import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { getUserProfile, getDialPosition, setDialPosition, getCoffeeCards, type CoffeeCards, type OtherCard } from '../lib/api';
import { reportError } from '../lib/errorReporter';
import { usePrelaunchGated } from '../lib/prelaunch';
import { ARCHETYPE_VISUALS } from './bloom/bloomVisuals';
import { CompareOverlay } from './bloom/CompareOverlay';
import { DialArchetypeSection } from './bloom/DialArchetypeSection';
import { openingSortOrder } from './bloom/useDialSlot';
import { resolveLandingSortOrder } from './bloom/doorConfig';
import { SlotShopCard, OtherShopCard, familyLookOf } from './shop/ShopCoffeeCard';
import { Wrap, Caps, Titled } from './chrome';
import { shopAssets, lifestyleAssets } from '../../design/assets';
import type { ArchetypeData, DoorTarget, Slot } from './bloom/types';
import './bloom/field/bloomField.css';

// Website 5 (2026-11-05): /bloom is the handoff page (source/bloom-b, option B):
// "The Bloom Dial" with the 01/02/03 strip, five family tabs (personalized
// order, YOUR / TO EXPLORE), one field for the selected family
// (DialArchetypeSection layout="field": the flower wheel, the coffee, the
// comfort zone, the reveal, the lineup, the quick picks), then the Other
// block (Experimental as compact cards, S2 decided 2026-11-05; the named
// category coffees), the doors (kill switch, S1) and the quiz link.
// Every behaviour of the old page survives: the saved position pre-set,
// the silent auto-save on every settled turn, ?archetype=&slot= deep links
// (Liam, Flavor Intelligence, the quiz), hasTurnedDial, Compare.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_5_THE_BLOOM.md

const EXPERIMENTAL = 'experimental';

export default function BloomPage() {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const gated = usePrelaunchGated();
  const [searchParams, setSearchParams] = useSearchParams();

  const [archetypes, setArchetypes] = useState<ArchetypeData[]>([]);
  const [experimentalData, setExperimentalData] = useState<ArchetypeData | null>(null);
  const [cards, setCards] = useState<CoffeeCards | null>(null);
  const [archetypeOrder, setArchetypeOrder] = useState<string[] | null>(null);
  const [orderSettled, setOrderSettled] = useState(false);
  const [catalogueSettled, setCatalogueSettled] = useState(false);
  const [error, setError] = useState(false);
  const [userArchetype, setUserArchetype] = useState<string | null>(null);
  const [userArchetypeLoaded, setUserArchetypeLoaded] = useState(false);

  const [selectedSortOrder, setSelectedSortOrder] = useState<Record<string, number>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [experimentalFocus, setExperimentalFocus] = useState<number | null>(null);

  // Part 21 §4.3: the strip's hint stays until the visitor turns the dial once
  // (localStorage, guests included); a signed-in customer with a saved
  // position from an earlier visit never needs it.
  const [hasTurnedDial, setHasTurnedDial] = useState(() => {
    // localStorage unavailable (private browsing, blocked storage): not an error, the hint just returns next visit.
    try { return localStorage.getItem('axisbloom.hasTurnedDial') === '1'; } catch { return false; }
  });
  const [hasSavedPosition, setHasSavedPosition] = useState(false);
  const showHints = !hasTurnedDial && !(user && hasSavedPosition);

  const [compareState, setCompareState] = useState<{ open: boolean; archetype: string; archetypeLabel: string; slot: Slot | null }>({
    open: false, archetype: '', archetypeLabel: '', slot: null,
  });

  // A deep-linked slot wins over the saved position for that family (the link is the newer intent).
  const linkedRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const archetypesFetch = fetch('/api/coffees/archetypes')
      .then(r => r.json())
      .then((data: ArchetypeData[]) => {
        setArchetypes(data);
        setSelectedSortOrder(prev => {
          const next = { ...prev };
          // Website 6 B2: open on the classic when sellable, else the nearest sellable stop.
          for (const a of data) if (!(a.archetype in next)) next[a.archetype] = openingSortOrder(a);
          return next;
        });
      })
      .catch(err => { reportError('[BloomPage/archetypes]', err); setError(true); });

    const experimentalFetch = fetch('/api/coffees/experimental')
      .then(r => r.json())
      .then((data: ArchetypeData) => setExperimentalData(data))
      .catch(err => reportError('[BloomPage/experimental]', err));

    // the presentation fields (words, notes, spec rows, Premium ★) and the named category coffees (OT-70)
    getCoffeeCards().then(setCards).catch(err => reportError('[BloomPage/cards]', err));

    // The deep-link effect waits for the catalogue to be settled, not merely non-empty.
    Promise.allSettled([archetypesFetch, experimentalFetch]).then(() => setCatalogueSettled(true));
  }, []);

  useEffect(() => {
    if (!user) { setUserArchetype(null); setUserArchetypeLoaded(true); return; }
    setUserArchetypeLoaded(false);
    getUserProfile()
      .then(p => setUserArchetype(p?.archetype?.id ?? null))
      .catch(err => { reportError('[BloomPage/user-archetype]', err); setUserArchetype(null); })
      .finally(() => setUserArchetypeLoaded(true));
  }, [user]);

  // Personalized order (the customer's family first, then the nearest), server-side.
  useEffect(() => {
    if (!userArchetypeLoaded) return;
    const qs = userArchetype ? `?archetype=${encodeURIComponent(userArchetype)}` : '';
    fetch(`/api/coffees/archetype-order${qs}`)
      .then(r => r.json())
      .then((data: { order: string[] }) => setArchetypeOrder(data.order))
      .catch(err => { reportError('[BloomPage/archetype-order]', err); setArchetypeOrder(null); })
      .finally(() => setOrderSettled(true));
  }, [userArchetype, userArchetypeLoaded]);

  const ordered = useMemo(() => {
    if (!archetypeOrder) return archetypes;
    return [...archetypes].sort((a, b) => archetypeOrder.indexOf(a.archetype) - archetypeOrder.indexOf(b.archetype));
  }, [archetypes, archetypeOrder]);

  // Phase D: pre-set each family's wheel to the signed-in customer's saved position.
  useEffect(() => {
    if (!user || !archetypes.length) return;
    Promise.all(archetypes.map(a => getDialPosition(a.archetype).then(r => [a.archetype, r.dialSortOrder] as const).catch(err => { reportError('[BloomPage/dial-position-read]', err); return [a.archetype, null] as const; })))
      .then(entries => {
        setSelectedSortOrder(prev => {
          const next = { ...prev };
          for (const [archetype, sortOrder] of entries) {
            if (sortOrder != null && !(archetype in linkedRef.current)) next[archetype] = sortOrder;
          }
          return next;
        });
        if (entries.some(([, sortOrder]) => sortOrder != null)) setHasSavedPosition(true);
      });
  }, [user, archetypes]);

  // The tab is URL state (?archetype=); an unknown or absent one shows the first family in the order.
  const archetypeParam = searchParams.get('archetype');
  const selected = ordered.find(a => a.archetype === archetypeParam) ?? ordered[0] ?? null;

  // ?archetype=&slot= deep links (Liam's action links, Flavor Intelligence's "Shop on
  // The Bloom", the quiz). Handled whenever they change (a link followed while already
  // on /bloom too); a tab click changes ?archetype= itself and is not re-handled.
  const internalNav = useRef(false);
  useEffect(() => {
    if (!catalogueSettled) return;
    if (internalNav.current) { internalNav.current = false; return; }
    if (!archetypeParam) return;
    const slotNum = Number(searchParams.get('slot'));
    if (archetypeParam === EXPERIMENTAL) {
      const valid = experimentalData?.slots.some(s => s.dialSortOrder === slotNum);
      setExperimentalFocus(valid ? slotNum : null);
      requestAnimationFrame(() => document.getElementById(EXPERIMENTAL)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    const target = archetypes.find(a => a.archetype === archetypeParam);
    if (!target) return;
    if (target.slots.some(s => s.dialSortOrder === slotNum)) {
      linkedRef.current[archetypeParam] = slotNum;
      setSelectedSortOrder(prev => ({ ...prev, [archetypeParam]: slotNum }));
    }
    requestAnimationFrame(() => document.getElementById(archetypeParam)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [catalogueSettled, archetypeParam, searchParams, archetypes, experimentalData]);

  function selectTab(archetype: string, focusTab = false) {
    internalNav.current = true;
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('archetype', archetype); next.delete('slot'); return next; }, { replace: true });
    if (focusTab) requestAnimationFrame(() => document.getElementById(`bf-tab-${archetype}`)?.focus());
  }

  function onTabsKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!selected || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    const i = ordered.findIndex(a => a.archetype === selected.archetype);
    const next = ordered[(i + (e.key === 'ArrowRight' ? 1 : -1) + ordered.length) % ordered.length];
    if (next) selectTab(next.archetype, true);
  }

  // Silent auto-save on every settled turn (signed in; a guest falls through).
  function handleDialSelect(archetype: string, dialSortOrder: number) {
    setSelectedSortOrder(prev => ({ ...prev, [archetype]: dialSortOrder }));
    if (user) setDialPosition(archetype, dialSortOrder).catch(err => reportError('[BloomPage/dial-position-write]', err));
    if (!hasTurnedDial) {
      setHasTurnedDial(true);
      // localStorage unavailable: not an error, the hint just reappears next visit.
      try { localStorage.setItem('axisbloom.hasTurnedDial', '1'); } catch {}
    }
  }

  function toggleReveal(key: string) {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Part 19 §A doors (off while DOORS_ENABLED is false): open the neighbour's tab on the continuity-rule stop.
  function handleDoorClick(_from: string, edge: 'left' | 'right', target: DoorTarget) {
    const targetData = archetypes.find(a => a.archetype === target.archetype);
    if (!targetData) return;
    const landing = resolveLandingSortOrder(edge, targetData);
    setSelectedSortOrder(prev => ({ ...prev, [target.archetype]: landing }));
    selectTab(target.archetype);
    requestAnimationFrame(() => document.getElementById(target.archetype)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function openCompare(archetype: string, archetypeLabel: string, slot: Slot) {
    setCompareState({ open: true, archetype, archetypeLabel, slot });
  }

  const kickerFor = (archetype: string) => (user && userArchetype)
    ? (userArchetype === archetype ? 'Your' : 'To explore')
    : null;

  // OT-70: a category coffee with no customer-facing name is never shown.
  const otherCards = useMemo(
    () => (cards?.other.cards ?? []).filter((c): c is OtherCard & { platformName: string } => !!c.platformName),
    [cards],
  );
  const otherHeading = [...new Set(otherCards.flatMap(c => c.categories.map(k => k.label)))].join(' · ');
  const expLook = experimentalData ? familyLookOf(experimentalData) : null;

  const otherBlock = (experimentalData?.slots.length || otherCards.length) ? (
    <div className="bf-other" data-testid="other-block">
      {experimentalData && expLook && experimentalData.slots.length > 0 && (
        <div className="bf-other-group" id={EXPERIMENTAL} data-testid="experimental-group">
          <Titled style={{ alignSelf: 'flex-start' }}>{experimentalData.archetypeLabel}</Titled>
          <div className="bf-cards">
            {[...experimentalData.slots].sort((a, b) => a.dialSortOrder - b.dialSortOrder).map(s => (
              <SlotShopCard
                key={s.dialSortOrder}
                family={expLook}
                card={{ ...s, archetype: experimentalData.archetype, archetypeLabel: experimentalData.archetypeLabel }}
                gated={gated}
                source="bloom"
                compact
                selected={experimentalFocus === s.dialSortOrder}
              />
            ))}
          </div>
        </div>
      )}
      {otherCards.length > 0 && (
        <div className="bf-other-group" id="other-categories" data-testid="other-categories">
          <Titled style={{ alignSelf: 'flex-start' }}>{otherHeading}</Titled>
          <div className="bf-cards">
            {otherCards.map(card => {
              const fam = card.archetype ? ARCHETYPE_VISUALS[card.archetype] : undefined;
              return (
                <OtherShopCard
                  key={card.coffeeId}
                  card={card}
                  gated={gated}
                  look={{ color: fam?.color ?? 'var(--ab-ink)', plateInk: fam?.plateInk ?? 'var(--ab-paper)', photo: { asset: shopAssets.other, fallback: lifestyleAssets.coffee15 } }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  ) : null;

  const ready = catalogueSettled && orderSettled && !!selected;
  const familyCards = selected ? cards?.families.find(f => f.archetype === selected.archetype)?.cards : undefined;

  return (
    <div style={{ background: '#ffffff', minHeight: '100vh' }}>
      <Wrap as="section" className="bf-top" aria-label="Families of taste">
        <div className="bf-top-row">
          <h1 className="bf-h1"><Titled>The Bloom Dial</Titled></h1>
          <Caps weight={400} className="bf-steps">01 Pick your family · 02 Turn the dial · 03 Meet your coffee</Caps>
        </div>
      </Wrap>

      <div className="bf-tabs-bar">
        <Wrap>
          <div className="bf-tabs" role="tablist" aria-label="Families of taste" onKeyDown={onTabsKeyDown} data-testid="family-tabs">
            {ordered.map(a => {
              const on = selected?.archetype === a.archetype;
              const kicker = kickerFor(a.archetype);
              return (
                <button
                  key={a.archetype}
                  id={`bf-tab-${a.archetype}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={a.archetype}
                  tabIndex={on ? 0 : -1}
                  className="bf-tab"
                  style={{ ['--c' as string]: ARCHETYPE_VISUALS[a.archetype]?.color ?? 'currentColor' } as CSSProperties}
                  onClick={() => {
                    selectTab(a.archetype);
                    requestAnimationFrame(() => document.getElementById(a.archetype)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                  }}
                >
                  <span className="bf-tab-kicker" aria-hidden={!kicker}>{kicker ?? ''}</span>
                  <span className="bf-tab-name">{a.archetypeLabel}</span>
                </button>
              );
            })}
          </div>
        </Wrap>
      </div>

      {error && !archetypes.length ? (
        <Wrap className="bf-error" role="alert">
          <Caps>The coffees did not load. Refresh the page to try again.</Caps>
        </Wrap>
      ) : !ready ? (
        <div className="bf-loading" aria-busy="true" aria-label="Loading the coffees" />
      ) : (
        <DialArchetypeSection
          key={selected!.archetype}
          layout="field"
          data={selected!}
          cards={familyCards}
          index={0}
          selectedSortOrder={selectedSortOrder[selected!.archetype] ?? openingSortOrder(selected!)}
          revealedKeys={revealedKeys}
          onDialSelect={handleDialSelect}
          onToggleReveal={toggleReveal}
          onAddToCart={addToCart}
          onCompare={openCompare}
          userArchetype={userArchetype}
          registerDialRef={() => {}}
          source="bloom"
          prelaunch={gated}
          onDoorClick={handleDoorClick}
          hideHints={!showHints}
          between={otherBlock}
        />
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
