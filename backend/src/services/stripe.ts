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

/**
 * For the one boot log line: [stripe] mode=test|live|disabled. A standard
 * (sk_) or restricted (rk_) live key is live; the prod live key is rk_live_
 * (Commerce 4, 2026-11-16). Pinned by stripe.test.ts.
 */
export function stripeMode(): 'test' | 'live' | 'disabled' {
  if (!STRIPE_ENABLED) return 'disabled';
  return STRIPE_SECRET_KEY.startsWith('sk_live_') || STRIPE_SECRET_KEY.startsWith('rk_live_') ? 'live' : 'test';
}

/**
 * The buyer's Stripe customer: user_profile.stripe_customer_id when set, else a
 * new customer (email, name, metadata.user_id) stored on the profile. The
 * idempotency key and the "only while NULL" update keep two concurrent first
 * checkouts from leaving two customers on one profile.
 *
 * Commerce 4 (2026-11-16): a saved id is checked with Stripe once per process.
 * Customer ids carry no test/live prefix, so a sandbox id saved before the
 * live cutover answers "No such customer" (resource_missing) in live, and a
 * customer deleted in the Dashboard comes back `deleted`. Either way a new
 * customer is created and replaces the saved id (only while the row still
 * holds the old one). The old id is never silently lost: it goes on the new
 * customer as metadata.replaced_customer_id and in a [stripe] log line.
 */
const verifiedCustomers = new Set<string>();

function isNoSuchCustomer(err: unknown): boolean {
  return err instanceof Stripe.errors.StripeError && err.code === 'resource_missing';
}

export async function getOrCreateStripeCustomer(userId: string, email: string | null): Promise<string> {
  const r = await db.query<{ stripe_customer_id: string | null; first_name: string | null; last_name: string | null }>(
    `SELECT stripe_customer_id, first_name, last_name FROM user_profile WHERE id = $1`, [userId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`user_profile ${userId} not found`);

  const saved = row.stripe_customer_id;
  if (saved) {
    if (verifiedCustomers.has(saved)) return saved;
    const usable = await stripe().customers.retrieve(saved)
      .then(c => !('deleted' in c && c.deleted))
      .catch(err => { if (isNoSuchCustomer(err)) return false; throw err; });
    if (usable) { verifiedCustomers.add(saved); return saved; }
  }

  const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || undefined;
  const customer = await stripe().customers.create(
    { email: email ?? undefined, name, metadata: saved ? { user_id: userId, replaced_customer_id: saved } : { user_id: userId } },
    { idempotencyKey: saved ? `customer:${userId}:replaces:${saved}` : `customer:${userId}` },
  );
  if (saved) {
    await db.query(
      `UPDATE user_profile SET stripe_customer_id = $1, updated_at = now() WHERE id = $2 AND stripe_customer_id = $3`,
      [customer.id, userId, saved]
    );
  } else {
    await db.query(
      `UPDATE user_profile SET stripe_customer_id = $1, updated_at = now() WHERE id = $2 AND stripe_customer_id IS NULL`,
      [customer.id, userId]
    );
  }
  const after = await db.query<{ stripe_customer_id: string }>(`SELECT stripe_customer_id FROM user_profile WHERE id = $1`, [userId]);
  const current = after.rows[0].stripe_customer_id;
  if (saved) console.warn(`[stripe] customer replaced user=${userId} old=${saved} new=${current} (old id not found in mode=${stripeMode()})`);
  verifiedCustomers.add(current);
  return current;
}
