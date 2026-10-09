import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { rebuildV7Scoring } from '../fixtures/quiz_calibration/v7AnswerMap.js';
import {
  rankScores,
  findWinner,
  isSecondaryClose,
  legacyFoodSignalAlignment,
  interpret,
  historicalBranchAnswerCode,
} from './quizScoring.js';

const CN = 'Chocolate & Nutty';
const BS = 'Balanced';
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

  it('falls back to Balanced when cascade is exhausted', () => {
    const ranked = rankScores({ [CN]: 5, [BS]: 5, [FR]: 2 });
    expect(findWinner(ranked, { 6: FR, 5: FR, 3: FR, 1: FR })).toBe(BS);
  });

  it('falls back to Balanced when byQ is empty', () => {
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

// ─── legacyFoodSignalAlignment (v1 label, confidence only) ────────────────────────────────────────────────

describe('legacyFoodSignalAlignment — Scenario 1: food matches primary', () => {
  it('high confidence, primary_only when no experimental and secondary not close', () => {
    const result = legacyFoodSignalAlignment(CN, CN, BS, false, false);
    expect(result).toBe('high');
  });
});

describe('legacyFoodSignalAlignment — Scenario 2: food matches secondary', () => {
  it('medium confidence, introduce_secondary when not experimental', () => {
    const result = legacyFoodSignalAlignment(BS, CN, BS, false, false);
    expect(result).toBe('medium');
  });

  it('medium confidence, active_secondary when experimental=true', () => {
    const result = legacyFoodSignalAlignment(BS, CN, BS, true, false);
    expect(result).toBe('medium');
  });
});

describe('legacyFoodSignalAlignment — Scenario 3: food matches neither', () => {
  it('low confidence, ai_agent', () => {
    const result = legacyFoodSignalAlignment(FR, CN, BS, false, false);
    expect(result).toBe('low');
  });

  it('low confidence, ai_agent even if experimental=true', () => {
    const result = legacyFoodSignalAlignment(FR, CN, BS, true, false);
    expect(result).toBe('low');
  });
});

describe('legacyFoodSignalAlignment — Scenario 4: food matches primary + secondary is close', () => {
  it('medium confidence, note_secondary when not experimental', () => {
    const result = legacyFoodSignalAlignment(CN, CN, BS, false, true);
    expect(result).toBe('medium');
  });
});

describe('legacyFoodSignalAlignment — experimental modifiers', () => {
  it('experimental overrides Scenario 4: food==primary, close secondary → primary_as_starting_point', () => {
    const result = legacyFoodSignalAlignment(CN, CN, BS, true, true);
    expect(result).toBe('medium');
  });

  it('experimental + food==primary (no close secondary) → primary_as_starting_point', () => {
    const result = legacyFoodSignalAlignment(CN, CN, BS, true, false);
    expect(result).toBe('medium');
  });
});

describe('legacyFoodSignalAlignment — no food signal', () => {
  it('defaults to high confidence, primary_only when foodSignal is null', () => {
    const result = legacyFoodSignalAlignment(null, CN, BS, false, false);
    expect(result).toBe('high');
  });

  it('defaults to high confidence, primary_only even when experimental=true and no food signal', () => {
    const result = legacyFoodSignalAlignment(null, CN, BS, true, false);
    expect(result).toBe('high');
  });
});

describe('legacyFoodSignalAlignment — secondary is null', () => {
  it('food matches neither when secondary is null and food != primary', () => {
    const result = legacyFoodSignalAlignment(FR, CN, null, false, false);
    expect(result).toBe('low');
  });
});

// ─── interpret() v2.2 — the branch answer (Prompt 4B, A.1) ───────────────────

describe('interpret() v2.2 — every row of the A.1 branch table', () => {
  // A plain Chocolate & Nutty 7 / Balanced 2 result, a Fruity 7 / Balanced 2 result and a Balanced 9 result.
  const cn = { scores: { [CN]: 7, [BS]: 2 }, byQ: { 1: CN, 2: BS, 3: CN, 4: CN, 5: CN }, foodSignal: null, experimental: false };
  const fr = { scores: { [FR]: 7, [BS]: 2 }, byQ: { 1: FR, 2: BS, 3: FR, 4: FR, 5: FR }, foodSignal: null, experimental: false };
  const bal = { scores: { [BS]: 9 }, byQ: { 1: BS, 2: BS, 3: BS, 4: BS, 5: BS }, foodSignal: null, experimental: false };
  const rows: [string, any, string, string | null, string, string | null, string | null, string][] = [
    // code, base, shown, branchedFrom, | match, lean, secondary, path
    ['v7_branch_cn_earthy', cn, 'Earthy', CN, 'Earthy', null, CN, 'runner-up'],
    ['v7_branch_cn_stay', cn, CN, null, CN, null, BS, 'runner-up'],
    ['v7_branch_fruity_floral', fr, 'Floral', FR, 'Floral', 'delicate', FR, 'runner-up'],
    ['v7_branch_fruity_stay', fr, FR, null, FR, null, BS, 'runner-up'],
    ['v7_branch_bal_cozy', bal, BS, null, BS, null, CN, 'branch-lean'],
    ['v7_branch_bal_fruit', bal, BS, null, FR, 'delicate', BS, 'branch-match'],
    ['v7_branch_bal_floral', bal, BS, null, 'Floral', 'delicate', BS, 'branch-match'],
  ];
  it.each(rows)('%s', (code, base, shown, branchedFrom, match, lean, secondary, path) => {
    const out = interpret({ ...base, finalArchetype: shown, branchedFrom, branchAnswerCode: code });
    expect(out.matchArchetype).toBe(match);
    expect(out.intensityLean).toBe(lean);
    expect(out.secondaryArchetype).toBe(secondary);
    expect(out.secondaryPath).toBe(path);
    expect(out.interpretationVersion).toBe('v2.2');
    if (path === 'branch-lean' || path === 'branch-match') expect(out.recommendationMode).toBe('primary_plus_active_secondary');
  });
  it('no branch answer: the match is the shown archetype, no lean, rule secondary', () => {
    const out = interpret({ ...cn, finalArchetype: CN, branchedFrom: null, branchAnswerCode: null });
    expect(out).toMatchObject({ matchArchetype: CN, intensityLean: null, secondaryArchetype: BS, secondaryPath: 'runner-up' });
  });
  it('an unknown branch code is ignored (treated as none)', () => {
    const out = interpret({ ...bal, finalArchetype: BS, branchedFrom: null, branchAnswerCode: 'v7_branch_nope' });
    expect(out).toMatchObject({ matchArchetype: BS, intensityLean: null });
  });
});

describe('interpret() v2.2 — pair confidence from scored answers and the branch answer only (A.2/A.3)', () => {
  it('an Earthy result with a Fruity treat is high: the treat no longer costs confidence', () => {
    const out = interpret({
      scores: { [CN]: 7, [BS]: 2 }, byQ: { 1: CN, 2: BS, 3: CN, 4: CN, 5: CN }, foodSignal: FR, experimental: false,
      finalArchetype: 'Earthy', branchedFrom: CN, branchAnswerCode: 'v7_branch_cn_earthy',
    });
    expect(out.pairConfidence).toBe('high');
    expect(out.exploreArchetype).toBe(FR);
    expect(out.exploreReason).toBe(`treat points to ${FR}`);
  });
  it('an experimental Earthy result with Fruity 3 is medium: Fruity counted once (scored), the gate adds nothing', () => {
    const out = interpret({
      scores: { [CN]: 6, [FR]: 3 }, byQ: { 1: CN, 2: FR, 3: FR, 4: CN, 5: CN }, foodSignal: null, experimental: true,
      finalArchetype: 'Earthy', branchedFrom: CN, branchAnswerCode: 'v7_branch_cn_earthy',
    });
    expect(out.pairConfidence).toBe('medium');
    expect(out.exploreArchetype).toBe(FR);
  });
  it('a 3/3/3 near-tie is low', () => {
    const out = interpret({
      scores: { [CN]: 3, [BS]: 3, [FR]: 3 }, byQ: { 1: BS, 2: BS, 3: FR, 4: FR, 5: CN }, foodSignal: null, experimental: false,
      finalArchetype: CN, branchedFrom: null, branchAnswerCode: null,
    });
    expect(out.secondaryPath).toBe('near-tie');
    expect(out.pairConfidence).toBe('low');
  });
  it('Balanced 8 / Fruity 1 with the peach answer: match Fruity, delicate, secondary Balanced, high', () => {
    const out = interpret({
      scores: { [BS]: 8, [FR]: 1 }, byQ: { 1: BS, 2: BS, 3: FR, 4: BS, 5: BS }, foodSignal: null, experimental: false,
      finalArchetype: BS, branchedFrom: null, branchAnswerCode: 'v7_branch_bal_fruit',
    });
    expect(out).toMatchObject({
      matchArchetype: FR, intensityLean: 'delicate', secondaryArchetype: BS, secondaryPath: 'branch-match',
      recommendationMode: 'primary_plus_active_secondary', pairConfidence: 'high',
    });
  });
  it('Balanced 5 / Chocolate & Nutty 4 with the smell answer: Chocolate & Nutty is a stray, medium, explore it', () => {
    const out = interpret({
      scores: { [BS]: 5, [CN]: 4 }, byQ: { 1: CN, 2: BS, 3: CN, 4: CN, 5: BS }, foodSignal: null, experimental: false,
      finalArchetype: BS, branchedFrom: null, branchAnswerCode: 'v7_branch_bal_floral',
    });
    expect(out).toMatchObject({
      matchArchetype: 'Floral', intensityLean: 'delicate', secondaryArchetype: BS, secondaryPath: 'branch-match',
      pairConfidence: 'medium', exploreArchetype: CN,
    });
  });
});

// ─── interpret() — Hoboken Crawl calibration set (37 real completions) ──────
// The v7 answer id map lives in fixtures/quiz_calibration/v7AnswerMap.ts (shared with scripts/quizRecalibrate.ts).
// The 'answer map reproduces the fixture inputs' tests below prove it against all 37 recorded score maps.
// expected_v2_1 stays in the fixture as the record; the current rules are checked against expected_v2_2.

interface CalibrationCase {
  case_id: string;
  input: {
    answerIds: string[];
    scores: Record<string, number>;
    archetype: string;
    foodSignal: string | null;
    experimental: boolean;
    branchedFrom: string | null;
  };
  expected_v2_2: {
    secondaryArchetype: string | null;
    recommendationMode: string;
    pairConfidence: string;
    exploreArchetype: string | null;
    primaryMargin: number;
    matchArchetype: string;
    intensityLean: string | null;
  };
}

const calibration = JSON.parse(
  readFileSync(new URL('../fixtures/quiz_calibration/hoboken-crawl-2026.calibration.json', import.meta.url), 'utf8')
) as { cases: CalibrationCase[] };

const rebuild = rebuildV7Scoring;

describe('interpret() v2.2 — calibration fixture', () => {
  it('has 37 cases', () => {
    expect(calibration.cases).toHaveLength(37);
  });

  it.each(calibration.cases.map(c => [c.case_id, c] as const))('%s: answer map reproduces the fixture inputs', (_id, c) => {
    const r = rebuild(c.input.answerIds);
    expect(r.scores).toEqual(c.input.scores);
    expect(r.foodSignal).toBe(c.input.foodSignal);
    expect(r.experimental).toBe(c.input.experimental);
  });

  it.each(calibration.cases.map(c => [c.case_id, c] as const))('%s: expected_v2_2', (_id, c) => {
    const r = rebuild(c.input.answerIds);
    const out = interpret({
      ...r,
      finalArchetype: c.input.archetype,
      branchedFrom: c.input.branchedFrom,
      branchAnswerCode: historicalBranchAnswerCode(c.input.archetype, c.input.branchedFrom),
    });
    expect({
      secondaryArchetype: out.secondaryArchetype,
      recommendationMode: out.recommendationMode,
      pairConfidence: out.pairConfidence,
      exploreArchetype: out.exploreArchetype,
      primaryMargin: out.primaryMargin,
      matchArchetype: out.matchArchetype,
      intensityLean: out.intensityLean,
    }).toEqual(c.expected_v2_2);
    expect(out.recommendationMode).not.toBe('ai_agent');
    expect(out.interpretationVersion).toBe('v2.2');
  });
});
