// Commerce 2, Part D (2026-10-31) — subscriptionService, the one writer of
// subscription / subscription_item / subscription_event, on the test DB:
// scheduleNext with pause and skip windows; the one-attempt-per-cycle claim;
// renewal failure once per (invoice, attempt) and past_due; renewal charged
// once per invoice, back to active, next date from the cycle (or the paid
// date when late); lapse after subscription_past_due_lapse_days with the open
// invoice voided; company-gift create and lapse unchanged; and Dana's decision
// 1: past_due and paused keep Liam access, lapsed and canceled do not.
// Stripe and the lifecycle refresh are mocked.
import 'dotenv/config';
import { describe, it, expect, vi, afterAll } from 'vitest';

const voided: string[] = [];
vi.mock('./stripe.js', () => ({
  STRIPE_ENABLED: true,
  stripe: () => ({
    invoices: {
      retrieve: async (id: string) => ({ id, status: 'open' }),
      voidInvoice: async (id: string) => { voided.push(id); return { id, status: 'void' }; },
    },
  }),
}));
const refreshLifecycleState = vi.fn(async () => null);
vi.mock('./userLifecycle.js', () => ({ refreshLifecycleState: (...a: unknown[]) => refreshLifecycleState(...(a as [])) }));

const { db } = await import('../db/client.js');
const { withRollback } = await import('../test/withRollback.js');
const { invalidateCommerceParameterCache } = await import('./commerceParameters.js');
const svc = await import('./subscriptionService.js');
const { hasLiamAccess } = await import('./liamAccess.js');

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const committedUsers: string[] = [];

async function paidSub(runner: { query: Tx['client']['query'] }, over: Record<string, unknown> = {}, uid = `vitest-sub-${Date.now()}-${Math.random()}`) {
  const userId = (await runner.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Sub') RETURNING id`, [uid])).rows[0].id;
  const cols = { kind: 'paid', status: 'active', frequency_weeks: 2, frequency_days: 14, next_delivery_date: '2026-11-14', ...over };
  const keys = Object.keys(cols);
  const id = (await runner.query<{ id: string }>(
    `INSERT INTO subscription (user_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
    [userId, ...Object.values(cols)]
  )).rows[0].id;
  return { userId, id, uid };
}

const row = async (runner: { query: Tx['client']['query'] }, id: string) =>
  (await runner.query(`SELECT status, failed_attempts, next_delivery_date::text AS next, last_order_id, last_charge_attempt_at FROM subscription WHERE id = $1`, [id])).rows[0];
const events = async (runner: { query: Tx['client']['query'] }, id: string) =>
  (await runner.query<{ event_kind: string; note: string | null; source: string }>(`SELECT event_kind, note, source FROM subscription_event WHERE subscription_id = $1 ORDER BY id`, [id])).rows;

afterAll(async () => {
  for (const userId of committedUsers) {
    await db.query(`DELETE FROM subscription_event WHERE subscription_id IN (SELECT id FROM subscription WHERE user_id = $1)`, [userId]);
    await db.query(`DELETE FROM subscription WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM user_profile WHERE id = $1`, [userId]);
  }
});

describe('scheduleNext', () => {
  it('from + frequency × 7', () => withRollback(async tx => {
    const s = await paidSub(tx.client);
    expect(await svc.scheduleNext(s.id, '2026-11-14', tx.client)).toBe('2026-11-28');
    expect((await row(tx.client, s.id)).next).toBe('2026-11-28');
  }));

  it('steps over every cycle a pause covers, recording each', () => withRollback(async tx => {
    const s = await paidSub(tx.client, { paused_until: '2026-12-15' });
    expect(await svc.scheduleNext(s.id, '2026-11-14', tx.client)).toBe('2026-12-26'); // 11-28 and 12-12 skipped
    expect((await events(tx.client, s.id)).map(e => e.event_kind)).toEqual(['renewal_skipped_paused', 'renewal_skipped_paused']);
  }));

  it('steps over the cycle a skip covers', () => withRollback(async tx => {
    const s = await paidSub(tx.client, { skip_next_until: '2026-11-28' });
    expect(await svc.scheduleNext(s.id, '2026-11-14', tx.client)).toBe('2026-12-12');
    expect((await events(tx.client, s.id)).map(e => e.event_kind)).toEqual(['renewal_skipped_skip']);
  }));
});

describe('charge attempt claim (one attempt per cycle)', () => {
  // The claim compares the attempt's real time with the cycle date, so this
  // runs on the real "today" (the cron always passes it).
  it('a due cycle is claimed once; a second claim the same day gets nothing; a released claim can be taken again', () => withRollback(async tx => {
    const today = svc.todayEastern();
    const s = await paidSub(tx.client, { next_delivery_date: today });
    const first = await svc.recordChargeAttempt(s.id, today, tx.client);
    expect(first).toMatchObject({ cycleDate: today, previousAttemptAt: null });
    expect(first!.attemptAt).toBeGreaterThan(Date.now() - 600_000);
    expect(await svc.recordChargeAttempt(s.id, today, tx.client)).toBeNull();
    await svc.releaseChargeAttempt(s.id, first!, tx.client);
    expect(await svc.recordChargeAttempt(s.id, today, tx.client)).not.toBeNull();
  }));

  it('not due yet, past_due, paused or sponsored: never claimed', () => withRollback(async tx => {
    expect(await svc.recordChargeAttempt((await paidSub(tx.client, { next_delivery_date: '2026-11-20' })).id, '2026-11-14', tx.client)).toBeNull();
    expect(await svc.recordChargeAttempt((await paidSub(tx.client, { status: 'past_due' })).id, '2026-11-14', tx.client)).toBeNull();
    expect(await svc.recordChargeAttempt((await paidSub(tx.client, { status: 'paused' })).id, '2026-11-14', tx.client)).toBeNull();
    expect(await svc.recordChargeAttempt((await paidSub(tx.client, { kind: 'sponsored' })).id, '2026-11-14', tx.client)).toBeNull();
  }));
});

describe('renewal outcomes', () => {
  it('a failure is recorded once per (invoice, attempt): past_due, failed_attempts counts attempts', () => withRollback(async tx => {
    const s = await paidSub(tx.client);
    const fail = (attempt: number, source: 'cron' | 'webhook') => svc.markRenewalFailed({ subscriptionId: s.id, invoiceId: 'in_v1', attemptCount: attempt, amountCents: 3350, note: 'declined', source }, tx.client);
    expect(await fail(1, 'cron')).toBe(true);
    expect(await fail(1, 'webhook')).toBe(false); // Stripe's invoice.payment_failed for the attempt the cron saw
    expect(await fail(2, 'webhook')).toBe(true); // Stripe's retry
    expect(await row(tx.client, s.id)).toMatchObject({ status: 'past_due', failed_attempts: 2 });
  }));

  it('charged once per invoice: back to active, attempts reset, next date from the cycle; late → from the paid date', () => withRollback(async tx => {
    const s = await paidSub(tx.client, { status: 'past_due', failed_attempts: 2, next_delivery_date: '2026-11-14' });
    const orderId = (await tx.client.query<{ id: string }>(`INSERT INTO "order" (user_id) VALUES ($1) RETURNING id`, [s.userId])).rows[0].id;
    const charge = () => svc.markRenewalCharged(tx.client, { subscriptionId: s.id, orderId, invoiceId: 'in_v2', amountCents: 3350, cycleDate: '2026-11-14', paidDate: '2026-11-19' });
    expect(await charge()).toBe(true);
    expect(await charge()).toBe(false);
    expect(await row(tx.client, s.id)).toMatchObject({ status: 'active', failed_attempts: 0, last_order_id: orderId, next: '2026-12-03' }); // 11-19 + 14

    const onTime = await paidSub(tx.client);
    const o2 = (await tx.client.query<{ id: string }>(`INSERT INTO "order" (user_id) VALUES ($1) RETURNING id`, [onTime.userId])).rows[0].id;
    await svc.markRenewalCharged(tx.client, { subscriptionId: onTime.id, orderId: o2, invoiceId: 'in_v3', amountCents: 3350, cycleDate: '2026-11-14', paidDate: '2026-11-14' });
    expect((await row(tx.client, onTime.id)).next).toBe('2026-11-28');
  }));

  it('lapseIfOverdue: past_due longer than subscription_past_due_lapse_days → lapsed, the open invoice voided, lifecycle refreshed', async () => {
    invalidateCommerceParameterCache();
    const overdue = await paidSub(db, { status: 'past_due', next_delivery_date: '2001-01-01' });
    const recent = await paidSub(db, { status: 'past_due', next_delivery_date: '2001-01-20' });
    committedUsers.push(overdue.userId, recent.userId);
    await svc.markRenewalFailed({ subscriptionId: overdue.id, invoiceId: `in_vitest_lapse_${overdue.id}`, attemptCount: 1, amountCents: 3350, note: 'declined', source: 'cron' });

    const lapsed = await svc.lapseIfOverdue('2001-01-25'); // 24 days after the first cycle, 5 after the second
    expect(lapsed).toContain(overdue.id);
    expect(lapsed).not.toContain(recent.id);
    expect((await row(db, overdue.id)).status).toBe('lapsed');
    expect((await row(db, recent.id)).status).toBe('past_due');
    expect(voided).toContain(`in_vitest_lapse_${overdue.id}`);
    expect((await events(db, overdue.id)).map(e => e.event_kind)).toEqual(['renewal_failed', 'lapsed']);
    expect(refreshLifecycleState).toHaveBeenCalledWith(overdue.uid);
  });
});

describe('company gift (sponsored) behaviour, moved here unchanged', () => {
  it('createSponsoredSubscription: active, sponsored, expires after the gift months; lapseSponsoredSubscription: lapsed', () => withRollback(async tx => {
    const userId = (await tx.client.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid) VALUES ($1) RETURNING id`, [`vitest-gift-${Date.now()}`])).rows[0].id;
    const giftId = (await tx.client.query<{ id: string }>(`SELECT id FROM company_gift LIMIT 1`)).rows[0]?.id
      ?? (await tx.client.query<{ id: string }>(`INSERT INTO company_gift (company_name, sponsorship_months) VALUES ('Vitest Co', 3) RETURNING id`)).rows[0].id;
    const sub = await svc.createSponsoredSubscription(tx.client, { userId, companyGiftId: giftId, sponsorshipMonths: 3 });
    const r = (await tx.client.query(
      `SELECT kind, status, company_gift_id, frequency_weeks, next_delivery_date,
              sponsored_expires_at BETWEEN now() + interval '3 months' - interval '1 minute' AND now() + interval '3 months' + interval '1 minute' AS expires_ok
       FROM subscription WHERE id = $1`, [sub.id]
    )).rows[0];
    expect(r).toEqual({ kind: 'sponsored', status: 'active', company_gift_id: giftId, frequency_weeks: null, next_delivery_date: null, expires_ok: true });
    await svc.lapseSponsoredSubscription(sub.id, tx.client);
    expect((await row(tx.client, sub.id)).status).toBe('lapsed');
  }));
});

describe("Dana's decision 1: which statuses keep Liam access", () => {
  it('active, past_due and paused keep it; lapsed and canceled do not', () => withRollback(async tx => {
    for (const [status, allowed] of [['active', true], ['past_due', true], ['paused', true], ['lapsed', false], ['canceled', false]] as const) {
      const s = await paidSub(tx.client, { status });
      expect({ status, ...(await hasLiamAccess(s.uid, tx.client)) }).toEqual({ status, allowed, reason: allowed ? 'subscriber' : null });
    }
  }));
});
