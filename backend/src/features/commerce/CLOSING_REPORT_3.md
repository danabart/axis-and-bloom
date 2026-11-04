# Closing report — Commerce 3: admin orders, refunds, shipping, subscription self-service

Brief: `CLAUDE_CODE_PROMPT_COMMERCE_3_ADMIN_AND_SELF_SERVICE.md` · Session 2026-10-31 · Base commit `2d9a2f4` (main == origin/main; prod rev `00811-pjt`). Test mode only. `DEVELOPMENT_GUARDRAILS.md` read before Task 0.

Status: **Done. Parts A–F complete; Part E passed on prod in test mode with Dana, 2026-11-04** (her change of plan, 2026-11-01: the local stack was stopped twice under low memory, so acceptance moved to `www.axisandbloomcoffee.com` with `?preview=true`, verified from the prod DB and the Stripe Dashboard). Prod Stripe is the sandbox (`[stripe] mode=test`).

| Commit | Content |
|---|---|
| `1f56782` | Task 0 findings |
| `fef6320` | Dana's Commerce README edit, its own commit |
| `d834161` | A, schema |
| `542f1b1` | B, backend |
| `78eaff9` | Dana's Task 0 decisions; `invoice.*` events confirmed on the endpoint |
| `c418abe` | C, frontend |
| `c4c8c1e` | D, tests |
| `66fa41f` | F, docs |
| `46b5546` | `CATALOG.md` from prod after the deploy (rev `00812-xj5`) |
| — | Part E evidence (this commit) |

---

## Task 0 — current state (verified 2026-10-31, before any change)

Code read at `2d9a2f4`. Prod queried read-only through the Cloud SQL proxy (`backend/tmp/commerce3_task0.ts`, SELECTs only). Stripe read with the test key (`backend/tmp/commerce3_stripe_ro.ts`: webhook endpoints, events, payment-method configuration; no writes).

### 0.1 Services to reuse (G3.9)

| Piece | Where | Brief 3 use |
|---|---|---|
| `recordSubscriptionEvent` | `services/subscriptionService.ts:56` | every self-service event |
| `setStatus` | `:75` | pause, resume, cancel |
| `scheduleNext` | `:186` | resume (and the auto-resume, finding 2) |
| `coveredBy` / `skipCoveredCycle` | `:209` / `:216` | the skip window, unchanged |
| `markRenewalCharged` | `:274` | a recovered past_due invoice, through the normal `invoice.paid` path |
| `lapseIfOverdue` (invoice void loop) | `:343–378` | cancel voids the open invoice the same way; the loop becomes a shared helper |
| `getSubscriptionsForCustomer` | `:400` | `GET /mine`, extended |
| `recordOrderEvent`, `OrderEventKind` | `services/checkoutService.ts:524`, `:508` | `shipped`, `canceled` |
| `recordRefund` | `checkoutService.ts:540` | gains the refund reason (finding 6) |
| `getOrderSummary` | `checkoutService.ts:578` | admin detail; its `email` is always `null` today (`:594`) |
| `dispatchFulfillment` | `services/fulfillment/index.ts:27` | admin retry; writes `source: 'finalizer'` at `:35, :44, :45`, so it gains a `source` parameter for the admin retry |
| `renderAdminNewOrderEmail` | `services/orderEmails.ts:125` | gains name, email, admin link |
| `sendOnce` | `services/transactionalEmail.ts:29` | every new email |
| `stripe()`, `getOrCreateStripeCustomer`, `stripeMode()` | `services/stripe.ts:24, :45, :34` | setup session, refunds, Dashboard links |
| `commerceParam` / `setParameterInTx` | `services/commerceParameters.ts` | the two new parameters |
| webhook switch | `routes/stripeWebhook.ts:57–119` | setup-mode branch |
| `/api/admin/commerce` | `routes/commerceAdmin.ts` (mounted `index.ts:161`) | lookups route; orders/subscriptions routes live in the same file, mounted at `/api/admin/orders` and `/api/admin/subscriptions` (no existing route uses those paths; `routes/admin.ts` has none) |
| `GET /api/subscriptions/mine` | `routes/subscriptions.ts:11` | the self-service routes go beside it |
| `SubscriptionSummary.tsx` | `frontend/.../profile/`, rendered at `Profile.tsx:698` | becomes `SubscriptionPanel.tsx` |
| Embedded Checkout | `checkout/CheckoutPage.tsx:181–183` (`EmbeddedCheckoutProvider` inline) | no shared component exists: it is lifted into one (`StripeEmbeddedCheckout`) used by `/checkout` and the Profile card update (G4.1) |
| Admin sidebar | `admin/AdminLayout.tsx:48–56` (Commerce group) | two entries |
| `AdminCompanyGifts.tsx` | table + drawer sibling | pattern for both admin pages |

### 0.2 Columns and seeds

- **`subscription`** has every column the brief needs: `paused_until`, `skip_next_until`, `cancel_at`, `frequency_weeks`, `stripe_payment_method_id`, `failed_attempts` (`schema.sql:9225–9235`).
- **`subscription_event_kind`** has all six: `paused`, `resumed`, `skip_requested`, `frequency_changed`, `canceled`, `payment_method_updated` (prod confirmed). Nothing to seed.
- **`order_event_kind`** has `shipped`, `canceled`, `refund_partial`, `refund_full` (prod confirmed). `order_fulfillment_status` has `shipped` ("On its way") and `canceled` (closed).
- **`v_subscription_status`** (`:9346`) already carries `paused_until`, `skip_next_until`, `cancel_at`, `frequency_weeks`. Part A adds only `canceled_at` (from the event) and `has_payment_method`.
- `order_event.source` is an existing CHECK list (`:9124`: webhook, finalizer, admin, cron). It already allows `admin`; G2.7 leaves existing lists until retired, so it is not touched.

### 0.3 `roastery_shipment_details`

- Columns as the brief says (`schema.sql:715–727`): `order_id`, `roaster_id`, `tracking_number`, `carrier` TEXT, `status` TEXT default `label_created`, `shipped_at`, plus `postage_cost`, `estimated_delivery`.
- No writer and no reader in code (`comments.sql:398`: "Writer: none"). Prod: 0 rows, so the `carrier` and `status` FKs touch nothing.
- `ab_app` has SELECT/INSERT/UPDATE/DELETE on it.
- `catalogService.ts:1377` reads open orders through `v_order_status`, as the brief says.

### 0.4 Setup-mode Checkout and the webhook

- `checkout.session.completed` today returns `ignored: mode <mode>` for anything but `payment` (`stripeWebhook.ts:61`). So a setup session already **never creates an order**; B3 replaces that early return with the setup branch.
- A setup session carries `mode: 'setup'` and `setup_intent` (an id string unless expanded). The payment method needs `setupIntents.retrieve(setup_intent).payment_method`.
- The setup session belongs to no `checkout_session` row (that table is a cart: its `mode` CHECK is `payment | subscription`). It is identified by `metadata.subscription_id`; an id this database does not have takes the existing `UnknownSubscriptionError` path (recorded, 200, never retried).
- Commerce 1 creates sessions with `ui_mode: 'embedded_page'` (`checkoutService.ts:232`; the name in API `2026-09-30.endive`), not `'embedded'`. The setup session matches it, as the brief asks.
- Setup mode with the account's dynamic payment methods needs `currency: 'usd'` on the session.
- The sandbox payment-method configuration (`pmc_1UVkYB…`, default) offers card, Apple Pay, Google Pay, Link and PromptPay. All except PromptPay can be saved; setup mode shows only the saveable ones.

### 0.5 Admin new-order email

`renderAdminNewOrderEmail` (`orderEmails.ts:125–147`) has the first name and the address, **no email, no last name, no link**. `getOrderSummary` sets `email: null` (`:594`); the customer emails take the address from Firebase Auth. `user_email` (primary) is the stored one: on prod all 27 users have exactly one primary row, and 0 order users lack one. The admin email reads it there (`user_email` Readers gain `orderEmails` and `commerceAdmin`).

### 0.6 Prod (read-only, 2026-10-31)

| | |
|---|---|
| Orders | 3, all `paid` / `awaiting_manual`; 1 is a subscription first delivery; 0 renewals |
| Order events | paid 3, finalized 3, fulfillment_dispatched 3 |
| Subscriptions | 1, `paid` / `active`, card saved; no pause, skip or cancel set |
| Subscription events | started 1 |
| `roastery_shipment_details` | 0 rows; `order_line_item.shipment_id` set on 0 rows |
| `commerce_parameter` | neither `subscription_pause_max_weeks` nor `refund_window_days` exists |
| New lookups | none of `order_refund_reason`, `shipping_carrier`, `shipping_status` exists |
| `stripe_event` | checkout.session.completed 7, expired 2, payment_intent.payment_failed 2; **no `invoice.*`** |

### Findings that contradict the brief or need a decision

1. **Stripe is not sending `invoice.*` to prod (urgent, outside this brief).**
   - Endpoint `we_1UWaPO0QYxZQN6jDi2Y9lp6q` lists only the six Commerce 1 events.
   - The four Commerce 2 Part E invoice events (`evt_1UWgMo…`, `evt_1UWgRP…`, `evt_1UWgV5…` `invoice.paid`; `evt_1UWgWJ…` `invoice.payment_failed`) show `pending_webhooks 0`: Stripe delivered them nowhere. The prod ledger has no `invoice.*` row.
   - The Commerce 2 Task 0.5 step was marked done, so the events were probably added to another destination or sandbox.
   - Consequence: prod's one paid subscription (Dana's 4242 check) would be charged on its first renewal date, but no renewal order, no fulfillment email and no next date would follow. The cron's one-attempt claim stops a second charge.
   - **Dana:** Stripe Dashboard (sandbox) → Developers → Webhooks → `axis-bloom-backend-test` → add `invoice.paid`, `invoice.payment_failed`, `invoice.marked_uncollectible`, `invoice.voided`. I re-read the endpoint afterwards. This is the brief's Task 0.5 "a Dashboard setting is needed" case.
2. **A pause never ends by itself.** The brief's pause sets status `paused` with a resume date. The daily job only reads `status = 'active'` (`subscriptionRenewal.ts:237–241`, and the claim at `subscriptionService.ts:243`), and nothing turns `paused` back when `paused_until` passes. A customer who paused for 3 weeks would stay paused until they press Resume.
   - **Recommended:** the daily job's first step resumes every paused subscription whose `paused_until` is before today, through the same `subscriptionService.resume` (event `resumed`, `source = 'cron'`, next date rescheduled when it fell inside the pause, the resumed email).
3. **`order_line_item.shipment_id` cannot be set.** B4 says markShipped sets it on the order's lines. `order_line_item` is insert-only for `ab_app` (the A2 grant loop, `schema.sql:9388–9398`, Customer Blueprint D11/D12, which Dana kept in Commerce 1 decision A; prod grants: INSERT, SELECT).
   - **Recommended:** keep D11. The shipment row's `order_id` is the link; `v_order_status` reads the latest shipment by `order_id`. `shipment_id` stays reserved, and its comment says so. One shipment per order holds today (one roaster per order); a split shipment is the ShipStation thread's question.
   - The alternative is a column-list UPDATE grant on `order_line_item.shipment_id`, which reopens D11.
4. **Partial refund and fulfillment.** B5 records `canceled` for any refund while the order is `awaiting_manual` / `needs_attention`. A $5 partial refund (acceptance step 3) is a goodwill credit, and the bag should still ship.
   - **Recommended:** only a full refund cancels fulfillment; a partial refund never does.
   - Also recommended: the route does not write `canceled` itself. It puts `cancel_fulfillment` in the refund's metadata, and `recordRefund` writes `canceled` when `charge.refunded` arrives. A refund Stripe refuses then cancels nothing, and "the DB changes only when `charge.refunded` arrives" holds for both events.
5. **The Stripe reason mapping is data, not code (G2.1 over the brief).** The brief maps our reasons to Stripe's three "in code". `order_refund_reason` gets a nullable `stripe_reason` column instead (`requested_by_customer` → `requested_by_customer`, `duplicate` → `duplicate`, the rest NULL, so Stripe gets no reason).
6. **`charge.refunded` does not carry the refund's metadata.** At API `2026-09-30.endive` the Charge's `refunds` list is not included by default. `recordRefund` lists the charge's refunds (`refunds.list({ charge })`) to read the newest refund's `metadata.reason_code` and `cancel_fulfillment`.
7. **Recovering a past_due invoice needs the new card named.** The renewal invoice was created with `default_payment_method` = the old card (`subscriptionRenewal.ts:110`), and that overrides the customer default. `attachPaymentMethod` therefore calls `invoices.pay(invoice, { payment_method: <new pm>, off_session: true })`, with the brief's key `sub:<id>:recover:<invoice>`. The open invoice is found from the `renewal_failed` events, as `lapseIfOverdue` does.
8. **The skipped date on Profile.** The brief leaves skip to the cron (date unchanged until the cycle day). Profile and admin would show a date that will not ship. `GET /mine` and the admin list return the effective next date (the first cycle after `skip_next_until` or `paused_until`), computed in `subscriptionService`, not in the UI.
9. **Two Commerce 3 items from OT-62 are not in the brief:**
   - the update-card link in the payment-trouble email (it says "reply to us" today);
   - Liam's status line printing the raw code (`sommelierGate.ts:337`, `liamProfile.ts:358`) instead of `customer_label`.
   - **Recommended:** include both. Each is a small change (one link; two reads of the label). Otherwise they stay in OT-62.
10. **Smaller points, built as stated unless Dana says otherwise:**
    - `markShipped` idempotency gets a partial unique index on (`order_id`, `tracking_number`).
    - A fulfillment retry on the manual adapter re-sends nothing: `admin_new_order:<id>` is deduped. It records a new `fulfillment_dispatched` (status back to `awaiting_manual`), and the response says so.
    - Liam's customer block (`customerReads.ts:442`) notes that no tracking exists. It is left as is; Liam reading tracking is a Liam brief.
    - Frontend `tsc --noEmit` baseline: 13 errors (Commerce 2).

### Questions for Dana

1. **Webhook events (finding 1):** please add the four `invoice.*` events to `axis-bloom-backend-test`, then tell me, and I re-read the endpoint.
2. **Auto-resume (finding 2):** should the daily job resume pauses whose date has passed? Recommended: yes.
3. **`shipment_id` (finding 3):** keep D11, linking by `order_id`? Recommended: yes.
4. **Partial refunds (finding 4):** should only a full refund cancel fulfillment, recorded from the webhook? Recommended: yes.
5. **OT-62 extras (finding 9):** include the update-card link and Liam's status label? Recommended: yes.

Findings 5–8 and 10 follow the guardrails or the real API, and are built as written above unless you say otherwise.

### Dana's decisions (2026-10-31)

1. **Webhook events:** added. Re-read through the API the same day: `we_1UWaPO0QYxZQN6jDi2Y9lp6q` lists 10 events, the six Commerce 1 ones plus `invoice.paid`, `invoice.payment_failed`, `invoice.marked_uncollectible` and `invoice.voided`. **The invoice events were missing from the Commerce 2 deploy (2026-10-31) until this fix the same day. No prod renewal has run in that window** (prod: 0 renewal orders, 0 `invoice.*` in `stripe_event`; the one paid subscription's first renewal is still ahead), so nothing was lost.
2. **Auto-resume:** yes. The daily job resumes any pause whose date has passed, through `subscriptionService.resume`, with a `resumed` event (`source = 'cron'`).
3. **Shipments link by `order_id`.** `order_line_item.shipment_id` stays unused, commented as reserved (D11 kept).
4. **Only a full refund cancels fulfillment,** and only when Stripe confirms it (`charge.refunded`), never on the click.
5. **Both OT-62 items are included:** the update-card link in the payment-trouble email, and the customer wording for Liam's status line.
6. **Approved as described:** the Stripe reason mapping as a column on the reason table; refund reasons read from Stripe's refund list; the new card named on the retry; the real next date when a cycle is skipped.

---

## Decisions applied

| Decision | Where it is built |
|---|---|
| 1. `invoice.*` on the endpoint | Re-read through the API, 10 events. No code. |
| 2. Auto-resume | `subscriptionService.resumeDuePauses(today)`, step 0 of `runSubscriptionDaily` (`DailyResult.resumed`, logged by `routes/cron.ts`); each resume goes through `resume(…, 'cron')`. |
| 3. Link by `order_id` | `roastery_shipment_details.order_id` plus unique (`order_id`, `tracking_number`); `v_order_status` takes the latest shipment through a LATERAL on `order_id`; `order_line_item.shipment_id` comment says "reserved (D11)". |
| 4. Only a full refund cancels, from the webhook | `requestRefund` only asks Stripe. `recordRefund` (on `charge.refunded`) writes `canceled` (source webhook) when the refund is full and the order is `awaiting_manual` / `needs_attention`. |
| 5. OT-62 extras | Payment-trouble email links to `/profile?tab=orders&card=update` ("Update your card"); `sommelierGate.ts` and `liamProfile.ts` print `customer_label`. |
| 6. Approved as described | `order_refund_reason.stripe_reason`; `refunds.list({ charge })` for the newest refund's metadata; `invoices.pay(…, { payment_method, off_session })`; `effectiveNextDelivery` in `GET /mine` and `/admin/subscriptions`. |

## Deviations from the brief, and why

1. **Views have one definition each.** `v_order_status` and `v_subscription_status` gained columns at the end. The Commerce 1 and 2 blocks of `schema.sql` held earlier `CREATE OR REPLACE` definitions, which would fail on every boot after the first, because a replace cannot drop columns. Those definitions are now comments pointing to the Commerce 3 block.
2. **Advisory locks on orders, not `FOR UPDATE`.** `ab_app` has no UPDATE on `"order"` (D11), and `SELECT … FOR UPDATE` needs it. Refunds lock on `pg_advisory_xact_lock(hashtext('refund:<order>'))`, shipments on `'ship:<order>'`.
3. **The recovery key names the card.** The key is `sub:<id>:recover:<invoice>:<payment method>`, not `sub:<id>:recover:<invoice>`. With the brief's key, the second card (4242) would replay the first card's (0341) declined response for 24 hours.
4. **The refund route writes nothing itself** (decision 4). The brief had it record `canceled` on the click.
5. **The Stripe reason mapping is a column** (`order_refund_reason.stripe_reason`, G2.1), not code.
6. **`subscription` table comment shortened** to 894 characters (the `comments.format` limit is 1,000) to fit the new writer functions.
7. **Part E on prod, not the local stack** (Dana, 2026-11-01). The low-memory reaper stopped the proxy, backend, relay and Vite twice. Prod runs the sandbox keys, and the sandbox endpoint already delivers to prod, so no relay is needed. Verification reads the prod DB through the Cloud SQL proxy (SELECTs only) and the Stripe sandbox.

## Tests

- New: `subscriptionSelfService.test.ts` (12). It covers:
  - frequency keeps the date;
  - skip twice → 409;
  - pause bounds → 422;
  - resume reschedules;
  - auto-resume from cron;
  - cancel voids the open invoice;
  - card attach on past_due pays once, is idempotent, and handles declines.
- New: `commerceAdmin.test.ts` (9). It covers:
  - `markShipped` idempotent, with the event and email once;
  - partial and full refund through `charge.refunded`;
  - full refund on `awaiting_manual` cancels, on shipped does not;
  - retry fulfillment;
  - admin reads with the customer email.
- `stripeWebhook.test.ts` +2: a setup-mode session saves the card and creates no order; an unknown subscription is recorded and answers 200.
- `checkoutService.test.ts`: the Stripe mock gained `refunds`.
- **Suite, file by file** (90 files, one vitest process each, 2026-11-01): 79 green. The rest:
  - Known baseline: `quizScoring` (6) and `schema.catalog_blueprint` (1).
  - Timeouts only at the 5 s default: `blendResolver` (2), `catalogService` (1) and `sommelierRag` (hook). All three pass with `--testTimeout=30000 --hookTimeout=60000` (7/7, 14/14, 10/10).
  - Every commerce file is green.
- Six lints, backend `tsc` and `vite build` are green. Frontend `tsc --noEmit` is at the 13-error baseline (no new errors).

## Part E — acceptance (prod, test mode)

Walked through with Dana on `www.axisandbloomcoffee.com/?preview=true`, 2026-11-01 → 2026-11-04 (prod rev `00812-xj5`): Profile steps as `danabar.mail+checkout1@gmail.com`, admin steps as Dana's admin account. Each step is checked in the prod DB (read-only, through the Cloud SQL proxy) and the Stripe sandbox, in batches as Dana asked. Subscription `7187cc53-60d2-49d2-b243-8ffbf3969304`, customer `cus_VXieQZVTedJE55`.

**Result: all steps pass.** Three steps were driven from our side, each approved by Dana (see "How Part E was run" below).

| # | Step | Result | Evidence (prod DB / Stripe sandbox) |
|---|---|---|---|
| 1a | Frequency 2→4 weeks: next date unchanged, email | ✅ | `frequency_changed` (customer) "every 2 → 4 weeks", 11-01 20:07 UTC; next date stayed 11-14; email `subscription_frequency_changed:2` |
| 1b | Skip next: `skip_requested`, Profile shows the cycle after | ✅ | `skip_requested` (customer) "delivery 2026-12-02 skipped", 11-04 14:42; `skip_next_until` 12-03; email `subscription_skipped:12`. Daily job (date moved to 11-04, see below): `renewal_skipped_skip` ×2 (11-04, 12-02), no charge, next date 12-30 |
| 1c | Pause 3 weeks, then resume | ✅ | `paused` "resumes 2026-11-23" (11-02 21:30:41), `resumed` "next delivery 2026-11-14" (21:30:53); emails `subscription_paused:3`, `subscription_resumed:4` |
| 1d | Cancel: `canceled`, Liam access gone, email | ✅ | `canceled` (customer) "was active", 11-04 14:50; status canceled, `cancel_at` 11-04, `skip_next_until` cleared; `v_subscription_status.counts_as_subscriber` false (Liam access off); email `subscription_canceled:15`. No open invoice at cancel, so nothing to void |
| 2 | Card update on past_due (0341, then 4242): invoice paid, renewal order, `active` | ✅ | Decline: `pm_card_chargeCustomerFail` (Visa 0341) attached by API (`payment_method_updated`, source admin); job run 11-02 → invoice `in_1UXT3z0…` $36.35 declined, `renewal_failed` (cron), past_due, `failed_attempts` 1, email `subscription_payment_trouble:in_1UXT3z0…:1`, `invoice.payment_failed` processed. Recovery 11-04: card form saved (`payment_method_updated` customer 14:41:23, customer default), invoice paid at once, `invoice.paid` processed, `renewal_charged` (webhook) → order `94b31a71` Paid / awaiting manual, status active, `failed_attempts` 0, next 12-02; emails `card_updated:9`, `order_confirmation:94b31a71…`, `admin_new_order:94b31a71…` |
| 3a | `/admin/orders` lists orders with customer emails | ✅ | Dana, screenshots |
| 3b | $5 partial refund → `refund_partial`, cents on `v_order_status`, Stripe refund | ✅ | `9e235cdf`: Stripe `re_3UWdDi0…` 500 succeeded on its payment intent; `charge.refunded` processed; `refund_partial` (webhook, `requested_by_customer`); `v_order_status` partially_refunded, 500 cents, "Partly refunded" |
| 3c | Full refund on `awaiting_manual` → `refund_full` + `canceled` | ✅ | `98fec0f0`: Stripe `re_3UWe5I0…` 3495 succeeded; `refund_full` + `canceled` "fully refunded before it was placed with the roaster (was awaiting_manual)"; closed, "Refunded" |
| 3d | Mark shipped (USPS): shipment row, `shipped`, email with tracking link, Profile | ✅ | `9e235cdf`: `roastery_shipment_details` `f2fd36f7…` usps `9400100000000000000000` shipped; `shipped` (admin); `v_order_status` tracking URL `tools.usps.com/…`, "On its way"; email `order_shipped:f2fd36f7…`; Profile, Dana |
| 3e | Retry fulfillment on `needs_attention` | ✅ | Run on `c47441c5` (`awaiting_manual`; prod had no `needs_attention` order, approved by Dana): `fulfillment_dispatched` (admin) "manual", 14:56. A second admin dispatch on `9e235cdf` at 14:55:19, before mark shipped |
| 4 | Admin new-order email: name, email, drawer link | ✅ | `admin_new_order:94b31a71…` to `dana@axisandbloomcoffee.com`; content checked by Dana |
| 5 | No roaster name on Profile or in customer emails | ✅ | Dana checked Profile and the emails. "Coado" (in Liam's order lines and `signup_names`) is a house name, not a roaster (Dana, 2026-11-02) |

### How Part E was run (deviations, all approved by Dana)

- **Prod instead of local** (Dana, 2026-11-01): the local stack was stopped under low memory.
- **Decline card attached by API.** Dana's card-form saves went through Link (Stripe stores `type: link`, no last four), so the 0341 card could not be picked from the form. `pm_card_chargeCustomerFail` was attached with `attachPaymentMethod(sub, pm, 'admin')`, which is why event 6 has source admin.
- **Dates moved by UPDATE.** `next_delivery_date` was set to today (Eastern) twice, on 11-02 for the decline run and on 11-04 for the skip run, each followed by `gcloud scheduler jobs run subscription-daily`. The 11-04 move is why two cycles were skipped (11-04 and 12-02 both fall inside the window up to 12-03).
- **Retry on `awaiting_manual`**, see 3e.
- **Two card saves** 24 s apart on 11-04 (`pm_1UY5NM0…`, `pm_1UY5Nl0…`), both through Link. The first paid the invoice; the second changed only the card on file.

### Noticed during Part E, not fixed in this brief

- **Email-link bounce, not reproduced.** Dana's first click on "Update your card" in the payment-trouble email (11-03) landed on the home page. `/profile` is in `PRELAUNCH_OPEN_ROUTES` and not wrapped in `<PrelaunchGate>`; the link host matches `FRONTEND_URL` and `VITE_CANONICAL_HOST`; signed out it goes to `/sign-in` with the redirect kept; a fresh tab with no preview flag opened Profile → Past Orders with the panel. Cause unknown; no change made.
- **Cosmetic, for a later pass (Dana, OT-65):** the Profile order card shows the total without "$" and the full UUID as the order number; the admin customer name is "—" when the profile has no first name.
- **OT-60 noise continues:** the leftover local invoice `in_1UWgWB…` is retried by Stripe and logged "no subscription" on prod (11-02, 11-04).

## What Commerce 4 needs

- **Live keys and endpoint.**
  - Live secret and publishable keys in Secret Manager and the frontend build.
  - A live webhook endpoint with all 10 events: `checkout.session.completed` / `expired` / `async_payment_succeeded` / `async_payment_failed`, `payment_intent.payment_failed`, `charge.refunded`, and the four `invoice.*`. Its signing secret goes in Secret Manager.
  - The boot log must show `[stripe] mode=live`.
- **Live payment-method configuration** checked for setup mode (the card update) as well as payment mode.
- **Dashboard links.** `/admin/orders` builds them from `stripeMode()`, so they switch by themselves; check one after cutover.
- **Retry schedule.** The live account's Smart Retries setting must match the sandbox (OT-63), or `subscription_past_due_lapse_days` is revisited.
- **Test data on prod.**
  - Test-mode orders, subscriptions, refunds and shipments from Commerce 1–3 stay as history (never deleted).
  - Decide whether admin lists hide them (e.g. a `stripe_mode` read from the payment intent prefix) or whether a cutover date is enough.
  - Test-mode Stripe customer ids on `user_profile.stripe_customer_id` do not exist in live. `getOrCreateStripeCustomer` must create a live customer for those users instead of reusing the test id.
- **Fees and tax.** `tax_collection_enabled` stays 0 unless Dana flips it (`MANUAL_SETUP_IDS.md`).
- **OT-60** (test events reaching prod) closes when prod uses only the live endpoint. Dev runs then need their own sandbox endpoint or the Stripe CLI.
- **ShipStation (OT-58)** can follow Commerce 4: it only needs to call `shipmentService.markShipped`.
