// Ella's Bloom Map 2 (2026-11-10), C1 — the face's legend: the three dot
// sizes with their words (dial_size via the vocabulary read) and the family
// colours. Words come from the props; nothing is typed in.
import { ARCHETYPE_VISUALS } from '../bloomVisuals';
import { dotRadius } from './mapGeometry';

export interface LegendSize { code: number; label: string; customer_label?: string | null }
export interface LegendFamily { archetype_code: string; archetype_name?: string }

/** Ella map 5: a step basis's line on the admin face (dial_step_basis). */
export interface LegendLine { code: string; label: string; line_style: string }

export default function EllaMapLegend({ sizes, families, customer = false, lines, noSizeLabel }: {
  sizes: LegendSize[]; families: LegendFamily[]; customer?: boolean;
  /** Ella map 5 (admin): the step lines, one per basis */
  lines?: LegendLine[];
  /** Ella map 5 (admin): the words beside the dashed dot (no size) */
  noSizeLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-stone-700">
      {lines && lines.length > 0 && (
        <span className="flex flex-wrap items-center gap-3">
          {lines.map(l => (
            <span key={l.code} className="inline-flex items-center gap-1.5">
              <svg width={34} height={8} aria-hidden="true">
                <line x1={2} y1={4} x2={32} y2={4} stroke="#3f3a36" strokeWidth={2.5} strokeLinecap="round"
                  strokeDasharray={l.line_style === 'dashed' ? '7 4' : l.line_style === 'dotted' ? '1 4' : undefined} />
              </svg>
              {l.label}
            </span>
          ))}
        </span>
      )}
      <span className="flex items-center gap-3">
        {sizes.map(s => {
          const r = dotRadius(s.code) / 2;
          return (
            <span key={s.code} className="inline-flex items-center gap-1.5">
              <svg width={r * 2 + 2} height={r * 2 + 2} aria-hidden="true"><circle cx={r + 1} cy={r + 1} r={r} fill="#78716c" /></svg>
              {customer ? s.customer_label ?? s.label : s.label}
            </span>
          );
        })}
        {noSizeLabel && (
          <span className="inline-flex items-center gap-1.5">
            <svg width={14} height={14} aria-hidden="true"><circle cx={7} cy={7} r={5.5} fill="none" stroke="#78716c" strokeWidth={1.5} strokeDasharray="2 2" /></svg>
            {noSizeLabel}
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-3">
        {families.map(f => (
          <span key={f.archetype_code} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: ARCHETYPE_VISUALS[f.archetype_code]?.color ?? '#3f3a36' }} />
            {f.archetype_name ?? f.archetype_code}
          </span>
        ))}
      </span>
    </div>
  );
}
