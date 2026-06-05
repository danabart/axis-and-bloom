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

  for (const qNum of [6, 5, 3, 1]) {
    const pointsTo = byQ[qNum];
    if (pointsTo && tied.includes(pointsTo)) return pointsTo;
  }

  return 'Balanced & Sweet';
}

export function findSecondary(ranked: [string, number][], winner: string): string | null {
  return ranked.find(([n]) => n !== winner)?.[0] ?? null;
}

export function isSecondaryClose(byQ: ByQ, secondary: string | null): boolean {
  if (!secondary) return false;
  return byQ[6] === secondary || byQ[5] === secondary;
}

export function computeConfidenceAndMode(
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
