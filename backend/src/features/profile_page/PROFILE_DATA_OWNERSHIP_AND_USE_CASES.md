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
| Phone number | **⚠ no UI exists** | Arrives only via checkout today | SQL | See Gap 1 |
| **Archetype** | User, **quiz only** | First quiz or retake (`/find-my-flavor`, soon `?retake=1` from Profile) | SQL quiz session + Firestore | `taste_journey` entry, lifecycle refresh, `behavioralConfidence`, Sommelier context |
| Dial position (per archetype) | User | Turning the dial on Bloom / Find My Flavor screens / Profile (Part 1) — **auto-saves on every selection**, signed-in only | SQL `user_bloom_dial_position` (upsert per user+archetype via `PATCH /api/users/dial-position`) | Preloaded on return to any dial surface |
| Feedback: stars, note (+ v2: dial answer, chips) | User | `OrderFeedbackForm` (orders tab / nudges / journal) or SMS reply — **append-only, no edit/delete** | Firestore `feedback_events` (+ v2: `dial_position_signal`, `user_flavor_feedback`) | `behavioralConfidence`, lifecycle, dial consensus (v2), community wheel (v2) |
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

1. **Phone number has no add/edit UI.** Settings shows "Add a phone number to enable this" under the SMS toggle, but no field exists anywhere — phone only arrives via checkout. A pre-order user can never enable Liam's texts. Candidate: small Settings addition (fold into a Profile part or its post-deploy round).
2. **Feedback is append-only.** A mis-tapped star is permanent and feeds confidence + (v2) dial signals. Options when addressed: allow edit within a time window, or append a superseding event (cleaner for the signal consumers — they already handle event streams). Needs a decision before building.
3. **Dial-save visibility — RESOLVED BY DESIGN (2026-07-18), two layers:** the silent auto-save of `user_bloom_dial_position` stays as pure continuity state ("where you left the dial"), deliberately un-narrated; *intentional* saving becomes visible via a "Save to my flavor memory" button (plus implicit add-to-cart capture), both writing a new Firestore `dial_events` log that Liam and analytics consume. Spec: `ai_agent_liam/CLAUDE_CODE_PROMPT_LIAM_DIAL_EVENT_LOG.md`. The earlier "whisper on every turn" idea was dropped — logging/narrating every turn treats exploration as intent, which it isn't.
4. **Guest dial positions aren't persisted** (auth-gated by design). Fine for now; revisit only if guest→signup continuity ever matters.

## Related prompts (execution status as of 2026-07-18: none run)

Profile Parts 1–3 (`profile_page/`), Liam SMS parity + Liam action links (`ai_agent_liam/`), Find My Flavor Part 4 (`find_my_flavor_page/`).
