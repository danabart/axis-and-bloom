import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCart } from '../../context/CartContext';
import { getCheckoutSessionStatus, type CheckoutSessionStatus } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import { formatPrice } from '../bloom/types';

// Commerce 1, C3 (2026-10-31) — /checkout/return, where Stripe sends the
// customer after paying. The page reads our own tables only
// (GET /api/checkout/session/:id/status), so it shows what the webhook
// actually wrote: polled every 1.5 s for up to 20 s. complete → Liam's
// order-placed line, what was ordered, ships-to; the cart is cleared. Still
// open after 20 s → a calm "almost there" (the email follows the moment the
// webhook lands). expired → back to /checkout.

const POLL_MS = 1500;
const POLL_FOR_MS = 20_000;
const FALLBACK_LINE = 'Your coffee is on its way to being roasted.';

export default function CheckoutReturnPage() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const navigate = useNavigate();
  const { clear } = useCart();
  const [status, setStatus] = useState<CheckoutSessionStatus | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!sessionId) { navigate('/checkout', { replace: true }); return; }
    let stopped = false;
    const started = Date.now();
    async function poll() {
      try {
        const s = await getCheckoutSessionStatus(sessionId!);
        if (stopped) return;
        setStatus(s);
        if (s.status === 'expired') { navigate('/checkout', { replace: true }); return; }
        // Wait for the finalizer too (Liam's line), but never past the window.
        if (s.status === 'complete' && s.finalized) return;
      } catch (err) {
        reportError('[CheckoutReturn/status]', err);
      }
      if (Date.now() - started >= POLL_FOR_MS) { setTimedOut(true); return; }
      setTimeout(() => { if (!stopped) poll(); }, POLL_MS);
    }
    poll();
    return () => { stopped = true; };
  }, [sessionId, navigate]);

  const complete = status?.status === 'complete';
  useEffect(() => { if (complete) clear(); }, [complete]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = status?.order;
  const s = order?.shipsTo;

  return (
    <div className="w-full min-h-screen bg-[#f2f1ea] px-4 md:px-10 py-16 md:py-24">
      <div className="max-w-xl mx-auto flex flex-col gap-8">
        {complete && order ? (
          <>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60">Order confirmed</p>
            <h1 className="text-2xl md:text-3xl leading-snug text-[#9a2918]">{status?.orderPlacedLine || FALLBACK_LINE}</h1>
            <div className="flex flex-col gap-2 bg-white/60 border border-[#a33726]/15 p-5">
              {order.lines.map((l, i) => (
                <p key={i} className="text-sm" style={{ color: '#4a4035' }}>
                  {l.quantity} × {l.displayName ?? 'Coffee'}{l.weightOz ? ` · ${l.weightOz} oz` : ''}
                </p>
              ))}
              <div className="border-t border-[#e0dcd4] mt-2 pt-3 text-sm flex justify-between" style={{ color: '#4a4035' }}>
                <span>Total paid</span><span>{formatPrice(order.totalCents)}</span>
              </div>
            </div>
            {s && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 mb-2">Ships to</p>
                <p className="text-sm text-[#a33726]">{s.street}</p>
                <p className="text-sm text-[#a33726]/70">{s.city}, {s.state} {s.postalCode}</p>
              </div>
            )}
            <p className="text-sm text-[#a33726]/80">We'll email you when it ships.</p>
            <Link to="/profile?tab=orders" className="text-[10px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 w-fit hover:border-[#a33726]">
              See your orders
            </Link>
          </>
        ) : timedOut ? (
          <p className="text-lg text-[#a33726]/80 leading-relaxed">
            Almost there, we're confirming your payment. You'll get an email the moment it's done.
          </p>
        ) : (
          <p className="text-sm uppercase tracking-widest text-[#a33726]/60">Confirming your payment…</p>
        )}
      </div>
    </div>
  );
}
