import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useCart, toCheckoutItems } from '../../context/CartContext';
import { getUserProfile, createCheckoutSession, CheckoutApiError, type ShipsTo } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import {
  CartLines, ShippingLine, SubscribeChoice, SubtotalLine, estimatedTotalCents, useCartQuote, useCheckoutRules,
} from '../bloom/CartLines';
import { Wrap, Titled } from '../chrome';
import '../bloom/cartPage.css';
import { formatPrice } from '../bloom/types';
import AddressForm, { type SavedAddress } from '../profile/AddressForm';
import StripeEmbeddedCheckout, { stripeConfigured } from './StripeEmbeddedCheckout';

// Commerce 1, C2 (2026-10-31) — /checkout. Left: the cart's lines, shipping
// (from GET /api/checkout/rules) and the estimated total. Right: Ships-to (the
// default shipping address, or the shared AddressForm when there is none),
// then Stripe Embedded Checkout (card, Apple Pay, Google Pay). The session is
// created first (POST /api/checkout/session) and its client secret handed to
// the provider, so a 409 (price changed / unavailable), 422 (no address) or
// 503 (checkout not configured) shows here, inline, in the site's own words.
// Prices are never decided here: the server re-prices every line.
// If the profile (the saved addresses) cannot be read, the session is created
// without an address id: the server ships to the default shipping address and
// returns that snapshot, shown here; only a 422 (truly no address) opens the
// form, so a failed read never makes the customer add a duplicate address.

// Stripe's component lives in StripeEmbeddedCheckout (shared with Profile's card update, Commerce 3).

const NOT_LIVE_COPY = "Checkout isn't live yet — online ordering opens soon. Everything up to this point worked.";

interface CheckoutErrorState { status: number; code: string; message: string }

export default function CheckoutPage() {
  const { cart, subscription } = useCart();
  const rules = useCheckoutRules();
  const quote = useCartQuote(cart, subscription);
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<CheckoutErrorState | null>(null);
  const [creating, setCreating] = useState(false);
  const [profileFailed, setProfileFailed] = useState(false);
  const [sessionShipsTo, setSessionShipsTo] = useState<ShipsTo | null>(null);

  useEffect(() => {
    getUserProfile()
      .then(p => {
        const shipping: SavedAddress[] = (p?.addresses ?? []).filter((a: any) => a.address_type === 'shipping');
        setAddresses(shipping);
        const preferred = shipping.find(a => a.is_default) ?? shipping[0] ?? null;
        setSelectedId(preferred?.id ?? null);
      })
      .catch(err => { reportError('[Checkout/profile]', err); setProfileFailed(true); setAddresses([]); });
  }, []);

  const items = useMemo(() => toCheckoutItems(cart), [cart]);
  // Commerce 2: a changed subscribe choice is a different Stripe session (different prices).
  const itemsKey = JSON.stringify([items, subscription]);

  // One Stripe session per (cart, ships-to); the server reuses an open one for the same cart.
  useEffect(() => {
    if (!cart.length || addresses === null) return;
    if (!selectedId && !profileFailed) return; // no saved address: the form is showing
    if (!stripeConfigured) { setError({ status: 503, code: 'checkout_unavailable', message: NOT_LIVE_COPY }); return; }
    let cancelled = false;
    setCreating(true); setError(null); setClientSecret(null);
    createCheckoutSession({ items, shippingAddressId: selectedId, subscription })
      .then(r => { if (!cancelled) { setClientSecret(r.clientSecret); setSessionShipsTo(r.shipsTo); } })
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
  }, [selectedId, itemsKey, addresses === null, profileFailed]);

  if (!cart.length) return <Navigate to="/bloom" replace />;

  // Website 8: the same estimate /cart shows (one function, CartLines.estimatedTotalCents).
  const total = estimatedTotalCents(cart, subscription, quote, rules);
  const selected = addresses?.find(a => a.id === selectedId) ?? null;

  return (
    // Website 8 Part C: the site tokens and chrome primitives; the logic above is unchanged.
    <div className="cp-page w-full min-h-screen">
      <Wrap className="cp-acct">

        {/* ── Order ── */}
        <section className="flex flex-col gap-6">
          <Titled style={{ alignSelf: 'flex-start' }}>Your order</Titled>
          <div className="cp-panel">
            <CartLines items={cart} />
            <SubscribeChoice items={cart} rules={rules} quote={quote} />
            <div className="pt-4 flex flex-col gap-2" style={{ borderTop: '1px solid var(--ab-ink-hairline)' }}>
              <SubtotalLine items={cart} quote={quote} subscribed={subscription !== null} />
              <ShippingLine items={cart} rules={rules} />
              <div className="cp-sum-t" data-testid="checkout-total">
                <span>{subscription ? 'First delivery' : 'Estimated total'}</span>
                <span>{total === null ? '…' : formatPrice(total)}</span>
              </div>
              <p className="text-xs" style={{ opacity: 0.72 }}>Any sales tax is added at payment.</p>
            </div>
          </div>
          <Link to="/bloom" className="ab-caps cp-ulink" style={{ fontWeight: 400, alignSelf: 'flex-start' }}>
            Keep exploring
          </Link>
        </section>

        {/* ── Ships to + payment ── */}
        <section className="flex flex-col gap-6">
          <Titled style={{ alignSelf: 'flex-start' }}>Ships to</Titled>
          {addresses === null ? (
            <p className="ab-caps" style={{ fontWeight: 400 }}>Loading…</p>
          ) : (
            <>
              {addresses.length > 0 && !addingAddress && (
                <div className="flex flex-col gap-3">
                  {addresses.map(a => (
                    <button key={a.id} type="button" onClick={() => setSelectedId(a.id)}
                      className="cp-choice" aria-pressed={a.id === selectedId}>
                      <p className="text-sm">{a.street}</p>
                      <p className="text-sm" style={{ opacity: 0.8 }}>{a.city}, {a.state} {a.postal_code}</p>
                      <p className="text-sm" style={{ opacity: 0.65 }}>{a.country}</p>
                    </button>
                  ))}
                  <button type="button" onClick={() => setAddingAddress(true)}
                    className="ab-caps cp-ulink" style={{ fontWeight: 400, alignSelf: 'flex-start' }}>
                    + Ship somewhere else
                  </button>
                </div>
              )}
              {profileFailed && !selectedId && !addingAddress && sessionShipsTo && (
                <div className="flex flex-col gap-3">
                  <div className="cp-choice" style={{ borderColor: 'var(--ab-ink)', cursor: 'default' }}>
                    <p className="text-sm">{sessionShipsTo.street}</p>
                    <p className="text-sm" style={{ opacity: 0.8 }}>{sessionShipsTo.city}, {sessionShipsTo.state} {sessionShipsTo.postalCode}</p>
                    <p className="text-sm" style={{ opacity: 0.65 }}>{sessionShipsTo.country}</p>
                  </div>
                  <button type="button" onClick={() => setAddingAddress(true)}
                    className="ab-caps cp-ulink" style={{ fontWeight: 400, alignSelf: 'flex-start' }}>
                    + Ship somewhere else
                  </button>
                </div>
              )}
              {((addresses.length === 0 && !profileFailed) || addingAddress) && (
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
            <p className="text-sm" role="alert" style={{ color: 'var(--ab-ink)', opacity: error.status === 503 ? 0.72 : 1 }}>
              {error.message}
              {error.status === 409 && <> <Link to="/bloom" className="underline">Back to The Bloom</Link></>}
            </p>
          )}

          {(selected || profileFailed) && !addingAddress && (
            <div className="bg-white overflow-hidden min-h-[200px]" style={{ border: '1px solid var(--ab-ink-hairline)' }}>
              {creating && !clientSecret && <p className="ab-caps p-6" style={{ fontWeight: 400 }}>Preparing secure payment…</p>}
              {clientSecret && <StripeEmbeddedCheckout clientSecret={clientSecret} />}
            </div>
          )}
        </section>
      </Wrap>
    </div>
  );
}
