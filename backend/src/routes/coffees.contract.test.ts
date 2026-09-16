// Catalog Blueprint · brief 3, Part E — regression coverage for the public
// Bloom API's response shapes across the views migration. Spins up express
// like admin.roasters.test.ts, fixtures built through catalogService
// (createCoffee -> setMatchArchetype -> upsertSku -> placeCoffee ->
// setSlotPrice), `Vitest`-prefixed, cleanup in `finally` and `afterAll`.
//
// Field lists asserted below were read from this brief's frontend consumers:
// Slot (bloom/types.ts, built by buildSlotsForArchetype): dialSortOrder,
// positionLabel, description, isActive, platformName, isDefault, prices,
// coffeeId. Hop/HopTarget (bloom/types.ts, usePositionCardData.ts's raw
// setHops(json)): dimensionName, direction, hopType, confidence, target:
// {archetype, archetypeLabel, dialSortOrder, positionLabel, platformName}.
// legacy-slot (CoffeesRedirect.tsx's destructure): archetype, dialSortOrder.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const { default: coffeesRouter } = await import('./coffees.js');
const { db } = await import('../db/client.js');
const { createCoffee, setMatchArchetype, upsertSku, placeCoffee, addGuest, setSlotPrice, retireCoffee, restoreCoffee, setHop } = await import('../services/catalogService.js');

const ACTOR = { actor: 'vitest' };
const WEIGHT_OZ = 12;
const ARCHETYPE_ORDER = ['floral', 'fruity', 'balanced_sweet', 'chocolate_nutty', 'earthy'];
const SLOT_KEYS = ['dialSortOrder', 'positionLabel', 'description', 'isActive', 'platformName', 'isDefault', 'prices', 'coffeeId'].sort();

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/coffees', coffeesRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/coffees`;
});

afterAll(async () => {
  await db.query(`DELETE FROM coffee_hop WHERE from_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%') OR to_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_sku WHERE blend_name LIKE 'Vitest%' OR coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function makeRoaster(name: string) {
  return (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [name])).rows[0];
}
async function slotId(archetype: string, sortOrder: number): Promise<number> {
  return (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [archetype, sortOrder])).rows[0].id;
}
async function cleanup(roaster: { id: string } | undefined, coffeeIds: number[], slotIds: number[] = []) {
  await db.query(`DELETE FROM coffee_hop WHERE from_coffee_id = ANY($1::int[]) OR to_coffee_id = ANY($1::int[])`, [coffeeIds]);
  if (coffeeIds.length) {
    await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM coffee_sku WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM coffees WHERE id = ANY($1::int[])`, [coffeeIds]);
  }
  if (slotIds.length) await db.query(`DELETE FROM coffee_slot_price WHERE slot_id = ANY($1::int[]) AND weight_oz = $2`, [slotIds, WEIGHT_OZ]);
  if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
}

describe('GET /api/coffees/archetypes', () => {
  it('returns 5 archetypes in canonical order, 4 slots each with exactly the Slot keys; floral/2 reflects the fixture, D5 hands off to a guest on retirement', async () => {
    let roaster: { id: string } | undefined;
    let homeId: number | undefined;
    let guestId: number | undefined;
    let slot: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Contract Roastery');
      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Contract Home Coffee' }, ACTOR);
      homeId = created.coffeeId;
      await setMatchArchetype({ coffeeId: homeId, archetype: 'floral', confidence: 'high', source: 'manual' }, ACTOR);
      slot = await slotId('floral', 2);
      await upsertSku({ coffeeId: homeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Contract Home Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId: homeId, slotId: slot, role: 'home' }, ACTOR);
      await setSlotPrice({ slotId: slot, weightOz: WEIGHT_OZ, retailPriceCents: 1900 }, ACTOR);

      const res1 = await fetch(`${baseUrl}/archetypes`);
      expect(res1.status).toBe(200);
      const body1 = await res1.json();

      expect(body1.map((a: { archetype: string }) => a.archetype)).toEqual(ARCHETYPE_ORDER);

      for (const entry of body1) {
        expect(entry.slots).toHaveLength(4);
        for (const s of entry.slots) {
          expect(Object.keys(s).sort()).toEqual(SLOT_KEYS);
        }
      }

      const floralEntry = body1.find((a: { archetype: string }) => a.archetype === 'floral');
      const slot2 = floralEntry.slots.find((s: { dialSortOrder: number }) => s.dialSortOrder === 2);
      expect(slot2.isActive).toBe(true);
      expect(slot2.coffeeId).toBe(homeId);
      expect(slot2.isDefault).toBe(true);

      for (const entry of body1) {
        for (const s of entry.slots) {
          if (entry.archetype === 'floral' && s.dialSortOrder === 2) continue;
          expect(s.isActive).toBe(false);
        }
      }

      // Retire the home coffee — floral/2 goes empty.
      await retireCoffee({ coffeeId: homeId, reason: 'manual' }, ACTOR);
      const res2 = await fetch(`${baseUrl}/archetypes`);
      const body2 = await res2.json();
      const floralSlot2After = body2.find((a: { archetype: string }) => a.archetype === 'floral').slots.find((s: { dialSortOrder: number }) => s.dialSortOrder === 2);
      expect(floralSlot2After.isActive).toBe(false);
      expect(floralSlot2After.coffeeId).toBeNull();

      // Reinstate the home, add a guest, then retire the home again — the guest fulfils the slot (D5).
      await restoreCoffee({ coffeeId: homeId }, ACTOR);
      await placeCoffee({ coffeeId: homeId, slotId: slot, role: 'home' }, ACTOR);
      const { result: guestCreated } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Contract Guest Coffee' }, ACTOR);
      guestId = guestCreated.coffeeId;
      await setMatchArchetype({ coffeeId: guestId, archetype: 'floral', confidence: 'high', source: 'manual' }, ACTOR);
      await upsertSku({ coffeeId: guestId, weightOz: WEIGHT_OZ, blendName: 'Vitest Contract Guest Blend', isActive: true }, ACTOR);
      await addGuest({ coffeeId: guestId, slotId: slot }, ACTOR);
      await retireCoffee({ coffeeId: homeId, reason: 'manual' }, ACTOR);

      const res3 = await fetch(`${baseUrl}/archetypes`);
      const body3 = await res3.json();
      const floralSlot2Final = body3.find((a: { archetype: string }) => a.archetype === 'floral').slots.find((s: { dialSortOrder: number }) => s.dialSortOrder === 2);
      expect(floralSlot2Final.isActive).toBe(true);
      expect(floralSlot2Final.coffeeId).toBe(guestId);
    } finally {
      await cleanup(roaster, [homeId, guestId].filter((id): id is number => id != null), slot ? [slot] : []);
    }
  }, 30000);
});

describe('GET /api/coffees/:id/hops and /:id/legacy-slot', () => {
  it('hops carries exactly the frontend Hop/HopTarget keys; legacy-slot carries exactly {archetype, dialSortOrder}', async () => {
    let roaster: { id: string } | undefined;
    let fromId: number | undefined;
    let toId: number | undefined;
    const slotIds: number[] = [];
    try {
      roaster = await makeRoaster('Vitest Hops Roastery');

      const { result: fromCreated } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Hops From Coffee' }, ACTOR);
      fromId = fromCreated.coffeeId;
      await setMatchArchetype({ coffeeId: fromId, archetype: 'fruity', confidence: 'high', source: 'manual' }, ACTOR);
      const fromSlot = await slotId('fruity', 1);
      slotIds.push(fromSlot);
      await upsertSku({ coffeeId: fromId, weightOz: WEIGHT_OZ, blendName: 'Vitest Hops From Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId: fromId, slotId: fromSlot, role: 'home' }, ACTOR);
      await setSlotPrice({ slotId: fromSlot, weightOz: WEIGHT_OZ, retailPriceCents: 1600 }, ACTOR);

      const { result: toCreated } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Hops To Coffee' }, ACTOR);
      toId = toCreated.coffeeId;
      await setMatchArchetype({ coffeeId: toId, archetype: 'fruity', confidence: 'high', source: 'manual' }, ACTOR);
      const toSlot = await slotId('fruity', 2);
      slotIds.push(toSlot);
      await upsertSku({ coffeeId: toId, weightOz: WEIGHT_OZ, blendName: 'Vitest Hops To Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId: toId, slotId: toSlot, role: 'home' }, ACTOR);
      await setSlotPrice({ slotId: toSlot, weightOz: WEIGHT_OZ, retailPriceCents: 1600 }, ACTOR);

      await setHop({ fromCoffeeId: fromId, toCoffeeId: toId, dimensionId: 1, direction: 'less', isRecommended: true, confidence: 'high' }, ACTOR);

      const hopsRes = await fetch(`${baseUrl}/${fromId}/hops`);
      expect(hopsRes.status).toBe(200);
      const hops = await hopsRes.json();
      expect(hops.length).toBeGreaterThan(0);
      const hop = hops[0];
      expect(Object.keys(hop).sort()).toEqual(['confidence', 'dimensionName', 'direction', 'hopType', 'target'].sort());
      expect(Object.keys(hop.target).sort()).toEqual(['archetype', 'archetypeLabel', 'dialSortOrder', 'platformName', 'positionLabel'].sort());
      expect(hop.target.archetype).toBe('fruity');
      expect(hop.target.dialSortOrder).toBe(2);

      const legacyRes = await fetch(`${baseUrl}/${fromId}/legacy-slot`);
      expect(legacyRes.status).toBe(200);
      const legacy = await legacyRes.json();
      expect(Object.keys(legacy).sort()).toEqual(['archetype', 'dialSortOrder']);
      expect(legacy.archetype).toBe('fruity');
      expect(legacy.dialSortOrder).toBe(1);

      // A coffee with no active home resolves to the same "no slot" 404 shape as today.
      await retireCoffee({ coffeeId: fromId, reason: 'manual' }, ACTOR);
      const noSlotRes = await fetch(`${baseUrl}/${fromId}/legacy-slot`);
      expect(noSlotRes.status).toBe(404);
    } finally {
      await cleanup(roaster, [fromId, toId].filter((id): id is number => id != null), slotIds);
    }
  }, 30000);
});
