# Claude Code Prompt — Stripe payment capture + subscriptions (launch step 12)

> Launch step 12 (G1) · Workstream: commerce-and-fulfillment · Model: **Fable, dedicated session — this touches money** · Written 2026-08-26 by the CTO session · Supersedes `launch/60_commerce-and-fulfillment/12_G1_payment_capture_PLACEHOLDER.md` (now a pointer to this file) · **Executes BEFORE step 08** (roaster fulfillment) and must not depend on it.

**Goal:** Take the customer's money on our own site. A signed-in customer with a cart on The Bloom reaches a `/checkout` page on axisandbloomcoffee.com, pays with Stripe Embedded Checkout (card, Apple Pay, Google Pay) for either a one-time order or a subscription, sees a confirmation in Liam's voice, and receives an order-confirmation email. The paid order is persisted on the normalized `"order"` table and handed to a **fulfillment adapter**; until step 08 wires the roasteries, that adapter is **manual mode** (Dana gets an email per paid order and an `/admin/orders` page to work from). Subscriptions renew on Stripe Billing, each renewal ships the customer's **current Bloom Dial position**, and customers pause / skip / change frequency / cancel from their Profile.

**Why this needs a build (context, not instructions):** `POST /api/orders` (`backend/src/routes/orders.ts`) does cart resolution, then calls `createOrder()` in `services/shopify.ts`, which throws because no Shopify credentials exist — so today the Bloom's Checkout button shows "Placing order…" then the fallback message in `CartContext.checkout()`. No `stripe` package exists in either `package.json`; no `STRIPE_*` secret exists in `.env`, `.github/workflows/deploy.yml`, or `launch/00_manual-setup/MANUAL_SETUP_IDS.md`. The only Stripe trace is `user_profile.stripe_customer_id` (unused) and `user_payment_detail` (unused). `subscription` exists as a skeleton (`status`, `frequency_days`, `next_delivery_date`) with no billing linkage; `user_lifecycle_stage` already has `SUBSCRIBER` and `refreshLifecycleState()` already reads `subscription.status`. OT-7 is done: the write path is already `"order"` + `order_line_item` (#73). The order route also carries a long tail of post-order side effects (inventory decrement, order-bonus tokens, Liam's order-placed beat, delayed beats, sommelier outcome tracking, lifecycle refresh) that today fire on *checkout attempt* — they must move to *payment confirmed* and none of them may be lost.

**Decisions already made — implement as stated, don't re-open:**

1. **Stripe on our own site** (Dana, 2026-07-18). Roasteries are fulfillment-only. The customer never sees Shopify, WooCommerce or ShipStation. Fee reference for Unit_Economics: 2.9% + 30¢ per card charge, +0.7% on recurring volume (Stripe Billing).
2. **Stripe Embedded Checkout** (Dana, 2026-08-26): Stripe's form rendered inside our `/checkout` page (`ui_mode: 'embedded'`), not the hosted redirect page and not a custom Payment Element page. Brand fonts/colors via Checkout appearance settings; layout is Stripe's. Moving to the Payment Element later is a component swap, so structure the page accordingly (the Stripe box is one child component).
3. **Subscriptions are in the Oct 1 offer, in this brief** (Dana, 2026-08-26 — overrides the playbook's "late-October soft-add"). Definition: **$32 per delivery, one 12oz bag, shipping always free**; each cycle ships the customer's **current Bloom Dial position** for the subscription's archetype; frequencies **every 2 / 4 / 6 weeks**; **pause, skip next, change frequency, cancel** are self-service in Profile.
4. **Shipping on one-time orders** (Dana, 2026-08-26): **$5.95 for a single bag; free when the order holds 2 or more bags** (a collection counts as its member count; a 5lb bag counts as a bag). Subscription deliveries: free, always.
5. **No sales tax collection at launch** (Dana, 2026-08-26). Coffee is treated as grocery-exempt; `STRIPE_TAX_ENABLED=false` wires Stripe Tax as a config switch, not a rebuild. Dana confirms with her accountant separately.
6. **Manual-fulfillment mode is the launch fallback** (Dana, 2026-08-26). Paid orders persist as pending fulfillment; the adapter interface is the seam step 08 plugs roaster adapters into. Launch does not block on step 08.
7. **Refunds are admin-triggered only** (per the original scope). No customer self-service refund.
8. **House-style names only leave our system.** Stripe line items, receipts and emails carry the slot's house name (`platformName` / `coffee_alias`), never the roaster's coffee name or the roaster — same roaster-blind rule the Flavor Intelligence page follows.
9. **Positive register everywhere** (house rule, `WHAT_WE_BUILT.md`): no urgency theatrics, no countdowns, no "don't miss out", no naming what isn't available. Checkout copy leads with what the customer gets.

Decisions made by the CTO session for scope control (reversible, flag in the writeup if you disagree): a subscription checks out on its own (mode `subscription`); one-time items stay in the cart for a separate checkout. Token purchases (OT-9) stay out of scope — note in the writeup how small the follow-up is once `services/stripe.ts` exists.

---

## Task 0 — Verify current state (confirm, don't assume)

Record findings in your writeup before changing anything:

1. Confirm no `stripe` dependency, no `STRIPE_*` in `backend/.env.example`, `deploy.yml --set-secrets`, or `MANUAL_SETUP_IDS.md`.
2. Read `routes/orders.ts` end to end. List every post-order side effect after the `"order"` INSERT (token bonus + Firestore balance sync, `dispatchOrderPlacedBeat`, `dispatchDelayedBeats`, `updateOrderOutcomes`, `refreshLifecycleState`, `writeDialPositionSignal`, anything else). Every one of them moves to Part B4 `finalizePaidOrder()`; none may be dropped.
3. Confirm `express.json()` is mounted globally in `index.ts` before all routers, and that `middleware/appCheck.ts` exempts `/api/webhooks/*`. The Stripe webhook needs the **raw body** for signature verification — Part B3 mounts it before `express.json()`.
4. Confirm `CartContext.checkout()` and its three consumers (`PublicLayout.tsx`, `FlavorQuiz.tsx` ×2, `FloatingCart.tsx`) — this is the only cart→order path; there must be no second one.
5. Confirm `refreshLifecycleState()` (`services/userLifecycle.ts`) derives `SUBSCRIBER` from `subscription.status = 'active'`, and how `SPONSORED_*` stages read `subscription.company_gift_id` / `sponsored_expires_at` — company-gift subscriptions are **not** Stripe subscriptions and must keep working untouched.
6. Confirm `user_bloom_dial_current_position` is written on every dial turn and read the archetype's `is_default` slot fallback from `dial_archetype_positions` (via `resolveBlendForSlot` / `computeDefaultSortOrder`).
7. Confirm which funnel/analytics stub exists for `Purchase` (`features/marketing/funnelEvents.ts`, `frontend/src/app/lib/analytics.ts` — step 02 left a call site).
8. In prod (read-only): `SELECT COUNT(*) FROM "order"; SELECT COUNT(*) FROM subscription; SELECT status, COUNT(*) FROM subscription GROUP BY 1;` — expect near-zero rows; note anything else.

No write DDL/DML against prod without Dana in the session; `schema.sql` is applied on deploy.

---

## Task 0.5 — Dana's manual setup (she does this; you write the checklist into `launch/00_manual-setup/MANUAL_SETUP_IDS.md` and wait for the values)

Dana has **no Stripe account yet** (confirmed 2026-08-26). Produce the checklist in the writeup and in `MANUAL_SETUP_IDS.md` under a new "Stripe" heading, then pause until she pastes the test keys:

1. Create the account at stripe.com (legal entity = the NJ LLC, EIN, payout bank account, website URL, product description "roasted coffee, one-time and subscription"). Activation runs in the background; **test mode is available immediately.**
2. Developers → API keys: copy `pk_test_…` and `sk_test_…`. (Live keys come later, Part G.)
3. Dashboard → Settings → Branding: logo, brand color, accent color, font per `misc/Brand Strategy & Visual Foundations Brief/` — this styles Embedded Checkout and receipts.
4. Settings → Customer portal: enable **update payment method**, **cancel** (at period end, with a reason list), **pause**; disable plan switching (we handle frequency changes ourselves, Part B6). Copy the portal configuration id.
5. Settings → Subscriptions and emails: turn **off** Stripe's own customer emails for successful payments and upcoming renewals (ours go via Resend, Part D); leave **failed payment** Smart Retries on (3 retries over ~1 week, then cancel).
6. Settings → Emails: turn off Stripe receipts (ours are the order confirmation).
7. Webhook endpoint: `https://<backend-host>/api/webhooks/stripe`, events listed in Part B3; copy the signing secret `whsec_…`.
8. Products are created **by code** on first run (Part B1 `ensureStripeCatalog()`), not by hand — so nothing to click here.
9. Secrets → GCP Secret Manager (project `axis-and-bloom-prod`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIG_ID`; add all three to `deploy.yml --set-secrets`. Frontend: `VITE_STRIPE_PUBLISHABLE_KEY` in the frontend build env (publishable keys are public by design). Add `STRIPE_TAX_ENABLED=false` and `ADMIN_ALERT_EMAIL` (Dana's address) as plain env vars.

---

## Part A — Schema (`backend/src/db/schema.sql`, idempotent, additive only — `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`)

**`"order"`** — add: `payment_status TEXT NOT NULL DEFAULT 'pending_payment'` (`pending_payment | paid | payment_failed | expired | refunded | partially_refunded`), `stripe_checkout_session_id TEXT UNIQUE`, `stripe_payment_intent_id TEXT UNIQUE`, `stripe_invoice_id TEXT UNIQUE` (subscription renewals), `subscription_id UUID REFERENCES subscription(id)`, `paid_at TIMESTAMPTZ`, `fulfillment_mode TEXT` (`manual | temecula | path` — the adapter that owns the order), `fulfillment_attempts INT DEFAULT 0`, `fulfillment_last_error TEXT`, `fulfillment_placed_at TIMESTAMPTZ`, `order_placed_line TEXT` (Liam's one line, generated at finalize so the return page can show it), `amount_refunded NUMERIC DEFAULT 0`. Rename nothing. `fulfillment_status` keeps its existing default `'pending'` with the vocabulary `pending | awaiting_manual | placed | shipped | delivered | canceled | needs_attention`. `external_shopify_order_id` stays (step 08 may use it).

**`order_line_item`** — add `display_name TEXT` (the house-style name as shown to the customer at purchase time — the snapshot rule, same reasoning as the shipping-address snapshot) and `weight_oz NUMERIC`.

**`subscription`** — add: `stripe_subscription_id TEXT UNIQUE`, `stripe_price_id TEXT`, `archetype archetype_enum`, `frequency_weeks INT` (2/4/6; keep `frequency_days` in sync = weeks×7 for the existing readers), `current_period_end TIMESTAMPTZ`, `paused_until TIMESTAMPTZ`, `cancel_at_period_end BOOLEAN DEFAULT false`, `canceled_at TIMESTAMPTZ`, `last_shipped_coffee_id INT REFERENCES coffees(id)`. `status` vocabulary: `active | past_due | paused | canceled | incomplete`. Company-gift rows keep `stripe_subscription_id IS NULL` — that null is how the two kinds are told apart; never infer from `company_gift_id` alone.

**`stripe_event`** (new) — `id TEXT PRIMARY KEY` (Stripe event id), `type TEXT NOT NULL`, `received_at TIMESTAMPTZ DEFAULT now()`, `processed_at TIMESTAMPTZ`, `error TEXT`, `payload JSONB`. This is the webhook idempotency ledger: insert-or-skip on arrival, mark processed on success. Retention: add it to the existing `purge-api-events` cron with a 90-day window.

**`user_profile.stripe_customer_id`** — already exists; add a `UNIQUE` partial index where not null.

Document every column in `WHAT_WE_BUILT_DB.md` (Part H).

---

## Part B — Backend

### B1. `services/stripe.ts` — one client, one catalog, one place for keys

- `npm i stripe` in `backend/`; pin the API version explicitly in the constructor. `STRIPE_ENABLED = Boolean(STRIPE_SECRET_KEY)`; mode is derived from the key prefix (`sk_test_` / `sk_live_`) and logged once at boot, never inferred anywhere else.
- `ensureStripeCatalog()` at boot (idempotent, keyed by `metadata.axis_key`): one Product `sub_12oz` "Axis & Bloom — your matched coffee, 12oz" with three recurring Prices `$32.00 / 2 weeks`, `/ 4 weeks`, `/ 6 weeks` (`recurring: { interval: 'week', interval_count: 2|4|6 }`, `metadata.frequency_weeks`). Cache the Price ids in memory; expose `getSubscriptionPriceId(weeks)`. One-time items do **not** get Products — they use `price_data` per line (prices come from `dial_slot_price` / `coffee_retail_price` at checkout time; Stripe is not the price source of truth).
- `getOrCreateStripeCustomer(userId)` → reads/writes `user_profile.stripe_customer_id`; Stripe customer carries `email`, `name`, `metadata.user_id`, `metadata.firebase_uid`.
- Every Stripe write that could be retried carries an `idempotencyKey` derived from our own ids (`order:<id>:session`, `sub:<id>:skip:<period_end>`, `refund:<order_id>:<amount>`).

### B2. `routes/checkout.ts` — `POST /api/checkout/session` (`requireAuth`, `blockAnonymousAuth`, rate-limited 10/min/user)

Extract the cart-resolution block of `routes/orders.ts` (dial / direct / collection / legacy `blendId`) into `services/cartResolver.ts` → `resolveCart(items) : ResolvedItem[]` with **server-side price enforcement for every kind**, not only collections: the client's `priceCents` is compared to the server's resolved price and any mismatch is a 409 with the existing "price has changed — refresh your cart" wording. `POST /api/orders` keeps using it (see B8).

Body: `{ mode: 'payment' | 'subscription', items?, subscription?: { archetype, frequencyWeeks }, shippingAddressId? }`.

1. Resolve the shipping address: `shippingAddressId` if given, else the profile's default shipping address, else 422 `{ error: 'shipping_address_required' }` (the checkout page handles this by showing the address form, Part C2).
2. **mode `payment`:** `resolveCart()`; compute `bagCount` (dial/direct = qty; collection = memberCount×qty); `shippingCents = bagCount >= 2 ? 0 : 595`. Insert the `"order"` row (`payment_status='pending_payment'`, address snapshot, `subtotal`, `shipping_fee_charged`, `total_amount_paid = 0` until paid, `fulfillment_mode` = current default adapter) and its `order_line_item` rows with `display_name` + `weight_oz`. Create the Checkout Session: `ui_mode: 'embedded'`, `mode: 'payment'`, `customer`, `line_items` with `price_data` (`currency: 'usd'`, `unit_amount`, `product_data.name = display_name`, `product_data.description = "<weight>oz · <archetype label>"`), `shipping_options: [{ shipping_rate_data: { display_name: bagCount >= 2 ? 'Free shipping' : 'Shipping', type: 'fixed_amount', fixed_amount: { amount: shippingCents, currency: 'usd' } } }]`, `automatic_tax: { enabled: STRIPE_TAX_ENABLED }`, `payment_intent_data.metadata.order_id`, `metadata.order_id`, `metadata.user_id`, `return_url: <FRONTEND_URL>/checkout/return?session_id={CHECKOUT_SESSION_ID}`, `expires_at` = now + 30 min. Persist `stripe_checkout_session_id`. Respond `{ clientSecret, orderId }`.
3. **mode `subscription`:** validate `archetype` is one of the five and `frequencyWeeks ∈ {2,4,6}`. Insert a `subscription` row with `status='incomplete'`, `archetype`, `frequency_weeks`, `user_id`, `household_id` (if any). Create the Checkout Session with `mode: 'subscription'`, `line_items: [{ price: getSubscriptionPriceId(weeks), quantity: 1 }]`, `subscription_data.metadata.subscription_id`, `metadata.subscription_id`, same `customer`, `return_url`, `automatic_tax`. Persist `stripe_checkout_session_id` on the subscription row (add the column). Respond `{ clientSecret, subscriptionId }`.
4. A user with an `incomplete` subscription row older than 30 min gets it reused/expired, never a pile of orphans: mark stale `pending_payment` orders and `incomplete` subscriptions `expired` in the `checkout.session.expired` handler (B3) **and** in a nightly sweep added to the existing cron router.

`GET /api/checkout/session/:sessionId/status` (auth, ownership-checked): returns `{ status: 'open' | 'complete' | 'expired', paymentStatus, orderId?, subscriptionId?, orderPlacedLine?, nextDelivery? }` from **our tables**, not from Stripe, so the return page reflects the webhook's work. If the webhook hasn't landed yet the page polls (Part C3).

### B3. `routes/stripeWebhook.ts` — `POST /api/webhooks/stripe`

- Mount in `index.ts` **before** `app.use(express.json())`: `app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler)`. Verify with `stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)`; 400 on failure. App Check already exempts `/api/webhooks/*` — confirm the path is matched by `isExempt` before the JSON middleware ordering change.
- Idempotency: `INSERT INTO stripe_event (id, type, payload) ... ON CONFLICT DO NOTHING`; if the row already has `processed_at`, respond 200 immediately. Process, then set `processed_at`; on error set `error`, respond 500 so Stripe retries (Stripe retries for up to 3 days).
- Respond within seconds: the handler does DB work and enqueues nothing external except the adapter call in `finalizePaidOrder`, which must itself be bounded (manual adapter = one email). If a roaster adapter later needs longer, step 08 moves it behind a queue — leave a comment at the seam.
- Events handled: `checkout.session.completed` (payment mode → `finalizePaidOrder(order)`; subscription mode → `activateSubscription(sub, session.subscription)`), `checkout.session.expired`, `checkout.session.async_payment_succeeded / failed` (defensive; cards settle synchronously), `invoice.paid` (subscription renewals **and** the first invoice → `createSubscriptionOrder(invoice)` → `finalizePaidOrder`), `invoice.upcoming` (→ upcoming-delivery email, Part D), `invoice.payment_failed` (→ `subscription.status='past_due'`, payment-trouble email), `customer.subscription.updated` (sync `status`, `current_period_end`, `cancel_at_period_end`, `pause_collection` → `paused_until`), `customer.subscription.deleted` (→ `canceled`, `canceled_at`, lifecycle refresh), `charge.refunded` (→ `amount_refunded`, `payment_status`). Every other event type: record + mark processed, no-op.
- Guard against the double-first-order trap: in subscription mode, the first cycle's coffee is created from `invoice.paid` **only** — `checkout.session.completed` activates the subscription and does not create an order. Assert this with a test (Part F).

### B4. `services/orderFinalizer.ts` — `finalizePaidOrder(orderId, { paymentIntentId | invoiceId, amountPaidCents })`

One transaction, idempotent: if `payment_status = 'paid'` already, return without side effects. Set `payment_status='paid'`, `paid_at`, `total_amount_paid`, `transaction_fee` (from the balance transaction when available; else null), Stripe ids. Then, in this order, each guarded so one failure never blocks the next and every failure is logged with the order id:

1. ~~Inventory decrement~~ RETIRED 2026-09-30 (drop-ship: we don't hold stock; see `features/catalog_write_door/CLAUDE_CODE_PROMPT_RETIRE_STOCK_AND_CLOSE_WRITE_DOOR.md`). Do not move or recreate it.
2. Order-bonus tokens + Firestore balance sync (moved verbatim).
3. `dispatchOrderPlacedBeat` → store the line on `order.order_placed_line`.
4. `dispatchDelayedBeats`, `updateOrderOutcomes`, `refreshLifecycleState`, `writeDialPositionSignal` (moved verbatim; keep their existing comments about the beat-engine cutover).
5. `dispatchFulfillment(orderId)` (B5).
6. `sendOrderConfirmationEmail(orderId)` (Part D).
7. `recordPurchaseEvent(orderId)` server-side funnel row (Part E).

### B5. `services/fulfillment/` — the seam step 08 plugs into

```ts
export interface FulfillmentAdapter {
  key: 'manual' | 'temecula' | 'path';
  placeOrder(order: OrderForFulfillment): Promise<{ externalRef?: string }>;
}
```

- `manual.ts`: sets `fulfillment_status='awaiting_manual'`, emails `ADMIN_ALERT_EMAIL` with the full order (house name **and** the resolved roaster coffee + roaster — this email is internal), address, weight, grind if present, and a link to `/admin/orders/<id>`.
- `index.ts`: `dispatchFulfillment(orderId)` picks the adapter per `order.fulfillment_mode` (default `manual` until step 08 changes the default and adds per-line roaster routing — leave a documented TODO for the mixed-roaster split, do not build it now). Wraps `placeOrder` in try/catch: success → `placed` + `fulfillment_placed_at`; failure → `fulfillment_attempts++`, `fulfillment_last_error`, `needs_attention`, admin alert email. **A paid order is never lost:** whatever happens here, `payment_status` stays `paid` and the order is visible on `/admin/orders`.
- `POST /api/admin/orders/:id/fulfillment/retry` re-dispatches; `POST /api/admin/orders/:id/fulfillment/shipped` `{ carrier, trackingNumber }` writes `roastery_shipment_details`, sets `shipped`, sends the shipping email (Part D) — this is how manual mode closes the loop and how step 08's tracking webhooks will call in later.

### B6. Subscriptions — `services/subscriptions.ts` + `routes/subscriptions.ts` (auth, ownership-checked on every route)

- `activateSubscription(subRow, stripeSubscriptionId)`: fetch the Stripe subscription, set `status='active'`, `stripe_subscription_id`, `stripe_price_id`, `current_period_end`, `next_delivery_date = current_period_start` (first) and thereafter `current_period_end`; `refreshLifecycleState` → `SUBSCRIBER`; send the subscription-started email.
- `createSubscriptionOrder(invoice)`: resolve the subscription from `invoice.subscription` metadata; **what ships:** `user_bloom_dial_current_position` for (`user_id`, `archetype`) → `resolveBlendForSlot(archetype, dial_sort_order, 12)`; if the user has no row for that archetype, use the archetype's default slot; if the resolver returns nothing, still create the order with `fulfillment_status='needs_attention'` and alert Dana — the charge already happened, so the order must exist. Insert `"order"` (`is_subscription=true`, `subscription_id`, `stripe_invoice_id`, `shipping_fee_charged=0`, `subtotal=32.00`, address = the profile's current default shipping address snapshot), one `order_line_item`, `last_shipped_coffee_id`, then `finalizePaidOrder`. Idempotent on `stripe_invoice_id`.
- `GET /api/subscriptions/mine` → status, frequency, next delivery date, **the coffee that will ship next** (same resolution as above, computed live, house name), paused_until, cancel_at_period_end, portal availability.
- `POST /api/subscriptions/:id/frequency` `{ weeks }` → `stripe.subscriptions.update(items: [{ id, price }], proration_behavior: 'none')`; DB via the `customer.subscription.updated` webhook, not optimistic writes.
- `POST /api/subscriptions/:id/skip` → `pause_collection: { behavior: 'void', resumes_at: current_period_end + frequency }` (skips exactly one cycle; the invoice in the window is voided, no charge, no order). One skip at a time; a second skip while one is pending returns 409 with friendly copy.
- `POST /api/subscriptions/:id/pause` `{ resumeAt? }` → `pause_collection: { behavior: 'void', resumes_at? }`; `POST …/resume` clears it. `POST …/cancel` → `cancel_at_period_end: true`; `POST …/reactivate` clears it before period end.
- `POST /api/subscriptions/portal` → `stripe.billingPortal.sessions.create({ customer, configuration: STRIPE_PORTAL_CONFIG_ID, return_url: /profile?tab=settings })` for payment-method updates and Stripe-side cancel.
- Lock rule the emails promise: the coffee is chosen when the invoice is paid (renewal moment). The `invoice.upcoming` email (Stripe sends it ~3 days before, per the Billing setting Dana leaves at default) tells the customer which coffee is *currently* lined up and that turning their dial before the renewal date changes it. Suppress that email while the subscription is paused or a skip covers the upcoming period (the voided invoice ships nothing).
- OT-14: swap the `/profile` placeholder in `buildSponsoredTrialEndingEmail()` / `buildSponsoredLapsedEmail()` (`routes/cron.ts`) for `/subscribe?archetype=<theirs>` (Part C4). Company-gift subscription logic itself is untouched.

### B7. Refunds + admin — `routes/admin.ts` additions (behind the existing `router.use(requireAdmin)`)

- `GET /api/admin/orders?paymentStatus=&fulfillmentStatus=&q=` paginated list; `GET /api/admin/orders/:id` detail incl. line items, resolved roaster per line (internal), shipment rows, Stripe ids as dashboard deep links, event trail from `stripe_event` filtered by the order's ids.
- `POST /api/admin/orders/:id/refund` `{ amountCents?, reason }` → `stripe.refunds.create({ payment_intent, amount?, reason, metadata.order_id })` with idempotency key; DB state changes only via `charge.refunded`. If `fulfillment_status ∈ {pending, awaiting_manual, needs_attention}` also set `canceled`; if `placed`/`shipped`, alert Dana to cancel with the roaster manually — the email says so plainly.
- `GET /api/admin/subscriptions` list with status, next delivery, next coffee, customer.

### B8. `routes/orders.ts` after this task

`POST /api/orders` no longer creates orders directly. Keep the route for one release returning 410 `{ error: 'use_checkout' }` so any stale client fails loudly, then remove it in the follow-up. `GET /api/orders` and the feedback route stay; extend the history payload with `payment_status`, `fulfillment_status`, tracking, `is_subscription`. `services/shopify.ts` stays untouched (step 08 decides its fate).

---

## Part C — Frontend

### C1. Cart → checkout handoff (reuse, don't rebuild)

`CartContext.checkout()` stops calling `placeOrder`; it navigates to `/checkout` (cart state already lives in the provider, which wraps `/bloom` and `/find-my-flavor` — confirm `/checkout` is inside the same provider scope in `App.tsx`; wrap it if not). The FloatingCart button label becomes "Checkout"; the "not live yet" fallback copy is deleted. Shipping line in the cart summary: "Shipping $5.95 · free with 2 bags" → "Free shipping" once bagCount ≥ 2 — positive register, states the benefit, never a warning.

### C2. `/checkout` page (`components/checkout/CheckoutPage.tsx`, under `PrelaunchGate`, `requireAuth` semantics like `/profile`)

Two columns on desktop, stacked on mobile: left = order summary (reuse `FloatingCart`'s line rendering — extract a `CartLines` component rather than duplicating), shipping line, total; right = **Ships to** (the default address card; if none, render the existing add-address form — extract it from `Profile.tsx` into `components/profile/AddressForm.tsx` and use the same component in both places) then the Stripe box: `@stripe/react-stripe-js` `EmbeddedCheckoutProvider` + `EmbeddedCheckout` with `fetchClientSecret` → `POST /api/checkout/session`. `loadStripe(VITE_STRIPE_PUBLISHABLE_KEY)` once at module level. Empty cart → gentle redirect to `/bloom`. Errors from session creation (409 price change, 422 address) render inline in the existing error style.

### C3. `/checkout/return` (`CheckoutReturnPage.tsx`)

Reads `session_id`, polls `GET /api/checkout/session/:id/status` every 1.5s up to 20s. `complete` + paid → confirmation: Liam's `orderPlacedLine` (fallback copy: "Your coffee is on its way to being roasted."), what was ordered, ships-to, "we'll email you when it ships", link to `/profile?tab=orders`; clears the cart (`CartContext` gets a `clear()`); fires the client `Purchase` analytics event once per order id (sessionStorage guard). Subscription → "Your first bag: <coffee>. Next delivery <date>." with the Profile link. `open`/timeout → "Almost there — we're confirming your payment. You'll get an email the moment it's done." (no red, no retry button; the webhook will land). `expired` → back to `/checkout`.

### C4. Subscribe entry points + Profile

- `/subscribe?archetype=` (`SubscribePage.tsx`): archetype (defaults to the user's quiz archetype; selectable among the five), the coffee currently lined up (from the dial position, house name, reusing the reveal-panel's card component), frequency choice 2/4/6 weeks, "$32 per delivery · shipping included", then the same Embedded Checkout box in `subscription` mode. Add a "Subscribe" door on The Bloom's commerce column (Part 20 layout) and in the reveal panel next to the existing add-to-cart — one link each, no new dial/card logic.
- Profile → Settings tab → **Subscription** section (`components/profile/SubscriptionPanel.tsx`) driven by `GET /api/subscriptions/mine`: status, next delivery date, next coffee with "Change it on your Bloom Dial →" link, frequency selector, Skip next / Pause / Resume, "Manage payment" (portal), Cancel (confirm sheet, at period end, copy states what they keep until then). No subscription → a single calm line with the `/subscribe` link.
- Profile → Orders tab: show payment/fulfillment status words in customer language ("Paid · being roasted", "Shipped · <carrier> <tracking link>") — map statuses in one helper, no negative wording for `needs_attention` (customer sees "Paid · being prepared").

### C5. Admin — `/admin/orders` (`AdminOrders.tsx`) + `/admin/subscriptions`

Add to the admin router in `App.tsx` and the sidebar. Orders: table with filters, status pills, detail drawer with the internal roaster resolution, actions: Retry fulfillment, Mark shipped (carrier + tracking), Refund (amount + reason, confirm). Subscriptions: list with next coffee. Follow the existing admin table/drawer patterns (`AdminCompanyGifts.tsx` is the closest sibling).

---

## Part D — Transactional emails (Resend, `features/marketing/templates/`, logged to `transactional_email_log`)

Use the `quizCompleteEmail.ts` layout and voice; plain, warm, no urgency. Templates: `orderConfirmationEmail` (immediately on paid: items with house names, ships-to, total, "we'll write again when it ships"), `shippingNotificationEmail` (on `shipped`: carrier + tracking link), `subscriptionStartedEmail`, `upcomingDeliveryEmail` (on `invoice.upcoming`: the coffee lined up, renewal date, dial link), `paymentTroubleEmail` (on `invoice.payment_failed`: Stripe is retrying; portal link to update the card — one email per failed attempt, Stripe's retry schedule paces it), `subscriptionPausedEmail` / `subscriptionCanceledEmail` (short, confirm what they asked for, one line on how to come back). Internal: `adminNewOrderEmail`, `adminFulfillmentAttentionEmail`. Dedupe every template on (`email`, `template`, reference id) via `transactional_email_log`.

---

## Part E — Analytics

Server-side: `recordPurchaseEvent(orderId)` writes the funnel row the step-02 stub anticipated (`quiz_funnel_event` or its commerce sibling — follow whatever `funnelEvents.ts` already does) with `amount_cents`, `is_subscription`, `bag_count`. Client-side: `Purchase` to GA4 + Pixel on the return page, deduped by order id (C3). Reporting: add `v_orders_daily` (orders, revenue, subscription starts, refunds by day) to the reporting views if `20_analytics-and-tracking` step 06 landed; else note it for that step.

---

## Part F — Tests

- `services/cartResolver.test.ts` — every item kind; price mismatch → 409; `bagCount` and shipping (1 bag → 595; 2 bags → 0; collection of 3 → 0; one 5lb → 595; 5lb + 12oz → 0).
- `routes/stripeWebhook.test.ts` — signature failure → 400; duplicate event id → 200 no-op; `checkout.session.completed` in subscription mode creates **no** order; `invoice.paid` creates exactly one order per invoice id on replay; `charge.refunded` partial vs full.
- `services/orderFinalizer.test.ts` — idempotent on second call; a throwing side effect does not stop the next; fulfillment failure leaves `payment_status='paid'` and sets `needs_attention`.
- `services/subscriptions.test.ts` — next coffee = dial position; no dial row → archetype default; resolver empty → `needs_attention` order still created; skip → `resumes_at = period_end + weeks`; second skip → 409.
- Stripe **test clocks** (`stripe.testHelpers.testClocks`) for a scripted renewal: create customer on a clock, subscribe, advance past `current_period_end`, assert one `invoice.paid` → one order → one email. Run this in the acceptance pass, not CI.
- Existing suites (`coffees.test.ts`, `admin.lookups.test.ts`) still green.

---

## Part G — Rollout and acceptance (staging first; live only with Dana in the session)

1. Test mode end to end with Stripe test cards: `4242…` success; `4000 0000 0000 0002` decline (customer sees Stripe's inline decline, no order finalized, order row `pending_payment` → expires); `4000 0025 0000 3155` 3DS challenge; webhook replay from the Dashboard (no double side effects); expire a session; refund full + partial from `/admin/orders`; a subscription with a test clock through two renewals, one skip, a frequency change, pause/resume, cancel at period end.
2. Manual-fulfillment loop: paid order → Dana's inbox email → Mark shipped with a tracking number → customer shipping email → Orders tab shows tracking.
3. Confirm no roaster name appears anywhere the customer can see: Stripe receipt/line items, both emails, Profile, return page.
4. **Live mode** (after Stripe activation): swap secrets to `sk_live_` / `whsec_` live endpoint / `pk_live_`; create a temporary $1 one-time line via a dev-only env override, Dana buys it, refunds it from `/admin/orders`, verifies the Stripe balance and both emails. Remove the override. This is the gate before the Sep 14–20 paid dry run (M11).
5. Standing trio (`launch/REGRESSION.md`).

Do not enable live keys, and do not change `PrelaunchGate` behaviour, without Dana saying so in the session.

---

## Part H — Documentation

- `WHAT_WE_BUILT.md`: new numbered entry "Stripe payment capture + subscriptions (launch step 12)": the two-system model (payment ↔ fulfillment joined by the order record), the webhook-is-truth rule, the finalize side-effect list and where it came from, the adapter seam for step 08, the subscription "current dial position" rule and skip/pause mechanics, the shipping and no-tax decisions with dates, and the copy rules.
- `WHAT_WE_BUILT_DB.md`: Part A columns/tables; `subscription` kind discrimination (`stripe_subscription_id` null = company-gift).
- `OPEN_TASKS.md`: OT-6 → "checkout live via Stripe; roaster placement still step 08"; OT-9 → note `services/stripe.ts` exists, purchase flow is a small follow-up; OT-14 → done (link swapped); add OT-NN "mixed-roaster order split — step 08".
- `launch/GAPS.md`: #4, #6, #12 resolved with dates. `launch/60_commerce-and-fulfillment/README.md` + `launch/TIMELINE.md`: step 12 status. `launch/00_manual-setup/MANUAL_SETUP_IDS.md`: Stripe section (account, mode, webhook endpoint, portal config id — no secret values).
- `REGRESSION.md`: scenarios "one-time checkout success/decline/refund", "subscription renewal ships current dial position", "webhook replay is a no-op".
- `backend/.env.example`: the new variables with comments.

**Writeup at the end:** Task 0 findings; the exact list of side effects moved into `finalizePaidOrder` with old→new file:line; every Stripe object created by `ensureStripeCatalog()` with ids; the webhook event matrix (event → handler → DB effect); how each Part G step was verified; anything you found that still creates or reads orders outside `cartResolver` / `orderFinalizer`; every place customer-facing copy names what is not available (so it can be reworded).
