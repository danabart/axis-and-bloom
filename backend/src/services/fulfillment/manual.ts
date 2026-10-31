// Commerce 1, B8 (2026-10-31) — the manual fulfillment adapter: until a
// roaster adapter exists, every paid order is an email to admin_alert_email
// with the full order (house names AND the resolved roaster coffee + roaster,
// internal only), the ships-to address, the weights and the Stripe payment
// intent id. Dana places it with the roaster by hand.
import type { OrderSummary } from '../checkoutService.js';
import { sendAdminNewOrderEmail } from '../orderEmails.js';
import type { FulfillmentAdapter } from './index.js';

export const manualAdapter: FulfillmentAdapter = {
  name: 'manual',
  async placeOrder(order: OrderSummary) {
    const sent = await sendAdminNewOrderEmail(order);
    // skipped = already sent for this order (a replayed webhook): placed, not a failure.
    if (sent.status === 'failed') throw new Error('admin new-order email could not be sent');
    return { externalRef: sent.id ?? undefined, fulfillmentStatus: 'awaiting_manual' as const };
  },
};
