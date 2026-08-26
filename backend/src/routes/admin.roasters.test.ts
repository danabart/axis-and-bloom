// Roastery lifecycle (2026-08-25) — regression coverage for
// GET/POST /api/admin/roasters/:id/deactivation-preview, deactivate, and
// reactivate. requireAdmin is mocked to a passthrough (same pattern as
// admin.lookups.test.ts) — the auth-gating behavior itself is identical,
// already-live middleware shared by every other /api/admin/* route.
//
// Requires DATABASE_URL pointed at a reachable Postgres instance with the
// roastery-lifecycle schema applied (coffees.is_active/roaster_id/
// deactivated_at/deactivation_reason, same on roaster_blend/coffee_alias,
// roaster.deactivated_at/deactivation_note) — cannot run against a
// pre-migration database. Every fixture here is a disposable roaster/coffee/
// blend/alias created and deleted by the test itself, never a real roastery
// — this file never touches Path or Temecula's real rows.
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
  // Fixture-leak backstop (2026-08-26 hardening round) — a fixture whose
  // creation itself fails partway (e.g. against a pre-migration database)
  // leaves the per-test try/finally below unable to reach it, since the
  // `fixture` variable was never assigned. This sweep is the real safety
  // net; moving creation inside try (below) only covers a failure in the
  // test body itself. Order matters — children before parents.
  await db.query(`DELETE FROM coffee_alias WHERE platform_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster_blend WHERE blend_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
  await new Promise<void>(resolve => server.close(() => resolve()));
});

interface Fixture {
  roaster: { id: string; name: string };
  coffee: { id: number };
  blend: { id: string };
  alias: { id: number };
}

// Disposable roaster + coffee + blend + alias, deleted by the caller's
// finally block. Deliberately NOT linked into any dial slot (no
// archetype_assignments/dial_archetype_positions row), so it never affects
// slotsGoingEmpty/archetypesLosingDefault for any real archetype.
async function makeFixture(): Promise<Fixture> {
  const roaster = (await db.query(
    `INSERT INTO roaster (name, is_active) VALUES ('Vitest Roastery', true) RETURNING id, name`
  )).rows[0];
  const coffee = (await db.query(
    `INSERT INTO coffees (name, roaster, roaster_id, is_active) VALUES ('Vitest Coffee', $1, $2, true) RETURNING id`,
    [roaster.name, roaster.id]
  )).rows[0];
  const blend = (await db.query(
    `INSERT INTO roaster_blend (roaster_id, blend_name, coffee_id, is_active) VALUES ($1, 'Vitest Blend', $2, true) RETURNING id`,
    [roaster.id, coffee.id]
  )).rows[0];
  const alias = (await db.query(
    `INSERT INTO coffee_alias (platform_name, coffee_id, is_active) VALUES ('Vitest Alias', $1, true) RETURNING id`,
    [coffee.id]
  )).rows[0];
  return { roaster, coffee, blend, alias };
}

async function cleanup(fixture: Fixture) {
  await db.query('DELETE FROM coffee_alias WHERE id = $1', [fixture.alias.id]);
  await db.query('DELETE FROM roaster_blend WHERE id = $1', [fixture.blend.id]);
  await db.query('DELETE FROM coffees WHERE id = $1', [fixture.coffee.id]);
  await db.query('DELETE FROM roaster WHERE id = $1', [fixture.roaster.id]);
}

describe('GET /api/admin/roasters/:id/deactivation-preview', () => {
  it('is side-effect free', async () => {
    let fixture: Fixture | undefined;
    try {
      fixture = await makeFixture();
      const res = await fetch(`${baseUrl}/roasters/${fixture.roaster.id}/deactivation-preview`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.roaster.isActive).toBe(true);
      expect(body.coffees).toHaveLength(1);
      expect(body.coffees[0].id).toBe(fixture.coffee.id);
      expect(body.blends).toEqual({ total: 1, active: 1 });
      expect(body.aliases).toEqual({ total: 1, active: 1 });
      expect(body.alreadyManuallyInactive).toEqual({ coffees: 0, blends: 0, aliases: 0 });

      const stillActive = await db.query('SELECT is_active FROM coffees WHERE id = $1', [fixture.coffee.id]);
      expect(stillActive.rows[0].is_active).toBe(true);
      const stillActiveRoaster = await db.query('SELECT is_active FROM roaster WHERE id = $1', [fixture.roaster.id]);
      expect(stillActiveRoaster.rows[0].is_active).toBe(true);
    } finally { if (fixture) await cleanup(fixture); }
  });
});

describe('POST /api/admin/roasters/:id/deactivate + reactivate', () => {
  it('cascades exactly the roastery\'s rows, skips an already-manually-inactive row, 409s on a second deactivate, and reactivate restores only the reason=roaster row', async () => {
    let fixture: Fixture | undefined;
    let manualCoffee: { id: number } | undefined;
    try {
      fixture = await makeFixture();
      // A second coffee, manually retired BEFORE the roastery deactivates —
      // must stay untouched by both the deactivate cascade and reactivate.
      manualCoffee = (await db.query(
        `INSERT INTO coffees (name, roaster, roaster_id, is_active, deactivated_at, deactivation_reason)
         VALUES ('Vitest Manual Coffee', $1, $2, false, now(), 'manual') RETURNING id`,
        [fixture.roaster.name, fixture.roaster.id]
      )).rows[0];

      const deactivateRes = await fetch(`${baseUrl}/roasters/${fixture.roaster.id}/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'vitest' }),
      });
      expect(deactivateRes.status).toBe(200);
      const deactivateBody = await deactivateRes.json();
      expect(deactivateBody.applied).toEqual({ coffees: 1, blends: 1, aliases: 1 });

      const coffeeRow = (await db.query(
        'SELECT is_active, deactivation_reason FROM coffees WHERE id = $1', [fixture.coffee.id]
      )).rows[0];
      expect(coffeeRow.is_active).toBe(false);
      expect(coffeeRow.deactivation_reason).toBe('roaster');

      const blendRow = (await db.query(
        'SELECT is_active, deactivation_reason FROM roaster_blend WHERE id = $1', [fixture.blend.id]
      )).rows[0];
      expect(blendRow.is_active).toBe(false);
      expect(blendRow.deactivation_reason).toBe('roaster');

      const aliasRow = (await db.query(
        'SELECT is_active, deactivation_reason FROM coffee_alias WHERE id = $1', [fixture.alias.id]
      )).rows[0];
      expect(aliasRow.is_active).toBe(false);
      expect(aliasRow.deactivation_reason).toBe('roaster');

      const manualRow = (await db.query(
        'SELECT is_active, deactivation_reason FROM coffees WHERE id = $1', [manualCoffee!.id]
      )).rows[0];
      expect(manualRow.is_active).toBe(false);
      expect(manualRow.deactivation_reason).toBe('manual'); // untouched — already inactive before the cascade ran

      const roasterRow = (await db.query('SELECT is_active FROM roaster WHERE id = $1', [fixture.roaster.id])).rows[0];
      expect(roasterRow.is_active).toBe(false);

      // Second deactivate 409s
      const secondRes = await fetch(`${baseUrl}/roasters/${fixture.roaster.id}/deactivate`, { method: 'POST' });
      expect(secondRes.status).toBe(409);

      // Reactivate restores only the 'roaster'-reason rows
      const reactivateRes = await fetch(`${baseUrl}/roasters/${fixture.roaster.id}/reactivate`, { method: 'POST' });
      expect(reactivateRes.status).toBe(200);
      const reactivateBody = await reactivateRes.json();
      expect(reactivateBody.restored).toEqual({ coffees: 1, blends: 1, aliases: 1 });

      const restoredCoffee = (await db.query(
        'SELECT is_active, deactivation_reason FROM coffees WHERE id = $1', [fixture.coffee.id]
      )).rows[0];
      expect(restoredCoffee.is_active).toBe(true);
      expect(restoredCoffee.deactivation_reason).toBeNull();

      const stillManual = (await db.query(
        'SELECT is_active, deactivation_reason FROM coffees WHERE id = $1', [manualCoffee!.id]
      )).rows[0];
      expect(stillManual.is_active).toBe(false);
      expect(stillManual.deactivation_reason).toBe('manual'); // stays retired — reactivate never touches manual rows

      // Second reactivate 409s
      const secondReactivateRes = await fetch(`${baseUrl}/roasters/${fixture.roaster.id}/reactivate`, { method: 'POST' });
      expect(secondReactivateRes.status).toBe(409);
    } finally {
      if (manualCoffee) await db.query('DELETE FROM coffees WHERE id = $1', [manualCoffee.id]);
      if (fixture) await cleanup(fixture);
    }
  }, 20000); // ~6 sequential HTTP calls + DB round trips over the Cloud SQL proxy tunnel — same timeout convention as coffees.test.ts's slow tests, vitest's 5000ms default isn't enough

  it('deactivate 404s for a nonexistent roaster', async () => {
    const res = await fetch(`${baseUrl}/roasters/00000000-0000-0000-0000-000000000000/deactivate`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/roasters/:id/toggle', () => {
  it('is gone — the bare toggle route no longer exists (404)', async () => {
    let fixture: Fixture | undefined;
    try {
      fixture = await makeFixture();
      const res = await fetch(`${baseUrl}/roasters/${fixture.roaster.id}/toggle`, { method: 'PATCH' });
      expect(res.status).toBe(404);
    } finally { if (fixture) await cleanup(fixture); }
  });
});
