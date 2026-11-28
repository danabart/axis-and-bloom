# Regression Checklist

Living checklist of behaviors that must keep working across future changes. Created by HOME Task 9 (2026-08-04) — see `SOMMELIER_BUILT.md`'s HOME Task 9 (S88) entry for the full verification report this checklist summarizes.

## home_v3 — Liam launch machinery

### Six-intent evaluator
- [ ] `DISCOVERY_SEEKER` fires on `experimental: true` (latest quiz).
- [ ] `PROFILE_AMBIGUOUS` fires on `quizTie: true`, `recommendationMode === 'ai_agent'`, or `foodSignalAlignment === 'low'`.
- [ ] `TASTE_EVOLUTION` fires when archetype changed across the last two quizzes.
- [ ] `RECOMMENDATION_MISS` fires on a real, non-superseded negative `feedback_events` doc within the lookback window. **Requires the `feedback_events` (`sentiment` ASC + `createdAt` ASC) Firestore composite index — confirm it still exists (`gcloud firestore indexes composite list --project=axis-and-bloom-prod --database=axis-bloom-fs`) before trusting this row; it silently returned `false` for the entire life of this intent until HOME Task 9 found and fixed it.**
- [ ] `CONVERSION` fires on `behavioralLevel !== 'low' && totalOrders === 0`.
- [ ] `EXPLORATION` fires on `userInitiated`/`browsingSignal` when no higher-priority intent also matches — note `CONVERSION` sits above it in `evaluatorRulePriority`, so a fresh zero-order test account will hit `CONVERSION` first; isolate with a real order when testing `EXPLORATION` specifically.
- [ ] `evaluatorRulePriority` order matches `SOMMELIER_BUILT.md`'s own documented table.

### RAG (`fetchSommelierCoffees`)
- [ ] All six focus types (`archetype_range`, `alternatives`, `evolution_bridge`, `discovery`, `exact_match`, `curated_mix`) return a non-empty catalog against realistic inputs. Standing pre-launch check per S84/7d — run before every launch-adjacent change to `sommelierRag.ts`, the RAG-focus config, or `archetype_assignments`.
- [ ] `catalogText` content is sane, not just non-empty — spot-check for cached AI refusals or stale-name leaks in `ai_summary`/`surprise_note` (the coffee-32/18/22 class of bug HOME Task 9 found; there is no automated check for this yet).
- [ ] `alternatives`/`archetype_range` correctly widen beyond the primary archetype when `archetype_relationship` has real adjacency data — **currently flagged empty in production (0 rows)**, silently degrading both to single-archetype-only; not yet fixed.

### Mode-aware system-prompt assembly (`assembleSystemPrompt`)
- [ ] Matching mode's `LIAM_BASE_PROMPT` core (Tone, Opening-turn, model routing, `200`-token default) stays byte-for-byte identical to the pre-home_v3 baseline (commit `d4e9911`) plus only the documented deliberate additions (Guardrails, Remembering-facts, Brew cards sections).
- [ ] Expertise mode: catalog omitted (or story injected in its place on `my_coffee`/`origins_process` topics), numbers carve-out present, banned technical vocabulary (`percolation`, `extraction yield`, `TDS`) absent.
- [ ] Topic stickiness carries a detected topic forward for `stickyDecayTurns` turns (seed 2), including across a session **resume** boundary, not just within one continuous session.
- [ ] `brewProfileContext`/`currentCoffeeContext`/`storyContext` are all absent-by-default (undefined params produce zero prompt difference) and only appear when their respective conditions are met.

### Beats (`beatEngine.ts`)
- [ ] `dispatchOrderPlacedBeat()` + `dispatchDelayedBeats()` are idempotent per `(user_id, order_id, beat_type)` — re-firing for the same order is a no-op, never a duplicate.
- [ ] Repeat-coffee orders correctly skip `dial_in` (`skip_reason: 'repeat_coffee'`) while `arrival_note` stays active.
- [ ] Degrade-on-silence drops `dial_in` after a low trailing response rate, never drops `arrival_note`.
- [ ] No legacy `sommelier_sms_feedback` row is ever scheduled alongside the beat engine (the supersede cutover) for any post-HOME_TASK_8 order.
- [ ] `beats.smsEnabled` stays `false` until Dana explicitly flips it (OT-17) — confirm live before and after any pass that touches config.

### Brew cards
- [ ] `<<card:save>>`/`<<card:adjust=KEY>>` markers are stripped from every visible reply regardless of validity.
- [ ] An adjustment bumps `revision`, updates the relevant `params` field, and records `last_adjustment_reason` verbatim.
- [ ] `GET /api/users/flavor-memory` reflects a card update immediately (no caching lag).
- [ ] A brew-card render logs a `brew_card_view_event` row (new in HOME Task 9 — Task 6 never built this; confirm it doesn't get silently dropped in a future refactor of the flavor-memory endpoint).

### QR (`/b/:token` → `GET /api/qr/:token/resolve`)
- [ ] Universal token: signed-out → `sign_in`; signed-in customer (personal order or sponsorship) → `profile`; signed-in non-customer → `quiz`.
- [ ] Legacy per-coffee tokens keep resolving (never a 404) even though nothing prints or links them anymore.
- [ ] A retired coffee's legacy token resolves `status: retired` with a `displayName`; `nearestHopCoffeeId` is `null` for coffees with no real outgoing hop in the graph — that's a data fact, not a bug.
- [ ] `isRealSignIn = !!req.uid && !req.isAnonymous` — an anonymous Firebase session must never read as signed-in.
- [ ] Every resolve logs exactly one `qr_scan_event` row with the correct `token_type`/`source`/`auth_state`/`destination`.

### Guards (Task 3)
- [ ] `tokenEconomy.gatingEnabled: false` — a zero-balance account can still start and continue a session.
- [ ] `guards.dailyTurnCap` blocks a new `/start` once hit, with the exact fixed Liam-voiced close line (never a model call).
- [ ] The daily-cap query correctly excludes token_events from a prior day (the day-boundary test, re-verified HOME Task 9).

### Memory / brew profile (Task 4)
- [ ] `<<remember:field=value>>` only accepts the five whitelisted field names; an unknown/malformed field is dropped and counted in `admin_stats/brew_profile.failures`, never written.
- [ ] Up to `brewProfile.maxMarkersPerTurn` (seed 2) markers collected per turn; excess is dropped from collection but still stripped from the visible reply.
- [ ] A write is visible in the Firestore doc within the same turn (read-back test).

## Roastery lifecycle (2026-08-25) — see `WHAT_WE_BUILT.md` #170

- [ ] Deactivating a roastery (`POST /api/admin/roasters/:id/deactivate`) cascades `is_active=false` to exactly that roastery's `coffees`/`roaster_blend`/`coffee_alias` rows, stamps `deactivation_reason='roaster'`, and skips (never overwrites) any row already inactive with `reason='manual'`.
- [ ] After deactivation: the public dial (`GET /archetypes`, `/experimental`), Liam's RAG candidate pool, `GET /:coffeeId/hops` targets, and every admin list (`GET /coffees`, `/inventory`, `/coffee-alias`, `/dial/graph`, `/dial/positions`, `/dial/navigation`) drop the roastery's coffees by default — `?include_inactive=true` (admin only) brings them back greyed.
- [ ] Owned-bag surfaces keep working for an inactive coffee: `/coffee/:id/story`, QR resolve (per-coffee and the universal token) for a customer who already has that coffee, Liam turns about a coffee the customer already owns (`getAliases()`'s `dial_slot_alias` fallback must still resolve a name), order history, brew cards.
- [ ] Reactivating (`POST .../reactivate`) restores exactly the rows stamped `reason='roaster'` at/after the roastery's own `deactivated_at` — a coffee manually retired before or after stays retired, dial positions/defaults come back exactly as they were (the cascade never touches `is_default` or `dial_archetype_positions`).
- [ ] `PATCH /api/admin/roasters/:id/toggle` no longer exists (404) — the only way to change a roastery's active state is the deactivate/reactivate cascade.
- [ ] `coffees_active_natural_key` rejects two active coffees sharing the same `(roaster_id, lower(trim(name)))` — same name across two different roasters, or the same name with one side inactive, must both still succeed. The `roaster_blend.coffee_id` name-match backfill requires `rb.roaster_id = c.roaster_id`, never an unqualified name-only match.
- [ ] `GET /api/axis/stats` and `/adjacency` exclude an inactive coffee from every count/pair (`coffeesMapped`, per-archetype `coffeeCount`, `connectionCount`, `regionAdjacency`/`adjacency`) — confirm without assuming `v_archetype_adjacency` itself changed (it's deliberately still unfiltered for Liam's RAG and the Bloom Dial admin page).

## Known-fragile spots (regression-test these first after any related change)

- Any new Firestore query combining an equality filter with a range filter or an `orderBy` on a different field **will silently return nothing if its composite index doesn't exist** — the query throws, and every call site in this codebase catches broadly. Check `gcloud firestore indexes composite list` after adding one, don't assume it "just works" because `tsc` and a happy-path unit test pass.
- `getAdjacentArchetypes()` — an empty result set from `archetype_relationship` is treated identically to "no adjacency data," not as an error; it will never trigger the hardcoded fallback map.

## Commerce — Stripe one-time checkout (Commerce 1, 2026-10-31)

Run these locally against the sandbox; prod is live since 2026-11-17 (Commerce 4). Stripe test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (decline), `4000 0025 0000 3155` (3D Secure). Full record: `backend/src/features/commerce/CLOSING_REPORT_1.md`.

- [ ] **Success**: cart → `/checkout` → pay with 4242 → exactly one `"order"` row, its lines, a `paid` + `finalized` `order_event`, one admin new-order email, one customer confirmation email; `/checkout/return` shows Liam's line (or the fallback) and the cart empties; Profile → Orders shows "Paid · being roasted" and the real total (dollars, not 1/100).
- [ ] **Decline**: 4000…0002 → Stripe shows the decline inline, no order, the session expires (`checkout_session.status = expired` after the expiry window).
- [ ] **Replay**: resend `checkout.session.completed` from the Dashboard → 200 `duplicate: true`, no second order, no second email (`stripe_event` ledger + `order_event_one_finalized`).
- [ ] **Shipping from data**: 1 bag → `shipping_fee_cents`; `free_shipping_min_bags` bags → free; change `shipping_fee_cents` on `/admin/commerce` → the next checkout charges it, no deploy.
- [ ] **No roaster name** on the Stripe form, the return page, the customer email or Profile (the admin email is the only place the roaster coffee appears).
- [ ] `POST /api/orders` answers 410 `use_checkout`; nothing but `checkoutService` writes `"order"` / `order_line_item` / `order_event` (`npm run lint:lineage`).
- [ ] Boot log shows `[stripe] mode=live` on prod (since Commerce 4, 2026-11-17) and `mode=test` locally; `disabled` anywhere is a broken secret.
- [ ] **Tax switch off**: no Stripe Tax call, order taxes 0 (`tax_collection_enabled` = 0 since 2026-10-31: the Stripe session and renewal invoice show automatic tax disabled, `"order".taxes_collected` = 0).
- [ ] **Header cart** (Checkout UX 1): the icon opens the drawer on every page with the nav, the badge matches the floating button, both are hidden while gated.
- [ ] **Return page**: `/checkout/return` with no `?preview=true` shows the confirmation signed in, and goes to `/sign-in` with `session_id` kept when signed out; never the curtain.
- [ ] **One host**: apex and `.web.app` addresses replace themselves with `www`, keeping path, query and hash; `/b/:token` and `/roastery/:token` still open.
- [ ] **Quiz name screen**: signed in shows "Signed in as …" and no sign-in link; a guest sees the link and no line.

## Commerce — subscriptions (Commerce 2, 2026-10-31)

Run these locally against the sandbox; prod is live since 2026-11-17 (Commerce 4). Full record: `backend/src/features/commerce/CLOSING_REPORT_2.md`. Renewals are Stripe one-off invoices our daily job (`GET /api/cron/subscription-daily`, Cloud Scheduler `subscription-daily`) creates; the `invoice.paid` webhook writes the order.

- [ ] **Subscribe**: cart → "Make it a subscription" → frequency (2/4/6 weeks from `/api/checkout/rules`) → the cart and `/checkout` show the server-quoted price (5% one bag, 10% two or more; never the collection discount on top) → pay with 4242 → one order with `is_subscription`, a `subscription` `active` with `next_delivery_date` = today + N weeks, `started` event; the return page says "Next delivery <date>, every N weeks"; Profile → Orders shows "Your subscription".
- [ ] **Subscription renewal ships current dial position**: turn the Bloom Dial for the subscription's archetype → the next renewal order's line is that position's house name and price; with `subscription_ships_current_dial_position` = 0 it is the signup slot.
- [ ] **Renewal cron is idempotent**: run `subscription-daily` twice the same day → one Stripe invoice, one renewal order (`order_kind = subscription_renewal`), both emails once, `next_delivery_date` advanced by the webhook.
- [ ] **Declined renewal**: past_due, one "About your next delivery" email per Stripe attempt, no order, the invoice stays open for Stripe's retries; Liam access and the SUBSCRIBER stage stay (past_due counts); after `subscription_past_due_lapse_days` the job lapses it and voids the invoice.
- [ ] **Upcoming notice**: `subscription_upcoming_notice_days` before a delivery, one email with the coffee lined up; a second run sends none.
- [ ] **Company gift unchanged**: redeeming a code creates an `active` sponsored subscription (kind `sponsored`); the sponsored-subscription check lapses it at expiry with the same email.
- [ ] Nothing but `subscriptionService` writes `subscription` / `subscription_item` / `subscription_event` (`npm run lint:lineage`).

## Commerce — admin and self-service (Commerce 3, 2026-11-01)

Run these locally against the sandbox; prod is live since 2026-11-17 (Commerce 4). Full record: `backend/src/features/commerce/CLOSING_REPORT_3.md`.

- [ ] **Customer skip/pause/cancel** (Profile → subscription panel): change frequency 2→4 weeks → next date unchanged, `frequency_changed` event, one email. Skip → `skip_requested`, Profile shows the cycle after; a second skip answers "already skipped"; on the skipped date the daily job records `renewal_skipped_skip`, charges nothing, advances the date. Pause (date within `subscription_pause_max_weeks`) → `paused`, Profile shows the resume date; Resume → `resumed`, next date rescheduled if it fell inside the pause; a pause whose date passed is resumed by the daily job (`source = cron`). Cancel → `canceled`, open renewal invoice voided, Liam access gone, one email.
- [ ] **Update card**: on a past_due subscription, "Update your card" (Profile, or the payment-trouble email link) → setup-mode Checkout → `payment_method_updated`; the open invoice is paid with the new card, `invoice.paid` writes one renewal order, status back to `active`. A card that declines after saving (`4000 0000 0000 0341`) leaves it past_due with the card saved.
- [ ] **Refund partial/full** (`/admin/orders` drawer): a partial refund → Stripe refund, then `refund_partial` with the reason and the cents on `v_order_status`, fulfillment unchanged. A full refund on an `awaiting_manual` order → `refund_full` + `canceled` (source webhook), never on the click; a full refund on a shipped order does not cancel.
- [ ] **Mark shipped email**: carrier + tracking number → one `roastery_shipment_details` row, a `shipped` event, one customer email with a working tracking link; submitting the same number again changes nothing; Profile → Orders shows "On its way" and the link. No roaster name in the email or on Profile.
- [ ] **Retry fulfillment** on a `needs_attention` order → `fulfillment_dispatched` (source admin), status `awaiting_manual`; the admin new-order email is not sent twice.
- [ ] **Admin new-order email** shows the customer's name, email and a link that opens `/admin/orders/<id>`.
- [ ] Nothing but `shipmentService` writes `roastery_shipment_details` (`npm run lint:lineage`).

## Commerce — live Stripe (Commerce 4, 2026-11-17)

Live since 2026-11-17 (rev `00869-6z8`). Full record: `backend/src/features/commerce/CLOSING_REPORT_4.md`. Rollback: `launch/00_manual-setup/MANUAL_SETUP_IDS.md` → Commerce 4.

- [ ] **Mode matches on both ends**: the prod boot log shows `[stripe] mode=live`, and the bundle on `axis-and-bloom-prod.web.app` carries `pk_live_`. `www` answers 403 to curl, so check the bundle there. A live key with a test bundle, or the reverse, breaks every checkout.
- [ ] **Restricted key accepted**: `stripeMode()` reads `rk_live_` / `rk_test_` like `sk_` (`stripe.test.ts`).
- [ ] **Saved customer from the other mode**: a profile whose `stripe_customer_id` Stripe answers "No such customer" for gets a new customer on its next checkout, and the checkout succeeds. The log shows `[stripe] customer replaced user=… old=… new=…`, and the new customer's metadata has `replaced_customer_id` (`stripe.test.ts`).
- [ ] **The $1 gate is off**: `live_gate_override_cents` 0, `live_gate_free_shipping` 0, `live_gate_override_email` empty on `/admin/commerce`. With the gate on, only the named email's **one-time** checkout is $1 a bag (subscriptions never), and the cart quote stays at full price (`cartResolver.test.ts`).
- [ ] **Apple Pay / Google Pay**: the payment method domain `www.axisandbloomcoffee.com` (`pmd_1UcyX925hnyYIAkSYRFkPcBK`) shows active for both in the live Dashboard.
- [ ] **Live webhook**: `stripe_event` rows have `payload->>'livemode'` = `true`, processed and with no error. A refund from `/admin/orders` arrives as `charge.refunded` and shows "Refunded · Canceled" on an unshipped order.


## Commerce — ShipStation fulfillment per roaster (Commerce 6, 2026-11-18)

- [ ] A paid order becomes one `fulfillment_request` per roaster on its lines. Dispatching again creates and posts nothing.
- [ ] `shipstation_enabled` = 0, or a roaster with no active ShipStation config: its request is manual, one admin email listing only that roaster's lines.
- [ ] Paid order → ShipStation request → ship-notify → tracking email:
  - [ ] the request is `placed`, with a ShipStation order `<8>-<n>`, key `ab:<order>:<n>`, the roaster's tag, the roaster's SKU and the house name, and the roaster coffee only in the internal notes;
  - [ ] `FULFILLMENT_SHIPPED` or `SHIP_NOTIFY` → one shipment per tracking number, with the shipping email listing only that part's lines;
  - [ ] the order shows `partially_shipped`, then `shipped`.
- [ ] A retry looks the order up in ShipStation first (GET before POST). A failure goes to `needs_attention` after `shipstation_needs_attention_after_attempts`, with one admin email. A missing roaster SKU goes to `needs_attention` at once, with the reason.
- [ ] Webhook: a wrong token is a 404 with no ledger row. A `resource_url` that is not https on `shipstation_api_host` is refused and nothing is fetched. An unknown order is recorded and changes nothing. An unknown carrier code is recorded as `other`, with a note.
- [ ] A full refund deletes the unshipped ShipStation order and cancels the requests. If ShipStation refuses, the request gets a `cancel_refused` event and the admin an email to contact the roaster.
- [ ] Daily cron (`subscription-daily`, third step): retries failed placements, fills postage once a label's shipment shows up, notes the provider, and alerts once about a request placed more than `shipstation_stale_days` ago.
- [ ] Customers never see a roaster name: items, emails and Profile show house names only.

## Commerce — reporting and bookkeeping (Commerce 5, 2026-11-18)

Full record: `backend/src/features/commerce/CLOSING_REPORT_5.md`. Unit cases: `commerce5Reporting.test.ts`, `commerceBackfill.test.ts`, `users.profileUpdatedAt.test.ts`, `orderFinalizer.test.ts`.

- [ ] **A refunded order leaves revenue and bags**: refund an order in full → `v_order_reportable.is_reportable` false, and it disappears from `v_orders_weekly`, from `v_customer_bag_attribution` (so from the timeline and every palate view) and from `v_household_numbers`. A partial refund keeps it, at net revenue, with its bags.
- [ ] **Test-mode orders count nowhere**: an order paid in the sandbox has `stripe_mode` `test` and is in no report; `/admin/orders` hides it by default (mode filter on live) and shows its pill under "Any mode".
- [ ] **Mode at insert**: a new order's `stripe_mode` is the delivered Stripe object's `livemode`; `"order".stripe_mode` is NOT NULL on prod; the boot log shows no `[commerce-integrity]` line.
- [ ] **Business dates**: a Sunday 21:00 Eastern order lands in that week of `v_orders_weekly`, not the next one; the Profile order date is the Eastern date; change `business_time_zone` on `/admin/commerce` → `todayBusiness()` follows within 60 s; an unknown zone is refused.
- [ ] **Fee recorded**: after the daily job, every live order has `transaction_fee_cents` on `v_order_reportable` (a `fee_recorded` event); `"order".transaction_fee` is never updated; a second run records nothing.
- [ ] **Order bonus from the parameter**: a paid order grants `order_bonus_tokens` (10); Admin → Sommelier Config has no order bonus field.
- [ ] **Profile reads leave `updated_at` alone**: GET `/api/users/profile` does not move `user_profile.updated_at`.

## Website chrome — header, Menu overlay, footer (Website 1, 2026-11-04)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_1.md`. Unit cases: `frontend/src/app/components/chrome/chrome.test.tsx` (`cd frontend && npm test`).

- [ ] **Auth state in the header:** signed out (incl. anonymous guest) → `Sign in`; signed in → `Profile · Sign out`; Sign out lands on `/`. Below 480px the same links sit in the Menu overlay's foot row.
- [ ] **Admin:** `Admin` shows for admins only, never while gated.
- [ ] **Live cart count:** `Cart (n)` = sum of quantities in the cart, updates on add/remove, opens the drawer (until `CART_PAGE_ROUTE_EXISTS` is flipped by Website 8, then links to `/cart` with a glyph button for the drawer).
- [ ] **Gated set:** with `VITE_PRELAUNCH_MODE` on and no `?preview=true`, the menu lists only Find my flavor; no cart in header, overlay or footer; footer site links only Find My Flavor; `/` still shows only the curtain.
- [ ] **Overlay a11y:** Menu has `aria-expanded`/`aria-controls="siteMenu"`; open → focus inside, Tab/Shift+Tab wrap, body scroll locked, Escape or outside click or Close closes, focus returns to Menu, route change closes. The closed overlay is not in the tab order.
- [ ] **Footer newsletter:** posts `source: 'footer'`, shows "You're on the list.", inline error on failure; `newsletter_subscriber.source_id` = the `footer` row.
- [ ] **Footer links:** Liam only with `hasLiamAccess`; Terms/Privacy are real routes; Instagram opens the profile (not `/ig`, which carries campaign attribution); year is the current year.
- [ ] **Home `[data-hero]`:** the header floats over the hero in paper; Liam's chat sits below the header (`--ab-header-h`), The Bloom jump-nav sticks at the top edge.

## Website presentation data (Website 2, 2026-11-04)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_2.md`. Tests: `backend/src/services/websitePresentation.test.ts`.

- [ ] **`GET /api/coffees/cards`:** five families in `sort_order`, each with `customerWords` and four slot cards; `other` holds the category coffees. A card with no hint / milk / brew / origin / photo has no such key (never a placeholder).
- [ ] **No roaster or award text in any card:** `hasAward` is a boolean; no `tags`, no award remark, no roaster name, no raw coffee name (an unslotted category coffee has `platformName: null`).
- [ ] **Collection price:** `collectionOffer.discountedCents = round(sumCents × (1 − collection_discount_pct / 100))`, null below `collection_min_members`.
- [ ] **Milk and leads in cup:** our choice first, else the roaster's submitted answer; leads falls back to the highest pooled midpoint among the portal's active dimensions.
- [ ] **`GET /api/home/content`:** facts are counted (main-quiz questions, cupped numeric dimensions, families), quotes are the active `marketing_home_quote` rows in order, featured is the `home_featured_slot` slot with its anchor price; no timing or freshness text.
- [ ] **`GET /api/coffees/archetypes`:** every family carries `customerWords` (three words), experimental null.
- [ ] **Admin:** Coffees → Edit shows "Customer card"; saving writes one `coffee_presentation` row and a `catalog_change` row; saving again unchanged writes nothing.

## Homepage (Website 3, 2026-11-05)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_3.md`. Tests: `frontend/src/app/components/home/home.test.tsx`.

- [ ] **Lifecycle CTA:** a signed-in customer (or a guest with a stage) sees, in section 03, their stage's headline and link (shop matches / subscription / reorder / what's new / welcome back). `NEW_NO_QUIZ` and signed-out visitors see the quiz invite.
- [ ] **Feedback nudge:** with a pending order feedback, `OrderFeedbackForm` shows above the 03 headline; "Not now" hides it for 14 days.
- [ ] **Gift widget:** `CompanyGiftRedemption` sits directly under section 03; redeeming a code refreshes the stage.
- [ ] **Name prefill:** typing a first name in 03, then opening Find my flavor (by any link), starts the quiz with that name.
- [ ] **Data, not copy:** facts, "Take the {n}-question quiz", "Answer {n} questions", "{n} dimensions · {min}–{max}", family numbers and words, quotes and the "This week" coffee and price all come from the API. No "seven" anywhere.
- [ ] **Prelaunch:** `/` is the curtain while gated; Home's gated branch hides the featured cart, Liam and Shop links, and family panels lead to the quiz.
- [ ] **390px:** no horizontal scroll; family panels scroll sideways; the menu row stacks.

## Shop all (Website 4, 2026-11-05)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_4.md`. Tests: `frontend/src/app/components/shop/shop.test.tsx`, `backend/src/services/websiteShop.test.ts`.

- [ ] **Anchors:** `/shop#floral`, `#fruity`, `#balanced_sweet`, `#chocolate_nutty`, `#earthy` (Home's family panels) land on that family; `/shop` links from Home's lifecycle CTAs, the menu, Profile and admin still open the page.
- [ ] **Your family first:** a customer with a known family sees it first, labelled "Your family", while the toggle is on (remembered per browser); off = `sort_order`. Anonymous visitors see "Find your family first →" to the quiz.
- [ ] **Card states:** a row with no value is absent. "Price coming" (unpriced) and "Coming soon" (no coffee, or no roaster can fill it now) cannot be added. Add to cart opens the drawer, and a signed-in add moves the dial (`trigger: add_to_cart`, source `shop`). "Add the collection ↗" adds the backend's collection offer.
- [ ] **No roaster or award names:** "Premium ★" is the only award sign; no roaster name, award name or raw `coffees.name` anywhere on the page.
- [ ] **OT-70:** a category coffee shows its category customer name (else its home slot name) on Shop all and The Bloom; with neither, it is not listed.
- [ ] **Prelaunch:** `/shop` stays behind the gate; the gated branch hides prices, cart links and the collection row.

## The Bloom (Website 5, 2026-11-05)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_5.md`. Tests: `frontend/src/app/components/bloom/bloom.test.tsx`, `backend/src/routes/users.dialPosition.test.ts`, `backend/src/db/coffeePresentation2.test.ts` (comfort zone).

- [ ] **Silent auto-save + pre-set:** a signed-in turn writes `user_bloom_dial_current_position` only (no trigger); the wheel reopens on the saved stop; a deep-linked slot wins over the saved one.
- [ ] **Save to flavor memory:** signed in, real slot: `explicit_save`, source `bloom`, then "View in flavor memory ↗" to `/profile?tab=memory`.
- [ ] **Add to cart:** the payload price, the drawer, `add_to_cart` source `bloom` (field button, lineup cards, classic quick pick).
- [ ] **States:** weight chips with more than one price; "Price coming", "Temporarily unavailable", "Coming soon" cannot be added; the shipping line comes from `GET /api/checkout/rules`.
- [ ] **Quick picks:** the classic and the Collection (the discount from the offer, never typed); hidden while gated.
- [ ] **Compare** opens from the reveal ("Compare with the neighbour").
- [ ] **Reveal:** roaster's words left, cupping bars with end words right, notes wheel collapsed; footer links; Liam only with access; Full breakdown and Ask Liam hidden while gated.
- [ ] **Comfort zone:** pill from the server `zone` (params `comfort_zone_edge_delta`, `dimension_delta_significant`), else the family level; sentence from the server; guests see "Find your flavor to see your match"; no percentage, no per-user value.
- [ ] **Tabs:** five, personalized order with YOUR / TO EXPLORE, sticky, `?archetype=` state, ←/→ between tabs.
- [ ] **Deep links:** `/bloom?archetype=fruity&slot=2` lands on the stop; Liam's and Flavor Intelligence's links still land; `?archetype=experimental&slot=n` scrolls to the Experimental group and marks the card.
- [ ] **Strip:** the 01/02/03 strip shows; the wheel's hint line hides after the first turn (`axisbloom.hasTurnedDial`) or for a customer with a saved position.
- [ ] **Other block:** Experimental cards first, then named category coffees only (OT-70).
- [ ] **Doors:** none while `DOORS_ENABLED` is false; switching it on shows "Turn the {neighbour} dial" under the Other block.
- [ ] **Wheel a11y:** keyboard-only turn (←/→/Home/End on the slider), `aria-valuetext` = the stop label, reduced motion paints without the spin.
- [ ] **Quiz result and Profile** still use the per-archetype dial (`layout` default) with their fold, ceremony and quick picks.

## The Axis (Website 6, 2026-11-05)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_6.md`. Tests: `frontend/src/app/components/axis/axis.test.tsx`, `backend/src/services/axisStats.test.ts`.

- [ ] **Live counts:** hero regions and dots = `originRegions` (sellable coffees per region; regions with none absent; none at all = the hero full width); 03 wheel segments = `archetypes[].coffeeCount`, hollow = `experimentalCount`; 04 ends on "{n} Bloom Notes this month · {n} positions refined this quarter"; "Map last tightened {date}" (UTC calendar date). On a stats error the live lines hide.
- [ ] **Focus param:** `/the-axis?archetype=floral` highlights Floral's band and list item and scrolls to 02 (profile links use it).
- [ ] **Families:** five bands and list items in `sort_order`, each with its three words; hovering or focusing a list item opens its band.
- [ ] **Liam copy:** "What Liam can and can't see" holds the live answer ("…he never invents a coffee. If he suggests a step, that step exists."), never a placeholder.
- [ ] **Competitive safety:** no scale, dimension name, formula, weight, coffee name or roaster on the page; `/api/axis/stats` carries aggregates only.
- [ ] **Accordions:** buttons (Enter/Space), `aria-expanded`, `aria-controls`.
- [ ] **Reduced motion:** dots and wheel segments shown without animation.
- [ ] **Prelaunch:** `/the-axis` stays behind the gate.
- [ ] **The Bloom opening stop (B2):** with no saved position or deep link a family opens on its classic when sellable, else the nearest sellable stop (lower on a tie).

## Find my flavor: entry and questions (Website 7A, 2026-11-06)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_7A.md`. Tests: `frontend/src/app/components/quiz/quiz.test.tsx`, `backend/src/db/quizSceneImage.test.ts`.

- [ ] **Funnel names and payloads:**
  - `QuizStart` + `quiz_start` once, on the first answer of question 1;
  - `QuizComplete` + `quiz_complete` with the pre-branch score;
  - `quiz_final` with the on-screen archetype (no branch / branch / tie);
  - `EmailSubmitted` + `email_submitted` from the gate;
  - each carries `{campaign, vid}` when a campaign is active; one session key per run, renewed on retake or exit.
- [ ] **Campaign fast-start:** `?campaign=instagram|facebook` skips the entry scene (a recognized returning user still sees Welcome back).
- [ ] **Retake:** `?retake=1` from Profile resets and lands on question 1; "Retake the quiz" on the returning-user scene does the same.
- [ ] **Returning user:** signed in with a match → Welcome back + the saved archetype + retake on the entry photo; the folded dial, Worth exploring and the link row below.
- [ ] **Sealed ending (prelaunch):** a finished quiz shows only the email card / "It's on its way to {email}"; the returning user sees "Your match is waiting".
- [ ] **Back / keyboard:** "← Back" from question 2 keeps the earlier answer; letter keys A… pick; ↑/↓ move between rows; Enter/Space pick; a keyboard-only run completes.
- [ ] **Counts are data:** "{N} questions" on the entry and "0n / 0N" plus N progress segments come from `GET /api/quiz/questions`; the branch reads "One more".
- [ ] **Exit ×:** with answers it asks in the design's dialog (Keep going / Leave); without answers it returns straight to the entry scene. Never `window.confirm`.
- [ ] **Photos:** each question's photo is `quiz_question.image_asset_key`; until uploaded, the current quiz photo shows.
- [ ] **Reduced motion:** the scene photo does not drift.

## Find my flavor: the result scene (Website 7B, 2026-11-06)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_7B.md`. Tests: `frontend/src/app/components/quiz/result.test.tsx`, `quiz.test.tsx`.

- [ ] **Hero from data:** "{Name}'s family of taste" (or "Your family of taste"), "{Family}.", the three customer words, "Your place on the dial: stop N — {label}" and "— next to {coffee}" only when that stop has a coffee. No percentage, description or why line anywhere on the result.
- [ ] **Turn the dial:** the button's href is `/bloom?archetype=<family>&slot=<stop>`; a click scrolls to the field (or the gate, before it unlocks) and the field opens on the hero's stop.
- [ ] **Ask Liam why:** hidden while gated; signed out → `/sign-in?redirect=/sommelier`; signed in with access → `/sommelier`; without access hidden.
- [ ] **Gate:** a first-time guest sees the email card under the share row and no dial; a recognized guest sees the masked-email note; a signed-in non-subscriber sees the consent note once; subscribe payloads carry the family name as before ("Balanced", "Chocolate & Nutty"…).
- [ ] **Share row:** shown for the five families, hidden for Experimental.
- [ ] **Action row:** signed in → "Your flavor profile →" and "Back to home →"; guests → "Back to home →" only. Privacy · Terms below.
- [ ] **Preview param:** `/find-my-flavor?result=floral|fruity|balanced|chocolate|earthy|experimental` (with `?preview=true` while gated) opens each result.
- [ ] **One score per run:** a key press while scoring or during the wrap ceremony does not score, save or log again; the screen's family equals the saved `quiz_session` and `quiz_final`.
- [ ] **No quiz link on the result:** the field's "Take the quiz" line is hidden here (`hideQuizLink`), still shown on /bloom.

## Sign in and the cart page (Website 8, 2026-11-06)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_8.md`. Tests: `frontend/src/app/components/signin.test.tsx`, `cart/cart.test.tsx`, `cart/cartContext.test.tsx`, `chrome/chrome.test.tsx`.

- [ ] **Sign-in tabs:** `/sign-in` opens on Create profile; `?mode=signin` opens on Sign in; first and last name only on create; "Forgot your password?" only on Sign in.
- [ ] **Providers:** "Continue with Google" and "Continue with Apple" both sign in and land on the redirect.
- [ ] **Redirect params:** `?redirect=` is honoured after email, Google and Apple (default `/profile`); `?quiz_id` shows "← Back to results" → `/find-my-flavor`.
- [ ] **Reset and errors:** reset needs the email first, then shows the sent line; Firebase errors read in the page's words (wrong password, no account, already in use, weak password).
- [ ] **QR doors:** `/b` "I have a profile" lands on `/sign-in?mode=signin&redirect=<the /b address>` with Sign in selected.
- [ ] **Side panel:** the question count comes from `facts.questions` (never typed); its Bloom link is hidden while gated.
- [ ] **Drawer + page:** add-to-cart opens the drawer everywhere; "Cart (n)" (header, menu, footer) links `/cart`; the icon beside it opens the drawer; arriving on `/cart` closes the drawer.
- [ ] **Stepper:** −/+ change the quantity through `CartContext.setQuantity`; − at 1 removes the line; adding the same thing again merges into its line.
- [ ] **Cart summary:** subtotal, shipping (from the checkout rules), the subscribe choice and the estimated total match `/checkout`; no roasting, delivery or "calculated at checkout" text.
- [ ] **Signed-out checkout:** a signed-out visitor or guest sees "Sign in to check out" → `/sign-in?mode=signin&redirect=/checkout`; signed in → `/checkout`.
- [ ] **Gated cart:** `/cart` is behind `PrelaunchGate` (redirects to the curtain while gated, unless `?preview=true`).
- [ ] **Checkout from `/cart`:** `/cart` → `/checkout` → `/checkout/return` completes in Stripe test mode; the return page clears the cart.

## Review fixes: relationships, the wheel, no scroll (Website 9, 2026-11-06)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_9.md`. Tests: `backend/src/db/archetypeRelationships.test.ts`, `frontend/src/app/components/website9.test.tsx`, `bloom/bloom.test.tsx`, `shop/shop.test.tsx`, `home/home.test.tsx`, `signin.test.tsx`.

- [ ] **Relationship words are data:** a signed-in customer with a family sees, beside every family (The Bloom tabs, the Shop sections), the `customer_label` of its relationship from `GET /api/coffees/archetype-order`; a family with no evidence and every guest see none. No YOUR / TO EXPLORE anywhere.
- [ ] **The relationship rule:** bridge hops make a family adjacent; else its cupped-coffee profile within `dimension_delta_significant` of hers is adjacent, further is distant; profiles come from `v_archetype_dimension_profile` only (never `archetype_vector`).
- [ ] **Pill and badge words:** the comfort-zone pill and the compatibility badge read their words from the same payload (`kinds`); no stretch apology line.
- [ ] **The wheel turns like the old dial:** drag anywhere outside the centre, mouse and touch; a turn past half a circle keeps going (never flips to the other end); the centre turns nothing; the tick row drags; snap on release; arrow keys, Home and End on the slider.
- [ ] **The wheel never moves:** stepping through a family's stops at desktop width moves the wheel 0 px.
- [ ] **No scroll on a turn (D18):** wheel, bar, keys and a lineup card change the stop in place (the lineup stays still on screen); a tab click scrolls only when the field is out of view; deep links and doors still scroll.
- [ ] **A new page opens at the top** (`ScrollToTopOnNavigate`): Full profile ↗ lands on Flavor Intelligence at its title; Back keeps the browser's position; `/shop#family` still lands on its section.
- [ ] **Home 03 figure:** a customer with a family sees that family's photo; the invite (guest, `NEW_NO_QUIZ`) sees the Balanced photo.
- [ ] **No save on an empty stop:** "Save to flavor memory" only on a stop with a live coffee.
- [ ] **Drawer and `/cart` share one sign-in link** (`?mode=signin&redirect=/checkout`).
- [ ] **`/sign-in` while signed in** goes straight to the redirect (default `/profile`); an anonymous guest still sees the form.
- [ ] **Profile features** are the family's `customer_words`.
- [ ] **Old card:** "Premium ★" for an award tag; the shipping line from the checkout rules.
- [ ] **No date, no typed count** on the curtain, the gate or Crawl; `/checkout/return` states order facts only.

## Close-out: order labels, retired pages (Website 10, 2026-11-07)

- [ ] **Order status words are facts only (D14):** Profile orders and `/checkout/return` show "Paid" / "Paid · sent to the roastery" / "On its way" / "Delivered" from `v_order_status.customer_label`; nothing about roasting, freshness or timing. A boot never overwrites a hand-edited label.
- [ ] **`/about` lands on Home and `/how-it-works` on The Axis**, query string kept (`?preview=true`).

## Family Household 1: foundation and join links (2026-11-07)

- [ ] **No household email:** adding a member asks for a first name only; nothing is sent; the admin gets Share / Copy for `/join-household?token=…`.
- [ ] **Join link works three ways:** signed out (sign in or sign up, back to the join page), signed in, new account; Join lands on `/profile?tab=family`; Decline closes the link and the member stays in the household.
- [ ] **`/join-household` is outside the curtain** with `VITE_PRELAUNCH_MODE` on, and sets no session bypass (`/shop` stays curtained).
- [ ] **A claim moves the member, not the roles:** the member's badge turns to "Has their own sign-in", `v_customer_identity` resolves the managed profile to the new account, one `member_claimed` event.
- [ ] **One household per person (D23):** joining another household leaves the current one first; a sole admin with other members is told to hand the admin role over first.
- [ ] **Never deleted:** leave / remove end the member row, dissolve sets `dissolved_at`, revoke closes the link; `household_event` is insert-only.
- [ ] **Managed profiles are safe:** the stale-guest purge never touches a `household_managed` profile; a `managed:` uid never authenticates.
- [ ] **Readers use `v_household_member`:** checkout recipient check, Liam access, homepage next delivery, user signals, Liam's member count. Nothing reads `user_profile.household_id`.
- [ ] **Privacy page** shows the Family Household paragraph.

## Family Household 2: quiz and dial by proxy (2026-11-07)

- [ ] **Quiz for a member:** `/find-my-flavor?for=<member>` names the member, saves the session on the member with the admin as `taken_by_user_id`; the admin's own result, newsletter row and inbox are untouched; no ad events fire.
- [ ] **The quiz is strict:** once the member has a self-taken quiz, Take the quiz for disappears and the door answers 409 with "Took their own quiz".
- [ ] **The dial is open:** Open their dial saves only on Save, as one move with the actor; the member's log shows it with Undo; Undo restores the slot the turn replaced; the saved list stays the member's own.
- [ ] **Unlink:** the member row returns to the managed profile with its proxy quiz; the account leaves the household; an admin member cannot be unlinked.
- [ ] **A claimed member sees the same quiz as the tab** (`/api/quiz/results/latest` reads `v_customer_quiz_current`).
- [ ] **Badge words** come from `household_account_state` / `household_quiz_state`.

## Family Household 3: order for the house (2026-11-07)

- [ ] **For whom per line:** a household member's cart shows "For" on each line (in-box members, the buyer first); the same coffee for two people is two lines; a line for someone outside the box is refused.
- [ ] **House orders carry the household;** a house subscription (a bag for someone else) carries it; a member's own plan does not and stays untouched by Leave.
- [ ] **Renewal per drinker:** each bag follows its drinker's current quiz and dial; the subscriber's dial never moves a member's bag; a member with no quiz or out of the box is skipped by name and the rest ships at its own tier; the payer gets one email per cycle.
- [ ] **Member mail:** members with a sign-in get "ordered" and "on its way" for their bag; managed members and the buyer get none.
- [ ] **Leave / Close with the house subscription:** the tab asks first (the API's sentence), then cancels it; members with a sign-in get the handover email and an offer; the first box they subscribe inside the window takes tier + the perk once; renewals at the tier.
- [ ] **The holder of the house subscription cannot be removed** by another admin.
- [ ] **Build the house box** adds one bag per in-box member with a quiz; others show Take the quiz for; own plans are marked.
- [ ] **Attribution:** a member's bag-claim scan beats the line's recipient (D24); the buyer's own bag reads `buyer`.

## Cupping evidence 9: disputes (2026-11-09)

- [ ] **An open dispute leaves the merge:** a disputed value (or whole cupper row) leaves the sample's merged row, so it also leaves the pooled range, the dial signal and the consensus; the merged row's `merge_note` names it.
- [ ] **A withdrawn dispute returns:** withdrawing re-merges, and the previous union comes back exactly (values, descriptors, calls).
- [ ] **The sheet row never changes:** `cupping_scores` / `cupping_score_values` are untouched by a raise or a withdraw. A dispute is never deleted, and its reason is never edited.
- [ ] **A manual merge is never re-merged by a dispute** (`manualMergeInPlace`).
- [ ] **The last undisputed cupper row cannot be disputed whole** (409 `LAST_CUPPER_ROW`); a merged row cannot be disputed at all.
- [ ] **Views show, they do not hide:** the readable and per-cupper views keep the disputed value with `is_disputed`; no view or code filters on a reason text.

## Ella's Bloom Map 1: schema, rules, preview (2026-11-10)

- [ ] **At most one active map version:** `dial_map_version_one_active` (activated and not retired); `activateVersion` retires the old one and activates a draft in one transaction, and refuses anything that is not a draft. Boot check #7 reports a drift.
- [ ] **Placement rows are never changed:** `dial_placement`, `dial_ring_cut` and `dial_size_cut` are written once, by `cutVersion`, while the version is a draft. The guard trigger refuses any later insert, update or delete, and a version row is never deleted.
- [ ] **The preview moves with the parameters, the active version does not:** changing a `dial_` parameter (`setParameterInTx`) changes `v_dial_placement_preview` and the preview edges; `v_dial_placement`, `v_dial_face` and `v_dial_edge` keep the cut's placements and the version's own parameter snapshot.
- [ ] **`cutVersion` is idempotent on its label:** a second call returns the same version and writes nothing.
- [ ] **Portal order is read by split:** each portal note's text is split on commas in the roaster's order; the stored response is never rewritten (G2.20).
- [ ] **No number in a view body:** every cut, weight, cap and grade threshold of the map is an `evidence_parameter` `dial_*` row (25 keys, boot check #10), every vocabulary a seeded lookup (boot check #9).
- [ ] **The map reads no slot ladder and no `coffee_hop`** for placement, edges or hops; the one slot read is `is_sellable`, through `v_coffee_sellable_candidate`, until the commerce move (OT-120).

## Ella's Bloom Map 2: the workbench (2026-11-10)

- [ ] **The page never writes a placement directly:** `/admin/map` writes only through `catalogService.setLean` (lean), `dialPlacementService` (cut, activate, first match, phrases) and `evidenceParameterService` (the `dial_` parameters). `dial_placement` is written only by `cutVersion`.
- [ ] **Parameters change the preview only:** a `dial_` parameter saved on the card moves the Preview (rings, edges, graph check); the Active version keeps its placements and its own snapshot.
- [ ] **Cut and Activate are the only two version actions**, and Activate asks for a confirmation that names the version it retires.
- [ ] **First match is refused under the grade floor at write (409 `BELOW_GRADE_FLOOR`), and the read still flags** a first match whose grade dropped later.
- [ ] **Nothing typed in:** lane, ring, size, grade, flag, move and status words, and the move-line delta phrases come from `GET /api/admin/map/vocabulary` and the phrase tables.
- [ ] **`EllaMapFace` is tap only:** no rotation, no drag; its layout is deterministic (`mapGeometry.test.ts`).

## Ella's Bloom Map 3: the match door and the customer map (2026-11-12)

- [ ] **Decisions are insert-only:** an UPDATE or DELETE on `customer_match_decision` or `customer_match_candidate` raises (guard trigger); a repeat `(source, source_id)` writes nothing.
- [ ] **Position is derived:** the latest decision per canonical user (`v_customer_match_current`); there is no current-position table, and the trail is every decision in order.
- [ ] **Every `dial_surface` row is `lane` until brief 4:** the quiz result, the profile and the dial-in email are unchanged for customers; `/map` is admin-only (`AdminRoute`) and `/api/map` answers 403 `map_not_open` to a customer.
- [ ] **The quiz door never fails on a decision error:** `POST /api/quiz/results` logs `[quiz/match-decision]` and answers as before (e.g. a decaf customer with no decaf first match on version 1).
- [ ] **A hop names a coffee in the caller's move set** (server-verified, 409 `NOT_IN_MOVE_SET`); `stay` re-picks the position; `forMemberId` goes through `assertMayTurnDialFor` and records the actor.
- [ ] **No slot and no `coffee_hop` in the map code** (`matchService`, `routes/map.ts`, the map pages); no price or add-to-cart on `/map` until prices move to `coffee_retail_price` (brief 4).
- [ ] **Nothing typed in:** button labels and edge phrases from `dial_hop_phrase`, sentences from `dial_customer_copy`; the customer page names no ring, lane, cell, seam, grade or version.

## Ella's Bloom Map 8: prices, and every map coffee buyable (2026-11-18)

- [ ] **A map coffee is bought as a direct line at `coffee_retail_price`:** `/map` adds `{ coffeeId, weightOz: anchor, priceCents }` through `useCart`; `resolveCart`'s `coffeeId` branch prices it from the pricing table and refuses a stale price (409 `price_changed`); the line, Stripe, the order email and ShipStation carry the map's name (short name, else the coffee's name), never a roaster name or a slot house name.
- [ ] **The map's sellable rule is coffee, SKU and price:** `v_dial_coffee_availability` (an active coffee, an active SKU at the active anchor size, a `coffee_retail_price` row there); a category (decaf, half-caf) does not exclude a coffee; the match's decaf filter is unchanged.
- [ ] **No page offers a switched-off size:** `coffee_size.is_active` false leaves `getSizes`, the candidate views and the map; `resolveCoffeeBlend` refuses a direct line at it ("unavailable"); the anchor cannot be switched off.
- [ ] **A slot price and a retail price for the same coffee agree:** catalog integrity check 15 lists any coffee whose winning slot price (`v_coffee_sellable_slot`) differs from its retail price at the same size.


## Ella's Bloom Map 7: the match rule and the customer page (2026-11-17)

- [ ] **The first bag comes only from `v_dial_start`:** `matchService.firstMatchFor` reads the session's winning `dial_start_rule` row, else the center family's always row; the decision's inputs carry `rule_id`, `family_read`, `scores` and `conditions`. A first bag needs no sellability; in stock, the grade floor and the decaf filter still apply.
- [ ] **No family code or threshold lives in `matchService`:** the conditions are one expression each in `v_dial_start_input`; the family reading (Balanced-branch Floral as Balanced, old Earthy by its highest raw score with the tie rule) is in the same view, keyed by `dial_wedge.old_branch_reads_scores` and `dial_earthy_branch_reworded_on`.
- [ ] **`/map` shows only published steps:** `GET /api/map/steps` reads `v_dial_step` (`on_active_map`) leaving the position; `decide` with move `step` refuses a coffee that is not one of them; no ring, lane, grade, version, basis or roaster name leaves the call.
- [ ] **A closed side is never offered:** `v_dial_wedge_lane.is_open` false (Earthy toward Floral, Floral toward Earthy): the lean buttons leave it out, `setLeanInTx` refuses it (`CLOSED_SIDE`), the preview flags it (`closed_side`), and no first match sits on it.
- [ ] **A start-rule change applies at once and keeps its history:** `setStartRule` supersedes and inserts (`v_dial_start_rule` keeps the old row); the customer's first-bag reason follows the current row of the (family, priority) that decided it.


## Ella's Bloom Map 6: the five coffees (2026-11-16)

- [ ] **A catalog coffee from a portal lineup is created only by `acceptResponse`** (`roasteryPortalService.acceptResponse` / `acceptResponseInTx`, the same body): it links the lineup coffee, writes the ticked basics, notes and descriptors through `catalogService`, logs one `roastery_portal_acceptance` row, and never writes a family, slot, SKU or price. The roaster's response rows stay as submitted.
- [ ] **The five-coffee script accepts each lineup coffee at most once:** a lineup coffee already linked to a catalog coffee is skipped and reported; a roaster pick that is not the approved term stops the plan.

## Ella's Bloom Map 5: the decided map and the simplified admin page (2026-11-16)

- [ ] **A ring decision wins over the calculated ring:** a current `coffee_ring_assignment` row that fits the family (0 exactly for the center) sets `v_dial_placement_preview.ring`; `calculated_ring` stays beside it and the flag `ring_decided` shows; with no decision the calculated ring is used as before. Ring 0 outside the center (or 1 to 3 in it) is refused by the service and the insert trigger.
- [ ] **A decided coffee is placeable without cupping:** a family, a lean and a fitting ring decision make a coffee placeable (grade D, flag `no_cupping_rows`); a cupped coffee with no decisions places exactly as before.
- [ ] **Dot size is the roaster's Sweetness rating:** latest submitted portal response against `dial_size_roaster_cut_1/2`; no rating, NULL size, flag `no_roaster_sweetness`, a dashed outline on the admin face only.
- [ ] **A step exists only as a `dial_step` row:** nothing calculates one; a change supersedes and inserts, one current row per ordered pair; `is_shown` is switched the same way and a hidden step stays in the admin table.
- [ ] **Publish is the only way a decision reaches the active map:** placements are cut from the preview, and `v_dial_step` gives the active map the step rows in force at the version's `cut_at` (wall clock); saving a decision changes the "not yet published" line, not the face.
- [ ] **Nothing here changes a customer surface:** every `dial_surface` row stays `lane`; `EllaMapFace` keeps its default dot style (`dotStyle='sellable'`) and draws no steps unless given them; the customer pages pass neither.
- [ ] **The old workbench is kept:** `/admin/map/advanced` renders brief 2 and 3's page unchanged, linked from the decided map.

## Usual Drink 1: capture the daily cups, the kitchen and the feeling (2026-11-12)

- [ ] **Facts are insert-only:** every brew-profile write (card, Profile, Liam) goes through `customerFacts.record.brewProfileChange`; a changed answer is a new row and the fold's latest wins.
- [ ] **A declined question is a fact:** each card field shown and not answered is a `declined` row (value NULL, quiz session set); the fold, `captured_at`, `source` and `v_palate_evidence` ignore it.
- [ ] **No card after a proxy quiz:** the card is not rendered on `?for=`, and `POST /api/quiz/post-result` answers 409 on a session with `taken_by_user_id`; 403 on a session the caller does not own.
- [ ] **Pickers come from data:** the card, the Profile mirror and Liam's field list read `getBrewProfileFieldsConfig()` only; a field with `prompt` NULL or `is_active` false leaves the card on the next refresh; no component logic keys on a field code.
- [ ] **Over-cap is rejected:** an array over `max_items`, words on a value that does not take them, or words over `max_item_len` is refused and counted in `brew_profile.failures`, never truncated, never a 500.
- [ ] **The purge keeps guests with facts:** the empty-guest rule skips a guest with a `customer_brew_profile_change` row; the stale-quiz rule still deletes the Auth record only.
- [ ] **Unknown funnel events are dropped:** `POST /api/quiz/event` with a code not in `quiz_funnel_event_type` answers ok with `dropped`, writes nothing.
- [ ] **Nothing reads the three fields for matching:** the quiz result, the first match, the map, the dial and Liam's recommendation are unchanged.

## Usual Drink 2: the coffee routine (2026-11-24)

- [ ] **The kitchen box can always be saved:** type a listed brand and press Save without tapping a row: the highlighted row is saved. Type a brand that is not listed: it is saved as `other` with the typed words and shows as typed after a reload. Save never closes the editor without writing or showing `routine_save_error`; clicking Save while the list is open still saves (the list is an overlay).
- [ ] **Most days follows the drinks:** "Which one most days?" shows only with two or more drinks picked (card and Profile); removing that drink clears `main_drink` in the same save (one `clear` row, same request).
- [ ] **"Nothing, black" stands alone:** milk and sugar save together; picking black clears them and picking another clears black; the door (`checkBrewProfileChange`) refuses `["black", …]` from any writer; Liam's `takes_it=black` is `set ["black"]`.
- [ ] **Three blocks on the Flavor Memory tab:** palate (retake link beside "Your archetype", always), routine, history (Activity and Tasting journal always; Brew cards only with a card; Your trail only when `MapTrail` reports content); "Leave feedback" opens the journal; a failed save shows `routine_save_error`, never the server's text; at 390 px nothing scrolls sideways, every routine button is 44 px or taller, inputs are 16 px.

## Usual Drink 4: page fixes and the kitchen list (2026-11-26)

- [ ] **Profile:**
  - The archetype words read on one line under "Your archetype", with the block closed.
  - No "NO." anywhere on the Profile; the Bloom page still shows the number.
  - The history tab row has no vertical scroller at desktop width or at 390 px, and still scrolls sideways on a phone.
  - The Brew cards segment shows `brew_cards_about` once, above the first card.
- [ ] **Kitchen autocomplete:**
  - "tatte" finds Tatte Bakery & Café.
  - "starbucks" lists Starbucks, then its products.
  - "pike" finds Starbucks Pike Place Roast.
  - A picked product saves and shows as a chip.
  - In the browse list each product sits directly under its brand, including one promoted later.
- [ ] **Promote:**
  - A typed kitchen name shows on the admin block with its customer count. Promoting it adds one entry, and a second promote of the same name adds nothing.
  - After the field-list refresh the entry is in the autocomplete.
  - The customer who typed it still sees their own words, and `v_customer_cupboard_coffee` returns the promoted brand for them. Their stored row is unchanged.
  - A non-admin gets 403.
- [ ] **`/map`:** a product as the coffee they drink most reads its brand's kitchen line.

## Usual Drink 3: routine fixes (2026-11-25)

- [ ] **Black goes with milk:** `["black","milk"]` saves on `takes_it` (Profile, card, door) and reads back as two chips. The brew card still leaves black out of its sentence (`brew_card_takes_it_skip`).
- [ ] **Up to three coffees in the kitchen:**
  - On focus with an empty box, the list shows every value, pinned first, and scrolls inside the overlay.
  - "star" offers Starbucks. A name not on the list saves as typed.
  - After a reload both show as chips. A fourth is refused, and the box is gone at three.
  - "Which one do you drink most?" shows only at two or more and offers a typed-in coffee by its words. Its answer is the filled chip. Removing that coffee clears it in the same save.
  - "Nothing right now", "I don't know" and pods stand alone.
- [ ] **Cards and chips:** the read view is one white card and every answer is a chip, the kitchen included (no line of text). In the edit view each question is its own white card, full width at 390 px, with no sideways scroll.
- [ ] **The coffee they drink most is the kitchen fact:** `v_customer_cupboard_coffee` (and so `/map`'s "You have … in your kitchen") reads `main_cupboard` while it is in the list, else the only coffee, else nothing.

## Ella's Bloom Map 9: the reasons on `/map` become personal (2026-11-20)

- [ ] **Only approved words, composed at read:** every sentence on `/map` is a `dial_customer_copy`, `dial_said_back`, start-rule or step row joined with the customer's own facts in `matchService.steps`; nothing composed is stored and no model or Liam call writes a customer sentence.
- [ ] **The first bag quotes only self-taken answers that have a said-back row:** a quiz with `taken_by_user_id`, an old session with no stored `answerIds`, or a rule with no `coffee_line` shows the rule's `customer_reason`; the treat question (Q6, weight 0, no row) is never quoted.
- [ ] **A kitchen brand is quoted only with its own said-back row:** partners (Joe Bean, Joe Coffee, Utopian, Temecula, Path), "Nothing right now", "I don't know", "Something else", pods and "A local roaster not on this list" have none.
- [ ] **One lead at most:** the feeling's direction when a shown step carries it (a tie goes to the rule's lead, else the first in step order), else the rule's lead before any bag, else none.
- [ ] **A step card has no "See it":** the coffee's name, its text and the price chip; the chip records the step and adds one bag as "Make it my next bag" did.
- [ ] **Basis goes to admins only:** `/api/map/steps` returns `basis` only for an admin caller; `GET /api/admin/map/reasons` writes nothing.
- [ ] **The old Bloom page and every `dial_surface` row are unchanged** (all `lane`).
- [ ] **"Never quote" is data, not code:** a current `dial_said_back` row with `is_quoted` false keeps its phrase, is never quoted on `/map`, and check 13 does not report it (`v7_q1_b`); no answer code is written in the code (G2.1).

## Ella's Bloom Map 10: the reasons on `/map`, Rev 2 (2026-11-24)

- [ ] **Every card is a customer sentence, then a coffee sentence:** no "You told us", "You also said", "You asked for", "If you want…" or third piece on any card; a step no answer supports opens with "Your answers point elsewhere."
- [ ] **The top card always has a label and a reason when there is a quiz:** "Founder's pick" on a first match (the latest quiz result's coffee, only "Same again" since, including one recorded before the start rules), "You are here" after a step; no quiz, the notes only.
- [ ] **Answers are taken in page order:** the top card first, then the lead, then the other steps in shown order. The top card and the lead use each answer once. A step card looks first among the unused answers, then (when `dial_step_reuse_answer` = 1, the default) among those already used on the page; it says "Your answers point elsewhere." only when no answer, used or not, supports it under the active support kinds. With the parameter at 0, each answer is used once per page (Ella map 10 follow-up, 2026-11-25).
- [ ] **How a card is chosen is the rows of `dial_reason_choice`:** switching a choice off or reordering it on `/admin/map` changes "Read it as" on the next read; an unknown code is skipped and reported (check 15).
- [ ] **A quiz taken by someone else, the treat question and a never-quoted row are never used.**

## Ella's Bloom Map 12: step comparisons, the treat, "More about this coffee" (2026-11-26)

- [ ] **A step card compares to the position coffee:** every step line on `/map` names the coffee the customer is on (`{from}`, filled with its map name) and says what changes; no `{` reaches a customer. A start rule's lead card keeps the rule's own lead line (written relative to the first bag).
- [ ] **The treat is step-card-only and last:** the treat answer (v7 Q6, through its sentence) opens a step card only when no other kind supports it, used or not, and its food signal is the destination's family (or the family its branch comes from); otherwise "Your answers point elsewhere." The top card and the lead never use it. Switching the `treat` row off on `/admin/map` removes it on the next read.
- [ ] **The reveal on `/map` shows coffee parts only:** "More about this coffee" on the top card and every step card opens the Bloom page's panel beneath that card, one at a time: the description, best-brew tags, cupping bars, notes wheel. No comfort-zone label, no compatibility sentence, no roaster name, no award tag, no links. No button on a coffee with neither a description nor cupping bars.
- [ ] **The Bloom page's "Reveal the full profile" is unchanged** (same three reads, now through `useCoffeeDetail`; no brew tags there).

## Ella's Bloom Map 13: `/map` on a laptop, the panel in the roaster's terms (2026-11-26)

- [ ] **`/map` has a laptop layout from `lg` (1024 px):** the map beside the top card; the step cards in two columns with the lead card across both; an open step card spans both columns with its panel inside it; the top card's open panel spans the page under the map and the top card. Below `lg` the page is one column, as before, with every panel inside its card.
- [ ] **The `/map` panel shows the roaster's ratings and never A&B's cupping:** the description, "Where it shines" (every method the roaster named, best first, then the lookup's order), the notes, then "How the roaster rates it" with "Rated by the roaster, against their own coffees.", each bar one step on the roaster's 1 to 5. No "Cupping profile", no `/dimensions` read. Every heading is a `dial_customer_copy` row.
- [ ] **A held-back dimension is not drawn:** Mouthfeel is held for both map roasters; "Show on /map" on the admin Calibration table (Roastery Feedback → a roastery → Calibration) brings it back on the next read, "Hide on /map" removes it; each asks for a reason; the roaster's answers never change.
- [ ] **The button shows** for a coffee with a description, the roaster's ratings, or notes with a where-it-shines answer (all 18 map coffees today).
- [ ] **The Bloom page's panel is unchanged:** "Reveal the full profile" shows "In the roaster's words", the brew tag, "Cupping profile" (A&B's 0 to 15 bars) and "See the notes wheel" exactly as before; it never reads `/roaster-profile`.

## Ella's Bloom Map 14: what moves your spot, and walking the map (2026-11-27)

- [ ] **The cart never moves the spot:** on `/map` the price chip adds one bag; the map, the top card and the trail do not change, and no row is written to `customer_match_decision`.
- [ ] **Looking at a coffee writes nothing:** tapping a coffee's dot or a step card's name opens `/map?at=<id>` with "Looking at", the coffee's compare line and "Back to your spot: {coffee}"; the spot stays ringed; refresh keeps it, back returns; no row in any table.
- [ ] **A first order is trail only:** "Ordered" on the trail; the spot stays.
- [ ] **A reorder moves the spot:** the same coffee in a second separate order (manual or Liam-followed; renewals and gifts do not count; two bags in one order are one order).
- [ ] **Positive feedback moves the spot** unless the spot's coffee has a higher rating; an unrated spot gives way; equal ratings move. Negative feedback never moves it, and that coffee is never the lead.
- [ ] **A quiz retake** moves the spot only while it is still the Founder's pick.
- [ ] **The rules are rows:** "What moves a spot" on `/admin/map` (effect, switch) and its numbers (`dial_spot_*`, `feedback_*`) change the spot on the next read.
- [ ] **While looking at another coffee** the customer's own spot is a normal card and never the lead (`dial_spot_not_lead_when_looking`).
- [ ] **Positive and negative** come from `feedback_positive_min_rating` / `feedback_negative_max_rating` everywhere (`v_customer_feedback_current`, `v_customer_timeline`, `getFeedbackCurrent`).

## Ella's Bloom Map 15: every card says something about you (2026-11-27)

- [ ] **With a usable quiz, every card says something about the customer** (a start rule's lead keeps its lead line). After the reuse pass and the treat, a card tries `family_lean` (the lean counts as support), then `own_family`.
- [ ] **Neither `family_lean` nor `own_family` ever decides the lead.**
- [ ] **No card rules a coffee out:** no customer text says "Your answers point elsewhere." or predicts a dislike. A card no row supports carries its line alone.
- [ ] **The opposite direction is taken last** by `family_lean` and `own_family` while `dial_step_opposite_last` is 1.
- [ ] **Every step card and the "Looking at" card carry a tag relative to the spot.** The first `spot_relation` row that holds gives it: same family, joined by a published step, leans to the spot's family, otherwise "A different direction: {family}". The spot as a card is "Your spot"; the spot's own top card has no tag.
- [ ] **The "Looking at" card** reads tag, a sentence about the customer, then the line. While looking, the heading names the coffee ("One step from {coffee}").
- [ ] **A quiz taken by someone else** gives no sentence about the customer: the top card is the rule's coffee line. The customer's own setup feeling is still used.
- [ ] **Tiger Stripe has five steps:** The Daily and Fabricator are one step each way. There is no step between Tiger Stripe and Benchmark.
