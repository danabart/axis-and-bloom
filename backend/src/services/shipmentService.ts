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
import { sendHouseholdBagShippedEmails } from './householdEmails.js';
import { markRequestShippedInTx, type FulfillmentSource } from './fulfillmentService.js';

export class ShipmentError extends Error {
  constructor(public status: 400 | 404 | 409, public code: string, message: string) { super(message); }
}

export interface MarkShippedInput {
  carrier: string; trackingNumber: string; roasterId?: string | null; shippedAt?: string | null;
  // Commerce 6 (2026-11-18): what the ShipStation webhook / reconcile knows.
  serviceCode?: string | null; postageCostCents?: number | null; externalShipmentId?: string | null; labelCreatedAt?: string | null;
  /** The fulfillment request this shipment is for; when absent, the order's one open request (an admin mark-shipped). */
  fulfillmentRequestId?: string | null;
  source?: FulfillmentSource;
}
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
    // Commerce 6: the request this shipment belongs to. An admin mark-shipped on
    // an order split across roasters must say which one.
    let requestId = input.fulfillmentRequestId ?? null;
    let requestRoaster: string | null = null;
    if (requestId) {
      const r = (await tx.query<{ roaster_id: string | null; order_id: string; status: string }>(
        `SELECT roaster_id, order_id, status FROM fulfillment_request WHERE id = $1`, [/^[0-9a-f-]{36}$/i.test(requestId) ? requestId : '00000000-0000-0000-0000-000000000000'])).rows[0];
      if (!r || r.order_id !== orderId) throw new ShipmentError(404, 'request_not_found', 'That fulfillment request is not on this order.');
      if (r.status === 'canceled') throw new ShipmentError(409, 'request_canceled', 'That part of the order was canceled.');
      requestRoaster = r.roaster_id;
    } else {
      const open = (await tx.query<{ id: string; roaster_id: string | null }>(
        `SELECT fr.id, fr.roaster_id FROM fulfillment_request fr JOIN fulfillment_request_status s ON s.code = fr.status
         WHERE fr.order_id = $1 AND NOT s.is_closed ORDER BY fr.sequence`, [orderId])).rows;
      if (open.length > 1) throw new ShipmentError(400, 'choose_request', 'This order ships from several roasters: choose which part shipped.');
      if (open.length === 1) { requestId = open[0].id; requestRoaster = open[0].roaster_id; }
    }
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

    const source = input.source ?? 'admin';
    const row = (await tx.query<{ id: string }>(
      `INSERT INTO roastery_shipment_details (order_id, roaster_id, tracking_number, carrier, status, shipped_at, updated_at,
                                              service_code, postage_cost, external_shipment_id, label_created_at, fulfillment_request_id)
       VALUES ($1, $2, $3, $4, 'shipped', COALESCE($5::timestamptz, now()), now(), $6, $7, $8, $9, $10)
       RETURNING id`,
      [orderId, input.roasterId ?? requestRoaster ?? order.fulfillment_roaster_id, trackingNumber, carrier.code, input.shippedAt ?? null,
       input.serviceCode ?? null, input.postageCostCents == null ? null : input.postageCostCents / 100, input.externalShipmentId ?? null,
       input.labelCreatedAt ?? null, requestId]
    )).rows[0];
    if (requestId) await markRequestShippedInTx(tx, requestId, `${carrier.code} ${trackingNumber}`, source);
    // With requests, v_order_status derives the order's status from them (shipped
    // or partially_shipped); the order event is the milestone only.
    await recordOrderEvent({
      orderId, kind: 'shipped', fulfillmentStatus: requestId ? null : 'shipped', note: `${carrier.code} ${trackingNumber}`, stripeRef: null,
      source: source === 'finalizer' ? 'admin' : source,
    }, tx);
    return { shipmentId: row.id, created: true };
  });

  let emailStatus: string | null = null;
  if (result.created) {
    emailStatus = await sendShippingNotificationEmail(orderId, result.shipmentId)
      .then(r => r.status)
      .catch(err => { console.error('[shipmentService] shipping email failed', orderId, err instanceof Error ? err.message : err); return 'failed'; });
    // Family Household 3 (D13): each member with a sign-in hears their bag shipped (buyer skipped, T8).
    await sendHouseholdBagShippedEmails(orderId)
      .catch(err => console.error('[shipmentService] household member emails failed', orderId, err instanceof Error ? err.message : err));
  }
  return { ...result, emailStatus };
}

/**
 * Commerce 6: the postage on a shipment recorded before its cost was readable
 * (a 3PL fulfillment carries none; the daily reconcile finds the label's
 * shipment later). Fills a NULL only; true when it wrote.
 */
export async function recordPostage(shipmentId: string, postageCostCents: number): Promise<boolean> {
  const r = await db.query(
    `UPDATE roastery_shipment_details SET postage_cost = $2, updated_at = now() WHERE id = $1 AND postage_cost IS NULL`,
    [shipmentId, postageCostCents / 100]
  );
  return (r.rowCount ?? 0) > 0;
}
