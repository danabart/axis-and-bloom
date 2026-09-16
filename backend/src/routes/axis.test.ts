// Roastery lifecycle — CTO review round (2026-08-26), rewritten for Catalog
// Blueprint brief 3 (2026-09-14). GET /api/axis/stats and /adjacency must
// exclude inactive coffees from every coffee-identity count (coffeesMapped,
// per-archetype coffeeCount, connectionCount, regionAdjacency/adjacency) —
// now derived from v_coffee (match_archetype) and v_coffee_hop/
// v_coffee_archetype_adjacency (home placement, D1/D3), so a fixture needs a real
// home placement, not just an archetype_assignments row — see routes/axis.ts's
// own comments.
//
// Requires DATABASE_URL pointed at a reachable Postgres instance with the
// Catalog Blueprint schema applied. Fixtures built through catalogService
// (createCoffee -> setMatchArchetype -> upsertSku -> placeCoffee -> setHop),
// `Vitest`-prefixed, cleanup in `finally` and `afterAll` (dependency order:
// dial_coffee_relationships -> coffee_slot_assignment ->
// archetype_assignments -> roaster_blend -> coffees -> roaster).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import axisRouter from './axis.js';
import { db } from '../db/client.js';
import { createCoffee, setMatchArchetype, upsertSku, placeCoffee, setHop } from '../services/catalogService.js';

let server: Server;
let baseUrl: string;

const ACTOR = { actor: 'vitest' };
const WEIGHT_OZ = 12;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/axis', axisRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/axis`;
});

afterAll(async () => {
  // Fixture-leak backstop (2026-08-26 hardening round) — the real safety net
  // if makeBridgeHopFixture() itself fails partway.
  await db.query(`DELETE FROM coffee_hop WHERE from_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%') OR to_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_sku WHERE blend_name LIKE 'Vitest%' OR coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function slotId(archetype: string, sortOrder: number): Promise<number> {
  return (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [archetype, sortOrder])).rows[0].id;
}

// A bridge hop (floral -> fruity) between two home-placed, sellable coffees —
// the real requirement for both v_coffee_hop.hop_type_derived and
// v_coffee_archetype_adjacency now that both are placement-derived (D1/D3).
async function makeBridgeHopFixture() {
  const roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Axis Roastery', true) RETURNING id`)).rows[0];
  const dimension = (await db.query<{ id: number }>(`SELECT id FROM coffee_dimensions LIMIT 1`)).rows[0];

  const { result: floralCreated } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Axis Floral' }, ACTOR);
  await setMatchArchetype({ coffeeId: floralCreated.coffeeId, archetype: 'floral', confidence: 'high', source: 'manual' }, ACTOR);
  const floralSlot = await slotId('floral', 3);
  await upsertSku({ coffeeId: floralCreated.coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Axis Floral Blend', isActive: true }, ACTOR);
  await placeCoffee({ coffeeId: floralCreated.coffeeId, slotId: floralSlot, role: 'home' }, ACTOR);

  const { result: fruityCreated } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Axis Fruity' }, ACTOR);
  await setMatchArchetype({ coffeeId: fruityCreated.coffeeId, archetype: 'fruity', confidence: 'high', source: 'manual' }, ACTOR);
  const fruitySlot = await slotId('fruity', 3);
  await upsertSku({ coffeeId: fruityCreated.coffeeId, weightOz: WEIGHT_OZ, blendName: 'Vitest Axis Fruity Blend', isActive: true }, ACTOR);
  await placeCoffee({ coffeeId: fruityCreated.coffeeId, slotId: fruitySlot, role: 'home' }, ACTOR);

  const { result: hopCreated } = await setHop(
    { fromCoffeeId: floralCreated.coffeeId, toCoffeeId: fruityCreated.coffeeId, dimensionId: dimension.id, direction: 'more', isRecommended: true, confidence: 'high' },
    ACTOR
  );

  return { roaster, floral: floralCreated.coffeeId, fruity: fruityCreated.coffeeId, hopId: hopCreated.hopId };
}

async function cleanup(f: Awaited<ReturnType<typeof makeBridgeHopFixture>>) {
  await db.query('DELETE FROM coffee_hop WHERE id = $1', [f.hopId]);
  await db.query('DELETE FROM coffee_slot_assignment WHERE coffee_id = ANY($1::int[])', [[f.floral, f.fruity]]);
  await db.query('DELETE FROM coffee_archetype_assignment WHERE coffee_id = ANY($1::int[])', [[f.floral, f.fruity]]);
  await db.query('DELETE FROM coffee_sku WHERE coffee_id = ANY($1::int[])', [[f.floral, f.fruity]]);
  await db.query('DELETE FROM coffees WHERE id = ANY($1::int[])', [[f.floral, f.fruity]]);
  await db.query('DELETE FROM roaster WHERE id = $1', [f.roaster.id]);
}

describe('GET /api/axis/adjacency — excludes inactive coffees', () => {
  it('the floral/fruity pair appears while both coffees are active, and disappears once one goes inactive', async () => {
    let f: Awaited<ReturnType<typeof makeBridgeHopFixture>> | undefined;
    try {
      f = await makeBridgeHopFixture();
      const before = await (await fetch(`${baseUrl}/adjacency`)).json();
      expect(before.adjacency.floral ?? []).toContain('fruity');

      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [f.fruity]);

      const after = await (await fetch(`${baseUrl}/adjacency`)).json();
      expect(after.adjacency.floral ?? []).not.toContain('fruity');
    } finally {
      if (f) {
        await db.query('UPDATE coffees SET is_active = true WHERE id = $1', [f.fruity]);
        await cleanup(f);
      }
    }
  }, 30000);
});

describe('GET /api/axis/stats — excludes inactive coffees from every count', () => {
  it('coffeesMapped, the floral archetype coffeeCount, and connectionCount all drop when a fixture coffee goes inactive', async () => {
    let f: Awaited<ReturnType<typeof makeBridgeHopFixture>> | undefined;
    try {
      f = await makeBridgeHopFixture();
      const before = await (await fetch(`${baseUrl}/stats`)).json();
      const floralBefore = before.archetypes.find((a: any) => a.key === 'floral')?.coffeeCount ?? 0;

      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [f.floral]);

      const after = await (await fetch(`${baseUrl}/stats`)).json();
      const floralAfter = after.archetypes.find((a: any) => a.key === 'floral')?.coffeeCount ?? 0;

      expect(after.coffeesMapped).toBe(before.coffeesMapped - 1);
      expect(floralAfter).toBe(floralBefore - 1);
      expect(after.connectionCount).toBe(before.connectionCount - 1); // the fixture's own bridge hop no longer counts
    } finally {
      if (f) {
        await db.query('UPDATE coffees SET is_active = true WHERE id = $1', [f.floral]);
        await cleanup(f);
      }
    }
  }, 30000);
});
