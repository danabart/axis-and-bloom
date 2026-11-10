// Ella's Bloom Map 2 (2026-11-10), C1 — the map's face as one SVG. Built once
// here (not in the admin folder) because brief 3 reuses it as the customer
// picture. Tap only: a dot is a button; nothing rotates or drags.
// Colours are the brand's archetype tokens (bloomVisuals) on the dial's paper
// beige; geometry lives in mapGeometry.ts. The component types in no label:
// names come from the placements and the seams from dial_seam.
import { ARCHETYPE_VISUALS } from '../bloomVisuals';
import {
  VIEW, faceGeometry, layoutDots, sectorPath, wedgeSpan, pointAt, ringRadius,
  type PlacementGeo, type WedgeGeo,
} from './mapGeometry';

export interface FacePlacement extends PlacementGeo {
  coffee_name: string;
  is_sellable: boolean;
  grade_code?: string | null;
}
export interface FaceSeam { archetype_a: string; archetype_b: string; label: string | null; is_labelled: boolean }
export interface FaceWedge extends WedgeGeo { archetype_name?: string }
export interface FaceHop { to_coffee_id: number; relation: string }

export interface EllaMapFaceProps {
  placements: FacePlacement[];
  /** dial_wedge rows (angle_order and sides): the face's own config */
  wedges: FaceWedge[];
  /** dial_seam rows; labelled seams are printed on their boundary */
  seams?: FaceSeam[];
  highlightCoffeeId?: number | null;
  /** the highlighted coffee's hop set, drawn as lines from it */
  hops?: FaceHop[];
  size: 'thumb' | 'full';
  showGrades?: boolean;
  onTapCoffee?: (coffeeId: number) => void;
}

const PAPER = 'rgb(242, 241, 234)'; // BloomDial's beige (fillEngine BEIGE)
const INK = '#3f3a36';
const colorOf = (code: string) => ARCHETYPE_VISUALS[code]?.color ?? INK;
const tintOf = (code: string) => ARCHETYPE_VISUALS[code]?.tint ?? '#e7e5e4';
const HOP_DASH: Record<string, string | undefined> = { bolder: undefined, gentler: '10 8', different: '3 7', sibling: '1 5' };

export default function EllaMapFace({ placements, wedges, seams = [], highlightCoffeeId = null, hops = [], size, showGrades = false, onTapCoffee }: EllaMapFaceProps) {
  const g = faceGeometry(VIEW);
  const full = size === 'full';
  const dots = layoutDots(g, placements, wedges);
  const byId = new Map(placements.map(p => [p.coffee_id, p]));
  const dotById = new Map(dots.map(d => [d.coffee_id, d]));
  const byArchetype = Object.fromEntries(wedges.map(w => [w.archetype_code, w]));
  const center = wedges.find(w => w.is_center);
  const outerWedges = wedges.filter(w => !w.is_center);
  const from = highlightCoffeeId !== null ? dotById.get(highlightCoffeeId) : undefined;

  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="Ella's Bloom Map"
      style={{ width: full ? '100%' : 160, height: 'auto', maxWidth: full ? 760 : 160, display: 'block', background: PAPER, borderRadius: 12, fontFamily: 'Lato, sans-serif' }}>
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
        const p = pointAt(g, (a0 + a1) / 2, g.outer + 52);
        return <text key={`n-${w.archetype_code}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
          fontSize={26} fontWeight={700} fill={colorOf(w.archetype_code)}>{w.archetype_name ?? w.archetype_code}</text>;
      })}
      {full && center && (
        <text x={g.cx} y={g.cy + g.center + 26} textAnchor="middle" fontSize={22} fontWeight={700} fill={colorOf(center.archetype_code)}>
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

      {/* the highlighted coffee's hops */}
      {from && hops.map(h => {
        const to = dotById.get(h.to_coffee_id);
        if (!to) return null;
        return <line key={`h-${h.relation}-${h.to_coffee_id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
          stroke={INK} strokeOpacity={0.55} strokeWidth={3} strokeDasharray={HOP_DASH[h.relation]} />;
      })}

      {/* dots */}
      {dots.map(d => {
        const p = byId.get(d.coffee_id)!;
        const highlighted = d.coffee_id === highlightCoffeeId;
        const color = colorOf(p.archetype_code);
        const tap = onTapCoffee ? () => onTapCoffee(d.coffee_id) : undefined;
        return (
          <g key={d.coffee_id} role={tap ? 'button' : undefined} tabIndex={tap ? 0 : undefined} aria-label={p.coffee_name}
            style={{ cursor: tap ? 'pointer' : 'default' }} onClick={tap}
            onKeyDown={tap ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } } : undefined}>
            <title>{p.coffee_name}</title>
            {highlighted && <circle cx={d.x} cy={d.y} r={d.r + 9} fill="none" stroke={INK} strokeWidth={4} />}
            <circle cx={d.x} cy={d.y} r={d.r} fill={color} fillOpacity={p.is_sellable ? 1 : 0.3}
              stroke={p.is_sellable ? '#fff' : color} strokeWidth={3} strokeDasharray={p.is_sellable ? undefined : '4 4'} />
            {full && showGrades && p.grade_code && (
              <text x={d.x + d.r + 4} y={d.y - d.r} fontSize={18} fontWeight={700} fill={INK}>{p.grade_code}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
