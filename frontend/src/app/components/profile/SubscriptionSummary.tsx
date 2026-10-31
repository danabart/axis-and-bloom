import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getMySubscriptions, type MySubscription } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import { formatCalendarDate } from '../../lib/calendarDate';

// Commerce 2, C2 (2026-10-31) — Profile → Orders: "Your subscription",
// read-only, from GET /api/subscriptions/mine. Status words are the lookup's
// customer_label; the coffee lined up is the server's dial-aware answer (house
// names only). Only the subscriptions that count (active, payment retrying,
// paused) show; nothing renders when there are none. Commerce 3 adds the
// buttons (pause, skip, frequency, card, cancel).
export default function SubscriptionSummary() {
  const [subs, setSubs] = useState<MySubscription[] | null>(null);

  useEffect(() => {
    getMySubscriptions()
      .then(setSubs)
      .catch(err => { reportError('[Profile/subscriptions]', err); setSubs([]); });
  }, []);

  const current = (subs ?? []).filter(s => s.countsAsSubscriber);
  if (!current.length) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="profile-subscription">
      {current.map(s => (
        <div key={s.id} className="flex flex-col gap-4 border border-[#a33726]/20 bg-white/40 p-6">
          <div className="flex justify-between items-end pb-4 border-b border-[#a33726]/10">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 mb-2 font-normal">Your subscription</p>
              <p className="text-sm text-[#a33726] font-normal">
                Every {s.frequencyWeeks} weeks · {s.bagCount} {s.bagCount === 1 ? 'bag' : 'bags'} · {s.discountPct}% off
              </p>
            </div>
            <span className="text-[10px] font-normal px-2 py-1 bg-[#a33726]/10 text-[#a33726] rounded-sm uppercase tracking-[0.1em]">{s.statusLabel}</span>
          </div>
          {s.nextDeliveryDate && (
            <p className="text-sm text-[#a33726]">Next delivery {formatCalendarDate(s.nextDeliveryDate)}</p>
          )}
          {s.nextCoffees.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60">Lined up</p>
              {s.nextCoffees.map((c, i) => (
                <p key={i} className="text-sm text-[#a33726]/80">
                  {c.quantity} × {c.displayName}{c.weightOz ? ` · ${c.weightOz} oz` : ''}
                </p>
              ))}
            </div>
          )}
          {s.followsDial && (
            <Link to="/bloom" className="text-[10px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 w-fit hover:border-[#a33726]">
              Change it on your Bloom Dial
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
