# Claude Code Prompt 1 of 3 — Interpretation rules v2.1: `interpret()`, `/score`, calibration fixture

> Series: quiz interpretation v2.1 (Dana, 2026-09-20 to 2026-09-25). Read `QUIZ_INTERPRETATION_V2_DECISIONS.md`
> first. Run this brief FIRST; briefs 2 and 3 depend on the function it creates.
> Scope: pure logic + the read-only scoring endpoint + tests. **This brief writes to no table and touches no
> stored row.** `PARKED_CLAUDE_CODE_PROMPT_SUBSCRIBER_RESYNC_FIX.md` in this folder is not part of the series.

## What does not change

The quiz **scoring**: questions, answers, weights (Q1=1, Q2=2, Q3=1, Q4=2, Q5=3), winner, Q5→Q4→Q2→Q1 tie
cascade, branch questions. Quiz version stays `v7`. The primary archetype and `branchedFrom` are the
customer's answers and are never reinterpreted.

## What changes

How a scored result is read into a secondary archetype, a recommendation mode and a confidence label.
This ruleset is **interpretation version `v2.1`**; what runs today is retroactively `v1`.

## Part A — `backend/src/services/quizScoring.ts`

Keep `rankScores`, `findWinner`, `isSecondaryClose` unchanged. Replace `findSecondary` and
`computeConfidenceAndMode` with one pure, exported function and its helpers:

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
  secondaryArchetype: string | null;   // value to store: branchedFrom when a branch switched
  secondaryPath: SecondaryPath;
  recommendationMode: RecommendationMode;   // never 'ai_agent' (keep the enum value for old rows)
  foodSignalAlignment: Confidence;          // legacy label, computed exactly as today (A.6)
  pairConfidence: PairConfidence;
  exploreArchetype: string | null;          // 'A / B' for an unresolved runner-up tie
  exploreReason: string | null;
  primaryMargin: number;
  interpretationVersion: string;
}

export function interpret(input: {
  scores: Scores;            // from the SUM query (only archetypes that scored appear)
  byQ: ByQ;                  // q_number -> archetype the chosen answer scores (Q1..Q5), built as today
  foodSignal: string | null; // Q6 resulting archetype name
  experimental: boolean;
  finalArchetype: string;    // winner, or the branch archetype after a real switch
  branchedFrom: string | null;
}): Interpretation;
```

Names are compared as `coffee_archetype.name` returns them today. No name normalization here.

### A.1 Winner and margin
`winner = findWinner(rankScores(scores), byQ)`. `runnerUpScore` = highest non-winner score (0 if none).
`primaryMargin = scores[winner] - runnerUpScore`. `runners` = non-winners with score `=== runnerUpScore && > 0`.

### A.2 Secondary: first rule that applies wins
`pick(candidates)`: one candidate → it; the treat is among them → the treat; else cascade
(`byQ[5], byQ[4], byQ[2], byQ[1]`, first in `candidates`; fall back to `'Balanced'` if present, else first).

| # | path | condition | secondary |
|---|---|---|---|
| 1 | `near-tie` | `primaryMargin <= 1` and `runners` non-empty | `pick(runners)` |
| 2 | `gate-backed` | `experimental && runners.includes('Fruity') && winner !== 'Fruity'` | `'Fruity'` |
| 3 | `food-led` | `foodSignal !== null && foodSignal !== winner` | `foodSignal` |
| 4 | `runner-up` | `runners` non-empty and `runnerUpScore >= 2` | `pick(runners)` |
| 5 | `none` | otherwise | `null` |

If `branchedFrom !== null`: `secondaryArchetype` = `branchedFrom` (2026-08-11 rule); `secondaryPath` still
records what rules 1–5 gave on the pre-branch scores, because the mode derives from it.

### A.3 Mode, from the path
| path | `experimental` | mode |
|---|---|---|
| `near-tie` | any | `primary_plus_active_secondary` |
| `gate-backed` | (true) | `primary_plus_active_secondary` |
| `food-led` | false | `primary_plus_introduce_secondary` |
| `food-led` | true | `primary_plus_active_secondary` |
| `runner-up` | false | `primary_plus_note_secondary` if `isSecondaryClose(byQ, secondary)` else `primary_only` |
| `runner-up` | true | `primary_as_starting_point` |
| `none` | false | `primary_only` |
| `none` | true | `primary_as_starting_point` |

### A.4 Pair confidence
`pair = [finalArchetype, secondaryArchetype].filter(Boolean)`. Strays, each counted once:
treat (`foodSignal` not in pair; distance = min axis distance to a pair member); gate
(`experimental && !pair.includes('Fruity') && (scores['Fruity'] ?? 0) >= 2`); third (any archetype not in
pair with score `>= 3`, unless it is the treat stray). None → `high`; one → `medium`; two+ → `low`; a treat
stray at distance `>= 2` → `low`. Runner-up ties are not strays.

### A.5 Explore archetype (for Liam)
Collect in this order; `exploreArchetype` = first, `exploreReason` = all joined with `; `:
1. gate: `experimental && !pair.includes('Fruity') && (scores['Fruity'] ?? 0) >= 1` → `'Fruity'`,
   `experimental gate open, Fruity outside the pair`
2. treat stray → `treat points to <X>` (+ ` (<d> steps from the pair)` when `d >= 2`)
3. third stray → `<X> scored <n> outside the pair`
4. runner-up tie (`runners.length > 1`, not branched): if the secondary came from `runners` → the other tied
   archetype, `<other> tied with <secondary> at <n>; <secondary> chosen by the treat` / `... by the
   Q5→Q4→Q2→Q1 cascade`; if the floor left no secondary → `'<A> / <B>'`, `<A> / <B> tied at <n>, under the
   2-point floor: no secondary named`.
Both `null` when nothing qualifies.

### A.6 Legacy `foodSignalAlignment`
Rename today's `computeConfidenceAndMode` to `legacyFoodSignalAlignment`, logic verbatim, return only its
`confidence`, called with the v2.1 secondary. Stored for comparison; drives nothing.

### A.7 Shared scorer
Extract the two queries `POST /api/quiz/score` already runs (weighted SUM per archetype; per-answer
metadata → `byQ` + `foodSignal` + experimental gate) into
`scoreAnswerIds(answerIds: string[]): Promise<{ scores, byQ, foodSignal, experimental }>` in
`quizScoring.ts` (or a sibling `quizScorer.ts`). `/score` uses it; brief 2 reuses it server-side. Behaviour
identical to today.

## Part B — `POST /api/quiz/score` (`backend/src/routes/quiz.ts`)
Call `scoreAnswerIds`, then `interpret(...)` with `finalArchetype = winnerName, branchedFrom = null` (the
branch happens in the frontend afterwards). Keep every existing response key; add `secondaryPath,
pairConfidence, exploreArchetype, exploreReason, primaryMargin, interpretationVersion`. `tieDetected` /
`tiedArchetypes` unchanged. Fix the stale comment "Q2 excluded — no rows": Q2 scores (weight 2); every v7
total sums to 9. **Do not change `POST /api/quiz/results` in this brief** (brief 2).

## Part C — frontend `FlavorQuiz.tsx` (types only)
`ScoreResult` gains the six new fields; `buildQuizResultPayload()` passes them through unchanged (they are
informational: brief 2 recomputes server-side). Nothing else in the component changes. Report only: grep for
renderings of `foodSignalAlignment` and `recommendationMode === 'ai_agent'` and list them.

## Part D — calibration fixture and tests
- Copy `hoboken-crawl-2026.calibration.json` to `backend/src/fixtures/quiz_calibration/`.
- `quizScoring.test.ts`: table-driven test over all 37 cases. Rebuild `byQ` from `answerIds` with a static
  map in the test (18 v7 answer ids → archetype, derived once from the v7 seed in `schema.sql`; assert the
  derived scores equal each case's `scores`, which proves the map), then assert `secondaryArchetype`,
  `recommendationMode`, `pairConfidence`, `exploreArchetype`, `primaryMargin`. 37/37 must pass. If one
  fails, stop and report the row with both values; never adjust a rule to make it pass.
- `backend/scripts/quizRecalibrate.ts`: offline, no DB. Reads a `v_subscriber_quiz_results` CSV export,
  runs `interpret()` per row, writes a fixture-format JSON with `expected_v2_1` plus a diff vs `stored_v1`.
- The 17 pre-existing vitest failures are known; leave them.

## Report back (`WHAT_WE_BUILT.md`, next number)
Precedence and mode tables as implemented; 37/37; the Part C locations; confirmation that no table was
written (`git diff` shows no SQL, no `INSERT`/`UPDATE`).
