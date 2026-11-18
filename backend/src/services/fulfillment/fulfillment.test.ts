// Commerce 6 (2026-11-18), Part C — fulfillment per roaster, on the test DB.
// Replaces the Commerce 1 mocked test (its seam, adapterFor + manual.ts, is
// gone). The ShipStation API client and the outgoing emails are faked; the
// database, fulfillmentService, shipmentService, the refund path, the views
// and the webhook route are real. Fixture rows (two Zzz roasters, SKUs, a
// customer, orders) are created per run and removed afterwards (test DB only).
// shipstation_enabled is set to 1 for the run and restored in afterAll.
import 'dotenv/config';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const ss = {
  created: [] as any[],
  existing: new Map<string, any>(),         // orderNumber -> ShipStation order (GET before POST)
  createFails: 0,                            // the next N createorder calls fail with a 500
  deleted: [] as string[],
  refuseDelete: false,
  resources: new Map<string, any>(),         // resource_url -> body
  shipments: new Map<string, any[]>(),       // orderNumber -> shipments (reconcile)
  fulfillments: new Map<string, any[]>(),    // orderNumber -> fulfillments (reconcile)
  fetched: [] as string[],
};
let nextOrderId = 900000;
vi.mock('./shipstationClient.js', async importOriginal => {
  const real = await importOriginal<typeof import('./shipstationClient.js')>();
  return {
    ...real,
    createOrUpdateOrder: async (o: any) => {
      if (ss.createFails > 0) { ss.createFails--; throw new real.ShipStationError(500, 'ShipStation POST /orders/createorder 500: boom'); }
      ss.created.push(o);
      const order = { orderId: nextOrderId++, orderNumber: o.orderNumber, orderKey: o.orderKey, orderStatus: 'awaiting_shipment' };
      ss.existing.set(o.orderNumber, order);
      return order;
    },
    findOrdersByNumber: async (n: string) => (ss.existing.has(n) ? [ss.existing.get(n)] : []),
    deleteOrder: async (id: string) => {
      if (ss.refuseDelete) throw new real.ShipStationError(400, 'ShipStation DELETE /orders 400: order is pending fulfillment');
      ss.deleted.push(String(id)); return { success: true, message: 'deleted' };
    },
    listTags: async () => [{ tagId: 5551, name: 'roaster:zzz-c6-a' }],
    shipmentsForOrder: async (n: string) => ss.shipments.get(n) ?? [],
    fulfillmentsForOrder: async (n: string) => ss.fulfillments.get(n) ?? [],
    fetchResource: async (url: string) => {
      if (!(await real.isApiUrl(url))) throw new real.ShipStationError(0, 'resource_url is not on the ShipStation API host');
      ss.fetched.push(url); return ss.resources.get(url) ?? {};
    },
  };
});
const alerts: any[] = [];
const manualEmails: any[] = [];
const shippingEmails: string[] = [];
vi.mock('../orderEmails.js', async importOriginal => {
  const real = await importOriginal<typeof import('../orderEmails.js')>();
  return {
    ...real,
    sendAdminNewOrderEmail: async (o: any, part?: any) => { manualEmails.push({ orderId: o.orderId, part }); return { status: 'sent', id: `resend-${manualEmails.length}` }; },
    sendAdminFulfillmentAlert: async (a: any) => { alerts.push(a); return { status: 'sent', id: null }; },
    sendShippingNotificationEmail: async (_orderId: string, shipmentId: string) => { shippingEmails.push(shipmentId); return { status: 'sent', id: null }; },
  };
});
vi.mock('../householdEmails.js', async importOriginal => ({ ...(await importOriginal<object>()), sendHouseholdBagShippedEmails: async () => undefined }));

const { db } = await import('../../db/client.js');
const { setParameter, invalidateCommerceParameterCache } = await import('../commerceParameters.js');
const fs = await import('../fulfillmentService.js');
const { dispatchFulfillment } = await import('./index.js');
const { markShipped } = await import('../shipmentService.js');
const { recordRefund, getOrderSummary } = await import('../checkoutService.js');
const { forShipment } = await import('../orderEmails.js');
const { default: webhookRouter } = await import('../../routes/shipstationWebhook.js');

const RUN = `zzz-c6-${Date.now()}`;
const ids = { roasters: [] as string[], skus: [] as string[], users: [] as string[], orders: [] as string[], ledger: [] as number[] };
let roasterA: string, roasterB: string, skuA: string, skuB: string, skuNoCode: string, userId: string;
const coffeeName: Record<string, string> = {};
let paramIds: Record<string, { id: number; original: number | null }> = {};
let server: Server; let base: string;
const TOKEN = 'test-token-c6';

async function setParam(key: string, value: number) {
  if (!paramIds[key]) {
    const row = (await db.query(`SELECT id, value_numeric FROM commerce_parameter WHERE key = $1 AND superseded_at IS NULL`, [key])).rows[0];
    paramIds[key] = { id: row.id, original: Number(row.value_numeric) };
  }
  await setParameter(key, value, 'vitest commerce 6', null);
  invalidateCommerceParameterCache();
}

async function makeOrder(lines: Array<{ sku: string; qty: number; name: string }>, opts: { pi?: string; noStreet?: boolean } = {}): Promise<string> {
  const id = (await db.query<{ id: string }>(
    `INSERT INTO "order" (user_id, total_amount_paid, subtotal, paid_at, created_at, stripe_mode, stripe_payment_intent_id,
                          shipping_street, shipping_city, shipping_state, shipping_postal_code, shipping_country)
     VALUES ($1, 30, 29, now(), now(), 'live', $2, $3, 'Hoboken', 'NJ', '07030', 'US') RETURNING id`,
    [userId, opts.pi ?? null, opts.noStreet ? null : '1 Zzz St']
  )).rows[0].id;
  ids.orders.push(id);
  for (const l of lines) {
    await db.query(`INSERT INTO order_line_item (order_id, blend_id, quantity, display_name, weight_oz, unit_price_charged) VALUES ($1, $2, $3, $4, 12, 14.5)`,
      [id, l.sku, l.qty, l.name]);
  }
  await db.query(`INSERT INTO order_event (order_id, event_kind, payment_status, source) VALUES ($1, 'paid', 'paid', 'webhook')`, [id]);
  return id;
}

const status = async (orderId: string) => (await db.query(`SELECT fulfillment_status, fulfillment_requests FROM v_order_status WHERE order_id = $1`, [orderId])).rows[0];
const requests = async (orderId: string) => (await db.query(`SELECT * FROM v_fulfillment_request_status WHERE order_id = $1 ORDER BY sequence`, [orderId])).rows;
const kinds = async (requestId: string) => (await db.query(`SELECT event_kind FROM fulfillment_event WHERE fulfillment_request_id = $1 ORDER BY id`, [requestId])).rows.map(r => r.event_kind);

beforeAll(async () => {
  process.env.SHIPSTATION_WEBHOOK_TOKEN = TOKEN;
  for (const tag of ['a', 'b']) {
    ids.roasters.push((await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [`Zzz C6 Roaster ${tag.toUpperCase()} ${RUN}`])).rows[0].id);
  }
  [roasterA, roasterB] = ids.roasters;
  // Inactive SKUs on existing test-DB coffees (an active SKU is unique per coffee and weight).
  const coffees = (await db.query<{ id: number; name: string }>(`SELECT id, name FROM v_coffee ORDER BY id LIMIT 3`)).rows;
  let ci = 0;
  const sku = async (roaster: string, name: string, code: string | null) => {
    const c = coffees[ci++];
    const id = (await db.query<{ id: string }>(`INSERT INTO coffee_sku (roaster_id, coffee_id, blend_name, roaster_sku, weight_oz, is_active) VALUES ($1, $2, $3, $4, 12, false) RETURNING id`, [roaster, c.id, name, code])).rows[0].id;
    ids.skus.push(id); coffeeName[id] = c.name; return id;
  };
  skuA = await sku(roasterA, `Zzz A coffee ${RUN}`, 'JB-001');
  skuB = await sku(roasterB, `Zzz B coffee ${RUN}`, 'JC-001');
  skuNoCode = await sku(roasterA, `Zzz A no code ${RUN}`, null);
  userId = (await db.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name, last_name) VALUES ($1, 'Zzz', 'Six') RETURNING id`, [`${RUN}-u`])).rows[0].id;
  ids.users.push(userId);
  await fs.setRoasterConfig({ roasterId: roasterA, adapterCode: 'shipstation', shipstationTag: 'roaster:zzz-c6-a', shipstationShipFromId: '1272614' }, 'vitest');
  await setParam('shipstation_enabled', 1);
  const app = express(); app.use(express.json()); app.use('/api/webhooks/shipstation', webhookRouter);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  const a = server.address(); base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/api/webhooks/shipstation`;
});

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  for (const [key, p] of Object.entries(paramIds)) {
    await db.query(`DELETE FROM commerce_parameter WHERE key = $1 AND id <> $2`, [key, p.id]);
    await db.query(`UPDATE commerce_parameter SET superseded_at = NULL WHERE id = $1`, [p.id]);
  }
  invalidateCommerceParameterCache();
  const reqIds = (await db.query(`SELECT id FROM fulfillment_request WHERE order_id = ANY($1)`, [ids.orders])).rows.map(r => r.id);
  await db.query(`DELETE FROM fulfillment_event WHERE fulfillment_request_id = ANY($1)`, [reqIds]);
  await db.query(`DELETE FROM roastery_shipment_details WHERE order_id = ANY($1)`, [ids.orders]);
  await db.query(`DELETE FROM fulfillment_request WHERE order_id = ANY($1)`, [ids.orders]);
  await db.query(`DELETE FROM order_event WHERE order_id = ANY($1)`, [ids.orders]);
  await db.query(`DELETE FROM order_line_item WHERE order_id = ANY($1)`, [ids.orders]);
  await db.query(`DELETE FROM "order" WHERE id = ANY($1)`, [ids.orders]);
  await db.query(`DELETE FROM fulfillment_shipstation_event WHERE id = ANY($1) OR payload->>'resource_url' LIKE $2`, [ids.ledger, `%${RUN}%`]);
  await db.query(`DELETE FROM roastery_fulfillment_config WHERE roaster_id = ANY($1)`, [ids.roasters]);
  await db.query(`DELETE FROM coffee_sku WHERE id = ANY($1)`, [ids.skus]);
  await db.query(`DELETE FROM roaster WHERE id = ANY($1)`, [ids.roasters]);
  await db.query(`DELETE FROM user_profile WHERE id = ANY($1)`, [ids.users]);
  await db.end();
});

beforeEach(() => { alerts.length = 0; manualEmails.length = 0; shippingEmails.length = 0; ss.fetched.length = 0; fs.resetShipStationTagCache(); });

describe('requests per roaster', () => {
  it('two roasters: two requests; the configured one goes to ShipStation, the other is manual with only its lines', async () => {
    const orderId = await makeOrder([{ sku: skuA, qty: 1, name: 'House A' }, { sku: skuB, qty: 2, name: 'House B' }]);
    const r = await dispatchFulfillment(orderId);
    expect(r.ok).toBe(true);
    const reqs = await requests(orderId);
    expect(reqs.map(q => [q.sequence, q.roaster_id, q.adapter_code, q.status])).toEqual([
      [1, roasterA, 'shipstation', 'placed'], [2, roasterB, 'manual', 'awaiting_manual'],
    ]);
    const sent = ss.created.find(o => o.orderKey === `ab:${orderId}:1`);
    expect(sent).toMatchObject({
      orderNumber: `${orderId.slice(0, 8).toUpperCase()}-1`, orderStatus: 'awaiting_shipment', tagIds: [5551], requestedShippingService: 'usps_ground_advantage',
      shipTo: { name: 'Zzz Six', street1: '1 Zzz St', city: 'Hoboken', state: 'NJ', postalCode: '07030', country: 'US' },
      weight: { value: 14, units: 'ounces' },
      advancedOptions: { warehouseId: 1272614, customField1: orderId, customField2: roasterA },
    });
    expect(sent.items).toEqual([expect.objectContaining({ sku: 'JB-001', name: 'House A', quantity: 1, unitPrice: 14.5 })]);
    expect(sent.internalNotes).toContain(coffeeName[skuA]);
    expect(sent.items.map((i: any) => i.name)).toEqual(['House A']); // the roaster coffee name never reaches an item (packing slip)
    expect(manualEmails).toEqual([{ orderId, part: expect.objectContaining({ sequence: 2, of: 2, lines: [expect.objectContaining({ displayName: 'House B' })] }) }]);
    // awaiting_manual (45) outranks placed (40): the part to place by hand is what the order shows.
    expect(await status(orderId)).toMatchObject({ fulfillment_status: 'awaiting_manual', fulfillment_requests: 2 });
  });

  it('is idempotent: dispatching again creates nothing and posts nothing; a retry finds the ShipStation order first', async () => {
    const orderId = await makeOrder([{ sku: skuA, qty: 1, name: 'House A' }]);
    await dispatchFulfillment(orderId);
    const posted = ss.created.length;
    await dispatchFulfillment(orderId);
    await fs.createRequestsForOrder(orderId);
    expect(await requests(orderId)).toHaveLength(1);
    expect(ss.created.length).toBe(posted);
    // A request that failed after ShipStation did create the order: GET before POST.
    const [req] = await requests(orderId);
    await db.query(`UPDATE fulfillment_request SET status = 'failed' WHERE id = $1`, [req.fulfillment_request_id]);
    const again = await fs.retry(req.fulfillment_request_id, 'admin');
    expect(again).toMatchObject({ ok: true, status: 'placed', note: 'found existing' });
    expect(ss.created.length).toBe(posted);
  });

  it('a failure counts attempts, stays failed, then needs attention after the parameter (3) and alerts once', async () => {
    const orderId = await makeOrder([{ sku: skuA, qty: 1, name: 'House A' }]);
    ss.createFails = 3;
    const first = await dispatchFulfillment(orderId);
    expect(first).toMatchObject({ ok: false });
    let [req] = await requests(orderId);
    expect(req).toMatchObject({ status: 'failed', attempts: 1 });
    await fs.retry(req.fulfillment_request_id);
    [req] = await requests(orderId);
    expect(req).toMatchObject({ status: 'failed', attempts: 2 });
    expect(alerts).toHaveLength(0);
    await fs.retry(req.fulfillment_request_id);
    [req] = await requests(orderId);
    expect(req).toMatchObject({ status: 'needs_attention', attempts: 3 });
    expect(req.last_error).toContain('boom');
    expect(alerts).toHaveLength(1);
    expect(await status(orderId)).toMatchObject({ fulfillment_status: 'needs_attention' });
    expect((await db.query(`SELECT payment_status FROM v_order_status WHERE order_id = $1`, [orderId])).rows[0].payment_status).toBe('paid');
  });

  it('a line with no roaster SKU goes straight to needs_attention with the reason', async () => {
    const orderId = await makeOrder([{ sku: skuNoCode, qty: 1, name: 'House A2' }]);
    await dispatchFulfillment(orderId);
    const [req] = await requests(orderId);
    expect(req).toMatchObject({ status: 'needs_attention', attempts: 1 });
    expect(req.last_error).toContain(`No roaster SKU for ${coffeeName[skuNoCode]}`);
    expect(alerts[0].subject).toContain('needs attention');
  });

  it('shipstation_enabled = 0: a configured roaster is manual', async () => {
    await setParam('shipstation_enabled', 0);
    try {
      const orderId = await makeOrder([{ sku: skuA, qty: 1, name: 'House A' }]);
      await dispatchFulfillment(orderId);
      expect((await requests(orderId)).map(r => r.adapter_code)).toEqual(['manual']);
      expect(await kinds((await requests(orderId))[0].fulfillment_request_id)).toEqual(['created', 'awaiting_manual']);
    } finally { await setParam('shipstation_enabled', 1); }
  });
});

describe('ShipStation webhook', () => {
  it('a bad token is a 404 and leaves no ledger row', async () => {
    const before = Number((await db.query(`SELECT count(*) FROM fulfillment_shipstation_event`)).rows[0].count);
    const r = await fetch(`${base}/wrong-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_url: 'https://ssapi.shipstation.com/shipments?x=1', resource_type: 'SHIP_NOTIFY' }) });
    expect(r.status).toBe(404);
    expect(Number((await db.query(`SELECT count(*) FROM fulfillment_shipstation_event`)).rows[0].count)).toBe(before);
  });

  it('a resource_url off the API host is refused before anything is fetched', async () => {
    const url = `https://evil.example.com/shipments?${RUN}`;
    const r = await fetch(`${base}/${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_url: url, resource_type: 'SHIP_NOTIFY' }) });
    expect(r.status).toBe(400);
    expect(ss.fetched).toEqual([]);
    const row = (await db.query(`SELECT error FROM fulfillment_shipstation_event WHERE resource_url = $1`, [url])).rows[0];
    expect(row.error).toMatch(/refused/);
  });

  it('an unknown order is recorded and changes nothing', async () => {
    const url = `https://ssapi.shipstation.com/shipments?batch=${RUN}-unknown`;
    ss.resources.set(url, { shipments: [{ shipmentId: 1, orderId: 1, orderKey: 'not-ours', orderNumber: 'X-1', trackingNumber: '9400', carrierCode: 'stamps_com', serviceCode: 'usps_ground_advantage', shipmentCost: 4.1, shipDate: '2026-11-19', createDate: '2026-11-19T10:00:00Z', voided: false }] });
    const r = await (await fetch(`${base}/${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_url: url, resource_type: 'SHIP_NOTIFY' }) })).json();
    expect(r).toMatchObject({ processed: true, matched: 0, shipped: 0 });
    const row = (await db.query(`SELECT processed_at, error, result FROM fulfillment_shipstation_event WHERE resource_url = $1`, [url])).rows[0];
    expect(row).toMatchObject({ error: null, result: expect.objectContaining({ unknown: 1 }) });
  });

  it('ship-notify: one shipment per tracking number with postage; the order is partially shipped, then shipped; the emails list each part', async () => {
    await fs.setRoasterConfig({ roasterId: roasterB, adapterCode: 'shipstation', shipstationTag: 'roaster:zzz-c6-a' }, 'vitest');
    try {
      const orderId = await makeOrder([{ sku: skuA, qty: 1, name: 'House A' }, { sku: skuB, qty: 1, name: 'House B' }]);
      await dispatchFulfillment(orderId);
      const [r1, r2] = await requests(orderId);
      expect([r1.status, r2.status]).toEqual(['placed', 'placed']);

      // Part 1: a FULFILLMENT_SHIPPED (3PL: no cost field), delivered twice.
      const url1 = `https://ssapi.shipstation.com/fulfillments?batch=${RUN}-1`;
      ss.resources.set(url1, { fulfillments: [{ fulfillmentId: 71, orderId: Number(r1.external_order_id), orderNumber: r1.external_order_number, trackingNumber: '9400111', carrierCode: 'stamps_com', fulfillmentServiceCode: null, shipDate: '2026-11-19', createDate: '2026-11-19T10:00:00Z', voided: false, sellerFillProviderName: 'Zzz 3PL' }] });
      for (let i = 0; i < 2; i++) {
        await fetch(`${base}/${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_url: url1, resource_type: 'FULFILLMENT_SHIPPED' }) });
      }
      const ships1 = (await db.query(`SELECT id, carrier, tracking_number, postage_cost, external_shipment_id, fulfillment_request_id FROM roastery_shipment_details WHERE order_id = $1`, [orderId])).rows;
      expect(ships1).toEqual([expect.objectContaining({ carrier: 'usps', tracking_number: '9400111', postage_cost: null, external_shipment_id: 'fulfillment:71', fulfillment_request_id: r1.fulfillment_request_id })]);
      expect(shippingEmails).toEqual([ships1[0].id]);
      expect(await status(orderId)).toMatchObject({ fulfillment_status: 'partially_shipped' });
      expect(await kinds(r1.fulfillment_request_id)).toEqual(expect.arrayContaining(['shipped', 'provider_assigned']));

      // The shipping email for part 1 lists only part 1's lines (decision 4).
      const view = await forShipment((await getOrderSummary(orderId))!, ships1[0].id);
      expect(view.lines.map(l => l.displayName)).toEqual(['House A']);
      expect(view.shipment).toMatchObject({ trackingNumber: '9400111', carrierLabel: 'USPS' });

      // Part 2: a SHIP_NOTIFY with the label's cost, an unknown carrier code.
      const url2 = `https://ssapi.shipstation.com/shipments?batch=${RUN}-2`;
      ss.resources.set(url2, { shipments: [{ shipmentId: 81, orderId: Number(r2.external_order_id), orderKey: r2.external_order_key, orderNumber: r2.external_order_number, trackingNumber: 'ZZ999', carrierCode: 'mystery_post', serviceCode: 'mp_ground', shipmentCost: 5.42, shipDate: '2026-11-20', createDate: '2026-11-20T09:00:00Z', voided: false }] });
      await fetch(`${base}/${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_url: url2, resource_type: 'SHIP_NOTIFY' }) });
      const ship2 = (await db.query(`SELECT carrier, postage_cost, service_code FROM roastery_shipment_details WHERE order_id = $1 AND tracking_number = 'ZZ999'`, [orderId])).rows[0];
      expect(ship2).toMatchObject({ carrier: 'other', postage_cost: '5.42', service_code: 'mp_ground' });
      const notes = (await db.query(`SELECT note FROM fulfillment_event WHERE fulfillment_request_id = $1 AND event_kind = 'needs_attention'`, [r2.fulfillment_request_id])).rows;
      expect(notes[0].note).toMatch(/unknown ShipStation carrier code "mystery_post"/);
      expect(await status(orderId)).toMatchObject({ fulfillment_status: 'shipped' });

      // The daily reconcile fills part 1's postage once the label's shipment shows up.
      ss.shipments.set(r1.external_order_number, [{ shipmentId: 91, orderId: Number(r1.external_order_id), orderKey: r1.external_order_key, orderNumber: r1.external_order_number, trackingNumber: '9400111', carrierCode: 'stamps_com', serviceCode: 'usps_ground_advantage', shipmentCost: 4.65, shipDate: '2026-11-19', createDate: '2026-11-19T10:00:00Z', voided: false }]);
      const daily = await fs.runShipStationDaily();
      expect(daily.enabled).toBe(true);
      expect((await db.query(`SELECT postage_cost FROM roastery_shipment_details WHERE id = $1`, [ships1[0].id])).rows[0].postage_cost).toBe('4.65');
      expect(shippingEmails).toHaveLength(2); // no repeat email
    } finally {
      await fs.setRoasterConfig({ roasterId: roasterB, adapterCode: 'manual' }, 'vitest');
    }
  }, 30_000);

  it('FULFILLMENT_REJECTED puts the request in needs_attention and alerts', async () => {
    const orderId = await makeOrder([{ sku: skuA, qty: 1, name: 'House A' }]);
    await dispatchFulfillment(orderId);
    const [r1] = await requests(orderId);
    const url = `https://ssapi.shipstation.com/fulfillments?batch=${RUN}-rej`;
    ss.resources.set(url, { fulfillments: [{ fulfillmentId: 72, orderId: Number(r1.external_order_id), orderNumber: r1.external_order_number, trackingNumber: null, carrierCode: null, shipDate: null, createDate: '2026-11-19T10:00:00Z', voided: false }] });
    await fetch(`${base}/${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_url: url, resource_type: 'FULFILLMENT_REJECTED' }) });
    expect((await requests(orderId))[0]).toMatchObject({ status: 'needs_attention', last_event_kind: 'rejected' });
    expect(alerts.map(a => a.subject)).toEqual([expect.stringContaining('Fulfillment rejected')]);
  });
});

describe('mark shipped and refunds', () => {
  it('an admin mark-shipped on a split order must name the part', async () => {
    await fs.setRoasterConfig({ roasterId: roasterB, adapterCode: 'manual' }, 'vitest');
    const orderId = await makeOrder([{ sku: skuA, qty: 1, name: 'House A' }, { sku: skuB, qty: 1, name: 'House B' }]);
    await dispatchFulfillment(orderId);
    await expect(markShipped(orderId, { carrier: 'usps', trackingNumber: 'ADM1' })).rejects.toMatchObject({ code: 'choose_request' });
    const [, r2] = await requests(orderId);
    const r = await markShipped(orderId, { carrier: 'usps', trackingNumber: 'ADM1', fulfillmentRequestId: r2.fulfillment_request_id });
    expect(r.created).toBe(true);
    expect((await requests(orderId))[1].status).toBe('shipped');
    expect(await status(orderId)).toMatchObject({ fulfillment_status: 'partially_shipped' });
  });

  it('a full refund deletes the unshipped ShipStation order and cancels the manual part', async () => {
    const pi = `pi_${RUN}_refund`;
    const orderId = await makeOrder([{ sku: skuA, qty: 1, name: 'House A' }, { sku: skuB, qty: 1, name: 'House B' }], { pi });
    await dispatchFulfillment(orderId);
    const [r1] = await requests(orderId);
    const r = await recordRefund({ id: `ch_${RUN}`, payment_intent: pi, amount: 3000, amount_refunded: 3000 } as any);
    expect(r).toMatchObject({ orderId, canceledFulfillment: true, fulfillmentWarnings: [] });
    expect(ss.deleted).toContain(r1.external_order_id);
    expect((await requests(orderId)).map(q => q.status)).toEqual(['canceled', 'canceled']);
    expect(await status(orderId)).toMatchObject({ fulfillment_status: 'canceled' });
  });

  it('a refused delete leaves the request open, records cancel_refused and emails the admin to contact the roaster', async () => {
    const pi = `pi_${RUN}_refused`;
    const orderId = await makeOrder([{ sku: skuA, qty: 1, name: 'House A' }], { pi });
    await dispatchFulfillment(orderId);
    ss.refuseDelete = true;
    try {
      const r = await recordRefund({ id: `ch_${RUN}_2`, payment_intent: pi, amount: 3000, amount_refunded: 3000 } as any);
      expect(r.fulfillmentWarnings?.[0]).toMatch(/Contact the roaster/);
      const [req] = await requests(orderId);
      expect(req.status).toBe('placed');
      expect(await kinds(req.fulfillment_request_id)).toContain('cancel_refused');
      expect(alerts.map(a => a.subject)).toEqual([expect.stringContaining('still with the roaster')]);
    } finally { ss.refuseDelete = false; }
  });
});

describe('lookups', () => {
  it('seeds the carrier mapping from the account and the refund rule as columns', async () => {
    const map = (await db.query(`SELECT external_code, carrier_code FROM shipping_carrier_external_code WHERE external_system = 'shipstation' ORDER BY external_code`)).rows;
    expect(map).toEqual(expect.arrayContaining([
      { external_code: 'stamps_com', carrier_code: 'usps' }, { external_code: 'ups_walleted', carrier_code: 'ups' },
      { external_code: 'fedex_walleted', carrier_code: 'fedex' }, { external_code: 'dhl_express_worldwide', carrier_code: 'dhl' },
    ]));
    const cancels = (await db.query(`SELECT code FROM order_fulfillment_status WHERE cancels_on_full_refund ORDER BY code`)).rows.map(r => r.code);
    expect(cancels).toEqual(['awaiting_manual', 'needs_attention']);
    const reqCancels = (await db.query(`SELECT code FROM fulfillment_request_status WHERE cancels_on_full_refund ORDER BY code`)).rows.map(r => r.code);
    expect(reqCancels).toEqual(['awaiting_manual', 'failed', 'needs_attention', 'pending', 'placed']);
  });
});
