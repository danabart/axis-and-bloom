import type { Slot, SlotPrice, CartItem } from './types';
import { formatPrice, formatWeight } from './types';

interface PositionCardProps {
  slot: Slot;
  archetype: string;
  archetypeLabel: string;
  color: string;
  isRevealed: boolean;
  onToggleReveal: () => void;
  onAddToCart: (item: CartItem) => void;
  onCompare: () => void;
  cardRef: (el: HTMLDivElement | null) => void;
  // Shared fetch/derived state — see usePositionCardData.ts (The Bloom Part 4,
  // Phase D: lifted up so the full-width RevealedPanel sibling can use the same
  // data without a second fetch).
  teaser: string | null;
  effectivelyActive: boolean;
  availableWeights: SlotPrice[];
  selectedWeight: number | null;
  setSelectedWeight: (weightOz: number) => void;
  selectedPrice: SlotPrice | undefined;
}

/** Collapsed header + commerce row only — the revealed informational layer lives in RevealedPanel.tsx, full-width, below this. */
export function PositionCard({
  slot, archetype, archetypeLabel, color, isRevealed, onToggleReveal, onAddToCart, onCompare, cardRef,
  teaser, effectivelyActive, availableWeights, selectedWeight, setSelectedWeight, selectedPrice,
}: PositionCardProps) {
  function handleAddToCart() {
    if (!slot.platformName || !selectedPrice) return;
    onAddToCart({
      kind: 'dial',
      archetype, archetypeLabel,
      dialSortOrder: slot.dialSortOrder,
      weightOz: selectedPrice.weightOz,
      platformName: slot.platformName,
      retailPriceCents: selectedPrice.retailPriceCents,
      qty: 1,
    });
  }

  if (!effectivelyActive) {
    // Same box treatment and comparable structural weight as the active card below
    // (rounded border, padding, a real minimum height) — a deliberately designed
    // state, not a small pill floating in whatever space happens to be left over
    // (The Bloom Part 9, Phase B).
    return (
      <div
        ref={cardRef}
        className="rounded-xl border px-6 py-5 flex flex-col items-center justify-center text-center gap-2"
        style={{ borderColor: '#e0dcd4', backgroundColor: '#f7f5f0', minHeight: 176 }}
      >
        <h3 className="text-lg font-normal" style={{ color: '#8a8070' }}>
          {slot.positionLabel}
        </h3>
        {slot.description && (
          <p className="text-sm font-light" style={{ color: '#a09880' }}>
            {slot.description}
          </p>
        )}
        <span className="text-xs px-2.5 py-1 rounded-full mt-1" style={{ backgroundColor: '#e0dcd4', color: '#8a8070' }}>
          Temporarily unavailable
        </span>
      </div>
    );
  }

  return (
    <div ref={cardRef} className="rounded-xl border overflow-hidden" style={{ borderColor: '#e0dcd4', backgroundColor: '#fff' }}>
      {/* ─ Collapsed header — always visible ─ */}
      <button onClick={onToggleReveal} className="w-full text-left px-6 py-5 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-normal" style={{ color }}>
            {slot.positionLabel} — {slot.platformName}
          </h3>
          {teaser && <p className="text-sm font-light mt-1 truncate" style={{ color: '#8a8070' }}>{teaser}</p>}
        </div>
        <span className="text-xs flex-shrink-0" style={{ color: '#a09880' }}>
          {isRevealed ? 'Collapse ↑' : 'Reveal the full profile ↓'}
        </span>
      </button>

      {/* ─ Commerce row ─ */}
      <div className="px-6 pb-5">
        <div className="flex items-center gap-4 flex-wrap">
          {availableWeights.length > 1 && (
            <div className="flex gap-2">
              {availableWeights.map(p => (
                <button
                  key={p.weightOz}
                  onClick={() => setSelectedWeight(p.weightOz)}
                  className="text-xs px-3 py-1.5 rounded-full border transition-all"
                  style={{
                    borderColor: selectedWeight === p.weightOz ? color : '#d0ccc4',
                    backgroundColor: selectedWeight === p.weightOz ? color : 'transparent',
                    color: selectedWeight === p.weightOz ? '#fff' : '#8a8070',
                  }}
                >
                  {formatWeight(p.weightOz)} · {formatPrice(p.retailPriceCents)}
                </button>
              ))}
            </div>
          )}
          {availableWeights.length === 1 && selectedPrice && (
            <span className="text-sm" style={{ color: '#4a4035' }}>
              {formatWeight(selectedPrice.weightOz)} · {formatPrice(selectedPrice.retailPriceCents)}
            </span>
          )}
          <button
            onClick={handleAddToCart}
            disabled={!selectedPrice}
            className="text-xs px-4 py-2 rounded-full text-white disabled:opacity-40"
            style={{ backgroundColor: color }}
          >
            Add to cart
          </button>
          <button
            onClick={onCompare}
            className="text-xs px-3 py-1.5 rounded-full border"
            style={{ borderColor: '#c8c0b4', color: '#8a8070' }}
          >
            ⇄ Compare
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: '#a09880' }}>Price includes shipping</p>
      </div>
    </div>
  );
}
