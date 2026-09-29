// Catalog Sizes + Visibility brief (2026-09-28) — coffee_size, v_coffee_visibility,
// the UNKNOWN_SIZE write block, the importer's size validation, the public
// per-archetype price order/labels, and the collection offer's anchor-first
// pick. Fixtures built through catalogService like the other catalog tests
// ('Vitest Sizes' prefix, cleanup in finally/afterAll), against the isolated
// axisandbloom_test database only.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import coffeesRouter from '../routes/coffees.js';
import { db } from '../db/client.js';
import {
  createCoffee, setMatchArchetype, upsertSku, placeCoffee, addGuest, setSlotPrice, CatalogError,
} from './catalogService.js';
import { importCatalog, type Manifest } from './catalogImport.js';
import { computeCollectionOffer, resolveBlendForSlot, resolveCoffeeBlend } from './blendResolver.js';
import { runCatalogIntegrityChecks } from './catalogIntegrity.js';
import {
  getSizes, getAnchorSize, getCoffeeVisibility, getSlotVisibility, getNotSellable, getSellableSlots, clearSizeCache,
} from './catalogReads.js';

const ACTOR = { actor: 'vitest' };
const OZ_12 = 12;
const OZ_2LB = 32;
const OZ_5LB = 80;

let server: Server;
let baseUrl: string;

// Slot prices that already exist on the slots these tests use (the test DB is
// a prod clone) — captured up front and restored, never deleted for good.
const USED_SLOTS: Array<[string, number]> = [['floral', 2], ['floral', 3], ['balanced_sweet', 1], ['balanced_sweet', 2], ['balanced_sweet', 3]];
let savedPrices: Array<{ slot_id: number; weight_oz: string; retail_price_cents: number }> = [];
const slotIds = new Map<string, number>();

async function slotId(archetype: string, sortOrder: number): Promise<number> {
  return slotIds.get(`${archetype}/${sortOrder}`)!;
}

beforeAll(async () => {
  for (const [a, n] of USED_SLOTS) {
    slotIds.set(`${a}/${n}`, (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [a, n])).rows[0].id);
  }
  const ids = [...slotIds.values()];
  savedPrices = (await db.query(`SELECT slot_id, weight_oz::text AS weight_oz, retail_price_cents FROM coffee_slot_price WHERE slot_id = ANY($1::int[])`, [ids])).rows;
  await db.query(`DELETE FROM coffee_slot_price WHERE slot_id = ANY($1::int[])`, [ids]);

  const app = express();
  app.use(express.json());
  app.use('/api/coffees', coffeesRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/coffees`;
}, 30000);

afterAll(async () => {
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Sizes%')`);
  await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Sizes%')`);
  await db.query(`DELETE FROM coffee_sku WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Sizes%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest Sizes%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest Sizes%'`);
  const ids = [...slotIds.values()];
  await db.query(`DELETE FROM coffee_slot_price WHERE slot_id = ANY($1::int[])`, [ids]);
  for (const p of savedPrices) {
    await db.query(`INSERT INTO coffee_slot_price (slot_id, weight_oz, retail_price_cents) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [p.slot_id, p.weight_oz, p.retail_price_cents]);
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function reset() {
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Sizes%')`);
  await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Sizes%')`);
  await db.query(`DELETE FROM coffee_sku WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Sizes%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest Sizes%'`);
  await db.query(`DELETE FROM coffee_slot_price WHERE slot_id = ANY($1::int[])`, [[...slotIds.values()]]);
}

async function makeRoaster(name = 'Vitest Sizes Roastery') {
  const existing = await db.query<{ id: string }>(`SELECT id FROM roaster WHERE name = $1`, [name]);
  if (existing.rows[0]) return existing.rows[0];
  return (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [name])).rows[0];
}

async function makeCoffee(opts: { name: string; archetype: string; skus: number[]; slot?: number; role?: 'home' | 'guest'; priority?: number }) {
  const roaster = await makeRoaster();
  const { result } = await createCoffee({ roasterId: roaster.id, name: opts.name }, ACTOR);
  const coffeeId = result.coffeeId;
  await setMatchArchetype({ coffeeId, archetype: opts.archetype as any, confidence: 'high', source: 'manual' }, ACTOR);
  for (const oz of opts.skus) await upsertSku({ coffeeId, weightOz: oz, blendName: opts.name, isActive: true }, ACTOR);
  if (opts.slot != null) {
    if (opts.role === 'guest') await addGuest({ coffeeId, slotId: opts.slot, priority: opts.priority }, ACTOR);
    else await placeCoffee({ coffeeId, slotId: opts.slot, role: 'home' }, ACTOR);
  }
  return coffeeId;
}

describe('coffee_size', () => {
  it('is seeded 12 oz (anchor) / 2 lb / 5 lb, in order', async () => {
    clearSizeCache();
    const sizes = await getSizes();
    expect(sizes.map(s => [s.weight_oz, s.label, s.is_anchor])).toEqual([
      [OZ_12, '12 oz', true], [OZ_2LB, '2 lb', false], [OZ_5LB, '5 lb', false],
    ]);
    expect((await getAnchorSize()).weight_oz).toBe(OZ_12);
  });

  it('refuses a second anchor and a non-positive weight (constraints, not comments)', async () => {
    await expect(db.query(`INSERT INTO coffee_size (weight_oz, label, sort_order, is_anchor) VALUES (48, '3 lb', 99, true)`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO coffee_size (weight_oz, label, sort_order) VALUES (0, 'zero', 98)`)).rejects.toThrow();
  });

  it('refuses a SKU / slot price weight outside coffee_size at the database (FK)', async () => {
    await expect(db.query(`INSERT INTO coffee_slot_price (slot_id, weight_oz, retail_price_cents) VALUES ($1, 48, 100)`, [await slotId('floral', 2)])).rejects.toThrow(/foreign key/i);
  });

  it('integrity check 14 passes', async () => {
    const report = await runCatalogIntegrityChecks();
    const check14 = report.checks.find(c => c.id === 14);
    expect(check14?.pass).toBe(true);
    expect(report.checks.filter(c => (c.severity ?? 'fail') === 'fail')).toHaveLength(11);
  });
});

describe('UNKNOWN_SIZE hard block', () => {
  it('setSlotPrice and upsertSku at 48 oz are refused with UNKNOWN_SIZE', async () => {
    await reset();
    const coffeeId = await makeCoffee({ name: 'Vitest Sizes Unknown', archetype: 'floral', skus: [OZ_12] });
    await expect(setSlotPrice({ slotId: await slotId('floral', 2), weightOz: 48, retailPriceCents: 1000 }, ACTOR))
      .rejects.toMatchObject({ code: 'UNKNOWN_SIZE', status: 400 });
    await expect(upsertSku({ coffeeId, weightOz: 48, isActive: true }, ACTOR))
      .rejects.toBeInstanceOf(CatalogError);
    await reset();
  }, 20000);
});

describe('importCatalog — sizes', () => {
  it('still rejects a coffee with no anchor (12 oz) SKU, and a SKU / slot price at an unknown size', async () => {
    await makeRoaster('Vitest Sizes Import Roastery');
    const manifest: Manifest = {
      roaster: { name: 'Vitest Sizes Import Roastery' },
      coffees: [
        { name: 'Vitest Sizes Import NoAnchor', match: { archetype: 'floral', confidence: 'high', source: 'manual' }, skus: [{ weightOz: OZ_2LB }] },
        { name: 'Vitest Sizes Import BadSize', match: { archetype: 'floral', confidence: 'high', source: 'manual' }, skus: [{ weightOz: OZ_12 }, { weightOz: 48 }] },
      ],
      slotPrices: [{ slot: 'floral/2', weightOz: 48, retailPriceCents: 1000 }],
    };
    const report = await importCatalog(manifest, { dryRun: true, actor: 'vitest' });
    expect(report.coffees[0].errors).toContain('Missing a 12 oz SKU');
    expect(report.coffees[1].errors.some(e => e.startsWith('UNKNOWN_SIZE'))).toBe(true);
    expect(report.slotPrices[0].error).toMatch(/UNKNOWN_SIZE/);
  }, 20000);
});

describe('v_coffee_visibility', () => {
  it('12 oz SKU with no slot price is hidden (no_slot_price); adding the price makes it visible', async () => {
    await reset();
    const slot = await slotId('floral', 2);
    const coffeeId = await makeCoffee({ name: 'Vitest Sizes Hidden', archetype: 'floral', skus: [OZ_12], slot });

    let vis = (await getCoffeeVisibility([coffeeId])).get(coffeeId)!;
    expect(vis.isPlaced).toBe(true);
    expect(vis.isVisible).toBe(false);
    const sizes = vis.placements[0].sizes;
    expect(sizes.map(s => s.label)).toEqual(['12 oz', '2 lb', '5 lb']);
    expect(sizes[0].reasons).toEqual(['no_slot_price']);
    expect(sizes[1].reasons).toEqual(['no_active_sku']);
    expect(sizes[2].reasons).toEqual(['no_active_sku']);
    expect((await getNotSellable({ coffeeId })).map(r => r.coffee_id)).toEqual([coffeeId]);

    await setSlotPrice({ slotId: slot, weightOz: OZ_12, retailPriceCents: 1800 }, ACTOR);
    vis = (await getCoffeeVisibility([coffeeId])).get(coffeeId)!;
    expect(vis.isVisible).toBe(true);
    expect(vis.visibleSlotCount).toBe(1);
    expect(vis.placements[0].sizes[0].isWinner).toBe(true);
    expect(await getNotSellable({ coffeeId })).toEqual([]);
    await reset();
  }, 30000);

  it('an unplaced coffee is not placed and not visible', async () => {
    await reset();
    const coffeeId = await makeCoffee({ name: 'Vitest Sizes Unplaced', archetype: 'floral', skus: [OZ_12] });
    const vis = (await getCoffeeVisibility([coffeeId])).get(coffeeId)!;
    expect(vis).toMatchObject({ isPlaced: false, isVisible: false, placements: [] });
    await reset();
  }, 20000);

  it('a lower-ranked guest is outranked, and the reason names the winner', async () => {
    await reset();
    const slot = await slotId('floral', 3);
    const homeId = await makeCoffee({ name: 'Vitest Sizes Home Winner', archetype: 'floral', skus: [OZ_12], slot });
    const guestId = await makeCoffee({ name: 'Vitest Sizes Guest Loser', archetype: 'floral', skus: [OZ_12], slot, role: 'guest', priority: 2 });
    await setSlotPrice({ slotId: slot, weightOz: OZ_12, retailPriceCents: 1800 }, ACTOR);

    const vis = await getCoffeeVisibility([homeId, guestId]);
    expect(vis.get(homeId)!.isVisible).toBe(true);
    const guest = vis.get(guestId)!;
    expect(guest.isVisible).toBe(false);
    const at12 = guest.placements[0].sizes[0];
    expect(at12.reasons).toEqual(['outranked']);
    expect(at12.winnerCoffeeName).toBe('Vitest Sizes Home Winner');

    const slotVis = (await getSlotVisibility([slot])).get(slot)!;
    expect(slotVis.isVisible).toBe(true);
    expect(slotVis.sizes[0].winnerCoffeeId).toBe(homeId);
    expect(slotVis.sizes[1].winnerCoffeeId).toBeNull();
    await reset();
  }, 30000);

  it('S3: 12 oz + 2 lb SKUs with only a 2 lb slot price is visible, but Liam\'s anchor-size reader excludes it (S2)', async () => {
    await reset();
    const slot = await slotId('floral', 2);
    const coffeeId = await makeCoffee({ name: 'Vitest Sizes TwoLb Only', archetype: 'floral', skus: [OZ_12, OZ_2LB], slot });
    await setSlotPrice({ slotId: slot, weightOz: OZ_2LB, retailPriceCents: 4200 }, ACTOR);

    const vis = (await getCoffeeVisibility([coffeeId])).get(coffeeId)!;
    expect(vis.isVisible).toBe(true);
    expect(vis.placements[0].sizes.map(s => s.isWinner)).toEqual([false, true, false]);

    const anchor = await getAnchorSize();
    expect(await getSellableSlots({ slotId: slot, weightOz: anchor.weight_oz })).toEqual([]);
    expect((await getSellableSlots({ slotId: slot })).map(r => Number(r.weight_oz))).toEqual([OZ_2LB]);
    await reset();
  }, 30000);
});

describe('public /api/coffees/archetypes — sizes', () => {
  it('returns prices in 12 oz / 2 lb / 5 lb order with labels, coffeeId = the anchor winner', async () => {
    await reset();
    const slot = await slotId('floral', 2);
    const coffeeId = await makeCoffee({ name: 'Vitest Sizes Public', archetype: 'floral', skus: [OZ_5LB, OZ_12, OZ_2LB], slot });
    await setSlotPrice({ slotId: slot, weightOz: OZ_5LB, retailPriceCents: 17000 }, ACTOR);
    await setSlotPrice({ slotId: slot, weightOz: OZ_2LB, retailPriceCents: 4200 }, ACTOR);
    await setSlotPrice({ slotId: slot, weightOz: OZ_12, retailPriceCents: 1800 }, ACTOR);

    const archetypes = await (await fetch(`${baseUrl}/archetypes`)).json();
    const s = archetypes.find((a: any) => a.archetype === 'floral').slots.find((x: any) => x.dialSortOrder === 2);
    expect(s.isActive).toBe(true);
    expect(s.coffeeId).toBe(coffeeId);
    expect(s.prices).toEqual([
      { weightOz: OZ_12, retailPriceCents: 1800, label: '12 oz', isAnchor: true },
      { weightOz: OZ_2LB, retailPriceCents: 4200, label: '2 lb', isAnchor: false },
      { weightOz: OZ_5LB, retailPriceCents: 17000, label: '5 lb', isAnchor: false },
    ]);
    await reset();
  }, 30000);

  it('a slot that wins only at 2 lb is active, coffeeId = the first size with a winner', async () => {
    await reset();
    const slot = await slotId('floral', 3);
    const coffeeId = await makeCoffee({ name: 'Vitest Sizes Public TwoLb', archetype: 'floral', skus: [OZ_2LB], slot });
    await setSlotPrice({ slotId: slot, weightOz: OZ_2LB, retailPriceCents: 4200 }, ACTOR);
    const archetypes = await (await fetch(`${baseUrl}/archetypes`)).json();
    const s = archetypes.find((a: any) => a.archetype === 'floral').slots.find((x: any) => x.dialSortOrder === 3);
    expect(s.isActive).toBe(true);
    expect(s.coffeeId).toBe(coffeeId);
    expect(s.prices.map((p: any) => p.label)).toEqual(['2 lb']);
    await reset();
  }, 30000);
});

describe('computeCollectionOffer — sizes', () => {
  it('picks the anchor (12 oz) for every member that has it, not the 5 lb price', async () => {
    await reset();
    const prices12 = [1200, 1500, 1800];
    for (let i = 0; i < 3; i++) {
      const slot = await slotId('balanced_sweet', i + 1);
      await makeCoffee({ name: `Vitest Sizes Collection ${i + 1}`, archetype: 'balanced_sweet', skus: [OZ_5LB, OZ_12], slot });
      await setSlotPrice({ slotId: slot, weightOz: OZ_5LB, retailPriceCents: 16000 + i }, ACTOR);
      await setSlotPrice({ slotId: slot, weightOz: OZ_12, retailPriceCents: prices12[i] }, ACTOR);
    }
    const offer = await computeCollectionOffer('balanced_sweet');
    expect(offer).not.toBeNull();
    expect(offer!.members.map(m => m.weightOz)).toEqual([OZ_12, OZ_12, OZ_12]);
    expect(offer!.sumCents).toBe(prices12.reduce((a, b) => a + b, 0));
    await reset();
  }, 40000);
});

describe('order-time resolution accepts a 2 lb (32 oz) line', () => {
  it('resolveBlendForSlot / resolveCoffeeBlend resolve at 32 oz (what POST /api/orders validates through)', async () => {
    await reset();
    const slot = await slotId('floral', 2);
    const coffeeId = await makeCoffee({ name: 'Vitest Sizes Order TwoLb', archetype: 'floral', skus: [OZ_12, OZ_2LB], slot });
    await setSlotPrice({ slotId: slot, weightOz: OZ_2LB, retailPriceCents: 4200 }, ACTOR);

    const resolved = await resolveBlendForSlot('floral', 2, OZ_2LB);
    expect(resolved?.coffee_id).toBe(coffeeId);
    expect(Number(resolved?.weight_oz)).toBe(OZ_2LB);
    expect(await resolveBlendForSlot('floral', 2, OZ_12)).toBeNull(); // no 12 oz price -> not orderable at 12 oz
    expect((await resolveCoffeeBlend(coffeeId, OZ_2LB))?.blend_id).toBeTruthy();
    await reset();
  }, 30000);
});
