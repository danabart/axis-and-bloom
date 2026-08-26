// Roastery lifecycle (2026-08-25) — resolveBlendForSlot must trust neither
// coffees.is_active nor roaster_blend.is_active alone; the deactivation
// cascade keeps them in sync, but the resolver itself checks both
// independently by design (see services/activeCatalog.ts's header comment).
//
// Requires DATABASE_URL pointed at a reachable Postgres instance with the
// roastery-lifecycle schema applied. Uses weight_oz = 13 — a value no real
// seeded roaster_blend row ever uses (12/80 only) — so the fixture blend is
// the ONLY candidate resolveBlendForSlot can find at that weight, regardless
// of what else occupies the real slot at 12oz/80oz. Everything created here
// is deleted in a finally block; a real archetype/dial_sort_order pair is
// read (never written) to stay a valid archetype_enum value.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { resolveBlendForSlot, resolveCoffeeBlend } from './blendResolver.js';

const FIXTURE_WEIGHT_OZ = 13;

// 2026-08-26 hardening round — the real safety net for a fixture whose
// creation itself fails partway (the per-test try/finally below can't reach
// it, since the fixture variable was never assigned in that case).
afterAll(async () => {
  await db.query(`DELETE FROM coffee_alias WHERE platform_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster_blend WHERE blend_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
});

async function makeSlotFixture() {
  const slot = (await db.query(
    `SELECT archetype, sort_order FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' ORDER BY sort_order LIMIT 1`
  )).rows[0];
  const coffee = (await db.query(
    `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest Slot Coffee', 'Vitest Roastery', true) RETURNING id`
  )).rows[0];
  const alias = (await db.query(
    `INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
     VALUES ('Vitest Slot Alias', $1, $2, $3, 1, true) RETURNING id`,
    [slot.archetype, slot.sort_order, coffee.id]
  )).rows[0];
  const blend = (await db.query(
    `INSERT INTO roaster_blend (blend_name, coffee_id, weight_oz, is_active) VALUES ('Vitest Slot Blend', $1, $2, true) RETURNING id`,
    [coffee.id, FIXTURE_WEIGHT_OZ]
  )).rows[0];
  return { archetype: slot.archetype, sortOrder: slot.sort_order, coffee, alias, blend };
}

type SlotFixture = Awaited<ReturnType<typeof makeSlotFixture>>;

async function cleanupSlotFixture(fixture: SlotFixture) {
  await db.query('DELETE FROM roaster_blend WHERE id = $1', [fixture.blend.id]);
  await db.query('DELETE FROM coffee_alias WHERE id = $1', [fixture.alias.id]);
  await db.query('DELETE FROM coffees WHERE id = $1', [fixture.coffee.id]);
}

describe('resolveBlendForSlot — coffees.is_active', () => {
  it('resolves the fixture coffee while active, and skips it once inactive even though its roaster_blend row stays active', async () => {
    let fixture: SlotFixture | undefined;
    try {
      fixture = await makeSlotFixture();
      const whileActive = await resolveBlendForSlot(fixture.archetype, fixture.sortOrder, FIXTURE_WEIGHT_OZ);
      expect(whileActive?.coffee_id).toBe(fixture.coffee.id);

      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [fixture.coffee.id]);
      const stillActiveBlend = await db.query('SELECT is_active FROM roaster_blend WHERE id = $1', [fixture.blend.id]);
      expect(stillActiveBlend.rows[0].is_active).toBe(true); // the blend itself was never touched

      const whileInactive = await resolveBlendForSlot(fixture.archetype, fixture.sortOrder, FIXTURE_WEIGHT_OZ);
      expect(whileInactive).toBeNull();
    } finally {
      if (fixture) {
        await db.query('UPDATE coffees SET is_active = true WHERE id = $1', [fixture.coffee.id]);
        await cleanupSlotFixture(fixture);
      }
    }
  });

  it('excludeCoffeeIds simulates a roastery going away without writing anything', async () => {
    let fixture: SlotFixture | undefined;
    try {
      fixture = await makeSlotFixture();
      const excluded = await resolveBlendForSlot(fixture.archetype, fixture.sortOrder, FIXTURE_WEIGHT_OZ, { excludeCoffeeIds: [fixture.coffee.id] });
      expect(excluded).toBeNull();

      const stillActive = await db.query('SELECT is_active FROM coffees WHERE id = $1', [fixture.coffee.id]);
      expect(stillActive.rows[0].is_active).toBe(true); // excludeCoffeeIds never writes
    } finally { if (fixture) await cleanupSlotFixture(fixture); }
  });
});

describe('resolveCoffeeBlend — coffees.is_active', () => {
  it('returns null once the coffee is inactive, even with an active roaster_blend row', async () => {
    let coffee: { id: number } | undefined;
    let blend: { id: string } | undefined;
    try {
      coffee = (await db.query(
        `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest Category Coffee', 'Vitest Roastery', true) RETURNING id`
      )).rows[0];
      blend = (await db.query(
        `INSERT INTO roaster_blend (blend_name, coffee_id, weight_oz, is_active) VALUES ('Vitest Category Blend', $1, $2, true) RETURNING id`,
        [coffee!.id, FIXTURE_WEIGHT_OZ]
      )).rows[0];

      const whileActive = await resolveCoffeeBlend(coffee!.id, FIXTURE_WEIGHT_OZ);
      expect(whileActive?.blend_id).toBe(blend!.id);

      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [coffee!.id]);
      const whileInactive = await resolveCoffeeBlend(coffee!.id, FIXTURE_WEIGHT_OZ);
      expect(whileInactive).toBeNull();
    } finally {
      if (blend) await db.query('DELETE FROM roaster_blend WHERE id = $1', [blend.id]);
      if (coffee) await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  });
});
