import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Slot, Hop, CartItem } from './types';
import { formatPrice, formatWeight } from './types';
import { TastingNotes, type ContentData } from '../coffee-info/TastingNotes';
import { DimensionBars, type DimensionRow } from '../coffee-info/DimensionBars';
import { CollaborativeFlavorWheel, type WheelRow } from '../coffee-info/CollaborativeFlavorWheel';
import { CompatibilityBadge, useCompatibility } from '../coffee-info/useCompatibility';

interface PositionCardProps {
  slot: Slot;
  archetype: string;
  archetypeLabel: string;
  color: string;
  isRevealed: boolean;
  onToggleReveal: () => void;
  onAddToCart: (item: CartItem) => void;
  onHopClick: (targetArchetype: string, targetDialSortOrder: number) => void;
  onCompare: () => void;
  userArchetype: string | null;
  cardRef: (el: HTMLDivElement | null) => void;
}

export function PositionCard({
  slot, archetype, archetypeLabel, color, isRevealed, onToggleReveal,
  onAddToCart, onHopClick, onCompare, userArchetype, cardRef,
}: PositionCardProps) {
  const [content, setContent] = useState<ContentData | null>(null);
  const [availability, setAvailability] = useState<Record<number, boolean> | null>(null);
  const [selectedWeight, setSelectedWeight] = useState<number | null>(null);

  const [dimensions, setDimensions] = useState<DimensionRow[]>([]);
  const [wheelRows, setWheelRows] = useState<WheelRow[]>([]);
  const [hops, setHops] = useState<Hop[]>([]);
  const [detailLoaded, setDetailLoaded] = useState(false);

  const { compat, dimCompText } = useCompatibility(archetype, userArchetype, dimensions);

  // Teaser + per-weight availability, fetched as soon as this is a real position (not gated by reveal).
  useEffect(() => {
    if (!slot.isActive || !slot.coffeeId) return;
    fetch(`/api/coffees/${slot.coffeeId}/content`).then(r => r.json()).then(setContent).catch(() => {});

    Promise.all(
      slot.prices.map(p =>
        fetch(`/api/shop/slot-availability?archetype=${archetype}&dialSortOrder=${slot.dialSortOrder}&weightOz=${p.weightOz}`)
          .then(r => r.json())
          .then(data => [p.weightOz, !!data.available] as const)
      )
    ).then(entries => {
      const map = Object.fromEntries(entries);
      setAvailability(map);
      const firstAvailable = slot.prices.find(p => map[p.weightOz])?.weightOz ?? null;
      setSelectedWeight(firstAvailable);
    }).catch(() => setAvailability({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.coffeeId, slot.isActive]);

  // Full informational layer, fetched lazily on first reveal only.
  useEffect(() => {
    if (!isRevealed || detailLoaded || !slot.coffeeId) return;
    setDetailLoaded(true);
    Promise.all([
      fetch(`/api/coffees/${slot.coffeeId}/dimensions`).then(r => r.json()),
      fetch(`/api/coffees/${slot.coffeeId}/flavor-wheel`).then(r => r.json()),
      fetch(`/api/coffees/${slot.coffeeId}/hops`).then(r => r.json()),
    ]).then(([dimData, wheel, hopData]) => {
      setDimensions(dimData.dimensions ?? []);
      setWheelRows(wheel);
      setHops(hopData);
    }).catch(() => {});
  }, [isRevealed, detailLoaded, slot.coffeeId]);

  const availableWeights = slot.prices.filter(p => availability?.[p.weightOz]);
  const effectivelyActive = slot.isActive && (availability === null || availableWeights.length > 0);

  const teaser = content?.surpriseNote ? content.surpriseNote.split(/(?<=[.!?])\s/)[0] : null;
  const selectedPrice = slot.prices.find(p => p.weightOz === selectedWeight);

  function handleAddToCart() {
    if (!slot.platformName || !selectedPrice) return;
    onAddToCart({
      archetype, archetypeLabel,
      dialSortOrder: slot.dialSortOrder,
      weightOz: selectedPrice.weightOz,
      platformName: slot.platformName,
      retailPriceCents: selectedPrice.retailPriceCents,
      qty: 1,
    });
  }

  if (!effectivelyActive) {
    return (
      <div
        ref={cardRef}
        className="rounded-xl border px-6 py-5 flex items-center justify-between"
        style={{ borderColor: '#e0dcd4', backgroundColor: '#f7f5f0', opacity: 0.65 }}
      >
        <span className="text-sm" style={{ color: '#8a8070' }}>{slot.positionLabel}</span>
        <span className="text-xs px-2.5 py-1 rounded-full" style={{ backgroundColor: '#e0dcd4', color: '#8a8070' }}>
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
      <div className="px-6 pb-5 flex items-center gap-4 flex-wrap">
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

      {/* ─ Revealed informational layer ─ */}
      <AnimatePresence initial={false}>
        {isRevealed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-8 pt-2 space-y-8 border-t" style={{ borderColor: '#e0dcd4' }}>
              <TastingNotes content={content} contentLoading={!content} exploreLink="/coffees" />
              <DimensionBars dimensions={dimensions} />
              <CollaborativeFlavorWheel wheelRows={wheelRows} />

              {compat && userArchetype && (
                <div className="flex flex-col gap-3">
                  <CompatibilityBadge level={compat} userArchetype={userArchetype} />
                  {dimCompText && (
                    <p className="text-sm font-light leading-relaxed" style={{ color: '#8a8070' }}>{dimCompText}</p>
                  )}
                </div>
              )}

              {hops.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {hops.map((hop, i) => (
                    <button
                      key={i}
                      onClick={() => onHopClick(hop.target.archetype, hop.target.dialSortOrder)}
                      className="text-xs px-3 py-1.5 rounded-full border"
                      style={{ borderColor: '#d0ccc4', color: '#8a8070' }}
                    >
                      {hop.target.archetype !== archetype && `→ ${hop.target.archetypeLabel} · `}
                      {hop.target.positionLabel} — {hop.target.platformName} · {hop.direction} {hop.dimensionName.toLowerCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
