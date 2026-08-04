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
 * wrapped in RequireAuth (App.tsx) — retired/non-owner/unknown all need to
 * render without forcing sign-in first; only the sign_in state itself
 * bounces to /sign-in, using the exact S21 redirect-preservation shape
 * RequireAuth uses internally (`/sign-in?redirect=...`), hand-built here since
 * this route isn't RequireAuth-wrapped.
 *
 * The `owner` destination (the bag view below) is now a legacy-only path: a
 * per-coffee digital-link token, still resolving exactly as HOME_TASK_7 built
 * it, but nothing mints or links to one anymore (HOME_TASK_7E, decision #2).
 * Retired and non-owner both hand off to the existing /coffee/:id/story page
 * (Task 5) via a declarative redirect — retired carries query params for the
 * past-tense framing + nearest-hop CTA added there for that task.
 *
 * HOME_TASK_7E (decisions 2026-08-04, amends 7c) — the universal printed
 * token's only two signed-in outcomes are declarative redirects: `profile`
 * (a customer — orders or B2B sponsorship — whose cards and story links
 * already live at /profile) and `quiz` (not a customer, straight to
 * /find-my-flavor, the site's actual conversion engine). This replaces 7c's
 * dedicated bag-view landing and two-bag picker entirely — the profile page
 * shows every bag for free, so there's nothing left for this page to render
 * for a universal scan. */
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

  // HOME_TASK_7E — universal token, signed in. Customer → their profile
  // (every bag lives there already); not a customer → the quiz.
  if (result.status === 'profile') {
    return <Navigate to="/profile" replace />;
  }

  if (result.status === 'quiz') {
    return <Navigate to="/find-my-flavor" replace />;
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

  // result.status === 'owner' — legacy per-coffee digital-link bag view.
  return <BagView coffeeId={result.coffeeId} displayName={result.displayName} card={result.card} />;
}
