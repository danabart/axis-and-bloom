# Sommelier Task 3 — Admin Portal
## Config Editor, Intent Editor, Token Dashboard, and Flow Diagram

**Depends on Task 1 being complete.** Can run in parallel with Task 2.

Before starting, verify:
- `config/sommelier` document exists in Firestore
- `getSommelierConfig()` importable from `sommelierConfig.ts`
- `user_tokens` and `token_events` tables exist in Cloud SQL
- `users/{uid}/sommelier_evaluations` Firestore structure defined (Task 1)

---

## Read these files first

1. `WHAT_WE_BUILT.md` — admin portal structure and tech stack
2. `WHAT_WE_BUILT_DB.md` — full database schema reference (the stats endpoint and Bloom Dial admin page query SQL — read this before writing any queries)
2. `frontend/src/app/components/admin/AdminDashboard.tsx` — UI patterns to follow
3. `frontend/src/app/components/admin/AdminLayout.tsx` — sidebar and layout conventions
4. `frontend/src/app/lib/api.ts` — apiFetch helper

---

## Shared: Config write endpoint

Add `PATCH /api/admin/sommelier/config` to `backend/src/routes/admin.ts` (behind `requireAdmin`).

Accepts a partial update to the `config/sommelier` Firestore document. Validates incoming data (weights are numbers 0–1, intent keys are valid, etc.). Writes with `set(..., { merge: true })`. Adds `updatedAt: serverTimestamp()`. The `sommelierConfig.ts` listener picks up the change automatically within ~1 second.

---

## Shared: Stats endpoint

Add `GET /api/admin/sommelier/stats` to `backend/src/routes/admin.ts`.

Reads all `sommelier_evaluations` documents (Admin SDK) and `user_tokens` / `token_events` from Cloud SQL. Aggregates and returns:

```json
{
  "totalEvaluations": 0,
  "needsSommelierRate": 0.0,
  "intentDistribution": {
    "DISCOVERY_SEEKER": { "count": 0, "sessionStartedRate": 0.0, "avgTurnsUsed": 0.0, "orderConversionRate": 0.0 },
    ...
  },
  "confidenceDistribution": { "low": 0, "medium": 0, "high": 0 },
  "outcomeStats": {
    "sessionCompletionRate": 0.0,
    "orderedWithin7DaysRate": 0.0,
    "returnedRate": 0.0,
    "avgTokensPerSession": 0.0
  },
  "tokenStats": {
    "totalTokensIssued": 0,
    "totalTokensSpent": 0,
    "avgBalancePerUser": 0.0,
    "usersWithZeroBalance": 0
  },
  "periodDays": 30
}
```

Only evaluations from last 30 days. Returns zeros when no data — diagram renders with "No data yet" labels.

---

## Add to `AdminLayout.tsx`

Add a "Sommelier" section to the sidebar with three links:
- "Configuration" → `/admin/sommelier/config`
- "Intent Editor" → `/admin/sommelier/intents`
- "Flow & Stats" → `/admin/sommelier/flow`

Add all three routes in `App.tsx` inside the existing `AdminRoute` wrapper.

---

## Page 1: `AdminSommelierConfig.tsx`
### Route: `/admin/sommelier/config`

### Section 1: Behavioral Confidence Weights

One card per component from `config.confidenceComponents`. Each shows:
- Active toggle (disabling removes it from score, weight redistributed proportionally)
- Weight input (number, 0.00–1.00, step 0.01)
- Label and description (read-only)

Live weight total below all inputs. Warning if total ≠ 1.00: "Weights must sum to 1.00 — currently {total}". Save disabled when invalid.

### Section 2: Confidence Thresholds

Two number inputs:
- "Medium threshold" (`confidenceThresholds.medium`)
- "High threshold" (`confidenceThresholds.high`)

Visual range bar: three colored zones (low / medium / high) updating live. High threshold must be > medium threshold — show validation error if not.

### Section 3: Token Economy

- "Signup bonus tokens" (`tokenEconomy.signupBonus`)
- "Order bonus tokens" (`tokenEconomy.orderBonus`)
- "Tokens per turn" (`tokenEconomy.costPerTurn`) — read-only with a note: "Changing this affects all future turns"
- "Token purchases enabled" (`tokenEconomy.purchaseEnabled`) — toggle. Currently disabled (Stripe placeholder). Show a note: "Enable when Stripe integration is configured."

### Section 4: Model Routing

- "Sonnet keywords" (`modelRouting.sonnetKeywords`) — tag input, renders as removable pills. Admins add/remove keywords.
- "Sonnet min message words" (`modelRouting.sonnetMinMessageWords`) — integer input. Note: "Messages longer than this word count trigger Sonnet."

### Section 5: Session Limits

- "Max turns per session" (`sessionLimits.maxTurns`) — integer input

### Section 6: RAG Limits

- "Max coffees per session" (`ragLimits.maxCoffees`) — integer input

### Section 7: Time Windows

All `timeWindows` keys as labeled number inputs. Label `sessionResumeWindowHours` as hours; all others as days.

### Section 8: Evaluator Rule Priority

Drag-to-reorder list of the 6 intent names from `evaluatorRulePriority`. Each row shows intent key and its human-readable label from config. Drag changes priority order. Save updates the array.

### Section 9: Recompute Centroids

A standalone button: "Recompute Intent Centroids". Calls `POST /api/admin/sommelier/recompute-centroids`. Shows a spinner while running, then shows: "Centroids updated — {N} evaluations processed" or an error.

### Save behavior

"Save Changes" button at the bottom. On click: `PATCH /api/admin/sommelier/config`. Success toast. Error message on failure.

---

## Page 2: `AdminIntentEditor.tsx`
### Route: `/admin/sommelier/intents`

One card per intent (six total). Each card:

**Header:**
- Intent key (e.g., `DISCOVERY_SEEKER`) — read-only label in monospace
- Human-readable label — editable text input
- Active toggle — disables this intent in the evaluator

**Body:**
- **RAG Focus** — dropdown: `archetype_range`, `alternatives`, `evolution_bridge`, `discovery`, `exact_match`, `curated_mix`. Brief description shown below selection.
- **Max Turns** — number input (per-intent override of global session limit)
- **Conversation Goal** — multiline textarea. Shown to admin and injected into system prompt.
- **System Prompt Addendum** — large multiline textarea. Most important field — shapes Liam's behavior for this intent. Show character count. Highlight border in amber if empty.

**Footer:**
- "Save [Label]" button — saves only this intent's block: `PATCH /api/admin/sommelier/config` with `{ intents: { [intentKey]: updatedValues } }`. Individual save per intent.
- "Preview System Prompt" button — opens a modal showing the complete system prompt as Liam would receive it: base prompt + catalog placeholder text + this addendum + goal. Read-only, for review before saving.

---

## Page 3: `AdminSommelierFlow.tsx`
### Route: `/admin/sommelier/flow`

A visual flow diagram of the complete evaluation and session pipeline. Built with React, positioned divs, and SVG connecting lines — no external diagram library. Uses brand colors from `theme.css`.

### Layout (top to bottom, centered)

**Row 1 — User State Inputs** (5 horizontal cards):
Quiz Sessions · Order History · Feedback Events · Archetype Stability · Token Balance

Each card: icon + label + live stat from `GET /api/admin/sommelier/stats`. Arrows point down to Row 2.

**Row 2 — Behavioral Confidence Score** (single centered box):
Shows the weighted formula visually — four component pills, each labeled `[Component] × {weight}`. Pulls weights live from config so they reflect current values. Arrows from Row 1 feed into this box.

**Row 3 — Trigger Evaluator** (single centered box):
Shows the `evaluatorRulePriority` list from config. Each rule shown as a labeled row with a short trigger condition description. Numbered by priority. Arrow from Row 2 points down.

**Row 4 — Intent Buckets** (6 horizontal boxes, one per intent):
Each box shows:
- Intent label (from config)
- Active/inactive indicator (green dot or grey)
- Stat badge: "N sessions (30d)" and "X% conversion"
- RAG focus label

Active intents: rust border. Inactive: grey border and muted text. Arrows from Row 3 fan out to each bucket.

**Row 5 — Liam** (single centered box):
- "Liam — Axis & Bloom Coffee Sommelier"
- Model routing: "Haiku by default · Sonnet when: keywords match OR message > {N} words"
- Max turns from config
- Arrow from Row 4 points down

**Row 6 — Outcomes** (3 horizontal boxes):
- Session Completion Rate
- Ordered Within 7 Days
- Returned to Sommelier

Stats from `GET /api/admin/sommelier/stats`. Arrows from Row 5. A curved arrow from Row 6 loops back up to Row 1 labeled "Improves future classifications".

**Row 7 — Token Economy** (2 horizontal boxes):
- "Tokens Issued" (total lifetime)
- "Tokens Spent" (total lifetime, with avg per session)

Positioned below Row 6, connected with a simple downward arrow from Row 5.

### Interactivity

- Hover an intent bucket (Row 4): highlights the RAG focus type description in Row 5
- Click an intent bucket: navigates to `/admin/sommelier/intents` scrolled to that card
- Top-right toggle "Show config values": overlays current numeric config values directly on the diagram (weights next to Row 2 arrows, thresholds in the confidence box, token values in Row 7, max turns in Row 5)
- "Refresh Stats" button: re-fetches `GET /api/admin/sommelier/stats` and updates all badges

---

## Bloom Dial admin (add if tables exist)

The Bloom Dial tables were created in June 2026. Add a fourth admin page:

**`AdminBloomDial.tsx`** at `/admin/sommelier/dial`:

Add "Bloom Dial" sidebar link under the Sommelier section in `AdminLayout.tsx` and route in `App.tsx`.

**Table reference** (all exist — no existence check needed):
- `dial_archetype_positions` — coffee positions per archetype (`archetype`, `coffee_id`, `position_label`, `dial_description`, `sort_order`, `is_default`)
- `dial_coffee_relationships` — hop graph (`from_coffee_id`, `to_coffee_id`, `dimension_id`, `direction`, `hop_label`, `hop_type`, `is_recommended`, `confidence`)
- `dial_archetype_config` — dominant dimension + `has_bloom_dial` flag per archetype (read-only in UI)
- `dial_position_vocabulary` — available labels per archetype+dimension combination (use to populate label dropdowns)
- `v_dial_positions` — view with names resolved (use for read queries)
- `v_dial_navigation` — view with names resolved (use for read queries)

**Left panel — Dial Positions:**
- Archetype selector dropdown
- Reads from `v_dial_positions` for the selected archetype
- Shows each position as a card: coffee name, `position_label` (dropdown populated from `dial_position_vocabulary` for this archetype+dimension), `dial_description` text input, `sort_order` number, `is_default` radio (only one per archetype)
- Admin can add new positions (insert to `dial_archetype_positions`), edit labels/descriptions, change default, remove positions
- "Dominant dimension: {name}" shown at top of panel from `dial_archetype_config`

**Right panel — Hop Graph:**
- Coffee search/select input
- Reads from `v_dial_navigation` where `from_coffee = selected coffee name` (outgoing hops)
- Also shows incoming hops (where `to_coffee = selected coffee`)
- For each hop: `to_coffee` name, `dimension` name, `direction` pill (`more` / `less`), `hop_label`, `hop_type` badge, `is_recommended` toggle, `confidence` badge
- Admin can add new hops (insert to `dial_coffee_relationships`), toggle `is_recommended`, remove hops
- "Auto-suggest relationships" button (future placeholder — shows "Coming soon" toast)

All writes go through a new backend route: `POST /api/admin/sommelier/dial` (accepts `{ action, table, payload }` — keeps the route surface small). Require admin auth.

---

## Before you finish: update documentation

When all checklist items are done, append a summary to `SOMMELIER_BUILT.md` under "Issues and Decisions". Include: any Firestore read performance decisions for the stats endpoint, diagram layout choices, config validation logic, and anything unexpected.

---

## What NOT to change

- Existing admin pages (Dashboard, Coffees, Sessions, Roasters, etc.)
- `requireAdmin` middleware — reuse it

---

## Definition of done

- [ ] `PATCH /api/admin/sommelier/config` — validates, merges, updates Firestore
- [ ] `GET /api/admin/sommelier/stats` — aggregates evaluations + token SQL data
- [ ] `POST /api/admin/sommelier/recompute-centroids` — computes and stores centroid vectors
- [ ] Sidebar links and routes added in `AdminLayout.tsx` and `App.tsx`
- [ ] `AdminSommelierConfig.tsx` — all 9 sections, weight sum validation, save
- [ ] `AdminIntentEditor.tsx` — all 6 intent cards, individual save, preview modal with "Liam" in the prompt preview
- [ ] `AdminSommelierFlow.tsx` — full diagram, live stats, config overlay toggle, intent click navigation
- [ ] All pages styled with existing design system (brand colors, Genova font, shadcn components)
