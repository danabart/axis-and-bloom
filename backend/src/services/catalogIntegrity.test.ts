// Catalog Blueprint · brief 1 (2026-09-13), check 10 rescoped in the CTO
// review round (2026-09-13). Requires DATABASE_URL, same convention as
// schema.catalog_blueprint.test.ts. dial_coffee_relationships holds 48
// historical hop rows from before both roasteries were deactivated (N3 — no
// backfill touches that table) — all 48 are between inactive coffees, so
// check 10 (now scoped to hops between active coffees only) correctly
// ignores every one of them as inert history, not stale hops. This suite
// only asserts what brief 1's own fixtures must produce, not that every one
// of 1-6/10-12 is currently green in prod.
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../db/client.js';
import { runCatalogIntegrityChecks } from './catalogIntegrity.js';

describe('runCatalogIntegrityChecks', () => {
  it('checks 1, 2, 3 pass against the seeded DB', async () => {
    const report = await runCatalogIntegrityChecks();
    for (const id of [1, 2, 3]) {
      const check = report.checks.find(c => c.id === id)!;
      expect(check.pass, `check ${id} (${check.name}): ${check.actual}`).toBe(true);
    }
  });

  it('check 4 fails, naming the coffee id, when an assigned coffee is deactivated out from under its active assignment', async () => {
    let roaster: { id: string } | undefined;
    let coffee: { id: number } | undefined;
    try {
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Integrity Roastery', true) RETURNING id`)).rows[0];
      coffee = (await db.query<{ id: number }>(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Integrity Coffee', 'Vitest Integrity Roastery', $1, true) RETURNING id`,
        [roaster!.id]
      )).rows[0];
      const slot = (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = 'earthy' AND sort_order = 1`)).rows[0];
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role) VALUES ($1, $2, 'home')`, [slot.id, coffee!.id]);

      // Violate check 4 directly: deactivate the coffee while its assignment stays active.
      // (Check 5's "two homes" scenario is impossible now — the DB constraint
      // added in this brief already rejects it, per schema.catalog_blueprint.test.ts.)
      await db.query(`UPDATE coffees SET is_active = false WHERE id = $1`, [coffee!.id]);

      const report = await runCatalogIntegrityChecks();
      const check4 = report.checks.find(c => c.id === 4)!;
      expect(check4.pass).toBe(false);
      expect(check4.details?.some(d => d.includes(`coffee ${coffee!.id}`))).toBe(true);
    } finally {
      if (coffee) {
        await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id = $1`, [coffee.id]);
        await db.query(`DELETE FROM coffees WHERE id = $1`, [coffee.id]);
      }
      if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
    }
  });

  it('check 10 ignores a hop between two inactive coffees (inert history, not a stale hop)', async () => {
    let roaster: { id: string } | undefined;
    let coffeeA: { id: number } | undefined;
    let coffeeB: { id: number } | undefined;
    let hop: { id: number } | undefined;
    try {
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Check10 Roastery', false) RETURNING id`)).rows[0];
      coffeeA = (await db.query<{ id: number }>(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Check10 Coffee A', 'Vitest Check10 Roastery', $1, false) RETURNING id`,
        [roaster!.id]
      )).rows[0];
      coffeeB = (await db.query<{ id: number }>(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Check10 Coffee B', 'Vitest Check10 Roastery', $1, false) RETURNING id`,
        [roaster!.id]
      )).rows[0];
      // Neither coffee has any coffee_slot_assignment (no home), so if check
      // 10 evaluated this hop it would look "stale" (from_slot_id/to_slot_id
      // both NULL) — it must not, since both endpoints are inactive.
      hop = (await db.query<{ id: number }>(
        `INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type)
         VALUES ($1, $2, 9, 'more', 'bridge_archetype') RETURNING id`,
        [coffeeA!.id, coffeeB!.id]
      )).rows[0];

      const report = await runCatalogIntegrityChecks();
      const check10 = report.checks.find(c => c.id === 10)!;
      expect(check10.details?.some(d => d.includes(`hop ${hop!.id}`))).toBeFalsy();
    } finally {
      if (hop) await db.query(`DELETE FROM dial_coffee_relationships WHERE id = $1`, [hop.id]);
      const coffeeIds = [coffeeA?.id, coffeeB?.id].filter((id): id is number => id != null);
      if (coffeeIds.length) await db.query(`DELETE FROM coffees WHERE id = ANY($1::int[])`, [coffeeIds]);
      if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
    }
  });
});
