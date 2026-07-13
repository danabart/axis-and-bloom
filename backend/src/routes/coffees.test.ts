// Flavor Intelligence Part 1 — regression coverage for the new/changed public
// (no-auth) endpoints on this router. Requires DATABASE_URL pointed at a reachable
// Postgres instance (e.g. the Cloud SQL Auth Proxy — see
// axis_and_bloom_local_cloudsql_testing memory / README) and NODE_ENV set before
// `npm test` runs, same as `npm run dev`.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import coffeesRouter from './coffees.js';

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
