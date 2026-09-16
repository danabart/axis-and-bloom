// Catalog Blueprint · brief 3 (2026-09-14) — rewritten against fixtures built
// through catalogService (createCoffee -> setMatchArchetype -> upsertSku ->
// placeCoffee -> setSlotPrice), same convention as catalogService.test.ts and
// the rewritten blendResolver.test.ts: `Vitest`-prefixed names, cleanup in
// `finally` and `afterAll` (dependency order: coffee_slot_assignment ->
// archetype_assignments -> roaster_blend -> coffees -> roaster).
//
// getCandidatePool() (sommelierRag.ts) draws from v_coffee_sellable_slot at
// 12oz (D2) — a coffee only ever enters Liam's pool once it's home/guest on
// a slot AND has a priced 12oz SKU there, exactly the same fixture chain
// blendResolver.test.ts uses.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { createCoffee, setMatchArchetype, upsertSku, placeCoffee, setSlotPrice, retireCoffee } from './catalogService.js';
import { fetchSommelierCoffees, getAliases } from './sommelierRag.js';

const ACTOR = { actor: 'vitest' };
const WEIGHT_OZ = 12;

afterAll(async () => {
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_sku WHERE blend_name LIKE 'Vitest%' OR coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
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
    await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM coffee_sku WHERE coffee_id = ANY($1::int[])`, [coffeeIds]);
    await db.query(`DELETE FROM coffees WHERE id = ANY($1::int[])`, [coffeeIds]);
  }
  if (slotIds.length) await db.query(`DELETE FROM coffee_slot_price WHERE slot_id = ANY($1::int[]) AND weight_oz = $2`, [slotIds, WEIGHT_OZ]);
  if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
}

describe('fetchSommelierCoffees — candidate pool is v_coffee_sellable_slot at 12oz (D2)', () => {
  it('includes a fixture once it is home + priced, and drops it once retired', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    let slot: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Rag Roastery');
      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Rag Coffee' }, ACTOR);
      coffeeId = created.coffeeId;
      await setMatchArchetype({ coffeeId, archetype: 'chocolate_nutty', confidence: 'high', source: 'manual' }, ACTOR);
      slot = await slotId('chocolate_nutty', 1);
      await upsertSku({ coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Rag Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId, slotId: slot, role: 'home' }, ACTOR);
      await setSlotPrice({ slotId: slot, weightOz: WEIGHT_OZ, retailPriceCents: 1600 }, ACTOR);

      const before = await fetchSommelierCoffees({ ragFocus: 'curated_mix', userArchetype: null });
      expect(before.coffeeIds).toContain(coffeeId);
      expect(before.catalogText).toContain('YOUR CURRENT CATALOG');

      await retireCoffee({ coffeeId, reason: 'manual' }, ACTOR);
      const after = await fetchSommelierCoffees({ ragFocus: 'curated_mix', userArchetype: null });
      expect(after.coffeeIds).not.toContain(coffeeId);
    } finally {
      await cleanup(roaster, coffeeId ? [coffeeId] : [], slot ? [slot] : []);
    }
  }, 20000);

  it('exact_match narrows the pool to the requested archetype only', async () => {
    let roaster: { id: string } | undefined;
    const coffeeIds: number[] = [];
    const slotIds: number[] = [];
    try {
      roaster = await makeRoaster('Vitest Rag Exact Roastery');
      const targetArchetype = 'earthy';
      const otherArchetype = 'floral';
      const target = await createCoffee({ roasterId: roaster.id, name: 'Vitest Rag Exact Target' }, ACTOR);
      coffeeIds.push(target.result.coffeeId);
      await setMatchArchetype({ coffeeId: target.result.coffeeId, archetype: targetArchetype, confidence: 'high', source: 'manual' }, ACTOR);
      const targetSlot = await slotId(targetArchetype, 2);
      slotIds.push(targetSlot);
      await upsertSku({ coffeeId: target.result.coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Rag Exact Target Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId: target.result.coffeeId, slotId: targetSlot, role: 'home' }, ACTOR);
      await setSlotPrice({ slotId: targetSlot, weightOz: WEIGHT_OZ, retailPriceCents: 1700 }, ACTOR);

      const other = await createCoffee({ roasterId: roaster.id, name: 'Vitest Rag Exact Other' }, ACTOR);
      coffeeIds.push(other.result.coffeeId);
      await setMatchArchetype({ coffeeId: other.result.coffeeId, archetype: otherArchetype, confidence: 'high', source: 'manual' }, ACTOR);
      const otherSlot = await slotId(otherArchetype, 2);
      slotIds.push(otherSlot);
      await upsertSku({ coffeeId: other.result.coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Rag Exact Other Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId: other.result.coffeeId, slotId: otherSlot, role: 'home' }, ACTOR);
      await setSlotPrice({ slotId: otherSlot, weightOz: WEIGHT_OZ, retailPriceCents: 1700 }, ACTOR);

      const result = await fetchSommelierCoffees({ ragFocus: 'exact_match', userArchetype: targetArchetype });
      expect(result.coffeeIds).toContain(target.result.coffeeId);
      expect(result.coffeeIds).not.toContain(other.result.coffeeId);
    } finally {
      await cleanup(roaster, coffeeIds, slotIds);
    }
  }, 20000);
});

describe('getAliases', () => {
  it('resolves the fixture coffee\'s home slot name (never the raw coffee/roaster name)', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    let slot: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Rag Alias Roastery');
      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Rag Alias Raw Name' }, ACTOR);
      coffeeId = created.coffeeId;
      slot = await slotId('balanced_sweet', 1);
      await placeCoffee({ coffeeId, slotId: slot, role: 'home' }, ACTOR);
      const slotName = (await db.query<{ name: string | null }>(`SELECT name FROM coffee_dial_slot WHERE id = $1`, [slot])).rows[0].name;

      const aliases = await getAliases([coffeeId]);
      expect(aliases.get(coffeeId)).toBe(slotName);
      expect(aliases.get(coffeeId)).not.toBe('Vitest Rag Alias Raw Name');
    } finally {
      await cleanup(roaster, coffeeId ? [coffeeId] : []);
    }
  }, 20000);

  it('falls back to the coffee\'s own name when it has no slot at all', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = await makeRoaster('Vitest Rag Alias Fallback Roastery');
      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Rag Alias Fallback Coffee' }, ACTOR);
      coffeeId = created.coffeeId;

      const aliases = await getAliases([coffeeId]);
      expect(aliases.get(coffeeId)).toBe('Vitest Rag Alias Fallback Coffee');
    } finally {
      await cleanup(roaster, coffeeId ? [coffeeId] : []);
    }
  }, 20000);
});
