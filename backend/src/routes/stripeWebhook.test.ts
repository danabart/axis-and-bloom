// Commerce 1, Part D (2026-10-31) — POST /api/webhooks/stripe: signature
// (the real stripe-node verifier with a test secret, payloads signed by its
// own generateTestHeaderString), the stripe_event ledger in the isolated test
// DB, and the event matrix. checkoutService / orderFinalizer are mocked so
// this file proves routing and idempotency only; their own behaviour is in
// checkoutService.test.ts and orderFinalizer.test.ts.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const WHSEC = 'whsec_vitest_secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_vitest_not_a_real_key';
process.env.STRIPE_WEBHOOK_SECRET = WHSEC;

const completeCheckoutSession = vi.fn(async () => ({ orderId: 'order-1', created: true }));
const expireCheckoutSession = vi.fn(async () => true);
const recordRefund = vi.fn(async () => ({ orderId: 'order-1' }));
const finalizePaidOrder = vi.fn(async () => ({ orderId: 'order-1', alreadyFinalized: false, orderPlacedLine: null, failedSteps: [] }));
class UnknownCheckoutSessionError extends Error {}
vi.mock('../services/checkoutService.js', () => ({ completeCheckoutSession, expireCheckoutSession, recordRefund, UnknownCheckoutSessionError }));
vi.mock('../services/orderFinalizer.js', () => ({ finalizePaidOrder }));

const { handleStripeWebhook } = await import('./stripeWebhook.js');
const { stripe } = await import('../services/stripe.js');
const { db } = await import('../db/client.js');

let server: Server;
let url: string;
const RUN = `evt_vitest_${Date.now()}`;
let seq = 0;

beforeAll(async () => {
  const app = express();
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/webhooks/stripe`;
});
afterAll(async () => {
  await db.query(`DELETE FROM stripe_event WHERE stripe_event_id LIKE $1`, [`${RUN}%`]);
  await new Promise<void>(resolve => server.close(() => resolve()));
});
beforeEach(() => { vi.clearAllMocks(); });

function event(type: string, object: Record<string, unknown>, id = `${RUN}_${++seq}`) {
  return { id, object: 'event', type, api_version: '2026-09-30.endive', created: Math.floor(Date.now() / 1000), data: { object } };
}

async function send(body: object, secret = WHSEC) {
  const payload = JSON.stringify(body);
  const header = stripe().webhooks.generateTestHeaderString({ payload, secret });
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header }, body: payload });
}

const paidSession = { id: 'cs_test_vitest', object: 'checkout.session', mode: 'payment', payment_status: 'paid' };

describe('POST /api/webhooks/stripe', () => {
  it('a bad signature is 400 and records nothing', async () => {
    const ev = event('checkout.session.completed', paidSession);
    const res = await send(ev, 'whsec_wrong');
    expect(res.status).toBe(400);
    expect((await db.query(`SELECT 1 FROM stripe_event WHERE stripe_event_id = $1`, [ev.id])).rows).toHaveLength(0);
    expect(completeCheckoutSession).not.toHaveBeenCalled();
  });

  it('completed (paid) → completeCheckoutSession then finalizePaidOrder, once; the replay is a 200 no-op', async () => {
    const ev = event('checkout.session.completed', paidSession);
    const first = await send(ev);
    expect(first.status).toBe(200);
    expect(completeCheckoutSession).toHaveBeenCalledTimes(1);
    expect(finalizePaidOrder).toHaveBeenCalledWith('order-1');
    const row = (await db.query(`SELECT type, processed_at, error, payload FROM stripe_event WHERE stripe_event_id = $1`, [ev.id])).rows[0];
    expect(row.type).toBe('checkout.session.completed');
    expect(row.processed_at).not.toBeNull();
    expect(row.error).toBeNull();
    expect(row.payload.id).toBe(ev.id);

    const replay = await send(ev);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ received: true, duplicate: true });
    expect(completeCheckoutSession).toHaveBeenCalledTimes(1);
    expect(finalizePaidOrder).toHaveBeenCalledTimes(1);
  });

  it('async_payment_succeeded is handled like completed; completed with payment still unpaid waits', async () => {
    await send(event('checkout.session.async_payment_succeeded', paidSession));
    expect(completeCheckoutSession).toHaveBeenCalledTimes(1);
    await send(event('checkout.session.completed', { ...paidSession, payment_status: 'unpaid' }));
    expect(completeCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('expired and async_payment_failed expire the session; charge.refunded records the refund', async () => {
    await send(event('checkout.session.expired', { id: 'cs_test_expired', object: 'checkout.session', mode: 'payment' }));
    await send(event('checkout.session.async_payment_failed', { id: 'cs_test_failed', object: 'checkout.session', mode: 'payment' }));
    expect(expireCheckoutSession.mock.calls.map(c => (c as unknown[])[0])).toEqual(['cs_test_expired', 'cs_test_failed']);
    await send(event('charge.refunded', { id: 'ch_vitest', object: 'charge', amount: 2695, amount_refunded: 1000, payment_intent: 'pi_x' }));
    expect(recordRefund).toHaveBeenCalledTimes(1);
    expect(completeCheckoutSession).not.toHaveBeenCalled();
  });

  it('any other event type is recorded and marked processed', async () => {
    const ev = event('payment_intent.payment_failed', { id: 'pi_vitest', object: 'payment_intent' });
    expect((await send(ev)).status).toBe(200);
    const row = (await db.query(`SELECT processed_at FROM stripe_event WHERE stripe_event_id = $1`, [ev.id])).rows[0];
    expect(row.processed_at).not.toBeNull();
  });

  it("a session this database never created (another environment's) is recorded with the reason and answered 200, never retried", async () => {
    completeCheckoutSession.mockRejectedValueOnce(new UnknownCheckoutSessionError('no checkout_session for Stripe session cs_elsewhere'));
    const ev = event('checkout.session.completed', paidSession);
    const res = await send(ev);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, unknownSession: true });
    const row = (await db.query(`SELECT processed_at, error FROM stripe_event WHERE stripe_event_id = $1`, [ev.id])).rows[0];
    expect(row.processed_at).not.toBeNull();
    expect(row.error).toMatch(/no checkout_session/);
    expect(finalizePaidOrder).not.toHaveBeenCalled();
  });

  it('a handler error is written to the ledger and answered 500 so Stripe retries; the retry processes it', async () => {
    completeCheckoutSession.mockRejectedValueOnce(new Error('db down'));
    const ev = event('checkout.session.completed', paidSession);
    expect((await send(ev)).status).toBe(500);
    let row = (await db.query(`SELECT processed_at, error FROM stripe_event WHERE stripe_event_id = $1`, [ev.id])).rows[0];
    expect(row).toEqual({ processed_at: null, error: 'db down' });
    expect((await send(ev)).status).toBe(200);
    row = (await db.query(`SELECT processed_at, error FROM stripe_event WHERE stripe_event_id = $1`, [ev.id])).rows[0];
    expect(row.processed_at).not.toBeNull();
    expect(row.error).toBeNull();
  });
});
