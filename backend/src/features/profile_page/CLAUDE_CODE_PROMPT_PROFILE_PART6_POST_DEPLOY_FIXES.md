# Profile Part 6 — post-deploy fixes after Parts 1–3 (Dana's screenshot review, 2026-07-18)

**Scope:** `Profile.tsx`, `bloom/RevealedPanel.tsx` (additive, shared), `users.ts` flavor-memory endpoint, `quiz.ts` (one resilience fix), one backfill script. Parts 4/5 may not have run yet — don't depend on them, don't touch their territory (Settings phone, feedback editing).

Four issues from Dana's live review, most-serious first.

---

## A. "Palate over time" shows one "first quiz" entry for a many-quiz user — diagnose root cause FIRST, then fix + backfill

**Symptom:** Dana has taken the quiz many times (including a fresh signed-in retake *after* this deployment) but the journey panel shows exactly one entry, labeled first quiz, dated Jul 2026. A post-deploy retake should have appended a `trigger: 'retake'` entry — it didn't (or isn't shown).

**Diagnostic evidence from Dana (2026-07-18):** while testing quizzes she watched the results land in Cloud SQL *and* saw the archetype update in Firestore under her user's documents after a quiz attempt. If that Firestore write was the `taste_journey` merge, the write block ran — and it appends the history entry in the same `set()` call — so the history entries likely exist and **the read side (candidate 1) is the primary suspect**. Still verify the doc directly first (her observation may have been a different user doc, e.g. `confidence_profile`).

**Diagnose before patching** (the FI-rebuild convention). Candidate root causes, in likelihood order — check each against her real account:

1. **The flavor-memory endpoint is serving Part 2's synthetic fallback** (current archetype + quiz date, labeled first-quiz — which matches the screenshot *exactly*). Check whether `users/{uid}/taste_journey` actually has `archetypeHistory` entries and whether the endpoint's read path/shape matches what `quiz.ts` writes; check whether a read error is being swallowed into the fallback branch. If the fallback is masking a read bug, separate "doc genuinely missing" from "read failed" — only the former may fall back.
2. **The journey write never happens:** in `quiz.ts`'s results route, the `taste_journey` write sits *after* `await computeBehavioralConfidence(...)` inside the same fire-and-forget try-block — if bc throws, the journey write is silently skipped (only a console.error). Check server logs / test a retake. **Regardless of whether this is the cause, fix the coupling:** the journey write must not depend on bc succeeding (compute `confidenceLevel` best-effort, write the journey entry either way).
3. Write succeeds but the frontend renders only the first entry (check the response payload before blaming the UI).

State the confirmed root cause in your summary.

**Backfill (do this in the same pass):** authenticated quiz history exists in SQL (`quiz_sessions` rows with resulting archetype + timestamps — the same source `sommelier.ts` queries for latest/previous). Write a one-time script that rebuilds `archetypeHistory` for users whose SQL quiz-session count exceeds their journey-entry count: entries ordered by session date, first = `first_quiz`, rest = `retake`, `confidenceLevel` null/absent for backfilled entries (don't fabricate), recompute `currentArchetype`/`evolutionCount`/`currentStreakCount` from the rebuilt sequence. Idempotent, dry-run mode first, report counts. Guest quizzes were never saved and stay unrecoverable — say so in the summary, not in user-facing UI.

## B. Text overlap in the intro block (stage line collides with the features list)

Screenshot 1: the `QUIZ_TAKEN_*_NO_ORDER` secondary line ("You haven't tried your match yet — it's below.") renders *on top of* the third feature line instead of below the list. Inspect how Part 1/3 positioned it — likely absolute positioning or a negative margin instead of normal flow. Fix: normal document flow, clear spacing below the features list, no overlap at any viewport width (test 390px too, where the list wraps taller).

## C. "Worth exploring" chips should explore *in place*, not eject to Flavor Intelligence

Dana's call (reversing the Part 3 spec — this supersedes it): clicking an adjacent-archetype chip should keep the user on their profile. New behavior:

- Clicking a chip renders that archetype's **full `ArchetypeSection`** directly below the primary match's section (the archetypes catalogue is already fetched in Profile — no new data work). Clicking the same chip again (or an active-state ✕) collapses it; clicking the other chip swaps it. One adjacent section open at a time.
- The adjacent section needs its own selection/reveal state instance (same pattern as FlavorQuiz's two independent instances — do not share the primary section's state).
- Chips get a clear active state. A small "See in Flavor Intelligence →" link may sit inside/near the expanded section for users who *choose* to leave — the deep link that exists today, demoted from primary action to escape hatch.
- Dial turns in the adjacent section save normally (it's a real ArchetypeSection — that's fine and desired).

## D. "Your flavor profile →" link in the revealed panel's action row — all surfaces except Profile

Screenshot 3: the action row in `RevealedPanel.tsx` ("Explore the full flavor breakdown →" / "Talk to Liam about this coffee →"). Dana: after finishing the quiz, the flow feels *over* — add a way onward to the personal page. Add a third link, "Your flavor profile →" → `/profile`, in that row, **on every surface except the Profile page itself** (self-link is noise). Mechanics: an optional prop threaded `ArchetypeSection` → `RevealedPanel` (additive, default = show; Profile passes hide) — existing consumers compile unchanged. Signed-in users only? No — show it to guests too: `/profile` redirects to sign-in, which is exactly the right nudge for a guest who just finished the quiz and wants to keep their result.

## Testing

1. Builds clean; backend against real Cloud SQL + Firestore.
2. A (Dana's account, with her consent for the backfill): journey shows her real multi-quiz history, newest retake labeled retake; a fresh retake appends immediately even when bc computation is made to throw; the synthetic fallback triggers only for genuinely-missing docs.
3. B: no overlap at 1280px and 390px, all quiz-taken stages.
4. C: chip click expands the adjacent archetype below the match with working dial/card/reveal/cart; toggling and swapping behave; FI link still reachable; primary section state untouched by adjacent interactions.
5. D: quiz results screen + returning-user screen + /bloom show the profile link in the revealed panel; Profile page does not; guest click lands on sign-in and then profile.
6. Regression: journal, adjacents row, retake link, `?tab=` links, Parts 1–3 behaviors intact.

In your summary: A's confirmed root cause, backfill counts (dry-run + applied), and where the RevealedPanel prop landed.
