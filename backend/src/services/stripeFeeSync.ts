// Commerce 5, Part B (2026-11-18): record Stripe's fee on every order that has
// none yet. At checkout.session.completed the charge usually has no balance
// transaction attached (Stripe attaches it about a minute later; Task 0.4), so
// the at-insert "order".transaction_fee is NULL on most orders. The daily job
// (GET /api/cron/subscription-daily) runs this step: for each order of the
// running key's mode with no fee (v_order_reportable.transaction_fee_cents
// NULL), read the balance transaction (payment intent → latest charge, or
// invoice → payments → payment intent) and record it through
// checkoutService.recordFee: one fee_recorded order_event, "order" untouched
// (Dana, 2026-11-18, decision 3). Idempotent: a recorded order leaves the
// list, and recordFee is a no-op on a second insert. Orders of the other mode
// are skipped (their ids do not resolve under this key). An order whose
// balance transaction is not attached yet is skipped and retried next run.
import { db } from '../db/client.js';
import { stripe, STRIPE_ENABLED, stripeMode } from './stripe.js';
import { paymentDetails, recordFee } from './checkoutService.js';

export interface FeeSyncResult { mode: string; checked: number; recorded: number; pending: number; errors: number }

/** The payment intent an order's fee hangs off: its own, or its invoice's paid payment. */
async function paymentIntentFor(row: { pi: string | null; inv: string | null }): Promise<string | null> {
  if (row.pi) return row.pi;
  if (!row.inv) return null;
  const inv = await stripe().invoices.retrieve(row.inv, { expand: ['payments'] });
  const payment = inv.payments?.data.find(p => p.status === 'paid') ?? inv.payments?.data[0];
  const pi = payment?.payment?.payment_intent;
  return pi == null ? null : typeof pi === 'string' ? pi : pi.id;
}

export async function syncStripeFees(): Promise<FeeSyncResult> {
  const mode = stripeMode();
  const result: FeeSyncResult = { mode, checked: 0, recorded: 0, pending: 0, errors: 0 };
  if (!STRIPE_ENABLED || mode === 'disabled') return result;

  const rows = (await db.query<{ order_id: string; pi: string | null; inv: string | null }>(
    `SELECT r.order_id, o.stripe_payment_intent_id AS pi, o.stripe_invoice_id AS inv
     FROM v_order_reportable r JOIN "order" o ON o.id = r.order_id
     WHERE r.transaction_fee_cents IS NULL AND r.stripe_mode = $1
       AND (o.stripe_payment_intent_id IS NOT NULL OR o.stripe_invoice_id IS NOT NULL)
     ORDER BY r.paid_at, r.order_id`, [mode]
  )).rows;

  for (const row of rows) {
    result.checked++;
    try {
      const { feeCents, balanceTransactionId } = await paymentDetails(await paymentIntentFor(row));
      if (feeCents === null) { result.pending++; continue; }
      if (await recordFee({ orderId: row.order_id, feeCents, balanceTransactionId, source: 'cron' })) result.recorded++;
    } catch (err) {
      result.errors++;
      console.error(`[stripe-fee-sync] order ${row.order_id}:`, err instanceof Error ? err.message : err);
    }
  }
  return result;
}
