# Profile Part 2 — Backend: flavor-memory read endpoint + feedback form v2 write path

**Date:** 2026-07-18
**Scope:** backend only (`backend/src/routes/`, `backend/src/services/`). No frontend changes in this part — Part 3 consumes what this builds. Independent of Profile Part 1 (can run before or after it); Part 3 requires both.

---

## Context

The Profile page's Flavor Memory tab is being rebuilt into the user's personal taste record (see `CLAUDE_CODE_PROMPT_PROFILE_PART1_FLAVOR_MEMORY_AND_LAYOUT.md` for the layout foundation). Two backend gaps block the content layer:

1. The system captures every personal signal — orders, feedback events (SMS + on-site), archetype changes over time (`taste_journey`), flavor-note contributions (`user_flavor_feedback`) — but **no user-facing read endpoint exposes any of it**. Only internal consumers (`userSignals.ts`, `sommelierEvaluator.ts`) read this data today.
2. The on-site feedback form (`POST /api/orders/:orderId/feedback`) captures only stars + free text. Dana has decided on a **v2 question set** (mix of closed questions + open text): overall stars, a closed dial-direction question, tasted-notes chips, and the free-text note. The closed answers should feed two systems that already exist and are waiting for exactly this data: `dial_position_signal` (the dormant customer→dial loop — `onsite_feedback` is already seeded with `reliability_weight = 1` in `dial_source_weight`) and `user_flavor_feedback` (the client-source rows of the Collaborative Flavor Wheel — see `v_collaborative_wheel`'s join on it).

## A. `GET /api/users/flavor-memory` (new, auth required)

One endpoint serving the three content blocks. Response shape (adapt field names to codebase conventions, keep the structure):

```jsonc
{
  "journal": [           // newest first, one entry per order
    {
      "orderId": "…",
      "date": "…",
      "blendName": "…",       // same resolution the UC3 pendingFeedback.blendName uses
      "rating": 4,            // null if no feedback yet
      "note": "…",            // rawText, null if none
      "source": "onsite",     // 'onsite' | 'sms' | null
      "hasFeedback": true
    }
  ],
  "journey": [           // archetype history, oldest first
    { "archetype": "floral", "archetypeLabel": "Floral", "at": "…", "trigger": "quiz" }
  ],
  "contributionCount": 4  // COUNT of this user's user_flavor_feedback rows
}
```

Implementation notes:

- **Journal** = the user's orders (same ownership join `POST /:orderId/feedback` uses) merged with their Firestore `users/{uid}/feedback_events` docs, matched by `orderId`. One Firestore read for all events, matched in code — don't query per order.
- **Journey** = the Firestore doc `users/{uid}/taste_journey` — **shape verified against `quiz.ts`'s results route** (Sommelier Task 1 §12; written fire-and-forget on every authenticated quiz save): `{ currentArchetype, currentStreakCount, evolutionCount, archetypeHistory: [{ archetype, date (Timestamp), quizSessionId, confidenceLevel, trigger: 'first_quiz' | 'retake' }], lastUpdated }`. Map `archetypeHistory` to the `journey[]` response (resolve `archetypeLabel` from the same label source the rest of the backend uses). Same-archetype retakes append an entry too (streak increments) — pass them through; the frontend decides presentation. **Backfill caveat:** users who quizzed before Sommelier Task 1 shipped have a missing or late-starting history — when the doc is absent/empty for a user with a current archetype, fall back to a single synthetic entry from their current archetype + quiz date so matched users always get ≥1 entry.
- **Roaster-blindness:** `blendName` here describes the user's *own past orders* — the same reasoning that cleared `pendingFeedback.blendName` for UC3 applies (it's their own already-known order, not catalogue browsing). Do **not** include roaster names, raw coffee names, or exact origins anywhere in the payload. If the blend→display-name resolution requires touching fields not already cleared by that precedent, stop and flag rather than leak.

## B. Feedback v2 — extend `POST /api/orders/:orderId/feedback`

Extend the existing route (keep it backward-compatible — old clients sending only `{rating, note}` must keep working; every new field optional):

```jsonc
{
  "rating": 4,                          // unchanged, required
  "note": "…",                          // unchanged, optional
  "expectation": "bolder",              // NEW optional: 'lighter' | 'as_expected' | 'bolder'
  "tastedNoteIds": ["<cupping_note id>", "…"]  // NEW optional: chips the user picked
}
```

What each new field writes:

1. **`expectation` → `dial_position_signal`** (the dormant Stage 2 loop from `BLOOM_DIAL_ALLOCATION_SPEC.md` §3 — read it before implementing). Resolve the order to its coffee and the coffee to its current archetype + the archetype's dominant dimension (`dial_archetype_config.dominant_dimension_id`). Insert a row: `source = 'onsite_feedback'`, `direction = 'less'` for `lighter` / `'more'` for `bolder`, `sample_size = 1`, `confidence = 'medium'`, `notes` referencing the orderId. Follow `recordCuppingSignal`'s conventions (supersede semantics, null-guards) — read it first; but note feedback signals are per-event observations, so appending rows (letting `v_dial_position_consensus` aggregate) is likely right where cupping supersedes. Decide from the spec + view definition and state your choice in the summary. `as_expected` writes **no** signal row this pass (it confirms the status quo; a confirmation-signal design is a future refinement — flag it, don't build it). Nothing here writes to `dial_archetype_positions` — that stays manual, per Phase 5's hard rule.
2. **`tastedNoteIds` → `user_flavor_feedback`** — one row per chip: `user_id`, `coffee_id` (resolved from the order), `order_id`, `cupping_note_id`, `intensity` null, `notes` null. Validate each id exists in `cupping_note` and (see C below) belongs to this coffee's offered chip set — reject ids outside it. These rows flow into `v_collaborative_wheel` as client-source mentions automatically; confirm with a query, don't modify the view.
3. **`feedback_events` doc**: add `expectation` (nullable) and populate the existing `descriptors` array (currently hardcoded `[]`) with the chip *labels* — keeping the doc shape a superset of what `behavioralConfidence`/`sommelierEvaluator`/`userSignals` already read. Do not rename or remove existing fields.

**Order→coffee resolution:** the route currently resolves `blend_id` via `order_line_item … LIMIT 1`. Chips and dial signals need a `coffee_id`. Find how the codebase already maps a blend/order to a coffee (`user_flavor_feedback` carries both `order_id` and `coffee_id`, so a canonical path exists — likely via `roaster_blend`). Reuse it; if an order genuinely spans multiple coffees, use the same first-line-item convention already established rather than inventing multi-coffee handling.

## C. Chips vocabulary — how the frontend knows what chips to offer

The chip set for a coffee = the distinct cupping notes already on that coffee's flavor record (the same notes the Collaborative Flavor Wheel shows, any source). Check the existing wheel endpoint the frontend consumes: if its rows already carry `cupping_note_id`, Part 3 can reuse it as-is and this section is a no-op. If it only returns labels, extend it (additive — don't break existing consumers) to include the id. Either way, the POST-side validation in B.2 must check membership against this same set, server-side.

## Testing

1. `tsc --noEmit` clean; boot against real Cloud SQL via the Auth Proxy (established playbook).
2. `GET /api/users/flavor-memory` for a real account with orders + mixed feedback (SMS and on-site): journal entries merge correctly, no roaster/raw-name/origin leakage anywhere in the payload (grep the response), journey non-empty for a matched user, contributionCount correct.
3. v2 POST with all fields: `feedback_events` doc has `expectation` + `descriptors`; `dial_position_signal` gains one correct `onsite_feedback` row (verify archetype + dimension + direction); `user_flavor_feedback` gains one row per chip; `v_dial_position_consensus` and `v_collaborative_wheel` both reflect the new rows.
4. v2 POST with only `{rating}` (legacy shape): behaves exactly as today.
5. Invalid `tastedNoteIds` (wrong coffee, nonexistent id) → 400, nothing written.
6. `as_expected` → no dial signal row; feedback_events still records it.
7. Never-ask-twice invariant intact: `oldestOrderMissingFeedback` / UC3 logic still sees v2 submissions.

In your summary: the supersede-vs-append decision (B.1), the order→coffee path you found, and whether C required an endpoint change.
