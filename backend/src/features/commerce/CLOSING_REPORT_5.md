# Closing report — Commerce 5: reporting and bookkeeping

Brief: `CLAUDE_CODE_PROMPT_COMMERCE_5_REPORTING_AND_BOOKKEEPING.md` · Session 2026-11-18 · Base commit `f476ec4` (main = origin; prod rev `00872-mjr`, `[stripe] mode=live`). `DEVELOPMENT_GUARDRAILS.md` read before Task 0.

Status: **Task 0 done; STOPPED for Dana's answers** (end of this file). Nothing changed: no code, no schema, no prod writes.

**Method:**
- **Prod DB:** read through the Cloud SQL proxy in read-only transactions (`backend/tmp/commerce5_task0_orders_ro.ts`, `commerce5_task0_misc_ro.ts`).
- **Live Stripe:** retrieve calls only, with the live key from Secret Manager, never printed (`commerce5_task0_stripe_ro.ts`).
- **Code:** read from `main`.

---

## Task 0.1 — Views that read orders

There are 12, all in `schema.sql`. Eight read `"order"` / `order_line_item` directly or through `v_customer_bag_attribution` ("vba"). The other four read only vba; they are the brief's "any `v_palate_*`".

| View | Reads orders through | Payment filter today | Declared readers (`comments.sql`) | Code readers |
|---|---|---|---|---|
| `v_order_status` | `"order"` + `order_event` (latest payment, fulfillment, refund) | **yes**, the only one | users GET profile, orders GET, catalogService, checkoutService.getSessionStatus, commerceAdminReads | + fulfillment/index, orderFinalizer, shipmentService (not declared) |
| `v_orders_weekly` | `"order"` only | no | Looker Studio via `reporting_ro` | none in code |
| `v_customer_bag_attribution` | `order_line_item` ⋈ `"order"` ⋈ `coffee_sku`; claims, household membership | no | customerReads.getFactsWatermark + the 8 views below | customerIntegrity, customerReads |
| `v_customer_timeline` | its `order_line` branch joins vba (and `"order"` for `created_at`) | no | customerReads.getTimeline | quiz, users, customerReads, liamProfile |
| `v_palate_evidence` | vba ⋈ `order_line_item` ⋈ `"order"` (`first/last_order_at`) | no | customerReads.getPalateEvidence | customerIntegrity, customerReads, liamWriteBack |
| `v_palate_recommendation_outcome` | vba ⋈ `order_line_item` ⋈ `"order"` (`ordered_at`) | no | customerReads.getRecommendationOutcomes, admin | admin, customerIntegrity, customerReads |
| `v_customer_calibration` | vba ⋈ `order_line_item` ⋈ `"order"` (`ordered_at`) | no | scripts/exportCalibration, scripts/quizRecalibrate | customerIntegrity |
| `v_household_numbers` | `"order"` ⋈ `order_line_item` where `household_id` is set | no | householdReads.numbers | householdReads |
| `v_palate_archetype_spread` | vba only | no | customerReads.getArchetypeSpread | customerIntegrity, customerReads |
| `v_palate_dominant_dimensions` | vba only | no | customerReads.getDominantDimensions | customerIntegrity, customerReads |
| `v_palate_shared_traits` | vba only | no | customerReads.getSharedTraits (Liam's profile line), v_palate_slot_candidates | customerIntegrity, customerReads |
| `v_palate_slot_candidates` | vba only (twice) | no | customerReads.getSlotCandidates, sommelierRag | customerIntegrity, customerReads, sommelierRag |

None of them nets refunds or groups dates in a business zone. Only `v_orders_weekly` groups dates, in the session zone, which is UTC on prod.

**Finding A. Filter once, at vba.** On prod, `pg_depend` lists all 8 bag views as dependents of `v_customer_bag_attribution`, so keeping only reportable orders inside vba removes test and fully refunded bags from every palate view, the timeline and the calibration export in one place (G3.9). Only `v_household_numbers` and `v_orders_weekly` read `"order"` without vba, so they need their own join to `v_order_reportable`. The brief joins each view separately; one filter in vba gives the same result with one edit. **Recommended.**

**Finding B. Where the new view can live in `schema.sql`.** `v_order_reportable` must be created after `"order".stripe_mode`, `order_event` (line ~9730) and `v_order_status` (~10054). vba (6577, `DROP … CASCADE`), `v_orders_weekly` (4689, `DROP` then `CREATE`) and `v_household_numbers` (10276) are defined earlier, and a fresh test DB builds top to bottom. The plan:
- A Commerce 5 block at the end creates `v_order_reportable`.
- In that block, vba gets `CREATE OR REPLACE` with the same columns and the new filter. Its 8 dependents survive an OR REPLACE.
- `v_orders_weekly` is dropped and recreated there with its new columns, and its `GRANT … TO reporting_ro` repeated.
- `v_household_numbers` is replaced there.
- The earlier definitions get a one-line pointer to the Commerce 5 block.

## Task 0.2 — `BUSINESS_TZ` / `todayEastern()` call sites

- **The constant and the function:** `subscriptionService.ts:28` `BUSINESS_TZ`, and `:30` `todayEastern(now)`.
- **SQL with the zone written in:** `subscriptionService.ts:256`, `AT TIME ZONE '${BUSINESS_TZ}'` (G3.2: becomes a bound parameter).
- **`todayEastern()` as a parameter's default value:**
  - `subscriptionService`: `:144` (`paid.today ?? todayEastern()`), `lapseIfOverdue :354`, `pause :531`, `resume :553`, `resumeDuePauses :569`, `cancel :591`, `pauseBounds :688`;
  - `subscriptionRenewal.runSubscriptionDaily :256`.
  - A default value cannot `await`. Each one becomes `today?: string` with `today ??= await todayBusiness()` inside. Their callers (`routes/subscriptions.ts` 28/102/109/116, `routes/commerceAdmin.ts:123`, `routes/cron.ts:626`, `resumeDuePauses → resume`) pass nothing and keep working.
- **Explicit calls:** `checkoutService.ts:491` and `:544` (`todayEastern(paidAt)`, renewal orders).
- **The literal `'America/New_York'`:** `householdEmails.ts:126` and `householdReads.ts:304` (offer expiry dates).
- **Tests:** `checkoutService.test.ts:68/311/350`, `subscriptionService.test.ts:83`.
- **Also found, not in the brief:**
  - `routes/users.ts:221` formats a customer's order date with `toLocaleDateString` and **no zone**. Cloud Run runs in UTC, so an order placed after 19:00/20:00 Eastern shows the next day on Profile. By the code, the $1 order (20:41 ET on 11-17) would show "November 18"; I did not check it on the page. It belongs with the zone work in Part B.
  - `commerce_parameter.subscription_charge_hour_local` (6) has **no reader in code**. The hour lives in the scheduler job (`0 6 * * *`, `America/New_York`, checked through `gcloud`), so the row says what the job does but changes nothing. It goes in the `MANUAL_SETUP_IDS.md` note beside the zone (OT, below).

## Task 0.3 — Order bonus

- **Code:** `orderFinalizer.ts:71` reads `getSommelierConfig()?.tokenEconomy?.orderBonus ?? 10`.
- **The live value:** Firestore `config/sommelier` could not be read from this machine (no default credentials). The live $1 order granted **+10** `order_bonus` (`token_events`), so 10 is what prod uses.
- **The Firestore key is not only read; it is edited in the admin:**
  - `AdminSommelierConfig.tsx:423` "Order bonus tokens" (input);
  - `AdminSommelierFlow.tsx:310` (display);
  - `sommelier_config_seed.ts:229` seeds it.
- **Decision proposed (the brief's preferred one):** the `commerce_parameter` row `order_bonus_tokens` becomes the source and the finalizer stops reading the Firestore key. Consequences:
  - **The Sommelier Config field** would edit a value nothing reads. It has to go, with the Flow line reading the parameter. That is a frontend change outside Part D's "Nothing else", so it needs your yes.
  - **The Firestore key:** left in place, marked retired in the `comments.sql` Firestore block. Nothing is deleted.
- **Same rule, not in scope:** `tokenEconomy.signupBonus` and `costPerTurn` are business numbers in Firestore config too (G2.15) → OT.

## Task 0.4 — Why `transaction_fee` is NULL

| Order | Created (UTC) | Path | Fee |
|---|---|---|---|
| `9e235cdf` | 10-31 14:25 | one-time checkout (`checkout.session.completed`) | NULL |
| `98fec0f0` | 10-31 15:20 | one-time checkout | NULL |
| `c47441c5` | 10-31 22:57 | subscription first box, checkout | NULL |
| `94b31a71` | 11-04 14:41 | **renewal, `invoice.paid`** | **1.35** |
| `a0d3829b` | 11-08 14:15 | subscription first box (household), checkout | NULL |
| `0b6ac7e9` | 11-18 01:41 | one-time checkout (live, $1) | NULL |

Both paths call the same `paymentDetails()` (`checkoutService.ts:324`), which expands `latest_charge.balance_transaction`. The difference is timing:

- **Checkout path:** at `checkout.session.completed`, the charge has **no balance transaction attached yet**. Live evidence for `0b6ac7e9`:
  - charge `ch_3Ucxrr…` created 01:41:01; webhook processed 01:41:04;
  - Stripe's `charge.updated` at **01:42:21**, whose `previous_attributes` are `balance_transaction`, `receipt_url`: the balance transaction (`txn_3Ucxrr…`, fee 33) was attached 80 s after the charge.
- **Renewal path:** our cron creates the invoice and Stripe pays it, so by the time `invoice.paid` arrives the charge is settled and the fee is there. It is not a missing expand.

So every checkout order will lack its fee until something reads it later. The brief's daily fee sync covers that.

**Finding C. Writing the fee conflicts with D11.** Commerce 1 decided "no mutable state on `"order"`": identifiers and snapshots are written once at insert, and later state lives in `order_event` (`schema.sql:9700`). `setTransactionFee` would UPDATE `"order".transaction_fee` after insert. Options:
- **(a)** A write-once fill: `UPDATE … SET transaction_fee = $2 WHERE id = $1 AND transaction_fee IS NULL`, through `checkoutService`, plus the `fee_recorded` event with the cents. The column is written at most once, as D11 intends: it was never written, so nothing is overwritten. Looker keeps reading one column.
- **(b)** The fee lives only in `order_event` (a new `fee_cents` column), and `v_order_reportable` reads the latest fee event. This keeps D11 to the letter, adds a column to the event table, and leaves `"order".transaction_fee` as a dead snapshot.

**Recommended (a).** Your call, since it touches D11.

## Task 0.5 — `user_profile.updated_at` bumps without a change

| Where | Door | Changes a value? |
|---|---|---|
| `routes/users.ts:72` | **GET** `/api/users/profile` (lazy upsert, `DO UPDATE SET updated_at = NOW()`) | no: a read |
| `routes/quiz.ts:227` | POST `/api/quiz/results` (lazy upsert of the taker's profile) | no: the quiz is written elsewhere |
| `routes/auth.ts:19` | POST `/api/auth/sync` (every sign-in) | only when a name is sent and differs; `updated_at` is set regardless |
| `routes/users.ts:263` | PATCH `/api/users/profile` | a real edit; bumps even when the values equal the old ones |
| `services/stripe.ts:86`, `:91` | customer id saved or replaced | yes |

- **Readers:** **nothing reads `user_profile.updated_at`**. The guest cleanup uses `created_at` (`staleGuestCleanup.ts:50`). Changing this affects only the column's meaning.
- **The column comment** (`comments.sql:154`) currently *documents* the bump ("refreshed by the lazy upserts and PATCH"), so it changes with the code.
- **Plan:**
  - `users.ts:72` and `quiz.ts:227` stop touching it (`DO UPDATE SET updated_at = user_profile.updated_at`, so `RETURNING` keeps working).
  - `auth.ts:19` sets it only when a name actually changes (`CASE WHEN … IS DISTINCT FROM …`).
  - PATCH and `stripe.ts` stay as they are: they are writes.

## Task 0.6 — Prod orders, mode evidence

There are 6 orders on prod, and every one has a Stripe id (`paid_at` is never NULL). Under the live key:

| Order | ET date | Buyer | Status (`v_order_status`) | Refunded | Fee NULL | pi / inv / cs under the live key |
|---|---|---|---|---|---|---|
| `9e235cdf` | 10-31 | +checkout1 | partially_refunded | 500 | yes | pi, cs: `resource_missing` |
| `98fec0f0` | 10-31 | +checkout1 | refunded | 3495 | yes | pi, cs: `resource_missing` |
| `c47441c5` | 10-31 | +checkout1 | paid | 0 | yes | pi, cs: `resource_missing` |
| `94b31a71` | 11-04 | +checkout1 | paid | 0 | no (1.35) | pi, inv: `resource_missing` |
| `a0d3829b` | 11-08 | Dana | paid | 0 | yes | pi, cs: `resource_missing` |
| `0b6ac7e9` | 11-17 | Dana | refunded | 100 | yes | pi, cs: **live** (`livemode` true) |

- **The backfill cutoff is confirmed two ways:**
  - Ids that resolve live give 1 live order and 5 test orders, the same split as the date cutoff (first live revision `00869`, 2026-11-17 17:35 UTC).
  - The account suffix in every id agrees: `…0QYxZQN6jD…` is the sandbox account, `…25hnyYIAkS…` is live.
- **Correction to the brief's acceptance:** it is **5 test orders and 1 live order**, not "all six test". The prod result is still zero reportable orders: 5 test, plus the live one fully refunded.
- **Lookups already there:**
  - `order_payment_status` has `paid`, `partially_refunded` and `refunded`, so decision 3 maps cleanly.
  - `order_event_kind` has neither `live_gate` nor `fee_recorded` yet.
  - `commerce_parameter` has neither `business_time_zone` nor `order_bonus_tokens`.

## G2.4 — `CATALOG.md` checked

- **Nothing in the catalog already does this:** no object holds a mode, `livemode`, or a "reportable" notion.
- **`v_order_status`** is per-order current state, and the brief keeps it that way. `v_order_reportable` composes it with mode, netting and the zone, as the brief says.
- **The new lookup `commerce_stripe_mode`** follows G2.7 and the `commerce_` prefix (G2.3).

## Other things the brief should know

1. **`stripe_mode` at insert:** the brief says "from `stripeMode()`". I propose the Stripe object's own `livemode` (`session.livemode`, `invoice.livemode`) instead. It is the fact Stripe sent us, it can't drift from the key, and it equals `stripeMode()` today. If `livemode` is missing, fall back to `stripeMode()`.
2. **Gross:** `gross_cents` = `total_amount_paid`, which includes shipping and tax (tax is 0 today). I'll also expose `shipping_cents` and `tax_cents` in `v_order_reportable`, so Looker can show product revenue without a second view.
3. **Backfill script name and writer:**
   - The brief names it `commerce_2026_11_17_stripe_mode.sql`. It will run on 2026-11-18 or later; I keep the brief's name and record the run date in its header.
   - It writes `"order".stripe_mode` and one `order_event` (`live_gate`), so `backfill:commerce_2026_11_17_stripe_mode` gets declared in both tables' `Writer:` (G2.5, lint:lineage).
4. **`v_order_status` readers are under-declared:** `fulfillment/index`, `orderFinalizer` and `shipmentService` read it but are not listed. I'll fix this in `comments.sql` with the rest.

## Open tasks this would add

- `tokenEconomy.signupBonus` / `costPerTurn` in Firestore config (G2.15, G2.1).
- `subscription_charge_hour_local` has no reader (the hour lives in the scheduler job).

---

## STOP — answers needed

1. **G2.9 amendment (Part E): yes or no?** Your message still has the placeholder "[yes/no]".
2. **"Push the pending docs commit with your first commit":** there is no unpushed commit. `main` = `origin/main` = `f476ec4`, and Commerce 4's docs are all pushed. What is uncommitted:
   - your edit to the commerce `README.md` brief table;
   - the untracked brief files `CLAUDE_CODE_PROMPT_COMMERCE_3_…`, `_4_…` and `_5_…`;
   - the deleted Genova fonts (not mine).

   Should the README edit and the three brief files go with my first commit?
3. **Fee and D11 (Finding C):** (a) write-once fill of `transaction_fee` plus a `fee_recorded` event (recommended), or (b) the fee only in `order_event`?
4. **Order bonus (0.3):** the parameter becomes the source, and the "Order bonus tokens" field leaves Admin → Sommelier Config (a frontend change beyond Part D). Yes?
5. **Filter once in `v_customer_bag_attribution` (Finding A)** instead of in each palate view: same result, one place. Yes?
6. **`stripe_mode` from Stripe's `livemode`** (other item 1) instead of `stripeMode()`. Yes?

---

## Decisions (Dana, 2026-11-18)

1. **G2.9:** yes. Amended in place to plain `now()`.
2. **Commit contents:** the README edit and the Commerce 3/4/5 brief files go in the first commit.
3. **The fee:** `"order"` stays immutable. The fee is recorded only as an `order_event` `fee_recorded`, in the new `amount_cents` column. `v_order_reportable.transaction_fee_cents` reads it, and there is no UPDATE grant. `"order".transaction_fee` is commented "at-insert value, usually NULL".
4. **Order bonus:** moved to the `order_bonus_tokens` parameter. The field is removed from Admin → Sommelier Config.
5. **Filter once:** `v_customer_bag_attribution` does the filtering.
6. **Mode:** `stripe_mode` comes from Stripe's `livemode` on the object received.

Also in scope: Profile order dates use the business zone. `subscription_charge_hour_local` stays as the documented scheduler hour.

## What was built

See `WHAT_WE_BUILT.md` #276. In short:
- **Data:** `commerce_stripe_mode`, `"order".stripe_mode`, `order_payment_status.counts_as_revenue`, `order_event.amount_cents` and the `fee_recorded` / `live_gate` kinds.
- **Views:** `v_order_reportable` is new; `v_orders_weekly` is rebuilt; the vba and `v_household_numbers` filters are added.
- **Parameters:** `business_time_zone` and `order_bonus_tokens`.
- **Code:** `stripeFeeSync` runs in the daily cron; the time-zone readers are updated; the `updated_at` bumps only happen on real changes; there is a Mode filter on `/admin/orders`.
- **The backfill migration:** `migrations/commerce_2026_11_17_stripe_mode.sql`.

## Deviations from the brief

- **The rule lives in lookups, not the view body (G2.1):** `commerce_stripe_mode.is_reportable` AND `order_payment_status.counts_as_revenue`.
- **`v_orders_weekly.revenue_cents` = net cents.** Gross, refunded and net sit next to it, so Looker's existing tile shows net revenue.
- **No 10-minute age cut-off on the fee sync.** An order not yet settled just comes back NULL and is retried on the next run, so there is no time constant (G2.1).
- **The fee sync only picks orders whose mode matches the running key.** A live key cannot read sandbox payment intents (`resource_missing`, Task 0.6).
- **The bag filter is in `v_customer_bag_attribution` once** (decision 5). Because `v_order_reportable` depends on objects defined later in `schema.sql`, the view is redefined at the end of the file with CREATE OR REPLACE (same columns). Pointer comments sit at the earlier definitions.
- **The rehearsal test locks `"order"` and marks other test files' concurrent fixture orders `test`** before running the migration, inside its rollback. The migration itself still refuses to guess a post-cutover NULL (second test case).

## Test evidence (local, test DB)

- **New:** `commerce5Reporting.test.ts`, `users.profileUpdatedAt.test.ts` and `commerceBackfill.test.ts` all pass. Together with `palateReads.test.ts`, that is 91/91 in the targeted run.
- **Full `src` suite:** 1252 passed, 23 failed, 6 skipped (112 files). All 23 failures are in the OT-140 baseline files: evidenceViews 7, quizScoring 6, evidenceAdmin 4, sommelierEval 2, sommelierRag 2, sommelierAnswer 1, catalogService 1, schema.catalog_blueprint 1, qrDoor (file-level cleanup FK). None are from Commerce 5. Lints (6) and backend tsc are green. The frontend tsc errors (7) were all there before this change.
- **The 2020-02-10 fixture week** = orders 3, new customers 3, gross 9000, refunded 1000, net 8000, fee 170. The test order and the fully refunded order are excluded, and a Sunday 21:00 Eastern order counts in that week, not the next.

## Deploy (2026-11-18)

- **Code:** `9e80761` was pushed. Deploy run 44246177972 is green; the revision is `axis-bloom-backend-00873-87l`.
- **Boot log:** `[stripe] mode=live` and `DB schema verified`. `[commerce-integrity] "order".stripe_mode is NULL on 6 order(s)` appeared, as expected before the backfill. No ERROR.
- **Prod, read-only:**
  - The `commerce_stripe_mode` rows are test=false and live=true. `counts_as_revenue` is set on paid and partially_refunded.
  - `v_order_reportable` has 6 rows, all `is_reportable` false, because no mode is set yet. `v_orders_weekly` is empty, and `v_customer_bag_attribution` has 0 bags.
  - The parameters are America/New_York and 10. `stripe_mode` is still nullable.
- **`CATALOG.md`:** regenerated from prod (218 tables, 113 views, catalog-hash `143f9462…`).
- **Not checked:** `/admin/commerce` in a signed-in browser.

## Acceptance (confirmed on prod, 2026-11-18)

Five test orders plus the refunded live one, zero reportable.

## Backfill — run on prod (Dana's go, 2026-11-18)

1. **Migration:** run at 14:39:53 UTC (`tmp/commerce5_backfill_run.ts`). The pre-check found 6 orders, all with no mode, and none newer than the cutover other than 0b6ac7e9. Result: 5 test, 1 live. `stripe_mode` is now NOT NULL.
2. **Reportable:** `v_order_reportable` has 6 rows, **0 reportable**: the five test orders plus the refunded live one. `v_orders_weekly` is empty.
3. **`live_gate` event:** on 0b6ac7e9, "Commerce 4 $1 gate purchase", source admin.
4. **Fee sync:** run with the live key, `{mode: live, checked 1, recorded 1, pending 0, errors 0}`. 0b6ac7e9 has `fee_recorded` 33 cents (`txn_3Ucxrr25hnyYIAkS1mEjVqWu`, source cron), and `transaction_fee_cents` = 33. Sandbox order 94b31a71 keeps its at-insert fee of 135 cents and stays unreportable.
5. **Bags:** `v_customer_bag_attribution` has 0 rows. The two `+checkout1` / Dana profiles have 0 bags. The 6 test-order lines stay in `order_line_item`, so nothing was deleted.
6. **Boot warning:** with no NULL left, the `[commerce-integrity]` warning stops at the next boot.

Read-only checks: `tmp/commerce5_checks_ro.ts`, `tmp/commerce5_checks2_ro.ts`. Commerce 5 is done.
