# Closing report — Commerce 6: ShipStation fulfillment

Brief: `CLAUDE_CODE_PROMPT_COMMERCE_6_SHIPSTATION.md` · Started 2026-11-18 · **Status: Task 0 done, STOP for Dana's answers.** Nothing has been built, committed or written. ShipStation stays off (`shipstation_enabled` = 0, a parameter that does not exist yet).

**How this was read:**
- The code is at `main` = `ab6ebc6`.
- Prod data was read through the proxy, read-only (`backend/tmp/commerce6_task0_ro.ts`).
- ShipStation was read through the **V1 API** (`ssapi.shipstation.com`, basic auth with the Secret Manager key and secret). Only GET calls, nothing was created. The secrets were piped in and never printed.
- The ShipStation API docs were read where the account could not answer.

---

## Task 0.1 — ShipStation API (V1)

**Account, read 2026-11-18:**

| Call | Result |
|---|---|
| `GET /carriers` | 6 carriers, all `balance 0`, all `requiresFundedAccount` (see table below) |
| `GET /warehouses` | 1: **`1272614` "Joe Bean Roasters (Rochester NY)"**, 565 Blossom Rd, 14610, `isDefault` |
| `GET /stores` | 1: **`249581` "Manual Orders"** (ShipStation's built-in store; orders created through the API land here) |
| `GET /accounts/listtags` | none |
| `GET /webhooks` | 1 already exists: `22666`, `HookType API_TRACK`, `IsLabelAPIHook true`, to an AWS execute-api URL (`…/shipping-events/prod`). **Not ours, and I will not touch it** (see finding 4). |
| `GET /orders`, `/fulfillments`, `/shipments` | all 0 |
| Rate-limit headers | `X-Rate-Limit-Limit: 40` per minute, with remaining and reset headers. Confirmed. |

**Carriers.** Your ids `se-1906567` and `se-1906568` are ShipStation's ids for two of these carriers. V1 does not use them; it names a carrier by its code:

| V1 `code` | Name | V1 id (`shippingProviderId`) | Our `shipping_carrier` |
|---|---|---|---|
| `stamps_com` | Stamps.com (USPS) | 1906567 = **se-1906567** | `usps` |
| `ups_walleted` | UPS by ShipStation | 1906568 = **se-1906568** | `ups` |
| `fedex_walleted` | FedEx One Balance | 1906569 | `fedex` |
| `dhl_express_worldwide` | DHL Express from ShipStation | 1906877 | `dhl` |
| `globalpost` | GlobalPost | 1906862 | `other` |
| `seko_ltl_walleted` | SEKO LTL | 1906878 | `other` |

So the brief's mapping seed needs these codes: `fedex_walleted` (not `fedex`) and `dhl_express_worldwide` (not `dhl_express`).

**Services:** `usps_ground_advantage` exists under `stamps_com`, so the brief's `shipstation_requested_service` default is valid. UPS has `ups_ground` and `ups_ground_saver`.

**Calls the brief will use (V1):**
- **Create or update an order:** `POST /orders/createorder`.
  - Required: `orderNumber` (up to 50 characters), `orderDate`, `orderStatus`, `billTo`, `shipTo`.
  - Optional: `orderKey`, `items[]` (`lineItemKey`, `sku`, `name`, `quantity`, `unitPrice`, `weight {value, units}`), `weight`, `internalNotes`, `requestedShippingService`, `carrierCode`, `serviceCode`, `tagIds`, and `advancedOptions` (`warehouseId`, `storeId`, `customField1-3`).
  - The upsert keys on `orderKey`. **Only open orders can be updated** (`awaiting_payment`, `awaiting_shipment`, `on_hold`), and **partial updates are not supported**: every call sends the whole order.
- **Delete an order:** `DELETE /orders/{orderId}`.
- **Tags:** `GET /accounts/listtags`; tags are created once in the Dashboard or through the API. Adding a tag to an order is `POST /orders/addtag`.
- **Webhooks:** `POST /webhooks/subscribe` `{target_url, event, store_id?, friendly_name?}`. The events are `ORDER_NOTIFY`, `ITEM_ORDER_NOTIFY`, `SHIP_NOTIFY`, `ITEM_SHIP_NOTIFY`, `FULFILLMENT_SHIPPED` and `FULFILLMENT_REJECTED`.
  - The payload is only `{resource_url, resource_type}`. There is no signature, and V1 retries are not documented.
- **Reads:** `GET /fulfillments?orderNumber=…`, `GET /shipments?orderNumber=…`, `GET /orders?orderNumber=…`.

## Finding A — the brief listens for the wrong webhook (STOP, G1.4)

The brief has the ship-notify webhook (`SHIP_NOTIFY`) carry carrier, service, tracking and postage. ShipStation's docs say otherwise:
- `SHIP_NOTIFY` fires when **our account** creates a label. It **does not fire for orders fulfilled through a fulfillment partner**, nor for "Mark as Shipped".
- An order sent to a 3PL provider becomes `pending_fulfillment`. When the provider ships it, **`FULFILLMENT_SHIPPED`** fires, and its `resource_url` returns **fulfillments**, not shipments.
- A fulfillment carries:
  - the order and tracking: `fulfillmentId`, `orderId`, `orderNumber`, `trackingNumber`;
  - the dates: `shipDate`, `createDate`, `voidDate`, `voided`;
  - who shipped it: `carrierCode`, `fulfillmentProviderCode`, `fulfillmentServiceCode`, `sellerFillProviderId` and `sellerFillProviderName`;
  - a `fulfillmentFee`.
- **It has no postage or label-cost field.**

Joe Bean prints on **our shared** carrier account, so the postage is charged to our carrier balance. Whether that label also shows up in our `GET /shipments` with a `shipmentCost` cannot be read today: there are no orders, and the docs don't say. We will only know at the first real order.

**Proposed:**
- Subscribe to **both** `FULFILLMENT_SHIPPED` (the expected path) and `SHIP_NOTIFY` (in case shared-carrier labels show up as our shipments), and handle both resource types.
- Fill tracking and carrier from whichever arrives first. The shipment is idempotent per tracking number, which already exists.
- Fill postage only from a shipment's `shipmentCost`. When only a fulfillment arrives, postage stays NULL, and the daily reconcile tries `GET /shipments?orderNumber=` again.
- Subscribe to `FULFILLMENT_REJECTED` too. It moves the request to `needs_attention` and emails `admin_alert_email`.
- In Part E, record which events actually arrived and whether postage could be read. If it can't, the postage-vs-$5.95 comparison comes from the carrier balance history, by hand, once.

## Task 0.2 — The current fulfillment seam

- **`fulfillment/index.ts`:**
  - `adapterFor` picks manual for every order, roaster or not, with a comment marking where a roaster adapter goes.
  - `dispatchFulfillment(orderId, source)` records order-level `order_event`s (`fulfillment_dispatched` / `placed` / `failed` / `needs_attention`) through `checkoutService.recordOrderEvent`. On a failure it sends the attention email.
  - `retryFulfillment` only retries `needs_attention` / `awaiting_manual`.
- **`manual.ts`:** one `sendAdminNewOrderEmail(order)` for the whole order, deduped per order (`admin_new_order:<id>`). After the split, a manual roaster's email must list only its own lines and be deduped per order × roaster.
- **`checkoutService.getOrderSummary`:** lines carry `blendId`, `coffeeId`, `displayName` (the house name), `weightOz`, `quantity` and `unitPriceCents`. There is **no roaster id on a line**.
- **`orderEmails.internalLines(o)`** resolves `coffeeName`, `roasterName` and `roasterSku` per `blendId` from `coffee_sku` + `v_coffee`. I'll reuse it (G3.9), adding `roasterId` (`coffee_sku.roaster_id`) to its result, rather than writing a second resolver.
- **`"order".fulfillment_roaster_id`:** NULL on all 6 prod orders. Lines resolve to Joe Bean or Joe Coffee through `coffee_sku.roaster_id`.

**The ship-to snapshot** on `"order"` is `shipping_street/city/state/postal_code/country`:
- There is no recipient name, no second street line and no phone. The `address` form has a single `street` field.
- The ShipStation `shipTo.name` will come from the buyer's `user_profile.first_name`/`last_name`, as the admin email does now.
- `street2` will be empty.
- UPS sometimes wants a phone number; we have none to send. That's fine for USPS Ground Advantage.

## Task 0.3 — `shipmentService.markShipped`

- **Input:** `{ carrier, trackingNumber, roasterId?, shippedAt? }`.
- **Idempotent per (order, tracking):** a unique index `roastery_shipment_one_per_tracking` already exists, and an advisory lock is taken per order.
- **On a new shipment** it sends the shipping email and the household bag emails, once each.
- **`roastery_shipment_details`** already has:
  - `postage_cost NUMERIC` (dollars, unused);
  - `status`, FK to the `shipping_status` lookup (`label_created`, `shipped`, `delivered`, `returned`);
  - `carrier`, FK to `shipping_carrier`;
  - `created_at`, which still uses the old `timezone('utc', now())` default. I'll replace it with `now()` while I'm in the table (G2.9 as amended).
- **Two small fixes needed:**
  - the `shipped` order event's `source` is hard-coded `'admin'`, so a webhook call needs a `source` argument;
  - the order-level `shipped` status is set on the first shipment. With two roasters that becomes `partially_shipped` until both have shipped (Part A view).
- I'll extend the input with `serviceCode`, `postageCostCents`, `externalShipmentId`, `labelCreatedAt` and `fulfillmentRequestId` as the brief says.

## Task 0.4 — Carriers

- **`shipping_carrier`** seeds: `usps`, `ups`, `fedex`, `dhl`, `other`, with tracking templates. A new column `shipstation_carrier_code` will map them.
- **One code per row is not enough:** UPS can come back as `ups_walleted` or `ups`, and FedEx as `fedex_walleted` or `fedex`. Proposed instead: a small mapping lookup, `shipping_carrier_external_code (id, external_system, external_code UNIQUE, carrier_code FK)`, seeded from the Task 0.1 table. An unknown code maps to `other`, with a `needs_attention` note.
- Alternatively, a `TEXT[]` column on `shipping_carrier` would do. I recommend the lookup (G2.7, and it allows one row per code).

## Task 0.5 (brief's 0.5 = SKU fill) — `coffee_sku.roaster_sku` on prod: **zero**

| Roaster | Active SKUs | With `roaster_sku` | Weight set |
|---|---|---|---|
| Joe Bean Roasters | 4 (Blossom Dark Roast, Fabricator House Roast, Geometric Filter Coffee, Tiger Stripe Espresso) | **0** | 4 × 12 oz |
| Joe Coffee Company | 8 | **0** | 8 × 12 oz |

**As things stand, no order can be pushed.** Every line would go to `needs_attention` with the reason "no roaster SKU". Before Part E, Joe Bean needs to give us its codes for the four coffees, and they get entered through the admin catalog form. The SKU writer is the catalog service; that is a data entry by you, not a migration.

`weight_oz` is the 12 oz of coffee. Shipping weight = 12 + `packaging_weight_oz` (2) = 14 oz per bag.

## Task 0.6 — Roaster rows

| Roaster | id | address / email / contact |
|---|---|---|
| Joe Bean Roasters | `19098f5c-99b9-4d7c-90ef-ee33d1e896b7` | all NULL |
| Joe Coffee Company | `f42ad179-9ef4-410a-a92e-464eae1d84ce` | all NULL |

- The other roasters are inactive: Path, Temecula, Utopian and the Zzz test roastery.
- The Joe Bean ship-from address lives in ShipStation (warehouse `1272614`), which is enough.
- Our `roaster.address` stays NULL: the brief doesn't need it, and filling it is optional data entry.

## Task 0.7 — Webhook mounting and secrets

- **Mounting:** `/api/webhooks/*` is exempt from App Check (`middleware/appCheck.ts`) and from `api_event` capture (`apiEventLog.ts` `SKIP_PATH_PREFIXES`), so the token is not written to `api_event`.
  - The Stripe route is registered raw-body, above `express.json()` and the global rate limiter.
  - The ShipStation route is plain JSON. It can sit after `express.json()` in its own router mounted at `/api/webhooks/shipstation`. `cronRouter` is also mounted at `/api/webhooks`, but nothing overlaps.
- **Token in the path:** Cloud Run's request log records the full URL, so **`SHIPSTATION_WEBHOOK_TOKEN` will appear in Cloud Logging** (`httpRequest.requestUrl`), readable by anyone with log access to the project. V1 has no signature, and the subscribe call has no custom-header field. The body is never trusted, since we re-fetch `resource_url` with our key. So the token only stops strangers from making us call ShipStation. **I recommend accepting this.**
- **Secrets:** all three exist, v1 enabled, created 2026-11-18 16:09–16:11 UTC. The key and secret authenticate (Task 0.1). `deploy.yml` `--set-secrets` doesn't list them yet; Part B adds them. No secret was printed or written to a file.

## G2.4 — `CATALOG.md` checked

I agree with the brief's reasons:
- `roaster` is contact data;
- `roastery_shipment_details` is the shipment and stays;
- `order_event` is per order, while a placement is per order × roaster, with its own retries and an external id;
- `stripe_event` is Stripe's ledger.

There are no `fulfillment_*` or `*shipstation*` objects on prod. New prefixes: `fulfillment_` (stated in the brief) and `shipstation_event`. G2.3 wants the domain as the prefix, so I propose **`fulfillment_shipstation_event`**.

## Other findings

1. **The refund cancel list is hard-coded (G2.1).** `checkoutService.REFUND_CANCELS_FROM = ['awaiting_manual', 'needs_attention']`.
   - Proposed: a column `cancels_on_full_refund` on the `order_fulfillment_status` lookup, and the same column on the new `fulfillment_request_status`.
   - With ShipStation, `placed` (sitting in our ShipStation, not shipped) could become cancelable by deleting the ShipStation order. But once the rule has sent it to Joe Bean (`pending_fulfillment`), Joe Bean may already be packing it, and ShipStation may not let us delete it. Your call (question 4).
2. **Retry is not a blind upsert.** ShipStation refuses to update an order that is not open, and `pending_fulfillment` is not open. So `place()` first looks for an existing order with `GET /orders?orderNumber=`. If it is already there, the request is marked `placed` with that `orderId`, without re-posting.
3. **Order numbers and keys:**
   - **`orderNumber`** = `<short order id>-<n>`, where n is the roaster's position in the order. ShipStation allows up to 50 characters here.
   - **`orderKey`:** the brief's `ab:<order uuid>:<roaster uuid>` is 76 characters. The docs give no limit for `orderKey`, so to be safe I'll use `ab:<order uuid>:<n>` (41 characters). The roaster id goes in `customField2`.
4. **The webhook already in the account:** `22666`, `API_TRACK` to `…execute-api.us-east-2.amazonaws.com/dev/queue/shipping-events/prod`, flagged `IsLabelAPIHook`. It looks like ShipStation's own label-API tracking hook, or something added when the account was created. It isn't ours, and I'll leave it alone. Do you know where it came from?
5. **Packing slip under a 3PL:** the slip is printed by Joe Bean's ShipStation when they fulfill. Whether **our** branded packing-slip template (Task 0.5 step 6) applies to their print, or theirs does, is set on the provider side. Confirm with Dena before Part E, since the slip must not show a roaster name.
6. **Carrier balances are all $0:** auto-funding (Task 0.5 step 2) isn't set yet.
7. **Order-level status:** today the order's `fulfillment_status` comes from `order_event` (written by `dispatchFulfillment` and `markShipped`). The brief adds per-request statuses.
   - To keep one source, `v_order_status` will derive the order-level value from the requests (all shipped → `shipped`, some → `partially_shipped`, any `needs_attention` → `needs_attention`) when the order has requests, and from `order_event` otherwise (orders from before this brief).
   - `dispatchFulfillment` keeps writing the milestone `order_event`s.
8. **Cron:** the daily job is `/api/cron/subscription-daily`, which now also runs the fee sync. The ShipStation retry and reconcile become a third step there, so there's no new Scheduler job.
   - Because V1 retries are not documented, the reconcile runs **daily** for every `placed` request: it fetches `/fulfillments` and `/shipments` by `orderNumber` and catches a missed webhook.
   - The stale alert after `shipstation_stale_days` (7) stays as the brief says.

---

## STOP — answers needed

1. **Webhook events (Finding A):** subscribe to `FULFILLMENT_SHIPPED` + `SHIP_NOTIFY` + `FULFILLMENT_REJECTED`, with postage filled only when a shipment cost can be read (otherwise NULL and retried by the daily reconcile), and confirm in Part E. Yes?
2. **Joe Bean's SKUs:** all 0 of 4 are filled. Will you get the four codes from Dena and enter them in the admin catalog form before Part E? Or should I build a "roaster SKU" field into the fulfillment config page?
3. **Carrier mapping:** a lookup `shipping_carrier_external_code` (one row per ShipStation code, seeded from the account's six carriers), instead of one column on `shipping_carrier`. Yes?
4. **Full refund of an order already in ShipStation:**
   - (a) cancel only while our ShipStation order is still `awaiting_shipment` (not yet sent to Joe Bean), otherwise the admin message says "contact the roaster", as today; or
   - (b) always try `DELETE`, and fall back to the message if ShipStation refuses.

   Plus the refund-cancel list moves to a lookup column (G2.1). I recommend (a).
5. **The webhook token in the URL** is visible in Cloud Logging (Task 0.7). Accept? The alternative is no token, relying only on re-fetching from the API.
6. **Ledger name:** `fulfillment_shipstation_event` (G2.3) instead of `shipstation_event`. Yes?
7. **The `22666` `API_TRACK` webhook already in the account:** do you know it? I'll leave it alone either way.
8. **Packing slip under the 3PL:** will you confirm with Dena that Joe Bean prints our A&B template (no roaster name)? That goes in Task 0.5 step 6.

---

## Decisions (Dana, 2026-11-18, answers to Task 0)

1. **Webhooks:** subscribe to `FULFILLMENT_SHIPPED`, `SHIP_NOTIFY` and `FULFILLMENT_REJECTED`. Postage stays NULL until a cost can be read, and the daily reconcile fills it later. Part E records which fields actually arrive.
2. **SKUs:** Dana gets Joe Bean's four codes from Dena and enters them in the existing admin catalog form. No new field.
3. **Carrier mapping:** a lookup `shipping_carrier_external_code`, one row per code, seeded from the account's six carriers.
4. **Refunds, option (b):** a full refund always tries `DELETE` in ShipStation. If ShipStation refuses, the admin gets the "contact the roaster" message. The refund-cancel list moves to a lookup column on both status tables (G2.1).
5. **Token:** the webhook token stays, and appearing in Cloud Logging is accepted. A webhook whose `resource_url` host is not `ssapi.shipstation.com` is rejected before anything is fetched.
6. **Ledger name:** `fulfillment_shipstation_event`.
7. **Webhook `22666`** (`API_TRACK`, `IsLabelAPIHook`) is not ours, probably ShipStation's own. Left alone, recorded here.
8. **Packing slip:** Dana confirms with Dena before Part E. Assume the A&B template until then; it doesn't block anything.

**Also approved:**
- `orderKey` = `ab:<order uuid>:<n>`;
- GET-before-POST on retry;
- `v_order_status` derived from the requests;
- reconcile as a third step of the daily cron, with no new Scheduler job.

**Scope:** Parts A, B and C, then STOP before Part D. `shipstation_enabled` stays 0.

---

## Parts A–C built (2026-11-18). Not committed or deployed; STOP before Part D

### Part A — schema (`schema.sql` Commerce 6 block; `comments.sql`)

- **Lookups:**
  - `fulfillment_adapter` (manual, shipstation);
  - `fulfillment_request_status`, which holds the rules as columns: `order_fulfillment_status`, `aggregate_rank`, `is_shipped`, `is_closed`, `is_retryable`, `cancels_on_full_refund`, `outranks_partial_shipment`;
  - `fulfillment_event_kind`;
  - `fulfillment_event_source` (G2.7 instead of a CHECK list);
  - `shipping_carrier_external_code`, seeded with the six account carriers (decision 3).
- **Tables:**
  - `roastery_fulfillment_config` (supersede-only, one current row per roaster);
  - `fulfillment_request` (UUID; unique per order × roaster, and per order × sequence; `external_order_key` unique);
  - `fulfillment_event` (insert-only; grant revoked);
  - `fulfillment_shipstation_event` (the ledger, decision 6).
- **Columns:**
  - `order_fulfillment_status.cancels_on_full_refund` (awaiting_manual, needs_attention) and `is_partial_shipment`, plus the row `partially_shipped` ("On its way");
  - `roastery_shipment_details.service_code`, `external_shipment_id`, `label_created_at`, `fulfillment_request_id`, with `created_at` defaulting to `now()` (G2.9).
- **Parameters:**
  - `shipstation_enabled` 0, `shipstation_requested_service` `usps_ground_advantage`, `shipstation_api_host` `ssapi.shipstation.com`;
  - `packaging_weight_oz` 2, `shipstation_push_retry_hours` 1, `shipstation_needs_attention_after_attempts` 3, `shipstation_stale_days` 7.
  - New formats: `shipstation service code` and `hostname`.
- **Views:**
  - `v_fulfillment_request_status`, `v_roastery_fulfillment_config`.
  - `v_order_status` is re-pointed: an order with requests takes its fulfillment status from them (the highest rank, or `partially_shipped`); `fulfillment_requests` is appended. The Commerce 3 definition is wrapped so it only creates the view on a fresh database (otherwise every boot would fail trying to drop the new column).
- Schema applied twice on the test DB with no error.

### Part B — backend and admin

- **`services/fulfillment/shipstationClient.ts`:** V1 calls, basic auth, the host from the parameter. A call off that host is refused, and a 429 waits for `X-Rate-Limit-Reset` (up to 3 retries).
- **`services/fulfillment/shipstation.ts`:** builds the order (decision 2). A problem a retry cannot fix (no SKU, tag, address or weight) raises a `NeedsAttentionError`.
- **`services/fulfillmentService.ts`** is the one writer of the four tables:
  - `createRequestsForOrder`, `place` (GET before POST), `retry`, `cancel` (always tries DELETE, decision 4b), `cancelForRefund`, `markRequestShippedInTx`;
  - `recordShipStationWebhook` / `processShipStationEvent` / `closeShipStationEvent`, `applyShipStationItems`;
  - `runShipStationDaily`, `ensureWebhookSubscriptions`, `setRoasterConfigInTx`.
- **`fulfillment/index.ts`:** `dispatchFulfillment` creates the requests, places each one, and records the order-level milestone events. `retryFulfillment` keeps its contract. `manual.ts` and `adapterFor` are gone.
- **`shipmentService.markShipped`:** new inputs `serviceCode`, `postageCostCents`, `externalShipmentId`, `labelCreatedAt`, `fulfillmentRequestId`, `source`. On a split order it refuses without a request (`choose_request`). New `recordPostage` (fills a NULL only).
- **`checkoutService`:** the refund rule comes from the lookup columns (`REFUND_CANCELS_FROM` removed). A full refund calls `cancelForRefund`. `requestRefund` warns about shipped parts and ShipStation deletes.
- **`orderEmails`:** `internalLines` returns `roasterId`; `sendAdminNewOrderEmail(order, part)`; `sendAdminFulfillmentAlert` (one key per alert); `forShipment` (the shipping email's lines and tracking for that shipment).
- **Routes:**
  - `routes/shipstationWebhook.ts`, mounted at `/api/webhooks/shipstation` after `express.json`;
  - admin: `GET/PUT /api/admin/commerce/fulfillment-config[/:roasterId]`, `POST /api/admin/orders/:id/fulfillment-requests/:requestId/retry|cancel` (scoped to the order), and `shipped` accepting `fulfillmentRequestId`.
- **Boot:** a `[shipstation] enabled=...` line, which subscribes only when enabled.
- **Cron:** `subscription-daily` logs a `shipstation:` line and returns `shipstation` in its JSON.
- **Frontend:** the `AdminOrders` drawer's "Fulfillment by roaster" section (Retry, Cancel part, the part picker for mark-shipped); the `AdminRoasters` Fulfillment panel. Frontend tsc: still 7 errors, the same ones as before.
- **`deploy.yml`:** the three secrets added to `--set-secrets`. The Cloud Run service account already has `secretmanager.secretAccessor` at project level, so nothing to grant.

### Part C — tests (test DB)

`services/fulfillment/fulfillment.test.ts`, 14 passing (ShipStation client and emails faked, everything else real):
- two roasters → two requests, ShipStation and manual (the payload checked field by field; no roaster coffee in the items);
- idempotent dispatch, and GET before POST on a retry;
- failures → `failed` 1, 2, then `needs_attention` at 3 with one alert, payment still `paid`;
- no roaster SKU → `needs_attention` with the reason;
- `shipstation_enabled` 0 → manual;
- webhook:
  - a bad token → 404 and no ledger row;
  - an off-host `resource_url` → 400 and nothing fetched;
  - an unknown order → ledger only;
  - a `FULFILLMENT_SHIPPED` twice → one shipment, no postage, `partially_shipped`, `provider_assigned`, and the email's lines are that part's only;
  - a `SHIP_NOTIFY` with cost and an unknown carrier → `other` + note, then `shipped`;
  - the reconcile fills part 1's postage, with no second email;
  - `FULFILLMENT_REJECTED` → `needs_attention` + alert;
- a split-order mark-shipped needs the part;
- a full refund deletes the ShipStation order and cancels both parts;
- a refused delete → `cancel_refused`, the request stays `placed`, the admin email;
- the lookup seeds.

`commerceAdmin.test.ts` cleanup now covers the new rows (9 passing). The six lints and backend tsc are green.

**Full `src` suite (2026-11-18):** the first raw run ended at 1253 passed, 28 failed, in 20 files. Beyond the OT-140 baseline, the extra failures were of two kinds; none was a Commerce 6 code failure.

- **Test-DB pollution I caused:**
  - My first `commerceAdmin.test.ts` run (13:07, before its cleanup knew `fulfillment_request`) left two `vitest-c3-*` users with 9 orders each, plus checkout lines on the 'Vitest C3 Blend' SKU. The catalog tests could then not delete their 'Vitest%' SKUs (an FK error at file level in `admin.roasters`, `activeCatalog`, `blendResolver`, `catalogReads`, `coffees`, `axis`, `schema.roastery_lifecycle`), and one of their slot prices (`floral/2`, $18.00) was left behind, which failed `catalogImport` and `coffees.contract`.
  - Six 'Zzz C6 Roaster' rows were left from my own fulfillment test's first three runs, whose setup crashed.
  - All of it was removed on the test DB (`backend/tmp/c6_cleanup_c3.ts`, `c6_left3.ts`, `c6_floral_fix.ts`), and the affected files rerun: they pass. A rerun of `commerceAdmin.test.ts` leaves nothing behind.
- **5-second timeouts on the shared test DB:** another session's backend (`tmp/boot_testdb.mjs`) runs against it. This explains `lintCustomer` (the lint itself passes in 8.8 s), `guard`, the extra `evidenceAdmin` and `catalogService` cases, and `palateReads` (86/86 with `--testTimeout=30000`).
  - `v_order_status` is not the cause: on the test DB, `v_palate_slot_candidates` takes about 0.6–0.9 s with the new lateral, with a pre-aggregated join, and with no requests join at all.
- **Rechecked with a 30 s timeout:** `catalogService` 1, `evidenceAdmin` 4, `schema.catalog_blueprint` 1, `sommelierRag` 1. These match the baseline.

### Deviations from the brief

1. **Webhook events:** `FULFILLMENT_SHIPPED` + `SHIP_NOTIFY` + `FULFILLMENT_REJECTED`, not `SHIP_NOTIFY` alone (Finding A, decision 1).
2. **Processed before the 200, not after:** Cloud Run may throttle the CPU once the response is sent. A processing error still answers 200; the ledger row holds the error and the reconcile catches up.
3. **No stored webhook id parameter:** `ensureWebhookSubscriptions` lists the account's webhooks and subscribes what is missing for our URL, so the ids are recorded in `MANUAL_SETUP_IDS.md` at Part D instead.
4. **No tag created through the API:** the tag is created in the Dashboard (Task 0.5 step 5); the code looks it up by name. A missing tag → `needs_attention` with the reason.
5. **Request statuses:** `awaiting_manual` was added (a manual part that was emailed), so a manual request doesn't claim `placed`.
   - Rank 45 beats `placed` (40): with one manual and one ShipStation part, the order shows the part to place by hand.
   - `fulfillment_event_kind` adds `awaiting_manual`, `rejected`, `postage_recorded`, `cancel_refused` and `stale_alerted`.
6. **`shipstation_api_host`** is a parameter (`Format: hostname`), so the host in decision 5 isn't typed in code (G2.1).
7. **`roastery_fulfillment_config`:** a partial unique index on the current row, instead of `roaster_id UNIQUE`, because rows are superseded.
8. **Retry from the daily cron also picks up `pending` requests older than the retry hours** (a crash between create and place).
9. **The ShipStation link in the drawer is not built** (OT-156). It shows the number and id.

### Open tasks added

- OT-154: Joe Coffee onboarding, the exact steps.
- OT-155: household member shipped emails on split orders.
- OT-156: the ShipStation link in the drawer.

OT-58 stays open until Part E.

### STOP — before Part D

Part D needs your go for:
- **Commit and push** = deploy, with `shipstation_enabled` = 0. It's a no-op for orders; every request is manual, as today.
- **After the deploy, I'll:**
  - watch the boot log;
  - regenerate `CATALOG.md` from prod and commit it;
  - smoke the admin pages read-only.
- **Then Task 0.5 steps 2 and 4–7 (yours, in the Dashboard):** auto-funding, the Joe Bean provider and carrier sharing, the `roaster:joe-bean` tag, the rule, the packing slip.
- **Then I'll:**
  - check the key: carriers, tags, the provider shown on an order once one exists;
  - set the Joe Bean fulfillment config through `/admin/roasters`;
  - switch `shipstation_enabled` to 1 only on your word; the boot or a manual call then subscribes the webhooks, and I record their ids.
- **Before Part E:** Joe Bean's four SKUs must be in the catalog (decision 2), and you place the real order.
