// Commerce 1, B2 (2026-10-31) — the one Stripe client.
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET come from Secret Manager through
// deploy.yml --set-secrets; no STRIPE_* value is ever written into the repo.
// Without a secret key checkout is disabled (POST /api/checkout/session
// answers 503 checkout_unavailable). The mode (test/live) is derived from the
// key prefix here, logged once at boot, and inspected nowhere else.
//
// API version pinned to the one the webhook endpoint was created with
// (we_1UWaPO0QYxZQN6jDi2Y9lp6q, 2026-10-31), so the objects we create and the
// events Stripe sends us have the same shape. stripe-node 23.1.0 types only
// its own default (2026-10-28.endive, same major), hence the cast.
import Stripe from 'stripe';
import { db } from '../db/client.js';

export const STRIPE_API_VERSION = '2026-09-30.endive';

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY ?? '').trim();
export const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
export const STRIPE_ENABLED = Boolean(STRIPE_SECRET_KEY);

let client: Stripe | null = null;

/** The client; throws when checkout is disabled (callers check STRIPE_ENABLED first). */
export function stripe(): Stripe {
  if (!STRIPE_ENABLED) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY unset)');
  client ??= new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    appInfo: { name: 'axis-and-bloom' },
  });
  return client;
}

/** For the one boot log line: [stripe] mode=test|live|disabled. */
export function stripeMode(): 'test' | 'live' | 'disabled' {
  if (!STRIPE_ENABLED) return 'disabled';
  return STRIPE_SECRET_KEY.startsWith('sk_live_') || STRIPE_SECRET_KEY.startsWith('rk_live_') ? 'live' : 'test';
}

/**
 * The buyer's Stripe customer: user_profile.stripe_customer_id when set, else a
 * new customer (email, name, metadata.user_id) stored on the profile. The
 * idempotency key and the "only while NULL" update keep two concurrent first
 * checkouts from leaving two customers on one profile.
 */
export async function getOrCreateStripeCustomer(userId: string, email: string | null): Promise<string> {
  const r = await db.query<{ stripe_customer_id: string | null; first_name: string | null; last_name: string | null }>(
    `SELECT stripe_customer_id, first_name, last_name FROM user_profile WHERE id = $1`, [userId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`user_profile ${userId} not found`);
  if (row.stripe_customer_id) return row.stripe_customer_id;

  const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || undefined;
  const customer = await stripe().customers.create(
    { email: email ?? undefined, name, metadata: { user_id: userId } },
    { idempotencyKey: `customer:${userId}` },
  );
  await db.query(
    `UPDATE user_profile SET stripe_customer_id = $1, updated_at = now() WHERE id = $2 AND stripe_customer_id IS NULL`,
    [customer.id, userId]
  );
  const after = await db.query<{ stripe_customer_id: string }>(`SELECT stripe_customer_id FROM user_profile WHERE id = $1`, [userId]);
  return after.rows[0].stripe_customer_id;
}
