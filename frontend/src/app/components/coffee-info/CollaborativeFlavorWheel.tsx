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
  sources: { source: string; mentions: number }[];
  totalMentions: number;
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
  const map: Record<string, DescriptorEntry> = {};
  for (const row of rows) {
    if (!map[row.descriptor]) {
      map[row.descriptor] = { descriptor: row.descriptor, wheel_category: row.wheel_category, sources: [], totalMentions: 0 };
    }
    map[row.descriptor].sources.push({ source: row.source, mentions: Number(row.mentions) });
    map[row.descriptor].totalMentions += Number(row.mentions);
  }
  return Object.values(map).sort((a, b) => b.totalMentions - a.totalMentions);
}

export interface CategoryGroup {
  category: string;
  entries: DescriptorEntry[];
  totalMentions: number;
}

/** Groups already-aggregated descriptors by their SCA wheel_category, sorted by total mentions within and across categories. */
export function groupByCategory(entries: DescriptorEntry[]): CategoryGroup[] {
  const map: Record<string, DescriptorEntry[]> = {};
  for (const entry of entries) {
    (map[entry.wheel_category] ??= []).push(entry);
  }
  return Object.entries(map)
    .map(([category, categoryEntries]) => ({
      category,
      entries: categoryEntries.sort((a, b) => b.totalMentions - a.totalMentions),
      totalMentions: categoryEntries.reduce((sum, e) => sum + e.totalMentions, 0),
    }))
    .sort((a, b) => b.totalMentions - a.totalMentions);
}

function BubbleCloud({ entries }: { entries: DescriptorEntry[] }) {
  if (!entries.length) return null;
  const maxMentions = Math.max(...entries.map(d => d.totalMentions), 1);
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {entries.map((entry, i) => {
        const t = Math.sqrt(entry.totalMentions / maxMentions);
        const size = Math.round(44 + t * 104);
        const primarySource = [...entry.sources].sort((a, b) => b.mentions - a.mentions)[0].source;
        const color = SOURCE_COLOR[primarySource] ?? '#b05642';
        const fontSize = Math.max(9, Math.min(13, Math.round(size / 7.5)));
        return (
          <motion.div
            key={entry.descriptor}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45, delay: i * 0.03, type: 'spring', stiffness: 160, damping: 14 }}
            className="rounded-full flex items-center justify-center text-center flex-shrink-0 cursor-default select-none"
            style={{
              width: size, height: size,
              backgroundColor: color + '16',
              border: `1.5px solid ${color}55`,
              color,
            }}
            title={`${entry.descriptor} · ${entry.totalMentions} mention${entry.totalMentions !== 1 ? 's' : ''} · ${entry.sources.map(s => SOURCE_LABEL[s.source]).join(', ')}`}
          >
            <span className="leading-tight font-light px-2" style={{ fontSize, wordBreak: 'break-word' }}>
              {entry.descriptor}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

interface CollaborativeFlavorWheelProps {
  wheelRows: WheelRow[];
  compareWheelRows?: WheelRow[] | null;
  primaryLabel?: string;
  compareLabel?: string;
}

function GroupedBubbleClouds({ entries }: { entries: DescriptorEntry[] }) {
  const groups = groupByCategory(entries);
  return (
    <div className="space-y-6">
      {groups.map(group => (
        <div key={group.category}>
          <p className="text-xs mb-2.5" style={{ color: '#b8b0a4' }}>{group.category}</p>
          <BubbleCloud entries={group.entries} />
        </div>
      ))}
    </div>
  );
}

/** "Collaborative Flavor Wheel" descriptor bubble cloud, grouped into labeled
 * sub-sections by SCA wheel_category — single coffee, or side-by-side when
 * compareWheelRows is passed. */
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
            <GroupedBubbleClouds entries={entries} />
          </div>
          <div>
            <p className="text-xs mb-4" style={{ color: '#a09880' }}>{compareLabel}</p>
            <GroupedBubbleClouds entries={compareEntries} />
          </div>
        </div>
      ) : (
        <GroupedBubbleClouds entries={entries} />
      )}
    </div>
  );
}
