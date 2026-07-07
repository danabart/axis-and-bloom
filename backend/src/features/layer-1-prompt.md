# Claude Code Prompt — Layer 1: Feedback Loop + Behavioral Signals

## Context

Axis & Bloom is a specialty coffee brand. The stack:
- React 18 + Vite + TypeScript frontend → Firebase Hosting
- Node.js + Express + TypeScript backend → Google Cloud Run
- PostgreSQL on Cloud SQL (schema in `backend/src/db/schema.sql`, fully idempotent — all changes use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
- Firebase Auth (token verification in `backend/src/middleware/auth.ts`)
- Transactional email via Resend from `noreply@axisandbloomcoffee.com` (see existing pattern in `backend/src/routes/auth.ts` → `POST /api/auth/reset-password`)
- Frontend routes in `frontend/src/app/App.tsx`; public routes wrap in `<PublicLayout>`
- Backend routes registered in `backend/src/index.ts`

The `order` table exists but is currently stubbed (Shopify not wired yet). The `client_flavor_feedback` table and `feedback_event` table already exist in the schema. The `v_collaborative_flavor_wheel` view returns all descriptor observations per coffee with source label.

---

## What to Build

Three things:

1. **Post-purchase feedback system** — a token-authenticated feedback page customers access via email link, no login required, that collects flavor descriptor feedback and a sentiment signal for a specific coffee they received.

2. **Behavioral signal logging** — a lightweight event table + endpoint + frontend hooks that silently track which coffees customers view and interact with.

3. **Retake quiz prompt** — a banner on the Profile page nudging customers who have 3+ orders and haven't taken the quiz in 90+ days.

---

## 1. Post-Purchase Feedback System

### Schema changes (`backend/src/db/schema.sql`)

Add two columns to the `order` table (idempotent):
```sql
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS feedback_token UUID UNIQUE DEFAULT gen_random_uuid();
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS feedback_sent_at TIMESTAMPTZ;
```

No new tables needed — `client_flavor_feedback` and `feedback_event` already exist.

### Backend: new route file `backend/src/routes/feedback.ts`

**`GET /api/feedback/:token`** — public, no auth.
- Look up the `order` row by `feedback_token`. Return 404 if not found or token is used (add a `feedback_submitted_at TIMESTAMPTZ` column to `order` to track this — add it idempotently to schema.sql too).
- From the order, get the coffee (via `order_line_item → blend → coffees` join — note that `blend` links to `coffees` via the catalogue).
  - If the join is complex given the stub state, fall back to: accept the `coffee_id` as a query param for now (`GET /api/feedback/:token?coffeeId=X`) and document this is temporary until Shopify is wired.
- Fetch that coffee's descriptors from `v_collaborative_flavor_wheel` — return name, roaster, and up to 12 descriptors (prioritise `internal` source first, then `roastery`) as chips for the UI.
- Also return the full list of SCA cupping notes (`SELECT id, descriptor, wheel_category, wheel_subcategory FROM cupping_note ORDER BY wheel_category, descriptor`) so the user can add descriptors not in the pre-populated set.
- Response shape:
```json
{
  "coffeeId": 1,
  "coffeeName": "Crosshatch",
  "roaster": "Path Coffee Roasters",
  "suggestedDescriptors": [
    { "id": 42, "descriptor": "Dark Chocolate", "wheelCategory": "Nutty / Cocoa" }
  ],
  "allDescriptors": [...],
  "alreadySubmitted": false
}
```

**`POST /api/feedback/:token`** — public, no auth.
- Validate token exists and `feedback_submitted_at` is null (reject with 409 if already submitted).
- Body:
```json
{
  "coffeeId": 1,
  "sentiment": "loved_it",
  "descriptorIds": [42, 17, 8],
  "notes": "Really got the dark chocolate, less citrus than expected"
}
```
- `sentiment` is one of: `loved_it`, `it_was_okay`, `not_for_me`.
- For each `descriptorId`, insert one row into `client_flavor_feedback`:
  - `coffee_id`, `cupping_note_id`, `intensity` = null (we're not collecting intensity in this flow), `notes` = the free text field value (only on the first descriptor row; null on the rest — or store notes separately, see below).
- Insert one row into `feedback_event`:
  - `user_id` = null (no auth required for this flow — check if the column is nullable; if not, make it nullable via idempotent `ALTER TABLE feedback_event ALTER COLUMN user_id DROP NOT NULL`).
  - `event_type` = `'post_purchase_feedback'`, plus the sentiment value. Check the existing columns on `feedback_event` and use whatever fits — if there's a `rating` or `event_data` JSONB column, use it for sentiment. If neither exists, add `ALTER TABLE feedback_event ADD COLUMN IF NOT EXISTS event_data JSONB`.
- Mark the token used: `UPDATE "order" SET feedback_submitted_at = NOW() WHERE feedback_token = $1`.
- Return `{ success: true }`.

**`POST /api/admin/orders/:orderId/send-feedback-email`** — admin only (uses `requireAdmin` middleware).
- Looks up the order, generates/confirms its `feedback_token`, sends the feedback email via Resend.
- This is the manual trigger for now (until Shopify webhooks are wired). Used to test the flow and send emails manually per order.
- Mark `feedback_sent_at = NOW()` on the order row after sending.

Register all three routes in `backend/src/index.ts`:
```typescript
import feedbackRouter from './routes/feedback';
app.use('/api/feedback', feedbackRouter);
```

### Resend email template

Follow the exact same pattern as the password reset email in `backend/src/routes/auth.ts`. Branded HTML, from `noreply@axisandbloomcoffee.com`.

Subject: `"How did [Coffee Name] land?"`

Body (HTML): Keep it minimal and on-brand.
- Brief heading: "We'd love to know what you tasted."
- One sentence: "It only takes a minute — no login needed."
- A single CTA button linking to `https://axisandbloom.com/feedback/[token]`
- Small footer: Axis & Bloom wordmark.

### Frontend: `/feedback/:token` page

New file: `frontend/src/app/components/FeedbackPage.tsx`

Add to `App.tsx` as a public route (inside `PublicLayout`):
```tsx
<Route path="/feedback/:token" element={<FeedbackPage />} />
```

**Page states:**
1. **Loading** — spinner while fetching `GET /api/feedback/:token`.
2. **Already submitted** — if `alreadySubmitted: true`, show: "You already shared your thoughts on this coffee. Thanks!" No form.
3. **Feedback form** — the main state.
4. **Success** — after submit: "Thanks for sharing. Your feedback helps us find better coffees for you." No further action needed.

**Form layout (state 3):**

```
[Coffee name] from [Roaster]

How did it land?
[ Loved it ]  [ It was okay ]  [ Not for me ]   ← tap-to-select pills, one choice

What did you taste?
[Dark Chocolate ×]  [Caramel ×]  [Citrus ×]   ← pre-populated chips from suggestedDescriptors, toggled on/off
[ + Add a descriptor ]                          ← opens a searchable dropdown of allDescriptors

Anything else? (optional)
[                                              ]  ← single text input, max 280 chars

[ Submit ]
```

Design notes:
- Match the site's aesthetic — cream background (`#f2f1ea`), rust accent (`#a33726`), clean sans-serif. Look at existing components for color tokens and Tailwind classes.
- Pre-populated chips start **selected** (toggled on). User can deselect ones they didn't taste and add new ones.
- The sentiment selector is required — Submit button is disabled until one is chosen.
- On submit, POST to `/api/feedback/:token` with `{ coffeeId, sentiment, descriptorIds: [...selectedIds], notes }`.

---

## 2. Behavioral Signal Logging

### Schema (`backend/src/db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS user_behavior_event (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT,                        -- firebase_uid, nullable (guests too)
  event_type  TEXT NOT NULL,               -- 'coffee_view' | 'compare_open' | 'compare_select'
  coffee_id   INT REFERENCES coffees(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_behavior_user ON user_behavior_event(user_id);
CREATE INDEX IF NOT EXISTS idx_user_behavior_coffee ON user_behavior_event(coffee_id);
```

### Backend: add to `backend/src/routes/coffees.ts` or a new `events.ts` file

**`POST /api/events`** — no auth required (guests can trigger events too). If a Firebase token is present in the `Authorization` header, extract the uid; otherwise store null.

Body: `{ eventType: 'coffee_view' | 'compare_open' | 'compare_select', coffeeId: number }`

Validate that `eventType` is one of the three allowed values. Insert one row. Return `{ ok: true }`. This endpoint should be fire-and-forget from the frontend — errors should never surface to the user.

Register in `backend/src/index.ts`.

### Frontend: fire events in `CoffeesPage.tsx`

In `frontend/src/app/components/CoffeesPage.tsx`, add a `logEvent` helper:

```typescript
async function logEvent(eventType: string, coffeeId: number) {
  try {
    const token = await auth.currentUser?.getIdToken();
    await fetch(`${API_URL}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ eventType, coffeeId })
    });
  } catch {
    // silent — never surface to user
  }
}
```

Fire it at:
1. **`coffee_view`** — when a coffee is selected in the sidebar (when `selectedCoffeeId` changes and is not null).
2. **`compare_open`** — when the compare toggle is activated.
3. **`compare_select`** — when the second coffee is selected in compare mode.

Use `useRef` to avoid double-firing in React strict mode (fire only when the value actually changes, not on re-render).

---

## 3. Retake Quiz Prompt (Profile Page)

In `frontend/src/app/components/Profile.tsx`:

The profile already fetches `GET /api/users/profile` which returns `archetype` and order data. Check if it also returns `lastQuizDate` (it should — this was added in issue #43).

Add a banner at the top of the profile page (above the tab bar) that shows when ALL of the following are true:
- User has an archetype (has taken the quiz at least once)
- `orders.length >= 3` (has 3 or more orders)
- `lastQuizDate` is more than 90 days ago, or is null

Banner design: subtle, non-intrusive. Cream background, rust left border, dismissible with an ×.

```
Your taste may have evolved since your last quiz.   [Retake →]   [×]
```

"Retake →" navigates to `/find-my-flavor`. The × dismisses the banner for the session (use `useState` — no persistence needed, it can re-appear next visit).

---

## Patterns to Follow

- All schema changes in `backend/src/db/schema.sql` — idempotent, `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- New backend route files follow the same structure as `backend/src/routes/auth.ts` — import `Router` from express, export default router, register in `index.ts`.
- Public endpoints (no auth): no middleware. Auth-required: `authenticateToken`. Admin-required: `requireAdmin`.
- Resend email pattern: copy from the password reset email in `backend/src/routes/auth.ts`.
- Frontend API calls: use the `apiFetch` helper from `frontend/src/app/lib/api.ts` for authenticated calls. For public calls (feedback page is unauthenticated), use plain `fetch` with `API_URL` from env.
- All colors and spacing should match the existing site — rust `#a33726`, cream `#f2f1ea`, sage, etc. Look at existing components for Tailwind classes in use.

---

## Out of Scope for This Build

- Scheduled/automatic email sending (add when Shopify is wired)
- Parsing free-text notes with Claude (future)
- Surfacing behavioral data in the agent (future — data collection first)
- Household-level feedback aggregation (future)
