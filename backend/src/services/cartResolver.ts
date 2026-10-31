// Commerce 1, B3 (2026-10-31) — the cart-resolution block of routes/orders.ts
// POST, extracted. Each client cart item resolves to a concrete SKU before
// anything is charged: a Bloom Dial slot { archetype, dialSortOrder, weightOz }
// through the same priority order the Coffees page sets (blendResolver,
// preferred roaster first, automatic fallback); a direct category coffee
// { coffeeId, weightOz }; a whole-archetype collection { collection: true,
// archetype } re-derived fresh by computeCollectionOffer; or a legacy
// { blendId } SKU id.
//
// Price is enforced server side for EVERY kind (before this brief only the
// collection was checked; dial and direct lines took the client's priceCents):
// the server price wins, and a client price that differs, or is missing, is a
// 409 with the collection's existing "has changed ... Refresh your cart"
// wording. A mismatch means the cart is stale (prices changed since it was
// added) or was tampered with; either way the customer should see a clear
// error and re-add, never be silently charged a different amount than the
// screen showed.
//
// Each line carries the house name (the slot name, or a category coffee's
// display name exactly as GET /api/coffees/other-categories shows it), never
// the roaster or the roaster's coffee name.
import { db } from '../db/client.js';
import { resolveBlendForSlot, resolveCoffeeBlend, computeCollectionOffer } from './blendResolver.js';
import { archetypeLabel, getCoffeeRetailPrices, getCoffees, getHomeSlot } from './catalogReads.js';
import { commerceParam } from './commerceParameters.js';

export class CartError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'CartError';
  }
}

export interface CartItemInput {
  archetype?: string;
  dialSortOrder?: number;
  weightOz?: number;
  coffeeId?: number;
  collection?: boolean;
  blendId?: string;
  id?: string;
  quantity?: number;
  priceCents?: number;
}

export interface ResolvedLine {
  coffeeSkuId: string;
  coffeeId: number | null;
  displayName: string;
  /** "Floral", the archetype (or a category coffee's match archetype) label; null when none. */
  archetypeLabel: string | null;
  weightOz: number;
  quantity: number;
  /** Charged per bag, cents, after discountCents. */
  unitPriceCents: number;
  discountCents: number;
  source: 'dial' | 'direct' | 'collection';
  archetype: string | null;
  dialSortOrder: number | null;
}

export interface ResolvedCart {
  lines: ResolvedLine[];
  subtotalCents: number;
  bagCount: number;
  shippingCents: number;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function priceChanged(what: string, expected: number, got: unknown): CartError {
  return new CartError(409, 'price_changed',
    `${what}'s price has changed — expected ${dollars(expected)}, got ${typeof got === 'number' ? dollars(got) : 'nothing'}. Refresh your cart and try again.`);
}

function quantityOf(item: CartItemInput): number {
  const q = item.quantity ?? 1;
  if (!Number.isInteger(q) || q < 1) throw new CartError(400, 'invalid_quantity', 'quantity must be a whole number of at least 1');
  return q;
}

/** A category coffee's house name and match archetype (exported for subscription renewals, Commerce 2). */
export async function directDisplay(coffeeId: number): Promise<{ displayName: string; archetype: string | null }> {
  const [coffee] = await getCoffees({ ids: [coffeeId] });
  const home = await getHomeSlot(coffeeId);
  return { displayName: home?.slot_name ?? coffee?.name ?? 'Coffee', archetype: coffee?.match_archetype ?? null };
}

/** A category coffee's pricing-table price at a weight, or null (exported for subscription renewals, Commerce 2). */
export async function retailPriceCents(coffeeId: number, weightOz: number): Promise<number | null> {
  const rows = await getCoffeeRetailPrices();
  return rows.find(r => r.coffee_id === coffeeId && Number(r.weight_oz) === Number(weightOz))?.retail_price_cents ?? null;
}

/** Shipping for a bag count, from commerce_parameter: free at free_shipping_min_bags, else shipping_fee_cents. */
export async function shippingFor(bagCount: number): Promise<number> {
  return bagCount >= await commerceParam('free_shipping_min_bags') ? 0 : await commerceParam('shipping_fee_cents');
}

export async function resolveCart(items: CartItemInput[]): Promise<ResolvedCart> {
  if (!Array.isArray(items) || !items.length) throw new CartError(400, 'empty_cart', 'items required');
  const lines: ResolvedLine[] = [];

  for (const item of items) {
    const quantity = quantityOf(item);

    if (item.archetype && item.dialSortOrder !== undefined && item.weightOz && !item.collection) {
      const resolved = await resolveBlendForSlot(item.archetype, item.dialSortOrder, item.weightOz);
      if (!resolved) {
        throw new CartError(409, 'unavailable', `No roaster currently available for ${item.archetype} position ${item.dialSortOrder} at ${item.weightOz}oz`);
      }
      const displayName = resolved.slot_name ?? 'Coffee';
      if (item.priceCents !== resolved.retail_price_cents) throw priceChanged(displayName, resolved.retail_price_cents, item.priceCents);
      lines.push({
        coffeeSkuId: resolved.blend_id, coffeeId: resolved.coffee_id, displayName,
        archetypeLabel: await archetypeLabel(item.archetype), weightOz: Number(item.weightOz), quantity,
        unitPriceCents: resolved.retail_price_cents, discountCents: 0,
        source: 'dial', archetype: item.archetype, dialSortOrder: item.dialSortOrder,
      });
    } else if (item.coffeeId && item.weightOz) {
      const blend = await resolveCoffeeBlend(item.coffeeId, item.weightOz);
      const cents = blend ? await retailPriceCents(item.coffeeId, item.weightOz) : null;
      if (!blend || cents === null) throw new CartError(409, 'unavailable', `This coffee is not currently available at ${item.weightOz}oz`);
      const { displayName, archetype } = await directDisplay(item.coffeeId);
      if (item.priceCents !== cents) throw priceChanged(displayName, cents, item.priceCents);
      lines.push({
        coffeeSkuId: blend.blend_id, coffeeId: item.coffeeId, displayName,
        archetypeLabel: archetype ? await archetypeLabel(archetype) : null, weightOz: Number(item.weightOz), quantity,
        unitPriceCents: cents, discountCents: 0,
        source: 'direct', archetype: null, dialSortOrder: null,
      });
    } else if (item.collection === true && item.archetype) {
      // Part 19 §C — the client never gets to say which coffees are in the set
      // or what it costs: both are re-derived here, fresh, by the same
      // computeCollectionOffer GET /archetypes uses for the preview.
      const offer = await computeCollectionOffer(item.archetype);
      if (!offer) {
        throw new CartError(409, 'unavailable', `${item.archetype} doesn't currently have enough purchasable positions for the Collection offer.`);
      }
      if (item.priceCents !== offer.discountedCents) throw priceChanged(`The ${item.archetype} Collection`, offer.discountedCents, item.priceCents);
      // One line per member coffee, each proportionally discounted so the sum of
      // the members' charged prices equals the verified discounted total exactly;
      // the rounding remainder goes to the last member, never off by a cent.
      const label = await archetypeLabel(item.archetype);
      let runningCharged = 0;
      offer.members.forEach((member, idx) => {
        const isLast = idx === offer.members.length - 1;
        const charged = isLast
          ? offer.discountedCents - runningCharged
          : Math.round(member.priceCents * (offer.discountedCents / offer.sumCents));
        if (!isLast) runningCharged += charged;
        lines.push({
          coffeeSkuId: member.blendId, coffeeId: member.coffeeId, displayName: member.slotName ?? 'Coffee',
          archetypeLabel: label, weightOz: member.weightOz, quantity,
          unitPriceCents: charged, discountCents: member.priceCents - charged,
          source: 'collection', archetype: item.archetype!, dialSortOrder: member.dialSortOrder,
        });
      });
    } else if (item.blendId ?? item.id) {
      // Legacy: a raw coffee_sku id (no frontend sends this today; kept so the
      // contract orders.ts accepted does not silently change). Priced like a
      // direct coffee at the SKU's weight.
      const sku = await db.query<{ id: string; coffee_id: number; weight_oz: string }>(
        `SELECT s.id, s.coffee_id, s.weight_oz FROM coffee_sku s JOIN coffees c ON c.id = s.coffee_id
         WHERE s.id = $1 AND s.is_active = true AND c.is_active = true`, [item.blendId ?? item.id]
      );
      const row = sku.rows[0];
      const cents = row ? await retailPriceCents(row.coffee_id, Number(row.weight_oz)) : null;
      if (!row || cents === null) throw new CartError(409, 'unavailable', 'This coffee is not currently available');
      const { displayName, archetype } = await directDisplay(row.coffee_id);
      if (item.priceCents !== cents) throw priceChanged(displayName, cents, item.priceCents);
      lines.push({
        coffeeSkuId: row.id, coffeeId: row.coffee_id, displayName,
        archetypeLabel: archetype ? await archetypeLabel(archetype) : null, weightOz: Number(row.weight_oz), quantity,
        unitPriceCents: cents, discountCents: 0,
        source: 'direct', archetype: null, dialSortOrder: null,
      });
    } else {
      throw new CartError(400, 'invalid_item', 'Each item needs a dial position, a coffee, a collection or a SKU');
    }
  }

  const subtotalCents = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  // One bag per unit of every line, whatever its weight; a collection counts each member.
  const bagCount = lines.reduce((s, l) => s + l.quantity, 0);
  return { lines, subtotalCents, bagCount, shippingCents: await shippingFor(bagCount) };
}
