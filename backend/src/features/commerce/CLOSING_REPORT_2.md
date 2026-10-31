# Closing report — Commerce 2: Subscriptions (core)

Brief: `CLAUDE_CODE_PROMPT_COMMERCE_2_SUBSCRIPTIONS.md` · Session 2026-10-31 · Base commit `3593c8f` (main == origin/main; prod runs Commerce 1 + Checkout UX 1). Test mode only.

Status: **Task 0 written; Task 0.5 waiting on Dana.**

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

## Task 0.5 — manual setup

Written into `launch/00_manual-setup/MANUAL_SETUP_IDS.md` → Stripe → "Commerce 2". Waiting on Dana for step 1 (the four `invoice.*` events on the sandbox endpoint) and step 2 (the retry schedule and the Stripe emails). Step 3, the scheduler job, comes after the deploy.
