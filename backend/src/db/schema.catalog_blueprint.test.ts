// Catalog Blueprint · brief 1 (2026-09-13). Requires DATABASE_URL pointed at a
// reachable Postgres instance with this brief's schema.sql block already
// applied (see backend/src/features/catalog_blueprint/
// CLAUDE_CODE_PROMPT_CATALOG_1_SCHEMA_VIEWS_INTEGRITY.md). Every fixture is
// prefixed `Vitest`, deleted in `finally` and in `afterAll` (dependency
// order: coffee_slot_assignment -> roaster_blend -> coffees -> roaster).
//
// Real prod data note (verified against the live DB before writing these
// tests): dial_slot_price already has admin-set rows for several slots,
// including floral/2 at 12oz/80oz — the v_coffee_sellable_slot fixture below
// reuses whatever price row already exists there instead of inserting a
// second one (which would violate dial_slot_price's own pre-existing UNIQUE
// (archetype, dial_sort_order, weight_oz)), and only deletes it in `finally`
// if this test run is the one that created it.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db, withTransaction } from './client.js';

afterAll(async () => {
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM dial_coffee_relationships WHERE from_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%') OR to_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_category_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM archetype_assignments WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM roaster_blend WHERE blend_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
});

describe('archetype identity (N2)', () => {
  it('code is populated for all six rows and unique', async () => {
    const { rows } = await db.query<{ name: string; code: string | null }>(`SELECT name, code FROM archetype`);
    expect(rows.length).toBe(6);
    for (const row of rows) expect(row.code, `${row.name} has no code`).not.toBeNull();
    const codes = rows.map(r => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('v_coffee_archetype returns 6 rows in sort_order 1-6', async () => {
    const { rows } = await db.query<{ code: string; sort_order: number }>(`SELECT code, sort_order FROM v_coffee_archetype ORDER BY sort_order`);
    expect(rows.length).toBe(6);
    expect(rows.map(r => r.sort_order)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('coffee_dial_slot', () => {
  it('has 24 rows', async () => {
    const { rows } = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM coffee_dial_slot`);
    expect(Number(rows[0].count)).toBe(24);
  });

  it('rejects a duplicate (archetype, sort_order)', async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(`INSERT INTO coffee_dial_slot (archetype, sort_order, name, position_label) VALUES ('floral', 2, 'Vitest Duplicate Slot', 'Vitest')`)
      ).rejects.toThrow(/duplicate key value violates unique constraint/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('rejects a second landing default on the same archetype', async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(`UPDATE coffee_dial_slot SET is_landing_default = true WHERE archetype = 'floral' AND sort_order = 1`)
      ).rejects.toThrow(/duplicate key value violates unique constraint "coffee_dial_slot_one_landing_default"/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('coffee_slot_assignment (D1/D5)', () => {
  async function makeVitestRoasterAndCoffees(count: number) {
    const roaster = (await db.query<{ id: string }>(
      `INSERT INTO roaster (name, is_active) VALUES ('Vitest CSA Roastery', true) RETURNING id`
    )).rows[0];
    const coffees: { id: number }[] = [];
    for (let i = 0; i < count; i++) {
      coffees.push((await db.query<{ id: number }>(
        `INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`,
        [`Vitest CSA Coffee ${i}`, roaster.id]
      )).rows[0]);
    }
    return { roaster, coffees };
  }
  async function cleanup(roaster: { id: string } | undefined, coffees: { id: number }[]) {
    const ids = coffees.map(c => c.id);
    if (ids.length) {
      await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id = ANY($1::int[])`, [ids]);
      await db.query(`DELETE FROM coffees WHERE id = ANY($1::int[])`, [ids]);
    }
    if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
  }
  async function slotId(archetype: string, sortOrder: number) {
    return (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [archetype, sortOrder])).rows[0].id;
  }

  it('rejects a second active home for the same coffee (across different slots)', async () => {
    let ctx: Awaited<ReturnType<typeof makeVitestRoasterAndCoffees>> | undefined;
    try {
      ctx = await makeVitestRoasterAndCoffees(1);
      const floral2 = await slotId('floral', 2);
      const fruity2 = await slotId('fruity', 2);
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role) VALUES ($1, $2, 'home')`, [floral2, ctx.coffees[0].id]);
      await expect(
        db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role) VALUES ($1, $2, 'home')`, [fruity2, ctx.coffees[0].id])
      ).rejects.toThrow(/duplicate key value violates unique constraint "coffee_slot_assignment_one_active_home"/);
    } finally {
      if (ctx) await cleanup(ctx.roaster, ctx.coffees);
    }
  });

  it('rejects the same (slot, coffee) twice', async () => {
    let ctx: Awaited<ReturnType<typeof makeVitestRoasterAndCoffees>> | undefined;
    try {
      ctx = await makeVitestRoasterAndCoffees(1);
      const floral1 = await slotId('floral', 1);
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role) VALUES ($1, $2, 'guest')`, [floral1, ctx.coffees[0].id]);
      await expect(
        db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role) VALUES ($1, $2, 'guest')`, [floral1, ctx.coffees[0].id])
      ).rejects.toThrow(/duplicate key value violates unique constraint "coffee_slot_assignment_slot_id_coffee_id_key"/);
    } finally {
      if (ctx) await cleanup(ctx.roaster, ctx.coffees);
    }
  });

  it('rejects two active rows at the same (slot, priority)', async () => {
    let ctx: Awaited<ReturnType<typeof makeVitestRoasterAndCoffees>> | undefined;
    try {
      ctx = await makeVitestRoasterAndCoffees(2);
      const earthy3 = await slotId('earthy', 3);
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role, priority) VALUES ($1, $2, 'guest', 1)`, [earthy3, ctx.coffees[0].id]);
      await expect(
        db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role, priority) VALUES ($1, $2, 'guest', 1)`, [earthy3, ctx.coffees[1].id])
      ).rejects.toThrow(/duplicate key value violates unique constraint "coffee_slot_assignment_one_active_per_priority"/);
    } finally {
      if (ctx) await cleanup(ctx.roaster, ctx.coffees);
    }
  });

  it('allows a guest row alongside a home row on the same slot', async () => {
    let ctx: Awaited<ReturnType<typeof makeVitestRoasterAndCoffees>> | undefined;
    try {
      ctx = await makeVitestRoasterAndCoffees(2);
      const earthy4 = await slotId('earthy', 4);
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role, priority) VALUES ($1, $2, 'home', 1)`, [earthy4, ctx.coffees[0].id]);
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role, priority) VALUES ($1, $2, 'guest', 2)`, [earthy4, ctx.coffees[1].id]);
      // coffee_slot_role_enum is declared ('home', 'guest') — Postgres enums sort
      // by declaration order, not alphabetically, so ORDER BY role gives 'home' first.
      const { rows } = await db.query(`SELECT role FROM coffee_slot_assignment WHERE slot_id = $1 AND coffee_id = ANY($2::int[]) ORDER BY role`, [earthy4, ctx.coffees.map(c => c.id)]);
      expect(rows.map(r => r.role)).toEqual(['home', 'guest']);
    } finally {
      if (ctx) await cleanup(ctx.roaster, ctx.coffees);
    }
  });
});

describe('archetype_assignments (Slot Truth Map F4)', () => {
  it('rejects a second row with superseded_at IS NULL for the same coffee', async () => {
    let roaster: { id: string } | undefined;
    let coffee: { id: number } | undefined;
    try {
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest AA Roastery', true) RETURNING id`)).rows[0];
      coffee = (await db.query<{ id: number }>(
        `INSERT INTO coffees (name, roaster_id, is_active) VALUES ('Vitest AA Coffee', $1, true) RETURNING id`,
        [roaster.id]
      )).rows[0];
      await db.query(`INSERT INTO archetype_assignments (coffee_id, archetype, confidence) VALUES ($1, 'floral', 'high')`, [coffee.id]);
      await expect(
        db.query(`INSERT INTO archetype_assignments (coffee_id, archetype, confidence) VALUES ($1, 'fruity', 'medium')`, [coffee.id])
      ).rejects.toThrow(/duplicate key value violates unique constraint "archetype_assignments_one_current"/);
    } finally {
      if (coffee) {
        await db.query(`DELETE FROM archetype_assignments WHERE coffee_id = $1`, [coffee.id]);
        await db.query(`DELETE FROM coffees WHERE id = $1`, [coffee.id]);
      }
      if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
    }
  });
});

describe('v_coffee_sellable_slot (D5)', () => {
  it('resolves the home coffee, drops on deactivated blend, falls to a guest, and excludes decaf', async () => {
    let roaster: { id: string } | undefined;
    let homeCoffee: { id: number } | undefined;
    let guestCoffee: { id: number } | undefined;
    let homeBlend: { id: string } | undefined;
    let guestBlend: { id: string } | undefined;
    let createdPriceRow = false;
    let slot: { id: number } | undefined;
    const slotArchetype = 'floral';
    const slotSortOrder = 2;
    try {
      slot = (await db.query<{ id: number }>(
        `SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [slotArchetype, slotSortOrder]
      )).rows[0];

      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Sellable Roastery', true) RETURNING id`)).rows[0];
      homeCoffee = (await db.query<{ id: number }>(
        `INSERT INTO coffees (name, roaster_id, is_active) VALUES ('Vitest Sellable Home Coffee', $1, true) RETURNING id`,
        [roaster.id]
      )).rows[0];
      await db.query(`INSERT INTO archetype_assignments (coffee_id, archetype, confidence) VALUES ($1, $2, 'high')`, [homeCoffee.id, slotArchetype]);
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role, priority) VALUES ($1, $2, 'home', 1)`, [slot.id, homeCoffee.id]);
      homeBlend = (await db.query<{ id: string }>(
        `INSERT INTO roaster_blend (roaster_id, coffee_id, blend_name, weight_oz, is_active) VALUES ($1, $2, 'Vitest Sellable Home Blend', 12, true) RETURNING id`,
        [roaster.id, homeCoffee.id]
      )).rows[0];

      // dial_slot_price already has real admin-set rows for many slots (verified
      // live before writing this test) — reuse whatever is there rather than
      // risk colliding with the UNIQUE (slot_id, weight_oz) constraint
      // (Catalog Blueprint brief 5a — slot_id is the only key now).
      const priceInsert = await db.query(
        `INSERT INTO dial_slot_price (slot_id, weight_oz, retail_price_cents)
         VALUES ($1, 12, 3200)
         ON CONFLICT (slot_id, weight_oz) DO NOTHING`,
        [slot.id]
      );
      createdPriceRow = (priceInsert.rowCount ?? 0) > 0;

      let sellable = await db.query<{ blend_id: string }>(
        `SELECT blend_id FROM v_coffee_sellable_slot WHERE slot_id = $1 AND weight_oz = 12`, [slot.id]
      );
      expect(sellable.rows.length).toBe(1);
      expect(sellable.rows[0].blend_id).toBe(homeBlend.id);

      // Deactivate the home blend -> no active 12oz SKU -> slot drops out entirely.
      await db.query(`UPDATE roaster_blend SET is_active = false WHERE id = $1`, [homeBlend.id]);
      sellable = await db.query(`SELECT blend_id FROM v_coffee_sellable_slot WHERE slot_id = $1 AND weight_oz = 12`, [slot.id]);
      expect(sellable.rows.length).toBe(0);

      // Add a guest with its own SKU, then deactivate the home coffee entirely -> guest resolves (D5).
      guestCoffee = (await db.query<{ id: number }>(
        `INSERT INTO coffees (name, roaster_id, is_active) VALUES ('Vitest Sellable Guest Coffee', $1, true) RETURNING id`,
        [roaster.id]
      )).rows[0];
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role, priority) VALUES ($1, $2, 'guest', 2)`, [slot.id, guestCoffee.id]);
      guestBlend = (await db.query<{ id: string }>(
        `INSERT INTO roaster_blend (roaster_id, coffee_id, blend_name, weight_oz, is_active) VALUES ($1, $2, 'Vitest Sellable Guest Blend', 12, true) RETURNING id`,
        [roaster.id, guestCoffee.id]
      )).rows[0];
      await db.query(`UPDATE coffees SET is_active = false WHERE id = $1`, [homeCoffee.id]);

      sellable = await db.query(`SELECT blend_id FROM v_coffee_sellable_slot WHERE slot_id = $1 AND weight_oz = 12`, [slot.id]);
      expect(sellable.rows.length).toBe(1);
      expect(sellable.rows[0].blend_id).toBe(guestBlend.id);

      // Tag the (now resolving) guest coffee decaf -> excluded, slot drops out again.
      const decafCategory = (await db.query<{ id: number }>(`SELECT id FROM coffee_category WHERE code = 'decaf'`)).rows[0];
      await db.query(`INSERT INTO coffee_category_assignment (coffee_id, category_id) VALUES ($1, $2)`, [guestCoffee.id, decafCategory.id]);
      sellable = await db.query(`SELECT blend_id FROM v_coffee_sellable_slot WHERE slot_id = $1 AND weight_oz = 12`, [slot.id]);
      expect(sellable.rows.length).toBe(0);
    } finally {
      const coffeeIds = [homeCoffee?.id, guestCoffee?.id].filter((id): id is number => id != null);
      if (coffeeIds.length) {
        await db.query(`DELETE FROM coffee_category_assignment WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
        await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
        await db.query(`DELETE FROM archetype_assignments WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
      }
      const blendIds = [homeBlend?.id, guestBlend?.id].filter((id): id is string => id != null);
      if (blendIds.length) await db.query(`DELETE FROM roaster_blend WHERE id = ANY($1::uuid[])`, [blendIds]);
      if (coffeeIds.length) await db.query(`DELETE FROM coffees WHERE id = ANY($1::int[])`, [coffeeIds]);
      if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
      if (createdPriceRow && slot) await db.query(`DELETE FROM dial_slot_price WHERE slot_id = $1 AND weight_oz = 12`, [slot.id]);
    }
  });
});

describe('v_coffee_hop (D3)', () => {
  it('derives bridge_archetype across two archetypes, within_archetype once homes match', async () => {
    let roaster: { id: string } | undefined;
    let coffeeA: { id: number } | undefined;
    let coffeeB: { id: number } | undefined;
    let hop: { id: number } | undefined;
    try {
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Hop Roastery', true) RETURNING id`)).rows[0];
      coffeeA = (await db.query<{ id: number }>(
        `INSERT INTO coffees (name, roaster_id, is_active) VALUES ('Vitest Hop Coffee A', $1, true) RETURNING id`,
        [roaster.id]
      )).rows[0];
      coffeeB = (await db.query<{ id: number }>(
        `INSERT INTO coffees (name, roaster_id, is_active) VALUES ('Vitest Hop Coffee B', $1, true) RETURNING id`,
        [roaster.id]
      )).rows[0];

      const floral2 = (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = 'floral' AND sort_order = 2`)).rows[0];
      const fruity3 = (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = 'fruity' AND sort_order = 3`)).rows[0];
      const floral1 = (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = 'floral' AND sort_order = 1`)).rows[0];

      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role) VALUES ($1, $2, 'home')`, [floral2.id, coffeeA.id]);
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role) VALUES ($1, $2, 'home')`, [fruity3.id, coffeeB.id]);

      hop = (await db.query<{ id: number }>(
        `INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction)
         VALUES ($1, $2, 9, 'more') RETURNING id`,
        [coffeeA.id, coffeeB.id]
      )).rows[0];

      let derived = (await db.query<{ hop_type_derived: string }>(`SELECT hop_type_derived FROM v_coffee_hop WHERE id = $1`, [hop.id])).rows[0];
      expect(derived.hop_type_derived).toBe('bridge_archetype');

      // Move coffee B's home onto floral too (deactivate old, insert new) -> both match.
      await db.query(`UPDATE coffee_slot_assignment SET is_active = false WHERE slot_id = $1 AND coffee_id = $2`, [fruity3.id, coffeeB.id]);
      await db.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role) VALUES ($1, $2, 'home')`, [floral1.id, coffeeB.id]);

      derived = (await db.query<{ hop_type_derived: string }>(`SELECT hop_type_derived FROM v_coffee_hop WHERE id = $1`, [hop.id])).rows[0];
      expect(derived.hop_type_derived).toBe('within_archetype');
    } finally {
      if (hop) await db.query(`DELETE FROM dial_coffee_relationships WHERE id = $1`, [hop.id]);
      const coffeeIds = [coffeeA?.id, coffeeB?.id].filter((id): id is number => id != null);
      if (coffeeIds.length) {
        await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
        await db.query(`DELETE FROM coffees WHERE id = ANY($1::int[])`, [coffeeIds]);
      }
      if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
    }
  });
});

describe('withTransaction (Part A — see also client.test.ts)', () => {
  it('rolls back on throw', async () => {
    const name = 'Vitest Schema Test Rollback Roastery';
    await expect(
      withTransaction(async (tx) => {
        await tx.query(`INSERT INTO roaster (name, is_active) VALUES ($1, true)`, [name]);
        throw new Error('Vitest deliberate rollback');
      })
    ).rejects.toThrow('Vitest deliberate rollback');
    const { rows } = await db.query(`SELECT id FROM roaster WHERE name = $1`, [name]);
    expect(rows.length).toBe(0);
  });
});

describe('Catalog Blueprint brief 5a — legacy dropped', () => {
  const LEGACY_OBJECTS = [
    'dial_archetype_positions', 'coffee_alias', 'dial_slot_alias',
    'dial_position_vocabulary', 'dial_archetype_config', 'v_dial_positions', 'v_dial_navigation',
  ];

  it('none of the seven legacy placement objects exist', async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass('public.' || name) IS NOT NULL`,
      [LEGACY_OBJECTS]
    );
    expect(rows).toEqual([]);
  });

  it('coffees.roaster column does not exist', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'coffees' AND column_name = 'roaster'`
    );
    expect(rows.length).toBe(0);
  });

  it('coffees.roaster_id NOT NULL rejects an insert without it', async () => {
    await expect(
      db.query(`INSERT INTO coffees (name, is_active) VALUES ('Vitest No Roaster Coffee', true)`)
    ).rejects.toThrow(/null value in column "roaster_id"/);
  });

  it('dial_position_signal.suggested_slot_id is populated for every pre-existing row that had a suggestion', async () => {
    // suggested_vocabulary_id no longer exists (re-keyed to suggested_slot_id
    // by A1) — a row that once had a suggestion is one with raw_value set
    // (recordCuppingSignal always writes both together).
    const { rows } = await db.query(
      `SELECT COUNT(*) AS count FROM dial_position_signal WHERE raw_value IS NOT NULL AND suggested_slot_id IS NULL`
    );
    expect(Number(rows[0].count)).toBe(0);
  });
});
