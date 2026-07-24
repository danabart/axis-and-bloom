import { useEffect, useState } from 'react';
import type { Slot, Hop } from './types';
import type { ContentData } from '../coffee-info/TastingNotes';
import type { DimensionRow } from '../coffee-info/DimensionBars';
import type { WheelRow } from '../coffee-info/CollaborativeFlavorWheel';

/**
 * All fetching/derived state for one position card, extracted out of the
 * component itself (The Bloom Part 4, Phase D) so both the collapsed card and
 * the full-width revealed panel can share one fetch instead of each fetching
 * independently.
 */
export function usePositionCardData(slot: Slot, archetype: string, isRevealed: boolean) {
  const [content, setContent] = useState<ContentData | null>(null);
  const [availability, setAvailability] = useState<Record<number, boolean> | null>(null);
  const [selectedWeight, setSelectedWeight] = useState<number | null>(null);

  const [dimensions, setDimensions] = useState<DimensionRow[]>([]);
  const [wheelRows, setWheelRows] = useState<WheelRow[]>([]);
  const [hops, setHops] = useState<Hop[]>([]);
  const [detailLoaded, setDetailLoaded] = useState(false);

  // Teaser + per-weight availability, fetched as soon as this is a real position (not gated by reveal).
  useEffect(() => {
    if (!slot.isActive || !slot.coffeeId) return;
    fetch(`/api/coffees/${slot.coffeeId}/content`).then(r => r.json()).then(setContent).catch(() => {});

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
    }).catch(() => setAvailability({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.coffeeId, slot.isActive]);

  // Full informational layer, fetched lazily on first reveal only.
  useEffect(() => {
    if (!isRevealed || detailLoaded || !slot.coffeeId) return;
    setDetailLoaded(true);
    Promise.all([
      fetch(`/api/coffees/${slot.coffeeId}/dimensions`).then(r => r.json()),
      fetch(`/api/coffees/${slot.coffeeId}/flavor-wheel`).then(r => r.json()),
      fetch(`/api/coffees/${slot.coffeeId}/hops`).then(r => r.json()),
    ]).then(([dimData, wheel, hopData]) => {
      setDimensions(dimData.dimensions ?? []);
      setWheelRows(wheel);
      setHops(hopData);
    }).catch(() => {});
  }, [isRevealed, detailLoaded, slot.coffeeId]);

  const availableWeights = slot.prices.filter(p => availability?.[p.weightOz]);
  // No dial_slot_price row for any weight — distinct from "no coffee resolved"
  // (slot.isActive false); renders as "Unpriced" rather than "Temporarily
  // unavailable" (Pricing update, 2026-07-24 — no hardcoded fallback price).
  const isUnpriced = slot.isActive && slot.prices.length === 0;
  const effectivelyActive = slot.isActive && slot.prices.length > 0 && (availability === null || availableWeights.length > 0);
  const teaser = content?.surpriseNote ? content.surpriseNote.split(/(?<=[.!?])\s/)[0] : null;
  const selectedPrice = slot.prices.find(p => p.weightOz === selectedWeight);

  return {
    content, dimensions, wheelRows, hops,
    availableWeights, effectivelyActive, isUnpriced, teaser, selectedPrice,
    selectedWeight, setSelectedWeight,
  };
}
