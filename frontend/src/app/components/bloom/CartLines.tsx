import { useEffect, useState } from 'react';
import type { CartItem } from './types';
import { formatPrice, formatWeight } from './types';
import { getCheckoutRules, type CheckoutRules } from '../../lib/api';

// Commerce 1, C1/C2 (2026-10-31) — the cart's line list, extracted from
// FloatingCart so /checkout shows the same lines without a second copy.

/** Bags in the cart: one per unit of every line, a collection counts each member (same rule as the server's cartResolver). */
export function cartBagCount(items: CartItem[]): number {
  return items.reduce((n, i) => n + i.qty * (i.kind === 'collection' ? i.memberCount : 1), 0);
}

export function cartSubtotalCents(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.retailPriceCents * i.qty, 0);
}

let rulesPromise: Promise<CheckoutRules> | null = null;
/** GET /api/checkout/rules, fetched once per page load: the shipping numbers come from commerce_parameter, never from here. */
export function useCheckoutRules(): CheckoutRules | null {
  const [rules, setRules] = useState<CheckoutRules | null>(null);
  useEffect(() => {
    rulesPromise ??= getCheckoutRules().catch(err => { rulesPromise = null; throw err; });
    rulesPromise.then(setRules).catch(() => setRules(null));
  }, []);
  return rules;
}

/** Shipping for this cart from the rules, or null while they load. */
export function shippingCentsFor(items: CartItem[], rules: CheckoutRules | null): number | null {
  if (!rules) return null;
  return cartBagCount(items) >= rules.freeShippingMinBags ? 0 : rules.shippingFeeCents;
}

/** "Shipping $5.95 · free with 2 bags" / "Free shipping", from data. */
export function ShippingLine({ items, rules }: { items: CartItem[]; rules: CheckoutRules | null }) {
  const shipping = shippingCentsFor(items, rules);
  if (shipping === null || !rules) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: '#8a8070' }}>
        {shipping === 0 ? 'Free shipping' : `Shipping · free with ${rules.freeShippingMinBags} bags`}
      </span>
      <span style={{ color: '#4a4035' }}>{shipping === 0 ? formatPrice(0) : formatPrice(shipping)}</span>
    </div>
  );
}

export function CartLines({ items, onRemove }: { items: CartItem[]; onRemove?: (index: number) => void }) {
  return (
    <>
      {items.map((item, i) => (
        <div key={i} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {item.kind === 'collection' ? (
              <>
                {/* Part 19 §C, naming updated by Part 20 — "The {Archetype} Collection ·
                    {N} coffees", one line, removed/re-added as a whole (never splits
                    into its members). */}
                <p className="text-sm font-normal truncate" style={{ color: '#4a4035' }}>
                  The {item.archetypeLabel} Collection · {item.memberCount} coffees
                </p>
                <p className="text-xs" style={{ color: '#a09880' }}>qty {item.qty}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-normal truncate" style={{ color: '#4a4035' }}>{item.platformName}</p>
                <p className="text-xs" style={{ color: '#a09880' }}>
                  {item.kind === 'dial' ? item.archetypeLabel : item.categoryLabel} · {formatWeight(item.weightOz)} · qty {item.qty}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm" style={{ color: '#4a4035' }}>
              {item.kind === 'collection' && item.undiscountedPriceCents > item.retailPriceCents && (
                <span className="line-through mr-1.5" style={{ color: '#c8b8a8', fontSize: '0.85em' }}>
                  {formatPrice(item.undiscountedPriceCents * item.qty)}
                </span>
              )}
              <span style={item.kind === 'collection' ? { color: '#9a2918' } : undefined}>
                {formatPrice(item.retailPriceCents * item.qty)}
              </span>
            </span>
            {onRemove && <button onClick={() => onRemove(i)} className="text-xs" style={{ color: '#c8887c' }}>Remove</button>}
          </div>
        </div>
      ))}
    </>
  );
}
