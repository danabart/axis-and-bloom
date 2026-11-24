// Ella's Bloom Map 11 follow-up (2026-11-24): the brief 9 seed
// (ellaMapReasons_2026_11_20.ts) never writes back a start rule whose current
// row was written after the script last ran, so a rerun cannot put Fabricator
// back on chocolate_nutty #3 or undo an /admin/map edit. Test DB only, inside
// a rolled-back transaction.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { db, type Tx } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import { setStartRuleInTx } from './dialPlacementService.js';
import { applyReasons, planReasons, lastRunAt, DATA_2 } from '../scripts/ellaMapReasons_2026_11_20.js';

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

const tx = (c: pg.PoolClient) => c as unknown as Tx;
const subjectOf = (d: (typeof DATA_2)[number]) => `${d.family} #${d.priority} (${d.coffee})`;

async function ensureRan(c: pg.PoolClient) {
  if (!(await lastRunAt(tx(c)))) await applyReasons(tx(c), { publishLabel: `zzz map9 guard ${randomUUID()}` });
  const last = await lastRunAt(tx(c));
  expect(last).not.toBeNull();
}

describe('ellaMapReasons_2026_11_20: start rules written since the last run', () => {
  it('skips and keeps a rule written after the script last ran; a rerun writes nothing to it', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRan(c);
      const before = await planReasons(tx(c));
      const open = before.rows.find(r => r.section === 'start_rule' && r.action !== 'skip');
      expect(open, 'a Data 2 rule the script may still write').toBeDefined();
      const d = DATA_2.find(x => subjectOf(x) === open!.subject)!;
      const cur = (await c.query(
        `SELECT condition_code, also_condition_code, coffee_id, admin_label, customer_reason, notes FROM v_dial_start_rule
          WHERE is_current AND family_code = $1 AND priority = $2`, [d.family, d.priority])).rows[0];

      // an edit made after the script last ran (as /admin/map or Ella map 11 would)
      await setStartRuleInTx(tx(c), {
        familyCode: d.family, priority: d.priority, conditionCode: cur.condition_code, alsoConditionCode: cur.also_condition_code,
        coffeeId: cur.coffee_id, adminLabel: cur.admin_label, customerReason: cur.customer_reason, notes: cur.notes,
        coffeeLine: 'Zzz guard test line.', adminUid: 'zzz-map9-guard',
      });

      const after = await planReasons(tx(c));
      const row = after.rows.find(r => r.section === 'start_rule' && r.subject === subjectOf(d))!;
      expect(row.action).toBe('skip');
      expect(row.why).toMatch(/^written since this script last ran/);
      // every other start rule keeps the action it had
      const others = (p: typeof before) => p.rows.filter(r => r.section === 'start_rule' && r.subject !== subjectOf(d)).map(r => `${r.subject}:${r.action}`);
      expect(others(after)).toEqual(others(before));

      await applyReasons(tx(c));
      const kept = (await c.query(
        `SELECT coffee_line, decided_by FROM v_dial_start_rule WHERE is_current AND family_code = $1 AND priority = $2`, [d.family, d.priority])).rows[0];
      expect(kept).toEqual({ coffee_line: 'Zzz guard test line.', decided_by: 'zzz-map9-guard' });
    });
  });

  it('lastRunAt is the latest row the script wrote itself', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRan(c);
      const last = (await lastRunAt(tx(c)))!;
      const latest = (await c.query<{ t: Date }>(
        `SELECT max(created_at) AS t FROM v_dial_start_rule WHERE decided_by = 'script:ellaMapReasons_2026_11_20'`)).rows[0].t;
      expect(last.getTime()).toBeGreaterThanOrEqual(new Date(latest).getTime());
    });
  });
});
