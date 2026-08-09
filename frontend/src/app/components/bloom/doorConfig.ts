import type { ArchetypeData } from './types';

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
