# Commerce workstream — Stripe payments (one-time + subscriptions)

**Status: LIVE since 2026-11-17** (Commerce 4: live Stripe account, rev `00869-6z8`, `[stripe] mode=live`; $1 gate passed 2026-11-18; `CLOSING_REPORT_4.md`). Briefs 1–3 were built and accepted in test mode. The pre-launch curtain is a separate step.

Decided 2026-10-29 (Dana + CTO session). Four briefs, run in order, each testable in Stripe test mode:

| # | Brief | Delivers |
|---|---|---|
| 1 | `CLAUDE_CODE_PROMPT_COMMERCE_1_CHECKOUT.md` (LIVE in test mode 2026-10-31, `CLOSING_REPORT_1.md`) | Stripe client, commerce parameters (admin-editable), `checkout_session`, webhook ledger, `finalizePaidOrder`, one-time checkout end to end, manual fulfillment (email per paid order), order confirmation email |
| 2 | `CLAUDE_CODE_PROMPT_COMMERCE_2_SUBSCRIPTIONS.md` (built in test mode 2026-10-31, `CLOSING_REPORT_2.md`) | Subscriptions core: card saved at the first checkout, our daily cron charges each cycle as a Stripe one-off invoice (automatic tax), pricing-table price minus 5%/10%, each paid invoice → order through brief 1's finalizer; subscribe choice in the cart; read-only Profile block (written 2026-10-31) |
| 3 | `CLAUDE_CODE_PROMPT_COMMERCE_3_ADMIN_AND_SELF_SERVICE.md` (LIVE in test mode 2026-11-04, `CLOSING_REPORT_3.md`) | `/admin/orders` + `/admin/subscriptions` (refund full/partial, retry, mark shipped + shipping email), Profile subscription panel (frequency, skip, pause/resume, cancel, update card via setup-mode Checkout), customer email on the admin alert |
| 5 | `CLAUDE_CODE_PROMPT_COMMERCE_5_REPORTING_AND_BOOKKEEPING.md` (written 2026-11-17) | Reporting view `v_order_reportable` (live, paid, refunds netted, business time zone), `stripe_mode` marker + backfill, fee sync, `business_time_zone` and `order_bonus_tokens` parameters, `updated_at` fix, G2.9 wording |
| 4 | `CLAUDE_CODE_PROMPT_COMMERCE_4_LIVE_CUTOVER.md` (DONE 2026-11-17, Stripe LIVE, `CLOSING_REPORT_4.md`) | Live Stripe account activation (Dana), live Dashboard settings redone, key swap via new Secret Manager versions, $1 purchase + refund gate, rollback runbook |

Standing decisions (Dana, 2026-10-29):
- Prices come from the admin pricing tables (`coffee_slot_price`, `coffee_retail_price`). Stripe never holds a price.
- Every business number is a `commerce_parameter` row, editable in the admin portal: shipping fee ($5.95 start), free-shipping bag count (2), subscription discounts (5% one bag, 10% two or more bags per delivery), frequencies (2/4/6 weeks), tax switch, alert email.
- Shipping rule is the same for one-time orders and subscriptions.
- Tax: the LLC holds an NJ sales tax registration; Stripe Tax computes per charge (packaged coffee is exempt in NJ, so it returns $0 on coffee; other states as nexus is reached).
  - **Off at launch** (Dana, 2026-10-31): `tax_collection_enabled` = 0, since it costs $0.50 per transaction and returns $0 today. Flip-on procedure in `launch/00_manual-setup/MANUAL_SETUP_IDS.md` → Stripe.
- Subscriptions do not use Stripe Billing plans: Stripe stores the card, our cron runs the schedule and charges the computed amount each cycle.
- Roasteries are fulfillment-only; the customer never sees a roaster name. ShipStation plugs into the fulfillment adapter in a separate thread.
- Test mode throughout briefs 1–3. Live keys only in brief 4, with Dana in the session.
- Tax: `tax_collection_enabled` = 0 at launch (2026-10-31): NJ exempts packaged coffee, no nexus elsewhere, Stripe Tax costs $0.50 per API call. Flip on when a second state nears its threshold (procedure in MANUAL_SETUP_IDS.md).
- Payment methods in the sandbox (2026-10-31): Cards, Apple Pay, Google Pay, Link only. Redo in the live account (brief 4).
- Fees on this account: Payments 2.9% + 30¢; Invoicing Starter 0.4% per paid one-time invoice; Tax Basic $0.50 per API transaction (off); Billing not used.

`SUPERSEDED_CLAUDE_CODE_PROMPT_STRIPE_PAYMENT_CAPTURE.md` is the Aug 26 design, never run; kept for history.
