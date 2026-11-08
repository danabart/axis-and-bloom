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
import { commerceParam, commerceParamText } from './commerceParameters.js';
import { refreshLifecycleState } from './userLifecycle.js';
import { stripe, STRIPE_ENABLED, getOrCreateStripeCustomer } from './stripe.js';
import { resolveSubscriptionShipment, subscriptionDiscountPct } from './subscriptionShipment.js';
import { sendSelfServiceEmail, type SelfServiceEmailKind, type SelfServiceFacts } from './subscriptionEmails.js';

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
  | 'payment_method_updated' | 'invoice_voided'
  | 'item_added' | 'item_removed' | 'renewal_items_skipped'; // Family Household 3
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
  /** Family Household 3: who the bag is for (the buyer's own lines carry the buyer). */
  intended_for_user_id?: string | null;
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
  paid: { paymentMethodId: string | null; today?: string; householdId?: string | null }
): Promise<string> {
  const weeks = cs.subscription_intent?.frequencyWeeks;
  if (!weeks) throw new Error(`checkout_session ${cs.id} has no subscription intent`);
  const today = paid.today ?? todayEastern();
  // Family Household 3 (T2): a bag for another member stores no archetype; it follows that member.
  const forOther = (l: CheckoutLineRow) => Boolean(l.intended_for_user_id && l.intended_for_user_id !== cs.user_id);
  const archetype = lines.find(l => !forOther(l) && l.archetype && l.source !== 'direct')?.archetype ?? null;
  // Dana's decision 2: the subscription carries the household only when a bag is for someone else
  // (a house subscription); a member's own plan stays personal (D30, T12).
  const householdId = lines.some(forOther) ? (paid.householdId ?? null) : null;

  const s = await tx.query<{ id: string }>(
    `INSERT INTO subscription
       (user_id, kind, status, frequency_weeks, frequency_days, archetype, origin_checkout_session_id,
        stripe_payment_method_id, next_delivery_date, household_id)
     VALUES ($1, 'paid', 'active', $2::int, $2::int * 7, $3, $4, $5, $6::date + $2::int * 7, $7)
     RETURNING id`,
    [cs.user_id, weeks, archetype, cs.id, paid.paymentMethodId, today, householdId]
  );
  const subscriptionId = s.rows[0].id;

  for (const l of lines) {
    const other = forOther(l);
    const lineArchetype = l.source === 'direct' ? null : l.archetype;
    const slot = lineArchetype && l.dial_sort_order != null
      ? (await tx.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [lineArchetype, l.dial_sort_order])).rows[0]
      : undefined;
    await tx.query(
      `INSERT INTO subscription_item (subscription_id, archetype, signup_slot_id, signup_coffee_id, weight_oz, quantity, display_name_at_signup, intended_for_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [subscriptionId, other ? null : lineArchetype, slot?.id ?? null, l.coffee_id, l.weight_oz, l.quantity, l.display_name,
       other ? l.intended_for_user_id : null]
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
      await voidOpenRenewalInvoices(id);
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

// ── open renewal invoices (shared by lapse, cancel, card update) ─────────────

/**
 * Stripe's still-open renewal invoices for a subscription: the ones a
 * renewal_failed event names (a declined cycle stays open for Stripe's
 * retries), newest first.
 */
export async function openRenewalInvoices(subscriptionId: string, runner: Runner = db): Promise<Array<{ id: string; amountDue: number }>> {
  if (!STRIPE_ENABLED) return [];
  const ids = (await runner.query<{ stripe_invoice_id: string }>(
    `SELECT stripe_invoice_id FROM subscription_event
     WHERE subscription_id = $1 AND event_kind = 'renewal_failed' AND stripe_invoice_id IS NOT NULL
     GROUP BY stripe_invoice_id ORDER BY MAX(id) DESC`, [subscriptionId]
  )).rows.map(r => r.stripe_invoice_id);
  const open: Array<{ id: string; amountDue: number }> = [];
  for (const invoiceId of ids) {
    const inv = await stripe().invoices.retrieve(invoiceId);
    if (inv.status === 'open') open.push({ id: invoiceId, amountDue: inv.amount_due });
  }
  return open;
}

/** Void every open renewal invoice, so Stripe's retries can never charge an ended subscription (lapse, cancel). */
export async function voidOpenRenewalInvoices(subscriptionId: string): Promise<string[]> {
  const open = await openRenewalInvoices(subscriptionId);
  for (const inv of open) {
    await stripe().invoices.voidInvoice(inv.id, {}, { idempotencyKey: `sub:${subscriptionId}:void:${inv.id}` });
  }
  return open.map(i => i.id);
}

// ── self-service (Commerce 3, B1) ────────────────────────────────────────────
// The customer's buttons on Profile (source customer) and admin's cancel
// (source admin), one function each, every change an event. Ownership is the
// route's job; these take the subscription id. Each is idempotent: asking for
// what is already true changes nothing and returns changed: false. A request
// the subscription's state does not allow is a SelfServiceError (the route
// answers its status with the friendly message). Emails go after the commit,
// once per event (the event id is in the template key).

export class SelfServiceError extends Error {
  constructor(public status: 400 | 404 | 409 | 422, public code: string, message: string) { super(message); }
}

export interface SelfServiceResult { changed: boolean; eventId: number | null }

interface SelfRow {
  id: string; user_id: string; kind: string; status: SubscriptionStatus; frequency_weeks: number | null;
  next_delivery_date: string | null; paused_until: string | null; skip_next_until: string | null; stripe_payment_method_id: string | null;
}

async function lockPaid(tx: Runner, subscriptionId: string): Promise<SelfRow> {
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) throw new SelfServiceError(404, 'subscription_not_found', 'We could not find that subscription.');
  const row = (await tx.query<SelfRow>(
    `SELECT id, user_id, kind, status, frequency_weeks, next_delivery_date::text AS next_delivery_date,
            paused_until::text AS paused_until, skip_next_until::text AS skip_next_until, stripe_payment_method_id
     FROM subscription WHERE id = $1 FOR UPDATE`, [subscriptionId]
  )).rows[0];
  if (!row || row.kind !== 'paid') throw new SelfServiceError(404, 'subscription_not_found', 'We could not find that subscription.');
  return row;
}

const ENDED: SubscriptionStatus[] = ['canceled', 'lapsed'];
function requireOpen(row: SelfRow): void {
  if (ENDED.includes(row.status)) throw new SelfServiceError(409, 'subscription_ended', 'This subscription has ended. Start a new one from your cart any time.');
}

const addDays = async (runner: Runner, date: string, days: number) =>
  (await runner.query<{ d: string }>(`SELECT ($1::date + $2::int)::text AS d`, [date, days])).rows[0].d;

/** Run a self-service change, then (after the commit) its customer email and lifecycle refresh. */
async function selfService(
  subscriptionId: string,
  change: (tx: Tx, row: SelfRow) => Promise<SelfServiceResult & { emailKind?: SelfServiceEmailKind; refreshLifecycle?: boolean }>,
): Promise<SelfServiceResult> {
  const { result, uid } = await withTransaction(async tx => {
    const row = await lockPaid(tx, subscriptionId);
    const r = await change(tx, row);
    return { result: r, uid: r.refreshLifecycle ? await firebaseUidOf(subscriptionId, tx) : null };
  });
  if (result.changed && result.eventId !== null && result.emailKind) {
    const eventId = result.eventId, kind = result.emailKind;
    await selfServiceFacts(subscriptionId)
      .then(facts => sendSelfServiceEmail(kind, subscriptionId, eventId, facts))
      .catch(err => console.error('[subscriptionService] self-service email failed', subscriptionId, err instanceof Error ? err.message : err));
  }
  if (uid) await refreshLifecycleState(uid).catch(err => console.error('[subscriptionService] lifecycle refresh failed', subscriptionId, err));
  return { changed: result.changed, eventId: result.eventId };
}

/** What a self-service email states, read after the change committed. */
async function selfServiceFacts(subscriptionId: string): Promise<SelfServiceFacts> {
  const r = (await db.query<{ frequency_weeks: number | null; next_delivery_date: string | null; paused_until: string | null; skip_next_until: string | null; resumes_on: string | null }>(
    `SELECT frequency_weeks, next_delivery_date::text AS next_delivery_date, paused_until::text AS paused_until,
            skip_next_until::text AS skip_next_until, (paused_until + 1)::text AS resumes_on
     FROM subscription WHERE id = $1`, [subscriptionId]
  )).rows[0];
  return {
    frequencyWeeks: r?.frequency_weeks ?? null,
    nextDeliveryDate: r ? await effectiveNextDelivery(r) : null,
    skippedDate: r?.skip_next_until && r.next_delivery_date && r.skip_next_until >= r.next_delivery_date ? r.next_delivery_date : null,
    resumesOn: r?.resumes_on ?? null,
  };
}

/** Every N weeks from the next delivery on: the next date stays (decision 4), the spacing after it changes. */
export async function changeFrequency(subscriptionId: string, weeks: number, source: SubscriptionEventSource = 'customer'): Promise<SelfServiceResult> {
  const allowed = await allowedFrequencies();
  if (!Number.isInteger(weeks) || !allowed.includes(weeks)) {
    throw new SelfServiceError(400, 'invalid_frequency', `Choose every ${allowed.join(', ')} weeks.`);
  }
  return selfService(subscriptionId, async (tx, row) => {
    requireOpen(row);
    if (row.frequency_weeks === weeks) return { changed: false, eventId: null };
    await tx.query(`UPDATE subscription SET frequency_weeks = $2, frequency_days = $2 * 7, updated_at = now() WHERE id = $1`, [subscriptionId, weeks]);
    const eventId = await recordSubscriptionEvent({ subscriptionId, kind: 'frequency_changed', note: `every ${row.frequency_weeks} → ${weeks} weeks`, source }, tx);
    return { changed: true, eventId, emailKind: 'frequency_changed' };
  });
}

/**
 * Skip the next delivery: skip_next_until = next delivery + 1 day; the daily
 * job's coveredBy / skipCoveredCycle move the date on without charging. One
 * pending skip at a time (409).
 */
export async function skipNext(subscriptionId: string, source: SubscriptionEventSource = 'customer'): Promise<SelfServiceResult> {
  return selfService(subscriptionId, async (tx, row) => {
    requireOpen(row);
    if (row.status !== 'active') throw new SelfServiceError(409, 'skip_not_available', row.status === 'paused'
      ? 'Your subscription is paused, so nothing ships until it resumes.'
      : 'Update your card first; then you can skip a delivery.');
    if (!row.next_delivery_date) throw new SelfServiceError(409, 'skip_not_available', 'There is no delivery scheduled to skip yet.');
    if (row.skip_next_until && row.skip_next_until >= row.next_delivery_date) {
      throw new SelfServiceError(409, 'skip_pending', "Your next delivery is already skipped. We'll pick up again after it.");
    }
    const until = await addDays(tx, row.next_delivery_date, 1);
    await tx.query(`UPDATE subscription SET skip_next_until = $2::date, updated_at = now() WHERE id = $1`, [subscriptionId, until]);
    const eventId = await recordSubscriptionEvent({ subscriptionId, kind: 'skip_requested', note: `delivery ${row.next_delivery_date} skipped`, source }, tx);
    return { changed: true, eventId, emailKind: 'skipped' };
  });
}

/**
 * Pause until a resume date the customer picks (decision 3): after today and
 * at most subscription_pause_max_weeks ahead (422 otherwise). Deliveries
 * through the day before resumeOn are skipped; the daily job resumes it on
 * resumeOn (resumeDuePauses), or the customer does earlier. A paused
 * subscription can move its resume date; a past_due one updates its card first.
 */
export async function pause(subscriptionId: string, resumeOn: string, source: SubscriptionEventSource = 'customer', today: string = todayEastern()): Promise<SelfServiceResult> {
  const bounds = await pauseBounds(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resumeOn) || resumeOn < bounds.earliest || resumeOn > bounds.latest) {
    throw new SelfServiceError(422, 'invalid_resume_date', `Pick a resume date between ${bounds.earliest} and ${bounds.latest}.`);
  }
  return selfService(subscriptionId, async (tx, row) => {
    requireOpen(row);
    if (row.status === 'past_due') throw new SelfServiceError(409, 'pause_not_available', 'Update your card first; then you can pause.');
    const pausedUntil = await addDays(tx, resumeOn, -1);
    if (row.status === 'paused' && row.paused_until === pausedUntil) return { changed: false, eventId: null };
    await tx.query(`UPDATE subscription SET status = 'paused', paused_until = $2::date, updated_at = now() WHERE id = $1`, [subscriptionId, pausedUntil]);
    const eventId = await recordSubscriptionEvent({ subscriptionId, kind: 'paused', note: `resumes ${resumeOn}`, source }, tx);
    return { changed: true, eventId, emailKind: 'paused', refreshLifecycle: true };
  });
}

/**
 * Resume a paused subscription (any time; the daily job on the resume date).
 * Status active, the pause window cleared; a next delivery that fell before
 * tomorrow moves to tomorrow (the job runs once in the morning), a later one
 * stays.
 */
export async function resume(subscriptionId: string, source: SubscriptionEventSource = 'customer', today: string = todayEastern()): Promise<SelfServiceResult> {
  return selfService(subscriptionId, async (tx, row) => {
    requireOpen(row);
    if (row.status !== 'paused') return { changed: false, eventId: null };
    const tomorrow = await addDays(tx, today, 1);
    const next = !row.next_delivery_date || row.next_delivery_date < tomorrow ? tomorrow : row.next_delivery_date;
    await tx.query(
      `UPDATE subscription SET status = 'active', paused_until = NULL, next_delivery_date = $2::date, updated_at = now() WHERE id = $1`,
      [subscriptionId, next]
    );
    const eventId = await recordSubscriptionEvent({ subscriptionId, kind: 'resumed', note: `next delivery ${next}`, source }, tx);
    return { changed: true, eventId, emailKind: 'resumed', refreshLifecycle: true };
  });
}

/** Daily job step 0 (Dana, 2026-10-31): every pause whose resume date has come resumes through resume(), source cron. */
export async function resumeDuePauses(today: string = todayEastern()): Promise<string[]> {
  const due = (await db.query<{ id: string }>(
    `SELECT id FROM subscription WHERE kind = 'paid' AND status = 'paused' AND paused_until < $1::date ORDER BY paused_until, id`, [today]
  )).rows;
  const resumed: string[] = [];
  for (const { id } of due) {
    try {
      if ((await resume(id, 'cron', today)).changed) resumed.push(id);
    } catch (err) {
      console.error(`[subscriptionService] resumeDuePauses failed for subscription ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  return resumed;
}

/**
 * Cancel now (decision 2): no further charges. Any open renewal invoice is
 * voided first (Stripe's retries must never charge a canceled customer; if
 * the void fails, nothing is canceled and the error goes to the caller).
 * Status canceled, cancel_at today, the event, the lifecycle refresh (Liam
 * access ends with counts_as_subscriber). A paid bag already ordered still ships.
 */
export async function cancel(subscriptionId: string, source: SubscriptionEventSource = 'customer', today: string = todayEastern()): Promise<SelfServiceResult> {
  const pre = (await db.query<{ status: SubscriptionStatus; kind: string }>(`SELECT status, kind FROM subscription WHERE id = $1`,
    [/^[0-9a-f-]{36}$/i.test(subscriptionId) ? subscriptionId : '00000000-0000-0000-0000-000000000000'])).rows[0];
  if (pre && pre.kind === 'paid' && !ENDED.includes(pre.status)) await voidOpenRenewalInvoices(subscriptionId);
  return selfService(subscriptionId, async (tx, row) => {
    if (ENDED.includes(row.status)) return { changed: false, eventId: null };
    await tx.query(
      `UPDATE subscription SET status = 'canceled', cancel_at = $2::date, paused_until = NULL, skip_next_until = NULL, updated_at = now() WHERE id = $1`,
      [subscriptionId, today]
    );
    const eventId = await recordSubscriptionEvent({ subscriptionId, kind: 'canceled', note: `was ${row.status}`, source }, tx);
    return { changed: true, eventId, emailKind: 'canceled', refreshLifecycle: true };
  });
}

/**
 * A new card from the setup-mode Checkout (decision 5): the Stripe customer's
 * default payment method and the subscription's, the event, the email. If
 * the subscription is past_due, its open renewal invoice is paid once, now,
 * with the new card named (the invoice was created with the old one as its
 * default; Task 0 finding 7). A success arrives as invoice.paid and goes the
 * normal way (order, back to active); a decline arrives as
 * invoice.payment_failed. The same card again changes nothing.
 */
export async function attachPaymentMethod(
  subscriptionId: string, paymentMethodId: string, source: SubscriptionEventSource = 'customer'
): Promise<SelfServiceResult & { recovery: 'none' | 'paid' | 'declined' | 'pending' }> {
  if (!/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)) throw new SelfServiceError(400, 'invalid_payment_method', 'That card could not be read.');
  const r = await selfService(subscriptionId, async (tx, row) => {
    requireOpen(row);
    if (row.stripe_payment_method_id === paymentMethodId) return { changed: false, eventId: null };
    await tx.query(`UPDATE subscription SET stripe_payment_method_id = $2, updated_at = now() WHERE id = $1`, [subscriptionId, paymentMethodId]);
    const eventId = await recordSubscriptionEvent({ subscriptionId, kind: 'payment_method_updated', note: paymentMethodId, source }, tx);
    return { changed: true, eventId, emailKind: 'card_updated' };
  });
  if (!STRIPE_ENABLED) return { ...r, recovery: 'none' };

  const sub = (await db.query<{ user_id: string; status: SubscriptionStatus }>(`SELECT user_id, status FROM subscription WHERE id = $1`, [subscriptionId])).rows[0];
  const customer = await getOrCreateStripeCustomer(sub.user_id, null);
  await stripe().customers.update(customer, { invoice_settings: { default_payment_method: paymentMethodId } });
  if (sub.status !== 'past_due') return { ...r, recovery: 'none' };

  const [open] = await openRenewalInvoices(subscriptionId);
  if (!open) return { ...r, recovery: 'none' };
  try {
    const paid = await stripe().invoices.pay(open.id, { payment_method: paymentMethodId, off_session: true },
      { idempotencyKey: `sub:${subscriptionId}:recover:${open.id}:${paymentMethodId}` });
    return { ...r, recovery: paid.status === 'paid' ? 'paid' : 'pending' };
  } catch (err) {
    const t = (err as { type?: string }).type;
    if (t === 'StripeCardError') return { ...r, recovery: 'declined' };
    throw err;
  }
}

/**
 * B2: a Stripe Checkout Session in setup mode (decision 5), the same embedded
 * component /checkout uses (ui_mode embedded_page, as Commerce 1). Nothing is
 * written here: checkout.session.completed (mode setup) carries
 * metadata.subscription_id to attachPaymentMethod.
 */
export async function createPaymentMethodSession(subscriptionId: string, email: string | null): Promise<{ clientSecret: string }> {
  if (!STRIPE_ENABLED) throw new SelfServiceError(409, 'card_update_unavailable', 'Card updates are not available right now.');
  const sub = (await db.query<{ user_id: string; status: SubscriptionStatus }>(`SELECT user_id, status FROM subscription WHERE id = $1`, [subscriptionId])).rows[0];
  if (!sub) throw new SelfServiceError(404, 'subscription_not_found', 'We could not find that subscription.');
  if (ENDED.includes(sub.status)) throw new SelfServiceError(409, 'subscription_ended', 'This subscription has ended. Start a new one from your cart any time.');
  const customer = await getOrCreateStripeCustomer(sub.user_id, email);
  const frontend = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  const session = await stripe().checkout.sessions.create({
    ui_mode: 'embedded_page',
    mode: 'setup',
    currency: 'usd',
    customer,
    metadata: { subscription_id: subscriptionId },
    setup_intent_data: { metadata: { subscription_id: subscriptionId } },
    return_url: `${frontend}/profile?tab=orders&card=updated&session_id={CHECKOUT_SESSION_ID}`,
  });
  if (!session.client_secret) throw new Error('Stripe returned no client_secret for the setup session');
  return { clientSecret: session.client_secret };
}

/** Ownership for the customer routes: is this subscription the signed-in customer's? */
export async function subscriptionOwnedBy(uid: string, subscriptionId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) return false;
  return (await db.query(
    `SELECT 1 FROM subscription s JOIN user_profile up ON up.id = s.user_id WHERE s.id = $1 AND up.firebase_uid = $2`, [subscriptionId, uid]
  )).rows.length > 0;
}

// ── reads for the panel ──────────────────────────────────────────────────────

/** The frequencies on offer (commerce_parameter subscription_frequency_weeks). */
export async function allowedFrequencies(): Promise<number[]> {
  return (await commerceParamText('subscription_frequency_weeks')).split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
}

/** The resume dates a pause may pick: tomorrow through subscription_pause_max_weeks from today. */
export async function pauseBounds(today: string = todayEastern()): Promise<{ earliest: string; latest: string; maxWeeks: number }> {
  const maxWeeks = await commerceParam('subscription_pause_max_weeks');
  const r = (await db.query<{ earliest: string; latest: string }>(
    `SELECT ($1::date + 1)::text AS earliest, ($1::date + $2::int * 7)::text AS latest`, [today, maxWeeks]
  )).rows[0];
  return { ...r, maxWeeks };
}

/**
 * The delivery that will actually ship next: next_delivery_date, stepped by
 * the frequency past a pending skip or pause window (finding 8; the stored
 * date moves only when the daily job reaches it). NULL with no date.
 */
export async function effectiveNextDelivery(
  row: { next_delivery_date: string | null; frequency_weeks: number | null; paused_until: string | null; skip_next_until: string | null },
  runner: Runner = db,
): Promise<string | null> {
  if (!row.next_delivery_date || !row.frequency_weeks) return row.next_delivery_date;
  const r = await runner.query<{ d: string | null }>(
    `SELECT MIN(d)::date::text AS d
     FROM generate_series($1::date, $1::date + 520 * 7, make_interval(days => $2::int * 7)) AS d
     WHERE ($3::date IS NULL OR d::date > $3::date) AND ($4::date IS NULL OR d::date > $4::date)`,
    [row.next_delivery_date, row.frequency_weeks, row.paused_until, row.skip_next_until]
  );
  return r.rows[0]?.d ?? row.next_delivery_date;
}

// ── reads (B6) ───────────────────────────────────────────────────────────────

export interface MySubscription {
  id: string;
  status: string;
  /** The customer's words for the status (subscription_status.customer_label). */
  statusLabel: string;
  countsAsSubscriber: boolean;
  frequencyWeeks: number | null;
  /** The delivery that will actually ship next (past a pending skip or pause; Commerce 3). */
  nextDeliveryDate: string | null;
  /** Commerce 3: the scheduled date a pending skip passes over; null when no skip is pending. */
  skippedDate: string | null;
  /** Commerce 3: the day a pause ends (paused_until + 1); null when not paused. */
  resumesOn: string | null;
  canceledAt: string | null;
  hasPaymentMethod: boolean;
  /** Commerce 3: which buttons apply in this state, decided here so the UI types no rule. */
  actions: { frequency: boolean; skip: boolean; pause: boolean; resume: boolean; cancel: boolean; updateCard: boolean };
  /** House names lined up for the next delivery (dial-aware, B2); the signup names when it cannot be resolved right now. */
  nextCoffees: Array<{ displayName: string; weightOz: number | null; quantity: number }>;
  /** True when at least one item follows the Bloom Dial. */
  followsDial: boolean;
  /** Family Household 3: the live items and whom each is for (null drinker = the subscriber). */
  items: Array<{ itemId: string; name: string | null; weightOz: number; quantity: number; drinkerFirstName: string | null; forMember: boolean }>;
  /** Family Household 3: the next delivery's lines with their drinker (resolved), and the bags sitting this one out. */
  nextFor: Array<{ displayName: string; drinkerFirstName: string | null }>;
  skipped: string[];
  bagCount: number;
  discountPct: number;
  lastOrderId: string | null;
}

/** GET /api/subscriptions/mine: the signed-in customer's paid subscriptions, newest first, through v_subscription_status. */
export async function getSubscriptionsForCustomer(uid: string): Promise<MySubscription[]> {
  const rows = (await db.query<{
    subscription_id: string; status: string; customer_label: string | null; counts_as_subscriber: boolean | null;
    frequency_weeks: number | null; next_delivery_date: string | null; bag_count: string; last_order_id: string | null;
    signup_names: string[] | null; paused_until: string | null; skip_next_until: string | null; canceled_at: string | null;
    has_payment_method: boolean;
  }>(
    `SELECT v.subscription_id, v.status, v.customer_label, v.counts_as_subscriber, v.frequency_weeks,
            v.next_delivery_date::text AS next_delivery_date, v.bag_count, v.last_order_id, v.signup_names,
            v.paused_until::text AS paused_until, v.skip_next_until::text AS skip_next_until, v.canceled_at, v.has_payment_method
     FROM v_subscription_status v JOIN user_profile up ON up.id = v.user_id
     WHERE up.firebase_uid = $1 AND v.kind = 'paid'
     ORDER BY v.created_at DESC`, [uid]
  )).rows;

  const out: MySubscription[] = [];
  for (const r of rows) {
    const bagCount = Number(r.bag_count);
    let nextCoffees: MySubscription['nextCoffees'] = (r.signup_names ?? []).filter(Boolean).map(n => ({ displayName: n, weightOz: null, quantity: 1 }));
    let followsDial = false;
    const items = (await db.query<{ item_id: string; signup_name: string | null; weight_oz: string; quantity: number; drinker_first_name: string | null; intended_for_user_id: string | null }>(
      `SELECT item_id, signup_name, weight_oz, quantity, drinker_first_name, intended_for_user_id
       FROM v_subscription_item WHERE subscription_id = $1 AND ended_at IS NULL ORDER BY created_at, item_id`, [r.subscription_id]
    )).rows;
    const drinkerOf = new Map(items.map(i => [i.item_id, i.intended_for_user_id ? i.drinker_first_name : null]));
    let nextFor: MySubscription['nextFor'] = [];
    let skipped: string[] = [];
    if (r.counts_as_subscriber) {
      const shipment = await resolveSubscriptionShipment(r.subscription_id).catch(() => null);
      if (shipment?.status === 'resolved') {
        nextCoffees = shipment.lines.map(l => ({ displayName: l.displayName, weightOz: l.weightOz, quantity: l.quantity }));
        followsDial = shipment.lines.some(l => l.archetype !== null);
        nextFor = shipment.lines.map(l => ({ displayName: l.displayName, drinkerFirstName: drinkerOf.get(l.itemId) ?? null }));
        skipped = shipment.skipped.map(u => u.reason);
      }
    }
    const ended = r.status === 'canceled' || r.status === 'lapsed';
    const skipPending = Boolean(r.skip_next_until && r.next_delivery_date && r.skip_next_until >= r.next_delivery_date);
    out.push({
      id: r.subscription_id, status: r.status, statusLabel: r.customer_label ?? r.status, countsAsSubscriber: Boolean(r.counts_as_subscriber),
      frequencyWeeks: r.frequency_weeks,
      nextDeliveryDate: ended ? null : await effectiveNextDelivery(r),
      skippedDate: skipPending ? r.next_delivery_date : null,
      resumesOn: r.status === 'paused' && r.paused_until ? (await db.query<{ d: string }>(`SELECT ($1::date + 1)::text AS d`, [r.paused_until])).rows[0].d : null,
      canceledAt: r.canceled_at, hasPaymentMethod: Boolean(r.has_payment_method),
      actions: {
        frequency: !ended, skip: r.status === 'active' && !skipPending && Boolean(r.next_delivery_date),
        pause: r.status === 'active' || r.status === 'paused', resume: r.status === 'paused', cancel: !ended, updateCard: !ended,
      },
      nextCoffees, followsDial,
      items: items.map(i => ({
        itemId: i.item_id, name: i.signup_name, weightOz: Number(i.weight_oz), quantity: i.quantity,
        drinkerFirstName: i.intended_for_user_id ? i.drinker_first_name : null, forMember: Boolean(i.intended_for_user_id),
      })),
      nextFor, skipped,
      bagCount, discountPct: await subscriptionDiscountPct(bagCount), lastOrderId: r.last_order_id,
    });
  }
  return out;
}

// ── Family Household 3 (2026-11-07, D12, T11): house subscription items ─────
// The admin of the house (or the subscriber) adds a bag for an in-box member
// or drops one. An item is never deleted: a drop sets ended_at (G2.11). Every
// change is a subscription_event; it applies from the next renewal (no
// proration); the tier follows the bag count at renewal as today.

/** Who may add or drop items: the subscriber, or an administrator of the household the subscription serves. */
export async function subscriptionItemsEditableBy(uid: string, subscriptionId: string): Promise<{ actorId: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) return null;
  const r = await db.query<{ actor_id: string }>(
    `SELECT up.id AS actor_id
     FROM subscription s
     JOIN user_profile up ON up.firebase_uid = $2
     WHERE s.id = $1 AND s.kind = 'paid'
       AND (s.user_id = up.id
            OR EXISTS (SELECT 1 FROM v_household_membership vm
                        WHERE vm.user_id = up.id AND vm.status_code = 'active' AND vm.can_administer
                          AND vm.household_id = COALESCE(s.household_id,
                                (SELECT sm.household_id FROM v_household_membership sm WHERE sm.user_id = s.user_id AND sm.status_code = 'active'))))`,
    [subscriptionId, uid]
  );
  return r.rows[0] ? { actorId: r.rows[0].actor_id } : null;
}

export interface AddItemInput { intendedForUserId: string; weightOz: number; quantity: number }

export async function addItem(subscriptionId: string, input: AddItemInput, source: SubscriptionEventSource = 'customer'): Promise<{ itemId: string; eventId: number | null }> {
  return withTransaction(async tx => {
    const row = await lockPaid(tx, subscriptionId);
    requireOpen(row);
    if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new SelfServiceError(400, 'invalid_quantity', 'Choose how many bags.');
    const sized = await tx.query(`SELECT 1 FROM coffee_slot_price WHERE weight_oz = $1 LIMIT 1`, [input.weightOz]);
    if (!sized.rows.length) throw new SelfServiceError(400, 'invalid_weight', 'Choose one of the bag sizes on offer.');
    if (input.intendedForUserId === row.user_id) {
      throw new SelfServiceError(400, 'for_subscriber', 'This adds a bag for a household member; change your own bags from your cart.');
    }
    const h = await tx.query<{ household_id: string; first_name: string | null }>(
      `SELECT r.household_id, r.first_name FROM v_household_membership r
       JOIN v_household_membership sub ON sub.household_id = r.household_id AND sub.user_id = $2 AND sub.status_code = 'active'
       WHERE r.user_id = $1 AND r.status_code = 'active' AND r.in_house_box`, [input.intendedForUserId, row.user_id]
    );
    const target = h.rows[0];
    if (!target) throw new SelfServiceError(400, 'not_in_house_box', 'Bags go to members in the household box.');
    const item = await tx.query<{ id: string }>(
      `INSERT INTO subscription_item (subscription_id, archetype, signup_slot_id, signup_coffee_id, weight_oz, quantity, display_name_at_signup, intended_for_user_id)
       VALUES ($1, NULL, NULL, NULL, $2, $3, NULL, $4) RETURNING id`,
      [subscriptionId, input.weightOz, input.quantity, input.intendedForUserId]
    );
    // Decision 2: a bag for someone else makes it a house subscription.
    await tx.query(`UPDATE subscription SET household_id = $2, updated_at = now() WHERE id = $1 AND household_id IS NULL`, [subscriptionId, target.household_id]);
    const eventId = await recordSubscriptionEvent({
      subscriptionId, kind: 'item_added', source,
      note: `item ${item.rows[0].id} for ${target.first_name ?? input.intendedForUserId}: ${input.quantity} x ${input.weightOz} oz, from the next renewal`,
    }, tx);
    return { itemId: item.rows[0].id, eventId };
  });
}

export async function removeItem(subscriptionId: string, itemId: string, source: SubscriptionEventSource = 'customer'): Promise<{ changed: boolean; eventId: number | null }> {
  return withTransaction(async tx => {
    const row = await lockPaid(tx, subscriptionId);
    requireOpen(row);
    const item = (await tx.query<{ id: string; ended_at: string | null; drinker_first_name: string | null }>(
      `SELECT item_id AS id, ended_at, drinker_first_name FROM v_subscription_item WHERE item_id = $1 AND subscription_id = $2`, [itemId, subscriptionId]
    )).rows[0];
    if (!item) throw new SelfServiceError(404, 'item_not_found', 'We could not find that bag.');
    if (item.ended_at) return { changed: false, eventId: null };
    const live = (await tx.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM subscription_item WHERE subscription_id = $1 AND ended_at IS NULL`, [subscriptionId]
    )).rows[0].n;
    if (live <= 1) throw new SelfServiceError(409, 'last_item', 'This is the last bag; cancel the subscription instead.');
    await tx.query(`UPDATE subscription_item SET ended_at = now() WHERE id = $1`, [itemId]);
    // Decision 2: no bag left for anyone else → a personal subscription again.
    await tx.query(
      `UPDATE subscription SET household_id = NULL, updated_at = now()
       WHERE id = $1 AND household_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM subscription_item i WHERE i.subscription_id = $1 AND i.ended_at IS NULL
                            AND i.intended_for_user_id IS NOT NULL AND i.intended_for_user_id <> subscription.user_id)`, [subscriptionId]
    );
    const eventId = await recordSubscriptionEvent({
      subscriptionId, kind: 'item_removed', source, note: `item ${itemId} (${item.drinker_first_name ?? 'subscriber'}) ended from the next renewal`,
    }, tx);
    return { changed: true, eventId };
  });
}
