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
import { describe, it, expect } from 'vitest';
import { db } from './client.js';

describe('coffees_active_natural_key', () => {
  it('rejects two active coffees with the same (roaster_id, name), case/whitespace-insensitive', async () => {
    const roaster = (await db.query(
      `INSERT INTO roaster (name, is_active) VALUES ('Vitest Natural Key Roastery', true) RETURNING id`
    )).rows[0];
    const first = (await db.query(
      `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Duplicate', 'Vitest Natural Key Roastery', $1, true) RETURNING id`,
      [roaster.id]
    )).rows[0];
    try {
      await expect(
        db.query(
          `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('  vitest duplicate  ', 'Vitest Natural Key Roastery', $1, true)`,
          [roaster.id]
        )
      ).rejects.toThrow(/duplicate key value violates unique constraint "coffees_active_natural_key"/);
    } finally {
      await db.query('DELETE FROM coffees WHERE id = $1', [first.id]);
      await db.query('DELETE FROM roaster WHERE id = $1', [roaster.id]);
    }
  });

  it('allows the same name twice when one of the two is inactive', async () => {
    const roaster = (await db.query(
      `INSERT INTO roaster (name, is_active) VALUES ('Vitest Natural Key Roastery 2', true) RETURNING id`
    )).rows[0];
    const active = (await db.query(
      `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Same Name', 'Vitest Natural Key Roastery 2', $1, true) RETURNING id`,
      [roaster.id]
    )).rows[0];
    const inactive = (await db.query(
      `INSERT INTO coffees (name, roaster, roaster_id, is_active, deactivation_reason, deactivated_at)
       VALUES ('Vitest Same Name', 'Vitest Natural Key Roastery 2', $1, false, 'manual', now()) RETURNING id`,
      [roaster.id]
    )).rows[0];
    try {
      expect(active.id).not.toBe(inactive.id); // both inserts succeeded — no violation
    } finally {
      await db.query('DELETE FROM coffees WHERE id = ANY($1::int[])', [[active.id, inactive.id]]);
      await db.query('DELETE FROM roaster WHERE id = $1', [roaster.id]);
    }
  });

  it('allows the same name across two different roasters', async () => {
    const roasterA = (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Roastery A', true) RETURNING id`)).rows[0];
    const roasterB = (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Roastery B', true) RETURNING id`)).rows[0];
    const coffeeA = (await db.query(
      `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Shared Name', 'Vitest Roastery A', $1, true) RETURNING id`,
      [roasterA.id]
    )).rows[0];
    const coffeeB = (await db.query(
      `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Shared Name', 'Vitest Roastery B', $1, true) RETURNING id`,
      [roasterB.id]
    )).rows[0];
    try {
      expect(coffeeA.id).not.toBe(coffeeB.id);
    } finally {
      await db.query('DELETE FROM coffees WHERE id = ANY($1::int[])', [[coffeeA.id, coffeeB.id]]);
      await db.query('DELETE FROM roaster WHERE id = ANY($1::uuid[])', [[roasterA.id, roasterB.id]]);
    }
  });
});

describe('roaster_blend.coffee_id name-match backfill — tightened to require matching roaster_id', () => {
  it('matches each blend to the coffee from its OWN roaster, not an arbitrary same-named one', async () => {
    // Reproduces the exact real-world shape: two coffees named identically,
    // one per roaster, and one unmatched blend row per roaster for that name.
    const roasterA = (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Backfill Roastery A', true) RETURNING id`)).rows[0];
    const roasterB = (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Backfill Roastery B', true) RETURNING id`)).rows[0];
    const coffeeA = (await db.query(
      `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Backfill Coffee', 'Vitest Backfill Roastery A', $1, true) RETURNING id`,
      [roasterA.id]
    )).rows[0];
    const coffeeB = (await db.query(
      `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Backfill Coffee', 'Vitest Backfill Roastery B', $1, true) RETURNING id`,
      [roasterB.id]
    )).rows[0];
    const blendA = (await db.query(
      `INSERT INTO roaster_blend (roaster_id, blend_name, weight_oz, is_active) VALUES ($1, 'Vitest Backfill Coffee', 12, true) RETURNING id`,
      [roasterA.id]
    )).rows[0];
    const blendB = (await db.query(
      `INSERT INTO roaster_blend (roaster_id, blend_name, weight_oz, is_active) VALUES ($1, 'Vitest Backfill Coffee', 12, true) RETURNING id`,
      [roasterB.id]
    )).rows[0];
    try {
      // The exact tightened statement from schema.sql (~L404-419).
      await db.query(`
        UPDATE roaster_blend rb
        SET coffee_id = c.id
        FROM coffees c
        WHERE rb.coffee_id IS NULL
          AND lower(trim(rb.blend_name)) = lower(trim(c.name))
          AND rb.roaster_id = c.roaster_id
          AND rb.id = ANY($1::uuid[])
      `, [[blendA.id, blendB.id]]);

      const linked = (await db.query(
        `SELECT id, coffee_id FROM roaster_blend WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[blendA.id, blendB.id]]
      )).rows;
      const blendARow = linked.find(r => r.id === blendA.id);
      const blendBRow = linked.find(r => r.id === blendB.id);
      expect(blendARow.coffee_id).toBe(coffeeA.id);
      expect(blendBRow.coffee_id).toBe(coffeeB.id);
    } finally {
      await db.query('DELETE FROM roaster_blend WHERE id = ANY($1::uuid[])', [[blendA.id, blendB.id]]);
      await db.query('DELETE FROM coffees WHERE id = ANY($1::int[])', [[coffeeA.id, coffeeB.id]]);
      await db.query('DELETE FROM roaster WHERE id = ANY($1::uuid[])', [[roasterA.id, roasterB.id]]);
    }
  });
});
