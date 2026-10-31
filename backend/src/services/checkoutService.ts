// Commerce 1, B4 (2026-10-31) — the single writer of checkout_session,
// checkout_session_line, "order", order_line_item and order_event.
//
// Two systems joined by the order: payment (Stripe; a checkout_session is a
// priced cart waiting for payment) and fulfillment (services/fulfillment/).
// The webhook is the truth: an order exists only once Stripe says it is paid
// (completeCheckoutSession, called from routes/stripeWebhook.ts), never on a
// checkout attempt. "order" and order_line_item stay insert-only facts
// (Customer Blueprint D11, Dana 2026-10-31); everything that happens to an
// order afterwards is an order_event row, and v_order_status is the only read
// path for order state.
//
// Money: cents here and in Stripe; the order's money columns stay in dollars
// (subtotal, shipping_fee_charged, taxes_collected, transaction_fee,
// total_amount_paid, unit_price_charged, discount_amount), as they always were.
import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { db, withTransaction, type Tx } from '../db/client.js';
import { resolveCart, CartError, type CartItemInput, type ResolvedCart } from './cartResolver.js';
import { commerceParam, commerceParamText } from './commerceParameters.js';
import { stripe, STRIPE_ENABLED, getOrCreateStripeCustomer } from './stripe.js';

export class CheckoutError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'CheckoutError';
  }
}

type Runner = Pick<Tx, 'query'>;
const FRONTEND_URL = () => (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const toDollars = (cents: number | null | undefined) => (cents ?? 0) / 100;

// ── create ───────────────────────────────────────────────────────────────────

interface ShipTo {
  id: string;
  street: string; city: string; state: string; postal_code: string; country: string;
}

async function resolveShipTo(userId: string, shippingAddressId?: string | null): Promise<ShipTo> {
  const r = await db.query<ShipTo>(
    `SELECT id, street, city, state, postal_code, country FROM address
     WHERE user_id = $1 AND address_type = 'shipping' AND ($2::uuid IS NULL OR id = $2::uuid)
     ORDER BY is_default DESC, created_at
     LIMIT 1`,
    [userId, shippingAddressId ?? null]
  );
  if (!r.rows[0]) throw new CheckoutError(422, 'shipping_address_required', 'Add a shipping address before checking out.');
  return r.rows[0];
}

// Customer Blueprint C2, Part A4 (moved from routes/orders.ts) — who each bag
// is for: the same for every line, and the buyer or a member of the buyer's
// household; the buyer when the client names nobody (this path never sets
// "order".household_id and there is no company-gift order path, so D7's
// default always applies).
async function resolveIntendedFor(userId: string, householdId: string | null, items: Array<{ intendedForUserId?: string | null }>): Promise<string> {
  const named = items.filter(it => it.intendedForUserId !== undefined).map(it => it.intendedForUserId ?? null);
  if (!named.length) return userId;
  if (new Set(named).size > 1) throw new CheckoutError(400, 'invalid_recipient', 'intendedForUserId must be the same for every line in one order');
  const target = named[0];
  if (!target || target === userId) return userId;
  const member = householdId
    ? (await db.query(`SELECT 1 FROM user_profile WHERE id = $1 AND household_id = $2`, [target, householdId])).rows.length > 0
    : false;
  if (!member) throw new CheckoutError(400, 'invalid_recipient', "intendedForUserId must be the buyer or a member of the buyer's household");
  return target;
}

function fingerprint(cart: ResolvedCart, shipTo: ShipTo, intendedFor: string): string {
  return createHash('sha256').update(JSON.stringify({
    lines: cart.lines.map(l => [l.coffeeSkuId, l.quantity, l.unitPriceCents, l.discountCents, l.source, l.archetype, l.dialSortOrder]),
    shipping: cart.shippingCents, shipTo, intendedFor,
  })).digest('hex');
}

export interface CreateCheckoutInput {
  uid: string;
  email: string | null;
  items: Array<CartItemInput & { intendedForUserId?: string | null }>;
  shippingAddressId?: string | null;
}
export interface CreateCheckoutResult { clientSecret: string; checkoutSessionId: string; reused: boolean }

export async function createCheckoutSession(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
  if (!STRIPE_ENABLED) throw new CheckoutError(503, 'checkout_unavailable', 'Checkout is not available yet.');
  const profile = (await db.query<{ id: string; household_id: string | null; first_name: string | null; last_name: string | null }>(
    `SELECT id, household_id, first_name, last_name FROM user_profile WHERE firebase_uid = $1`, [input.uid]
  )).rows[0];
  if (!profile) throw new CheckoutError(404, 'profile_not_found', 'User profile not found');

  const shipTo = await resolveShipTo(profile.id, input.shippingAddressId);
  const intendedFor = await resolveIntendedFor(profile.id, profile.household_id, input.items ?? []);
  const cart = await resolveCart(input.items);
  const print = fingerprint(cart, shipTo, intendedFor);

  // The same open cart twice within the expiry window reuses its session.
  const open = (await db.query<{ id: string; stripe_checkout_session_id: string | null }>(
    `SELECT id, stripe_checkout_session_id FROM checkout_session
     WHERE user_id = $1 AND cart_fingerprint = $2 AND status = 'open' AND expires_at > now() AND stripe_checkout_session_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [profile.id, print]
  )).rows[0];
  if (open) {
    const existing = await stripe().checkout.sessions.retrieve(open.stripe_checkout_session_id!);
    if (existing.status === 'open' && existing.client_secret) {
      return { clientSecret: existing.client_secret, checkoutSessionId: open.id, reused: true };
    }
    if (existing.status === 'expired') await expireCheckoutSession(existing.id);
  }

  const expiryMinutes = await commerceParam('checkout_session_expiry_minutes');
  const taxEnabled = (await commerceParam('tax_collection_enabled')) === 1;
  const coffeeTaxCode = await commerceParamText('stripe_tax_code_coffee');
  const shippingTaxCode = await commerceParamText('stripe_tax_code_shipping');
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000);

  const sessionId = await withTransaction(async tx => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO checkout_session
         (user_id, mode, status, cart_fingerprint, subtotal_cents, shipping_cents, bag_count, shipping_address_id,
          shipping_street, shipping_city, shipping_state, shipping_postal_code, shipping_country, expires_at)
       VALUES ($1, 'payment', 'open', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [profile.id, print, cart.subtotalCents, cart.shippingCents, cart.bagCount, shipTo.id,
       shipTo.street, shipTo.city, shipTo.state, shipTo.postal_code, shipTo.country, expiresAt]
    );
    for (const l of cart.lines) {
      await tx.query(
        `INSERT INTO checkout_session_line
           (checkout_session_id, coffee_sku_id, coffee_id, display_name, weight_oz, quantity, unit_price_cents,
            discount_cents, intended_for_user_id, order_kind, source, archetype, dial_sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10, $11, $12)`,
        [s.rows[0].id, l.coffeeSkuId, l.coffeeId, l.displayName, l.weightOz, l.quantity, l.unitPriceCents,
         l.discountCents, intendedFor, l.source, l.archetype, l.dialSortOrder]
      );
    }
    return s.rows[0].id;
  });

  try {
    const customer = await getOrCreateStripeCustomer(profile.id, input.email);
    // Stripe Tax needs a destination: the snapshot address, as the customer's shipping.
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || input.email || 'Customer';
    await stripe().customers.update(customer, {
      shipping: {
        name,
        address: { line1: shipTo.street, city: shipTo.city, state: shipTo.state, postal_code: shipTo.postal_code, country: shipTo.country },
      },
    });
    const session = await stripe().checkout.sessions.create({
      ui_mode: 'embedded_page',
      mode: 'payment',
      customer,
      line_items: cart.lines.map(l => ({
        quantity: l.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: l.unitPriceCents,
          tax_behavior: 'exclusive',
          product_data: {
            name: l.displayName,
            description: [`${l.weightOz} oz`, l.archetypeLabel].filter(Boolean).join(' · '),
            tax_code: coffeeTaxCode,
          },
        },
      })),
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: cart.shippingCents, currency: 'usd' },
          display_name: cart.shippingCents > 0 ? 'Shipping' : 'Free shipping',
          tax_behavior: 'exclusive',
          tax_code: shippingTaxCode,
        },
      }],
      automatic_tax: { enabled: taxEnabled },
      ...(taxEnabled ? { customer_update: { shipping: 'auto' as const } } : {}),
      metadata: { checkout_session_id: sessionId },
      payment_intent_data: { metadata: { checkout_session_id: sessionId } },
      return_url: `${FRONTEND_URL()}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    }, { idempotencyKey: `checkout_session:${sessionId}` });

    await db.query(`UPDATE checkout_session SET stripe_checkout_session_id = $1 WHERE id = $2`, [session.id, sessionId]);
    if (!session.client_secret) throw new Error('Stripe returned no client_secret for an embedded session');
    return { clientSecret: session.client_secret, checkoutSessionId: sessionId, reused: false };
  } catch (err) {
    // A session Stripe never opened must not stay open here.
    await db.query(`UPDATE checkout_session SET status = 'expired' WHERE id = $1 AND status = 'open'`, [sessionId]).catch(() => undefined);
    throw err;
  }
}

// ── complete / expire (the webhook) ──────────────────────────────────────────

async function transactionFeeCents(paymentIntentId: string | null): Promise<number | null> {
  if (!paymentIntentId) return null;
  try {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
    const charge = pi.latest_charge as Stripe.Charge | null;
    const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null | undefined;
    return bt && typeof bt === 'object' ? bt.fee : null;
  } catch (err) {
    console.warn('[checkout] balance transaction not retrievable', paymentIntentId, err instanceof Error ? err.message : err);
    return null;
  }
}

const idOf = (v: string | { id: string } | null | undefined) => (v == null ? null : typeof v === 'string' ? v : v.id);

/**
 * A completed Stripe session this database never created: the account's
 * webhook endpoints all receive every event, so a session opened from another
 * environment (local acceptance runs against the test DB) reaches prod too.
 * Not retryable: the webhook records it and answers 200.
 */
export class UnknownCheckoutSessionError extends Error {
  constructor(public stripeCheckoutSessionId: string) {
    super(`no checkout_session for Stripe session ${stripeCheckoutSessionId}`);
    this.name = 'UnknownCheckoutSessionError';
  }
}

export interface CompleteResult { orderId: string; created: boolean }

/**
 * Write the paid order for a completed Stripe Checkout Session, exactly once:
 * idempotent on stripe_checkout_session_id (a second call returns the first
 * order). One transaction: "order", its lines, the paid order_event, and the
 * session marked complete.
 */
export async function completeCheckoutSession(session: Stripe.Checkout.Session): Promise<CompleteResult> {
  const paymentIntentId = idOf(session.payment_intent as string | Stripe.PaymentIntent | null);
  const feeCents = await transactionFeeCents(paymentIntentId);

  return withTransaction(async tx => {
    const existing = await tx.query<{ id: string }>(`SELECT id FROM "order" WHERE stripe_checkout_session_id = $1`, [session.id]);
    if (existing.rows[0]) return { orderId: existing.rows[0].id, created: false };

    const cs = (await tx.query(
      `SELECT * FROM checkout_session WHERE stripe_checkout_session_id = $1 OR id::text = $2 FOR UPDATE`,
      [session.id, session.metadata?.checkout_session_id ?? '']
    )).rows[0];
    if (!cs) throw new UnknownCheckoutSessionError(session.id);

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO "order"
         (user_id, fulfillment_status, subtotal, shipping_fee_charged, taxes_collected, transaction_fee, total_amount_paid,
          currency, shipping_street, shipping_city, shipping_state, shipping_postal_code, shipping_country, shipping_address_id,
          checkout_session_id, stripe_checkout_session_id, stripe_payment_intent_id, paid_at, fulfillment_roaster_id)
       VALUES ($1, 'awaiting_manual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), NULL)
       ON CONFLICT (stripe_checkout_session_id) DO NOTHING
       RETURNING id`,
      [cs.user_id, toDollars(cs.subtotal_cents), toDollars(session.total_details?.amount_shipping ?? cs.shipping_cents),
       toDollars(session.total_details?.amount_tax), feeCents === null ? null : toDollars(feeCents), toDollars(session.amount_total),
       (session.currency ?? 'usd').toUpperCase(), cs.shipping_street, cs.shipping_city, cs.shipping_state, cs.shipping_postal_code,
       cs.shipping_country, cs.shipping_address_id, cs.id, session.id, paymentIntentId]
    );
    if (!inserted.rows[0]) {
      const again = await tx.query<{ id: string }>(`SELECT id FROM "order" WHERE stripe_checkout_session_id = $1`, [session.id]);
      return { orderId: again.rows[0].id, created: false };
    }
    const orderId = inserted.rows[0].id;

    const lines = await tx.query(`SELECT * FROM checkout_session_line WHERE checkout_session_id = $1 ORDER BY created_at, id`, [cs.id]);
    for (const l of lines.rows) {
      await tx.query(
        `INSERT INTO order_line_item
           (order_id, blend_id, quantity, unit_price_charged, discount_amount, intended_for_user_id, order_kind, display_name, weight_oz)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [orderId, l.coffee_sku_id, l.quantity, toDollars(l.unit_price_cents), toDollars(l.discount_cents),
         l.intended_for_user_id, l.order_kind, l.display_name, l.weight_oz]
      );
    }
    await recordOrderEvent({
      orderId, kind: 'paid', paymentStatus: 'paid', fulfillmentStatus: 'awaiting_manual', stripeRef: paymentIntentId, source: 'webhook',
    }, tx);
    await tx.query(
      `UPDATE checkout_session SET status = 'complete', completed_at = now(), order_id = $1 WHERE id = $2`, [orderId, cs.id]
    );
    return { orderId, created: true };
  });
}

/** Stripe expired the session (or its async payment failed): no order. */
export async function expireCheckoutSession(stripeCheckoutSessionId: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE checkout_session SET status = 'expired' WHERE stripe_checkout_session_id = $1 AND status = 'open'`, [stripeCheckoutSessionId]
  );
  return (r.rowCount ?? 0) > 0;
}

// ── order events (insert-only) ───────────────────────────────────────────────

export type OrderEventKind =
  | 'paid' | 'finalized' | 'fulfillment_dispatched' | 'fulfillment_placed' | 'fulfillment_failed'
  | 'fulfillment_needs_attention' | 'shipped' | 'delivered' | 'canceled' | 'refund_partial' | 'refund_full';

export interface OrderEventInput {
  orderId: string;
  kind: OrderEventKind;
  paymentStatus?: 'paid' | 'refunded' | 'partially_refunded' | null;
  fulfillmentStatus?: 'awaiting_manual' | 'placed' | 'shipped' | 'delivered' | 'canceled' | 'needs_attention' | null;
  amountRefundedCents?: number | null;
  stripeRef?: string | null;
  note?: string | null;
  source: 'webhook' | 'finalizer' | 'admin' | 'cron';
}

/** Append one order_event. A second finalized event for an order is a no-op (returns null). */
export async function recordOrderEvent(e: OrderEventInput, runner: Runner = db): Promise<number | null> {
  const r = await runner.query<{ id: number }>(
    `INSERT INTO order_event (order_id, event_kind, payment_status, fulfillment_status, amount_refunded_cents, stripe_ref, note, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (order_id) WHERE event_kind = 'finalized' DO NOTHING
     RETURNING id`,
    [e.orderId, e.kind, e.paymentStatus ?? null, e.fulfillmentStatus ?? null, e.amountRefundedCents ?? null,
     e.stripeRef ?? null, e.note ?? null, e.source]
  );
  return r.rows[0]?.id ?? null;
}

/**
 * charge.refunded: Stripe's amount_refunded is cumulative, so each event
 * carries the running total; full when it reaches the charge amount.
 */
export async function recordRefund(charge: Stripe.Charge): Promise<{ orderId: string | null }> {
  const paymentIntentId = idOf(charge.payment_intent as string | Stripe.PaymentIntent | null);
  if (!paymentIntentId) return { orderId: null };
  const order = (await db.query<{ id: string }>(`SELECT id FROM "order" WHERE stripe_payment_intent_id = $1`, [paymentIntentId])).rows[0];
  if (!order) return { orderId: null };
  const full = charge.amount_refunded >= charge.amount;
  await recordOrderEvent({
    orderId: order.id, kind: full ? 'refund_full' : 'refund_partial',
    paymentStatus: full ? 'refunded' : 'partially_refunded',
    amountRefundedCents: charge.amount_refunded, stripeRef: charge.id, source: 'webhook',
  });
  return { orderId: order.id };
}

// ── reads ────────────────────────────────────────────────────────────────────

export interface OrderSummary {
  orderId: string;
  userId: string;
  firebaseUid: string;
  email: string | null;
  firstName: string | null;
  createdAt: string;
  paidAt: string | null;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shipsTo: { street: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null };
  stripePaymentIntentId: string | null;
  fulfillmentRoasterId: string | null;
  lines: Array<{ blendId: string; coffeeId: number | null; displayName: string | null; weightOz: number | null; quantity: number; unitPriceCents: number }>;
  status: { paymentStatus: string | null; fulfillmentStatus: string | null; customerLabel: string | null; finalizedAt: string | null; orderPlacedLine: string | null };
}

const cents = (dollars: string | number | null) => Math.round(Number(dollars ?? 0) * 100);

/** One order with its lines and its v_order_status row. */
export async function getOrderSummary(orderId: string, runner: Runner = db): Promise<OrderSummary | null> {
  const o = (await runner.query(
    `SELECT o.*, up.firebase_uid, up.first_name, s.payment_status, s.fulfillment_status AS current_fulfillment_status,
            s.customer_label, s.finalized_at, s.order_placed_line
     FROM "order" o
     JOIN user_profile up ON up.id = o.user_id
     JOIN v_order_status s ON s.order_id = o.id
     WHERE o.id = $1`, [orderId]
  )).rows[0];
  if (!o) return null;
  const lines = await runner.query(
    `SELECT li.blend_id, sku.coffee_id, li.display_name, li.weight_oz, li.quantity, li.unit_price_charged
     FROM order_line_item li LEFT JOIN coffee_sku sku ON sku.id = li.blend_id
     WHERE li.order_id = $1 ORDER BY li.created_at, li.id`, [orderId]
  );
  return {
    orderId: o.id, userId: o.user_id, firebaseUid: o.firebase_uid, email: null, firstName: o.first_name,
    createdAt: o.created_at, paidAt: o.paid_at,
    subtotalCents: cents(o.subtotal), shippingCents: cents(o.shipping_fee_charged), taxCents: cents(o.taxes_collected),
    totalCents: cents(o.total_amount_paid),
    shipsTo: { street: o.shipping_street, city: o.shipping_city, state: o.shipping_state, postalCode: o.shipping_postal_code, country: o.shipping_country },
    stripePaymentIntentId: o.stripe_payment_intent_id, fulfillmentRoasterId: o.fulfillment_roaster_id,
    lines: lines.rows.map(l => ({
      blendId: l.blend_id, coffeeId: l.coffee_id ?? null, displayName: l.display_name, weightOz: l.weight_oz === null ? null : Number(l.weight_oz),
      quantity: l.quantity, unitPriceCents: cents(l.unit_price_charged),
    })),
    status: {
      paymentStatus: o.payment_status, fulfillmentStatus: o.current_fulfillment_status, customerLabel: o.customer_label,
      finalizedAt: o.finalized_at, orderPlacedLine: o.order_placed_line,
    },
  };
}

export interface SessionStatus {
  status: 'open' | 'complete' | 'expired';
  orderId?: string;
  finalized?: boolean;
  orderPlacedLine?: string | null;
  order?: {
    lines: Array<{ displayName: string | null; weightOz: number | null; quantity: number }>;
    shipsTo: OrderSummary['shipsTo'];
    subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number;
    customerLabel: string | null;
  };
}

/** GET /api/checkout/session/:id/status — our tables only, ownership-checked; :id is ours or Stripe's (cs_...). */
export async function getSessionStatus(uid: string, id: string): Promise<SessionStatus | null> {
  const cs = (await db.query<{ status: SessionStatus['status']; order_id: string | null }>(
    `SELECT cs.status, cs.order_id FROM checkout_session cs JOIN user_profile up ON up.id = cs.user_id
     WHERE up.firebase_uid = $1 AND (cs.stripe_checkout_session_id = $2 OR cs.id::text = $2)`,
    [uid, id]
  )).rows[0];
  if (!cs) return null;
  if (cs.status !== 'complete' || !cs.order_id) return { status: cs.status };
  const o = await getOrderSummary(cs.order_id);
  if (!o) return { status: cs.status };
  return {
    status: 'complete', orderId: o.orderId, finalized: Boolean(o.status.finalizedAt), orderPlacedLine: o.status.orderPlacedLine,
    order: {
      lines: o.lines.map(l => ({ displayName: l.displayName, weightOz: l.weightOz, quantity: l.quantity })),
      shipsTo: o.shipsTo, subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, taxCents: o.taxCents, totalCents: o.totalCents,
      customerLabel: o.status.customerLabel,
    },
  };
}

/** Did the order already finalize? (orderFinalizer's idempotency, read inside its transaction.) */
export async function isFinalized(orderId: string, runner: Runner = db): Promise<boolean> {
  const r = await runner.query(`SELECT 1 FROM order_event WHERE order_id = $1 AND event_kind = 'finalized'`, [orderId]);
  return r.rows.length > 0;
}

export { CartError };
