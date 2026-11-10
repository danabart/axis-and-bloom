// Ella's Bloom Map 2 (2026-11-10), Part D — the face geometry: the angle per
// wedge, the lane offsets toward each seam, and a fan-out that does not
// depend on the order rows arrive in.
import { describe, it, expect } from 'vitest';
import { faceGeometry, wedgeSpan, sharedBoundary, laneAngle, layoutDots, ringRadius, LANE_INSET, type WedgeGeo, type PlacementGeo } from './mapGeometry';

// the brief 1 seeds (dial_wedge): sides per Rev 3 section 2 and CTO call 4
const WEDGES: WedgeGeo[] = [
  { archetype_code: 'chocolate_nutty', is_center: false, angle_order: 1, side_a_archetype: 'fruity', side_b_archetype: 'earthy' },
  { archetype_code: 'fruity', is_center: false, angle_order: 2, side_a_archetype: 'chocolate_nutty', side_b_archetype: 'floral' },
  { archetype_code: 'earthy', is_center: false, angle_order: 3, side_a_archetype: 'chocolate_nutty', side_b_archetype: 'floral' },
  { archetype_code: 'floral', is_center: false, angle_order: 4, side_a_archetype: 'fruity', side_b_archetype: 'earthy' },
  { archetype_code: 'balanced_sweet', is_center: true, angle_order: 0, side_a_archetype: 'chocolate_nutty', side_b_archetype: 'fruity' },
];
const BY = Object.fromEntries(WEDGES.map(w => [w.archetype_code, w]));
const g = faceGeometry();

describe('mapGeometry', () => {
  it('each wedge has its quadrant; neighbours share a boundary, opposites do not', () => {
    expect(wedgeSpan(1)).toEqual([-90, 0]);
    expect(wedgeSpan(2)).toEqual([-180, -90]);
    expect(wedgeSpan(3)).toEqual([0, 90]);
    expect(wedgeSpan(4)).toEqual([90, 180]);
    expect(sharedBoundary(1, 2)).toBe(-90);
    expect(sharedBoundary(1, 3)).toBe(0);
    expect(sharedBoundary(2, 4)).toBe(-180);
    expect(sharedBoundary(3, 4)).toBe(90);
    expect(sharedBoundary(1, 4)).toBeNull();
    expect(sharedBoundary(2, 3)).toBeNull();
  });

  it('side A sits near the seam with side_a_archetype, side B near side_b, middle at the center of the wedge', () => {
    const cn = BY.chocolate_nutty;
    expect(laneAngle(cn, 'middle', BY)).toBe(-45);
    expect(laneAngle(cn, 'side_a', BY)).toBeCloseTo(-90 + 90 * LANE_INSET); // toward fruity (top-left)
    expect(laneAngle(cn, 'side_b', BY)).toBeCloseTo(0 - 90 * LANE_INSET);   // toward earthy (bottom-right)
    expect(laneAngle(BY.floral, 'side_a', BY)).toBeCloseTo(180 - 90 * LANE_INSET); // toward fruity across the left boundary
  });

  it('rings are equal width outside the center disc', () => {
    expect(ringRadius(g, 2) - ringRadius(g, 1)).toBeCloseTo(g.ringWidth);
    expect(ringRadius(g, 3) + g.ringWidth / 2).toBeCloseTo(g.outer);
  });

  it('fan-out: coffees in one cell spread around its point, the same whatever the row order', () => {
    const ps: PlacementGeo[] = [3, 1, 2].map(id => ({ coffee_id: id, archetype_code: 'fruity', is_center: false, ring: 2, lane_code: 'middle', size: 2 }));
    const a = layoutDots(g, ps, WEDGES);
    const b = layoutDots(g, [...ps].reverse(), WEDGES);
    expect(a).toEqual(b);
    expect(new Set(a.map(d => `${d.x.toFixed(2)},${d.y.toFixed(2)}`)).size).toBe(3);
    expect(new Set(a.map(d => `${d.cellX},${d.cellY}`)).size).toBe(1);
    const lone = layoutDots(g, [{ coffee_id: 9, archetype_code: 'balanced_sweet', is_center: true, ring: 0, lane_code: 'middle', size: 1 }], WEDGES)[0];
    expect([lone.x, lone.y]).toEqual([g.cx, g.cy]);
  });

  it('a placement with no ring draws nothing', () => {
    expect(layoutDots(g, [{ coffee_id: 1, archetype_code: 'fruity', is_center: false, ring: null, lane_code: 'middle', size: null }], WEDGES)).toEqual([]);
  });
});
