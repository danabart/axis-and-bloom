// Commerce 1, B8 (2026-10-31) — fulfillment: payment and fulfillment are two
// systems joined by the order. A failure never touches the payment: the order
// stays paid, the attempt is recorded, the order goes to needs_attention and
// Dana gets an attention email.
//
// Commerce 6 (2026-11-18): dispatch is per roaster. dispatchFulfillment
// creates one fulfillment_request per roaster on the order and places each
// with its adapter (fulfillmentService: the manual email listing only that
// roaster's lines, or a ShipStation order). The order's fulfillment status is
// derived from its requests (v_order_status); the order_event kinds below stay
// as order-level milestones only. The old one-adapter seam (adapterFor,
// manual.ts) is replaced by the per-request adapter column.
import { getOrderSummary, recordOrderEvent } from '../checkoutService.js';
import { db } from '../../db/client.js';
import { createRequestsForOrder, place, requestsForOrder, type FulfillmentSource } from '../fulfillmentService.js';

export interface DispatchResult { ok: boolean; adapter: string; attempts: number; error?: string; requests?: Array<{ id: string; status: string; adapter: string; error?: string }> }

export class FulfillmentRetryError extends Error {
  constructor(public status: 404 | 409, public code: string, message: string) { super(message); }
}

/**
 * Commerce 3, B5: admin's "Retry fulfillment" on an order not yet with the
 * roaster (needs_attention, awaiting_manual). Commerce 6: retries every
 * request still waiting to be placed; a manual request already emailed is not
 * re-sent (deduped per order and part), and the response says so.
 */
export async function retryFulfillment(orderId: string): Promise<DispatchResult & { note: string | null }> {
  const st = (await db.query<{ fulfillment_status: string | null; payment_status: string | null }>(
    `SELECT fulfillment_status, payment_status FROM v_order_status WHERE order_id = $1`,
    [/^[0-9a-f-]{36}$/i.test(orderId) ? orderId : '00000000-0000-0000-0000-000000000000']
  )).rows[0];
  if (!st) throw new FulfillmentRetryError(404, 'order_not_found', 'Order not found.');
  if (!['needs_attention', 'awaiting_manual', 'pending'].includes(st.fulfillment_status ?? '') || st.payment_status === 'refunded') {
    throw new FulfillmentRetryError(409, 'not_retryable', `Only an order waiting for fulfillment can be retried (this one is ${st.fulfillment_status}${st.payment_status === 'refunded' ? ', refunded' : ''}).`);
  }
  const r = await dispatchFulfillment(orderId, 'admin');
  const onlyManual = (r.requests ?? []).every(q => q.adapter === 'manual');
  return { ...r, note: r.ok && onlyManual ? 'Manual fulfillment: the new-order email was already sent once for this order and is not repeated.' : null };
}

/** source: finalizer after payment; admin for a retry from /admin/orders (Commerce 3). */
export async function dispatchFulfillment(orderId: string, source: FulfillmentSource = 'finalizer'): Promise<DispatchResult> {
  const order = await getOrderSummary(orderId);
  if (!order) throw new Error(`dispatchFulfillment: order ${orderId} not found`);
  const created = await createRequestsForOrder(orderId, source);
  const results: NonNullable<DispatchResult['requests']> = [];
  for (const req of created) {
    if (!['pending', 'failed', 'needs_attention'].includes(req.status)) { results.push({ id: req.id, status: req.status, adapter: req.adapter_code }); continue; }
    const p = await place(req.id, source);
    results.push({ id: req.id, status: p.status, adapter: p.adapter, error: p.error });
  }
  const after = await requestsForOrder(orderId);
  const attempts = Math.max(0, ...after.map(r => r.attempts));
  const adapters = [...new Set(after.map(r => r.adapter_code))].join('+') || 'manual';
  const failed = results.filter(r => r.error);
  const orderSource = source === 'webhook' ? 'webhook' : source === 'cron' ? 'cron' : source;
  if (failed.length) {
    const error = failed.map(f => f.error).join('; ');
    await recordOrderEvent({ orderId, kind: 'fulfillment_failed', note: `${adapters} attempt ${attempts}: ${error}`, source: orderSource });
    await recordOrderEvent({ orderId, kind: 'fulfillment_needs_attention', source: orderSource });
    return { ok: false, adapter: adapters, attempts, error, requests: results };
  }
  const placed = after.some(r => r.status === 'placed');
  await recordOrderEvent({
    orderId, kind: placed ? 'fulfillment_placed' : 'fulfillment_dispatched',
    note: after.map(r => `${r.sequence}:${r.adapter_code}:${r.status}${r.external_order_number ? ` ${r.external_order_number}` : ''}`).join(', '), source: orderSource,
  });
  return { ok: true, adapter: adapters, attempts, requests: results };
}
