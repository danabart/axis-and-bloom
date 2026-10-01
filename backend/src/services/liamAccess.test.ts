import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type pg from 'pg';

// Liam access & cost brief, Part A6 (2026-10-01) — hasLiamAccess against the
// real test database. Every fixture lives inside one transaction that is
// rolled back, the same discipline palateReads.test.ts / liamProfile.test.ts
// use, so nothing is left behind even on a failed run.
const { db } = await import('../db/client.js');
const { hasLiamAccess } = await import('./liamAccess.js');

let client: pg.PoolClient;
const uids = {
  admin: 'vitest-liam-access-admin',
  own: 'vitest-liam-access-own',
  household: 'vitest-liam-access-household',
  sponsored: 'vitest-liam-access-sponsored',
  sponsoredExpired: 'vitest-liam-access-sponsored-expired',
  lapsed: 'vitest-liam-access-lapsed',
  none: 'vitest-liam-access-none',
};

async function profile(uid: string, extra: { userTypeId?: string; householdId?: string } = {}): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, user_type_id, household_id) VALUES ($1, $2, $3) RETURNING id`,
    [uid, extra.userTypeId ?? null, extra.householdId ?? null]
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  client = await db.connect();
  await client.query('BEGIN');

  const adminType = await client.query<{ id: string }>(`SELECT id FROM user_type WHERE name = 'admin'`);
  expect(adminType.rows).toHaveLength(1);
  await profile(uids.admin, { userTypeId: adminType.rows[0].id }); // no subscription

  const ownId = await profile(uids.own);
  await client.query(`INSERT INTO subscription (user_id, status) VALUES ($1, 'active')`, [ownId]);

  // Household member with no subscription of their own; the household pays.
  const household = await client.query<{ id: string }>(`INSERT INTO household (household_name) VALUES ('Vitest Liam Access') RETURNING id`);
  const payerId = await profile('vitest-liam-access-household-payer', { householdId: household.rows[0].id });
  await client.query(`INSERT INTO subscription (user_id, household_id, status) VALUES ($1, $2, 'active')`, [payerId, household.rows[0].id]);
  await profile(uids.household, { householdId: household.rows[0].id });

  const gift = await client.query<{ id: string }>(
    `INSERT INTO company_gift (company_name, seat_count, admin_contact_email) VALUES ('Vitest Co', 2, 'vitest@example.com') RETURNING id`
  );
  const sponsoredId = await profile(uids.sponsored);
  await client.query(
    `INSERT INTO subscription (user_id, status, company_gift_id, sponsored_expires_at) VALUES ($1, 'active', $2, now() + interval '30 days')`,
    [sponsoredId, gift.rows[0].id]
  );
  // Expired but the cron hasn't flipped it yet: status still 'active'.
  const expiredId = await profile(uids.sponsoredExpired);
  await client.query(
    `INSERT INTO subscription (user_id, status, company_gift_id, sponsored_expires_at) VALUES ($1, 'active', $2, now() - interval '1 day')`,
    [expiredId, gift.rows[0].id]
  );

  const lapsedId = await profile(uids.lapsed);
  await client.query(`INSERT INTO subscription (user_id, status) VALUES ($1, 'lapsed')`, [lapsedId]);

  await profile(uids.none);
}, 20000);

afterAll(async () => {
  await client.query('ROLLBACK');
  client.release();
});

describe('hasLiamAccess', () => {
  it('admin without a subscription → allowed (admin)', async () => {
    expect(await hasLiamAccess(uids.admin, client)).toEqual({ allowed: true, reason: 'admin' });
  });

  it('own active subscription → allowed (subscriber)', async () => {
    expect(await hasLiamAccess(uids.own, client)).toEqual({ allowed: true, reason: 'subscriber' });
  });

  it("household's active subscription → allowed (subscriber)", async () => {
    expect(await hasLiamAccess(uids.household, client)).toEqual({ allowed: true, reason: 'subscriber' });
  });

  it('active sponsored (company gift) subscription → allowed (subscriber)', async () => {
    expect(await hasLiamAccess(uids.sponsored, client)).toEqual({ allowed: true, reason: 'subscriber' });
  });

  it('sponsored with sponsored_expires_at in the past, status still active → refused', async () => {
    expect(await hasLiamAccess(uids.sponsoredExpired, client)).toEqual({ allowed: false, reason: null });
  });

  it('lapsed subscription → refused', async () => {
    expect(await hasLiamAccess(uids.lapsed, client)).toEqual({ allowed: false, reason: null });
  });

  it('no subscription → refused', async () => {
    expect(await hasLiamAccess(uids.none, client)).toEqual({ allowed: false, reason: null });
  });

  it('no user_profile row at all → refused', async () => {
    expect(await hasLiamAccess('vitest-liam-access-unknown', client)).toEqual({ allowed: false, reason: null });
  });

  it('query failure → refused (fails closed) and logged with [liamAccess]', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { query: async () => { throw new Error('connection reset'); } };
    expect(await hasLiamAccess(uids.admin, broken as unknown as pg.PoolClient)).toEqual({ allowed: false, reason: null });
    expect(errorSpy.mock.calls[0][0]).toContain('[liamAccess]');
    errorSpy.mockRestore();
  });
});
