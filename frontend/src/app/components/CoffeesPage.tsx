import { useEffect, useState, useRef } from 'react';
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
  wheel_subcategory: string | null;
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

interface SessionNote {
  overall_notes: string;
  session_date: string;
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

function aggregateDescriptors(rows: WheelRow[]): Record<string, DescriptorEntry[]> {
  const map: Record<string, DescriptorEntry> = {};
  for (const row of rows) {
    const key = `${row.wheel_category}__${row.descriptor}`;
    if (!map[key]) {
      map[key] = { descriptor: row.descriptor, wheel_category: row.wheel_category, sources: [], totalMentions: 0 };
    }
    map[key].sources.push({ source: row.source, mentions: Number(row.mentions) });
    map[key].totalMentions += Number(row.mentions);
  }
  const byCategory: Record<string, DescriptorEntry[]> = {};
  for (const entry of Object.values(map)) {
    (byCategory[entry.wheel_category] ??= []).push(entry);
  }
  for (const cat of Object.values(byCategory)) cat.sort((a, b) => b.totalMentions - a.totalMentions);
  return byCategory;
}

// ── Dimension bar component ──────────────────────────────────────────────────
function DimensionBar({ dim }: { dim: DimensionRow }) {
  const min = Number(dim.avg_min);
  const max = Number(dim.avg_max);
  const leftPct  = (min / 15) * 100;
  const widthPct = Math.max(((max - min) / 15) * 100, 2);

  return (
    <div className="grid items-center gap-3" style={{ gridTemplateColumns: '120px 1fr 80px' }}>
      <span className="text-sm text-right" style={{ color: '#5a4a3a' }}>{dim.dimension}</span>
      <div className="relative">
        <div className="h-2 rounded-full w-full" style={{ backgroundColor: '#e0dcd4' }} />
        <div
          className="absolute top-0 h-2 rounded-full"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: '#b05642' }}
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs" style={{ color: '#a09880' }}>{dim.scale_min_label}</span>
          <span className="text-xs" style={{ color: '#a09880' }}>{dim.scale_max_label}</span>
        </div>
      </div>
      <span className="text-sm font-light tabular-nums" style={{ color: '#b05642' }}>
        {min}–{max}<span className="text-xs opacity-50">/15</span>
      </span>
    </div>
  );
}

export default function CoffeesPage() {
  const [coffees, setCoffees]           = useState<Coffee[]>([]);
  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [wheelRows, setWheelRows]       = useState<WheelRow[]>([]);
  const [dimensions, setDimensions]     = useState<DimensionRow[]>([]);
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);
  const [aiSummary, setAiSummary]       = useState<string>('');
  const [summaryCache, setSummaryCache] = useState<Record<number, string>>({});
  const [loading, setLoading]           = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError]               = useState('');

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
    setSessionNotes([]);
    setAiSummary(summaryCache[selectedId] ?? '');

    Promise.all([
      fetch(`/api/coffees/${selectedId}/flavor-wheel`).then(r => r.json()),
      fetch(`/api/coffees/${selectedId}/dimensions`).then(r => r.json()),
    ]).then(([wheel, dimData]) => {
      setWheelRows(wheel);
      setDimensions(dimData.dimensions ?? []);
      setSessionNotes(dimData.notes ?? []);
      setLoading(false);

      // Fetch AI summary if not cached
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

  // Stats
  const totalMentions  = wheelRows.reduce((s, r) => s + Number(r.mentions), 0);
  const uniqueDescs    = new Set(wheelRows.map(r => r.descriptor)).size;
  const sourceCounts   = wheelRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + Number(r.mentions); return acc;
  }, {});
  const topDescriptors = Object.values(
    wheelRows.reduce<Record<string, { descriptor: string; source: string; total: number }>>((acc, r) => {
      if (!acc[r.descriptor]) acc[r.descriptor] = { descriptor: r.descriptor, source: r.source, total: 0 };
      acc[r.descriptor].total += Number(r.mentions); return acc;
    }, {})
  ).sort((a, b) => b.total - a.total).slice(0, 5);

  const byCategory = aggregateDescriptors(wheelRows);
  const categoryOrder = ['Sweet', 'Fruity', 'Floral', 'Nutty / Cocoa', 'Roasted', 'Spices', 'Sour / Fermented', 'Green / Vegetative', 'Other'];
  const sortedCategories = [
    ...categoryOrder.filter(c => byCategory[c]),
    ...Object.keys(byCategory).filter(c => !categoryOrder.includes(c)),
  ];

  // Separate client feedback descriptors for the dedicated section
  const clientDescriptors = wheelRows.filter(r => r.source === 'client');

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

        {/* ── Coffee list sidebar ── */}
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

        {/* ── Coffee detail ── */}
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
                <div className="mb-8 pb-6 border-b border-stone-200">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex-1">
                      <h2 className="text-3xl font-normal" style={{ color: '#b05642', fontFamily: 'Genova, sans-serif' }}>
                        {selectedCoffee.name}
                      </h2>
                      <div className="flex flex-wrap gap-3 mt-2 text-sm" style={{ color: '#8a8070' }}>
                        {selectedCoffee.roaster    && <span>{selectedCoffee.roaster}</span>}
                        {selectedCoffee.origin     && <><span>·</span><span>{selectedCoffee.origin}</span></>}
                        {selectedCoffee.process    && <><span>·</span><span>{selectedCoffee.process}</span></>}
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
                  <div className="flex items-center gap-2 py-12 text-stone-400">
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
                  <div className="space-y-12">

                    {/* ── AI Summary ── */}
                    <div className="rounded-xl border px-6 py-5" style={{ borderColor: '#e0dcd4', backgroundColor: '#faf9f5' }}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>AI tasting note</span>
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f0ede6', color: '#b05642' }}>Claude</span>
                      </div>
                      {summaryLoading ? (
                        <div className="flex items-center gap-2 text-stone-400">
                          <div className="w-3 h-3 rounded-full border-2 border-stone-300 border-t-stone-400 animate-spin" />
                          <span className="text-sm">Generating…</span>
                        </div>
                      ) : aiSummary ? (
                        <p className="text-base font-light leading-relaxed" style={{ color: '#3a3020' }}>{aiSummary}</p>
                      ) : (
                        <p className="text-sm" style={{ color: '#a09880' }}>Summary unavailable — not enough data yet.</p>
                      )}
                    </div>

                    {/* ── Stats ── */}
                    {wheelRows.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-xl border px-4 py-4 bg-white/50" style={{ borderColor: '#e0dcd4' }}>
                          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#a09880' }}>Mentions</p>
                          <p className="text-3xl font-light" style={{ color: '#b05642' }}>{totalMentions}</p>
                        </div>
                        <div className="rounded-xl border px-4 py-4 bg-white/50" style={{ borderColor: '#e0dcd4' }}>
                          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#a09880' }}>Descriptors</p>
                          <p className="text-3xl font-light" style={{ color: '#b05642' }}>{uniqueDescs}</p>
                        </div>
                        {(['internal', 'roastery', 'client'] as const).filter(s => sourceCounts[s]).map(source => (
                          <div key={source} className="rounded-xl border px-4 py-4 bg-white/50" style={{ borderColor: '#e0dcd4' }}>
                            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#a09880' }}>
                              {SOURCE_LABEL[source].split(' ')[0]}
                            </p>
                            <p className="text-3xl font-light" style={{ color: SOURCE_COLOR[source] }}>{sourceCounts[source]}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── Dimension bars ── */}
                    {dimensions.length > 0 && (
                      <div>
                        <p className="text-xs uppercase tracking-widest mb-6" style={{ color: '#a09880' }}>
                          Cupping profile — average across {dimensions[0]?.session_count} session{Number(dimensions[0]?.session_count) !== 1 ? 's' : ''}
                        </p>
                        <div className="space-y-5">
                          {dimensions.map((dim, i) => (
                            <motion.div
                              key={dim.dimension}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.3, delay: i * 0.05 }}
                            >
                              <DimensionBar dim={dim} />
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Session notes ── */}
                    {sessionNotes.length > 0 && (
                      <div>
                        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#a09880' }}>Cupper's notes</p>
                        <div className="space-y-3">
                          {sessionNotes.map((note, i) => (
                            <div key={i} className="rounded-lg border px-4 py-3" style={{ borderColor: '#e0dcd4', backgroundColor: '#faf9f5' }}>
                              <p className="text-sm font-light leading-relaxed" style={{ color: '#3a3020' }}>{note.overall_notes}</p>
                              <p className="text-xs mt-2" style={{ color: '#a09880' }}>
                                {new Date(note.session_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Top descriptors ── */}
                    {topDescriptors.length > 0 && (
                      <div>
                        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#a09880' }}>Most mentioned</p>
                        <div className="flex flex-wrap gap-2">
                          {topDescriptors.map(d => (
                            <span key={d.descriptor} className="px-3 py-1.5 rounded-full text-sm text-white font-light"
                              style={{ backgroundColor: SOURCE_COLOR[d.source] }}>
                              {d.descriptor}
                              <span className="ml-1.5 opacity-75 text-xs">×{d.total}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Customer feedback ── */}
                    {clientDescriptors.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SOURCE_COLOR.client }} />
                          <p className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>Customer feedback</p>
                          <span className="text-xs" style={{ color: '#a09880' }}>({clientDescriptors.length} notes)</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {clientDescriptors.map((r, i) => (
                            <span key={i} className="px-3 py-1.5 rounded-full text-sm font-light border"
                              style={{ borderColor: SOURCE_COLOR.client, color: SOURCE_COLOR.client, backgroundColor: '#f5f3fc' }}>
                              {r.descriptor}
                              {r.avg_intensity && <span className="ml-1.5 opacity-60 text-xs">intensity {Number(r.avg_intensity).toFixed(0)}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Full descriptor cloud ── */}
                    {sortedCategories.length > 0 && (
                      <div>
                        <div className="flex flex-wrap gap-4 mb-6">
                          {(['internal', 'roastery', 'client'] as const).filter(s => sourceCounts[s]).map(source => (
                            <div key={source} className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLOR[source] }} />
                              <span className="text-sm" style={{ color: '#6a6050' }}>{SOURCE_LABEL[source]}</span>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-8">
                          {sortedCategories.map((category, ci) => (
                            <motion.div key={category}
                              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.35, delay: ci * 0.05 }}
                            >
                              <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#a09880' }}>{category}</p>
                              <div className="flex flex-wrap gap-2">
                                {byCategory[category].map(entry => (
                                  <div key={entry.descriptor}
                                    className="flex items-center gap-1.5 rounded-full border px-3 py-1.5"
                                    style={{ borderColor: '#e0ddd5', backgroundColor: '#faf9f5' }}
                                  >
                                    <span className="text-sm font-light" style={{ color: '#3a3020' }}>{entry.descriptor}</span>
                                    <span className="flex gap-0.5 ml-1">
                                      {entry.sources.map(s => (
                                        <span key={s.source} className="w-2 h-2 rounded-full"
                                          title={`${SOURCE_LABEL[s.source]} (×${s.mentions})`}
                                          style={{ backgroundColor: SOURCE_COLOR[s.source] }}
                                        />
                                      ))}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          ))}
                        </div>
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
