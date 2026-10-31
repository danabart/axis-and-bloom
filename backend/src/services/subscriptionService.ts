// Commerce 2, B1 (2026-10-31) — the single writer of subscription,
// subscription_item and subscription_event (comments.sql Writer fields).
//
// Two kinds of subscription share the table: a sponsored company-gift seat
// (created on redemption, lapsed by the sponsored-subscription cron; both
// moved here from routes/companyGiftRedemption.ts and routes/cron.ts with the
// SQL unchanged) and a paid subscription (Commerce 2): started by a checkout
// (createPaidSubscriptionFromCheckout, inside checkoutService's completion
// transaction), charged each cycle by the daily cron as a Stripe one-off
// invoice (subscriptionRenewal.ts), and moved on by the webhook when the
// invoice is paid or fails. subscription_event is insert-only history.
//
// Dates: next_delivery_date, the cycle date and "today" are calendar dates in
// US Eastern (Task 0 finding 7); they are passed and returned as YYYY-MM-DD
// strings and all date arithmetic happens in SQL, never on JS Dates.
//
// Every write stamps subscription.updated_at, so Liam's customer block
// (customerReads watermark) rebuilds when a subscription changes.
import { db, withTransaction, type Tx } from '../db/client.js';
import { commerceParam } from './commerceParameters.js';
import { refreshLifecycleState } from './userLifecycle.js';
import { stripe, STRIPE_ENABLED } from './stripe.js';
import { resolveSubscriptionShipment, subscriptionDiscountPct } from './subscriptionShipment.js';

type Runner = Pick<Tx, 'query'>;

export const BUSINESS_TZ = 'America/New_York';
/** Today's calendar date in US Eastern, YYYY-MM-DD. */
export function todayEastern(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ });
}

export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'paused' | 'canceled' | 'lapsed';
export type SubscriptionEventKind =
  | 'started' | 'renewal_charged' | 'renewal_failed' | 'renewal_skipped_paused' | 'renewal_skipped_skip'
  | 'paused' | 'resumed' | 'skip_requested' | 'frequency_changed' | 'canceled' | 'lapsed'
  | 'payment_method_updated' | 'invoice_voided';
export type SubscriptionEventSource = 'checkout' | 'cron' | 'webhook' | 'admin' | 'customer';

export interface SubscriptionEventInput {
  subscriptionId: string;
  kind: SubscriptionEventKind;
  orderId?: string | null;
  stripeInvoiceId?: string | null;
  amountCents?: number | null;
  attemptCount?: number | null;
  note?: string | null;
  source: SubscriptionEventSource;
}

/**
 * Append one subscription_event. Returns null when a partial unique index
 * says it already exists (a second started, a second renewal_charged for an
 * invoice, a second renewal_failed for the same invoice attempt).
 */
export async function recordSubscriptionEvent(e: SubscriptionEventInput, runner: Runner = db): Promise<number | null> {
  const r = await runner.query<{ id: number }>(
    `INSERT INTO subscription_event (subscription_id, event_kind, order_id, stripe_invoice_id, amount_cents, attempt_count, note, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [e.subscriptionId, e.kind, e.orderId ?? null, e.stripeInvoiceId ?? null, e.amountCents ?? null,
     e.attemptCount ?? null, e.note ?? null, e.source]
  );
  return r.rows[0]?.id ?? null;
}

/** Does this database have the subscription? (The webhook's unknown-subscription check.) */
export async function subscriptionExists(subscriptionId: string, runner: Runner = db): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) return false;
  return (await runner.query(`SELECT 1 FROM subscription WHERE id = $1`, [subscriptionId])).rows.length > 0;
}

/** Set a subscription's status (FK subscription_status); returns false when the row is missing. */
export async function setStatus(subscriptionId: string, status: SubscriptionStatus, runner: Runner = db): Promise<boolean> {
  const r = await runner.query(`UPDATE subscription SET status = $2, updated_at = now() WHERE id = $1`, [subscriptionId, status]);
  return (r.rowCount ?? 0) > 0;
}

// ── sponsored (company gift) — moved, behaviour unchanged ────────────────────

/**
 * Was routes/companyGiftRedemption.ts's INSERT, same SQL plus kind
 * 'sponsored' (also the column default). Runs inside the redemption
 * transaction; the one-active-sponsored-seat guard stays in the route.
 */
export async function createSponsoredSubscription(
  tx: Runner, input: { userId: string; companyGiftId: string; sponsorshipMonths: number | string }
): Promise<{ id: string; sponsored_expires_at: string }> {
  const r = await tx.query<{ id: string; sponsored_expires_at: string }>(
    `INSERT INTO subscription (user_id, status, company_gift_id, sponsored_expires_at, kind)
     VALUES ($1, 'active', $2, now() + ($3::text || ' months')::interval, 'sponsored')
     RETURNING id, sponsored_expires_at`,
    [input.userId, input.companyGiftId, input.sponsorshipMonths]
  );
  return r.rows[0];
}

/** Was routes/cron.ts's sponsored-lapse UPDATE, same SQL; the cron still refreshes lifecycle and sends the email. */
export async function lapseSponsoredSubscription(subscriptionId: string, runner: Runner = db): Promise<void> {
  await runner.query(`UPDATE subscription SET status = 'lapsed', updated_at = now() WHERE id = $1`, [subscriptionId]);
  await recordSubscriptionEvent({ subscriptionId, kind: 'lapsed', note: 'sponsored seat expired', source: 'cron' }, runner);
}

// ── paid: start ──────────────────────────────────────────────────────────────

export interface SubscriptionIntent { frequencyWeeks: number; startsSubscription: true }

interface CheckoutSessionRow {
  id: string;
  user_id: string;
  subscription_intent: SubscriptionIntent | null;
}
interface CheckoutLineRow {
  coffee_id: number | null;
  display_name: string;
  weight_oz: string | number;
  quantity: number;
  source: 'dial' | 'direct' | 'collection';
  archetype: string | null;
  dial_sort_order: number | null;
}

/**
 * B3: a subscription checkout completed. Called by
 * checkoutService.completeCheckoutSession inside its transaction, BEFORE the
 * first delivery's order is written ("order" is insert-only, so the order
 * carries the subscription id at insert): the subscription (paid, active,
 * next delivery = today + N weeks) and one item per checkout line. The
 * caller then writes the order and calls recordSubscriptionStarted.
 */
export async function createPaidSubscriptionFromCheckout(
  tx: Runner,
  cs: CheckoutSessionRow,
  lines: CheckoutLineRow[],
  paid: { paymentMethodId: string | null; today?: string }
): Promise<string> {
  const weeks = cs.subscription_intent?.frequencyWeeks;
  if (!weeks) throw new Error(`checkout_session ${cs.id} has no subscription intent`);
  const today = paid.today ?? todayEastern();
  const archetype = lines.find(l => l.archetype && l.source !== 'direct')?.archetype ?? null;

  const s = await tx.query<{ id: string }>(
    `INSERT INTO subscription
       (user_id, kind, status, frequency_weeks, frequency_days, archetype, origin_checkout_session_id,
        stripe_payment_method_id, next_delivery_date)
     VALUES ($1, 'paid', 'active', $2::int, $2::int * 7, $3, $4, $5, $6::date + $2::int * 7)
     RETURNING id`,
    [cs.user_id, weeks, archetype, cs.id, paid.paymentMethodId, today]
  );
  const subscriptionId = s.rows[0].id;

  for (const l of lines) {
    const lineArchetype = l.source === 'direct' ? null : l.archetype;
    const slot = lineArchetype && l.dial_sort_order != null
      ? (await tx.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [lineArchetype, l.dial_sort_order])).rows[0]
      : undefined;
    await tx.query(
      `INSERT INTO subscription_item (subscription_id, archetype, signup_slot_id, signup_coffee_id, weight_oz, quantity, display_name_at_signup)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [subscriptionId, lineArchetype, slot?.id ?? null, l.coffee_id, l.weight_oz, l.quantity, l.display_name]
    );
  }

  return subscriptionId;
}

/** The first delivery's order exists: point the subscription at it and record started (once). */
export async function recordSubscriptionStarted(tx: Runner, subscriptionId: string, first: { orderId: string; amountCents: number | null }): Promise<void> {
  const r = await tx.query<{ frequency_weeks: number }>(
    `UPDATE subscription SET last_order_id = $2, updated_at = now() WHERE id = $1 RETURNING frequency_weeks`, [subscriptionId, first.orderId]
  );
  await recordSubscriptionEvent({
    subscriptionId, kind: 'started', orderId: first.orderId, amountCents: first.amountCents,
    note: `every ${r.rows[0]?.frequency_weeks} weeks`, source: 'checkout',
  }, tx);
}

// ── paid: schedule ───────────────────────────────────────────────────────────

/**
 * next_delivery_date = fromDate + frequency_weeks × 7, stepping over every
 * date a pause (paused_until) or a skip (skip_next_until) covers, each step
 * over recorded as an event. Returns the new date (YYYY-MM-DD).
 */
export async function scheduleNext(subscriptionId: string, fromDate: string, runner: Runner = db, source: SubscriptionEventSource = 'cron'): Promise<string> {
  const sub = (await runner.query<{ frequency_weeks: number | null; paused_until: string | null; skip_next_until: string | null }>(
    `SELECT frequency_weeks, paused_until::text, skip_next_until::text FROM subscription WHERE id = $1`, [subscriptionId]
  )).rows[0];
  if (!sub?.frequency_weeks) throw new Error(`subscription ${subscriptionId} has no frequency`);
  const step = async (d: string) =>
    (await runner.query<{ d: string }>(`SELECT ($1::date + $2::int * 7)::text AS d`, [d, sub.frequency_weeks])).rows[0].d;

  let next = await step(fromDate);
  // Dates compare correctly as YYYY-MM-DD strings.
  for (let guard = 0; guard < 520; guard++) {
    if (sub.paused_until && next <= sub.paused_until) {
      await recordSubscriptionEvent({ subscriptionId, kind: 'renewal_skipped_paused', note: `cycle ${next} skipped (paused until ${sub.paused_until})`, source }, runner);
    } else if (sub.skip_next_until && next <= sub.skip_next_until) {
      await recordSubscriptionEvent({ subscriptionId, kind: 'renewal_skipped_skip', note: `cycle ${next} skipped (skip until ${sub.skip_next_until})`, source }, runner);
    } else break;
    next = await step(next);
  }
  await runner.query(`UPDATE subscription SET next_delivery_date = $2::date, updated_at = now() WHERE id = $1`, [subscriptionId, next]);
  return next;
}

/** Is a cycle date covered by the pause or the skip window? (The cron skips it without charging.) */
export function coveredBy(cycleDate: string, sub: { paused_until: string | null; skip_next_until: string | null }): 'paused' | 'skip' | null {
  if (sub.paused_until && cycleDate <= sub.paused_until) return 'paused';
  if (sub.skip_next_until && cycleDate <= sub.skip_next_until) return 'skip';
  return null;
}

/** A due cycle the pause or skip covers: record it, move the date on, charge nothing. */
export async function skipCoveredCycle(subscriptionId: string, cycleDate: string, why: 'paused' | 'skip'): Promise<string> {
  return withTransaction(async tx => {
    await recordSubscriptionEvent({
      subscriptionId, kind: why === 'paused' ? 'renewal_skipped_paused' : 'renewal_skipped_skip',
      note: `cycle ${cycleDate} skipped`, source: 'cron',
    }, tx);
    return scheduleNext(subscriptionId, cycleDate, tx, 'cron');
  });
}

// ── paid: charge attempts ────────────────────────────────────────────────────

/** attemptAt: this claim's stamp in epoch ms, part of the attempt's Stripe idempotency keys. */
export interface ChargeClaim { cycleDate: string; previousAttemptAt: string | null; attemptAt: number }

/**
 * Claim this cycle's one charge attempt (Task 0 finding 3). Atomic: only an
 * active paid subscription that is due (next_delivery_date <= today) and
 * whose last attempt (in Eastern days) is before the cycle date is claimed,
 * and the claim stamps last_charge_attempt_at, so a second cron run the same
 * day, or a concurrent one, gets null and charges nothing.
 */
export async function recordChargeAttempt(subscriptionId: string, today: string, runner: Runner = db): Promise<ChargeClaim | null> {
  const r = await runner.query<{ cycle_date: string; previous_attempt_at: string | null; attempt_ms: string }>(
    `WITH old AS (SELECT id, last_charge_attempt_at FROM subscription WHERE id = $1 FOR UPDATE)
     UPDATE subscription s SET last_charge_attempt_at = now(), updated_at = now()
     FROM old
     WHERE s.id = old.id AND s.kind = 'paid' AND s.status = 'active'
       AND s.next_delivery_date <= $2::date
       AND (s.last_charge_attempt_at IS NULL OR (s.last_charge_attempt_at AT TIME ZONE '${BUSINESS_TZ}')::date < s.next_delivery_date)
     RETURNING s.next_delivery_date::text AS cycle_date, old.last_charge_attempt_at::text AS previous_attempt_at,
               (EXTRACT(EPOCH FROM s.last_charge_attempt_at) * 1000)::bigint::text AS attempt_ms`,
    [subscriptionId, today]
  );
  const row = r.rows[0];
  return row ? { cycleDate: row.cycle_date, previousAttemptAt: row.previous_attempt_at, attemptAt: Number(row.attempt_ms) } : null;
}

/** Give a claim back (a non-card error: Stripe unreachable, an item that could not be named), so the next run tries again. */
export async function releaseChargeAttempt(subscriptionId: string, claim: ChargeClaim, runner: Runner = db): Promise<void> {
  await runner.query(
    `UPDATE subscription SET last_charge_attempt_at = $2::timestamptz, updated_at = now() WHERE id = $1`,
    [subscriptionId, claim.previousAttemptAt]
  );
}

// ── paid: outcomes ───────────────────────────────────────────────────────────

/**
 * invoice.paid for a cycle (called by checkoutService.createSubscriptionOrder
 * in the order's transaction). Exactly once per invoice (the renewal_charged
 * unique index): records the event, puts a past_due or lapsed subscription
 * back to active (paused and canceled stay as they are), resets
 * failed_attempts, points last_order_id at the order, and schedules the next
 * cycle from the cycle date, or from the paid date when a retry succeeded
 * later (Task 0 finding 6). Returns false when the invoice was already
 * recorded.
 */
export async function markRenewalCharged(
  tx: Runner,
  input: { subscriptionId: string; orderId: string; invoiceId: string; amountCents: number; cycleDate: string; paidDate: string }
): Promise<boolean> {
  const id = await recordSubscriptionEvent({
    subscriptionId: input.subscriptionId, kind: 'renewal_charged', orderId: input.orderId, stripeInvoiceId: input.invoiceId,
    amountCents: input.amountCents, note: `cycle ${input.cycleDate}`, source: 'webhook',
  }, tx);
  if (id === null) return false;
  await tx.query(
    `UPDATE subscription
     SET status = CASE WHEN status IN ('past_due', 'lapsed') THEN 'active' ELSE status END,
         failed_attempts = 0, last_order_id = $2, updated_at = now()
     WHERE id = $1`,
    [input.subscriptionId, input.orderId]
  );
  const from = input.paidDate > input.cycleDate ? input.paidDate : input.cycleDate;
  await scheduleNext(input.subscriptionId, from, tx, 'webhook');
  return true;
}

/**
 * A renewal charge failed (the cron's synchronous decline, or Stripe's
 * invoice.payment_failed for a retry). Once per (invoice, attempt): the
 * event, failed_attempts + 1, status past_due (from active or past_due).
 * Returns whether this call recorded it (the caller emails only then).
 */
export async function markRenewalFailed(input: {
  subscriptionId: string; invoiceId: string; attemptCount: number; amountCents: number | null; note: string | null; source: 'cron' | 'webhook';
}, runner: Runner = db): Promise<boolean> {
  const id = await recordSubscriptionEvent({
    subscriptionId: input.subscriptionId, kind: 'renewal_failed', stripeInvoiceId: input.invoiceId,
    attemptCount: input.attemptCount, amountCents: input.amountCents, note: input.note, source: input.source,
  }, runner);
  if (id === null) return false;
  await runner.query(
    `UPDATE subscription
     SET failed_attempts = failed_attempts + 1,
         status = CASE WHEN status IN ('active', 'past_due') THEN 'past_due' ELSE status END,
         updated_at = now()
     WHERE id = $1`,
    [input.subscriptionId]
  );
  return true;
}

/** invoice.marked_uncollectible (Stripe gave up): lapsed, with the event and a lifecycle refresh. */
export async function lapseForUncollectible(subscriptionId: string, invoiceId: string): Promise<void> {
  const uid = await withTransaction(async tx => {
    await setStatus(subscriptionId, 'lapsed', tx);
    await recordSubscriptionEvent({ subscriptionId, kind: 'lapsed', stripeInvoiceId: invoiceId, note: 'invoice marked uncollectible', source: 'webhook' }, tx);
    return firebaseUidOf(subscriptionId, tx);
  });
  if (uid) await refreshLifecycleState(uid).catch(err => console.error('[subscriptionService] lifecycle refresh failed', subscriptionId, err));
}

async function firebaseUidOf(subscriptionId: string, runner: Runner): Promise<string | null> {
  return (await runner.query<{ firebase_uid: string }>(
    `SELECT up.firebase_uid FROM subscription s JOIN user_profile up ON up.id = s.user_id WHERE s.id = $1`, [subscriptionId]
  )).rows[0]?.firebase_uid ?? null;
}

/**
 * B4 step 1: a paid subscription past_due for more than
 * subscription_past_due_lapse_days since its unpaid cycle's date lapses: the
 * status, the event, Stripe's open invoice for that cycle voided (so Stripe's
 * retries can never charge a lapsed customer; Task 0 finding 5), and a
 * lifecycle refresh. Returns the subscriptions lapsed.
 */
export async function lapseIfOverdue(today: string = todayEastern()): Promise<string[]> {
  const days = await commerceParam('subscription_past_due_lapse_days');
  const due = (await db.query<{ id: string }>(
    `SELECT id FROM subscription
     WHERE kind = 'paid' AND status = 'past_due' AND next_delivery_date + $2::int < $1::date`,
    [today, days]
  )).rows;
  const lapsed: string[] = [];
  for (const { id } of due) {
    try {
      const invoiceIds = (await db.query<{ stripe_invoice_id: string }>(
        `SELECT DISTINCT stripe_invoice_id FROM subscription_event
         WHERE subscription_id = $1 AND event_kind = 'renewal_failed' AND stripe_invoice_id IS NOT NULL`, [id]
      )).rows.map(r => r.stripe_invoice_id);
      if (STRIPE_ENABLED) {
        for (const invoiceId of invoiceIds) {
          const inv = await stripe().invoices.retrieve(invoiceId);
          if (inv.status === 'open') await stripe().invoices.voidInvoice(invoiceId, {}, { idempotencyKey: `sub:${id}:void:${invoiceId}` });
        }
      }
      const uid = await withTransaction(async tx => {
        const r = await tx.query(`UPDATE subscription SET status = 'lapsed', updated_at = now() WHERE id = $1 AND status = 'past_due'`, [id]);
        if (!r.rowCount) return null;
        await recordSubscriptionEvent({ subscriptionId: id, kind: 'lapsed', note: `past due more than ${days} days`, source: 'cron' }, tx);
        return firebaseUidOf(id, tx);
      });
      if (uid) {
        lapsed.push(id);
        await refreshLifecycleState(uid).catch(err => console.error('[subscriptionService] lifecycle refresh failed', id, err));
      }
    } catch (err) {
      console.error(`[subscriptionService] lapseIfOverdue failed for subscription ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  return lapsed;
}

// ── reads (B6) ───────────────────────────────────────────────────────────────

export interface MySubscription {
  id: string;
  status: string;
  /** The customer's words for the status (subscription_status.customer_label). */
  statusLabel: string;
  countsAsSubscriber: boolean;
  frequencyWeeks: number | null;
  nextDeliveryDate: string | null;
  /** House names lined up for the next delivery (dial-aware, B2); the signup names when it cannot be resolved right now. */
  nextCoffees: Array<{ displayName: string; weightOz: number | null; quantity: number }>;
  /** True when at least one item follows the Bloom Dial. */
  followsDial: boolean;
  bagCount: number;
  discountPct: number;
  lastOrderId: string | null;
}

/** GET /api/subscriptions/mine: the signed-in customer's paid subscriptions, newest first, through v_subscription_status. */
export async function getSubscriptionsForCustomer(uid: string): Promise<MySubscription[]> {
  const rows = (await db.query<{
    subscription_id: string; status: string; customer_label: string | null; counts_as_subscriber: boolean | null;
    frequency_weeks: number | null; next_delivery_date: string | null; bag_count: string; last_order_id: string | null;
    signup_names: string[] | null;
  }>(
    `SELECT v.subscription_id, v.status, v.customer_label, v.counts_as_subscriber, v.frequency_weeks,
            v.next_delivery_date::text AS next_delivery_date, v.bag_count, v.last_order_id, v.signup_names
     FROM v_subscription_status v JOIN user_profile up ON up.id = v.user_id
     WHERE up.firebase_uid = $1 AND v.kind = 'paid'
     ORDER BY v.created_at DESC`, [uid]
  )).rows;

  const out: MySubscription[] = [];
  for (const r of rows) {
    const bagCount = Number(r.bag_count);
    let nextCoffees: MySubscription['nextCoffees'] = (r.signup_names ?? []).filter(Boolean).map(n => ({ displayName: n, weightOz: null, quantity: 1 }));
    let followsDial = false;
    if (r.counts_as_subscriber) {
      const shipment = await resolveSubscriptionShipment(r.subscription_id).catch(() => null);
      if (shipment?.status === 'resolved') {
        nextCoffees = shipment.lines.map(l => ({ displayName: l.displayName, weightOz: l.weightOz, quantity: l.quantity }));
        followsDial = shipment.lines.some(l => l.archetype !== null);
      }
    }
    out.push({
      id: r.subscription_id, status: r.status, statusLabel: r.customer_label ?? r.status, countsAsSubscriber: Boolean(r.counts_as_subscriber),
      frequencyWeeks: r.frequency_weeks, nextDeliveryDate: r.next_delivery_date, nextCoffees, followsDial,
      bagCount, discountPct: await subscriptionDiscountPct(bagCount), lastOrderId: r.last_order_id,
    });
  }
  return out;
}