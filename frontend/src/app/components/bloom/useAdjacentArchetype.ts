import { useEffect, useRef, useState } from 'react';
import { getDialPosition, setDialPosition } from '../../lib/api';
import { computeDefaultSortOrder } from './ArchetypeSection';
import type { BloomDialHandle } from './dial/BloomDial';
import type { ArchetypeData } from './types';

/**
 * The "open a target archetype's DialArchetypeSection in place" mechanism
 * behind Profile.tsx's "Worth exploring" CTA (`WorthExploring.tsx`, Profile
 * Part 6), shared so every single-archetype surface (Profile, both Find My
 * Flavor screens) uses the same open/scroll machinery instead of each screen
 * growing its own copy.
 *
 * Part 18 §B — root cause of "the Worth Exploring CTA works sometimes,
 * doesn't other times," diagnosed here: the CTA never actually scrolled to
 * anything. `handleChipClick` only ever set `adjacentArchetypeId` — there was
 * no `scrollIntoView` call anywhere in this hook's chip-click path (Part 17 §F
 * built scroll+turn choreography for HOP-CHIP clicks only, via the
 * since-removed `openAtHop`; the CTA path was never wired to it). Whether the
 * CTA "worked" was pure luck: if the user's current scroll position happened
 * to already be near where the newly-mounted section rendered (they were
 * already scrolled down near Worth Exploring), the new content appeared in
 * view and looked like it worked; if they were higher up the page, the
 * section mounted off-screen below the fold and nothing appeared to happen.
 * Fixed by giving `handleChipClick` its own scroll, triggered from an effect
 * (guaranteed to run only after React has committed the new section into the
 * DOM — not a `requestAnimationFrame` racing the click handler) and delayed
 * until the section's layout has actually stopped changing, not just mounted
 * — a coffee's flavor wheel, dial fill-engine canvas, and variable-height
 * prose can all still be settling into their final layout for a frame or two
 * after first mount, and scrolling before that lands at a position that then
 * drifts as more settles in.
 */
export function useAdjacentArchetype(archetypesList: ArchetypeData[], experimentalData: ArchetypeData | null) {
  const [adjacentArchetypeId, setAdjacentArchetypeId] = useState<string | null>(null);
  const [adjacentSortOrder, setAdjacentSortOrderState] = useState<number | null>(null);
  const [adjacentRevealedKeys, setAdjacentRevealedKeys] = useState<Set<string>>(new Set());
  const adjacentDialRef = useRef<BloomDialHandle | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  const adjacentData = adjacentArchetypeId
    ? (adjacentArchetypeId === 'experimental' ? experimentalData : archetypesList.find(a => a.archetype === adjacentArchetypeId) ?? null)
    : null;

  useEffect(() => {
    if (!adjacentArchetypeId) { setAdjacentSortOrderState(null); return; }
    getDialPosition(adjacentArchetypeId)
      .then(r => { if (r?.dialSortOrder != null) setAdjacentSortOrderState(r.dialSortOrder); })
      .catch(() => {});
  }, [adjacentArchetypeId]);

  // Scrolls to `el` once its position has stopped moving for 2 consecutive
  // frames (~settled), or after maxWaitMs regardless — a hard fallback so a
  // pathological "never quite settles" case still scrolls eventually instead
  // of silently never firing. One scroll call, once settled — never a scroll
  // to a position that's still shifting.
  function scrollWhenSettled(el: HTMLElement | null, maxWaitMs = 900) {
    if (!el) return;
    const start = performance.now();
    let lastTop: number | null = null;
    let stableFrames = 0;
    function check() {
      if (!el.isConnected) return;
      const top = el.getBoundingClientRect().top;
      stableFrames = lastTop !== null && Math.abs(top - lastTop) < 1 ? stableFrames + 1 : 0;
      lastTop = top;
      if (stableFrames >= 2 || performance.now() - start > maxWaitMs) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  }

  // Fires exactly once per open/retarget (never on close, never on the
  // position-only update from the getDialPosition effect above) — the mount
  // this effect reacts to has already committed by the time it runs (React
  // guarantees effects run after commit), so `sectionRef.current` is always
  // the freshly-mounted element, not stale.
  useEffect(() => {
    if (!adjacentArchetypeId) return;
    scrollWhenSettled(sectionRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjacentArchetypeId]);

  /** Worth Exploring chip click — toggle open/closed at the saved (or default)
   *  position; opening (including swapping to a different archetype) scrolls
   *  once settled, via the effect above. */
  function handleChipClick(archetype: string) {
    setAdjacentArchetypeId(prev => (prev === archetype ? null : archetype));
    setAdjacentRevealedKeys(new Set());
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
    handleDialSelect,
    toggleReveal,
    registerDialRef,
  };
}
