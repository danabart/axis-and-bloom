// Hand-simplified, low-poly world-map silhouette for The Axis map's geography
// states (0-1). Deliberately abstract — "a pattern, not an atlas" per
// CLAUDE_CODE_PROMPT_THE_AXIS_V2_REFINEMENTS_R3.md — generated as smooth
// closed blobs (Catmull-Rom → cubic Bezier) from a few seeded control points,
// not real coastline data. No map libraries, no external fetches.

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blobPath(cx: number, cy: number, rx: number, ry: number, seed: number, points = 9, jitter = 0.22): string {
  const rand = mulberry32(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const rJitter = 1 - jitter / 2 + rand() * jitter;
    pts.push([cx + rx * rJitter * Math.cos(angle), cy + ry * rJitter * Math.sin(angle)]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} `;
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % points];
    const p3 = pts[(i + 2) % points];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
  }
  return d + 'Z';
}

// Positioned to loosely echo real west-to-east world layout (not accurate
// coastlines) within the map's 640x520 coordinate space, roughly underlying
// the four coffee-belt dot clusters.
export const WORLD_LANDMASSES: string[] = [
  blobPath(140, 175, 58, 42, 1001),   // Central America & Mexico
  blobPath(160, 250, 26, 48, 1002, 7), // isthmus, softly bridges the two Americas blobs
  blobPath(185, 330, 62, 88, 1003),   // South America
  blobPath(365, 255, 70, 96, 1004),   // Africa
  blobPath(430, 188, 26, 20, 1005, 7), // Arabia (small extension off Africa)
  blobPath(515, 220, 88, 70, 1006),   // Asia & Pacific
  blobPath(585, 285, 14, 12, 1007, 6), // small Pacific island accent
];
