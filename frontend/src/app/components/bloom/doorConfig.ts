import type { ArchetypeData } from './types';

/**
 * Part 23 §A — temporary, reversible kill switch for the cross-archetype edge
 * doors. The Part 19 door chips turned out to be live in production with a
 * known-broken door map (Dana's call: hide the doors everywhere until the
 * separate door-chain thread fixes the map, don't rip the mechanism out).
 * Flip to `true` to restore doors with zero other changes — every render
 * site (BloomDial.tsx's imperative step-chip paint AND its JSX fallback) and
 * the onDoorClick wiring all key off `DialConfig.doors`, which this flag
 * gates at its single source, `buildDialConfig()` in dial/archetypeConfig.ts.
 * At an extreme position with doors off, the outward slot is simply empty
 * again (Part 18 behavior) — nothing else about step chips/snapping/
 * classic/collection CTAs changes.
 */
export const DOORS_ENABLED = false;

/**
 * Part 19 §A — the door-landing continuity rule (Dana's spec).
 *
 * 'continuity' (shipped): exiting through the RIGHT edge lands on the target
 * dial's LEFT edge position, and vice versa — the user's direction of travel
 * stays meaningful across the seam (walking "more" keeps meaning more).
 *
 * 'mirror': would land on the SAME-side edge instead (right → right,
 * left → left). Flip this ONE constant to switch every door's landing
 * behavior, everywhere a door travels (Bloom page + Profile/quiz screens) —
 * nothing else needs to change.
 */
export const DOOR_LANDING: 'continuity' | 'mirror' = 'continuity';

/** Which dialSortOrder to land on when a door is exited through `edge`, based
 *  on the TARGET archetype's own first/last positions (by dialSortOrder). */
export function resolveLandingSortOrder(edge: 'left' | 'right', targetData: ArchetypeData): number {
  const sorted = [...targetData.slots].sort((a, b) => a.dialSortOrder - b.dialSortOrder);
  const first = sorted[0]?.dialSortOrder ?? 1;
  const last = sorted[sorted.length - 1]?.dialSortOrder ?? first;
  if (DOOR_LANDING === 'continuity') {
    // Exited right -> land on target's left edge; exited left -> target's right edge.
    return edge === 'right' ? first : last;
  }
  // mirror: land on the same-side edge.
  return edge === 'right' ? last : first;
}
