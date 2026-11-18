// Commerce 6 (2026-11-18), Part B — the ShipStation adapter's order shape.
// One fulfillment_request (one roaster's lines of a paid order) becomes one
// ShipStation order in our account (decision 2): item name = the house name
// (the packing slip is customer-facing), SKU = the roaster's code
// (coffee_sku.roaster_sku), the roaster coffee and roaster in the internal
// notes only, tagged with the roaster's tag so the automation rule hands it to
// the roaster as 3PL provider. Pure: fulfillmentService.place gathers the
// inputs and makes the call. A problem a retry cannot fix (no SKU, no tag, no
// address) is a NeedsAttentionError: the request goes straight to
// needs_attention with the reason.
import type { OrderSummary } from '../checkoutService.js';
import type { ShipStationAddress, ShipStationOrderInput } from './shipstationClient.js';

export class NeedsAttentionError extends Error {
  constructor(message: string) { super(message); this.name = 'NeedsAttentionError'; }
}

export interface ShipStationLine {
  blendId: string; displayName: string | null; quantity: number; unitPriceCents: number; weightOz: number | null;
  roasterSku: string | null; coffeeName: string | null;
}

export interface BuildInput {
  order: OrderSummary;
  request: { id: string; sequence: number; externalOrderKey: string; roasterId: string | null };
  roasterName: string | null;
  lines: ShipStationLine[];
  tagId: number;
  requestedService: string | null;
  packagingWeightOz: number;
  warehouseId: number | null;
}

/** <first 8 of the order id>-<n>: under ShipStation's 50-character orderNumber limit. */
export function shipStationOrderNumber(orderId: string, sequence: number): string {
  return `${orderId.slice(0, 8).toUpperCase()}-${sequence}`;
}

/** Our idempotency key (approved: ab:<order uuid>:<n>). ShipStation upserts on it. */
export function shipStationOrderKey(orderId: string, sequence: number): string {
  return `ab:${orderId}:${sequence}`;
}

function shipTo(o: OrderSummary): ShipStationAddress {
  const name = [o.firstName, o.lastName].filter(Boolean).join(' ').trim();
  const s = o.shipsTo;
  const missing = [!name && 'recipient name', !s.street && 'street', !s.city && 'city', !s.state && 'state', !s.postalCode && 'postal code']
    .filter(Boolean);
  if (missing.length) throw new NeedsAttentionError(`The order has no ${missing.join(', ')} to ship to.`);
  return {
    name, street1: s.street!, street2: null, city: s.city!, state: s.state!, postalCode: s.postalCode!,
    country: (s.country ?? 'US').trim() || 'US', phone: null, residential: true,
  };
}

export function buildShipStationOrder(p: BuildInput): ShipStationOrderInput {
  if (!p.lines.length) throw new NeedsAttentionError('This request has no lines.');
  const noSku = p.lines.filter(l => !l.roasterSku?.trim());
  if (noSku.length) {
    throw new NeedsAttentionError(`No roaster SKU for ${noSku.map(l => l.coffeeName ?? l.displayName ?? l.blendId).join(', ')}: enter the roaster's code in the admin catalog form, then retry.`);
  }
  const noWeight = p.lines.filter(l => l.weightOz == null);
  if (noWeight.length) throw new NeedsAttentionError(`No bag weight for ${noWeight.map(l => l.displayName ?? l.blendId).join(', ')}.`);
  const address = shipTo(p.order);
  const coffeeOz = p.lines.reduce((n, l) => n + Number(l.weightOz) * l.quantity, 0);
  const orderDate = p.order.paidAt ?? p.order.createdAt;
  const notes = [
    `Axis & Bloom order ${p.order.orderId} (request ${p.request.sequence}, ${p.request.id})`,
    `Roaster: ${p.roasterName ?? '(none)'}`,
    ...p.lines.map(l => `${l.quantity} x ${l.displayName ?? 'Coffee'} = ${l.coffeeName ?? '?'} (SKU ${l.roasterSku})`),
  ].join('\n');
  return {
    orderNumber: shipStationOrderNumber(p.order.orderId, p.request.sequence),
    orderKey: p.request.externalOrderKey,
    orderDate: new Date(orderDate).toISOString(),
    orderStatus: 'awaiting_shipment',
    billTo: address,
    shipTo: address,
    items: p.lines.map((l, i) => ({
      lineItemKey: `${p.request.externalOrderKey}:${i + 1}`,
      sku: l.roasterSku!.trim(),
      name: l.displayName ?? 'Axis & Bloom coffee',
      quantity: l.quantity,
      unitPrice: l.unitPriceCents / 100,
      weight: { value: Number(l.weightOz), units: 'ounces' as const },
    })),
    weight: { value: coffeeOz + p.packagingWeightOz, units: 'ounces' },
    internalNotes: notes,
    requestedShippingService: p.requestedService,
    tagIds: [p.tagId],
    advancedOptions: {
      warehouseId: p.warehouseId,
      customField1: p.order.orderId,
      customField2: p.request.roasterId ?? '',
      customField3: p.request.id,
    },
  };
}
