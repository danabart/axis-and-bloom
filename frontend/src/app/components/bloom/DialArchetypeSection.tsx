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

  const bottomContent = (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Part 19 §B/§C — directly under the archetype name block (which lives
          above this whole bottomContent block, in .bd-namelock), above the
          teaser/price of whatever position happens to be selected right now.
          Disambiguation from the big ADD TO CART below: that one always acts
          on the CURRENTLY DISPLAYED position; these two are named, compact,
          and act on the archetype as a whole regardless of what's on screen. */}
      {(classicAvailable || data.collectionOffer) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingBottom: 10, marginBottom: 2, borderBottom: '1px solid rgba(123,127,128,0.18)' }}>
          {classicAvailable && (
            <button
              type="button"
              onClick={handleClassicAdd}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 6, background: 'none', border: 'none', padding: 0,
                cursor: 'pointer', textAlign: 'left', color: '#9a2918',
              }}
            >
              <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                The classic — {defaultSlot!.platformName}
              </span>
              <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, flexShrink: 0 }}>
                · Add to cart →
              </span>
            </button>
          )}
          {data.collectionOffer && (
            <button
              type="button"
              onClick={handleCollectionAdd}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                fontSize: 11.5, letterSpacing: '0.01em', color: '#7b7f80',
              }}
            >
              Taste the whole {data.archetypeLabel} set — 10% off →
            </button>
          )}
        </div>
      )}

      {(!isPlaceholder && cardData.effectivelyActive && cardData.teaser) ? (
        <p style={{ fontSize: 12, letterSpacing: '0.02em', color: '#7b7f80', fontWeight: 400, lineHeight: 1.5, margin: 0 }}>
          {cardData.teaser}
        </p>
      ) : (
        // Placeholder body so positions without a coffee yet still read like the
        // active ones (keeps every archetype's left column consistent).
        <p style={{ fontSize: 12, letterSpacing: '0.02em', color: '#7b7f80', fontWeight: 400, lineHeight: 1.5, margin: 0, opacity: 0.85 }}>
          A {data.archetypeLabel} coffee for this turn of the dial. Its full tasting notes are arriving soon.
        </p>
      )}

      {isPlaceholder ? (
        <span style={{
          alignSelf: 'flex-start', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
          color: '#7b7f80', border: '1px solid rgba(123,127,128,0.35)', borderRadius: 999, padding: '5px 12px',
        }}>
          Coming soon
        </span>
      ) : !cardData.effectivelyActive ? (
        <span style={{
          alignSelf: 'flex-start', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
          color: '#7b7f80', border: '1px solid rgba(123,127,128,0.35)', borderRadius: 999, padding: '5px 12px',
        }}>
          {cardData.isUnpriced ? 'Unpriced' : 'Temporarily unavailable'}
        </span>
      ) : (
        <>
          {cardData.availableWeights.length > 1 && (
            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
              {cardData.availableWeights.map(p => {
                const selected = cardData.selectedWeight === p.weightOz;
                return (
                  <button
                    key={p.weightOz}
                    type="button"
                    onClick={() => cardData.setSelectedWeight(p.weightOz)}
                    style={{
                      fontSize: 12.5, letterSpacing: '0.02em', padding: '2px 0',
                      border: 'none', borderBottom: `1.5px solid ${selected ? '#9a2918' : 'transparent'}`,
                      background: 'none',
                      color: selected ? '#9a2918' : '#7b7f80',
                      fontWeight: selected ? 500 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {formatWeight(p.weightOz)} · {formatPrice(p.retailPriceCents)}
                  </button>
                );
              })}
            </div>
          )}
          {cardData.availableWeights.length === 1 && cardData.selectedPrice && (
            <span style={{ fontSize: 12.5, color: '#7b7f80' }}>
              {formatWeight(cardData.selectedPrice.weightOz)} · {formatPrice(cardData.selectedPrice.retailPriceCents)}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <button
              className="bd-btn"
              type="button"
              style={{ flex: '1 1 auto', margin: 0, minWidth: 160 }}
              onClick={handleAddToCart}
              disabled={!cardData.selectedPrice}
            >
              ADD TO CART&nbsp;&nbsp;→
            </button>
            <button
              type="button"
              onClick={() => onCompare(data.archetype, data.archetypeLabel, currentSlot)}
              style={{
                fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7b7f80',
                background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', padding: 0,
              }}
            >
              ⇄ Compare
            </button>
          </div>
          <p style={{ fontSize: 10.5, letterSpacing: '0.05em', color: '#a09880', margin: 0 }}>Price includes shipping</p>
        </>
      )}

      {showReveal && (
        <button
          type="button"
          onClick={() => onToggleReveal(currentKey)}
          style={{
            fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ee5974',
            background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, marginTop: 4,
          }}
        >
          {isRevealed ? 'Collapse ↑' : 'Reveal the full profile ↓'}
        </button>
      )}

      {user && !isPlaceholder && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleExplicitSave}
            disabled={savedKey === currentKey}
            style={{
              fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9a2918',
              opacity: savedKey === currentKey ? 0.55 : 0.85, background: 'none', border: 'none',
              cursor: 'pointer', textAlign: 'left', padding: 0,
            }}
          >
            {savedKey === currentKey ? 'Saved ✓' : 'Save to my flavor memory'}
          </button>
          {savedKey === currentKey && (
            <Link
              to="/profile?tab=memory"
              style={{
                fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9a2918', opacity: 0.85,
              }}
            >
              View in your flavor memory →
            </Link>
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
      onDoorClick={onDoorClick ? (edge, target) => onDoorClick(data.archetype, edge, target) : undefined}
    />
  );
}
