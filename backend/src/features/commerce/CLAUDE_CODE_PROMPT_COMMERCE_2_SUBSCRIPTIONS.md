# Claude Code brief — Commerce 2: Subscriptions (core)

Workstream: commerce (`README.md` here) · Written 2026-10-31 by the CTO session after Commerce 1 went live in test mode (`CLOSING_REPORT_1.md`) · Touches money: strongest model, dedicated session · Dana runs it; push = production deploy · **Test mode only.** Customer self-service buttons (cancel, pause, skip, change frequency, update card) and the admin pages are **Commerce 3**, not here. Build the data and the renewal engine; the only customer-facing additions are the subscribe choice in the cart/checkout and a read-only summary in Profile.

**Goal.** A customer can turn their cart into a subscription: every 2, 4 or 6 weeks (frequencies from `commerce_parameter`), their coffee ships again, charged to the card saved at the first checkout, at the pricing-table price minus 5% (one bag per delivery) or 10% (two or more), with the same shipping rule as one-time orders and tax through Stripe Tax. Each charge becomes an ordinary paid order through Commerce 1's `completeCheckoutSession`-style insert and `finalizePaidOrder`, so emails, Liam's line, tokens, lifecycle and manual fulfillment all happen exactly as for a one-time order.

**Decisions (Dana, 2026-10-29/31), implement as stated:**
1. Pricing comes from the admin pricing tables each cycle; Stripe holds no price. Discounts, frequencies and shipping are `commerce_parameter` rows (already seeded by Commerce 1: `subscription_discount_pct_1_bag`, `subscription_discount_pct_2plus_bags`, `subscription_frequency_weeks`, `shipping_fee_cents`, `free_shipping_min_bags`).
2. Shipping on subscriptions = the one-time rule (free at `free_shipping_min_bags`, else `shipping_fee_cents`).
3. No Stripe Billing subscription objects. Stripe stores the card; our cron runs the schedule.
4. What ships each cycle: the customer's **current Bloom Dial position** for the subscription's archetype if they have one (`user_bloom_dial_current_position`), else the slot chosen at signup. Switch `subscription_ships_current_dial_position` (new parameter, 1) turns the first rule off, in which case the signup slot always ships. One function, `resolveSubscriptionShipment`, owns this rule.
5. Bag count per delivery is whatever the cart held at signup (lines × quantity); the discount tier is by total bags.

**CTO decision for this brief (reversible, flag in the writeup if the code disagrees): renewals are charged as Stripe one-off Invoices, not raw PaymentIntents.** An invoice with `automatic_tax` computes and records tax the same way Checkout does, charges the saved card off-session with `collection_method: 'charge_automatically'`, retries failed cards on the schedule set in the Dashboard, and reports through `invoice.paid` / `invoice.payment_failed`. The alternative (PaymentIntent + Tax Calculation API + Tax Transaction recording) is three calls and two more failure modes for the same result. Stripe's one-off invoice fee is small (0.4% capped at $2 per paid invoice); note the exact figure from the Dashboard pricing page in the writeup.

---

## Task 0 — Verify (write into `CLOSING_REPORT_2.md` before changing anything)

1. Commerce 1 as built: `services/checkoutService.ts` (`createCheckoutSession`, `completeCheckoutSession`, `recordOrderEvent`, `getOrderSummary`), `services/orderFinalizer.ts` (`finalizePaidOrder(orderId)`), `services/stripe.ts` (`stripe()`, `getOrCreateStripeCustomer`, `STRIPE_API_VERSION`), `routes/stripeWebhook.ts` (ledger, event switch), `services/commerceParameters.ts` (`commerceParam`, `commerceParamText`, `setParameterInTx`), `services/orderEmails.ts` (shared sender), `services/fulfillment/`. Reuse; do not fork.
2. `subscription` today: writers `companyGiftRedemption.POST …/redeem` (INSERT) and `cron.GET /sponsored-subscription-check` (UPDATE status → lapsed); readers `userSignals`, `liamAccess`, `users`, `catalogService`, `cron`, `refreshLifecycleState` (SUBSCRIBER from `status='active'`, SPONSORED_* from `company_gift_id` / `sponsored_expires_at`). List every reader with file:line; company-gift behaviour must be unchanged after this brief.
3. `customer_order_kind` already has `subscription_renewal`; `"order".is_subscription` exists and is never written; `order_line_item.order_kind` default `manual`.
4. `user_bloom_dial_current_position` is (user_id, archetype) → `slot_id`; `coffee_dial_slot` → archetype + sort_order; `resolveBlendForSlot(archetype, dialSortOrder, weightOz)` returns the sellable coffee and `retail_price_cents`. Confirm how `cartResolver` turns a slot into a line and reuse it for renewals.
5. Checkout Session in `createCheckoutSession`: `mode: 'payment'`, `customer`, `automatic_tax`, `customer_update.shipping`. Confirm nothing sets `setup_future_usage` yet.
6. Cron router pattern (`requireCronSecret`, `GET` routes, Cloud Scheduler jobs are created by hand and listed in `MANUAL_SETUP_IDS.md`).
7. Prod, read-only: `SELECT status, company_gift_id IS NOT NULL AS sponsored, COUNT(*) FROM subscription GROUP BY 1,2;`

## Task 0.5 — Dana's manual steps (write into `MANUAL_SETUP_IDS.md` → Stripe; pause until she confirms 1 and 2)

1. Sandbox webhook `axis-bloom-backend-test`: add events `invoice.paid`, `invoice.payment_failed`, `invoice.marked_uncollectible`, `invoice.voided`. (The CTO session can do this in her browser.)
2. Dashboard → Settings → Billing → Automatic collection (invoices): confirm the retry schedule for failed one-off invoices (Smart Retries or the default 3 attempts); note it in the writeup. Dashboard → Settings → Emails: Stripe's "failed payment" and "upcoming invoice" emails stay **off**; ours go through Resend.
3. Cloud Scheduler job (after deploy): `GET /api/cron/subscription-daily`, once a day, early morning US Eastern, `x-cron-secret` header as the other jobs. Write the exact `gcloud scheduler jobs create` line into `MANUAL_SETUP_IDS.md`.

---

## Part A — Schema (`schema.sql` additive, `comments.sql`, then `catalog:md`)

Why no existing object fits (repeat in the writeup): `subscription` exists and stays the current-state row, but it has no items, no billing link, no history and two writers; `order_event` is per order, not per subscription; `checkout_session` is the one-time cart snapshot, and a subscription's lines must outlive it. `user_payment_detail` is retired (Stripe holds the card).

**`subscription`** add: `kind TEXT NOT NULL DEFAULT 'sponsored' REFERENCES subscription_kind(code)` (new lookup, `id SERIAL PK`, `code UNIQUE`, `label`; seed `paid`, `sponsored`; backfill existing rows to `sponsored`), `frequency_weeks INT` (keep `frequency_days = weeks*7` in sync for existing readers), `archetype archetype_enum`, `origin_checkout_session_id UUID FK checkout_session`, `stripe_payment_method_id TEXT`, `paused_until DATE`, `skip_next_until DATE`, `cancel_at DATE`, `last_order_id UUID FK "order"`, `last_charge_attempt_at TIMESTAMPTZ`, `failed_attempts INT NOT NULL DEFAULT 0`. `status` vocabulary becomes a lookup `subscription_status` (`id`, `code UNIQUE`, `label`, `customer_label`; seed `pending`, `active`, `past_due`, `paused`, `canceled`, `lapsed`) with an FK; existing values `active`/`lapsed` already fit. `next_delivery_date` (exists) is the next charge-and-ship date; comment it so.

**`subscription_item`** (new) `id UUID PK`, `subscription_id FK`, `archetype archetype_enum NOT NULL`, `signup_slot_id INT FK coffee_dial_slot`, `signup_coffee_id INT FK coffees` (snapshot of what the customer saw), `weight_oz NUMERIC NOT NULL`, `quantity INT NOT NULL`, `display_name_at_signup TEXT`, `created_at`.

**`subscription_event`** (new, insert-only history, same shape as `order_event`): `id SERIAL PK`, `subscription_id FK`, `event_kind TEXT FK subscription_event_kind(code)` (lookup; seed `started`, `renewal_charged`, `renewal_failed`, `renewal_skipped_paused`, `renewal_skipped_skip`, `paused`, `resumed`, `skip_requested`, `frequency_changed`, `canceled`, `lapsed`, `payment_method_updated`), `order_id UUID FK "order"`, `stripe_invoice_id TEXT`, `amount_cents INT`, `note TEXT`, `source TEXT` (`checkout | cron | webhook | admin | customer`), `created_at`.

**`"order"`** add `subscription_id UUID FK subscription`, `stripe_invoice_id TEXT UNIQUE`; `is_subscription` starts being written (true for renewals **and** for the first subscription delivery). **`checkout_session`** add `subscription_intent JSONB` (frequency_weeks + the flag that this checkout starts a subscription; NULL for one-time) and `subscription_id UUID FK subscription` set on completion.

**`commerce_parameter`** seed (only if missing): `subscription_ships_current_dial_position` = 1 (Range: 0–1), `subscription_upcoming_notice_days` = 3 (Range: 0–14), `subscription_past_due_lapse_days` = 21 (Range: 7–60), `subscription_charge_hour_local` = 6 (Range: 0–23, informational: when the daily cron is scheduled).

Every new table and column gets a `COMMENT ON` line; `subscription`'s table comment changes Writer to `subscriptionService` (see B1). `v_subscription_status` (new view): one row per subscription with status label, next delivery date, the coffee lined up for the next delivery (via the same resolver, see B2, exposed as a SQL fallback: signup slot only; the dial-aware answer comes from code), item count, bag count, last order id. Readers of status for Profile and admin use it.

---

## Part B — Backend

**B1 `services/subscriptionService.ts`** — the **single writer** of `subscription`, `subscription_item`, `subscription_event`. Move the company-gift INSERT (`companyGiftRedemption.ts`) and the sponsored-lapse UPDATE (`cron.ts`) into functions here (`createSponsoredSubscription`, `lapseSponsoredSubscription`), behaviour identical, callers updated, `comments.sql` Writer field updated, `lint:lineage` green. New: `createPaidSubscriptionFromCheckout(checkoutSessionRow, stripeSession)`, `recordSubscriptionEvent`, `setStatus`, `scheduleNext(subscriptionId, fromDate)` (= from + frequency_weeks*7, skipping while `paused_until`/`skip_next_until` cover the date, each skip recorded as an event), `markRenewalCharged`, `markRenewalFailed` (failed_attempts++, status `past_due`), `lapseIfOverdue` (past_due longer than `subscription_past_due_lapse_days` → `lapsed`, event, `refreshLifecycleState`).

**B2 `services/subscriptionShipment.ts`** — `resolveSubscriptionShipment(subscriptionId)`: for each `subscription_item`: if `subscription_ships_current_dial_position` = 1 and the user has a `user_bloom_dial_current_position` row for the item's archetype → that slot; else `signup_slot_id`; resolve to a sellable coffee + price via the same path `cartResolver` uses for `source: 'dial'`; if the slot resolves to nothing sellable, fall back to the archetype's default slot (`is_default`), and if that fails too, return `unresolved` for that item (the cron then skips the charge, records `renewal_failed` with the reason and emails `admin_alert_email`; **never charge for a coffee we cannot name**). Returns lines in the `ResolvedLine` shape plus `bagCount`, `subtotalCents`, `discountPct`, `discountCents`, `shippingCents`.

**B3 Signup through Commerce 1's checkout.** `createCheckoutSession` accepts `subscription?: { frequencyWeeks }`. Validate `frequencyWeeks` ∈ `subscription_frequency_weeks`. Store `subscription_intent` on the `checkout_session` row. Line prices: apply the discount tier to each line's `unit_price_cents` (rounded per line, remainder on the first line, same technique as the collection discount) so Stripe's form shows the discounted prices; `product_data.description` adds "every N weeks". Add `payment_intent_data.setup_future_usage: 'off_session'` **only** for subscription checkouts, so Checkout saves the card and only offers reusable methods. `completeCheckoutSession`: after the order insert, if the session has `subscription_intent`, call `createPaidSubscriptionFromCheckout` in the same transaction: subscription row (`kind='paid'`, `status='active'`, `archetype` = the first line's archetype or NULL for direct items, `frequency_weeks`, `stripe_payment_method_id` from the PaymentIntent, `origin_checkout_session_id`, `last_order_id`, `next_delivery_date` = today + weeks×7), items from the lines, event `started`; set `"order".is_subscription = true`, `"order".subscription_id`; `order_line_item.order_kind = 'subscription_renewal'` is **not** used for the first delivery (keep `manual`), it is for renewals. Then `finalizePaidOrder` as today, plus `refreshLifecycleState` already in it picks up SUBSCRIBER.

**B4 Renewals — `routes/cron.ts` `GET /api/cron/subscription-daily`** (`requireCronSecret`, idempotent, safe to run twice a day). Steps, each guarded and logged with the subscription id:
1. `lapseIfOverdue` for all `past_due`.
2. Upcoming notices: subscriptions `active` with `next_delivery_date` = today + `subscription_upcoming_notice_days`: send `subscriptionUpcomingEmail` (the coffee lined up per B2, the date, "turn your Bloom Dial before then to change it"); dedupe on (email, template, subscription id + date) via the shared sender.
3. Charges: subscriptions `active` with `next_delivery_date <= today`, not covered by `paused_until`/`skip_next_until` (covered ones → `scheduleNext` + event, no charge): `resolveSubscriptionShipment`; create the Stripe invoice: `stripe.invoices.create({ customer, collection_method: 'charge_automatically', auto_advance: true, automatic_tax: { enabled }, default_payment_method: stripe_payment_method_id, metadata: { subscription_id, cycle_date }, pending_invoice_items_behavior: 'exclude' })`, then `invoiceItems.create` per line (`unit_amount_decimal`, `quantity`, `description` = house name + "every N weeks", `tax_code` coffee) and one for shipping when > 0 (`tax_code` shipping, `tax_behavior: 'exclusive'`), then `invoices.finalizeInvoice` and `invoices.pay` (off-session). Idempotency keys from `sub:<id>:cycle:<date>`. On a synchronous card failure: `markRenewalFailed`, email `paymentTroubleEmail` (Commerce 3 adds the update-card link; for now the email says to reply to us). On success the webhook does the rest (B5); the cron only records `last_charge_attempt_at`. **The cron never inserts orders**; the webhook is truth, same as Commerce 1.

**B5 Webhook additions** (`routes/stripeWebhook.ts`): `invoice.paid` with `metadata.subscription_id` → `checkoutService.createSubscriptionOrder(invoice)` (new function in checkoutService, it stays the one order writer): idempotent on `stripe_invoice_id` (`ON CONFLICT DO NOTHING` + re-select), inserts `"order"` (`is_subscription=true`, `subscription_id`, `stripe_invoice_id`, `stripe_payment_intent_id`, amounts from the invoice incl. `total_details`/`tax`, address snapshot = the profile's current default shipping address, `fulfillment_status='awaiting_manual'`) and `order_line_item` rows (`order_kind='subscription_renewal'`, `display_name`, `weight_oz`, discounted `unit_price_charged`, `discount_amount`), records `renewal_charged` + `markRenewalCharged` + `scheduleNext`, then `finalizePaidOrder`. `invoice.payment_failed` → `markRenewalFailed` + email (deduped per invoice attempt). `invoice.marked_uncollectible` → `lapsed` + event + lifecycle refresh. `invoice.voided` → event only. Invoices without our metadata → quiet no-op, same as unknown sessions.

**B6 Reads** — `GET /api/subscriptions/mine` (auth, ownership): status + customer label, frequency, next delivery date, the coffee lined up (B2, house name), bag count, discount, last order id. Used by Profile (C2) and later by Commerce 3's buttons.

---

## Part C — Frontend (small)

**C1 Cart → subscribe choice.** In the cart drawer (`FloatingCart`/`CartLines`), under the lines: "Make it a subscription" with the frequency choice (options from `GET /api/checkout/rules`, extended to return `subscriptionFrequencyWeeks` and the two discount percentages) and the resulting discounted subtotal ("every 4 weeks · 5% off"). `/checkout` shows the same line in the summary and passes `subscription: { frequencyWeeks }` to the session call. Positive register, no urgency copy. Nothing typed in: numbers and options come from the rules endpoint.
**C2 `/checkout/return`** for a subscription start: "Your first bag is on its way to being roasted. Next delivery <date>, every N weeks." **Profile → Orders tab**: a read-only "Your subscription" block from `/api/subscriptions/mine` (status label, next date, coffee lined up, "Change it on your Bloom Dial" link). No buttons yet (Commerce 3).

---

## Part D — Tests

`subscriptionShipment.test.ts` (dial row → that slot; no row → signup slot; switch=0 → signup slot; unsellable → default slot; nothing → `unresolved`); `subscriptionService.test.ts` (scheduleNext with pause/skip windows; lapse after N days; company-gift create/lapse unchanged); `checkoutService` additions (subscription start creates subscription + items + `started` in the same tx; `createSubscriptionOrder` idempotent on invoice id; first delivery `is_subscription=true`); cron (`subscription-daily` twice in a row charges once; unresolved shipment → no invoice, admin email); webhook (`invoice.paid` without metadata → no-op; with metadata → one order + finalize once; `payment_failed` → past_due + one email). Lints, typecheck, build.

## Part E — Acceptance (test mode, local backend on the test DB, as Commerce 1 did)

1. Subscribe from the cart (one bag, every 2 weeks) with 4242: one order (5% off, $5.95 shipping, tax line), subscription `active`, `next_delivery_date` = +14 days, Profile shows the block, return page shows the next date.
2. Two-bag subscription: 10% off and free shipping.
3. Renewal: set `next_delivery_date` to today in the test DB, call `subscription-daily` with the cron secret: one invoice in Stripe, `invoice.paid` → one renewal order with `order_kind='subscription_renewal'`, both emails, `next_delivery_date` advanced. Run the cron again the same day: nothing happens.
4. Dial rule: turn the dial for that archetype, set the date to today again, run: the renewal ships the new position; flip `subscription_ships_current_dial_position` to 0 in `/admin/commerce`, run again: ships the signup slot.
5. Failure: attach a failing test card to the customer (`pm_card_chargeDeclined`) as the default payment method, run: `past_due`, payment-trouble email, no order. Confirm the retry schedule from Task 0.5.
6. Pause/skip windows are exercised through the service in tests (no UI yet).
7. Upcoming notice: date = today + notice days, run: one email, run again: none.

## Part F — Docs and closing

`comments.sql` → `catalog:md` → `CATALOG.md` committed. `WHAT_WE_BUILT.md` entry "Commerce 2: subscriptions (card on file, our schedule, invoices per cycle)". `WHAT_WE_BUILT_DB.md`. `OPEN_TASKS.md` (Commerce 3 items: self-service buttons, update card, admin orders/subscriptions, refunds, mark shipped, customer email on the admin new-order email). `REGRESSION.md`: "subscription renewal ships current dial position", "renewal cron is idempotent". `MANUAL_SETUP_IDS.md`: the scheduler job line and the new webhook events. `CLOSING_REPORT_2.md`: Task 0 findings, event matrix, parameters seeded, Part E evidence (invoice ids), fee figure, what Commerce 3 needs.
