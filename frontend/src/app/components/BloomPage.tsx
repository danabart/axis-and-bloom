import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { getUserProfile, getDialPosition, setDialPosition } from '../lib/api';
import { ARCHETYPE_ORDER, ARCHETYPE_VISUALS } from './bloom/bloomVisuals';
import { Link } from 'react-router';
import { ArchetypeSection, computeDefaultSortOrder } from './bloom/ArchetypeSection';
import { CompareOverlay } from './bloom/CompareOverlay';
import { OtherCategoryCard } from './bloom/OtherCategoryCard';
import type { BloomDialHandle } from './BloomDialWidget';
import type { ArchetypeData, OtherCategoryCoffee, Slot } from './bloom/types';
import { slotKey } from './bloom/types';

// Bloom Dial Base Data Part 3, Phase 6: category tags grouped in this order —
// Decaf/Half-Caf/Flavored under "Other Categories", Experimental gets its own
// "The Unexpected" section (matches the admin's coffee_category.sort_order).
const OTHER_CATEGORY_CODES = ['decaf', 'half_caf', 'flavored'];

export default function BloomPage() {
  const { user } = useAuth();
  const { addToCart } = useCart();

  const [archetypes, setArchetypes] = useState<ArchetypeData[]>([]);
  const [otherCategories, setOtherCategories] = useState<OtherCategoryCoffee[]>([]);
  const [error, setError] = useState('');
  const [userArchetype, setUserArchetype] = useState<string | null>(null);

  const [selectedSortOrder, setSelectedSortOrder] = useState<Record<string, number>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const dialRefs = useRef<Record<string, BloomDialHandle | null>>({});

  const [compareState, setCompareState] = useState<{ open: boolean; archetype: string; archetypeLabel: string; slot: Slot | null }>({
    open: false, archetype: '', archetypeLabel: '', slot: null,
  });

  useEffect(() => {
    fetch('/api/coffees/archetypes')
      .then(r => r.json())
      .then((data: ArchetypeData[]) => {
        const ordered = [...data].sort(
          (a, b) => ARCHETYPE_ORDER.indexOf(a.archetype as any) - ARCHETYPE_ORDER.indexOf(b.archetype as any)
        );
        setArchetypes(ordered);
        setSelectedSortOrder(prev => {
          const next = { ...prev };
          for (const a of ordered) if (!(a.archetype in next)) next[a.archetype] = computeDefaultSortOrder(a);
          return next;
        });
      })
      .catch(() => setError('Failed to load coffees'));

    fetch('/api/coffees/other-categories')
      .then(r => r.json())
      .then((data: OtherCategoryCoffee[]) => setOtherCategories(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) { setUserArchetype(null); return; }
    getUserProfile()
      .then(p => setUserArchetype(p?.archetype?.id ?? null))
      .catch(() => {});
  }, [user]);

  // Phase D — pre-set each archetype's dial to the signed-in user's saved position.
  useEffect(() => {
    if (!user || !archetypes.length) return;
    Promise.all(archetypes.map(a => getDialPosition(a.archetype).then(r => [a.archetype, r.dialSortOrder] as const).catch(() => [a.archetype, null] as const)))
      .then(entries => {
        setSelectedSortOrder(prev => {
          const next = { ...prev };
          for (const [archetype, sortOrder] of entries) if (sortOrder != null) next[archetype] = sortOrder;
          return next;
        });
      });
  }, [user, archetypes]);

  function registerDialRef(archetype: string, handle: BloomDialHandle | null) {
    dialRefs.current[archetype] = handle;
  }

  function handleDialSelect(archetype: string, dialSortOrder: number) {
    setSelectedSortOrder(prev => ({ ...prev, [archetype]: dialSortOrder }));
    if (user) setDialPosition(archetype, dialSortOrder).catch(() => {});
  }

  function toggleReveal(key: string) {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleHopClick(archetype: string, dialSortOrder: number) {
    dialRefs.current[archetype]?.rotateTo(dialSortOrder);
    setRevealedKeys(prev => new Set(prev).add(slotKey(archetype, dialSortOrder)));
    requestAnimationFrame(() => {
      document.getElementById(archetype)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function openCompare(archetype: string, archetypeLabel: string, slot: Slot) {
    setCompareState({ open: true, archetype, archetypeLabel, slot });
  }

  return (
    <div style={{ backgroundColor: '#f2f1ea', minHeight: '100vh' }}>
      {/* ── Hero ── */}
      <section style={{ padding: 'clamp(100px, 14vh, 160px) clamp(32px, 6vw, 96px) clamp(52px, 7vh, 80px)' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.95 }}>
          <p style={{ fontSize: '0.50rem', letterSpacing: '0.38em', textTransform: 'uppercase', color: 'rgba(154,41,24,0.40)', margin: '0 0 16px' }}>
            The Bloom
          </p>
          <h1 style={{ fontSize: 'clamp(3.2rem, 6.5vw, 8.5rem)', color: '#9a2918', fontWeight: 400, lineHeight: 0.92, margin: '0 0 clamp(28px, 4vh, 48px)', letterSpacing: '-0.03em' }}>
            Six worlds.<br />Every detail, at your pace.
          </h1>
        </motion.div>
      </section>

      {/* ── Sticky archetype jump-nav ── */}
      <div style={{
        position: 'sticky', top: 64, zIndex: 40, backgroundColor: '#f2f1ea',
        borderTop: '1px solid rgba(154,41,24,0.07)', borderBottom: '1px solid rgba(154,41,24,0.07)',
        padding: 'clamp(10px, 1.4vh, 16px) clamp(32px, 6vw, 96px)',
        display: 'flex', gap: 'clamp(14px, 2.5vw, 40px)', overflowX: 'auto',
      }}>
        {archetypes.map(a => {
          const visual = ARCHETYPE_VISUALS[a.archetype];
          if (!visual) return null;
          return (
            <a
              key={a.archetype}
              href={`#${a.archetype}`}
              style={{
                fontSize: '0.48rem', letterSpacing: '0.28em', textTransform: 'uppercase',
                color: visual.color, opacity: 0.6, whiteSpace: 'nowrap', textDecoration: 'none',
              }}
            >
              {visual.num} · {a.archetypeLabel}
            </a>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-500 px-8 py-4">{error}</p>}

      {archetypes.map((data, i) => (
        <ArchetypeSection
          key={data.archetype}
          data={data}
          index={i}
          selectedSortOrder={selectedSortOrder[data.archetype] ?? computeDefaultSortOrder(data)}
          revealedKeys={revealedKeys}
          onDialSelect={handleDialSelect}
          onToggleReveal={toggleReveal}
          onAddToCart={addToCart}
          onHopClick={handleHopClick}
          onCompare={openCompare}
          userArchetype={userArchetype}
          registerDialRef={registerDialRef}
        />
      ))}

      {/* ── Other Categories (Decaf / Half-Caf / Flavored) + The Unexpected (Experimental) ──
           Bloom Dial Base Data Part 3, Phase 6 — coffees with no dial position, grouped by
           category tag instead of archetype/slot. A coffee carrying more than one tag
           (e.g. a flavored decaf) renders once per tag. */}
      {otherCategories.length > 0 && (
        <section style={{ borderTop: '1px solid rgba(154,41,24,0.08)', padding: 'clamp(52px, 7vh, 92px) clamp(32px, 6vw, 96px)' }}>
          <h2 style={{ fontSize: 'clamp(2rem, 3.2vw, 4rem)', color: '#9a2918', fontWeight: 400, margin: '0 0 clamp(20px, 3vh, 32px)', letterSpacing: '-0.02em' }}>
            Other Categories
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {otherCategories
              .flatMap(coffee => coffee.categories
                .filter(c => OTHER_CATEGORY_CODES.includes(c.code))
                .map(c => ({ coffee, categoryLabel: c.label })))
              .map(({ coffee, categoryLabel }) => (
                <OtherCategoryCard
                  key={`${coffee.coffeeId}-${categoryLabel}`}
                  coffee={coffee}
                  categoryLabel={categoryLabel}
                  onAddToCart={addToCart}
                  renderFlavorIntelligenceLink={coffeeId => (
                    <Link to={`/flavor-intelligence?directCoffee=${coffeeId}`} className="text-xs underline" style={{ color: '#8a8070' }}>
                      Flavor Intelligence
                    </Link>
                  )}
                />
              ))}
          </div>
        </section>
      )}

      {otherCategories.some(c => c.categories.some(cat => cat.code === 'experimental')) && (
        <section style={{ borderTop: '1px solid rgba(154,41,24,0.08)', padding: 'clamp(52px, 7vh, 92px) clamp(32px, 6vw, 96px)' }}>
          <h2 style={{ fontSize: 'clamp(2rem, 3.2vw, 4rem)', color: '#056c7a', fontWeight: 400, margin: '0 0 clamp(20px, 3vh, 32px)', letterSpacing: '-0.02em' }}>
            The Unexpected
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {otherCategories
              .filter(coffee => coffee.categories.some(c => c.code === 'experimental'))
              .map(coffee => (
                <OtherCategoryCard
                  key={coffee.coffeeId}
                  coffee={coffee}
                  categoryLabel="Experimental"
                  onAddToCart={addToCart}
                  renderFlavorIntelligenceLink={coffeeId => (
                    <Link to={`/flavor-intelligence?directCoffee=${coffeeId}`} className="text-xs underline" style={{ color: '#8a8070' }}>
                      Flavor Intelligence
                    </Link>
                  )}
                />
              ))}
          </div>
        </section>
      )}

      <CompareOverlay
        open={compareState.open}
        onClose={() => setCompareState(s => ({ ...s, open: false }))}
        left={compareState.slot ? { archetype: compareState.archetype, archetypeLabel: compareState.archetypeLabel, slot: compareState.slot } : null}
        archetypes={archetypes}
      />
    </div>
  );
}
