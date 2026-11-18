# Claude Code brief — Commerce 5: Reporting and bookkeeping

Workstream: commerce (`README.md`) · Written 2026-11-17 by the CTO session from the order trace in `CLOSING_REPORT_4.md` ("Order data trace", flags A and B) and OPEN_TASKS OT-145 to OT-151 · No money path changes; read side and bookkeeping only · Dana runs it; push = deploy.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (parameters: `commerce_parameter` rows `business_time_zone`, `order_bonus_tokens`) · G2.2 surrogate id · G2.4 CATALOG.md checked (why nothing fits: see Part A) · G2.5 one writer (`checkoutService` for `"order"` columns; `commerceParameters` for rows; views have none), one read path (`v_order_reportable` becomes the read path for every revenue or bag count) · G2.8 additive schema + a dated backfill script · G2.9 timestamps (this brief amends the rule's wording, Part E) · G2.13 state in events · G2.17 comments.sql → catalog:md · G3.3 idempotent cron · G3.9 reuse · G1.6 push is deploy, one closing report.
Mode: live (Stripe is live since 2026-11-17; nothing here calls Stripe except the fee backfill, read-only). STOP points: after Task 0; before running the backfill script on prod.

**Goal.** Every revenue, order-count or "bags this customer has" number reads one shared view of real orders: live mode, paid, refunds netted, grouped in the business time zone. Test-mode and gate orders stay in the database (nothing deleted) but are marked and excluded from reports. Stripe's fee lands on every order. The three hard-coded values found in the trace become data. `user_profile.updated_at` means what it says.

**Decisions (Dana 2026-11-17 unless marked CTO):**
1. Test and refunded orders are never deleted; they are excluded from reports by a marker and by status.
2. (CTO) The marker is `"order".stripe_mode` (`test | live`) set at insert from `stripeMode()`; backfilled once: every order created before the live cutover (first live revision 00869, 2026-11-17 17:35 UTC) is `test`. The $1 gate order is `live` and fully refunded, so it is excluded by status, and its `live_gate` event marks it.
3. Reportable = `stripe_mode = 'live'` AND latest payment status in (`paid`, `partially_refunded`); a partially refunded order counts with net revenue; a fully refunded order does not count. Bags for palate purposes: a fully refunded order's bags are not the customer's bags.
4. Business time zone is a parameter, `America/New_York` today, read by code and by the reporting view. The Cloud Scheduler job's time zone is noted beside it in `MANUAL_SETUP_IDS.md` so the two change together.
5. (CTO) G2.9 amended: `created_at` / `updated_at` default to plain `now()` on `timestamptz` columns; existing `timezone('utc', now())` defaults are left until a table is touched for another reason. Pending Dana's yes; if no, skip Part E.

---

## Task 0 — Verify (into `CLOSING_REPORT_5.md`; STOP after)
1. Views that read `"order"` or `order_line_item` (from `schema.sql`): `v_order_status`, `v_orders_weekly`, `v_customer_bag_attribution`, `v_customer_timeline`, `v_palate_evidence`, `v_palate_recommendation_outcome`, `v_customer_calibration`, `v_household_numbers`, plus any `v_palate_*` that reads `v_customer_bag_attribution`. For each: who reads it (comments.sql Readers), whether it filters payment status today (expect: only `v_order_status`), and where the join to orders is.
2. `BUSINESS_TZ` / `todayEastern()` users: `subscriptionService.ts`, `subscriptionRenewal.ts`, `checkoutService.ts`, `householdEmails.ts`, `householdReads.ts` (+ tests). List each call site.
3. `orderFinalizer.ts:71` bonus fallback `?? 10`; `getSommelierConfig().tokenEconomy.orderBonus` lives in Firestore config (G2.15: rules belong in Postgres). Decide in the report: the parameter row becomes the source and the Firestore key is read no more (preferred), or the row is only the fallback.
4. `checkoutService.paymentDetails()` expands `latest_charge.balance_transaction`; confirm why `transaction_fee` was null on 5 of 6 orders (balance transaction not yet attached at webhook time, or renewal orders created from invoices without a payment intent expand). Note which path each of the 6 orders took.
5. `routes/users.ts:74` `ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()` on a GET; list every other place that bumps `user_profile.updated_at` without changing a value.
6. Prod, read-only: orders by `created_at::date`, payment status (via `v_order_status`), `transaction_fee IS NULL`, and whether `stripe_payment_intent_id`/`stripe_invoice_id` resolve in live or test Stripe (an id created in test mode returns "No such …" against the live key: use that to confirm the backfill cutoff rather than the date alone).

## Part A — Schema (`schema.sql` additive, `comments.sql`, `catalog:md`)
Why nothing fits: `v_order_status` is per-order current state and must stay that way; the reporting filter needs a view that composes it with mode and net revenue; no existing view does that. The marker needs a column on the fact, not a new table.
- `"order"` add `stripe_mode TEXT REFERENCES commerce_stripe_mode(code)` (new lookup `commerce_stripe_mode`: `id`, `code UNIQUE`, `label`; seed `test`, `live`). NOT NULL only after the backfill; the seed leaves it nullable with a boot integrity check reporting NULLs.
- `order_event_kind` seed `live_gate` (used by Part D of Commerce 4 retroactively: one event on order 0b6ac7e9, source admin, note "Commerce 4 $1 gate purchase", written by the backfill script).
- `commerce_parameter` seed if missing: `business_time_zone` (text, `America/New_York`, note: IANA zone; the Cloud Scheduler job `subscription-daily` must match), `order_bonus_tokens` (10, Range: 0–100).
- New view **`v_order_reportable`**: one row per order with `order_id`, `user_id`, `stripe_mode`, `paid_at`, `paid_on_business_date` (`paid_at AT TIME ZONE business_time_zone` → date, the zone read from `commerce_parameter` inside the view), `gross_cents`, `refunded_cents`, `net_cents`, `bag_count`, `is_subscription`, `payment_status`, and `is_reportable` boolean per decision 3. Readers: every reporting and palate view below.
- **`v_orders_weekly`** rewritten over `v_order_reportable` where `is_reportable`: week = `date_trunc('week', paid_on_business_date)`, `orders`, `new_customers` (first reportable order), `gross_cents`, `refunded_cents`, `net_cents`, `subscription_orders`. Keep the column names Looker already uses where they exist; add the new ones.
- `v_customer_bag_attribution`, `v_customer_timeline`, `v_palate_evidence`, `v_palate_recommendation_outcome`, `v_customer_calibration`, `v_household_numbers`: join `v_order_reportable` and keep only `is_reportable` orders. Test-mode bags disappear from customers' palate data; fully refunded bags too. Partial refunds keep the bags.
- Comments for everything; `catalog:md`.

## Part B — Backend
- `commerceParameters`: `businessTimeZone()` (cached, validated against `Intl.supportedValuesOf('timeZone')` on write). `todayEastern()` → `todayBusiness()` async, reading it; every call site from Task 0.2 updated; SQL that embedded the literal takes it as a bind parameter.
- `checkoutService`: set `stripe_mode` on insert for one-time and renewal orders (`stripeMode()` at insert time).
- `orderFinalizer`: bonus from `commerceParam('order_bonus_tokens')`; the Firestore key is no longer read (or per Task 0.3 decision).
- Fee: `services/stripeFeeSync.ts` + a step in `subscription-daily` (rename the cron's internal name to `commerce-daily` only in docs if you prefer; keep the route path, the scheduler job is already created): for every live order with `transaction_fee IS NULL` and a payment intent or invoice older than 10 minutes, fetch the balance transaction (payment intent → latest charge → balance_transaction; invoice → payments → payment intent) and write `transaction_fee` through `checkoutService.setTransactionFee(orderId, feeCents)` (one writer; records an `order_event` kind `fee_recorded`, seed it, with the cents in the note). Idempotent; test orders skipped (their ids don't resolve live).
- `routes/users.ts`: the GET upsert stops touching `updated_at` (`DO UPDATE SET updated_at = user_profile.updated_at` or `DO NOTHING` + re-select; keep the RETURNING). Any other read-path bump from Task 0.5 the same.

## Part C — Backfill (`backend/src/db/migrations/commerce_2026_11_17_stripe_mode.sql`, STOP before running on prod)
Sets `stripe_mode` from the Task 0.6 evidence (ids that resolve live → `live`, else `test`), writes the `live_gate` event on 0b6ac7e9, then adds the NOT NULL. Ran-on date recorded in the file header and the closing report. Nothing deleted.

## Part D — Admin
`/admin/orders`: a "mode" pill (test/live) and a default filter "live only" with a toggle; `/admin/commerce` shows the two new parameters. Nothing else.

## Part E — Guardrail wording (only with Dana's yes)
`DEVELOPMENT_GUARDRAILS.md` G2.9: "Timestamps are UTC `TIMESTAMPTZ`; `created_at` and `updated_at` default to `now()`. (Amended 2026-11-17: `timezone('utc', now())` yields a zoneless value that depends on the session zone; existing defaults are replaced when their table is next touched.)" Dated, in place.

## Part F — Tests, acceptance, docs
Tests: `v_order_reportable` (test order excluded, refunded excluded, partial counted net, business-date boundary: a Sunday 21:00 Eastern order lands in that week, not the next); `v_orders_weekly` totals against a fixture; `todayBusiness()` reads the parameter; bonus from the parameter; fee sync idempotent and skips test ids; GET profile leaves `updated_at` unchanged. Acceptance on prod after deploy: `v_orders_weekly` shows zero reportable orders (all six test, the $1 refunded); `/admin/orders` shows the mode pills; the fee sync run from the cron fills `transaction_fee` on the $1 order (0.33); `v_customer_bag_attribution` no longer lists test bags for +checkout1 or Dana. Docs: `WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`, `OPEN_TASKS.md` (close OT-145–151 as applicable), `REGRESSION.md` ("refunded order leaves revenue and bags"), `MANUAL_SETUP_IDS.md` (time zone note beside the scheduler job), `CLOSING_REPORT_5.md`.
