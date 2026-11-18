# Claude Code brief — Commerce 3: Admin orders, refunds, mark-shipped, subscription self-service

Workstream: commerce (`README.md` here) · Written 2026-10-31 by the CTO session after Commerce 1 and 2 went live in test mode (`CLOSING_REPORT_1.md`, `CLOSING_REPORT_2.md`) · Touches money (refunds, card changes): strongest model, dedicated session · Dana runs it; push = deploy · **Test mode only.**

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (parameters: `commerce_parameter`; vocabularies: `order_refund_reason`, `shipping_carrier`) · G2.2 surrogate id PK · G2.3 prefixes `order_`, `subscription_`, `shipping_`, `commerce_` · G2.4 CATALOG.md checked (why nothing fits: see Part A) · G2.5 one writer (`checkoutService` for orders and order events, `subscriptionService` for subscriptions, new `shipmentService` for `roastery_shipment_details`), reads via `v_order_status`, `v_subscription_status` · G2.7 vocabularies are lookups · G2.13 state changes are events · G2.17 comments.sql → catalog:md · G3.1 routes call services · G3.3 idempotent · G3.6 admin gated server-side, ownership on every customer route · G3.9 reuse, do not fork · G1.6 push is deploy, one closing report.
Mode: test. STOP points: after Task 0 (findings + any contradiction with the code), and before Part E if a Stripe Dashboard setting is needed.

**Goal.** Close the two loops Commerce 1 and 2 left open. (1) The customer can manage their subscription from Profile: change frequency, skip the next delivery, pause until a date, resume, cancel, and update the card. (2) Dana can run the shop from `/admin/orders` and `/admin/subscriptions`: see every order with its customer, refund (full or partial), retry fulfillment, mark shipped with a tracking number (which emails the customer), and see each subscription with what ships next. The internal new-order email gains the customer's name, email and a link to the order's admin page.

**Decisions (Dana 2026-10-29/31 + CTO decisions for this brief; CTO ones are marked and reversible, flag in the writeup if the code disagrees):**
1. Self-service set: frequency, skip next, pause (with a resume date), resume, cancel, update card. All through `subscriptionService`, each an insert-only `subscription_event` with `source='customer'`.
2. (CTO) **Cancel is immediate**: no further charges, status `canceled`, Liam access ends per the Commerce 2 decision. There is no prepaid period to honour (each delivery is paid when charged), so "cancel at period end" has no meaning here. The copy says what they keep: the last paid bag still ships, their profile and flavor memory stay.
3. (CTO) **Pause has a resume date**, chosen by the customer, at most `subscription_pause_max_weeks` (new parameter, 12) ahead; resume is allowed any time. No open-ended pause: it hides churn and leaves cards on file for nothing.
4. (CTO) **Frequency change keeps the next delivery date** and applies the new spacing after it. Simplest to explain and to test.
5. (CTO) **Update card = Stripe Embedded Checkout in `mode: 'setup'`**, the same component `/checkout` already uses, inside Profile. Not Stripe's Customer Portal (it would show Stripe's branding and offer actions we handle ourselves). On completion the new payment method becomes the customer's default and the subscription's `stripe_payment_method_id`; if the subscription is `past_due`, the open invoice is paid once, immediately, with the new card (`invoices.pay`), so a fixed card recovers the renewal without waiting for Stripe's retry.
6. **Refunds are admin-only**, full or partial, reason from a lookup. Stripe is the source of truth: the DB changes only when `charge.refunded` arrives (Commerce 1 already handles it). A refund on an order not yet shipped also cancels its fulfillment (`canceled` event). Refunding a renewal does not cancel the subscription; that is a separate button.
7. **Mark shipped** writes one `roastery_shipment_details` row (carrier from a lookup, tracking number), a `shipped` order event, and sends the shipping email with the tracking link. Delivered is left for the ShipStation thread.
8. Status words customers see keep coming from the lookups' `customer_label` (Commerce 1 rule); the frontend types in nothing.

---

## Task 0 — Verify (write into `CLOSING_REPORT_3.md` before changing anything; STOP after)

1. Services to reuse, by name: `subscriptionService` (`setStatus`, `scheduleNext`, `coveredBy`, `recordSubscriptionEvent`, `getSubscriptionsForCustomer`, `markRenewalCharged`), `checkoutService` (`recordOrderEvent`, `recordRefund`, `getOrderSummary`, `OrderEventKind`), `fulfillment/index.ts` (`dispatchFulfillment`), `orderEmails.ts` + `transactionalEmail.sendOnce`, `stripe.ts` (`stripe()`, `getOrCreateStripeCustomer`), `commerceParameters.ts`, `routes/stripeWebhook.ts` event switch, `routes/commerceAdmin.ts`, `routes/subscriptions.ts` (`GET /mine`), `frontend/.../profile/SubscriptionSummary.tsx`, `admin/AdminCommerce.tsx`, `admin/AdminLayout.tsx` (sidebar), `admin/AdminCompanyGifts.tsx` (closest table/drawer sibling), `checkout/CheckoutPage.tsx` (the Embedded Checkout component to reuse in setup mode).
2. `subscription` columns from Commerce 2: `paused_until`, `skip_next_until`, `cancel_at`, `frequency_weeks`, `stripe_payment_method_id`, `failed_attempts`; `subscription_event_kind` seeds (`paused`, `resumed`, `skip_requested`, `frequency_changed`, `canceled`, `payment_method_updated` exist; confirm). `order_event_kind` seeds (`shipped`, `canceled`, `refund_partial`, `refund_full` exist; confirm).
3. `roastery_shipment_details`: no writer today; columns `order_id`, `roaster_id`, `tracking_number`, `carrier`, `status`, `shipped_at`; `order_line_item.shipment_id` FK exists. `catalogService` reads open orders per roaster from `v_order_status`.
4. How the webhook identifies a setup-mode Checkout Session (`mode === 'setup'`, `setup_intent`), and that `checkout.session.completed` currently assumes payment mode: it must branch, never create an order for a setup session.
5. The admin new-order email (`renderAdminNewOrderEmail`): confirm it lacks the customer email; `user_email` (primary) is where it lives.
6. Prod, read-only: counts of orders by `fulfillment_status`, subscriptions by status.

## Task 0.5 — Dana's manual steps
None expected. If a Stripe Dashboard setting turns out to be needed (e.g. a setup-mode payment method restriction), STOP and list it.

---

## Part A — Schema (`schema.sql` additive, `comments.sql`, `catalog:md`)

Why nothing existing fits (repeat in the closing report): refund reasons and carriers are new vocabularies (G2.7); `roastery_shipment_details` exists and is reused as is, gaining a writer; `order_event` / `subscription_event` already carry the history, no new event tables.

- **`order_refund_reason`** (new lookup): `id SERIAL PK`, `code TEXT UNIQUE`, `label`, `customer_label`. Seed: `requested_by_customer`, `damaged_in_transit`, `lost_in_transit`, `wrong_item`, `quality`, `duplicate`, `other`. (Stripe's own `reason` field takes only `duplicate | fraudulent | requested_by_customer`; map ours to that in code and keep ours as the record.)
- **`shipping_carrier`** (new lookup): `id SERIAL PK`, `code TEXT UNIQUE`, `label`, `tracking_url_template TEXT` (`{tracking}` placeholder), `is_active`. Seed: `usps`, `ups`, `fedex`, `dhl`, `other` (no template). Templates are data; the email and Profile build the link from the row.
- **`order_event`** add `refund_reason TEXT FK order_refund_reason(code)` (nullable; set on `refund_*` events).
- **`roastery_shipment_details`**: `carrier` becomes `REFERENCES shipping_carrier(code)` once every existing value (expect none) fits; `status` vocabulary via a new lookup `shipping_status` (`label_created`, `shipped`, `delivered`, `returned`) with FK. Comment: Writer `shipmentService.markShipped`.
- **`subscription_event`** gains nothing; the kinds exist. If `resumed` or `payment_method_updated` is missing, seed it.
- **`commerce_parameter`** seed if missing: `subscription_pause_max_weeks` = 12 (Range: 1–26), `refund_window_days` = 30 (Range: 0–365; the admin UI warns past it, never blocks).
- Views: extend **`v_order_status`** with `shipped_at`, `carrier`, `tracking_number`, `tracking_url` (from the carrier template) so Profile and admin read one path; extend **`v_subscription_status`** with `paused_until`, `skip_next_until`, `canceled_at` (from the event), `frequency_weeks`, `has_payment_method`.

---

## Part B — Backend

**B1 `subscriptionService` additions (one writer, every change an event, every function idempotent):** `changeFrequency(id, weeks)` (validate against `subscription_frequency_weeks`; keep `next_delivery_date`; event `frequency_changed` with old→new in the note), `skipNext(id)` (sets `skip_next_until` = `next_delivery_date` + 1 day, event `skip_requested`; a second skip while one is pending → 409 with friendly copy; the cron's existing `coveredBy` + `skipCoveredCycle` do the rest), `pause(id, resumeOn)` (validate ≤ max weeks ahead, status `paused`, `paused_until`, event `paused`), `resume(id)` (status `active`, clear `paused_until`, if `next_delivery_date` is in the past set it to today + 1 via `scheduleNext` logic, event `resumed`), `cancel(id, source)` (status `canceled`, `cancel_at` = today, event `canceled`; void the open invoice if any; `refreshLifecycleState`), `attachPaymentMethod(id, paymentMethodId)` (update Stripe customer `invoice_settings.default_payment_method`, set `stripe_payment_method_id`, event `payment_method_updated`; if `past_due` and an open invoice exists → `invoices.pay` once with an idempotency key `sub:<id>:recover:<invoice>`; a success flows through the normal `invoice.paid` path). Ownership is checked in the route; the service takes the subscription id.

**B2 `routes/subscriptions.ts`** (auth, `blockAnonymousAuth`, ownership on every route, zod): `POST /:id/frequency {weeks}`, `POST /:id/skip`, `POST /:id/pause {resumeOn}`, `POST /:id/resume`, `POST /:id/cancel`, `POST /:id/payment-method/session` → creates a Stripe Checkout Session `ui_mode: 'embedded'` (match what Commerce 1 used), `mode: 'setup'`, `customer`, `metadata.subscription_id`, `return_url: /profile?tab=orders&card=updated&session_id={CHECKOUT_SESSION_ID}`; responds `{ clientSecret }`. `GET /mine` extended with the new view columns and the allowed frequencies + max pause weeks (from parameters) so the UI types nothing.

**B3 Webhook:** `checkout.session.completed` with `mode === 'setup'` → read `setup_intent.payment_method` → `attachPaymentMethod`; never an order. Keep the ledger/no-op behaviour for unknown sessions.

**B4 `services/shipmentService.ts`** (new; the one writer of `roastery_shipment_details`): `markShipped(orderId, { carrier, trackingNumber, roasterId? , shippedAt? })`: insert the row (`status='shipped'`, `shipped_at`), set `order_line_item.shipment_id` on the order's lines (declare `shipmentService` as that column's writer), record order event `shipped` through `checkoutService.recordOrderEvent`, send `shippingNotificationEmail` (B6). Idempotent: a second call for the same order and tracking number returns the existing row.

**B5 Admin routes — `routes/commerceAdmin.ts` additions (under `requireAdmin`):**
- `GET /api/admin/orders?paymentStatus=&fulfillmentStatus=&q=&page=` from `v_order_status` joined to `user_profile` + primary `user_email`; `GET /api/admin/orders/:id` → summary (house names **and** resolved roaster coffee per line, internal), customer, shipment rows, `order_event` trail, Stripe ids as Dashboard deep links (test/live by `stripeMode()`).
- `POST /api/admin/orders/:id/refund {amountCents?, reason}` → `stripe.refunds.create({ payment_intent, amount?, reason: mapped, metadata: { order_id, reason_code } })` with idempotency key `refund:<order>:<amount>:<n>`; DB changes only via `charge.refunded` (extend `recordRefund` to carry `refund_reason` from metadata). If `fulfillment_status ∈ {awaiting_manual, needs_attention}` also record `canceled`; if already `placed`/`shipped`, the response tells Dana to cancel with the roaster by hand.
- `POST /api/admin/orders/:id/fulfillment/retry` → `dispatchFulfillment`. `POST /api/admin/orders/:id/shipped {carrier, trackingNumber}` → `shipmentService.markShipped`.
- `GET /api/admin/subscriptions?status=` from `v_subscription_status` + customer + next coffee (`resolveSubscriptionShipment`, house name); `POST /api/admin/subscriptions/:id/cancel` → `subscriptionService.cancel(id, 'admin')`.
- `GET /api/admin/commerce/lookups` → carriers, refund reasons (so the UI types nothing).

**B6 Emails** (through the shared sender, deduped): `shippingNotificationEmail` (carrier, tracking link from the template, "it's on its way"), `subscriptionPausedEmail`, `subscriptionResumedEmail`, `subscriptionCanceledEmail`, `subscriptionSkippedEmail`, `subscriptionFrequencyChangedEmail`, `cardUpdatedEmail` (short, warm, confirm what they asked for, one line on how to come back). `renderAdminNewOrderEmail` gains customer name + email + `/admin/orders/<id>` link.

---

## Part C — Frontend

**C1 Profile → Orders tab → `SubscriptionSummary.tsx` becomes `SubscriptionPanel.tsx`:** status label, next date, coffee lined up with "Change it on your Bloom Dial" link, frequency select (options from the API), buttons Skip next · Pause (date picker bounded by max weeks) / Resume · Update card · Cancel (confirm sheet; copy states what they keep). Update card opens the Embedded Checkout component in setup mode inline; on return (`card=updated`) show "Card updated" and refresh. Positive register; `past_due` reads "We couldn't charge your card. Update it and we'll retry right away."
**C2 Profile → Orders rows:** tracking link when `tracking_url` is present; status from `customer_label`.
**C3 `/admin/orders`** (`AdminOrders.tsx`, sidebar entry): table (date, customer, total, payment, fulfillment, subscription flag), filters, search by email/order id, detail drawer (lines with internal roaster resolution, ships-to, events trail, Stripe links), actions Retry fulfillment · Mark shipped (carrier select from lookups + tracking) · Refund (full/partial, reason select, confirm with amount; warning past `refund_window_days`). `/admin/orders/:id` deep link opens the drawer (the admin email links here).
**C4 `/admin/subscriptions`** (`AdminSubscriptions.tsx`, sidebar entry): table (customer, status, frequency, next date, next coffee, last order), filter by status, Cancel action with confirm. Follow `AdminCompanyGifts.tsx` patterns.

---

## Part D — Tests
`subscriptionService` additions (frequency keeps next date; skip twice → 409; pause beyond max → 422; resume with past date reschedules; cancel voids the open invoice and records the event; attachPaymentMethod on past_due pays the open invoice once and is idempotent). Webhook: setup-mode `checkout.session.completed` attaches the card and creates no order. `shipmentService` idempotent; `shipped` event + email once. Admin refund: partial and full map to the right event via `charge.refunded`; refund on `awaiting_manual` also cancels fulfillment; refund on `shipped` does not. Lints, typecheck, build green.

## Part E — Acceptance (test mode, local backend on the test DB; Dana signs in in the Claude tab group as in Commerce 1/2)
1. Profile: change frequency 2→4 weeks (next date unchanged, email), skip next (cron run with the date set to today: skipped, no charge, date advanced), pause 3 weeks then resume, cancel (status canceled, Liam access gone, confirm email).
2. Update card on a `past_due` subscription (use the decline-after-save card first, then update to 4242): the open invoice is paid at once, `invoice.paid` creates the renewal order, status back to `active`.
3. Admin: `/admin/orders` lists the test orders with customer emails; refund $5 partial on a paid order → `refund_partial` event, amount on `v_order_status`, Stripe shows the refund; full refund on an `awaiting_manual` order → `refund_full` + `canceled`; mark shipped with a USPS tracking number → shipment row, `shipped`, customer email with a working tracking link, Profile shows it; retry fulfillment on a `needs_attention` order.
4. Admin email for a new order now shows the customer's name, email and a link that opens the order drawer.
5. No roaster name anywhere a customer can see (Profile, emails).

## Part F — Docs and closing
`comments.sql` → `catalog:md` → `CATALOG.md`. `WHAT_WE_BUILT.md` entry "Commerce 3: admin orders, refunds, shipping, subscription self-service". `WHAT_WE_BUILT_DB.md`. `OPEN_TASKS.md`: close the Commerce 3 items from Commerce 1/2; add "ShipStation adapter: tracking webhooks call `shipmentService.markShipped`" and "Commerce 4: live cutover". `REGRESSION.md`: "customer skip/pause/cancel", "refund partial/full", "mark shipped email". `CLOSING_REPORT_3.md`: Task 0 findings, decisions applied, Part E evidence (Stripe ids), what Commerce 4 needs.
