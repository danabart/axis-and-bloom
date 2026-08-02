import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { setDialPosition } from '../../lib/api';
import { BloomDial, type BloomDialHandle } from './dial/BloomDial';
import { buildDialConfig } from './dial/archetypeConfig';
import { RevealedPanel } from './RevealedPanel';
import { usePositionCardData } from './usePositionCardData';
import type { ArchetypeData, CartItem, Slot } from './types';
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
  data, selectedSortOrder, revealedKeys, onDialSelect, onToggleReveal, onAddToCart, onHopClick, onCompare,
  userArchetype, registerDialRef, source = null, hideProfileLink = false, embedded = false,
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
  source?: 'bloom' | 'find_my_flavor_returning' | 'find_my_flavor_results' | 'profile' | null;
  hideProfileLink?: boolean;
  /** Compact variant for embedded contexts (quiz screens, Profile). */
  embedded?: boolean;
}) {
  const { user } = useAuth();
  const config = buildDialConfig(data);
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

  const showReveal = currentSlot.coffeeId != null && currentSlot.isActive;

  const bottomContent = (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!isPlaceholder && cardData.effectivelyActive && cardData.teaser && (
        <p style={{ fontSize: 12, letterSpacing: '0.02em', color: '#7b7f80', fontWeight: 400, lineHeight: 1.5, margin: 0 }}>
          {cardData.teaser}
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {cardData.availableWeights.map(p => (
                <button
                  key={p.weightOz}
                  type="button"
                  onClick={() => cardData.setSelectedWeight(p.weightOz)}
                  style={{
                    fontSize: 11, letterSpacing: '0.05em', padding: '6px 12px', borderRadius: 999,
                    border: `1px solid ${cardData.selectedWeight === p.weightOz ? '#9a2918' : 'rgba(123,127,128,0.35)'}`,
                    backgroundColor: cardData.selectedWeight === p.weightOz ? '#9a2918' : 'transparent',
                    color: cardData.selectedWeight === p.weightOz ? '#f2f1ea' : '#7b7f80',
                    cursor: 'pointer',
                  }}
                >
                  {formatWeight(p.weightOz)} · {formatPrice(p.retailPriceCents)}
                </button>
              ))}
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
        hops={cardData.hops}
        userArchetype={userArchetype}
        onHopClick={onHopClick}
        hideProfileLink={hideProfileLink}
      />
    </div>
  );

  return (
    <BloomDial
      ref={h => registerDialRef(data.archetype, h)}
      config={config}
      initialDialSortOrder={selectedSortOrder}
      onZoneChange={n => onDialSelect(data.archetype, n)}
      bottomContent={bottomContent}
      belowStage={belowStage}
      embedded={embedded}
    />
  );
}
