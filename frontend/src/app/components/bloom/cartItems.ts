import { setDialPosition } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import type { CartItem, Slot, SlotPrice } from './types';

// Website 4 (2026-11-05) — the cart items every coffee card adds, built once
// (G4.1, G3.9): the dial card (DialArchetypeSection), Home's featured coffee
// and Shop all's ShopCoffeeCard all call these instead of building the shape
// inline. The prices come from the payload; nothing here computes one.

/** One bag of a dial slot's coffee at the chosen weight. */
export function dialCartItem(
  family: { archetype: string; archetypeLabel: string },
  slot: Pick<Slot, 'dialSortOrder' | 'platformName'>,
  price: Pick<SlotPrice, 'weightOz' | 'retailPriceCents'>,
): CartItem | null {
  if (!slot.platformName) return null;
  return {
    kind: 'dial',
    archetype: family.archetype,
    archetypeLabel: family.archetypeLabel,
    dialSortOrder: slot.dialSortOrder,
    weightOz: price.weightOz,
    platformName: slot.platformName,
    retailPriceCents: price.retailPriceCents,
    qty: 1,
  };
}

/** "The collection": the family's purchasable positions as one line, at the backend's offer. */
export function collectionCartItem(family: {
  archetype: string; archetypeLabel: string;
  collectionOffer: { memberCount: number; sumCents: number; discountedCents: number } | null;
}): CartItem | null {
  if (!family.collectionOffer) return null;
  return {
    kind: 'collection',
    archetype: family.archetype,
    archetypeLabel: family.archetypeLabel,
    memberCount: family.collectionOffer.memberCount,
    retailPriceCents: family.collectionOffer.discountedCents,
    undiscountedPriceCents: family.collectionOffer.sumCents,
    qty: 1,
  };
}

/** A category coffee (no dial slot), priced and resolved by coffee id. */
export function directCartItem(
  coffee: { coffeeId: number; platformName: string; archetypeLabel: string | null },
  categoryLabel: string,
  price: Pick<SlotPrice, 'weightOz' | 'retailPriceCents'>,
): CartItem {
  return {
    kind: 'direct',
    coffeeId: coffee.coffeeId,
    categoryLabel,
    matchedArchetypeLabel: coffee.archetypeLabel,
    weightOz: price.weightOz,
    platformName: coffee.platformName,
    retailPriceCents: price.retailPriceCents,
    qty: 1,
  };
}

/** The dial-event sync after an add-to-cart: moves the customer's dial and records the fact. Any `user` (guests too). */
export function syncDialAddToCart(
  user: unknown,
  archetype: string,
  dialSortOrder: number,
  source: string | null,
  coffeeId: number | null | undefined,
) {
  if (!user) return;
  setDialPosition(archetype, dialSortOrder, { trigger: 'add_to_cart', source, coffeeId: coffeeId ?? null })
    .catch(err => reportError(`[${source ?? 'dial'}/add-to-cart-dial-sync]`, err));
}
