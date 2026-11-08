# Closing report — Household 3: Order for the house

Brief: `CLAUDE_CODE_PROMPT_HOUSEHOLD_3_ORDER_FOR_THE_HOUSE.md` · Design: `DESIGN_HOUSEHOLD.md` · Stripe test mode · Started 2026-11-07.

Status: Task 0 accepted (Dana, 2026-11-07); Parts A–D built and tested, local acceptance (Stripe test mode) passed, committed and deployed (below). **STOP 2: Part E's production steps wait for Dana.** Task 0's production reads ran inside `BEGIN READ ONLY … ROLLBACK` (`backend/tmp/household3_task0.ts`, gitignored).

---

## Task 0 — findings

### 1. Checkout (`services/checkoutService.ts`)

- `resolveIntendedFor(userId, items)` (:75): one recipient for the whole order (400 when lines differ), membership through `v_household_member` (both active, same household); no `in_house_box` check.
- `fingerprint(cart, shipTo, intendedFor, intent)` (:90): includes the single `intendedFor`.
- `createCheckoutSession` (:158): `checkout_session_line.intended_for_user_id` already exists and is written per line, but with the one order-wide value. `completeCheckoutSession` (:323) copies each session line's `intended_for_user_id` into `order_line_item`. `"order".household_id` is never written (insert-only table, D11: it must be set in the INSERT).
- **`resolveCart` turns items into lines one-to-one, except a Collection item, which expands into several lines.** A per-line recipient therefore needs each resolved line to carry the index of the cart item it came from (a field on `ResolvedLine`), so every coffee of a Collection takes that item's recipient.
- `createSubscriptionOrder` (:428, renewals): the order lines are rebuilt from the **Stripe invoice items' metadata** that the renewal cron wrote (`RenewalLineMetadata`: sku, coffee, name, oz, price, discount); every line gets `intended_for_user_id = sub.user_id`. The drinker must travel in that metadata (`intended_for_user_id`), written by `subscriptionRenewal.invoiceCycle`; an invoice without it falls back to the subscriber.
- `CartItemInput` has no recipient; the frontend (`CartContext.toCheckoutItems`) sends none. **The cart merges identical items by quantity**, so the merge key must include the recipient (two people, same coffee → two lines).

### 2. Subscription (`services/subscriptionService.ts`)

- `createPaidSubscriptionFromCheckout` (:133): `subscription.archetype` = first dial line's; one `subscription_item` per checkout line (`archetype`, `signup_slot_id`, `signup_coffee_id`, `weight_oz`, `quantity`, `display_name_at_signup`); CHECK `archetype IS NOT NULL OR signup_coffee_id IS NOT NULL`. No `household_id`, no recipient, no `ended_at`.
- `subscription_event_kind`: **`item_added` / `item_removed` are not seeded** (Part A seeds them).
- `cancel` (:581): voids open Stripe renewal invoices, then its **own transaction** (status `canceled`, event), then the subscriber's cancellation email and `refreshLifecycleState`. It cannot run inside `householdService`'s transaction; cancel-on-leave has to sequence around it.
- `subscriptionOwnedBy(uid, id)` gates the self-service routes on the subscriber only; the household admin's add/drop needs its own ownership check.
- `getSubscriptionsForCustomer` reads `v_subscription_status` and calls `resolveSubscriptionShipment` for "what ships next". `v_subscription_status` is a per-subscription `CREATE OR REPLACE VIEW` (columns can only be appended); per-item drinker data needs an item view beside it (`v_subscription_item`).
- Tests mock `./stripe.js` (`subscriptionService.test.ts`, `subscriptionRenewal.test.ts`, `checkoutService.test.ts`): Part D follows them.

### 3. Shipment and renewal

- `subscriptionShipment.resolveItem(item, userId, followDial)`: an item with an archetype tries the dial (`user_bloom_dial_current_position` by the raw subscriber id), then the signup slot, then the landing default; a category coffee ships its signup coffee. `resolveSubscriptionShipment` passes `sub.user_id` for every item.
- **One unresolved item makes the whole shipment unresolved**: `subscriptionRenewal.chargeDueSubscription` → `notPrepared`: no charge for anyone, `renewal_failed` event, admin attention email, claim released (the cron retries the next day), the next delivery date does not move. With per-drinker items, a member who left (or has no quiz) would hold every other bag of the house box until the admin drops the item. See decision 1.
- `applySubscriptionPricing(lines)`: tier by total bag count (`subscription_discount_pct_1_bag` 5, `_2plus_bags` 10 on prod); the handover perk needs an extra-percent input.
- `commerce_parameter.subscription_ships_current_dial_position` = 1 on prod.

### 4. Attribution

`v_customer_bag_attribution`: CASE intended → buyer (no household, no gift) → claim (an active member of the order's household, via `v_household_member`, brief 1) → unattributed. Readers: `v_customer_timeline` (detail.attribution), `v_palate_*` views (`attribution <> 'unattributed'` and `drinker_user_id`), `customerReads.getFactsWatermark`, `liamProfile` (`<> 'unattributed'`), `customerIntegrity` (column list). None depends on the order of the CASE, so D24's reorder breaks nothing. One consequence: house-order lines for the buyer must keep storing the buyer's id (as today), or the new CASE would leave them unattributed.

### 5. Mail

`orderEmails`: `renderOrderConfirmationEmail` / `sendOrderConfirmationEmail` (`order_confirmation:<orderId>`, from `orderFinalizer.finalizePaidOrder`), `renderShippingNotificationEmail` / `sendShippingNotificationEmail` (`order_shipped:<shipmentId>`, from `shipmentService.markShipped`; no ShipStation path). Customer emails go to the Firebase Auth record's email (`customerEmail`), through `sendOnce` (dedupe on email + template). `OrderSummary.lines` carry `displayName` (the house slot name, never a roaster), `weightOz`, `quantity`, price; no recipient and no archetype label yet: both are added for the member mail. No roaster name reaches a customer template today (the admin emails carry it, by design).

### 6. Household

`leave` / `dissolve` refuse with `subscription_active` when any counting subscription has the household's id (to be replaced by D22). `mine`: the cost is not an N+1 in code (one query for all members) but the scalar subqueries in `v_household_member`, each walking `v_customer_identity` (~70 ms per member, OT-108); the fix is in the view (one identity lookup per row, joined once). `v_household.pays_user_id` = `primary_billing_user_id` (OT-103). `household_event_kind` has `subscription_cancelled_on_leave`, `handover_offered`; **`handover_redeemed` is missing**. `household_parameter` has the three keys (1 bag per member, 5 %, 7 days).

### 7. Liam

`liamAccess` grants a subscriber on `s.user_id = up.id OR` an active member of `s.household_id` (brief 1). It will see the `household_id` this brief writes: every active member gets Liam through the house subscription (D16). This interacts with decision 2.

### 8. Production, read-only (2026-11-07)

- Subscriptions: one `paid`, `canceled` (`7187cc53…`, user `37198fcc…`, not Dana-Admin; 1 item chocolate_nutty slot 23 "Coado" 12 oz); none with `household_id`.
- Orders with `household_id`: 0.
- Household "Bars-checout1-test": Dana-Admin (admin + household, login, own quiz, earthy, dial slot 15) and camila (household, managed, proxy quiz by Dana-Admin, fruity, dial slot 7). Proxy sessions: 1 (brief 2's production step is done).
- So Part E on production starts a new house subscription; nothing existing is reused.

---

## Contradictions and decisions needed before Part A

1. **A drinker who left (or has no quiz) and the rest of the box.** Today an unresolved item blocks the whole renewal (no charge, admin email, retried daily), so under CTO call 3 one departed member would stop every bag of the house box until the admin drops that item. D11 says the *item* goes unresolved and the admin is told; it does not say the others wait. **Recommendation:** ship the bags that resolve, skip the unresolved items this cycle (not charged, the tier recomputed on the bags that ship), and email the admin once per cycle naming the skipped members; a cycle where nothing resolves stays today's unresolved path. Alternative: keep CTO call 3 literally (the whole box waits).
2. **`subscription.household_id` on a member's own subscription.** CTO call 1 sets `household_id` on every subscription a household member starts. Then a member's *own* plan (D30's `own_plan`, T12) becomes "the house subscription": leaving the household would cancel it under D22 (T12 says their own subscription is untouched), and `liamAccess` would give the whole household Liam through one member's personal plan (D16 is about the house subscription). **Recommendation:** orders get `household_id` as CTO call 1 says (counting only, nothing acts on it); a subscription gets `household_id` only when at least one item is for another member (a house subscription). Alternative: CTO call 1 literally for both.
3. **Removing the subscriber.** D22 covers the subscriber leaving or dissolving. An admin *removing* the member who holds the house subscription (possible after a D21 transfer) would leave a running subscription paid by someone outside the household. **Recommendation:** refuse that removal while the house subscription is active (409, "<name> holds the house subscription; they can leave, which offers it to the household"). Alternative: cancel with confirmation, as for leave.
4. **The handover perk's scope.** CTO call 2: tier + 5 % at the first subscription checkout inside the window, recorded on that checkout's lines; renewals are at the normal tier. I build it as the first box only. Say if the perk should stay on every renewal of the new subscription.
5. **Member mail addresses.** The brief says "primary email"; every customer email today goes to the Firebase Auth record's email (`orderEmails.customerEmail`). I reuse that lookup for the member notices and the handover email (one source for customer addresses); a managed member has no Firebase record and gets nothing (D31).
6. **Smaller points (my defaults):** per-item drinker data in a new `v_subscription_item` view beside `v_subscription_status` (which can only gain columns at the end); `ResolvedLine` gains the cart item index; the cart merge key includes the recipient; the renewal invoice items carry `intended_for_user_id` in their metadata; OT-108 is fixed in `v_household_member` (one identity lookup per row) rather than by splitting `mine`.

### Dana's answers (2026-11-07)

1. Ship what resolves; skip the missing member's bag for that cycle (not charged), recompute tier and shipping on what ships, email once per cycle naming the skipped member. The whole box never waits on one person (D34).
2. Orders always carry the household (counting only); a subscription carries it only when at least one item is for someone other than the subscriber. Liam access and cancel-on-leave follow the subscription's household_id.
3. Refuse removing the member who holds the active house subscription, with copy pointing at Leave.
4. The handover perk is first box only; renewals at the normal tier.
5. Member notices and the handover email go to the sign-in address; managed members get nothing.

Smaller defaults accepted (`v_subscription_item`, drinker in the cart merge key and in the renewal invoice metadata); OT-108 fixed in the view.

---

## What was built

### Part A — schema

CATALOG.md checked (G2.4): the recipient of a line and of an item are columns that gain a writer (`order_line_item.intended_for_user_id` existed; `subscription_item.intended_for_user_id` is new beside it); the handover is `household_event` rows; the views are reads. No new table.

- `subscription_item.intended_for_user_id`, `ended_at`; the unnamed CHECK `subscription_item_check` is swapped (idempotent `DO` block) for `subscription_item_what_ships` (archetype, signup coffee or recipient, T2).
- Seeds: `subscription_event_kind` `item_added`, `item_removed`, `renewal_items_skipped`; `household_event_kind` `handover_redeemed`; `household_parameter` `house_box_weight_oz` 12 (G2.1: the box needs a bag size; the pricing tables sell 12 and 80 oz).
- `checkout_session.handover_offer_event_id` (the offer a subscription checkout redeems).
- `v_subscription_status` (edited in place, `CREATE OR REPLACE`): counts live items only; `household_id` appended.
- **OT-108**: `v_household_member` was split. `v_household_membership` (lean: membership, roles and flags, account state, claim link, open link; no identity walk) stays where the household views were and serves the hot readers (`liamAccess`, `checkoutService.resolveIntendedFor`, `userSignals`, `users` homepage, `customerReads`, `subscriptionService`, `subscriptionShipment.readDrinker`, the attribution claim join, the invitation and event views). `v_household_member` now joins identity, current quiz and dial **once per query** and gains `in_house_subscription` and `own_plan_active`.
- A new block **after the Commerce 3 block** (the household views now read `subscription_item`'s new columns, which are created ~3,000 lines after the old household views): `v_subscription_item`, `v_household_member`, `v_household` (OT-103: `pays_user_id` from the active house subscription, else the admin pointer; `house_subscription_id`, `house_subscription_status`), `v_household_numbers` (D19).
- `v_customer_bag_attribution` (D24): claim by an active member of the order's household → the line's recipient → the buyer of a non-household order → unattributed. **Correction found by the tests:** every line stores a recipient (the buyer's own lines carry the buyer, or house-order buyer lines would fall to `unattributed`), so the code is `intended` only when the recipient is someone other than the buyer and `buyer` when it is the buyer. Readers only test `<> 'unattributed'` (Task 0 item 4); the Liam profile and palate tests pass (105/105).
- `comments.sql` for every new column and view and the changed writers (`subscription.household_id`, `"order".household_id`, `subscription_item`, `user_saved_item` unchanged).

### Part B — backend

- **B1** `resolveIntendedFor(buyer, items)` → `{ perItem, householdId }`: each item is the buyer or an active in-box member of the buyer's household (400 `invalid_recipient` otherwise). `ResolvedLine.itemIndex` (cartResolver) maps a Collection's coffees to their item's recipient; `fingerprint` includes each line's recipient (exported for its test). `completeCheckoutSession` and `createSubscriptionOrder` write `"order".household_id` (the buyer's active household at payment, CTO call 1); renewal lines take their recipient from the invoice item metadata.
- **B2** `createPaidSubscriptionFromCheckout`: recipient items with `archetype NULL`; `subscription.household_id` only when an item is for someone else (decision 2). `subscriptionService.addItem` / `removeItem` (ended, never deleted; `item_added` / `item_removed`; a bag for someone else makes it a house subscription, dropping the last such bag makes it personal again; the last live bag cannot be dropped), gated by `subscriptionItemsEditableBy` (the subscriber or an administrator of the household it serves). Routes `POST /api/subscriptions/:id/items`, `DELETE /api/subscriptions/:id/items/:itemId`.
- **B3** `subscriptionShipment`: `readDrinker` (canonical id, current archetype, dial for it, still an active in-box member of the subscription's household) and `resolveDrinkerLine` (current quiz → their dial → signup slot if in that archetype → landing default), shared with Build the house box. Decision 1: a drinker reason (no quiz yet, no longer in the box) is `skippable`; the shipment is `resolved` with `skipped`, priced on what ships (`applySubscriptionPricing` on the resolved lines: tier and shipping by the bags that ship); any other reason, or nothing left, stays today's unresolved path. The renewal cron writes `intended_for_user_id` into each invoice item's metadata, and after a successful charge with skipped bags records `renewal_items_skipped` and emails the payer once per cycle (`household_items_skipped:<sub>:<cycle>`). Items read `ended_at IS NULL`.
- **B4** `services/householdEmails.ts` (one module, `sendOnce`, the order emails' card layout): `household_bag_ordered:<line>` (from `finalizePaidOrder`, new step after the buyer's confirmation) and `household_bag_shipped:<line>` (from `markShipped`, after the buyer's shipping email) to each drinker with a sign-in whose canonical account is not the buyer (T8); managed drinkers get nothing (D31); coffee name, size, family label, never a roaster (G4.5).
- **B5** `householdService.leave(actor, { confirm })` / `dissolve(actor, { confirm })`: the leave rules are checked first; when the actor holds the household's active house subscription, no confirm → 409 `confirm_cancel` with the sentence the tab shows; with confirm → `subscriptionService.cancel` (its own transaction, the subscriber's cancellation email), then in one household transaction `subscription_cancelled_on_leave`, one `handover_offered` per other active member with a sign-in (`member_user_id`, `expires_at` = now + window days, the subscription, the perk), the leave; then the handover emails (`household_handover:<event>:<member>`: what was in the box, the perk, the end date). The brief-1 refusal is gone (CTO call 4). Decision 3: `removeMember` of the holder → 409 `holds_house_subscription`. Accepting another household's join link while holding a house subscription → 409 (leave first, so the offer goes out).
- **B6** the perk: `applySubscriptionPricing(lines, extraPct)`; `quoteCart` (signed in via `optionalAuth` on `/quote`) returns `subscription.offer {pct, cents, label, expiresAt}`; `createCheckoutSession` prices the first box at tier + perk and stores `handover_offer_event_id`; `completeCheckoutSession` calls `householdService.recordHandoverRedeemed` (once per offer).
- **B7** `GET /api/household/house-box` (admin): one line per active in-box member with a quiz (`house_box_bags_per_member` × `house_box_weight_oz`, the renewal's own resolution), `needsQuiz`, `ownPlanActive`, the reason when nothing is sellable. `GET /api/household/recipients` (the cart's "For").
- **B8** `mine` adds `houseSubscription` (who pays, status, next date, items with whom each is for, `canEdit`, `addableFor`, the bag size) and `handoverOffer`; per member `inHouseBox`, `inHouseSubscription`, `ownPlanActive`. Admin `GET /api/admin/household/numbers`; the household drawer carries the house subscription's items.

### Part C — frontend

- **C1** `CartLines`: a "For" select per line (buyer first, in-box members; hidden outside a household; read-only "For <name>" where the list is not editable); `CartContext.setRecipient`, recipient in `isSameLine` and in `toCheckoutItems`; the quote is sent signed in and the subtotal shows "Family Household offer · 5% −$x" as its own line.
- **C2** Family Household tab: the handover offer banner, Build the house box (adds the lines to the cart; per member the coffee, "Take the quiz for <name>" when `needsQuiz`, the own-plan role label for D30, Go to cart), the house subscription (status, frequency, next date, who pays; each bag and whom it follows; Drop; Add a bag for <member>), Leave / Close asking first with the API's sentence when it would cancel the house subscription.
- **C3** `SubscriptionPanel`: each next-delivery line names its drinker; skipped bags listed.
- **C4** Admin Households: the numbers card (households, members, members per household, proxy quizzes, claimed profiles and claim rate, house orders, bags per house order) and the house subscription in the drawer.

### Part D — tests

- `services/householdOrder.test.ts` (8, Stripe / Resend / Firebase mocked, real slots and prices from the test DB): per-line recipients (buyer + members pass; non-member, member out of the box, left member refused; fingerprint changes); a house subscription checkout end to end (order and subscription `household_id`, recipients per line, recipient items `archetype NULL`, `mine` sees it; a member's own plan stays personal while its order counts; a solo order has no household); D24 (intended → claim by another member; solo → buyer); member mail ordered and shipped (Tom only, once); renewal per drinker (the subscriber's dial on their bag, Tom's dial on his, Ella's signup slot; a no-quiz member and a removed member skipped by name, the rest ships at its own bag count; nothing resolvable → unresolved); add/drop (events, `ended_at`, `bag_count`, household set and cleared, subscriber and odd size refused, last bag kept); D22 (holder not removable, a non-subscriber leave cancels nothing, 409 then cancel + one offer + one handover email to the member with a sign-in, quote tier + 5 % once, redeemed, then tier only; an expired offer prices nothing; dissolve asks then cancels); Build the house box flags; `v_household_numbers` against the base tables.
- Updated: `householdService.test.ts` (per-item recipients; confirm instead of refusal; 20 event kinds), `orderFinalizer.test.ts` (mocks the new step, like every other step).
- **Full backend suite** (test DB as refreshed 2026-11-07): first run 20 failed / 1,204. Mine: 2 (`orderFinalizer`, fixed above). Three (`guard.test`, `catalogImport` ×2) were catalog-integrity check 12 counting one NULL-slot dial row that brief 2's local acceptance left on the test DB (removed; the behaviour itself is OT-110). The remaining 15 are the known set (6 `quizScoring`, OT-73, 8 OT-107). The affected files then passed 11/11.
- Backend tsc clean; all six CI lints clean; frontend tsc adds nothing (7 pre-existing), frontend suite 145/145, `vite build` clean.

## Acceptance — local, test DB, Stripe TEST mode (2026-11-07)

`backend/tmp/hh3_accept.mts`, in process against `axisandbloom_test`, with the Stripe **test** key and the Resend key from Secret Manager in the process environment only (the script refuses a non-`sk_test_` key). Real Stripe test-mode Checkout Sessions are created; the paid webhook is replayed by calling `completeCheckoutSession` with a synthetic paid session (card entry with the test card is Dana's, in Part E on production). Three Firebase users on Dana's plus-addresses (`+hh3admin`, `+tom`, `+ella`), **deleted at the end**; the emails went to those addresses.

- Household "Acceptance House 3" (`7a99e4ed…`): Dana (admin, own quiz), Tom (claimed account, own quiz, dial), Ella (managed, proxy quiz).
- Build the house box: three lines, "1 × Coado (Chocolate & Nutty, stop 2)" for Dana, Tom, Ella. Quote: 3 bags, $96.00, as a subscription 10 % → $86.40.
- Subscription checkout: Stripe session `cs_test_b1Tb4rDa5Q…`; order `5a20bf5f…` with `household_id` = the household, subtotal $86.40, three lines at $28.80 for Ella, Dana, Tom; subscription `21a74397…` active with `household_id`; items: Tom (archetype NULL), Dana (chocolate_nutty), Ella (archetype NULL).
- Emails: Dana `order_confirmation`; Tom `household_bag_ordered` (sent; a second call `skipped`); Ella (managed) none.
- Renewal resolution: three lines. Tom's bag resolved to his signup slot, not his dial: his dial stop is not sellable on the test DB (one sellable slot per family), so the designed fallback applied; the dial basis is proven in Part D with sellable slots.
- Ella claims her profile and leaves: the next resolution ships 2 bags at 10 %, skipped "Ella is no longer in the household box"; the payer's skipped-bags email sent once (second `skipped`).
- Mark shipped (shipment `89776bde…`): Dana's `order_shipped`; Tom's `household_bag_shipped`; Ella's `household_bag_shipped` too (she had claimed a sign-in and left after this order was placed: her bag in that order did ship).
- Dana hands the admin role to Tom, then leaves: without confirm 409 "You hold the house subscription (3 bags every 4 weeks). Leaving cancels it, and everyone else in the household gets an offer to start it on their side."; with confirm the subscription is `canceled`, Dana gets `subscription_canceled`, Tom gets `household_handover`, one offer.
- Tom's quote for 2 bags as a subscription: 15 % (tier 10 + offer 5), offer line $3.20, $54.40; his checkout (Stripe session `cs_test_a1WjqQCHml…`, $54.40, offer event `d8cb3464…`) completes and `handover_redeemed` is recorded; quoting again: 10 %, $57.60. His new subscription is personal (`household_id` NULL).
- Events: created, member_added, link_created, link_accepted, member_claimed (Tom, Ella), member_left (Ella), admin_transferred, subscription_cancelled_on_leave, handover_offered, member_left (Dana), handover_redeemed. Subscription events: started, canceled.

## Deploy (2026-11-07)

- Commit `0be5f21` pushed; Deploy run `42444016096` green (backend + frontend); revision `axis-bloom-backend-00844-6g5`.
- Startup log: `DB schema verified`, `[db-comments] applied 1762 statements`, 0 ERROR lines; the same pre-existing findings (quiz-integrity #10 = OT-33, sommelier-integrity #3, evidence-integrity #2 and #6, data-catalog #6); data-catalog #4 reported `CATALOG.md` stale as expected, regenerated from prod (168 tables, 86 views, 1,508 columns, hash `6704cc35…`) and committed with this report.
- Production, read-only after the deploy: `subscription_item` CHECKs are `subscription_item_quantity_check` and `subscription_item_what_ships`; household "Bars-checout1-test": pays Dana-Admin (no house subscription yet), 2 active members, 1 proxy quiz; members Dana-Admin (login, own quiz, earthy, dial slot 15) and camila (managed, quiz by Dana-Admin, fruity, dial slot 7), neither in a house subscription nor on an own plan; numbers: 1 household, 2 members, 1 proxy quiz, 1 managed profile, 0 claims, 0 house orders; `house_box_weight_oz` 12.
- **Before Part E (read-only resolution on prod):** Build the house box will give camila "Clean Fruit" (Fruity, her dial stop 1, $29.00 at 12 oz) and Dana-Admin none: Earthy has nothing sellable at 12 oz on prod (her dial slot 15 and the landing default slot 16). Dana can add any coffee for herself by hand (G2.19); it is a catalog fact, not a household rule.

## Part E — production (with Dana)

**Not run yet (STOP 2).**

## Deviations from the brief (and why)

- Decisions 1–5 (above).
- OT-108 is fixed by splitting the view (`v_household_membership` + `v_household_member`), not by splitting `mine`; the household views moved after the subscription tables (boot order).
- `v_customer_bag_attribution` reads `buyer` for a line whose recipient is the buyer (D24's codes, with every line carrying a recipient).
- `house_box_weight_oz` added to `household_parameter` (the box needs a size; nothing typed in).
- Decision 1 applies to drinker reasons only; a subscriber's own unsellable bag still stops the renewal as before (OT-111).
- Local acceptance replays the paid webhook in process (card entry is Dana's); production Part E pays with the test card.

## Open tasks

OT-103 and OT-108 done. Added: OT-110 (integrity check 12 vs an Undo onto "no position"), OT-111 (decision 1 covers drinker reasons only).
