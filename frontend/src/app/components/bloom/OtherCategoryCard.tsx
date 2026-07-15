import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CartItem, OtherCategoryCoffee } from './types';
import { formatPrice, formatWeight } from './types';

interface OtherCategoryCardProps {
  coffee: OtherCategoryCoffee;
  categoryLabel: string;
  onAddToCart: (item: CartItem) => void;
  /** BloomPage.tsx renders a real link out to Flavor Intelligence; FlavorIntelligencePage.tsx
   * (already on that page) renders a button that selects the coffee in-page instead of
   * navigating — Bloom Dial Base Data Part 3, Phase 6. */
  renderFlavorIntelligenceLink: (coffeeId: number) => ReactNode;
}

/** Card for a Decaf/Half-Caf/Flavored/Experimental coffee — same visual language as
 * PositionCard.tsx (the dial-slot card) but grouped by category tag instead of a dial
 * position, since these coffees have neither a slot nor a dial-position label. */
export function OtherCategoryCard({ coffee, categoryLabel, onAddToCart, renderFlavorIntelligenceLink }: OtherCategoryCardProps) {
  const availablePrices = coffee.prices.filter(p => p.isActive);
  const [selectedWeight, setSelectedWeight] = useState<number | null>(
    (availablePrices.find(p => p.weightOz === 12) ?? availablePrices[0])?.weightOz ?? null
  );
  const selectedPrice = availablePrices.find(p => p.weightOz === selectedWeight) ?? availablePrices[0];

  function handleAddToCart() {
    if (!selectedPrice) return;
    onAddToCart({
      kind: 'direct',
      coffeeId: coffee.coffeeId,
      categoryLabel,
      matchedArchetypeLabel: coffee.archetypeLabel,
      weightOz: selectedPrice.weightOz,
      platformName: coffee.displayName,
      retailPriceCents: selectedPrice.retailPriceCents,
      qty: 1,
    });
  }

  if (!coffee.effectivelyActive) {
    return (
      <div
        className="rounded-xl border px-6 py-5 flex flex-col items-center justify-center text-center gap-2"
        style={{ borderColor: '#e0dcd4', backgroundColor: '#f7f5f0', minHeight: 176 }}
      >
        <h3 className="text-lg font-normal" style={{ color: '#8a8070' }}>{coffee.displayName}</h3>
        <span className="text-xs px-2.5 py-1 rounded-full" style={{ backgroundColor: '#e0dcd4', color: '#8a8070' }}>
          {categoryLabel}
        </span>
        <span className="text-xs px-2.5 py-1 rounded-full mt-1" style={{ backgroundColor: '#e0dcd4', color: '#8a8070' }}>
          Temporarily unavailable
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#e0dcd4', backgroundColor: '#fff' }}>
      <div className="px-6 py-5">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-xs px-2.5 py-1 rounded-full" style={{ backgroundColor: '#f2ede4', color: '#9a2918' }}>
            {categoryLabel}
          </span>
          {coffee.archetypeLabel && (
            <span className="text-xs" style={{ color: '#a09880' }}>Matches {coffee.archetypeLabel}</span>
          )}
        </div>
        <h3 className="text-lg font-normal" style={{ color: '#4a4035' }}>{coffee.displayName}</h3>
      </div>

      <div className="px-6 pb-5">
        <div className="flex items-center gap-4 flex-wrap">
          {availablePrices.length > 1 && (
            <div className="flex gap-2">
              {availablePrices.map(p => (
                <button
                  key={p.weightOz}
                  onClick={() => setSelectedWeight(p.weightOz)}
                  className="text-xs px-3 py-1.5 rounded-full border transition-all"
                  style={{
                    borderColor: selectedWeight === p.weightOz ? '#9a2918' : '#d0ccc4',
                    backgroundColor: selectedWeight === p.weightOz ? '#9a2918' : 'transparent',
                    color: selectedWeight === p.weightOz ? '#fff' : '#8a8070',
                  }}
                >
                  {formatWeight(p.weightOz)} · {formatPrice(p.retailPriceCents)}
                </button>
              ))}
            </div>
          )}
          {availablePrices.length === 1 && selectedPrice && (
            <span className="text-sm" style={{ color: '#4a4035' }}>
              {formatWeight(selectedPrice.weightOz)} · {formatPrice(selectedPrice.retailPriceCents)}
            </span>
          )}
          <button
            onClick={handleAddToCart}
            disabled={!selectedPrice}
            className="text-xs px-4 py-2 rounded-full text-white disabled:opacity-40"
            style={{ backgroundColor: '#9a2918' }}
          >
            Add to cart
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: '#a09880' }}>Price includes shipping</p>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t" style={{ borderColor: '#f0ede6' }}>
          <Link to="/sommelier" className="text-xs underline" style={{ color: '#8a8070' }}>Talk to Liam</Link>
          {renderFlavorIntelligenceLink(coffee.coffeeId)}
        </div>
      </div>
    </div>
  );
}
