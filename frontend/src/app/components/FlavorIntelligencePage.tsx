import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { getHomepageState } from '../lib/api';
import { ARCHETYPE_LABEL, ARCHETYPE_COLOR, useCompatibility, CompatibilityBadge } from './coffee-info/useCompatibility';
import { useArchetypeAdjacency } from './coffee-info/archetypeAdjacency';
import { DimensionBars, type DimensionRow } from './coffee-info/DimensionBars';
import { CollaborativeFlavorWheel, type WheelRow } from './coffee-info/CollaborativeFlavorWheel';
import { TastingNotes, type ContentData } from './coffee-info/TastingNotes';
import OrderFeedbackForm from './OrderFeedbackForm';
import { OtherCategoryCard } from './bloom/OtherCategoryCard';
import type { ArchetypeData, OtherCategoryCoffee, Slot } from './bloom/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HomepageState {
  stageCode: string;
  archetype: { name: string; id: string; color: string; features: string[] } | null;
  daysSinceQuiz: number | null;
  pendingFeedback: { orderId: string; blendName: string | null; coffeeId: number | null } | null;
  usualBlend: { id: string; name: string } | null;
  nextDeliveryDate: string | null;
}

interface CoffeeContent extends ContentData {
  process: string | null;
  roastLevel: string | null;
  originRegion: string | null;
}

interface CuppingNote {
  overall_notes: string;
  session_date: string;
}

// Mirrors Home.tsx's FEEDBACK_NAG_SUPPRESS_DAYS.
const FEEDBACK_NAG_SUPPRESS_DAYS = 14;

// Part 15 — brand reskin tokens (same as Part 13's reveal panel / RevealedPanel.tsx).
const QUIET_LINK_CLASS = 'text-[10.5px] uppercase tracking-[.14em] text-[#9a2918] opacity-[.85] hover:opacity-100 no-underline transition-opacity';
const MICRO_LABEL_CLASS = 'text-[10px] uppercase tracking-[.18em]';
const MICRO_LABEL_STYLE = { color: '#7b7f80', fontWeight: 400 } as const;
const RULE_STYLE = { border: 'none', borderTop: '1px solid #deded1', margin: '32px 0' } as const;

const MATCH_FIRST_STAGES = new Set([
  'QUIZ_TAKEN_FRESH_NO_ORDER', 'QUIZ_TAKEN_SETTLED_NO_ORDER', 'QUIZ_STALE_NO_ORDER',
  'SUBSCRIBER', 'REORDER_DUE', 'LAPSED_SINGLE_ORDER', 'ACTIVE_REPEAT_USER',
]);

function slotKey(archetype: string, dialSortOrder: number) { return `${archetype}_${dialSortOrder}`; }

function findDefaultSlot(data: ArchetypeData | undefined): Slot | undefined {
  if (!data) return undefined;
  const activeSlots = data.slots.filter(s => s.isActive);
  return activeSlots.find(s => s.isDefault) ?? activeSlots[0];
}

// ── Cupping session notes (Decision #6) ──────────────────────────────────────

function CuppingNotes({ notes }: { notes: CuppingNote[] }) {
  const [open, setOpen] = useState(false);
  if (!notes.length) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: '#ee5974', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {open ? 'Hide' : 'Show'} cupping session notes ({notes.length}) {open ? '↑' : '↓'}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }} className="overflow-hidden"
          >
            <div className="space-y-4 mt-4">
              {notes.map((n, i) => (
                <div key={i} className="pl-4" style={{ borderLeft: '2px solid #deded1' }}>
                  <p className="text-xs mb-1" style={{ color: '#b3b0a6' }}>
                    {new Date(n.session_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                  <p className="text-[15.5px] font-light" style={{ color: '#45474a', lineHeight: 1.7 }}>{n.overall_notes}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FlavorIntelligencePage() {
  const { user, loading: authLoading } = useAuth();
  const { addToCart } = useCart();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const adjacency = useArchetypeAdjacency();

  const [archetypes, setArchetypes] = useState<ArchetypeData[]>([]);
  const [archetypesLoaded, setArchetypesLoaded] = useState(false);
  const [experimentalData, setExperimentalData] = useState<ArchetypeData | null>(null);
  const [otherCategories, setOtherCategories] = useState<OtherCategoryCoffee[]>([]);
  const [directCoffeeId, setDirectCoffeeId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const [homepageState, setHomepageState] = useState<HomepageState | null>(null);
  const [homepageStateLoaded, setHomepageStateLoaded] = useState(false);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedArchetype, setSelectedArchetype] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const initializedRef = useRef(false);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pendingScroll, setPendingScroll] = useState(false);

  const [content, setContent] = useState<CoffeeContent | null>(null);
  const [dimensions, setDimensions] = useState<DimensionRow[]>([]);
  const [notes, setNotes] = useState<CuppingNote[]>([]);
  const [wheelRows, setWheelRows] = useState<WheelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);

  const [compareMode, setCompareMode] = useState(false);
  const [compareCoffeeId, setCompareCoffeeId] = useState<number | null>(null);
  const [compareContent, setCompareContent] = useState<CoffeeContent | null>(null);
  const [compareDimensions, setCompareDimensions] = useState<DimensionRow[]>([]);
  const [compareWheelRows, setCompareWheelRows] = useState<WheelRow[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareLabel, setCompareLabel] = useState<string | undefined>(undefined);

  // ── Load archetype catalogue ────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/coffees/archetypes')
      .then(r => r.json())
      .then((data: ArchetypeData[]) => { setArchetypes(data); setArchetypesLoaded(true); })
      .catch(() => { setError('Failed to load coffees'); setArchetypesLoaded(true); });

    // Bloom Dial Base Data Part 4, §C1: Experimental gets its own archetype-style
    // box here too (same data/component as The Bloom's — see BloomPage.tsx),
    // merged into `displayArchetypes` below so the existing accordion/selection
    // machinery handles it with no parallel code path.
    fetch('/api/coffees/experimental')
      .then(r => r.json())
      .then((data: ArchetypeData) => setExperimentalData(data))
      .catch(() => {});

    fetch('/api/coffees/other-categories')
      .then(r => r.json())
      .then((data: OtherCategoryCoffee[]) => setOtherCategories(data))
      .catch(() => {});
  }, []);

  // Bloom Dial Base Data Part 4, §B2/C1: the 5 real archetypes plus Experimental,
  // always last — used for the accordion, selection lookups, and compare options
  // so all of that machinery treats Experimental exactly like a 6th archetype
  // without a parallel rendering path. Ordering here is FI's own pre-existing
  // match/adjacency logic (Decision #2, below), unrelated to Part 4 §B3's
  // personalized order (that's Bloom-only, per spec).
  const displayArchetypes = useMemo(
    () => (experimentalData ? [...archetypes, experimentalData] : archetypes),
    [archetypes, experimentalData]
  );

  // ── Load lifecycle personalization state ────────────────────────────────────
  // Gated on authLoading (not just `user`) — Firebase's onAuthStateChanged starts
  // with user=null before it resolves, so without this the default-selection
  // effect below could fire once for a "guest" that turns out to be signed in.
  useEffect(() => {
    if (authLoading) return;
    if (!user) { setHomepageState(null); setHomepageStateLoaded(true); return; }
    setHomepageStateLoaded(false);
    getHomepageState()
      .then(setHomepageState)
      .catch(() => setHomepageState(null))
      .finally(() => setHomepageStateLoaded(true));
  }, [user, authLoading]);

  useEffect(() => {
    const orderId = homepageState?.pendingFeedback?.orderId;
    if (!orderId) { setFeedbackDismissed(false); return; }
    const key = `axisBloomFeedbackDismiss_${orderId}`;
    const dismissedAt = localStorage.getItem(key);
    setFeedbackDismissed(!!dismissedAt && Date.now() - Number(dismissedAt) < FEEDBACK_NAG_SUPPRESS_DAYS * 86400000);
  }, [homepageState]);

  const matchArchetypeId = homepageState?.archetype?.id ?? null;
  const isMatched = !!user && !!matchArchetypeId && MATCH_FIRST_STAGES.has(homepageState?.stageCode ?? '');

  function selectSlot(archetype: string, dialSortOrder: number | null) {
    setSelectedArchetype(archetype);
    setSelectedSlot(dialSortOrder);
    setExpanded(prev => new Set(prev).add(archetype));
    setDirectCoffeeId(null);
  }

  // Bloom Dial Base Data Part 3, Phase 6: select a Decaf/Half-Caf/Flavored/Experimental
  // coffee directly by id — these have no archetype/dial-slot to select through.
  // Compare mode is dial-only (its UI is omitted for a direct coffee, see the detail
  // panel below) — force it off here so a stale compareMode=true from a prior dial
  // selection can't leave selectedSlotData-dependent JSX rendering with no slot data.
  function selectDirectCoffee(coffeeId: number) {
    setDirectCoffeeId(coffeeId);
    setCompareMode(false);
    setCompareCoffeeId(null);
  }

  // ── Deep-link resolution + default selection (Decision #3) ─────────────────
  useEffect(() => {
    if (!archetypesLoaded || !homepageStateLoaded || initializedRef.current || archetypes.length === 0) return;
    initializedRef.current = true;

    const archParam = searchParams.get('archetype');
    const slotParam = searchParams.get('slot');
    const legacyCoffeeId = searchParams.get('coffee');
    const directCoffeeParam = searchParams.get('directCoffee');

    if (archParam && slotParam != null && displayArchetypes.some(a => a.archetype === archParam)) {
      selectSlot(archParam, Number(slotParam));
      setPendingScroll(true);
      return;
    }

    if (directCoffeeParam) {
      selectDirectCoffee(Number(directCoffeeParam));
      return;
    }

    if (legacyCoffeeId) {
      fetch(`/api/coffees/${legacyCoffeeId}/legacy-slot`)
        .then(r => (r.ok ? r.json() : null))
        .then((resolved: { archetype: string; dialSortOrder: number } | null) => {
          if (resolved) {
            selectSlot(resolved.archetype, resolved.dialSortOrder);
            setPendingScroll(true);
            navigate(`/flavor-intelligence?archetype=${resolved.archetype}&slot=${resolved.dialSortOrder}`, { replace: true });
          } else {
            defaultSelect();
          }
        })
        .catch(() => defaultSelect());
      return;
    }

    defaultSelect();

    function defaultSelect() {
      const matched = isMatched ? archetypes.find(a => a.archetype === matchArchetypeId) : undefined;
      const target = matched ?? archetypes[0];
      if (!target) return;
      const slot = findDefaultSlot(target);
      selectSlot(target.archetype, slot?.dialSortOrder ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archetypesLoaded, homepageStateLoaded, archetypes]);

  useEffect(() => {
    if (!pendingScroll || !selectedArchetype || selectedSlot == null) return;
    const el = cardRefs.current[slotKey(selectedArchetype, selectedSlot)];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setPendingScroll(false); }
  }, [pendingScroll, selectedArchetype, selectedSlot, expanded]);

  // ── Load selected coffee's data ─────────────────────────────────────────────
  const selectedArchData = displayArchetypes.find(a => a.archetype === selectedArchetype);
  const selectedSlotData = selectedArchData?.slots.find(s => s.dialSortOrder === selectedSlot);
  // Bloom Dial Base Data Part 3, Phase 6: a directly-selected category coffee has no
  // dial slot, so it takes priority when set — selectSlot() always clears it, so normal
  // dial navigation naturally wins back over a stale direct selection.
  const directCoffee = directCoffeeId != null ? otherCategories.find(c => c.coffeeId === directCoffeeId) ?? null : null;
  const selectedCoffeeId = directCoffeeId ?? (selectedSlotData?.coffeeId ?? null);
  const displayName = selectedSlotData?.platformName ?? directCoffee?.displayName ?? '';

  useEffect(() => {
    if (!selectedCoffeeId) { setContent(null); setDimensions([]); setNotes([]); setWheelRows([]); return; }
    setLoading(true);
    setContentLoading(true);
    Promise.all([
      fetch(`/api/coffees/${selectedCoffeeId}/flavor-wheel`).then(r => r.json()),
      fetch(`/api/coffees/${selectedCoffeeId}/dimensions`).then(r => r.json()),
    ]).then(([wheel, dimData]) => {
      setWheelRows(wheel);
      setDimensions(dimData.dimensions ?? []);
      setNotes(dimData.notes ?? []);
      setLoading(false);
      fetch(`/api/coffees/${selectedCoffeeId}/content`)
        .then(r => r.json())
        .then((data: CoffeeContent) => setContent(data))
        .catch(() => {})
        .finally(() => setContentLoading(false));
    }).catch(() => { setError('Failed to load coffee data'); setLoading(false); setContentLoading(false); });
  }, [selectedCoffeeId]);

  const { compat, dimCompText } = useCompatibility(selectedArchData?.archetype ?? directCoffee?.archetype ?? null, matchArchetypeId, dimensions);
  const compareArchetype = compareCoffeeId
    ? displayArchetypes.find(a => a.slots.some(s => s.coffeeId === compareCoffeeId))?.archetype ?? null
    : null;
  const { compat: compareCompat } = useCompatibility(compareArchetype, matchArchetypeId, compareDimensions);

  // ── Compare mode (Decision #4) ──────────────────────────────────────────────
  const compareOptions = useMemo(() => (
    displayArchetypes.flatMap(a => a.slots
      .filter(s => s.isActive && s.coffeeId != null && s.coffeeId !== selectedCoffeeId)
      .map(s => ({ coffeeId: s.coffeeId!, archetypeLabel: a.archetypeLabel, platformName: s.platformName! })))
  ), [displayArchetypes, selectedCoffeeId]);

  useEffect(() => {
    if (!compareMode || !compareCoffeeId) {
      setCompareContent(null); setCompareDimensions([]); setCompareWheelRows([]); return;
    }
    setCompareLoading(true);
    Promise.all([
      fetch(`/api/coffees/${compareCoffeeId}/flavor-wheel`).then(r => r.json()),
      fetch(`/api/coffees/${compareCoffeeId}/dimensions`).then(r => r.json()),
      fetch(`/api/coffees/${compareCoffeeId}/content`).then(r => r.json()),
    ]).then(([wheel, dimData, cContent]) => {
      setCompareWheelRows(wheel);
      setCompareDimensions(dimData.dimensions ?? []);
      setCompareContent(cContent);
    }).catch(() => {}).finally(() => setCompareLoading(false));
  }, [compareMode, compareCoffeeId]);

  function toggleCompareMode() {
    setCompareMode(v => { if (v) { setCompareCoffeeId(null); setCompareLabel(undefined); } return !v; });
  }

  function handleCompareSelect(coffeeId: number) {
    setCompareCoffeeId(coffeeId);
    setCompareLabel(compareOptions.find(o => o.coffeeId === coffeeId)?.platformName);
  }

  function toggleSection(archetype: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(archetype)) next.delete(archetype); else next.add(archetype);
      return next;
    });
  }

  function handleSelectCard(archetype: string, dialSortOrder: number) {
    selectSlot(archetype, dialSortOrder);
    if (compareMode && displayArchetypes.find(a => a.archetype === archetype)?.slots.find(s => s.dialSortOrder === dialSortOrder)?.coffeeId === compareCoffeeId) {
      setCompareCoffeeId(null);
    }
  }

  // ── Section ordering (Decision #2) ──────────────────────────────────────────
  // Experimental (from displayArchetypes) is never the match and never adjacent
  // (v_archetype_adjacency only covers the 5 real archetypes), so it always lands
  // in restSections — the "Explore other flavor families" bucket at the bottom,
  // same general position the old grouped "The Unexpected" section used to occupy.
  const { matchSection, adjacentSections, restSections } = useMemo(() => {
    if (!isMatched || !matchArchetypeId) return { matchSection: null, adjacentSections: [] as ArchetypeData[], restSections: displayArchetypes };
    const match = displayArchetypes.find(a => a.archetype === matchArchetypeId) ?? null;
    const adjacentIds = new Set(adjacency[matchArchetypeId] ?? []);
    const adjacentSections = displayArchetypes.filter(a => a.archetype !== matchArchetypeId && adjacentIds.has(a.archetype));
    const restSections = displayArchetypes.filter(a => a.archetype !== matchArchetypeId && !adjacentIds.has(a.archetype));
    return { matchSection: match, adjacentSections, restSections };
  }, [displayArchetypes, adjacency, isMatched, matchArchetypeId]);

  // ── Personalized secondary copy per stage (Decision #2) ─────────────────────
  function renderSecondary(stageCode: string) {
    if (stageCode === 'QUIZ_TAKEN_FRESH_NO_ORDER') {
      return <Link to="/bloom" className={QUIET_LINK_CLASS}>Shop your match on The Bloom →</Link>;
    }
    if (stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER') {
      return (
        <div className="flex flex-wrap gap-x-9 gap-y-3">
          <Link to="/bloom" className={QUIET_LINK_CLASS}>Shop your match on The Bloom →</Link>
          <Link to="/find-my-flavor" className={QUIET_LINK_CLASS} style={{ opacity: 0.6 }}>Retake the quiz →</Link>
        </div>
      );
    }
    if (stageCode === 'QUIZ_STALE_NO_ORDER') {
      return (
        <div className="flex flex-wrap gap-x-9 gap-y-3">
          <Link to="/bloom" className={QUIET_LINK_CLASS}>Shop your match on The Bloom →</Link>
          <Link to="/find-my-flavor" className={QUIET_LINK_CLASS} style={{ opacity: 0.6 }}>Palates change — retake anytime →</Link>
        </div>
      );
    }
    if (stageCode === 'SUBSCRIBER') {
      return <p className="text-[15.5px] font-light" style={{ color: '#7b7f80' }}>This is the flavor intelligence behind your regular pick.</p>;
    }
    if (stageCode === 'LAPSED_SINGLE_ORDER') {
      return <p className="text-[15.5px] font-light" style={{ color: '#7b7f80' }}>It's been a while — here's what else is worth trying.</p>;
    }
    return null; // REORDER_DUE, ACTIVE_REPEAT_USER — no secondary nudge on this page
  }

  const matchArchetypeLabel = matchArchetypeId ? (ARCHETYPE_LABEL[matchArchetypeId] ?? matchArchetypeId) : null;

  // ── Archetype accordion section ─────────────────────────────────────────────
  function renderSection(data: ArchetypeData, tag?: string) {
    const isOpen = expanded.has(data.archetype);
    const activeSlots = data.slots.filter(s => s.isActive);
    // Bloom Dial Base Data Part 4, §C1: category coffees (Decaf/Half-Caf/Flavored)
    // nest under their matched archetype here instead of Part 3's separate "Other
    // Categories" section (FI isn't the shopping page — Bloom keeps that section).
    // Part 5: Experimental-category coffees are excluded outright — Experimental is
    // a presentation box (§B2 above), not a nestable category, so a coffee like Kopi
    // Safari (Experimental category + matched to experimental) doesn't also get a
    // "Categories: Experimental" sub-list inside its own Experimental box. This also
    // means the Experimental box always ends up with an empty categoryCoffees list.
    const categoryCoffees = otherCategories.filter(
      c => c.archetype === data.archetype && !c.categories.some(cat => cat.code === 'experimental')
    );
    return (
      <div key={data.archetype} style={{ borderBottom: '1px solid #deded1' }}>
        <button
          onClick={() => toggleSection(data.archetype)}
          className="w-full flex items-center justify-between gap-4 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ARCHETYPE_COLOR[data.archetype] ?? '#999' }} />
            {/* Deliberately one tier below the "highlight" sub-heading role (text-xl) above —
                this is a nav-level list label, not a content heading. */}
            <span className="text-base font-light" style={{ color: '#45474a' }}>{data.archetypeLabel}</span>
            <span className="text-xs" style={{ color: '#b3b0a6' }}>{activeSlots.length} coffee{activeSlots.length !== 1 ? 's' : ''}</span>
            {tag && (
              <span className="text-[10px] uppercase tracking-[.1em] px-2 py-0.5 rounded-full border" style={{ borderColor: '#9a2918', color: '#9a2918' }}>{tag}</span>
            )}
          </div>
          <span className="text-sm" style={{ color: '#7b7f80' }}>{isOpen ? '−' : '+'}</span>
        </button>
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }} className="overflow-hidden"
            >
              <div className="pb-6 space-y-5">
                <div className="flex flex-wrap gap-3">
                  {activeSlots.map(slot => {
                    const isSelected = selectedArchetype === data.archetype && selectedSlot === slot.dialSortOrder;
                    return (
                      <button
                        key={slot.dialSortOrder}
                        ref={el => { cardRefs.current[slotKey(data.archetype, slot.dialSortOrder)] = el; }}
                        onClick={() => handleSelectCard(data.archetype, slot.dialSortOrder)}
                        className="text-left px-4 py-3 border transition-all duration-200 min-w-[180px]"
                        style={{
                          borderRadius: 2,
                          borderColor: isSelected ? '#9a2918' : '#deded1',
                          backgroundColor: 'transparent',
                        }}
                      >
                        <p className="text-sm" style={{ color: isSelected ? '#9a2918' : '#45474a' }}>{slot.platformName}</p>
                        <p className="text-xs mt-0.5" style={{ color: '#7b7f80' }}>{slot.positionLabel}</p>
                      </button>
                    );
                  })}
                </div>

                {categoryCoffees.length > 0 && (
                  <div>
                    <p className={`${MICRO_LABEL_CLASS} mb-2`} style={MICRO_LABEL_STYLE}>
                      Categories: {categoryCoffees.map(c => c.categories[0]?.label).filter(Boolean).join(', ')}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {categoryCoffees.map(coffee => {
                        const isSelected = directCoffeeId === coffee.coffeeId;
                        return (
                          <button
                            key={coffee.coffeeId}
                            onClick={() => selectDirectCoffee(coffee.coffeeId)}
                            className="text-left px-4 py-3 border transition-all duration-200 min-w-[180px]"
                            style={{
                              borderRadius: 2,
                              borderColor: isSelected ? '#9a2918' : '#deded1',
                              backgroundColor: 'transparent',
                            }}
                          >
                            <p className="text-sm" style={{ color: isSelected ? '#9a2918' : '#45474a' }}>{coffee.displayName}</p>
                            <p className="text-xs mt-0.5" style={{ color: '#7b7f80' }}>
                              {coffee.categories.map(c => c.label).join(' · ')}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen" style={{ backgroundColor: '#f2f1ea' }}>

      {/* ── Header ── */}
      <div className="pt-32 pb-12 px-8 md:px-16 max-w-[1400px] mx-auto">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <h1 className="text-5xl md:text-7xl font-normal leading-tight mb-4" style={{ color: '#9a2918' }}>
            Flavor Intelligence
          </h1>
          <p className="font-light max-w-xl" style={{ fontSize: 15.5, color: '#7b7f80', lineHeight: 1.65 }}>
            Every coffee, seen through three lenses — our cuppers, the roaster, and customers who've ordered it.
          </p>
        </motion.div>
      </div>

      <div className="px-8 md:px-16 max-w-[1400px] mx-auto pb-32">

        {/* ── 1. Feedback nudge (UC3) ── */}
        {homepageState?.pendingFeedback && !feedbackDismissed && (
          <div className="mb-10 p-6 border" style={{ borderColor: '#deded1', borderRadius: 2, backgroundColor: '#fff' }}>
            <p className="text-lg font-light mb-3" style={{ color: '#45474a' }}>
              How was {homepageState.pendingFeedback.blendName ?? 'your last coffee'}?
            </p>
            <OrderFeedbackForm
              orderId={homepageState.pendingFeedback.orderId}
              blendName={homepageState.pendingFeedback.blendName}
              coffeeId={homepageState.pendingFeedback.coffeeId}
              onSubmitted={() => setFeedbackDismissed(true)}
            />
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(`axisBloomFeedbackDismiss_${homepageState.pendingFeedback!.orderId}`, String(Date.now()));
                setFeedbackDismissed(true);
              }}
              className="mt-3 opacity-85 hover:opacity-100"
              style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: '#9a2918' }}
            >
              Not now
            </button>
          </div>
        )}

        {/* ── 2. Personalized header (UC1/UC4) ── */}
        {isMatched && matchArchetypeLabel && homepageState && (
          <div className="mb-10 pb-8" style={{ borderBottom: '1px solid #deded1' }}>
            {/* Coffee/archetype "highlight" sub-heading role: text-xl everywhere it appears
                (here and the compare-mode h3s below), one step under the selected-coffee H2
                below (text-3xl), which stays largest as the page's primary focus. */}
            <p className="text-xl font-normal mb-1" style={{ color: '#9a2918' }}>
              Your match: {matchArchetypeLabel}
            </p>
            <div className="mt-3">{renderSecondary(homepageState.stageCode)}</div>
          </div>
        )}

        {/* ── 3. Quiz nudge banner (UC0/UC2) ── */}
        {!isMatched && (
          <div className="mb-10 pb-8 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: '1px solid #deded1' }}>
            <p className="text-[15.5px] font-light" style={{ color: '#45474a' }}>
              {user ? "Ready to find your flavor?" : "Not sure where to start? Take the quiz to see your match →"}
            </p>
            <Link to="/find-my-flavor" className={QUIET_LINK_CLASS}>Take the quiz →</Link>
          </div>
        )}

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        <div className="flex flex-col lg:flex-row gap-12">
          {/* ── 4. Archetype accordion (left) ── */}
          <div className="lg:w-80 flex-shrink-0 lg:sticky lg:top-24 lg:self-start">
            {matchSection && renderSection(matchSection)}
            {adjacentSections.map(a => renderSection(a, 'Worth exploring'))}
            {isMatched && (matchSection || adjacentSections.length > 0) && restSections.length > 0 && (
              <p className={`${MICRO_LABEL_CLASS} py-4`} style={MICRO_LABEL_STYLE}>Explore other flavor families</p>
            )}
            {restSections.map(a => renderSection(a))}
          </div>

          {/* ── 5. Selected coffee detail panel (right, majority width) ── */}
          <div className="flex-1 min-w-0">
          {(selectedSlotData || directCoffee) ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedSlotData ? slotKey(selectedArchetype ?? '', selectedSlot ?? -1) : `direct-${directCoffeeId}`}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}
            >
              <div className="mb-8 pb-6" style={{ borderBottom: '1px solid #deded1' }}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex-1">
                    {/* Primary focus of the page — one step larger than the "highlight" role, on purpose. */}
                    <h2 className="text-3xl font-normal" style={{ color: '#9a2918' }}>
                      {displayName}
                    </h2>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {selectedArchData && (
                        <span className="text-xs px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: ARCHETYPE_COLOR[selectedArchData.archetype] ?? '#999' }}>
                          {selectedArchData.archetypeLabel}
                        </span>
                      )}
                      {selectedSlotData && (
                        <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: '#deded1', color: '#7b7f80' }}>
                          {selectedSlotData.positionLabel}
                        </span>
                      )}
                      {directCoffee && directCoffee.categories.map(c => (
                        <span key={c.code} className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: '#deded1', color: '#7b7f80' }}>
                          {c.label}
                        </span>
                      ))}
                      {content?.process && (
                        <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: '#deded1', color: '#7b7f80' }}>{content.process}</span>
                      )}
                      {content?.roastLevel && (
                        <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: '#deded1', color: '#7b7f80' }}>{content.roastLevel}</span>
                      )}
                      {content?.originRegion && (
                        <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: '#deded1', color: '#7b7f80' }}>{content.originRegion}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Part 10 — the only purchase path from this page; checkout/pricing
                        deliberately stay on The Bloom (Part 2 Decision #2). Shown for every
                        coffee regardless of lifecycle stage — this is about the coffee
                        currently in view, not a personalized nudge. Bloom doesn't read these
                        query params yet (no useSearchParams in BloomPage.tsx as of this
                        writing) — link still works, just lands on Bloom's default view
                        instead of scrolling to this archetype; flagged as a known gap. */}
                    {selectedArchData && selectedSlot != null && (
                      <Link
                        to={`/bloom?archetype=${selectedArchData.archetype}&slot=${selectedSlot}`}
                        className="text-[10.5px] uppercase tracking-[.1em] px-3 py-1.5 rounded-full border transition-all duration-200"
                        style={{ borderColor: '#9a2918', color: '#9a2918', backgroundColor: 'transparent' }}
                      >
                        Shop on The Bloom →
                      </Link>
                    )}
                    {/* directCoffee has no dial slot, so no equivalent Bloom deep link exists
                        (Bloom's Other Categories section isn't individually anchorable this
                        pass) — buy inline here instead, reusing the same card the Bloom/Unexpected
                        sections use (Bloom Dial Base Data Part 3, Phase 6). Compare mode is
                        dial-only this pass, so the toggle is simply omitted for a direct coffee. */}
                    {selectedSlotData && (
                      <button
                        onClick={toggleCompareMode}
                        className="text-[10.5px] uppercase tracking-[.1em] px-3 py-1.5 rounded-full border transition-all duration-200"
                        style={{
                          borderColor: compareMode ? '#9a2918' : '#deded1',
                          color: compareMode ? '#9a2918' : '#7b7f80',
                          backgroundColor: 'transparent',
                        }}
                      >
                        {compareMode ? 'Exit compare' : '⇄ Compare'}
                      </button>
                    )}
                  </div>
                </div>

                {directCoffee && (
                  <div className="mt-4 max-w-sm">
                    <OtherCategoryCard
                      coffee={directCoffee}
                      categoryLabel={directCoffee.categories[0]?.label ?? ''}
                      onAddToCart={addToCart}
                      renderFlavorIntelligenceLink={() => null}
                    />
                  </div>
                )}

                {compareMode && (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className={MICRO_LABEL_CLASS} style={MICRO_LABEL_STYLE}>Compare with</span>
                    <select
                      value={compareCoffeeId ?? ''}
                      onChange={e => e.target.value ? handleCompareSelect(Number(e.target.value)) : setCompareCoffeeId(null)}
                      className="text-sm px-3 py-1.5 border bg-white min-w-0 max-w-full flex-1 sm:flex-none"
                      style={{ borderColor: '#deded1', color: '#45474a', borderRadius: 2 }}
                    >
                      <option value="">Select a coffee…</option>
                      {compareOptions.map(o => (
                        <option key={o.coffeeId} value={o.coffeeId}>{o.archetypeLabel} — {o.platformName}</option>
                      ))}
                    </select>
                    {compareLoading && <span className="text-xs" style={{ color: '#7b7f80' }}>Loading…</span>}
                  </div>
                )}
              </div>

              {loading && (
                <div className="flex items-center gap-2 py-16">
                  <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: '#deded1', borderTopColor: '#7b7f80' }} />
                  <span className="text-[15.5px] font-light" style={{ color: '#7b7f80' }}>Loading…</span>
                </div>
              )}

              {!loading && (() => {
                // Part 15 — hairline rhythm between sections (Section 2: "flat 1px #deded1
                // hairlines between sections, ~32px rhythm"). Each block's "will it render"
                // condition mirrors the JSX below exactly, so a hairline never appears next
                // to an empty/absent block — same discipline as RevealedPanel.tsx/Part 13.
                const showCompatBadge = !!(compat && matchArchetypeId && !compareMode);
                const showCompareGrid = compareMode && !!compareCoffeeId;
                const showTastingNotes = !compareMode; // 'full' TastingNotes always renders at least Liam's intake
                const showCuppingNotes = !compareMode && notes.length > 0;
                const showDimensionBars = dimensions.length > 0 || !!(compareMode && compareCoffeeId && compareDimensions.length > 0);
                const showWheel = wheelRows.length > 0;
                return (
                  <div>
                    {showCompatBadge && (
                      <div className="flex flex-col gap-3">
                        <CompatibilityBadge level={compat!} userArchetype={matchArchetypeId!} />
                        {dimCompText && (
                          <p className="text-[15.5px] font-light" style={{ color: '#7b7f80', lineHeight: 1.55, maxWidth: '52ch' }}>{dimCompText}</p>
                        )}
                      </div>
                    )}

                    {showCompatBadge && (showCompareGrid || showTastingNotes || showCuppingNotes || showDimensionBars || showWheel) && <hr style={RULE_STYLE} />}

                    {showCompareGrid && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="flex flex-col gap-3">
                          <h3 className="text-xl font-normal" style={{ color: '#9a2918' }}>{displayName}</h3>
                          {compat && matchArchetypeId && <CompatibilityBadge level={compat} userArchetype={matchArchetypeId} />}
                        </div>
                        <div className="flex flex-col gap-3">
                          <h3 className="text-xl font-normal" style={{ color: '#9a2918' }}>{compareLabel}</h3>
                          {compareCompat && matchArchetypeId && <CompatibilityBadge level={compareCompat} userArchetype={matchArchetypeId} />}
                        </div>
                      </div>
                    )}

                    {showCompareGrid && (showTastingNotes || showCuppingNotes || showDimensionBars || showWheel) && <hr style={RULE_STYLE} />}

                    {showTastingNotes && (
                      <TastingNotes content={content} contentLoading={contentLoading} talkToLiamLink="/sommelier?entry=user_initiated" />
                    )}

                    {showTastingNotes && (showCuppingNotes || showDimensionBars || showWheel) && <hr style={RULE_STYLE} />}

                    {showCuppingNotes && <CuppingNotes notes={notes} />}

                    {showCuppingNotes && (showDimensionBars || showWheel) && <hr style={RULE_STYLE} />}

                    {showDimensionBars && (
                      <DimensionBars
                        dimensions={dimensions}
                        compareDimensions={compareMode && compareCoffeeId ? compareDimensions : undefined}
                        primaryLabel={displayName || undefined}
                        compareLabel={compareLabel}
                      />
                    )}

                    {showDimensionBars && showWheel && <hr style={RULE_STYLE} />}

                    {showWheel && (
                      <CollaborativeFlavorWheel
                        wheelRows={wheelRows}
                        compareWheelRows={compareMode && compareCoffeeId ? compareWheelRows : undefined}
                        primaryLabel={displayName || undefined}
                        compareLabel={compareLabel}
                      />
                    )}
                  </div>
                );
              })()}
            </motion.div>
          </AnimatePresence>
          ) : (
            <div className="py-16 text-center">
              <p className="text-[15.5px] font-light" style={{ color: '#7b7f80' }}>Select a coffee to see its flavor intelligence.</p>
            </div>
          )}
          </div>
        </div>

      </div>
    </div>
  );
}
