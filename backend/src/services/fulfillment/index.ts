// Commerce 1, B8 (2026-10-31) — fulfillment: payment and fulfillment are two
// systems joined by the order. dispatchFulfillment picks an adapter for a paid
// order and records what happened as order_event rows (through
// checkoutService, the one writer). A failure never touches the payment: the
// order stays paid, the attempt is a fulfillment_failed event, the order goes
// to needs_attention and Dana gets an attention email.
import { getOrderSummary, recordOrderEvent, type OrderSummary } from '../checkoutService.js';
import { sendAdminFulfillmentAttentionEmail } from '../orderEmails.js';
import { db } from '../../db/client.js';
import { manualAdapter } from './manual.js';

export interface FulfillmentAdapter {
  name: string;
  placeOrder(order: OrderSummary): Promise<{ externalRef?: string; fulfillmentStatus: 'awaiting_manual' | 'placed' }>;
}

/** Which adapter places this order. NULL fulfillment_roaster_id = manual. */
export function adapterFor(order: OrderSummary): FulfillmentAdapter {
  if (!order.fulfillmentRoasterId) return manualAdapter;
  // seam: roaster adapters. A roaster id routes to that roaster's adapter
  // (ShipStation, OPEN_TASKS) once it exists; until then, manual too.
  return manualAdapter;
}

export interface DispatchResult { ok: boolean; adapter: string; attempts: number; error?: string }

export async function dispatchFulfillment(orderId: string): Promise<DispatchResult> {
  const order = await getOrderSummary(orderId);
  if (!order) throw new Error(`dispatchFulfillment: order ${orderId} not found`);
  const adapter = adapterFor(order);
  try {
    const placed = await adapter.placeOrder(order);
    await recordOrderEvent({
      orderId, kind: placed.fulfillmentStatus === 'placed' ? 'fulfillment_placed' : 'fulfillment_dispatched',
      fulfillmentStatus: placed.fulfillmentStatus, note: [adapter.name, placed.externalRef].filter(Boolean).join(': '), source: 'finalizer',
    });
    return { ok: true, adapter: adapter.name, attempts: 0 };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const prior = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM order_event WHERE order_id = $1 AND event_kind = 'fulfillment_failed'`, [orderId]
    );
    const attempts = Number(prior.rows[0].n) + 1;
    await recordOrderEvent({ orderId, kind: 'fulfillment_failed', note: `${adapter.name} attempt ${attempts}: ${error}`, source: 'finalizer' });
    await recordOrderEvent({ orderId, kind: 'fulfillment_needs_attention', fulfillmentStatus: 'needs_attention', source: 'finalizer' });
    await sendAdminFulfillmentAttentionEmail(orderId, error, attempts).catch(e => console.error('[fulfillment] attention email failed', orderId, e));
    console.error(`[fulfillment] ${adapter.name} failed for order ${orderId} (attempt ${attempts}):`, error);
    return { ok: false, adapter: adapter.name, attempts, error };
  }
}
