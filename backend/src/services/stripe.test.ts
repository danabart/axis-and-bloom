// Commerce 4 (2026-11-16): stripeMode() reads the key prefix at module load.
// The live key is a restricted key (rk_live_), so both secret-key kinds must
// map to the right mode. The first block needs no DB and no network.
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

async function modeFor(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = key;
  const { stripeMode } = await import('./stripe.js');
  return stripeMode();
}

describe('stripeMode', () => {
  const original = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = original;
    vi.resetModules();
  });

  it('live for a standard live key (sk_live_)', async () => {
    expect(await modeFor('sk_live_vitest_not_a_real_key')).toBe('live');
  });

  it('live for a restricted live key (rk_live_)', async () => {
    expect(await modeFor('rk_live_vitest_not_a_real_key')).toBe('live');
  });

  it('test for sk_test_ and rk_test_', async () => {
    expect(await modeFor('sk_test_vitest_not_a_real_key')).toBe('test');
    expect(await modeFor('rk_test_vitest_not_a_real_key')).toBe('test');
  });

  it('trims the secret (a trailing newline from Secret Manager keeps live)', async () => {
    expect(await modeFor('rk_live_vitest_not_a_real_key\n')).toBe('live');
  });

  it('disabled without a key', async () => {
    expect(await modeFor(undefined)).toBe('disabled');
    expect(await modeFor('')).toBe('disabled');
  });
});

// Commerce 4 (2026-11-16): a saved customer id that Stripe no longer knows
// (a sandbox id after the live cutover, or a deleted customer) is replaced by a
// new customer; the old id goes on the new customer's metadata. Test DB only;
// the Stripe client's customer calls are faked (nothing leaves the process).
describe('getOrCreateStripeCustomer', () => {
  const UID = `vitest-stripe-customer-${Date.now()}`;
  let userId = '';
  let db: typeof import('../db/client.js').db;
  let mod: typeof import('./stripe.js');
  let Stripe: typeof import('stripe').default;
  const calls = { retrieve: [] as string[], create: [] as Array<{ params: any; opts: any }> };
  let known = new Set<string>();
  let deleted = new Set<string>();
  let seq = 0;

  beforeAll(async () => {
    vi.resetModules();
    process.env.STRIPE_SECRET_KEY = 'rk_live_vitest_not_a_real_key';
    mod = await import('./stripe.js');
    ({ db } = await import('../db/client.js'));
    Stripe = (await import('stripe')).default;
    const client = mod.stripe();
    vi.spyOn(client.customers, 'retrieve').mockImplementation((async (id: string) => {
      calls.retrieve.push(id);
      if (deleted.has(id)) return { id, object: 'customer', deleted: true };
      if (!known.has(id)) throw new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code: 'resource_missing', message: `No such customer: '${id}'` } as any);
      return { id, object: 'customer' };
    }) as any);
    vi.spyOn(client.customers, 'create').mockImplementation((async (params: any, opts: any) => {
      calls.create.push({ params, opts });
      const id = `cus_vitest_live_${++seq}`;
      known.add(id);
      return { id, object: 'customer' };
    }) as any);
    userId = (await db.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name, last_name) VALUES ($1, 'Vita', 'Stripe') RETURNING id`, [UID])).rows[0].id;
  });

  afterAll(async () => {
    if (userId) await db.query(`DELETE FROM user_profile WHERE id = $1`, [userId]);
    vi.restoreAllMocks();
  });

  const savedId = async () => (await db.query<{ stripe_customer_id: string | null }>(`SELECT stripe_customer_id FROM user_profile WHERE id = $1`, [userId])).rows[0].stripe_customer_id;

  it('replaces a saved id Stripe answers "No such customer" for, keeping the old id in metadata', async () => {
    await db.query(`UPDATE user_profile SET stripe_customer_id = 'cus_vitest_sandbox_old' WHERE id = $1`, [userId]);
    const id = await mod.getOrCreateStripeCustomer(userId, 'vita@example.com');
    expect(id).toBe('cus_vitest_live_1');
    expect(await savedId()).toBe('cus_vitest_live_1');
    const c = calls.create.at(-1)!;
    expect(c.params.metadata).toEqual({ user_id: userId, replaced_customer_id: 'cus_vitest_sandbox_old' });
    expect(c.opts.idempotencyKey).toBe(`customer:${userId}:replaces:cus_vitest_sandbox_old`);
  });

  it('reuses a known saved id, and checks it with Stripe only once per process', async () => {
    const before = { create: calls.create.length, retrieve: calls.retrieve.length };
    expect(await mod.getOrCreateStripeCustomer(userId, null)).toBe('cus_vitest_live_1');
    expect(await mod.getOrCreateStripeCustomer(userId, null)).toBe('cus_vitest_live_1');
    expect(calls.create.length).toBe(before.create);
    expect(calls.retrieve.length - before.retrieve).toBeLessThanOrEqual(1);
  });

  it('replaces a customer that was deleted in Stripe', async () => {
    await db.query(`UPDATE user_profile SET stripe_customer_id = 'cus_vitest_deleted' WHERE id = $1`, [userId]);
    deleted.add('cus_vitest_deleted'); known.add('cus_vitest_deleted');
    const id = await mod.getOrCreateStripeCustomer(userId, null);
    expect(id).toBe('cus_vitest_live_2');
    expect(calls.create.at(-1)!.params.metadata.replaced_customer_id).toBe('cus_vitest_deleted');
  });

  it('does not replace on any other Stripe error', async () => {
    await db.query(`UPDATE user_profile SET stripe_customer_id = 'cus_vitest_flaky' WHERE id = $1`, [userId]);
    const spy = vi.spyOn(mod.stripe().customers, 'retrieve').mockRejectedValueOnce(
      new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'boom' } as any));
    await expect(mod.getOrCreateStripeCustomer(userId, null)).rejects.toThrow('boom');
    expect(await savedId()).toBe('cus_vitest_flaky');
    spy.mockClear();
  });

  it('first checkout with no saved id creates one under the original key', async () => {
    await db.query(`UPDATE user_profile SET stripe_customer_id = NULL WHERE id = $1`, [userId]);
    const id = await mod.getOrCreateStripeCustomer(userId, null);
    expect(await savedId()).toBe(id);
    expect(calls.create.at(-1)!.opts.idempotencyKey).toBe(`customer:${userId}`);
    expect(calls.create.at(-1)!.params.metadata).toEqual({ user_id: userId });
  });
});
