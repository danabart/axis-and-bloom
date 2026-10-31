// Commerce 2, B4 (2026-10-31) — the daily subscription job
// (GET /api/cron/subscription-daily). Idempotent, safe to run twice a day.
// Writes nothing itself: subscription rows and events go through
// subscriptionService, orders only ever come from the invoice.paid webhook
// (checkoutService.createSubscriptionOrder; the webhook is the truth, the
// cron only records the attempt).
//
//   1. lapse: past_due longer than subscription_past_due_lapse_days → lapsed,
//      the cycle's open invoice voided (subscriptionService.lapseIfOverdue).
//   2. upcoming notices: active subscriptions whose next delivery is
//      subscription_upcoming_notice_days away get the coffee lined up
//      (resolveSubscriptionShipment) by email, once per cycle.
//   3. charges: active subscriptions due today or earlier. A cycle the pause
//      or skip window covers moves on with an event, nothing charged. Else
//      the cycle's one attempt is claimed (recordChargeAttempt), the shipment
//      resolved (an unresolved item: nothing charged, event, admin email,
//      claim given back so tomorrow tries again), and a Stripe one-off invoice
//      created, finalized and paid off-session. A card decline: past_due and
//      the payment-trouble email (Stripe retries on the Dashboard schedule).
//      Any other error: the claim is given back.
//
// The invoice is created with auto_advance false and only switched on when we
// finalize it (Task 0 deviation, recorded in CLOSING_REPORT_2.md): a draft left
// behind by a crash between calls can then never finalize and charge by
// itself an hour later. Idempotency keys sub:<id>:cycle:<date>:<step>.
import Stripe from 'stripe';
import { db } from '../db/client.js';
import { commerceParam, commerceParamText } from './commerceParameters.js';
import { stripe, STRIPE_ENABLED, getOrCreateStripeCustomer } from './stripe.js';
import { resolveSubscriptionShipment, type ShipmentLine } from './subscriptionShipment.js';
import {
  todayEastern, lapseIfOverdue, coveredBy, skipCoveredCycle, recordChargeAttempt, releaseChargeAttempt,
  markRenewalFailed, recordSubscriptionEvent, type ChargeClaim,
} from './subscriptionService.js';
import { sendSubscriptionUpcomingEmail, sendPaymentTroubleEmail, sendAdminSubscriptionAttentionEmail } from './subscriptionEmails.js';
import type { RenewalLineMetadata } from './checkoutService.js';

export type ChargeOutcome = 'charged' | 'declined' | 'skipped_paused' | 'skipped_skip' | 'already_attempted' | 'unresolved' | 'error';

export interface DailyResult {
  today: string;
  lapsed: string[];
  upcomingSent: number;
  charges: Array<{ subscriptionId: string; outcome: ChargeOutcome; invoiceId?: string; detail?: string }>;
}

interface SubRow {
  id: string; user_id: string; frequency_weeks: number; next_delivery_date: string;
  paused_until: string | null; skip_next_until: string | null; stripe_payment_method_id: string | null;
}

const SUB_COLUMNS = `id, user_id, frequency_weeks, next_delivery_date::text AS next_delivery_date, paused_until::text AS paused_until,
  skip_next_until::text AS skip_next_until, stripe_payment_method_id`;

async function defaultShipTo(userId: string): Promise<{ street: string; city: string; state: string; postal_code: string; country: string } | null> {
  return (await db.query(
    `SELECT street, city, state, postal_code, country FROM address
     WHERE user_id = $1 AND address_type = 'shipping' ORDER BY is_default DESC, created_at LIMIT 1`, [userId]
  )).rows[0] ?? null;
}

const isCardError = (err: unknown) =>
  typeof err === 'object' && err !== null && ((err as { type?: string }).type === 'StripeCardError' || (err as { code?: string }).code === 'card_declined');

async function notPrepared(sub: SubRow, claim: ChargeClaim, reason: string): Promise<ChargeOutcome> {
  await recordSubscriptionEvent({ subscriptionId: sub.id, kind: 'renewal_failed', note: `not charged: ${reason}`, source: 'cron' });
  await sendAdminSubscriptionAttentionEmail(sub.id, claim.cycleDate, reason)
    .catch(err => console.error('[subscription-daily] admin email failed', sub.id, err));
  await releaseChargeAttempt(sub.id, claim);
  return 'unresolved';
}

/**
 * Create, finalize and pay this cycle's invoice. Throws Stripe's error on a
 * decline. `attempt.invoiceId` is set as soon as Stripe has the invoice, so
 * the caller can void it if a later step fails.
 *
 * Idempotency keys are per cycle AND per attempt (the claim's timestamp,
 * Part E finding): within one attempt a retried call returns the same
 * object; a later attempt for the same cycle (after a released claim, with a
 * shipment that may have changed because the customer turned the dial) gets
 * fresh keys instead of Stripe refusing a reused key with new parameters.
 */
async function invoiceCycle(sub: SubRow, claim: ChargeClaim, lines: ShipmentLine[], shippingCents: number, attempt: { invoiceId?: string }): Promise<Stripe.Invoice> {
  const cycleDate = claim.cycleDate;
  const key = (step: string) => `sub:${sub.id}:cycle:${cycleDate}:attempt:${claim.attemptAt}:${step}`;
  const taxEnabled = (await commerceParam('tax_collection_enabled')) === 1;
  const coffeeTaxCode = await commerceParamText('stripe_tax_code_coffee');
  const shippingTaxCode = await commerceParamText('stripe_tax_code_shipping');
  const customer = await getOrCreateStripeCustomer(sub.user_id, null);

  // Stripe Tax taxes the customer's shipping address: make it the profile's
  // current default first, as checkout does (Task 0 finding 8).
  const shipTo = await defaultShipTo(sub.user_id);
  if (shipTo) {
    const name = (await db.query<{ n: string | null }>(
      `SELECT NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '') AS n FROM user_profile WHERE id = $1`, [sub.user_id]
    )).rows[0]?.n ?? 'Customer';
    await stripe().customers.update(customer, {
      shipping: { name, address: { line1: shipTo.street, city: shipTo.city, state: shipTo.state, postal_code: shipTo.postal_code, country: shipTo.country } },
    });
  }

  const s = stripe();
  let invoice = await s.invoices.create({
    customer,
    collection_method: 'charge_automatically',
    auto_advance: false,
    automatic_tax: { enabled: taxEnabled },
    ...(sub.stripe_payment_method_id ? { default_payment_method: sub.stripe_payment_method_id } : {}),
    pending_invoice_items_behavior: 'exclude',
    description: `Axis & Bloom · every ${sub.frequency_weeks} weeks`,
    metadata: { subscription_id: sub.id, cycle_date: cycleDate },
  }, { idempotencyKey: key('invoice') });
  attempt.invoiceId = invoice.id;

  for (const [i, l] of lines.entries()) {
    const metadata: RenewalLineMetadata = {
      kind: 'coffee', coffee_sku_id: l.coffeeSkuId, coffee_id: String(l.coffeeId), display_name: l.displayName,
      weight_oz: String(l.weightOz), unit_price_cents: String(l.unitPriceCents), discount_cents: String(l.discountCents),
    };
    await s.invoiceItems.create({
      customer, invoice: invoice.id, currency: 'usd',
      quantity: l.quantity,
      unit_amount_decimal: Stripe.Decimal.from(String(l.unitPriceCents)),
      description: `${l.displayName} · ${l.weightOz} oz · every ${sub.frequency_weeks} weeks`,
      tax_code: coffeeTaxCode, tax_behavior: 'exclusive',
      metadata: metadata as unknown as Stripe.MetadataParam,
    }, { idempotencyKey: key(`item:${i}`) });
  }
  if (shippingCents > 0) {
    await s.invoiceItems.create({
      customer, invoice: invoice.id, currency: 'usd',
      quantity: 1, unit_amount_decimal: Stripe.Decimal.from(String(shippingCents)),
      description: 'Shipping', tax_code: shippingTaxCode, tax_behavior: 'exclusive',
      metadata: { kind: 'shipping' },
    }, { idempotencyKey: key('shipping') });
  }

  invoice = await s.invoices.finalizeInvoice(invoice.id!, { auto_advance: true }, { idempotencyKey: key('finalize') });
  if (invoice.status === 'paid') return invoice;
  return s.invoices.pay(invoice.id!, { off_session: true }, { idempotencyKey: key('pay') });
}

/** One subscription's due cycle. Exported for tests. */
export async function chargeDueSubscription(sub: SubRow, today: string): Promise<{ outcome: ChargeOutcome; invoiceId?: string; detail?: string }> {
  const covered = coveredBy(sub.next_delivery_date, sub);
  if (covered) {
    const next = await skipCoveredCycle(sub.id, sub.next_delivery_date, covered);
    return { outcome: covered === 'paused' ? 'skipped_paused' : 'skipped_skip', detail: `next ${next}` };
  }

  const claim = await recordChargeAttempt(sub.id, today);
  if (!claim) return { outcome: 'already_attempted' };

  const shipment = await resolveSubscriptionShipment(sub.id);
  if (shipment.status === 'unresolved') {
    const reason = shipment.unresolved.map(u => u.reason).join('; ');
    return { outcome: await notPrepared(sub, claim, reason), detail: reason };
  }
  if (!(await defaultShipTo(sub.user_id))) {
    return { outcome: await notPrepared(sub, claim, 'the customer has no shipping address'), detail: 'no shipping address' };
  }
  if (!STRIPE_ENABLED) {
    await releaseChargeAttempt(sub.id, claim);
    return { outcome: 'error', detail: 'stripe not configured' };
  }

  const attempt: { invoiceId?: string } = {};
  try {
    const invoice = await invoiceCycle(sub, claim, shipment.lines, shipment.shippingCents, attempt);
    return { outcome: 'charged', invoiceId: invoice.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isCardError(err) && attempt.invoiceId) {
      // The invoice is finalized and stays open; Stripe retries it on the
      // Dashboard schedule. The claim stays, so the cron never opens a second one.
      const inv = await stripe().invoices.retrieve(attempt.invoiceId);
      const attemptCount = inv.attempt_count || 1;
      const recorded = await markRenewalFailed({
        subscriptionId: sub.id, invoiceId: inv.id!, attemptCount, amountCents: inv.amount_due, note: message, source: 'cron',
      });
      if (recorded) {
        await sendPaymentTroubleEmail(sub.id, inv.id!, attemptCount, inv.amount_due)
          .catch(e => console.error('[subscription-daily] payment trouble email failed', sub.id, e));
      }
      return { outcome: 'declined', invoiceId: inv.id, detail: message };
    }
    // Any other failure. Before the claim is given back (so the next run
    // retries with fresh keys), this attempt's invoice must not be able to
    // collect by itself: an open one is voided; a draft never finalizes on
    // its own (auto_advance false until finalize). If the void fails, the
    // claim is kept and admin alerted: a stuck cycle beats a double charge.
    if (attempt.invoiceId) {
      try {
        const inv = await stripe().invoices.retrieve(attempt.invoiceId);
        if (inv.status === 'paid') return { outcome: 'charged', invoiceId: inv.id, detail: `paid despite: ${message}` };
        if (inv.status === 'open') await stripe().invoices.voidInvoice(inv.id!);
      } catch (voidErr) {
        const reason = `charge attempt failed (${message}) and its invoice ${attempt.invoiceId} could not be voided (${voidErr instanceof Error ? voidErr.message : voidErr}); the cycle is held until checked`;
        await sendAdminSubscriptionAttentionEmail(sub.id, claim.cycleDate, reason)
          .catch(e => console.error('[subscription-daily] admin email failed', sub.id, e));
        throw new Error(reason);
      }
    }
    await releaseChargeAttempt(sub.id, claim);
    throw err;
  }
}

/** Upcoming-delivery emails for cycles noticeDays away (B4 step 2). */
async function sendUpcomingNotices(today: string): Promise<number> {
  const days = await commerceParam('subscription_upcoming_notice_days');
  const rows = (await db.query<SubRow>(
    `SELECT ${SUB_COLUMNS} FROM subscription
     WHERE kind = 'paid' AND status = 'active' AND next_delivery_date = $1::date + $2::int`, [today, days]
  )).rows;
  let sent = 0;
  for (const sub of rows) {
    try {
      if (coveredBy(sub.next_delivery_date, sub)) continue;
      const shipment = await resolveSubscriptionShipment(sub.id);
      if (shipment.status !== 'resolved') continue; // the charge step alerts admin on the day
      const r = await sendSubscriptionUpcomingEmail(sub.id, sub.next_delivery_date, shipment.lines);
      if (r.status === 'sent') sent++;
    } catch (err) {
      console.error(`[subscription-daily] upcoming notice failed for subscription ${sub.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

export async function runSubscriptionDaily(today: string = todayEastern()): Promise<DailyResult> {
  const lapsed = await lapseIfOverdue(today);
  const upcomingSent = await sendUpcomingNotices(today);

  const due = (await db.query<SubRow>(
    `SELECT ${SUB_COLUMNS} FROM subscription
     WHERE kind = 'paid' AND status = 'active' AND next_delivery_date <= $1::date
     ORDER BY next_delivery_date, id`, [today]
  )).rows;
  const charges: DailyResult['charges'] = [];
  for (const sub of due) {
    try {
      const r = await chargeDueSubscription(sub, today);
      charges.push({ subscriptionId: sub.id, ...r });
      console.log(`[cron/subscription-daily] subscription ${sub.id} cycle ${sub.next_delivery_date}: ${r.outcome}${r.invoiceId ? ` ${r.invoiceId}` : ''}${r.detail ? ` (${r.detail})` : ''}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      charges.push({ subscriptionId: sub.id, outcome: 'error', detail });
      console.error(`[cron/subscription-daily] subscription ${sub.id} failed:`, detail);
    }
  }
  return { today, lapsed, upcomingSent, charges };
}
