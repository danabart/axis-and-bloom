// Website 5 (2026-11-05): the family tint set the flower wheel and the field
// draw with, computed from the archetype colour by the handoff's one rule
// (source/bloom-b tints(): the colour mixed into paper at .72 / .56 / .40,
// inner ring to outer, always lighter than the field). Nothing per family is
// typed here; the Balanced ink/accent override lives in archetypeConfig.

const PAPER = '#f1efe5';

function hex(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** `a` mixed into `b` at proportion `p` of `a` (the handoff's mix()). */
export function mix(a: string, b: string, p: number): string {
  const A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v * p + B[i] * (1 - p))).join(',')})`;
}

/** [inner, middle, outer] petal tints for a family colour. */
export function tints(color: string): [string, string, string] {
  return [mix(color, PAPER, 0.72), mix(color, PAPER, 0.56), mix(color, PAPER, 0.4)];
}
