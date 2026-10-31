// Commerce 2, Part D (2026-10-31) — the daily subscription job
// (runSubscriptionDaily) on the test DB, Stripe mocked: run twice the same day
// charges once (one invoice, idempotency keys per cycle, auto_advance only at
// finalize); the cron never writes an order; an unresolved shipment creates no
// invoice, records why, emails admin and gives the claim back; a declined card
// → past_due and one payment-trouble email; a paused cycle moves on without a
// charge; the upcoming-delivery email goes once (the real sendOnce door; only
// the Resend sender and Firebase are mocked). Fixtures sit on 2001 dates so the
// job sees only them.
import 'dotenv/config';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const calls = { invoiceCreate: [] as any[], itemCreate: [] as any[], finalize: [] as any[], pay: [] as any[] };
let declineCustomer = '';
let failFinalizeCustomer = '';
const voidedInvoices: string[] = [];
let seq = 0;
const fakeStripe = {
  customers: { update: vi.fn(async () => ({})) },
  invoices: {
    create: vi.fn(async (params: any, opts: any) => { calls.invoiceCreate.push({ params, opts }); return { id: `in_vitest_daily_${calls.invoiceCreate.length}`, status: 'draft' }; }),
    finalizeInvoice: vi.fn(async (id: string, params: any, opts: any) => { calls.finalize.push({ id, params, opts }); return { id, status: 'open' }; }),
    retrieve: vi.fn(async (id: string) => ({ id, status: 'open', attempt_count: 1, amount_due: 3350 })),
    voidInvoice: vi.fn(async (id: string) => { voidedInvoices.push(id); return { id, status: 'void' }; }),
    pay: vi.fn(async (id: string, params: any, opts: any) => {
      calls.pay.push({ id, params, opts });
      const invoice = calls.invoiceCreate.find(c => `in_vitest_daily_${calls.invoiceCreate.indexOf(c) + 1}` === id);
      if (invoice && invoice.params.customer === failFinalizeCustomer) throw Object.assign(new Error('Stripe API unreachable'), { type: 'StripeConnectionError' });
      if (invoice && invoice.params.customer === declineCustomer) {
        throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined' });
      }
      return { id, status: 'paid' };
    }),
    list: vi.fn(async ({ customer }: { customer: string }) => ({
      data: calls.invoiceCreate
        .map((c, i) => ({ id: `in_vitest_daily_${i + 1}`, customer: c.params.customer, metadata: c.params.metadata, attempt_count: 1, amount_due: 3350 }))
        .filter(i => i.customer === customer),
    })),
  },
  invoiceItems: { create: vi.fn(async (params: any, opts: any) => { calls.itemCreate.push({ params, opts }); return { id: `ii_${calls.itemCreate.length}` }; }) },
};
vi.mock('./stripe.js', () => ({
  STRIPE_ENABLED: true,
  stripe: () => fakeStripe,
  getOrCreateStripeCustomer: async (userId: string) => `cus_${userId}`,
}));

// The shipment per subscription id (its own rules are subscriptionShipment.test.ts).
const shipments: Record<string, any> = {};
vi.mock('./subscriptionShipment.js', () => ({ resolveSubscriptionShipment: async (id: string) => shipments[id] }));
vi.mock('./userLifecycle.js', () => ({ refreshLifecycleState: async () => null }));
const sent: Array<{ to: string; subject: string }> = [];
vi.mock('../features/marketing/resendEmail.js', () => ({
  sendResendEmail: async (e: { to: string; subject: string }) => { sent.push({ to: e.to, subject: e.subject }); return { ok: true, id: `re_${sent.length}` }; },
}));
vi.mock('./firebase-admin.js', () => ({ default: { auth: () => ({ getUser: async (uid: string) => ({ email: `${uid}@example.com` }) }) } }));

const { db } = await import('../db/client.js');
const { invalidateCommerceParameterCache } = await import('./commerceParameters.js');
const { runSubscriptionDaily } = await import('./subscriptionRenewal.js');

const users: string[] = [];

async function dueSub(nextDate: string, over: Record<string, unknown> = {}) {
  const uid = `vitest-daily-${Date.now()}-${++seq}`;
  const userId = (await db.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Daily') RETURNING id`, [uid])).rows[0].id;
  users.push(userId);
  await db.query(
    `INSERT INTO address (user_id, address_type, street, city, state, postal_code, country, is_default) VALUES ($1, 'shipping', '2 Vitest Way', 'Union City', 'NJ', '07087', 'US', true)`, [userId]
  );
  const cols = { kind: 'paid', status: 'active', frequency_weeks: 4, frequency_days: 28, next_delivery_date: nextDate, stripe_payment_method_id: 'pm_vitest', ...over };
  const keys = Object.keys(cols);
  const id = (await db.query<{ id: string }>(
    `INSERT INTO subscription (user_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`, [userId, ...Object.values(cols)]
  )).rows[0].id;
  return { id, userId, uid };
}

const resolved = (id: string, userId: string) => ({
  status: 'resolved', subscriptionId: id, userId, bagCount: 1, discountPct: 5, discountCents: 145, subtotalCents: 2755, shippingCents: 595,
  lines: [{ itemId: 'i1', coffeeSkuId: '00000000-0000-0000-0000-000000000001', coffeeId: 1, displayName: 'Petal Hour', archetypeLabel: 'Floral',
    weightOz: 12, quantity: 1, fullPriceCents: 2900, unitPriceCents: 2755, discountCents: 145, archetype: 'floral', slotId: 1, dialSortOrder: 1, basis: 'dial' }],
});

const subRow = async (id: string) =>
  (await db.query(`SELECT status, failed_attempts, next_delivery_date::text AS next, last_charge_attempt_at FROM subscription WHERE id = $1`, [id])).rows[0];
const eventsOf = async (id: string) =>
  (await db.query<{ event_kind: string; note: string | null; stripe_invoice_id: string | null }>(`SELECT event_kind, note, stripe_invoice_id FROM subscription_event WHERE subscription_id = $1 ORDER BY id`, [id])).rows;

beforeEach(() => { invalidateCommerceParameterCache(); });

afterAll(async () => {
  for (const userId of users) {
    await db.query(`DELETE FROM transactional_email_log WHERE template LIKE ANY (ARRAY['subscription_%', 'admin_subscription_attention:%']) AND (template LIKE '%' || $1 || '%')`,
      [(await db.query<{ id: string }>(`SELECT id FROM subscription WHERE user_id = $1`, [userId])).rows[0]?.id ?? '-']);
    await db.query(`DELETE FROM subscription_event WHERE subscription_id IN (SELECT id FROM subscription WHERE user_id = $1)`, [userId]);
    await db.query(`DELETE FROM subscription WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM address WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM user_profile WHERE id = $1`, [userId]);
  }
  await db.query(`DELETE FROM transactional_email_log WHERE template LIKE 'subscription_payment_trouble:in_vitest_daily_%'`);
});

describe('runSubscriptionDaily', () => {
  it('charges a due cycle as one Stripe invoice; the same run again charges nothing; no order is written by the cron', async () => {
    const s = await dueSub('2001-01-01');
    shipments[s.id] = resolved(s.id, s.userId);
    const ordersBefore = Number((await db.query(`SELECT count(*) FROM "order"`)).rows[0].count);

    const first = await runSubscriptionDaily('2001-01-01');
    expect(first.charges.find(c => c.subscriptionId === s.id)).toMatchObject({ outcome: 'charged', invoiceId: 'in_vitest_daily_1' });
    const second = await runSubscriptionDaily('2001-01-01');
    expect(second.charges.find(c => c.subscriptionId === s.id)).toMatchObject({ outcome: 'already_attempted' });
    expect(calls.invoiceCreate.filter(c => c.params.metadata.subscription_id === s.id)).toHaveLength(1);

    const inv = calls.invoiceCreate[0];
    expect(inv.params).toMatchObject({
      customer: `cus_${s.userId}`, collection_method: 'charge_automatically', auto_advance: false, automatic_tax: { enabled: true },
      default_payment_method: 'pm_vitest', pending_invoice_items_behavior: 'exclude', metadata: { subscription_id: s.id, cycle_date: '2001-01-01' },
    });
    expect(inv.opts.idempotencyKey).toMatch(new RegExp(`^sub:${s.id}:cycle:2001-01-01:attempt:\\d+:invoice$`));
    const [coffee, shipping] = calls.itemCreate;
    expect(coffee.params).toMatchObject({ invoice: 'in_vitest_daily_1', quantity: 1, tax_code: 'txcd_41050006', tax_behavior: 'exclusive',
      description: 'Petal Hour · 12 oz · every 4 weeks', metadata: { kind: 'coffee', unit_price_cents: '2755', discount_cents: '145', display_name: 'Petal Hour' } });
    expect(String(coffee.params.unit_amount_decimal)).toBe('2755');
    expect(shipping.params).toMatchObject({ tax_code: 'txcd_92010001', metadata: { kind: 'shipping' } });
    expect(String(shipping.params.unit_amount_decimal)).toBe('595');
    expect(calls.finalize[0]).toMatchObject({ params: { auto_advance: true } });
    expect(calls.finalize[0].opts.idempotencyKey).toMatch(/:attempt:\d+:finalize$/);
    expect(calls.pay[0]).toMatchObject({ params: { off_session: true } });
    expect(calls.pay[0].opts.idempotencyKey).toMatch(/:attempt:\d+:pay$/);
    expect(JSON.stringify(calls)).not.toMatch(/roaster/i);

    expect(Number((await db.query(`SELECT count(*) FROM "order"`)).rows[0].count)).toBe(ordersBefore);
    expect((await subRow(s.id)).next).toBe('2001-01-01'); // the invoice.paid webhook moves it, not the cron
  });

  it('an unresolved shipment: no invoice, the reason recorded, admin emailed once, the claim given back', async () => {
    const s = await dueSub('2001-01-02');
    shipments[s.id] = { status: 'unresolved', subscriptionId: s.id, userId: s.userId, unresolved: [{ itemId: 'i1', reason: 'floral: nothing sellable at 12 oz' }] };
    const invoicesBefore = calls.invoiceCreate.length;
    const r = await runSubscriptionDaily('2001-01-02');
    expect(r.charges.find(c => c.subscriptionId === s.id)).toMatchObject({ outcome: 'unresolved' });
    expect(calls.invoiceCreate.length).toBe(invoicesBefore);
    expect(await eventsOf(s.id)).toEqual([{ event_kind: 'renewal_failed', note: 'not charged: floral: nothing sellable at 12 oz', stripe_invoice_id: null }]);
    expect((await subRow(s.id))).toMatchObject({ status: 'active', last_charge_attempt_at: null });
    expect(sent.filter(e => e.subject === `Subscription renewal not charged: ${s.id}`)).toHaveLength(1);
    await runSubscriptionDaily('2001-01-02'); // tomorrow's retry: same cycle, no second admin email
    expect(sent.filter(e => e.subject === `Subscription renewal not charged: ${s.id}`)).toHaveLength(1);
  });

  it('a declined card: past_due, one payment-trouble email; Stripe retries from here', async () => {
    const s = await dueSub('2001-01-03');
    shipments[s.id] = resolved(s.id, s.userId);
    declineCustomer = `cus_${s.userId}`;
    const r = await runSubscriptionDaily('2001-01-03');
    const c = r.charges.find(x => x.subscriptionId === s.id);
    expect(c).toMatchObject({ outcome: 'declined', detail: 'Your card was declined.' });
    expect(await subRow(s.id)).toMatchObject({ status: 'past_due', failed_attempts: 1 });
    expect((await eventsOf(s.id)).map(e => [e.event_kind, e.stripe_invoice_id])).toEqual([['renewal_failed', c!.invoiceId]]);
    expect(sent.filter(e => e.to === `${s.uid}@example.com` && e.subject === 'About your next delivery')).toHaveLength(1);
    await runSubscriptionDaily('2001-01-03'); // past_due: the cron never opens a second invoice for the cycle
    expect(calls.invoiceCreate.filter(x => x.params.metadata.subscription_id === s.id)).toHaveLength(1);
  });

  it('a paused cycle moves on with an event, nothing charged', async () => {
    const s = await dueSub('2001-01-04', { paused_until: '2001-01-10' });
    shipments[s.id] = resolved(s.id, s.userId);
    const r = await runSubscriptionDaily('2001-01-04');
    expect(r.charges.find(c => c.subscriptionId === s.id)).toMatchObject({ outcome: 'skipped_paused' });
    expect((await subRow(s.id)).next).toBe('2001-02-01');
    expect((await eventsOf(s.id)).map(e => e.event_kind)).toEqual(['renewal_skipped_paused']);
    expect(calls.invoiceCreate.filter(x => x.params.metadata.subscription_id === s.id)).toHaveLength(0);
  });

  it('the upcoming-delivery email goes once, notice-days ahead, with the coffee lined up', async () => {
    const s = await dueSub('2001-03-04'); // notice 3 days → sent on 2001-03-01
    shipments[s.id] = resolved(s.id, s.userId);
    const one = await runSubscriptionDaily('2001-03-01');
    const two = await runSubscriptionDaily('2001-03-01');
    const mine = sent.filter(e => e.to === `${s.uid}@example.com` && e.subject.startsWith('Your next coffee ships'));
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe('Your next coffee ships Sunday, March 4');
    expect(one.upcomingSent).toBeGreaterThanOrEqual(1);
    expect(two.upcomingSent).toBe(0);
    expect(two.charges.find(c => c.subscriptionId === s.id)).toBeUndefined(); // not due yet
  });

  it('a non-card failure after finalize: the open invoice is voided, the claim given back; the retry uses fresh keys', async () => {
    const s = await dueSub('2001-01-05');
    shipments[s.id] = resolved(s.id, s.userId);
    failFinalizeCustomer = `cus_${s.userId}`;
    const r = await runSubscriptionDaily('2001-01-05');
    const c = r.charges.find(x => x.subscriptionId === s.id);
    expect(c).toMatchObject({ outcome: 'error', detail: 'Stripe API unreachable' });
    const first = calls.invoiceCreate.filter(x => x.params.metadata.subscription_id === s.id);
    expect(first).toHaveLength(1);
    expect(voidedInvoices).toContain(`in_vitest_daily_${calls.invoiceCreate.indexOf(first[0]) + 1}`);
    expect((await subRow(s.id))).toMatchObject({ status: 'active', last_charge_attempt_at: null });

    failFinalizeCustomer = '';
    expect((await runSubscriptionDaily('2001-01-05')).charges.find(x => x.subscriptionId === s.id)).toMatchObject({ outcome: 'charged' });
    const keys = calls.invoiceCreate.filter(x => x.params.metadata.subscription_id === s.id).map(x => x.opts.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
