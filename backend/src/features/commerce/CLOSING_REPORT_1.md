# Closing report — Commerce 1: Stripe one-time checkout

Brief: `CLAUDE_CODE_PROMPT_COMMERCE_1_CHECKOUT.md` · Session 2026-10-31 · Base commit `f58162c` (main == origin/main), prod rev `00803-9lk`.

Status: **Task 0 done. Task 0.5 written, waiting on Dana.** Parts A–F not started.

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

---

## Parts A–F

_Not started._
