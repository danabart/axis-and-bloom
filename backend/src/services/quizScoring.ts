export type Scores = Record<string, number>;
export type ByQ = Record<number, string | null>;

export type RecommendationMode =
  | 'primary_only'
  | 'primary_plus_introduce_secondary'
  | 'primary_plus_active_secondary'
  | 'primary_plus_note_secondary'
  | 'primary_as_starting_point'
  | 'ai_agent';

export type Confidence = 'high' | 'medium' | 'low';

export function rankScores(scores: Scores): [string, number][] {
  return Object.entries(scores).sort(([, a], [, b]) => b - a);
}

export function findWinner(ranked: [string, number][], byQ: ByQ): string {
  const maxScore = ranked[0][1];
  const tied = ranked.filter(([, s]) => s === maxScore).map(([n]) => n);

  if (tied.length === 1) return tied[0];

  for (const qNum of [5, 4, 2, 1]) {
    const pointsTo = byQ[qNum];
    if (pointsTo && tied.includes(pointsTo)) return pointsTo;
  }

  return 'Balanced';
}

export function isSecondaryClose(byQ: ByQ, secondary: string | null): boolean {
  if (!secondary) return false;
  return byQ[5] === secondary || byQ[4] === secondary;
}

// Legacy v1 label, logic verbatim. Stored as `foodSignalAlignment` for comparison only; it drives
// nothing since interpretation v2.1 (it measures treat-vs-winner agreement, not confidence).
export function legacyFoodSignalAlignment(
  foodSignal: string | null,
  winner: string,
  secondary: string | null,
  experimental: boolean,
  secondaryClose: boolean
): Confidence {
  return legacyConfidenceAndMode(foodSignal, winner, secondary, experimental, secondaryClose).confidence;
}

function legacyConfidenceAndMode(
  foodSignal: string | null,
  winner: string,
  secondary: string | null,
  experimental: boolean,
  secondaryClose: boolean
): { confidence: Confidence; recommendationMode: RecommendationMode } {
  if (foodSignal === winner) {
    if (experimental) {
      return { confidence: 'medium', recommendationMode: 'primary_as_starting_point' };
    }
    if (secondaryClose) {
      return { confidence: 'medium', recommendationMode: 'primary_plus_note_secondary' };
    }
    return { confidence: 'high', recommendationMode: 'primary_only' };
  }

  if (foodSignal === secondary) {
    return {
      confidence: 'medium',
      recommendationMode: experimental
        ? 'primary_plus_active_secondary'
        : 'primary_plus_introduce_secondary',
    };
  }

  if (foodSignal !== null) {
    return { confidence: 'low', recommendationMode: 'ai_agent' };
  }

  return { confidence: 'high', recommendationMode: 'primary_only' };
}

// ─── Interpretation v2.2 ─────────────────────────────────────────────────────
// Pure: reads a scored result into secondary, mode, pair confidence, explore hint, and (v2.2) where on the
// Bloom Dial the person is matched. Rules and rationale:
// features/quiz_interpretation_v2/QUIZ_INTERPRETATION_V2_DECISIONS.md ("v2.2 (2026-10-09)").
// v2.2 changes from v2.1: the branch answer sets the match (matchArchetype, intensityLean) and can override the
// secondary; pair confidence counts scored answers only (the Q6 treat and the experimental gate never lower it,
// Dana 2026-10-06); the treat-distance axis is gone.

export const INTERPRETATION_VERSION = 'v2.2';

export type PairConfidence = 'high' | 'medium' | 'low';
export type SecondaryPath = 'near-tie' | 'gate-backed' | 'food-led' | 'runner-up' | 'none' | 'branch-lean' | 'branch-match';
export type IntensityLean = 'delicate' | null;

// The effect of each branch answer, part of the ruleset (versions with INTERPRETATION_VERSION, not stored on
// quiz_answer). `match` null = the match is the shown archetype. `secondary` set = overrides the rule secondary
// (with `path`). Shown (finalArchetype) is never changed here: a Balanced winner is shown Balanced whatever they
// answer on the Balanced branch (Dana, 2026-10-08/09).
interface BranchEffect {
  match: string | null;
  intensityLean: IntensityLean;
  secondary?: string;
  path?: 'branch-lean' | 'branch-match';
}
export const BRANCH_ANSWER_EFFECTS: Record<string, BranchEffect> = {
  v7_branch_cn_earthy:     { match: null, intensityLean: null },
  v7_branch_cn_stay:       { match: null, intensityLean: null },
  v7_branch_fruity_floral: { match: null, intensityLean: 'delicate' },
  v7_branch_fruity_stay:   { match: null, intensityLean: null },
  v7_branch_bal_cozy:      { match: null, intensityLean: null, secondary: 'Chocolate & Nutty', path: 'branch-lean' },
  v7_branch_bal_fruit:     { match: 'Fruity', intensityLean: 'delicate', secondary: 'Balanced', path: 'branch-match' },
  v7_branch_bal_floral:    { match: 'Floral', intensityLean: 'delicate', secondary: 'Balanced', path: 'branch-match' },
};

// Sessions saved before branch_answer_id existed (2026-10-09) only carry branchedFrom. A real switch can only
// have come from the switching answer; anything else is unknown (null), never guessed. Used by the backfill and
// the offline recalibration, never by the live path.
export function historicalBranchAnswerCode(finalArchetype: string | null, branchedFrom: string | null): string | null {
  if (branchedFrom === null) return null;
  if (finalArchetype === 'Earthy') return 'v7_branch_cn_earthy';
  if (finalArchetype === 'Floral') return 'v7_branch_fruity_floral';
  return null;
}

export interface Interpretation {
  winner: string;
  secondaryArchetype: string | null;   // value to store: branchedFrom when a branch switched
  secondaryPath: SecondaryPath;
  recommendationMode: RecommendationMode;   // never 'ai_agent' (enum value kept for old rows)
  foodSignalAlignment: Confidence;          // legacy label, computed exactly as before
  pairConfidence: PairConfidence;
  exploreArchetype: string | null;          // 'A / B' for an unresolved runner-up tie
  exploreReason: string | null;
  primaryMargin: number;
  interpretationVersion: string;
  matchArchetype: string;                   // where on the Bloom Dial we match them; never null
  intensityLean: IntensityLean;             // 'delicate' or null (= the archetype's default position)
}

export interface InterpretInput {
  scores: Scores;            // only archetypes that scored appear
  byQ: ByQ;                  // q_number -> archetype the chosen answer scores (Q1..Q5)
  foodSignal: string | null; // Q6 resulting archetype name
  experimental: boolean;
  finalArchetype: string;    // shown: the winner, or the branch archetype after a real switch
  branchedFrom: string | null;
  branchAnswerCode: string | null;   // quiz_answer.answer_code of the branch answer; null = none / unknown
}

export function interpret(input: InterpretInput): Interpretation {
  const { scores, byQ, foodSignal, experimental, finalArchetype, branchedFrom, branchAnswerCode } = input;
  const branch = branchAnswerCode ? BRANCH_ANSWER_EFFECTS[branchAnswerCode] ?? null : null;

  // A.1 winner and margin
  const winner = findWinner(rankScores(scores), byQ);
  const others = Object.entries(scores).filter(([n]) => n !== winner);
  const runnerUpScore = others.reduce((m, [, s]) => Math.max(m, s), 0);
  const primaryMargin = (scores[winner] ?? 0) - runnerUpScore;
  const runners = others.filter(([, s]) => s === runnerUpScore && s > 0).map(([n]) => n);

  // A.2 secondary: first rule that applies wins
  const pick = (candidates: string[]): string => {
    if (candidates.length === 1) return candidates[0];
    if (foodSignal !== null && candidates.includes(foodSignal)) return foodSignal;
    for (const q of [5, 4, 2, 1]) {
      const a = byQ[q];
      if (a && candidates.includes(a)) return a;
    }
    return candidates.includes('Balanced') ? 'Balanced' : candidates[0];
  };

  let path: SecondaryPath;
  let ruleSecondary: string | null;
  if (primaryMargin <= 1 && runners.length > 0) {
    path = 'near-tie'; ruleSecondary = pick(runners);
  } else if (experimental && runners.includes('Fruity') && winner !== 'Fruity') {
    path = 'gate-backed'; ruleSecondary = 'Fruity';
  } else if (foodSignal !== null && foodSignal !== winner) {
    path = 'food-led'; ruleSecondary = foodSignal;
  } else if (runners.length > 0 && runnerUpScore >= 2) {
    path = 'runner-up'; ruleSecondary = pick(runners);
  } else {
    path = 'none'; ruleSecondary = null;
  }
  // A.3 mode, from the (pre-branch) path; a branch-lean/branch-match answer sets its own (below)
  let recommendationMode: RecommendationMode;
  switch (path) {
    case 'near-tie':
    case 'gate-backed':
      recommendationMode = 'primary_plus_active_secondary'; break;
    case 'food-led':
      recommendationMode = experimental ? 'primary_plus_active_secondary' : 'primary_plus_introduce_secondary'; break;
    case 'runner-up':
      recommendationMode = experimental
        ? 'primary_as_starting_point'
        : isSecondaryClose(byQ, ruleSecondary) ? 'primary_plus_note_secondary' : 'primary_only';
      break;
    default:
      recommendationMode = experimental ? 'primary_as_starting_point' : 'primary_only';
  }

  // A.4 the branch answer: match, lean, and (Balanced branch) the secondary
  let secondaryArchetype = branchedFrom !== null ? branchedFrom : ruleSecondary;
  let secondaryPath: SecondaryPath = path;
  if (branch?.secondary) {
    secondaryArchetype = branch.secondary;
    secondaryPath = branch.path!;
    recommendationMode = 'primary_plus_active_secondary';
  }
  const matchArchetype = branch?.match ?? finalArchetype;
  const intensityLean: IntensityLean = branch?.intensityLean ?? null;

  // A.5 pair confidence: scored answers and the branch answer only. The pair is {match, secondary}; a stray is
  // an archetype outside it with 3+ scored points. Low only for an unresolved two-way tie for runner-up.
  const pair = [matchArchetype, secondaryArchetype].filter((x): x is string => Boolean(x));
  const scoredStrays = Object.entries(scores)
    .filter(([n, s]) => !pair.includes(n) && s >= 3)
    .sort(([, a], [, b]) => b - a);
  const pairConfidence: PairConfidence = secondaryPath === 'near-tie' && runners.length >= 2
    ? 'low'
    : scoredStrays.length === 0 ? 'high' : 'medium';

  // A.6 explore archetype (Liam only): gate Fruity, treat, a 3+ point third archetype, a runner-up tie,
  // each evaluated against the pair above
  const treatStray = foodSignal !== null && !pair.includes(foodSignal);
  const fruityScore = scores['Fruity'] ?? 0;
  const explore: { archetype: string; reason: string }[] = [];
  if (experimental && !pair.includes('Fruity') && fruityScore >= 1) {
    explore.push({ archetype: 'Fruity', reason: 'experimental gate open, Fruity outside the pair' });
  }
  if (treatStray) {
    explore.push({ archetype: foodSignal as string, reason: `treat points to ${foodSignal}` });
  }
  const thirdStray = scoredStrays.find(([n]) => !(treatStray && n === foodSignal));
  if (thirdStray) {
    const [n, s] = thirdStray;
    explore.push({ archetype: n, reason: `${n} scored ${s} outside the pair` });
  }
  if (runners.length > 1 && branchedFrom === null && branch?.secondary) {
    // The branch answer named the secondary: a tied runner-up outside the pair is the loose thread.
    for (const r of [...runners].sort().filter(r => !pair.includes(r))) {
      explore.push({ archetype: r, reason: `${r} tied for runner-up at ${runnerUpScore}, outside the pair` });
    }
  } else if (runners.length > 1 && branchedFrom === null) {
    if (ruleSecondary !== null && runners.includes(ruleSecondary)) {
      const other = runners.find(r => r !== ruleSecondary) as string;
      const by = path === 'gate-backed'
        ? 'the experimental gate'
        : foodSignal === ruleSecondary ? 'the treat' : 'the Q5->Q4->Q2->Q1 cascade';
      explore.push({
        archetype: other,
        reason: `${other} tied with ${ruleSecondary} at ${runnerUpScore}; ${ruleSecondary} chosen by ${by}`,
      });
    } else if (ruleSecondary === null) {
      const [a, b] = [...runners].sort();
      explore.push({
        archetype: `${a} / ${b}`,
        reason: `${a} / ${b} tied at ${runnerUpScore}, under the 2-point floor: no secondary named`,
      });
    }
  }

  return {
    winner,
    secondaryArchetype,
    secondaryPath,
    recommendationMode,
    foodSignalAlignment: legacyFoodSignalAlignment(
      foodSignal, winner, ruleSecondary, experimental, isSecondaryClose(byQ, ruleSecondary)
    ),
    pairConfidence,
    exploreArchetype: explore[0]?.archetype ?? null,
    exploreReason: explore.length ? explore.map(e => e.reason).join('; ') : null,
    primaryMargin,
    interpretationVersion: INTERPRETATION_VERSION,
    matchArchetype,
    intensityLean,
  };
}
