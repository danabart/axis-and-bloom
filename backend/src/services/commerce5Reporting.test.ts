// Commerce 5 (2026-11-18), Part F: the reporting read path on the test DB.
// v_order_reportable (test-mode and fully refunded orders excluded, a partial
// refund counted net, the business date in business_time_zone), v_orders_weekly
// totals for a fixture week, the bag filter in v_customer_bag_attribution,
// todayBusiness() reading the parameter, and stripeFeeSync (idempotent, test
// orders skipped). View cases run inside withRollback; the parameter and the
// fee-sync cases commit and undo their own rows in `finally` (test DB only).
import 'dotenv/config';
import { describe, it, expect, vi, afterAll } from 'vitest';

// The fee sync talks to Stripe only through paymentDetails / invoices; both are faked here.
const fakeFees = new Map<string, { feeCents: number | null; balanceTransactionId: string | null }>();
vi.mock('./stripe.js', async importOriginal => {
  const real = await importOriginal<typeof import('./stripe.js')>();
  return { ...real, STRIPE_ENABLED: true, stripeMode: () => 'live' as const };
});
vi.mock('./checkoutService.js', async importOriginal => {
  const real = await importOriginal<typeof import('./checkoutService.js')>();
  return {
    ...real,
    paymentDetails: async (pi: string | null) => ({ ...(fakeFees.get(pi ?? '') ?? { feeCents: null, balanceTransactionId: null }), paymentMethodId: null }),
  };
});

const { db } = await import('../db/client.js');
const { withRollback } = await import('../test/withRollback.js');
const { setParameter, invalidateCommerceParameterCache, CommerceParameterError } = await import('./commerceParameters.js');
const { todayBusiness } = await import('./subscriptionService.js');
const { syncStripeFees } = await import('./stripeFeeSync.js');

const RUN = `zzz-c5-${Date.now()}`;
type Runner = { query: typeof db.query };

async function fixtureUser(r: Runner, tag: string): Promise<string> {
  return (await r.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz C5') RETURNING id`, [`${RUN}-${tag}`])).rows[0].id;
}

/** An order with one bag, a paid event, and optionally a refund (cumulative cents) and an at-insert fee. */
async function fixtureOrder(r: Runner, o: {
  tag: string; mode: 'live' | 'test'; paidAt: string; totalCents: number; refundedCents?: number; insertFeeCents?: number; pi?: string;
}): Promise<{ orderId: string; userId: string; lineId: string }> {
  const userId = await fixtureUser(r, o.tag);
  const orderId = (await r.query<{ id: string }>(
    `INSERT INTO "order" (user_id, total_amount_paid, transaction_fee, paid_at, created_at, stripe_mode, stripe_payment_intent_id)
     VALUES ($1, $2, $3, $4, $4, $5, $6) RETURNING id`,
    [userId, o.totalCents / 100, o.insertFeeCents == null ? null : o.insertFeeCents / 100, o.paidAt, o.mode, o.pi ?? null]
  )).rows[0].id;
  const sku = (await r.query<{ id: string }>(`SELECT id FROM coffee_sku ORDER BY id LIMIT 1`)).rows[0].id;
  const lineId = (await r.query<{ id: string }>(
    `INSERT INTO order_line_item (order_id, blend_id, quantity, intended_for_user_id) VALUES ($1, $2, 1, $3) RETURNING id`, [orderId, sku, userId]
  )).rows[0].id;
  await r.query(`INSERT INTO order_event (order_id, event_kind, payment_status, source, created_at) VALUES ($1, 'paid', 'paid', 'webhook', $2)`, [orderId, o.paidAt]);
  if (o.refundedCents) {
    const full = o.refundedCents >= o.totalCents;
    await r.query(
      `INSERT INTO order_event (order_id, event_kind, payment_status, amount_refunded_cents, source, created_at)
       VALUES ($1, $2, $3, $4, 'webhook', $5::timestamptz + interval '1 hour')`,
      [orderId, full ? 'refund_full' : 'refund_partial', full ? 'refunded' : 'partially_refunded', o.refundedCents, o.paidAt]
    );
  }
  return { orderId, userId, lineId };
}

afterAll(async () => { await db.end(); });

describe('v_order_reportable and the views over it', () => {
  it('excludes test-mode and fully refunded orders, counts a partial refund net, and dates in the business zone', async () => {
    await withRollback(async ({ client }) => {
      const a = await fixtureOrder(client, { tag: 'a', mode: 'live', paidAt: '2020-02-12T15:00:00Z', totalCents: 3000 });
      const b = await fixtureOrder(client, { tag: 'b', mode: 'live', paidAt: '2020-02-12T16:00:00Z', totalCents: 5000, refundedCents: 1000, insertFeeCents: 50 });
      const c = await fixtureOrder(client, { tag: 'c', mode: 'test', paidAt: '2020-02-13T15:00:00Z', totalCents: 2000 });
      const d = await fixtureOrder(client, { tag: 'd', mode: 'live', paidAt: '2020-02-13T16:00:00Z', totalCents: 4000, refundedCents: 4000 });
      // Sunday 2020-02-16 21:00 Eastern = Monday 02:00 UTC: the business week of Monday 2020-02-10, not the next one.
      const e = await fixtureOrder(client, { tag: 'e', mode: 'live', paidAt: '2020-02-17T02:00:00Z', totalCents: 1000 });
      await client.query(`INSERT INTO order_event (order_id, event_kind, amount_cents, source) VALUES ($1, 'fee_recorded', 120, 'cron')`, [a.orderId]);

      const rows = (await client.query(
        `SELECT order_id, stripe_mode, paid_on_business_date::text AS d, gross_cents, refunded_cents, net_cents, transaction_fee_cents, bag_count, payment_status, is_reportable
         FROM v_order_reportable WHERE order_id = ANY($1)`, [[a, b, c, d, e].map(x => x.orderId)]
      )).rows;
      const by = (x: { orderId: string }) => rows.find(r => r.order_id === x.orderId);
      expect(by(a)).toMatchObject({ is_reportable: true, gross_cents: 3000, refunded_cents: 0, net_cents: 3000, transaction_fee_cents: 120, bag_count: 1, d: '2020-02-12' });
      expect(by(b)).toMatchObject({ is_reportable: true, payment_status: 'partially_refunded', gross_cents: 5000, refunded_cents: 1000, net_cents: 4000, transaction_fee_cents: 50 });
      expect(by(c)).toMatchObject({ is_reportable: false, stripe_mode: 'test', payment_status: 'paid' });
      expect(by(d)).toMatchObject({ is_reportable: false, payment_status: 'refunded', net_cents: 0 });
      expect(by(e)).toMatchObject({ is_reportable: true, d: '2020-02-16' });

      const weeks = (await client.query(`SELECT week::text AS week, orders::int, new_customers::int, revenue_cents::int, gross_cents::int, refunded_cents::int, net_cents::int, fee_cents::int, subscription_orders::int
                                         FROM v_orders_weekly WHERE week BETWEEN '2020-02-03' AND '2020-02-24' ORDER BY week`)).rows;
      expect(weeks).toEqual([{ week: '2020-02-10', orders: 3, new_customers: 3, revenue_cents: 8000, gross_cents: 9000, refunded_cents: 1000, net_cents: 8000, fee_cents: 170, subscription_orders: 0 }]);

      // Bags: only reportable orders' lines are anyone's bags; a partial refund keeps them.
      const bags = (await client.query(`SELECT order_line_item_id FROM v_customer_bag_attribution WHERE order_line_item_id = ANY($1)`,
        [[a, b, c, d, e].map(x => x.lineId)])).rows.map(r => r.order_line_item_id).sort();
      expect(bags).toEqual([a.lineId, b.lineId, e.lineId].sort());
    });
  });
});

describe('business_time_zone', () => {
  it('todayBusiness() reads the parameter; the writer refuses a zone this runtime does not know', async () => {
    const KEY = 'business_time_zone';
    const original = (await db.query(`SELECT id, value_text FROM commerce_parameter WHERE key = $1 AND superseded_at IS NULL`, [KEY])).rows[0];
    expect(original.value_text).toBe('America/New_York');
    const at = new Date('2026-01-01T20:00:00Z'); // 15:00 in New York, 05:00 next day in Tokyo
    try {
      invalidateCommerceParameterCache();
      expect(await todayBusiness(at)).toBe('2026-01-01');
      await expect(setParameter(KEY, 'Mars/Olympus', 'vitest', null)).rejects.toBeInstanceOf(CommerceParameterError);
      await setParameter(KEY, 'Asia/Tokyo', 'vitest', null);
      expect(await todayBusiness(at)).toBe('2026-01-02');
    } finally {
      await db.query(`DELETE FROM commerce_parameter WHERE key = $1 AND id <> $2`, [KEY, original.id]);
      await db.query(`UPDATE commerce_parameter SET superseded_at = NULL WHERE id = $1`, [original.id]);
      invalidateCommerceParameterCache();
    }
    expect(await todayBusiness(at)).toBe('2026-01-01');
  });
});

describe('stripeFeeSync', () => {
  it('records the fee once per live order as a fee_recorded event, skips test orders and orders not settled yet', async () => {
    const created: string[] = [];
    try {
      const live = await fixtureOrder(db, { tag: 'fee-live', mode: 'live', paidAt: '2020-03-02T15:00:00Z', totalCents: 2900, pi: `pi_${RUN}_live` });
      const test = await fixtureOrder(db, { tag: 'fee-test', mode: 'test', paidAt: '2020-03-02T15:00:00Z', totalCents: 2900, pi: `pi_${RUN}_test` });
      const pending = await fixtureOrder(db, { tag: 'fee-pending', mode: 'live', paidAt: '2020-03-02T15:00:00Z', totalCents: 2900, pi: `pi_${RUN}_pending` });
      created.push(live.orderId, test.orderId, pending.orderId);
      fakeFees.set(`pi_${RUN}_live`, { feeCents: 114, balanceTransactionId: `txn_${RUN}` });
      fakeFees.set(`pi_${RUN}_test`, { feeCents: 999, balanceTransactionId: 'txn_never' });

      const feeEvents = async (orderId: string) => (await db.query(
        `SELECT amount_cents, stripe_ref, source FROM order_event WHERE order_id = $1 AND event_kind = 'fee_recorded'`, [orderId])).rows;
      const first = await syncStripeFees();
      expect(first.mode).toBe('live');
      expect(await feeEvents(live.orderId)).toEqual([{ amount_cents: 114, stripe_ref: `txn_${RUN}`, source: 'cron' }]);
      expect(await feeEvents(test.orderId)).toEqual([]);
      expect(await feeEvents(pending.orderId)).toEqual([]);
      expect((await db.query(`SELECT transaction_fee FROM "order" WHERE id = $1`, [live.orderId])).rows[0].transaction_fee).toBeNull();
      expect((await db.query(`SELECT transaction_fee_cents FROM v_order_reportable WHERE order_id = $1`, [live.orderId])).rows[0].transaction_fee_cents).toBe(114);

      // A second run records nothing new: the live order has its fee, the pending one is still unsettled.
      await syncStripeFees();
      expect(await feeEvents(live.orderId)).toHaveLength(1);
      // Settled later: picked up on the next run.
      fakeFees.set(`pi_${RUN}_pending`, { feeCents: 90, balanceTransactionId: `txn_${RUN}_p` });
      await syncStripeFees();
      expect((await feeEvents(pending.orderId)).map(e => e.amount_cents)).toEqual([90]);
    } finally {
      if (created.length) {
        await db.query(`DELETE FROM order_event WHERE order_id = ANY($1)`, [created]);
        await db.query(`DELETE FROM order_line_item WHERE order_id = ANY($1)`, [created]);
        await db.query(`DELETE FROM "order" WHERE id = ANY($1)`, [created]);
      }
      await db.query(`DELETE FROM user_profile WHERE firebase_uid LIKE $1`, [`${RUN}-%`]);
    }
  });
});
