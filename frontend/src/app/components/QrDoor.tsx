import { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { resolveQrToken, type QrResolveResult, type QrBagCard } from '../lib/api';

const RUST = '#a33726';

const METHOD_LABEL: Record<string, string> = {
  v60: 'V60', french_press: 'French press', espresso: 'Espresso', moka: 'Moka pot',
  aeropress: 'Aeropress', cold_brew: 'Cold brew', drip: 'Drip', other: 'Your method',
};

/** HOME_TASK_7 (§3.1, QR indirection) — the QR door: `/b/:token`, the page a
 * scanned bag label opens. This page owns almost none of the destination
 * logic itself — GET /api/qr/:token/resolve (optionalAuth) decides where a
 * scan goes, this component just renders whichever state comes back. Not
 * wrapped in RequireAuth (App.tsx) — retired/non-owner/unknown/no_orders all
 * need to render without forcing sign-in first; only the sign_in state itself
 * bounces to /sign-in, using the exact S21 redirect-preservation shape
 * RequireAuth uses internally (`/sign-in?redirect=...`), hand-built here since
 * this route isn't RequireAuth-wrapped.
 *
 * The owner destination (the bag view) is rendered directly on this page
 * rather than a separate route — no dedicated single-card page existed before
 * this task (BrewCards.tsx is a list section on the Profile tab only), and
 * the token URL itself is naturally "this bag's page." Retired and non-owner
 * both hand off to the existing /coffee/:id/story page (Task 5) via a
 * declarative redirect — retired carries query params for the past-tense
 * framing + nearest-hop CTA added there for this task.
 *
 * HOME_TASK_7C (strategy §9, 2026-08-03) — the universal printed QR adds two
 * more states this same page renders: `no_orders` (a signed-in customer with
 * no order history — the brand landing, i.e. the homepage, which already
 * carries the quiz CTA) and `picker` (2+ plausible active bags — a minimal
 * one-tap list, reusing the exact same bag-view rendering as `owner` for
 * whichever card gets tapped, entirely client-side, no second network
 * round-trip since the resolve response already carries every candidate
 * bag's full card data). */
function BagView({ coffeeId, displayName, card }: { coffeeId: number; displayName: string; card: QrBagCard }) {
  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <p className="text-[10px] uppercase tracking-[0.3em] mb-2" style={{ color: `${RUST}99` }}>Your bag</p>
      <h1 className="text-2xl font-normal mb-8" style={{ color: '#3a2e28' }}>{displayName}</h1>

      <div className="flex flex-col gap-1.5 mb-10">
        <p className="text-sm" style={{ color: RUST }}>
          {METHOD_LABEL[card.method] ?? card.method} · {card.ratio} · {card.grindLabel}
          {card.tempC != null ? ` · ${card.tempC}°C` : ''}
        </p>
        {card.notes && (
          <p className="text-xs leading-relaxed" style={{ color: `${RUST}99` }}>{card.notes}</p>
        )}
      </div>

      <Link
        to={`/sommelier?entry=bag&coffee=${coffeeId}`}
        className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] border-b pb-0.5 transition-colors"
        style={{ color: RUST, borderColor: RUST }}
      >
        Talk to Liam about this coffee <ArrowRight size={12} />
      </Link>
    </div>
  );
}

export default function QrDoor() {
  const { token } = useParams();
  const { loading: authLoading } = useAuth();
  const [result, setResult] = useState<QrResolveResult | null>(null);
  const [pickedCoffeeId, setPickedCoffeeId] = useState<number | null>(null);

  useEffect(() => {
    if (!token || authLoading) return;
    let cancelled = false;
    resolveQrToken(token).then(r => { if (!cancelled) setResult(r); });
    return () => { cancelled = true; };
  }, [token, authLoading]);

  if (!token) return <Navigate to="/" replace />;

  if (authLoading || !result) {
    return <div className="min-h-[50vh] flex items-center justify-center text-sm text-stone-400">Loading…</div>;
  }

  if (result.status === 'sign_in') {
    return <Navigate to={`/sign-in?redirect=${encodeURIComponent(`/b/${token}`)}`} replace />;
  }

  if (result.status === 'retired') {
    const params = new URLSearchParams({ retired: '1' });
    if (result.nearestHopCoffeeId != null) params.set('nearestHop', String(result.nearestHopCoffeeId));
    return <Navigate to={`/coffee/${result.coffeeId}/story?${params.toString()}`} replace />;
  }

  if (result.status === 'non_owner') {
    return <Navigate to={`/coffee/${result.coffeeId}/story`} replace />;
  }

  // HOME_TASK_7C — signed in, universal token, zero order history. The
  // brand landing is the homepage: it already carries the quiz path, and
  // there's no coffee-specific story to route to (unlike non_owner above).
  if (result.status === 'no_orders') {
    return <Navigate to="/" replace />;
  }

  if (result.status === 'unknown') {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 text-center px-6">
        <p className="text-sm text-stone-500">That code doesn't match anything we know.</p>
        <Link to="/" className="text-xs uppercase tracking-[0.2em] border-b pb-0.5" style={{ color: RUST, borderColor: RUST }}>
          Go home <ArrowRight size={12} className="inline" />
        </Link>
      </div>
    );
  }

  if (result.status === 'rate_limited') {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-center px-6">
        <p className="text-sm text-stone-500">Too many scans right now — give it a minute and try again.</p>
      </div>
    );
  }

  if (result.status === 'error') {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-center px-6">
        <p className="text-sm text-stone-500">Something went wrong reading that code — try again in a moment.</p>
      </div>
    );
  }

  // HOME_TASK_7C — 2+ plausible active bags. A tap selects one, rendered via
  // the exact same BagView as the single-bag `owner` case below — no second
  // resolve call, the response already carried every candidate's full card.
  if (result.status === 'picker') {
    const picked = pickedCoffeeId != null ? result.bags.find(b => b.coffeeId === pickedCoffeeId) : null;
    if (picked) return <BagView coffeeId={picked.coffeeId} displayName={picked.displayName} card={picked.card} />;

    return (
      <div className="max-w-xl mx-auto px-6 py-16">
        <p className="text-[10px] uppercase tracking-[0.3em] mb-2" style={{ color: `${RUST}99` }}>Which bag?</p>
        <h1 className="text-2xl font-normal mb-8" style={{ color: '#3a2e28' }}>You've got a couple going</h1>
        <div className="flex flex-col gap-3">
          {result.bags.map(bag => (
            <button
              key={bag.coffeeId}
              onClick={() => setPickedCoffeeId(bag.coffeeId)}
              className="text-left px-5 py-4 border border-stone-200 hover:border-[#a33726] transition-colors"
            >
              <p className="text-sm font-medium" style={{ color: '#3a2e28' }}>{bag.displayName}</p>
              <p className="text-xs mt-1" style={{ color: `${RUST}99` }}>
                {METHOD_LABEL[bag.card.method] ?? bag.card.method} · {bag.card.ratio}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // result.status === 'owner' — the single bag view.
  return <BagView coffeeId={result.coffeeId} displayName={result.displayName} card={result.card} />;
}
