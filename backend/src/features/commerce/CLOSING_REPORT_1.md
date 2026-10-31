# Closing report — Commerce 1: Stripe one-time checkout

Brief: `CLAUDE_CODE_PROMPT_COMMERCE_1_CHECKOUT.md` · Session 2026-10-31 · Base commit `f58162c` (main == origin/main), prod rev `00803-9lk`.

Status: **done in test mode; committed on `main`, not pushed (waiting on Dana's go).** Commits `e6d568f` (A), `b330ecd` (B), `0044099` (C), `2b01436` (D), `790f251` (E fix), plus the docs commit. After the push and first boot: `npm run catalog:md -- --expect-db axisandbloom` and commit `CATALOG.md` (it is generated from prod, which has the Commerce 1 schema only after that boot), then the post-deploy checks at the end of this report.

---

## Task 0 — current state (verified 2026-10-31, before any change)

Read-only: code read at `f58162c`; prod queried through the Cloud SQL proxy (`--gcloud-auth`), SELECTs only.

### 0.1 `routes/orders.ts` POST side effects (handler 35–349)

The order INSERT is at 192–209 and the line INSERT at 212–233. Side effects after the INSERT, in the order they run:

| # | Side effect | Where | How |
|---|---|---|---|
| 1 | Order-placed beat | 245–257 | `SELECT coffee_id FROM coffee_sku` on `resolvedItems[0]`, then `dispatchOrderPlacedBeat(userId, orderId, primaryCoffeeId)`. Runs **before** the response; the result is returned as `orderPlacedLine`. |
| — | Response sent | 259–266 | `{ orderId, shopifyOrderId, orderName, orderPlacedLine, items[] }` |
| 2 | Order-bonus tokens | 271–300 | Inline SQL inside BEGIN/COMMIT: `UPDATE user_tokens` (276–280) and `INSERT token_events … 'order_bonus'` (281–286). Amount is `getSommelierConfig()?.tokenEconomy?.orderBonus ?? 10`. |
| 3 | Firestore balance sync | 288–294 | `users/{uid}.set({ tokenBalance }, { merge: true })` |
| 4 | `updateOrderOutcomes(uid, new Date())` | 303 | awaited inside the fire-and-forget IIFE |
| 5 | `dispatchDelayedBeats({ userId, orderId, coffeeId, brewProfile })` | 324–334 | nested IIFE; `getBrewProfile(uid)` comes from `./sommelier.js` |
| 6 | `refreshLifecycleState(uid)` | 338–340 | `.catch` logs |

Nothing else runs after the INSERT. The brief says to look for three more; the POST calls **none** of them:
- `record` (customerFacts)
- `computeBehavioralConfidence`
- `writeDialPositionSignal`

All three live in the feedback route (`POST /:orderId/feedback`, 384–515) and stay there. SMS scheduling is retired: it is only documented in comments at 305–323.

Shopify `createOrder` runs **before** the INSERT (181–186). It throws `'Shop not yet available'` unless all three `SHOPIFY_*` vars are set (`shopify.ts:5, :78`), and the route turns that into a 500 `Order failed`. This is why checkout fails today.

### 0.2 `index.ts` and webhooks

- `express.json()` is global at line 83, before every router. There is no raw-body handling anywhere.
- `/api/webhooks` → `cronRouter` at line 132; `/api/cron` → `cronRouter` at 131.
- `appCheck.ts:36–41` exempts `/api/cron`, `/api/webhooks`, `/api/newsletter/unsubscribe` and `/api/beats/dial-in`. Enforcement is off in deploy (`APP_CHECK_ENFORCED=false`).
- The global rate limiter is at 99–101 (2000 per 15 min, real client IP).
- **`cron.ts` has no `/stripe` route.** Grep finds no "stripe" in it. Its webhook-ish routes are `POST /webhooks/sms/inbound` (768) and `/mailchimp` (861, 873).
- Plan: `app.post('/api/webhooks/stripe', express.raw(...))` registered above line 83. It is under the existing App Check exemption prefix.

### 0.3 Prices — **deviation from the brief's assumption**

- **`resolveBlendForSlot` does not return a price.**
  - `ResolvedBlend` (`blendResolver.ts:21–31`) has no price field.
  - Its source rows (`getSellableCandidates`, view `v_coffee_sellable_candidate`) do carry `retail_price_cents`, but `blendResolver.ts:55–65` drops it.
- `resolveCoffeeBlend` (148–157) returns no price either.
- `computeCollectionOffer` (113–132) prices from `v_coffee_sellable_slot.retail_price_cents`.
  - Its discount `COLLECTION_DISCOUNT = 0.10` is hard-coded at line 84.
  - This is a business number. Bringing it under `commerce_parameter` is in the spirit of the brief but not on its seed list; see open questions.
- `catalogReads.getCoffeeRetailPrices(filter, runner)` (361–372) reads `coffee_retail_price` JOIN `coffees`, with `weight_oz` returned as a string.
- `getSlotPrices(slotIds)` (346–353) reads `coffee_slot_price`.
- **Server-side price enforcement today exists only for the collection kind** (139–144). Dial, direct and legacy lines take the client's `priceCents` unchecked. B3 closes this for every kind, with the existing wording: "…price has changed … Refresh your cart and try again."
- Cart kinds the route accepts:
  - dial: `archetype + dialSortOrder + weightOz`
  - direct: `coffeeId + weightOz`
  - collection: `collection:true + archetype`
  - legacy: `blendId ?? id`, plus `variantId`
- The frontend sends only the first three (`CartContext.tsx:109–133`).

### 0.4 Cart → order path

There is one path: `CartContext.checkout()` (`CartContext.tsx:93–156`) → `lib/api.placeOrder` (`api.ts:57–77`) → `POST /api/orders`.

- `checkout()` is called from two places:
  - `PublicLayout.tsx:13`, which renders `FloatingCart` at 49–58
  - `FlavorQuiz.tsx:653`, which renders `FloatingCart` at 1481 and 2097
- `BloomPage.tsx`, `FlavorIntelligencePage.tsx` and `Profile.tsx` only call `addToCart`.
- **There is no second order-creation path.** `orders.ts:193` is the only `INSERT INTO "order"` outside tests, and `companyGiftRedemption` writes `subscription` only.
- Other details:
  - The "not live yet" copy is in `CartContext.tsx:154`, not in FloatingCart. It is shown for any error.
  - `placeOrder` drops the 409 body and throws a generic error (`api.ts:75`).
  - The cart lives in React state only.
  - The address comes from the profile's first shipping address. `addressId` is never sent, so `order.shipping_address_id` would always be NULL today.

### 0.5 Parameter pattern

| Piece | Where |
|---|---|
| `evidence_parameter` table | `schema.sql:2832–2840`; partial unique index at 2841; seeded with `WHERE NOT EXISTS` at 2845–2874 |
| `evidenceParameterService.setParameterInTx(tx, { key, value, note?, adminId? })` | line 60 |
| `evidenceReads.getParameters()` | 194–210; returns current + previous via LATERAL |
| `routes/evidenceAdmin.ts` `GET /parameters`, `PUT /parameters/:key` | 82–100; maps `EvidenceParameterError` |
| `EvidenceParametersCard.tsx` | takes no props; rendered at `AdminSommelierConfig.tsx:273` |

How `setParameterInTx` works:
1. `FOR UPDATE` on the current row.
2. 404 if the key is unknown.
3. Sane range parsed from the note's `Range:` clause (regex at 26). A note with no range is a 400.
4. No-op when the value is unchanged.
5. Otherwise stamp `superseded_at` on the old row and insert a new row whose note is the old note plus a changed-by suffix.

**Range-format note:** the regex expects `Range: 0 <= value <= 2000`. The brief's `Range: 0–2000` does not match it. The commerce notes will use the parser's form, which is the same meaning.

### 0.6 Email pattern

- `sendResendEmail({ to, subject, html, text, kind })` in `features/marketing/resendEmail.ts` does the sending. It never throws, and it is a no-op when `RESEND_API_KEY` is unset.
- The send + log door for `quizCompleteEmail` is `routes/newsletter.ts` `sendQuizCompleteEmailOnce` (40–85). It works as a claim:
  1. `INSERT transactional_email_log (email, template) … ON CONFLICT DO NOTHING RETURNING` claims the send.
  2. Send.
  3. On failure, `DELETE` the claim.
  4. On success, `UPDATE resend_message_id`.
- `roasteryPortalNotify.notifySubmission` uses the same claim pattern with a per-id template key (`roasty-portal-submit:<id>`). That is the precedent for `order_confirmation:<orderId>`.
- `transactional_email_log` (`schema.sql:1058`) has PK `(email, template)` and **no surrogate id**. Its Writer is `newsletter.sendQuizCompleteEmailOnce, roasteryPortalNotify.notifySubmission`.
- **This table is already multi-writer.** The brief says not to add a writer. To honour that, the order emails need one shared door. Plan: lift the claim/send/release logic into a single `transactionalEmail.sendOnce(...)` module that both existing callers and the new emails go through.
  - Doing that changes who writes the table, so it needs Dana's nod (see open questions).
  - The fallback is to declare the new email module as a third writer.

### 0.7 `tokenService.grantTokens`

- Signature: `grantTokens(uid: string, amount: number, reason: string, referenceId?: string): Promise<number>` (`tokenService.ts:65–96`).
- In one transaction it updates `user_tokens`, inserts a `token_events` row, and then fire-and-forget syncs the Firestore `tokenBalance`.
- It is identical to the inline orders block and **has no callers today**.
- The finalizer will call `grantTokens(uid, bonus, 'order_bonus', orderId)`. That removes `orders` from the Writer lists of `user_tokens`/`token_events` and of the Firestore `users/{uid}` line.

### 0.8 Current `Writer:` declarations (`backend/src/db/comments.sql`; `backend/lineage.json` is generated)

| Table | Line | Writer today |
|---|---|---|
| `"order"` | 370 | `orders.POST /api/orders` (Class fact) |
| `order_line_item` | 406 | `orders.POST /api/orders; seed` |
| `user_tokens` | 212 | `auth.POST /api/auth/sync, orders.POST /api/orders, tokenService.spendToken, tokenService.grantTokens; manual:grant_tokens` |
| `token_events` | 219 | the same, plus `tokenService.logUsage` |
| `user_profile` | 139 | 12 route entries + `seed` (no stripe writer yet; `stripe_customer_id` comment at 147 says "reserved … not written yet") |
| `transactional_email_log` | 557 | `newsletter.sendQuizCompleteEmailOnce, roasteryPortalNotify.notifySubmission` |
| firestore `users/{uid}` | 24 | names "orders token bonus (routes/orders.ts)" |

- `lint:lineage` (`scripts/lineage-scan.mjs`, in CI at `deploy.yml:138`) compares the module (file stem) of each SQL write against the table's Writer field.

### 0.9 Prod (read-only, 2026-10-31)

- `SELECT COUNT(*) FROM "order"` = **0**
- `SELECT COUNT(*) FROM order_line_item` = **0**
- No `fulfillment_status` values exist, so the FK can be added with nothing to migrate. `pending` will still be seeded as legacy because it is the column default.
- None of these exist yet: `commerce_parameter`, `checkout_session`, `checkout_session_line`, `stripe_event`, `order_payment_status`, `order_fulfillment_status`.
- `user_profile.stripe_customer_id` **already exists** (`schema.sql:200`). Part A adds only the partial unique index.
- `customer_order_kind` holds manual, subscription_renewal, gift_redemption, liam_followed. Its PK is `code`, with no surrogate id. That is pre-existing, and per CLAUDE.md it is not retrofitted here.

### Other findings the brief did not anticipate

1. **`"order"` and `order_line_item` are INSERT-only facts for `ab_app`.**
   - Source: `schema.sql:8941–8951`, the Customer Blueprint D11/D12 decision. It runs `GRANT SELECT, INSERT` and `REVOKE UPDATE, DELETE, TRUNCATE` at every boot.
   - The brief needs UPDATEs on `"order"`: `payment_status`, `amount_refunded`, `fulfillment_status`, `fulfillment_attempts`, `fulfillment_last_error`, `fulfillment_placed_at`, `order_placed_line`, `finalized_at`.
   - The quiz SCD2 flip has a precedent: a sanctioned **column-list UPDATE grant** listed in `lint-customer.mjs` RULE2_ALLOWLIST.
   - **Proposal:** grant `UPDATE (those columns) ON "order" TO ab_app`, written only by `checkoutService`, and allow-listed the same way. `order_line_item` stays INSERT-only. **Needs Dana's yes**, since it reopens a D11 decision.
2. **`sommelierIntegrity.ts:260–273` (check 10)** warns whenever any writer of `"order"` is something other than the `orders` module doing INSERT only. The move to `checkoutService` (INSERT + UPDATE) will trip it unless the check is updated. The check is meant to make sure Liam's `order_status` rule never claims a status nobody writes. Now that a real status is written, the check should name `checkoutService` as the expected writer.
3. **`order_line_item` has no `coffee_sku_id`/`coffee_id` columns.**
   - Its SKU FK is `blend_id → coffee_sku`. The brief's `checkout_session_line.coffee_sku_id` maps onto `order_line_item.blend_id`.
   - The coffee is derivable from `coffee_sku.coffee_id`.
   - No new column is planned on `order_line_item` beyond the brief's `display_name` and `weight_oz`.
4. **Profile total display bug.**
   - `unit_price_charged` is stored in dollars (`orders.ts:214`).
   - `users.ts:96–98` sums it as `total_cents`, and `users.ts:203` divides by 100 again, so Profile would show 1/100 of the real total.
   - It has never been visible, because there are 0 orders. Fix in C4 by reading `"order".total_amount_paid`.
5. **`address` has no name, line-2 or phone columns.** The Stripe customer shipping uses `user_profile` first/last name.
6. **`/profile` is not under `PrelaunchGate`.** `VITE_PRELAUNCH_MODE` is `'true'` in the prod build, so `/checkout` under the gate is reachable on prod only with `?preview=true`. That matches the brief's "under `PrelaunchGate`". `PRELAUNCH_OPEN_ROUTES` in `lib/prelaunch.ts` already has a comment reserving a spot for checkout; the gate stays closed (not added to the open list) in this brief.
7. **Stripe shipping tax code `txcd_92010001`.** The public tax-code page did not show it on fetch. It will be confirmed against the Tax Codes API (`GET /v1/tax_codes/txcd_92010001`) with the test key before seeding.
8. **No Stripe dependency** exists in either `package.json`.

### Open questions for Dana (asked at the Task 0.5 pause)

- **A.** Column-list UPDATE grant on `"order"` for `checkoutService` (finding 1)? Recommended.
- **B.** Should the order emails share one `transactionalEmail` door for the log table, with the two existing callers moved onto it? Or should `orderEmails` be declared as a third writer?
- **C.** Move `COLLECTION_DISCOUNT` (10%) into `commerce_parameter` as `collection_discount_pct`? It is a business number, but outside the brief's list.

### Dana's decisions (2026-10-31)

- **A — keep D11.** There is no UPDATE grant on `"order"`, and no mutable columns are added to it.
  - Dropped from Part A: `payment_status`, `fulfillment_attempts`, `fulfillment_last_error`, `fulfillment_placed_at`, `order_placed_line`, `amount_refunded`, `finalized_at`.
  - Instead there is an insert-only **`order_event`**:
    - `id SERIAL`, `order_id`
    - `event_kind`, a FK to the new lookup `order_event_kind`. Seeds: paid, finalized, fulfillment_dispatched, fulfillment_placed, fulfillment_failed, fulfillment_needs_attention, shipped, delivered, canceled, refund_partial, refund_full.
    - nullable `payment_status` FK and `fulfillment_status` FK
    - `amount_refunded_cents`, `stripe_ref`, `note`, `source` (webhook | finalizer | admin | cron), `created_at`
  - Its only writer is `checkoutService`.
  - Liam's order-placed line is the `note` on the `finalized` event.
  - `finalizePaidOrder` is idempotent: if a `finalized` event already exists for the order (checked inside the transaction), the call is a no-op.
  - **`v_order_status`** (one row per order) is the only read path for order state: latest payment status, latest fulfillment status, refunded cents, `finalized_at` and `order_placed_line`. Profile, `GET /api/orders`, catalogService open-orders and the checkout status route all read it.
  - `"order".fulfillment_status` is written once at insert as `awaiting_manual` and is commented as a legacy at-insert value.
- **B — one shared sender.** The two existing `transactional_email_log` writers and the new order emails all go through one module, declared as the one writer. Behaviour is unchanged.
- **C — yes.** New `commerce_parameter` rows `collection_discount_pct = 10` (Range 0–50) and `collection_min_members = 3` (Range 2–6), read through `commerceParam` in `blendResolver`. The constants at `blendResolver.ts:84, 87` are removed.
- Also approved: the Profile 100× fix in C4, updating Liam health check 10 for the new writer, and checking the shipping tax code against the API before seeding.

---

## Task 0.5 — manual setup

Written into `launch/00_manual-setup/MANUAL_SETUP_IDS.md` under "Stripe". Waiting on Dana for:
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Secret Manager. As of 2026-10-31 07:35 `gcloud secrets list` shows neither.
- The `VITE_STRIPE_PUBLISHABLE_KEY` value.

**Resolved 2026-10-31:** both secrets exist; the publishable key is `pk_test_51UVkXO…`. The Cloud Run runtime service account (`892123729036-compute@`) has project-level `secretAccessor`, so no per-secret grant was needed. Stripe Tax was `pending` (missing head office): Dana added the head office (Union City, NJ) and an active NJ test registration during Part E.

---

## Why no existing table fits (Part A, plus Dana's decision A)

- **`commerce_parameter`:** `evidence_parameter` is the cupping-evidence rule store, read only through the evidence modules and documented as such; `marketing_config` is a three-key URL store with no history. Neither should grow a commerce vocabulary, and commerce needs text values (tax codes, an email, a list), which `evidence_parameter.value NUMERIC NOT NULL` cannot hold.
- **`order_payment_status` / `order_fulfillment_status` / `order_event_kind`:** `customer_order_kind` is the line's origin (manual, renewal, gift), not a payment or fulfillment state, and has no customer label.
- **`checkout_session` / `checkout_session_line`:** `"order"` is an immutable paid fact; a cart waiting for payment has a different lifecycle (open, complete, expired) and is mostly never paid. `user_payment_detail` is retired (Stripe holds payment methods); `roastery_shipment_details` stays reserved for brief 3.
- **`stripe_event`:** no ledger of inbound webhooks exists. `api_event` captures mutating API requests with a redacted body and the response status, one row per request: it has no unique Stripe event id to dedupe on, no processed/error state for retries, and does not keep the full signed payload. The Stripe webhook is registered above `apiEventLog` (raw body), so it is not in `api_event` at all.
- **`order_event` + `v_order_status` (decision A):** D11 keeps `"order"` insert-only for `ab_app`, so no existing table can hold the order's changing state. `roastery_shipment_details` is per shipment and reserved; `notification_log` is outbound messages. An insert-only event row per state change, read through one view, keeps D11 and gives a history for free.

## Side effects moved (old → new)

From `routes/orders.ts` POST at `f58162c` to `services/orderFinalizer.ts` `finalizePaidOrder` (runs on payment; idempotent on the `finalized` order_event under an advisory lock):

| Side effect | Old (orders.ts @ f58162c) | New |
|---|---|---|
| Order-placed beat (Liam's line) | 245–257, before the response | `orderFinalizer.ts`, inside the claim transaction; the line is the `finalized` event's note, read by `/checkout/return` |
| Order bonus tokens + Firestore `tokenBalance` sync | 271–300, inline SQL on `user_tokens` / `token_events` | `tokenService.grantTokens(uid, orderBonus, 'order_bonus', orderId)` (same SQL, same sync) |
| `updateOrderOutcomes` | 303 | step `order_outcomes` (paid_at as the order time) |
| `dispatchDelayedBeats` (+ `getBrewProfile`) | 324–334 | step `delayed_beats` |
| `refreshLifecycleState` | 338–340 | step `lifecycle` |
| (new) fulfillment | — | step `fulfillment` → `dispatchFulfillment` (manual adapter: admin email) |
| (new) confirmation email | — | step `confirmation_email` → `sendOrderConfirmationEmail` |
| Shopify `createOrder` | 181–186 | gone from the path (`services/shopify.ts` untouched until brief 4) |

`record` (customerFacts), `computeBehavioralConfidence` and `writeDialPositionSignal` were never in the POST (feedback route only) and stay there.

## Webhook event matrix (`routes/stripeWebhook.ts`)

| Event | Handling |
|---|---|
| (any) bad signature | 400, nothing recorded |
| (any) already processed | 200 `{ duplicate: true }`, nothing re-run |
| `checkout.session.completed`, payment mode, `payment_status=paid` | `completeCheckoutSession` (order exactly once) → `finalizePaidOrder` |
| `checkout.session.completed`, still unpaid (async method) | recorded, waits for `async_payment_*` |
| `checkout.session.async_payment_succeeded` | as completed |
| `checkout.session.async_payment_failed` | session expired + warning |
| `checkout.session.expired` | session `expired` (no order) |
| `charge.refunded` | `refund_partial` / `refund_full` order_event with Stripe's cumulative `amount_refunded` |
| a completed session this DB never created | recorded with the reason, marked processed, 200, **never retried** (Dana's change 2) |
| anything else (`payment_intent.payment_failed`, …) | recorded, marked processed |
| handler error | `error` written, 500, Stripe retries; the retry runs it again |

## `commerce_parameter` rows seeded

| key | value | sane range / format |
|---|---|---|
| shipping_fee_cents | 595 | integer 0–2000 |
| free_shipping_min_bags | 2 | integer 1–10 |
| checkout_session_expiry_minutes | 30 | integer 30–1440 |
| tax_collection_enabled | 1 | integer 0–1 |
| stripe_tax_code_coffee | txcd_41050006 | stripe tax code (API: "Coffee Beans or Ground Coffee") |
| stripe_tax_code_shipping | txcd_92010001 | stripe tax code (API: "Shipping") |
| admin_alert_email | dana@axisandbloomcoffee.com | email |
| subscription_discount_pct_1_bag | 5 | 0–50 (brief 2) |
| subscription_discount_pct_2plus_bags | 10 | 0–50 (brief 2) |
| subscription_frequency_weeks | 2,4,6 | integer list (brief 2) |
| collection_discount_pct | 10 | 0–50 (decision C, was COLLECTION_DISCOUNT) |
| collection_min_members | 3 | integer 2–6 (decision C, was COLLECTION_MIN_MEMBERS) |

## Part E — how each step was verified

Run on 2026-10-31 in Stripe **test mode**, against a local backend on **`axisandbloom_test`** (prod untouched), browser driven through the Chrome extension with Dana signed in as `danabar.mail+checkout1@gmail.com` (customer; kept, per Dana). The Stripe CLI could not be installed (download blocked), so `backend/tmp/stripe-relay.ts` read the account's real events from the Events API and posted them to the local webhook, signed with a local test secret through stripe-node's `generateTestHeaderString`. Stripe's own delivery to the prod URL is therefore a post-deploy check.

| Step | Result |
|---|---|
| 4242, 1 bag, Union City NJ | order `3d2003bd…`: $29.00 + $5.95 shipping + $0 tax = $34.95 (fee $1.31); one `order`, one line "Classic Balanced" 12 oz; events paid → finalized (Liam's line) → fulfillment_dispatched (awaiting_manual); `v_order_status` "Paid · being roasted"; admin email to dana@ and confirmation to the customer, both with Resend ids; order_bonus +10 in `token_events`; beats order_placed, arrival_note, dial_in. Return page showed Liam's line, the line, ships-to, $34.95 |
| 4000 0000 0000 0002 | declined inline by Stripe ("Your credit card was declined…"); no order, no email; `payment_intent.payment_failed` recorded and processed; the session stayed open |
| 4000 0025 0000 3155 (3DS) | Stripe's test challenge, Complete → order `8a7d757a…`, $34.95, both emails, return page with a second Liam line |
| Replay `evt_1UWchu0QYxZQN6jDNciRyLWi` | 200 `duplicate: true`; still 2 orders and 4 emails |
| 2 bags | our summary "Free shipping $0.00"; Stripe "Shipping · Free shipping · Free", total $58.00 |
| Session expiry | the 2-bag session expired through the Stripe API (as at the 30-minute window) → `checkout.session.expired` → `expired`, no order |
| `shipping_fee_cents` 595 → 650 | through `commerceParameters.setParameter` (the admin route's door; Dana checks the `/admin/commerce` page on her own account): the running backend served 650 after 15 s, no restart; cart and Stripe showed $6.50 (total $35.50); restored to 595 (another superseding row) |
| Tax, NJ registration active | coffee: $0, `taxability_reason: product_exempt` under NJ sales tax 6.625%; **shipping line: `amount_tax: 0`** on $5.95; `total_details.amount_tax` 0 |
| No roaster name | searched for the roaster ("Joe Coffee Company") and its coffee name ("Benchmark") in the Stripe line items, the status route payload (return page), the rendered customer email and the Profile order rows: all clean; only the internal admin email carries them, by design |
| Standing trio (`launch/REGRESSION.md`) | not run: it checks the live site, so it runs after the deploy |

Found and fixed during Part E: `/checkout` treated a failed profile read as "no saved addresses" and showed the add-address form (a duplicate address per retry). It now creates the session without an address id; the server ships to the default and returns the snapshot (`790f251`). Locally the profile read always fails because `GET /api/users/profile` writes Firestore and the dev write guard blocks it; the order-bonus Firestore sync is blocked the same way (the SQL grant committed). Both are local-only.

Noticed, not changed: Embedded Checkout also offers Cash App Pay, Klarna, Affirm, Bank, Link and Amazon Pay (account payment-method settings; the brief names card, Apple Pay, Google Pay; Bank/Klarna are async and handled by `async_payment_*`). The 3DS page names the merchant "CREATIVE BOX LLC SANDB" (sandbox public details, brief 4).

## Tests

New: `commerceParameters.test.ts`, `cartResolver.test.ts`, `checkoutService.test.ts` (test DB, Stripe mocked; carries orders.stock's "never touches coffee_sku"), `stripeWebhook.test.ts` (incl. the unknown-session case), `orderFinalizer.test.ts`, `fulfillment/fulfillment.test.ts`; `orders.stock.test.ts` now asserts the 410. `sommelierGate.test.ts` expects `checkoutService`. Full suite 1,040 passed; failures: exactly the 7 known (quizScoring 6, schema.catalog_blueprint `dial_position_signal` 1, not fixed per Dana) plus 5 s timeouts under Cloud SQL latency in palateReads / coffeePresentation / cuppingImmutability / customerIntegrity / evidenceViews / sommelierAnswer, which all pass with `--testTimeout=30000` (139/139). `comments.format`, the six lints including `lint:lineage`, typecheck and `vite build` green.

## Anything still creating or reading orders outside `checkoutService`

- **Writers:** none. `checkoutService` is the only writer of `"order"`, `order_line_item`, `order_event`, `checkout_session*` (lineage: no undeclared writers). The SQL seeds and test fixtures write `order_line_item` as before.
- **State readers:** only through `v_order_status` (`routes/orders.ts` GET, `routes/users.ts` profile, `catalogService` open orders, `checkoutService` status). Nothing reads `"order".fulfillment_status` directly.
- **Fact readers (dates, lines, coffees; unchanged):** `routes/admin.ts`, `behavioralConfidence`, `brewCard`, `customerIntegrity`, `customerReads`, `customerFacts`, `engagementMetrics`, `qrDoor`, `userSignals`, `sommelierIntegrity` (lineage).

## What brief 2 (subscriptions) will need from this code

- `checkout_session.mode = 'subscription'` is reserved; the first subscription checkout can save the card (`mode: 'setup'` or `payment_intent_data.setup_future_usage`) on the customer `stripe.getOrCreateStripeCustomer` already creates.
- Each renewal charge should land through the same door: a session-less completion path in `checkoutService` writing `"order"` with `is_subscription = true` and `order_kind = 'subscription_renewal'`, then `finalizePaidOrder` unchanged.
- The discounts and frequencies are already `commerce_parameter` rows (`subscription_discount_pct_*`, `subscription_frequency_weeks`); `cartResolver.shippingFor` is the shared shipping rule.
- The renewal cron writes events with `source: 'cron'` (already allowed in `order_event.source`).

## Post-deploy checks (Dana)

1. Push → deploy green → boot log `[stripe] mode=test`, `DB schema verified`.
2. `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md`.
3. One 4242 purchase on prod (`?preview=true`, `/checkout` is behind the pre-launch gate): Stripe's real delivery to `/api/webhooks/stripe` → order, both emails, Profile shows "Paid · being roasted" and the right total.
4. Stripe Dashboard → the endpoint's delivery log: the local-run events show as 200 `unknownSession` from then on (OT-60).
5. Standing regression trio on the live site (`launch/REGRESSION.md`) and the new Commerce section of `REGRESSION.md`.
