import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ARCHETYPE_VISUALS } from './bloomVisuals';
import { PositionCard } from './PositionCard';
import { RevealedPanel } from './RevealedPanel';
import { usePositionCardData } from './usePositionCardData';
import { BloomDialWidget, type BloomDialHandle, type DialPosition } from '../BloomDialWidget';
import { useAuth } from '../../context/AuthContext';
import { setDialPosition } from '../../lib/api';
import type { ArchetypeData, CartItem, Slot } from './types';
import { slotKey } from './types';

/** ★ default position — sort_order 2 ("Classic"/"Balanced"/etc.) by established convention
 * across every archetype's seeded vocabulary; falls back to the first defined position
 * for the rare archetype that doesn't have one. */
export function computeDefaultSortOrder(data: ArchetypeData): number {
  return data.slots.some(s => s.dialSortOrder === 2) ? 2 : (data.slots[0]?.dialSortOrder ?? 1);
}

/**
 * The per-archetype block (header row + photo/dial/card row + full-width
 * RevealedPanel) — extracted out of BloomPage.tsx (The Bloom Part 10, Phase A)
 * so it can be reused on other pages (starting with Find My Flavor's
 * returning-user screen). Carries over Parts 6–9's row-layout/bag-position
 * fixes unchanged; this extraction is behavior-identical on /bloom.
 */
export function ArchetypeSection({
  data, index, selectedSortOrder, revealedKeys, onDialSelect, onToggleReveal, onAddToCart, onHopClick, onCompare,
  userArchetype, registerDialRef, showPhoto = true, source = null, hideProfileLink = false,
}: {
  data: ArchetypeData;
  index: number;
  selectedSortOrder: number;
  revealedKeys: Set<string>;
  onDialSelect: (archetype: string, dialSortOrder: number) => void;
  onToggleReveal: (key: string) => void;
  onAddToCart: (item: CartItem) => void;
  onHopClick: (archetype: string, dialSortOrder: number) => void;
  onCompare: (archetype: string, archetypeLabel: string, slot: Slot) => void;
  userArchetype: string | null;
  registerDialRef: (archetype: string, handle: BloomDialHandle | null) => void;
  /** When false, omits the photo column — the dial (fixed basis) stays as-is and the
   * card column's existing flex:1 naturally absorbs the freed width, so the row
   * redistributes rather than leaving a gap. Default true (today's /bloom look). */
  showPhoto?: boolean;
  /** Liam Dial Event Log — which of the four dial surfaces rendered this instance
   * (/bloom, both Find My Flavor screens, Profile), carried on explicit_save/
   * add_to_cart events. Defaults to null so existing call sites compile unchanged. */
  source?: 'bloom' | 'find_my_flavor_returning' | 'find_my_flavor_results' | 'profile' | null;
  /** Profile Part 6, issue D: threaded straight through to RevealedPanel's
   * "Your flavor profile →" link. Additive, default false (shown) — only the
   * Profile page passes true, since a self-link there is noise. */
  hideProfileLink?: boolean;
}) {
  const { user } = useAuth();
  const visual = ARCHETYPE_VISUALS[data.archetype];
  const flip = index % 2 !== 0;
  const eager = index === 0;

  if (!visual) return null;

  const defaultSortOrder = computeDefaultSortOrder(data);
  const dialPositions: DialPosition[] = data.slots.map(s => ({
    dialSortOrder: s.dialSortOrder,
    label: s.positionLabel,
    description: s.description,
    isActive: s.isActive,
  }));
  const currentSlot = data.slots.find(s => s.dialSortOrder === selectedSortOrder)
    ?? data.slots.find(s => s.dialSortOrder === defaultSortOrder)
    ?? data.slots[0];
  const currentKey = slotKey(data.archetype, currentSlot.dialSortOrder);
  const isRevealed = revealedKeys.has(currentKey);

  // Shared fetch/derived state for this position — one fetch, used by both the
  // collapsed PositionCard below and the full-width RevealedPanel underneath
  // the three-column row (The Bloom Part 4, Phase D).
  const cardData = usePositionCardData(currentSlot, data.archetype, isRevealed);

  // Liam Dial Event Log, Phase A — the "Save to my flavor memory" button and
  // add-to-cart capture. Both PATCH /api/users/dial-position with a `trigger`,
  // which additionally appends a Firestore users/{uid}/dial_events doc server-side;
  // the silent auto-save on every plain dial turn (onDialSelect, in the parent) is
  // untouched and still calls setDialPosition with no trigger. Signed-in only —
  // nothing to save to for a guest.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  useEffect(() => { setSavedKey(null); }, [currentKey]);

  function handleExplicitSave() {
    if (!user) return;
    setDialPosition(data.archetype, currentSlot.dialSortOrder, { trigger: 'explicit_save', source })
      .then(() => setSavedKey(currentKey))
      .catch(() => {});
  }

  function handleAddToCart(item: CartItem) {
    onAddToCart(item);
    if (user) {
      setDialPosition(data.archetype, currentSlot.dialSortOrder, {
        trigger: 'add_to_cart', source, coffeeId: currentSlot.coffeeId,
      }).catch(() => {});
    }
  }

  return (
    <motion.section
      id={data.archetype}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.06 }}
      transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
      style={{
        borderTop: '1px solid rgba(154,41,24,0.08)',
        padding: 'clamp(52px, 7vh, 92px) clamp(32px, 6vw, 96px)',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 'clamp(28px, 4vh, 52px)',
      }}>
        <span style={{ fontSize: '0.49rem', letterSpacing: '0.38em', textTransform: 'uppercase', color: visual.color, opacity: 0.52 }}>
          No. {visual.num}
        </span>
        <span style={{ fontSize: '0.49rem', letterSpacing: '0.26em', textTransform: 'uppercase', color: visual.color, opacity: 0.40 }}>
          {data.archetypeLabel}
        </span>
      </div>

      <div
        className={`flex flex-col ${flip ? 'md:flex-row-reverse' : 'md:flex-row'}`}
        style={{ gap: 'clamp(24px, 3.5vw, 56px)', alignItems: 'flex-start' }}
      >
        {/* ── Photo column — a fixed height that never changes, regardless of whether
             the current position is active or unavailable. Anchored to the active
             card's typical total height (heading + bag/card sub-row, ~319px measured
             live), not computed relative to whatever the neighboring columns produce
             on a given row/state — the dial's own height is already state-invariant,
             but the card column's isn't, so "match a neighbor" was the wrong mental
             model even though Part 7's fixed pixel values happened to land close
             (The Bloom Part 9, Phase C). Omitted entirely when showPhoto is false
             (Part 10, Phase A) — the dial's fixed basis and the card's flex:1
             naturally redistribute the row's width without it. ── */}
        {showPhoto && (
          <div className="w-full md:basis-[27%] md:flex-none" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ height: 213, overflow: 'hidden' }}>
              <img
                src={visual.hero}
                alt={`${data.archetypeLabel} — Axis & Bloom archetype`}
                width={800} height={600}
                loading={eager ? 'eager' : 'lazy'}
                decoding={eager ? 'sync' : 'async'}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              <div style={{ height: 101, overflow: 'hidden' }}>
                <img src={visual.sm1} alt="" width={400} height={400} loading="lazy" decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
              <div style={{ height: 101, overflow: 'hidden' }}>
                <img src={visual.sm2} alt="" width={400} height={400} loading="lazy" decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            </div>
          </div>
        )}

        {/* ── Dial column — dial only; the bag lives beside the card now (Part 7) ── */}
        <div className="w-full md:basis-[26%] md:flex-none" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <BloomDialWidget
            ref={el => registerDialRef(data.archetype, el)}
            color={visual.color}
            archetypeLabel={data.archetypeLabel}
            positions={dialPositions}
            dimensionLabel={data.dimensionPlatformName}
            defaultSortOrder={defaultSortOrder}
            initialSortOrder={selectedSortOrder}
            onSelect={sortOrder => onDialSelect(data.archetype, sortOrder)}
          />
          {user && (
            <button
              onClick={handleExplicitSave}
              disabled={savedKey === currentKey}
              className="text-[10px] uppercase tracking-[0.15em] mt-3 transition-opacity"
              style={{ color: visual.color, opacity: savedKey === currentKey ? 0.55 : 0.85 }}
            >
              {savedKey === currentKey ? 'Saved ✓' : 'Save to my flavor memory'}
            </button>
          )}
        </div>

        {/* ── Dynamic position card, with the bag sitting beside it on the dial-facing side (Part 7) ── */}
        <div className="w-full md:flex-1" style={{ minWidth: 0 }}>
          <h2 style={{
            fontSize: 'clamp(2rem, 3.2vw, 4rem)', color: visual.color, fontWeight: 400,
            lineHeight: 0.95, margin: '0 0 clamp(20px, 3vh, 32px)', letterSpacing: '-0.02em',
          }}>
            {data.archetypeLabel}
          </h2>
          <div
            className={`flex flex-col ${flip ? 'md:flex-row-reverse' : 'md:flex-row'}`}
            style={{ gap: 'clamp(14px, 2vw, 24px)', alignItems: 'stretch' }}
          >
            {/* Bag — DOM-first so it renders on the dial-facing side in both flip orientations
                (row / row-reverse mirrors the outer row's own flip), and appears directly
                above the card on mobile rather than off near the dial. Height stretches to
                match the card (via the parent row's alignItems:stretch) so it reads as
                equally weighted next to the dial (Part 8, Phase A); width is capped tightly
                — it's a narrow, tall product shape that only needs vertical room to read
                clearly, not a wide flex share the card column needs back (Part 9, Phase A). */}
            <div className="w-full md:w-[clamp(90px,9vw,120px)] md:flex-none" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img
                src={visual.bag}
                alt={`${data.archetypeLabel} bag`}
                width={160} height={200}
                loading="lazy" decoding="async"
                className="max-h-[190px] md:max-h-full"
                style={{ maxWidth: '100%', objectFit: 'contain', filter: 'drop-shadow(0 18px 44px rgba(0,0,0,0.09))' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <PositionCard
                key={currentKey}
                slot={currentSlot}
                archetype={data.archetype}
                archetypeLabel={data.archetypeLabel}
                color={visual.color}
                isRevealed={isRevealed}
                onToggleReveal={() => onToggleReveal(currentKey)}
                onAddToCart={handleAddToCart}
                onCompare={() => onCompare(data.archetype, data.archetypeLabel, currentSlot)}
                cardRef={() => {}}
                teaser={cardData.teaser}
                effectivelyActive={cardData.effectivelyActive}
                availableWeights={cardData.availableWeights}
                selectedWeight={cardData.selectedWeight}
                setSelectedWeight={cardData.setSelectedWeight}
                selectedPrice={cardData.selectedPrice}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Revealed informational layer — full width, below the three-column row ── */}
      <RevealedPanel
        key={currentKey}
        isRevealed={isRevealed}
        archetype={data.archetype}
        dialSortOrder={currentSlot.dialSortOrder}
        content={cardData.content}
        dimensions={cardData.dimensions}
        wheelRows={cardData.wheelRows}
        hops={cardData.hops}
        userArchetype={userArchetype}
        onHopClick={onHopClick}
        hideProfileLink={hideProfileLink}
      />
    </motion.section>
  );
}
