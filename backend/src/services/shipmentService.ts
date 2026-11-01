// Commerce 3, B4 (2026-10-31) — the one writer of roastery_shipment_details.
// Admin marks a paid order shipped (later: the ShipStation tracking webhooks
// call the same function). One row per (order, tracking number), linked to
// the order by order_id: order_line_item.shipment_id stays unused, because
// order_line_item is insert-only for ab_app (D11; Dana 2026-10-31, Commerce 3
// decision 3). The shipped order event goes through checkoutService (the one
// order_event writer); the customer's shipping email goes once per shipment.
import { db, withTransaction } from '../db/client.js';
import { recordOrderEvent } from './checkoutService.js';
import { sendShippingNotificationEmail } from './orderEmails.js';

export class ShipmentError extends Error {
  constructor(public status: 400 | 404 | 409, public code: string, message: string) { super(message); }
}

export interface MarkShippedInput { carrier: string; trackingNumber: string; roasterId?: string | null; shippedAt?: string | null }
export interface MarkShippedResult { shipmentId: string; created: boolean; emailStatus: string | null }

const CLOSED_FOR_SHIPPING = ['canceled', 'delivered'];

/**
 * Mark an order shipped: the shipment row (status shipped), a shipped order
 * event (source admin) and the shipping email. Idempotent: the same order and
 * tracking number again returns the existing row and does nothing else.
 */
export async function markShipped(orderId: string, input: MarkShippedInput): Promise<MarkShippedResult> {
  const trackingNumber = String(input.trackingNumber ?? '').trim();
  if (!trackingNumber || trackingNumber.length > 64) throw new ShipmentError(400, 'invalid_tracking_number', 'Enter the tracking number (up to 64 characters).');
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new ShipmentError(404, 'order_not_found', 'Order not found.');

  const carrier = (await db.query<{ code: string }>(`SELECT code FROM shipping_carrier WHERE code = $1 AND is_active`, [input.carrier])).rows[0];
  if (!carrier) throw new ShipmentError(400, 'invalid_carrier', 'Choose a carrier from the list.');

  const result = await withTransaction(async tx => {
    // One markShipped per order at a time: an advisory lock, as the finalizer
    // takes (ab_app has no UPDATE on "order", so no row lock, D11).
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ship:${orderId}`]);
    const order = (await tx.query<{ id: string; fulfillment_roaster_id: string | null }>(
      `SELECT id, fulfillment_roaster_id FROM "order" WHERE id = $1`, [orderId]
    )).rows[0];
    if (!order) throw new ShipmentError(404, 'order_not_found', 'Order not found.');
    const state = (await tx.query<{ fulfillment_status: string | null; payment_status: string | null }>(
      `SELECT fulfillment_status, payment_status FROM v_order_status WHERE order_id = $1`, [orderId]
    )).rows[0];

    const existing = (await tx.query<{ id: string }>(
      `SELECT id FROM roastery_shipment_details WHERE order_id = $1 AND tracking_number = $2`, [orderId, trackingNumber]
    )).rows[0];
    if (existing) return { shipmentId: existing.id, created: false };

    if (state?.fulfillment_status && CLOSED_FOR_SHIPPING.includes(state.fulfillment_status)) {
      throw new ShipmentError(409, 'order_closed', `This order is ${state.fulfillment_status}; it cannot be marked shipped.`);
    }
    if (state?.payment_status === 'refunded') throw new ShipmentError(409, 'order_refunded', 'This order was fully refunded.');

    const row = (await tx.query<{ id: string }>(
      `INSERT INTO roastery_shipment_details (order_id, roaster_id, tracking_number, carrier, status, shipped_at, updated_at)
       VALUES ($1, $2, $3, $4, 'shipped', COALESCE($5::timestamptz, now()), now())
       RETURNING id`,
      [orderId, input.roasterId ?? order.fulfillment_roaster_id, trackingNumber, carrier.code, input.shippedAt ?? null]
    )).rows[0];
    await recordOrderEvent({
      orderId, kind: 'shipped', fulfillmentStatus: 'shipped', note: `${carrier.code} ${trackingNumber}`, stripeRef: null, source: 'admin',
    }, tx);
    return { shipmentId: row.id, created: true };
  });

  let emailStatus: string | null = null;
  if (result.created) {
    emailStatus = await sendShippingNotificationEmail(orderId, result.shipmentId)
      .then(r => r.status)
      .catch(err => { console.error('[shipmentService] shipping email failed', orderId, err instanceof Error ? err.message : err); return 'failed'; });
  }
  return { ...result, emailStatus };
}
