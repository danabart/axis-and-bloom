// Roastery lifecycle — CTO review round (2026-08-26). Coverage for the two
// schema-level fixes: the coffees_active_natural_key partial unique index,
// and the tightened roaster_blend.coffee_id name-match backfill (now also
// requires rb.roaster_id = c.roaster_id) — the exact bug class that landed
// Temecula's two Colombia blend rows on Path's Colombia coffee in prod (see
// backend/src/db/migrations/coffees_colombia_guatemala_datafix_2026_08_26.sql).
//
// Requires DATABASE_URL pointed at a reachable Postgres instance with the
// roastery-lifecycle schema applied (coffees_active_natural_key must already
// exist — it won't until the pending data-fix migration has run, since a
// live duplicate blocks its creation; see schema.sql's own comment). Every
// fixture is disposable, deleted in a finally block.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from './client.js';

// 2026-08-26 hardening round — the real safety net for a fixture whose
// creation itself fails partway (every test below creates 2+ rows before
// its try/finally can reach any of them).
afterAll(async () => {
  await db.query(`DELETE FROM coffee_alias WHERE platform_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster_blend WHERE blend_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
});

describe('coffees_active_natural_key', () => {
  it('rejects two active coffees with the same (roaster_id, name), case/whitespace-insensitive', async () => {
    let roaster: { id: string } | undefined;
    let first: { id: number } | undefined;
    try {
      roaster = (await db.query(
        `INSERT INTO roaster (name, is_active) VALUES ('Vitest Natural Key Roastery', true) RETURNING id`
      )).rows[0];
      first = (await db.query(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Duplicate', 'Vitest Natural Key Roastery', $1, true) RETURNING id`,
        [roaster!.id]
      )).rows[0];

      await expect(
        db.query(
          `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('  vitest duplicate  ', 'Vitest Natural Key Roastery', $1, true)`,
          [roaster!.id]
        )
      ).rejects.toThrow(/duplicate key value violates unique constraint "coffees_active_natural_key"/);
    } finally {
      if (first) await db.query('DELETE FROM coffees WHERE id = $1', [first.id]);
      if (roaster) await db.query('DELETE FROM roaster WHERE id = $1', [roaster.id]);
    }
  });

  it('allows the same name twice when one of the two is inactive', async () => {
    let roaster: { id: string } | undefined;
    let active: { id: number } | undefined;
    let inactive: { id: number } | undefined;
    try {
      roaster = (await db.query(
        `INSERT INTO roaster (name, is_active) VALUES ('Vitest Natural Key Roastery 2', true) RETURNING id`
      )).rows[0];
      active = (await db.query(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Same Name', 'Vitest Natural Key Roastery 2', $1, true) RETURNING id`,
        [roaster!.id]
      )).rows[0];
      inactive = (await db.query(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active, deactivation_reason, deactivated_at)
         VALUES ('Vitest Same Name', 'Vitest Natural Key Roastery 2', $1, false, 'manual', now()) RETURNING id`,
        [roaster!.id]
      )).rows[0];

      expect(active!.id).not.toBe(inactive!.id); // both inserts succeeded — no violation
    } finally {
      const ids = [active?.id, inactive?.id].filter((id): id is number => id != null);
      if (ids.length) await db.query('DELETE FROM coffees WHERE id = ANY($1::int[])', [ids]);
      if (roaster) await db.query('DELETE FROM roaster WHERE id = $1', [roaster.id]);
    }
  });

  it('allows the same name across two different roasters', async () => {
    let roasterA: { id: string } | undefined;
    let roasterB: { id: string } | undefined;
    let coffeeA: { id: number } | undefined;
    let coffeeB: { id: number } | undefined;
    try {
      roasterA = (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Roastery A', true) RETURNING id`)).rows[0];
      roasterB = (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Roastery B', true) RETURNING id`)).rows[0];
      coffeeA = (await db.query(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Shared Name', 'Vitest Roastery A', $1, true) RETURNING id`,
        [roasterA!.id]
      )).rows[0];
      coffeeB = (await db.query(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Shared Name', 'Vitest Roastery B', $1, true) RETURNING id`,
        [roasterB!.id]
      )).rows[0];

      expect(coffeeA!.id).not.toBe(coffeeB!.id);
    } finally {
      const coffeeIds = [coffeeA?.id, coffeeB?.id].filter((id): id is number => id != null);
      if (coffeeIds.length) await db.query('DELETE FROM coffees WHERE id = ANY($1::int[])', [coffeeIds]);
      const roasterIds = [roasterA?.id, roasterB?.id].filter((id): id is string => id != null);
      if (roasterIds.length) await db.query('DELETE FROM roaster WHERE id = ANY($1::uuid[])', [roasterIds]);
    }
  });
});

describe('roaster_blend.coffee_id name-match backfill — tightened to require matching roaster_id', () => {
  it('matches each blend to the coffee from its OWN roaster, not an arbitrary same-named one', async () => {
    let roasterA: { id: string } | undefined;
    let roasterB: { id: string } | undefined;
    let coffeeA: { id: number } | undefined;
    let coffeeB: { id: number } | undefined;
    let blendA: { id: string } | undefined;
    let blendB: { id: string } | undefined;
    try {
      // Reproduces the exact real-world shape: two coffees named identically,
      // one per roaster, and one unmatched blend row per roaster for that name.
      roasterA = (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Backfill Roastery A', true) RETURNING id`)).rows[0];
      roasterB = (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Backfill Roastery B', true) RETURNING id`)).rows[0];
      coffeeA = (await db.query(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Backfill Coffee', 'Vitest Backfill Roastery A', $1, true) RETURNING id`,
        [roasterA!.id]
      )).rows[0];
      coffeeB = (await db.query(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Backfill Coffee', 'Vitest Backfill Roastery B', $1, true) RETURNING id`,
        [roasterB!.id]
      )).rows[0];
      blendA = (await db.query(
        `INSERT INTO roaster_blend (roaster_id, blend_name, weight_oz, is_active) VALUES ($1, 'Vitest Backfill Coffee', 12, true) RETURNING id`,
        [roasterA!.id]
      )).rows[0];
      blendB = (await db.query(
        `INSERT INTO roaster_blend (roaster_id, blend_name, weight_oz, is_active) VALUES ($1, 'Vitest Backfill Coffee', 12, true) RETURNING id`,
        [roasterB!.id]
      )).rows[0];

      // The exact tightened statement from schema.sql (~L404-419).
      await db.query(`
        UPDATE roaster_blend rb
        SET coffee_id = c.id
        FROM coffees c
        WHERE rb.coffee_id IS NULL
          AND lower(trim(rb.blend_name)) = lower(trim(c.name))
          AND rb.roaster_id = c.roaster_id
          AND rb.id = ANY($1::uuid[])
      `, [[blendA!.id, blendB!.id]]);

      const linked = (await db.query(
        `SELECT id, coffee_id FROM roaster_blend WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[blendA!.id, blendB!.id]]
      )).rows;
      const blendARow = linked.find(r => r.id === blendA!.id);
      const blendBRow = linked.find(r => r.id === blendB!.id);
      expect(blendARow.coffee_id).toBe(coffeeA!.id);
      expect(blendBRow.coffee_id).toBe(coffeeB!.id);
    } finally {
      const blendIds = [blendA?.id, blendB?.id].filter((id): id is string => id != null);
      if (blendIds.length) await db.query('DELETE FROM roaster_blend WHERE id = ANY($1::uuid[])', [blendIds]);
      const coffeeIds = [coffeeA?.id, coffeeB?.id].filter((id): id is number => id != null);
      if (coffeeIds.length) await db.query('DELETE FROM coffees WHERE id = ANY($1::int[])', [coffeeIds]);
      const roasterIds = [roasterA?.id, roasterB?.id].filter((id): id is string => id != null);
      if (roasterIds.length) await db.query('DELETE FROM roaster WHERE id = ANY($1::uuid[])', [roasterIds]);
    }
  });
});
