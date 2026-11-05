import { PETALS, type Petal } from '../bloom/wheel/wheelGeometry';
import { mix } from '../bloom/wheel/tints';

// Website 6 (2026-11-05): The Axis's family wheel (03 Network) and readers
// wheel (04). The geometry is Website 5's flower-wheel asset (the handoff's
// build.py scraped the same 27 petals from bloom-b at build time; nothing is
// scraped here), taken in angle order. What it shows is data: one segment per
// coffee of each family (GET /api/axis/stats archetypes[].coffeeCount), then
// one hollow segment per Experimental coffee, the rest left open.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_6_THE_AXIS.md

const PAPER = '#f1efe5';

/** The petals in angle order (build.py: SEGS sorted by data-ang). */
export const SEGMENTS: Petal[] = [...PETALS].sort((a, b) => a.ang - b.ang);

/** The readers wheel draws three petals only (build.py readers(): angles 306, 54, 162). */
export const READER_ANGLES = [306, 54, 162];

/** The handoff's family fills by ring: t40 / t60 / t80, the colour mixed into paper at .4 / .56 / .72. */
export function tierFill(color: string, tier: number): string {
  return mix(color, PAPER, [0.4, 0.56, 0.72][tier] ?? 0.4);
}

export type SegmentKind =
  | { kind: 'family'; code: string; color: string }
  | { kind: 'experimental' }
  | { kind: 'open' };

/**
 * One kind per segment, in angle order. Families in the order given (sort_order),
 * each taking as many segments as it has coffees. When the coffees outnumber the
 * segments, each family's share is proportional (largest remainder), and a family
 * with any coffee keeps at least one. Experimental coffees take hollow segments from
 * what is left; the remainder stays open.
 */
export function allocateSegments(
  families: { code: string; color: string; count: number }[],
  experimentalCount: number,
  total = SEGMENTS.length,
): SegmentKind[] {
  const live = families.filter(f => f.count > 0);
  const sum = live.reduce((n, f) => n + f.count, 0);
  let shares: number[];
  if (sum <= total) {
    shares = live.map(f => f.count);
  } else {
    const exact = live.map(f => (f.count / sum) * total);
    shares = exact.map(x => Math.max(1, Math.floor(x)));
    let left = total - shares.reduce((a, b) => a + b, 0);
    const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
    for (let k = 0; left > 0; k = (k + 1) % order.length) { shares[order[k].i]++; left--; }
    // a floor of 1 can overshoot: take back from the largest shares
    while (shares.reduce((a, b) => a + b, 0) > total) {
      const big = shares.indexOf(Math.max(...shares));
      shares[big]--;
    }
  }
  const out: SegmentKind[] = [];
  live.forEach((f, i) => { for (let k = 0; k < shares[i]; k++) out.push({ kind: 'family', code: f.code, color: f.color }); });
  const hollow = Math.min(Math.max(0, experimentalCount), total - out.length);
  for (let k = 0; k < hollow; k++) out.push({ kind: 'experimental' });
  while (out.length < total) out.push({ kind: 'open' });
  return out;
}
