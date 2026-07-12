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

export interface CartItem {
  archetype: string;
  archetypeLabel: string;
  dialSortOrder: number;
  weightOz: number;
  platformName: string;
  retailPriceCents: number;
  qty: number;
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
