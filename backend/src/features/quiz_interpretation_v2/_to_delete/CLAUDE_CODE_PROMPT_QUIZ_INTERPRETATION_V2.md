# Claude Code Prompt — Quiz interpretation v2.1: deterministic secondary, mode, pair confidence, explore hint

> Written 2026-09-24, revised 2026-09-25 (scope tightened to the interpretation logic only; tie-break explore
> hint added; data-safety section expanded). From the Hoboken Crawl results review: 37 real quiz completions
> of 2026-09-20, export of 2026-09-25. Decisions and rationale: `QUIZ_INTERPRETATION_V2_DECISIONS.md`.
> Calibration set (37 cases): `hoboken-crawl-2026.calibration.json`. Read both before starting.
>
> Sequencing: independent of `CLAUDE_CODE_PROMPT_QUIZ_RESULTS_VIEW_V2.md` (read-only SQL); run the two in
> either order, as separate commits. `PARKED_CLAUDE_CODE_PROMPT_SUBSCRIBER_RESYNC_FIX.md` in this folder is
> not part of this work: do not touch the newsletter subscribe route, the recognized-guest resync effects,
> Mailchimp sync, or the email gate's payload in this brief.

## Scope in one paragraph

The quiz **scoring** does not change: same questions, answers, weights (Q1=1, Q2=2, Q3=1, Q4=2, Q5=3),
same winner, same Q5→Q4→Q2→Q1 tie cascade, same branch questions. This is quiz `v7` and stays `v7`.
What changes is how a scored result is **interpreted** into a secondary archetype, a recommendation mode
and a confidence label, at the moment a new quiz is scored. Today the field exported as "confidence" is
really `foodSignalAlignment` (does the Q6 treat agree with the winner?), which sends a 9/9 Balanced result
to `ai_agent / low` because the person grabbed a brownie, and the secondary on a runner-up tie depends on
SQL row order. After this brief: the secondary follows a fixed precedence; the mode follows from *why* the
secondary was chosen; `pairConfidence` says how well every signal agrees with the recommended pair;
`ai_agent` is never produced; and `exploreArchetype` tells Liam which loose thread to pull.
`foodSignalAlignment` keeps being computed and written under its own name, unchanged.

## Data safety: how results are and are not changed

This is the most important section. The quiz sessions from the 2026-09-20 event are live production
data and the calibration record for this work. Read it twice.

1. **Existing rows are never modified.** No `UPDATE`, no backfill, no migration script, no "recompute on
   read" for `quiz_session`, its `context_data`, or the Firestore mirrors `users/{uid}` and
   `users/{uid}/quiz_sessions/{id}`. The new interpretation applies to sessions **scored after deploy**
   only. A returning user who completed the quiz before deploy keeps seeing their stored result exactly
   as it is; the profile, reveal, homepage-state and `GET /api/quiz/results/latest` paths read stored
   values and must keep doing so.
2. **No schema change.** All new fields go into `context_data` (JSONB) alongside the existing ones, as
   every earlier quiz change did. No `ALTER TABLE` in this brief.
3. **Additive payload.** `POST /api/quiz/results` accepts the new fields and stores them; when they are
   absent (old bundle still cached in someone's browser), it stores nothing new and labels the row
   `interpretationVersion: 'v1'`. It never rejects a payload for lacking them.
4. **No destructive verification.** The fixture and unit tests run offline. Anything that needs a
   database uses the dev DB. Do not touch the persistent Cloud SQL Auth Proxy that `backend/.env` depends
   on (see `features/quizes/CLAUDE_CODE_PROMPT_QUIZ_DRIFT_PREVENTION.md`, "Lesson for future prompts").
5. **Prove it.** Before you start, on the dev DB, record
   `SELECT COUNT(*), md5(string_agg(id::text || context_data::text, ',' ORDER BY id)) FROM quiz_session;`
   Re-run it after every test run and at the end; both values must be identical. Put both readings in
   the report. Dana will run the same statement on prod before and after the deploy.
6. **Rollback is a code revert.** Because nothing is migrated, reverting the deploy restores the old
   behaviour completely; rows written in between are identifiable by `interpretationVersion = 'v2.1'`.
7. **Keep the enum.** `RecommendationMode` keeps `'ai_agent'` in the type so stored rows still type-check;
   the new code never returns it.

## Part A — `backend/src/services/quizScoring.ts`

Keep `rankScores`, `findWinner`, `isSecondaryClose` exactly as they are. Replace `findSecondary` and
`computeConfidenceAndMode` with one pure, exported, unit-testable function:

```ts
export const INTERPRETATION_VERSION = 'v2.1';

// Interim, hand-ordered by Dana from archetype families. Replace with hop distance from the dial graph
// (Seam Board / bloom_dial_base_data) once that is the source of truth. Experimental is a flag, not a position.
export const ARCHETYPE_AXIS = ['Floral', 'Fruity', 'Balanced', 'Chocolate & Nutty', 'Earthy'] as const;
export function axisDistance(a: string, b: string): number;   // Infinity if either is off the axis

export type PairConfidence = 'high' | 'medium' | 'low';
export type SecondaryPath = 'near-tie' | 'gate-backed' | 'food-led' | 'runner-up' | 'none';

export interface Interpretation {
  winner: string;
  secondaryArchetype: string | null;   // the value to STORE (branchedFrom when a branch switched)
  secondaryPath: SecondaryPath;
  recommendationMode: RecommendationMode;   // never 'ai_agent'
  foodSignalAlignment: Confidence;          // legacy label, computed exactly as today (A.6)
  pairConfidence: PairConfidence;
  exploreArchetype: string | null;          // 'A / B' for an unresolved runner-up tie
  exploreReason: string | null;
  primaryMargin: number;
  interpretationVersion: string;
}

export function interpret(input: {
  scores: Scores;            // as returned by the SUM query (only archetypes that scored appear)
  byQ: ByQ;                  // q_number -> archetype the chosen answer scores (Q1..Q5), built as today
  foodSignal: string | null; // Q6 resulting archetype name
  experimental: boolean;
  finalArchetype: string;    // winner, or the branch archetype after a real switch
  branchedFrom: string | null;
}): Interpretation;
```

Archetype names are compared as the database returns them today (`coffee_archetype.name`, currently
`Balanced`, `Chocolate & Nutty`, `Fruity`, `Earthy`, `Floral`). Do not add name normalization here.

### A.1 Winner and margin

`winner = findWinner(rankScores(scores), byQ)` (unchanged). `runnerUpScore` = highest score among
non-winners (0 if none). `primaryMargin = scores[winner] - runnerUpScore`. `runners` = every non-winner
with score `=== runnerUpScore && > 0`.

### A.2 Secondary: first rule that applies wins

`pick(candidates)`: one candidate → it; the treat is among them → the treat; otherwise the cascade
(`byQ[5]`, `byQ[4]`, `byQ[2]`, `byQ[1]`, first that is in `candidates`; fall back to `'Balanced'` if
present, else the first candidate). This replaces the row-order-dependent `ranked.find(...)`.

| # | path | condition | secondary |
|---|---|---|---|
| 1 | `near-tie` | `primaryMargin <= 1` and `runners` non-empty | `pick(runners)` |
| 2 | `gate-backed` | `experimental && runners.includes('Fruity') && winner !== 'Fruity'` | `'Fruity'` |
| 3 | `food-led` | `foodSignal !== null && foodSignal !== winner` | `foodSignal` |
| 4 | `runner-up` | `runners` non-empty and `runnerUpScore >= 2` | `pick(runners)` |
| 5 | `none` | otherwise | `null` |

Rule 2 sits above the treat because the gate answer (Q3c) is itself a Fruity answer: two Fruity signals
outrank one treat. Rule 4's floor: a single weight-1 answer is not a secondary.

If `branchedFrom !== null`: `secondaryArchetype` (the stored value) is `branchedFrom`, per the
2026-08-11 rule; `secondaryPath` still records what rules 1–5 produced on the pre-branch scores, because
the mode is derived from it. Nothing is recomputed after a branch.

### A.3 Mode, from the path

| path | `experimental` | mode |
|---|---|---|
| `near-tie` | any | `primary_plus_active_secondary` |
| `gate-backed` | (always true) | `primary_plus_active_secondary` |
| `food-led` | false | `primary_plus_introduce_secondary` |
| `food-led` | true | `primary_plus_active_secondary` |
| `runner-up` | false | `primary_plus_note_secondary` if `isSecondaryClose(byQ, secondary)` else `primary_only` |
| `runner-up` | true | `primary_as_starting_point` |
| `none` | false | `primary_only` |
| `none` | true | `primary_as_starting_point` |

### A.4 Pair confidence

`pair = [finalArchetype, secondaryArchetype].filter(Boolean)`. Signals outside the pair ("strays"), each
counted once:

- **treat**: `foodSignal` not in `pair`; distance = `min(axisDistance(foodSignal, p) for p in pair)`.
- **gate**: `experimental && !pair.includes('Fruity') && (scores['Fruity'] ?? 0) >= 2`.
- **third**: any archetype not in `pair` with score `>= 3`, unless it is already the treat stray.

`pairConfidence`: no strays → `high`; one → `medium`; two or more → `low`; a treat stray at distance
`>= 2` → `low` regardless. Runner-up ties (A.5) are **not** strays and never change confidence.

### A.5 Explore archetype (for Liam)

Collect, in this priority order, and set `exploreArchetype` to the first, `exploreReason` to all of them
joined with `; `:

1. gate: `experimental && !pair.includes('Fruity') && (scores['Fruity'] ?? 0) >= 1` → `'Fruity'`,
   reason `experimental gate open, Fruity outside the pair`.
2. treat stray → `foodSignal`, reason `treat points to <X>` (+ ` (<d> steps from the pair)` when `d >= 2`).
3. third stray → that archetype, reason `<X> scored <n> outside the pair`.
4. runner-up tie (`runners.length > 1`, not branched):
   - if the secondary came from `runners`: the other tied archetype, reason
     `<other> tied with <secondary> at <n>; <secondary> chosen by the treat` / `... by the Q5→Q4→Q2→Q1 cascade`;
   - if the floor left no secondary: `'<A> / <B>'`, reason `<A> / <B> tied at <n>, under the 2-point floor: no secondary named`.

Both `null` when nothing qualifies. (Decided 2026-09-25: Alex, Balanced 7 with Fruity 1 / Chocolate 1,
gets no secondary and the tie as his hint; Becca, Balanced 5 with Fruity 2 / Chocolate 2, keeps Fruity from
the cascade and gets Chocolate & Nutty as her hint.)

### A.6 Legacy `foodSignalAlignment`

Rename the current `computeConfidenceAndMode` to `legacyFoodSignalAlignment`, keep its logic verbatim,
return only its `confidence`, and call it with the v2.1 secondary. It is stored under its own name so the
old and new labels can be compared on every new session. It drives nothing.

## Part B — `backend/src/routes/quiz.ts`

`POST /api/quiz/score`: keep steps 1, 2, 3, 5 (score query, metadata query, winner, experimental gate).
Replace steps 4, 6, 7 with `interpret(...)` using `finalArchetype = winnerName, branchedFrom = null`
(the branch happens in the frontend afterwards). Response keeps every existing key and adds
`secondaryPath, pairConfidence, exploreArchetype, exploreReason, primaryMargin, interpretationVersion`.
`tieDetected` / `tiedArchetypes` (step 8) stay.

`POST /api/quiz/results`: read the six new fields from the body and pass them into the `context_data`
object given to `saveQuizSession` and into the Firestore session document, with `?? null` defaults and
`interpretationVersion ?? 'v1'`. No other change to this handler; `saveQuizSession` itself is untouched.

Fix the stale comment above the score query ("Q2 excluded — no rows in quiz_answer_archetype_score"):
Q2 does score (weight 2); every v7 total sums to 9.

## Part C — frontend `FlavorQuiz.tsx` (payload only)

- `ScoreResult` gains the six new fields.
- `buildQuizResultPayload()` passes them through unchanged. On a real branch switch it sends
  `secondaryArchetype = branchedFrom` as today and every other interpretation field exactly as `/score`
  returned it (pre-branch values; the SQL view brief recomputes post-branch values for analysis). Add a
  code comment saying so.
- Nothing else in this component changes. In particular: no change to `PostQuizEmailGate`'s props, to what
  the gate sends to `/api/newsletter/subscribe`, or to the two resync/auto-subscribe effects.
- Report only (no edits): grep the frontend for any rendering of `foodSignalAlignment` and of
  `recommendationMode === 'ai_agent'`, and list the locations in the report so a later copy pass can
  decide what the reveal should show.

## Part D — Liam (`backend/src/services/sommelierEvaluator.ts`), minimal

- Read `pairConfidence`, `exploreArchetype`, `exploreReason`, `interpretationVersion` from the session.
- `PROFILE_AMBIGUOUS` currently fires on `recommendationMode === 'ai_agent' || foodSignalAlignment ===
  'low'`. For sessions with `interpretationVersion` of `'v2.1'` or later, fire on
  `pairConfidence === 'low' || exploreArchetype !== null`; for older sessions keep the old rule unchanged.
- Expose `exploreArchetype` / `exploreReason` in the context Liam's prompt receives. Advisory only; Liam
  still cannot change an archetype. Feature vector: keep its 13 dimensions and order; add nothing.

## Part E — calibration fixture and tests

- Copy `hoboken-crawl-2026.calibration.json` to `backend/src/fixtures/quiz_calibration/` (create the
  folder). Each case carries the exact `context_data` inputs and the expected v2.1 output.
- `quizScoring.test.ts`: a table-driven test that, for every case, rebuilds `byQ` from `answerIds` with a
  **static map** included in the test (answer id → archetype for the 18 v7 answers, derived once from the
  v7 seed in `schema.sql`; assert the derived scores equal the fixture's `scores` for all 37 cases, which
  proves the map), then asserts `secondaryArchetype`, `recommendationMode`, `pairConfidence`,
  `exploreArchetype`, `primaryMargin`. All 37 must pass. If one does not, stop and report the row with both
  values; do not adjust a rule to make it pass.
- `backend/scripts/quizRecalibrate.ts`: reads an export of `v_subscriber_quiz_results` (CSV with
  `quiz_result_json`), runs `interpret()` offline on every row, writes a JSON in the fixture format with
  `expected_v2_1` filled in plus a side-by-side diff against `stored_v1`. No database access. This is how the
  next event's export becomes the next calibration file.
- The 17 pre-existing vitest failures (6 tie-break drift, 11 live-prod tests) are known; do not touch them.

## Report back (`WHAT_WE_BUILT.md`, next sequential number)

Record: the precedence and mode tables as implemented; 37/37 fixture result; the before/after
`quiz_session` count + md5 readings from the data-safety section; the frontend locations from Part C;
the Liam trigger change; and the explicit statement that no existing `quiz_session` row, `context_data`
or Firestore document was modified.
