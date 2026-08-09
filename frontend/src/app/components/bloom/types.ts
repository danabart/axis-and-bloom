export interface SlotPrice {
  weightOz: number;
  retailPriceCents: number;
}

export interface Slot {
  dialSortOrder: number;
  positionLabel: string;
  description: string | null;
  isActive: boolean;
  platformName: string | null;
  /** Flavor Intelligence Part 1 Decision #8 — matches whichever coffee is currently resolved for this slot. */
  isDefault: boolean;
  prices: SlotPrice[];
  coffeeId: number | null;
}

export interface ArchetypeData {
  archetype: string;
  archetypeLabel: string;
  dimensionName: string | null;
  dimensionPlatformName: string | null;
  /** Part 14 — the dial dimension's scale end labels (coffee_dimensions.scale_min_label/
   * scale_max_label, the same values Admin's dimension data reads), for the Bloom Dial
   * ruler ends. Null when the archetype has no dial dimension configured — BloomDial
   * falls back to Delicate/Pronounced in that case. */
  dimensionScaleMinLabel: string | null;
  dimensionScaleMaxLabel: string | null;
  slots: Slot[];
  /** Part 19 §A — the edge-door targets, resolved server-side (never hardcoded
   * per archetype here) — see computeDoorMap in coffees.ts. Null only if the
   * door map somehow failed to resolve; the fallback rule always produces
   * something in practice. */
  doors: { left: DoorTarget; right: DoorTarget } | null;
  /** Part 19 §C — backend-computed preview of "the collection" (see
   * computeCollectionOfferFromSlots in coffees.ts); null when fewer than 3
   * positions are currently purchasable — also the collection CTA's hide
   * condition. The frontend never computes the discount itself, only displays
   * this. */
  collectionOffer: { memberCount: number; sumCents: number; discountedCents: number } | null;
}

/** Part 19 §A — one edge door's resolved target. `rule` says which rule
 * produced it: 'graph' (a same-dimension bridge hop) or 'fallback' (the
 * site's canonical archetype order). */
export interface DoorTarget {
  archetype: string;
  archetypeLabel: string;
  rule: 'graph' | 'fallback';
}

export interface HopTarget {
  archetype: string;
  archetypeLabel: string;
  dialSortOrder: number;
  positionLabel: string;
  platformName: string | null;
}

export interface Hop {
  dimensionName: string;
  direction: 'more' | 'less';
  hopType: 'within_archetype' | 'bridge_archetype';
  confidence: 'low' | 'medium' | 'high';
  target: HopTarget;
}

export interface DialCartItem {
  kind: 'dial';
  archetype: string;
  archetypeLabel: string;
  dialSortOrder: number;
  weightOz: number;
  platformName: string;
  retailPriceCents: number;
  qty: number;
}

/** A category coffee (Decaf/Half-Caf/Flavored/Experimental) with no dial position —
 * Bloom Dial Base Data Part 3, Phase 6. Priced/resolved by coffeeId, not archetype+slot. */
export interface DirectCartItem {
  kind: 'direct';
  coffeeId: number;
  categoryLabel: string;
  matchedArchetypeLabel: string | null;
  weightOz: number;
  platformName: string;
  retailPriceCents: number;
  qty: number;
}

/** Part 19 §C — "the collection": all purchasable positions of one archetype,
 * one cart line, one price, added/removed/qty-adjusted as a whole (never as
 * individual coffees — that's exactly the "discount leak" the spec calls out).
 * `retailPriceCents` is the DISCOUNTED total (so FloatingCart's existing
 * `retailPriceCents * qty` subtotal math needs no special-casing);
 * `undiscountedPriceCents` is carried only for the optional strikethrough
 * display. The backend independently re-resolves the actual member coffees
 * and re-verifies this price at order time — nothing about *which* coffees
 * are in the set is ever sent from here. */
export interface CollectionCartItem {
  kind: 'collection';
  archetype: string;
  archetypeLabel: string;
  memberCount: number;
  retailPriceCents: number;
  undiscountedPriceCents: number;
  qty: number;
}

export type CartItem = DialCartItem | DirectCartItem | CollectionCartItem;

export interface OtherCategoryPrice {
  weightOz: number;
  retailPriceCents: number;
  isActive: boolean;
}

export interface OtherCategoryCoffee {
  coffeeId: number;
  displayName: string;
  archetype: string | null;
  archetypeLabel: string | null;
  categories: { code: string; label: string; sortOrder: number }[];
  prices: OtherCategoryPrice[];
  effectivelyActive: boolean;
  /** No dial_slot_price/coffee_retail_price row for any weight — distinct from
   * "no coffee resolved"; renders as "Unpriced" rather than "Temporarily unavailable"
   * (Pricing update, 2026-07-24 — no hardcoded fallback price). */
  isUnpriced: boolean;
}

/** Stable key for a slot, used for refs, revealed-state, and cart line matching. */
export function slotKey(archetype: string, dialSortOrder: number): string {
  return `${archetype}_${dialSortOrder}`;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatWeight(weightOz: number): string {
  return weightOz === 12 ? '12oz' : weightOz >= 16 ? `${weightOz / 16}lb` : `${weightOz}oz`;
}
