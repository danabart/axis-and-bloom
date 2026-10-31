# Claude Code brief — Commerce 1: Stripe one-time checkout

Workstream: commerce (`backend/src/features/commerce/README.md`) · Written 2026-10-29 by the CTO session · Touches money: use the strongest model available, one dedicated session · Dana runs it; merge to main = production deploy, so **nothing in this brief enables live keys**.

**Goal.** A signed-in customer with a cart on The Bloom reaches `/checkout`, pays with Stripe Embedded Checkout (card, Apple Pay, Google Pay; test mode), and the paid order lands on `"order"` + `order_line_item` exactly once. Every post-order side effect fires on *payment confirmed*, never on checkout attempt. Dana gets an email per paid order (manual fulfillment until the roaster adapter exists). The customer gets a confirmation email and a confirmation page in Liam's voice. Every business number is a `commerce_parameter` row editable in the admin portal.

**Out of scope here** (later briefs, see README): subscriptions, `/admin/orders`, refunds, mark-shipped, shipping email, live keys. Build the seams, not the features.

**House rules that bind this brief** (`CLAUDE.md`): nothing hard-coded (rules in tables); every table has a surrogate `id`; one writer per table, declared in `comments.sql`, enforced by `npm run lint:lineage`; nothing deleted from the DB; new objects get `COMMENT ON` lines and the brief ends with `npm run catalog:md -- --expect-db axisandbloom`; before any new table, say why no existing one fits (done in Part A).

---

## Task 0 — Verify current state (write findings in the closing report before changing anything)

1. `routes/orders.ts` POST: list every side effect after the order INSERT with file:line. Expected: order-bonus tokens via inline SQL on `user_tokens` + `token_events` (lines ~271–296) and Firestore `users/{uid}.tokenBalance` sync; `dispatchOrderPlacedBeat`; `updateOrderOutcomes`; `dispatchDelayedBeats` (with `getBrewProfile`); `refreshLifecycleState`; anything using `record` from `customerFacts`, `computeBehavioralConfidence`, `writeDialPositionSignal`. All move to `finalizePaidOrder` (B6). None may be dropped.
2. `index.ts`: `express.json()` is at line ~83; `/api/webhooks` is already mounted to `cronRouter` (line ~132) and `middleware/appCheck.ts` exempts `/api/webhooks`. The Stripe webhook needs the **raw body**, so it is registered as its own `app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), handler)` **above** `express.json()`. Confirm the cron router has no `/stripe` route.
3. Prices: `blendResolver.resolveBlendForSlot` returns `retail_price_cents` from `coffee_slot_price`; category coffees price from `coffee_retail_price` (`catalogReads.getCoffeeRetailPrices`). Confirm, and confirm the cart item kinds the route accepts today (dial, direct, collection, legacy `blendId`).
4. Cart → order path: `CartContext.checkout()` → `lib/api.placeOrder` → `POST /api/orders`. Consumers: `FloatingCart.tsx`, `PublicLayout.tsx`, `FlavorQuiz.tsx`, `FlavorIntelligencePage.tsx`. Confirm there is no second path.
5. Parameter pattern to copy: `evidence_parameter` + `services/evidenceParameterService.ts` (`setParameterInTx`, sane range in the note) + `evidenceReads.getParameters` + `routes/evidenceAdmin.ts` (`GET /parameters`, `PUT /parameters/:key`) + `frontend/.../admin/EvidenceParametersCard.tsx`.
6. Email pattern: how `quizCompleteEmail.ts` is sent through Resend and logged to `transactional_email_log` (which module owns the send + log; it is a multi-writer table today, so route the new sends through the same door and do not add a writer).
7. `tokenService.grantTokens` signature. The finalizer calls it instead of inline SQL (this removes `orders` as a writer of `user_tokens`/`token_events`; update `comments.sql` Writer fields accordingly).
8. `lineage.json` + `comments.sql`: current `Writer:` for `"order"`, `order_line_item`, `user_tokens`, `token_events`, `user_profile` (for `stripe_customer_id`), `transactional_email_log`.
9. Prod, read-only: `SELECT COUNT(*) FROM "order"; SELECT payment_status... ` (column does not exist yet; just count orders and lines). Expect near zero.

No DDL/DML against prod outside `schema.sql`/`comments.sql`, which apply at boot.

## Task 0.5 — Dana's manual setup (write this list into `launch/00_manual-setup/MANUAL_SETUP_IDS.md` under "Stripe", then pause until she pastes the values)

Status 2026-10-31 (CTO session, in the sandbox): steps 2, 3 (product category only; head office address waits for live activation), 4 (receipts) and 5 (colors; no logo) are DONE. Step 1 (keys) and step 6 (Secret Manager) are Dana's. Statement descriptor, support email and bank account are live-account settings, deferred to brief 4.

1. Stripe Dashboard, **test mode**: Developers → API keys → copy `pk_test_…` and `sk_test_…`.
2. Developers → Webhooks → add endpoint `https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/webhooks/stripe`, events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `payment_intent.payment_failed`. Copy `whsec_…`.
3. Settings → Tax: enable Stripe Tax, set the origin address (Union City, NJ), add the **New Jersey registration** (she holds one). Nothing else.
4. Settings → Emails: turn **off** Stripe's successful-payment receipts (ours go through Resend). Settings → Public details: statement descriptor `AXIS & BLOOM COFFEE` (≤22 chars), support email `dana@axisandbloomcoffee.com`.
5. Settings → Branding: logo + brand colors from `misc/design_documents` (styles Embedded Checkout).
6. GCP Secret Manager (project `axis-and-bloom-prod`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; add both to `deploy.yml --set-secrets`. Frontend build env: `VITE_STRIPE_PUBLISHABLE_KEY`. No `STRIPE_*` value is ever written into the repo.

Mode (test/live) is derived from the key prefix at boot and logged once. No other code may inspect it.

---

## Part A — Schema (`backend/src/db/schema.sql`, idempotent, additive) + `comments.sql`

Why no existing object fits (state this in the closing report too): `evidence_parameter` is the parameter store for the cupping-evidence rules, read only through evidence modules and documented as such; `marketing_config` is a three-key URL store with no history. Neither should grow a commerce vocabulary. `customer_order_kind` is a lookup for line origin, not payment or fulfillment state. `"order"` is an immutable paid fact; a cart waiting for payment is a different thing with a different lifecycle, hence `checkout_session`. `user_payment_detail` is retired (Stripe holds payment methods). `roastery_shipment_details` stays reserved for brief 3.

**`commerce_parameter`** (new; the brief's single source of business numbers)
`id SERIAL PK`, `key TEXT NOT NULL`, `value_numeric NUMERIC`, `value_text TEXT`, `since TIMESTAMPTZ NOT NULL DEFAULT now()`, `superseded_at TIMESTAMPTZ`, `note TEXT`; `CHECK ((value_numeric IS NULL) <> (value_text IS NULL))`; partial unique index on `key` where `superseded_at IS NULL`. Change = insert new row + stamp `superseded_at` on the old one, never UPDATE a value (same as `evidence_parameter`). Seed rows (only if the key has no current row):

| key | value | note (ends with Range: …) |
|---|---|---|
| `shipping_fee_cents` | 595 | Shipping charged when the order holds fewer bags than free_shipping_min_bags. Range: 0–2000 |
| `free_shipping_min_bags` | 2 | Bag count at which shipping is free; every line quantity counts one bag per unit, a collection counts its members. Range: 1–10 |
| `checkout_session_expiry_minutes` | 30 | Minutes a Stripe Checkout Session stays open. Range: 30–1440 (Stripe minimum 30) |
| `tax_collection_enabled` | 1 | 1 = Stripe Tax computes tax on every charge, 0 = off. Range: 0–1 |
| `stripe_tax_code_coffee` | text `txcd_41050006` | Stripe product tax code "Coffee Beans or Ground Coffee" (set as the account's preset category in the sandbox on 2026-10-31) |
| `stripe_tax_code_shipping` | text `txcd_92010001` | Stripe tax code for shipping charges (engineer confirms the code in Stripe's tax code list before seeding) |
| `admin_alert_email` | `dana@axisandbloomcoffee.com` | Address that receives the per-paid-order and attention emails |
| `subscription_discount_pct_1_bag` | 5 | Reserved for brief 2. Range: 0–50 |
| `subscription_discount_pct_2plus_bags` | 10 | Reserved for brief 2. Range: 0–50 |
| `subscription_frequency_weeks` | text `2,4,6` | Reserved for brief 2 |

**`order_payment_status`** and **`order_fulfillment_status`** (new lookups, `id SERIAL PK`, `code TEXT UNIQUE NOT NULL`, `label TEXT NOT NULL`, `customer_label TEXT NOT NULL`). Seed payment: `paid`, `refunded`, `partially_refunded`. Seed fulfillment: `awaiting_manual`, `placed`, `shipped`, `delivered`, `canceled`, `needs_attention`. Spelling settled: **`canceled`** (Stripe's). `customer_label` is what Profile shows ("Paid · being roasted"), so no status word is typed into the frontend. `catalogService` today treats `delivered`/`cancelled` as closed: make it read the lookup (closed = delivered, canceled) and stop matching strings.

**`checkout_session`** (new; one Stripe Checkout Session we created)
`id UUID PK`, `user_id UUID FK user_profile`, `stripe_checkout_session_id TEXT UNIQUE`, `mode TEXT NOT NULL` (`payment` now; `subscription` reserved), `status TEXT NOT NULL` (`open | complete | expired`), `subtotal_cents INT NOT NULL`, `shipping_cents INT NOT NULL`, `bag_count INT NOT NULL`, `shipping_address_id UUID FK address`, address snapshot columns (same names as `"order"`), `order_id UUID FK "order"` (set on completion), `created_at`, `expires_at`, `completed_at`.

**`checkout_session_line`** (new) `id UUID PK`, `checkout_session_id FK`, `coffee_sku_id UUID FK coffee_sku`, `coffee_id INT FK coffees`, `display_name TEXT NOT NULL` (house name at the time), `weight_oz NUMERIC NOT NULL`, `quantity INT NOT NULL`, `unit_price_cents INT NOT NULL`, `discount_cents INT NOT NULL DEFAULT 0`, `intended_for_user_id UUID`, `order_kind TEXT FK customer_order_kind`, `source TEXT` (`dial | direct | collection`), `archetype TEXT`, `dial_sort_order INT`.

**`stripe_event`** (new; webhook idempotency ledger) `id SERIAL PK`, `stripe_event_id TEXT UNIQUE NOT NULL`, `type TEXT NOT NULL`, `received_at TIMESTAMPTZ DEFAULT now()`, `processed_at TIMESTAMPTZ`, `error TEXT`, `payload JSONB NOT NULL`. Never purged (nothing-deleted rule); note the growth expectation in the comment.

**`"order"`** add: `payment_status TEXT NOT NULL DEFAULT 'paid' REFERENCES order_payment_status(code)`, `checkout_session_id UUID FK checkout_session`, `stripe_checkout_session_id TEXT UNIQUE`, `stripe_payment_intent_id TEXT UNIQUE`, `paid_at TIMESTAMPTZ`, `fulfillment_roaster_id UUID FK roaster` (NULL = manual adapter), `fulfillment_attempts INT DEFAULT 0`, `fulfillment_last_error TEXT`, `fulfillment_placed_at TIMESTAMPTZ`, `order_placed_line TEXT`, `amount_refunded NUMERIC DEFAULT 0`. `fulfillment_status` gets `REFERENCES order_fulfillment_status(code)` only after confirming every existing row holds a seeded code (expect `pending` rows: seed `pending` too, label it legacy). Existing money columns stay in **dollars** (`subtotal`, `shipping_fee_charged`, `taxes_collected`, `transaction_fee`, `total_amount_paid`); cents live in Stripe and in `checkout_session`. Do not migrate units.

**`order_line_item`** add `display_name TEXT`, `weight_oz NUMERIC`. **`user_profile.stripe_customer_id`**: partial unique index where not null.

`comments.sql`: a line for every new table and column (format in the file header; `Class: operating` for `checkout_session*`, `stripe_event`, `commerce_parameter`; `master` for the lookups). Writers as declared in Part B. Update `"order"` and `order_line_item` table comments (writer changes from `orders.POST` to `checkoutService`) and the reserved-column comments that say "never written today".

---

## Part B — Backend

**B1 `services/commerceParameters.ts`** — the only writer of `commerce_parameter`: `setParameterInTx(tx, { key, value, note, adminId })` mirroring `evidenceParameterService` (sane-range check from the note, no-op when unchanged, supersede-not-update), `getParameters()` for the admin card (current + previous), and the reader `commerceParam(key)` / `commerceParamText(key)` with a 60-second in-memory cache invalidated on write. Nothing in Parts B–C types a business number; every one goes through these two readers.

**B2 `services/stripe.ts`** — one client. `npm i stripe` in `backend/`, API version pinned in the constructor to `2026-09-30.endive` (the version the sandbox webhook endpoint `we_1UWaPO0QYxZQN6jDi2Y9lp6q` was created with on 2026-10-31). `STRIPE_ENABLED = Boolean(STRIPE_SECRET_KEY)`; when disabled, checkout returns 503 `{ error: 'checkout_unavailable' }` and the frontend shows the current "not live yet" copy. `getOrCreateStripeCustomer(userId)` reads/writes `user_profile.stripe_customer_id` (declare `stripe.getOrCreateStripeCustomer` as a writer of `user_profile`); customer carries `email`, `name`, `metadata.user_id`. Every Stripe create carries an idempotency key from our ids (`checkout_session:<id>`).

**B3 `services/cartResolver.ts`** — extract the cart-resolution block of `routes/orders.ts` unchanged in behaviour: `resolveCart(items): ResolvedLine[]` for dial / direct / collection / legacy `blendId`, with server-side price enforcement for **every** kind (client `priceCents` ≠ server price → 409 with the existing "price has changed, refresh your cart" wording). Each line carries `displayName` (house name: `platformName` / `coffee_alias`, never the roaster coffee name), `weightOz`, `coffeeId`, `coffeeSkuId`, `source`, `archetype`, `dialSortOrder`. `bagCount` = Σ quantity (collection = members × quantity). Shipping = `bagCount >= commerceParam('free_shipping_min_bags') ? 0 : commerceParam('shipping_fee_cents')`.

**B4 `services/checkoutService.ts`** — the **single writer** of `checkout_session`, `checkout_session_line`, `"order"`, `order_line_item`.
- `createCheckoutSession(userId, items, shippingAddressId?)`: resolve address (given id → profile default → 422 `shipping_address_required`); `resolveCart`; insert `checkout_session` + lines in one transaction; then create the Stripe Checkout Session: `ui_mode: 'embedded'`, `mode: 'payment'`, `customer`, `line_items[].price_data` (`currency: 'usd'`, `unit_amount`, `product_data.name = display_name`, `product_data.description = "<weight> oz · <archetype label>"`, `tax_code = commerceParamText('stripe_tax_code_coffee')`), `shipping_options[0].shipping_rate_data` (`fixed_amount`, `display_name` "Shipping" or "Free shipping", `tax_behavior: 'exclusive'`, `tax_code` shipping), `automatic_tax: { enabled: commerceParam('tax_collection_enabled') === 1 }`, `customer_update: { shipping: 'auto' }` with the snapshot address passed as the customer's shipping (Stripe Tax needs a destination), `metadata.checkout_session_id`, `payment_intent_data.metadata.checkout_session_id`, `return_url: <FRONTEND_URL>/checkout/return?session_id={CHECKOUT_SESSION_ID}`, `expires_at` from the parameter. Persist `stripe_checkout_session_id`. Return `{ clientSecret, checkoutSessionId }`. Two consecutive calls for the same open cart within the expiry window reuse the open session rather than piling up rows.
- `completeCheckoutSession(stripeSession)` (called by the webhook, one transaction, idempotent on `stripe_checkout_session_id`): if an order already exists for it, return it. Else insert `"order"` (`payment_status='paid'`, `paid_at`, `subtotal`, `shipping_fee_charged`, `taxes_collected` from `total_details.amount_tax`, `total_amount_paid` from `amount_total`, `transaction_fee` from the balance transaction when retrievable else NULL, `currency`, address snapshot copied from the session row, `stripe_*` ids, `fulfillment_status='awaiting_manual'`, `fulfillment_roaster_id NULL`), insert `order_line_item` rows from the session lines (`unit_price_charged`, `discount_amount`, `display_name`, `weight_oz`, `intended_for_user_id`, `order_kind`), set session `status='complete'`, `completed_at`, `order_id`. Return the order id.
- `expireCheckoutSession(stripeSessionId)`: `status='expired'`.
- `routes/orders.ts` POST becomes 410 `{ error: 'use_checkout' }` for one release; remove `createOrder` import; `services/shopify.ts` untouched (brief 4). GET and feedback routes stay; extend the history payload with `payment_status`, `fulfillment_status` + `customer_label`, `display_name`.

**B5 `routes/checkout.ts`** (`requireAuth`, `blockAnonymousAuth`, rate-limited 10/min/user): `POST /api/checkout/session` `{ items, shippingAddressId? }` → B4. `GET /api/checkout/session/:id/status` (ownership-checked) → `{ status, orderId?, orderPlacedLine? }` from **our tables** only, so the return page reflects the webhook's work.

**B6 `routes/stripeWebhook.ts`** — `POST /api/webhooks/stripe`, raw body, `stripe.webhooks.constructEvent` (400 on bad signature). Ledger: `INSERT INTO stripe_event … ON CONFLICT (stripe_event_id) DO NOTHING`; already `processed_at` → 200 at once. Handle `checkout.session.completed` (payment mode, `payment_status='paid'`) → `completeCheckoutSession` → `finalizePaidOrder`; `checkout.session.expired` → expire; `async_payment_succeeded` → same as completed; `async_payment_failed` → expire + log; `charge.refunded` → update `amount_refunded` + `payment_status` (full/partial) so brief 3's refunds work day one; every other type → record + mark processed. On handler error: write `error`, respond 500 so Stripe retries. Writer of `stripe_event`: `stripeWebhook`.

**B7 `services/orderFinalizer.ts`** — `finalizePaidOrder(orderId)`: idempotent (a `finalized_at` column on `"order"`, set first inside the transaction; second call returns). Then, each step guarded so one failure never blocks the next, each failure logged with the order id: order-bonus tokens via `tokenService.grantTokens` (bonus from the existing sommelier config read, as today) + Firestore balance sync as today; `dispatchOrderPlacedBeat` → store on `order.order_placed_line`; `updateOrderOutcomes`; `dispatchDelayedBeats`; `refreshLifecycleState`; whatever else Task 0 found; `dispatchFulfillment(orderId)` (B8); `sendOrderConfirmationEmail(orderId)` (B9). Move the code, keep its comments.

**B8 `services/fulfillment/`** — `FulfillmentAdapter { placeOrder(order): Promise<{ externalRef?: string }> }`. `manual.ts`: emails `admin_alert_email` the full order (house name **and** resolved roaster coffee + roaster, internal only), address, weight, grind if present, Stripe payment intent id; sets `fulfillment_status='awaiting_manual'`. `index.ts`: `dispatchFulfillment` picks the adapter by `fulfillment_roaster_id` (NULL → manual; any roaster id → manual too until the ShipStation adapter exists, with a `// seam: roaster adapters` comment). Failure → `fulfillment_attempts++`, `fulfillment_last_error`, `needs_attention`, alert email. A paid order is never lost. These status writes go through `checkoutService` helpers (one writer).

**B9 Emails** (through the existing Resend + `transactional_email_log` door, deduped on recipient + template + order id): `orderConfirmationEmail` (customer: house names, ships-to, totals incl. tax line when > 0, "we'll write again when it ships"; `quizCompleteEmail.ts` layout and voice, no urgency), `adminNewOrderEmail`, `adminFulfillmentAttentionEmail`.

**B10 Admin** — `routes/commerceAdmin.ts` under `requireAdmin`: `GET /api/admin/commerce/parameters`, `PUT /api/admin/commerce/parameters/:key` (thin callers of B1, same shape as `evidenceAdmin`).

**B11 `index.ts`** — register the raw-body webhook above `express.json()`; mount `/api/checkout` and `/api/admin/commerce`; boot log one line `[stripe] mode=test|live|disabled`.

---

## Part C — Frontend

**C1** `CartContext.checkout()` navigates to `/checkout` (no API call); add `clear()`. FloatingCart button "Checkout"; delete the "not live yet" copy except for the 503 case. Cart summary shipping line reads from a new `GET /api/checkout/rules` (public, cached) that returns the shipping fee and free-shipping bag count, so the frontend prints "Shipping $5.95 · free with 2 bags" / "Free shipping" from data.
**C2** `/checkout` (`components/checkout/CheckoutPage.tsx`, route inside the `CartProvider` scope, under `PrelaunchGate`, auth like `/profile`): left = order lines (extract `CartLines` from `FloatingCart`, don't duplicate), shipping, estimated total; right = Ships-to (default address card; none → `components/profile/AddressForm.tsx` extracted from `Profile.tsx` and reused there) then `@stripe/react-stripe-js` `EmbeddedCheckoutProvider` + `EmbeddedCheckout` with `fetchClientSecret` → `POST /api/checkout/session`. `loadStripe(VITE_STRIPE_PUBLISHABLE_KEY)` once at module level. Empty cart → redirect `/bloom`. 409/422/503 inline in the existing error style.
**C3** `/checkout/return` (`CheckoutReturnPage.tsx`): poll `GET /api/checkout/session/:id/status` every 1.5 s up to 20 s. `complete` → Liam's `orderPlacedLine` (fallback "Your coffee is on its way to being roasted."), what was ordered, ships-to, "we'll email you when it ships", link `/profile?tab=orders`; `clear()` the cart. `open` after timeout → "Almost there, we're confirming your payment. You'll get an email the moment it's done." (no red, no retry). `expired` → back to `/checkout`.
**C4** Profile → Orders tab shows `customer_label` from the lookup, nothing typed in the frontend.
**C5** Admin: generalize `EvidenceParametersCard` to take `{ title, endpoint }` and mount a second instance "Commerce parameters" on a new admin page `/admin/commerce` (sidebar entry), so Dana edits shipping, discounts, tax switch and alert email there. Text-valued parameters get a text input.

---

## Part D — Tests (`vitest`)

`cartResolver.test.ts` (every kind; mismatch → 409; bagCount/shipping from parameters: 1 bag → fee, 2 → 0, collection of 3 → 0, 80 oz → counts 1 bag); `checkoutService.test.ts` (completeCheckoutSession idempotent; address snapshot copied; units: cents in → dollars on order); `stripeWebhook.test.ts` (bad signature → 400; duplicate event → 200 no-op; completed → exactly one order; expired → status); `orderFinalizer.test.ts` (second call no side effects; throwing step doesn't stop the next; fulfillment failure keeps `payment_status='paid'`, sets `needs_attention`); `commerceParameters.test.ts` (supersede not update; sane range; cache invalidation). `comments.format.test.ts` and `lint:lineage` green.

## Part E — Acceptance (test mode; Dana in the session for prod steps)

Stripe test cards: `4242…` success → one order, one admin email, one customer email, Profile shows "Paid · being roasted"; `4000 0000 0000 0002` decline → no order, session expires; `4000 0025 0000 3155` 3DS → success; replay the `checkout.session.completed` event from the Dashboard → no second order, no second email; two bags → free shipping; one bag → $5.95; change `shipping_fee_cents` in `/admin/commerce` → next checkout reflects it without a deploy; tax line is $0 on coffee for a NJ address (Stripe Tax, exempt grocery code) and whatever Stripe returns on shipping. Confirm no roaster name on the Stripe form, the return page, both emails or Profile. Standing trio in `launch/REGRESSION.md`.

## Part F — Documentation

`comments.sql` (Part A) → `npm run catalog:md -- --expect-db axisandbloom` → commit `CATALOG.md`. `WHAT_WE_BUILT.md`: new entry "Commerce 1: Stripe one-time checkout" (two-system model payment ↔ fulfillment joined by the order; webhook-is-truth; the finalize side-effect list with old→new file:line; the adapter seam; parameters list). `WHAT_WE_BUILT_DB.md`: new tables and columns. `OPEN_TASKS.md`: OT-6 → checkout live in test mode via Stripe; add "ShipStation roaster adapter" and "mixed-roaster order split". `backend/.env.example`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` with comments; frontend env `VITE_STRIPE_PUBLISHABLE_KEY`. `deploy.yml`: the two secrets. `REGRESSION.md`: "one-time checkout success / decline / replay".

**Closing report** (`CLOSING_REPORT_1.md` in this folder): Task 0 findings; side effects moved with old→new file:line; webhook event matrix; every `commerce_parameter` row seeded; how each Part E step was verified; anything still creating or reading orders outside `checkoutService`; what brief 2 (subscriptions) will need from this code.
