# Profile data ownership & modification use cases

**Date:** 2026-07-18 · **Status:** reference doc (not a Claude Code prompt). The standing answer to "who can modify what in a user's profile, and how." Update this doc when a new modification path ships.

---

## The core rule

Three actors touch profile data, each with a fixed role:

- **The user** initiates every identity edit and every taste action (quiz, dial, feedback, family).
- **The system** computes everything derived (lifecycle stage, confidence, taste journey) — automatically, never user-editable.
- **Nobody has a bypass.** Liam is advisory-only (talks about taste, never writes it — decided 2026-07-18, see `ai_agent_liam/CLAUDE_CODE_PROMPT_LIAM_ACTION_LINKS.md`). Admin has no user-profile editor (deliberate; `grant_admin`/`revoke_admin` role helpers are the only admin-side user mutation).

The one invariant to defend hardest: **archetype changes only through the quiz.** `taste_journey` triggers, `behavioralConfidence.quizStability`, and the Sommelier's `TASTE_EVOLUTION` intent all assume archetype changes are quiz events. Any future "just let X edit the archetype" proposal breaks the signal stack — re-read this before agreeing to one.

## Ownership matrix

| Data | Changed by | Mechanism | Persistence | Downstream reactions |
|---|---|---|---|---|
| First/last name, birthday | User | Settings form (`PATCH /api/users/profile`) | SQL `user_profile` | — |
| Email | Nobody | Fixed by the sign-in account (Firebase) | — | — |
| Addresses | User | Settings: add / delete / set-default (no in-place edit — delete & re-add) | SQL | Checkout defaults |
| SMS opt-in | User | Settings toggle (`smsOptIn`) — only when a phone exists | SQL | Gates Liam's SMS loop |
| Phone number | User | Settings add/change (`PATCH /api/users/profile`, Part 4) | SQL `user_phone` | Enables Liam's SMS loop once opted in |
| **Archetype** | User, **quiz only** | First quiz or retake (`/find-my-flavor`, soon `?retake=1` from Profile) | SQL quiz session + Firestore | `taste_journey` entry, lifecycle refresh, `behavioralConfidence`, Sommelier context |
| Dial position (per archetype) | User | Turning the dial on Bloom / Find My Flavor screens / Profile (Part 1) — **auto-saves on every selection**, signed-in only | SQL `user_bloom_dial_position` (upsert per user+archetype via `PATCH /api/users/dial-position`) | Preloaded on return to any dial surface |
| Feedback: stars, note (+ v2: dial answer, chips) | User | `OrderFeedbackForm` (orders tab / nudges / journal) — **editable per order, no time window, via superseding events** (Part 5); SMS reply still append-only, one-shot | Firestore `feedback_events` (revision supersedes the prior doc, never mutates it) + v2: `dial_position_signal` (revision supersedes the prior row), `user_flavor_feedback` (revision deletes + reinserts — no supersede column, feeds a live mention count) | `behavioralConfidence`, lifecycle, dial consensus (v2), community wheel (v2) — all recomputed against the latest revision only |
| Family / household | User | Family tab, join links | SQL | B2B model builds on this |
| Lifecycle stage | System | Recomputed after quiz / order / feedback | SQL | Homepage, FI, Profile personalization |
| `behavioralConfidence`, `confidence_profile` | System | Recomputed after quiz / order / feedback | Firestore | Sommelier behavior |
| `taste_journey` | System | Written on every quiz save (Sommelier Task 1 §12) | Firestore | Profile "Palate over time" (Part 2/3), Sommelier context |

## Use cases

- **UC-P1 — account edits:** user edits identity data in Settings; direct writes; nothing recomputes.
- **UC-P2 — taste actions:** user acts (quiz, dial turn, feedback); the action itself is the save; system recomputes derived state afterwards. There is no "edit taste directly" path anywhere, on purpose.
- **UC-P3 — system recomputation:** never user-visible as an action; always a consequence of UC-P2 or an order.
- **UC-P4 — Liam-assisted change:** Liam recommends, links to the surface (retake / dial), user performs UC-P2 there. Liam never writes.

## Open gaps (flagged 2026-07-18, unresolved)

1. ~~Phone number has no add/edit UI.~~ — **CLOSED (Part 4, 2026-07-18).** Settings now has an add/change phone affordance under the SMS toggle (`PATCH /api/users/profile` accepts an optional `phoneNumber`, normalized server-side). Correction to this gap's original premise: no checkout phone-creation path actually existed to reuse — grepped the whole backend and found none; `user_phone` rows previously only ever came from manual/admin seeding.
2. ~~Feedback is append-only.~~ — **CLOSED (Part 5, 2026-07-18).** Dana's decision: always editable by its owner, per order, no time window, via superseding events (same pattern `dial_position_signal`/`archetype_assignments` already use). `POST /api/orders/:orderId/feedback` now revises in place — old `feedback_events` doc gets `supersededAt`, a new one is added; every consumer (`behavioralConfidence`, `userSignals`' `hasRecentNegativeFeedback`, `sommelier.ts`'s RECOMMENDATION_MISS exclusion list, the flavor-memory journal) ignores superseded docs. `dial_position_signal` rows are superseded the same way (matched by an exact `notes` equality, tightened from Part 2's fuzzy `LIKE` on the same field). `user_flavor_feedback` has no supersede column — a revision deletes this user's rows for the order and reinserts, since those rows are a live mention count, not an audit trail.
3. **Dial-save visibility — RESOLVED BY DESIGN (2026-07-18), two layers:** the silent auto-save of `user_bloom_dial_position` stays as pure continuity state ("where you left the dial"), deliberately un-narrated; *intentional* saving becomes visible via a "Save to my flavor memory" button (plus implicit add-to-cart capture), both writing a new Firestore `dial_events` log that Liam and analytics consume. Spec: `ai_agent_liam/CLAUDE_CODE_PROMPT_LIAM_DIAL_EVENT_LOG.md`. The earlier "whisper on every turn" idea was dropped — logging/narrating every turn treats exploration as intent, which it isn't.
4. **Guest dial positions aren't persisted** (auth-gated by design). Fine for now; revisit only if guest→signup continuity ever matters.

## Related prompts (execution status as of 2026-07-18: none run)

Profile Parts 1–3 (`profile_page/`), Liam SMS parity + Liam action links (`ai_agent_liam/`), Find My Flavor Part 4 (`find_my_flavor_page/`).
