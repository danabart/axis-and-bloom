// Quiz Resync Fix Part D2 (2026-09-25) — asserts the "identity yes, data no"
// split: an empty (never-quizzed) stale guest still loses its Postgres row;
// a quiz-taken stale guest keeps every row of data and only loses its
// Firebase Auth identity. Firebase Admin mocked (no real Auth/Firestore
// calls); real DB (axisandbloom_test, via globalSetup — see test_database).
import 'dotenv/config';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const deleteUserCalls: string[] = [];
const recursiveDeletePaths: string[] = [];

vi.mock('./firebase-admin.js', () => ({
  default: {
    auth: () => ({
      // Every candidate uid in this test is "still anonymous" — that branch
      // (a converted account skipped entirely) is not what Part D2 changes
      // and is already covered by the pre-existing behavior this file
      // doesn't touch.
      getUser: async (_uid: string) => ({ providerData: [] }),
      deleteUser: async (uid: string) => { deleteUserCalls.push(uid); },
    }),
  },
  firestoreDb: {
    doc: (path: string) => ({ path }),
    recursiveDelete: async (docRef: { path: string }) => { recursiveDeletePaths.push(docRef.path); },
  },
}));

const { db } = await import('../db/client.js');
const { purgeStaleAnonymousGuests } = await import('./staleGuestCleanup.js');

describe('purgeStaleAnonymousGuests — Part D2 identity-vs-data split', () => {
  const emptyUid = `test-empty-guest-${Date.now()}`;
  const identityOnlyUid = `test-identity-only-guest-${Date.now()}`;

  beforeAll(async () => {
    // "Empty" candidate: created 8 days ago, never quizzed, never ordered.
    await db.query(
      `INSERT INTO user_profile (firebase_uid, created_at) VALUES ($1, now() - interval '8 days')`,
      [emptyUid],
    );
    // "Identity-only" candidate: profile itself can be recent — what matters
    // is its one quiz_session completed 91 days ago (past the 90-day rule).
    const profileResult = await db.query<{ id: string }>(
      `INSERT INTO user_profile (firebase_uid, created_at) VALUES ($1, now()) RETURNING id`,
      [identityOnlyUid],
    );
    await db.query(
      `INSERT INTO quiz_session (user_id, completed_at) VALUES ($1, now() - interval '91 days')`,
      [profileResult.rows[0].id],
    );
  });

  afterAll(async () => {
    // Hygiene only — the function under test is expected to have already
    // removed the empty guest's row; this just ensures nothing lingers
    // either way (e.g. if an assertion above failed mid-test).
    await db.query(`DELETE FROM user_profile WHERE firebase_uid = ANY($1::text[])`, [[emptyUid, identityOnlyUid]]);
  });

  it('deletes the empty guest\'s Postgres row but only the identity-only guest\'s Firebase identity', async () => {
    const result = await purgeStaleAnonymousGuests();

    expect(result.checked).toBeGreaterThanOrEqual(2);
    expect(result.purgedEmpty).toBeGreaterThanOrEqual(1);
    expect(result.purgedIdentityOnly).toBeGreaterThanOrEqual(1);

    // Both lose their Firebase Auth identity.
    expect(deleteUserCalls).toContain(emptyUid);
    expect(deleteUserCalls).toContain(identityOnlyUid);

    // Only the empty guest's Firestore tree is touched.
    expect(recursiveDeletePaths.some(p => p.includes(emptyUid))).toBe(true);
    expect(recursiveDeletePaths.some(p => p.includes(identityOnlyUid))).toBe(false);

    // Postgres: empty guest's row is gone.
    const emptyRow = await db.query(`SELECT 1 FROM user_profile WHERE firebase_uid = $1`, [emptyUid]);
    expect(emptyRow.rowCount).toBe(0);

    // Postgres: identity-only guest's row — and its quiz_session — survives untouched.
    const identityOnlyRow = await db.query<{ id: string }>(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [identityOnlyUid]);
    expect(identityOnlyRow.rowCount).toBe(1);
    const sessionRow = await db.query(`SELECT 1 FROM quiz_session WHERE user_id = $1`, [identityOnlyRow.rows[0].id]);
    expect(sessionRow.rowCount).toBe(1);
  });
});
