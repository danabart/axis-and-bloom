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

// ─── Interpretation v2.1 ─────────────────────────────────────────────────────
// Pure: reads a scored result into secondary, mode, pair confidence and explore hint.
// Rules and rationale: features/quiz_interpretation_v2/QUIZ_INTERPRETATION_V2_DECISIONS.md

export const INTERPRETATION_VERSION = 'v2.1';

// Interim, hand-ordered by Dana from archetype families. Replace with hop distance from the dial graph
// (Seam Board / bloom_dial_base_data) once that is the source of truth. Experimental is a flag, not a position.
export const ARCHETYPE_AXIS = ['Floral', 'Fruity', 'Balanced', 'Chocolate & Nutty', 'Earthy'] as const;

export function axisDistance(a: string, b: string): number {
  const ia = (ARCHETYPE_AXIS as readonly string[]).indexOf(a);
  const ib = (ARCHETYPE_AXIS as readonly string[]).indexOf(b);
  if (ia < 0 || ib < 0) return Infinity;
  return Math.abs(ia - ib);
}

export type PairConfidence = 'high' | 'medium' | 'low';
export type SecondaryPath = 'near-tie' | 'gate-backed' | 'food-led' | 'runner-up' | 'none';

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
}

export interface InterpretInput {
  scores: Scores;            // only archetypes that scored appear
  byQ: ByQ;                  // q_number -> archetype the chosen answer scores (Q1..Q5)
  foodSignal: string | null; // Q6 resulting archetype name
  experimental: boolean;
  finalArchetype: string;    // winner, or the branch archetype after a real switch
  branchedFrom: string | null;
}

export function interpret(input: InterpretInput): Interpretation {
  const { scores, byQ, foodSignal, experimental, finalArchetype, branchedFrom } = input;

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
  const secondaryArchetype = branchedFrom !== null ? branchedFrom : ruleSecondary;

  // A.3 mode, from the (pre-branch) path: the branch never changes the mode
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

  // A.4 pair confidence
  const pair = [finalArchetype, secondaryArchetype].filter((x): x is string => Boolean(x));
  const treatStray = foodSignal !== null && !pair.includes(foodSignal);
  const treatDistance = treatStray
    ? Math.min(...pair.map(p => axisDistance(foodSignal as string, p)))
    : 0;
  const fruityScore = scores['Fruity'] ?? 0;
  const gateStray = experimental && !pair.includes('Fruity') && fruityScore >= 2;
  const thirdStrays = Object.entries(scores)
    .filter(([n, s]) => !pair.includes(n) && s >= 3 && !(treatStray && n === foodSignal))
    .sort(([, a], [, b]) => b - a);
  const strayCount = (treatStray ? 1 : 0) + (gateStray ? 1 : 0) + (thirdStrays.length > 0 ? 1 : 0);
  let pairConfidence: PairConfidence = strayCount === 0 ? 'high' : strayCount === 1 ? 'medium' : 'low';
  if (treatStray && treatDistance >= 2) pairConfidence = 'low';

  // A.5 explore archetype (Liam only)
  const explore: { archetype: string; reason: string }[] = [];
  if (experimental && !pair.includes('Fruity') && fruityScore >= 1) {
    explore.push({ archetype: 'Fruity', reason: 'experimental gate open, Fruity outside the pair' });
  }
  if (treatStray) {
    explore.push({
      archetype: foodSignal as string,
      reason: `treat points to ${foodSignal}` + (treatDistance >= 2 ? ` (${treatDistance} steps from the pair)` : ''),
    });
  }
  if (thirdStrays.length > 0) {
    const [n, s] = thirdStrays[0];
    explore.push({ archetype: n, reason: `${n} scored ${s} outside the pair` });
  }
  if (runners.length > 1 && branchedFrom === null) {
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
    secondaryPath: path,
    recommendationMode,
    foodSignalAlignment: legacyFoodSignalAlignment(
      foodSignal, winner, ruleSecondary, experimental, isSecondaryClose(byQ, ruleSecondary)
    ),
    pairConfidence,
    exploreArchetype: explore[0]?.archetype ?? null,
    exploreReason: explore.length ? explore.map(e => e.reason).join('; ') : null,
    primaryMargin,
    interpretationVersion: INTERPRETATION_VERSION,
  };
}
