import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface Coffee {
  id: number;
  name: string;
  roaster: string | null;
  origin: string | null;
  process: string | null;
  roast_level: string | null;
  archetype: string | null;
  confidence: string | null;
}

interface WheelRow {
  wheel_category: string;
  descriptor: string;
  source: 'internal' | 'roastery' | 'client';
  mentions: string;
  avg_intensity: string | null;
}

interface DimensionRow {
  dimension: string;
  scale_min_label: string;
  scale_max_label: string;
  avg_min: string;
  avg_max: string;
  session_count: string;
}

interface DescriptorEntry {
  descriptor: string;
  wheel_category: string;
  sources: { source: string; mentions: number }[];
  totalMentions: number;
}

const SOURCE_LABEL: Record<string, string> = {
  internal: 'Internal cupping',
  roastery: 'Roastery notes',
  client:   'Customer feedback',
};

const SOURCE_COLOR: Record<string, string> = {
  internal: '#b05642',
  roastery: '#7c9e87',
  client:   '#8a7cbe',
};

const ARCHETYPE_LABEL: Record<string, string> = {
  chocolate_nutty: 'Chocolate & Nutty',
  balanced_sweet:  'Balanced & Sweet',
  fruity:          'Fruity',
  earthy:          'Earthy',
  floral:          'Floral',
  experimental:    'Experimental',
};

const ARCHETYPE_COLOR: Record<string, string> = {
  chocolate_nutty: '#a54c2d',
  balanced_sweet:  '#c9a830',
  fruity:          '#ca445f',
  earthy:          '#7a6a4f',
  floral:          '#8a7cbe',
  experimental:    '#4a8a6e',
};

function aggregateDescriptors(rows: WheelRow[]): DescriptorEntry[] {
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

// ── Dimension bar ────────────────────────────────────────────────────────────
function DimensionBar({ dim, index }: { dim: DimensionRow; index: number }) {
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
      style={{ gridTemplateColumns: '110px 1fr 72px' }}
    >
      <span className="text-sm text-right truncate" style={{ color: '#5a4a3a' }}>{dim.dimension}</span>
      <div className="relative">
        <div className="h-1.5 rounded-full w-full" style={{ backgroundColor: '#e0dcd4' }} />
        <div
          className="absolute top-0 h-1.5 rounded-full transition-all duration-500"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: '#b05642' }}
        />
        <div className="flex justify-between mt-1.5">
          <span className="text-xs" style={{ color: '#b8b0a4' }}>{dim.scale_min_label}</span>
          <span className="text-xs" style={{ color: '#b8b0a4' }}>{dim.scale_max_label}</span>
        </div>
      </div>
      <span className="text-sm font-light tabular-nums" style={{ color: '#b05642' }}>
        {min}–{max}<span className="text-xs opacity-40">/15</span>
      </span>
    </motion.div>
  );
}

// ── Bubble cloud ─────────────────────────────────────────────────────────────
function BubbleCloud({ entries, activeSources }: { entries: DescriptorEntry[]; activeSources: string[] }) {
  if (!entries.length) return null;
  const maxMentions = Math.max(...entries.map(d => d.totalMentions), 1);

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {entries.map((entry, i) => {
        const t = Math.sqrt(entry.totalMentions / maxMentions);
        const size = Math.round(44 + t * 104); // 44px → 148px
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
              width: size,
              height: size,
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CoffeesPage() {
  const [coffees, setCoffees]               = useState<Coffee[]>([]);
  const [selectedId, setSelectedId]         = useState<number | null>(null);
  const [wheelRows, setWheelRows]           = useState<WheelRow[]>([]);
  const [dimensions, setDimensions]         = useState<DimensionRow[]>([]);
  const [aiSummary, setAiSummary]           = useState<string>('');
  const [summaryCache, setSummaryCache]     = useState<Record<number, string>>({});
  const [loading, setLoading]               = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError]                   = useState('');

  useEffect(() => {
    fetch('/api/coffees')
      .then(r => r.json())
      .then((data: Coffee[]) => { setCoffees(data); if (data.length > 0) setSelectedId(data[0].id); })
      .catch(() => setError('Failed to load coffees'));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setWheelRows([]);
    setDimensions([]);
    setAiSummary(summaryCache[selectedId] ?? '');

    Promise.all([
      fetch(`/api/coffees/${selectedId}/flavor-wheel`).then(r => r.json()),
      fetch(`/api/coffees/${selectedId}/dimensions`).then(r => r.json()),
    ]).then(([wheel, dimData]) => {
      setWheelRows(wheel);
      setDimensions(dimData.dimensions ?? []);
      setLoading(false);

      if (!summaryCache[selectedId]) {
        setSummaryLoading(true);
        fetch(`/api/coffees/${selectedId}/ai-summary`)
          .then(r => r.json())
          .then(data => {
            const text = data.summary ?? '';
            setAiSummary(text);
            setSummaryCache(prev => ({ ...prev, [selectedId]: text }));
          })
          .catch(() => {})
          .finally(() => setSummaryLoading(false));
      }
    }).catch(() => { setError('Failed to load coffee data'); setLoading(false); });
  }, [selectedId]);

  const selectedCoffee = coffees.find(c => c.id === selectedId);
  const descriptorEntries = aggregateDescriptors(wheelRows);
  const activeSources = [...new Set(wheelRows.map(r => r.source))];

  return (
    <div className="w-full min-h-screen" style={{ backgroundColor: '#f2f1ea' }}>

      {/* ── Header ── */}
      <div className="pt-32 pb-16 px-8 md:px-16 max-w-[1400px] mx-auto">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <p className="uppercase tracking-widest text-xs mb-3" style={{ color: '#b05642' }}>Flavor Intelligence</p>
          <h1 className="text-5xl md:text-7xl font-normal leading-tight mb-4" style={{ color: '#b05642', fontFamily: 'Genova, sans-serif' }}>
            Our Coffees
          </h1>
          <p className="text-lg font-light max-w-xl" style={{ color: '#8a8070' }}>
            Flavor notes drawn from roastery descriptions, internal cupping sessions,
            and customer feedback — combined into one picture.
          </p>
        </motion.div>
      </div>

      <div className="px-8 md:px-16 max-w-[1400px] mx-auto pb-32 flex flex-col lg:flex-row gap-12">

        {/* ── Sidebar ── */}
        <motion.aside
          initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
          className="lg:w-64 flex-shrink-0"
        >
          <p className="text-xs uppercase tracking-widest mb-4" style={{ color: '#b05642' }}>
            {coffees.length} coffee{coffees.length !== 1 ? 's' : ''}
          </p>
          <div className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
            {coffees.map(coffee => (
              <button
                key={coffee.id}
                onClick={() => setSelectedId(coffee.id)}
                className="flex-shrink-0 text-left px-4 py-3 rounded-lg border transition-all duration-200"
                style={{
                  borderColor: selectedId === coffee.id ? '#b05642' : '#e0ddd5',
                  backgroundColor: selectedId === coffee.id ? '#fff8f5' : 'transparent',
                }}
              >
                <p className="text-sm font-normal" style={{ color: selectedId === coffee.id ? '#b05642' : '#4a4035' }}>
                  {coffee.name}
                </p>
                {coffee.roaster && <p className="text-xs mt-0.5" style={{ color: '#a09880' }}>{coffee.roaster}</p>}
                {coffee.archetype && (
                  <span className="inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: ARCHETYPE_COLOR[coffee.archetype] ?? '#999' }}>
                    {ARCHETYPE_LABEL[coffee.archetype] ?? coffee.archetype}
                  </span>
                )}
              </button>
            ))}
          </div>
        </motion.aside>

        {/* ── Detail ── */}
        <div className="flex-1 min-w-0">
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

          {selectedCoffee && (
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedCoffee.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}
              >
                {/* Coffee header */}
                <div className="mb-10 pb-6 border-b border-stone-200">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex-1">
                      <h2 className="text-3xl font-normal" style={{ color: '#b05642', fontFamily: 'Genova, sans-serif' }}>
                        {selectedCoffee.name}
                      </h2>
                      <div className="flex flex-wrap gap-3 mt-2 text-sm" style={{ color: '#8a8070' }}>
                        {selectedCoffee.roaster     && <span>{selectedCoffee.roaster}</span>}
                        {selectedCoffee.origin      && <><span>·</span><span>{selectedCoffee.origin}</span></>}
                        {selectedCoffee.process     && <><span>·</span><span>{selectedCoffee.process}</span></>}
                        {selectedCoffee.roast_level && <><span>·</span><span>{selectedCoffee.roast_level}</span></>}
                      </div>
                    </div>
                    {selectedCoffee.archetype && (
                      <span className="px-3 py-1 rounded-full text-sm text-white"
                        style={{ backgroundColor: ARCHETYPE_COLOR[selectedCoffee.archetype] ?? '#999' }}>
                        {ARCHETYPE_LABEL[selectedCoffee.archetype] ?? selectedCoffee.archetype}
                      </span>
                    )}
                  </div>
                </div>

                {loading && (
                  <div className="flex items-center gap-2 py-16 text-stone-400">
                    <div className="w-4 h-4 rounded-full border-2 border-stone-300 border-t-stone-500 animate-spin" />
                    <span className="text-sm">Loading…</span>
                  </div>
                )}

                {!loading && wheelRows.length === 0 && dimensions.length === 0 && (
                  <div className="py-16 text-center" style={{ color: '#a09880' }}>
                    <p className="text-lg mb-1">No tasting data yet</p>
                    <p className="text-sm">Notes will appear here after cupping sessions are recorded.</p>
                  </div>
                )}

                {!loading && (wheelRows.length > 0 || dimensions.length > 0) && (
                  <div className="space-y-14">

                    {/* AI tasting note */}
                    <div className="rounded-xl border px-6 py-5" style={{ borderColor: '#e0dcd4', backgroundColor: '#faf9f5' }}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>Tasting note</span>
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f0ede6', color: '#b05642' }}>AI</span>
                      </div>
                      {summaryLoading ? (
                        <div className="flex items-center gap-2 text-stone-400">
                          <div className="w-3 h-3 rounded-full border-2 border-stone-300 border-t-stone-400 animate-spin" />
                          <span className="text-sm">Generating…</span>
                        </div>
                      ) : aiSummary ? (
                        <p className="text-base font-light leading-relaxed" style={{ color: '#3a3020' }}>{aiSummary}</p>
                      ) : (
                        <p className="text-sm" style={{ color: '#a09880' }}>Not enough data to generate a summary yet.</p>
                      )}
                    </div>

                    {/* Dimension bars */}
                    {dimensions.length > 0 && (
                      <div>
                        <p className="text-xs uppercase tracking-widest mb-6" style={{ color: '#a09880' }}>
                          Cupping profile
                          <span className="ml-2 normal-case" style={{ color: '#c8c0b4' }}>
                            — avg across {dimensions[0]?.session_count} session{Number(dimensions[0]?.session_count) !== 1 ? 's' : ''}
                          </span>
                        </p>
                        <div className="space-y-5">
                          {dimensions.map((dim, i) => <DimensionBar key={dim.dimension} dim={dim} index={i} />)}
                        </div>
                      </div>
                    )}

                    {/* Bubble cloud */}
                    {descriptorEntries.length > 0 && (
                      <div>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6">
                          <p className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>Flavor notes</p>
                          <div className="flex flex-wrap gap-4">
                            {activeSources.map(source => (
                              <div key={source} className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SOURCE_COLOR[source] }} />
                                <span className="text-xs" style={{ color: '#8a8070' }}>{SOURCE_LABEL[source]}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <BubbleCloud entries={descriptorEntries} activeSources={activeSources} />
                      </div>
                    )}

                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
