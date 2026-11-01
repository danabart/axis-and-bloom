// Commerce 3, Part D (2026-10-31) — the customer's own changes, through
// subscriptionService (the one writer), on the test DB with Stripe, Resend
// and Firebase mocked: frequency keeps the next date; a second skip while one
// is pending is a 409; a pause beyond subscription_pause_max_weeks is a 422;
// resume with a past next date reschedules to tomorrow; the daily job resumes
// a pause whose date has come (source cron); cancel voids the open renewal
// invoice and records the event; a new card on a past_due subscription pays
// the open invoice once, with the new card named, and is idempotent; each
// change emails once; the panel's effective next date passes a pending skip.
import 'dotenv/config';
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
// DB round trips over the Cloud SQL proxy: the 5 s default is too tight for these fixtures.
vi.setConfig({ testTimeout: 30000 });

const stripeCalls = { voided: [] as string[], paid: [] as Array<{ id: string; params: any; opts: any }>, customerUpdates: [] as any[] };
let invoiceStatus: Record<string, string> = {};
vi.mock('./stripe.js', () => ({
  STRIPE_ENABLED: true,
  stripe: () => ({
    invoices: {
      retrieve: async (id: string) => ({ id, status: invoiceStatus[id] ?? 'open', amount_due: 3350 }),
      voidInvoice: async (id: string) => { stripeCalls.voided.push(id); invoiceStatus[id] = 'void'; return { id, status: 'void' }; },
      pay: async (id: string, params: any, opts: any) => {
        stripeCalls.paid.push({ id, params, opts });
        return { id, status: 'paid' };
      },
    },
    customers: { update: async (id: string, params: any) => { stripeCalls.customerUpdates.push({ id, params }); return {}; } },
  }),
  getOrCreateStripeCustomer: async (userId: string) => `cus_${userId}`,
}));
const refreshLifecycleState = vi.fn(async () => null);
vi.mock('./userLifecycle.js', () => ({ refreshLifecycleState: (...a: unknown[]) => refreshLifecycleState(...(a as [])) }));
const sent: Array<{ to: string; subject: string; text?: string }> = [];
vi.mock('../features/marketing/resendEmail.js', () => ({
  sendResendEmail: async (e: { to: string; subject: string; text?: string }) => { sent.push({ to: e.to, subject: e.subject, text: e.text }); return { ok: true, id: `re_${sent.length}` }; },
}));
vi.mock('./firebase-admin.js', () => ({ default: { auth: () => ({ getUser: async (uid: string) => ({ email: `${uid}@example.com` }) }) } }));

const { db } = await import('../db/client.js');
const { invalidateCommerceParameterCache } = await import('./commerceParameters.js');
const svc = await import('./subscriptionService.js');

const users: string[] = [];
let seq = 0;

async function paidSub(over: Record<string, unknown> = {}) {
  const uid = `vitest-self-${Date.now()}-${++seq}`;
  const userId = (await db.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Self') RETURNING id`, [uid])).rows[0].id;
  users.push(userId);
  const cols = { kind: 'paid', status: 'active', frequency_weeks: 2, frequency_days: 14, next_delivery_date: '2026-11-14', stripe_payment_method_id: 'pm_old', ...over };
  const keys = Object.keys(cols);
  const id = (await db.query<{ id: string }>(
    `INSERT INTO subscription (user_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
    [userId, ...Object.values(cols)]
  )).rows[0].id;
  return { id, userId, uid };
}

const row = async (id: string) => (await db.query(
  `SELECT status, frequency_weeks, frequency_days, next_delivery_date::text AS next, paused_until::text AS paused_until,
          skip_next_until::text AS skip_next_until, cancel_at::text AS cancel_at, stripe_payment_method_id
   FROM subscription WHERE id = $1`, [id])).rows[0];
const events = async (id: string) => (await db.query<{ event_kind: string; note: string | null; source: string }>(
  `SELECT event_kind, note, source FROM subscription_event WHERE subscription_id = $1 ORDER BY id`, [id])).rows;
const mailsTo = (uid: string) => sent.filter(m => m.to === `${uid}@example.com`);

beforeEach(() => { invalidateCommerceParameterCache(); });

afterAll(async () => {
  for (const userId of users) {
    const subIds = (await db.query<{ id: string }>(`SELECT id FROM subscription WHERE user_id = $1`, [userId])).rows.map(r => r.id);
    const uid = (await db.query<{ firebase_uid: string }>(`SELECT firebase_uid FROM user_profile WHERE id = $1`, [userId])).rows[0]?.firebase_uid;
    if (uid) await db.query(`DELETE FROM transactional_email_log WHERE email = $1`, [`${uid}@example.com`]);
    await db.query(`DELETE FROM subscription_event WHERE subscription_id = ANY($1::uuid[])`, [subIds]);
    await db.query(`DELETE FROM subscription WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM user_profile WHERE id = $1`, [userId]);
  }
});

describe('changeFrequency', () => {
  it('keeps the next delivery date, changes the spacing, records the event and emails once; the same value again changes nothing', async () => {
    const s = await paidSub();
    const r = await svc.changeFrequency(s.id, 4, 'customer');
    expect(r.changed).toBe(true);
    expect(await row(s.id)).toMatchObject({ frequency_weeks: 4, frequency_days: 28, next: '2026-11-14' });
    expect(await events(s.id)).toEqual([{ event_kind: 'frequency_changed', note: 'every 2 → 4 weeks', source: 'customer' }]);
    expect((await svc.changeFrequency(s.id, 4, 'customer')).changed).toBe(false);
    expect(await events(s.id)).toHaveLength(1);
    expect(mailsTo(s.uid).map(m => m.subject)).toEqual(['Your coffee now comes every 4 weeks']);
  });

  it('a frequency not on offer is a 400', async () => {
    const s = await paidSub();
    await expect(svc.changeFrequency(s.id, 3)).rejects.toMatchObject({ status: 400, code: 'invalid_frequency' });
  });
});

describe('skipNext', () => {
  it('skips the next delivery (skip_next_until = next + 1); a second skip while it is pending is a 409; the panel date passes it', async () => {
    const s = await paidSub();
    await svc.skipNext(s.id);
    expect(await row(s.id)).toMatchObject({ next: '2026-11-14', skip_next_until: '2026-11-15' });
    await expect(svc.skipNext(s.id)).rejects.toMatchObject({ status: 409, code: 'skip_pending' });
    expect((await events(s.id)).map(e => e.event_kind)).toEqual(['skip_requested']);
    expect(await svc.effectiveNextDelivery({ next_delivery_date: '2026-11-14', frequency_weeks: 2, paused_until: null, skip_next_until: '2026-11-15' })).toBe('2026-11-28');
    expect(svc.coveredBy('2026-11-14', { paused_until: null, skip_next_until: '2026-11-15' })).toBe('skip'); // the daily job does the rest
  });

  it('a past_due subscription cannot skip (update the card first)', async () => {
    const s = await paidSub({ status: 'past_due' });
    await expect(svc.skipNext(s.id)).rejects.toMatchObject({ status: 409, code: 'skip_not_available' });
  });
});

describe('pause and resume', () => {
  it('a resume date beyond subscription_pause_max_weeks is a 422; one inside pauses through the day before it', async () => {
    const s = await paidSub();
    const today = '2026-11-01';
    const max = await (await import('./commerceParameters.js')).commerceParam('subscription_pause_max_weeks');
    const tooFar = (await db.query<{ d: string }>(`SELECT ($1::date + $2::int * 7 + 1)::text AS d`, [today, max])).rows[0].d;
    await expect(svc.pause(s.id, tooFar, 'customer', today)).rejects.toMatchObject({ status: 422, code: 'invalid_resume_date' });
    await expect(svc.pause(s.id, today, 'customer', today)).rejects.toMatchObject({ status: 422 }); // not after today
    await svc.pause(s.id, '2026-11-22', 'customer', today);
    expect(await row(s.id)).toMatchObject({ status: 'paused', paused_until: '2026-11-21' });
    expect(await events(s.id)).toEqual([{ event_kind: 'paused', note: 'resumes 2026-11-22', source: 'customer' }]);
    expect(refreshLifecycleState).toHaveBeenCalled();
  });

  it('resume with a next date in the past moves it to tomorrow; a resumed one resumes nothing again', async () => {
    const s = await paidSub({ status: 'paused', paused_until: '2026-11-30', next_delivery_date: '2026-11-14' });
    const r = await svc.resume(s.id, 'customer', '2026-11-20');
    expect(r.changed).toBe(true);
    expect(await row(s.id)).toMatchObject({ status: 'active', paused_until: null, next: '2026-11-21' });
    expect((await svc.resume(s.id, 'customer', '2026-11-20')).changed).toBe(false);
    expect((await events(s.id)).map(e => [e.event_kind, e.source])).toEqual([['resumed', 'customer']]);
  });

  it('resume keeps a next date that is still ahead', async () => {
    const s = await paidSub({ status: 'paused', paused_until: '2026-11-20', next_delivery_date: '2026-12-12' });
    await svc.resume(s.id, 'customer', '2026-11-18');
    expect((await row(s.id)).next).toBe('2026-12-12');
  });

  it('the daily job resumes a pause whose resume date has come (source cron), and leaves one still running', async () => {
    const due = await paidSub({ status: 'paused', paused_until: '2001-02-01', next_delivery_date: '2001-01-20' });
    const running = await paidSub({ status: 'paused', paused_until: '2001-02-10', next_delivery_date: '2001-01-20' });
    const resumed = await svc.resumeDuePauses('2001-02-02');
    expect(resumed).toContain(due.id);
    expect(resumed).not.toContain(running.id);
    expect(await row(due.id)).toMatchObject({ status: 'active', next: '2001-02-03' });
    expect((await events(due.id)).map(e => [e.event_kind, e.source])).toEqual([['resumed', 'cron']]);
    expect((await row(running.id)).status).toBe('paused');
  });
});

describe('cancel', () => {
  it('voids the open renewal invoice, cancels now, records the event, refreshes the lifecycle, emails once; again changes nothing', async () => {
    const s = await paidSub({ status: 'past_due' });
    await svc.recordSubscriptionEvent({ subscriptionId: s.id, kind: 'renewal_failed', stripeInvoiceId: 'in_vitest_cancel_open', attemptCount: 1, source: 'cron' });
    invoiceStatus.in_vitest_cancel_open = 'open';
    const r = await svc.cancel(s.id, 'customer', '2026-11-16');
    expect(r.changed).toBe(true);
    expect(stripeCalls.voided).toContain('in_vitest_cancel_open');
    expect(await row(s.id)).toMatchObject({ status: 'canceled', cancel_at: '2026-11-16' });
    expect((await events(s.id)).slice(-1)).toEqual([{ event_kind: 'canceled', note: 'was past_due', source: 'customer' }]);
    expect(refreshLifecycleState).toHaveBeenCalledWith(s.uid);
    expect((await svc.cancel(s.id, 'customer')).changed).toBe(false);
    expect(mailsTo(s.uid).filter(m => m.subject === 'Your subscription is canceled')).toHaveLength(1);
    await expect(svc.pause(s.id, '2026-11-30', 'customer', '2026-11-16')).rejects.toMatchObject({ status: 409, code: 'subscription_ended' });
  });
});

describe('attachPaymentMethod', () => {
  it('on past_due: saves the card as default, pays the open invoice once with the new card named; the same card again pays nothing new', async () => {
    const s = await paidSub({ status: 'past_due' });
    await svc.recordSubscriptionEvent({ subscriptionId: s.id, kind: 'renewal_failed', stripeInvoiceId: 'in_vitest_recover', attemptCount: 1, source: 'cron' });
    invoiceStatus.in_vitest_recover = 'open';
    const paidBefore = stripeCalls.paid.length;

    const r = await svc.attachPaymentMethod(s.id, 'pm_new_4242', 'customer');
    expect(r).toMatchObject({ changed: true, recovery: 'paid' });
    expect((await row(s.id)).stripe_payment_method_id).toBe('pm_new_4242');
    expect(stripeCalls.customerUpdates.slice(-1)[0]).toEqual({ id: `cus_${s.userId}`, params: { invoice_settings: { default_payment_method: 'pm_new_4242' } } });
    const pays = stripeCalls.paid.slice(paidBefore);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ id: 'in_vitest_recover', params: { payment_method: 'pm_new_4242', off_session: true } });
    expect(pays[0].opts.idempotencyKey).toBe(`sub:${s.id}:recover:in_vitest_recover:pm_new_4242`);
    expect((await events(s.id)).filter(e => e.event_kind === 'payment_method_updated')).toHaveLength(1);

    // A replayed setup session: no second event or email; a second pay call carries the same key, so Stripe pays once.
    invoiceStatus.in_vitest_recover = 'paid';
    const again = await svc.attachPaymentMethod(s.id, 'pm_new_4242', 'customer');
    expect(again).toMatchObject({ changed: false, recovery: 'none' });
    expect(stripeCalls.paid.length).toBe(paidBefore + 1);
    expect((await events(s.id)).filter(e => e.event_kind === 'payment_method_updated')).toHaveLength(1);
    expect(mailsTo(s.uid).filter(m => m.subject === 'Your card is updated')).toHaveLength(1);
  });

  it('on an active subscription: saves the card and charges nothing', async () => {
    const s = await paidSub();
    const before = stripeCalls.paid.length;
    expect(await svc.attachPaymentMethod(s.id, 'pm_active_new')).toMatchObject({ changed: true, recovery: 'none' });
    expect(stripeCalls.paid.length).toBe(before);
  });
});

describe('the payment-trouble email', () => {
  it('links to the card update on Profile', async () => {
    const { renderPaymentTroubleEmail } = await import('./subscriptionEmails.js');
    const e = renderPaymentTroubleEmail({ firstName: 'Sam', amountCents: 3350 });
    expect(e.text).toMatch(/\/profile\?tab=orders&card=update$/m);
    expect(e.html).toContain('Update your card');
  });
});
