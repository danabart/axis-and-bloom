# Profile Part 5 — feedback editing via superseding events

**Date:** 2026-07-18
**Prerequisites:** Profile Parts 2 + 3 executed (feedback v2 write path + journal UI). Verify in code first. Part 4 is independent — order between 4 and 5 doesn't matter.

**Scope:** closes gap 2 from `PROFILE_DATA_OWNERSHIP_AND_USE_CASES.md` (update that doc's gap list as part of this task). Dana's decision (2026-07-18): feedback is **always editable by its owner, per order, via superseding events** — the same pattern `dial_position_signal` and `archetype_assignments` already use. No time window. History preserved; consumers read latest-per-order.

---

## Backend

1. **Revision = same endpoint.** `POST /api/orders/:orderId/feedback` becomes "submit or revise": when a non-superseded `feedback_events` doc already exists for this order, the new submission appends a new doc (same shape, all v2 fields) and marks the old one superseded (`supersededAt: serverTimestamp()` on the old doc — additive field, matching the codebase's supersede convention). Never delete or mutate the old doc's content. First-time submissions behave exactly as today.
2. **Consumers read latest-per-order.** Find **every** reader of `feedback_events` (`behavioralConfidence`, `sommelierEvaluator`, `userSignals`, the Part 2 `flavor-memory` endpoint, and grep for any others — including `oldestOrderMissingFeedback`) and make each ignore superseded docs. This is the load-bearing change — a missed consumer double-counts revised feedback. List every touched consumer in your summary.
3. **Derived rows follow the revision:**
   - `dial_position_signal`: supersede (set `superseded_at`) the prior row(s) this order's feedback created — locate them the same way Part 2 tagged them (it references the orderId in `notes`; if that lookup proves fragile, say so and propose the fix rather than silently matching loosely). Write the new row per the new `expectation` (or none for `as_expected`/absent — same rules as Part 2).
   - `user_flavor_feedback`: the table has no supersede column and feeds `v_collaborative_wheel` by row count — **delete** this user's rows for this `order_id` and insert the new chips. Rationale (state it in code comments): these rows represent the user's *current* opinion; the audit trail lives in `feedback_events`. Do not add a supersede column to this table this pass.
   - Recompute: the existing post-submit `computeBehavioralConfidence` + `refreshLifecycleState` calls already fire on this route — confirm they still run on revisions.
4. **Invariants that must survive:** never-ask-twice still sees the order as having feedback (a superseded doc + its replacement ≠ missing feedback); UC3/`pendingFeedback` unaffected; the negative-feedback flag (`hasPendingNegativeFeedback`) follows the *latest* sentiment — a revision from 2★ to 4★ should clear/not-set it, a revision downward should set it (mirror the existing logic against the latest event).

## Frontend

5. **Edit affordance:** in the Profile journal and the Past Orders tab, entries that have feedback gain a quiet "Edit" link (same micro-label style as "add one"). It opens the same shared `OrderFeedbackForm`, **prefilled** with the current values (stars, expectation, selected chips, note) — add optional initial-value props to the component (additive; existing call sites unchanged). Submitting revises via the endpoint above and refreshes the entry in place.
6. Nudge surfaces (FI, homepage) are untouched — they only appear for missing feedback, and revisions don't re-trigger them.

## Testing

1. Builds clean; backend against real Cloud SQL + Firestore.
2. Revise 2★→4★ with new chips + changed expectation: new `feedback_events` doc, old one carries `supersededAt`; old dial-signal row superseded + new one written; old chip rows gone, new ones present; `v_collaborative_wheel` counts reflect only current chips; `v_dial_position_consensus` reflects only the new signal; behavioralConfidence recomputed against the latest event only; negative-feedback flag cleared.
3. Revise downward (4★→1★): flag sets; sentiment consumers see the revision.
4. First-time submission: byte-for-byte today's behavior.
5. Journal + orders tab: prefill correct on every field; revision updates the entry without reload; "add one" (no prior feedback) path unchanged.
6. Never-ask-twice: an order with revised feedback shows no nudges anywhere.

In your summary: every `feedback_events` consumer touched (and any found beyond the four named), how prior dial-signal rows were located, and anything the supersede convention forced you to decide.
