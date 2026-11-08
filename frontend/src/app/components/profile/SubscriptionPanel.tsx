import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  getMySubscriptionPanel, changeSubscriptionFrequency, skipNextDelivery, pauseSubscription, resumeSubscription,
  cancelSubscription, createCardUpdateSession, SubscriptionApiError, type MySubscription, type MySubscriptionsResponse,
} from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import { formatCalendarDate } from '../../lib/calendarDate';
import StripeEmbeddedCheckout, { stripeConfigured } from '../checkout/StripeEmbeddedCheckout';

// Commerce 3, C1 (2026-10-31) — Profile → Orders: the subscription panel (was
// Commerce 2's read-only SubscriptionSummary). Everything comes from
// GET /api/subscriptions/mine: the status words (subscription_status
// customer_label), the real next date (past a pending skip or pause), the
// coffee lined up (house names, dial-aware), the frequencies and the pause
// bounds (commerce_parameter), and which buttons apply (actions). Nothing is
// decided here. Each button calls one route; a refusal shows the server's own
// words. Update card opens Stripe's embedded form in setup mode (the same
// component /checkout uses); Stripe returns to ?card=updated. The
// payment-trouble email links here with ?card=update, which opens it.

type Notice = { tone: 'ok' | 'error'; text: string };
const link = 'text-[10px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 w-fit hover:border-[#a33726] disabled:opacity-40';
const button = 'text-[10px] uppercase tracking-[0.2em] px-3 py-2 border border-[#a33726]/30 text-[#a33726] hover:border-[#a33726] disabled:opacity-40';

export default function SubscriptionPanel() {
  const [data, setData] = useState<MySubscriptionsResponse | null>(null);
  const [notice, setNotice] = useState<Record<string, Notice>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(() => getMySubscriptionPanel()
    .then(setData)
    .catch(err => { reportError('[Profile/subscriptions]', err); setData({ subscriptions: [], frequencies: [], pause: { maxWeeks: 0, earliestResume: '', latestResume: '' } }); }), []);

  useEffect(() => { load(); }, [load]);

  // Back from Stripe's card form: say so once, reload (the webhook saves the card), drop the params.
  const cardParam = searchParams.get('card');
  useEffect(() => {
    if (cardParam !== 'updated') return;
    setBanner('Card updated. Thank you.');
    const t = setTimeout(load, 2500);
    const next = new URLSearchParams(searchParams); next.delete('card'); next.delete('session_id');
    setSearchParams(next, { replace: true });
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardParam]);

  async function act(s: MySubscription, what: string, run: () => Promise<unknown>, done: string): Promise<boolean> {
    setBusy(`${s.id}:${what}`);
    setNotice(n => { const { [s.id]: _, ...rest } = n; return rest; });
    try {
      await run();
      setNotice(n => ({ ...n, [s.id]: { tone: 'ok', text: done } }));
      await load();
      return true;
    } catch (err) {
      const text = err instanceof SubscriptionApiError ? err.message : 'That did not go through. Please try again.';
      if (!(err instanceof SubscriptionApiError)) reportError(`[Profile/subscriptions/${what}]`, err);
      setNotice(n => ({ ...n, [s.id]: { tone: 'error', text } }));
      return false;
    } finally { setBusy(null); }
  }

  if (!data) return null;
  const current = data.subscriptions.filter(s => s.countsAsSubscriber);
  if (!current.length && !banner) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="profile-subscription">
      {banner && <p className="text-sm text-[#a33726]" data-testid="subscription-banner">{banner}</p>}
      {current.map(s => (
        <SubscriptionCard key={s.id} s={s} data={data} busy={busy} notice={notice[s.id] ?? null}
          openCardOnLoad={cardParam === 'update' && s.actions.updateCard}
          onAct={(what, run, done) => act(s, what, run, done)}
          onCanceled={() => setBanner("Your subscription is canceled. Any bag you've already paid for still ships, and your flavor profile stays with your account for whenever you'd like to start again.")} />
      ))}
    </div>
  );
}

function SubscriptionCard({ s, data, busy, notice, openCardOnLoad, onAct, onCanceled }: {
  s: MySubscription; data: MySubscriptionsResponse; busy: string | null; notice: Notice | null; openCardOnLoad: boolean;
  onAct: (what: string, run: () => Promise<unknown>, done: string) => Promise<boolean>;
  onCanceled: () => void;
}) {
  const [pausing, setPausing] = useState(false);
  const [resumeOn, setResumeOn] = useState(data.pause.earliestResume);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cardSecret, setCardSecret] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const isBusy = (what: string) => busy === `${s.id}:${what}`;
  const anyBusy = busy?.startsWith(`${s.id}:`) ?? false;

  async function openCard() {
    setCardError(null);
    try { setCardSecret((await createCardUpdateSession(s.id)).clientSecret); }
    catch (err) {
      if (!(err instanceof SubscriptionApiError)) reportError('[Profile/subscriptions/card]', err);
      setCardError(err instanceof SubscriptionApiError ? err.message : 'The card form could not open. Please try again.');
    }
  }
  useEffect(() => { if (openCardOnLoad && stripeConfigured) openCard(); /* once, from the email link */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCardOnLoad]);

  return (
    <div className="flex flex-col gap-4 border border-[#a33726]/20 bg-white/40 p-6">
      <div className="flex justify-between items-end pb-4 border-b border-[#a33726]/10">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 mb-2 font-normal">Your subscription</p>
          <p className="text-sm text-[#a33726] font-normal">
            Every {s.frequencyWeeks} weeks · {s.bagCount} {s.bagCount === 1 ? 'bag' : 'bags'} · {s.discountPct}% off
          </p>
        </div>
        <span className="text-[10px] font-normal px-2 py-1 bg-[#a33726]/10 text-[#a33726] rounded-sm uppercase tracking-[0.1em]">{s.statusLabel}</span>
      </div>

      {s.status === 'past_due' && (
        <p className="text-sm text-[#a33726]" data-testid="subscription-past-due">We couldn't charge your card. Update it and we'll retry right away.</p>
      )}
      {s.resumesOn && <p className="text-sm text-[#a33726]">Paused · resumes {formatCalendarDate(s.resumesOn)}</p>}
      {s.skippedDate && <p className="text-sm text-[#a33726]/80">Skipping {formatCalendarDate(s.skippedDate)}</p>}
      {s.nextDeliveryDate && <p className="text-sm text-[#a33726]">Next delivery {formatCalendarDate(s.nextDeliveryDate)}</p>}

      {s.nextCoffees.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60">Lined up</p>
          {s.nextCoffees.map((c, i) => (
            <p key={i} className="text-sm text-[#a33726]/80">
              {c.quantity} × {c.displayName}{c.weightOz ? ` · ${c.weightOz} oz` : ''}
              {/* Family Household 3 (C3): a house subscription names whom each bag is for. */}
              {s.nextFor?.[i]?.drinkerFirstName ? ` · for ${s.nextFor[i].drinkerFirstName}` : ''}
            </p>
          ))}
          {(s.skipped ?? []).map((r, i) => <p key={`skip-${i}`} className="text-xs text-[#a33726]/60">{r}</p>)}
        </div>
      )}
      {s.followsDial && <Link to="/bloom" className={link}>Change it on your Bloom Dial</Link>}

      {/* ── the customer's own changes ── */}
      <div className="flex flex-col gap-4 pt-4 border-t border-[#a33726]/10">
        {s.actions.frequency && data.frequencies.length > 1 && (
          <label className="flex items-center gap-3 text-sm text-[#a33726]">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60">How often</span>
            <select value={s.frequencyWeeks ?? ''} disabled={anyBusy} data-testid="subscription-frequency"
              onChange={e => { const weeks = Number(e.target.value); onAct('frequency', () => changeSubscriptionFrequency(s.id, weeks), `Every ${weeks} weeks from your next delivery on.`); }}
              className="bg-transparent border border-[#a33726]/30 px-2 py-1 text-sm text-[#a33726]">
              {data.frequencies.map(w => <option key={w} value={w}>Every {w} weeks</option>)}
            </select>
          </label>
        )}

        <div className="flex flex-wrap gap-3">
          {s.actions.skip && (
            <button type="button" className={button} disabled={anyBusy} data-testid="subscription-skip"
              onClick={() => onAct('skip', () => skipNextDelivery(s.id), "Done: we'll skip this one.")}>
              {isBusy('skip') ? 'Skipping…' : 'Skip next delivery'}
            </button>
          )}
          {s.actions.pause && !pausing && (
            <button type="button" className={button} disabled={anyBusy} data-testid="subscription-pause" onClick={() => setPausing(true)}>
              {s.status === 'paused' ? 'Change resume date' : 'Pause'}
            </button>
          )}
          {s.actions.resume && (
            <button type="button" className={button} disabled={anyBusy} data-testid="subscription-resume"
              onClick={() => onAct('resume', () => resumeSubscription(s.id), 'Welcome back: your coffee is on again.')}>
              {isBusy('resume') ? 'Resuming…' : 'Resume now'}
            </button>
          )}
          {s.actions.updateCard && stripeConfigured && !cardSecret && (
            <button type="button" className={button} disabled={anyBusy} data-testid="subscription-card" onClick={openCard}>Update card</button>
          )}
        </div>

        {pausing && (
          <div className="flex flex-wrap items-end gap-3" data-testid="subscription-pause-form">
            <label className="flex flex-col gap-1 text-sm text-[#a33726]">
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60">Resume on</span>
              <input type="date" value={resumeOn} min={data.pause.earliestResume} max={data.pause.latestResume}
                onChange={e => setResumeOn(e.target.value)} className="bg-transparent border border-[#a33726]/30 px-2 py-1 text-sm text-[#a33726]" />
            </label>
            <button type="button" className={button} disabled={anyBusy || !resumeOn}
              onClick={() => onAct('pause', () => pauseSubscription(s.id, resumeOn), `Paused. We'll pick up again on ${formatCalendarDate(resumeOn)}.`).then(ok => { if (ok) setPausing(false); })}>
              {isBusy('pause') ? 'Pausing…' : 'Pause until then'}
            </button>
            <button type="button" className={link} onClick={() => setPausing(false)}>Keep it going</button>
            <p className="w-full text-xs text-[#a33726]/60">Up to {data.pause.maxWeeks} weeks; you can resume sooner any time.</p>
          </div>
        )}

        {cardError && <p className="text-sm text-[#c8887c]">{cardError}</p>}
        {cardSecret && (
          <div className="bg-white rounded-lg overflow-hidden min-h-[200px]" data-testid="subscription-card-form">
            <StripeEmbeddedCheckout clientSecret={cardSecret} />
          </div>
        )}

        {notice && <p className="text-sm" style={{ color: notice.tone === 'ok' ? '#a33726' : '#c8887c' }} data-testid="subscription-notice">{notice.text}</p>}

        {s.actions.cancel && !confirmCancel && (
          <button type="button" className={`${link} text-[#a33726]/60`} disabled={anyBusy} data-testid="subscription-cancel" onClick={() => setConfirmCancel(true)}>
            Cancel subscription
          </button>
        )}
        {confirmCancel && (
          <div className="flex flex-col gap-3 border border-[#a33726]/20 p-4" data-testid="subscription-cancel-confirm">
            <p className="text-sm text-[#a33726]">Cancel your subscription?</p>
            <p className="text-sm text-[#a33726]/80">Any bag you've already paid for still ships. Your flavor profile and everything Liam knows about your taste stay with your account, ready whenever you'd like to start again.</p>
            <div className="flex gap-3">
              <button type="button" className={button} disabled={anyBusy}
                onClick={() => onAct('cancel', () => cancelSubscription(s.id), 'Your subscription is canceled.').then(ok => { setConfirmCancel(false); if (ok) onCanceled(); })}>
                {isBusy('cancel') ? 'Canceling…' : 'Yes, cancel'}
              </button>
              <button type="button" className={link} onClick={() => setConfirmCancel(false)}>Keep my subscription</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
