import { motion } from 'motion/react';

export interface DimensionRow {
  dimension: string;
  scale_min_label: string;
  scale_max_label: string;
  avg_min: string;
  avg_max: string;
  session_count?: string;
}

function DimensionBar({ dim, index, compareDim }: { dim: DimensionRow; index: number; compareDim?: DimensionRow | null }) {
  const min = Number(dim.avg_min);
  const max = Number(dim.avg_max);
  const leftPct  = (min / 15) * 100;
  const widthPct = Math.max(((max - min) / 15) * 100, 2);

  const hasCmp = !!compareDim;
  const cMin = hasCmp ? Number(compareDim!.avg_min) : 0;
  const cMax = hasCmp ? Number(compareDim!.avg_max) : 0;
  const cLeftPct  = (cMin / 15) * 100;
  const cWidthPct = Math.max(((cMax - cMin) / 15) * 100, 2);

  const midA = (min + max) / 2;
  const midB = hasCmp ? (cMin + cMax) / 2 : 0;
  const isDivergent = hasCmp && Math.abs(midA - midB) > 3;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      className="grid items-center gap-4"
      style={{ gridTemplateColumns: '110px 1fr 72px' }}
    >
      <span className="text-sm text-right truncate" style={{ color: '#5a4a3a' }}>{dim.dimension}</span>
      <div className="relative flex flex-col gap-1">
        {/* Primary coffee bar — sharp rectangle, matching the descriptor bars (Part 7). */}
        <div className="relative">
          <div className="h-1.5 w-full" style={{ backgroundColor: '#e0dcd4' }} />
          <div
            className="absolute top-0 h-1.5 transition-all duration-500"
            style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: '#b05642' }}
          />
        </div>
        {/* Comparison coffee bar */}
        {hasCmp && (
          <div className="relative">
            <div className="h-1.5 w-full" style={{ backgroundColor: '#e0dcd4' }} />
            <div
              className="absolute top-0 h-1.5 transition-all duration-500"
              style={{
                left: `${cLeftPct}%`,
                width: `${cWidthPct}%`,
                backgroundColor: isDivergent ? '#c9a830' : '#7c9e87',
              }}
            />
          </div>
        )}
        {!hasCmp && (
          <div className="flex justify-between mt-1">
            <span className="text-xs" style={{ color: '#b8b0a4' }}>{dim.scale_min_label}</span>
            <span className="text-xs" style={{ color: '#b8b0a4' }}>{dim.scale_max_label}</span>
          </div>
        )}
        {hasCmp && isDivergent && (
          <span className="text-[10px] mt-0.5" style={{ color: '#c9a830' }}>Notable difference</span>
        )}
      </div>
      <span className="text-sm font-light tabular-nums" style={{ color: '#b05642' }}>
        {min}–{max}<span className="text-xs opacity-40">/15</span>
      </span>
    </motion.div>
  );
}

/** Merges two dimension lists by name, preserving primary's order then appending compare-only rows. */
export function mergeDimensions(primary: DimensionRow[], compare: DimensionRow[]) {
  const mapA = new Map(primary.map(d => [d.dimension, d]));
  const mapB = new Map(compare.map(d => [d.dimension, d]));
  const order = primary.map(d => d.dimension);
  const rest  = [...mapB.keys()].filter(k => !mapA.has(k));
  return [...order, ...rest].map(name => ({ name, a: mapA.get(name) ?? null, b: mapB.get(name) ?? null }));
}

/** Reveal-panel trimmed row (Part 13) — no numeric column, no scale-label wraparound below
 * a session caption; just name · track · scale end-labels. Same entrance animation as
 * DimensionBar. */
function DimensionBarReveal({ dim, index }: { dim: DimensionRow; index: number }) {
  const min = Number(dim.avg_min);
  const max = Number(dim.avg_max);
  const leftPct  = (min / 15) * 100;
  const widthPct = Math.max(((max - min) / 15) * 100, 2);

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      className="grid items-center gap-4"
      style={{ gridTemplateColumns: '88px 1fr' }}
    >
      <span className="text-[12px] text-right" style={{ color: '#45474a', fontWeight: 400 }}>{dim.dimension}</span>
      <div>
        <div className="relative">
          <div className="h-[5px] w-full" style={{ backgroundColor: '#f2f1ea' }} />
          <div
            className="absolute top-0 h-[5px] transition-all duration-500"
            style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: '#9a2918' }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px]" style={{ color: '#b3b0a6' }}>{dim.scale_min_label}</span>
          <span className="text-[10px]" style={{ color: '#b3b0a6' }}>{dim.scale_max_label}</span>
        </div>
      </div>
    </motion.div>
  );
}

interface DimensionBarsProps {
  dimensions: DimensionRow[];
  compareDimensions?: DimensionRow[] | null;
  primaryLabel?: string;
  compareLabel?: string;
  /** Reveal-panel trimmed presentation (Part 13) — no numbers, no session-count caption,
   * brand colors/track. Default 'default' preserves today's rendering byte-for-byte
   * (CompareOverlay and FlavorIntelligencePage, which must stay as-is). Compare mode
   * (compareDimensions set) always renders the default/compare presentation regardless
   * of variant — 'reveal' never carries a comparison. */
  variant?: 'default' | 'reveal';
}

/** "Cupping profile" section — single-coffee bars, or side-by-side comparison when compareDimensions is passed. */
export function DimensionBars({ dimensions, compareDimensions, primaryLabel, compareLabel, variant = 'default' }: DimensionBarsProps) {
  const isCompare = !!compareDimensions;
  if (!dimensions.length && !(compareDimensions?.length)) return null;

  if (variant === 'reveal' && !isCompare) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-[.18em] mb-[18px]" style={{ color: '#7b7f80', fontWeight: 400 }}>
          Cupping profile
        </p>
        <div className="space-y-4">
          {dimensions.map((dim, i) => <DimensionBarReveal key={dim.dimension} dim={dim} index={i} />)}
        </div>
      </div>
    );
  }

  const merged = isCompare ? mergeDimensions(dimensions, compareDimensions!) : [];

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <p className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>
          Cupping profile
          {!isCompare && dimensions[0]?.session_count && (
            <span className="ml-2 normal-case" style={{ color: '#c8c0b4' }}>
              — avg across {dimensions[0].session_count} session{Number(dimensions[0].session_count) !== 1 ? 's' : ''}
            </span>
          )}
        </p>
        {isCompare && (
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-1.5 inline-block" style={{ backgroundColor: '#b05642' }} />
              <span style={{ color: '#8a8070' }}>{primaryLabel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-1.5 inline-block" style={{ backgroundColor: '#7c9e87' }} />
              <span style={{ color: '#8a8070' }}>{compareLabel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-1.5 inline-block" style={{ backgroundColor: '#c9a830' }} />
              <span style={{ color: '#8a8070' }}>Notable difference</span>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-5">
        {isCompare
          ? merged.map((row, i) => row.a ? <DimensionBar key={row.name} dim={row.a} index={i} compareDim={row.b} /> : null)
          : dimensions.map((dim, i) => <DimensionBar key={dim.dimension} dim={dim} index={i} />)
        }
      </div>
    </div>
  );
}
