import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { setDialPosition } from '../../lib/api';
import { BloomDial, type BloomDialHandle } from './dial/BloomDial';
import { buildDialConfig } from './dial/archetypeConfig';
import { computeDefaultSortOrder } from './ArchetypeSection';
import { RevealedPanel } from './RevealedPanel';
import { usePositionCardData } from './usePositionCardData';
import type { ArchetypeData, CartItem, DoorTarget, Slot } from './types';
import { slotKey, formatPrice, formatWeight } from './types';

/**
 * The Bloom Part 12 — unified archetype section built on Camila's Bloom Dial
 * (brief 33), restoring the commerce/reveal/save-to-memory layer that lived in
 * the pre-33 ArchetypeSection/PositionCard/RevealedPanel trio. Prop surface
 * matches the old ArchetypeSection exactly so every call site is a one-line
 * swap; `index` is accepted for compatibility but unused (no more flip/eager
 * layout — the dial owns its own presentation).
 */
export function DialArchetypeSection({
  data, selectedSortOrder, revealedKeys, onDialSelect, onToggleReveal, onAddToCart, onCompare,
  userArchetype, registerDialRef, source = null, hideProfileLink = false, embedded = false, onDoorClick,
}: {
  data: ArchetypeData;
  index: number;
  selectedSortOrder: number;
  revealedKeys: Set<string>;
  onDialSelect: (archetype: string, dialSortOrder: number) => void;
  onToggleReveal: (key: string) => void;
  onAddToCart: (item: CartItem) => void;
  onCompare: (archetype: string, archetypeLabel: string, slot: Slot) => void;
  userArchetype: string | null;
  registerDialRef: (archetype: string, handle: BloomDialHandle | null) => void;
  source?: 'bloom' | 'find_my_flavor_returning' | 'find_my_flavor_results' | 'profile' | null;
  hideProfileLink?: boolean;
  /** Compact variant for embedded contexts (quiz screens, Profile). */
  embedded?: boolean;
  /** Part 19 §A — bubbled straight through to BloomDial's own onDoorClick; the
   * parent (Bloom page vs Profile/quiz) decides how to travel, since only it
   * knows about the other archetype sections/adjacent-section mechanism. */
  onDoorClick?: (archetype: string, edge: 'left' | 'right', target: DoorTarget) => void;
}) {
  const { user } = useAuth();
  const config = buildDialConfig(data);
  // Part 19 §B — a local handle to THIS dial (in addition to forwarding one up
  // via registerDialRef) so "the classic" CTA can turn the dial itself as
  // feedback, without needing the parent to plumb a lookup back down.
  const dialRef = useRef<BloomDialHandle | null>(null);
  if (!config) return null;

  // Synthetic slot for placeholders (hooks must run unconditionally) — a dial
  // position with no resolved catalogue slot at all, distinct from a real slot
  // that's merely inactive/unpriced.
  const realSlot = data.slots.find(s => s.dialSortOrder === selectedSortOrder);
  const isPlaceholder = !realSlot;
  const currentSlot: Slot = realSlot ?? {
    dialSortOrder: selectedSortOrder,
    positionLabel: '',
    description: null,
    isActive: false,
    platformName: null,
    isDefault: false,
    prices: [],
    coffeeId: null,
  };
  const currentKey = slotKey(data.archetype, currentSlot.dialSortOrder);
  const isRevealed = revealedKeys.has(currentKey);

  // Shared fetch/derived state for this position — one fetch, used by both the
  // commerce controls below and the full-width RevealedPanel underneath.
  const cardData = usePositionCardData(currentSlot, data.archetype, isRevealed);

  // "Save to my flavor memory" — signed-in + a real (non-placeholder) slot only.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  useEffect(() => { setSavedKey(null); }, [currentKey]);

  function handleExplicitSave() {
    if (!user) return;
    setDialPosition(data.archetype, currentSlot.dialSortOrder, {
      trigger: 'explicit_save', source, coffeeId: currentSlot.coffeeId, platformName: currentSlot.platformName,
    })
      .then(() => setSavedKey(currentKey))
      .catch(() => {});
  }

  function handleAddToCart() {
    if (!currentSlot.platformName || !cardData.selectedPrice) return;
    const item: CartItem = {
      kind: 'dial',
      archetype: data.archetype,
      archetypeLabel: data.archetypeLabel,
      dialSortOrder: currentSlot.dialSortOrder,
      weightOz: cardData.selectedPrice.weightOz,
      platformName: currentSlot.platformName,
      retailPriceCents: cardData.selectedPrice.retailPriceCents,
      qty: 1,
    };
    onAddToCart(item);
    if (user) {
      setDialPosition(data.archetype, currentSlot.dialSortOrder, {
        trigger: 'add_to_cart', source, coffeeId: currentSlot.coffeeId,
      }).catch(() => {});
    }
  }

  // Part 19 §B — "the classic": the archetype's DEFAULT position (isDefault
  // slot, falling back to computeDefaultSortOrder's convention the same way
  // the dial's own initial position does), independent of whatever position
  // is currently selected/displayed. Uses data.slots directly (already
  // fetched for the whole archetype) rather than cardData, which only ever
  // knows about currentSlot.
  //
  // Only trust isDefault when EXACTLY ONE slot carries it — same hardening
  // philosophy as computeStopPositions (Part 17 §E): an archetype with two
  // conflicting isDefault=true rows (chocolate_nutty, still unresolved DB
  // data — see WHAT_WE_BUILT.md #145) is a data problem, not something to
  // pick a "first match" default from. Naively taking data.slots.find(s =>
  // s.isDefault) here would have picked chocolate_nutty's UNPRICED
  // dialSortOrder-1 row over its real, priced dialSortOrder-2 default —
  // caught live during this section's own QA.
  const isDefaultSlots = data.slots.filter(s => s.isDefault);
  const defaultSlot = isDefaultSlots.length === 1
    ? isDefaultSlots[0]
    : data.slots.find(s => s.dialSortOrder === computeDefaultSortOrder(data));
  const defaultPrice = defaultSlot?.prices.find(p => p.weightOz === 12) ?? defaultSlot?.prices[0];
  const classicAvailable = !!(defaultSlot && defaultSlot.isActive && defaultSlot.platformName && defaultPrice);

  function handleClassicAdd() {
    if (!defaultSlot || !defaultPrice || !defaultSlot.platformName) return;
    const item: CartItem = {
      kind: 'dial',
      archetype: data.archetype,
      archetypeLabel: data.archetypeLabel,
      dialSortOrder: defaultSlot.dialSortOrder,
      weightOz: defaultPrice.weightOz,
      platformName: defaultSlot.platformName,
      retailPriceCents: defaultPrice.retailPriceCents,
      qty: 1,
    };
    onAddToCart(item);
    // Turn the dial to the default position as feedback — same snap animation
    // as any other settle, via the imperative handle this component keeps a
    // local copy of specifically for this.
    dialRef.current?.rotateTo(defaultSlot.dialSortOrder);
    onDialSelect(data.archetype, defaultSlot.dialSortOrder);
    if (user) {
      setDialPosition(data.archetype, defaultSlot.dialSortOrder, {
        trigger: 'add_to_cart', source, coffeeId: defaultSlot.coffeeId,
      }).catch(() => {});
    }
  }

  // Part 19 §C — "the collection": data.collectionOffer is already the
  // backend-computed, backend-verified-at-order-time preview (null when fewer
  // than 3 positions are purchasable — the CTA's own hide condition). No
  // client-side discount math anywhere in this component.
  function handleCollectionAdd() {
    if (!data.collectionOffer) return;
    const item: CartItem = {
      kind: 'collection',
      archetype: data.archetype,
      archetypeLabel: data.archetypeLabel,
      memberCount: data.collectionOffer.memberCount,
      retailPriceCents: data.collectionOffer.discountedCents,
      undiscountedPriceCents: data.collectionOffer.sumCents,
      qty: 1,
    };
    onAddToCart(item);
  }

  const showReveal = currentSlot.coffeeId != null && currentSlot.isActive;

  // Part 20 — Zone 2 (the coffee card) + Zone 3 (quick picks), replacing the
  // ~12-line stack this column used to be with three real zones (see
  // PROMPT_commerce_column_redesign.md / commerce-column-redesign.html,
  // "Proposed · 38/62"). Zone 1 (identity: YOUR/title/NO.) lives one level up,
  // in BloomDial.tsx's bd-namelock — this component owns everything from the
  // card down. Compare's visibility mirrors its old gating exactly
  // (cardData.effectivelyActive only); Save's mirrors its old gating exactly
  // (signed-in + !isPlaceholder) — unified into one quiet row per the
  // mockup, but neither button's OWN visibility rule changed.
  const bottomContent = (
    <div style={{ marginTop: 18 }}>
      <div className="bd-card">
        <div className="bd-card-main">
          <div className="bd-card-headrow">
            <img className="bd-card-bag" src={config.bag} alt={`${data.archetypeLabel} bag`} draggable={false} />
            <div style={{ minWidth: 0 }}>
              <p className="bd-card-microlabel">On the dial now</p>
              <p className="bd-card-name">{currentSlot.platformName ?? 'Coming soon'}</p>
            </div>
          </div>

          <p className="bd-card-teaser">
            {(!isPlaceholder && cardData.effectivelyActive && cardData.teaser)
              ? cardData.teaser
              : `A ${data.archetypeLabel} coffee for this turn of the dial. Its full tasting notes are arriving soon.`}
          </p>

          {isPlaceholder ? (
            <span className="bd-card-status">Coming soon</span>
          ) : !cardData.effectivelyActive ? (
            <span className="bd-card-status">{cardData.isUnpriced ? 'Unpriced' : 'Temporarily unavailable'}</span>
          ) : (
            <>
              <div className="bd-card-pricerow">
                {cardData.availableWeights.length > 1 ? (
                  cardData.availableWeights.map(p => {
                    const selected = cardData.selectedWeight === p.weightOz;
                    return (
                      <button
                        key={p.weightOz}
                        type="button"
                        className={`bd-card-weight ${selected ? 'sel' : 'un'}`}
                        onClick={() => cardData.setSelectedWeight(p.weightOz)}
                      >
                        {formatWeight(p.weightOz)} · {formatPrice(p.retailPriceCents)}
                      </button>
                    );
                  })
                ) : cardData.selectedPrice ? (
                  <span className="bd-card-weight sel" style={{ cursor: 'default' }}>
                    {formatWeight(cardData.selectedPrice.weightOz)} · {formatPrice(cardData.selectedPrice.retailPriceCents)}
                  </span>
                ) : null}
                <span className="bd-card-ship">shipping included</span>
              </div>

              <button className="bd-card-atc" type="button" onClick={handleAddToCart} disabled={!cardData.selectedPrice}>
                ADD TO CART&nbsp;&nbsp;→
              </button>
            </>
          )}

          {!isPlaceholder && (cardData.effectivelyActive || user) && (
            <div className="bd-card-quietrow">
              {cardData.effectivelyActive && (
                <button type="button" onClick={() => onCompare(data.archetype, data.archetypeLabel, currentSlot)}>
                  ⇄ Compare
                </button>
              )}
              {user && (
                <button type="button" onClick={handleExplicitSave} disabled={savedKey === currentKey}>
                  {savedKey === currentKey ? 'Saved ✓' : 'Save to my flavor memory'}
                </button>
              )}
            </div>
          )}
          {savedKey === currentKey && (
            <Link to="/profile?tab=memory" className="bd-card-saved-link">
              View in your flavor memory →
            </Link>
          )}
        </div>

        {showReveal && (
          <button type="button" className="bd-card-reveal" onClick={() => onToggleReveal(currentKey)}>
            <span>{isRevealed ? 'Collapse' : 'Reveal the full profile'}</span>
            <span>{isRevealed ? '↑' : '↓'}</span>
          </button>
        )}
      </div>

      {/* Zone 3 — quick picks. Naming decision (Dana, 2026-08-08): "The
          {Archetype} classic" and "The {Archetype} Collection" everywhere,
          never a bare "classic" or "set". */}
      {(classicAvailable || data.collectionOffer) && (
        <div className="bd-qp">
          <p className="bd-qp-label">Quick picks</p>
          {classicAvailable && (
            <button type="button" className="bd-qp-row" onClick={handleClassicAdd}>
              <span className="bd-qp-what">The {data.archetypeLabel} classic — {defaultSlot!.platformName}</span>
              <span className="bd-qp-act">Add to cart →</span>
            </button>
          )}
          {data.collectionOffer && (
            <button type="button" className="bd-qp-row" onClick={handleCollectionAdd}>
              <span className="bd-qp-what">
                The {data.archetypeLabel} Collection <em>· {data.collectionOffer.memberCount} coffees — 10% off</em>
              </span>
              <span className="bd-qp-act">Add the collection →</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  const belowStagePaddingX = embedded ? 0 : 'clamp(32px, 6vw, 96px)';
  const belowStage = (
    <div style={{ paddingLeft: belowStagePaddingX, paddingRight: belowStagePaddingX }}>
      <RevealedPanel
        key={currentKey}
        isRevealed={isRevealed}
        archetype={data.archetype}
        dialSortOrder={currentSlot.dialSortOrder}
        content={cardData.content}
        dimensions={cardData.dimensions}
        wheelRows={cardData.wheelRows}
        userArchetype={userArchetype}
        hideProfileLink={hideProfileLink}
      />
    </div>
  );

  return (
    <BloomDial
      ref={h => { dialRef.current = h; registerDialRef(data.archetype, h); }}
      config={config}
      initialDialSortOrder={selectedSortOrder}
      onZoneChange={n => onDialSelect(data.archetype, n)}
      bottomContent={bottomContent}
      belowStage={belowStage}
      embedded={embedded}
      signedIn={!!user}
      onDoorClick={onDoorClick ? (edge, target) => onDoorClick(data.archetype, edge, target) : undefined}
    />
  );
}
