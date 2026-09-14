// Catalog Blueprint · brief 2 (2026-09-14), extended in brief 4 (2026-09-14)
// with the new admin GET reads (Part A/D) and the newly-retired legacy GETs.
// Same pattern as admin.roasters.test.ts: requireAdmin mocked to a
// passthrough, a real HTTP server wrapping the real router, real DB.
// Requires DATABASE_URL.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../middleware/auth.js', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

const { default: adminRouter } = await import('./admin.js');
const { db } = await import('../db/client.js');
const { createCoffee, setMatchArchetype, upsertSku, placeCoffee, setHop } = await import('../services/catalogService.js');
const { apiEventLog } = await import('../middleware/apiEventLog.js');

let server: Server;
let baseUrl: string;

const ACTOR = { actor: 'vitest' };
const WEIGHT_OZ = 12;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // GET /catalog/changes reads api_event — mount the same capture-first
  // middleware index.ts does, in the same order (after express.json(), before
  // the router), or every write this test file makes would be invisible to it.
  app.use(apiEventLog);
  app.use('/api/admin', adminRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/admin`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function slotId(archetype: string, sortOrder: number): Promise<number> {
  return (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [archetype, sortOrder])).rows[0].id;
}
async function cleanup(roaster: { id: string } | undefined, coffeeIds: number[], slotIds: number[] = []) {
  await db.query(`DELETE FROM dial_coffee_relationships WHERE from_coffee_id = ANY($1::int[]) OR to_coffee_id = ANY($1::int[])`, [coffeeIds]);
  if (coffeeIds.length) {
    await db.query('DELETE FROM coffee_slot_assignment WHERE coffee_id = ANY($1::int[])', [coffeeIds]);
    await db.query('DELETE FROM archetype_assignments WHERE coffee_id = ANY($1::int[])', [coffeeIds]);
    await db.query('DELETE FROM roaster_blend WHERE coffee_id = ANY($1::int[])', [coffeeIds]);
    await db.query('DELETE FROM coffees WHERE id = ANY($1::int[])', [coffeeIds]);
  }
  if (slotIds.length) await db.query('DELETE FROM dial_slot_price WHERE slot_id = ANY($1::int[]) AND weight_oz = $2', [slotIds, WEIGHT_OZ]);
  if (roaster) await db.query('DELETE FROM roaster WHERE id = $1', [roaster.id]);
}

describe('retired placement endpoints', () => {
  const retired: Array<[string, string]> = [
    ['POST', '/coffees'],
    ['PATCH', '/coffees/1'],
    ['DELETE', '/coffees/1'],
    ['POST', '/coffees/1/archetype'],
    ['POST', '/coffee-alias'],
    ['PATCH', '/coffee-alias/slot'],
    ['PATCH', '/coffee-alias/1'],
    ['PATCH', '/slot-prices'],
    ['PATCH', '/dial/vocabulary/1'],
    ['POST', '/dial/positions'],
    ['PATCH', '/dial/positions/1'],
    ['DELETE', '/dial/positions/1'],
    ['POST', '/dial/positions/guest'],
    ['DELETE', '/dial/positions/guest/1'],
    ['POST', '/dial/relationships'],
    ['DELETE', '/dial/relationships/1'],
    ['PATCH', '/inventory/1'],
    ['POST', '/inventory/1/restock'],
    // Catalog Blueprint brief 4 — legacy admin GETs retired this brief.
    ['GET', '/archetypes'],
    ['GET', '/coffees'],
    ['GET', '/dial/slot-aliases'],
    ['GET', '/coffee-alias'],
    ['GET', '/slot-prices'],
    ['GET', '/dial/graph'],
    ['GET', '/dial/positions'],
    ['GET', '/dial/dimension-config'],
    ['GET', '/dial/navigation'],
    ['GET', '/dial/hop-suggestions'],
    ['GET', '/dial/archetype-adjacency'],
    ['GET', '/dial/vocabulary'],
    ['GET', '/inventory/coffees-lookup'],
    ['GET', '/inventory'],
  ];

  for (const [method, path] of retired) {
    it(`${method} ${path} returns 410`, async () => {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('RETIRED');
    });
  }
});

// coffee-prices is NOT retired — coffee_retail_price is a separate, still-live
// pricing mechanism for category coffees (decaf/half_caf/flavored/experimental),
// unrelated to dial_slot_price/placement (Task 0 deviation, see closing report).
describe('GET /coffee-prices (not retired — a different table, D2 category pricing)', () => {
  it('is still a real 200, not 410', async () => {
    const res = await fetch(`${baseUrl}/coffee-prices`);
    expect(res.status).toBe(200);
  });
});

describe('POST /catalog/coffees', () => {
  it('returns 400 INVALID_INPUT without roasterId', async () => {
    const res = await fetch(`${baseUrl}/catalog/coffees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Vitest Route Test Coffee' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_INPUT');
  });
});

describe('Catalog Blueprint brief 4 — new admin reads', () => {
  it('GET /catalog/slots shows occupants + sellable_12oz + prices on a fixture', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    let slot: number | undefined;
    try {
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Catalog GET Roastery', true) RETURNING id`)).rows[0];
      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Catalog GET Coffee' }, ACTOR);
      coffeeId = created.coffeeId;
      await setMatchArchetype({ coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, ACTOR);
      slot = await slotId('earthy', 1);
      await upsertSku({ coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Catalog GET Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId, slotId: slot, role: 'home' }, ACTOR);
      await db.query(
        `INSERT INTO dial_slot_price (archetype, dial_sort_order, weight_oz, retail_price_cents, slot_id) VALUES ('earthy', 1, $2, 1800, $1)`,
        [slot, WEIGHT_OZ]
      );

      const res = await fetch(`${baseUrl}/catalog/slots?archetype=earthy`);
      expect(res.status).toBe(200);
      const slots = await res.json();
      expect(slots).toHaveLength(4);
      const targetSlot = slots.find((s: { id: number }) => s.id === slot);
      expect(targetSlot.occupants).toHaveLength(1);
      expect(targetSlot.occupants[0].coffee_id).toBe(coffeeId);
      expect(targetSlot.sellable_12oz).toBe(true);
      expect(targetSlot.sellable_12oz_coffee_id).toBe(coffeeId);
      expect(targetSlot.prices).toEqual(expect.arrayContaining([expect.objectContaining({ weight_oz: '12', retail_price_cents: 1800 })]));
    } finally {
      await cleanup(roaster, coffeeId ? [coffeeId] : [], slot ? [slot] : []);
    }
  }, 20000);

  it('GET /catalog/graph returns 24 slots and the fixture placement + hop', async () => {
    let roaster: { id: string } | undefined;
    let fromId: number | undefined;
    let toId: number | undefined;
    let hopId: number | undefined;
    const slotIds: number[] = [];
    try {
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Graph Roastery', true) RETURNING id`)).rows[0];
      const dimension = (await db.query<{ id: number }>(`SELECT id FROM coffee_dimensions LIMIT 1`)).rows[0];

      const { result: fromCreated } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Graph From' }, ACTOR);
      fromId = fromCreated.coffeeId;
      await setMatchArchetype({ coffeeId: fromId, archetype: 'fruity', confidence: 'high', source: 'manual' }, ACTOR);
      const fromSlot = await slotId('fruity', 2);
      slotIds.push(fromSlot);
      await placeCoffee({ coffeeId: fromId, slotId: fromSlot, role: 'home' }, ACTOR);

      const { result: toCreated } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Graph To' }, ACTOR);
      toId = toCreated.coffeeId;
      await setMatchArchetype({ coffeeId: toId, archetype: 'fruity', confidence: 'high', source: 'manual' }, ACTOR);
      const toSlot = await slotId('fruity', 3);
      slotIds.push(toSlot);
      await placeCoffee({ coffeeId: toId, slotId: toSlot, role: 'home' }, ACTOR);

      const { result: hopCreated } = await setHop(
        { fromCoffeeId: fromId, toCoffeeId: toId, dimensionId: dimension.id, direction: 'more', isRecommended: true, confidence: 'high' },
        ACTOR
      );
      hopId = hopCreated.hopId;

      const res = await fetch(`${baseUrl}/catalog/graph`);
      expect(res.status).toBe(200);
      const graph = await res.json();
      expect(graph.slots).toHaveLength(24);
      const fromSlotRow = graph.slots.find((s: { id: number }) => s.id === fromSlot);
      expect(fromSlotRow.occupants.some((o: { coffee_id: number }) => o.coffee_id === fromId)).toBe(true);
      expect(graph.hops.some((h: { id: number }) => h.id === hopId)).toBe(true);
    } finally {
      if (hopId) await db.query('DELETE FROM dial_coffee_relationships WHERE id = $1', [hopId]);
      await cleanup(roaster, [fromId, toId].filter((id): id is number => id != null), slotIds);
    }
  }, 20000);

  it('GET /catalog/not-sellable lists a placed-unpriced fixture with no_price_12oz', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    let slot: number | undefined;
    try {
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest NotSellable Roastery', true) RETURNING id`)).rows[0];
      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest NotSellable Coffee' }, ACTOR);
      coffeeId = created.coffeeId;
      await setMatchArchetype({ coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, ACTOR);
      slot = await slotId('earthy', 4);
      // Capture/clear/restore whatever real price already exists — dial_slot_price
      // is real pre-existing business config, same hazard brief 3's tests hit.
      const existing = (await db.query<{ retail_price_cents: number }>(`SELECT retail_price_cents FROM dial_slot_price WHERE slot_id = $1 AND weight_oz = $2`, [slot, WEIGHT_OZ])).rows[0];
      if (existing) await db.query('DELETE FROM dial_slot_price WHERE slot_id = $1 AND weight_oz = $2', [slot, WEIGHT_OZ]);
      await upsertSku({ coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest NotSellable Blend', isActive: true }, ACTOR);
      await placeCoffee({ coffeeId, slotId: slot, role: 'home' }, ACTOR);

      const res = await fetch(`${baseUrl}/catalog/not-sellable`);
      expect(res.status).toBe(200);
      const rows = await res.json();
      const row = rows.find((r: { slot_id: number }) => r.slot_id === slot);
      expect(row).toBeTruthy();
      expect(row.coffee_id).toBe(coffeeId);
      expect(row.reasons).toContain('no_price_12oz');

      if (existing) await db.query(
        `INSERT INTO dial_slot_price (archetype, dial_sort_order, weight_oz, retail_price_cents, slot_id)
         SELECT archetype, sort_order, $2, $3, id FROM coffee_dial_slot WHERE id = $1 ON CONFLICT DO NOTHING`,
        [slot, WEIGHT_OZ, existing.retail_price_cents]
      );
    } finally {
      await cleanup(roaster, coffeeId ? [coffeeId] : []);
    }
  }, 20000);

  it('GET /catalog/changes returns the write just made, with its call_type', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Changes Roastery', true) RETURNING id`)).rows[0];
      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Changes Coffee' }, ACTOR);
      coffeeId = created.coffeeId;

      // A create call's own request body has no coffeeId to parse (the coffee
      // doesn't exist yet) — this route has :id in the path itself
      // (…/coffees/:id/match), which is what getChanges actually parses.
      const matchRes = await fetch(`${baseUrl}/catalog/coffees/${coffeeId}/match`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archetype: 'earthy', confidence: 'high', source: 'manual' }),
      });
      expect(matchRes.status).toBe(200);

      // api_event's own writes are fire-and-forget (never awaited in the
      // request/response cycle, by design — middleware/apiEventLog.ts's own
      // "can never slow a request" requirement) — poll briefly rather than
      // assume the UPDATE landed before this test's next fetch does.
      let changes: Array<{ verb: string; coffee_id: number | null; status: number | null }> = [];
      let matchChange: { verb: string; coffee_id: number | null; status: number | null } | undefined;
      for (let attempt = 0; attempt < 20 && !matchChange; attempt++) {
        const res = await fetch(`${baseUrl}/catalog/changes?limit=20&coffee_id=${coffeeId}`);
        expect(res.status).toBe(200);
        changes = await res.json();
        matchChange = changes.find((c) => c.verb === 'PUT /api/admin/catalog/coffees/:id/match');
        if (!matchChange) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(matchChange).toBeTruthy();
      expect(matchChange!.coffee_id).toBe(coffeeId);
      expect(matchChange!.status).toBe(200);
    } finally {
      await cleanup(roaster, coffeeId ? [coffeeId] : []);
    }
  }, 20000);

  it('PUT /catalog/archetypes/:code/descriptor-families validates against real wheel_category values', async () => {
    const badRes = await fetch(`${baseUrl}/catalog/archetypes/floral/descriptor-families`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ families: ['Not A Real Wheel Category'] }),
    });
    expect(badRes.status).toBe(400);

    // Round-trip a real edit, then restore floral's original families —
    // this is real, shared archetype config, not a disposable fixture.
    const before = (await db.query<{ descriptor_families: string[] }>(`SELECT descriptor_families FROM archetype WHERE code = 'floral'`)).rows[0].descriptor_families;
    try {
      const goodRes = await fetch(`${baseUrl}/catalog/archetypes/floral/descriptor-families`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ families: ['Floral'] }),
      });
      expect(goodRes.status).toBe(200);
      const updated = (await db.query<{ descriptor_families: string[] }>(`SELECT descriptor_families FROM archetype WHERE code = 'floral'`)).rows[0].descriptor_families;
      expect(updated).toEqual(['Floral']);
    } finally {
      await db.query(`UPDATE archetype SET descriptor_families = $1 WHERE code = 'floral'`, [before]);
    }
  });
});
