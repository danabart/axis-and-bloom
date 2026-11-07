import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCart } from '../../context/CartContext';
import { getCheckoutSessionStatus, type CheckoutSessionStatus } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import { formatPrice } from '../bloom/types';
import { formatCalendarDate } from '../../lib/calendarDate';
import { Wrap, Titled, Caps } from '../chrome';
import '../bloom/cartPage.css';

// Commerce 1, C3 (2026-10-31) — /checkout/return, where Stripe sends the
// customer after paying. The page reads our own tables only
// (GET /api/checkout/session/:id/status), so it shows what the webhook
// actually wrote: polled every 1.5 s for up to 20 s. complete → Liam's
// order-placed line, what was ordered, ships-to; the cart is cleared. Still
// open after 20 s → a calm "almost there" (the email follows the moment the
// webhook lands). expired → back to /checkout.

const POLL_MS = 1500;
const POLL_FOR_MS = 20_000;
// OT-94 (Website 9, D14): order facts only; no roasting or delivery claim.
const FALLBACK_LINE = 'Your order is placed.';

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
    // Website 8 Part C: the site tokens and chrome primitives; the polling and the clear are unchanged.
    <div className="cp-page w-full min-h-screen">
      <Wrap className="flex flex-col gap-8" style={{ maxWidth: 640, paddingBlock: 'clamp(48px, 7vw, 96px)' }}>
        {complete && order ? (
          <>
            <Titled style={{ alignSelf: 'flex-start' }}>Order confirmed</Titled>
            <h1 className="cp-ah" style={{ maxWidth: 'none', fontSize: 'clamp(28px, 3.2vw, 44px)', lineHeight: 1.1 }}>{status?.orderPlacedLine || FALLBACK_LINE}</h1>
            {/* Website 10 (OT-96, D14): the order's status as a fact, v_order_status.customer_label; no status word typed here. */}
            {order.customerLabel && (
              <Caps as="p" weight={400} data-testid="return-status" style={{ alignSelf: 'flex-start' }}>{order.customerLabel}</Caps>
            )}
            <div className="cp-panel" style={{ gap: 8 }}>
              {order.lines.map((l, i) => (
                <p key={i} className="text-sm">
                  {l.quantity} × {l.displayName ?? 'Coffee'}{l.weightOz ? ` · ${l.weightOz} oz` : ''}
                </p>
              ))}
              <div className="mt-2 pt-3 text-sm flex justify-between" style={{ borderTop: '1px solid var(--ab-ink-hairline)' }}>
                <span>Total paid</span><span>{formatPrice(order.totalCents)}</span>
              </div>
            </div>
            {status?.subscription && (
              <div className="flex flex-col gap-1 p-5" style={{ backgroundColor: 'var(--ab-paper)' }} data-testid="return-subscription">
                <p className="text-sm">Your subscription has started with this order.</p>
                {status.subscription.nextDeliveryDate && (
                  <p className="text-sm">
                    Next delivery {formatCalendarDate(status.subscription.nextDeliveryDate)}, every {status.subscription.frequencyWeeks} weeks.
                  </p>
                )}
              </div>
            )}
            {s && (
              <div>
                <Caps as="p" weight={400} style={{ marginBottom: 8 }}>Ships to</Caps>
                <p className="text-sm">{s.street}</p>
                <p className="text-sm" style={{ opacity: 0.8 }}>{s.city}, {s.state} {s.postalCode}</p>
              </div>
            )}
            <p className="text-sm">We'll email you when it ships.</p>
            <Link to="/profile?tab=orders" className="ab-caps cp-ulink" style={{ fontWeight: 600, alignSelf: 'flex-start' }}>
              See your orders
            </Link>
          </>
        ) : timedOut ? (
          <p className="cp-ap" style={{ maxWidth: '48ch' }}>
            Almost there, we're confirming your payment. You'll get an email the moment it's done.
          </p>
        ) : (
          <Caps as="p" weight={400} role="status">Confirming your payment…</Caps>
        )}
      </Wrap>
    </div>
  );
}
