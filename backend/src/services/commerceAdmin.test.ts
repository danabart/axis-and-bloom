// Commerce 3, Part D (2026-10-31) — the admin side on the test DB, Stripe /
// Resend / Firebase mocked: markShipped (one shipment row per tracking number,
// one shipped event and one shipping email with the carrier's tracking link,
// v_order_status carries it); refunds (the admin request only asks Stripe,
// with our reason as metadata and Stripe's reason from the lookup's
// stripe_reason; charge.refunded writes refund_partial / refund_full with the
// reason; only a full refund of an order not yet placed cancels fulfillment);
// retry fulfillment (source admin; not on a shipped order); the admin
// new-order email names the customer and links the drawer; the admin list and
// detail read the customer's primary email and the internal roaster coffee.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
// DB round trips over the Cloud SQL proxy: the 5 s default is too tight for these fixtures.
vi.setConfig({ testTimeout: 30000 });

let seq = 0;
const refunds: any[] = [];
const fakeStripe = {
  customers: { update: vi.fn(async () => ({})) },
  checkout: { sessions: {
    create: vi.fn(async () => ({ id: `cs_test_c3_${Date.now()}_${++seq}`, client_secret: `cs_secret_c3_${seq}`, status: 'open' })),
    retrieve: vi.fn(async (id: string) => ({ id, status: 'open', client_secret: 'cs_secret_reused' })),
  } },
  paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: { balance_transaction: { fee: 82 } }, payment_method: null })) },
  refunds: {
    list: vi.fn(async () => ({ data: refunds.length ? [refunds[refunds.length - 1]] : [] })),
    create: vi.fn(async (params: any, opts: any) => { const r = { id: `re_c3_${refunds.length + 1}`, status: 'succeeded', amount: params.amount, metadata: params.metadata, params, opts }; refunds.push(r); return r; }),
  },
};
vi.mock('./stripe.js', () => ({ STRIPE_ENABLED: true, stripe: () => fakeStripe, getOrCreateStripeCustomer: async () => 'cus_c3', stripeMode: () => 'test' }));
const sent: Array<{ to: string; subject: string; text?: string }> = [];
vi.mock('../features/marketing/resendEmail.js', () => ({
  sendResendEmail: async (e: { to: string; subject: string; text?: string }) => { sent.push({ to: e.to, subject: e.subject, text: e.text }); return { ok: true, id: `re_mail_${sent.length}` }; },
}));
vi.mock('./firebase-admin.js', () => ({ default: { auth: () => ({ getUser: async (uid: string) => ({ email: `${uid}@example.com` }) }) } }));

const { db } = await import('../db/client.js');
const { createCoffee, setMatchArchetype, upsertSku, setCoffeeRetailPrice } = await import('./catalogService.js');
const { invalidateCommerceParameterCache } = await import('./commerceParameters.js');
const { createCheckoutSession, completeCheckoutSession, recordRefund, requestRefund, recordOrderEvent, getOrderSummary } = await import('./checkoutService.js');
const { markShipped } = await import('./shipmentService.js');
const { retryFulfillment } = await import('./fulfillment/index.js');
const { renderAdminNewOrderEmail } = await import('./orderEmails.js');
const { listOrders, getOrderDetail } = await import('./commerceAdminReads.js');

const ACTOR = { actor: 'vitest' };
const UID = `vitest-c3-${Date.now()}`;
let roasterId: string; let coffeeId: number; let userId: string; let addressId: string;

beforeAll(async () => {
  invalidateCommerceParameterCache();
  roasterId = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest C3 Roastery', true) RETURNING id`)).rows[0].id;
  coffeeId = (await createCoffee({ roasterId, name: 'Vitest C3 Coffee' }, ACTOR)).result.coffeeId;
  await setMatchArchetype({ coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, ACTOR);
  await upsertSku({ coffeeId, weightOz: 12, blendName: 'Vitest C3 Blend', isActive: true }, ACTOR);
  await setCoffeeRetailPrice({ coffeeId, weightOz: 12, retailPriceCents: 2100 }, ACTOR);
  userId = (await db.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name, last_name) VALUES ($1, 'Rae', 'Fund') RETURNING id`, [UID])).rows[0].id;
  await db.query(`INSERT INTO user_email (user_id, email_address, is_primary) VALUES ($1, $2, true)`, [userId, `${UID}@example.com`]);
  addressId = (await db.query<{ id: string }>(
    `INSERT INTO address (user_id, address_type, street, city, state, postal_code, country, is_default) VALUES ($1, 'shipping', '3 Vitest Way', 'Union City', 'NJ', '07087', 'US', true) RETURNING id`, [userId]
  )).rows[0].id;
}, 30000);

afterAll(async () => {
  if (userId) {
    const orders = (await db.query<{ id: string }>(`SELECT id FROM "order" WHERE user_id = $1`, [userId])).rows.map(r => r.id);
    await db.query(`DELETE FROM transactional_email_log WHERE email = $1`, [`${UID}@example.com`]);
    await db.query(`DELETE FROM transactional_email_log WHERE template = ANY($1::text[])`, [orders.flatMap(o => [`admin_new_order:${o}`, `admin_fulfillment_attention:${o}`])]);
    await db.query(`DELETE FROM roastery_shipment_details WHERE order_id = ANY($1::uuid[])`, [orders]);
    await db.query(`DELETE FROM order_event WHERE order_id = ANY($1::uuid[])`, [orders]);
    await db.query(`UPDATE checkout_session SET order_id = NULL WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM order_line_item WHERE order_id = ANY($1::uuid[])`, [orders]);
    await db.query(`DELETE FROM "order" WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM checkout_session_line WHERE checkout_session_id IN (SELECT id FROM checkout_session WHERE user_id = $1)`, [userId]);
    await db.query(`DELETE FROM checkout_session WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM address WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM user_email WHERE user_id = $1`, [userId]);
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

/** A paid one-bag order (awaiting_manual), written through the real checkout path. */
let orderSeq = 0;
async function paidOrder(): Promise<{ orderId: string; pi: string }> {
  // A distinct quantity per order: a different cart, so no open session is reused.
  const r = await createCheckoutSession({ uid: UID, email: `${UID}@example.com`, items: [{ coffeeId, weightOz: 12, quantity: ++orderSeq, priceCents: 2100 }], shippingAddressId: addressId });
  const cs = (await db.query(`SELECT id, stripe_checkout_session_id FROM checkout_session WHERE id = $1`, [r.checkoutSessionId])).rows[0];
  const pi = `pi_c3_${Date.now()}_${orderSeq}`;
  const total = 2100 * orderSeq + (orderSeq >= 2 ? 0 : 595);
  const { orderId } = await completeCheckoutSession({
    id: cs.stripe_checkout_session_id, object: 'checkout.session', mode: 'payment', payment_status: 'paid', status: 'complete',
    payment_intent: pi, amount_total: total, amount_subtotal: 2100 * orderSeq, currency: 'usd',
    total_details: { amount_tax: 0, amount_shipping: total - 2100 * orderSeq, amount_discount: 0 }, metadata: { checkout_session_id: cs.id },
  } as any);
  await recordOrderEvent({ orderId, kind: 'fulfillment_dispatched', fulfillmentStatus: 'awaiting_manual', source: 'finalizer' });
  return { orderId, pi };
}

const status = async (orderId: string) => (await db.query(`SELECT * FROM v_order_status WHERE order_id = $1`, [orderId])).rows[0];
const kinds = async (orderId: string) => (await db.query<{ event_kind: string; source: string; refund_reason: string | null }>(
  `SELECT event_kind, source, refund_reason FROM order_event WHERE order_id = $1 ORDER BY created_at, id`, [orderId])).rows;
const charge = (pi: string, amount: number, refunded: number) => ({ id: `ch_${pi}`, payment_intent: pi, amount, amount_refunded: refunded }) as any;

describe('markShipped', () => {
  it('one shipment row, one shipped event (admin), one shipping email with the tracking link; the same tracking number again does nothing', async () => {
    const { orderId } = await paidOrder();
    const first = await markShipped(orderId, { carrier: 'usps', trackingNumber: '9400111899223' });
    expect(first).toMatchObject({ created: true, emailStatus: 'sent' });
    const again = await markShipped(orderId, { carrier: 'usps', trackingNumber: '9400111899223' });
    expect(again).toEqual({ shipmentId: first.shipmentId, created: false, emailStatus: null });

    expect((await db.query(`SELECT carrier, status, roaster_id FROM roastery_shipment_details WHERE order_id = $1`, [orderId])).rows)
      .toEqual([{ carrier: 'usps', status: 'shipped', roaster_id: null }]);
    expect((await kinds(orderId)).filter(e => e.event_kind === 'shipped')).toEqual([{ event_kind: 'shipped', source: 'admin', refund_reason: null }]);
    const v = await status(orderId);
    expect(v).toMatchObject({ fulfillment_status: 'shipped', customer_label: 'On its way', carrier: 'usps', carrier_label: 'USPS', tracking_number: '9400111899223',
      tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223' });
    const mails = sent.filter(m => m.subject === 'Your coffee is on its way');
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain('Track your package: https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223');
    expect(mails[0].text).not.toContain('Vitest C3 Roastery');
  });

  it('refuses an unknown carrier (400) and a canceled order (409)', async () => {
    const { orderId } = await paidOrder();
    await expect(markShipped(orderId, { carrier: 'pigeon', trackingNumber: 'X1' })).rejects.toMatchObject({ status: 400, code: 'invalid_carrier' });
    await recordOrderEvent({ orderId, kind: 'canceled', fulfillmentStatus: 'canceled', source: 'admin' });
    await expect(markShipped(orderId, { carrier: 'ups', trackingNumber: '1Z999' })).rejects.toMatchObject({ status: 409, code: 'order_closed' });
  });
});

describe('refunds', () => {
  it('the admin request only asks Stripe: amount, our reason as metadata, Stripe reason from stripe_reason, the idempotency key; nothing written yet', async () => {
    const { orderId, pi } = await paidOrder();
    const before = await kinds(orderId);
    const r = await requestRefund(orderId, { amountCents: 500, reason: 'requested_by_customer', adminId: 'vitest-admin' });
    expect(r).toMatchObject({ amountCents: 500, full: false, cancelsFulfillment: false, warning: null });
    const created = refunds[refunds.length - 1];
    expect(created.params).toEqual({ payment_intent: pi, amount: 500, reason: 'requested_by_customer', metadata: { order_id: orderId, reason_code: 'requested_by_customer', admin: 'vitest-admin' } });
    expect(created.opts).toEqual({ idempotencyKey: `refund:${orderId}:500:0` });
    expect(await kinds(orderId)).toEqual(before);

    await requestRefund(orderId, { amountCents: 300, reason: 'damaged_in_transit' });
    expect(refunds[refunds.length - 1].params.reason).toBeUndefined(); // stripe_reason NULL: Stripe gets none
    await expect(requestRefund(orderId, { amountCents: 999999, reason: 'quality' })).rejects.toMatchObject({ status: 400, code: 'invalid_amount' });
    await expect(requestRefund(orderId, { reason: 'no_such_reason' })).rejects.toMatchObject({ status: 400, code: 'invalid_reason' });
  });

  it('charge.refunded partial → refund_partial with the reason; the bag still ships (no cancel)', async () => {
    const { orderId, pi } = await paidOrder();
    await requestRefund(orderId, { amountCents: 500, reason: 'quality' });
    const r = await recordRefund(charge(pi, 2695, 500));
    expect(r).toEqual({ orderId, canceledFulfillment: false });
    expect((await kinds(orderId)).slice(-1)).toEqual([{ event_kind: 'refund_partial', source: 'webhook', refund_reason: 'quality' }]);
    expect(await status(orderId)).toMatchObject({ payment_status: 'partially_refunded', amount_refunded_cents: 500, fulfillment_status: 'awaiting_manual' });
  });

  it('charge.refunded full on an awaiting_manual order → refund_full and canceled, both from the webhook', async () => {
    const { orderId, pi } = await paidOrder();
    const asked = await requestRefund(orderId, { reason: 'requested_by_customer' });
    expect(asked).toMatchObject({ full: true, cancelsFulfillment: true });
    expect(await recordRefund(charge(pi, asked.amountCents, asked.amountCents))).toMatchObject({ canceledFulfillment: true });
    expect((await kinds(orderId)).slice(-2)).toEqual([
      { event_kind: 'refund_full', source: 'webhook', refund_reason: 'requested_by_customer' },
      { event_kind: 'canceled', source: 'webhook', refund_reason: null },
    ]);
    expect(await status(orderId)).toMatchObject({ payment_status: 'refunded', fulfillment_status: 'canceled', customer_label: 'Refunded' });
  });

  it('charge.refunded full on a shipped order → refund_full only; the request warns to cancel with the roaster', async () => {
    const { orderId, pi } = await paidOrder();
    await markShipped(orderId, { carrier: 'ups', trackingNumber: `1Z${Date.now()}` });
    const asked = await requestRefund(orderId, { reason: 'lost_in_transit' });
    expect(asked.cancelsFulfillment).toBe(false);
    expect(asked.warning).toMatch(/already shipped/);
    expect(await recordRefund(charge(pi, asked.amountCents, asked.amountCents))).toMatchObject({ canceledFulfillment: false });
    expect((await kinds(orderId)).map(e => e.event_kind)).not.toContain('canceled');
    expect(await status(orderId)).toMatchObject({ payment_status: 'refunded', fulfillment_status: 'shipped' });
  });
});

describe('retry fulfillment', () => {
  it('a needs_attention order is dispatched again with source admin; a shipped one is a 409', async () => {
    const { orderId } = await paidOrder();
    await recordOrderEvent({ orderId, kind: 'fulfillment_needs_attention', fulfillmentStatus: 'needs_attention', source: 'finalizer' });
    const r = await retryFulfillment(orderId);
    expect(r).toMatchObject({ ok: true, adapter: 'manual' });
    expect((await kinds(orderId)).slice(-1)).toEqual([{ event_kind: 'fulfillment_dispatched', source: 'admin', refund_reason: null }]);
    expect((await status(orderId)).fulfillment_status).toBe('awaiting_manual');
    await markShipped(orderId, { carrier: 'fedex', trackingNumber: `FX${Date.now()}` });
    await expect(retryFulfillment(orderId)).rejects.toMatchObject({ status: 409, code: 'not_retryable' });
  });
});

describe('admin reads and the admin email', () => {
  it('the new-order email names the customer, their email and the drawer link', async () => {
    const { orderId } = await paidOrder();
    const e = await renderAdminNewOrderEmail((await getOrderSummary(orderId))!);
    expect(e.text).toContain(`Customer: Rae Fund <${UID}@example.com>`);
    expect(e.text).toMatch(new RegExp(`Admin: .*/admin/orders/${orderId}$`, 'm'));
  });

  it('the list finds the order by email; the detail carries the internal roaster coffee, events and Stripe links', async () => {
    const { orderId, pi } = await paidOrder();
    const list = await listOrders({ q: UID });
    expect(list.orders.find(o => o.orderId === orderId)).toMatchObject({ customer: { name: 'Rae Fund', email: `${UID}@example.com` } });
    const d = await getOrderDetail(orderId);
    expect(d!.lines[0]).toMatchObject({ displayName: 'Vitest C3 Coffee', roasterCoffee: 'Vitest C3 Coffee', roasterName: 'Vitest C3 Roastery' });
    expect(d!.stripe.paymentUrl).toBe(`https://dashboard.stripe.com/test/payments/${pi}`);
    expect(d!.events.map((e: any) => e.event_kind)).toContain('paid');
  });
});
