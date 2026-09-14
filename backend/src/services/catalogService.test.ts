// Catalog Blueprint · brief 2 (2026-09-14). Requires DATABASE_URL, same
// convention as brief 1's schema.catalog_blueprint.test.ts. Every fixture is
// prefixed `Vitest`, deleted in `finally` and in `afterAll` (dependency
// order: coffee_slot_assignment -> dial_coffee_relationships ->
// coffee_category_assignment -> archetype_assignments -> roaster_blend ->
// coffees -> roaster). Slot-level properties (spec_band_lo/hi,
// spec_descriptor_families) touched by the D6 tests are real, shared rows —
// captured and restored to their original value in `finally`, never just
// deleted.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import {
  CatalogError, createCoffee, placeCoffee, moveCoffee, addGuest, setPriority, setMatchArchetype,
  retireCoffee, restoreCoffee, deactivateRoastery, reactivateRoastery, setHop, upsertSku, setSlotPrice,
} from './catalogService.js';

afterAll(async () => {
  await db.query(`DELETE FROM dial_coffee_relationships WHERE from_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%') OR to_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM roastery_coffee_descriptors WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM archetype_assignments WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM roaster_blend WHERE blend_name LIKE 'Vitest%' OR coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
  // Cupping fixtures for the D6 band test (dependency order: values -> scores -> session_coffees -> sessions).
  await db.query(`DELETE FROM cupping_score_values WHERE cupping_score_id IN (SELECT id FROM cupping_scores WHERE taster_name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM cupping_scores WHERE taster_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM cupping_session_coffees WHERE session_id IN (SELECT id FROM cupping_sessions WHERE location LIKE 'Vitest%')`);
  await db.query(`DELETE FROM cupping_sessions WHERE location LIKE 'Vitest%'`);
});

const ACTOR = { actor: 'vitest' };

async function makeRoaster(name: string) {
  return (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [name])).rows[0];
}
async function makeCoffee(name: string, roasterId: string) {
  return (await db.query<{ id: number }>(
    `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
    [name, name, roasterId]
  )).rows[0];
}
async function slotId(archetype: string, sortOrder: number): Promise<number> {
  return (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [archetype, sortOrder])).rows[0].id;
}
async function cleanupRoasterAndCoffees(roaster: { id: string } | undefined, coffeeIds: number[]) {
  if (coffeeIds.length) {
    await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM archetype_assignments WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM roaster_blend WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM coffees WHERE id = ANY($1::int[])`, [coffeeIds]);
  }
  if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
}

describe('createCoffee', () => {
  it('sets roaster_id and the text roaster column', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest CS Roastery');
      const { result } = await createCoffee({ roasterId: roaster.id, name: 'Vitest CS Coffee' }, ACTOR);
      coffeeId = result.coffeeId;
      const row = (await db.query<{ roaster_id: string; roaster: string }>(`SELECT roaster_id, roaster FROM coffees WHERE id = $1`, [coffeeId])).rows[0];
      expect(row.roaster_id).toBe(roaster.id);
      expect(row.roaster).toBe('Vitest CS Roastery');
    } finally {
      await cleanupRoasterAndCoffees(roaster, coffeeId ? [coffeeId] : []);
    }
  });

  it('rejects an inactive roaster with ROASTER_NOT_FOUND-adjacent 409', async () => {
    let roaster: { id: string } | undefined;
    try {
      roaster = await makeRoaster('Vitest CS Inactive Roastery');
      await db.query(`UPDATE roaster SET is_active = false WHERE id = $1`, [roaster.id]);
      await expect(createCoffee({ roasterId: roaster.id, name: 'Vitest CS Coffee 2' }, ACTOR)).rejects.toMatchObject({ status: 409, code: 'ROASTER_STATE' });
    } finally {
      await cleanupRoasterAndCoffees(roaster, []);
    }
  });

  it('rejects a duplicate active name for the same roaster with 409', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest CS Dupe Roastery');
      const { result } = await createCoffee({ roasterId: roaster.id, name: 'Vitest CS Dupe Coffee' }, ACTOR);
      coffeeId = result.coffeeId;
      await expect(createCoffee({ roasterId: roaster.id, name: 'Vitest CS Dupe Coffee' }, ACTOR)).rejects.toMatchObject({ status: 409 });
    } finally {
      await cleanupRoasterAndCoffees(roaster, coffeeId ? [coffeeId] : []);
    }
  });
});

describe('placeCoffee / moveCoffee (D5)', () => {
  it('rejects a second home with HOME_EXISTS, then moveCoffee succeeds leaving exactly one active home', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Place Roastery');
      coffeeId = (await makeCoffee('Vitest Place Coffee', roaster.id)).id;
      const floral1 = await slotId('floral', 1);
      const floral3 = await slotId('floral', 3);

      await placeCoffee({ coffeeId, slotId: floral1, role: 'home' }, ACTOR);
      await expect(placeCoffee({ coffeeId, slotId: floral3, role: 'home' }, ACTOR)).rejects.toMatchObject({ status: 409, code: 'HOME_EXISTS' });

      await moveCoffee({ coffeeId, toSlotId: floral3 }, ACTOR);

      const rows = (await db.query<{ slot_id: number; is_active: boolean; deactivation_reason: string | null }>(
        `SELECT slot_id, is_active, deactivation_reason FROM coffee_slot_assignment WHERE coffee_id = $1 ORDER BY id`, [coffeeId]
      )).rows;
      const oldRow = rows.find(r => r.slot_id === floral1)!;
      expect(oldRow.is_active).toBe(false);
      expect(oldRow.deactivation_reason).toBe('moved');
      const activeHomes = rows.filter(r => r.is_active);
      expect(activeHomes.length).toBe(1);
      expect(activeHomes[0].slot_id).toBe(floral3);
    } finally {
      await cleanupRoasterAndCoffees(roaster, coffeeId ? [coffeeId] : []);
    }
  });

  it('rejects a guest on the home slot (ALREADY_ASSIGNED); a guest on another slot resolves via v_coffee_sellable_slot once the home is retired (D5)', async () => {
    let roaster: { id: string } | undefined;
    let homeCoffeeId: number | undefined;
    let guestCoffeeId: number | undefined;
    let chocolate2: number | undefined;
    // v_coffee_sellable_slot requires blend AND price (both since brief 1) —
    // chocolate_nutty/2 isn't guaranteed to already have a real 12oz price
    // (dial_slot_price is real, pre-existing business config, same "capture
    // and restore" hazard as blendResolver.test.ts's own no-price test), so
    // this test sets one and restores whatever was there before.
    let existingPriceCents: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Guest Roastery');
      homeCoffeeId = (await makeCoffee('Vitest Guest Home Coffee', roaster.id)).id;
      guestCoffeeId = (await makeCoffee('Vitest Guest Guest Coffee', roaster.id)).id;
      chocolate2 = await slotId('chocolate_nutty', 2);
      const existing = (await db.query<{ retail_price_cents: number }>(
        `SELECT retail_price_cents FROM dial_slot_price WHERE slot_id = $1 AND weight_oz = 12`, [chocolate2]
      )).rows[0];
      existingPriceCents = existing?.retail_price_cents;
      await setSlotPrice({ slotId: chocolate2, weightOz: 12, retailPriceCents: existingPriceCents ?? 1700 }, ACTOR);

      await placeCoffee({ coffeeId: homeCoffeeId, slotId: chocolate2, role: 'home' }, ACTOR);
      await expect(placeCoffee({ coffeeId: homeCoffeeId, slotId: chocolate2, role: 'guest' }, ACTOR)).rejects.toMatchObject({ status: 409, code: 'ALREADY_ASSIGNED' });

      await placeCoffee({ coffeeId: guestCoffeeId, slotId: chocolate2, role: 'guest', priority: 2 }, ACTOR);
      await upsertSku({ coffeeId: homeCoffeeId, weightOz: 12 }, ACTOR);
      await upsertSku({ coffeeId: guestCoffeeId, weightOz: 12 }, ACTOR);

      // Both have an active 12oz SKU — home wins (D5: home ranks before guest).
      let sellable = (await db.query(`SELECT coffee_id FROM v_coffee_sellable_slot WHERE slot_id = $1 AND weight_oz = 12`, [chocolate2])).rows;
      expect(sellable.length).toBe(1);
      expect(sellable[0].coffee_id).toBe(homeCoffeeId);

      // Home retired — guest now resolves.
      await db.query(`UPDATE coffees SET is_active = false WHERE id = $1`, [homeCoffeeId]);
      sellable = (await db.query(`SELECT coffee_id FROM v_coffee_sellable_slot WHERE slot_id = $1 AND weight_oz = 12`, [chocolate2])).rows;
      expect(sellable.length).toBe(1);
      expect(sellable[0].coffee_id).toBe(guestCoffeeId);
    } finally {
      if (chocolate2 !== undefined && existingPriceCents === undefined) {
        await db.query(`DELETE FROM dial_slot_price WHERE slot_id = $1 AND weight_oz = 12`, [chocolate2]);
      }
      await cleanupRoasterAndCoffees(roaster, [homeCoffeeId, guestCoffeeId].filter((x): x is number => x != null));
    }
  });
});

describe('setPriority', () => {
  it('reorders two coffees on one slot without a unique violation; a taken priority is rejected', async () => {
    let roaster: { id: string } | undefined;
    let coffeeA: number | undefined;
    let coffeeB: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Priority Roastery');
      coffeeA = (await makeCoffee('Vitest Priority Coffee A', roaster.id)).id;
      coffeeB = (await makeCoffee('Vitest Priority Coffee B', roaster.id)).id;
      const earthy4 = await slotId('earthy', 4);

      await placeCoffee({ coffeeId: coffeeA, slotId: earthy4, role: 'guest', priority: 1 }, ACTOR);
      await expect(placeCoffee({ coffeeId: coffeeB, slotId: earthy4, role: 'guest', priority: 1 }, ACTOR)).rejects.toMatchObject({ status: 409, code: 'PRIORITY_TAKEN' });
      await placeCoffee({ coffeeId: coffeeB, slotId: earthy4, role: 'guest', priority: 2 }, ACTOR);

      await setPriority({ slotId: earthy4, ordered: [coffeeB, coffeeA] }, ACTOR);
      const rows = (await db.query<{ coffee_id: number; priority: number }>(
        `SELECT coffee_id, priority FROM coffee_slot_assignment WHERE slot_id = $1 AND is_active = true ORDER BY priority`, [earthy4]
      )).rows;
      expect(rows.map(r => r.coffee_id)).toEqual([coffeeB, coffeeA]);
    } finally {
      await cleanupRoasterAndCoffees(roaster, [coffeeA, coffeeB].filter((x): x is number => x != null));
    }
  });
});

describe('D6 — placement guardrail evidence (warn + record)', () => {
  it('band_out_of_spec requires a note; inside the band does not; band clears after the test', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    const slotArchetype = 'chocolate_nutty', slotSortOrder = 1; // dimension_id 7 (Body), unpriced/unbanded slot
    let session: { id: number } | undefined;
    let sessionCoffee: { id: number } | undefined;
    let score: { id: number } | undefined;
    try {
      const cnSlot = await slotId(slotArchetype, slotSortOrder);
      const originalBand = (await db.query<{ spec_band_lo: number | null; spec_band_hi: number | null }>(
        `SELECT spec_band_lo, spec_band_hi FROM coffee_dial_slot WHERE id = $1`, [cnSlot]
      )).rows[0];

      roaster = await makeRoaster('Vitest D6 Roastery');
      coffeeId = (await makeCoffee('Vitest D6 Coffee', roaster.id)).id;

      // Merged cupping fixture: Body (dimension 7) scored high (12-13), well
      // outside a deliberately low band.
      session = (await db.query<{ id: number }>(`INSERT INTO cupping_sessions (session_date, location) VALUES (now(), 'Vitest D6 Session') RETURNING id`)).rows[0];
      sessionCoffee = (await db.query<{ id: number }>(`INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`, [session.id, coffeeId])).rows[0];
      score = (await db.query<{ id: number }>(`INSERT INTO cupping_scores (session_coffee_id, taster_name, is_merged) VALUES ($1, 'Vitest Taster', true) RETURNING id`, [sessionCoffee.id])).rows[0];
      await db.query(`INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max) VALUES ($1, 7, 12, 13)`, [score.id]);

      await db.query(`UPDATE coffee_dial_slot SET spec_band_lo = 1, spec_band_hi = 3 WHERE id = $1`, [cnSlot]);

      await expect(placeCoffee({ coffeeId, slotId: cnSlot, role: 'home' }, ACTOR)).rejects.toMatchObject({ status: 400, code: 'NOTE_REQUIRED' });

      const { warnings } = await placeCoffee({ coffeeId, slotId: cnSlot, role: 'home', placementNote: 'known outlier, placing anyway' }, ACTOR);
      expect(warnings.some(w => w.kind === 'band_out_of_spec')).toBe(true);
      const savedNote = (await db.query<{ placement_note: string }>(`SELECT placement_note FROM coffee_slot_assignment WHERE coffee_id = $1 AND slot_id = $2`, [coffeeId, cnSlot])).rows[0].placement_note;
      expect(savedNote).toBe('known outlier, placing anyway');

      // Widen the band to include the score — no note needed now.
      await db.query(`UPDATE coffee_slot_assignment SET is_active = false WHERE coffee_id = $1 AND slot_id = $2`, [coffeeId, cnSlot]);
      await db.query(`UPDATE coffee_dial_slot SET spec_band_lo = 10, spec_band_hi = 15 WHERE id = $1`, [cnSlot]);
      const { warnings: warnings2 } = await placeCoffee({ coffeeId, slotId: cnSlot, role: 'home' }, ACTOR);
      expect(warnings2.some(w => w.kind === 'band_out_of_spec')).toBe(false);

      await db.query(`UPDATE coffee_dial_slot SET spec_band_lo = $1, spec_band_hi = $2 WHERE id = $3`, [originalBand.spec_band_lo, originalBand.spec_band_hi, cnSlot]);
    } finally {
      if (score) await db.query(`DELETE FROM cupping_score_values WHERE cupping_score_id = $1`, [score.id]);
      if (score) await db.query(`DELETE FROM cupping_scores WHERE id = $1`, [score.id]);
      if (sessionCoffee) await db.query(`DELETE FROM cupping_session_coffees WHERE id = $1`, [sessionCoffee.id]);
      if (session) await db.query(`DELETE FROM cupping_sessions WHERE id = $1`, [session.id]);
      const cnSlot = await slotId(slotArchetype, slotSortOrder);
      await db.query(`UPDATE coffee_dial_slot SET spec_band_lo = NULL, spec_band_hi = NULL WHERE id = $1`, [cnSlot]);
      await cleanupRoasterAndCoffees(roaster, coffeeId ? [coffeeId] : []);
    }
  });

  it('descriptor_off_family: three Nutty / Cocoa descriptors placed on a floral slot', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest D6 Descriptor Roastery');
      coffeeId = (await makeCoffee('Vitest D6 Descriptor Coffee', roaster.id)).id;

      const notes = (await db.query<{ id: string }>(`SELECT id FROM cupping_note WHERE wheel_category = 'Nutty / Cocoa' LIMIT 3`)).rows;
      expect(notes.length).toBe(3);
      for (const note of notes) {
        await db.query(`INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id) VALUES ($1, $2)`, [coffeeId, note.id]);
      }

      const floral2 = await slotId('floral', 2);
      await expect(placeCoffee({ coffeeId, slotId: floral2, role: 'home' }, ACTOR)).rejects.toMatchObject({ status: 400, code: 'NOTE_REQUIRED' });
      const { warnings } = await placeCoffee({ coffeeId, slotId: floral2, role: 'home', placementNote: 'roastery notes lean cocoa, placing on floral per cupping call' }, ACTOR);
      expect(warnings.some(w => w.kind === 'descriptor_off_family')).toBe(true);
    } finally {
      if (coffeeId) await db.query(`DELETE FROM roastery_coffee_descriptors WHERE coffee_id = $1`, [coffeeId]);
      await cleanupRoasterAndCoffees(roaster, coffeeId ? [coffeeId] : []);
    }
  });
});

describe('setMatchArchetype (D1)', () => {
  it('supersedes correctly (exactly one current row) and warns on divergence from an active home', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Match Roastery');
      coffeeId = (await makeCoffee('Vitest Match Coffee', roaster.id)).id;

      await setMatchArchetype({ coffeeId, archetype: 'floral', confidence: 'medium', source: 'manual' }, ACTOR);
      await setMatchArchetype({ coffeeId, archetype: 'fruity', confidence: 'high', source: 'manual' }, ACTOR);
      const currentRows = (await db.query(`SELECT archetype FROM archetype_assignments WHERE coffee_id = $1 AND superseded_at IS NULL`, [coffeeId])).rows;
      expect(currentRows.length).toBe(1);
      expect(currentRows[0].archetype).toBe('fruity');

      const earthy1 = await slotId('earthy', 1);
      await placeCoffee({ coffeeId, slotId: earthy1, role: 'home' }, ACTOR);
      const { warnings } = await setMatchArchetype({ coffeeId, archetype: 'floral', confidence: 'high', source: 'manual' }, ACTOR);
      expect(warnings.some(w => w.kind === 'placement_diverges_from_match' && w.placement === 'earthy')).toBe(true);
    } finally {
      await cleanupRoasterAndCoffees(roaster, coffeeId ? [coffeeId] : []);
    }
  });
});

describe('retireCoffee / restoreCoffee', () => {
  it('retire cascades assignments and SKUs; restore brings back coffee + SKUs but not assignments', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Retire Roastery');
      coffeeId = (await makeCoffee('Vitest Retire Coffee', roaster.id)).id;
      const fruity4 = await slotId('fruity', 4);
      await placeCoffee({ coffeeId, slotId: fruity4, role: 'home' }, ACTOR);
      await upsertSku({ coffeeId, weightOz: 12 }, ACTOR);

      const { result } = await retireCoffee({ coffeeId, reason: 'manual' }, ACTOR);
      expect(result.assignments).toBe(1);
      expect(result.blends).toBe(1);
      const coffeeRow = (await db.query(`SELECT is_active FROM coffees WHERE id = $1`, [coffeeId])).rows[0];
      expect(coffeeRow.is_active).toBe(false);

      await restoreCoffee({ coffeeId }, ACTOR);
      const restoredCoffee = (await db.query(`SELECT is_active FROM coffees WHERE id = $1`, [coffeeId])).rows[0];
      expect(restoredCoffee.is_active).toBe(true);
      const restoredBlend = (await db.query(`SELECT is_active FROM roaster_blend WHERE coffee_id = $1`, [coffeeId])).rows[0];
      expect(restoredBlend.is_active).toBe(true);
      const assignmentRow = (await db.query(`SELECT is_active FROM coffee_slot_assignment WHERE coffee_id = $1 AND slot_id = $2`, [coffeeId, fruity4])).rows[0];
      expect(assignmentRow.is_active).toBe(false); // N3 — placements are not restored
    } finally {
      await cleanupRoasterAndCoffees(roaster, coffeeId ? [coffeeId] : []);
    }
  });
});

describe('deactivateRoastery / reactivateRoastery', () => {
  it('deactivate cascades coffee_slot_assignment; reactivate does not restore it', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Lifecycle Roastery');
      coffeeId = (await makeCoffee('Vitest Lifecycle Coffee', roaster.id)).id;
      const balanced2 = await slotId('balanced_sweet', 2);
      await placeCoffee({ coffeeId, slotId: balanced2, role: 'home' }, ACTOR);

      await deactivateRoastery({ roasterId: roaster.id, note: 'vitest pause' }, ACTOR);
      const assignmentAfterDeactivate = (await db.query(`SELECT is_active, deactivation_reason FROM coffee_slot_assignment WHERE coffee_id = $1 AND slot_id = $2`, [coffeeId, balanced2])).rows[0];
      expect(assignmentAfterDeactivate.is_active).toBe(false);
      expect(assignmentAfterDeactivate.deactivation_reason).toBe('roaster');

      await reactivateRoastery({ roasterId: roaster.id }, ACTOR);
      const coffeeAfterReactivate = (await db.query(`SELECT is_active FROM coffees WHERE id = $1`, [coffeeId])).rows[0];
      expect(coffeeAfterReactivate.is_active).toBe(true);
      const assignmentAfterReactivate = (await db.query(`SELECT is_active FROM coffee_slot_assignment WHERE coffee_id = $1 AND slot_id = $2`, [coffeeId, balanced2])).rows[0];
      expect(assignmentAfterReactivate.is_active).toBe(false); // N3 — not restored
    } finally {
      await cleanupRoasterAndCoffees(roaster, coffeeId ? [coffeeId] : []);
    }
  });
});

describe('setHop', () => {
  it('writes hop_type matching v_coffee_hop.hop_type_derived when both homes exist', async () => {
    let roaster: { id: string } | undefined;
    let coffeeA: number | undefined;
    let coffeeB: number | undefined;
    let hopId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Hop Roastery');
      coffeeA = (await makeCoffee('Vitest Hop Coffee A', roaster.id)).id;
      coffeeB = (await makeCoffee('Vitest Hop Coffee B', roaster.id)).id;
      const earthy2 = await slotId('earthy', 2);
      const floral4 = await slotId('floral', 4);
      await placeCoffee({ coffeeId: coffeeA, slotId: earthy2, role: 'home' }, ACTOR);
      await placeCoffee({ coffeeId: coffeeB, slotId: floral4, role: 'home' }, ACTOR);

      const { result } = await setHop({ fromCoffeeId: coffeeA, toCoffeeId: coffeeB, dimensionId: 9, direction: 'more' }, ACTOR);
      hopId = result.hopId;

      const row = (await db.query<{ hop_type_stored: string; hop_type_derived: string }>(`SELECT hop_type_stored, hop_type_derived FROM v_coffee_hop WHERE id = $1`, [hopId])).rows[0];
      expect(row.hop_type_stored).toBe(row.hop_type_derived);
      expect(row.hop_type_derived).toBe('bridge_archetype');
    } finally {
      if (hopId) await db.query(`DELETE FROM dial_coffee_relationships WHERE id = $1`, [hopId]);
      await cleanupRoasterAndCoffees(roaster, [coffeeA, coffeeB].filter((x): x is number => x != null));
    }
  });
});

describe('atomicity', () => {
  it('a failure after the assignment insert (invalid certify.by) leaves nothing written', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Atomic Roastery');
      coffeeId = (await makeCoffee('Vitest Atomic Coffee', roaster.id)).id;
      const experimental1 = await slotId('experimental', 1);

      await expect(
        placeCoffee({ coffeeId, slotId: experimental1, role: 'home', certify: { by: '' as any } }, ACTOR)
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_INPUT' });

      const rows = (await db.query(`SELECT id FROM coffee_slot_assignment WHERE coffee_id = $1`, [coffeeId])).rows;
      expect(rows.length).toBe(0);
    } finally {
      await cleanupRoasterAndCoffees(roaster, coffeeId ? [coffeeId] : []);
    }
  });
});
