// Commerce 6 (2026-11-18), Part B — the one writer of fulfillment_request,
// fulfillment_event, roastery_fulfillment_config and the ShipStation webhook
// ledger fulfillment_shipstation_event (G2.5). A paid order becomes one
// request per roaster (decision 4); each request is placed by its adapter
// (manual email, or a ShipStation order in our account that an automation rule
// hands to the roaster as 3PL provider). ShipStation is the truth for what
// shipped (G3.3): its webhook and the daily reconcile call
// shipmentService.markShipped, which records the shipment and emails the
// customer. Everything ShipStation is behind shipstation_enabled.
import { db, withTransaction, type Tx } from '../db/client.js';
import { commerceParam, commerceParamText } from './commerceParameters.js';
import { getOrderSummary, type OrderSummary } from './checkoutService.js';
import { internalLines, sendAdminNewOrderEmail, sendAdminFulfillmentAlert } from './orderEmails.js';
import * as ss from './fulfillment/shipstationClient.js';
import { buildShipStationOrder, NeedsAttentionError, shipStationOrderKey, shipStationOrderNumber } from './fulfillment/shipstation.js';
import { log } from '../lib/logger.js';

type Runner = Pick<Tx, 'query'>;
export type FulfillmentSource = 'finalizer' | 'webhook' | 'admin' | 'cron';

export class FulfillmentRequestError extends Error {
  constructor(public status: 400 | 404 | 409, public code: string, message: string) { super(message); }
}

export interface RequestRow {
  id: string; order_id: string; roaster_id: string | null; sequence: number; adapter_code: string; status: string;
  external_order_id: string | null; external_order_number: string | null; external_order_key: string; attempts: number;
  last_error: string | null; placed_at: string | null; created_at: string; updated_at: string;
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function shipStationEnabled(): Promise<boolean> {
  return (await commerceParam('shipstation_enabled')) === 1;
}

// ── history and state ────────────────────────────────────────────────────────

async function recordEvent(runner: Runner, e: { requestId: string; kind: string; status?: string | null; note?: string | null; externalRef?: string | null; source: FulfillmentSource }) {
  await runner.query(
    `INSERT INTO fulfillment_event (fulfillment_request_id, event_kind, status, external_ref, note, source) VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.requestId, e.kind, e.status ?? null, e.externalRef ?? null, e.note ?? null, e.source]
  );
}

/** The request's one state change: the row and its event, together. */
async function transition(runner: Runner, requestId: string, t: {
  status: string; kind: string; source: FulfillmentSource; note?: string | null; externalRef?: string | null;
  externalOrderId?: string | null; externalOrderNumber?: string | null; bumpAttempts?: boolean; lastError?: string | null; placed?: boolean;
}) {
  await runner.query(
    `UPDATE fulfillment_request SET status = $2,
            external_order_id = COALESCE($3, external_order_id), external_order_number = COALESCE($4, external_order_number),
            attempts = attempts + CASE WHEN $5 THEN 1 ELSE 0 END,
            last_error = COALESCE($6::text, last_error),
            placed_at = CASE WHEN $7 THEN COALESCE(placed_at, now()) ELSE placed_at END,
            updated_at = now()
     WHERE id = $1`,
    [requestId, t.status, t.externalOrderId ?? null, t.externalOrderNumber ?? null, Boolean(t.bumpAttempts), t.lastError ?? null, Boolean(t.placed)]
  );
  await recordEvent(runner, { requestId, kind: t.kind, status: t.status, note: t.note, externalRef: t.externalRef, source: t.source });
}

async function getRequest(requestId: string, runner: Runner = db): Promise<RequestRow | null> {
  if (!UUID.test(requestId)) return null;
  return (await runner.query<RequestRow>(`SELECT * FROM fulfillment_request WHERE id = $1`, [requestId])).rows[0] ?? null;
}

export async function requestsForOrder(orderId: string, runner: Runner = db): Promise<RequestRow[]> {
  return (await runner.query<RequestRow>(`SELECT * FROM fulfillment_request WHERE order_id = $1 ORDER BY sequence`, [orderId])).rows;
}

async function statusRow(code: string): Promise<{ is_retryable: boolean; is_closed: boolean; cancels_on_full_refund: boolean }> {
  return (await db.query(`SELECT is_retryable, is_closed, cancels_on_full_refund FROM fulfillment_request_status WHERE code = $1`, [code])).rows[0];
}

// ── roaster config (supersede-only) ──────────────────────────────────────────

export interface RoasterConfigInput {
  roasterId: string; adapterCode: string; shipstationTag?: string | null; shipstationShipFromId?: string | null;
  requestedServiceCode?: string | null; isActive?: boolean; note?: string | null;
}

export async function activeConfig(roasterId: string | null, runner: Runner = db) {
  if (!roasterId) return null;
  return (await runner.query<{ config_id: number; adapter_code: string; shipstation_tag: string | null; shipstation_ship_from_id: string | null;
    requested_service_code: string | null; is_active: boolean; roaster_name: string }>(
    `SELECT * FROM v_roastery_fulfillment_config WHERE roaster_id = $1`, [roasterId]
  )).rows[0] ?? null;
}

/** Supersede the roaster's current config with a new row (the admin form). */
export async function setRoasterConfigInTx(tx: Tx, input: RoasterConfigInput, setBy: string | null) {
  if (!UUID.test(input.roasterId) || !(await tx.query(`SELECT 1 FROM roaster WHERE id = $1`, [input.roasterId])).rows.length) {
    throw new FulfillmentRequestError(404, 'roaster_not_found', 'Roaster not found.');
  }
  if (!(await tx.query(`SELECT 1 FROM fulfillment_adapter WHERE code = $1`, [input.adapterCode])).rows.length) {
    throw new FulfillmentRequestError(400, 'invalid_adapter', 'Choose a fulfillment adapter from the list.');
  }
  const tag = input.shipstationTag?.trim() || null;
  const shipFrom = input.shipstationShipFromId?.trim() || null;
  const service = input.requestedServiceCode?.trim() || null;
  if (input.adapterCode === 'shipstation' && !tag) throw new FulfillmentRequestError(400, 'tag_required', 'A ShipStation roaster needs the tag its automation rule keys on.');
  if (shipFrom && !/^\d{1,12}$/.test(shipFrom)) throw new FulfillmentRequestError(400, 'invalid_ship_from', 'The ship-from id is the ShipStation warehouse number.');
  if (service && !/^[a-z0-9_]{2,60}$/.test(service)) throw new FulfillmentRequestError(400, 'invalid_service', 'The service is a ShipStation service code, e.g. usps_ground_advantage.');
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fulfillment_config:${input.roasterId}`]);
  await tx.query(`UPDATE roastery_fulfillment_config SET superseded_at = now() WHERE roaster_id = $1 AND superseded_at IS NULL`, [input.roasterId]);
  const row = (await tx.query<{ id: number }>(
    `INSERT INTO roastery_fulfillment_config (roaster_id, adapter_code, shipstation_tag, shipstation_ship_from_id, requested_service_code, is_active, set_by, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.roasterId, input.adapterCode, tag, shipFrom, service, input.isActive ?? true, setBy, input.note?.trim() || null]
  )).rows[0];
  return { configId: row.id };
}

export async function setRoasterConfig(input: RoasterConfigInput, setBy: string | null) {
  return withTransaction(tx => setRoasterConfigInTx(tx, input, setBy));
}

export async function listRoasterConfigs() {
  const configs = (await db.query(`SELECT * FROM v_roastery_fulfillment_config ORDER BY roaster_name`)).rows;
  const adapters = (await db.query(`SELECT code, label FROM fulfillment_adapter ORDER BY id`)).rows;
  return { configs, adapters };
}

// ── requests for an order ────────────────────────────────────────────────────

type InternalLineMap = Awaited<ReturnType<typeof internalLines>>;

/** Group the order's lines by roaster: one group per roaster, in line order. */
function groupByRoaster(order: OrderSummary, internal: InternalLineMap): Array<{ roasterId: string | null; lines: OrderSummary['lines'] }> {
  const groups: Array<{ roasterId: string | null; lines: OrderSummary['lines'] }> = [];
  for (const l of order.lines) {
    const roasterId = internal.get(l.blendId)?.roasterId ?? null;
    let g = groups.find(x => x.roasterId === roasterId);
    if (!g) { g = { roasterId, lines: [] }; groups.push(g); }
    g.lines.push(l);
  }
  return groups;
}

/**
 * One request per roaster on the order, created once (idempotent: a second
 * call returns the same rows). The adapter is decided here: shipstation when
 * the switch is on and the roaster's active config says so, else manual.
 */
export async function createRequestsForOrder(orderId: string, source: FulfillmentSource = 'finalizer'): Promise<RequestRow[]> {
  const order = await getOrderSummary(orderId);
  if (!order) throw new FulfillmentRequestError(404, 'order_not_found', 'Order not found.');
  const groups = groupByRoaster(order, await internalLines(order));
  const enabled = await shipStationEnabled();
  return withTransaction(async tx => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fulfill:${orderId}`]);
    const existing = await requestsForOrder(orderId, tx);
    if (existing.length) return existing;
    for (const [i, g] of groups.entries()) {
      const cfg = await activeConfig(g.roasterId, tx);
      const adapter = enabled && cfg?.is_active && cfg.adapter_code === 'shipstation' ? 'shipstation' : 'manual';
      const sequence = i + 1;
      const row = (await tx.query<{ id: string }>(
        `INSERT INTO fulfillment_request (order_id, roaster_id, sequence, adapter_code, status, external_order_key)
         VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING id`,
        [orderId, g.roasterId, sequence, adapter, shipStationOrderKey(orderId, sequence)]
      )).rows[0];
      await recordEvent(tx, { requestId: row.id, kind: 'created', status: 'pending', source,
        note: `${adapter}; ${g.lines.reduce((n, l) => n + l.quantity, 0)} bag(s)${!enabled && cfg?.adapter_code === 'shipstation' ? '; shipstation_enabled = 0, so manual' : ''}` });
    }
    return requestsForOrder(orderId, tx);
  });
}

export interface PlaceResult { requestId: string; ok: boolean; status: string; adapter: string; error?: string; note?: string }

let tagCache: { at: number; tags: Map<string, number> } | null = null;
async function tagIdFor(name: string): Promise<number | null> {
  if (!tagCache || Date.now() - tagCache.at > 10 * 60_000) {
    tagCache = { at: Date.now(), tags: new Map((await ss.listTags()).map(t => [t.name.trim().toLowerCase(), t.tagId])) };
  }
  return tagCache.tags.get(name.trim().toLowerCase()) ?? null;
}
export function resetShipStationTagCache() { tagCache = null; }

/**
 * Place one request with its adapter. Only a pending, failed or
 * needs-attention request is placed; anything else returns as it is. A
 * ShipStation retry looks for the order first (GET before POST): ShipStation
 * refuses to update an order that is no longer open.
 */
export async function place(requestId: string, source: FulfillmentSource): Promise<PlaceResult> {
  const req = await getRequest(requestId);
  if (!req) throw new FulfillmentRequestError(404, 'request_not_found', 'Fulfillment request not found.');
  if (!['pending', 'failed', 'needs_attention'].includes(req.status)) {
    return { requestId, ok: true, status: req.status, adapter: req.adapter_code, note: `already ${req.status}` };
  }
  const order = await getOrderSummary(req.order_id);
  if (!order) throw new FulfillmentRequestError(404, 'order_not_found', 'Order not found.');
  const internal = await internalLines(order);
  const lines = order.lines.filter(l => (internal.get(l.blendId)?.roasterId ?? null) === req.roaster_id);
  const all = await requestsForOrder(req.order_id);

  try {
    if (req.adapter_code === 'manual') {
      const sent = await sendAdminNewOrderEmail(order, { sequence: req.sequence, of: all.length, lines });
      if (sent.status === 'failed') throw new Error('admin new-order email could not be sent');
      await transition(db, requestId, { status: 'awaiting_manual', kind: 'awaiting_manual', source, placed: true, bumpAttempts: true,
        externalRef: sent.id, note: sent.status === 'skipped' ? 'email already sent for this order' : null });
      return { requestId, ok: true, status: 'awaiting_manual', adapter: 'manual' };
    }

    // ShipStation
    const orderNumber = shipStationOrderNumber(req.order_id, req.sequence);
    const found = (await ss.findOrdersByNumber(orderNumber)).find(o => o.orderKey === req.external_order_key);
    if (found) {
      await transition(db, requestId, { status: 'placed', kind: 'placed', source, placed: true, bumpAttempts: true,
        externalOrderId: String(found.orderId), externalOrderNumber: orderNumber, externalRef: String(found.orderId), note: `already in ShipStation (${found.orderStatus})` });
      return { requestId, ok: true, status: 'placed', adapter: 'shipstation', note: 'found existing' };
    }
    const cfg = await activeConfig(req.roaster_id);
    if (!cfg?.shipstation_tag) throw new NeedsAttentionError('The roaster has no active ShipStation config (tag).');
    const tagId = await tagIdFor(cfg.shipstation_tag);
    if (tagId === null) throw new NeedsAttentionError(`ShipStation has no tag "${cfg.shipstation_tag}": create it in the ShipStation Dashboard, then retry.`);
    const payload = buildShipStationOrder({
      order, roasterName: cfg.roaster_name,
      request: { id: req.id, sequence: req.sequence, externalOrderKey: req.external_order_key, roasterId: req.roaster_id },
      lines: lines.map(l => ({ ...l, roasterSku: internal.get(l.blendId)?.roasterSku ?? null, coffeeName: internal.get(l.blendId)?.coffeeName ?? null })),
      tagId,
      requestedService: cfg.requested_service_code ?? ((await commerceParamText('shipstation_requested_service')).trim() || null),
      packagingWeightOz: await commerceParam('packaging_weight_oz'),
      warehouseId: cfg.shipstation_ship_from_id ? Number(cfg.shipstation_ship_from_id) : null,
    });
    const created = await ss.createOrUpdateOrder(payload);
    await transition(db, requestId, { status: 'placed', kind: 'placed', source, placed: true, bumpAttempts: true,
      externalOrderId: String(created.orderId), externalOrderNumber: orderNumber, externalRef: String(created.orderId) });
    log.info('fulfillment', 'placed in ShipStation', { requestId, orderId: req.order_id, shipstationOrderId: created.orderId, orderNumber });
    return { requestId, ok: true, status: 'placed', adapter: 'shipstation' };
  } catch (err) {
    return failPlacement(req, order, err, source);
  }
}

async function failPlacement(req: RequestRow, order: OrderSummary, err: unknown, source: FulfillmentSource): Promise<PlaceResult> {
  const error = err instanceof Error ? err.message : String(err);
  const attempts = req.attempts + 1;
  const limit = await commerceParam('shipstation_needs_attention_after_attempts');
  const attention = err instanceof NeedsAttentionError || req.adapter_code === 'manual' || attempts >= limit;
  const status = attention ? 'needs_attention' : 'failed';
  await transition(db, req.id, { status, kind: status, source, bumpAttempts: true, lastError: error, note: `${req.adapter_code} attempt ${attempts}: ${error}` });
  log.error('fulfillment', 'placement failed', { requestId: req.id, orderId: req.order_id, adapter: req.adapter_code, attempts, status, error });
  if (attention) {
    await sendAdminFulfillmentAlert({
      orderId: order.orderId, key: `needs_attention:${req.id}:${attempts}`,
      subject: `Order needs attention: ${order.orderId} (${req.adapter_code}, part ${req.sequence})`,
      text: `Fulfillment request ${req.id} (part ${req.sequence}, ${req.adapter_code}) could not be placed after ${attempts} attempt(s).\n\nReason: ${error}\n\nThe order is paid; nothing was refunded. Fix the reason and press Retry in /admin/orders, or place it by hand.`,
    }).catch(e => log.error('fulfillment', 'attention email failed', { requestId: req.id, error: e instanceof Error ? e.message : String(e) }));
  }
  return { requestId: req.id, ok: false, status, adapter: req.adapter_code, error };
}

/** Admin's Retry on one request (or the cron's): only a retryable state. */
export async function retry(requestId: string, source: FulfillmentSource = 'admin', orderId?: string): Promise<PlaceResult> {
  const req = await getRequest(requestId);
  if (!req || (orderId && req.order_id !== orderId)) throw new FulfillmentRequestError(404, 'request_not_found', 'Fulfillment request not found.');
  if (!(await statusRow(req.status)).is_retryable) {
    throw new FulfillmentRequestError(409, 'not_retryable', `This request is ${req.status}; only a pending, failed or needs-attention request can be retried.`);
  }
  await recordEvent(db, { requestId, kind: 'retried', status: req.status, source });
  return place(requestId, source);
}

export interface CancelResult { requestId: string; canceled: boolean; warning: string | null }

/**
 * Cancel one request (decision 4b: a ShipStation order is always DELETEd; if
 * ShipStation refuses, nothing changes on our side but a cancel_refused event,
 * and the caller tells the admin to contact the roaster).
 */
export async function cancel(requestId: string, reason: string, source: FulfillmentSource = 'admin', orderId?: string): Promise<CancelResult> {
  const req = await getRequest(requestId);
  if (!req || (orderId && req.order_id !== orderId)) throw new FulfillmentRequestError(404, 'request_not_found', 'Fulfillment request not found.');
  if ((await statusRow(req.status)).is_closed) {
    throw new FulfillmentRequestError(409, 'request_closed', `This request is ${req.status}; it cannot be canceled.`);
  }
  if (req.adapter_code === 'shipstation' && req.external_order_id) {
    try {
      await ss.deleteOrder(req.external_order_id);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await recordEvent(db, { requestId, kind: 'cancel_refused', status: req.status, note: `${reason}: ${error}`, externalRef: req.external_order_id, source });
      log.warn('fulfillment', 'ShipStation refused the delete', { requestId, shipstationOrderId: req.external_order_id, error });
      return { requestId, canceled: false, warning: `ShipStation would not delete order ${req.external_order_number ?? req.external_order_id} (${error}). Contact the roaster to stop it.` };
    }
  }
  await transition(db, requestId, { status: 'canceled', kind: 'canceled', source, note: reason, externalRef: req.external_order_id });
  return { requestId, canceled: true, warning: null };
}

/** A full refund (checkoutService.recordRefund): cancel every request whose status a refund cancels. */
export async function cancelForRefund(orderId: string, source: FulfillmentSource = 'webhook'): Promise<CancelResult[]> {
  const reqs = (await db.query<{ fulfillment_request_id: string }>(
    `SELECT fulfillment_request_id FROM v_fulfillment_request_status WHERE order_id = $1 AND cancels_on_full_refund ORDER BY sequence`, [orderId]
  )).rows;
  const results: CancelResult[] = [];
  for (const r of reqs) results.push(await cancel(r.fulfillment_request_id, 'full refund', source));
  const refused = results.filter(r => !r.canceled);
  if (refused.length) {
    await sendAdminFulfillmentAlert({
      orderId, key: `cancel_refused:${orderId}`, subject: `Refunded order still with the roaster: ${orderId}`,
      text: `The order was fully refunded, but ShipStation would not cancel it:\n\n${refused.map(r => r.warning).join('\n')}\n\nContact the roaster to stop the shipment.`,
    }).catch(e => log.error('fulfillment', 'cancel-refused email failed', { orderId, error: e instanceof Error ? e.message : String(e) }));
  }
  return results;
}

/** shipmentService.markShipped, inside its transaction: the request is shipped. */
export async function markRequestShippedInTx(tx: Tx, requestId: string, note: string, source: FulfillmentSource) {
  const r = (await tx.query<{ status: string }>(`SELECT status FROM fulfillment_request WHERE id = $1 FOR UPDATE`, [requestId])).rows[0];
  if (!r || r.status === 'shipped') return;
  await transition(tx, requestId, { status: 'shipped', kind: 'shipped', source, note });
}

// ── ShipStation: webhook, reconcile, subscription ────────────────────────────

/** The webhook ledger row, as received (the route checked the token and the host first). */
export async function recordShipStationWebhook(payload: { resource_url?: unknown; resource_type?: unknown }): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO fulfillment_shipstation_event (resource_url, resource_type, payload) VALUES ($1, $2, $3) RETURNING id`,
    [typeof payload.resource_url === 'string' ? payload.resource_url : null, typeof payload.resource_type === 'string' ? payload.resource_type : null, JSON.stringify(payload)]
  )).rows[0].id;
}

/** A ledger row closed without processing (refused host, switch off). */
export async function closeShipStationEvent(ledgerId: number, error: string): Promise<void> {
  await db.query(`UPDATE fulfillment_shipstation_event SET processed_at = now(), error = $2 WHERE id = $1`, [ledgerId, error]);
}

async function findRequestFor(item: { orderKey?: string | null; orderId?: number | null; orderNumber?: string | null }): Promise<RequestRow | null> {
  return (await db.query<RequestRow>(
    `SELECT * FROM fulfillment_request
     WHERE adapter_code = 'shipstation' AND (external_order_key = $1 OR external_order_id = $2 OR external_order_number = $3)
     ORDER BY (external_order_key = $1) DESC NULLS LAST LIMIT 1`,
    [item.orderKey ?? null, item.orderId == null ? null : String(item.orderId), item.orderNumber ?? null]
  )).rows[0] ?? null;
}

async function mapCarrier(code: string | null): Promise<{ carrier: string; known: boolean }> {
  if (code) {
    const r = (await db.query<{ carrier_code: string }>(
      `SELECT carrier_code FROM shipping_carrier_external_code WHERE external_system = 'shipstation' AND external_code = $1`, [code]
    )).rows[0];
    if (r) return { carrier: r.carrier_code, known: true };
  }
  return { carrier: 'other', known: false };
}

export interface ApplyResult { matched: number; shipped: number; postage: number; rejected: number; unknown: number; skipped: number; errors: string[] }
const emptyApply = (): ApplyResult => ({ matched: 0, shipped: 0, postage: 0, rejected: 0, unknown: 0, skipped: 0, errors: [] });

/**
 * Apply what ShipStation says shipped (shipments carry postage; fulfillments,
 * from a 3PL provider, do not: postage stays NULL until a shipment shows up,
 * decision 1). markShipped is idempotent per tracking number.
 */
export async function applyShipStationItems(
  data: { shipments?: ss.ShipStationShipment[]; fulfillments?: ss.ShipStationFulfillment[] },
  kind: 'shipped' | 'rejected', source: FulfillmentSource,
): Promise<ApplyResult> {
  const { markShipped, recordPostage } = await import('./shipmentService.js');
  const out = emptyApply();
  const items: Array<{ ref: string; orderKey?: string | null; orderId: number; orderNumber: string; trackingNumber: string | null; carrierCode: string | null;
    serviceCode: string | null; costCents: number | null; shipDate: string | null; createDate: string | null; voided: boolean; provider: string | null }> = [
    ...(data.shipments ?? []).map(s => ({ ref: `shipment:${s.shipmentId}`, orderKey: s.orderKey, orderId: s.orderId, orderNumber: s.orderNumber, trackingNumber: s.trackingNumber,
      carrierCode: s.carrierCode, serviceCode: s.serviceCode, costCents: s.shipmentCost == null ? null : Math.round(Number(s.shipmentCost) * 100),
      shipDate: s.shipDate, createDate: s.createDate, voided: Boolean(s.voided), provider: null })),
    ...(data.fulfillments ?? []).map(f => ({ ref: `fulfillment:${f.fulfillmentId}`, orderKey: null, orderId: f.orderId, orderNumber: f.orderNumber, trackingNumber: f.trackingNumber,
      carrierCode: f.carrierCode, serviceCode: f.fulfillmentServiceCode ?? null, costCents: null, shipDate: f.shipDate, createDate: f.createDate,
      voided: Boolean(f.voided), provider: f.sellerFillProviderName ?? f.fulfillmentProviderCode ?? null })),
  ];
  for (const it of items) {
    const req = await findRequestFor(it);
    if (!req) { out.unknown++; continue; }
    out.matched++;
    try {
      if (kind === 'rejected') {
        if (!(await statusRow(req.status)).is_closed) {
          await transition(db, req.id, { status: 'needs_attention', kind: 'rejected', source, note: `rejected${it.provider ? ` by ${it.provider}` : ''} (${it.ref})`, externalRef: it.ref });
          await sendAdminFulfillmentAlert({ orderId: req.order_id, key: `rejected:${req.id}:${it.ref}`, subject: `Fulfillment rejected: ${req.order_id}`,
            text: `ShipStation says the fulfillment provider rejected part ${req.sequence} (${req.external_order_number}). Check it in ShipStation, then Retry or place it by hand.` })
            .catch(() => undefined);
          out.rejected++;
        } else out.skipped++;
        continue;
      }
      if (it.voided || !it.trackingNumber) { out.skipped++; continue; }
      const carrier = await mapCarrier(it.carrierCode);
      const r = await markShipped(req.order_id, {
        carrier: carrier.carrier, trackingNumber: it.trackingNumber, roasterId: req.roaster_id, shippedAt: it.shipDate,
        serviceCode: it.serviceCode, postageCostCents: it.costCents, externalShipmentId: it.ref, labelCreatedAt: it.createDate,
        fulfillmentRequestId: req.id, source,
      });
      if (r.created) {
        out.shipped++;
        if (!carrier.known) {
          await recordEvent(db, { requestId: req.id, kind: 'needs_attention', status: 'shipped', source, externalRef: it.ref,
            note: `unknown ShipStation carrier code "${it.carrierCode ?? ''}": recorded as other; add it to shipping_carrier_external_code` });
        }
        if (it.provider) await recordEvent(db, { requestId: req.id, kind: 'provider_assigned', status: 'shipped', source, externalRef: it.ref, note: `shipped by ${it.provider}` });
      } else if (it.costCents != null && await recordPostage(r.shipmentId, it.costCents)) {
        out.postage++;
        await recordEvent(db, { requestId: req.id, kind: 'postage_recorded', status: 'shipped', source, externalRef: it.ref, note: `${it.costCents} cents` });
      }
    } catch (err) {
      out.errors.push(`${it.ref}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/** Process one ledger row: fetch its resource_url from the API (the body is never trusted) and apply it. */
export async function processShipStationEvent(ledgerId: number): Promise<ApplyResult> {
  const row = (await db.query<{ resource_url: string | null; resource_type: string | null }>(
    `SELECT resource_url, resource_type FROM fulfillment_shipstation_event WHERE id = $1`, [ledgerId]
  )).rows[0];
  let result = emptyApply();
  let error: string | null = null;
  try {
    if (!row?.resource_url) throw new Error('no resource_url');
    const data = await ss.fetchResource(row.resource_url);
    result = await applyShipStationItems(data, row.resource_type === 'FULFILLMENT_REJECTED' ? 'rejected' : 'shipped', 'webhook');
    if (result.errors.length) error = result.errors.join('; ');
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  await db.query(`UPDATE fulfillment_shipstation_event SET processed_at = now(), error = $2, result = $3 WHERE id = $1`,
    [ledgerId, error, JSON.stringify(result)]);
  if (error) log.error('shipstation-webhook', 'processing failed', { ledgerId, resourceType: row?.resource_type, error });
  return result;
}

export interface DailyResult { enabled: boolean; retried: number; reconciled: ApplyResult; providerAssigned: number; staleAlerted: number; errors: string[] }

/**
 * The daily cron's third step (approved: no new Scheduler job). Retries
 * failed placements older than shipstation_push_retry_hours, reconciles every
 * placed request and every shipped one still without postage against
 * ShipStation (V1 webhook retries are undocumented, so a missed webhook is
 * caught here), notes the provider once ShipStation shows one, and alerts the
 * admin once about a request placed more than shipstation_stale_days ago with
 * no shipment.
 */
export async function runShipStationDaily(now: Date = new Date()): Promise<DailyResult> {
  const out: DailyResult = { enabled: await shipStationEnabled(), retried: 0, reconciled: emptyApply(), providerAssigned: 0, staleAlerted: 0, errors: [] };
  if (!out.enabled) return out;
  const retryHours = await commerceParam('shipstation_push_retry_hours');
  const staleDays = await commerceParam('shipstation_stale_days');

  const due = (await db.query<{ id: string }>(
    `SELECT id FROM fulfillment_request WHERE adapter_code = 'shipstation' AND status IN ('pending', 'failed')
       AND updated_at <= $1::timestamptz - make_interval(hours => $2::int) ORDER BY created_at`, [now.toISOString(), retryHours]
  )).rows;
  for (const r of due) {
    try { await place(r.id, 'cron'); out.retried++; } catch (err) { out.errors.push(`retry ${r.id}: ${err instanceof Error ? err.message : String(err)}`); }
  }

  const open = (await db.query<{ fulfillment_request_id: string; order_id: string; external_order_number: string; status: string; placed_at: string | null; last_event_kind: string | null; postage_cost: string | null; shipment_id: string | null }>(
    `SELECT fulfillment_request_id, order_id, external_order_number, status, placed_at, last_event_kind, postage_cost, shipment_id
     FROM v_fulfillment_request_status
     WHERE adapter_code = 'shipstation' AND external_order_number IS NOT NULL
       AND (status = 'placed' OR (status = 'shipped' AND shipment_id IS NOT NULL AND postage_cost IS NULL))
     ORDER BY created_at`
  )).rows;
  for (const r of open) {
    try {
      const [fulfillments, shipments] = await Promise.all([ss.fulfillmentsForOrder(r.external_order_number), ss.shipmentsForOrder(r.external_order_number)]);
      const applied = await applyShipStationItems({ shipments, fulfillments }, 'shipped', 'cron');
      for (const k of ['matched', 'shipped', 'postage', 'rejected', 'unknown', 'skipped'] as const) out.reconciled[k] += applied[k];
      out.reconciled.errors.push(...applied.errors);
      if (r.status !== 'placed') continue;
      const ssOrder = (await ss.findOrdersByNumber(r.external_order_number))[0];
      const providerNoted = (await db.query(`SELECT 1 FROM fulfillment_event WHERE fulfillment_request_id = $1 AND event_kind = 'provider_assigned'`, [r.fulfillment_request_id])).rows.length;
      if (ssOrder?.externallyFulfilled && !providerNoted) {
        await recordEvent(db, { requestId: r.fulfillment_request_id, kind: 'provider_assigned', status: 'placed', source: 'cron',
          note: `ShipStation: ${ssOrder.externallyFulfilledBy ?? 'externally fulfilled'} (${ssOrder.orderStatus})` });
        out.providerAssigned++;
      }
      const stillPlaced = (await db.query(`SELECT 1 FROM fulfillment_request WHERE id = $1 AND status = 'placed'`, [r.fulfillment_request_id])).rows.length;
      const stale = r.placed_at && new Date(r.placed_at).getTime() <= now.getTime() - staleDays * 86_400_000;
      const alerted = (await db.query(`SELECT 1 FROM fulfillment_event WHERE fulfillment_request_id = $1 AND event_kind = 'stale_alerted'`, [r.fulfillment_request_id])).rows.length;
      if (stillPlaced && stale && !alerted) {
        await sendAdminFulfillmentAlert({ orderId: r.order_id, key: `stale:${r.fulfillment_request_id}`, subject: `No shipment after ${staleDays} days: ${r.order_id}`,
          text: `ShipStation order ${r.external_order_number} was placed ${r.placed_at} and has no shipment yet (ShipStation status: ${ssOrder?.orderStatus ?? 'unknown'}). Check with the roaster.` });
        await recordEvent(db, { requestId: r.fulfillment_request_id, kind: 'stale_alerted', status: 'placed', source: 'cron', note: `${staleDays} days` });
        out.staleAlerted++;
      }
    } catch (err) {
      out.errors.push(`reconcile ${r.fulfillment_request_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/**
 * The webhook events the handler understands (it fetches List Shipments /
 * List Fulfillments resources). Integration shape, not a business setting.
 */
export const SHIPSTATION_WEBHOOK_EVENTS = ['FULFILLMENT_SHIPPED', 'SHIP_NOTIFY', 'FULFILLMENT_REJECTED'] as const;

/** Our webhook target (the token is a secret path segment, decision 5). */
export function shipStationWebhookUrl(): string | null {
  const base = (process.env.BACKEND_URL ?? '').replace(/\/$/, '');
  const token = process.env.SHIPSTATION_WEBHOOK_TOKEN ?? '';
  return base && token ? `${base}/api/webhooks/shipstation/${token}` : null;
}

/**
 * Subscribe once to each event, when enabled (at boot and from Part D's
 * check). Idempotent: an existing subscription to our URL for the event is
 * kept. Other webhooks in the account (22666, API_TRACK) are never touched.
 * Logs ids and events only, never the URL (it carries the token).
 */
export async function ensureWebhookSubscriptions(): Promise<{ enabled: boolean; subscribed: Array<{ event: string; id: number; created: boolean }> }> {
  if (!(await shipStationEnabled())) return { enabled: false, subscribed: [] };
  const target = shipStationWebhookUrl();
  if (!target) throw new Error('BACKEND_URL / SHIPSTATION_WEBHOOK_TOKEN are not set');
  const existing = await ss.listWebhooks();
  const subscribed: Array<{ event: string; id: number; created: boolean }> = [];
  for (const event of SHIPSTATION_WEBHOOK_EVENTS) {
    const have = existing.find(w => w.HookType === event && w.Url === target);
    if (have) { subscribed.push({ event, id: have.WebHookID, created: false }); continue; }
    const r = await ss.subscribeWebhook({ target_url: target, event, friendly_name: `Axis & Bloom ${event}` });
    subscribed.push({ event, id: r.id, created: true });
  }
  log.info('shipstation', 'webhook subscriptions', { subscribed });
  return { enabled: true, subscribed };
}
