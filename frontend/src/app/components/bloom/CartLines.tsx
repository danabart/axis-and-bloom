import { useEffect, useState } from 'react';
import type { CartItem } from './types';
import { formatPrice, formatWeight } from './types';
import { getCheckoutRules, quoteCheckout, type CartQuote, type CheckoutRules, type SubscriptionChoice } from '../../lib/api';
import { useCart, toCheckoutItems } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { Caps } from '../chrome';
import { Photo } from '../home/Photo';
import { familyLookOf } from '../shop/ShopCoffeeCard';
import './cartPage.css';

// Commerce 1, C1/C2 (2026-10-31) — the cart's line list, extracted from
// FloatingCart so /checkout shows the same lines without a second copy.
// Website 8 (2026-11-06) — /cart uses the same pieces (variant="page").

/** Bags in the cart: one per unit of every line, a collection counts each member (same rule as the server's cartResolver). */

/** The signed-out checkout link, one for the drawer and /cart (OT-93, Website 9). */
export const CHECKOUT_SIGN_IN_HREF = '/sign-in?mode=signin&redirect=/checkout';

export function cartBagCount(items: CartItem[]): number {
  return items.reduce((n, i) => n + i.qty * (i.kind === 'collection' ? i.memberCount : 1), 0);
}

export function cartSubtotalCents(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.retailPriceCents * i.qty, 0);
}

// Website 8 (D1): the site tokens, not typed hex colours. Shared by the drawer, /cart and /checkout.
const INK = { color: 'var(--ab-ink)' } as const;
const MUTED = { color: 'var(--ab-ink)', opacity: 0.72 } as const;

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
export function ShippingLine({ items, rules, className = 'text-sm' }: { items: CartItem[]; rules: CheckoutRules | null; className?: string }) {
  const shipping = shippingCentsFor(items, rules);
  if (shipping === null || !rules) return null;
  return (
    <div className={`flex items-center justify-between gap-4 ${className}`} data-testid="shipping-line">
      <span style={MUTED}>
        {shipping === 0 ? 'Free shipping' : `Shipping · free with ${rules.freeShippingMinBags} bags`}
      </span>
      <span style={INK}>{shipping === 0 ? formatPrice(0) : formatPrice(shipping)}</span>
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
    <div className="flex flex-col gap-2 p-3" data-testid="subscribe-choice"
      style={{ backgroundColor: on ? 'var(--ab-paper)' : 'transparent', border: '1px solid var(--ab-ink-hairline)' }}>
      <label className="flex items-center gap-2 text-sm cursor-pointer" style={INK}>
        <input
          type="checkbox" checked={on} data-testid="subscribe-toggle"
          onChange={e => setSubscription(e.target.checked ? { frequencyWeeks: subscription?.frequencyWeeks ?? options[Math.min(1, options.length - 1)] } : null)}
          style={{ accentColor: 'var(--ab-ink)' }}
        />
        Make it a subscription · {pct}% off every delivery
      </label>
      {on && (
        <div className="flex flex-wrap gap-2 pl-6">
          {options.map(w => (
            <button
              key={w} type="button" onClick={() => setSubscription({ frequencyWeeks: w })} data-testid={`subscribe-every-${w}`}
              className="text-xs px-3 py-1"
              style={w === subscription!.frequencyWeeks
                ? { backgroundColor: 'var(--ab-ink)', color: 'var(--ab-paper)', border: '1px solid var(--ab-ink)' }
                : { backgroundColor: 'transparent', color: 'var(--ab-ink)', border: '1px solid var(--ab-ink-hairline)' }}
            >
              Every {w} weeks
            </button>
          ))}
        </div>
      )}
      {on && (
        <p className="text-xs pl-6" style={MUTED}>
          Every {subscription!.frequencyWeeks} weeks · {pct}% off.{items.some(i => i.kind !== 'direct') && ' Your coffee follows your Bloom Dial.'}
        </p>
      )}
    </div>
  );
}

/** Subtotal row: the subscribed price (with the one-time price struck through) when subscribing, else the one-time subtotal. */
export function SubtotalLine({ items, quote, subscribed, className = 'text-sm' }: { items: CartItem[]; quote: CartQuote | null; subscribed: boolean; className?: string }) {
  const oneTime = cartSubtotalCents(items);
  const sub = subscribed ? quote?.subscription : null;
  return (
    <>
    {/* Family Household 3 (D22): the handover perk on this first box, its own line, words from the API. */}
    {sub?.offer && (
      <div className={`flex items-center justify-between gap-4 ${className}`} data-testid="offer-line">
        <span style={MUTED}>{sub.offer.label} · {sub.offer.pct}%</span>
        <span style={INK}>−{formatPrice(sub.offer.cents)}</span>
      </div>
    )}
    <div className={`flex items-center justify-between gap-4 ${className}`} data-testid="subtotal-line">
      <span style={MUTED}>Subtotal</span>
      <span style={INK}>
        {sub && sub.subtotalCents < oneTime && (
          <span className="line-through mr-1.5" style={{ ...MUTED, fontSize: '0.85em' }}>{formatPrice(oneTime)}</span>
        )}
        {subscribed && !sub ? '…' : formatPrice(sub ? sub.subtotalCents : oneTime)}
      </span>
    </div>
    </>
  );
}

/** Family Household 3 (C1): who a bag can be for — the buyer first, then the household box; empty outside a household. */
type Recipient = { userId: string; firstName: string | null; isMe: boolean };
let recipientsCache: { uid: string; at: number; list: Promise<Recipient[]> } | null = null;
function useHouseholdRecipients(): Recipient[] {
  const { user } = useAuth();
  const [list, setList] = useState<Recipient[]>([]);
  useEffect(() => {
    if (!user || user.isAnonymous) { setList([]); return; }
    if (!recipientsCache || recipientsCache.uid !== user.uid || Date.now() - recipientsCache.at > 60_000) {
      recipientsCache = {
        uid: user.uid, at: Date.now(),
        list: Promise.resolve().then(() => user.getIdToken())
          .then(t => fetch('/api/household/recipients', { headers: { Authorization: `Bearer ${t}` } }))
          .then(r => (r.ok ? r.json() : []))
          .catch(() => []),
      };
    }
    let live = true;
    recipientsCache.list.then(l => { if (live) setList(l); });
    return () => { live = false; };
  }, [user]);
  return list;
}

/** The "For" choice on a line (shown when the buyer is in a household with someone in the box). */
function ForWhom({ item, index, editable }: { item: CartItem; index: number; editable: boolean }) {
  const recipients = useHouseholdRecipients();
  const { setRecipient } = useCart();
  if (recipients.length < 2) return null;
  const current = item.intendedForUserId ?? recipients.find(r => r.isMe)?.userId ?? '';
  if (!editable) {
    const who = recipients.find(r => r.userId === current);
    return who && !who.isMe ? <p className="text-xs" style={MUTED} data-testid="line-for">For {who.firstName}</p> : null;
  }
  return (
    <label className="text-xs flex items-center gap-1.5" style={MUTED} data-testid="line-for">
      For
      <select
        value={current}
        onChange={e => {
          const r = recipients.find(x => x.userId === e.target.value);
          setRecipient(index, r && !r.isMe ? r.userId : null, r && !r.isMe ? r.firstName : null);
        }}
        className="bg-transparent border-b text-xs" style={{ ...INK, borderColor: 'var(--ab-ink-hairline)' }}
      >
        {recipients.map(r => <option key={r.userId} value={r.userId}>{r.isMe ? `${r.firstName ?? 'Me'} (you)` : r.firstName}</option>)}
      </select>
    </label>
  );
}

/** Website 8 — the estimated total /checkout and /cart both show: the (subscribed) subtotal + shipping from the rules; null while either loads. */
export function estimatedTotalCents(items: CartItem[], subscription: SubscriptionChoice | null, quote: CartQuote | null, rules: CheckoutRules | null): number | null {
  const subtotal = subscription ? quote?.subscription?.subtotalCents ?? null : cartSubtotalCents(items);
  const shipping = shippingCentsFor(items, rules);
  return shipping === null || subtotal === null ? null : subtotal + shipping;
}

/** The line's family photo (Shop all's family photo; "Other" for a category coffee). */
function linePhoto(item: CartItem) {
  return familyLookOf(item.kind === 'direct'
    ? { archetype: '', archetypeLabel: item.categoryLabel }
    : { archetype: item.archetype, archetypeLabel: item.archetypeLabel }).photo;
}

function LinePrice({ item }: { item: CartItem }) {
  return (
    <>
      {item.kind === 'collection' && item.undiscountedPriceCents > item.retailPriceCents && (
        <span className="line-through mr-1.5" style={{ ...MUTED, fontSize: '0.85em' }} data-testid="line-undiscounted">
          {formatPrice(item.undiscountedPriceCents * item.qty)}
        </span>
      )}
      <span>{formatPrice(item.retailPriceCents * item.qty)}</span>
    </>
  );
}

/**
 * The cart's lines. `variant="list"` (default) is the drawer's and /checkout's
 * compact list; `variant="page"` is /cart's handoff `.line` (Website 8): the
 * family photo, the meta line, the name, the −/+ stepper (`onQuantity`, i.e.
 * CartContext.setQuantity: 0 removes) and Remove.
 */
export function CartLines({ items, onRemove, onQuantity, variant = 'list' }: {
  items: CartItem[];
  onRemove?: (index: number) => void;
  onQuantity?: (index: number, qty: number) => void;
  variant?: 'list' | 'page';
}) {
  if (variant === 'page') {
    return (
      <div className="cp-lines" data-testid="cart-lines">
        {items.map((item, i) => {
          const photo = linePhoto(item);
          const name = item.kind === 'collection' ? `The ${item.archetypeLabel} Collection` : item.platformName;
          // The meta line from what the item carries (Task 0: no position label or award flag on cart items).
          const meta = item.kind === 'collection'
            ? `The collection · ${item.memberCount} coffees`
            : `${item.kind === 'dial' ? item.archetypeLabel : item.categoryLabel} · ${item.weightOz} oz whole bean`;
          return (
            <div key={i} className="cp-line" data-testid="cart-line">
              <Photo asset={photo.asset} fallback={photo.fallback} alt="" sizes="96px" className="cp-line-img" />
              <div className="cp-lm">
                <Caps weight={400}>{meta}</Caps>
                <span className="cp-ln">{name}</span>
                <ForWhom item={item} index={i} editable={Boolean(onRemove)} />
              </div>
              <div className="cp-right">
                {onQuantity && (
                  <span className="cp-qty">
                    <button type="button" aria-label={`One less: ${name}`} onClick={() => onQuantity(i, item.qty - 1)} data-testid="qty-less">−</button>
                    <span aria-live="polite" data-testid="qty-n">{item.qty}</span>
                    <button type="button" aria-label={`One more: ${name}`} onClick={() => onQuantity(i, item.qty + 1)} data-testid="qty-more">+</button>
                  </span>
                )}
                <Caps weight={400}><b style={{ fontWeight: 700 }}><LinePrice item={item} /></b></Caps>
                {onRemove && (
                  <button type="button" className="ab-caps cp-ulink" style={{ fontWeight: 400 }} onClick={() => onRemove(i)} aria-label={`Remove ${name}`}>Remove</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
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
                <p className="text-sm font-normal truncate" style={INK}>
                  The {item.archetypeLabel} Collection · {item.memberCount} coffees
                </p>
                <p className="text-xs" style={MUTED}>qty {item.qty}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-normal truncate" style={INK}>{item.platformName}</p>
                <p className="text-xs" style={MUTED}>
                  {item.kind === 'dial' ? item.archetypeLabel : item.categoryLabel} · {formatWeight(item.weightOz)} · qty {item.qty}
                </p>
              </>
            )}
            <ForWhom item={item} index={i} editable={Boolean(onRemove)} />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm" style={INK}><LinePrice item={item} /></span>
            {onRemove && <button onClick={() => onRemove(i)} className="text-xs" style={MUTED}>Remove</button>}
          </div>
        </div>
      ))}
    </>
  );
}
