import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { useCart, toCheckoutItems } from '../../context/CartContext';
import { getUserProfile, createCheckoutSession, CheckoutApiError } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import { CartLines, ShippingLine, cartSubtotalCents, shippingCentsFor, useCheckoutRules } from '../bloom/CartLines';
import { formatPrice } from '../bloom/types';
import AddressForm, { type SavedAddress } from '../profile/AddressForm';

// Commerce 1, C2 (2026-10-31) — /checkout. Left: the cart's lines, shipping
// (from GET /api/checkout/rules) and the estimated total. Right: Ships-to (the
// default shipping address, or the shared AddressForm when there is none),
// then Stripe Embedded Checkout (card, Apple Pay, Google Pay). The session is
// created first (POST /api/checkout/session) and its client secret handed to
// the provider, so a 409 (price changed / unavailable), 422 (no address) or
// 503 (checkout not configured) shows here, inline, in the site's own words.
// Prices are never decided here: the server re-prices every line.

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
// loadStripe once, at module level (Stripe's own guidance), only when a key is built in.
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

const NOT_LIVE_COPY = "Checkout isn't live yet — online ordering opens soon. Everything up to this point worked.";

interface CheckoutErrorState { status: number; code: string; message: string }

export default function CheckoutPage() {
  const { cart } = useCart();
  const rules = useCheckoutRules();
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<CheckoutErrorState | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getUserProfile()
      .then(p => {
        const shipping: SavedAddress[] = (p?.addresses ?? []).filter((a: any) => a.address_type === 'shipping');
        setAddresses(shipping);
        const preferred = shipping.find(a => a.is_default) ?? shipping[0] ?? null;
        setSelectedId(preferred?.id ?? null);
      })
      .catch(err => { reportError('[Checkout/profile]', err); setAddresses([]); });
  }, []);

  const items = useMemo(() => toCheckoutItems(cart), [cart]);
  const itemsKey = JSON.stringify(items);

  // One Stripe session per (cart, ships-to); the server reuses an open one for the same cart.
  useEffect(() => {
    if (!selectedId || !cart.length) return;
    if (!PUBLISHABLE_KEY) { setError({ status: 503, code: 'checkout_unavailable', message: NOT_LIVE_COPY }); return; }
    let cancelled = false;
    setCreating(true); setError(null); setClientSecret(null);
    createCheckoutSession({ items, shippingAddressId: selectedId })
      .then(r => { if (!cancelled) setClientSecret(r.clientSecret); })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof CheckoutApiError) {
          setError({ status: err.status, code: err.code, message: err.status === 503 ? NOT_LIVE_COPY : err.message });
          if (err.status === 422) setAddingAddress(true);
        } else {
          reportError('[Checkout/session]', err);
          setError({ status: 500, code: 'checkout_failed', message: 'Checkout failed. Please try again.' });
        }
      })
      .finally(() => { if (!cancelled) setCreating(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, itemsKey]);

  if (!cart.length) return <Navigate to="/bloom" replace />;

  const subtotal = cartSubtotalCents(cart);
  const shipping = shippingCentsFor(cart, rules);
  const selected = addresses?.find(a => a.id === selectedId) ?? null;

  return (
    <div className="w-full min-h-screen bg-[#f2f1ea] px-4 md:px-10 py-12 md:py-20">
      <div className="max-w-6xl mx-auto grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">

        {/* ── Order ── */}
        <section className="flex flex-col gap-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60">Your order</p>
          <div className="flex flex-col gap-4 bg-white/60 border border-[#a33726]/15 p-5">
            <CartLines items={cart} />
            <div className="border-t border-[#e0dcd4] pt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: '#8a8070' }}>Subtotal</span>
                <span style={{ color: '#4a4035' }}>{formatPrice(subtotal)}</span>
              </div>
              <ShippingLine items={cart} rules={rules} />
              <div className="flex items-center justify-between text-sm pt-2">
                <span style={{ color: '#4a4035' }}>Estimated total</span>
                <span style={{ color: '#4a4035' }}>{shipping === null ? '…' : formatPrice(subtotal + shipping)}</span>
              </div>
              <p className="text-xs" style={{ color: '#a09880' }}>Any sales tax is added at payment.</p>
            </div>
          </div>
          <Link to="/bloom" className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 hover:text-[#a33726] border-b border-[#a33726]/20 pb-1 w-fit">
            Keep exploring
          </Link>
        </section>

        {/* ── Ships to + payment ── */}
        <section className="flex flex-col gap-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60">Ships to</p>
          {addresses === null ? (
            <p className="text-sm text-[#a33726]/60">Loading…</p>
          ) : (
            <>
              {addresses.length > 0 && !addingAddress && (
                <div className="flex flex-col gap-3">
                  {addresses.map(a => (
                    <button key={a.id} type="button" onClick={() => setSelectedId(a.id)}
                      className="text-left p-4 bg-white/40"
                      style={{ border: `1px solid ${a.id === selectedId ? '#a33726' : 'rgba(163,55,38,0.15)'}` }}>
                      <p className="text-sm text-[#a33726]">{a.street}</p>
                      <p className="text-sm text-[#a33726]/70">{a.city}, {a.state} {a.postal_code}</p>
                      <p className="text-sm text-[#a33726]/50">{a.country}</p>
                    </button>
                  ))}
                  <button type="button" onClick={() => setAddingAddress(true)}
                    className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/50 hover:text-[#a33726] border-b border-[#a33726]/20 pb-1 w-fit">
                    + Ship somewhere else
                  </button>
                </div>
              )}
              {(addresses.length === 0 || addingAddress) && (
                <AddressForm
                  addressType="shipping"
                  submitLabel="Ship here"
                  onSaved={addr => {
                    setAddresses(prev => [...(prev ?? []), addr]);
                    setSelectedId(addr.id);
                    setAddingAddress(false);
                  }}
                  onCancel={addresses.length ? () => setAddingAddress(false) : undefined}
                />
              )}
            </>
          )}

          {error && (
            <p className="text-sm" style={{ color: error.status === 503 ? '#8a8070' : '#c8887c' }}>
              {error.message}
              {error.status === 409 && <> <Link to="/bloom" className="underline">Back to The Bloom</Link></>}
            </p>
          )}

          {selected && !addingAddress && (
            <div className="bg-white rounded-lg overflow-hidden min-h-[200px]">
              {creating && !clientSecret && <p className="text-sm text-[#a33726]/60 p-6">Preparing secure payment…</p>}
              {clientSecret && stripePromise && (
                <EmbeddedCheckoutProvider key={clientSecret} stripe={stripePromise} options={{ clientSecret }}>
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
