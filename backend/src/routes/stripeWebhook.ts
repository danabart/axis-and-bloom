// Commerce 1, B6 (2026-10-31) — POST /api/webhooks/stripe. Registered in
// index.ts with express.raw ABOVE express.json(): the signature is computed
// over the exact bytes Stripe sent. Under the /api/webhooks App Check
// exemption (middleware/appCheck.ts); Stripe's signature is the auth.
//
// The webhook is the truth for payment: an order is written only here.
// Ledger first (stripe_event, ON CONFLICT DO NOTHING on the event id): an
// event already processed answers 200 at once, so a replay from the
// Dashboard or a Stripe retry never writes a second order or sends a second
// email. A handler error is written to the row and answered 500 so Stripe
// retries; the retry finds the row unprocessed and runs again (each step is
// idempotent on its own).
//
// Event matrix:
//   checkout.session.completed (payment mode, payment_status paid) and
//   checkout.session.async_payment_succeeded → completeCheckoutSession → finalizePaidOrder
//   checkout.session.completed with payment unpaid (async method pending) → recorded, wait for async_*
//   checkout.session.expired → expireCheckoutSession
//   checkout.session.async_payment_failed → expireCheckoutSession + log
//   charge.refunded → refund order_event (amount + full/partial payment status)
//   anything else (payment_intent.payment_failed, ...) → recorded and marked processed
//   a completed session this database never created (another environment's;
//   every endpoint of the account receives every event) → recorded with the
//   reason, marked processed, 200: never retried
import type { Request, Response } from 'express';
import type Stripe from 'stripe';
import { db } from '../db/client.js';
import { stripe, STRIPE_ENABLED, STRIPE_WEBHOOK_SECRET } from '../services/stripe.js';
import { completeCheckoutSession, expireCheckoutSession, recordRefund, UnknownCheckoutSessionError } from '../services/checkoutService.js';
import { finalizePaidOrder } from '../services/orderFinalizer.js';

async function handleEvent(event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'payment') return `ignored: mode ${session.mode}`;
      if (session.payment_status !== 'paid') return `waiting: payment_status ${session.payment_status}`;
      const { orderId, created } = await completeCheckoutSession(session);
      const fin = await finalizePaidOrder(orderId);
      return `order ${orderId}${created ? ' created' : ' existed'}${fin.alreadyFinalized ? ', already finalized' : ', finalized'}${fin.failedSteps.length ? ` (failed: ${fin.failedSteps.join(',')})` : ''}`;
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      return (await expireCheckoutSession(session.id)) ? 'expired' : 'expired (no open session)';
    }
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.warn('[stripe-webhook] async payment failed for session', session.id);
      await expireCheckoutSession(session.id);
      return 'async payment failed: session expired';
    }
    case 'charge.refunded': {
      const { orderId } = await recordRefund(event.data.object as Stripe.Charge);
      return orderId ? `refund recorded on order ${orderId}` : 'refund for no known order';
    }
    default:
      return 'recorded';
  }
}

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  if (!STRIPE_ENABLED || !STRIPE_WEBHOOK_SECRET) { res.status(503).json({ error: 'stripe_not_configured' }); return; }

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(req.body as Buffer, req.headers['stripe-signature'] as string, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('[stripe-webhook] bad signature:', err instanceof Error ? err.message : err);
    res.status(400).json({ error: 'invalid_signature' });
    return;
  }

  try {
    await db.query(
      `INSERT INTO stripe_event (stripe_event_id, type, payload) VALUES ($1, $2, $3) ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(event)]
    );
    const row = (await db.query<{ processed_at: string | null }>(
      `SELECT processed_at FROM stripe_event WHERE stripe_event_id = $1`, [event.id]
    )).rows[0];
    if (row?.processed_at) { res.json({ received: true, duplicate: true }); return; }

    const outcome = await handleEvent(event);
    await db.query(`UPDATE stripe_event SET processed_at = now(), error = NULL WHERE stripe_event_id = $1`, [event.id]);
    console.log(`[stripe-webhook] ${event.type} ${event.id}: ${outcome}`);
    res.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UnknownCheckoutSessionError) {
      // Another environment's session (every endpoint of the account gets
      // every event): recorded, marked processed with the reason, never retried.
      console.warn(`[stripe-webhook] ${event.type} ${event.id}: ${message}; recorded, not retried`);
      await db.query(`UPDATE stripe_event SET processed_at = now(), error = $2 WHERE stripe_event_id = $1`, [event.id, message]).catch(() => undefined);
      res.json({ received: true, unknownSession: true });
      return;
    }
    console.error(`[stripe-webhook] ${event.type} ${event.id} failed:`, message);
    await db.query(`UPDATE stripe_event SET error = $2 WHERE stripe_event_id = $1`, [event.id, message.slice(0, 2000)]).catch(() => undefined);
    res.status(500).json({ error: 'webhook_handler_failed' });
  }
}
