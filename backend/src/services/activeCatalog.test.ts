// Roastery lifecycle (2026-08-25) — coverage for the single shared predicate
// every browse/recommend/resolve read composes (see
// backend/src/features/roastery_lifecycle/CLAUDE_CODE_PROMPT_ROASTERY_SOFT_DEACTIVATION.md
// Part B1). Requires DATABASE_URL pointed at a reachable Postgres instance with
// the roastery-lifecycle schema applied (see coffees.test.ts's own header note)
// — every assertion here reads coffees.is_active, so this file cannot run
// against a pre-migration database.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { ACTIVE_COFFEE_SQL, isCoffeeActive, getActiveCoffeeIds } from './activeCatalog.js';

// This file creates no fixtures today (every test here only reads), but
// carries the same 'Vitest%' sweep as every other new test file in this
// feature (2026-08-26 hardening round) as cheap insurance against a future
// test added here that does.
afterAll(async () => {
  await db.query(`DELETE FROM coffee_alias WHERE platform_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster_blend WHERE blend_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
});

describe('ACTIVE_COFFEE_SQL', () => {
  it('defaults to alias c, and accepts a custom alias', () => {
    expect(ACTIVE_COFFEE_SQL()).toBe('c.is_active = true');
    expect(ACTIVE_COFFEE_SQL('fc')).toBe('fc.is_active = true');
  });
});

describe('isCoffeeActive', () => {
  it('reflects the real coffees.is_active column for a live coffee, and is false for a nonexistent id', async () => {
    const row = (await db.query('SELECT id, is_active FROM coffees ORDER BY id LIMIT 1')).rows[0];
    expect(row).toBeTruthy();
    expect(await isCoffeeActive(row.id)).toBe(row.is_active);
    expect(await isCoffeeActive(999999999)).toBe(false);
  });
});

describe('getActiveCoffeeIds', () => {
  it('returns exactly the set of coffee ids with is_active = true', async () => {
    const expected = (await db.query('SELECT id FROM coffees WHERE is_active = true')).rows.map((r: { id: number }) => r.id);
    const actual = await getActiveCoffeeIds();
    expect(actual.size).toBe(expected.length);
    for (const id of expected) expect(actual.has(id)).toBe(true);
  });
});
