// Commerce 1, Part D (2026-10-31) — checkoutService against the isolated test
// DB, Stripe mocked (nothing leaves the process): session creation (address
// required, server prices, Stripe params from commerce_parameter, reuse of an
// open session), completion exactly once (idempotent on the Stripe session,
// address snapshot copied, cents in → dollars on the order), expiry, refunds,
// and v_order_status. Also carries the invariant orders.stock.test.ts used to
// prove through POST /api/orders: writing an order never touches coffee_sku
// (stock tracking is retired; roasters drop-ship).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

let sessionSeq = 0;
const stripeCalls = { create: [] as any[], retrieve: 0 };
const fakeStripe = {
  customers: { update: vi.fn(async () => ({})) },
  checkout: {
    sessions: {
      create: vi.fn(async (params: any, opts: any) => {
        stripeCalls.create.push({ params, opts });
        return { id: `cs_test_vitest_${Date.now()}_${++sessionSeq}`, client_secret: `cs_secret_${sessionSeq}`, status: 'open' };
      }),
      retrieve: vi.fn(async (id: string) => { stripeCalls.retrieve++; return { id, status: 'open', client_secret: 'cs_secret_reused' }; }),
    },
  },
  paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: { balance_transaction: { fee: 82 } } })) },
};
vi.mock('./stripe.js', () => ({
  STRIPE_ENABLED: true,
  stripe: () => fakeStripe,
  getOrCreateStripeCustomer: async () => 'cus_vitest',
}));

const { db } = await import('../db/client.js');
const { createCoffee, setMatchArchetype, upsertSku, setCoffeeRetailPrice } = await import('./catalogService.js');
const { invalidateCommerceParameterCache } = await import('./commerceParameters.js');
const { createCheckoutSession, completeCheckoutSession, expireCheckoutSession, recordRefund, getSessionStatus, CheckoutError } = await import('./checkoutService.js');

const ACTOR = { actor: 'vitest' };
const UID = 'vitest-checkout-uid';
let roasterId: string; let coffeeId: number; let userId: string; let addressId: string;

beforeAll(async () => {
  invalidateCommerceParameterCache();
  roasterId = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Checkout Roastery', true) RETURNING id`)).rows[0].id;
  coffeeId = (await createCoffee({ roasterId, name: 'Vitest Checkout Coffee' }, ACTOR)).result.coffeeId;
  await setMatchArchetype({ coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, ACTOR);
  await upsertSku({ coffeeId, weightOz: 12, blendName: 'Vitest Checkout Blend', isActive: true }, ACTOR);
  await setCoffeeRetailPrice({ coffeeId, weightOz: 12, retailPriceCents: 2100 }, ACTOR);
  userId = (await db.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name, last_name) VALUES ($1, 'Vita', 'Test') RETURNING id`, [UID])).rows[0].id;
}, 30000);

afterAll(async () => {
  if (userId) {
    await db.query(`DELETE FROM order_event WHERE order_id IN (SELECT id FROM "order" WHERE user_id = $1)`, [userId]);
    await db.query(`UPDATE checkout_session SET order_id = NULL WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM order_line_item WHERE order_id IN (SELECT id FROM "order" WHERE user_id = $1)`, [userId]);
    await db.query(`DELETE FROM "order" WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM checkout_session_line WHERE checkout_session_id IN (SELECT id FROM checkout_session WHERE user_id = $1)`, [userId]);
    await db.query(`DELETE FROM checkout_session WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM address WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM user_profile WHERE id = $1`, [userId]);
  }
  if (coffeeId) {
    await db.query('DELETE FROM coffee_retail_price WHERE coffee_id = $1', [coffeeId]);
    await db.query('DELETE FROM coffee_archetype_assignment WHERE coffee_id = $1', [coffeeId]);
    await db.query('DELETE FROM coffee_sku WHERE coffee_id = $1', [coffeeId]);
    await db.query('DELETE FROM coffees WHERE id = $1', [coffeeId]);
  }
  if (roasterId) await db.query('DELETE FROM roaster WHERE id = $1', [roasterId]);
}, 30000);

const item = (quantity = 1, priceCents = 2100) => ({ coffeeId, weightOz: 12, quantity, priceCents });

function stripeSessionFor(stripeId: string, ourId: string, over: Record<string, unknown> = {}) {
  return {
    id: stripeId, object: 'checkout.session', mode: 'payment', payment_status: 'paid', status: 'complete',
    payment_intent: `pi_vitest_${stripeId}`, amount_total: 2695, amount_subtotal: 2100, currency: 'usd',
    total_details: { amount_tax: 0, amount_shipping: 595, amount_discount: 0 },
    metadata: { checkout_session_id: ourId }, ...over,
  } as any;
}

describe('createCheckoutSession', () => {
  it('needs a shipping address: 422 shipping_address_required', async () => {
    const err = await createCheckoutSession({ uid: UID, email: 'vitest@example.com', items: [item()] }).then(() => null, e => e);
    expect(err).toBeInstanceOf(CheckoutError);
    expect(err).toMatchObject({ status: 422, code: 'shipping_address_required' });
  });

  it('writes the session and its server-priced lines, and builds the Stripe session from commerce_parameter', async () => {
    addressId = (await db.query<{ id: string }>(
      `INSERT INTO address (user_id, address_type, street, city, state, postal_code, country, is_default)
       VALUES ($1, 'shipping', '1 Vitest Way', 'Union City', 'NJ', '07087', 'US', true) RETURNING id`, [userId]
    )).rows[0].id;
    const r = await createCheckoutSession({ uid: UID, email: 'vitest@example.com', items: [item()] });
    expect(r.clientSecret).toMatch(/^cs_secret_/);
    const cs = (await db.query(`SELECT * FROM checkout_session WHERE id = $1`, [r.checkoutSessionId])).rows[0];
    expect(cs).toMatchObject({ status: 'open', mode: 'payment', subtotal_cents: 2100, shipping_cents: 595, bag_count: 1,
      shipping_street: '1 Vitest Way', shipping_city: 'Union City', shipping_state: 'NJ', shipping_postal_code: '07087', shipping_address_id: addressId });
    const lines = (await db.query(`SELECT * FROM checkout_session_line WHERE checkout_session_id = $1`, [r.checkoutSessionId])).rows;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ display_name: 'Vitest Checkout Coffee', unit_price_cents: 2100, quantity: 1, source: 'direct', intended_for_user_id: userId });

    const { params, opts } = stripeCalls.create.at(-1);
    expect(opts).toEqual({ idempotencyKey: `checkout_session:${r.checkoutSessionId}` });
    expect(params).toMatchObject({
      ui_mode: 'embedded_page', mode: 'payment', customer: 'cus_vitest',
      automatic_tax: { enabled: true },
      metadata: { checkout_session_id: r.checkoutSessionId },
      payment_intent_data: { metadata: { checkout_session_id: r.checkoutSessionId } },
    });
    expect(params.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 2100, tax_behavior: 'exclusive',
      product_data: { name: 'Vitest Checkout Coffee', description: '12 oz · Earthy', tax_code: 'txcd_41050006' } });
    expect(params.shipping_options[0].shipping_rate_data).toMatchObject({ fixed_amount: { amount: 595, currency: 'usd' }, display_name: 'Shipping', tax_code: 'txcd_92010001' });
    expect(params.return_url).toMatch(/\/checkout\/return\?session_id=\{CHECKOUT_SESSION_ID\}$/);
    expect(JSON.stringify(params)).not.toContain('Vitest Checkout Roastery');
  });

  it('the same open cart again reuses the open session instead of piling up rows', async () => {
    const createsBefore = stripeCalls.create.length;
    const rowsBefore = Number((await db.query(`SELECT count(*) FROM checkout_session WHERE user_id = $1`, [userId])).rows[0].count);
    const r = await createCheckoutSession({ uid: UID, email: 'vitest@example.com', items: [item()] });
    expect(r.clientSecret).toBe('cs_secret_reused');
    expect(stripeCalls.create.length).toBe(createsBefore);
    expect(Number((await db.query(`SELECT count(*) FROM checkout_session WHERE user_id = $1`, [userId])).rows[0].count)).toBe(rowsBefore);
  });

  it('two bags ship free', async () => {
    const r = await createCheckoutSession({ uid: UID, email: 'vitest@example.com', items: [item(2)] });
    const cs = (await db.query(`SELECT shipping_cents, bag_count FROM checkout_session WHERE id = $1`, [r.checkoutSessionId])).rows[0];
    expect(cs).toEqual({ shipping_cents: 0, bag_count: 2 });
    expect(stripeCalls.create.at(-1).params.shipping_options[0].shipping_rate_data).toMatchObject({ fixed_amount: { amount: 0 }, display_name: 'Free shipping' });
  });
});

describe('completeCheckoutSession', () => {
  it('writes exactly one order, copies the snapshot, converts cents to dollars, and never touches coffee_sku', async () => {
    const r = await createCheckoutSession({ uid: UID, email: 'vitest@example.com', items: [item(1, 2100)], shippingAddressId: addressId });
    const ours = (await db.query(`SELECT id, stripe_checkout_session_id FROM checkout_session WHERE id = $1`, [r.checkoutSessionId])).rows[0];
    const skuBefore = (await db.query(`SELECT * FROM coffee_sku WHERE coffee_id = $1`, [coffeeId])).rows;
    const session = stripeSessionFor(ours.stripe_checkout_session_id, ours.id);

    const first = await completeCheckoutSession(session);
    expect(first.created).toBe(true);
    const second = await completeCheckoutSession(session);
    expect(second).toEqual({ orderId: first.orderId, created: false });

    const orders = (await db.query(`SELECT * FROM "order" WHERE stripe_checkout_session_id = $1`, [session.id])).rows;
    expect(orders).toHaveLength(1);
    const o = orders[0];
    expect(Number(o.subtotal)).toBe(21);
    expect(Number(o.shipping_fee_charged)).toBe(5.95);
    expect(Number(o.taxes_collected)).toBe(0);
    expect(Number(o.total_amount_paid)).toBe(26.95);
    expect(Number(o.transaction_fee)).toBe(0.82);
    expect(o).toMatchObject({ currency: 'USD', fulfillment_status: 'awaiting_manual', checkout_session_id: ours.id,
      stripe_payment_intent_id: session.payment_intent, fulfillment_roaster_id: null,
      shipping_street: '1 Vitest Way', shipping_city: 'Union City', shipping_state: 'NJ', shipping_postal_code: '07087', shipping_country: 'US', shipping_address_id: addressId });
    expect(o.paid_at).not.toBeNull();

    const lines = (await db.query(`SELECT * FROM order_line_item WHERE order_id = $1`, [o.id])).rows;
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].unit_price_charged)).toBe(21);
    expect(lines[0]).toMatchObject({ display_name: 'Vitest Checkout Coffee', quantity: 1, order_kind: 'manual', intended_for_user_id: userId });
    expect(Number(lines[0].weight_oz)).toBe(12);

    const events = (await db.query(`SELECT event_kind, payment_status, fulfillment_status, source FROM order_event WHERE order_id = $1`, [o.id])).rows;
    expect(events).toEqual([{ event_kind: 'paid', payment_status: 'paid', fulfillment_status: 'awaiting_manual', source: 'webhook' }]);
    const status = (await db.query(`SELECT * FROM v_order_status WHERE order_id = $1`, [o.id])).rows[0];
    expect(status).toMatchObject({ payment_status: 'paid', fulfillment_status: 'awaiting_manual', customer_label: 'Paid · being roasted', is_closed: false, finalized_at: null });
    expect((await db.query(`SELECT status, order_id FROM checkout_session WHERE id = $1`, [ours.id])).rows[0]).toEqual({ status: 'complete', order_id: o.id });

    expect((await db.query(`SELECT * FROM coffee_sku WHERE coffee_id = $1`, [coffeeId])).rows).toEqual(skuBefore);

    const viaRoute = await getSessionStatus(UID, session.id);
    expect(viaRoute).toMatchObject({ status: 'complete', orderId: o.id, finalized: false, order: { totalCents: 2695, shippingCents: 595 } });
    expect(await getSessionStatus('someone-else', session.id)).toBeNull(); // ownership-checked
  });

  it('records refunds as order events: partial, then full', async () => {
    const o = (await db.query(`SELECT id, stripe_payment_intent_id FROM "order" WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId])).rows[0];
    await recordRefund({ id: 'ch_vitest', payment_intent: o.stripe_payment_intent_id, amount: 2695, amount_refunded: 1000 } as any);
    let s = (await db.query(`SELECT payment_status, amount_refunded_cents, customer_label FROM v_order_status WHERE order_id = $1`, [o.id])).rows[0];
    expect(s).toEqual({ payment_status: 'partially_refunded', amount_refunded_cents: 1000, customer_label: 'Partly refunded' });
    await recordRefund({ id: 'ch_vitest', payment_intent: o.stripe_payment_intent_id, amount: 2695, amount_refunded: 2695 } as any);
    s = (await db.query(`SELECT payment_status, amount_refunded_cents, customer_label FROM v_order_status WHERE order_id = $1`, [o.id])).rows[0];
    expect(s).toEqual({ payment_status: 'refunded', amount_refunded_cents: 2695, customer_label: 'Refunded' });
  });
});

describe('expireCheckoutSession', () => {
  it('expires an open session and writes no order', async () => {
    const r = await createCheckoutSession({ uid: UID, email: 'vitest@example.com', items: [item(3)] });
    const stripeId = (await db.query(`SELECT stripe_checkout_session_id FROM checkout_session WHERE id = $1`, [r.checkoutSessionId])).rows[0].stripe_checkout_session_id;
    expect(await expireCheckoutSession(stripeId)).toBe(true);
    expect(await expireCheckoutSession(stripeId)).toBe(false); // already expired: no-op
    expect((await db.query(`SELECT status, order_id FROM checkout_session WHERE id = $1`, [r.checkoutSessionId])).rows[0]).toEqual({ status: 'expired', order_id: null });
    expect(await getSessionStatus(UID, stripeId)).toEqual({ status: 'expired' });
  });
});
