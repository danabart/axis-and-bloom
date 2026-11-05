// Website 5 (2026-11-05), acceptance on the test DB: The Bloom's new field
// layout sends PATCH /api/users/dial-position with exactly the three bodies
// the old dial sent (asserted on the frontend side in
// frontend/src/app/components/bloom/bloom.test.tsx). This mounts the real users
// router (auth mocked to a fixture uid) and checks what each body writes:
// the silent auto-save overwrites user_bloom_dial_current_position only;
// explicit_save and add_to_cart each add one customer_dial_event row with that
// event_type (explicit_save also a user_saved_item). Fixture rows are removed
// afterwards (test DB only; the vitest guard refuses any other database).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const UID = `zzz-website5-${Date.now()}`;
vi.mock('../middleware/auth.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/auth.js')>();
  return {
    ...real,
    requireAuth: (req: any, _res: any, next: any) => { req.uid = UID; next(); },
    blockAnonymousAuth: (_req: any, _res: any, next: any) => next(),
  };
});

const { default: usersRouter } = await import('./users.js');
const { db } = await import('../db/client.js');

let server: Server;
let base: string;
let profileId: string;

beforeAll(async () => {
  profileId = (await db.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz Website5') RETURNING id`, [UID])).rows[0].id;
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/api/users`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.query(`DELETE FROM customer_dial_event WHERE user_id = $1`, [profileId]);
  await db.query(`DELETE FROM user_saved_item WHERE user_id = $1`, [profileId]);
  await db.query(`DELETE FROM user_bloom_dial_current_position WHERE user_id = $1`, [profileId]);
  await db.query(`DELETE FROM user_profile WHERE id = $1`, [profileId]);
  await db.end();
});

const patch = (body: unknown) => fetch(`${base}/dial-position`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const events = async () => (await db.query<{ event_type: string; archetype_code: string; coffee_id: number | null }>(
  `SELECT event_type, archetype_code::text, coffee_id FROM customer_dial_event WHERE user_id = $1 ORDER BY recorded_at`, [profileId])).rows;

describe('The Bloom dial events on the test DB (Website 5 acceptance)', () => {
  it('silent turn: position only; explicit_save and add_to_cart: one event each, same triggers as before', async () => {
    // a live slot of the test DB (any archetype with a coffee on it)
    const live = (await db.query<{ archetype: string; sort_order: number; coffee_id: number }>(
      `SELECT placement_archetype::text AS archetype, sort_order, coffee_id FROM v_coffee_slot WHERE coffee_id IS NOT NULL AND assignment_is_active ORDER BY 1, 2 LIMIT 1`)).rows[0];
    expect(live).toBeTruthy();

    expect((await patch({ archetype: live.archetype, dialSortOrder: live.sort_order })).status).toBe(200);
    expect(await events()).toEqual([]);
    const pos = (await db.query(`SELECT s.sort_order FROM user_bloom_dial_current_position p JOIN coffee_dial_slot s ON s.id = p.slot_id WHERE p.user_id = $1 AND p.archetype = $2`, [profileId, live.archetype])).rows;
    expect(pos).toEqual([{ sort_order: live.sort_order }]);

    expect((await patch({ archetype: live.archetype, dialSortOrder: live.sort_order, trigger: 'explicit_save', source: 'bloom', coffeeId: live.coffee_id, platformName: 'Zzz Name' })).status).toBe(200);
    expect((await patch({ archetype: live.archetype, dialSortOrder: live.sort_order, trigger: 'add_to_cart', source: 'bloom', coffeeId: live.coffee_id })).status).toBe(200);
    expect(await events()).toEqual([
      { event_type: 'explicit_save', archetype_code: live.archetype, coffee_id: live.coffee_id },
      { event_type: 'add_to_cart', archetype_code: live.archetype, coffee_id: live.coffee_id },
    ]);
    const savedItems = (await db.query(`SELECT kind, ref_id FROM user_saved_item WHERE user_id = $1`, [profileId])).rows;
    expect(savedItems).toEqual([{ kind: 'dial_slot', ref_id: `${live.archetype}:${live.sort_order}` }]);
  });
});
