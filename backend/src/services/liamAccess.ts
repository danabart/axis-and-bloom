import type pg from 'pg';
import { db } from '../db/client.js';

// Liam access & cost brief (2026-10-01) — who may talk to Liam. Strategy v3.2
// §5: Liam is what the subscription buys; admins are the one exception.
//
// The one place this predicate lives. Nothing else re-implements "admin OR an
// active subscription reachable by the user" — routes go through
// requireLiamAccess (middleware/auth.ts), the client learns the answer from
// GET /api/users/profile's hasLiamAccess, both of which call this.
//
// "Reachable" matches userSignals.ts hasActiveSubscription (own subscription
// or the household's, sponsored company-gift seats included), tightened by
// one condition Dana decided: a sponsored seat whose sponsored_expires_at has
// passed no longer counts, even if the expiry cron hasn't flipped it to
// 'lapsed' yet.
//
// Fails closed: a query error means no access.

export type LiamAccessReason = 'admin' | 'subscriber';

export interface LiamAccess {
  allowed: boolean;
  reason: LiamAccessReason | null;
}

type Runner = Pick<pg.Pool | pg.PoolClient, 'query'>;

export async function hasLiamAccess(uid: string, runner: Runner = db): Promise<LiamAccess> {
  try {
    const result = await runner.query<{ is_admin: boolean; is_subscriber: boolean }>(
      `SELECT
         COALESCE(ut.name = 'admin', false) AS is_admin,
         EXISTS (
           SELECT 1 FROM subscription s
           WHERE (s.user_id = up.id OR s.household_id = up.household_id)
             AND s.status = 'active'
             AND (s.sponsored_expires_at IS NULL OR s.sponsored_expires_at > now())
         ) AS is_subscriber
       FROM user_profile up
       LEFT JOIN user_type ut ON ut.id = up.user_type_id
       WHERE up.firebase_uid = $1`,
      [uid]
    );
    const row = result.rows[0];
    if (row?.is_admin) return { allowed: true, reason: 'admin' };
    if (row?.is_subscriber) return { allowed: true, reason: 'subscriber' };
    return { allowed: false, reason: null };
  } catch (err) {
    console.error(`[liamAccess] access check failed for uid=${uid} — failing closed:`, err);
    return { allowed: false, reason: null };
  }
}
