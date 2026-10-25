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
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { db } from '../db/client.js';
import { createCoffee, setMatchArchetype, upsertSku, placeCoffee, setSlotPrice, retireCoffee, type ArchetypeCode } from './catalogService.js';
import { fetchSommelierCoffees, getAliases, getCatalogBlock, type SlotCandidate } from './sommelierRag.js';
import { freeSlots, freeSlotsInOneArchetype, liveSellableCoffeeIds, type FreeSlot } from '../test/freeSlots.js';

const ACTOR = { actor: 'vitest' };
// Rev 2: the coffees a ragFocus composed (the FIT block's), not the whole catalog.
const picked = (r: { slices: Array<{ coffeeId: number }> }) => r.slices.map(s => s.coffeeId);
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
// Cupping evidence brief 3, Part 0: fixtures use free slots (no live
// placement, no 12 oz price), so cleanup's 12 oz price delete only removes
// prices the fixture set; see src/test/freeSlots.ts.
async function slotId(archetype: string): Promise<number> {
  return (await freeSlotsInOneArchetype(1, { archetype }))[0].id;
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
      slot = await slotId('chocolate_nutty');
      await upsertSku({ coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Rag Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId, slotId: slot, role: 'home' }, ACTOR);
      await setSlotPrice({ slotId: slot, weightOz: WEIGHT_OZ, retailPriceCents: 1600 }, ACTOR);

      const before = await fetchSommelierCoffees({ ragFocus: 'curated_mix', userArchetype: null });
      expect(before.coffeeIds).toContain(coffeeId);
      // Liam sees everything brief Rev 2: coffeeIds is the whole shared catalog block.
      expect((await getCatalogBlock()).text).toContain('YOUR CATALOG');

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
      const targetSlot = await slotId(targetArchetype);
      slotIds.push(targetSlot);
      await upsertSku({ coffeeId: target.result.coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Rag Exact Target Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId: target.result.coffeeId, slotId: targetSlot, role: 'home' }, ACTOR);
      await setSlotPrice({ slotId: targetSlot, weightOz: WEIGHT_OZ, retailPriceCents: 1700 }, ACTOR);

      const other = await createCoffee({ roasterId: roaster.id, name: 'Vitest Rag Exact Other' }, ACTOR);
      coffeeIds.push(other.result.coffeeId);
      await setMatchArchetype({ coffeeId: other.result.coffeeId, archetype: otherArchetype, confidence: 'high', source: 'manual' }, ACTOR);
      const otherSlot = await slotId(otherArchetype);
      slotIds.push(otherSlot);
      await upsertSku({ coffeeId: other.result.coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Rag Exact Other Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId: other.result.coffeeId, slotId: otherSlot, role: 'home' }, ACTOR);
      await setSlotPrice({ slotId: otherSlot, weightOz: WEIGHT_OZ, retailPriceCents: 1700 }, ACTOR);

      const result = await fetchSommelierCoffees({ ragFocus: 'exact_match', userArchetype: targetArchetype });
      // Liam sees everything brief Rev 2: coffeeIds is the whole catalog Liam
      // may name; what the focus composed (and labelled) is `slices`.
      expect(picked(result)).toContain(target.result.coffeeId);
      expect(picked(result)).not.toContain(other.result.coffeeId);
    } finally {
      await cleanup(roaster, coffeeIds, slotIds);
    }
  }, 20000);
});

describe('fetchSommelierCoffees — Liam L1, Part B: thread/secondary/palate slices', () => {
  // One shared fixture for this whole block (read-only assertions — nothing
  // here mutates), so 5 tests don't each pay for their own coffee/slot setup.
  // Cupping evidence brief 3, Part 0: every fixture coffee sits on its own
  // free slot (a live coffee may hold the others), the secondary archetype is
  // whichever real archetype still has three free slots, and every call below
  // passes the live sellable coffees as dislikes so the pool is the fixture's
  // own coffees only (fetchIsolated).
  const state: {
    roaster?: { id: string };
    floral: number[]; // 3 coffees, archetype 'floral' — the thread candidates
    secondary: number[]; // 3 coffees, archetype state.secondaryArchetype — the secondary candidates
    secondaryArchetype: string;
    earthy: number[]; // 1 coffee, archetype 'earthy' — the disliked-but-would-be-picked fill target
    live: number[];
    coffeeIds: number[];
    slotIds: number[];
  } = { floral: [], secondary: [], secondaryArchetype: '', earthy: [], live: [], coffeeIds: [], slotIds: [] };

  async function makeFixtureCoffee(name: string, slot: FreeSlot, role: 'home' | 'guest'): Promise<number> {
    const { result: created } = await createCoffee({ roasterId: state.roaster!.id, name }, ACTOR);
    const coffeeId = created.coffeeId;
    await setMatchArchetype({ coffeeId, archetype: slot.archetype as ArchetypeCode, confidence: 'high', source: 'manual' }, ACTOR);
    await upsertSku({ coffeeId, weightOz: WEIGHT_OZ, blendName: `${name} Blend`, isActive: true }, ACTOR);
    await placeCoffee({ coffeeId, slotId: slot.id, role }, ACTOR);
    await setSlotPrice({ slotId: slot.id, weightOz: WEIGHT_OZ, retailPriceCents: 1800 }, ACTOR);
    state.coffeeIds.push(coffeeId);
    state.slotIds.push(slot.id);
    return coffeeId;
  }
  const fetchIsolated = (params: Parameters<typeof fetchSommelierCoffees>[0]) =>
    fetchSommelierCoffees({ ...params, dislikedCoffeeIds: [...state.live, ...(params.dislikedCoffeeIds ?? [])] });

  beforeAll(async () => {
    state.live = await liveSellableCoffeeIds();
    state.roaster = await makeRoaster('Vitest Rag Composition Roastery');
    const floralSlots = await freeSlotsInOneArchetype(3, { archetype: 'floral' });
    const secondarySlots = await freeSlotsInOneArchetype(3, { notArchetypes: ['floral', 'earthy'] });
    state.secondaryArchetype = secondarySlots[0].archetype;
    const [earthySlot] = await freeSlotsInOneArchetype(1, { archetype: 'earthy' });
    for (let i = 0; i < 3; i++) state.floral.push(await makeFixtureCoffee(`Vitest Rag Floral ${i + 1}`, floralSlots[i], i === 0 ? 'home' : 'guest'));
    for (let i = 0; i < 3; i++) state.secondary.push(await makeFixtureCoffee(`Vitest Rag Secondary ${i + 1}`, secondarySlots[i], i === 0 ? 'home' : 'guest'));
    state.earthy.push(await makeFixtureCoffee('Vitest Rag Earthy 1', earthySlot, 'guest'));
  }, 30000);

  afterAll(async () => {
    await cleanup(state.roaster, state.coffeeIds, state.slotIds);
  });

  it('reserves a thread slice and a secondary slice in every focus, both before focus fill', async () => {
    const result = await fetchIsolated({
      ragFocus: 'curated_mix',
      userArchetype: null,
      exploreArchetype: 'floral',
      secondaryArchetype: state.secondaryArchetype,
    });
    const threadSlices = result.slices.filter(s => s.slice === 'thread');
    const secondarySlices = result.slices.filter(s => s.slice === 'secondary');
    expect(threadSlices.length).toBe(2); // capped at 2, from 3 floral candidates
    expect(threadSlices.every(s => state.floral.includes(s.coffeeId))).toBe(true);
    expect(secondarySlices.length).toBe(2); // capped at 2, from 3 secondary candidates
    expect(secondarySlices.every(s => state.secondary.includes(s.coffeeId))).toBe(true);
    expect(result.fitText).toContain('[thread: Floral]');
    expect(result.fitText).toContain('[second archetype]');

    // Both reserved slices precede any focus-fill coffee (palate isn't used
    // in this call, so the first non-thread/secondary slice is 'focus'/'primary').
    const lastReservedIndex = Math.max(
      ...result.slices.map((s, i) => (s.slice === 'thread' || s.slice === 'secondary' ? i : -1))
    );
    const firstFillIndex = result.slices.findIndex(s => s.slice === 'focus' || s.slice === 'primary');
    if (firstFillIndex !== -1) expect(lastReservedIndex).toBeLessThan(firstFillIndex);
  }, 20000);

  it('places the palate slice before focus fill, and a coffee in two slices keeps the first (thread) label', async () => {
    // state.floral[0] qualifies for BOTH the thread slice (exploreArchetype
    // = floral) and is also listed as a slot candidate here — thread runs
    // first (composition step 1), so it must keep slice='thread', never be
    // reclassified 'palate'/'had' by the later palate step.
    const slotCandidates: SlotCandidate[] = [
      { coffee_id: state.floral[0], already_bought: false, last_rating: null },
      { coffee_id: state.secondary[2], already_bought: true, last_rating: 5 },
    ];
    const result = await fetchIsolated({
      ragFocus: 'curated_mix',
      userArchetype: null,
      exploreArchetype: 'floral',
      slotCandidates,
    });

    const floral0Slice = result.slices.find(s => s.coffeeId === state.floral[0]);
    expect(floral0Slice?.slice).toBe('thread'); // kept its first label, not overwritten to 'palate'

    const secondary2Slice = result.slices.find(s => s.coffeeId === state.secondary[2]);
    expect(secondary2Slice?.slice).toBe('had'); // already_bought -> 'had', not plain 'palate'
    expect(result.fitText).toContain('[palate match] [had before, rated 5]');

    // Palate slice (index of secondary[2]) precedes any focus-fill coffee.
    const palateIndex = result.slices.findIndex(s => s.coffeeId === state.secondary[2]);
    const firstFillIndex = result.slices.findIndex(s => s.slice === 'focus' || s.slice === 'primary');
    if (firstFillIndex !== -1) expect(palateIndex).toBeLessThan(firstFillIndex);
  }, 20000);

  it('caps the palate slice at 4 even when given more slot candidates', async () => {
    const slotCandidates: SlotCandidate[] = [...state.floral, ...state.secondary, state.earthy[0]]
      .map(coffee_id => ({ coffee_id, already_bought: false, last_rating: null }));
    const result = await fetchIsolated({ ragFocus: 'curated_mix', userArchetype: null, slotCandidates });
    const palateSlices = result.slices.filter(s => s.slice === 'palate' || s.slice === 'had');
    expect(palateSlices.length).toBe(4);
  }, 20000);

  it('excludes a disliked coffee even when the focus would otherwise pick it', async () => {
    const withoutDislike = await fetchIsolated({ ragFocus: 'curated_mix', userArchetype: 'earthy' });
    expect(picked(withoutDislike)).toContain(state.earthy[0]); // curated_mix picks 1 per archetype in the pool

    const withDislike = await fetchIsolated({
      ragFocus: 'curated_mix', userArchetype: 'earthy', dislikedCoffeeIds: [state.earthy[0]],
    });
    expect(picked(withDislike)).not.toContain(state.earthy[0]);
  }, 20000);

  // Liam L2, Part C — the new 'matched' focus.
  it('matched focus: a quiz-only customer with a secondary gets primary coffees before secondary', async () => {
    const result = await fetchIsolated({
      ragFocus: 'matched', userArchetype: 'floral', secondaryArchetype: state.secondaryArchetype,
    });
    const primaryIndexes = result.slices.map((s, i) => (s.slice === 'primary' ? i : -1)).filter(i => i !== -1);
    const secondaryIndexes = result.slices.map((s, i) => (s.slice === 'secondary' ? i : -1)).filter(i => i !== -1);
    expect(primaryIndexes.length).toBeGreaterThan(0);
    expect(secondaryIndexes.length).toBeGreaterThan(0);
    expect(Math.max(...primaryIndexes)).toBeLessThan(Math.min(...secondaryIndexes));
    expect(result.fitText).toContain('[primary]');
    expect(result.fitText).toContain('[second archetype]');
  }, 20000);

  it('matched focus: a customer with slot candidates gets [palate match] first', async () => {
    const result = await fetchIsolated({
      ragFocus: 'matched', userArchetype: 'floral', secondaryArchetype: state.secondaryArchetype,
      slotCandidates: [{ coffee_id: state.earthy[0], already_bought: false, last_rating: null }],
    });
    expect(result.slices[0]).toEqual({ coffeeId: state.earthy[0], slice: 'palate' });
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
      slot = await slotId('balanced_sweet');
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
