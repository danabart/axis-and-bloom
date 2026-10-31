# Closing report — Commerce 2: Subscriptions (core)

Brief: `CLAUDE_CODE_PROMPT_COMMERCE_2_SUBSCRIPTIONS.md` · Session 2026-10-31 · Base commit `3593c8f` (main == origin/main; prod runs Commerce 1 + Checkout UX 1). Test mode only.

Status: **done in test mode; committed on `main`, not pushed (Dana's go).**

| Commit | Content |
|---|---|
| `14afa49` | Task 0 / 0.5 |
| `dad8a09` | A, schema |
| `7627fc8` | B, backend |
| `a2f8ed0` | C, frontend |
| `3f929ee` | D, tests |
| `3896fcf` | E fix |
| `c130e45` | Dana's `CLAUDE.md` guardrails pointer, its own commit |
| — | plus the docs commit |

After the push and first boot:
1. Run `npm run catalog:md -- --expect-db axisandbloom` and commit `CATALOG.md`.
2. Create the Cloud Scheduler job (`MANUAL_SETUP_IDS.md`).
3. Run the post-deploy checks at the end of this report.

`DEVELOPMENT_GUARDRAILS.md` (added to `CLAUDE.md` mid-brief) was read during Part B and the build checked against it. One conflict was found and followed per the guardrails: the brief's `subscription_event.source` CHECK list became a lookup table (G2.7).

---

## Task 0 — current state (verified 2026-10-31, before any change)

Code read at `3593c8f`. Prod queried read-only through the Cloud SQL proxy (`--gcloud-auth`, SELECTs only, `backend/tmp/commerce2_task0.ts`).

### 0.1 Commerce 1 as built (reuse, do not fork)

| Piece | Where | What brief 2 uses |
|---|---|---|
| `createCheckoutSession(input)` | `services/checkoutService.ts:90` | gains `subscription?: { frequencyWeeks }` |
| `completeCheckoutSession(session)` | `checkoutService.ts:238` | one transaction (order, lines, `paid` event, session complete); the subscription is created inside it |
| `recordOrderEvent(e, runner)` | `checkoutService.ts:317` | renewals use it as is (`source` already allows `cron`) |
| `getOrderSummary(orderId)` | `checkoutService.ts:371` | renewal emails |
| `finalizePaidOrder(orderId)` | `services/orderFinalizer.ts:31` | unchanged; its `lifecycle` step calls `refreshLifecycleState`, which picks up SUBSCRIBER once the subscription row exists |
| `stripe()`, `getOrCreateStripeCustomer`, `STRIPE_API_VERSION` (`2026-09-30.endive`) | `services/stripe.ts:24, :45, :15` | the renewal invoices |
| ledger + event switch | `routes/stripeWebhook.ts:32–60` (switch), `:62–102` (ledger) | new `invoice.*` cases; unknown invoices are a quiet no-op, like unknown sessions |
| `commerceParam`, `commerceParamText`, `setParameterInTx` | `services/commerceParameters.ts:52, :59, :106` | discounts, frequencies, the new parameters |
| `sendOnce` (the one `transactional_email_log` door) | `services/transactionalEmail.ts:29` | upcoming-delivery and payment-trouble emails |
| order emails | `services/orderEmails.ts` | the two new emails live beside them |
| `dispatchFulfillment` | `services/fulfillment/index.ts` | unchanged (the finalizer calls it) |
| `shippingFor(bagCount)` | `services/cartResolver.ts:94` | the one shipping rule, for renewals too |

### 0.2 `subscription` today

Table: `schema.sql:675–684`, plus `company_gift_id` and `sponsored_expires_at` at `:4197–4198`.
- Columns: `id` UUID, `user_id`, `household_id`, `status` TEXT default `active` with no CHECK, `frequency_days` default 30, `next_delivery_date`, `created_at`, `updated_at`.
- Table comment: `comments.sql:358`.

**Writers** (as `comments.sql:358` declares):

| Writer | Where | What |
|---|---|---|
| `companyGiftRedemption.POST /:code/redeem` | `routes/companyGiftRedemption.ts:107–112` | `INSERT (user_id, status 'active', company_gift_id, sponsored_expires_at = now() + N months)`, inside the redemption transaction (the code `FOR UPDATE`, the 409 guard at `:92–100`, `user_profile.company_gift_id` at `:106`) |
| `cron.GET /sponsored-subscription-check` | `routes/cron.ts:527` | `UPDATE status = 'lapsed', updated_at = now()` for expired sponsored rows, then `refreshLifecycleState` and the lapsed email (`:528–547`); the trial-ending pass (`:551–577`) only reads |

**Readers:**

| Reader | Where | Reads |
|---|---|---|
| `userSignals.hasActiveSubscription` | `services/userSignals.ts:239–247` | `status = 'active'`, own row or the household's |
| `userSignals` sponsored | `userSignals.ts:257–267` | sponsored rows: active, `sponsored_expires_at`, lapsed |
| `refreshLifecycleState` → `classifyStage` | `services/userLifecycle.ts:31, :34, :53` | SUBSCRIBER from `hasActiveSubscription`; SPONSORED_LAPSED_NO_PAYMENT / SPONSORED_TRIAL_ENDING from the sponsored signals |
| `liamAccess.hasLiamAccess` | `services/liamAccess.ts:35–38` | `status = 'active'` and not past `sponsored_expires_at`, own or household |
| `users` lifecycle route | `routes/users.ts:392–400` | `next_delivery_date` of the active row, when the stage is SUBSCRIBER |
| `catalogService` roaster deactivation preview | `services/catalogService.ts:1382–1396` | count of active subscribers whose last line is this roaster's |
| `cron` | `routes/cron.ts:519–525, :551–558` | sponsored rows (above) |
| `companyGiftRedemption` guard | `companyGiftRedemption.ts:92–95` | active sponsored row exists |
| `customerReads.getSubscriptionCurrent` | `services/customerReads.ts:483–495` | latest row's `status` + sponsored flag, for Liam's customer block (`liamProfile.ts:356–358`) and the gate's `customer_subscription` resolver (`sommelierGate.ts:334–337`) |
| `customerReads` watermark | `customerReads.ts:370–371` | `COALESCE(updated_at, created_at)`; Liam's block rebuilds when this moves, so every subscription write must stamp `updated_at` |

`comments.sql:358` lists the readers as `userSignals, liamAccess, users, catalogService, cron`. It is missing `customerReads`; Part A corrects that.

No SQL view reads `subscription` (`grep` on `schema.sql`).

**Company-gift behaviour that must not change:**
- the redemption INSERT, its 409 rule and its transaction;
- the cron lapse with its lifecycle refresh and the transition-only email;
- `hasActiveSubscription` and `liamAccess`, which both read `status = 'active'`.

Moving the two writes into `subscriptionService` keeps the SQL identical. The only addition is `kind = 'sponsored'`, which is also the column default.

### 0.3 Order columns brief 2 starts writing

| Column / row | Today |
|---|---|
| `customer_order_kind` | already has `subscription_renewal` (`schema.sql:5437`) |
| `"order".is_subscription` | exists (`schema.sql:692`, default false); no code writes it |
| `order_line_item.order_kind` | default `manual`; Commerce 1 writes `manual` from `checkout_session_line.order_kind` |

Prod: 2 orders, both `is_subscription = false`, both lines `manual`. These are Dana's post-deploy 4242 checks.

### 0.4 Dial position → line

- `user_bloom_dial_current_position` (`schema.sql:1676`, `slot_id` added at `:3215`) has PK `(user_id, archetype)` and **no surrogate id**. It predates the rule and is not retrofitted here.
- `coffee_dial_slot` (`:2583`) has `archetype`, `sort_order` (1–4) and `name`. The house name is UNIQUE.
- `cartResolver` turns a dial item `{ archetype, dialSortOrder, weightOz }` into a line at `cartResolver.ts:105–117`:
  1. `resolveBlendForSlot(archetype, dialSortOrder, weightOz)` (`blendResolver.ts:45`) returns the first sellable candidate, home slot first. The result carries `blend_id`, `coffee_id`, `slot_name` and `retail_price_cents`.
  2. That gives a line with `displayName = slot_name` and `unitPriceCents = retail_price_cents`.
- Renewals reuse exactly this, minus the client-price check: the server price is the only price.
- Direct (category) coffees resolve through `resolveCoffeeBlend(coffeeId, weightOz)` (`blendResolver.ts:166`) plus `coffee_retail_price` (`cartResolver.ts:88–91`), named through `directDisplay` (`:82–86`).

**Deviations from the brief's wording:**
1. **The default-slot column is `coffee_dial_slot.is_landing_default`**, not `is_default`. Each archetype has exactly one; on prod it is sort_order 2 for all six archetypes. B2's fallback reads it.
2. **Direct coffees have no archetype and no slot.** The brief sets `subscription.archetype` to NULL "for direct items", but it declares `subscription_item.archetype NOT NULL`. Plan:
   - `subscription_item.archetype` is nullable, with `CHECK (archetype IS NOT NULL OR signup_coffee_id IS NOT NULL)`.
   - A direct item always ships its signup coffee through the direct path. The dial rule does not apply to it.
   - If that coffee is no longer sellable at the weight, the item is `unresolved` and nothing is charged.

### 0.5 Checkout Session today

`checkoutService.ts:156–188`:
- `mode: 'payment'`, `customer`, `automatic_tax: { enabled }` and `customer_update: { shipping: 'auto' }` (when tax is on).
- Line `price_data` uses `tax_behavior: 'exclusive'` and the coffee tax code; shipping is a `shipping_rate_data`.
- Metadata is set on both the session and the PaymentIntent.
- **Nothing sets `setup_future_usage`** (grep: no match in `backend/src`). Prod has 0 `checkout_session` rows with `mode <> 'payment'`.

The cart fingerprint (`:73–78`) does not include anything subscription-shaped. Without a change, a one-time cart and the same cart as a subscription would reuse each other's open Stripe session. B3 adds the intent to the fingerprint.

### 0.6 Cron pattern

- `requireCronSecret` (`routes/cron.ts:42–49`) compares the `x-cron-secret` header exactly with `CRON_SECRET`. Every job is a `GET`.
- The router is mounted twice, at `/api/cron` and `/api/webhooks` (`index.ts:141–142`).
- The Stripe webhook is registered separately, raw-body, at `index.ts:91`.

`gcloud scheduler jobs list` (read-only, 2026-10-31) shows three jobs, all `ENABLED`, all in UTC:

| Job | Schedule |
|---|---|
| `purge-stale-anonymous-guests` | 09:00 |
| `liam-gate-offline` | 08:00 |
| `coffee-content-backfill` | 10:00 |

**`sponsored-subscription-check` has no scheduler job** (OT-13 is still open; the commands are in `OPEN_TASKS.md:113`). The sponsored lapse therefore never runs on prod today. There are 0 subscriptions on prod, so nothing has gone wrong yet. I'm only noting it here; the job is OT-13's, not this brief's.

### 0.7 Prod (read-only, 2026-10-31)

- `SELECT status, company_gift_id IS NOT NULL AS sponsored, COUNT(*) FROM subscription GROUP BY 1,2;` → **no rows** (0 subscriptions, sponsored or not).
- `household_id`, `next_delivery_date` and a non-default `frequency_days` are each set on 0 rows. The `kind` backfill and the `status` FK therefore touch nothing on prod. Both are written to work on any rows anyway.
- `user_bloom_dial_current_position`: 34 rows, 12 users.
- `commerce_parameter` has all 12 Commerce 1 rows. `subscription_discount_pct_1_bag` = 5, `_2plus_bags` = 10 and `subscription_frequency_weeks` = `2,4,6` are already seeded.
- `stripe_event`: `checkout.session.completed` 4, `checkout.session.expired` 2, `payment_intent.payment_failed` 1. There are no `invoice.*` events yet.
- None of these exist yet: `subscription_item`, `subscription_event`, `subscription_status`, `subscription_kind`, `subscription_event_kind`.

### 0.8 Stripe API at `2026-09-30.endive` (SDK `stripe@23.1.0` types) — deviations from the brief's call shapes

1. **`Invoice` has no `payment_intent` field and no `tax` field.**
   - The PaymentIntent is reached through `invoice.payments` (an `InvoicePayment` list, expandable).
   - Tax is `invoice.total_taxes[]`.
   - `createSubscriptionOrder` therefore retrieves the invoice with `expand: ['payments']` to record `stripe_payment_intent_id` and the fee, and sums `total_taxes[].amount` for `taxes_collected`.
2. **`unit_amount_decimal` takes a `Decimal` object** (`Decimal.from('2755')` from the SDK), not a string. Integer cents with `quantity` would also work through `price_data`, but that needs a Product id. The plan is `unit_amount_decimal` via `Decimal`.
3. Present as the brief wrote them:
   - `invoices.create`: `pending_invoice_items_behavior`, `automatic_tax`, `default_payment_method`, `collection_method`, `auto_advance`, `metadata`
   - `invoiceItems.create`: `invoice`, `tax_code`, `tax_behavior`, `quantity`, `description`, `metadata`
   - `invoices.pay`: `off_session`

### Further findings the brief did not spell out

1. **Liam access and the SUBSCRIBER stage read `status = 'active'` only** (`userSignals.ts:243`, `liamAccess.ts:37`). With the new vocabulary, a paid subscriber in `past_due` (a card retry in progress) or `paused` would lose Liam and drop out of SUBSCRIBER at once. See question 1.
2. **Liam says the raw status code.** The gate's `customer_subscription` resolver (`sommelierGate.ts:337`) and the customer block (`liamProfile.ts:358`) print `sub.status` as is, so a `past_due` subscriber would hear "past_due". I'm noting it, not changing it: the label lookup gains `customer_label`, and Commerce 3 can switch those two lines onto it.
3. **Renewal double-charge guard.**
   - The cron must stay idempotent across two runs on the same day, even before the `invoice.paid` webhook has moved `next_delivery_date`.
   - Plan: the cron takes each due row `FOR UPDATE SKIP LOCKED` and skips it when `last_charge_attempt_at >= next_delivery_date`, meaning this cycle was already attempted. It stamps `last_charge_attempt_at` before calling Stripe.
   - On a non-card error (network, Stripe 5xx) the stamp is put back, so the next run retries.
   - The Stripe idempotency keys `sub:<id>:cycle:<date>:…` cover a crash in between.
4. **Retries after a synchronous card failure are Stripe's.** The invoice stays open with `auto_advance`, and Stripe retries it on the Dashboard schedule (Task 0.5 #2).
   - The cron only charges `active` rows, so it never opens a second invoice for a `past_due` cycle.
   - A later successful retry arrives as `invoice.paid`: the order is written, the row goes back to `active`, `failed_attempts` resets to 0, and the next date is scheduled.
   - Stripe also sends `invoice.payment_failed` for the synchronous failure the cron already recorded. Both paths go through `markRenewalFailed`, deduped per (invoice, attempt count), so the email goes out once per attempt.
5. **Lapse must stop Stripe collecting.** When `lapseIfOverdue` lapses a `past_due` subscription, it also voids that cycle's open invoice. Otherwise Stripe's retry schedule could charge a lapsed customer later.
   - If an `invoice.paid` still arrives (a race), the customer has paid, so the order is written and the subscription goes back to `active`.
   - "Overdue" is measured from the unpaid cycle's date. `next_delivery_date` does not move until the cycle is paid, so that date is the cycle's due date.
6. **The next date after a late payment:**
   - On time, `next = cycle date + weeks × 7`.
   - When a retry succeeds days later, `next = paid date + weeks × 7`. The coffee ships when it is paid, so the gap between deliveries stays at N weeks.
7. **The business date is US Eastern.** "Today", the cycle date and `next_delivery_date` are calendar dates in `America/New_York`, matching the scheduler job at `subscription_charge_hour_local`.
8. **The renewal's tax destination.** Stripe Tax on an invoice uses the customer's shipping address. Each renewal first sets the Stripe customer's shipping to the profile's current default address, as checkout does at `checkoutService.ts:150–155`. The address snapshot on the order and the taxed address therefore match.
9. **Collection lines in a subscription cart** (`cartResolver.ts:130–156`) are already 10% off. See question 2.

### Questions for Dana (at the Task 0.5 pause)

1. **`past_due` and `paused`:** should these keep Liam access and the SUBSCRIBER stage?
   - Recommended: yes for both. Liam is what the subscription buys, and a card retry or a pause the customer asked for is not a cancellation.
   - Under this option, `lapsed` and `canceled` remove access.
   - This changes the `status = 'active'` predicate in `userSignals.ts:243`, `liamAccess.ts:37` and `users.ts:396` to "status is one of active, past_due, paused". It goes through the lookup (a new `subscription_status.counts_as_subscriber` column), so the list is data, not code.
   - Sponsored rows are only ever `active` or `lapsed`, so company-gift behaviour is unchanged.
   - The alternative is to keep `active` only, exactly as the brief states it.
2. **Collection + subscription:** should the 10% collection discount stack with the subscription discount?
   - Recommended: no.
   - Under this option, a subscribed line is priced at the pricing-table price minus the subscription tier, and the collection discount is not applied when subscribing.
   - The first delivery and every renewal then cost the same: renewals price each member slot from the pricing table, and nothing re-derives a "collection" each cycle.
   - The alternative is to stack them on the first delivery only, which makes the first box cheaper than the renewals.

---

### Dana's decisions (2026-10-31)

1. **Status access:** past_due and paused keep Liam access and the SUBSCRIBER stage; lapsed and canceled remove them; sponsored unchanged. This is implemented as `subscription_status.counts_as_subscriber`, read by `userSignals`, `liamAccess`, `users` and `catalogService`.
2. **No stacking:** a subscription uses only the subscription tier by bag count. The collection discount never applies to a subscription checkout or renewal.
3. **Task 0 resolutions approved:**
   - `is_landing_default` as the default-slot column;
   - a nullable item archetype for category coffees, with the coffee id set;
   - the real API shapes;
   - no double charge per cycle;
   - void the unpaid invoice on lapse.
4. **Build deviations approved:** the event-source lookup, `invoice_voided`, `auto_advance` only at finalize, the date fix, no collection discount on subscriptions. OT-13 left as noted.

---

## Task 0.5 — manual setup

Written into `launch/00_manual-setup/MANUAL_SETUP_IDS.md` → Stripe → "Commerce 2".

| Step | Status |
|---|---|
| 1. The four `invoice.*` events on the sandbox endpoint | ✅ Dana |
| 2b. Stripe customer emails (failed payment, reminders, finalized invoices) off | ✅ Dana |
| 2a. Retry schedule | **Not recorded:** both of Dana's replies carried the placeholder `[paste the Dashboard wording]` (OT-63) |
| 3. Scheduler job | After the deploy; exact command in the doc |

**Invoice fee:** 0.4% per paid invoice per Stripe's public pricing; account figure to confirm. (stripe.com/invoicing/pricing, read 2026-10-31: Starter 0.4%, Plus 0.5%, no cap shown; the brief's "capped at $2" was from memory.) The card fee on renewal `in_1UWgMi0QYxZQN6jD3b3e7vlF` ($33.50) was $1.27; Stripe Tax's own fee comes on top.

---

## Why no existing object fits (Part A)

`CATALOG.md` was checked before adding anything.

- **`subscription`** stays the current-state row. It has no items, no billing link and no history, and it had two writers.
- **`order_event`** is per order, not per subscription.
- **`checkout_session`** is a one-time cart snapshot that ends at payment, while a subscription's lines must outlive it.
- **`user_payment_detail`** is retired (Stripe holds the card).
- **New tables, all domain-prefixed (G2.3):**
  - `subscription_item` (what ships);
  - `subscription_event` (insert-only history, G2.13);
  - the lookups `subscription_status`, `subscription_kind`, `subscription_event_kind` and `subscription_event_source` (G2.7);
  - the view `v_subscription_status` (the read path for Profile and admin).

## Built

**Schema** (`schema.sql` Commerce 2 block, additive and idempotent; `comments.sql` for every new table and column):
- **`subscription`:** gains `kind`, `frequency_weeks`, `archetype`, `origin_checkout_session_id`, `stripe_payment_method_id`, `paused_until`, `skip_next_until`, `cancel_at`, `last_order_id`, `last_charge_attempt_at` and `failed_attempts`, plus the `status` FK.
- **`subscription_event`** carries `attempt_count`, a column the brief did not list, so a failure is deduplicated per Stripe attempt. Partial unique indexes:
  - one `started` per subscription;
  - one `renewal_charged` per invoice;
  - one `renewal_failed` per (invoice, attempt).

  It is REVOKE UPDATE/DELETE for `ab_app`.
- **`"order"`** gains `subscription_id` and `stripe_invoice_id` (UNIQUE).
- **`checkout_session`** gains `subscription_intent` and `subscription_id`.

**One writer (G2.5):** `subscriptionService` writes `subscription`, `subscription_item` and `subscription_event`.
- `companyGiftRedemption`'s INSERT and `cron`'s sponsored-lapse UPDATE moved there with the SQL unchanged. Sponsored lapse now also records a `lapsed` event.
- `checkoutService` stays the one writer of `"order"` and `order_line_item`, with the new `createSubscriptionOrder`.
- `lint:lineage` is green.

**Prices (G2.16):** every cycle is re-priced from `coffee_slot_price` / `coffee_retail_price`, through the same `resolveBlendForSlot` / `resolveCoffeeBlend` the cart uses. The cart helpers `retailPriceCents` and `directDisplay` are exported rather than copied (G3.9). Stripe never holds a price.

## Webhook event matrix (additions)

| Event | Handling |
|---|---|
| `invoice.paid` with our `metadata.subscription_id` | `createSubscriptionOrder` (once per invoice: order + `subscription_renewal` lines + `paid` event + `renewal_charged` + back to active + next date) → `finalizePaidOrder` |
| `invoice.paid` without our metadata | recorded, processed, nothing else |
| any `invoice.*` naming a subscription this DB does not have | recorded with the reason, processed, 200 `unknownSession`, never retried |
| `invoice.payment_failed` | `markRenewalFailed` (past_due, `failed_attempts`+1) + payment-trouble email, once per (invoice, attempt), so the cron's own record of a synchronous decline is not doubled |
| `invoice.marked_uncollectible` | lapsed + event + lifecycle refresh |
| `invoice.voided` | `invoice_voided` event |

## `commerce_parameter` rows seeded

| key | value | sane range |
|---|---|---|
| subscription_ships_current_dial_position | 1 | integer 0–1 |
| subscription_upcoming_notice_days | 3 | integer 0–14 |
| subscription_past_due_lapse_days | 21 | integer 7–60 |
| subscription_charge_hour_local | 6 | integer 0–23 (informational: the scheduler job's hour) |

`subscription_discount_pct_1_bag` (5), `_2plus_bags` (10) and `subscription_frequency_weeks` (2,4,6) were seeded by Commerce 1 and are now used.

## Deviations from the brief, and why

1. **`subscription_item.archetype` is nullable** with a CHECK (archetype or `signup_coffee_id`), because category coffees have no archetype (Task 0, approved).
2. **The default slot is `coffee_dial_slot.is_landing_default`** (Task 0, approved).
3. **`subscription_event.source` is a lookup `subscription_event_source`**, not a CHECK list (G2.7, approved). `invoice_voided` was added to the event kinds (approved).
4. **Invoices are created with `auto_advance: false`;** `finalizeInvoice(…, { auto_advance: true })` switches it on. A draft left by a crash can never finalize and charge on its own (approved).
5. **Invoice items use `unit_amount_decimal: Stripe.Decimal.from(…)`** (the SDK's `Decimal`). The PaymentIntent comes from `invoice.payments`, and tax is the sum of `total_taxes` (API `2026-09-30.endive`, Task 0).
6. **Idempotency keys are per cycle and per attempt:** `sub:<id>:cycle:<date>:attempt:<claim ms>:<step>`, not the brief's `sub:<id>:cycle:<date>`. Part E finding: a second attempt at a cycle (a released claim, or a shipment changed by a dial turn) reused keys, and Stripe refused them as "same key, different parameters". A non-card failure now voids that attempt's open invoice before the claim is released. If the void fails, the cycle is held and admin alerted: a stuck cycle beats a double charge.
7. **The renewal's next date:** on time it is cycle + N weeks; after a late retry it is paid date + N weeks.
8. **The subscription discount is rounded per bag,** not "rounded per line, remainder on the first line". Each bag's Stripe unit price is then exactly what it is charged, and first deliveries and renewals round the same way.
9. **A server quote, `POST /api/checkout/quote`,** shows the subscribed subtotal in the cart and on `/checkout`. The frontend never computes a discount (G2.1/G4.2).
10. **Profile reads `GET /api/subscriptions/mine`** through `v_subscription_status` plus the dial-aware resolver.
11. **Date bug fixed on the way.** `Home.tsx` and `Profile.tsx` rendered `nextDeliveryDate` with `new Date(…)`, which shows a Postgres DATE as the previous day in US time. They now use `lib/calendarDate.formatCalendarDate`, and `users.ts` sends YYYY-MM-DD.
12. **Part E step 5 used `pm_card_chargeCustomerFail` (4000…0341), not the brief's `pm_card_chargeDeclined`.** Stripe declines `chargeDeclined` at attach, so it can never be a saved card; 0341 attaches and then declines on charge.
13. **The renewal email for the first delivery uses the order confirmation as is** ("Your order is in"). Renewals send the same confirmation and admin emails as any order.

## Part E — acceptance

Run 2026-10-31 in Stripe test mode against a local backend on `axisandbloom_test` (prod untouched). Stripe events came through `backend/tmp/stripe-relay.ts` (the Events API, signed locally), now including `invoice.*`. The cron was called with a local secret. The browser was driven in Dana's tab group, signed in as `danabar.mail+checkout1@gmail.com` (customer). Card payments used Stripe's published test cards; "Pay without Link" was chosen.

| Step | Result |
|---|---|
| 1. Subscribe, 1 bag, every 2 weeks, 4242 | cart showed "Make it a subscription · 5% off", $29.00 struck → $27.55; Stripe showed the future-payments mandate; order `63e40778…` `is_subscription`, $27.55 + $5.95 + $0 tax = $33.50, line `manual` with $1.45 discount; subscription `f1ea569f…` `active`, next `2026-11-14`, item balanced_sweet / slot 4 / coffee 2905, `started` event, saved `pm_1UWgKH…`; return page "Next delivery Saturday, November 14, every 2 weeks"; admin and customer emails sent |
| 2. Two bags, every 4 weeks | $58.00 struck → $52.20, free shipping in the cart and in Stripe; subscription `e12c51d1…` next `2026-11-28`; Profile → Orders showed both subscription blocks (status, every N weeks · bags · % off, next date, lined up, "Change it on your Bloom Dial") |
| 3. Renewal | date set to today, `subscription-daily` → invoice `in_1UWgMi0QYxZQN6jD3b3e7vlF`, `invoice.paid` → order `7b408e8c…`, line `subscription_renewal` $27.55, total $33.50, fee $1.27, paid → finalized → dispatched, both emails, next back to `2026-11-14`; second run the same day: nothing charged. Stripe: `automatic_tax.status complete`, coffee and shipping lines `product_exempt` $0 (NJ) |
| 4. Dial rule | the test DB had one sellable Balanced slot, so for this step only "Bright & Balanced" (slot 5) was made sellable in `axisandbloom_test` through `catalogService.placeCoffee` (guest) + `setSlotPrice` ($31.00); dial turned in the browser to slot 5 → invoice `in_1UWgRK0QYxZQN6jDdFsMxtBW`, order line "Bright & Balanced" $29.45 ($1.55 off). Switch to 0 (through `commerceParameters.setParameter`, the admin route's door) → `in_1UWgV10QYxZQN6jD64sDifWV`, line "Classic Balanced" $27.55. Switch restored to 1 |
| 5. Failure | `pm_card_chargeCustomerFail` attached (`pm_1UWgW30QYxZQN6jD3WApU185`, 0341), subscription pointed at it → `declined`, invoice `in_1UWgWB0QYxZQN6jDbWZgkKkv` open with `auto_advance: true` (Stripe retries), subscription `past_due`, `failed_attempts` 1, one `renewal_failed` (attempt 1, $35.40) although Stripe's `invoice.payment_failed` also arrived, one "About your next delivery" email, no order. Retry schedule: see Task 0.5 |
| 6. Pause / skip | covered by tests (`subscriptionService.test.ts`, `subscriptionRenewal.test.ts`) |
| 7. Upcoming notice | date = today + 3 (`2026-11-03`), run → 1 email `subscription_upcoming:e12c51d1…:2026-11-03`, run again → 0 |

**Found and fixed in Part E:** the reused idempotency keys (deviation 6). The first attempt that hit it was harmless: the reused create key returned step 3's paid invoice and the first invoice item was refused, so nothing was charged and the claim was released.

**Noticed, not changed:**
- `transaction_fee` is NULL on the first-delivery order: Stripe had not settled the balance transaction when the webhook arrived. The renewal order's fee was present. Same behaviour as Commerce 1.
- Embedded Checkout still offers Cash App Pay and Klarna for subscription checkouts. They are account settings: Checkout hides only methods that cannot be saved.
- Locally, Profile → Orders says "You haven't placed any orders yet" because the local profile read fails on the Firestore dev guard (Commerce 1 finding). On prod it lists the orders.
- The test data stays (the throwaway account, its 2 subscriptions, 5 orders, the slot-5 placement and price in the test DB), per the nothing-deleted rule.

## Tests

- **New test files:**

  | File | Tests | Covers |
  |---|---|---|
  | `subscriptionShipment.test.ts` | 9 | the fallback chain, category coffee, pricing tiers, per-bag rounding |
  | `subscriptionService.test.ts` | 10 | scheduleNext with pause/skip, the one-attempt claim, failure per attempt, charge per invoice, the late-paid next date, lapse + void, sponsored create/lapse, decision 1 access |
  | `subscriptionRenewal.test.ts` | 6 | twice → one invoice and no order, unresolved → no invoice + admin email once, declined → past_due + one email, paused → skipped, non-card failure → void + release + fresh keys, upcoming notice once |

- **Additions to existing files:** `checkoutService.test.ts` (+7: subscription checkout, completion in one transaction exactly once, `createSubscriptionOrder` idempotent, unknown subscription, quote) and `stripeWebhook.test.ts` (+5: the invoice events).
- **Full suite** (before the Part E fix): 1,087 passed; 7 failed, exactly the known ones (quizScoring 6, schema.catalog_blueprint 1), not fixed per Dana. After the fix, the changed files re-ran green (16/16).
- **Checks:** `comments.format` / `comments.db`, the six lints, backend `tsc`, `vite build` green. Frontend `tsc` is at the same 13 pre-existing errors.

## What Commerce 3 needs from this

- **Self-service:** write through `subscriptionService` with `source = 'customer'`.
  - pause: `paused_until` + `paused`
  - skip: `skip_next_until` + `skip_requested`
  - frequency: `frequency_weeks` / `frequency_days` + `frequency_changed`
  - cancel: `cancel_at` + `canceled`, with status
  - update card: a SetupIntent → `stripe_payment_method_id` + `payment_method_updated`

  The cron already honours the pause and skip windows (`scheduleNext`, `skipCoveredCycle`).
- **Payment-trouble email:** add the update-card link, and when a new card is saved, retry the open invoice (`invoices.pay`) for a past_due subscription.
- **Admin:** subscriptions from `v_subscription_status` and events from `subscription_event`; orders and refunds as planned.
- **Liam:** the `customer_subscription` resolver and the customer block should print `customer_label` (OT-62).
- **Retry schedule:** decide the post-retry outcome once the Dashboard wording is in (OT-63).

## Post-deploy checks

1. Push → deploy green → boot log shows `[stripe] mode=test`, `DB schema verified`, and `[db-comments]` with no errors.
2. `npm run catalog:md -- --expect-db axisandbloom`, then commit `CATALOG.md`.
3. Create the `subscription-daily` Cloud Scheduler job (`MANUAL_SETUP_IDS.md`) and trigger it once with `gcloud scheduler jobs run`. The Cloud Run log should show `[cron/subscription-daily]` with 0 charged on a database with no paid subscriptions.
4. On prod with `?preview=true`, subscribe with 4242 (1 bag): one order, the subscription block on Profile, the next date on the return page.
5. `/admin/commerce` shows the four new parameters.
6. Run the standing regression trio, plus the new subscriptions section of `REGRESSION.md`.
