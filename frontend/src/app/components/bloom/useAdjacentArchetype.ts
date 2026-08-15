import { useEffect, useRef, useState } from 'react';
import { getDialPosition, setDialPosition } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import { computeDefaultSortOrder } from './ArchetypeSection';
import type { BloomDialHandle } from './dial/BloomDial';
import type { ArchetypeData } from './types';
import { slotKey } from './types';

/**
 * The "open a target archetype's DialArchetypeSection in place" mechanism
 * behind Profile.tsx's "Worth exploring" CTA (`WorthExploring.tsx`, Profile
 * Part 6) and, since Part 19 §A, edge doors on single-archetype surfaces
 * (Profile, both Find My Flavor screens) — one open/scroll/turn machinery,
 * two entry points, so neither screen grows its own copy.
 *
 * Part 18 §B — root cause of "the Worth Exploring CTA works sometimes,
 * doesn't other times," diagnosed here: the CTA never actually scrolled to
 * anything. Fixed by giving every open/retarget its own scroll, triggered
 * from an effect (guaranteed to run only after React commits the new
 * section) and delayed until the section's layout has actually stopped
 * changing, not just mounted.
 */
export function useAdjacentArchetype(archetypesList: ArchetypeData[], experimentalData: ArchetypeData | null) {
  const [adjacentArchetypeId, setAdjacentArchetypeId] = useState<string | null>(null);
  const [adjacentSortOrder, setAdjacentSortOrderState] = useState<number | null>(null);
  const [adjacentRevealedKeys, setAdjacentRevealedKeys] = useState<Set<string>>(new Set());
  const adjacentDialRef = useRef<BloomDialHandle | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  // Set right before an open/retarget that has an EXPLICIT target position
  // (a door — Part 19 §A), so the getDialPosition effect below (a plain
  // Worth Exploring chip click, no explicit target — "open wherever I last
  // left it") doesn't race in and clobber it.
  const pendingLandingRef = useRef<number | null>(null);
  // Bumped on every open/retarget that should travel (never on close) —
  // NOT the same thing as adjacentArchetypeId changing: a door landing on a
  // new position within the archetype that's *already* open as "adjacent"
  // doesn't change adjacentArchetypeId at all, and still needs its own
  // scroll+turn, so travel is driven by this token instead of that id.
  const [travelToken, setTravelToken] = useState(0);

  const adjacentData = adjacentArchetypeId
    ? (adjacentArchetypeId === 'experimental' ? experimentalData : archetypesList.find(a => a.archetype === adjacentArchetypeId) ?? null)
    : null;

  useEffect(() => {
    if (!adjacentArchetypeId) { setAdjacentSortOrderState(null); return; }
    if (pendingLandingRef.current != null) { setAdjacentSortOrderState(pendingLandingRef.current); return; }
    getDialPosition(adjacentArchetypeId)
      .then(r => { if (r?.dialSortOrder != null) setAdjacentSortOrderState(r.dialSortOrder); })
      .catch(err => reportError('[useAdjacentArchetype/dial-position-read]', err));
  }, [adjacentArchetypeId]);

  // Scrolls to `el` once its position has stopped moving for 2 consecutive
  // frames (~settled), or after maxWaitMs regardless — a hard fallback so a
  // pathological "never quite settles" case still scrolls eventually instead
  // of silently never firing. One scroll call, once settled — never a scroll
  // to a position that's still shifting. `onSettled` (optional) fires right
  // as the scroll starts — used to turn the dial to an explicit landing
  // position (a door), same arrival choreography as the Bloom page's.
  function scrollWhenSettled(el: HTMLElement | null, maxWaitMs: number, onSettled?: () => void) {
    if (!el) { onSettled?.(); return; }
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
        onSettled?.();
        return;
      }
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  }

  // Fires on every open/retarget that should travel (travelToken bump) —
  // never on close (handleChipClick only bumps it when actually opening).
  useEffect(() => {
    if (!adjacentArchetypeId || travelToken === 0) return;
    const landing = pendingLandingRef.current;
    pendingLandingRef.current = null;
    scrollWhenSettled(sectionRef.current, 900, () => {
      if (landing != null) adjacentDialRef.current?.rotateTo(landing);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelToken]);

  /** Worth Exploring chip click — toggle open/closed at the saved (or default)
   *  position; opening (including swapping to a different archetype) travels
   *  once settled. Closing never scrolls. */
  function handleChipClick(archetype: string) {
    const opening = adjacentArchetypeId !== archetype;
    setAdjacentArchetypeId(prev => (prev === archetype ? null : archetype));
    setAdjacentRevealedKeys(new Set());
    if (opening) setTravelToken(t => t + 1);
  }

  /** Part 19 §A — a door click: always opens/retargets (never toggles closed)
   *  at the door's exact continuity-rule landing position, reveals it, and
   *  travels there — whether the section is mounting fresh or already open
   *  on a different archetype/position. */
  function openAtPosition(archetype: string, dialSortOrder: number) {
    pendingLandingRef.current = dialSortOrder;
    setAdjacentArchetypeId(archetype);
    setAdjacentRevealedKeys(new Set([slotKey(archetype, dialSortOrder)]));
    setTravelToken(t => t + 1);
  }

  function handleDialSelect(archetype: string, dialSortOrder: number) {
    setAdjacentSortOrderState(dialSortOrder);
    setDialPosition(archetype, dialSortOrder).catch(err => reportError('[useAdjacentArchetype/dial-position-write]', err));
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
    openAtPosition,
    handleDialSelect,
    toggleReveal,
    registerDialRef,
  };
}
