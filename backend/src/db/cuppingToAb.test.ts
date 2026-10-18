// Cupping evidence brief 1 (2026-10-18), C2 — cupping_to_ab(): native value →
// 0 to 15 pair, from cupping_scale_step. Read-only against the test DB.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from './client.js';

afterAll(async () => { await db.end(); });

async function ab(scale: string, min: number | null, max: number | null, raw: string | null) {
  const r = await db.query<{ ab_min: string | null; ab_max: string | null }>(
    `SELECT ab_min, ab_max FROM cupping_to_ab($1, $2, $3, $4)`, [scale, min, max, raw]
  );
  expect(r.rows).toHaveLength(1);
  const { ab_min, ab_max } = r.rows[0];
  return [ab_min === null ? null : Number(ab_min), ab_max === null ? null : Number(ab_max)];
}

describe('cupping_to_ab', () => {
  it('identity on ab_0_15 and legacy', async () => {
    expect(await ab('ab_0_15', 7, 9, '7-9')).toEqual([7, 9]);
    expect(await ab('ab_0_15', 3, 3, null)).toEqual([3, 3]);
    expect(await ab('legacy', 12, 13, null)).toEqual([12, 13]);
  });

  it('grid_0_5 steps: 0→0-1, 1→2-4, 2→5-7, 3→8-10, 4→11-13, 5→14-15', async () => {
    const expected: Record<number, [number, number]> = { 0: [0, 1], 1: [2, 4], 2: [5, 7], 3: [8, 10], 4: [11, 13], 5: [14, 15] };
    for (const [v, pair] of Object.entries(expected)) {
      expect(await ab('grid_0_5', Number(v), Number(v), `grid 0-5: ${v}`)).toEqual(pair);
    }
  });

  it('a grid range spans its steps (1 to 3 → 2-10)', async () => {
    expect(await ab('grid_0_5', 1, 3, 'grid 0-5: 1-3')).toEqual([2, 10]);
  });

  it('word_3 resolves the word in raw_value, case- and space-insensitive', async () => {
    expect(await ab('word_3', null, null, 'low')).toEqual([0, 5]);
    expect(await ab('word_3', null, null, ' Medium ')).toEqual([5, 10]);
    expect(await ab('word_3', null, null, 'HIGH')).toEqual([10, 15]);
  });

  it('an unknown label or scale gives nulls, and the readable view flags conversion_error', async () => {
    expect(await ab('word_3', null, null, 'loud')).toEqual([null, null]);
    expect(await ab('no_such_scale', 3, 4, null)).toEqual([null, null]);
    expect(await ab('grid_0_5', null, null, 'grid 0-5: ?')).toEqual([null, null]);
  });
});
