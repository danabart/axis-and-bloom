# Commerce workstream — Stripe payments (one-time + subscriptions)

Decided 2026-10-29 (Dana + CTO session). Four briefs, run in order, each testable in Stripe test mode:

| # | Brief | Delivers |
|---|---|---|
| 1 | `CLAUDE_CODE_PROMPT_COMMERCE_1_CHECKOUT.md` (LIVE in test mode 2026-10-31, `CLOSING_REPORT_1.md`) | Stripe client, commerce parameters (admin-editable), `checkout_session`, webhook ledger, `finalizePaidOrder`, one-time checkout end to end, manual fulfillment (email per paid order), order confirmation email |
| 2 | `CLAUDE_CODE_PROMPT_COMMERCE_2_SUBSCRIPTIONS.md` (built in test mode 2026-10-31, `CLOSING_REPORT_2.md`) | Subscriptions core: card saved at the first checkout, our daily cron charges each cycle as a Stripe one-off invoice (automatic tax), pricing-table price minus 5%/10%, each paid invoice → order through brief 1's finalizer; subscribe choice in the cart; read-only Profile block (written 2026-10-31) |
| 3 | `CLAUDE_CODE_PROMPT_COMMERCE_3_ADMIN_AND_SELF_SERVICE.md` | `/admin/orders` (refund, mark shipped), Profile subscription panel (cancel, card, frequency, pause, skip), shipping email |
| 4 | `CLAUDE_CODE_PROMPT_COMMERCE_4_LIVE_CUTOVER.md` | Live keys, $1 purchase + refund, Shopify secrets dropped from the deploy |

Standing decisions (Dana, 2026-10-29):
- Prices come from the admin pricing tables (`coffee_slot_price`, `coffee_retail_price`). Stripe never holds a price.
- Every business number is a `commerce_parameter` row, editable in the admin portal: shipping fee ($5.95 start), free-shipping bag count (2), subscription discounts (5% one bag, 10% two or more bags per delivery), frequencies (2/4/6 weeks), tax switch, alert email.
- Shipping rule is the same for one-time orders and subscriptions.
- Tax: the LLC holds an NJ sales tax registration; Stripe Tax computes per charge (packaged coffee is exempt in NJ, so it returns $0 on coffee; other states as nexus is reached).
- Subscriptions do not use Stripe Billing plans: Stripe stores the card, our cron runs the schedule and charges the computed amount each cycle.
- Roasteries are fulfillment-only; the customer never sees a roaster name. ShipStation plugs into the fulfillment adapter in a separate thread.
- Test mode throughout briefs 1–3. Live keys only in brief 4, with Dana in the session.

`SUPERSEDED_CLAUDE_CODE_PROMPT_STRIPE_PAYMENT_CAPTURE.md` is the Aug 26 design, never run; kept for history.
