import { motion } from 'motion/react';
import { SignatureLine } from './SignatureLine';

export interface WheelRow {
  wheel_category: string;
  descriptor: string;
  source: 'internal' | 'roastery' | 'client';
  mentions: string;
  avg_intensity: string | null;
  /** Profile Part 2 §C — chip vocabulary for the on-site feedback form's
   * tasted-notes chips (Part 3). Optional/additive: existing consumers of this
   * endpoint/type never read it. */
  cupping_note_id?: string;
  /** Coffee presentation brief 1 (2026-10-23): the rows arrive qualified,
   * capped and in display order (signature, then accent); these say how. */
  family?: string | null;
  is_signature?: boolean;
  display_order?: number | null;
  group_order?: number | null;
  confirmed_by_cupping?: boolean;
}

export interface DescriptorEntry {
  descriptor: string;
  wheel_category: string;
  sources: { source: string; mentions: number; avgIntensity: number | null }[];
  totalMentions: number;
  /** Mentions-weighted average intensity across sources; null if no source ever reported an intensity for this descriptor. */
  avgIntensity: number | null;
}

/** Part 13 (reveal-panel redesign) — customer-facing copy warms up ("Our cupping table" /
 * "The roastery" / "Drinkers like you"). Admin's Flavor Wheel page defines its own separate
 * `SOURCE_LABELS` constant (AdminFlavorWheel.tsx) rather than importing this one, so this
 * change doesn't touch admin wording. */
export const SOURCE_LABEL: Record<string, string> = {
  internal: 'Our cupping table',
  roastery: 'The roastery',
  client:   'Drinkers like you',
};

/** Part 13 — accessibility fix: the prior green/purple pair failed a color-vision
 * distinguishability check and sat outside the brand palette. New triad is CVD-safe and
 * brand-derived (deep red / petrol / dark gold). Propagates everywhere this constant is
 * imported (TastingNotes' legend, this file's own legend + descriptor-bar fills) —
 * intended. Admin's Flavor Wheel page defines its own separate `SOURCE_COLORS` constant
 * and is unaffected; out of scope for this pass. */
export const SOURCE_COLOR: Record<string, string> = {
  internal: '#9a2918',
  roastery: '#006e9c',
  client:   '#8f7410',
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
  // Coffee presentation brief 1: no re-sort; entries keep the order the rows
  // arrived in (the read's display_order).
  return Object.values(map)
    .map(({ weightedSum, weightedCount, ...entry }) => ({
      ...entry,
      avgIntensity: weightedCount > 0 ? weightedSum / weightedCount : null,
    }));
}

export interface CategoryGroup {
  category: string;
  entries: DescriptorEntry[];
  maxMentions: number;
}

/** Groups already-aggregated descriptors by their SCA wheel_category. Coffee presentation
 * brief 1 (2026-10-23): entries keep the order they arrived in (the read's display_order)
 * and groups appear in the order of their first entry; nothing is re-ranked here. */
export function groupByCategory(entries: DescriptorEntry[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  for (const entry of entries) {
    let group = groups.find(g => g.category === entry.wheel_category);
    if (!group) { group = { category: entry.wheel_category, entries: [], maxMentions: 0 }; groups.push(group); }
    group.entries.push(entry);
    group.maxMentions = Math.max(group.maxMentions, entry.totalMentions);
  }
  return groups;
}

// Dominance-clarity band (Part 8) — deliberately not the full 0–100% range. Per Dana:
// "accuracy here is not important, what's important is creating a clear visual
// understanding about the dominance of each note." The strongest note should never look
// "maxed out" (flush to the row's end) and the weakest visible note should still read as
// genuinely minor, not just "somewhat smaller." Starting numbers, explicitly tunable.
const MIN_BAR_WIDTH_PCT = 5;
const MAX_BAR_WIDTH_PCT = 75;
// Used when a descriptor has mentions but no source ever recorded an intensity for it —
// renders at a neutral mid-thickness rather than looking artificially thin or thick.
const INTENSITY_DEFAULT_RATIO = 0.6;

// Min-max normalization (not relative-to-max-only) — stretches whatever spread of mention
// counts actually exists for this coffee across the full [MIN,MAX] band, so the top and
// bottom note are always clearly, visibly different regardless of how close or far apart
// the raw numbers happen to be. Computed once across all entries, before category grouping.
function computeWidthPct(entry: DescriptorEntry, minMentions: number, maxMentions: number): number {
  if (maxMentions === minMentions) return MAX_BAR_WIDTH_PCT; // only one distinct value present — treat as dominant, not ambiguous
  const ratio = (entry.totalMentions - minMentions) / (maxMentions - minMentions);
  return MIN_BAR_WIDTH_PCT + ratio * (MAX_BAR_WIDTH_PCT - MIN_BAR_WIDTH_PCT);
}

function DescriptorBar({ entry, minMentions, maxMentions, index }: { entry: DescriptorEntry; minMentions: number; maxMentions: number; index: number }) {
  const widthPct = computeWidthPct(entry, minMentions, maxMentions);
  const intensityRatio = entry.avgIntensity != null ? Math.min(entry.avgIntensity / 15, 1) : INTENSITY_DEFAULT_RATIO;
  const barHeightPx = 6 + intensityRatio * 6; // 6px (low intensity) to 12px (high intensity)

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
    >
      <p className="text-xs mb-1" style={{ color: '#45474a' }}>{entry.descriptor}</p>
      {/* Sharp rectangle, not a rounded pill (Part 6). Segmented by each source's share of
          mentions — the bar itself shows the three-source blend, not a single flat color
          with dots next to the label (Part 8). */}
      <div className="w-full" style={{ height: barHeightPx, backgroundColor: '#f2f1ea' }}>
        <motion.div
          className="flex"
          style={{ height: '100%' }}
          initial={{ width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={{ duration: 0.5, delay: index * 0.04 + 0.1 }}
        >
          {entry.sources.map(s => (
            <div
              key={s.source}
              style={{ width: `${(s.mentions / entry.totalMentions) * 100}%`, height: '100%', backgroundColor: SOURCE_COLOR[s.source] }}
            />
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}

/** One SCA-category group of descriptor bars. Coffee presentation brief 1 (2026-10-23):
 * no per-category cap or "+N more" toggle here; the read already capped the rows by the
 * evidence parameters, so every row it returns is drawn. */
function CategoryBarGroup({ group, minMentions, maxMentions }: { group: CategoryGroup; minMentions: number; maxMentions: number }) {
  return (
    <div>
      <p className="mb-2.5" style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: '#b3b0a6' }}>{group.category}</p>
      <div className="space-y-3">
        {group.entries.map((entry, i) => (
          <DescriptorBar key={entry.descriptor} entry={entry} minMentions={minMentions} maxMentions={maxMentions} index={i} />
        ))}
      </div>
    </div>
  );
}

interface CollaborativeFlavorWheelProps {
  wheelRows: WheelRow[];
  compareWheelRows?: WheelRow[] | null;
  primaryLabel?: string;
  compareLabel?: string;
  /** Reveal-panel "Signature notes" (coffee presentation brief 1, 2026-10-23): one line of
   * the signature notes and a lighter "a hint of …" clause per accent family
   * (SignatureLine), no bars. Default 'grouped' keeps the bars (CompareOverlay and
   * FlavorIntelligencePage) over the same rows in the same order. Compare mode
   * (compareWheelRows set) always renders the grouped/compare presentation regardless of
   * variant — 'signature' never carries a comparison. */
  variant?: 'grouped' | 'signature';
}

/** All descriptor bars for one coffee, grouped into labeled SCA-category sub-sections.
 * Bar length is relative to this coffee's own most-mentioned note (computed across all
 * categories, before grouping) — never a fixed scale and never a number — so the dominant
 * character reads as unmistakably dominant. Bar thickness carries intensity as a secondary
 * signal (Part 6). */
function GroupedDescriptorBars({ entries }: { entries: DescriptorEntry[] }) {
  if (!entries.length) return null;
  const mentionCounts = entries.map(e => e.totalMentions);
  const minMentions = Math.min(...mentionCounts);
  const maxMentions = Math.max(...mentionCounts, 1);
  const groups = groupByCategory(entries);
  return (
    <div className="space-y-6">
      {groups.map(group => (
        <CategoryBarGroup key={group.category} group={group} minMentions={minMentions} maxMentions={maxMentions} />
      ))}
    </div>
  );
}

/** "Collaborative Flavor Wheel" — descriptor bars, grouped into labeled sub-sections by
 * SCA wheel_category — single coffee, or side-by-side when compareWheelRows is passed.
 * No numbers/percentages/mention counts anywhere; bar length (mentions) and thickness
 * (intensity) alone carry the "how dominant is this note" signal. */
export function CollaborativeFlavorWheel({ wheelRows, compareWheelRows, primaryLabel, compareLabel, variant = 'grouped' }: CollaborativeFlavorWheelProps) {
  const entries = aggregateDescriptors(wheelRows);
  const compareEntries = compareWheelRows ? aggregateDescriptors(compareWheelRows) : [];
  const activeSources = [...new Set(wheelRows.map(r => r.source))];
  if (!entries.length) return null;

  if (variant === 'signature' && !compareWheelRows) {
    return (
      <div>
        <p className="mb-[18px]" style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: '#7b7f80', fontWeight: 400 }}>
          Signature notes
        </p>
        <SignatureLine rows={wheelRows} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6">
        <p className="text-[10px] uppercase tracking-[.18em]" style={{ color: '#7b7f80', fontWeight: 400 }}>Collaborative Flavor Wheel</p>
        <div className="flex flex-wrap gap-4">
          {activeSources.map(source => (
            <div key={source} className="flex items-center gap-1.5">
              <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: SOURCE_COLOR[source] }} />
              <span className="text-[11px]" style={{ color: '#7b7f80' }}>{SOURCE_LABEL[source]}</span>
            </div>
          ))}
        </div>
      </div>
      {compareWheelRows && compareEntries.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div>
            <p className="text-xs mb-4" style={{ color: '#7b7f80' }}>{primaryLabel}</p>
            <GroupedDescriptorBars entries={entries} />
          </div>
          <div>
            <p className="text-xs mb-4" style={{ color: '#7b7f80' }}>{compareLabel}</p>
            <GroupedDescriptorBars entries={compareEntries} />
          </div>
        </div>
      ) : (
        <GroupedDescriptorBars entries={entries} />
      )}
    </div>
  );
}
