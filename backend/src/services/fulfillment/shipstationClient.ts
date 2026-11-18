// Commerce 6 (2026-11-18), Part B — the ShipStation V1 API client
// (CLOSING_REPORT_6 Task 0.1: the account exposes V1, ssapi.shipstation.com,
// key + secret basic auth, 40 requests a minute). The host is the parameter
// shipstation_api_host (G2.1); the key and secret come from Secret Manager
// (SHIPSTATION_API_KEY / SHIPSTATION_API_SECRET). On a 429 the call waits for
// X-Rate-Limit-Reset seconds and tries again, a bounded number of times.
// Only the calls the brief uses are here.
import { commerceParamText } from '../commerceParameters.js';
import { log } from '../../lib/logger.js';

export class ShipStationError extends Error {
  constructor(public status: number, message: string, public body: unknown = null) { super(message); this.name = 'ShipStationError'; }
}

export interface ShipStationAddress {
  name: string; company?: string | null; street1: string; street2?: string | null; street3?: string | null;
  city: string; state: string; postalCode: string; country: string; phone?: string | null; residential?: boolean | null;
}
export interface ShipStationOrderItem { lineItemKey: string; sku: string; name: string; quantity: number; unitPrice: number; weight: { value: number; units: 'ounces' } }
export interface ShipStationOrderInput {
  orderNumber: string; orderKey: string; orderDate: string; orderStatus: 'awaiting_shipment';
  billTo: ShipStationAddress; shipTo: ShipStationAddress; items: ShipStationOrderItem[];
  amountPaid?: number; shippingAmount?: number; weight: { value: number; units: 'ounces' };
  internalNotes: string; requestedShippingService: string | null; tagIds: number[];
  advancedOptions: { warehouseId?: number | null; customField1: string; customField2: string; customField3?: string | null };
}
export interface ShipStationOrder { orderId: number; orderNumber: string; orderKey: string; orderStatus: string; tagIds?: number[] | null;
  externallyFulfilled?: boolean; externallyFulfilledBy?: string | null; advancedOptions?: { customField1?: string | null; customField2?: string | null } }
export interface ShipStationShipment { shipmentId: number; orderId: number; orderKey: string; orderNumber: string; trackingNumber: string | null;
  carrierCode: string | null; serviceCode: string | null; shipmentCost: number | null; insuranceCost?: number | null; shipDate: string | null;
  createDate: string | null; voided: boolean }
export interface ShipStationFulfillment { fulfillmentId: number; orderId: number; orderNumber: string; trackingNumber: string | null;
  carrierCode: string | null; fulfillmentProviderCode?: string | null; fulfillmentServiceCode?: string | null; fulfillmentFee?: number | null;
  shipDate: string | null; createDate: string | null; voided: boolean; sellerFillProviderId?: number | null; sellerFillProviderName?: string | null }
export interface ShipStationWebhook { WebHookID: number; HookType: string; Url: string; Name?: string | null; Active?: boolean; StoreID?: number | null }

const MAX_429_RETRIES = 3;

function credentials(): string {
  const key = process.env.SHIPSTATION_API_KEY, secret = process.env.SHIPSTATION_API_SECRET;
  if (!key || !secret) throw new ShipStationError(0, 'SHIPSTATION_API_KEY / SHIPSTATION_API_SECRET are not set');
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
}

export async function apiHost(): Promise<string> {
  return (await commerceParamText('shipstation_api_host')).trim().toLowerCase();
}

/** True when url is https on the configured API host (decision 5: checked before any webhook resource is fetched). */
export async function isApiUrl(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.toLowerCase() === await apiHost() && !u.username && !u.password && (u.port === '' || u.port === '443');
  } catch { return false; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** One API call. path starts with '/', or is a full URL on the API host (a webhook resource_url). */
export async function call<T>(method: 'GET' | 'POST' | 'DELETE', pathOrUrl: string, body?: unknown): Promise<T> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `https://${await apiHost()}${pathOrUrl}`;
  if (!(await isApiUrl(url))) throw new ShipStationError(0, `refusing a ShipStation call off the API host: ${url}`);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: credentials(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      const reset = Number(res.headers.get('x-rate-limit-reset') ?? '10');
      log.warn('shipstation', 'rate limited; waiting', { method, path: new URL(url).pathname, resetSeconds: reset, attempt: attempt + 1 });
      await sleep((Number.isFinite(reset) && reset > 0 ? Math.min(reset, 60) : 10) * 1000 + 250);
      continue;
    }
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* a plain-text error body */ }
    if (!res.ok) {
      const message = typeof parsed === 'object' && parsed && 'Message' in parsed ? String((parsed as { Message: unknown }).Message)
        : typeof parsed === 'object' && parsed && 'ExceptionMessage' in parsed ? String((parsed as { ExceptionMessage: unknown }).ExceptionMessage)
        : String(text).slice(0, 300);
      throw new ShipStationError(res.status, `ShipStation ${method} ${new URL(url).pathname} ${res.status}: ${message}`, parsed);
    }
    return parsed as T;
  }
}

// ── the calls the brief uses (CLOSING_REPORT_6 Task 0.1) ─────────────────────

/** Create or update (upsert on orderKey) an order: POST /orders/createorder. */
export const createOrUpdateOrder = (order: ShipStationOrderInput) => call<ShipStationOrder>('POST', '/orders/createorder', order);

/** Orders with this orderNumber (GET-before-POST on a retry). */
export async function findOrdersByNumber(orderNumber: string): Promise<ShipStationOrder[]> {
  const r = await call<{ orders: ShipStationOrder[] }>('GET', `/orders?orderNumber=${encodeURIComponent(orderNumber)}&pageSize=100`);
  return (r.orders ?? []).filter(o => o.orderNumber === orderNumber);
}

export const deleteOrder = (orderId: string | number) => call<{ success: boolean; message: string }>('DELETE', `/orders/${encodeURIComponent(String(orderId))}`);

export async function listTags(): Promise<Array<{ tagId: number; name: string }>> {
  return (await call<Array<{ tagId: number; name: string }>>('GET', '/accounts/listtags')) ?? [];
}

export async function shipmentsForOrder(orderNumber: string): Promise<ShipStationShipment[]> {
  const r = await call<{ shipments: ShipStationShipment[] }>('GET', `/shipments?orderNumber=${encodeURIComponent(orderNumber)}&pageSize=100`);
  return r.shipments ?? [];
}

export async function fulfillmentsForOrder(orderNumber: string): Promise<ShipStationFulfillment[]> {
  const r = await call<{ fulfillments: ShipStationFulfillment[] }>('GET', `/fulfillments?orderNumber=${encodeURIComponent(orderNumber)}&pageSize=100`);
  return r.fulfillments ?? [];
}

export async function listWebhooks(): Promise<ShipStationWebhook[]> {
  return (await call<{ webhooks: ShipStationWebhook[] }>('GET', '/webhooks')).webhooks ?? [];
}

export const subscribeWebhook = (input: { target_url: string; event: string; friendly_name: string }) =>
  call<{ id: number }>('POST', '/webhooks/subscribe', input);

/** A webhook's resource_url (List Shipments / List Fulfillments shape). The host is checked first. */
export async function fetchResource(resourceUrl: string): Promise<{ shipments?: ShipStationShipment[]; fulfillments?: ShipStationFulfillment[]; orders?: ShipStationOrder[] }> {
  if (!(await isApiUrl(resourceUrl))) throw new ShipStationError(0, 'resource_url is not on the ShipStation API host');
  return call('GET', resourceUrl);
}
