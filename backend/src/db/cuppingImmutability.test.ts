// Cupping evidence brief 1 (2026-10-18), C2 — DB-level immutability of the
// cupping evidence: triggers, the one supersede transition, RESTRICT. Every
// fixture lives inside a rolled-back transaction (withRollback): an evidence
// row, once committed, could never be cleaned up.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import type pg from 'pg';
import { db } from './client.js';
import { withRollback, type RollbackTx } from '../test/withRollback.js';

afterAll(async () => { await db.end(); });

const IMMUTABLE = { code: '23000' };      // RAISE ... integrity_constraint_violation
const RESTRICTED = { code: '23503' };     // foreign_key_violation (ON DELETE RESTRICT)

interface Fixture { coffeeId: number; sessionId: number; scId: number; cupperRow: number; mergedRow: number; noteId: string }

async function fixture(c: pg.PoolClient): Promise<Fixture> {
  const roaster = (await c.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Zzz Immutability Roastery', true) RETURNING id`)).rows[0].id;
  const coffeeId = (await c.query<{ id: number }>(`INSERT INTO coffees (name, roaster_id, is_active) VALUES ('Zzz Immutability Coffee', $1, true) RETURNING id`, [roaster])).rows[0].id;
  const cupper = (await c.query<{ id: number }>(`INSERT INTO cupper (name) VALUES ('Zzz Immutability Cupper') RETURNING id`)).rows[0].id;
  const sessionId = (await c.query<{ id: number }>(`INSERT INTO cupping_sessions (session_date, record_source) VALUES ('2026-10-18', 'test') RETURNING id`)).rows[0].id;
  const scId = (await c.query<{ id: number }>(`INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`, [sessionId, coffeeId])).rows[0].id;
  const cupperRow = (await c.query<{ id: number }>(`INSERT INTO cupping_scores (session_coffee_id, cupper_id, is_merged, scale_code) VALUES ($1, $2, false, 'ab_0_15') RETURNING id`, [scId, cupper])).rows[0].id;
  const mergedRow = (await c.query<{ id: number }>(`INSERT INTO cupping_scores (session_coffee_id, is_merged, scale_code, merge_rule) VALUES ($1, true, 'ab_0_15', 'union_v1') RETURNING id`, [scId])).rows[0].id;
  const noteId = (await c.query<{ id: string }>(`SELECT id FROM cupping_note WHERE descriptor = 'Blueberry' AND tier = 3`)).rows[0].id;
  for (const row of [cupperRow, mergedRow]) {
    await c.query(`INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max, raw_value) VALUES ($1, 5, 6, 8, '6-8')`, [row]);
    await c.query(`INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id) VALUES ($1, $2)`, [row, noteId]);
  }
  return { coffeeId, sessionId, scId, cupperRow, mergedRow, noteId };
}

/** The one permitted transition: the replacement's id from the sequence, the old row pointed at it, then the replacement inserted. */
async function supersede(tx: RollbackTx, oldId: number, scId: number, merged: boolean): Promise<number> {
  const c = tx.client;
  const newId = Number((await c.query(`SELECT nextval(pg_get_serial_sequence('cupping_scores', 'id')) AS id`)).rows[0].id);
  await c.query(`UPDATE cupping_scores SET superseded_at = now(), superseded_by_id = $2, supersede_reason = 'test' WHERE id = $1`, [oldId, newId]);
  if (merged) {
    await c.query(`INSERT INTO cupping_scores (id, session_coffee_id, is_merged, scale_code, merge_rule) VALUES ($1, $2, true, 'ab_0_15', 'union_v1')`, [newId, scId]);
  } else {
    const cupper = (await c.query(`SELECT cupper_id FROM cupping_scores WHERE id = $1`, [oldId])).rows[0].cupper_id;
    await c.query(`INSERT INTO cupping_scores (id, session_coffee_id, cupper_id, is_merged, scale_code) VALUES ($1, $2, $3, false, 'ab_0_15')`, [newId, scId, cupper]);
  }
  return newId;
}

describe('cupping evidence is immutable at the database level', () => {
  it('values and descriptors: UPDATE and DELETE are rejected', async () => {
    await withRollback(async tx => {
      const f = await fixture(tx.client);
      await expect(tx.savepoint(() => tx.client.query(`UPDATE cupping_score_values SET value_max = 9 WHERE cupping_score_id = $1`, [f.cupperRow]))).rejects.toMatchObject(IMMUTABLE);
      await expect(tx.savepoint(() => tx.client.query(`DELETE FROM cupping_score_values WHERE cupping_score_id = $1`, [f.cupperRow]))).rejects.toMatchObject(IMMUTABLE);
      await expect(tx.savepoint(() => tx.client.query(`UPDATE cupping_score_descriptors SET intensity = 3 WHERE cupping_score_id = $1`, [f.cupperRow]))).rejects.toMatchObject(IMMUTABLE);
      await expect(tx.savepoint(() => tx.client.query(`DELETE FROM cupping_score_descriptors WHERE cupping_score_id = $1`, [f.cupperRow]))).rejects.toMatchObject(IMMUTABLE);
    });
  });

  it('scores: DELETE is rejected; an UPDATE that changes a value is rejected', async () => {
    await withRollback(async tx => {
      const f = await fixture(tx.client);
      await expect(tx.savepoint(() => tx.client.query(`DELETE FROM cupping_scores WHERE id = $1`, [f.cupperRow]))).rejects.toMatchObject(IMMUTABLE);
      await expect(tx.savepoint(() => tx.client.query(`UPDATE cupping_scores SET overall_notes = 'changed' WHERE id = $1`, [f.cupperRow]))).rejects.toMatchObject(IMMUTABLE);
      await expect(tx.savepoint(() => tx.client.query(`UPDATE cupping_scores SET archetype_call = 'fruity' WHERE id = $1`, [f.mergedRow]))).rejects.toMatchObject(IMMUTABLE);
    });
  });

  it('the one supersede transition succeeds once, on a cupper row and on a merged row, and fails the second time', async () => {
    await withRollback(async tx => {
      const f = await fixture(tx.client);
      for (const [row, merged] of [[f.cupperRow, false], [f.mergedRow, true]] as const) {
        const newId = await tx.savepoint(() => supersede(tx, row, f.scId, merged));
        const old = (await tx.client.query(`SELECT superseded_at, superseded_by_id, supersede_reason FROM cupping_scores WHERE id = $1`, [row])).rows[0];
        expect(old.superseded_at).not.toBeNull();
        expect(old.superseded_by_id).toBe(newId);
        expect(old.supersede_reason).toBe('test');
        await expect(tx.savepoint(() => tx.client.query(
          `UPDATE cupping_scores SET superseded_at = now(), supersede_reason = 'again' WHERE id = $1`, [row]
        ))).rejects.toMatchObject(IMMUTABLE);
      }
      const current = await tx.client.query(`SELECT count(*)::int n FROM cupping_scores WHERE session_coffee_id = $1 AND superseded_at IS NULL`, [f.scId]);
      expect(current.rows[0].n).toBe(2);
    });
  });

  it('a transition that also changes another column is rejected', async () => {
    await withRollback(async tx => {
      const f = await fixture(tx.client);
      await expect(tx.savepoint(() => tx.client.query(
        `UPDATE cupping_scores SET superseded_at = now(), superseded_by_id = $2, supersede_reason = 'x', overall_notes = 'sneaky' WHERE id = $1`,
        [f.cupperRow, f.mergedRow]
      ))).rejects.toMatchObject(IMMUTABLE);
      // and a half-transition (no reason) breaks the shape CHECK before the guard even runs
      await expect(tx.savepoint(() => tx.client.query(
        `UPDATE cupping_scores SET superseded_at = now() WHERE id = $1`, [f.cupperRow]
      ))).rejects.toThrow();
    });
  });

  it('RESTRICT: a session with coffees, and a coffee with evidence or an assignment, cannot be deleted', async () => {
    await withRollback(async tx => {
      const f = await fixture(tx.client);
      await expect(tx.savepoint(() => tx.client.query(`DELETE FROM cupping_sessions WHERE id = $1`, [f.sessionId]))).rejects.toMatchObject(RESTRICTED);
      await expect(tx.savepoint(() => tx.client.query(`DELETE FROM coffees WHERE id = $1`, [f.coffeeId]))).rejects.toMatchObject(RESTRICTED);

      const roaster = (await tx.client.query(`SELECT roaster_id FROM coffees WHERE id = $1`, [f.coffeeId])).rows[0].roaster_id;
      const bare = (await tx.client.query<{ id: number }>(`INSERT INTO coffees (name, roaster_id, is_active) VALUES ('Zzz Immutability Bare', $1, true) RETURNING id`, [roaster])).rows[0].id;
      await tx.client.query(`INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence, source) VALUES ($1, 'fruity', 'low', 'manual')`, [bare]);
      await expect(tx.savepoint(() => tx.client.query(`DELETE FROM coffees WHERE id = $1`, [bare]))).rejects.toMatchObject(RESTRICTED);

      const empty = (await tx.client.query<{ id: number }>(`INSERT INTO cupping_sessions (session_date, record_source) VALUES ('2026-10-18', 'test') RETURNING id`)).rows[0].id;
      await tx.savepoint(() => tx.client.query(`DELETE FROM cupping_sessions WHERE id = $1`, [empty]));
    });
  });

  it('brew params: editable while nothing is scored under the sample, immutable once a score exists', async () => {
    await withRollback(async tx => {
      const f = await fixture(tx.client);
      const fresh = (await tx.client.query<{ id: number }>(`INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`, [f.sessionId, f.coffeeId])).rows[0].id;
      await tx.client.query(`INSERT INTO cupping_brew_params (session_coffee_id, dose_grams, water_grams) VALUES ($1, 8.5, 150)`, [fresh]);
      await tx.savepoint(() => tx.client.query(`UPDATE cupping_brew_params SET water_grams = 160 WHERE session_coffee_id = $1`, [fresh]));
      await tx.client.query(`INSERT INTO cupping_brew_params (session_coffee_id, dose_grams) VALUES ($1, 8.5)`, [f.scId]);
      await expect(tx.savepoint(() => tx.client.query(`UPDATE cupping_brew_params SET dose_grams = 9 WHERE session_coffee_id = $1`, [f.scId]))).rejects.toMatchObject(IMMUTABLE);
      await expect(tx.savepoint(() => tx.client.query(`DELETE FROM cupping_brew_params WHERE session_coffee_id = $1`, [f.scId]))).rejects.toMatchObject(IMMUTABLE);
    });
  });

  it('the readable views hide superseded rows', async () => {
    await withRollback(async tx => {
      const f = await fixture(tx.client);
      await supersede(tx, f.mergedRow, f.scId, true);
      const merged = await tx.client.query(`SELECT DISTINCT score_id FROM v_cupping_scores_readable WHERE session_coffee_id = $1 AND is_merged`, [f.scId]);
      expect(merged.rows.map(r => r.score_id)).not.toContain(f.mergedRow);
      const wheel = await tx.client.query(`SELECT count(*)::int n FROM v_collaborative_flavor_wheel WHERE coffee_id = $1 AND source = 'internal'`, [f.coffeeId]);
      expect(wheel.rows[0].n).toBe(0); // the new merged row has no descriptor; the cupper row never shows
    });
  });
});
