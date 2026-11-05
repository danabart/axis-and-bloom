import { useEffect, useState } from 'react';
import { reportError } from '../../lib/errorReporter';
import type { Slot } from './types';

/**
 * Per-weight availability of one dial slot (GET /api/shop/slot-availability,
 * roaster-blind), the weight the card starts on, and the card's state flags.
 * Extracted from usePositionCardData (Website 4, 2026-11-05) so the dial card
 * and Shop all's card share one rule (G4.1): unpriced = an active slot with no
 * price row; effectively active = active, priced, and (once known) at least
 * one weight a roaster can fill.
 */
export function useSlotAvailability(slot: Pick<Slot, 'isActive' | 'coffeeId' | 'dialSortOrder' | 'prices'>, archetype: string) {
  const [availability, setAvailability] = useState<Record<number, boolean> | null>(null);
  const [selectedWeight, setSelectedWeight] = useState<number | null>(null);

  useEffect(() => {
    if (!slot.isActive || !slot.coffeeId) return;
    Promise.all(
      slot.prices.map(p =>
        fetch(`/api/shop/slot-availability?archetype=${archetype}&dialSortOrder=${slot.dialSortOrder}&weightOz=${p.weightOz}`)
          .then(r => r.json())
          .then(data => [p.weightOz, !!data.available] as const)
      )
    ).then(entries => {
      const map = Object.fromEntries(entries);
      setAvailability(map);
      const firstAvailable = slot.prices.find(p => map[p.weightOz])?.weightOz ?? null;
      setSelectedWeight(firstAvailable);
    }).catch(err => { reportError('[useSlotAvailability]', err); setAvailability({}); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.coffeeId, slot.isActive]);

  const availableWeights = slot.prices.filter(p => availability?.[p.weightOz]);
  // No price row for any weight — distinct from "no coffee resolved" (slot.isActive
  // false); renders as unpriced rather than unavailable (Pricing update, 2026-07-24 —
  // no hardcoded fallback price).
  const isUnpriced = slot.isActive && slot.prices.length === 0;
  const effectivelyActive = slot.isActive && slot.prices.length > 0 && (availability === null || availableWeights.length > 0);
  const selectedPrice = slot.prices.find(p => p.weightOz === selectedWeight);

  return { availability, availableWeights, isUnpriced, effectivelyActive, selectedWeight, setSelectedWeight, selectedPrice };
}

/**
 * Website 6 B2 (2026-11-05): the same rule as `effectivelyActive` above, as a pure
 * function over the payload, for places that pick a slot before any availability
 * is fetched (The Bloom's opening stop): a coffee on the slot, active, priced, and,
 * when the per-weight availability is known, at least one weight a roaster can fill.
 */
export function slotSellable(
  slot: Pick<Slot, 'isActive' | 'coffeeId' | 'prices'>,
  availability: Record<number, boolean> | null = null,
): boolean {
  return slot.isActive && slot.coffeeId != null && slot.prices.length > 0
    && (availability === null || slot.prices.some(p => availability[p.weightOz]));
}
