import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { getUserProfile, getDialPosition, setDialPosition } from '../lib/api';
import { ARCHETYPE_VISUALS } from './bloom/bloomVisuals';
import { Link, useSearchParams } from 'react-router';
import { computeDefaultSortOrder } from './bloom/ArchetypeSection';
import { CompareOverlay } from './bloom/CompareOverlay';
import { OtherCategoryCard } from './bloom/OtherCategoryCard';
import { DialArchetypeSection } from './bloom/DialArchetypeSection';
import type { BloomDialHandle } from './bloom/dial/BloomDial';
import type { ArchetypeData, OtherCategoryCoffee, Slot } from './bloom/types';
import { slotKey } from './bloom/types';

// Bloom Dial Base Data Part 3, Phase 6: Decaf/Half-Caf/Flavored group under
// "Other Categories" (Part 4 keeps this section on Bloom unchanged). Experimental
// no longer belongs in this list — Part 4 §B2 gives it a proper archetype-style
// box instead (see `experimentalData` below), not a grouped OtherCategoryCard section.
const OTHER_CATEGORY_CODES = ['decaf', 'half_caf', 'flavored'];

export default function BloomPage() {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const [searchParams] = useSearchParams();

  const [archetypes, setArchetypes] = useState<ArchetypeData[]>([]);
  const [experimentalData, setExperimentalData] = useState<ArchetypeData | null>(null);
  const [archetypeOrder, setArchetypeOrder] = useState<string[] | null>(null);
  const [otherCategories, setOtherCategories] = useState<OtherCategoryCoffee[]>([]);
  const [catalogueSettled, setCatalogueSettled] = useState(false);
  const [error, setError] = useState('');
  const [userArchetype, setUserArchetype] = useState<string | null>(null);
  const [userArchetypeLoaded, setUserArchetypeLoaded] = useState(false);

  const [selectedSortOrder, setSelectedSortOrder] = useState<Record<string, number>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const dialRefs = useRef<Record<string, BloomDialHandle | null>>({});

  const [compareState, setCompareState] = useState<{ open: boolean; archetype: string; archetypeLabel: string; slot: Slot | null }>({
    open: false, archetype: '', archetypeLabel: '', slot: null,
  });

  useEffect(() => {
    const archetypesFetch = fetch('/api/coffees/archetypes')
      .then(r => r.json())
      .then((data: ArchetypeData[]) => {
        setArchetypes(data);
        setSelectedSortOrder(prev => {
          const next = { ...prev };
          for (const a of data) if (!(a.archetype in next)) next[a.archetype] = computeDefaultSortOrder(a);
          return next;
        });
      })
      .catch(() => setError('Failed to load coffees'));

    const experimentalFetch = fetch('/api/coffees/experimental')
      .then(r => r.json())
      .then((data: ArchetypeData) => {
        setExperimentalData(data);
        setSelectedSortOrder(prev => (data.archetype in prev) ? prev : { ...prev, [data.archetype]: computeDefaultSortOrder(data) });
      })
      .catch(() => {});

    fetch('/api/coffees/other-categories')
      .then(r => r.json())
      .then((data: OtherCategoryCoffee[]) => setOtherCategories(data))
      .catch(() => {});

    // Liam action links, Phase A: the deep-link effect below needs to know when
    // the catalogue is *settled*, not just non-empty — experimentalData alone can
    // resolve before archetypes does, which would otherwise make `all.length`
    // falsely look "loaded" while the actual target archetype hasn't arrived yet.
    Promise.allSettled([archetypesFetch, experimentalFetch]).then(() => setCatalogueSettled(true));
  }, []);

  useEffect(() => {
    if (!user) { setUserArchetype(null); setUserArchetypeLoaded(true); return; }
    setUserArchetypeLoaded(false);
    getUserProfile()
      .then(p => setUserArchetype(p?.archetype?.id ?? null))
      .catch(() => setUserArchetype(null))
      .finally(() => setUserArchetypeLoaded(true));
  }, [user]);

  // Bloom Dial Base Data Part 4, §B3: personalized order (customer's match first,
  // then nearest neighbor) computed server-side, not hard-coded here — see
  // GET /api/coffees/archetype-order. Waits for userArchetypeLoaded so a signed-in
  // match isn't briefly requested as "no match" before getUserProfile() resolves.
  useEffect(() => {
    if (!userArchetypeLoaded) return;
    const qs = userArchetype ? `?archetype=${encodeURIComponent(userArchetype)}` : '';
    fetch(`/api/coffees/archetype-order${qs}`)
      .then(r => r.json())
      .then((data: { order: string[] }) => setArchetypeOrder(data.order))
      .catch(() => setArchetypeOrder(null));
  }, [userArchetype, userArchetypeLoaded]);

  const orderedArchetypes = useMemo(() => {
    if (!archetypeOrder) return archetypes;
    return [...archetypes].sort((a, b) => archetypeOrder.indexOf(a.archetype) - archetypeOrder.indexOf(b.archetype));
  }, [archetypes, archetypeOrder]);

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

  // Liam action links, Phase A — honor ?archetype=&slot= deep links (FI's existing
  // "Shop on The Bloom →" link already emits this shape). Gated on `catalogueSettled`
  // rather than `all.length > 0` — experimentalData alone can resolve before the base
  // archetypes fetch does, which would otherwise mis-resolve the deep link as "not
  // found". Runs once. Invalid/unknown params fall through to the default view.
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    const archetypeParam = searchParams.get('archetype');
    if (!archetypeParam) { deepLinkHandledRef.current = true; return; }
    if (!catalogueSettled) return; // wait for both catalogue fetches to settle

    deepLinkHandledRef.current = true;
    const all = [...orderedArchetypes, ...(experimentalData ? [experimentalData] : [])];
    const target = all.find(a => a.archetype === archetypeParam);
    if (!target) return;

    const slotParam = searchParams.get('slot');
    const slotNum = slotParam ? Number(slotParam) : NaN;
    const validSlot = target.slots.some(s => s.dialSortOrder === slotNum) ? slotNum : null;

    requestAnimationFrame(() => {
      document.getElementById(archetypeParam)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (validSlot != null) dialRefs.current[archetypeParam]?.rotateTo(validSlot);
    });
  }, [catalogueSettled, orderedArchetypes, experimentalData, searchParams]);

  function registerDialRef(archetype: string, handle: BloomDialHandle | null) {
    dialRefs.current[archetype] = handle;
  }

  // Silent auto-save on every settled turn (signed-in only; anonymous falls through).
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

  // The Bloom Part 12: the new dial's rotateTo() only repaints — unlike the old
  // widget, it does NOT emit onZoneChange — so the reading column won't switch
  // to the hopped slot without also updating selectedSortOrder here.
  //
  // Part 17 §C — "it just throws me to the next archetype" fix: every archetype
  // section is already mounted on this page (unlike Profile/Find My Flavor),
  // so the missing piece was purely sequencing. The old code called rotateTo()
  // FIRST and scrolled second — the dial silently jumped to its new position
  // before the target section was even in view, so the turn (BloomDial's own
  // 560ms rotor transition, already built) never registered as an event the
  // user witnessed. Now: scroll first, then rotate once the smooth-scroll has
  // had time to land — the turn plus paint()'s existing zone-change name-fade
  // (BloomDial.tsx, unchanged) together ARE the arrival cue §C.2/§C.3 ask for,
  // no new animation needed, just the right order.
  function handleHopClick(archetype: string, dialSortOrder: number) {
    setRevealedKeys(prev => new Set(prev).add(slotKey(archetype, dialSortOrder)));
    requestAnimationFrame(() => {
      document.getElementById(archetype)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // selectedSortOrder is deliberately NOT updated until this same delayed
      // callback as rotateTo(): BloomDial has its own effect that repaints the
      // instant its initialDialSortOrder prop changes (for deep-link/saved-
      // position sync) — updating the state early would trigger that silent,
      // immediate repaint and reproduce the exact "throws me to the next
      // archetype" bug this section fixes. Both updates land together, once
      // the section has actually scrolled into view.
      setTimeout(() => {
        dialRefs.current[archetype]?.rotateTo(dialSortOrder);
        setSelectedSortOrder(prev => ({ ...prev, [archetype]: dialSortOrder }));
      }, 550);
    });
  }

  function openCompare(archetype: string, archetypeLabel: string, slot: Slot) {
    setCompareState({ open: true, archetype, archetypeLabel, slot });
  }

  const allData = [...orderedArchetypes, ...(experimentalData ? [experimentalData] : [])];

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
        {allData.map(a => {
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

      {/* ── The Bloom Dial per archetype (brief 33), with the full commerce/reveal
           layer restored on top (The Bloom Part 12). Personalized order (match
           first) for the flavor archetypes, Experimental always last. ── */}
      {allData.map((data, i) => (
        <DialArchetypeSection
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
          source="bloom"
        />
      ))}

      {/* ── Other Categories (Decaf / Half-Caf / Flavored) ──
           Bloom Dial Base Data Part 3, Phase 6 — coffees with no dial position,
           grouped by category tag instead of archetype/slot. A coffee carrying
           more than one tag renders once per tag. Kept exactly as Part 3 built it. ── */}
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

      <CompareOverlay
        open={compareState.open}
        onClose={() => setCompareState(s => ({ ...s, open: false }))}
        left={compareState.slot ? { archetype: compareState.archetype, archetypeLabel: compareState.archetypeLabel, slot: compareState.slot } : null}
        archetypes={archetypes}
      />
    </div>
  );
}
