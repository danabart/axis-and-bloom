# Task: User lifecycle status (business/marketing, Cloud SQL) — decoupled from the Sommelier's conversation-scoping state (Firestore) — plus fixing the order-table split underneath both

**Terminology note:** this doc uses "user," not "customer," throughout — matching the schema itself, where every related table is already `user_profile`, `user_email`, `user_phone`, `user_feedback_event`, etc. There is no `customer_*` table anywhere in this codebase. Code identifiers, table names, and admin-facing labels should all say "user." ("Customer" is fine in brand-voice copy shown to shoppers, e.g. marketing emails — that's a tone choice, not a data-model term.)

## The bug that started this (from Dana's screenshots)

Two `Capture.JPG` / `Capture2.JPG` screenshots (in `backend/src/admin section/`) show a signed-in user (nav clearly shows **"SIGN OUT"**) landing on the homepage and still seeing:

- "Enter your name" / "BEGIN PROFILE →" — the profile-capture form, as if they were a first-time anonymous visitor
- "TAKE THE QUIZ →" / "or sign in →" — pushed regardless of whether they already took the quiz, and (in one screenshot) alongside the sign-in nudge even though they're signed in

Root cause in `frontend/src/app/components/Home.tsx`:

- **Section 2 "PROFILE CTA" (~lines 214–284)** — the "Enter your name" / "BEGIN PROFILE" form renders unconditionally for every visitor, signed in or not. Only the small "Already a member? Sign in →" sub-link is gated on `!user` (line 272).
- **Section 6 "QUIZ CTA" (~lines 429–451)** — "TAKE THE QUIZ" always renders; "or sign in" is correctly gated on `!user` already. But there's no check anywhere for **whether the signed-in user already completed the quiz**.

Investigating the fix led somewhere bigger: the codebase already has a user-classification system (the Sommelier's Intent engine), it's built on a table split that doesn't match reality, and this is a good moment to fix the foundation rather than bolt a second classifier on top of a shaky one.

**These are two genuinely separate systems, not one shared taxonomy — decided after going back and forth on this:**

- **User lifecycle status** is a business/marketing question: where does this user stand, right now and historically, for the purposes of the homepage, admin reporting, and future segmentation. It needs to be queryable and joinable (which archetype has the most lapsed users, average days from quiz to first order, etc.) and it needs history, not just a current snapshot — this is an analytics need, not a real-time need. That shape belongs in **Cloud SQL**, same as every other structured/reportable fact in this schema.
- **Sommelier conversation-scoping state** is a different question: what should Liam know to open *this* chat well — which Intent, what tone, which coffees to bring up. It's read once per session start, feeds directly into a prompt, and doesn't need to be joined against anything. That's exactly what the existing Firestore `confidence_profile` / `sommelier_evaluations` / `taste_journey` docs already are — leave them as they are.
- There is no enforced sequence between lifecycle stages (a user doesn't have to pass through stages in order — it's not a graph, just current-facts-re-evaluated), so lifecycle status is a flat classification with a plain history log, not a state-transition graph.
- The two systems share exactly one thing: the underlying raw facts (quiz history, order history, feedback history). That's `getUserSignals()` — a function, not a shared data store. Neither system reads the other's output.

This doc covers three things, in dependency order: **(0)** fix the order-table split both systems depend on, **(1)** build user lifecycle status in Cloud SQL, **(2)** wire the homepage to it and refactor the Sommelier to pull from the same shared signals function, without changing its Firestore-based behavior.

---

## Phase 0 — Migrate checkout off the legacy `orders` table (prerequisite, do this first)

**This table's existence has never actually been exercised.** `backend/src/routes/orders.ts` (`POST /api/orders`) calls `createOrder()` from `backend/src/services/shopify.ts` *before* it ever reaches `INSERT INTO orders (...)` — and `createOrder()` throws `'Shop not yet available'` until real Shopify credentials are set (they aren't yet). So every real checkout attempt today fails at the Shopify step, and the code path that would prove the `orders` table exists and works has never run in production. Confirmed by grep: **there is no `CREATE TABLE` for `orders` (plural) anywhere in `schema.sql` or any migration file** — if it exists at all, it was created by hand at some point outside the tracked schema. This matches Dana's read: the flow isn't actually built yet.

Meanwhile the schema already has a proper, normalized pair for this — `"order"` + `order_line_item` — and the rest of the system already assumes orders live there:
- `sommelierEvaluator.ts` and `behavioralConfidence.ts` both query `"order"` (currently returning 0 rows for everyone, since nothing writes to it — this is why `totalOrders` is silently always 0 today).
- `SOMMELIER_BUILT.md` (decision **S13**) already documents this exact gap: *"`sommelier_sms_feedback.order_id` (which FKs to `"order"(id)`) is always passed as `null` until the orders route is migrated."* That migration is what this phase does.

**Do this:**

1. Rewrite `POST /api/orders` in `backend/src/routes/orders.ts` to write to `"order"` + `order_line_item` instead of the legacy `orders` table:
   - Resolve `user_profile.id` from `req.uid` (firebase UID) first — `"order".user_id` is a UUID FK to `user_profile(id)`, not a firebase UID string like legacy `orders.uid` was.
   - Insert one `"order"` row (`user_id`, `external_shopify_order_id`, `fulfillment_status`, `subtotal`/`total_amount_paid` computed from cart items).
   - Insert one `order_line_item` row per cart item (`blend_id`, `quantity`, `unit_price_charged`) instead of the current `items` JSON blob.
   - **Shipping address — decided: snapshot, don't live-reference.** `"order"` has no shipping-address column today. Standard e-commerce practice (this is how Shopify itself handles it, among others) is to copy the address fields onto the order at checkout time, not store a live FK to the `address` table. Reasoning: if the customer later edits or deletes that saved address, a live reference would silently rewrite what a past order "shipped to" — wrong for support lookups, returns, and tax-jurisdiction records. Add snapshot columns directly to `"order"` (`shipping_street`, `shipping_city`, `shipping_state`, `shipping_postal_code`, `shipping_country`) or a tiny 1:1 `order_shipping_snapshot` table if that's cleaner stylistically. Optionally *also* keep `shipping_address_id UUID REFERENCES address(id)` alongside the snapshot purely for "which saved address did this come from" convenience — but the snapshot fields are the source of truth for what was actually shipped.
   - Update the two places `orders.ts` currently reads from the legacy table for its own logic: the order-count check that gates Liam's SMS scheduling (`orderCount <= 2`) and the token-bonus logic — both need to count from `"order"` now.
   - Once `"order".id` exists at insert time, pass the real order ID into `schedulePostDeliveryMessage()` — this closes out the `null` gap from S13.
2. Verify inventory decrement logic (currently keyed on `item.blendId ?? item.id` against `roaster_blend`) still works unchanged — it doesn't depend on which order table is used.
3. This phase is what makes UC3/UC4 and the Sommelier's `totalOrders` signal trustworthy at the same time — don't build the lifecycle classification (Phase 1/2 below) against the legacy table as a stopgap; there won't be a stopgap needed once this ships.

---

## Phase 1 — User lifecycle status, entirely in Cloud SQL

### Recap: the Sommelier's existing six Intents (context only — not being changed here)

`backend/src/services/sommelierEvaluator.ts` classifies every chat session into exactly one Intent, checked in priority order:

| Intent | Trigger | Goal |
|---|---|---|
| `DISCOVERY_SEEKER` | experimental flag from quiz | push toward the unexpected |
| `PROFILE_AMBIGUOUS` | quiz tie, low food-signal alignment, or `ai_agent` mode | clarify archetype through dialogue |
| `TASTE_EVOLUTION` | archetype changed between the last two quiz takes | explore what shifted |
| `RECOMMENDATION_MISS` | negative feedback signal within a lookback window | find an alternative |
| `CONVERSION` | confirmed archetype (`behavioralLevel !== 'low'`) + zero orders | remove hesitation, get the first order |
| `EXPLORATION` | user opened chat themselves, no stronger trigger | open-ended discovery |

Weights, thresholds, and per-intent prompt config stay admin-editable in Firestore `config/sommelier` (`AdminSommelierConfig` / `AdminIntentEditor`) — **nothing about this system changes in this task** beyond having it read `getUserSignals()` (Phase 2) instead of inlining its own queries.

### User lifecycle status is a separate, SQL-native concept — current state + history, no graph

No stage has to be reached before another (a user can go straight from "never quizzed" to nothing at all, there's no enforced path), so there's nothing graph-shaped here — just a classification re-evaluated from current facts, plus a plain log of when it changed, for analytics. Three tables, all following existing patterns in this schema:

**1. Definition — reference/lookup table, same pattern as `lookup_value` / `archetype`:**

```sql
CREATE TABLE IF NOT EXISTS user_lifecycle_stage (
  id                SERIAL PRIMARY KEY,
  code              TEXT UNIQUE NOT NULL,       -- e.g. 'QUIZ_TAKEN_FRESH_NO_ORDER'
  label             TEXT NOT NULL,               -- admin-facing name
  description       TEXT,
  sort_order        INTEGER DEFAULT 0,
  homepage_enabled  BOOLEAN DEFAULT true,        -- does this stage drive a homepage CTA?
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT timezone('utc', now())
);
```

No `sommelier_intent` column — that was me trying to force a link between the two systems that shouldn't exist. Drop it.

Seed rows (starting set — extend freely, this is meant to grow beyond today's 5 homepage use cases as new business questions come up):

| code | homepage_enabled | notes |
|---|---|---|
| `NEW_NO_QUIZ` | true | UC2 |
| `QUIZ_TAKEN_FRESH_NO_ORDER` | true | UC1, <30 days |
| `QUIZ_TAKEN_SETTLED_NO_ORDER` | true | UC1, 30–180 days |
| `QUIZ_STALE_NO_ORDER` | true | UC1, >180 days — also eligible for the retake nudge |
| `FIRST_ORDER_FEEDBACK_PENDING` | true | UC3 |
| `ACTIVE_REPEAT_USER` | true | ordering normally, no nudge needed |
| `SUBSCRIBER` | true | UC4, active subscription |
| `REORDER_DUE` | true | UC4, gap exceeds their own cadence |
| `LAPSED_SINGLE_ORDER` | true | UC4, one order, long silence |

Admin-editable the same way `lookup_value` already is (`GET /api/admin/lookups`-style pattern) — reuse it rather than inventing new admin UI.

**2. Current state — one row per user, cheap indexed read at pageview time:**

```sql
CREATE TABLE IF NOT EXISTS user_lifecycle_state (
  user_id      UUID PRIMARY KEY REFERENCES user_profile(id) ON DELETE CASCADE,
  stage_id     INTEGER REFERENCES user_lifecycle_stage(id),
  computed_at  TIMESTAMPTZ DEFAULT timezone('utc', now())
);
```

**3. History — append-only, for funnels and cohort analysis, never updated in place:**

```sql
CREATE TABLE IF NOT EXISTS user_lifecycle_event (
  id              SERIAL PRIMARY KEY,
  user_id         UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  from_stage_id   INTEGER REFERENCES user_lifecycle_stage(id),
  to_stage_id     INTEGER REFERENCES user_lifecycle_stage(id),
  transitioned_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_user_lifecycle_event_user     ON user_lifecycle_event(user_id);
CREATE INDEX IF NOT EXISTS idx_user_lifecycle_event_to_stage ON user_lifecycle_event(to_stage_id);
```

Same idea as the existing Firestore `taste_journey` history array (archetype changes over time), just relational — because the whole point here is to answer things like "what % of `QUIZ_TAKEN_FRESH_NO_ORDER` users reach a first order within 14 days," which is a join/aggregate query, not a per-user document read. This is exactly why it belongs in Cloud SQL and not alongside the Sommelier's Firestore docs — different consumer, different access pattern, same underlying facts.

Write path (`refreshLifecycleState`, Phase 2): compute the new `stage_id` from `getUserSignals()`, compare to the existing row in `user_lifecycle_state`; if it changed, `UPDATE` the current-state row and `INSERT` one row into `user_lifecycle_event` (old stage → new stage); if unchanged, just bump `computed_at`. One SQL transaction, same connection pool as everything else — no separate Firestore SDK round trip needed for this piece at all.

---

## Phase 2 — Shared signals function, then two independent, cheap consumers

1. **`backend/src/services/userSignals.ts`** → `getUserSignals(uid): Promise<UserSignals>` — pull the Stage-1 data collection out of `evaluateSommelier()` (quiz sessions/count/archetype changes, order data — now from `"order"`/`order_line_item` post-Phase-0, behavioral confidence, negative-feedback flag, demographics). Add fields the homepage needs that the Sommelier doesn't compute today: order dates (reorder-gap math), active-subscription flag (`subscription` table), and a per-order feedback-pending check (distinct from "any recent *negative* feedback" — this is "has *any* feedback been left for *this* order").
2. **Refactor `sommelierEvaluator.ts`** to call `getUserSignals(uid)` instead of inlining its own queries. Its six-intent logic is otherwise unchanged — re-verify manually that `CONVERSION` and `TASTE_EVOLUTION` still fire sensibly now that `totalOrders` reflects real orders instead of always reading 0.
3. **`refreshLifecycleState(uid)`** (SQL, `backend/src/services/userLifecycle.ts`) — computes the new `stage_id` from `getUserSignals()` output against the thresholds below, upserts `user_lifecycle_state`, and inserts a `user_lifecycle_event` row when the stage actually changed. Call it fire-and-forget from the same three hooks `computeBehavioralConfidence()` already runs from (quiz results route, order route, feedback parser) — this is a second, independent write from that same trigger point, not a replacement for it.
4. **`GET /api/users/homepage-state`** — a single indexed SQL join (`user_lifecycle_state` → `user_lifecycle_stage`) keyed on `user_id`, cheap at pageview time, no Firestore involved for this piece at all. Falls back to computing live via `getUserSignals()` only if no row exists yet (first visit before any trigger has fired).
5. **Homepage-specific thresholds** — named constants, separate from Sommelier's Firestore `config/sommelier`: `QUIZ_FRESH_DAYS = 30`, `QUIZ_DRIFTED_DAYS = 180`, `FEEDBACK_WINDOW_START_DAYS = 10`, `FEEDBACK_NAG_SUPPRESS_DAYS = 14`, `REORDER_GAP_MULTIPLIER = 1.5`, `SINGLE_ORDER_LAPSE_DAYS = 45`.
6. **Frontend** — replace Home.tsx sections 2 (~214–284) and 6 (~429–451) with a component driven by `GET /api/users/homepage-state`. Remove the unconditional "Enter your name" form for signed-in users entirely. Remove any "or sign in" not already gated on `!user`.
7. **On-site feedback form (new — confirmed in scope, not a stub; zero-LLM-cost by default — see Cloud cost section below).** Small form: 1–5 star rating + optional free-text note, tied to a specific order/blend. `POST /api/orders/:orderId/feedback` (auth required, ownership-checked against the order's `user_id`) writes to Firestore `users/{uid}/feedback_events` with the **same document shape** `liamSmsFeedback.ts` already writes (`signalType`, `rating`, `sValue`, `sentiment`, `descriptors`, `orderId`, `blendId`, `createdAt`), plus a `source: 'onsite'` field (vs. `'sms'`) so channel is distinguishable without changing anything `behavioralConfidence.ts` or `sommelierEvaluator.ts` already read. Compute `rating`/`sentiment`/`sValue` directly from the star input in plain code — no Haiku call, unlike the SMS path, which has to parse free text because it has no structured rating to work with. `descriptors` can just be empty/omitted for on-site submissions; parsing the optional free-text note into descriptors via Haiku is a separate future enhancement, not part of this task. This makes the two feedback channels interchangeable from every downstream consumer's point of view. Frontend surface: triggered from the UC3 homepage nudge ("How was [Blend]? Leave a quick note") and also reachable from `Profile.tsx` order history, not just the homepage.

---

## Use cases (what each stage should render)

**UC0 — Anonymous.** Unchanged: "Take the quiz" + "or sign in."

**UC2 — `NEW_NO_QUIZ`.** Signed in, never quizzed. Direct fix for the screenshots: no profile-capture form, no "or sign in." Primary CTA: "Ready to find your flavor?" → quiz.

**UC1 — quiz taken, never ordered**, bucketed by `daysSinceQuiz`:
- `QUIZ_TAKEN_FRESH_NO_ORDER` (<30d): "You're a [Archetype] — shop your matches." No quiz mention.
- `QUIZ_TAKEN_SETTLED_NO_ORDER` (30–180d): same, quiz link de-emphasized.
- `QUIZ_STALE_NO_ORDER` (>180d): same, plus an optional "Palates change — retake anytime."

**UC2b — admin/roaster account, no consumer activity.** Decided: no special-casing. Show whatever `user_lifecycle_stage` their actual signals produce, same as any other user — an admin who's also a customer should see accurate CTAs, and one who isn't will naturally land in `NEW_NO_QUIZ` like anyone else. Don't build `isAdmin`-based suppression logic for this.

**UC3 — `FIRST_ORDER_FEEDBACK_PENDING`.** Order past `FEEDBACK_WINDOW_START_DAYS` with no matching `feedback_events` doc, and Liam's SMS loop hasn't already captured one. No on-site feedback submission surface exists yet — **build one as part of this task**, not a follow-up. See "On-site feedback form" under Phase 2 below. Suppress re-showing the homepage nudge for `FEEDBACK_NAG_SUPPRESS_DAYS` after dismissal.

**UC4 — ordered before, not currently ordering:**
- `SUBSCRIBER` (active row in `subscription`): show subscription/next-shipment status, no reorder nudge.
- `REORDER_DUE` (≥2 orders, gap since last exceeds `REORDER_GAP_MULTIPLIER × average gap`): reorder nudge referencing usual blend.
- `LAPSED_SINGLE_ORDER` (1 order, no repeat, >`SINGLE_ORDER_LAPSE_DAYS`): softer re-engagement copy ("New arrivals since your last order"), not an assumed-repeat nudge.
- Otherwise (`ACTIVE_REPEAT_USER` or a recent single order): default profile/shop CTA, no special nudge.

---

## Context to read before touching anything

- `frontend/src/app/context/AuthContext.tsx` — exposes `user`, `isAdmin`.
- `GET /api/quiz/results/latest` (`backend/src/routes/quiz.ts`) — latest `quiz_session`, has `completed_at`.
- `GET /api/users/profile` (`backend/src/routes/users.ts`) — check current `orders[]` shape before relying on it; it likely needs updating once Phase 0 lands.
- `SOMMELIER_BUILT.md` in full — six intents, `confidence_profile`/`sommelier_evaluations`/`taste_journey` Firestore shapes, and prior bugs in this exact area (S8, S13, S22, S23) worth not repeating.
- `backend/src/services/liamSmsFeedback.ts` — 10 days after order #1 or #2, Liam texts asking how the coffee was; replies are parsed to Firestore `users/{uid}/feedback_events`. Any on-site feedback nudge (UC3) is a fallback channel for this, not a replacement — check `feedback_events` before asking on-site so the customer is never asked twice.
- Project convention throughout this codebase: **decision logic lives in the backend, the frontend only renders what it's told** (see quiz scoring: "All scoring logic lives here — zero logic in the frontend"). Same rule applies here.
- `CLAUDE_CODE_PROMPT_ADMIN_REORG.md` previously scoped the `orders`-vs-`"order"` reconciliation as "a separate, bigger cleanup" out of scope for that task. This task is that cleanup, scoped narrowly to the checkout write path (Phase 0) — it's the right moment because the flow isn't live yet, not a detour.

---

## Decisions log (resolved with Dana — build against these, don't re-litigate)

1. **Shipping address**: snapshot onto `"order"` at checkout time. See Phase 0 above.
2. **Threshold values**: the proposed defaults (30/180 day quiz windows, 10-day feedback window, 1.5× reorder multiplier, 45-day lapse) are the accepted starting point. Still named constants in one place so they're easy to retune after real usage data comes in.
3. **UC2b (admin/roaster accounts)**: no special-casing — default view for everyone, based on actual signals. See UC2b above.
4. **On-site feedback form**: confirmed it doesn't exist yet, and confirmed to build it now, not defer it. See Phase 2 item 7.
5. **`totalOrders` fix changes live Sommelier behavior**: confirmed expected and wanted. For reference, here's how `behavioralScore` is actually calculated today (`behavioralConfidence.ts`) — this doesn't change in this task, only the `totalOrders` input feeding into it does:
   - `quizStability` (30% weight): 1 quiz taken → 0.30 baseline; 2+ quizzes, same archetype every time → 0.90; any archetype change across retakes → 0.15.
   - `behavioralValidation` (40% weight): 0 orders → 0.40 neutral default; otherwise, the fraction of orders whose blend matches the user's current archetype. **This is the component the order-table fix directly repairs** — today it's stuck at the 0.40 neutral default for every real customer because `totalOrders` always reads 0.
   - `dataDepth` (20% weight): log-scale of total interactions (quiz count + order count + feedback count), so more history generally raises confidence regardless of direction.
   - `feedbackAlignment` (10% weight): 0 feedback events → 0.50 neutral; otherwise the fraction of feedback events that were positive.
   - Weighted sum → `score`; `level` = high (≥0.70) / medium (≥0.40) / low, otherwise. Weights and thresholds are admin-configurable in Firestore `config/sommelier.confidenceWeights` / `confidenceThresholds`.
6. **`REORDER_DUE` as a future Sommelier trigger**: not building it now, but scoped for later specifically as a topic Liam could raise with users who've ordered exactly once and gone quiet — a natural "haven't heard from you in a while" opening, distinct from `CONVERSION` (which targets zero-order users, not lapsed one-time buyers).

---

## Cloud cost — designed to add none, one spot to watch

- **No new GCP services or instances.** The three new tables (`user_lifecycle_stage`, `user_lifecycle_state`, `user_lifecycle_event`) live in the existing `axis-bloom-db` Cloud SQL instance. `GET /api/users/homepage-state` and `refreshLifecycleState()` run inside the existing `axis-bloom-backend` Cloud Run service. Nothing new to provision, nothing new billed on its own line.
- **This is exactly why lifecycle status was built in Cloud SQL and not Firestore.** Cloud SQL is billed by instance size + storage, essentially flat regardless of how many small queries run on it — adding a homepage read on every signed-in pageview doesn't move the bill. Firestore bills per document read/write, so putting a per-pageview lookup there (as the Sommelier's `confidence_profile` reads/writes already do, at chat-session start only, far lower volume) would have scaled with homepage traffic. That trade-off is a real reason this design is cheaper, not just tidier.
- **The one place a real new cost could sneak in: the on-site feedback form.** The SMS feedback loop uses a Haiku call to parse free-text replies into a structured signal — a genuine per-message Anthropic API cost, already accepted for that feature. Don't copy that pattern by default for the on-site form: since the user picks a star rating directly, compute `sentiment`/`sValue` from that number in plain code (e.g. rating ≥4 → positive, ≤2 → negative, `sValue = rating / 5`) — zero LLM calls. Only the free-text note's optional descriptor extraction would need Haiku, and that should be a separate, explicitly-flagged addition Dana can approve on its own, not bundled in as if it's required.

---

## Test matrix

Seed test users in dev covering each stage (varying `quiz_session.completed_at`, rows in `"order"`/`order_line_item`, a `subscription` row, Firestore `feedback_events` docs) and verify: the correct `stage_id` lands in `user_lifecycle_state`, a `user_lifecycle_event` row is written only when the stage actually changes (not on every recompute), the homepage renders the matching CTA, and Sommelier intents still fire correctly post-refactor. Real UC3/UC4 verification against live traffic isn't possible until Shopify is wired for real — call this out in the PR description.

A quick sanity query worth running after seeding: `SELECT cls.label, COUNT(*) FROM user_lifecycle_state uls JOIN user_lifecycle_stage cls ON cls.id = uls.stage_id GROUP BY cls.label;` — if this kind of query is awkward or impossible, the design has drifted back toward something Firestore-shaped and should be reconsidered.
