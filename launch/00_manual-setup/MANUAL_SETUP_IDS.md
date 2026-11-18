# Marketing Manual Setup — IDs & Accounts (created 2026-07-17)

All created under danabar.mail@gmail.com. These are the values the numbered prompts (esp. Step 02) need.

## Analytics & Ads IDs

| What | Value |
|------|-------|
| **GA4 Measurement ID** | `G-GYC50VYRYN` |
| GA4 account / property | "Axis & Bloom" / "Axis & Bloom Website" (NY time, USD) |
| GA4 web stream | "Axis & Bloom Web", stream id `15277059820` |
| **Meta Pixel ID** | `945138695260153` (dataset "Axis and Bloom Pixel") |
| Meta business portfolio | "Axis and Bloom", business_id `1347053896963249` |
| Meta ad account | "Axis and Bloom Ads", id `2545676339186168` (NY, USD) |
| Meta domain asset | axisandbloomcoffee.com, asset id `2406778309814992` |

Neither the GA4 tag nor the Pixel base code is installed on the site — **Step 02 wires both in** via env config. Paste into the Step 02 command: GA4 id `G-GYC50VYRYN`, Pixel id `945138695260153`.

## Mailchimp

- Datacenter **us11**; audience **"Axis & Bloom"**, audience id `a5940f849b` (matches `MAILCHIMP_LIST_ID` in GCP Secret Manager, project axis-and-bloom-prod).
- Email domain `axisandbloomcoffee.com` verified (via hello@); DKIM authenticated (k2/k3 `_domainkey` CNAMEs → `dkim2/dkim3.mcsv.net`, added automatically by Entri into Namecheap).
- Default from: **Axis & Bloom <hello@axisandbloomcoffee.com>** (hello@ and dana@ forward to Dana's Gmail via Namecheap Private Email).
- Footer mailing address set (LLC address, Union City NJ) — CAN-SPAM requirement done.
- **Prod sync verified 2026-07-17** end-to-end: homepage newsletter signup → backend → Mailchimp audience (test contact `danabar.mail+mailchimptest@gmail.com`, safe to archive). `test-mailchimp.mjs` not needed.

## DNS (Namecheap BasicDNS — Advanced DNS tab)

- Pre-existing, do not touch: TXT `v=spf1 include:amazonses.com ~all` (Resend), TXT `hosting-site=axis-and-bloom-prod`.
- Added by Entri (Mailchimp DKIM): CNAMEs `k2._domainkey`, `k3._domainkey`.
- TXT at host `@`: `facebook-domain-verification=rs1ltv26wyfqr0nuhob59r7tpnxnsd` — added 2026-07-17, domain **Verified** in Meta.

## People & access

- Camila (camilamarchon@gmail.com) invited to the Meta portfolio as full-access admin — invite expires ~2026-08-16. After accepting she should create the **Facebook Page from inside Business settings** (portfolio-owned) and connect the Instagram account.
- GA4 access: only Dana so far (add Camila later if she'll read reports directly; Looker Studio dashboard is the plan of record).

## Stripe (Commerce 1, added 2026-10-31)

Brief: `backend/src/features/commerce/CLAUDE_CODE_PROMPT_COMMERCE_1_CHECKOUT.md` (Task 0.5). **Test mode only** through Commerce briefs 1–3; live keys only in brief 4, with Dana in the session. No `STRIPE_*` value is ever written into the repo, this file included. Record only that the value exists and where it lives.

| # | Step | Owner | Status |
|---|---|---|---|
| 1 | Stripe Dashboard, **test mode**: Developers → API keys → copy `pk_test_…` and `sk_test_…` | Dana | ⏳ |
| 2 | Developers → Webhooks: endpoint `https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/webhooks/stripe`, events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `payment_intent.payment_failed`; copy `whsec_…`. Sandbox endpoint `we_1UWaPO0QYxZQN6jDi2Y9lp6q`, API version `2026-09-30.endive` | CTO session | ✅ 2026-10-31 |
| 3 | Settings → Tax: Stripe Tax enabled, origin Union City NJ, NJ registration; preset product category "Coffee Beans or Ground Coffee" (`txcd_41050006`). Head-office address waits for live activation | CTO session | ✅ 2026-10-31 (product category only) |
| 4 | Settings → Emails: Stripe successful-payment receipts **off** (ours go through Resend) | CTO session | ✅ 2026-10-31 |
| 4b | Settings → Public details: statement descriptor `AXIS & BLOOM COFFEE`, support email `dana@axisandbloomcoffee.com`, bank account | Dana | ⏸ live-account settings, deferred to brief 4 |
| 5 | Settings → Branding: brand colors from `misc/design_documents` (styles Embedded Checkout); no logo yet | CTO session | ✅ 2026-10-31 (colors only) |
| 6a | GCP Secret Manager (`axis-and-bloom-prod`): create `STRIPE_SECRET_KEY` (the `sk_test_…`) and `STRIPE_WEBHOOK_SECRET` (the `whsec_…`) | Dana | ⏳ (not present at 2026-10-31 07:35) |
| 6b | Add both to `deploy.yml --set-secrets` | Claude Code, Part F | ⏳ |
| 6c | Frontend build env `VITE_STRIPE_PUBLISHABLE_KEY` (the `pk_test_…`; publishable, safe in the build) | Dana gives the value; Claude Code wires it into `deploy.yml` | ⏳ |

Secret Manager (PowerShell, in your own terminal; you paste the value at the prompt, so it never sits in shell history). It writes through a temp file with no trailing newline, because piping a PowerShell 5.1 string adds a CRLF that would corrupt the key:
```
$f="$env:TEMP\s.txt"; [IO.File]::WriteAllText($f,(Read-Host "sk_test value")); gcloud secrets create STRIPE_SECRET_KEY --project axis-and-bloom-prod --data-file=$f; Remove-Item $f
$f="$env:TEMP\s.txt"; [IO.File]::WriteAllText($f,(Read-Host "whsec value"));   gcloud secrets create STRIPE_WEBHOOK_SECRET --project axis-and-bloom-prod --data-file=$f; Remove-Item $f
```
(Or create them in the Console: Secret Manager → Create secret.)
The Cloud Run runtime service account needs `roles/secretmanager.secretAccessor` on both. It already has it project-wide if the other secrets resolve; that gets checked before the deploy that adds them.

**Stripe Tax is off at launch** (Dana, 2026-10-31): `commerce_parameter.tax_collection_enabled` = 0, since NJ exempts packaged coffee and there is no nexus in any other state (Tax Basic costs $0.50 per transaction). To turn it on when a state requires it:
1. Stripe Dashboard → Tax → Registrations: add the state's registration (in the same mode, test or live, as the keys in use).
2. `/admin/commerce`: set `tax_collection_enabled` to 1. The next checkout and the next renewal invoice compute tax; no deploy.

Fees on this account (Settings → Plans and fees, 2026-10-31): Payments 2.9% + 30¢ per domestic card charge; Invoicing Starter 0.4% per paid one-time invoice, no cap; Tax Basic $0.50 per API transaction; Billing 0.7%, not used.

Mode (test/live) is derived from the key prefix at boot and logged once as `[stripe] mode=test|live|disabled`. Without `STRIPE_SECRET_KEY`, checkout answers 503 `checkout_unavailable` and the cart shows the "not live yet" copy.

### Commerce 2 — subscriptions (added 2026-10-31)

Brief: `backend/src/features/commerce/CLAUDE_CODE_PROMPT_COMMERCE_2_SUBSCRIPTIONS.md` (Task 0.5). Still **test mode only**. Renewals are Stripe one-off invoices that our daily cron creates. There are no Stripe Billing subscription objects, so none of the Dashboard's subscription settings apply.

| # | Step | Owner | Status |
|---|---|---|---|
| 1 | Sandbox webhook endpoint `axis-bloom-backend-test` (`we_1UWaPO0QYxZQN6jDi2Y9lp6q`): add the events `invoice.paid`, `invoice.payment_failed`, `invoice.marked_uncollectible`, `invoice.voided` (keep the six Commerce 1 events) | Dana / CTO session | ✅ 2026-10-31 (Dana). **Endpoint disabled 2026-11-17 by the CTO session** at the live cutover (OT-60 closed); re-enable it only to run sandbox events against prod. |
| 2a | Settings → Billing → **Automatic collection** (one-off invoices): note the retry schedule for a failed charge (Smart Retries, or the default schedule) and what happens after the last retry (leave open / mark uncollectible / void). `invoice.marked_uncollectible` lapses the subscription; leaving it open lets our own lapse (`subscription_past_due_lapse_days`, 21) void it | Dana | ✅ 2026-10-31 (Dana: Billing → Manage failed payments → Card payments: Smart Retries, up to 8 times within 2 weeks; after the last retry the invoice is left past-due, not marked uncollectible, so our 21-day lapse voids it) |
| 2b | Settings → **Emails**: Stripe's "failed payment" and "upcoming invoice / renewal reminder" customer emails stay **off**, and so do invoice emails to customers ("Email finalized invoices to customers"). Ours go through Resend | Dana | ✅ 2026-10-31 (Dana: failed payment, reminders, finalized invoices off) |
| 3 | Cloud Scheduler job `subscription-daily`, after the Commerce 2 deploy (command below) | Dana | ✅ 2026-10-31 (created by Claude Code on Dana's go; manual run 22:29:50Z → 200, rev 00809: `lapsed 0, upcoming 0, charged 0, declined 0, unresolved 0, skipped 0, already 0, errors 0`; first scheduled run 2026-11-01 06:00 ET) |

Step 3, in PowerShell (the header value comes straight from Secret Manager, so it is never typed or shown). The schedule is 06:00 US Eastern, matching `commerce_parameter.subscription_charge_hour_local` = 6, which is informational only. Change both together.
```
$env:CLOUDSDK_PYTHON = "C:\Python313\python.exe"; $s = (gcloud secrets versions access latest --secret=CRON_SECRET --project=axis-and-bloom-prod); gcloud scheduler jobs create http subscription-daily --schedule="0 6 * * *" --time-zone="America/New_York" --uri="https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/cron/subscription-daily" --http-method=GET --headers="x-cron-secret=$s" --attempt-deadline=600s --project=axis-and-bloom-prod --location=us-central1; Remove-Variable s
```
Check: `gcloud scheduler jobs run subscription-daily --location=us-central1 --project=axis-and-bloom-prod`. The Cloud Run log should then show `[cron/subscription-daily]` with counts and a 200. The job is safe to run twice a day: a cycle already attempted is skipped.

Stripe Invoicing fee, confirmed on this account (Dana, 2026-10-31): Starter, 0.4% per paid one-time invoice, no cap. Each renewal also pays the card fee (renewal `in_1UWgMi0QYxZQN6jD3b3e7vlF`, $33.50: $1.27), and the Stripe Tax fee only while `tax_collection_enabled` = 1 (all fees: Stripe section above).

Note (Task 0, 2026-10-31): `sponsored-subscription-check` and `expire-company-gift-codes` still have no scheduler jobs (OT-13). `gcloud scheduler jobs list` shows only `purge-stale-anonymous-guests`, `liam-gate-offline` and `coffee-content-backfill`.

### Commerce 4 — Live (added 2026-11-16)

Brief: `backend/src/features/commerce/CLAUDE_CODE_PROMPT_COMMERCE_4_LIVE_CUTOVER.md`. Live account `acct_1UVxa425hnyYIAkS`. Settings re-read through the live API by Claude Code on 2026-11-16 (read-only, `backend/tmp/commerce4_stripe_live_ro.ts`).

**Part A: live account activation (Dana)**

| # | Step | Owner | Status |
|---|---|---|---|
| A1 | Business: Creative Box LLC, EIN, Union City NJ address, website, product description | Dana | ✅ 2026-11-16 |
| A2 | Representative details | Dana | ✅ 2026-11-16 |
| A3 | Payout bank account (LLC checking), Stripe default payout schedule | Dana | ✅ 2026-11-16 (API: `payouts_enabled` true) |
| A4 | Public details: statement descriptor, support email, support URL | Dana | ✅ 2026-11-16 (API: descriptor `AXIS AND BLOOM COFFEE`; the brief proposed `AXIS & BLOOM COFFEE`) |
| A5 | "Payments enabled" | Stripe | ✅ 2026-11-16 (API: `charges_enabled` true) |
| A6 | Radar: Radar Lite (the default rules) | Dana | ✅ 2026-11-16 |

**Part B: live Dashboard settings (CTO session, in Dana's browser)**

| # | Setting | Owner | Status |
|---|---|---|---|
| B1 | Tax: preset category "Coffee Beans or Ground Coffee" (`txcd_41050006`), copied from the sandbox; head office Union City NJ | CTO session | ✅ 2026-11-16 (API: tax settings active, default `txcd_41050006`, head office Union City) |
| B2 | Tax registration: NJ, state sales tax | CTO session | ✅ 2026-11-16 (API: US/NJ `state_sales_tax`, active) |
| B3 | Payment methods: Cards, Apple Pay, Google Pay, Link only | CTO session | ✅ 2026-11-16 (API: default config `pmc_1UVxad25hnyYIAkSjEaHhGqo` = apple_pay, card, google_pay, link) |
| B4 | Payment method domains: `www.axisandbloomcoffee.com` for Apple Pay / Google Pay | Claude Code (Dana's go, decision 5) | ✅ 2026-11-18: **`pmd_1UcyX925hnyYIAkSYRFkPcBK`**, registered through the live API (`backend/tmp/commerce4_pm_domain.ts`). Apple Pay, Google Pay, Link and PayPal all `active`; Stripe verified Apple Pay without a domain association file, so no static route was added. The apex `axisandbloomcoffee.com` is not registered. |
| B5 | Branding: brand `#3a3c3e`, accent `#ca526d`, copied from the sandbox | CTO session | ✅ 2026-11-16 (API: primary `#3a3c3e`, secondary `#ca526d`) |
| B6 | Emails: successful-payment and refund receipts off | CTO session | ✅ 2026-11-16 |
| B7 | Billing → Manage failed payments: Smart Retries, up to 8 times within 2 weeks, invoice left past-due | CTO session | ✅ 2026-11-16 |
| B8 | Webhook `axis-bloom-backend-live`: **`we_1UcTtB25hnyYIAkSqQmkzKQR`**, URL `https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/webhooks/stripe`, API `2026-09-30.endive`, the same 10 events as the sandbox (`checkout.session.completed` / `expired` / `async_payment_succeeded` / `async_payment_failed`, `charge.refunded`, `payment_intent.payment_failed`, `invoice.paid` / `payment_failed` / `marked_uncollectible` / `voided`) | CTO session | ✅ 2026-11-16 (API: enabled, 10 events) |

**Secrets (Secret Manager, `axis-and-bloom-prod`)**

| Secret | Live version | Test version |
|---|---|---|
| `STRIPE_SECRET_KEY` | v2, created 2026-11-16 18:30 UTC, a **restricted key** (`rk_live_`, full access except sensitive operations) | v1 (2026-10-31), **disabled** |
| `STRIPE_WEBHOOK_SECRET` | v2, created 2026-11-16 18:35 UTC (the live endpoint's signing secret) | v1 (2026-10-31), **disabled** |
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` in `deploy.yml` (frontend build env; publishable) | `pk_test_51UVkXO…` |

`deploy.yml` maps both secrets as `:latest`. Rollback: re-enable v1 of both secrets, disable v2, set the `pk_test_` value back in `deploy.yml`, push (redeploy). No DB change.

The `subscription-daily` scheduler job is unchanged by the cutover (same URL, same secret).

**Live since 2026-11-17** (rev `00869-6z8`, `[stripe] mode=live`; publishable key `pk_live_` since that deploy). The $1 gate:
- purchase on 2026-11-18 01:41 UTC: order `0b6ac7e9-3e0a-45f8-9de5-4ceb51ade2b4`, `pi_3Ucxrr25hnyYIAkS14flyHRq`;
- refunded at 02:18 UTC;
- gate rows back to 0 / 0 / empty at 02:22 UTC.

Evidence is in `CLOSING_REPORT_4.md`.

**Rollback (Part E), full steps:**
1. In Secret Manager, re-enable v1 of `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` and disable v2. Both are mapped `:latest`, so the next instance that starts boots test.
2. Set the `pk_test_51UVkXO…` value back in `deploy.yml` (the rollback value is in the comment there) and push. This redeploys and rebuilds the frontend.
3. Check that the boot log shows `[stripe] mode=test` and that the bundle on `axis-and-bloom-prod.web.app` has `pk_test_`. `www` answers 403 to curl (Cloudflare), so check the bundle there.
4. No DB change.
   - Any live `cus_` id saved on a profile is replaced by a sandbox customer on that user's next checkout (`stripe.getOrCreateStripeCustomer`: a `resource_missing` answer means a new customer, and the old id goes into its metadata). Going back to live repeats this in the other direction.
   - Live orders keep their live ids. In the sandbox, refunds of live orders cannot be made from `/admin/orders`; refund them in the live Dashboard after switching back.

**Test-mode rows remain on prod**, and are not deleted. These are `+checkout1`'s orders, Dana's Commerce 2/3 orders, subscriptions and events, and the Household test subscription `b0b6b130` (canceled on 2026-11-17, source admin, note "sandbox card, live cutover"). Their Stripe ids are sandbox ids (`cs_test_`, `pi_` / `in_` of the sandbox account, `evt_` with `livemode` false). Live rows are told apart by `stripe_event.payload->>'livemode'` and by date (after 2026-11-17 15:13 UTC). No admin filter exists; OT-145 if Dana wants one.

**The $1 gate stays in code for the next cutover:** `cartResolver.applyLiveGateOverride` plus the `commerce_parameter` rows `live_gate_override_cents`, `live_gate_free_shipping` and `live_gate_override_email`, all seeded off. To use it:
- set the email, then shipping, then cents (cents last turns it on) through `/admin/commerce` or `setParameter`;
- it prices one-time checkouts only;
- supersede the rows back to 0 / 0 / empty when done (cents first).

## Open before ads warm-up (~Aug 3)

1. ~~Meta domain verification~~ ✅ done 2026-07-17.
2. Ad account payment method (Dana, in Billing & payments).
3. Facebook Page created + Instagram connected (Camila, post-invite).
