import { describe, it, expect } from 'vitest';
import {
  rankScores,
  findWinner,
  findSecondary,
  isSecondaryClose,
  computeConfidenceAndMode,
} from './quizScoring.js';

const CN = 'Chocolate & Nutty';
const BS = 'Balanced & Sweet';
const FR = 'Fruity';

// ─── rankScores ──────────────────────────────────────────────────────────────

describe('rankScores', () => {
  it('sorts descending by score', () => {
    const ranked = rankScores({ [CN]: 7, [FR]: 2, [BS]: 4 });
    expect(ranked.map(([n]) => n)).toEqual([CN, BS, FR]);
  });
});

// ─── findWinner ──────────────────────────────────────────────────────────────

describe('findWinner — clear winner', () => {
  it('returns the highest scorer with no cascade needed', () => {
    const ranked = rankScores({ [CN]: 7, [BS]: 3, [FR]: 2 });
    expect(findWinner(ranked, {})).toBe(CN);
  });
});

describe('findWinner — veto cascade', () => {
  it('resolves tie via Q6', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 2 });
    expect(findWinner(ranked, { 6: CN })).toBe(CN);
  });

  it('resolves tie via Q5 when Q6 points to neither tied archetype', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 2 });
    expect(findWinner(ranked, { 6: FR, 5: BS })).toBe(BS);
  });

  it('resolves tie via Q3 when Q6 and Q5 do not help', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 2 });
    expect(findWinner(ranked, { 6: FR, 5: FR, 3: CN })).toBe(CN);
  });

  it('resolves tie via Q1 as last resort', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 2 });
    expect(findWinner(ranked, { 6: FR, 5: FR, 3: FR, 1: BS })).toBe(BS);
  });

  it('falls back to Balanced & Sweet when cascade is exhausted', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 2 });
    expect(findWinner(ranked, { 6: FR, 5: FR, 3: FR, 1: FR })).toBe(BS);
  });

  it('falls back to Balanced & Sweet when byQ is empty', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 2 });
    expect(findWinner(ranked, {})).toBe(BS);
  });

  it('handles three-way tie — first match in cascade wins', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 5 });
    expect(findWinner(ranked, { 6: FR })).toBe(FR);
  });

  it('Q4 is NOT in the cascade (split answer should not break ties)', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 2 });
    // Even if Q4 points to CN, it should be ignored
    expect(findWinner(ranked, { 4: CN })).toBe(BS); // fallback — Q4 not checked
  });

  it('Q2 is NOT in the cascade', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 2 });
    expect(findWinner(ranked, { 2: CN })).toBe(BS); // Q2 not checked, falls back
  });
});

// ─── findSecondary ───────────────────────────────────────────────────────────

describe('findSecondary', () => {
  it('returns 2nd highest archetype', () => {
    const ranked = rankScores({ [CN]: 7, [BS]: 4, [FR]: 2 });
    expect(findSecondary(ranked, CN)).toBe(BS);
  });

  it('returns null when only one archetype has a score', () => {
    const ranked = rankScores({ [CN]: 7 });
    expect(findSecondary(ranked, CN)).toBeNull();
  });

  it('skips the winner when finding secondary', () => {
    const ranked = rankScores({ [CN]: 7, [BS]: 7, [FR]: 2 });
    // winner is CN (first in ranked after cascade), secondary should be BS
    expect(findSecondary(ranked, CN)).toBe(BS);
  });
});

// ─── isSecondaryClose ────────────────────────────────────────────────────────

describe('isSecondaryClose (Option B — secondary scored on Q5 or Q6)', () => {
  it('returns true when secondary scored on Q6', () => {
    expect(isSecondaryClose({ 6: BS }, BS)).toBe(true);
  });

  it('returns true when secondary scored on Q5', () => {
    expect(isSecondaryClose({ 5: FR }, FR)).toBe(true);
  });

  it('returns false when secondary only scored on low-weight questions', () => {
    expect(isSecondaryClose({ 1: BS, 3: BS }, BS)).toBe(false);
  });

  it('returns false when Q5/Q6 point to a different archetype', () => {
    expect(isSecondaryClose({ 6: CN, 5: CN }, BS)).toBe(false);
  });

  it('returns false when secondary is null', () => {
    expect(isSecondaryClose({ 6: CN }, null)).toBe(false);
  });

  it('returns false when byQ is empty', () => {
    expect(isSecondaryClose({}, BS)).toBe(false);
  });
});

// ─── computeConfidenceAndMode ────────────────────────────────────────────────

describe('computeConfidenceAndMode — Scenario 1: food matches primary', () => {
  it('high confidence, primary_only when no experimental and secondary not close', () => {
    const result = computeConfidenceAndMode(CN, CN, BS, false, false);
    expect(result).toEqual({ confidence: 'high', recommendationMode: 'primary_only' });
  });
});

describe('computeConfidenceAndMode — Scenario 2: food matches secondary', () => {
  it('medium confidence, introduce_secondary when not experimental', () => {
    const result = computeConfidenceAndMode(BS, CN, BS, false, false);
    expect(result).toEqual({ confidence: 'medium', recommendationMode: 'primary_plus_introduce_secondary' });
  });

  it('medium confidence, active_secondary when experimental=true', () => {
    const result = computeConfidenceAndMode(BS, CN, BS, true, false);
    expect(result).toEqual({ confidence: 'medium', recommendationMode: 'primary_plus_active_secondary' });
  });
});

describe('computeConfidenceAndMode — Scenario 3: food matches neither', () => {
  it('low confidence, ai_agent', () => {
    const result = computeConfidenceAndMode(FR, CN, BS, false, false);
    expect(result).toEqual({ confidence: 'low', recommendationMode: 'ai_agent' });
  });

  it('low confidence, ai_agent even if experimental=true', () => {
    const result = computeConfidenceAndMode(FR, CN, BS, true, false);
    expect(result).toEqual({ confidence: 'low', recommendationMode: 'ai_agent' });
  });
});

describe('computeConfidenceAndMode — Scenario 4: food matches primary + secondary is close', () => {
  it('medium confidence, note_secondary when not experimental', () => {
    const result = computeConfidenceAndMode(CN, CN, BS, false, true);
    expect(result).toEqual({ confidence: 'medium', recommendationMode: 'primary_plus_note_secondary' });
  });
});

describe('computeConfidenceAndMode — experimental modifiers', () => {
  it('experimental overrides Scenario 4: food==primary, close secondary → primary_as_starting_point', () => {
    const result = computeConfidenceAndMode(CN, CN, BS, true, true);
    expect(result).toEqual({ confidence: 'medium', recommendationMode: 'primary_as_starting_point' });
  });

  it('experimental + food==primary (no close secondary) → primary_as_starting_point', () => {
    const result = computeConfidenceAndMode(CN, CN, BS, true, false);
    expect(result).toEqual({ confidence: 'medium', recommendationMode: 'primary_as_starting_point' });
  });
});

describe('computeConfidenceAndMode — no food signal', () => {
  it('defaults to high confidence, primary_only when foodSignal is null', () => {
    const result = computeConfidenceAndMode(null, CN, BS, false, false);
    expect(result).toEqual({ confidence: 'high', recommendationMode: 'primary_only' });
  });

  it('defaults to high confidence, primary_only even when experimental=true and no food signal', () => {
    const result = computeConfidenceAndMode(null, CN, BS, true, false);
    expect(result).toEqual({ confidence: 'high', recommendationMode: 'primary_only' });
  });
});

describe('computeConfidenceAndMode — secondary is null', () => {
  it('food matches neither when secondary is null and food != primary', () => {
    const result = computeConfidenceAndMode(FR, CN, null, false, false);
    expect(result).toEqual({ confidence: 'low', recommendationMode: 'ai_agent' });
  });
});
