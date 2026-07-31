// Coloring-book fill engine — ported faithfully from mockup 32 v8 (brief 33 §3).
//
// Cells are detected ONCE from the vector linework (rasterize → threshold alpha →
// thicken ink → flood-fill borders/gutters → label enclosed cells → tuck under ink).
// Cell GEOMETRY depends only on the SVG, so it is computed a single time and shared
// across every mounted dial; only the per-archetype COLOR assignment differs.

import { LINEWORK_URI } from './linework';

export const W = 1200, H = 1200;
export const CX = W / 2, CY = H / 2;
// SVG viewBox is 162.4763 × 171.4078 (portrait). Rasterize height-fit, centered,
// so the fill lands exactly under the visible (preserveAspectRatio meet) linework.
export const DRAW_W = W * 162.4763 / 171.4078;
export const DRAW_X = (W - DRAW_W) / 2;

export const BEIGE: readonly [number, number, number] = [242, 241, 234];

export interface Cell {
  px: number[];   // pixel indices into the W*H bitmap
  count: number;
  cx: number;
  cy: number;
}

export type RGB = [number, number, number];

export function mixHex(hex: string, pct: number): RGB {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return c.map((v, i) => Math.round(v * pct / 100 + BEIGE[i] * (1 - pct / 100))) as RGB;
}

// ── Cell detection (runs once, memoized) ────────────────────────────────────
function detectCells(maskImg: HTMLImageElement): Cell[] {
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
  const mx = mc.getContext('2d', { willReadFrequently: true })!;
  mx.drawImage(maskImg, DRAW_X, 0, DRAW_W, H);
  const md = mx.getImageData(0, 0, W, H).data;
  const N = W * H;

  // ink = linework pixels (alpha > 25), then thicken by 1px
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) ink[i] = md[i * 4 + 3] > 25 ? 1 : 0;
  const grown = new Uint8Array(ink);
  for (let i = 0; i < N; i++) {
    if (!ink[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) grown[i - 1] = 1;
    if (x < W - 1) grown[i + 1] = 1;
    if (y > 0) grown[i - W] = 1;
    if (y < H - 1) grown[i + W] = 1;
  }
  grown.forEach((v, i) => { ink[i] = v; });

  const label = new Int32Array(N).fill(0);
  const stack = new Int32Array(N);
  function flood(seed: number, id: number) {
    let sp = 0, count = 0, sx = 0, sy = 0;
    const px: number[] = [];
    stack[sp++] = seed; label[seed] = id;
    while (sp > 0) {
      const p = stack[--sp];
      if (id > 0) { px.push(p); count++; sx += p % W; sy += (p / W) | 0; }
      const x = p % W, y = (p / W) | 0;
      if (x > 0     && !label[p - 1] && !ink[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1; }
      if (x < W - 1 && !label[p + 1] && !ink[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0     && !label[p - W] && !ink[p - W]) { label[p - W] = id; stack[sp++] = p - W; }
      if (y < H - 1 && !label[p + W] && !ink[p + W]) { label[p + W] = id; stack[sp++] = p + W; }
    }
    return { px, count, cx: sx / (count || 1), cy: sy / (count || 1) };
  }

  // flood the outside + gutters from every border pixel (id = -1)
  for (let x = 0; x < W; x++) {
    if (!ink[x] && !label[x]) flood(x, -1);
    const b = (H - 1) * W + x; if (!ink[b] && !label[b]) flood(b, -1);
  }
  for (let y = 0; y < H; y++) {
    const l = y * W; if (!ink[l] && !label[l]) flood(l, -1);
    const r = y * W + W - 1; if (!ink[r] && !label[r]) flood(r, -1);
  }

  // remaining unlabeled non-ink regions = enclosed cells (area >= 220)
  let id = 1; const found: Cell[] = [];
  for (let i = 0; i < N; i++) {
    if (!ink[i] && !label[i]) {
      const c = flood(i, ++id);
      if (c.count >= 220) found.push(c);
    }
  }
  // exclude the hub (cells whose centroid is within 75px of center)
  const usable = found.filter(c => Math.hypot(c.cx - CX, c.cy - CY) > 75);

  // tuck each cell 2px under the ink (2 grow passes claiming ink pixels)
  const owner = new Int32Array(N).fill(-1);
  usable.forEach((c, k) => c.px.forEach(p => owner[p] = k));
  for (let pass = 0; pass < 2; pass++) {
    const adds: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      if (!ink[i] || owner[i] >= 0) continue;
      const x = i % W, y = (i / W) | 0;
      const nb = [x > 0 ? owner[i - 1] : -1, x < W - 1 ? owner[i + 1] : -1, y > 0 ? owner[i - W] : -1, y < H - 1 ? owner[i + W] : -1];
      const k = nb.find(v => v >= 0);
      if (k !== undefined && k >= 0) adds.push([i, k]);
    }
    adds.forEach(([i, k]) => { owner[i] = k; usable[k].px.push(i); });
  }

  // sort center-out so bloom order runs from the hub outward
  usable.sort((a, b) => Math.hypot(a.cx - CX, a.cy - CY) - Math.hypot(b.cx - CX, b.cy - CY));
  return usable;
}

let cellsPromise: Promise<Cell[]> | null = null;

/** Rasterize the shared linework and detect cells once; every dial reuses the result. */
export function getCells(): Promise<Cell[]> {
  if (cellsPromise) return cellsPromise;
  cellsPromise = new Promise<Cell[]>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try { resolve(detectCells(img)); } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Bloom Dial linework failed to load'));
    img.src = LINEWORK_URI;
  });
  return cellsPromise;
}

// ── Per-archetype colour assignment (cheap; runs per dial per archetype) ─────
export function colorizeCells(cells: Cell[], archHex: string): RGB[] {
  const last = cells[cells.length - 1];
  const maxR = Math.hypot(last.cx - CX, last.cy - CY) || 1;
  const colors: RGB[] = cells.map(c => {
    const r = Math.hypot(c.cx - CX, c.cy - CY) / maxR;
    return r < 0.32 ? mixHex(archHex, 38)
         : r < 0.55 ? mixHex(archHex, 58)
         : r < 0.80 ? mixHex(archHex, 74)
         : mixHex(archHex, 88);
  });
  // accent cells — only among the smaller cells (below 1.4× median area)
  const areas = cells.map(c => c.count).sort((a, b) => a - b);
  const medArea = areas[Math.floor(areas.length / 2)] || 1;
  cells.forEach((c, k) => {
    if (c.count > medArea * 1.4) return;
    if (k % 9 === 4) colors[k] = mixHex('#ee5974', 100); // pink
    if (k % 9 === 8) colors[k] = mixHex('#9a2918', 100); // terracotta
  });
  return colors;
}
