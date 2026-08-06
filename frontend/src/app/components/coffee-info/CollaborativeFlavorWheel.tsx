import { useState } from 'react';
import { motion } from 'motion/react';

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
  return Object.values(map)
    .map(({ weightedSum, weightedCount, ...entry }) => ({
      ...entry,
      avgIntensity: weightedCount > 0 ? weightedSum / weightedCount : null,
    }))
    .sort((a, b) => b.totalMentions - a.totalMentions);
}

export interface CategoryGroup {
  category: string;
  entries: DescriptorEntry[];
  maxMentions: number;
}

/** Groups already-aggregated descriptors by their SCA wheel_category. Entries within a
 * group, and the groups themselves, are ordered by totalMentions — how often/widely a note
 * was observed reads as real, visible bar-length variation; avgIntensity values cluster too
 * tightly together (cuppers mostly only note a descriptor when it's already reasonably
 * present) to differentiate bar length on their own — see Part 6. */
export function groupByCategory(entries: DescriptorEntry[]): CategoryGroup[] {
  const map: Record<string, DescriptorEntry[]> = {};
  for (const entry of entries) {
    (map[entry.wheel_category] ??= []).push(entry);
  }
  return Object.entries(map)
    .map(([category, categoryEntries]) => {
      const sorted = categoryEntries.sort((a, b) => b.totalMentions - a.totalMentions);
      return { category, entries: sorted, maxMentions: sorted[0]?.totalMentions ?? 0 };
    })
    .sort((a, b) => b.maxMentions - a.maxMentions);
}

// Dominance-clarity band (Part 8) — deliberately not the full 0–100% range. Per Dana:
// "accuracy here is not important, what's important is creating a clear visual
// understanding about the dominance of each note." The strongest note should never look
// "maxed out" (flush to the row's end) and the weakest visible note should still read as
// genuinely minor, not just "somewhat smaller." Starting numbers, explicitly tunable.
const MIN_BAR_WIDTH_PCT = 5;
const MAX_BAR_WIDTH_PCT = 75;
const VISIBLE_PER_CATEGORY = 5;
// Used when a descriptor has mentions but no source ever recorded an intensity for it —
// renders at a neutral mid-thickness rather than looking artificially thin or thick.
const INTENSITY_DEFAULT_RATIO = 0.6;

// Min-max normalization (not relative-to-max-only) — stretches whatever spread of mention
// counts actually exists for this coffee across the full [MIN,MAX] band, so the top and
// bottom note are always clearly, visibly different regardless of how close or far apart
// the raw numbers happen to be. Computed once across all entries, before category grouping
// and the VISIBLE_PER_CATEGORY cap, so expanding "+N more" never shifts the scale of bars
// already on screen.
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
      <p className="text-xs mb-1" style={{ color: '#5a4a3a' }}>{entry.descriptor}</p>
      {/* Sharp rectangle, not a rounded pill (Part 6). Segmented by each source's share of
          mentions — the bar itself shows the three-source blend, not a single flat color
          with dots next to the label (Part 8). */}
      <div className="w-full" style={{ height: barHeightPx, backgroundColor: '#e0dcd4' }}>
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

/** One SCA-category group of descriptor bars, capped to VISIBLE_PER_CATEGORY with a
 * "+N more" expand toggle — both the bar length/scale and the count shown by default
 * favor the dominant note over the long tail of minor ones. */
function CategoryBarGroup({ group, minMentions, maxMentions }: { group: CategoryGroup; minMentions: number; maxMentions: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.entries : group.entries.slice(0, VISIBLE_PER_CATEGORY);
  const hiddenCount = group.entries.length - VISIBLE_PER_CATEGORY;

  return (
    <div>
      <p className="text-xs mb-2.5" style={{ color: '#b8b0a4' }}>{group.category}</p>
      <div className="space-y-3">
        {visible.map((entry, i) => (
          <DescriptorBar key={entry.descriptor} entry={entry} minMentions={minMentions} maxMentions={maxMentions} index={i} />
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

// Part 13 (reveal-panel redesign) — "Signature notes" default. Strength ranks every
// descriptor across all categories, independent of the bar-width normalization above
// (which stays mention-count-based, computed across all entries, so the expander never
// rescales the top-5 bars already on screen). 9 = INTENSITY_DEFAULT_RATIO (0.6) × 15, the
// same neutral mid-thickness fallback used when a descriptor has no recorded intensity.
const SIGNATURE_COUNT = 5;
function computeStrength(entry: DescriptorEntry): number {
  return entry.totalMentions * ((entry.avgIntensity ?? INTENSITY_DEFAULT_RATIO * 15) / 15);
}

/** Reveal-panel descriptor row (Part 13) — brand colors/track. `showCategory` prints the
 * `· {wheel_category}` tag inline (the flat top-5 list, which has no group header of its
 * own); the grouped tail omits it since its category header already says so. */
function DescriptorBarReveal({ entry, minMentions, maxMentions, index, showCategory }: { entry: DescriptorEntry; minMentions: number; maxMentions: number; index: number; showCategory: boolean }) {
  const widthPct = computeWidthPct(entry, minMentions, maxMentions);
  const intensityRatio = entry.avgIntensity != null ? Math.min(entry.avgIntensity / 15, 1) : INTENSITY_DEFAULT_RATIO;
  const barHeightPx = 6 + intensityRatio * 6; // 6px (low intensity) to 12px (high intensity)

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      className="mb-[11px]"
    >
      <p className="text-[12px] mb-1" style={{ color: '#45474a', fontWeight: 400 }}>
        {entry.descriptor}
        {showCategory && (
          <span className="ml-1" style={{ fontSize: 10, letterSpacing: '.06em', color: '#b3b0a6' }}>· {entry.wheel_category}</span>
        )}
      </p>
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

/** "Signature notes" — top 5 descriptors by strength (totalMentions × intensity ratio),
 * flat, no category groups. The remaining entries sit behind a "The quieter notes"
 * expander, grouped by category (today's grouped view, minus the per-category "+N more"
 * — this is already the tail, no further nested expansion). No expander at all when there
 * are ≤5 entries total. Width normalization is computed once across ALL entries (top 5 +
 * tail) before either split, so expanding never rescales the bars already visible. */
function SignatureNotes({ entries }: { entries: DescriptorEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!entries.length) return null;

  const mentionCounts = entries.map(e => e.totalMentions);
  const minMentions = Math.min(...mentionCounts);
  const maxMentions = Math.max(...mentionCounts, 1);

  const strengthSorted = [...entries].sort((a, b) => computeStrength(b) - computeStrength(a));
  const top = strengthSorted.slice(0, SIGNATURE_COUNT);
  const topKeys = new Set(top.map(e => e.descriptor));
  const tail = entries.filter(e => !topKeys.has(e.descriptor));
  const tailGroups = groupByCategory(tail);

  return (
    <div>
      <div>
        {top.map((entry, i) => (
          <DescriptorBarReveal key={entry.descriptor} entry={entry} minMentions={minMentions} maxMentions={maxMentions} index={i} showCategory />
        ))}
      </div>
      {tail.length > 0 && expanded && (
        <div className="mt-2">
          {tailGroups.map(group => (
            <div key={group.category}>
              <p className="mt-5 first:mt-0 mb-[10px]" style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: '#b3b0a6' }}>
                {group.category}
              </p>
              {group.entries.map((entry, i) => (
                <DescriptorBarReveal key={entry.descriptor} entry={entry} minMentions={minMentions} maxMentions={maxMentions} index={i} showCategory={false} />
              ))}
            </div>
          ))}
        </div>
      )}
      {tail.length > 0 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-4"
          style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: '#ee5974', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {expanded ? 'Show less ↑' : 'The quieter notes ↓'}
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
  /** Reveal-panel "Signature notes" default (Part 13) — top-5-by-strength flat list with a
   * "The quieter notes" expander for the grouped tail. Default 'grouped' preserves today's
   * rendering byte-for-byte (CompareOverlay and FlavorIntelligencePage, which must stay as
   * -is). Compare mode (compareWheelRows set) always renders the grouped/compare
   * presentation regardless of variant — 'signature' never carries a comparison. */
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
        <SignatureNotes entries={entries} />
      </div>
    );
  }

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
