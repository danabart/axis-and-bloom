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
  slots: Slot[];
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

export type CartItem = DialCartItem | DirectCartItem;

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
