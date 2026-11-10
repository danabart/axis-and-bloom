// Ella's Bloom Map 2 (2026-11-10), C1 — the face's legend: the three dot
// sizes with their words (dial_size via the vocabulary read) and the family
// colours. Words come from the props; nothing is typed in.
import { ARCHETYPE_VISUALS } from '../bloomVisuals';
import { dotRadius } from './mapGeometry';

export interface LegendSize { code: number; label: string; customer_label?: string | null }
export interface LegendFamily { archetype_code: string; archetype_name?: string }

export default function EllaMapLegend({ sizes, families, customer = false }: {
  sizes: LegendSize[]; families: LegendFamily[]; customer?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-stone-700">
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
