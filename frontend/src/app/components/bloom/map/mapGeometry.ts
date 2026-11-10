// Ella's Bloom Map 2 (2026-11-10), C1 — the face's geometry, pure and
// deterministic (no React, no DOM). Brief 3 reuses it for the customer face.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_2_WORKBENCH.md
//
// Angles are degrees in SVG space (0 = +x, clockwise, -90 = up). The center
// is a disc; the four wedges sit in the quadrants named by dial_wedge.angle_order
// (1 top-right, 2 top-left, 3 bottom-right, 4 bottom-left); the three rings
// have equal width. A lane is an angle inside the wedge: side A near the
// boundary shared with side_a_archetype's wedge, middle at the wedge's
// center, side B near side_b's. Nothing here rotates or drags.

export interface WedgeGeo {
  archetype_code: string;
  is_center: boolean;
  angle_order: number;
  side_a_archetype: string;
  side_b_archetype: string;
}

export interface PlacementGeo {
  coffee_id: number;
  archetype_code: string;
  is_center: boolean;
  ring: number | null;
  lane_code: string;
  size: number | null;
}

export interface FaceGeometry {
  cx: number; cy: number;
  /** outer radius of ring 3 */
  outer: number;
  /** radius of the center disc */
  center: number;
  /** ring width (rings 1 to 3 are equal) */
  ringWidth: number;
}

export const VIEW = 1000;

export function faceGeometry(view = VIEW): FaceGeometry {
  const outer = view * 0.4;
  const center = outer * 0.25;
  return { cx: view / 2, cy: view / 2, outer, center, ringWidth: (outer - center) / 3 };
}

/** The quadrant of a wedge by its angle_order: [start, end] in degrees, end = start + 90. */
export function wedgeSpan(angleOrder: number): [number, number] {
  switch (angleOrder) {
    case 1: return [-90, 0];    // top-right
    case 2: return [-180, -90]; // top-left
    case 3: return [0, 90];     // bottom-right
    case 4: return [90, 180];   // bottom-left
    default: throw new Error(`no quadrant for angle_order ${angleOrder}`);
  }
}

const norm = (a: number) => ((a % 360) + 360) % 360;
const same = (a: number, b: number) => Math.abs(norm(a) - norm(b)) < 1e-9;

/** The boundary angle two wedges share, or null when they are not neighbours. */
export function sharedBoundary(a: number, b: number): number | null {
  const [a0, a1] = wedgeSpan(a);
  const [b0, b1] = wedgeSpan(b);
  if (same(a0, b1)) return a0;
  if (same(a1, b0)) return a1;
  return null;
}

/** Fraction of the wedge's span between a seam lane and its boundary. */
export const LANE_INSET = 0.2;

/** The lane's angle inside its wedge; a side with no shared boundary falls back to the middle. */
export function laneAngle(wedge: WedgeGeo, laneCode: string, byArchetype: Record<string, WedgeGeo>): number {
  const [a0, a1] = wedgeSpan(wedge.angle_order);
  const mid = (a0 + a1) / 2;
  const side = laneCode === 'side_a' ? wedge.side_a_archetype : laneCode === 'side_b' ? wedge.side_b_archetype : null;
  const other = side ? byArchetype[side] : undefined;
  if (!other || other.is_center) return mid;
  const boundary = sharedBoundary(wedge.angle_order, other.angle_order);
  if (boundary === null) return mid;
  const span = a1 - a0;
  return same(boundary, a0) ? a0 + span * LANE_INSET : a1 - span * LANE_INSET;
}

/** Mid radius of a ring (1 to 3). */
export function ringRadius(g: FaceGeometry, ring: number): number {
  return g.center + (ring - 0.5) * g.ringWidth;
}

const polar = (g: FaceGeometry, deg: number, r: number) => ({
  x: g.cx + r * Math.cos((deg * Math.PI) / 180),
  y: g.cy + r * Math.sin((deg * Math.PI) / 180),
});

/** The cell point of a placement: a wedge point, or for the center a point toward its lean side's wedge. */
export function cellPoint(g: FaceGeometry, p: PlacementGeo, byArchetype: Record<string, WedgeGeo>): { x: number; y: number } | null {
  const wedge = byArchetype[p.archetype_code];
  if (!wedge || p.ring === null) return null;
  if (wedge.is_center || p.is_center) {
    const side = p.lane_code === 'side_a' ? wedge.side_a_archetype : p.lane_code === 'side_b' ? wedge.side_b_archetype : null;
    const toward = side ? byArchetype[side] : undefined;
    if (!toward || toward.is_center) return { x: g.cx, y: g.cy };
    const [t0, t1] = wedgeSpan(toward.angle_order);
    return polar(g, (t0 + t1) / 2, g.center * 0.5);
  }
  return polar(g, laneAngle(wedge, p.lane_code, byArchetype), ringRadius(g, p.ring));
}

/** Dot radius by size class; no size draws the smallest. */
export function dotRadius(size: number | null): number {
  return size === 3 ? 18 : size === 2 ? 14 : 10;
}

export const FAN_RADIUS = 24;

export interface DotLayout { coffee_id: number; x: number; y: number; r: number; cellX: number; cellY: number }

/**
 * Every placement's dot. Coffees that share a cell fan out around the cell's
 * point, in coffee_id order, so the layout is the same whatever order the
 * rows arrive in.
 */
export function layoutDots(g: FaceGeometry, placements: PlacementGeo[], wedges: WedgeGeo[]): DotLayout[] {
  const byArchetype = Object.fromEntries(wedges.map(w => [w.archetype_code, w]));
  const cells = new Map<string, Array<{ p: PlacementGeo; x: number; y: number }>>();
  for (const p of [...placements].sort((a, b) => a.coffee_id - b.coffee_id)) {
    const pt = cellPoint(g, p, byArchetype);
    if (!pt) continue;
    const key = `${pt.x.toFixed(3)},${pt.y.toFixed(3)}`;
    cells.set(key, [...(cells.get(key) ?? []), { p, ...pt }]);
  }
  const out: DotLayout[] = [];
  for (const members of cells.values()) {
    const n = members.length;
    members.forEach((m, i) => {
      const angle = -90 + (360 * i) / n;
      const dx = n === 1 ? 0 : FAN_RADIUS * Math.cos((angle * Math.PI) / 180);
      const dy = n === 1 ? 0 : FAN_RADIUS * Math.sin((angle * Math.PI) / 180);
      out.push({ coffee_id: m.p.coffee_id, x: m.x + dx, y: m.y + dy, r: dotRadius(m.p.size), cellX: m.x, cellY: m.y });
    });
  }
  return out.sort((a, b) => a.coffee_id - b.coffee_id);
}

/** SVG path of a wedge's sector between the center disc and the outer ring. */
export function sectorPath(g: FaceGeometry, angleOrder: number): string {
  const [a0, a1] = wedgeSpan(angleOrder);
  const p0 = polar(g, a0, g.center), p1 = polar(g, a0, g.outer), p2 = polar(g, a1, g.outer), p3 = polar(g, a1, g.center);
  return `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} A ${g.outer} ${g.outer} 0 0 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${g.center} ${g.center} 0 0 0 ${p0.x} ${p0.y} Z`;
}

/** A point at an angle and radius (labels). */
export function pointAt(g: FaceGeometry, deg: number, r: number) { return polar(g, deg, r); }

/** Follow-up (2026-11-10): the name label beside a dot, cut to `max` characters with an ellipsis. */
export const LABEL_MAX = 16;
export function shortLabel(name: string, max = LABEL_MAX): string {
  const s = name.trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Where a dot's label sits: beside the dot, on the side away from its cell's
 * point, so the names in a fanned-out cell move with their dots and spread
 * apart rather than stacking. A lone dot (or one straight above or below the
 * point) is labelled on its right.
 */
export function labelAnchor(d: DotLayout, gap = 6): { x: number; y: number; anchor: 'start' | 'end' } {
  const left = d.x < d.cellX - 0.5;
  return { x: left ? d.x - d.r - gap : d.x + d.r + gap, y: d.y, anchor: left ? 'end' : 'start' };
}
