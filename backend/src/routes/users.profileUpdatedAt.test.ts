// Commerce 5 (2026-11-18), Part B: GET /api/users/profile is a read, so it
// leaves user_profile.updated_at alone (it used to bump it on every load,
// CLOSING_REPORT_4 flag B). Mounts the real users router with auth mocked to a
// fixture uid (users.dialPosition.test.ts pattern). The response status is not
// asserted: locally the route's Firestore mirror write may fail after the
// upsert; what matters is the column. Fixture rows removed afterwards (test DB).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const UID = `zzz-c5-profile-${Date.now()}`;
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
const STAMP = '2020-01-01T00:00:00.000Z';

beforeAll(async () => {
  profileId = (await db.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name, updated_at) VALUES ($1, 'Zzz C5', $2) RETURNING id`, [UID, STAMP])).rows[0].id;
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/api/users`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.query(`DELETE FROM user_email WHERE user_id = $1`, [profileId]);
  await db.query(`DELETE FROM user_profile WHERE id = $1`, [profileId]);
  await db.end();
});

describe('GET /api/users/profile', () => {
  it('leaves user_profile.updated_at unchanged', async () => {
    await fetch(`${base}/profile`);
    await fetch(`${base}/profile`);
    const row = (await db.query<{ updated_at: Date }>(`SELECT updated_at FROM user_profile WHERE id = $1`, [profileId])).rows[0];
    expect(row.updated_at.toISOString()).toBe(STAMP);
  });
});
