import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { setDialPosition } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import { computeDefaultSortOrder } from './ArchetypeSection';
import { usePositionCardData } from './usePositionCardData';
import { dialCartItem, collectionCartItem, syncDialAddToCart } from './cartItems';
import { slotSellable } from './useSlotAvailability';
import type { ArchetypeData, CartItem, Slot } from './types';
import { slotKey } from './types';

// Website 5 (2026-11-05): the slot logic DialArchetypeSection's two layouts
// (the per-archetype canvas dial and the field) share, lifted out of
// DialArchetypeSection unchanged so neither layout forks it (G4.1, G3.9):
// the classic, the current slot (with the placeholder stand-in), the card
// data, "Save to my flavor memory" and the add-to-cart dial events.

export type DialSource = 'bloom' | 'find_my_flavor_returning' | 'find_my_flavor_results' | 'profile' | null;

/**
 * The archetype's DEFAULT (classic) position. Only trusts isDefault when
 * EXACTLY ONE slot carries it (an archetype with two conflicting isDefault rows
 * is a data problem, not a "first match"; see WHAT_WE_BUILT.md #145).
 */
export function classicOf(data: ArchetypeData) {
  const isDefaultSlots = data.slots.filter(s => s.isDefault);
  const defaultSlot = isDefaultSlots.length === 1
    ? isDefaultSlots[0]
    : data.slots.find(s => s.dialSortOrder === computeDefaultSortOrder(data));
  const defaultSortOrder = defaultSlot?.dialSortOrder ?? computeDefaultSortOrder(data);
  const defaultPrice = defaultSlot?.prices.find(p => p.isAnchor) ?? defaultSlot?.prices[0];
  const classicAvailable = !!(defaultSlot && defaultSlot.isActive && defaultSlot.platformName && defaultPrice);
  return { defaultSlot, defaultSortOrder, defaultPrice, classicAvailable };
}

/**
 * Website 6 B2 (decided 2026-11-05): the stop a family opens on when there is no
 * saved position or deep link. The classic when it is sellable; else the sellable
 * stop nearest to it (the lower one on a tie); else the classic (nothing sellable).
 */
export function openingSortOrder(data: ArchetypeData): number {
  const { defaultSortOrder } = classicOf(data);
  const slots = [...data.slots].sort((a, b) => a.dialSortOrder - b.dialSortOrder);
  const home = slots.findIndex(s => s.dialSortOrder === defaultSortOrder);
  if (home >= 0 && slotSellable(slots[home])) return defaultSortOrder;
  const from = home >= 0 ? home : 0;
  let best: number | null = null;
  slots.forEach((s, i) => {
    if (!slotSellable(s)) return;
    if (best === null || Math.abs(i - from) < Math.abs(best - from)) best = i;
  });
  return best === null ? defaultSortOrder : slots[best].dialSortOrder;
}

/** The Collection's discount as the offer itself states it (sum vs discounted), never a typed percentage. */
export function collectionPct(offer: { sumCents: number; discountedCents: number }): number {
  return offer.sumCents > 0 ? Math.round((1 - offer.discountedCents / offer.sumCents) * 100) : 0;
}

// Small-number spellout for "The four Floral coffees" / "Four ... coffees live here";
// the numeral itself past ten (the count is always the real one).
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** The line shown for a slot with no coffee yet, or a coffee whose notes are not in yet. */
export function arrivingSoonLine(archetypeLabel: string): string {
  return `A ${archetypeLabel} coffee for this turn of the dial. Its full tasting notes are arriving soon.`;
}

export function useDialSlot({ data, displaySortOrder, revealedKeys, source, onAddToCart, onDialSelect }: {
  data: ArchetypeData;
  displaySortOrder: number;
  revealedKeys: Set<string>;
  source: DialSource;
  onAddToCart: (item: CartItem) => void;
  onDialSelect: (archetype: string, dialSortOrder: number) => void;
}) {
  const { user } = useAuth();
  const classic = classicOf(data);

  // Synthetic slot for placeholders (hooks must run unconditionally): a dial
  // position with no resolved catalogue slot at all, distinct from a real slot
  // that is merely inactive/unpriced.
  const realSlot = data.slots.find(s => s.dialSortOrder === displaySortOrder);
  const isPlaceholder = !realSlot;
  const currentSlot: Slot = realSlot ?? {
    dialSortOrder: displaySortOrder,
    positionLabel: '',
    description: null,
    isActive: false,
    platformName: null,
    isDefault: false,
    prices: [],
    coffeeId: null,
  };
  const currentKey = slotKey(data.archetype, currentSlot.dialSortOrder);
  const isRevealed = revealedKeys.has(currentKey);

  // One fetch for this position, shared by the commerce controls and the reveal.
  const cardData = usePositionCardData(currentSlot, data.archetype, isRevealed);

  // "Save to my flavor memory": signed-in + a real (non-placeholder) slot only.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  useEffect(() => { setSavedKey(null); }, [currentKey]);

  function handleExplicitSave() {
    if (!user) return;
    setDialPosition(data.archetype, currentSlot.dialSortOrder, {
      trigger: 'explicit_save', source, coffeeId: currentSlot.coffeeId, platformName: currentSlot.platformName,
    })
      .then(() => setSavedKey(currentKey))
      .catch(err => reportError('[DialArchetypeSection/explicit-save]', err));
  }

  function handleAddToCart() {
    if (!cardData.selectedPrice) return;
    const item = dialCartItem(data, currentSlot, cardData.selectedPrice);
    if (!item) return;
    onAddToCart(item);
    syncDialAddToCart(user, data.archetype, currentSlot.dialSortOrder, source, currentSlot.coffeeId);
  }

  /** The classic quick pick; `turnTo` moves this surface's dial to the classic as feedback. */
  function handleClassicAdd(turnTo?: (dialSortOrder: number) => void) {
    const { defaultSlot, defaultPrice } = classic;
    if (!defaultSlot || !defaultPrice) return;
    const item = dialCartItem(data, defaultSlot, defaultPrice);
    if (!item) return;
    onAddToCart(item);
    turnTo?.(defaultSlot.dialSortOrder);
    onDialSelect(data.archetype, defaultSlot.dialSortOrder);
    syncDialAddToCart(user, data.archetype, defaultSlot.dialSortOrder, source, defaultSlot.coffeeId);
  }

  // data.collectionOffer is the backend-computed preview (null when fewer than
  // 3 positions are purchasable); no client-side discount math.
  function handleCollectionAdd() {
    const item = collectionCartItem(data);
    if (item) onAddToCart(item);
  }

  const showReveal = currentSlot.coffeeId != null && currentSlot.isActive;
  const isSaved = savedKey === currentKey;

  return {
    user, ...classic, realSlot, isPlaceholder, currentSlot, currentKey, isRevealed, cardData,
    isSaved, showReveal, handleExplicitSave, handleAddToCart, handleClassicAdd, handleCollectionAdd,
  };
}
