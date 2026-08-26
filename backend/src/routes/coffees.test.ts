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

let server: Server;
let baseUrl: string;

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
});

afterAll(async () => {
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
    // unwalkable seam: exactly the live Fruity/Balanced & Sweet defect this
    // chain replaced (Fruity's door pointed at Balanced & Sweet, but
    // Balanced & Sweet's matching door didn't point back).
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
    const archRes = await fetch(`${baseUrl}/archetypes`);
    const archetypes = await archRes.json();
    const activeSlot = archetypes.flatMap((a: any) => a.slots).find((s: any) => s.isActive);
    expect(activeSlot).toBeTruthy();

    const res = await fetch(`${baseUrl}/${activeSlot.coffeeId}/legacy-slot`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('archetype');
    expect(body.dialSortOrder).toBe(activeSlot.dialSortOrder);
  }, 20000);

  it('404s for a coffeeId with no live archetype assignment', async () => {
    const res = await fetch(`${baseUrl}/999999999/legacy-slot`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/coffees/:id/content', () => {
  it('includes process/roastLevel/originRegion, never roaster/name/exact origin', async () => {
    const archRes = await fetch(`${baseUrl}/archetypes`);
    const archetypes = await archRes.json();
    const activeSlot = archetypes.flatMap((a: any) => a.slots).find((s: any) => s.isActive);
    expect(activeSlot).toBeTruthy();

    const res = await fetch(`${baseUrl}/${activeSlot.coffeeId}/content`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('process');
    expect(body).toHaveProperty('roastLevel');
    expect(body).toHaveProperty('originRegion');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/Path Coffee Roasters|Temecula Coffee Roasters/);
  }, 30000); // may trigger AI content generation on first call
});

// Roastery lifecycle (2026-08-25) — every fixture below is created and
// deleted by the test itself; none of this touches a real Path/Temecula row.
// Requires the roastery-lifecycle schema applied (coffees.is_active and the
// matching roaster_blend/coffee_alias columns) — cannot run against a
// pre-migration database.
describe('GET /api/coffees/archetypes — inactive coffees', () => {
  it('an inactive coffee never fills a slot, even one it would otherwise occupy alone', async () => {
    // A genuinely open slot — no active coffee_alias row and no home
    // dial_archetype_positions row for it — so seeding it with exactly one
    // fixture coffee makes that fixture the only possible occupant.
    const openSlot = (await db.query(`
      SELECT dpv.archetype, dpv.sort_order
      FROM dial_position_vocabulary dpv
      LEFT JOIN coffee_alias ca ON ca.archetype = dpv.archetype AND ca.dial_sort_order = dpv.sort_order AND ca.is_active = true
      LEFT JOIN dial_archetype_positions dap ON dap.archetype = dpv.archetype AND dap.vocabulary_id = dpv.id AND dap.is_guest = false
      WHERE ca.id IS NULL AND dap.id IS NULL
      LIMIT 1
    `)).rows[0];
    if (!openSlot) return; // every slot currently occupied — nothing to seed safely, skip rather than risk a real slot

    const coffee = (await db.query(
      `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest Open-Slot Coffee', 'Vitest Roastery', true) RETURNING id`
    )).rows[0];
    const alias = (await db.query(
      `INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
       VALUES ('Vitest Open-Slot Alias', $1, $2, $3, 1, true) RETURNING id`,
      [openSlot.archetype, openSlot.sort_order, coffee.id]
    )).rows[0];
    const blend = (await db.query(
      `INSERT INTO roaster_blend (blend_name, coffee_id, weight_oz, is_active) VALUES ('Vitest Open-Slot Blend', $1, 12, true) RETURNING id`,
      [coffee.id]
    )).rows[0];

    try {
      const findSlot = async () => {
        const res = await fetch(`${baseUrl}/archetypes`);
        const archetypes = await res.json();
        const arch = archetypes.find((a: any) => a.archetype === openSlot.archetype);
        return arch?.slots?.find((s: any) => s.dialSortOrder === openSlot.sort_order);
      };

      const whileActive = await findSlot();
      expect(whileActive?.isActive).toBe(true);

      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [coffee.id]);

      const whileInactive = await findSlot();
      expect(whileInactive?.isActive).toBe(false);
    } finally {
      await db.query('DELETE FROM roaster_blend WHERE id = $1', [blend.id]);
      await db.query('DELETE FROM coffee_alias WHERE id = $1', [alias.id]);
      await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  }, 20000);
});

describe('GET /api/coffees/:id/story — inactive coffees stay reachable (Decision 5)', () => {
  it('still serves a story for an inactive coffee — only browse/recommend surfaces drop it, never an id-addressed read', async () => {
    const coffee = (await db.query(
      `INSERT INTO coffees (name, roaster, is_active, story, story_published)
       VALUES ('Vitest Story Coffee', 'Vitest Roastery', false, 'A vitest-only story.', true) RETURNING id`
    )).rows[0];
    try {
      const res = await fetch(`${baseUrl}/${coffee.id}/story`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.story).toBe('A vitest-only story.');
    } finally {
      await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  });
});

describe('GET /api/coffees/:coffeeId/hops — inactive targets', () => {
  it('never returns an inactive target, and still returns up to 3 active ones when available', async () => {
    const dimension = (await db.query(`SELECT id FROM coffee_dimensions LIMIT 1`)).rows[0];
    const source = (await db.query(
      `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest Hop Source', 'Vitest Roastery', true) RETURNING id`
    )).rows[0];

    // A genuinely open slot to seed each target coffee into, same reasoning
    // as the /archetypes test above — one open slot per target, so each
    // target actually resolves via resolveBlendForSlot.
    const openSlots = (await db.query(`
      SELECT dpv.archetype, dpv.sort_order
      FROM dial_position_vocabulary dpv
      LEFT JOIN coffee_alias ca ON ca.archetype = dpv.archetype AND ca.dial_sort_order = dpv.sort_order AND ca.is_active = true
      LEFT JOIN dial_archetype_positions dap ON dap.archetype = dpv.archetype AND dap.vocabulary_id = dpv.id AND dap.is_guest = false
      WHERE ca.id IS NULL AND dap.id IS NULL
      LIMIT 4
    `)).rows;
    if (openSlots.length < 4) { await db.query('DELETE FROM coffees WHERE id = $1', [source.id]); return; } // not enough open slots to seed 4 targets safely — skip

    const targets: Array<{ coffeeId: number; aliasId: number; blendId: string; hopId: number }> = [];
    try {
      for (const slot of openSlots) {
        const target = (await db.query(
          `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest Hop Target', 'Vitest Roastery', true) RETURNING id`
        )).rows[0];
        // The /hops route's dap join is `dap.archetype = aa.archetype` — without
        // a live archetype_assignments row, that join never matches, target_archetype
        // comes back NULL, and the route's own `if (!row.target_archetype) continue`
        // silently skips every hop (found live: this fixture originally omitted it,
        // and the test failed with 0 hops instead of 3 — a fixture bug, not a route bug).
        // ON DELETE CASCADE from coffees cleans this up with the target row, no
        // separate delete needed.
        await db.query(
          `INSERT INTO archetype_assignments (coffee_id, archetype, confidence) VALUES ($1, $2, 'high')`,
          [target.id, slot.archetype]
        );
        const alias = (await db.query(
          `INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
           VALUES ('Vitest Hop Target Alias', $1, $2, $3, 1, true) RETURNING id`,
          [slot.archetype, slot.sort_order, target.id]
        )).rows[0];
        const blend = (await db.query(
          `INSERT INTO roaster_blend (blend_name, coffee_id, weight_oz, is_active) VALUES ('Vitest Hop Target Blend', $1, 12, true) RETURNING id`,
          [target.id]
        )).rows[0];
        const hop = (await db.query(
          `INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence)
           VALUES ($1, $2, $3, 'more', 'bridge_archetype', true, 'high') RETURNING id`,
          [source.id, target.id, dimension.id]
        )).rows[0];
        targets.push({ coffeeId: target.id, aliasId: alias.id, blendId: blend.id, hopId: hop.id });
      }

      // Deactivate one target — it must never appear, and the other three
      // (still >= 3 active) must still fill all 3 slots the endpoint caps at.
      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [targets[0].coffeeId]);

      const res = await fetch(`${baseUrl}/${source.id}/hops`);
      expect(res.status).toBe(200);
      const hops = await res.json();
      expect(hops.length).toBe(3);
      // The inactive target's own (archetype, dialSortOrder) must not appear among the returned hops.
      const inactiveKey = `${openSlots[0].archetype}|${openSlots[0].sort_order}`;
      expect(hops.some((h: any) => `${h.target.archetype}|${h.target.dialSortOrder}` === inactiveKey)).toBe(false);
    } finally {
      for (const t of targets) {
        await db.query('DELETE FROM dial_coffee_relationships WHERE id = $1', [t.hopId]);
        await db.query('DELETE FROM roaster_blend WHERE id = $1', [t.blendId]);
        await db.query('DELETE FROM coffee_alias WHERE id = $1', [t.aliasId]);
        await db.query('DELETE FROM coffees WHERE id = $1', [t.coffeeId]);
      }
      await db.query('DELETE FROM coffees WHERE id = $1', [source.id]);
    }
  }, 20000);
});
