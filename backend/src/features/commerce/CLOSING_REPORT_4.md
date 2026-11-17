# Closing report — Commerce 4: live cutover

Brief: `CLAUDE_CODE_PROMPT_COMMERCE_4_LIVE_CUTOVER.md` · Session 2026-11-16 · Base commit `9473f75` (main; prod rev `00864-vpp`). `DEVELOPMENT_GUARDRAILS.md` read before Task 0.

Status: **Task 0 done; STOPPED before the push** (Dana). Parts A and B were done before this session: A by Dana, B by the CTO session. They are recorded in `MANUAL_SETUP_IDS.md` → Stripe → Commerce 4.

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
