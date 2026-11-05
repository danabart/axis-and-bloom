// Website 6 (2026-11-05): GET /api/axis/stats through axisStatsReads, on the
// test DB. Every existing field is kept; originRegions counts sellable coffees
// per origin region (v_axis_origin_region_count), one row per region with at
// least one, in the lookup's order; nothing names a coffee. Fixtures live in
// rolled-back transactions (withRollback).
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';

const { db } = await import('../db/client.js');
const { withRollback } = await import('../test/withRollback.js');
const { getAxisStats } = await import('./axisStatsReads.js');

afterAll(async () => { await db.end(); });

describe('axisStatsReads.getAxisStats (Website 6)', () => {
  it('keeps every existing field and adds originRegions', async () => {
    const s = await getAxisStats();
    expect(Object.keys(s).sort()).toEqual([
      'archetypes', 'bloomNotesThisMonth', 'coffeesMapped', 'connectionCount', 'experimentalCount',
      'lastTightenedAt', 'originRegions', 'positionsRefinedThisQuarter', 'regionAdjacency',
    ]);
    expect(s.archetypes.length).toBeGreaterThan(0);
    expect(s.archetypes.every(a => typeof a.coffeeCount === 'number' && a.name)).toBe(true);
  });

  it('a region counts each sellable coffee once, in lookup order, and only regions with a coffee appear', async () => {
    await withRollback(async ({ client: c }) => {
      const sellable = (await c.query<{ coffee_id: number }>(
        `SELECT DISTINCT coffee_id FROM v_coffee_sellable_slot WHERE coffee_id IS NOT NULL ORDER BY coffee_id LIMIT 2`)).rows.map(r => r.coffee_id);
      expect(sellable.length).toBeGreaterThan(0);
      const regions = (await c.query<{ id: number; label: string; sort_order: number }>(
        `SELECT id, label, sort_order FROM lookup_value WHERE category = 'origin_region' ORDER BY sort_order LIMIT 2`)).rows;
      // every active coffee starts with no region on the test DB (OT-71); give them one each way
      await c.query(`UPDATE coffees SET origin_region_id = NULL WHERE is_active`);
      expect((await getAxisStats(c)).originRegions).toEqual([]);
      await c.query(`UPDATE coffees SET origin_region_id = $1 WHERE id = ANY($2)`, [regions[1].id, sellable]);
      const s = await getAxisStats(c);
      expect(s.originRegions).toEqual([{ label: regions[1].label, coffeeCount: sellable.length }]);
      if (sellable.length > 1) {
        await c.query(`UPDATE coffees SET origin_region_id = $1 WHERE id = $2`, [regions[0].id, sellable[1]]);
        expect((await getAxisStats(c)).originRegions).toEqual([
          { label: regions[0].label, coffeeCount: 1 },
          { label: regions[1].label, coffeeCount: 1 },
        ]);
      }
    });
  });

  it('aggregates only: no coffee name or id in the payload', async () => {
    const s = await getAxisStats();
    const json = JSON.stringify(s);
    const names = (await db.query<{ name: string }>(`SELECT name FROM coffees WHERE is_active AND length(name) > 4`)).rows.map(r => r.name);
    for (const n of names) expect(json).not.toContain(n);
    expect(json).not.toMatch(/coffeeId|coffee_id/);
  });
});
