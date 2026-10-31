// Commerce 1, B7 (2026-10-31) — every post-order side effect, fired on payment
// confirmed (the Stripe webhook), never on a checkout attempt. Moved out of
// routes/orders.ts POST (lines 239–344 at f58162c), comments kept; nothing
// dropped (Task 0, CLOSING_REPORT_1.md).
//
// Idempotent: the order's `finalized` order_event (Dana's decision A, at most
// one per order by unique index) is checked and written inside one
// transaction, under an advisory lock on the order, before any other step
// runs; a second call finds it and returns. Liam's order-placed line is that
// event's note. After that, each step is guarded so one failure never blocks
// the next, and each failure is logged with the order id. A paid order is
// never lost: payment_status stays paid whatever a step does.
import { withTransaction } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';
import { grantTokens } from './tokenService.js';
import { updateOrderOutcomes } from './outcomeTracker.js';
import { refreshLifecycleState } from './userLifecycle.js';
import { dispatchOrderPlacedBeat, dispatchDelayedBeats } from './beatEngine.js';
import { getBrewProfile } from '../routes/sommelier.js';
import { getOrderSummary, isFinalized, recordOrderEvent } from './checkoutService.js';
import { dispatchFulfillment } from './fulfillment/index.js';
import { sendOrderConfirmationEmail } from './orderEmails.js';

export interface FinalizeResult {
  orderId: string;
  alreadyFinalized: boolean;
  orderPlacedLine: string | null;
  failedSteps: string[];
}

export async function finalizePaidOrder(orderId: string): Promise<FinalizeResult> {
  const claimed = await withTransaction(async tx => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`finalize:${orderId}`]);
    if (await isFinalized(orderId, tx)) return null;
    const order = await getOrderSummary(orderId, tx);
    if (!order) throw new Error(`finalizePaidOrder: order ${orderId} not found`);

    // HOME_TASK_8 (§3.1) — the order-placed beat. Primary coffee only (the
    // first line), same "first item is the primary coffee" precedent Task 6's
    // own arrival-card hook and the legacy SMS hook both already used. It
    // used to run before the order response; now the confirmation page reads
    // it from this event's note (v_order_status.order_placed_line).
    const primaryCoffeeId = order.lines[0]?.coffeeId ?? null;
    let orderPlacedLine: string | null = null;
    if (primaryCoffeeId) {
      orderPlacedLine = await dispatchOrderPlacedBeat(order.userId, orderId, primaryCoffeeId).catch(err => {
        console.error('[beatEngine] order_placed dispatch failed:', orderId, err);
        return null;
      });
    }
    await recordOrderEvent({ orderId, kind: 'finalized', note: orderPlacedLine, source: 'finalizer' }, tx);
    return { order, primaryCoffeeId, orderPlacedLine };
  });
  if (!claimed) return { orderId, alreadyFinalized: true, orderPlacedLine: null, failedSteps: [] };

  const { order, primaryCoffeeId, orderPlacedLine } = claimed;
  const uid = order.firebaseUid;
  const failedSteps: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn(); }
    catch (err) {
      failedSteps.push(name);
      console.error(`[orderFinalizer] ${name} failed for order ${orderId}:`, err instanceof Error ? err.message : err);
    }
  };

  // Order bonus tokens (+ the Firestore users/{uid}.tokenBalance sync, which
  // grantTokens does) — was inline SQL on user_tokens/token_events in orders.ts.
  await step('order_bonus_tokens', async () => {
    const orderBonus = getSommelierConfig()?.tokenEconomy?.orderBonus ?? 10;
    await grantTokens(uid, orderBonus, 'order_bonus', String(orderId));
  });

  // Update sommelier outcome: orderedWithin7Days / orderedWithin30Days
  await step('order_outcomes', () => updateOrderOutcomes(uid, new Date(order.paidAt ?? order.createdAt)));

  // HOME_TASK_8 (§3.1) — the beat engine's dial_in/arrival_note beats
  // (superseding the legacy schedulePostDeliveryMessage SMS; see WHAT_WE_BUILT
  // and beatEngine.ts). dispatchDelayedBeats also owns what Task 6's
  // arrival-card hook used to call directly (createArrivalCard).
  if (primaryCoffeeId) {
    await step('delayed_beats', async () => {
      const brewProfile = await getBrewProfile(uid);
      await dispatchDelayedBeats({ userId: order.userId, orderId, coffeeId: primaryCoffeeId, brewProfile });
    });
  }

  // Recompute lifecycle stage now that an order exists.
  await step('lifecycle', () => refreshLifecycleState(uid));

  // Fulfillment (manual adapter: an email per paid order) and the customer's
  // confirmation email.
  await step('fulfillment', () => dispatchFulfillment(orderId));
  await step('confirmation_email', () => sendOrderConfirmationEmail(orderId));

  return { orderId, alreadyFinalized: false, orderPlacedLine, failedSteps };
}
