import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { getUserProfile } from '../lib/api';
import { ARCHETYPE_LABEL, ARCHETYPE_COLOR, useCompatibility, CompatibilityBadge } from './coffee-info/useCompatibility';
import { DimensionBars, type DimensionRow } from './coffee-info/DimensionBars';
import { CollaborativeFlavorWheel, type WheelRow } from './coffee-info/CollaborativeFlavorWheel';
import { TastingNotes, type ContentData } from './coffee-info/TastingNotes';

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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CoffeesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

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
  const { compat, dimCompText } = useCompatibility(selectedCoffee?.archetype ?? null, userArchetype, dimensions);
  const { compat: compareCompat } = useCompatibility(compareCoffee?.archetype ?? null, userArchetype, compareDimensions);

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
          <h1 className="text-5xl md:text-7xl font-normal leading-tight mb-4" style={{ color: '#b05642', fontFamily: "'Lato', Arial, sans-serif" }}>
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
                      <h2 className="text-3xl font-normal" style={{ color: '#b05642', fontFamily: "'Lato', Arial, sans-serif" }}>
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
                      {/* Ask Liam */}
                      {user && (
                        <button
                          onClick={() => navigate('/sommelier?entry=user_initiated')}
                          className="text-xs px-3 py-1.5 rounded-full border transition-all duration-200"
                          style={{ borderColor: '#b05642', color: '#b05642', backgroundColor: '#fff8f5' }}
                        >
                          Ask Liam
                        </button>
                      )}
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
                          { coffee: selectedCoffee, compat },
                          { coffee: compareCoffee,  compat: compareCompat },
                        ].map(({ coffee, compat: c }, i) => (
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

                    {/* ─ Notes: surprise angle + three-voice story + Liam's intake ─ */}
                    {!compareMode && (
                      <TastingNotes content={content} contentLoading={contentLoading} />
                    )}

                    {/* ─ Dimension bars ─ */}
                    <DimensionBars
                      dimensions={dimensions}
                      compareDimensions={compareMode && compareId ? compareDimensions : undefined}
                      primaryLabel={selectedCoffee.name}
                      compareLabel={compareCoffee?.name}
                    />

                    {/* ─ Collaborative Flavor Wheel ─ */}
                    <CollaborativeFlavorWheel
                      wheelRows={wheelRows}
                      compareWheelRows={compareMode && compareId ? compareWheelRows : undefined}
                      primaryLabel={selectedCoffee.name}
                      compareLabel={compareCoffee?.name}
                    />

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
