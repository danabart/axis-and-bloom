// Catalog Blueprint · brief 3 (2026-09-14) — rewritten against fixtures built
// through catalogService (createCoffee -> setMatchArchetype -> upsertSku ->
// placeCoffee -> setSlotPrice), same convention as catalogService.test.ts:
// `Vitest`-prefixed names, cleanup in `finally` and `afterAll` (dependency
// order: coffee_slot_assignment -> archetype_assignments -> roaster_blend ->
// coffees -> roaster; dial_slot_price rows are deleted by weight+slot since
// they don't carry a name to filter on).
//
// v_coffee_sellable_candidate only ever has rows at BLOOM_WEIGHTS_OZ (12, 80)
// — the old test's isolation trick (a synthetic weight_oz = 13 no real seed
// data used) no longer works now that the view enumerates a fixed weight
// list, so these tests resolve at the real weight (12oz) and assert on the
// fixture's own coffee_id/blend_id rather than "the only candidate at this
// weight" (the catalog starts empty per N3, so a freshly-placed fixture is
// in practice the only candidate on its slot regardless).
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { createCoffee, setMatchArchetype, upsertSku, placeCoffee, addGuest, setSlotPrice, retireCoffee } from './catalogService.js';
import { resolveBlendForSlot, resolveCoffeeBlend, computeCollectionOffer } from './blendResolver.js';
import { getSellableCandidates } from './catalogReads.js';

const ACTOR = { actor: 'vitest' };
const WEIGHT_OZ = 12;

afterAll(async () => {
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM archetype_assignments WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM roaster_blend WHERE blend_name LIKE 'Vitest%' OR coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
});

async function makeRoaster(name: string) {
  return (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [name])).rows[0];
}
async function slotId(archetype: string, sortOrder: number): Promise<number> {
  return (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [archetype, sortOrder])).rows[0].id;
}
async function cleanup(roaster: { id: string } | undefined, coffeeIds: number[], slotIds: number[] = []) {
  if (coffeeIds.length) {
    await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM archetype_assignments WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM roaster_blend WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM coffees WHERE id = ANY($1::int[])`, [coffeeIds]);
  }
  if (slotIds.length) await db.query(`DELETE FROM dial_slot_price WHERE slot_id = ANY($1::int[]) AND weight_oz = $2`, [slotIds, WEIGHT_OZ]);
  if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
}

// Full happy-path chain: createCoffee -> setMatchArchetype -> upsertSku ->
// placeCoffee(home) -> setSlotPrice.
async function placeHomeFixture(opts: { roasterId: string; name: string; archetype: string; sortOrder: number; priceCents: number }) {
  const { result: created } = await createCoffee({ roasterId: opts.roasterId, name: opts.name }, ACTOR);
  const coffeeId = created.coffeeId;
  await setMatchArchetype({ coffeeId, archetype: opts.archetype as any, confidence: 'high', source: 'manual' }, ACTOR);
  const slot = await slotId(opts.archetype, opts.sortOrder);
  await upsertSku({ coffeeId, weightOz: WEIGHT_OZ, blendName: opts.name, isActive: true }, ACTOR);
  await placeCoffee({ coffeeId, slotId: slot, role: 'home' }, ACTOR);
  await setSlotPrice({ slotId: slot, weightOz: WEIGHT_OZ, retailPriceCents: opts.priceCents }, ACTOR);
  return { coffeeId, slotId: slot };
}

describe('resolveBlendForSlot', () => {
  it('resolves the home fixture at its priced weight', async () => {
    let roaster: { id: string } | undefined;
    let fixture: { coffeeId: number; slotId: number } | undefined;
    try {
      roaster = await makeRoaster('Vitest BR Roastery');
      fixture = await placeHomeFixture({ roasterId: roaster.id, name: 'Vitest BR Home Coffee', archetype: 'earthy', sortOrder: 1, priceCents: 1800 });

      const resolved = await resolveBlendForSlot('earthy', 1, WEIGHT_OZ);
      expect(resolved?.coffee_id).toBe(fixture.coffeeId);
      expect(resolved?.priority).toBe(1);
      expect(resolved?.weight_oz).toBe(WEIGHT_OZ);
      expect(resolved?.skipped).toEqual([]);
    } finally {
      if (fixture) await cleanup(roaster, [fixture.coffeeId], [fixture.slotId]);
      else await cleanup(roaster, []);
    }
  });

  it('excludeCoffeeIds removes the only candidate without writing anything', async () => {
    let roaster: { id: string } | undefined;
    let fixture: { coffeeId: number; slotId: number } | undefined;
    try {
      roaster = await makeRoaster('Vitest BR Exclude Roastery');
      fixture = await placeHomeFixture({ roasterId: roaster.id, name: 'Vitest BR Exclude Coffee', archetype: 'earthy', sortOrder: 2, priceCents: 1800 });

      const excluded = await resolveBlendForSlot('earthy', 2, WEIGHT_OZ, { excludeCoffeeIds: [fixture.coffeeId] });
      expect(excluded).toBeNull();

      const stillActive = (await db.query<{ is_active: boolean }>(`SELECT is_active FROM coffees WHERE id = $1`, [fixture.coffeeId])).rows[0];
      expect(stillActive.is_active).toBe(true); // excludeCoffeeIds never writes
    } finally {
      if (fixture) await cleanup(roaster, [fixture.coffeeId], [fixture.slotId]);
      else await cleanup(roaster, []);
    }
  });

  // Three fixture coffees, each a multi-step catalogService chain over the
  // Cloud SQL Auth Proxy — comfortably past the 5s default under real network
  // latency, same reasoning as the computeCollectionOffer tests below.
  //
  // Home always outranks a guest regardless of priority (rank orders by
  // (role='home') DESC first, D5) — so to make the guest the eventual winner
  // (and exercise the 'no active blend' skip reason on a real candidate that
  // ranks ahead of it), the home itself is the one with no SKU here.
  it('skips a home with no SKU at that weight, and resolves the guest instead (D5, "no active blend" reason)', async () => {
    let roaster: { id: string } | undefined;
    const coffeeIds: number[] = [];
    let slot: number | undefined;
    try {
      roaster = await makeRoaster('Vitest BR Skip Roastery');
      slot = await slotId('earthy', 3);

      // Home — no SKU at all at WEIGHT_OZ.
      const { result: home } = await createCoffee({ roasterId: roaster.id, name: 'Vitest BR Skip No Blend' }, ACTOR);
      coffeeIds.push(home.coffeeId);
      await setMatchArchetype({ coffeeId: home.coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, ACTOR);
      await placeCoffee({ coffeeId: home.coffeeId, slotId: slot, role: 'home' }, ACTOR);

      // Guest — SKU + price, the eventual winner.
      const { result: guest } = await createCoffee({ roasterId: roaster.id, name: 'Vitest BR Skip Winner' }, ACTOR);
      coffeeIds.push(guest.coffeeId);
      await setMatchArchetype({ coffeeId: guest.coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, ACTOR);
      await upsertSku({ coffeeId: guest.coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest BR Skip Winner Blend', isActive: true }, ACTOR);
      await addGuest({ coffeeId: guest.coffeeId, slotId: slot }, ACTOR); // priority auto-assigned — home already took priority 1
      await setSlotPrice({ slotId: slot, weightOz: WEIGHT_OZ, retailPriceCents: 1500 }, ACTOR);

      const resolved = await resolveBlendForSlot('earthy', 3, WEIGHT_OZ);
      expect(resolved?.coffee_id).toBe(guest.coffeeId);
      expect(resolved?.skipped).toEqual([
        expect.objectContaining({ coffee_name: 'Vitest BR Skip No Blend', reason: 'no active blend at that weight' }),
      ]);
    } finally {
      await cleanup(roaster, coffeeIds, slot ? [slot] : []);
    }
  }, 20000);

  // Price lives on (slot, weight) — v_coffee_sellable_candidate's dial_slot_price
  // join — not per candidate, so within one resolveBlendForSlot call every
  // blend-bearing candidate on the slot shares the same priced/unpriced state.
  // 'no price at that weight' is therefore only observable directly on
  // getSellableCandidates' own is_sellable flag (never inside a resolved
  // ResolvedBlend.skipped array, since a winner implies the slot IS priced).
  //
  // Dial slot prices are real, pre-existing business configuration set ahead
  // of catalog placement (unlike coffee_slot_assignment, N3's empty catalog
  // doesn't mean dial_slot_price is empty too) — so this test can't assume a
  // given slot/weight has no price already. Same "capture and restore" rule
  // catalogService.test.ts's own header note uses for shared slot-level rows:
  // whatever price row already exists for (slot, weight) is captured, removed
  // for the duration of the test, and put back exactly in `finally`.
  it('is_sellable is false for a blend-bearing candidate when the slot has no price at that weight', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    let slot: number | undefined;
    let existingPriceCents: number | undefined;
    try {
      roaster = await makeRoaster('Vitest BR NoPrice Roastery');
      slot = await slotId('earthy', 4);
      const existing = (await db.query<{ retail_price_cents: number }>(
        `SELECT retail_price_cents FROM dial_slot_price WHERE slot_id = $1 AND weight_oz = $2`, [slot, WEIGHT_OZ]
      )).rows[0];
      existingPriceCents = existing?.retail_price_cents;
      if (existingPriceCents !== undefined) {
        await db.query(`DELETE FROM dial_slot_price WHERE slot_id = $1 AND weight_oz = $2`, [slot, WEIGHT_OZ]);
      }

      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest BR NoPrice Coffee' }, ACTOR);
      coffeeId = created.coffeeId;
      await setMatchArchetype({ coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, ACTOR);
      await upsertSku({ coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest BR NoPrice Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId, slotId: slot, role: 'home' }, ACTOR);
      // Deliberately no setSlotPrice call.

      const resolved = await resolveBlendForSlot('earthy', 4, WEIGHT_OZ);
      expect(resolved).toBeNull();

      const candidates = await getSellableCandidates(slot, WEIGHT_OZ);
      const own = candidates.find((c) => c.coffee_id === coffeeId);
      expect(own?.blend_id).not.toBeNull();
      expect(own?.is_sellable).toBe(false);
    } finally {
      if (slot !== undefined && existingPriceCents !== undefined) {
        await db.query(
          `INSERT INTO dial_slot_price (slot_id, weight_oz, retail_price_cents) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [slot, WEIGHT_OZ, existingPriceCents]
        );
      }
      await cleanup(roaster, coffeeId ? [coffeeId] : []);
    }
  }, 20000);
});

describe('resolveCoffeeBlend (D2 — owned-coffee lookup, unchanged this brief)', () => {
  it('returns null once the coffee is inactive, even with an active roaster_blend row', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest RCB Roastery');
      const { result } = await createCoffee({ roasterId: roaster.id, name: 'Vitest RCB Coffee' }, ACTOR);
      coffeeId = result.coffeeId;
      await upsertSku({ coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest RCB Blend', isActive: true }, ACTOR);

      const whileActive = await resolveCoffeeBlend(coffeeId, WEIGHT_OZ);
      expect(whileActive?.blend_id).toBeTruthy();

      await retireCoffee({ coffeeId, reason: 'manual' }, ACTOR);
      const whileInactive = await resolveCoffeeBlend(coffeeId, WEIGHT_OZ);
      expect(whileInactive).toBeNull();
    } finally {
      await cleanup(roaster, coffeeId ? [coffeeId] : []);
    }
  });
});

describe('computeCollectionOffer', () => {
  it('sums three priced home positions with the 10% discount', async () => {
    let roaster: { id: string } | undefined;
    const coffeeIds: number[] = [];
    const slotIds: number[] = [];
    try {
      roaster = await makeRoaster('Vitest Collection Roastery');
      const prices = [1200, 1500, 1800];
      for (let i = 0; i < prices.length; i++) {
        const fixture = await placeHomeFixture({
          roasterId: roaster.id, name: `Vitest Collection Coffee ${i + 1}`,
          archetype: 'chocolate_nutty', sortOrder: i + 1, priceCents: prices[i],
        });
        coffeeIds.push(fixture.coffeeId);
        slotIds.push(fixture.slotId);
      }

      const offer = await computeCollectionOffer('chocolate_nutty');
      expect(offer).not.toBeNull();
      expect(offer!.members.length).toBeGreaterThanOrEqual(3);
      const sum = prices.reduce((a, b) => a + b, 0);
      expect(offer!.sumCents).toBeGreaterThanOrEqual(sum);
      expect(offer!.discountedCents).toBe(Math.round(offer!.sumCents * 0.9));
    } finally {
      await cleanup(roaster, coffeeIds, slotIds);
    }
  }, 20000);

  it('returns null below the collection minimum (only 2 priced positions)', async () => {
    let roaster: { id: string } | undefined;
    const coffeeIds: number[] = [];
    const slotIds: number[] = [];
    try {
      roaster = await makeRoaster('Vitest Collection Floor Roastery');
      for (let i = 0; i < 2; i++) {
        const fixture = await placeHomeFixture({
          roasterId: roaster.id, name: `Vitest Collection Floor Coffee ${i + 1}`,
          archetype: 'balanced_sweet', sortOrder: i + 1, priceCents: 1500,
        });
        coffeeIds.push(fixture.coffeeId);
        slotIds.push(fixture.slotId);
      }

      const offer = await computeCollectionOffer('balanced_sweet');
      expect(offer).toBeNull();
    } finally {
      await cleanup(roaster, coffeeIds, slotIds);
    }
  }, 20000);
});
