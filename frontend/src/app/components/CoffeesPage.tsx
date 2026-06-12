import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { getUserProfile } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface ContentData {
  aiSummary: string;
  surpriseNote: string | null;
  threeVoiceStory: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

// Adjacent archetypes — used for "Worth exploring" compatibility tier
const ARCHETYPE_ADJACENT: Record<string, string[]> = {
  chocolate_nutty: ['balanced_sweet', 'earthy'],
  balanced_sweet:  ['chocolate_nutty', 'fruity'],
  fruity:          ['balanced_sweet', 'floral', 'experimental'],
  earthy:          ['chocolate_nutty'],
  floral:          ['fruity', 'experimental'],
  experimental:    ['fruity', 'floral'],
};

// Typical cupping score mid-points per archetype (0–15 scale) for dim comparison
const ARCHETYPE_TYPICAL: Record<string, Partial<Record<string, [number, number]>>> = {
  chocolate_nutty: { Sweetness: [5, 8],  Acidity: [2, 5],  Bitterness: [7, 11], Body: [8, 12] },
  balanced_sweet:  { Sweetness: [7, 10], Acidity: [4, 7],  Bitterness: [3, 6],  Body: [5, 8]  },
  fruity:          { Sweetness: [6, 9],  Acidity: [8, 12], Bitterness: [0, 3],  Body: [2, 5]  },
  earthy:          { Sweetness: [3, 6],  Acidity: [2, 5],  Bitterness: [6, 10], Body: [9, 13] },
  floral:          { Sweetness: [6, 9],  Acidity: [7, 11], Bitterness: [0, 3],  Body: [2, 5]  },
  experimental:    { Sweetness: [5, 9],  Acidity: [7, 12], Bitterness: [2, 6],  Body: [4, 8]  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

type CompatLevel = 'wheelhouse' | 'exploring' | 'stretch';

function getCompatibility(coffeeArchetype: string | null, userArchetype: string | null): CompatLevel | null {
  if (!coffeeArchetype || !userArchetype) return null;
  if (coffeeArchetype === userArchetype) return 'wheelhouse';
  if (ARCHETYPE_ADJACENT[userArchetype]?.includes(coffeeArchetype)) return 'exploring';
  return 'stretch';
}

function getDimensionComparison(dimensions: DimensionRow[], userArchetype: string): string {
  const typical = ARCHETYPE_TYPICAL[userArchetype];
  if (!typical) return '';
  const archetypeLabel = ARCHETYPE_LABEL[userArchetype] ?? userArchetype;

  const divergences: { dim: string; delta: number; dir: string }[] = [];
  for (const row of dimensions) {
    const range = typical[row.dimension];
    if (!range) continue;
    const coffeeMid = (Number(row.avg_min) + Number(row.avg_max)) / 2;
    const typicalMid = (range[0] + range[1]) / 2;
    const delta = coffeeMid - typicalMid;
    if (Math.abs(delta) < 1.5) continue;
    const dir = delta > 4 ? 'significantly more' : delta > 1.5 ? 'slightly more'
              : delta < -4 ? 'significantly less' : 'slightly less';
    divergences.push({ dim: row.dimension.toLowerCase(), delta: Math.abs(delta), dir });
  }

  if (!divergences.length) {
    return `This coffee's profile sits close to your usual ${archetypeLabel} preference.`;
  }
  divergences.sort((a, b) => b.delta - a.delta);
  const top = divergences.slice(0, 2);
  if (top.length === 1) {
    return `This coffee has ${top[0].dir} ${top[0].dim} than your typical ${archetypeLabel} profile.`;
  }
  return `This coffee has ${top[0].dir} ${top[0].dim} and ${top[1].dir} ${top[1].dim} than your usual ${archetypeLabel} profile.`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CompatibilityBadge({ level, userArchetype }: { level: CompatLevel; userArchetype: string }) {
  const configs = {
    wheelhouse: {
      label: 'In your wheelhouse',
      bg: '#a33726', text: '#fff', border: 'transparent',
    },
    exploring: {
      label: 'Worth exploring',
      bg: 'transparent', text: '#b07d1a', border: '#b07d1a',
    },
    stretch: {
      label: 'Outside your comfort zone',
      bg: 'transparent', text: '#8a8070', border: '#c8c0b4',
    },
  };
  const c = configs[level];
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="self-start text-xs px-3 py-1 rounded-full border font-normal tracking-wide"
        style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
      >
        {c.label}
      </span>
      {level === 'stretch' && (
        <p className="text-xs font-light" style={{ color: '#a09880' }}>
          This is a stretch from your usual {ARCHETYPE_LABEL[userArchetype]} profile — but that's not a bad thing.
        </p>
      )}
    </div>
  );
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
        {/* Primary coffee bar */}
        <div className="relative">
          <div className="h-1.5 rounded-full w-full" style={{ backgroundColor: '#e0dcd4' }} />
          <div
            className="absolute top-0 h-1.5 rounded-full transition-all duration-500"
            style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: '#b05642' }}
          />
        </div>
        {/* Comparison coffee bar */}
        {hasCmp && (
          <div className="relative">
            <div className="h-1.5 rounded-full w-full" style={{ backgroundColor: '#e0dcd4' }} />
            <div
              className="absolute top-0 h-1.5 rounded-full transition-all duration-500"
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

function ContentSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#e0dcd4' }} />
      <div className="h-3 rounded w-full" style={{ backgroundColor: '#e0dcd4' }} />
      <div className="h-3 rounded w-2/3" style={{ backgroundColor: '#e0dcd4' }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CoffeesPage() {
  const { user } = useAuth();

  // Coffee list + selection
  const [coffees, setCoffees]         = useState<Coffee[]>([]);
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [error, setError]             = useState('');

  // Primary coffee data
  const [wheelRows, setWheelRows]     = useState<WheelRow[]>([]);
  const [dimensions, setDimensions]   = useState<DimensionRow[]>([]);
  const [content, setContent]         = useState<ContentData | null>(null);
  const [loading, setLoading]         = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [aiExpanded, setAiExpanded]   = useState(false);

  // Personalization
  const [userArchetype, setUserArchetype] = useState<string | null>(null);

  // Compare mode
  const [compareMode, setCompareMode]         = useState(false);
  const [compareId, setCompareId]             = useState<number | null>(null);
  const [compareWheelRows, setCompareWheelRows] = useState<WheelRow[]>([]);
  const [compareDimensions, setCompareDimensions] = useState<DimensionRow[]>([]);
  const [compareContent, setCompareContent]   = useState<ContentData | null>(null);
  const [compareLoading, setCompareLoading]   = useState(false);

  // Load coffee list
  useEffect(() => {
    fetch('/api/coffees')
      .then(r => r.json())
      .then((data: Coffee[]) => {
        setCoffees(data);
        if (data.length > 0) setSelectedId(data[0].id);
      })
      .catch(() => setError('Failed to load coffees'));
  }, []);

  // Load user archetype for personalization
  useEffect(() => {
    if (!user) { setUserArchetype(null); return; }
    getUserProfile()
      .then(p => setUserArchetype(p?.archetype?.id ?? null))
      .catch(() => {});
  }, [user]);

  // Load primary coffee data when selection changes
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setWheelRows([]);
    setDimensions([]);
    setContent(null);
    setAiExpanded(false);

    Promise.all([
      fetch(`/api/coffees/${selectedId}/flavor-wheel`).then(r => r.json()),
      fetch(`/api/coffees/${selectedId}/dimensions`).then(r => r.json()),
    ]).then(([wheel, dimData]) => {
      setWheelRows(wheel);
      setDimensions(dimData.dimensions ?? []);
      setLoading(false);

      setContentLoading(true);
      fetch(`/api/coffees/${selectedId}/content`)
        .then(r => r.json())
        .then((data: ContentData) => setContent(data))
        .catch(() => {})
        .finally(() => setContentLoading(false));
    }).catch(() => { setError('Failed to load coffee data'); setLoading(false); });
  }, [selectedId]);

  // Load comparison coffee data
  useEffect(() => {
    if (!compareMode || !compareId) {
      setCompareWheelRows([]);
      setCompareDimensions([]);
      setCompareContent(null);
      return;
    }
    setCompareLoading(true);
    Promise.all([
      fetch(`/api/coffees/${compareId}/flavor-wheel`).then(r => r.json()),
      fetch(`/api/coffees/${compareId}/dimensions`).then(r => r.json()),
      fetch(`/api/coffees/${compareId}/content`).then(r => r.json()),
    ]).then(([wheel, dimData, cContent]) => {
      setCompareWheelRows(wheel);
      setCompareDimensions(dimData.dimensions ?? []);
      setCompareContent(cContent);
    }).catch(() => {}).finally(() => setCompareLoading(false));
  }, [compareMode, compareId]);

  const selectedCoffee  = coffees.find(c => c.id === selectedId) ?? null;
  const compareCoffee   = coffees.find(c => c.id === compareId) ?? null;
  const descriptorEntries = aggregateDescriptors(wheelRows);
  const compareDescriptors = aggregateDescriptors(compareWheelRows);
  const activeSources   = [...new Set(wheelRows.map(r => r.source))];
  const compat          = getCompatibility(selectedCoffee?.archetype ?? null, userArchetype);
  const compareCompat   = getCompatibility(compareCoffee?.archetype ?? null, userArchetype);
  const dimCompText     = (compat && userArchetype && dimensions.length)
    ? getDimensionComparison(dimensions, userArchetype) : null;

  // Build merged dimension list for compare mode
  const mergedDims = (() => {
    if (!compareMode) return [];
    const mapA = new Map(dimensions.map(d => [d.dimension, d]));
    const mapB = new Map(compareDimensions.map(d => [d.dimension, d]));
    const order = dimensions.map(d => d.dimension);
    const rest  = [...mapB.keys()].filter(k => !mapA.has(k));
    return [...order, ...rest].map(name => ({ name, a: mapA.get(name) ?? null, b: mapB.get(name) ?? null }));
  })();

  function handleSelectCoffee(id: number) {
    setSelectedId(id);
    if (compareMode && id === compareId) setCompareId(null);
  }

  function toggleCompareMode() {
    setCompareMode(v => {
      if (v) { setCompareId(null); }
      return !v;
    });
  }

  return (
    <div className="w-full min-h-screen" style={{ backgroundColor: '#f2f1ea' }}>

      {/* ── Header ── */}
      <div className="pt-32 pb-16 px-8 md:px-16 max-w-[1400px] mx-auto">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <p className="uppercase tracking-widest text-xs mb-3" style={{ color: '#b05642' }}>Our Coffees</p>
          <h1 className="text-5xl md:text-7xl font-normal leading-tight mb-4" style={{ color: '#b05642', fontFamily: 'Arial, sans-serif' }}>
            Flavor Intelligence
          </h1>
          <p className="text-lg font-light max-w-xl" style={{ color: '#8a8070' }}>
            Every coffee, seen through three lenses — our cuppers, the roaster, and customers who've ordered it.
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
                onClick={() => handleSelectCoffee(coffee.id)}
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

        {/* ── Detail panel ── */}
        <div className="flex-1 min-w-0">
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

          {selectedCoffee && (
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedCoffee.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}
              >
                {/* ─ Coffee header ─ */}
                <div className="mb-8 pb-6 border-b border-stone-200">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1">
                      <h2 className="text-3xl font-normal" style={{ color: '#b05642', fontFamily: 'Arial, sans-serif' }}>
                        {selectedCoffee.name}
                      </h2>
                      <div className="flex flex-wrap gap-3 mt-2 text-sm" style={{ color: '#8a8070' }}>
                        {selectedCoffee.roaster     && <span>{selectedCoffee.roaster}</span>}
                        {selectedCoffee.origin      && <><span>·</span><span>{selectedCoffee.origin}</span></>}
                        {selectedCoffee.process     && <><span>·</span><span>{selectedCoffee.process}</span></>}
                        {selectedCoffee.roast_level && <><span>·</span><span>{selectedCoffee.roast_level}</span></>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {selectedCoffee.archetype && (
                        <span className="px-3 py-1 rounded-full text-sm text-white"
                          style={{ backgroundColor: ARCHETYPE_COLOR[selectedCoffee.archetype] ?? '#999' }}>
                          {ARCHETYPE_LABEL[selectedCoffee.archetype] ?? selectedCoffee.archetype}
                        </span>
                      )}
                      {/* Compare toggle */}
                      <button
                        onClick={toggleCompareMode}
                        className="text-xs px-3 py-1.5 rounded-full border transition-all duration-200"
                        style={{
                          borderColor: compareMode ? '#b05642' : '#c8c0b4',
                          color: compareMode ? '#b05642' : '#8a8070',
                          backgroundColor: compareMode ? '#fff8f5' : 'transparent',
                        }}
                      >
                        {compareMode ? '✕ Exit compare' : '⇄ Compare'}
                      </button>
                    </div>
                  </div>

                  {/* Compare coffee picker */}
                  {compareMode && (
                    <div className="mt-4 flex items-center gap-3">
                      <span className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>Compare with</span>
                      <select
                        value={compareId ?? ''}
                        onChange={e => setCompareId(e.target.value ? Number(e.target.value) : null)}
                        className="text-sm px-3 py-1.5 rounded border bg-white"
                        style={{ borderColor: '#d0ccc4', color: '#4a4035' }}
                      >
                        <option value="">Select a coffee…</option>
                        {coffees.filter(c => c.id !== selectedId).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      {compareLoading && <span className="text-xs" style={{ color: '#a09880' }}>Loading…</span>}
                    </div>
                  )}
                </div>

                {loading && (
                  <div className="flex items-center gap-2 py-16 text-stone-400">
                    <div className="w-4 h-4 rounded-full border-2 border-stone-300 border-t-stone-500 animate-spin" />
                    <span className="text-sm">Loading…</span>
                  </div>
                )}

                {!loading && wheelRows.length === 0 && dimensions.length === 0 && !contentLoading && (
                  <div className="py-16 text-center" style={{ color: '#a09880' }}>
                    <p className="text-lg mb-1">No tasting data yet</p>
                    <p className="text-sm">Notes will appear here after cupping sessions are recorded.</p>
                  </div>
                )}

                {!loading && (wheelRows.length > 0 || dimensions.length > 0 || contentLoading) && (
                  <div className="space-y-12">

                    {/* ─ Personalization: compatibility + dimension comparison ─ */}
                    {compat && userArchetype && !compareMode && (
                      <div className="flex flex-col gap-3">
                        <CompatibilityBadge level={compat} userArchetype={userArchetype} />
                        {dimCompText && (
                          <p className="text-sm font-light leading-relaxed" style={{ color: '#8a8070' }}>
                            {dimCompText}
                          </p>
                        )}
                      </div>
                    )}

                    {/* ─ Compare mode: side-by-side headers + badges ─ */}
                    {compareMode && compareId && compareCoffee && (
                      <div className="grid grid-cols-2 gap-6 pb-6 border-b border-stone-200">
                        {[
                          { coffee: selectedCoffee, compat, descriptors: descriptorEntries },
                          { coffee: compareCoffee,  compat: compareCompat, descriptors: compareDescriptors },
                        ].map(({ coffee, compat: c, descriptors }, i) => (
                          <div key={i} className="flex flex-col gap-3">
                            <div>
                              <h3 className="text-lg font-normal" style={{ color: '#b05642' }}>{coffee.name}</h3>
                              {coffee.archetype && (
                                <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full text-white"
                                  style={{ backgroundColor: ARCHETYPE_COLOR[coffee.archetype] ?? '#999' }}>
                                  {ARCHETYPE_LABEL[coffee.archetype] ?? coffee.archetype}
                                </span>
                              )}
                            </div>
                            {c && userArchetype && <CompatibilityBadge level={c} userArchetype={userArchetype} />}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ─ Surprise angle ─ */}
                    {!compareMode && (
                      <div>
                        {contentLoading && !content?.surpriseNote ? (
                          <ContentSkeleton />
                        ) : content?.surpriseNote ? (
                          <p
                            className="text-lg font-light leading-relaxed"
                            style={{ color: '#3a3020', borderLeft: '2px solid #b0564240', paddingLeft: '1rem' }}
                          >
                            {content.surpriseNote}
                          </p>
                        ) : null}
                      </div>
                    )}

                    {/* ─ Three-voice story ─ */}
                    {!compareMode && (
                      <div>
                        {contentLoading && !content?.threeVoiceStory ? (
                          <ContentSkeleton />
                        ) : content?.threeVoiceStory ? (
                          <div>
                            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#a09880' }}>
                              Three voices
                            </p>
                            <div className="flex gap-3 mb-3">
                              {['Internal cupping', 'Roastery notes', 'Customer feedback'].map((label, i) => {
                                const colors = ['#b05642', '#7c9e87', '#8a7cbe'];
                                return (
                                  <div key={label} className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors[i] }} />
                                    <span className="text-xs" style={{ color: '#8a8070' }}>{label}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="text-base font-light leading-relaxed" style={{ color: '#3a3020' }}>
                              {content.threeVoiceStory}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* ─ AI tasting note (collapsible) ─ */}
                    {!compareMode && (
                      <div className="rounded-xl border px-6 py-5" style={{ borderColor: '#e0dcd4', backgroundColor: '#faf9f5' }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>Tasting note</span>
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f0ede6', color: '#b05642' }}>AI</span>
                          </div>
                          {content?.aiSummary && (
                            <button
                              onClick={() => setAiExpanded(v => !v)}
                              className="text-xs transition-colors"
                              style={{ color: '#a09880' }}
                            >
                              {aiExpanded ? 'Collapse ↑' : 'Read full note ↓'}
                            </button>
                          )}
                        </div>
                        {contentLoading && !content?.aiSummary ? (
                          <div className="flex items-center gap-2 text-stone-400">
                            <div className="w-3 h-3 rounded-full border-2 border-stone-300 border-t-stone-400 animate-spin" />
                            <span className="text-sm">Generating…</span>
                          </div>
                        ) : content?.aiSummary ? (
                          <AnimatePresence initial={false}>
                            {aiExpanded ? (
                              <motion.p
                                key="expanded"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="text-base font-light leading-relaxed overflow-hidden"
                                style={{ color: '#3a3020' }}
                              >
                                {content.aiSummary}
                              </motion.p>
                            ) : (
                              <motion.p
                                key="collapsed"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="text-sm font-light line-clamp-2"
                                style={{ color: '#8a8070' }}
                              >
                                {content.aiSummary}
                              </motion.p>
                            )}
                          </AnimatePresence>
                        ) : (
                          <p className="text-sm" style={{ color: '#a09880' }}>Not enough data to generate a summary yet.</p>
                        )}
                      </div>
                    )}

                    {/* ─ Dimension bars ─ */}
                    {(dimensions.length > 0 || (compareMode && compareDimensions.length > 0)) && (
                      <div>
                        <div className="flex items-center gap-4 mb-6">
                          <p className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>
                            Cupping profile
                            {!compareMode && dimensions[0]?.session_count && (
                              <span className="ml-2 normal-case" style={{ color: '#c8c0b4' }}>
                                — avg across {dimensions[0].session_count} session{Number(dimensions[0].session_count) !== 1 ? 's' : ''}
                              </span>
                            )}
                          </p>
                          {compareMode && compareId && (
                            <div className="flex items-center gap-4 text-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-1.5 rounded-full inline-block" style={{ backgroundColor: '#b05642' }} />
                                <span style={{ color: '#8a8070' }}>{selectedCoffee.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-1.5 rounded-full inline-block" style={{ backgroundColor: '#7c9e87' }} />
                                <span style={{ color: '#8a8070' }}>{compareCoffee?.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-1.5 rounded-full inline-block" style={{ backgroundColor: '#c9a830' }} />
                                <span style={{ color: '#8a8070' }}>Notable difference</span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="space-y-5">
                          {compareMode
                            ? mergedDims.map((row, i) => row.a
                                ? <DimensionBar key={row.name} dim={row.a} index={i} compareDim={row.b} />
                                : null
                              )
                            : dimensions.map((dim, i) => <DimensionBar key={dim.dimension} dim={dim} index={i} />)
                          }
                        </div>
                      </div>
                    )}

                    {/* ─ Descriptor bubble cloud(s) ─ */}
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
                        {compareMode && compareId && compareDescriptors.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            <div>
                              <p className="text-xs mb-4" style={{ color: '#a09880' }}>{selectedCoffee.name}</p>
                              <BubbleCloud entries={descriptorEntries} />
                            </div>
                            <div>
                              <p className="text-xs mb-4" style={{ color: '#a09880' }}>{compareCoffee?.name}</p>
                              <BubbleCloud entries={compareDescriptors} />
                            </div>
                          </div>
                        ) : (
                          <BubbleCloud entries={descriptorEntries} />
                        )}
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
