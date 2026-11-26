import { useEffect, useState } from 'react';
import { reportError } from '../../lib/errorReporter';
import type { Slot, Hop } from './types';
import { useCoffeeDetail } from '../coffee-info/useCoffeeDetail';
import { teaserFor } from '../../lib/signatureLine';
import { useSlotAvailability } from './useSlotAvailability';

/**
 * All fetching/derived state for one position card, extracted out of the
 * component itself (The Bloom Part 4, Phase D) so both the collapsed card and
 * the full-width revealed panel can share one fetch instead of each fetching
 * independently.
 */
export function usePositionCardData(slot: Slot, archetype: string, isRevealed: boolean) {
  const [hops, setHops] = useState<Hop[]>([]);

  // Ella map 12 (2026-11-26): the content, the flavor wheel and the dimensions
  // come from useCoffeeDetail, the one copy of those reads (/map's "More about
  // this coffee" calls it too). Unchanged here: content and wheel as soon as
  // this is a real position (Part 16 §A; Coffee presentation brief 1, B2: the
  // collapsed card's teaser falls back to the signature line from the wheel
  // rows), dimensions lazily on first reveal only.
  const { content, dimensions, wheelRows } = useCoffeeDetail(slot.coffeeId ?? null, {
    readContent: !!slot.isActive, withDimensions: isRevealed, logTag: 'usePositionCardData',
  });

  // Hops, fetched as soon as this is a real position (not gated by reveal).
  // Part 16 §A: the chips render on the dial instrument itself, pre-reveal, so
  // they need to be ready before the first reveal click.
  useEffect(() => {
    if (!slot.isActive || !slot.coffeeId) return;
    fetch(`/api/coffees/${slot.coffeeId}/hops`).then(r => r.json()).then(setHops).catch(err => reportError('[usePositionCardData/hops]', err));
    // per-weight availability: useSlotAvailability below (shared with Shop all's card)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.coffeeId, slot.isActive]);

  const { availableWeights, isUnpriced, effectivelyActive, selectedWeight, setSelectedWeight, selectedPrice } = useSlotAvailability(slot, archetype);
  // Coffee presentation brief 2 (2026-10-24), B2: always the signature line
  // from the same rows the reveal panel draws (the surprise-note branch is
  // gone with the surprise note); see teaserFor.
  const teaser = teaserFor(Array.isArray(wheelRows) ? wheelRows : []);
  // Coffee presentation brief 4 (2026-10-24), decision 2: the card's tags as
  // the content read gives them (award, best brew); never text of our own.
  const tags = Array.isArray(content?.tags) ? content.tags : [];
  // Decision 1: the coffee has customer-voice rows (the "arriving soon" line renders only without any).
  const hasVoiceRows = Array.isArray(wheelRows) && wheelRows.length > 0;

  return {
    content, dimensions, wheelRows, hops, tags, hasVoiceRows,
    availableWeights, effectivelyActive, isUnpriced, teaser, selectedPrice,
    selectedWeight, setSelectedWeight,
  };
}
