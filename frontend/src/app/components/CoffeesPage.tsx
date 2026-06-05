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
  coffee_name: string;
  wheel_category: string;
  wheel_subcategory: string | null;
  descriptor: string;
  source: 'internal' | 'roastery' | 'client';
  mentions: string;
  avg_intensity: string | null;
}

interface DescriptorEntry {
  descriptor: string;
  wheel_category: string;
  wheel_subcategory: string | null;
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

// Aggregate rows into per-descriptor entries (combining sources)
function aggregateDescriptors(rows: WheelRow[]): Record<string, DescriptorEntry[]> {
  const map: Record<string, DescriptorEntry> = {};
  for (const row of rows) {
    const key = `${row.wheel_category}__${row.descriptor}`;
    if (!map[key]) {
      map[key] = {
        descriptor: row.descriptor,
        wheel_category: row.wheel_category,
        wheel_subcategory: row.wheel_subcategory,
        sources: [],
        totalMentions: 0,
      };
    }
    map[key].sources.push({ source: row.source, mentions: Number(row.mentions) });
    map[key].totalMentions += Number(row.mentions);
  }

  // Group by category
  const byCategory: Record<string, DescriptorEntry[]> = {};
  for (const entry of Object.values(map)) {
    (byCategory[entry.wheel_category] ??= []).push(entry);
  }
  // Sort each category by total mentions
  for (const cat of Object.values(byCategory)) {
    cat.sort((a, b) => b.totalMentions - a.totalMentions);
  }
  return byCategory;
}

export default function CoffeesPage() {
  const [coffees, setCoffees]       = useState<Coffee[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rows, setRows]             = useState<WheelRow[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    fetch('/api/coffees')
      .then(r => r.json())
      .then((data: Coffee[]) => {
        setCoffees(data);
        if (data.length > 0) setSelectedId(data[0].id);
      })
      .catch(() => setError('Failed to load coffees'));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setRows([]);
    fetch(`/api/coffees/${selectedId}/flavor-wheel`)
      .then(r => r.json())
      .then(data => { setRows(data); setLoading(false); })
      .catch(() => { setError('Failed to load flavor data'); setLoading(false); });
  }, [selectedId]);

  const selectedCoffee = coffees.find(c => c.id === selectedId);

  // Stats
  const totalMentions  = rows.reduce((s, r) => s + Number(r.mentions), 0);
  const uniqueDescs    = new Set(rows.map(r => r.descriptor)).size;
  const sourceCounts   = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + Number(r.mentions); return acc;
  }, {});
  const topDescriptors = Object.values(
    rows.reduce<Record<string, { descriptor: string; source: string; total: number }>>((acc, r) => {
      if (!acc[r.descriptor]) acc[r.descriptor] = { descriptor: r.descriptor, source: r.source, total: 0 };
      acc[r.descriptor].total += Number(r.mentions);
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total).slice(0, 5);

  const byCategory = aggregateDescriptors(rows);
  const categoryOrder = ['Sweet', 'Fruity', 'Floral', 'Nutty / Cocoa', 'Roasted', 'Spices', 'Sour / Fermented', 'Green / Vegetative', 'Other'];
  const sortedCategories = [
    ...categoryOrder.filter(c => byCategory[c]),
    ...Object.keys(byCategory).filter(c => !categoryOrder.includes(c)),
  ];

  return (
    <div className="w-full min-h-screen" style={{ backgroundColor: '#f2f1ea' }}>

      {/* ── Header ── */}
      <div className="pt-32 pb-16 px-8 md:px-16 max-w-[1400px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          <p className="uppercase tracking-widest text-xs mb-3" style={{ color: '#b05642' }}>
            Flavor Intelligence
          </p>
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

        {/* ── Coffee list (sidebar) ── */}
        <motion.aside
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
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
                {coffee.roaster && (
                  <p className="text-xs mt-0.5" style={{ color: '#a09880' }}>{coffee.roaster}</p>
                )}
                {coffee.archetype && (
                  <span
                    className="inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: ARCHETYPE_COLOR[coffee.archetype] ?? '#999' }}
                  >
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
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4 }}
              >
                {/* Coffee header */}
                <div className="mb-8 pb-6 border-b border-stone-200">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex-1">
                      <h2 className="text-3xl font-normal" style={{ color: '#b05642', fontFamily: 'Genova, sans-serif' }}>
                        {selectedCoffee.name}
                      </h2>
                      <div className="flex flex-wrap gap-3 mt-2 text-sm" style={{ color: '#8a8070' }}>
                        {selectedCoffee.roaster   && <span>{selectedCoffee.roaster}</span>}
                        {selectedCoffee.origin    && <><span>·</span><span>{selectedCoffee.origin}</span></>}
                        {selectedCoffee.process   && <><span>·</span><span>{selectedCoffee.process}</span></>}
                        {selectedCoffee.roast_level && <><span>·</span><span>{selectedCoffee.roast_level}</span></>}
                      </div>
                    </div>
                    {selectedCoffee.archetype && (
                      <span
                        className="px-3 py-1 rounded-full text-sm text-white"
                        style={{ backgroundColor: ARCHETYPE_COLOR[selectedCoffee.archetype] ?? '#999' }}
                      >
                        {ARCHETYPE_LABEL[selectedCoffee.archetype] ?? selectedCoffee.archetype}
                      </span>
                    )}
                  </div>
                </div>

                {loading && (
                  <div className="flex items-center gap-2 py-12 text-stone-400">
                    <div className="w-4 h-4 rounded-full border-2 border-stone-300 border-t-stone-500 animate-spin" />
                    <span className="text-sm">Loading flavor data…</span>
                  </div>
                )}

                {!loading && rows.length === 0 && (
                  <div className="py-16 text-center" style={{ color: '#a09880' }}>
                    <p className="text-lg mb-1">No flavor notes yet</p>
                    <p className="text-sm">Cupping notes will appear here after sessions are recorded.</p>
                  </div>
                )}

                {!loading && rows.length > 0 && (
                  <>
                    {/* ── Stats ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
                      <div className="rounded-xl border border-stone-200 px-4 py-4 bg-white/50">
                        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#a09880' }}>Mentions</p>
                        <p className="text-3xl font-light" style={{ color: '#b05642' }}>{totalMentions}</p>
                      </div>
                      <div className="rounded-xl border border-stone-200 px-4 py-4 bg-white/50">
                        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#a09880' }}>Descriptors</p>
                        <p className="text-3xl font-light" style={{ color: '#b05642' }}>{uniqueDescs}</p>
                      </div>
                      {(['internal', 'roastery', 'client'] as const).filter(s => sourceCounts[s]).map(source => (
                        <div key={source} className="rounded-xl border border-stone-200 px-4 py-4 bg-white/50">
                          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#a09880' }}>
                            {SOURCE_LABEL[source].split(' ')[0]}
                          </p>
                          <p className="text-3xl font-light" style={{ color: SOURCE_COLOR[source] }}>
                            {sourceCounts[source]}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* ── Source legend ── */}
                    <div className="flex flex-wrap gap-4 mb-8">
                      {(['internal', 'roastery', 'client'] as const).filter(s => sourceCounts[s]).map(source => (
                        <div key={source} className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_COLOR[source] }} />
                          <span className="text-sm" style={{ color: '#6a6050' }}>{SOURCE_LABEL[source]}</span>
                        </div>
                      ))}
                    </div>

                    {/* ── Top descriptors ── */}
                    {topDescriptors.length > 0 && (
                      <div className="mb-10">
                        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#a09880' }}>Most mentioned</p>
                        <div className="flex flex-wrap gap-2">
                          {topDescriptors.map(d => (
                            <span
                              key={d.descriptor}
                              className="px-3 py-1.5 rounded-full text-sm text-white font-light"
                              style={{ backgroundColor: SOURCE_COLOR[d.source] }}
                            >
                              {d.descriptor}
                              <span className="ml-1.5 opacity-75 text-xs">×{d.total}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Descriptor categories ── */}
                    <div className="space-y-8">
                      {sortedCategories.map((category, ci) => (
                        <motion.div
                          key={category}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4, delay: ci * 0.06 }}
                        >
                          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#a09880' }}>
                            {category}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {byCategory[category].map(entry => (
                              <div
                                key={entry.descriptor}
                                className="flex items-center gap-1.5 rounded-full border px-3 py-1.5"
                                style={{ borderColor: '#e0ddd5', backgroundColor: '#faf9f5' }}
                              >
                                <span className="text-sm font-light" style={{ color: '#3a3020' }}>
                                  {entry.descriptor}
                                </span>
                                {/* Source dots — one per source this descriptor appears in */}
                                <span className="flex gap-0.5 ml-1">
                                  {entry.sources.map(s => (
                                    <span
                                      key={s.source}
                                      className="w-2 h-2 rounded-full"
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
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
