# Closing report — Commerce 4: live cutover

Brief: `CLAUDE_CODE_PROMPT_COMMERCE_4_LIVE_CUTOVER.md` · Session 2026-11-16 · Base commit `9473f75` (main; prod rev `00864-vpp`). `DEVELOPMENT_GUARDRAILS.md` read before Task 0.

Status: **DONE 2026-11-18. Stripe has been live on prod since 2026-11-17** (rev `00869-6z8`, `[stripe] mode=live`). The $1 gate passed (paid, refunded, gate off), and the payment method domain is registered. Parts A and B were done before this session: A by Dana, B by the CTO session. They are recorded in `MANUAL_SETUP_IDS.md` → Stripe → Commerce 4. The pre-launch curtain stays up.

Steps, with the dates in UTC:
1. Task 0 on 2026-11-16, then STOP.
2. Push `37f26ff` at 2026-11-17 17:34.
3. Part D built and pushed (`ae02461`); gate on at 18:54.
4. Purchase 2026-11-18 01:41; refund at 02:18.
5. Gate off at 02:22.
6. Payment method domain right after.
7. Docs (this commit).

---

## Task 0 — current state (verified 2026-11-16, read-only)

Prod DB read through the Cloud SQL proxy, SELECTs only, in a read-only transaction (`backend/tmp/commerce4_task0.ts`, `commerce4_task0b.ts`). Live Stripe read with the live key from Secret Manager, list and retrieve calls only (`backend/tmp/commerce4_stripe_live_ro.ts`). Cloud Run and Secret Manager read with `gcloud`.

### 0.1 Mode, deploy wiring

- Boot log: every revision through `00864-vpp` (last boot 2026-11-16 18:08:04 UTC) logs `[stripe] mode=test`.
- `deploy.yml:169` passes `STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest` and `STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET:latest` through `--set-secrets`.
- The publishable key is a literal in the workflow env, `deploy.yml:249`: `VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_51UVkXO…'`. It is not a repo variable. `StripeEmbeddedCheckout.tsx:9` is its only reader.
- `stripeMode()` (`services/stripe.ts:34`) already treats `rk_live_` as live. That was in the code since Commerce 1 (`b330ecd`). What was missing was a test. `stripe.test.ts` (new, 5 tests) now pins sk/rk live, sk/rk test, the trim, and disabled.

### 0.2 `commerce_parameter` (current rows on prod)

| Key | Value | Brief expects |
|---|---|---|
| `shipping_fee_cents` | 595 | 595 ✅ |
| `free_shipping_min_bags` | 2 | 2 ✅ |
| `tax_collection_enabled` | 0 | 0 ✅ |
| `subscription_discount_pct_1_bag` / `_2plus_bags` | 5 / 10 | 5 / 10 ✅ |
| `subscription_frequency_weeks` | `2,4,6` | ✅ |
| `admin_alert_email` | `dana@axisandbloomcoffee.com` | ✅ (but see finding 4) |
| `stripe_tax_code_coffee` | `txcd_41050006` | ✅ |
| `stripe_tax_code_shipping` | `txcd_92010001` | ✅ |

Not listed in the brief, unchanged: `checkout_session_expiry_minutes` 30, `collection_discount_pct` 10, `collection_min_members` 3, `home_featured_slot` `chocolate_nutty:2`, `refund_window_days` 30, `subscription_charge_hour_local` 6, `subscription_past_due_lapse_days` 21, `subscription_pause_max_weeks` 12, `subscription_ships_current_dial_position` 1, `subscription_upcoming_notice_days` 3. No differences.

### 0.3 Live account (Parts A and B, re-read through the API)

| Check | Result |
|---|---|
| Account | `acct_1UVxa425hnyYIAkS`, `charges_enabled` true, `payouts_enabled` true |
| Statement descriptor | `AXIS AND BLOOM COFFEE` (brief: `AXIS & BLOOM COFFEE`; recorded as set) |
| Webhook | `we_1UcTtB25hnyYIAkSqQmkzKQR` enabled, the Cloud Run URL, API `2026-09-30.endive`, exactly the 10 events |
| Payment methods | default `pmc_1UVxad25hnyYIAkSjEaHhGqo`: apple_pay, card, google_pay, link |
| Tax | settings active, default `txcd_41050006`, head office Union City; registration US/NJ `state_sales_tax` active |
| Branding | `#3a3c3e` / `#ca526d` |
| Payment method domains | **none registered** (finding 5) |
| Live events so far | account/capability/tax-settings updates only; no payments |

Receipts off, Smart Retries 8×/2 weeks and Radar Lite are not readable through the API. They are recorded as reported by the CTO session and Dana.

### 0.4 Test-mode data on prod (stays; nothing deleted)

- **Orders: 5, not 4.** All are sandbox payment intents (`pi_3…0QYxZQN6jD…`):
  - `9e235cdf` partly refunded / shipped;
  - `98fec0f0` refunded / canceled;
  - `c47441c5`, `94b31a71` and `a0d3829b` paid / `awaiting_manual`.
  - The fifth (`a0d3829b`, 2026-11-08) is the Household brief 3 Part E order.
  - The three `awaiting_manual` orders appear as open work on `/admin/orders`. Their admin emails were already sent (deduped by `admin_new_order:<id>`), so nothing is pending to send. Nothing pays out: sandbox balances never reach the bank.
- **Subscriptions: 2.**
  - `7187cc53` (`+checkout1`) is canceled.
  - **`b0b6b130` is active, on Dana's own account, next delivery 2026-12-06, with a sandbox card** (finding 2).
- Shipment: 1 row (`f2fd36f7`, usps, shipped).
- `stripe_event`: 39 rows, all `livemode = false`.

### 0.5 Open sandbox invoice (OT-60)

- `in_1UWgWB0QYxZQN6jDbWZgkKkv` is still being retried by the sandbox. There are 8 `invoice.payment_failed` errors "no subscription f1ea569f…", the last on 2026-11-14 18:20 UTC.
- I could not confirm its state in the sandbox: v1 of `STRIPE_SECRET_KEY` (the test key) is disabled, so I have no test key to read it with.
- After the swap, sandbox deliveries fail the signature check (400) against the live signing secret, so they never reach the ledger. Stripe's Smart Retries end by themselves (8 within 2 weeks of the 10-31 invoice, so this is about done). Recommended: let it expire.

### 0.6 `PrelaunchGate`

`VITE_PRELAUNCH_MODE: 'true'` (`deploy.yml:250`), `PrelaunchGate.tsx` unchanged. It stays as is in this brief.

---

## Findings that contradict the brief or need a decision

1. **The live secrets are already "latest", and the test versions are disabled. Prod can flip to live on any cold start, before the frontend has `pk_live_`.**
   - `deploy.yml` reads both secrets as `:latest`, and Cloud Run resolves `:latest` when an instance starts.
   - v2 (live) of both secrets was created 2026-11-16 18:30 / 18:35 UTC, and v1 (test) of both is **disabled**. The brief's Part C kept the test versions as older, enabled versions.
   - The running instance booted at 18:08, before the change, so it still says `mode=test`.
   - The service has no `minScale`, so the next new instance (scale from zero, a second instance under load, any deploy) boots `mode=live` while the frontend still ships `pk_test_`. Embedded Checkout then fails: a live session cannot be mounted with a test publishable key.
   - The pre-launch gate limits who can reach checkout today, so the practical exposure is Dana's own testing. Findings 2 and 3 are what a live boot would do on its own.
   - Options:
     - (a) go ahead with the push soon, so frontend and backend switch together; or
     - (b) re-enable v1 and disable v2 until the push.
   - Recommended: (a), once findings 2 and 3 are decided. The push itself is the planned switch.
2. **An active subscription with a sandbox card is on Dana's account** (`b0b6b130`, Household brief 3 Part E, kept active on purpose on 2026-11-08).
   - Once live, the daily job sends the upcoming-delivery notice around 12-03, then on 12-06 tries a live invoice against a sandbox customer and card. That fails, and the subscription goes past_due with payment-trouble emails, then lapses after 21 days.
   - Recommended: cancel it before the push, through `subscriptionService` (source admin, a `canceled` event; no row deleted). That is a prod write, so it needs your yes.
3. **Saved Stripe customer ids are sandbox ids, and the code reuses them.**
   - `getOrCreateStripeCustomer` (`stripe.ts:45`) returns `user_profile.stripe_customer_id` when it is set.
   - Two users have sandbox customers: **Dana `danabar.mail@gmail.com` (`cus_Va3eBGMG4YfD43`)** and `+checkout1` (`cus_VXieQZVTedJE55`).
   - In live, Stripe answers "No such customer" for those ids, so **the Part D $1 purchase fails for Dana's account as it stands.** Customer ids carry no test/live prefix, so the code cannot tell them apart.
   - Closing report 3 named this ("must create a live customer for those users"). The brief's "no code change" does not cover it.
   - Options:
     - (a) code: on `resource_missing` from Stripe, create a live customer and replace the stored id. Small, tested, and it self-heals any other leftover id.
     - (b) data: set both columns to NULL on prod (our own data, not received data; a prod write).
     - (c) a mode column beside the id.
   - Recommended: (a). The old id is overwritten, but it only ever pointed at the sandbox, so it is noted in this report rather than kept. If you would rather keep it, choose (c).
4. **Part D's guard matches no account.**
   - The override is scoped to "the signed-in user is `admin_alert_email`'s account". No `user_email` row holds `dana@axisandbloomcoffee.com`.
   - Dana's account is `danabar.mail@gmail.com` (user `5d005443…`).
   - Part D needs either a different guard (for example a parameter holding the gate user's id or email), or Dana signing in with the alert address. To decide at the Part D STOP; it does not block the push.
5. **No payment-method domain in live.** Apple Pay and Google Pay in Embedded Checkout need `www.axisandbloomcoffee.com` registered under Settings → Payment method domains. The live API lists none. The brief says "Checkout usually does this; verify": it is not done. This is a Dashboard step (Dana or the CTO session); cards and Link work without it.
6. **The publishable key value is missing.** The message pasted into this session has the placeholder `[paste pk_live]`, not a key. `deploy.yml:249` stays `pk_test_` until you paste the `pk_live_…` value.

### Dana's decisions (2026-11-16)

1. **Push now** to close the scale-to-zero window. Do not re-enable v1.
2. **Cancel the Household test subscription** through `subscriptionService` (source admin, note "sandbox card, live cutover"), before the push.
3. **Replace a saved customer id that Stripe does not know:** create a live customer and save its id, keeping the old id visible. Add a test.
4. **Part D guard:** a `commerce_parameter` text row `live_gate_override_email`, seeded with `danabar.mail@gmail.com`, not a fixed account. Both override rows are superseded to 0 / empty at the end of Part D. Built at Part D, not in this push.
5. **Payment method domain:** after the $1 gate, register `www.axisandbloomcoffee.com`. If Apple's verification needs the association file served from our domain, add a static route and note it. Not blocking.

## Decisions applied

| Decision | Where |
|---|---|
| 2. Cancel | Prod, 2026-11-16 20:41 ET (01:41:45 UTC 11-17), `backend/tmp/commerce4_cancel_house_sub.ts`. It ran local code against prod with no Stripe key in the process: no `renewal_failed` events, so there was nothing to void. `subscriptionService.cancel(b0b6b130…, 'admin', '2026-11-16', 'sandbox card, live cutover')` → event 17 `canceled` "was active; sandbox card, live cutover" (admin); status canceled, `cancel_at` 2026-11-16, `counts_as_subscriber` false. The cancel email was not sent (the local Resend key is invalid, 401); the subscription is Dana's own. `cancel()` gained an optional `reason` parameter (G3.9: one door, a parameter, not a fork). |
| 3. Unknown customer id | `getOrCreateStripeCustomer` (`stripe.ts`) checks a saved id with `customers.retrieve` once per process. On `resource_missing` or a deleted customer, it creates a new one with `metadata.replaced_customer_id` = the old id and idempotency key `customer:<user>:replaces:<old>`. It replaces the id on `user_profile` only while the row still holds the old one, and logs `[stripe] customer replaced user=… old=… new=…`. Any other Stripe error propagates and nothing changes. The ids that will be replaced on first live use are Dana `5d005443…` `cus_Va3eBGMG4YfD43` and `+checkout1` `37198fcc…` `cus_VXieQZVTedJE55` (sandbox). |

## What changes in the push

- `backend/src/services/stripe.ts`: the `stripeMode()` comment (sk_/rk_), and unknown-customer replacement (decision 3).
- `backend/src/services/stripe.test.ts` (new, 10 tests): `stripeMode` 5; customer replacement 5 (no such customer, reuse and verify once, deleted, other errors leave the id alone, first creation unchanged).
- `backend/src/services/subscriptionService.ts`: `cancel(…, reason?)`.
- `backend/src/services/subscriptionSelfService.test.ts`: +1 (admin cancel with its reason).
- `backend/src/db/comments.sql`: `user_profile.stripe_customer_id` comment states the replacement. `CATALOG.md` is regenerated from prod after the deploy (G2.17).
- `launch/00_manual-setup/MANUAL_SETUP_IDS.md`: Commerce 4 Live section (Parts A and B, webhook id, secret versions, rollback).
- `.github/workflows/deploy.yml:249`: `pk_test_…` → `pk_live_…`.
- `CLOSING_REPORT_4.md`: this file.

Tests: the commerce files (`stripe`, `subscriptionSelfService`, `stripeWebhook`, `checkoutService`, `commerceAdmin`): 61/61. Backend `tsc --noEmit` clean.

## Part C — key swap (2026-11-17)

- Push `37f26ff` (with Dana's go) → deploy run `44138137101` green → rev `00869-6z8`, boot `[stripe] mode=live` at 17:34:20 UTC, no ERROR. The built bundle on `axis-and-bloom-prod.web.app` carries `pk_live_51UVxa425hny…`, no `pk_test_`.
- **The backend was already live from 15:13 UTC.** The Ella's Bloom Map 6 and 7 deploys (revs `00865`–`00868`) booted with the `:latest` (live) secrets while the bundle still had `pk_test_`. The prod ledger shows 0 checkout sessions and 0 live events in that window: nothing was charged or attempted.
- `CATALOG.md` was regenerated from prod after the deploy (`952c58d`, hash `a788146b…`).
- Step 4 (Dashboard test event) was skipped: live endpoints offer no "Send test event" (Dana). The $1 purchase is the first live delivery.

## Part D — the $1 gate

Built (Dana, decision 4): `cartResolver.applyLiveGateOverride(cart, buyerEmail)`, called by `checkoutService.createCheckoutSession` for one-time checkouts only; a subscription's first box is never gated. Three `commerce_parameter` rows, seeded **off** (`schema.sql`, Commerce 4 block):

| Key | Seed | For the gate | After the gate |
|---|---|---|---|
| `live_gate_override_cents` | 0 | 100 | 0 |
| `live_gate_free_shipping` | 0 | 1 | 0 |
| `live_gate_override_email` | `''` | `danabar.mail@gmail.com` | `''` |

- **Rule:** the signed-in email (Firebase token, case-insensitive) must equal `live_gate_override_email`, and the cents must be > 0. Each bag is then charged min(cents, price), with the rest as the line's `discount_cents`, and shipping is 0 when the flag is 1. Anyone else gets the normal cart.
- **The quote is not gated:** `POST /api/checkout/quote` has no email, so the cart summary keeps the normal price. The Stripe page shows the gated one.
- **New format** `email or empty` (`commerceParameters.FORMAT_CHECKS`), so the email can be cleared through the same writer.
- **Notes** are on the rows (G2.17); the `commerce_parameter.note` column comment lists the new format.
- **Tests:**
  - `cartResolver.test.ts` +5: off, on (any case), anyone else or no email, email empty, shipping off.
  - `commerceParameters.test.ts` +1: seeds off, format and range.
- **Checks:** the commerce files are green, 84/84. Backend `tsc` clean, six lints green.

### The $1 purchase (2026-11-18 01:41 UTC, Dana, rev 00870-2fp)

The gate was turned on 2026-11-17 18:54Z with `setParameter` (Dana's admin id), giving 100 / 1 / `danabar.mail@gmail.com`. Evidence was read only, from the prod DB, live Stripe and Cloud Run logs (`tmp/commerce4_paid_ro.ts`, `tmp/commerce4_paid_stripe_ro.ts`):

- **Customer replaced (decision 3):**
  - Log `01:40:19 [stripe] customer replaced user=5d005443… old=cus_Va3eBGMG4YfD43 new=cus_VeGNCORezTxvah (old id not found in mode=live)`.
  - The live customer's metadata is `replaced_customer_id=cus_Va3eBGMG4YfD43`, `user_id=5d005443…`.
  - `user_profile.stripe_customer_id` is now `cus_VeGNCORezTxvah`.
- **Checkout session:**
  - `cs_live_a0DFG793…`, mode `payment`, `complete`.
  - Subtotal 100, shipping 0, one bag, Hoboken.
  - Stripe gives `amount_total` 100, shipping 0, tax 0, `livemode` true.
- **Payment:**
  - `pi_3Ucxrr25hnyYIAkS14flyHRq` `succeeded`, $1.00 USD, live, paid through Link.
  - Radar `normal`.
  - Fee $0.33, net $0.67.
- **Webhook (first live delivery):** `evt_1Ucxrw25hnyYIAkSaN03yrw1` `checkout.session.completed`, `livemode` true, processed, no error. Log: `order 0b6ac7e9… created, finalized`.
- **Order `0b6ac7e9-3e0a-45f8-9de5-4ceb51ade2b4`:**
  - Subtotal $1, shipping $0, tax $0, total $1.
  - Line: 1 × $1 with $28 discount (the gate's remainder of the bag price).
  - Events:
    1. `paid` (webhook);
    2. `finalized` (the order-placed line);
    3. `fulfillment_dispatched` manual.
  - `v_order_status` shows Paid / Awaiting manual fulfillment.
- **Emails:**
  - `admin_new_order` to dana@axisandbloomcoffee.com, 01:41:06;
  - `order_confirmation` to danabar.mail@gmail.com, 01:41:06.
  - Both have a Resend id.

### The refund (2026-11-18 02:18 UTC, Dana, from `/admin/orders`)

- **Stripe (live):**
  - `refund.created` and `charge.refunded` at 02:18:31.
  - Charge `ch_3Ucxrr25hnyYIAkS1z1xKsme` shows `amount_refunded` 100.
  - The $0.33 fee is not returned, so the net result of Part D is −$0.33.
- **Webhook:** `evt_3Ucxrr25hnyYIAkS1R3PCmdy` `charge.refunded`, `livemode` true, received 02:18:32.300, processed, no error.
- **`order_event`:**
  - 25 `refund_full`: payment `refunded`, 100 cents, reason `requested_by_customer`;
  - 26 `canceled`: fulfillment `canceled`, note "fully refunded before it was placed with the roaster (was awaiting_manual)".
  - Both are from the webhook at 02:18:32.431, with `stripe_ref` = the charge.
- **`v_order_status`:** Refunded / Canceled, `amount_refunded_cents` 100.
- **Emails:** none sent for the refund, and none expected (no refund template exists; Stripe receipts are off).
- **As the trace predicted:** `v_orders_weekly` and the customer views still count the order (OT-146).

### Gate off and the full-price check (2026-11-18 02:22 UTC, Dana's go)

`tmp/commerce4_gate_off.ts` used `setParameter` (Dana's admin id, note "Commerce 4 Part D: $1 live gate off after purchase + refund of order 0b6ac7e9 (Dana)"). Cents went first, so the gate was off from the first write:

| Key | Before | After | Since |
|---|---|---|---|
| `live_gate_override_cents` | 100 | **0** | 02:22:44.837 |
| `live_gate_free_shipping` | 1 | **0** | 02:22:45.042 |
| `live_gate_override_email` | `danabar.mail@gmail.com` | **`''`** | 02:22:45.249 |

- **Full-price check:** `tmp/commerce4_gate_off_verify_ro.ts` ran against the prod parameters and catalog, read only. It resolved the order's own cart: chocolate_nutty position 1, 12 oz, one bag. It then ran `applyLiveGateOverride` for `danabar.mail@gmail.com`.
  - Result: "Quieta Non Movere" at **2900** cents, discount 0, subtotal 2900, shipping **595**.
  - This is identical to the ungated cart, so her next checkout is full price.
  - Running instances hold parameters for up to 60 s, so every instance was off by 02:23:46.
- **The code path stays**, seeded off, for the next cutover. How to use it is in `MANUAL_SETUP_IDS.md` → Commerce 4.

## Payment method domain (decision 5, 2026-11-18 after the gate, Dana's go)

`tmp/commerce4_pm_domain.ts` called the live API: list, then create, then validate.
- **Domain:** `www.axisandbloomcoffee.com` → **`pmd_1UcyX925hnyYIAkSYRFkPcBK`**, enabled, `livemode` true.
- **Status:** `apple_pay` **active**, `google_pay` **active**, `link` active, `paypal` active (not offered: the payment method configuration has no PayPal).
- **Apple:** Stripe verified Apple Pay without an association file, so no static route was added.
- **Not registered:** the apex `axisandbloomcoffee.com` (the app moves apex visitors to `www`, REGRESSION "One host"). Not seen in a browser yet: whether the wallet buttons appear on Dana's devices at the next checkout.

## Part E — rollback and runbook

In `MANUAL_SETUP_IDS.md` → Commerce 4:
- the secret versions (v2 live, v1 test disabled);
- the four rollback steps (the secrets, `pk_test_` in `deploy.yml`, the check, no DB change), with what happens to saved customer ids in either direction;
- live since 2026-11-17;
- the gate ids;
- the test-mode rows that remain and how to tell them apart (OT-145 for an admin filter);
- how to use the gate at the next cutover.

## Part F — docs

- **`WHAT_WE_BUILT.md`:** #275 "Commerce 4: live cutover".
- **`OPEN_TASKS.md`:**
  - OT-64 closed.
  - OT-114 closed (the live payment methods have no bank).
  - OT-60 annotated: sandbox deliveries now fail signature on prod; disable or repoint the sandbox endpoint, Dana's call.
  - OT-145 to OT-151 added, from this brief.
  - ShipStation (OT-58) stays open.
  - No "first live renewal" task: no live subscription exists.
- **`REGRESSION.md`:** a "Commerce — live Stripe" section (mode on both ends, `rk_`, customer replacement, gate off, wallet domain, live webhook). The `mode=test` line and the three "test mode until brief 4" intros are updated.
- **Commerce `README.md`:** status line "LIVE since 2026-11-17". Dana's own uncommitted edit to the brief table is left in the working tree, unstaged; only the status line is committed.
- **`comments.sql`:** the gate rows have notes (Part D, `ae02461`), and no column changed in this commit. `CATALOG.md` was regenerated after Part D (`5611bde`).

### Guardrails and brief, where they differed

- **Part D guard (finding 4):** the brief guarded on `admin_alert_email`'s account. Dana chose a parameter email instead (decision 4).
- **Part C step 4:** skipped. Live endpoints have no test event (Dana).
- **Part C step 2:** the brief kept the test secret versions enabled. They were disabled before the session, and Dana chose not to re-enable them (decision 1).
- **Customer replacement:** the "no code change" goal gave way to the customer replacement (decision 3) and the gate.
- **G2.9:** open, Dana's call (OT-149). The trace found that the rule's own default form is unsafe on `timestamptz`.

## Order data trace (order `0b6ac7e9-3e0a-45f8-9de5-4ceb51ade2b4`, before the refund)

- **Method:** read-only, against prod on 2026-11-18, through `tmp/commerce4_order_trace_ro.ts` and `tmp/commerce4_order_trace2_ro.ts`. View definitions come from `schema.sql` and were checked against `pg_get_viewdef` on prod.
- **Time zone:** the prod DB session `TimeZone` is **UTC**, and `db/client.ts` sets no time zone.
- **Nothing was changed.**

### Tables

The order was paid by webhook (`checkoutService`). The finalizer (`orderFinalizer.finalizePaidOrder`) then wrote, in order: the order-placed beat, then `finalized`, tokens, outcomes, delayed beats, lifecycle, fulfillment, the confirmation email, and household member emails.

| Table | Should hold | Holds | Key values |
|---|---|---|---|
| `"order"` | 1 row | ✅ 1 | user `5d005443…`, **household `22cbcdf2…`** (Dana's active house); subtotal 1, shipping 0, tax 0, total 1, USD; `transaction_fee` **NULL** (point 3); cs `cs_live_a0DFG793…`, pi `pi_3Ucxrr25…`; `paid_at` = `created_at` 2026-11-18 01:41:04.836Z (20:41 ET on 11-17); `fulfillment_status` awaiting_manual, `subscription_id` NULL |
| `order_line_item` | 1 per checkout line | ✅ 1 | `239be7c4…`, sku `3b7fd321…` "Quieta Non Movere" 12 oz; qty 1; unit 1, discount 28, tax 0.00; `intended_for_user_id` = Dana; `order_kind` manual; `vendor_payout_status` pending_invoice |
| `order_event` | paid, finalized, fulfillment_dispatched | ✅ 3 | 22 `paid` (webhook, paid / awaiting_manual, `stripe_ref` pi); 23 `finalized` (finalizer, note = Liam's order-placed line); 24 `fulfillment_dispatched` (finalizer, manual: Resend id) |
| `checkout_session` | 1, complete, linked | ✅ 1 | `bb2ff0a0…`, payment, complete, subtotal 100, shipping 0, 1 bag, `order_id` set, completed 01:41:04.836Z |
| `checkout_session_line` | 1 per bag line | ✅ 1 | coffee 2917, unit 100, discount 2800, `order_kind` manual, source `dial`, archetype chocolate_nutty |
| `stripe_event` | `checkout.session.completed` (the other live events are not subscribed) | ✅ 1 | `evt_1Ucxrw25hnyYIAkSaN03yrw1`, `livemode` true, processed 01:41:06.651Z, no error |
| `transactional_email_log` | admin new order and confirmation | ✅ 2 | `admin_new_order:<order>` to dana@axisandbloomcoffee.com and `order_confirmation:<order>` to danabar.mail@gmail.com, both with a Resend id. No household member email: the buyer is skipped (T8) and no other member with a sign-in got a bag. |
| `user_profile.stripe_customer_id` | the live customer | ✅ | `cus_VeGNCORezTxvah` (replaced `cus_Va3eBGMG4YfD43`) |
| `token_events` / `user_tokens` | order bonus | ✅ | +10 `order_bonus`, reference = order id, `balance_after` 1006; `user_tokens.balance` 1006. The Firestore `tokenBalance` sync is not visible from SQL. |
| `beat_event` | order_placed, arrival_note, dial_in | ✅ 3 | 40 `order_placed` inline, sent 01:41:04.9; 41 `arrival_note` email, scheduled 01:41:06; 42 `dial_in` email, scheduled **2026-11-21 01:41** (+3 days). All coffee 2917. |
| `user_brew_card` | arrival card (new arrival_note beat) | ✅ 1 | id 17, coffee 2917, espresso, origin arrival_note, arrival email scheduled **2026-11-22 01:41** |
| `user_lifecycle_state` / `_event` | recomputed | ✅ state / — event | Stage 6 ACTIVE_REPEAT_USER, `computed_at` 01:41:06. No new event, because the stage did not change; the last transition (7→6) was 2026-11-17 01:41:47Z, a day before this order. |
| `sommelier_evaluation.outcome` | only for sessions in the 30 days before the order not yet flagged | — 0 | No session qualified, so nothing was written. |
| `customer_*` fact tables | **none:** the paid path writes no `customer_*` fact | — | Since 01:40Z there is one `customer_dial_event` (`add_to_cart`, coffee 2917, slot 24, 01:40:14Z). It was written by the dial before checkout, not by the finalizer. The bag reaches the customer model only through `order_line_item` and the views below. `routes/orders.ts` imports `customerFacts` for the feedback route alone. |

### Views

| View | Holds the order | Base tables | Filters by payment status | Nets refunds | Dates |
|---|---|---|---|---|---|
| `v_order_status` | ✅ paid / "Paid" / awaiting_manual, refunded 0, line present | `"order"`, `order_event` (latest payment, latest fulfillment, latest refund amount, finalized), `order_payment_status`, `order_fulfillment_status`, `roastery_shipment_details`, `shipping_carrier` | No: one row per order, any status. It *reports* the status. | Reports `amount_refunded_cents`, the latest cumulative figure from the events. It is not netted into a total. | None grouped: raw `timestamptz`. |
| `v_orders_weekly` | ✅ **week 2026-11-16**: orders 1, new_customers 0 (her first order was 2026-11-08), `revenue_cents` 100 | `"order"` only | **No**: every order, including the sandbox-era test orders and this one | **No**: `SUM(total_amount_paid)` is gross; after the refund the $1 stays as revenue | `date_trunc('week', created_at)` in the session zone, which is **UTC**. Weeks start Monday 00:00 UTC (Sunday 19:00/20:00 ET). The order is 20:41 ET Tuesday, so the week is the same either way; a Sunday-evening ET order would land a week late. No code reads this view (`grep`: none in `backend/src` or `frontend/src`). |
| `v_customer_bag_attribution` | ✅ line `239be7c4…`, coffee 2917, manual, drinker Dana, attribution **buyer**. It is a house order with `intended_for_user_id` = buyer, and there is no bag claim. | `order_line_item`, `"order"`, `coffee_sku`, `user_profile`, `customer_bag_claim`, `v_household_membership` | **No** | **No**: a refunded bag still counts as drunk | None. |
| `v_customer_timeline` | ✅ one `order_line` at 01:41:04.836Z, `ref_id` = line, detail {order_id, attribution buyer, order_kind manual, `blend_name` "Fabricator House Roast"} | Order branch: `order_line_item`, `"order"`, `coffee_sku`, `v_coffee`, `v_customer_bag_attribution`, `v_customer_identity`. Other branches: quiz, feedback, brew profile, dial, bag claim, Liam, identity link. | **No** | **No** | Raw `o.created_at`, ordered by `occurred_at`, no grouping. Note: the detail carries `coffee_sku.blend_name` (the internal blend), not the line's `display_name` ("Quieta Non Movere"). |
| `v_palate_evidence` | ✅ in Dana's row: `n_attributed_lines` 2, `n_distinct_coffees` 2, `last_order_at` = this order | `v_customer_bag_attribution`, `order_line_item`, `"order"`, `v_customer_identity`, `v_customer_quiz_current`, `v_customer_feedback_current`, `customer_liam_question` / `_reply` / `_recommendation`, `v_customer_brew_profile` | **No** | **No**: the refunded line stays in the counts and in `last_order_at` | Raw min/max of `created_at`, no grouping. |
| `v_household_numbers` | ✅ counted: `house_orders` 2, `bags_per_house_order` 1.50 (household `22cbcdf2…` has 2 orders) | `household`, `household_member`, `household_member_status`, `"order"`, `order_line_item`, `quiz_session`, `user_profile`, `user_type`, `customer_identity_link` / `_unlink` | **No** | **No** | None. |

### What this means

1. **Every table the order should touch holds its row, and the values agree:**
   - $1 / $0 / $0;
   - one bag;
   - live ids end to end.
2. **After the refund, only `v_order_status` will know.** It is the only view that reads `order_event`.
   - `v_orders_weekly` keeps $1 revenue and 1 order.
   - The attribution, timeline and palate views keep Dana's bag as drunk.
   - `v_household_numbers` keeps the house order.
   - No view filters on `payment_status`. The same holds for every sandbox test order still on prod (test data stays).
   - Proposed follow-up, not done here: these views should count only paid, not-fully-refunded orders by joining `v_order_status`. `v_orders_weekly` should show gross and refunded cents side by side. The refund lives in `order_event`, not on `"order"` (D11).
3. **`"order".transaction_fee` is NULL.** `checkoutService.paymentDetails` reads the fee from the charge's balance transaction at webhook time. Link had not settled it yet: Stripe's `charge.updated` came at 01:42:21, 77 s later. Stripe shows fee 33, net 67. Nothing fills it in later: `charge.updated` is not subscribed or handled. This is not new: of the 6 Stripe orders on prod, **5 have a NULL fee** and 1 has one.
4. **The weekly view groups by UTC weeks.** Every other date the business reasons in is Eastern: the subscription cycle, `todayEastern`, and the 06:00 America/New_York scheduler job.
5. **The gate order in reporting:** this $1 order and its $28 line discount will be in any revenue or discount sum. The gate leaves no marker on the order. It can be told apart only by its `checkout_session` falling between the gate's `since` (2026-11-17 18:54Z) and its supersede, with the buyer email equal to the gate email.

### `BUSINESS_TZ` and G2.1

`subscriptionService.ts:28` has `export const BUSINESS_TZ = 'America/New_York'`. It is used in `todayEastern()` and interpolated into SQL at `:256` (`AT TIME ZONE '${BUSINESS_TZ}'`). The same literal is repeated in:
- `householdEmails.ts:126`;
- `householdReads.ts:304`;
- the Cloud Scheduler job's time zone;

and is absent from `v_orders_weekly`. G2.1: a switch like this lives in a table and is read at runtime.

**Proposal:** a `commerce_parameter` text row, not a new table. `commerce_parameter` already holds the business-wide commerce settings, with its one writer and the admin card. Among the existing parameter tables (`evidence_`, `brew_`, `household_`, `commerce_parameter`), it is the one whose readers (the subscription engine, checkout, the order views) use the zone.
- **Row:** `business_time_zone` = `America/New_York`, note "Format: iana time zone."
- **Format check:** a new `FORMAT_CHECKS` entry that accepts a zone `Intl.DateTimeFormat` resolves. Editable on `/admin/commerce`.
- **Code:** `todayEastern()` becomes `todayBusiness()` and reads `commerceParamText('business_time_zone')` (60 s cache). Two consequences:
  - It turns async, so `checkoutService`, `subscriptionRenewal` and the tests follow.
  - The SQL at `:256` takes the value as a bound parameter (`AT TIME ZONE $n`), not by string interpolation.
- **Household emails** (`householdEmails`, `householdReads`) read the same row.
- **`v_orders_weekly`** (and any view that groups dates) joins the current row: `date_trunc('week', o.created_at AT TIME ZONE tz.value_text)`.
- **Cloud Scheduler:** its job time zone stays a deploy setting. It is named in the row's note so the two change together.

This should be its own small brief, since it changes a function signature the subscription engine calls throughout, and needs tests.

Seen while tracing, same rule: `orderFinalizer` uses `getSommelierConfig()?.tokenEconomy?.orderBonus ?? 10`. The number lives in config, but the `10` fallback is typed in code.

### Timestamps (G2.9)

Every timestamp for the order is listed in `tmp/commerce4_ts_ro.ts`. That is 34 values across 14 tables, read on prod in UTC, with types and defaults from `information_schema`.

- **Columns without a time zone:** none. All are `timestamptz`.
- **Values not in UTC:** none.
- **Paid → finalized:** 61 ms (`order_event` 22 at 01:41:04.836 → 23 at 01:41:04.897).
- **Webhook received → processed:** 2.0 s.

Two flags:

- **Flag A: the G2.9 default is the riskier form for `timestamptz`.**
  - G2.9 says `created_at` / `updated_at` default to `timezone('utc', now())`. That expression returns a timestamp *without* time zone, and Postgres reads it back in the session's `TimeZone`.
  - It is correct today only because every prod connection runs in UTC: `db/client.ts` sets nothing, and the prod setting is UTC.
  - Proof on this order: `"order".created_at` and `order_line_item.created_at` (that default) equal `order_event` 22 (`now()`) to the millisecond, in the same transaction.
  - A connection set to `America/New_York` would store those rows 5 hours late. Plain `now()` is correct in any session.
  - On this order's path, seven tables already use `now()`: `order_event`, `checkout_session`, `checkout_session_line`, `stripe_event`, `token_events`, `user_tokens`, `beat_event`.
  - Proposal, for Dana: amend G2.9 to "default `now()` on `timestamptz`" rather than move those tables to the current wording. The existing `timezone('utc', now())` defaults (on `"order"`, `order_line_item`, `user_profile`, `transactional_email_log`, `user_lifecycle_state`, `customer_dial_event` here) change in their own brief.
- **Flag B: `user_profile.updated_at` is bumped by a read.**
  - The Stripe customer replacement (01:40:19, `stripe.ts:86`) set `updated_at = now()`.
  - At 01:42:48.887, `GET /api/users/profile` ran its upsert (`users.ts:72-74`, `INSERT … ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()`) and moved it to 01:42:48.943 (Cloud Run request log).
  - Every profile load does this, so the column cannot say when the profile last changed.
  - The replacement is still recorded in the Cloud Run log and in the live customer's metadata (`replaced_customer_id`).
  - Proposal: the upsert's conflict branch should not touch `updated_at`, e.g. `DO NOTHING` followed by a select. That is its own small change, with a test.
- **Note:** `now()` is the transaction's start time. Every write in the webhook transaction shares 01:41:04.836, though `stripe_event.received_at` is 197 ms earlier.
