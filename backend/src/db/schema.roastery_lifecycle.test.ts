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
  // coffee_alias's own cleanup line was dropped along with the table
  // (Catalog Blueprint brief 5a).
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
        `INSERT INTO coffees (name, roaster_id, is_active)
         VALUES ('Vitest Duplicate', $1, true) RETURNING id`,
        [roaster!.id]
      )).rows[0];

      await expect(
        db.query(
          `INSERT INTO coffees (name, roaster_id, is_active)
         VALUES ('  vitest duplicate  ', $1, true)`,
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
        `INSERT INTO coffees (name, roaster_id, is_active)
         VALUES ('Vitest Same Name', $1, true) RETURNING id`,
        [roaster!.id]
      )).rows[0];
      inactive = (await db.query(
        `INSERT INTO coffees (name, roaster_id, is_active, deactivation_reason, deactivated_at)
         VALUES ('Vitest Same Name', $1, false, 'manual', now()) RETURNING id`,
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
        `INSERT INTO coffees (name, roaster_id, is_active)
         VALUES ('Vitest Shared Name', $1, true) RETURNING id`,
        [roasterA!.id]
      )).rows[0];
      coffeeB = (await db.query(
        `INSERT INTO coffees (name, roaster_id, is_active)
         VALUES ('Vitest Shared Name', $1, true) RETURNING id`,
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

describe('roaster_blend.coffee_id — NOT NULL supersedes the name-match backfill', () => {
  // The tightened backfill this describe block used to exercise (matching
  // rb.coffee_id by (blend_name, roaster_id) for rows where it was NULL) is
  // still in schema.sql for the one-time transition of legacy data, but
  // Catalog Blueprint brief 5a made roaster_blend.coffee_id NOT NULL — no
  // roaster_blend row can be constructed with coffee_id NULL anymore, on
  // this table or any future one, so that backfill's WHERE rb.coffee_id IS
  // NULL clause can never match again. NOT NULL is a strictly stronger
  // guarantee against the original bug class (Temecula's two Colombia blend
  // rows landing on Path's Colombia coffee, 2026-08-26) than the backfill's
  // own join ever was: it doesn't just match correctly, it makes the
  // unmatched state impossible to create in the first place. Coverage
  // updated to assert that invariant directly instead of a JOIN that can no
  // longer run.
  it('rejects a roaster_blend row with no coffee_id', async () => {
    let roaster: { id: string } | undefined;
    try {
      roaster = (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Backfill Roastery A', true) RETURNING id`)).rows[0];
      await expect(db.query(
        `INSERT INTO roaster_blend (roaster_id, blend_name, weight_oz, is_active) VALUES ($1, 'Vitest Backfill Coffee', 12, true)`,
        [roaster!.id]
      )).rejects.toThrow(/null value in column "coffee_id"/);
    } finally {
      const roasterIds = [roaster?.id].filter((id): id is string => id != null);
      if (roasterIds.length) await db.query('DELETE FROM roaster WHERE id = ANY($1::uuid[])', [roasterIds]);
    }
  });
});
