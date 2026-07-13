import { useState } from 'react';
import { motion } from 'motion/react';

export interface WheelRow {
  wheel_category: string;
  descriptor: string;
  source: 'internal' | 'roastery' | 'client';
  mentions: string;
  avg_intensity: string | null;
}

export interface DescriptorEntry {
  descriptor: string;
  wheel_category: string;
  sources: { source: string; mentions: number; avgIntensity: number | null }[];
  totalMentions: number;
  /** Mentions-weighted average intensity across sources; null if no source ever reported an intensity for this descriptor. */
  avgIntensity: number | null;
}

export const SOURCE_LABEL: Record<string, string> = {
  internal: 'Internal cupping',
  roastery: 'Roastery notes',
  client:   'Customer feedback',
};

export const SOURCE_COLOR: Record<string, string> = {
  internal: '#b05642',
  roastery: '#7c9e87',
  client:   '#8a7cbe',
};

export function aggregateDescriptors(rows: WheelRow[]): DescriptorEntry[] {
  const map: Record<string, DescriptorEntry & { weightedSum: number; weightedCount: number }> = {};
  for (const row of rows) {
    const mentions = Number(row.mentions);
    const intensity = row.avg_intensity != null ? Number(row.avg_intensity) : null;
    if (!map[row.descriptor]) {
      map[row.descriptor] = {
        descriptor: row.descriptor, wheel_category: row.wheel_category,
        sources: [], totalMentions: 0, avgIntensity: null, weightedSum: 0, weightedCount: 0,
      };
    }
    const entry = map[row.descriptor];
    entry.sources.push({ source: row.source, mentions, avgIntensity: intensity });
    entry.totalMentions += mentions;
    if (intensity != null) {
      entry.weightedSum += intensity * mentions;
      entry.weightedCount += mentions;
    }
  }
  return Object.values(map)
    .map(({ weightedSum, weightedCount, ...entry }) => ({
      ...entry,
      avgIntensity: weightedCount > 0 ? weightedSum / weightedCount : null,
    }))
    .sort((a, b) => (b.avgIntensity ?? 0) - (a.avgIntensity ?? 0));
}

export interface CategoryGroup {
  category: string;
  entries: DescriptorEntry[];
  maxIntensity: number;
}

/** Groups already-aggregated descriptors by their SCA wheel_category. Entries within a
 * group, and the groups themselves, are ordered by avgIntensity — the "how dominant is
 * this note" signal — not raw mention count. */
export function groupByCategory(entries: DescriptorEntry[]): CategoryGroup[] {
  const map: Record<string, DescriptorEntry[]> = {};
  for (const entry of entries) {
    (map[entry.wheel_category] ??= []).push(entry);
  }
  return Object.entries(map)
    .map(([category, categoryEntries]) => {
      const sorted = categoryEntries.sort((a, b) => (b.avgIntensity ?? 0) - (a.avgIntensity ?? 0));
      return { category, entries: sorted, maxIntensity: sorted[0]?.avgIntensity ?? 0 };
    })
    .sort((a, b) => b.maxIntensity - a.maxIntensity);
}

// Entries with no captured intensity still render, at a fixed short floor width, so they
// read as "present but unconfirmed" rather than absent or arbitrarily sized.
const NO_INTENSITY_FLOOR_RATIO = 0.2;
const MIN_BAR_WIDTH_PCT = 8;
const VISIBLE_PER_CATEGORY = 5;

function DescriptorBar({ entry, maxIntensity, index }: { entry: DescriptorEntry; maxIntensity: number; index: number }) {
  const value = entry.avgIntensity ?? maxIntensity * NO_INTENSITY_FLOOR_RATIO;
  const widthPct = Math.max((value / maxIntensity) * 100, MIN_BAR_WIDTH_PCT);
  const sourcesPresent = [...new Set(entry.sources.map(s => s.source))];
  const barColor = SOURCE_COLOR[sourcesPresent[0]] ?? '#b05642';

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs" style={{ color: '#5a4a3a' }}>{entry.descriptor}</span>
        <div className="flex gap-0.5">
          {sourcesPresent.map(s => (
            <span key={s} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SOURCE_COLOR[s] }} title={SOURCE_LABEL[s]} />
          ))}
        </div>
      </div>
      <div className="h-1.5 rounded-full w-full" style={{ backgroundColor: '#e0dcd4' }}>
        <motion.div
          className="h-1.5 rounded-full"
          style={{ backgroundColor: barColor }}
          initial={{ width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={{ duration: 0.5, delay: index * 0.04 + 0.1 }}
        />
      </div>
    </motion.div>
  );
}

/** One SCA-category group of descriptor bars, capped to VISIBLE_PER_CATEGORY with a
 * "+N more" expand toggle — both the bar length/scale and the count shown by default
 * favor the dominant note over the long tail of minor ones. */
function CategoryBarGroup({ group, maxIntensity }: { group: CategoryGroup; maxIntensity: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.entries : group.entries.slice(0, VISIBLE_PER_CATEGORY);
  const hiddenCount = group.entries.length - VISIBLE_PER_CATEGORY;

  return (
    <div>
      <p className="text-xs mb-2.5" style={{ color: '#b8b0a4' }}>{group.category}</p>
      <div className="space-y-3">
        {visible.map((entry, i) => (
          <DescriptorBar key={entry.descriptor} entry={entry} maxIntensity={maxIntensity} index={i} />
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs mt-2 hover:underline"
          style={{ color: '#a09880' }}
        >
          {expanded ? 'Show less ←' : `+${hiddenCount} more, less prominent →`}
        </button>
      )}
    </div>
  );
}

interface CollaborativeFlavorWheelProps {
  wheelRows: WheelRow[];
  compareWheelRows?: WheelRow[] | null;
  primaryLabel?: string;
  compareLabel?: string;
}

/** All descriptor bars for one coffee, grouped into labeled SCA-category sub-sections.
 * Bar length is relative to this coffee's own single strongest note (computed across all
 * categories, before grouping) — never a fixed scale and never a number — so the dominant
 * character reads as unmistakably dominant. */
function GroupedDescriptorBars({ entries }: { entries: DescriptorEntry[] }) {
  if (!entries.length) return null;
  const maxIntensity = Math.max(...entries.map(e => e.avgIntensity ?? 0), 1);
  const groups = groupByCategory(entries);
  return (
    <div className="space-y-6">
      {groups.map(group => (
        <CategoryBarGroup key={group.category} group={group} maxIntensity={maxIntensity} />
      ))}
    </div>
  );
}

/** "Collaborative Flavor Wheel" — descriptor intensity bars, grouped into labeled
 * sub-sections by SCA wheel_category — single coffee, or side-by-side when
 * compareWheelRows is passed. No numbers/percentages/mention counts anywhere; bar
 * length alone carries the "how dominant is this note" signal. */
export function CollaborativeFlavorWheel({ wheelRows, compareWheelRows, primaryLabel, compareLabel }: CollaborativeFlavorWheelProps) {
  const entries = aggregateDescriptors(wheelRows);
  const compareEntries = compareWheelRows ? aggregateDescriptors(compareWheelRows) : [];
  const activeSources = [...new Set(wheelRows.map(r => r.source))];
  if (!entries.length) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6">
        <p className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>Collaborative Flavor Wheel</p>
        <div className="flex flex-wrap gap-4">
          {activeSources.map(source => (
            <div key={source} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SOURCE_COLOR[source] }} />
              <span className="text-xs" style={{ color: '#8a8070' }}>{SOURCE_LABEL[source]}</span>
            </div>
          ))}
        </div>
      </div>
      {compareWheelRows && compareEntries.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div>
            <p className="text-xs mb-4" style={{ color: '#a09880' }}>{primaryLabel}</p>
            <GroupedDescriptorBars entries={entries} />
          </div>
          <div>
            <p className="text-xs mb-4" style={{ color: '#a09880' }}>{compareLabel}</p>
            <GroupedDescriptorBars entries={compareEntries} />
          </div>
        </div>
      ) : (
        <GroupedDescriptorBars entries={entries} />
      )}
    </div>
  );
}
