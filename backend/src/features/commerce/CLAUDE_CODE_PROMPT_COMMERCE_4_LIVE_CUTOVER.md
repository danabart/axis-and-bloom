# Claude Code brief — Commerce 4: Live cutover

Workstream: commerce (`README.md`) · Written 2026-11-04 by the CTO session after Commerce 1–3 passed Part E on prod in test mode (`CLOSING_REPORT_3.md`) · Touches real money: strongest model, dedicated session, **Dana in the session for every step after Task 0** · OT-64.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches: G2.1 nothing hard-coded (nothing new; `commerce_parameter` rows reviewed) · G3.6 secrets in Secret Manager only; third parties go live only in a brief of their own with Dana saying "live" · G3.4 scheduler jobs listed in `MANUAL_SETUP_IDS.md` · G3.8 lints green before push · G1.6 push is deploy, one closing report.
Mode: **test → live**. STOP points: after Task 0; after Part B (before the key swap); after Part D step 1 (before the $1 purchase); before removing the pre-launch gate (not this brief).

**Goal.** Move Stripe from the sandbox to the live account with no code change: the same deploy, three different secrets, the Dashboard settings recreated in the live account, one real $1 purchase and refund as the gate. The pre-launch curtain stays up; going live with Stripe is not the same as launching the site.

**Why no code changes:** mode is derived from the key prefix at boot (`[stripe] mode=live`); prices, shipping, discounts and the tax switch are `commerce_parameter` rows that already hold the launch values; the webhook handler, finalizer, renewal cron and admin pages are identical in both modes.

---

## Task 0 — Verify (into `CLOSING_REPORT_4.md`; STOP after)
1. Boot log of the current prod revision shows `[stripe] mode=test`; `deploy.yml` passes `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` from Secret Manager and `VITE_STRIPE_PUBLISHABLE_KEY` as a build env; note where the publishable key is set (workflow env or repo variable).
2. `commerce_parameter` current rows on prod: `shipping_fee_cents` 595, `free_shipping_min_bags` 2, `tax_collection_enabled` 0, the two subscription discounts 5/10, `subscription_frequency_weeks` 2,4,6, `admin_alert_email`, `stripe_tax_code_coffee` txcd_41050006, `stripe_tax_code_shipping`. List them; flag any that differ.
3. `MANUAL_SETUP_IDS.md` Stripe section: the sandbox webhook id `we_1UWaPO0QYxZQN6jDi2Y9lp6q` (10 events), the `subscription-daily` scheduler job, the sandbox settings done on 2026-10-31 (tax category, NJ registration, payment methods Cards/Apple Pay/Google Pay/Link, branding colors, receipts off, retry schedule Smart Retries 8×/2 weeks).
4. Test-mode data on prod: `+checkout1`'s 4 orders, 1 canceled subscription, events, shipment row. They stay (nothing deleted); confirm nothing in the app treats them as live (no payouts, no fulfillment emails pending).
5. Prod has no open test-mode invoice that would still be retried by the sandbox after the swap (the one from Commerce 2 local tests, OT-60: confirm it is voided or let it expire; the live webhook will not receive sandbox events anyway).
6. `PrelaunchGate`: confirm it stays as is; this brief does not change it.

## Part A — Dana activates the live account (Stripe Dashboard, "Switch to live account" → Activate)
Write this as a checklist in `MANUAL_SETUP_IDS.md` → Stripe → Live; Dana does it, Claude Code waits.
1. Business: Creative Box LLC, EIN, Union City NJ address, website axisandbloomcoffee.com, product description "roasted coffee sold online, one-time and subscription", MCC grocery/coffee if offered.
2. Representative: Dana's personal details (Stripe requires them; nothing is stored in our systems).
3. Bank account for payouts: the LLC's checking account. Payout schedule: leave Stripe's default (daily rolling, 2-day) unless Dana prefers weekly.
4. Public details: statement descriptor `AXIS & BLOOM COFFEE` (≤22 chars), shortened descriptor `AXIS&BLOOM`, support email `dana@axisandbloomcoffee.com`, support URL the site.
5. Wait for "Payments enabled" in the live Dashboard. This can take minutes to days.

## Part B — Live Dashboard settings (CTO session does these in Dana's browser; Claude Code records them)
In the **live** account, repeat the sandbox settings: Tax → preset category "Coffee Beans or Ground Coffee" (txcd_41050006), head office = LLC address, **NJ registration** ("I've already registered", sales tax, start today); Payment methods → only Cards, Apple Pay, Google Pay, Link; Payment method domains → `www.axisandbloomcoffee.com` registered for Apple/Google Pay (Checkout usually does this; verify); Branding → brand `#3a3c3e`, accent `#ca526d`, logo if available; Emails → successful-payment receipts off, refund receipts off; Billing → Manage failed payments → Smart Retries 8×/2 weeks, invoice left past-due after retries; Developers → Webhooks → new destination `axis-bloom-backend-live`, same URL `https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/webhooks/stripe`, API version `2026-09-30.endive`, the same **10 events** (checkout.session.completed / expired / async_payment_succeeded / async_payment_failed, charge.refunded, payment_intent.payment_failed, invoice.paid / payment_failed / marked_uncollectible / voided). Record the live webhook id in `MANUAL_SETUP_IDS.md`. STOP.

## Part C — Key swap (Dana + Claude Code)
1. Dana copies from the live Dashboard: `sk_live_…` (API keys), `whsec_…` (the live webhook's signing secret), `pk_live_…`.
2. Dana adds **new versions** of the two secrets in Secret Manager (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`); the test versions stay as older versions (nothing deleted; rollback = re-enable the previous version). Dana pastes the `pk_live_` value to Claude Code, which updates the build env in the same place Task 0 found.
3. Claude Code commits the `pk_live_` change plus `MANUAL_SETUP_IDS.md` and pushes. Boot log must show `[stripe] mode=live`. If it shows `test` or `disabled`, stop and check the secret versions.
4. Claude Code confirms the live webhook receives a test event (Dashboard → Send test event → `checkout.session.expired`) with a 200 and an `unknownSession` no-op in the ledger.

## Part D — The $1 gate (Dana buys, Dana refunds; real money, real card)
1. Claude Code adds a temporary `commerce_parameter` row `live_gate_override_cents` = 100 read only by `cartResolver` when the signed-in user is `admin_alert_email`'s account, so Dana's own one-bag checkout is priced at $1.00 with $0 shipping (shipping via a second temporary row `live_gate_free_shipping` = 1, same guard). Both rows are superseded to 0 at the end of this part; the code path stays, documented, for the next cutover. STOP before the purchase.
2. Dana, signed in as herself on `axisandbloomcoffee.com/bloom?preview=true`, buys one bag with her real card. Expect: Stripe live payment $1.00, order on `/admin/orders`, admin email, customer email, `[stripe] mode=live` in the log, Stripe balance +$1.00 minus fees.
3. Dana refunds it in full from `/admin/orders`. Expect: `charge.refunded` on the live webhook, "Refunded · Canceled", Stripe balance back to the fee delta.
4. Claude Code supersedes both override rows to 0 and shows the next checkout quotes full price.
5. Renewal path on live: no real subscription is created in this brief. The sandbox evidence from Commerce 2/3 stands; the first live renewal is watched when it happens (the daily job logs it).

## Part E — Rollback and runbook
`MANUAL_SETUP_IDS.md` → Stripe → Live → "Rollback": re-enable the previous (test) versions of the two secrets, set the `pk_test_` build env, redeploy; no DB change needed. Also record: live webhook id, which secret versions are live, the date, and that test-mode rows remain in prod with `stripe_*` ids starting with the test prefixes (an admin filter is OT-NN if Dana wants one).

## Part F — Docs and closing
`WHAT_WE_BUILT.md` entry "Commerce 4: live cutover" (date, what changed, what did not). `OPEN_TASKS.md`: close OT-64; add "first live renewal watched" with the expected date if a live subscription exists; ShipStation adapter stays open. `README.md` here: status line "LIVE since <date>". `CLOSING_REPORT_4.md`: Task 0 findings, every Dashboard setting with who did it, the key-swap timestamps, the $1 purchase and refund ids, boot log lines. No `comments.sql` change unless Part D's parameter rows need notes (they do: add them).
