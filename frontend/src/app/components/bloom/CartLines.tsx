import { useEffect, useState } from 'react';
import type { CartItem } from './types';
import { formatPrice, formatWeight } from './types';
import { getCheckoutRules, quoteCheckout, type CartQuote, type CheckoutRules, type SubscriptionChoice } from '../../lib/api';
import { useCart, toCheckoutItems } from '../../context/CartContext';

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

// ── Commerce 2, C1 (2026-10-31): the subscribe choice ───────────────────────
// Options and percentages come from GET /api/checkout/rules; the subscribed
// subtotal comes from POST /api/checkout/quote (the server prices it exactly
// as checkout will: the subscription tier by bag count, no collection
// discount). Nothing is computed or typed in here.

/** The server's quote for the cart (and its subscription price when one is chosen); null while loading or on error. */
export function useCartQuote(items: CartItem[], subscription: SubscriptionChoice | null): CartQuote | null {
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const key = JSON.stringify([toCheckoutItems(items), subscription]);
  useEffect(() => {
    if (!items.length || !subscription) { setQuote(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      quoteCheckout({ items: toCheckoutItems(items), subscription })
        .then(q => { if (!cancelled) setQuote(q); })
        .catch(() => { if (!cancelled) setQuote(null); });
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return quote;
}

/** "Make it a subscription": on/off, the frequency, and what it saves. Reads and sets the cart's choice (CartContext). */
export function SubscribeChoice({ items, rules, quote }: { items: CartItem[]; rules: CheckoutRules | null; quote: CartQuote | null }) {
  const { subscription, setSubscription } = useCart();
  const options = rules?.subscriptionFrequencyWeeks ?? [];
  if (!items.length || !options.length) return null;
  const on = subscription !== null;
  const pct = quote?.subscription?.discountPct
    ?? (cartBagCount(items) >= 2 ? rules!.subscriptionDiscountPct2PlusBags : rules!.subscriptionDiscountPct1Bag);
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg" style={{ backgroundColor: on ? '#f7efe9' : '#faf8f4', border: `1px solid ${on ? '#e6c9bf' : '#ece6dc'}` }}>
      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#4a4035' }}>
        <input
          type="checkbox" checked={on} data-testid="subscribe-toggle"
          onChange={e => setSubscription(e.target.checked ? { frequencyWeeks: subscription?.frequencyWeeks ?? options[Math.min(1, options.length - 1)] } : null)}
          style={{ accentColor: '#9a2918' }}
        />
        Make it a subscription · {pct}% off every delivery
      </label>
      {on && (
        <div className="flex flex-wrap gap-2 pl-6">
          {options.map(w => (
            <button
              key={w} type="button" onClick={() => setSubscription({ frequencyWeeks: w })} data-testid={`subscribe-every-${w}`}
              className="text-xs px-3 py-1 rounded-full"
              style={w === subscription!.frequencyWeeks
                ? { backgroundColor: '#9a2918', color: '#f2f1ea', border: '1px solid #9a2918' }
                : { backgroundColor: 'transparent', color: '#9a2918', border: '1px solid #e6c9bf' }}
            >
              Every {w} weeks
            </button>
          ))}
        </div>
      )}
      {on && (
        <p className="text-xs pl-6" style={{ color: '#8a8070' }}>
          Every {subscription!.frequencyWeeks} weeks · {pct}% off.{items.some(i => i.kind !== 'direct') && ' Your coffee follows your Bloom Dial.'}
        </p>
      )}
    </div>
  );
}

/** Subtotal row: the subscribed price (with the one-time price struck through) when subscribing, else the one-time subtotal. */
export function SubtotalLine({ items, quote, subscribed }: { items: CartItem[]; quote: CartQuote | null; subscribed: boolean }) {
  const oneTime = cartSubtotalCents(items);
  const sub = subscribed ? quote?.subscription : null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: '#8a8070' }}>Subtotal</span>
      <span style={{ color: '#4a4035' }}>
        {sub && sub.subtotalCents < oneTime && (
          <span className="line-through mr-1.5" style={{ color: '#c8b8a8', fontSize: '0.85em' }}>{formatPrice(oneTime)}</span>
        )}
        {subscribed && !sub ? '…' : formatPrice(sub ? sub.subtotalCents : oneTime)}
      </span>
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
