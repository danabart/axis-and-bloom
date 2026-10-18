// Cupping evidence brief 1 (2026-10-18), C2 — cupping_note is a tree (tier +
// parent_id). Read-only except the CHECK probe, which runs in a rolled-back
// transaction.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from './client.js';
import { withRollback } from '../test/withRollback.js';

afterAll(async () => { await db.end(); });

describe('cupping_note tree', () => {
  it('every tier-3 row has a tier-2 parent whose parent is tier 1; tier-1 rows have none', async () => {
    const bad = await db.query(`
      SELECT c.descriptor, c.tier, p.tier AS parent_tier, g.tier AS grandparent_tier
      FROM cupping_note c
      LEFT JOIN cupping_note p ON p.id = c.parent_id
      LEFT JOIN cupping_note g ON g.id = p.parent_id
      WHERE (c.tier = 3 AND (p.tier IS DISTINCT FROM 2 OR g.tier IS DISTINCT FROM 1))
         OR (c.tier = 2 AND (p.tier IS DISTINCT FROM 1 OR p.parent_id IS NOT NULL))
         OR (c.tier = 1 AND c.parent_id IS NOT NULL)`);
    expect(bad.rows).toEqual([]);
    const counts = await db.query<{ tier: number; n: string }>(`SELECT tier, COUNT(*) AS n FROM cupping_note GROUP BY tier`);
    expect(counts.rows.map(r => r.tier).sort()).toEqual([1, 2, 3]);
    expect((await db.query(`SELECT count(*)::int n FROM cupping_note WHERE tier > 1 AND parent_id IS NULL`)).rows[0].n).toBe(0);
  });

  it('a recursive walk from Blueberry reaches Berry, then Fruity', async () => {
    const path = await db.query<{ descriptor: string; tier: number }>(`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, descriptor, tier, 0 AS depth FROM cupping_note WHERE descriptor = 'Blueberry' AND tier = 3
        UNION ALL
        SELECT n.id, n.parent_id, n.descriptor, n.tier, up.depth + 1 FROM cupping_note n JOIN up ON n.id = up.parent_id
      ) SELECT descriptor, tier FROM up ORDER BY depth`);
    expect(path.rows).toEqual([
      { descriptor: 'Blueberry', tier: 3 },
      { descriptor: 'Berry', tier: 2 },
      { descriptor: 'Fruity', tier: 1 },
    ]);
  });

  it('parent_id agrees with the text labels on every row', async () => {
    const bad = await db.query(`
      SELECT c.descriptor FROM cupping_note c JOIN cupping_note p ON p.id = c.parent_id
      WHERE p.wheel_category <> c.wheel_category
         OR (c.tier = 3 AND p.descriptor IS DISTINCT FROM c.wheel_subcategory)
         OR (c.tier = 2 AND p.descriptor IS DISTINCT FROM c.wheel_category)`);
    expect(bad.rows).toEqual([]);
  });

  it('inserting a tier-2 row without a parent fails the CHECK', async () => {
    await withRollback(async ({ client }) => {
      await expect(client.query(
        `INSERT INTO cupping_note (wheel_category, wheel_subcategory, descriptor, tier) VALUES ('Fruity', 'Zzz', 'Zzz', 2)`
      )).rejects.toMatchObject({ code: '23514' });
    });
  });
});
