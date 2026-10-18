// Cupping evidence brief 1 (2026-10-18), C2 — cuppingService: the merge rule
// (pure), validation, supersede on re-save, merge twice, the dial-signal
// gate, the remove-empty doors, brew defaults.
//
// Evidence written through the service is immutable, so it cannot be cleaned
// up: every row lives under a marked fixture roastery ('Zzz Cupping Test
// Roastery', inactive, never one of the real roasteries) and fixture cuppers
// ('Zzz Cupper A/B'), found or created once and reused. Each run adds one
// session there. The dial signal is mocked (dialSuggestion.recordCuppingSignal)
// so no dial_position_signal row is written.
import 'dotenv/config';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('./dialSuggestion.js', () => ({ recordCuppingSignal: vi.fn(async () => {}) }));
vi.mock('./cuppingReads.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./cuppingReads.js')>();
  return { ...orig, getMergedRanges: vi.fn(orig.getMergedRanges) };
});

import { db } from '../db/client.js';
import { recordCuppingSignal } from './dialSuggestion.js';
import { getMergedRanges, type MergedRange } from './cuppingReads.js';
import {
  unionScores, rangeGap, createSession, addSessionCoffee, saveCupperScore, mergeByRule, refreshDialSignal,
  removeEmptySession, removeEmptySessionCoffee, saveBrewParams, addCupper, CuppingError, type UnionRow,
} from './cuppingService.js';

const RUN = Date.now().toString(36);
let coffeeId: number;
let cupperA: number;
let cupperB: number;
let sessionId: number;

async function findOrCreateCupper(name: string): Promise<number> {
  const found = await db.query<{ id: number }>(`SELECT id FROM cupper WHERE name = $1`, [name]);
  return found.rows[0]?.id ?? (await addCupper(name, { note: 'test fixture (cupping evidence brief 1 tests)' })).id;
}

beforeAll(async () => {
  let roaster = (await db.query<{ id: string }>(`SELECT id FROM roaster WHERE name = 'Zzz Cupping Test Roastery'`)).rows[0];
  if (!roaster) roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Zzz Cupping Test Roastery', false) RETURNING id`)).rows[0];
  let coffee = (await db.query<{ id: number }>(`SELECT id FROM coffees WHERE name = 'Zzz Cupping Test Coffee' AND roaster_id = $1`, [roaster.id])).rows[0];
  if (!coffee) coffee = (await db.query<{ id: number }>(`INSERT INTO coffees (name, roaster_id, is_active) VALUES ('Zzz Cupping Test Coffee', $1, false) RETURNING id`, [roaster.id])).rows[0];
  coffeeId = coffee.id;
  cupperA = await findOrCreateCupper('Zzz Cupper A');
  cupperB = await findOrCreateCupper('Zzz Cupper B');
  sessionId = await createSession({ sessionDate: '2026-10-18', recordSource: `test:cupping.test.ts ${RUN}`, sheetFormat: 'score_entry', location: 'Zzz test' });
});

afterAll(async () => { await db.end(); });
beforeEach(() => { vi.mocked(recordCuppingSignal).mockClear(); });

// ── unionScores (pure) ──────────────────────────────────────────────────────
const dim = (dimensionId: number, abMin: number | null, abMax: number | null, notes: string | null = null, isNumeric = true) =>
  ({ dimensionId, dimensionName: `D${dimensionId}`, isNumeric, abMin, abMax, notes });
const row = (who: string, values: UnionRow['values'], extra: Partial<UnionRow> = {}): UnionRow =>
  ({ cupperName: who, scaleCode: 'ab_0_15', values, descriptors: [], ...extra });

describe('unionScores (union_v1)', () => {
  it('unions ranges; a dimension scored by one cupper keeps her range and is listed', () => {
    const u = unionScores([row('A', [dim(5, 2, 8), dim(4, 6, 6)]), row('B', [dim(5, 3, 3)])], 2);
    expect(u.values.find(v => v.dimensionId === 5)).toMatchObject({ valueMin: 2, valueMax: 8, rawValue: 'union of: A 2-8, B 3' });
    expect(u.values.find(v => v.dimensionId === 4)).toMatchObject({ valueMin: 6, valueMax: 6 });
    expect(u.oneCupper).toEqual(['D4']);
    expect(u.mergeNote).toContain('one cupper: D4');
  });

  it('text dimensions keep words per cupper and no value', () => {
    const u = unionScores([row('A', [dim(12, null, null, 'silky', false)]), row('B', [dim(12, null, null, 'round', false)])], 2);
    expect(u.values[0]).toMatchObject({ valueMin: null, valueMax: null, notes: 'A: silky; B: round' });
  });

  it('a gap of exactly n agrees, n + 1 disagrees', () => {
    expect(rangeGap([2, 3], [5, 6])).toBe(2);
    expect(unionScores([row('A', [dim(5, 2, 3)]), row('B', [dim(5, 5, 6)])], 2).disagreements).toEqual([]);
    const u = unionScores([row('A', [dim(5, 2, 3)]), row('B', [dim(5, 6, 7)])], 2);
    expect(u.disagreements).toEqual(['D5']);
    expect(u.mergeNote).toContain('cupper disagreement (gap > 2) on: D5');
  });

  it('a converted scale makes allAbScale false and the note withholds the dial signal', () => {
    const u = unionScores([row('A', [dim(5, 2, 4)]), row('B', [dim(5, 11, 13)], { scaleCode: 'grid_0_5' })], 2);
    expect(u.allAbScale).toBe(false);
    expect(u.scaleCodes).toEqual(['ab_0_15', 'grid_0_5']);
    expect(u.mergeNote).toContain('scales: A ab_0_15, B grid_0_5');
    expect(u.mergeNote).toContain('no dial signal (converted scale)');
    expect(unionScores([row('A', [dim(5, 2, 4)])], 2).allAbScale).toBe(true);
  });

  it('calls: kept when unanimous among cuppers who made one, otherwise null with the calls in call_note', () => {
    expect(unionScores([row('A', [], { archetypeCall: 'earthy' }), row('B', [])], 2).archetypeCall).toBe('earthy');
    expect(unionScores([row('A', [], { archetypeCall: 'earthy' }), row('B', [], { archetypeCall: 'earthy' })], 2).archetypeCall).toBe('earthy');
    const u = unionScores([row('A', [], { archetypeCall: 'earthy', positionCall: 'light' }), row('B', [], { archetypeCall: 'chocolate_nutty', positionCall: 'light' })], 2);
    expect(u.archetypeCall).toBeNull();
    expect(u.positionCall).toBe('light');
    expect(u.callNote).toContain('archetype calls differ: A=earthy, B=chocolate_nutty');
  });

  it('descriptors: union of nodes, each cupper\'s words kept', () => {
    const u = unionScores([
      row('A', [], { descriptors: [{ cuppingNoteId: 'n1', customNotes: 'cocoa' }, { cuppingNoteId: 'n2' }] }),
      row('B', [], { descriptors: [{ cuppingNoteId: 'n1', customNotes: 'bitter choc', intensity: 4 }] }),
    ], 2);
    expect(u.descriptors).toEqual([
      { cuppingNoteId: 'n1', intensity: 4, customNotes: 'A: cocoa; B: bitter choc' },
      { cuppingNoteId: 'n2', intensity: null, customNotes: null },
    ]);
  });
});

// ── The service against the test DB ────────────────────────────────────────
async function newSample(): Promise<number> {
  return addSessionCoffee(sessionId, coffeeId, { blindCode: `ZZZ-${RUN}` });
}
const current = async (scId: number) =>
  (await db.query(`SELECT id, cupper_id, is_merged, superseded_at, superseded_by_id, supersede_reason, merge_rule, merge_note
                   FROM cupping_scores WHERE session_coffee_id = $1 ORDER BY id`, [scId])).rows;

describe('saveCupperScore validation', () => {
  it('numeric values must sit inside the scale the cupper used', async () => {
    const sc = await newSample();
    await expect(saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, scaleCode: 'grid_0_5', values: [{ dimensionId: 5, valueMin: 6, valueMax: 6, rawValue: 'grid 0-5: 6' }] }))
      .rejects.toMatchObject({ code: 'CUPPING_INVALID' });
    await expect(saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, values: [{ dimensionId: 5, valueMin: 14, valueMax: 16, rawValue: '14-16' }] }))
      .rejects.toMatchObject({ code: 'CUPPING_INVALID' });
    await expect(saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, values: [{ dimensionId: 5, valueMin: 8, valueMax: 6, rawValue: '8-6' }] }))
      .rejects.toMatchObject({ code: 'CUPPING_INVALID' });
  });

  it('rawValue is required for a range and for any scale other than ab_0_15', async () => {
    const sc = await newSample();
    await expect(saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, values: [{ dimensionId: 5, valueMin: 4, valueMax: 6 }] }))
      .rejects.toMatchObject({ code: 'CUPPING_INVALID' });
    await expect(saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, scaleCode: 'grid_0_5', values: [{ dimensionId: 5, valueMin: 4, valueMax: 4 }] }))
      .rejects.toMatchObject({ code: 'CUPPING_INVALID' });
  });

  it('a words-only dimension rejects values; an ordinal scale takes the word, not values', async () => {
    const sc = await newSample();
    await expect(saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, values: [{ dimensionId: 12, valueMin: 3, valueMax: 3, rawValue: '3' }] }))
      .rejects.toMatchObject({ code: 'CUPPING_INVALID' });
    await expect(saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, scaleCode: 'word_3', values: [{ dimensionId: 5, valueMin: 3, valueMax: 3, rawValue: 'low' }] }))
      .rejects.toMatchObject({ code: 'CUPPING_INVALID' });
    const id = await saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, scaleCode: 'word_3', values: [{ dimensionId: 5, rawValue: 'low' }] });
    const v = (await db.query(`SELECT value_min, value_max, raw_value FROM cupping_score_values WHERE cupping_score_id = $1`, [id])).rows[0];
    expect(v).toEqual({ value_min: null, value_max: null, raw_value: 'low' });
    const readable = (await db.query(`SELECT value_min, value_max FROM v_cupping_scores_readable WHERE score_id = $1`, [id])).rows[0];
    expect([Number(readable.value_min), Number(readable.value_max)]).toEqual([0, 5]);
  });

  it('refuses the legacy scale and an unknown cupper', async () => {
    const sc = await newSample();
    await expect(saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, scaleCode: 'legacy', values: [] })).rejects.toMatchObject({ code: 'CUPPING_INVALID' });
    await expect(saveCupperScore({ sessionCoffeeId: sc, cupperId: 987654321, values: [] })).rejects.toMatchObject({ code: 'CUPPING_INVALID' });
  });
});

describe('supersede, merge, re-merge', () => {
  it('re-saving a cupper row supersedes it and re-merges; one current row each', async () => {
    const sc = await newSample();
    const a1 = await saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, values: [{ dimensionId: 5, valueMin: 4, valueMax: 6, rawValue: '4-6' }] });
    await saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperB, values: [{ dimensionId: 5, valueMin: 9, valueMax: 9 }] });
    const m1 = await mergeByRule(sc);
    expect(m1.union.disagreements).toEqual(['Acidity']);
    expect(m1.union.mergeNote).toMatch(/^union_v1; scales: Zzz Cupper A ab_0_15, Zzz Cupper B ab_0_15; cupper disagreement \(gap > 2\) on: Acidity/);

    const a2 = await saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, values: [{ dimensionId: 5, valueMin: 7, valueMax: 8, rawValue: '7-8' }], supersedeReason: 'transcription correction: 4-6 was 7-8' });
    const rows = await current(sc);
    const old = rows.find(r => r.id === a1)!;
    expect(old.superseded_by_id).toBe(a2);
    expect(old.supersede_reason).toBe('transcription correction: 4-6 was 7-8');
    expect(rows.filter(r => r.superseded_at === null && !r.is_merged)).toHaveLength(2);
    const merged = rows.filter(r => r.is_merged);
    expect(merged.filter(r => r.superseded_at === null)).toHaveLength(1);
    const oldMerge = merged.find(r => r.id === m1.mergedScoreId)!;
    expect(oldMerge.supersede_reason).toBe('merged by rule again');
    const newMerge = merged.find(r => r.superseded_at === null)!;
    expect(newMerge.merge_rule).toBe('union_v1');
    expect(newMerge.merge_note).not.toContain('cupper disagreement'); // 7-8 vs 9: gap 1
    const range = (await db.query(`SELECT value_min, value_max FROM cupping_score_values WHERE cupping_score_id = $1 AND dimension_id = 5`, [newMerge.id])).rows[0];
    expect([Number(range.value_min), Number(range.value_max)]).toEqual([7, 9]);
  });

  it('mergeByRule twice leaves one current merged row', async () => {
    const sc = await newSample();
    await saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, values: [{ dimensionId: 4, valueMin: 5, valueMax: 5 }] });
    const first = await mergeByRule(sc);
    const second = await mergeByRule(sc);
    const merged = (await current(sc)).filter(r => r.is_merged);
    expect(merged).toHaveLength(2);
    expect(merged.filter(r => r.superseded_at === null).map(r => r.id)).toEqual([second.mergedScoreId]);
    expect(merged.find(r => r.id === first.mergedScoreId)!.superseded_by_id).toBe(second.mergedScoreId);
  });

  it('a merge with no cupper row is refused', async () => {
    const sc = await newSample();
    await expect(mergeByRule(sc)).rejects.toMatchObject({ code: 'CUPPING_NO_CUPPER_ROWS' });
  });

  it('the gap comes from param(cupper_gap) when not given', async () => {
    const sc = await newSample();
    await saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, values: [{ dimensionId: 4, valueMin: 2, valueMax: 2 }] });
    await saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperB, values: [{ dimensionId: 4, valueMin: 5, valueMax: 5 }] });
    const gap = Number((await db.query(`SELECT param('cupper_gap') AS v`)).rows[0].v);
    const m = await mergeByRule(sc);
    expect(m.union.mergeNote).toContain(`gap > ${gap}`);
    expect(m.union.disagreements).toEqual(gap < 3 ? ['Sweetness'] : []);
  });
});

describe('the dial signal', () => {
  const range = (all: boolean): MergedRange => ({
    coffee_id: 1, dimension_id: 5, dimension_name: 'Acidity', value_min: 4, value_max: 6, midpoint: 5, n_scores: 2,
    basis: 'merged', session_id: 1, session_date: '2026-10-18', n_sessions: 1, all_ab_scale: all,
    scale_min_label: null, scale_max_label: null, display_order: 5, is_numeric: true,
  });

  it('fires only when every cupper row behind the latest merge is ab_0_15, retracts otherwise', async () => {
    vi.mocked(getMergedRanges).mockResolvedValueOnce([range(true)]);
    expect(await refreshDialSignal(1)).toBe('recorded');
    expect(recordCuppingSignal).toHaveBeenLastCalledWith(1);

    vi.mocked(getMergedRanges).mockResolvedValueOnce([range(false)]);
    expect(await refreshDialSignal(1)).toBe('retracted');
    expect(recordCuppingSignal).toHaveBeenLastCalledWith(1, { retract: true });

    vi.mocked(getMergedRanges).mockResolvedValueOnce([]);
    expect(await refreshDialSignal(1)).toBe('retracted');
  });

  it('mergeByRule refreshes the signal after it commits', async () => {
    const sc = await newSample();
    await saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, scaleCode: 'grid_0_5', values: [{ dimensionId: 5, valueMin: 4, valueMax: 4, rawValue: 'grid 0-5: 4' }] });
    vi.mocked(recordCuppingSignal).mockClear();
    const m = await mergeByRule(sc);
    expect(m.union.allAbScale).toBe(false);
    expect(recordCuppingSignal).toHaveBeenCalledWith(coffeeId, { retract: true });
    const v = (await db.query(`SELECT value_min, value_max FROM cupping_score_values WHERE cupping_score_id = $1 AND dimension_id = 5`, [m.mergedScoreId])).rows[0];
    expect([Number(v.value_min), Number(v.value_max)]).toEqual([11, 13]); // grid 4, converted
  });
});

describe('sessions, samples, brew params', () => {
  it('addSessionCoffee writes the session\'s brew defaults; saveBrewParams locks once scored', async () => {
    const s = await createSession({ sessionDate: '2026-10-18', recordSource: `test:cupping.test.ts ${RUN}`,
      brewDefaults: { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl' } });
    const sc = await addSessionCoffee(s, coffeeId, { isControl: true });
    const brew = (await db.query(`SELECT dose_grams, water_grams, ratio, brew_device FROM cupping_brew_params WHERE session_coffee_id = $1`, [sc])).rows[0];
    expect(brew).toEqual({ dose_grams: '8.5', water_grams: '150', ratio: '17.65', brew_device: 'cupping bowl' });
    await saveBrewParams(sc, { doseGrams: 9, waterGrams: 150 });
    await saveCupperScore({ sessionCoffeeId: sc, cupperId: cupperA, values: [{ dimensionId: 4, valueMin: 5, valueMax: 5 }] });
    await expect(saveBrewParams(sc, { doseGrams: 10 })).rejects.toMatchObject({ code: 'CUPPING_HAS_EVIDENCE' });
    expect((await db.query(`SELECT is_control FROM cupping_session_coffees WHERE id = $1`, [sc])).rows[0].is_control).toBe(true);
  });

  it('removeEmpty* refuses anything with evidence underneath and removes what is empty', async () => {
    const s = await createSession({ sessionDate: '2026-10-18', recordSource: `test:cupping.test.ts ${RUN}`, brewDefaults: { doseGrams: 8.5, waterGrams: 150 } });
    const scored = await addSessionCoffee(s, coffeeId);
    await saveCupperScore({ sessionCoffeeId: scored, cupperId: cupperA, values: [] });
    const empty = await addSessionCoffee(s, coffeeId);
    await expect(removeEmptySessionCoffee(scored)).rejects.toBeInstanceOf(CuppingError);
    await expect(removeEmptySession(s)).rejects.toMatchObject({ code: 'CUPPING_HAS_EVIDENCE' });
    await removeEmptySessionCoffee(empty);
    expect((await db.query(`SELECT 1 FROM cupping_session_coffees WHERE id = $1`, [empty])).rowCount).toBe(0);

    const bare = await createSession({ sessionDate: '2026-10-18', recordSource: `test:cupping.test.ts ${RUN}` });
    await removeEmptySession(bare);
    expect((await db.query(`SELECT 1 FROM cupping_sessions WHERE id = $1`, [bare])).rowCount).toBe(0);
  });
});
