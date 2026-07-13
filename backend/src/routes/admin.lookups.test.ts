// Flavor Intelligence Part 1 Decision #9 — regression coverage for the new
// lookup_value CRUD endpoints and the origin_region resolution on
// PATCH /api/admin/coffees/:id. requireAdmin is mocked to a passthrough here —
// the auth-gating behavior itself (401 without a token, 403 for non-admins) is
// identical, already-live middleware shared by every other /api/admin/* route,
// separately confirmed with a real unauthenticated curl request against the
// running dev server. This file exercises the SQL/business logic behind the gate.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../middleware/auth.js', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

const { default: adminRouter } = await import('./admin.js');
const { db } = await import('../db/client.js');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
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

describe('lookup_value CRUD', () => {
  it('POST upserts on (category, value); a second POST with the same value updates label, not a new row', async () => {
    const first = await fetch(`${baseUrl}/lookups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'origin_region', value: 'test_region_vitest', label: 'Vitest Region' }),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await fetch(`${baseUrl}/lookups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'origin_region', value: 'test_region_vitest', label: 'Vitest Region Renamed' }),
    });
    expect(second.status).toBe(201);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.label).toBe('Vitest Region Renamed');

    // PATCH
    const patched = await fetch(`${baseUrl}/lookups/${firstBody.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Vitest Region Patched' }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).label).toBe('Vitest Region Patched');

    // DELETE (unused) succeeds
    const deleted = await fetch(`${baseUrl}/lookups/${firstBody.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
  });

  it('DELETE returns 409, not a raw Postgres error, when the value is still assigned to a coffee', async () => {
    const created = await fetch(`${baseUrl}/lookups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'origin_region', value: 'test_region_vitest_ref', label: 'Vitest Region Ref' }),
    });
    const { id: lookupId } = await created.json();

    const coffeeRow = (await db.query('SELECT id, origin_region_id FROM coffees ORDER BY id LIMIT 1')).rows[0];
    await db.query('UPDATE coffees SET origin_region_id = $1 WHERE id = $2', [lookupId, coffeeRow.id]);

    try {
      const res = await fetch(`${baseUrl}/lookups/${lookupId}`, { method: 'DELETE' });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/still assigned/i);
    } finally {
      // restore the coffee row, then the lookup row is safe to remove
      await db.query('UPDATE coffees SET origin_region_id = $1 WHERE id = $2', [coffeeRow.origin_region_id, coffeeRow.id]);
      await db.query('DELETE FROM lookup_value WHERE id = $1', [lookupId]);
    }
  });
});

describe('PATCH /api/admin/coffees/:id — origin_region', () => {
  it('resolves the origin_region slug to origin_region_id, and null clears it', async () => {
    const coffeeRow = (await db.query('SELECT id, origin_region_id FROM coffees ORDER BY id LIMIT 1')).rows[0];
    try {
      const res = await fetch(`${baseUrl}/coffees/${coffeeRow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin_region: 'east_africa' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const eastAfrica = (await db.query(
        "SELECT id FROM lookup_value WHERE category = 'origin_region' AND value = 'east_africa'"
      )).rows[0];
      expect(body.origin_region_id).toBe(eastAfrica.id);

      const cleared = await fetch(`${baseUrl}/coffees/${coffeeRow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin_region: null }),
      });
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).origin_region_id).toBeNull();
    } finally {
      await db.query('UPDATE coffees SET origin_region_id = $1 WHERE id = $2', [coffeeRow.origin_region_id, coffeeRow.id]);
    }
  });
});
