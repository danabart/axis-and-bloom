// Flavor Intelligence Part 1 — regression coverage for the new/changed public
// (no-auth) endpoints on this router. Requires DATABASE_URL pointed at a reachable
// Postgres instance (e.g. the Cloud SQL Auth Proxy — see
// axis_and_bloom_local_cloudsql_testing memory / README) and NODE_ENV set before
// `npm test` runs, same as `npm run dev`.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import coffeesRouter, { computeDoorMap, assertDoorMapInvariants } from './coffees.js';
import { db } from '../db/client.js';
import { createCoffee, setMatchArchetype, upsertSku, placeCoffee, setSlotPrice, setHop } from '../services/catalogService.js';

let server: Server;
let baseUrl: string;

const CATALOG_ACTOR = { actor: 'vitest' };
const CATALOG_WEIGHT_OZ = 12;

// Catalog Blueprint brief 3 — a single shared "active slot" fixture (built
// through catalogService, not the retired coffee_alias/dial_archetype_positions
// tables) for the /legacy-slot and /content tests below, which each just need
// *some* real active slot to exist (N3: the catalog starts empty, so nothing
// is active until a test places something).
let sharedFixture: { roasterId: string; coffeeId: number; slotId: number; archetype: string; sortOrder: number };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/coffees', coffeesRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/coffees`;

  const roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Coffees Shared Roastery', true) RETURNING id`)).rows[0];
  const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Coffees Shared Coffee' }, CATALOG_ACTOR);
  await setMatchArchetype({ coffeeId: created.coffeeId, archetype: 'floral', confidence: 'high', source: 'manual' }, CATALOG_ACTOR);
  const slot = (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = 'floral' AND sort_order = 1`)).rows[0];
  await upsertSku({ coffeeId: created.coffeeId, weightOz: CATALOG_WEIGHT_OZ, blendName: 'Vitest Coffees Shared Blend', isActive: true }, CATALOG_ACTOR);
  await placeCoffee({ coffeeId: created.coffeeId, slotId: slot.id, role: 'home' }, CATALOG_ACTOR);
  await setSlotPrice({ slotId: slot.id, weightOz: CATALOG_WEIGHT_OZ, retailPriceCents: 1800 }, CATALOG_ACTOR);
  sharedFixture = { roasterId: roaster.id, coffeeId: created.coffeeId, slotId: slot.id, archetype: 'floral', sortOrder: 1 };
}, 20000);

afterAll(async () => {
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_sku WHERE blend_name LIKE 'Vitest%' OR coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_slot_price WHERE slot_id = $1 AND weight_oz = $2`, [sharedFixture.slotId, CATALOG_WEIGHT_OZ]);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('GET /api/coffees/archetypes', () => {
  it('returns every archetype with isDefault on every slot, and at most one isDefault=true per archetype among is_archetype rows', async () => {
    const res = await fetch(`${baseUrl}/archetypes`);
    expect(res.status).toBe(200);
    const archetypes = await res.json();
    expect(Array.isArray(archetypes)).toBe(true);
    expect(archetypes.length).toBeGreaterThan(0);

    for (const arch of archetypes) {
      expect(Array.isArray(arch.slots)).toBe(true);
      for (const slot of arch.slots) {
        expect(slot).toHaveProperty('isDefault');
        expect(typeof slot.isDefault).toBe('boolean');
        // Roaster-blind: never a raw coffee name or roaster string anywhere in a slot.
        expect(slot).not.toHaveProperty('roaster');
        expect(slot).not.toHaveProperty('name');
      }
      const defaultCount = arch.slots.filter((s: any) => s.isDefault).length;
      expect(defaultCount).toBeLessThanOrEqual(1);
    }
  }, 20000); // sequential per-slot DB round trips over the Cloud SQL proxy tunnel
});

// Part 19 §A, revised — the door map used to be derived per-archetype from
// bridge_archetype hop data, which live QA found could produce an archetype
// whose left and right doors were the SAME target, and seams that weren't
// walkable both ways (A's right door pointing at B without B's left door
// pointing back at A). Replaced with one fixed symmetric chain around
// CANONICAL_ARCHETYPE_ORDER; these tests pin both the exact 6x2 map (so a
// future edit to the chain is a visible, deliberate diff) and the invariant
// checker itself (so it isn't just quietly passing because the current data
// happens to be fine — it has to actually catch a broken map too).
describe('Bloom Dial door map (Part 19 §A)', () => {
  it('matches the canonical Floral<->Fruity<->Balanced&Sweet<->Chocolate&Nutty<->Earthy<->Experimental<->Floral chain', async () => {
    const doorMap = await computeDoorMap();
    const expected: Record<string, { left: string; right: string }> = {
      floral: { left: 'experimental', right: 'fruity' },
      fruity: { left: 'floral', right: 'balanced_sweet' },
      balanced_sweet: { left: 'fruity', right: 'chocolate_nutty' },
      chocolate_nutty: { left: 'balanced_sweet', right: 'earthy' },
      earthy: { left: 'chocolate_nutty', right: 'experimental' },
      experimental: { left: 'earthy', right: 'floral' },
    };
    for (const archetype of Object.keys(expected)) {
      expect(doorMap[archetype].left.archetype).toBe(expected[archetype].left);
      expect(doorMap[archetype].right.archetype).toBe(expected[archetype].right);
      expect(doorMap[archetype].left.rule).toBe('chain');
      expect(doorMap[archetype].right.rule).toBe('chain');
    }
  });

  it('is internally symmetric: every door is walkable back through', async () => {
    const doorMap = await computeDoorMap();
    // Re-run the same invariant the module asserts at startup — proves the
    // live map still satisfies it, not just that startup didn't crash once.
    expect(() => assertDoorMapInvariants(doorMap)).not.toThrow();
    for (const archetype of Object.keys(doorMap)) {
      expect(doorMap[archetype].left.archetype).not.toBe(doorMap[archetype].right.archetype);
    }
  });

  it('assertDoorMapInvariants actually catches a broken map (both doors the same target)', () => {
    const broken = {
      floral: { left: { archetype: 'fruity', archetypeLabel: 'Fruity', rule: 'chain' as const }, right: { archetype: 'fruity', archetypeLabel: 'Fruity', rule: 'chain' as const } },
      fruity: { left: { archetype: 'floral', archetypeLabel: 'Floral', rule: 'chain' as const }, right: { archetype: 'floral', archetypeLabel: 'Floral', rule: 'chain' as const } },
    };
    expect(() => assertDoorMapInvariants(broken)).toThrow(/left and right doors are both/);
  });

  it('assertDoorMapInvariants actually catches a broken map (asymmetric seam)', () => {
    // north's right door is east — but east's left door points at south,
    // not back at north. Each node's own left/right still differ (so this
    // isn't the "both doors the same" case above), it's specifically an
    // unwalkable seam: exactly the live Fruity/Balanced defect this
    // chain replaced (Fruity's door pointed at Balanced, but
    // Balanced's matching door didn't point back).
    const chain = (l: string, r: string) => ({
      left: { archetype: l, archetypeLabel: l, rule: 'chain' as const },
      right: { archetype: r, archetypeLabel: r, rule: 'chain' as const },
    });
    const broken = {
      north: chain('south', 'east'),
      east: chain('south', 'west'), // broken: should be chain('north', ...)
    };
    expect(() => assertDoorMapInvariants(broken)).toThrow(/north's right door is east, but east's left door is south, not north/);
  });
});

describe('GET /api/coffees/archetype-stats', () => {
  it('returns dimension rows (null-safe) for a valid archetype', async () => {
    const res = await fetch(`${baseUrl}/archetype-stats?archetype=chocolate_nutty`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archetype).toBe('chocolate_nutty');
    expect(body.archetypeLabel).toBe('Chocolate & Nutty');
    expect(Array.isArray(body.dimensions)).toBe(true);
    expect(body.dimensions.length).toBeGreaterThan(0);
    for (const dim of body.dimensions) {
      expect(dim).toHaveProperty('avgActual'); // present even when null — not omitted
      expect(dim).toHaveProperty('coffeeCount');
      expect(typeof dim.coffeeCount).toBe('number');
    }
  });

  it('400s on an unknown archetype instead of returning an empty/misleading 200', async () => {
    const res = await fetch(`${baseUrl}/archetype-stats?archetype=not_a_real_archetype`);
    expect(res.status).toBe(400);
  });

  it('400s when archetype is missing entirely', async () => {
    const res = await fetch(`${baseUrl}/archetype-stats`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/coffees/:id/legacy-slot', () => {
  it('resolves a real, currently-assigned coffeeId to its archetype + dialSortOrder', async () => {
    const res = await fetch(`${baseUrl}/${sharedFixture.coffeeId}/legacy-slot`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archetype).toBe(sharedFixture.archetype);
    expect(body.dialSortOrder).toBe(sharedFixture.sortOrder);
  }, 20000);

  it('404s for a coffeeId with no live archetype assignment', async () => {
    const res = await fetch(`${baseUrl}/999999999/legacy-slot`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/coffees/:id/content', () => {
  it('includes process/roastLevel/originRegion, never roaster/name/exact origin', async () => {
    const res = await fetch(`${baseUrl}/${sharedFixture.coffeeId}/content`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('process');
    expect(body).toHaveProperty('roastLevel');
    expect(body).toHaveProperty('originRegion');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/Path Coffee Roasters|Temecula Coffee Roasters|Vitest Coffees Shared Roastery|Vitest Coffees Shared Coffee/);
  }, 30000); // may trigger AI content generation on first call
});

// Roastery lifecycle (2026-08-25) — every fixture below is created and
// deleted by the test itself; none of this touches a real Path/Temecula row.
// Requires the roastery-lifecycle schema applied (coffees.is_active and the
// matching roaster_blend/coffee_alias columns) — cannot run against a
// pre-migration database.
describe('GET /api/coffees/archetypes — inactive coffees', () => {
  it('an inactive coffee never fills a slot, even one it would otherwise occupy alone', async () => {
    // Catalog Blueprint brief 3 — placed through catalogService onto a slot
    // of its own (earthy/2, distinct from sharedFixture's floral/1), not the
    // retired coffee_alias/dial_archetype_positions tables.
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    let slot: { id: number } | undefined;
    try {
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Open-Slot Roastery', true) RETURNING id`)).rows[0];
      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Open-Slot Coffee' }, CATALOG_ACTOR);
      coffeeId = created.coffeeId;
      await setMatchArchetype({ coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, CATALOG_ACTOR);
      slot = (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = 'earthy' AND sort_order = 2`)).rows[0];
      await upsertSku({ coffeeId, weightOz: CATALOG_WEIGHT_OZ, blendName: 'Vitest Open-Slot Blend', isActive: true }, CATALOG_ACTOR);
      await placeCoffee({ coffeeId, slotId: slot.id, role: 'home' }, CATALOG_ACTOR);
      await setSlotPrice({ slotId: slot.id, weightOz: CATALOG_WEIGHT_OZ, retailPriceCents: 1800 }, CATALOG_ACTOR);

      const findSlot = async () => {
        const res = await fetch(`${baseUrl}/archetypes`);
        const archetypes = await res.json();
        const arch = archetypes.find((a: any) => a.archetype === 'earthy');
        return arch?.slots?.find((s: any) => s.dialSortOrder === 2);
      };

      const whileActive = await findSlot();
      expect(whileActive?.isActive).toBe(true);

      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [coffeeId]);

      const whileInactive = await findSlot();
      expect(whileInactive?.isActive).toBe(false);
    } finally {
      if (coffeeId) {
        await db.query('DELETE FROM coffee_slot_assignment WHERE coffee_id = $1', [coffeeId]);
        await db.query('DELETE FROM coffee_archetype_assignment WHERE coffee_id = $1', [coffeeId]);
        await db.query('DELETE FROM coffee_sku WHERE coffee_id = $1', [coffeeId]);
        await db.query('DELETE FROM coffees WHERE id = $1', [coffeeId]);
      }
      if (slot) await db.query('DELETE FROM coffee_slot_price WHERE slot_id = $1 AND weight_oz = $2', [slot.id, CATALOG_WEIGHT_OZ]);
      if (roaster) await db.query('DELETE FROM roaster WHERE id = $1', [roaster.id]);
    }
  }, 20000);
});

describe('GET /api/coffees/:id/story — inactive coffees stay reachable (Decision 5)', () => {
  it('still serves a story for an inactive coffee — only browse/recommend surfaces drop it, never an id-addressed read', async () => {
    // coffees.roaster (free text) dropped by Catalog Blueprint brief 5a —
    // roaster_id (NOT NULL) needs a real roaster row now.
    const roaster = (await db.query<{ id: string }>(
      `INSERT INTO roaster (name, is_active) VALUES ('Vitest Story Roastery', true) RETURNING id`
    )).rows[0];
    const coffee = (await db.query(
      `INSERT INTO coffees (name, roaster_id, is_active, story, story_published)
       VALUES ('Vitest Story Coffee', $1, false, 'A vitest-only story.', true) RETURNING id`,
      [roaster.id]
    )).rows[0];
    try {
      const res = await fetch(`${baseUrl}/${coffee.id}/story`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.story).toBe('A vitest-only story.');
    } finally {
      await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
      await db.query('DELETE FROM roaster WHERE id = $1', [roaster.id]);
    }
  });
});

describe('GET /api/coffees/:coffeeId/hops — inactive targets', () => {
  it('never returns an inactive target, and still returns up to 3 active ones when available', async () => {
    // Catalog Blueprint brief 3 — source and each target placed+priced through
    // catalogService (v_coffee_hop/getHops, not dial_coffee_relationships
    // directly; a target must be home + sellable at 12oz to surface at all —
    // D2). Four targets across four distinct fruity slots so each resolves
    // its own home placement.
    let roaster: { id: string } | undefined;
    let sourceId: number | undefined;
    const targets: Array<{ coffeeId: number; slotId: number; hopId: number; sortOrder: number }> = [];
    try {
      const dimension = (await db.query<{ id: number }>(`SELECT id FROM coffee_dimensions LIMIT 1`)).rows[0];
      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Hop Roastery', true) RETURNING id`)).rows[0];

      const { result: sourceCreated } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Hop Source' }, CATALOG_ACTOR);
      sourceId = sourceCreated.coffeeId;

      for (let sortOrder = 1; sortOrder <= 4; sortOrder++) {
        const { result: targetCreated } = await createCoffee({ roasterId: roaster.id, name: `Vitest Hop Target ${sortOrder}` }, CATALOG_ACTOR);
        await setMatchArchetype({ coffeeId: targetCreated.coffeeId, archetype: 'fruity', confidence: 'high', source: 'manual' }, CATALOG_ACTOR);
        const slot = (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = 'fruity' AND sort_order = $1`, [sortOrder])).rows[0];
        await upsertSku({ coffeeId: targetCreated.coffeeId, weightOz: CATALOG_WEIGHT_OZ, blendName: `Vitest Hop Target ${sortOrder} Blend`, isActive: true }, CATALOG_ACTOR);
        await placeCoffee({ coffeeId: targetCreated.coffeeId, slotId: slot.id, role: 'home' }, CATALOG_ACTOR);
        await setSlotPrice({ slotId: slot.id, weightOz: CATALOG_WEIGHT_OZ, retailPriceCents: 1600 }, CATALOG_ACTOR);
        const { result: hopCreated } = await setHop(
          { fromCoffeeId: sourceId, toCoffeeId: targetCreated.coffeeId, dimensionId: dimension.id, direction: 'more', isRecommended: true, confidence: 'high' },
          CATALOG_ACTOR
        );
        targets.push({ coffeeId: targetCreated.coffeeId, slotId: slot.id, hopId: hopCreated.hopId, sortOrder });
      }

      // Deactivate one target — it must never appear, and the other three
      // (still >= 3 active) must still fill all 3 slots the endpoint caps at.
      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [targets[0].coffeeId]);

      const res = await fetch(`${baseUrl}/${sourceId}/hops`);
      expect(res.status).toBe(200);
      const hops = await res.json();
      expect(hops.length).toBe(3);
      // The inactive target's own (archetype, dialSortOrder) must not appear among the returned hops.
      expect(hops.some((h: any) => h.target.archetype === 'fruity' && h.target.dialSortOrder === targets[0].sortOrder)).toBe(false);
    } finally {
      const targetIds = targets.map(t => t.coffeeId);
      const slotIds = targets.map(t => t.slotId);
      await db.query(`DELETE FROM coffee_hop WHERE from_coffee_id = $1 OR to_coffee_id = ANY($2::int[])`, [sourceId ?? 0, targetIds]);
      if (targetIds.length) {
        await db.query('DELETE FROM coffee_slot_assignment WHERE coffee_id = ANY($1::int[])', [targetIds]);
        await db.query('DELETE FROM coffee_archetype_assignment WHERE coffee_id = ANY($1::int[])', [targetIds]);
        await db.query('DELETE FROM coffee_sku WHERE coffee_id = ANY($1::int[])', [targetIds]);
      }
      if (slotIds.length) await db.query('DELETE FROM coffee_slot_price WHERE slot_id = ANY($1::int[]) AND weight_oz = $2', [slotIds, CATALOG_WEIGHT_OZ]);
      if (sourceId) await db.query('DELETE FROM coffees WHERE id = $1', [sourceId]);
      if (targetIds.length) await db.query('DELETE FROM coffees WHERE id = ANY($1::int[])', [targetIds]);
      if (roaster) await db.query('DELETE FROM roaster WHERE id = $1', [roaster.id]);
    }
  }, 30000);
});
