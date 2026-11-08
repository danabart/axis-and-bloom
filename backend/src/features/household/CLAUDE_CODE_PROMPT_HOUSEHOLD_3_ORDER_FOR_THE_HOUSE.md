# Claude Code brief — Household 3: Order for the house

Workstream: household (`README.md`, `DESIGN_HOUSEHOLD.md` here; the design is the spec, read §3 D11, D12, D13, D21, D22, D24, D30, D32, D34 and §3d T1, T2, T3, T8, T11, T12 first; then `CLOSING_REPORT_1.md` and `CLOSING_REPORT_2.md`) · Written 2026-11-07 by the CTO session after Household 2 shipped · **Touches money (subscription items, cancellation, a discount): strongest model, dedicated session (G1.13)** · Dana runs it; push = deploy · **Stripe test mode.**

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (parameters: `household_parameter.house_box_bags_per_member`, `household_handover_discount_pct`, `household_handover_window_days`; `commerce_parameter` for everything that already lives there) · G2.2 · G2.3 prefixes `household_`, `subscription_`, `order_` · G2.4 CATALOG.md checked (why nothing fits: the recipient of a line and of a subscription item are existing columns gaining a writer; the handover is events in `household_event`; no new table) · G2.5 one writer (`checkoutService` for orders and lines, `subscriptionService` for `subscription`, `subscription_item`, `subscription_event`, `householdService` for `household_*`, `orderEmails` + `transactionalEmail.sendOnce` for mail), reads via `v_household_*`, `v_customer_quiz_current`, `v_customer_dial_current`, `v_order_status`, `v_subscription_status` · G2.6 one door · G2.13 events for every subscription and household change · G2.16 prices from our tables, Stripe holds none · G2.19 transactions are never blocked · G3.1 · G3.3 idempotent (renewal, emails, handover redemption) · G3.6 ownership on every customer route · G3.9 reuse `resolveIntendedFor`, `resolveItem`, `applySubscriptionPricing`, `subscriptionService.cancel`, `sendOnce`, `orderEmails` renderers · G4.1 reuse `CartLines` / `useCart`, `SubscriptionPanel`, `FamilyTab` · G4.2 nothing typed in · G4.4 positive copy · G4.5 no roaster names in member mail · G5.1 vitest · G5.2 acceptance in test mode with evidence · G1.6 push is deploy, one closing report.
STOP points: after Task 0; before Part E's production steps (Dana does them with you).

**Goal.** The head of the household buys and subscribes for the family. Every cart line and every subscription item names its drinker; renewals follow each drinker's own current quiz and dial; the drinkers who signed up are told when their coffee is ordered and shipped; a drinker who left the box makes their line unresolved instead of shipping the wrong coffee. Leaving or dissolving with the house subscription active cancels it and hands the other members a time-boxed offer to take it over. The admin page gets the numbers.

**Decisions already made (Dana 2026-11-07, design §3; do not re-open).** D11, D12, D13, D16 (done in brief 1, verify only), D19, D21, D22, D24, D30, D32, D34; technical calls T1 (done), T2, T3, T8, T11, T12. CTO calls for this brief, reversible, flag if the code disagrees:
1. `"order".household_id` and `subscription.household_id` are set when the buyer is an active member of a household at the time of the order, whether or not a line names someone else. The views then know a house order from a solo one, and the numbers card counts bags per house order correctly.
2. The handover discount is one `household_parameter` percentage added to the subscription tier (Dana: "additional 5%"), applied once, at the first subscription checkout a handover-offered member completes inside the window, and recorded as `discount_cents` on the lines plus a `household_event` `handover_redeemed`. Nothing in Stripe: our pricing tables price the invoice as today.
3. An unresolved renewal item for a member who left keeps today's unresolved path (no charge, event, admin emailed once per cycle) with the reason naming the member; no new mechanism.
4. The brief-1 refusal of leave/dissolve while a house subscription is active is removed and replaced by D22's cancel-with-confirmation.

---

## Task 0 — Verify (write into `CLOSING_REPORT_3.md` before changing anything; STOP after)

1. **Checkout.** `checkoutService.resolveIntendedFor` (one recipient per order, membership via `v_household_member`), `fingerprint` (includes `intendedFor`), `createCheckoutSession` line insert (~216, `intended_for_user_id` per line already a column), `completeCheckoutSession` (~375) and `createSubscriptionOrder` (~487) line inserts, where `"order".household_id` would be set (never today). `CartItemInput` and the frontend payload (`useCart`, `CartLines`, `CheckoutPage`): what a line carries.
2. **Subscription.** `subscriptionService.createPaidSubscriptionFromCheckout` (~133; item insert ~160), `subscription_item` columns and CHECK, `subscription_event_kind` seeds (`item_added`, `item_removed` exist? seed if not), `cancel` (~581: voids open invoices, `refreshLifecycleState`), `getSubscriptionsForCustomer`, `v_subscription_status`. `routes/subscriptions.ts` self-service routes from Commerce 3 and `SubscriptionPanel.tsx`.
3. **Shipment.** `subscriptionShipment.resolveItem(item, userId, followDial)` and `resolveSubscriptionShipment` (passes `sub.user_id` for every item; dial read from `user_bloom_dial_current_position` by raw id), `applySubscriptionPricing` (tier by bag count), `subscriptionRenewal` unresolved outcome (event, admin email once, claim released), `commerce_parameter.subscription_ships_current_dial_position`.
4. **Attribution.** `v_customer_bag_attribution` CASE (intended → buyer → claim) and its claim join on `v_household_member` from brief 1; every reader of `attribution` / `drinker_user_id` (`v_palate_evidence`, Liam, timeline) so D24's reorder breaks nothing.
5. **Mail.** `orderEmails` renderers and `sendOnce` keys for confirmation and shipping; where the shipping email is triggered (`shipmentService.markShipped`, ShipStation path if any); `OrderSummary` line fields (display name, archetype label; confirm no roaster name reaches a customer template).
6. **Household.** `householdService.leave` / `dissolve` (the brief-1 refusal `subscription_active`), `householdReads.mine` (OT-108: the per-member N+1), `v_household.pays_user_id` (OT-103), `household_event_kind` seeds (`subscription_cancelled_on_leave`, `handover_offered` exist; add `handover_redeemed`), `household_parameter` seeds for the three keys.
7. **Liam.** `liamAccess` already grants via `v_household_member` for `s.household_id` (brief 1); confirm it will see the `household_id` this brief starts writing on subscriptions.
8. **Production, read-only:** subscriptions by status and whether any has `household_id`; orders with `household_id` (expect 0); Dana's test subscription from Commerce 2 (id, items, status) since Part E reuses it or creates a new one in test mode.

## Task 0.5 — Dana's manual steps
None before Part E. Part E's production steps are done with Dana in the session (test-mode Stripe).

---

## Part A — Schema (additive, idempotent; `comments.sql`; `catalog:md`)

- `subscription_item.intended_for_user_id UUID NULL REFERENCES user_profile(id)` (NULL = the subscriber). CHECK becomes `archetype IS NOT NULL OR signup_coffee_id IS NOT NULL OR intended_for_user_id IS NOT NULL` (T2). Add `ended_at TIMESTAMPTZ NULL` so a dropped item is retired, not deleted (G2.11); every item read filters `ended_at IS NULL`.
- `subscription_event_kind` seeds `item_added`, `item_removed` (if missing). `household_event_kind` seed `handover_redeemed`.
- `v_customer_bag_attribution` (D24): CASE order becomes claim by an active member of the order's household → `intended_for_user_id` → buyer (non-household, non-gift) → unattributed; `attribution` codes unchanged (`claim`, `intended`, `buyer`, `unattributed`).
- `v_subscription_status` (or the item read it exposes): per item `intended_for_user_id`, `intended_for_first_name`, `ended_at`; `household_id`.
- `v_household`: `pays_user_id` from the active house subscription's `user_id` when one exists, else the admin pointer (OT-103); `house_subscription_id`, `house_subscription_status`.
- `v_household_member`: `in_house_subscription` (has a live item pointed at them), `own_plan_active` (the member's own active subscription exists; D30).
- Admin numbers view `v_household_numbers` (one row): households, active members, avg members per household, proxy quizzes (`quiz_session.taken_by_user_id IS NOT NULL`), claim rate (members whose `account_state = login` and that have a `household_claim` link / managed members ever created), bags per house order (avg line quantity sum over orders with `household_id`).

---

## Part B — Backend

B1 **Per-line recipient.** `resolveIntendedFor` becomes per line: each line's `intendedForUserId` is NULL (the buyer) or an active member of the buyer's household (`v_household_member`, role flag `in_house_box` for anyone other than the buyer); otherwise 400 `invalid_recipient`. `fingerprint` includes the per-line recipients. Order lines insert each line's own `intended_for_user_id`. `"order".household_id` = the buyer's active household (CTO call 1). Same in `completeCheckoutSession` and `createSubscriptionOrder`.

B2 **Subscription items with a recipient.** `createPaidSubscriptionFromCheckout` writes `intended_for_user_id` per item, `archetype NULL` for a recipient line (T2), `subscription.household_id` (CTO call 1). `subscriptionService.addItem(subscriptionId, { intendedForUserId, weightOz, quantity }, actor)` and `removeItem(subscriptionId, itemId, actor)` (sets `ended_at`), both admin-of-the-household or the subscriber, events `item_added` / `item_removed` with the item in the note; changes apply from the next renewal, no proration (T11). The price tier is recomputed by bag count at renewal as today.

B3 **Renewal per drinker.** `resolveSubscriptionShipment`: for an item with `intended_for_user_id`, resolve the drinker's canonical id (`v_customer_identity`), take their current archetype from `v_customer_quiz_current` (no quiz → `unresolved`, reason "`<first name>`: no quiz yet"), then the dial from `v_customer_dial_current` (T3), then signup slot, then landing default; items without a recipient keep today's path. If the drinker is no longer an active in-box member of `subscription.household_id` → `unresolved`, reason "`<first name>` is no longer in the household box" (D11, CTO call 3). Line display name per drinker. `createSubscriptionOrder` carries each line's `intended_for_user_id` into the order.

B4 **Member mail (D13, T8).** In the order-confirmation and mark-shipped paths: for each order line with an `intended_for_user_id` that is not the buyer and whose profile has a login (`account_state = login`) and a primary email, send `household_bag_ordered:<order line id>` / `household_bag_shipped:<order line id>` through `sendOnce`, rendered by new `orderEmails` functions reusing the existing layout (coffee display name and archetype label; no roaster, G4.5; positive register, G4.4). The buyer's own confirmation and shipping emails are unchanged.

B5 **Cancel on leave and handover (D22).** `householdService.leave` / `dissolve`: when the actor is the subscriber of the active house subscription, require `confirm: true` in the request (the route returns 409 `confirm_cancel` with the API's copy naming the subscription when absent), then `subscriptionService.cancel(id, 'customer')`, event `subscription_cancelled_on_leave`, and for every other active member with a login and primary email: `sendOnce` `household_handover:<household event id>:<member id>` with the handover email (what was in the box, the perk percentage and the window end date, a link to subscribe) and event `handover_offered` with `{ member, expires_at }`. Remove the brief-1 `subscription_active` refusal (CTO call 4). Admin transfer (D21) is unchanged.

B6 **Handover discount (CTO call 2).** `checkoutService.quoteCart` and `createCheckoutSession` with a subscription intent: if the buyer has a `handover_offered` event not yet redeemed and inside `household_handover_window_days`, add `household_handover_discount_pct` to the tier percentage for this checkout (quote shows it as its own line, "Family Household offer"), and on `completeCheckoutSession` write `handover_redeemed` with the order id. Idempotent: one redemption per offer. Nothing is written to Stripe beyond the line amounts we already send.

B7 **Build the house box.** `GET /api/household/house-box` (admin): for every active member with `in_house_box`, `house_box_bags_per_member` lines at the member's current match through the same resolution as B3 (so the cart and the renewal agree), plus `needs_quiz` for members with none and `own_plan_active` for D30. The frontend adds the returned lines to the cart; nothing is ordered server-side.

B8 **Reads and admin.** `householdReads.mine` reworked to one query per section (OT-108), adds `house_subscription` (id, status, next delivery, items with drinker names, add/drop allowed), `handover_offer` (when one is open for this member). Admin `GET /api/admin/household/numbers` from `v_household_numbers`.

---

## Part C — Frontend

C1 **Cart.** `CartLines`: a "For" select per line (members with `in_house_box`, the buyer first, labels from the API; hidden when the buyer is in no household); `useCart` carries `intendedForUserId` per line; `CheckoutPage` sends it. Shared components, no copy (G4.1).

C2 **Family Household tab.** "Build the house box" (admin): calls B7, adds the lines to the cart, shows per member the chosen coffee, "Take the quiz for <name>" for `needs_quiz`, and "Also on their own plan" for D30; then "Go to cart". House subscription section (admin): what ships next and for whom, Add a bag for <member>, Drop, from B2 through the existing `SubscriptionPanel` pieces. Leave / Dissolve: the confirmation sentence from the API when it would cancel the house subscription. Handover banner for a member with an open offer (perk and end date from the API, button to the dial / shop).

C3 **Subscription self-service** (`SubscriptionPanel.tsx`): each item shows its drinker; the admin of the household sees Add / Drop.

C4 **Admin** `AdminHouseholds.tsx`: the numbers card (D19) from B8 at the top; the household drawer shows the house subscription and its items.

---

## Part D — Tests (vitest, test DB)

- `resolveIntendedFor` per line: buyer + member passes; a non-member or a `left` member 400s; a member without `in_house_box` 400s; fingerprint changes with recipients.
- Order creation writes per-line recipients and `household_id` for a household buyer, NULL for a solo buyer.
- `createPaidSubscriptionFromCheckout` writes recipient items with `archetype NULL`; `addItem` / `removeItem` write events, `ended_at` retires, reads filter it.
- `resolveSubscriptionShipment`: recipient with quiz + dial → dial slot; with quiz, no dial → signup slot / landing default; no quiz → unresolved naming them; recipient who left → unresolved naming them; items without a recipient unchanged; the subscriber's own dial never leaks onto a recipient line.
- `v_customer_bag_attribution` D24 order: intended line claimed by another household member → `claim`; unclaimed → `intended`; solo order → `buyer`.
- Member mail: one `household_bag_ordered` per recipient line with a login, none for a managed member, none for the buyer; shipped likewise; `sendOnce` idempotent.
- Leave by the subscriber without confirm → 409; with confirm → subscription `canceled`, event, one handover email per eligible member, `handover_offered` events; dissolve likewise; leave by a non-subscriber member cancels nothing.
- Handover discount: offered member inside the window gets tier + perk once; after redemption or after the window, tier only; non-offered buyer unchanged.
- House box: lines per in-box member × parameter, `needs_quiz` and `own_plan_active` flags.
- `v_household_numbers` on a fixture with known counts.

## Part E — Acceptance (Stripe test mode; D32)

Local, test DB, test keys: as admin with members Tom (login, own quiz, dial set) and Ella (managed, proxy quiz): Build the house box → cart shows three lines with drinkers → checkout as a subscription (Stripe test card) → order has `household_id`, lines carry recipients, Tom gets `household_bag_ordered`, Ella and the buyer do not; subscription has two recipient items with `archetype NULL`. Run the renewal resolution (`resolveSubscriptionShipment`): Tom's line follows his dial, Ella's her proxy quiz. Ella leaves (as Ella, via her claimed account in a private window) → next resolution unresolved naming Ella, admin emailed once. Mark shipped → Tom gets `household_bag_shipped`. Admin leaves with confirm → subscription canceled, Tom gets the handover email; as Tom, quote a subscription → tier + 5%; complete it → `handover_redeemed`; quote again → tier only. Delete temporary Firebase users afterwards.

Production (with Dana, test mode, pre-launch gate up): on prod, Build the house box for her household (camila has a proxy quiz), checkout a house subscription with the test card, confirm order lines and `household_id`, run nothing destructive; Dana decides whether to leave the test subscription active or cancel it from the tab (which exercises D22 on prod).

## Docs and closing

`CLOSING_REPORT_3.md` with the evidence list (ids, amounts, emails), `WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`, `CATALOG.md` regenerated and committed, `README.md` here marked ran, OT-103 and OT-108 closed in `OPEN_TASKS.md`. Leave `backend/src/features/commerce/README.md` and the Genova font deletions out, as before.

## Do not

- Do not block any order or subscription change on palate state (G2.19, D34): a member with no quiz shows "Take the quiz for" in Build the house box but the admin may still add any coffee for anyone.
- Do not store an archetype on a recipient subscription item (T2); do not copy a quiz result or dial position anywhere (G2.14).
- Do not DELETE a subscription item (`ended_at`), an order line, an event or a household row.
- Do not create a Stripe coupon, promotion code or subscription object; prices and discounts stay in our tables and our line amounts (G2.16).
- Do not email a managed member or anyone without a login (D31); do not email the buyer a member notice (T8); never a roaster name in customer mail (G4.5).
- Do not fork `resolveItem`, `resolveIntendedFor`, `applySubscriptionPricing`, `subscriptionService.cancel`, `CartLines` or `SubscriptionPanel`; extend them.
- Do not switch Stripe to live keys; this brief runs in test mode throughout.
