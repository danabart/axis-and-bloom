// Ella's Bloom Map 2 (2026-11-10), C1 — the map's face as one SVG. Built once
// here (not in the admin folder) because brief 3 reuses it as the customer
// picture. Tap only: a dot is a button; nothing rotates or drags.
// Colours are the brand's archetype tokens (bloomVisuals) on the dial's paper
// beige; geometry lives in mapGeometry.ts. The component types in no label:
// names come from the placements and the seams from dial_seam.
import { useId } from 'react';
import { ARCHETYPE_VISUALS } from '../bloomVisuals';
import {
  VIEW, faceGeometry, layoutDots, sectorPath, wedgeSpan, pointAt, ringRadius, shortLabel, labelAnchor,
  type PlacementGeo, type WedgeGeo,
} from './mapGeometry';

export interface FacePlacement extends PlacementGeo {
  coffee_name: string;
  is_sellable: boolean;
}
export interface FaceSeam { archetype_a: string; archetype_b: string; label: string | null; is_labelled: boolean }
export interface FaceWedge extends WedgeGeo { archetype_name?: string }
export interface FaceHop { to_coffee_id: number; relation: string }
/** Ella map 5: one decided step between two coffees, drawn with its basis's line style (dial_step_basis.line_style). */
export interface FaceStep { from_coffee_id: number; to_coffee_id: number; line_style: string }

export interface EllaMapFaceProps {
  placements: FacePlacement[];
  /** dial_wedge rows (angle_order and sides): the face's own config */
  wedges: FaceWedge[];
  /** dial_seam rows; labelled seams are printed on their boundary */
  seams?: FaceSeam[];
  highlightCoffeeId?: number | null;
  /** the highlighted coffee's hop set, drawn as lines from it */
  hops?: FaceHop[];
  /** Ella map 3: coffee ids in order, joined by one line (the trail); ids not on the face are skipped */
  path?: number[];
  size: 'thumb' | 'full';
  /**
   * What is printed beside each dot: 'name' (the coffee's name, cut short; the
   * full name is the dot's tooltip and the tap target) or 'none'. Defaults to
   * 'name' on the full face and 'none' on the thumb. Grades are not drawn on
   * the face; they live in the placement table.
   */
  labelMode?: 'name' | 'none';
  onTapCoffee?: (coffeeId: number) => void;
  /**
   * Ella map 5: decided steps, one line per pair of coffees (a step and its
   * way back share one line), drawn under the dots. Pairs not on the face are skipped.
   */
  steps?: FaceStep[];
  /**
   * Ella map 5: what a dashed dot means. 'sellable' (default, every customer
   * use): a coffee that is not sellable is dimmed and dashed. 'size' (the
   * admin decided map): a coffee with no size is a dashed outline; sellability
   * is not drawn.
   */
  dotStyle?: 'sellable' | 'size';
  /**
   * Ella map 7 (the customer page): coffee ids the highlighted coffee points
   * at, each drawn as an arrow from it and named. Ids not on the face are skipped.
   */
  arrowsTo?: number[];
  /**
   * Ella map 7: only the highlighted coffee and the arrows' coffees are named
   * and drawn in colour; every other placed coffee is a small quiet dot with no
   * name (not even a tooltip). Off by default: the admin face is unchanged.
   */
  quietOthers?: boolean;
}

const PAPER = 'rgb(242, 241, 234)'; // BloomDial's beige (fillEngine BEIGE)
const INK = '#3f3a36';
const colorOf = (code: string) => ARCHETYPE_VISUALS[code]?.color ?? INK;
const tintOf = (code: string) => ARCHETYPE_VISUALS[code]?.tint ?? '#e7e5e4';
const HOP_DASH: Record<string, string | undefined> = { bolder: undefined, gentler: '10 8', different: '3 7', sibling: '1 5' };
// Ella map 5: dial_step_basis.line_style -> SVG dash (chrome: the style words come from the API)
export const STEP_DASH: Record<string, string | undefined> = { solid: undefined, dashed: '14 9', dotted: '2 8' };
const ARROW = '#2f6f68'; // Ella map 7: the customer's steps (chrome)
// where the family names are drawn (and where the customer face's coffee names keep clear of them)
const FAMILY_FONT = 26, FAMILY_OFFSET = 52, CENTER_FONT = 22, CENTER_OFFSET = 26;

export default function EllaMapFace({ placements, wedges, seams = [], highlightCoffeeId = null, hops = [], path = [], size, labelMode, onTapCoffee, steps = [], dotStyle = 'sellable', arrowsTo = [], quietOthers = false }: EllaMapFaceProps) {
  const markerId = `ella-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const arrowSet = new Set(arrowsTo);
  const g = faceGeometry(VIEW);
  const full = size === 'full';
  const labels = (labelMode ?? (full ? 'name' : 'none')) === 'name';
  const dots = layoutDots(g, placements, wedges);
  const byId = new Map(placements.map(p => [p.coffee_id, p]));
  const dotById = new Map(dots.map(d => [d.coffee_id, d]));
  const byArchetype = Object.fromEntries(wedges.map(w => [w.archetype_code, w]));
  const center = wedges.find(w => w.is_center);
  const outerWedges = wedges.filter(w => !w.is_center);
  const from = highlightCoffeeId !== null ? dotById.get(highlightCoffeeId) : undefined;
  // Ella map 7: on the customer face only a few coffees are named, so each name
  // takes the first spot beside its dot that overlaps no other name or named dot.
  const QUIET_FONT = 22;
  const quietLabels = new Map<number, { x: number; y: number; anchor: 'start' | 'end' | 'middle'; text: string }>();
  if (quietOthers) {
    type Box = { x0: number; x1: number; y0: number; y1: number };
    const named = dots.filter(d => d.coffee_id === highlightCoffeeId || arrowSet.has(d.coffee_id))
      .sort((a, b) => Number(b.coffee_id === highlightCoffeeId) - Number(a.coffee_id === highlightCoffeeId));
    const boxes: Box[] = named.map(d => ({ x0: d.x - d.r - 4, x1: d.x + d.r + 4, y0: d.y - d.r - 4, y1: d.y + d.r + 4 }));
    // 2026-11-26 (Ella map 13 fix): a coffee's name never covers a family's name. The family names
    // (and the centre's) are placed first, exactly where they are drawn below; this runs on the
    // customer face only (quietOthers), so the admin face's labels are unchanged.
    const textBox = (x: number, y: number, text: string, size: number): Box => {
      const w = text.length * size * 0.6, h = size + 6;
      return { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
    };
    if (full) {
      for (const w of outerWedges) {
        const [a0, a1] = wedgeSpan(w.angle_order);
        const p = pointAt(g, (a0 + a1) / 2, g.outer + FAMILY_OFFSET);
        boxes.push(textBox(p.x, p.y, w.archetype_name ?? w.archetype_code, FAMILY_FONT));
      }
      if (center) boxes.push(textBox(g.cx, g.cy + g.center + CENTER_OFFSET - CENTER_FONT * 0.35, (center as FaceWedge).archetype_name ?? center.archetype_code, CENTER_FONT));
    }
    const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    for (const d of named) {
      const text = shortLabel(byId.get(d.coffee_id)!.coffee_name, 22);
      const w = text.length * QUIET_FONT * 0.55, h = QUIET_FONT + 4, gap = d.r + 10;
      const cands: Array<{ x: number; y: number; anchor: 'start' | 'end' | 'middle' }> = [
        { x: d.x + gap, y: d.y, anchor: 'start' }, { x: d.x - gap, y: d.y, anchor: 'end' },
        { x: d.x, y: d.y - gap - h / 2, anchor: 'middle' }, { x: d.x, y: d.y + gap + h / 2, anchor: 'middle' },
        { x: d.x + gap, y: d.y - gap, anchor: 'start' }, { x: d.x + gap, y: d.y + gap, anchor: 'start' },
        { x: d.x - gap, y: d.y - gap, anchor: 'end' }, { x: d.x - gap, y: d.y + gap, anchor: 'end' },
        { x: d.x, y: d.y - gap - h * 1.6, anchor: 'middle' }, { x: d.x, y: d.y + gap + h * 1.6, anchor: 'middle' },
      ];
      const boxOf = (c: { x: number; y: number; anchor: string }): Box => {
        const x0 = c.anchor === 'start' ? c.x : c.anchor === 'end' ? c.x - w : c.x - w / 2;
        return { x0, x1: x0 + w, y0: c.y - h / 2, y1: c.y + h / 2 };
      };
      const fits = (b: Box) => b.x0 >= 0 && b.x1 <= VIEW && b.y0 >= 0 && b.y1 <= VIEW && !boxes.some(o => hit(o, b));
      const pick = cands.find(c => fits(boxOf(c))) ?? cands[0];
      boxes.push(boxOf(pick));
      quietLabels.set(d.coffee_id, { ...pick, text });
    }
  }

  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="Ella's Bloom Map"
      style={{ width: full ? '100%' : 160, height: 'auto', maxWidth: full ? 760 : 160, display: 'block', background: PAPER, borderRadius: 12, fontFamily: 'Lato, sans-serif' }}>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW} />
        </marker>
      </defs>
      {/* wedges */}
      {outerWedges.map(w => (
        <path key={w.archetype_code} d={sectorPath(g, w.angle_order)} fill={tintOf(w.archetype_code)} fillOpacity={0.35}
          stroke={colorOf(w.archetype_code)} strokeOpacity={0.5} strokeWidth={2} />
      ))}
      {/* rings 1 and 2 outer edges (ring 3's is the sector edge) */}
      {[1, 2].map(r => (
        <circle key={r} cx={g.cx} cy={g.cy} r={ringRadius(g, r) + g.ringWidth / 2} fill="none" stroke={INK} strokeOpacity={0.15} strokeWidth={2} />
      ))}
      {/* center disc */}
      {center && <circle cx={g.cx} cy={g.cy} r={g.center} fill={tintOf(center.archetype_code)} fillOpacity={0.6} stroke={colorOf(center.archetype_code)} strokeWidth={2} />}

      {/* family names and labelled seams (full only) */}
      {full && outerWedges.map(w => {
        const [a0, a1] = wedgeSpan(w.angle_order);
        const p = pointAt(g, (a0 + a1) / 2, g.outer + FAMILY_OFFSET);
        return <text key={`n-${w.archetype_code}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
          fontSize={FAMILY_FONT} fontWeight={700} fill={colorOf(w.archetype_code)}>{w.archetype_name ?? w.archetype_code}</text>;
      })}
      {full && center && (
        <text x={g.cx} y={g.cy + g.center + CENTER_OFFSET} textAnchor="middle" fontSize={CENTER_FONT} fontWeight={700} fill={colorOf(center.archetype_code)}>
          {(center as FaceWedge).archetype_name ?? center.archetype_code}
        </text>
      )}
      {full && seams.filter(s => s.is_labelled && s.label).map(s => {
        const a = byArchetype[s.archetype_a], b = byArchetype[s.archetype_b];
        if (!a || !b || a.is_center || b.is_center) return null;
        const [a0, a1] = wedgeSpan(a.angle_order), [b0, b1] = wedgeSpan(b.angle_order);
        const norm = (x: number) => ((x % 360) + 360) % 360;
        const boundary = norm(a0) === norm(b1) ? a0 : norm(a1) === norm(b0) ? a1 : null;
        if (boundary === null) return null;
        const p = pointAt(g, boundary, g.outer + 18);
        return <text key={`s-${s.archetype_a}-${s.archetype_b}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
          fontSize={19} fontStyle="italic" fill={INK} fillOpacity={0.7}>{s.label}</text>;
      })}

      {/* Ella map 5: decided steps, one line per pair, under the dots */}
      {(() => {
        const seen = new Set<string>();
        return steps.map(st => {
          const key = [st.from_coffee_id, st.to_coffee_id].sort((x, y) => x - y).join('-');
          if (seen.has(key)) return null;
          seen.add(key);
          const a = dotById.get(st.from_coffee_id), b = dotById.get(st.to_coffee_id);
          if (!a || !b) return null;
          const lit = highlightCoffeeId !== null && (st.from_coffee_id === highlightCoffeeId || st.to_coffee_id === highlightCoffeeId);
          return <line key={`st-${key}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} data-step={key}
            stroke={INK} strokeOpacity={lit ? 0.85 : 0.5} strokeWidth={lit ? 4 : 3} strokeLinecap="round" strokeDasharray={STEP_DASH[st.line_style]} />;
        });
      })()}

      {/* the highlighted coffee's hops */}
      {from && hops.map(h => {
        const to = dotById.get(h.to_coffee_id);
        if (!to) return null;
        return <line key={`h-${h.relation}-${h.to_coffee_id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
          stroke={INK} strokeOpacity={0.55} strokeWidth={3} strokeDasharray={HOP_DASH[h.relation]} />;
      })}

      {/* Ella map 7: the customer's steps, an arrow from their dot to each */}
      {from && arrowsTo.map(id => {
        const to = dotById.get(id);
        if (!to || to.coffee_id === from.coffee_id) return null;
        const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
        const start = from.r + 6, end = len - to.r - 10;
        if (end <= start) return null;
        return <line key={`a-${id}`} data-arrow={id} x1={from.x + dx / len * start} y1={from.y + dy / len * start}
          x2={from.x + dx / len * end} y2={from.y + dy / len * end}
          stroke={ARROW} strokeWidth={5} strokeLinecap="round" markerEnd={`url(#${markerId})`} />;
      })}

      {/* the trail: the dots joined in order */}
      {(() => {
        const pts = path.map(id => dotById.get(id)).filter((d): d is NonNullable<typeof d> => !!d);
        return pts.length > 1
          ? <polyline points={pts.map(d => `${d.x},${d.y}`).join(' ')} fill="none" stroke={INK} strokeOpacity={0.45} strokeWidth={full ? 4 : 8} strokeLinejoin="round" strokeLinecap="round" />
          : null;
      })()}

      {/* dots */}
      {dots.map(d => {
        const p = byId.get(d.coffee_id)!;
        const highlighted = d.coffee_id === highlightCoffeeId;
        const color = colorOf(p.archetype_code);
        const tap = onTapCoffee ? () => onTapCoffee(d.coffee_id) : undefined;
        if (quietOthers && !highlighted && !arrowSet.has(d.coffee_id)) {
          // Ella map 7: a quiet, unnamed dot
          return <circle key={d.coffee_id} cx={d.x} cy={d.y} r={Math.max(6, d.r * 0.55)} fill={INK} fillOpacity={0.18} data-quiet="1" />;
        }
        return (
          <g key={d.coffee_id} role={tap ? 'button' : undefined} tabIndex={tap ? 0 : undefined} aria-label={p.coffee_name}
            style={{ cursor: tap ? 'pointer' : 'default' }} onClick={tap}
            onKeyDown={tap ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } } : undefined}>
            <title>{p.coffee_name}</title>
            {highlighted && <circle cx={d.x} cy={d.y} r={d.r + 9} fill="none" stroke={quietOthers ? ARROW : INK} strokeWidth={4} />}
            {(() => {
              // Ella map 7: the customer face draws every named coffee solid (no price is the card's business)
              const solid = quietOthers || (dotStyle === 'size' ? p.size !== null && p.size !== undefined : p.is_sellable);
              return dotStyle === 'size' && !solid
                ? <circle cx={d.x} cy={d.y} r={d.r} fill={PAPER} stroke={color} strokeWidth={3} strokeDasharray="4 4" />
                : <circle cx={d.x} cy={d.y} r={d.r} fill={color} fillOpacity={solid ? 1 : 0.3}
                    stroke={solid ? '#fff' : color} strokeWidth={3} strokeDasharray={solid ? undefined : '4 4'} />;
            })()}
            {labels && quietLabels.has(d.coffee_id) && (() => {
              const q = quietLabels.get(d.coffee_id)!;
              return <text x={q.x} y={q.y} textAnchor={q.anchor} dominantBaseline="middle" fontSize={QUIET_FONT} fontWeight={700}
                fill={highlighted ? ARROW : INK} stroke={PAPER} strokeWidth={5} paintOrder="stroke" strokeLinejoin="round">{q.text}</text>;
            })()}
            {labels && !quietOthers && (() => {
              const a = labelAnchor(d, highlighted ? 16 : 6);
              return <text x={a.x} y={a.y} textAnchor={a.anchor} dominantBaseline="middle" fontSize={17} fontWeight={700}
                fill={color} stroke={PAPER} strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{shortLabel(p.coffee_name)}</text>;
            })()}
          </g>
        );
      })}
    </svg>
  );
}
