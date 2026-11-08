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
//
// Commerce 2 (2026-10-31): a checkout can start a subscription
// (subscription: { frequencyWeeks }): the lines are priced by the
// subscription tier (subscriptionShipment.applySubscriptionPricing, no
// collection discount), Stripe saves the card for off-session use, and the
// completion writes the subscription (subscriptionService) in the same
// transaction as the first delivery's order. Each later cycle is a Stripe
// invoice; createSubscriptionOrder writes its order from invoice.paid. This
// module stays the one writer of "order" and order_line_item.
import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { db, withTransaction, type Tx } from '../db/client.js';
import { resolveCart, CartError, type CartItemInput, type ResolvedCart } from './cartResolver.js';
import { commerceParam, commerceParamText } from './commerceParameters.js';
import { stripe, STRIPE_ENABLED, getOrCreateStripeCustomer } from './stripe.js';
import { applySubscriptionPricing } from './subscriptionShipment.js';
import { activeHouseholdOf, openHandoverOffer } from './householdReads.js';
import { recordHandoverRedeemed } from './householdService.js';
import {
  createPaidSubscriptionFromCheckout, recordSubscriptionStarted, markRenewalCharged, todayEastern, type SubscriptionIntent,
} from './subscriptionService.js';

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

const shipsToOf = (s: ShipTo): ShipsTo => ({ street: s.street, city: s.city, state: s.state, postalCode: s.postal_code, country: s.country });

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
// is for. Family Household 3 (2026-11-07, B1): per cart item. Each item's
// intendedForUserId is absent/null/the buyer (the buyer's own bag) or an active
// member of the buyer's household whose roles put them in the house box
// (v_household_membership, in_house_box); anything else is 400. The buyer's
// own lines store the buyer's id (attribution reads it, D24). householdId is
// the buyer's active household (CTO call 1: every order of a household member
// carries it, for counting).
export async function resolveIntendedFor(
  userId: string, items: Array<{ intendedForUserId?: string | null }>,
): Promise<{ perItem: string[]; householdId: string | null }> {
  const householdId = await activeHouseholdOf(userId);
  const allowed = new Set<string>([userId]);
  if (householdId) {
    const r = await db.query<{ user_id: string }>(
      `SELECT user_id FROM v_household_membership WHERE household_id = $1 AND status_code = 'active' AND in_house_box`, [householdId]
    );
    for (const row of r.rows) allowed.add(row.user_id);
  }
  const perItem = items.map(it => {
    const target = it.intendedForUserId ?? null;
    if (!target || target === userId) return userId;
    if (!allowed.has(target)) {
      throw new CheckoutError(400, 'invalid_recipient', "Each bag is for you or for someone in your Family Household's box");
    }
    return target;
  });
  return { perItem, householdId };
}

export function fingerprint(cart: ResolvedCart, shipTo: ShipTo, recipients: string[], intent: SubscriptionIntent | null): string {
  return createHash('sha256').update(JSON.stringify({
    // Family Household 3: each line's recipient is part of the cart.
    lines: cart.lines.map(l => [l.coffeeSkuId, l.quantity, l.unitPriceCents, l.discountCents, l.source, l.archetype, l.dialSortOrder, recipients[l.itemIndex ?? 0]]),
    shipping: cart.shippingCents, shipTo,
    // Commerce 2: the same cart as a subscription is a different session.
    ...(intent ? { subscription: intent.frequencyWeeks } : {}),
  })).digest('hex');
}

/** The frequencies offered, from commerce_parameter subscription_frequency_weeks ("2,4,6"). */
export async function subscriptionFrequencies(): Promise<number[]> {
  return (await commerceParamText('subscription_frequency_weeks')).split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
}

/**
 * B3: re-price a resolved cart for a subscription. Every line goes back to
 * its pricing-table price (a collection member's share of the collection
 * discount is added back: the two never stack, Dana 2026-10-31) and takes the
 * subscription tier by total bags. Shipping is unchanged (same bag count,
 * same rule).
 */
async function priceForSubscription(cart: ResolvedCart, extraPct = 0): Promise<ResolvedCart> {
  const pricing = await applySubscriptionPricing(cart.lines.map(l => ({ ...l, fullPriceCents: l.unitPriceCents + l.discountCents })), extraPct);
  return {
    ...cart,
    lines: pricing.lines.map(({ fullPriceCents: _full, ...l }) => l),
    subtotalCents: pricing.subtotalCents,
  };
}

export interface CartQuote {
  bagCount: number;
  subtotalCents: number;
  shippingCents: number;
  /**
   * The same cart as a subscription: the tier by bag count, no collection
   * discount (null when not asked). Family Household 3 (D22): `offer` is the
   * handover perk when the signed-in buyer has an open offer (first box only):
   * its percentage, what it takes off, and the line's words.
   */
  subscription: {
    frequencyWeeks: number; discountPct: number; discountCents: number; subtotalCents: number;
    offer?: { pct: number; cents: number; label: string; expiresAt: string } | null;
  } | null;
}

/** D22's words for the quote line. */
const HANDOVER_OFFER_LABEL = 'Family Household offer';

/**
 * Commerce 2, C1: POST /api/checkout/quote — the cart summary's numbers from
 * the server (the frontend never computes a discount): the cart priced as
 * checkout would price it, and, when asked, as a subscription. Read-only;
 * the client's prices are checked exactly as at checkout (409 when stale).
 */
export async function quoteCart(items: CartItemInput[], subscription: { frequencyWeeks: number } | null, buyerUid: string | null = null): Promise<CartQuote> {
  const cart = await resolveCart(items);
  let sub: CartQuote['subscription'] = null;
  if (subscription) {
    const weeks = Number(subscription.frequencyWeeks);
    if (!(await subscriptionFrequencies()).includes(weeks)) throw new CheckoutError(400, 'invalid_frequency', 'Choose one of the delivery frequencies offered.');
    const full = cart.lines.map(l => ({ ...l, fullPriceCents: l.unitPriceCents + l.discountCents }));
    const tier = await applySubscriptionPricing(full);
    const buyerId = buyerUid
      ? (await db.query<{ id: string }>(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [buyerUid])).rows[0]?.id ?? null
      : null;
    const offer = buyerId ? await openHandoverOffer(buyerId) : null;
    const pricing = offer ? await applySubscriptionPricing(full, offer.pct) : tier;
    sub = {
      frequencyWeeks: weeks, discountPct: pricing.discountPct, discountCents: pricing.discountCents, subtotalCents: pricing.subtotalCents,
      ...(offer ? { offer: { pct: offer.pct, cents: tier.subtotalCents - pricing.subtotalCents, label: HANDOVER_OFFER_LABEL, expiresAt: offer.expiresAt } } : {}),
    };
  }
  return { bagCount: cart.bagCount, subtotalCents: cart.subtotalCents, shippingCents: cart.shippingCents, subscription: sub };
}

export interface CreateCheckoutInput {
  uid: string;
  email: string | null;
  items: Array<CartItemInput & { intendedForUserId?: string | null }>;
  shippingAddressId?: string | null;
  /** Commerce 2: start a subscription delivering every frequencyWeeks weeks (one of subscription_frequency_weeks). */
  subscription?: { frequencyWeeks: number } | null;
}
export interface ShipsTo { street: string; city: string; state: string; postalCode: string; country: string }
/** shipsTo: the snapshot the session ships to (the given address, else the profile's default), so the page can show it even when it could not load the profile. */
export interface CreateCheckoutResult { clientSecret: string; checkoutSessionId: string; reused: boolean; shipsTo: ShipsTo }

export async function createCheckoutSession(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
  if (!STRIPE_ENABLED) throw new CheckoutError(503, 'checkout_unavailable', 'Checkout is not available yet.');
  const profile = (await db.query<{ id: string; first_name: string | null; last_name: string | null }>(
    `SELECT id, first_name, last_name FROM user_profile WHERE firebase_uid = $1`, [input.uid]
  )).rows[0];
  if (!profile) throw new CheckoutError(404, 'profile_not_found', 'User profile not found');

  let intent: SubscriptionIntent | null = null;
  if (input.subscription) {
    const weeks = Number(input.subscription.frequencyWeeks);
    if (!(await subscriptionFrequencies()).includes(weeks)) {
      throw new CheckoutError(400, 'invalid_frequency', 'Choose one of the delivery frequencies offered.');
    }
    intent = { frequencyWeeks: weeks, startsSubscription: true };
  }

  const shipTo = await resolveShipTo(profile.id, input.shippingAddressId);
  const { perItem: recipients } = await resolveIntendedFor(profile.id, input.items ?? []);
  const resolved = await resolveCart(input.items);
  // Family Household 3 (D22, CTO call 2): an open handover offer adds its
  // percentage to the tier on this, the first box; recorded on the session and
  // redeemed when it completes. Renewals are at the normal tier.
  const offer = intent ? await openHandoverOffer(profile.id) : null;
  const cart = intent ? await priceForSubscription(resolved, offer?.pct ?? 0) : resolved;
  const print = fingerprint(cart, shipTo, recipients, intent);

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
      return { clientSecret: existing.client_secret, checkoutSessionId: open.id, reused: true, shipsTo: shipsToOf(shipTo) };
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
          shipping_street, shipping_city, shipping_state, shipping_postal_code, shipping_country, expires_at, subscription_intent,
          handover_offer_event_id)
       VALUES ($1, $13, 'open', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $14, $15)
       RETURNING id`,
      [profile.id, print, cart.subtotalCents, cart.shippingCents, cart.bagCount, shipTo.id,
       shipTo.street, shipTo.city, shipTo.state, shipTo.postal_code, shipTo.country, expiresAt,
       intent ? 'subscription' : 'payment', intent ? JSON.stringify(intent) : null, offer?.eventId ?? null]
    );
    for (const l of cart.lines) {
      await tx.query(
        `INSERT INTO checkout_session_line
           (checkout_session_id, coffee_sku_id, coffee_id, display_name, weight_oz, quantity, unit_price_cents,
            discount_cents, intended_for_user_id, order_kind, source, archetype, dial_sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10, $11, $12)`,
        [s.rows[0].id, l.coffeeSkuId, l.coffeeId, l.displayName, l.weightOz, l.quantity, l.unitPriceCents,
         l.discountCents, recipients[l.itemIndex ?? 0], l.source, l.archetype, l.dialSortOrder]
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
            description: [`${l.weightOz} oz`, l.archetypeLabel, intent ? `every ${intent.frequencyWeeks} weeks` : null].filter(Boolean).join(' · '),
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
      // A subscription checkout saves the card for the renewals our cron
      // charges off-session; Checkout then offers only reusable methods.
      payment_intent_data: {
        metadata: { checkout_session_id: sessionId },
        ...(intent ? { setup_future_usage: 'off_session' as const } : {}),
      },
      return_url: `${FRONTEND_URL()}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    }, { idempotencyKey: `checkout_session:${sessionId}` });

    await db.query(`UPDATE checkout_session SET stripe_checkout_session_id = $1 WHERE id = $2`, [session.id, sessionId]);
    if (!session.client_secret) throw new Error('Stripe returned no client_secret for an embedded session');
    return { clientSecret: session.client_secret, checkoutSessionId: sessionId, reused: false, shipsTo: shipsToOf(shipTo) };
  } catch (err) {
    // A session Stripe never opened must not stay open here.
    await db.query(`UPDATE checkout_session SET status = 'expired' WHERE id = $1 AND status = 'open'`, [sessionId]).catch(() => undefined);
    throw err;
  }
}

// ── complete / expire (the webhook) ──────────────────────────────────────────

/** The charge's Stripe fee (cents) and the PaymentMethod it used (saved off-session on a subscription checkout). */
async function paymentDetails(paymentIntentId: string | null): Promise<{ feeCents: number | null; paymentMethodId: string | null }> {
  if (!paymentIntentId) return { feeCents: null, paymentMethodId: null };
  try {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
    const charge = pi.latest_charge as Stripe.Charge | null;
    const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null | undefined;
    return { feeCents: bt && typeof bt === 'object' ? bt.fee : null, paymentMethodId: idOf(pi.payment_method as string | Stripe.PaymentMethod | null) };
  } catch (err) {
    console.warn('[checkout] payment intent not retrievable', paymentIntentId, err instanceof Error ? err.message : err);
    return { feeCents: null, paymentMethodId: null };
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
  const { feeCents, paymentMethodId } = await paymentDetails(paymentIntentId);

  return withTransaction(async tx => {
    const existing = await tx.query<{ id: string }>(`SELECT id FROM "order" WHERE stripe_checkout_session_id = $1`, [session.id]);
    if (existing.rows[0]) return { orderId: existing.rows[0].id, created: false };

    const cs = (await tx.query(
      `SELECT * FROM checkout_session WHERE stripe_checkout_session_id = $1 OR id::text = $2 FOR UPDATE`,
      [session.id, session.metadata?.checkout_session_id ?? '']
    )).rows[0];
    if (!cs) throw new UnknownCheckoutSessionError(session.id);
    // Under the session lock: a concurrent delivery that got here first has committed its order.
    if (cs.order_id) return { orderId: cs.order_id as string, created: false };
    const lines = await tx.query(`SELECT * FROM checkout_session_line WHERE checkout_session_id = $1 ORDER BY created_at, id`, [cs.id]);

    // Commerce 2: a subscription checkout. "order" is insert-only (D11), so
    // the subscription exists first and the order carries its id at insert;
    // the subscription then points at the order (started event, last_order_id).
    // Family Household 3 (CTO call 1): the buyer's active household, at payment.
    const householdId = await activeHouseholdOf(cs.user_id, tx);
    const subscriptionId: string | null = cs.subscription_intent
      ? await createPaidSubscriptionFromCheckout(tx, cs, lines.rows, { paymentMethodId, householdId })
      : null;

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO "order"
         (user_id, fulfillment_status, subtotal, shipping_fee_charged, taxes_collected, transaction_fee, total_amount_paid,
          currency, shipping_street, shipping_city, shipping_state, shipping_postal_code, shipping_country, shipping_address_id,
          checkout_session_id, stripe_checkout_session_id, stripe_payment_intent_id, paid_at, fulfillment_roaster_id,
          is_subscription, subscription_id, household_id)
       VALUES ($1, 'awaiting_manual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), NULL, $17, $18, $19)
       ON CONFLICT (stripe_checkout_session_id) DO NOTHING
       RETURNING id`,
      [cs.user_id, toDollars(cs.subtotal_cents), toDollars(session.total_details?.amount_shipping ?? cs.shipping_cents),
       toDollars(session.total_details?.amount_tax), feeCents === null ? null : toDollars(feeCents), toDollars(session.amount_total),
       (session.currency ?? 'usd').toUpperCase(), cs.shipping_street, cs.shipping_city, cs.shipping_state, cs.shipping_postal_code,
       cs.shipping_country, cs.shipping_address_id, cs.id, session.id, paymentIntentId, subscriptionId !== null, subscriptionId, householdId]
    );
    if (!inserted.rows[0]) {
      // Lost a race to a concurrent delivery of the same event. With a
      // subscription this transaction already wrote one, so it rolls back
      // (the webhook answers 500, Stripe retries and finds the order).
      if (subscriptionId) throw new Error(`order for Stripe session ${session.id} was written concurrently; retry`);
      const again = await tx.query<{ id: string }>(`SELECT id FROM "order" WHERE stripe_checkout_session_id = $1`, [session.id]);
      return { orderId: again.rows[0].id, created: false };
    }
    const orderId = inserted.rows[0].id;
    if (subscriptionId) await recordSubscriptionStarted(tx, subscriptionId, { orderId, amountCents: session.amount_total ?? null });

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
    // Family Household 3 (D22): the handover perk this session priced in is used now (once per offer).
    if (cs.handover_offer_event_id && subscriptionId) {
      await recordHandoverRedeemed(tx, cs.handover_offer_event_id, { orderId, subscriptionId, userId: cs.user_id });
    }
    await tx.query(
      `UPDATE checkout_session SET status = 'complete', completed_at = now(), order_id = $1, subscription_id = $3 WHERE id = $2`,
      [orderId, cs.id, subscriptionId]
    );
    return { orderId, created: true };
  });
}

// ── subscription renewals (Commerce 2, B5: invoice.paid) ─────────────────────

/**
 * A paid invoice whose metadata names a subscription this database does not
 * have (another environment's; every endpoint gets every event). Not
 * retryable: the webhook records it and answers 200, like an unknown session.
 */
export class UnknownSubscriptionError extends Error {
  constructor(public subscriptionId: string, public invoiceId: string) {
    super(`no subscription ${subscriptionId} for Stripe invoice ${invoiceId}`);
    this.name = 'UnknownSubscriptionError';
  }
}

export interface RenewalLineMetadata {
  kind: 'coffee' | 'shipping';
  coffee_sku_id?: string;
  coffee_id?: string;
  display_name?: string;
  weight_oz?: string;
  unit_price_cents?: string;
  discount_cents?: string;
  /** Family Household 3: the member this bag is for (absent = the subscriber). */
  intended_for_user_id?: string;
}

const isUuid = (s: string | undefined) => Boolean(s && /^[0-9a-f-]{36}$/i.test(s));

/**
 * Write the renewal order for a paid subscription invoice, exactly once:
 * idempotent on stripe_invoice_id. One transaction: "order"
 * (is_subscription, subscription_id, stripe_invoice_id, amounts from the
 * invoice, ships to the profile's current default address), its lines
 * (order_kind subscription_renewal, house names, the discounted price and the
 * per-bag discount, from the invoice items' metadata the cron wrote), the paid
 * order_event, then subscriptionService.markRenewalCharged (renewal_charged,
 * back to active, next date). The caller runs finalizePaidOrder.
 */
export async function createSubscriptionOrder(invoice: Stripe.Invoice): Promise<CompleteResult & { subscriptionId: string }> {
  const subscriptionId = invoice.metadata?.subscription_id ?? '';
  const invoiceId = invoice.id!;
  if (!isUuid(subscriptionId)) throw new UnknownSubscriptionError(subscriptionId, invoiceId);
  const known = (await db.query(`SELECT 1 FROM subscription WHERE id = $1`, [subscriptionId])).rows.length > 0;
  if (!known) throw new UnknownSubscriptionError(subscriptionId, invoiceId);

  // Task 0 (0.8): at this API version the PaymentIntent is under
  // invoice.payments, and tax is total_taxes.
  const full = await stripe().invoices.retrieve(invoiceId, { expand: ['payments'] });
  const payment = full.payments?.data.find(p => p.status === 'paid') ?? full.payments?.data[0];
  const paymentIntentId = idOf(payment?.payment?.payment_intent as string | Stripe.PaymentIntent | undefined);
  const { feeCents } = await paymentDetails(paymentIntentId);
  const items = (await stripe().invoiceItems.list({ invoice: invoiceId, limit: 100 })).data;
  const coffee = items.filter(i => (i.metadata as unknown as RenewalLineMetadata | null)?.kind === 'coffee');
  const shippingCents = items.filter(i => i.metadata?.kind === 'shipping').reduce((s, i) => s + i.amount, 0);
  const taxCents = (full.total_taxes ?? []).reduce((s, t) => s + t.amount, 0);
  const paidAt = full.status_transitions?.paid_at ? new Date(full.status_transitions.paid_at * 1000) : new Date();
  const cycleDate = full.metadata?.cycle_date ?? todayEastern(paidAt);

  return withTransaction(async tx => {
    const existing = await tx.query<{ id: string }>(`SELECT id FROM "order" WHERE stripe_invoice_id = $1`, [invoiceId]);
    if (existing.rows[0]) return { orderId: existing.rows[0].id, created: false, subscriptionId };

    const sub = (await tx.query<{ user_id: string }>(`SELECT user_id FROM subscription WHERE id = $1 FOR UPDATE`, [subscriptionId])).rows[0];
    // The customer paid: the order is written even without a saved address
    // (the snapshot is then empty and the admin email shows it).
    const shipTo = await resolveShipTo(sub.user_id).catch(() => null);
    const lineRows = coffee.map(i => {
      const m = i.metadata as unknown as RenewalLineMetadata;
      return {
        skuId: m.coffee_sku_id!, displayName: m.display_name ?? null, weightOz: m.weight_oz ? Number(m.weight_oz) : null,
        quantity: i.quantity, unitCents: Number(m.unit_price_cents), discountCents: Number(m.discount_cents ?? 0),
        intendedFor: isUuid(m.intended_for_user_id) ? m.intended_for_user_id! : sub.user_id,
      };
    });
    // Family Household 3 (CTO call 1): the subscriber's active household, at payment.
    const householdId = await activeHouseholdOf(sub.user_id, tx);
    const subtotalCents = lineRows.reduce((s, l) => s + l.unitCents * l.quantity, 0);

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO "order"
         (user_id, fulfillment_status, subtotal, shipping_fee_charged, taxes_collected, transaction_fee, total_amount_paid,
          currency, shipping_street, shipping_city, shipping_state, shipping_postal_code, shipping_country, shipping_address_id,
          stripe_payment_intent_id, paid_at, fulfillment_roaster_id, is_subscription, subscription_id, stripe_invoice_id, household_id)
       VALUES ($1, 'awaiting_manual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULL, true, $16, $17, $18)
       ON CONFLICT (stripe_invoice_id) DO NOTHING
       RETURNING id`,
      [sub.user_id, toDollars(subtotalCents), toDollars(shippingCents), toDollars(taxCents),
       feeCents === null ? null : toDollars(feeCents), toDollars(full.amount_paid), (full.currency ?? 'usd').toUpperCase(),
       shipTo?.street ?? null, shipTo?.city ?? null, shipTo?.state ?? null, shipTo?.postal_code ?? null, shipTo?.country ?? null,
       shipTo?.id ?? null, paymentIntentId, paidAt, subscriptionId, invoiceId, householdId]
    );
    if (!inserted.rows[0]) {
      const again = await tx.query<{ id: string }>(`SELECT id FROM "order" WHERE stripe_invoice_id = $1`, [invoiceId]);
      return { orderId: again.rows[0].id, created: false, subscriptionId };
    }
    const orderId = inserted.rows[0].id;

    for (const l of lineRows) {
      await tx.query(
        `INSERT INTO order_line_item
           (order_id, blend_id, quantity, unit_price_charged, discount_amount, intended_for_user_id, order_kind, display_name, weight_oz)
         VALUES ($1, $2, $3, $4, $5, $6, 'subscription_renewal', $7, $8)`,
        [orderId, l.skuId, l.quantity, toDollars(l.unitCents), toDollars(l.discountCents), l.intendedFor, l.displayName, l.weightOz]
      );
    }
    await recordOrderEvent({
      orderId, kind: 'paid', paymentStatus: 'paid', fulfillmentStatus: 'awaiting_manual', stripeRef: paymentIntentId ?? invoiceId, source: 'webhook',
    }, tx);
    await markRenewalCharged(tx, {
      subscriptionId, orderId, invoiceId, amountCents: full.amount_paid, cycleDate, paidDate: todayEastern(paidAt),
    });
    return { orderId, created: true, subscriptionId };
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
 *
 * Commerce 3: the reason is the newest refund's metadata.reason_code (the
 * admin refund route sets it; the Charge in the event does not carry its
 * refunds at API 2026-09-30, so they are listed; Task 0 finding 6). A full
 * refund of an order not yet placed with the roaster (awaiting_manual,
 * needs_attention) also cancels its fulfillment, here, when Stripe confirms
 * it, never on the admin's click (Dana, 2026-10-31, decision 4). A partial
 * refund never does.
 */
export async function recordRefund(charge: Stripe.Charge): Promise<{ orderId: string | null; canceledFulfillment: boolean }> {
  const paymentIntentId = idOf(charge.payment_intent as string | Stripe.PaymentIntent | null);
  if (!paymentIntentId) return { orderId: null, canceledFulfillment: false };
  const order = (await db.query<{ id: string }>(`SELECT id FROM "order" WHERE stripe_payment_intent_id = $1`, [paymentIntentId])).rows[0];
  if (!order) return { orderId: null, canceledFulfillment: false };
  const full = charge.amount_refunded >= charge.amount;

  let reasonCode: string | null = null;
  if (STRIPE_ENABLED) {
    const newest = (await stripe().refunds.list({ charge: charge.id, limit: 1 })).data[0];
    const code = newest?.metadata?.reason_code;
    if (code && (await db.query(`SELECT 1 FROM order_refund_reason WHERE code = $1`, [code])).rows.length) reasonCode = code;
  }

  return withTransaction(async tx => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`refund:${order.id}`]);
    await tx.query(
      `INSERT INTO order_event (order_id, event_kind, payment_status, amount_refunded_cents, stripe_ref, refund_reason, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'webhook')`,
      [order.id, full ? 'refund_full' : 'refund_partial', full ? 'refunded' : 'partially_refunded', charge.amount_refunded, charge.id, reasonCode]
    );
    let canceledFulfillment = false;
    if (full) {
      const st = (await tx.query<{ fulfillment_status: string | null }>(`SELECT fulfillment_status FROM v_order_status WHERE order_id = $1`, [order.id])).rows[0];
      if (st && REFUND_CANCELS_FROM.includes(st.fulfillment_status ?? '')) {
        await recordOrderEvent({
          orderId: order.id, kind: 'canceled', fulfillmentStatus: 'canceled', stripeRef: charge.id,
          note: `fully refunded before it was placed with the roaster (was ${st.fulfillment_status})`, source: 'webhook',
        }, tx);
        canceledFulfillment = true;
      }
    }
    return { orderId: order.id, canceledFulfillment };
  });
}

/** Fulfillment states a full refund cancels: nothing placed with the roaster yet. */
export const REFUND_CANCELS_FROM = ['awaiting_manual', 'needs_attention'];

export class RefundError extends Error {
  constructor(public status: 400 | 404 | 409, public code: string, message: string) { super(message); }
}

export interface RefundRequest { amountCents?: number | null; reason: string; adminId?: string | null }
export interface RefundRequestResult {
  refundId: string; status: string | null; amountCents: number; full: boolean;
  /** The order will be canceled when Stripe confirms (full refund, not yet placed). */
  cancelsFulfillment: boolean;
  /** Set when the order is already with the roaster or shipped: cancel it with them by hand. */
  warning: string | null;
  pastRefundWindow: boolean;
}

/**
 * B5: admin refund, full (no amount) or partial. Stripe is the truth: this
 * only asks Stripe; the order changes when charge.refunded arrives
 * (recordRefund). Idempotency key refund:<order>:<amount>:<n>, n = refund
 * events recorded so far, so a double click asks once.
 */
export async function requestRefund(orderId: string, req: RefundRequest): Promise<RefundRequestResult> {
  if (!STRIPE_ENABLED) throw new RefundError(409, 'stripe_not_configured', 'Stripe is not configured.');
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new RefundError(404, 'order_not_found', 'Order not found.');
  const o = (await db.query<{ stripe_payment_intent_id: string | null; total_amount_paid: string; paid_at: string | null; created_at: string;
    amount_refunded_cents: number; fulfillment_status: string | null; refunds: string; past_window: boolean }>(
    `SELECT o.stripe_payment_intent_id, o.total_amount_paid, o.paid_at, o.created_at, s.amount_refunded_cents, s.fulfillment_status,
            (SELECT count(*) FROM order_event e WHERE e.order_id = o.id AND e.event_kind IN ('refund_partial', 'refund_full')) AS refunds,
            COALESCE(o.paid_at, o.created_at) < now() - make_interval(days => $2::int) AS past_window
     FROM "order" o JOIN v_order_status s ON s.order_id = o.id WHERE o.id = $1`,
    [orderId, await commerceParam('refund_window_days')]
  )).rows[0];
  if (!o) throw new RefundError(404, 'order_not_found', 'Order not found.');
  if (!o.stripe_payment_intent_id) throw new RefundError(409, 'no_payment', 'This order has no Stripe payment to refund.');
  const reason = (await db.query<{ code: string; stripe_reason: string | null }>(`SELECT code, stripe_reason FROM order_refund_reason WHERE code = $1`, [req.reason])).rows[0];
  if (!reason) throw new RefundError(400, 'invalid_reason', 'Choose a refund reason.');

  const totalCents = cents(o.total_amount_paid);
  const remaining = totalCents - Number(o.amount_refunded_cents ?? 0);
  if (remaining <= 0) throw new RefundError(409, 'already_refunded', 'This order is already fully refunded.');
  const amount = req.amountCents == null ? remaining : Math.round(Number(req.amountCents));
  if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) {
    throw new RefundError(400, 'invalid_amount', `Refund between $0.01 and ${(remaining / 100).toFixed(2)}.`);
  }
  const full = amount === remaining;

  const refund = await stripe().refunds.create({
    payment_intent: o.stripe_payment_intent_id,
    amount,
    ...(reason.stripe_reason ? { reason: reason.stripe_reason as Stripe.RefundCreateParams.Reason } : {}),
    metadata: { order_id: orderId, reason_code: reason.code, ...(req.adminId ? { admin: req.adminId } : {}) },
  }, { idempotencyKey: `refund:${orderId}:${amount}:${Number(o.refunds)}` });

  const placed = o.fulfillment_status === 'placed' || o.fulfillment_status === 'shipped';
  return {
    refundId: refund.id, status: refund.status ?? null, amountCents: amount, full,
    cancelsFulfillment: full && REFUND_CANCELS_FROM.includes(o.fulfillment_status ?? ''),
    warning: placed ? `This order is already ${o.fulfillment_status === 'shipped' ? 'shipped' : 'placed with the roaster'}: the refund does not stop it. Cancel it with the roaster by hand.` : null,
    pastRefundWindow: Boolean(o.past_window),
  };
}

// ── reads ────────────────────────────────────────────────────────────────────

export interface OrderSummary {
  orderId: string;
  userId: string;
  firebaseUid: string;
  /** The customer's primary user_email (Commerce 3; the customer emails still address Firebase Auth's). */
  email: string | null;
  firstName: string | null;
  lastName: string | null;
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
  /** Commerce 3: the latest shipment (v_order_status), null before it ships. */
  shipment: { id: string; carrier: string | null; carrierLabel: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null } | null;
}

const cents = (dollars: string | number | null) => Math.round(Number(dollars ?? 0) * 100);

/** One order with its lines and its v_order_status row. */
export async function getOrderSummary(orderId: string, runner: Runner = db): Promise<OrderSummary | null> {
  const o = (await runner.query(
    `SELECT o.*, up.firebase_uid, up.first_name, up.last_name, s.payment_status, s.fulfillment_status AS current_fulfillment_status,
            s.customer_label, s.finalized_at, s.order_placed_line,
            s.shipment_id, s.carrier, s.carrier_label, s.tracking_number, s.tracking_url, s.shipped_at,
            (SELECT ue.email_address FROM user_email ue WHERE ue.user_id = o.user_id AND ue.is_primary ORDER BY ue.created_at LIMIT 1) AS primary_email
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
    orderId: o.id, userId: o.user_id, firebaseUid: o.firebase_uid, email: o.primary_email ?? null, firstName: o.first_name, lastName: o.last_name ?? null,
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
    shipment: o.shipment_id ? {
      id: o.shipment_id, carrier: o.carrier, carrierLabel: o.carrier_label, trackingNumber: o.tracking_number, trackingUrl: o.tracking_url, shippedAt: o.shipped_at,
    } : null,
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
  /** Commerce 2: present when the checkout started a subscription. */
  subscription?: { frequencyWeeks: number | null; nextDeliveryDate: string | null; discountCents: number };
}

/** GET /api/checkout/session/:id/status — our tables only, ownership-checked; :id is ours or Stripe's (cs_...). */
export async function getSessionStatus(uid: string, id: string): Promise<SessionStatus | null> {
  const cs = (await db.query<{ id: string; status: SessionStatus['status']; order_id: string | null; subscription_id: string | null }>(
    `SELECT cs.id, cs.status, cs.order_id, cs.subscription_id FROM checkout_session cs JOIN user_profile up ON up.id = cs.user_id
     WHERE up.firebase_uid = $1 AND (cs.stripe_checkout_session_id = $2 OR cs.id::text = $2)`,
    [uid, id]
  )).rows[0];
  if (!cs) return null;
  if (cs.status !== 'complete' || !cs.order_id) return { status: cs.status };
  const o = await getOrderSummary(cs.order_id);
  if (!o) return { status: cs.status };
  let subscription: SessionStatus['subscription'];
  if (cs.subscription_id) {
    const s = (await db.query<{ frequency_weeks: number | null; next_delivery_date: string | null; discount_cents: string | null }>(
      `SELECT v.frequency_weeks, v.next_delivery_date::text AS next_delivery_date,
              (SELECT SUM(discount_cents * quantity) FROM checkout_session_line WHERE checkout_session_id = $2) AS discount_cents
       FROM v_subscription_status v WHERE v.subscription_id = $1`, [cs.subscription_id, cs.id]
    )).rows[0];
    if (s) subscription = { frequencyWeeks: s.frequency_weeks, nextDeliveryDate: s.next_delivery_date, discountCents: Number(s.discount_cents ?? 0) };
  }
  return {
    ...(subscription ? { subscription } : {}),
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
