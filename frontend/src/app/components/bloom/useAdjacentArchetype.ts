import { useEffect, useRef, useState } from 'react';
import { getDialPosition, setDialPosition } from '../../lib/api';
import { computeDefaultSortOrder } from './ArchetypeSection';
import type { BloomDialHandle } from './dial/BloomDial';
import type { ArchetypeData } from './types';
import { slotKey } from './types';

/**
 * Part 17 §F — the "open a target archetype's DialArchetypeSection in place"
 * mechanism, extracted from Profile.tsx's "Worth exploring" flow (Profile Part 6,
 * `WorthExploring.tsx`) so every single-archetype surface (Profile, both Find My
 * Flavor screens) can route BOTH the Worth Exploring CTA and cross-archetype hop
 * chips through the same open/scroll/turn machinery, instead of each screen
 * growing its own copy — and instead of hop chips silently doing nothing on
 * these surfaces the way they did before this section (there's no second
 * archetype section on the page for them to jump to until one is opened).
 *
 * One adjacent archetype open at a time, same as Worth Exploring always was.
 */
export function useAdjacentArchetype(archetypesList: ArchetypeData[], experimentalData: ArchetypeData | null) {
  const [adjacentArchetypeId, setAdjacentArchetypeId] = useState<string | null>(null);
  const [adjacentSortOrder, setAdjacentSortOrderState] = useState<number | null>(null);
  const [adjacentRevealedKeys, setAdjacentRevealedKeys] = useState<Set<string>>(new Set());
  const adjacentDialRef = useRef<BloomDialHandle | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);
  // Set right before a hop opens the section at an EXPLICIT target position, so
  // the getDialPosition effect below (a plain chip click, no explicit target —
  // "open wherever I last left it") doesn't race in and clobber it.
  const pendingHopSortOrderRef = useRef<number | null>(null);

  const adjacentData = adjacentArchetypeId
    ? (adjacentArchetypeId === 'experimental' ? experimentalData : archetypesList.find(a => a.archetype === adjacentArchetypeId) ?? null)
    : null;

  useEffect(() => {
    if (!adjacentArchetypeId) { setAdjacentSortOrderState(null); return; }
    if (pendingHopSortOrderRef.current != null) { pendingHopSortOrderRef.current = null; return; }
    getDialPosition(adjacentArchetypeId)
      .then(r => { if (r?.dialSortOrder != null) setAdjacentSortOrderState(r.dialSortOrder); })
      .catch(() => {});
  }, [adjacentArchetypeId]);

  /** Worth Exploring chip click — toggle open/closed at the saved (or default) position. */
  function handleChipClick(archetype: string) {
    setAdjacentArchetypeId(prev => (prev === archetype ? null : archetype));
    setAdjacentRevealedKeys(new Set());
  }

  /** Cross-archetype hop click — always opens (never toggles closed) at the
   *  hop's exact target position, reveals that position's panel, then
   *  smooth-scrolls to the section and turns the dial once it's landed — the
   *  same arrival choreography Part 17 §C built for the Bloom page, reused
   *  here since this section may be mounting for the first time (nothing to
   *  visibly "turn" from) or may already be open on a different position
   *  (where the turn is exactly the explanation §C intends). */
  function openAtHop(archetype: string, dialSortOrder: number) {
    pendingHopSortOrderRef.current = dialSortOrder;
    setAdjacentArchetypeId(archetype);
    setAdjacentSortOrderState(dialSortOrder);
    setAdjacentRevealedKeys(new Set([slotKey(archetype, dialSortOrder)]));
    requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => adjacentDialRef.current?.rotateTo(dialSortOrder), 550);
    });
  }

  function handleDialSelect(archetype: string, dialSortOrder: number) {
    setAdjacentSortOrderState(dialSortOrder);
    setDialPosition(archetype, dialSortOrder).catch(() => {});
  }

  function toggleReveal(key: string) {
    setAdjacentRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function registerDialRef(_archetype: string, handle: BloomDialHandle | null) {
    adjacentDialRef.current = handle;
  }

  return {
    adjacentArchetypeId,
    adjacentData,
    adjacentSortOrder: adjacentSortOrder ?? (adjacentData ? computeDefaultSortOrder(adjacentData) : null),
    adjacentRevealedKeys,
    sectionRef,
    handleChipClick,
    openAtHop,
    handleDialSelect,
    toggleReveal,
    registerDialRef,
  };
}
