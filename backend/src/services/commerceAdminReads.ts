// Commerce 3, B5 (2026-10-31) — reads behind /admin/orders and
// /admin/subscriptions (routes/commerceAdmin.ts). Read-only: order state
// through v_order_status, subscription state through v_subscription_status
// (the one read paths), the customer from user_profile + their primary
// user_email. Internal: the detail carries the resolved roaster coffee per
// line, which the customer never sees.
import { db } from '../db/client.js';
import { commerceParam } from './commerceParameters.js';
import { getOrderSummary } from './checkoutService.js';
import { internalLines } from './orderEmails.js';
import { stripeMode } from './stripe.js';
import { resolveSubscriptionShipment } from './subscriptionShipment.js';
import { effectiveNextDelivery } from './subscriptionService.js';

const cents = (dollars: string | number | null) => Math.round(Number(dollars ?? 0) * 100);

/** Stripe Dashboard deep links, test or live by the key in use. */
function dashboardUrl(kind: 'payments' | 'invoices' | 'customers', id: string | null): string | null {
  if (!id) return null;
  return `https://dashboard.stripe.com/${stripeMode() === 'live' ? '' : 'test/'}${kind}/${id}`;
}

export interface AdminOrderFilters { paymentStatus?: string; fulfillmentStatus?: string; q?: string; page?: number }
const PAGE_SIZE = 50;

export async function listOrders(f: AdminOrderFilters): Promise<{ orders: AdminOrderRow[]; page: number; pageSize: number; total: number }> {
  const page = Math.max(1, Math.floor(Number(f.page) || 1));
  const q = (f.q ?? '').trim();
  const params: unknown[] = [f.paymentStatus || null, f.fulfillmentStatus || null, q || null, PAGE_SIZE, (page - 1) * PAGE_SIZE];
  const where = `($1::text IS NULL OR s.payment_status = $1)
     AND ($2::text IS NULL OR s.fulfillment_status = $2)
     AND ($3::text IS NULL OR o.id::text ILIKE $3 || '%' OR ue.email_address ILIKE '%' || $3 || '%'
          OR CONCAT_WS(' ', up.first_name, up.last_name) ILIKE '%' || $3 || '%')`;
  const from = `FROM "order" o
     JOIN v_order_status s ON s.order_id = o.id
     JOIN user_profile up ON up.id = o.user_id
     LEFT JOIN LATERAL (SELECT email_address FROM user_email WHERE user_id = o.user_id AND is_primary ORDER BY created_at LIMIT 1) ue ON true`;
  const rows = (await db.query(
    `SELECT o.id, COALESCE(o.paid_at, o.created_at) AS paid_at, o.total_amount_paid, o.is_subscription, o.subscription_id,
            up.first_name, up.last_name, ue.email_address,
            s.payment_status, s.payment_customer_label, s.fulfillment_status, s.fulfillment_label, s.amount_refunded_cents,
            s.tracking_number, s.carrier_label,
            (SELECT COALESCE(SUM(quantity), 0) FROM order_line_item WHERE order_id = o.id) AS bags
     ${from} WHERE ${where}
     ORDER BY COALESCE(o.paid_at, o.created_at) DESC, o.id
     LIMIT $4 OFFSET $5`, params
  )).rows;
  const total = Number((await db.query(`SELECT count(*) AS n ${from} WHERE ${where}`, params.slice(0, 3))).rows[0].n);
  return {
    page, pageSize: PAGE_SIZE, total,
    orders: rows.map(r => ({
      orderId: r.id, paidAt: r.paid_at, totalCents: cents(r.total_amount_paid), bags: Number(r.bags),
      isSubscription: Boolean(r.is_subscription), subscriptionId: r.subscription_id,
      customer: { name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, email: r.email_address ?? null },
      paymentStatus: r.payment_status, paymentLabel: r.payment_customer_label,
      fulfillmentStatus: r.fulfillment_status, fulfillmentLabel: r.fulfillment_label,
      amountRefundedCents: Number(r.amount_refunded_cents ?? 0),
      tracking: r.tracking_number ? `${r.carrier_label ?? ''} ${r.tracking_number}`.trim() : null,
    })),
  };
}

export interface AdminOrderRow {
  orderId: string; paidAt: string; totalCents: number; bags: number; isSubscription: boolean; subscriptionId: string | null;
  customer: { name: string | null; email: string | null };
  paymentStatus: string | null; paymentLabel: string | null; fulfillmentStatus: string | null; fulfillmentLabel: string | null;
  amountRefundedCents: number; tracking: string | null;
}

/** One order for the drawer: lines (house name + internal roaster coffee), customer, ships-to, shipments, the event trail, Stripe links. */
export async function getOrderDetail(orderId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const o = await getOrderSummary(orderId);
  if (!o) return null;
  const internal = await internalLines(o);
  const extra = (await db.query<{ stripe_invoice_id: string | null; subscription_id: string | null; is_subscription: boolean; stripe_customer_id: string | null;
    amount_refunded_cents: number; fulfillment_label: string | null; payment_customer_label: string | null; past_window: boolean }>(
    `SELECT o.stripe_invoice_id, o.subscription_id, o.is_subscription, up.stripe_customer_id, s.amount_refunded_cents, s.fulfillment_label, s.payment_customer_label,
            COALESCE(o.paid_at, o.created_at) < now() - make_interval(days => $2::int) AS past_window
     FROM "order" o JOIN user_profile up ON up.id = o.user_id JOIN v_order_status s ON s.order_id = o.id WHERE o.id = $1`,
    [orderId, await commerceParam('refund_window_days')]
  )).rows[0];
  const events = (await db.query(
    `SELECT e.id, e.created_at, e.event_kind, k.label AS kind_label, e.payment_status, e.fulfillment_status, e.amount_refunded_cents,
            e.refund_reason, rr.label AS refund_reason_label, e.stripe_ref, e.note, e.source
     FROM order_event e JOIN order_event_kind k ON k.code = e.event_kind
     LEFT JOIN order_refund_reason rr ON rr.code = e.refund_reason
     WHERE e.order_id = $1 ORDER BY e.created_at, e.id`, [orderId]
  )).rows;
  const shipments = (await db.query(
    `SELECT d.id, d.carrier, c.label AS carrier_label, d.tracking_number, d.status, d.shipped_at, r.name AS roaster_name,
            CASE WHEN c.tracking_url_template IS NOT NULL THEN replace(c.tracking_url_template, '{tracking}', d.tracking_number) END AS tracking_url
     FROM roastery_shipment_details d LEFT JOIN shipping_carrier c ON c.code = d.carrier LEFT JOIN roaster r ON r.id = d.roaster_id
     WHERE d.order_id = $1 ORDER BY d.shipped_at NULLS LAST, d.created_at`, [orderId]
  )).rows;
  return {
    orderId: o.orderId, createdAt: o.createdAt, paidAt: o.paidAt,
    customer: { name: [o.firstName, o.lastName].filter(Boolean).join(' ') || null, email: o.email, firebaseUid: o.firebaseUid },
    totals: { subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, taxCents: o.taxCents, totalCents: o.totalCents,
      refundedCents: Number(extra?.amount_refunded_cents ?? 0) },
    status: { ...o.status, fulfillmentLabel: extra?.fulfillment_label ?? null, paymentLabel: extra?.payment_customer_label ?? null },
    pastRefundWindow: Boolean(extra?.past_window),
    isSubscription: Boolean(extra?.is_subscription), subscriptionId: extra?.subscription_id ?? null,
    shipsTo: o.shipsTo,
    lines: o.lines.map(l => {
      const i = internal.get(l.blendId);
      return { ...l, roasterCoffee: i?.coffeeName ?? null, roasterName: i?.roasterName ?? null, roasterSku: i?.roasterSku ?? null };
    }),
    shipments, events,
    stripe: {
      paymentIntentId: o.stripePaymentIntentId, paymentUrl: dashboardUrl('payments', o.stripePaymentIntentId),
      invoiceId: extra?.stripe_invoice_id ?? null, invoiceUrl: dashboardUrl('invoices', extra?.stripe_invoice_id ?? null),
      customerId: extra?.stripe_customer_id ?? null, customerUrl: dashboardUrl('customers', extra?.stripe_customer_id ?? null),
    },
  };
}

/** /admin/subscriptions: each paid subscription with its customer, the real next date and what ships next (house names). */
export async function listSubscriptions(status?: string) {
  const rows = (await db.query(
    `SELECT v.subscription_id, v.status, v.status_label, v.frequency_weeks, v.next_delivery_date::text AS next_delivery_date,
            v.paused_until::text AS paused_until, v.skip_next_until::text AS skip_next_until, v.cancel_at::text AS cancel_at,
            v.failed_attempts, v.last_order_id, v.bag_count, v.has_payment_method, v.created_at, v.counts_as_subscriber,
            up.first_name, up.last_name, ue.email_address, lo.paid_at AS last_order_at
     FROM v_subscription_status v
     JOIN user_profile up ON up.id = v.user_id
     LEFT JOIN LATERAL (SELECT email_address FROM user_email WHERE user_id = v.user_id AND is_primary ORDER BY created_at LIMIT 1) ue ON true
     LEFT JOIN "order" lo ON lo.id = v.last_order_id
     WHERE v.kind = 'paid' AND ($1::text IS NULL OR v.status = $1)
     ORDER BY v.created_at DESC`, [status || null]
  )).rows;
  const out = [];
  for (const r of rows) {
    const ended = r.status === 'canceled' || r.status === 'lapsed';
    let nextCoffee: string[] = [];
    if (!ended) {
      const shipment = await resolveSubscriptionShipment(r.subscription_id).catch(() => null);
      nextCoffee = shipment?.status === 'resolved'
        ? shipment.lines.map(l => `${l.quantity} × ${l.displayName} · ${l.weightOz} oz`)
        : shipment?.status === 'unresolved' ? ['(cannot be resolved: ' + shipment.unresolved.map(u => u.reason).join('; ') + ')'] : [];
    }
    out.push({
      subscriptionId: r.subscription_id, status: r.status, statusLabel: r.status_label,
      customer: { name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, email: r.email_address ?? null },
      frequencyWeeks: r.frequency_weeks, bags: Number(r.bag_count),
      nextDeliveryDate: ended ? null : await effectiveNextDelivery(r),
      pausedUntil: r.paused_until, skipNextUntil: r.skip_next_until, canceledOn: r.cancel_at,
      failedAttempts: r.failed_attempts, hasPaymentMethod: Boolean(r.has_payment_method),
      lastOrderId: r.last_order_id, lastOrderAt: r.last_order_at, nextCoffee,
    });
  }
  return out;
}

/** The admin forms' options (G2.1: nothing typed into the UI). */
export async function getCommerceLookups() {
  const [carriers, reasons, payment, fulfillment, subStatus] = await Promise.all([
    db.query(`SELECT code, label, (tracking_url_template IS NOT NULL) AS has_tracking_link FROM shipping_carrier WHERE is_active ORDER BY id`),
    db.query(`SELECT code, label FROM order_refund_reason ORDER BY id`),
    db.query(`SELECT code, label FROM order_payment_status ORDER BY id`),
    db.query(`SELECT code, label FROM order_fulfillment_status ORDER BY id`),
    db.query(`SELECT code, label FROM subscription_status ORDER BY id`),
  ]);
  return {
    carriers: carriers.rows, refundReasons: reasons.rows, paymentStatuses: payment.rows,
    fulfillmentStatuses: fulfillment.rows, subscriptionStatuses: subStatus.rows,
    refundWindowDays: await commerceParam('refund_window_days'),
  };
}
