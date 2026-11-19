# Claude Code brief. Ella's Bloom Map 8: prices, and every map coffee buyable

Workstream: ella_bloom_map (`README.md` here; `CLOSING_REPORT_5.md` to `_7.md` for the map as built; `backend/src/features/commerce/README.md` and its closing reports 4 to 6 for commerce as it stands) · Written 2026-11-18 by the CTO session · **Model: the strongest model, in a dedicated session (G1.13: this brief touches money, and Stripe is live since 2026-11-17).** · Dana runs it; push = deploy · Acceptance in **test mode on the test DB**. No live charge is made by this brief.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every price is a pricing-table row; no price, size or coffee id in code) · G2.5 one writer per table (`catalogService` for prices, SKUs and sizes; declared in `comments.sql`) · G2.6 one door for a write (`resolveCart`, `finalizePaidOrder`, `catalogService.upsertSku`) · G2.11 retire, never delete (a size is switched off, not removed) · G2.14 a fact lives once (see the price rule below) · G2.16 prices come from our pricing tables; Stripe never holds one · G2.17 `comments.sql` then `catalog:md` · G3.9 reuse, do not fork · G4.1 reuse `useCart` / `CartContext` · G4.2 nothing typed in · G4.5 customers never see a roaster name · G4.6 `/map` stays behind the pre-launch gate and the admin route · G5.1 vitest · G5.2 acceptance in test mode · G1.6 push is deploy, one closing report · G1.9 one execution at a time: add files by path only; `commerce/CLOSING_REPORT_6.md` and the genova font deletions in the tree are not yours.
Mode: test. STOP points: after Task 0; before any production data write (Part E).

**Goal.** The decided map holds 18 coffees and the customer page `/map` (admin-only) shows a first bag and its steps, but most of those coffees cannot be bought: today a coffee is sellable only through a lane-dial slot. This brief makes every map coffee buyable by coffee, at one price list, and connects `/map` to the cart. It also fixes three small things on the page.

**Decisions already made (Dana, 2026-11-16 to 2026-11-18; do not re-open).**

1. **12 oz is $29.00 for every coffee, except Tiger Stripe and The Village, which keep the higher price they have today** (Dana recalls 32 or 34; Task 0 reads it). They are the premium ones.
2. **2 lb and 5 lb are not available for now.** Switched off, kept in the database.
3. **All 18 map coffees are buyable**, both roasters, including decaf and half-caf and the coffees that were marked not sold. Joe Coffee is not on ShipStation yet (Dana connects it next week); its orders go by the manual fulfillment email, as before ShipStation.
4. The customer Bloom page, the lane dial and every `dial_surface` row stay as they are. The switch is brief 4.
5. Utopian stays paused and untouched.

CTO calls, reversible, flag if the code disagrees:

- **A map coffee is bought as a direct line by coffee id**, the path category coffees already use (`resolveCart`'s `coffeeId` branch: an active SKU at the weight through `resolveCoffeeBlend`, and a `coffee_retail_price` row). No new purchase path, no new price table.
- **Price rule (G2.14).** `coffee_retail_price` is the price of a coffee on the map. A coffee that also wins a lane-dial slot keeps its `coffee_slot_price` for the old page until brief 4 retires slots. This brief sets both to the same number and adds a boot integrity check (report only, G2.18) that lists any coffee whose home-slot price and retail price differ at the same size.
- **The map's availability rule moves to the coffee:** sellable means an active coffee, an active SKU at the anchor size, and a `coffee_retail_price` row at that size. Category (decaf, half-caf) no longer excludes a coffee. This closes OT-126 for the map; the match's decaf filter stays as it is.
- **"Make it my next bag" and the first-bag button add the bag to the cart** (one bag, anchor size, through `useCart`, as a direct line) and record the choice as today. The cart's own subscribe choice applies unchanged.
- **A new SKU carries no cost** (`cost_to_us` NULL, as Commerce 6 did for the Joe Bean singles) and gets its code minted by `upsertSku`.

---

## Task 0: Verify (write into `CLOSING_REPORT_8.md`; STOP after)

Read-only, test DB and production.

1. **The 18 coffees** (ids in `CLOSING_REPORT_5.md` and `_6.md`): for each, the roaster, categories, home slot if any, every active SKU by size with its `roaster_sku`, the current `coffee_slot_price` of its home slot by size, the current `coffee_retail_price` by size, and whether `resolveCart` would accept it today as a direct line at 12 oz. Give Tiger Stripe's and The Village's current 12 oz price, and say plainly if the two differ or if either is not above $29.
2. **Every other price on production:** all `coffee_slot_price` and `coffee_retail_price` rows that are not for these 18 (other slots, Utopian), so Dana sees what "all prices" would and would not cover. Propose: every 12 oz slot price that a non-premium map coffee wins goes to $29; slots no map coffee wins are left alone and listed.
3. **Sizes:** `coffee_size` rows, who reads `is_active`, and what switching 32 oz and 80 oz off does to: the old Bloom page and Shop, the cart, `resolveBlendForSlot`, subscriptions and renewals, admin Supply and Inventory, integrity checks. Count carts, open checkout sessions, subscriptions and paid orders on those two sizes on production (expect none live). `coffee_size`'s only writer is `seed`: say whether a `catalogService.setSizeActive` is the right door.
4. **The direct line end to end:** `resolveCart` → `checkoutService` → `finalizePaidOrder` → fulfillment → emails → `v_order_reportable`, for a coffee with no slot. Name anything on that path that assumes a slot or a category name (display name, archetype label, the order email, the bag QR story, the subscription renewal). **What does `directDisplay` call a slotted coffee: the slot's house name or the coffee's name?** List, for the 18, the name `/map` shows today beside the name the cart and the order email would show. If they differ for any coffee, that is a STOP item.
5. **Fulfillment:** with `roastery_fulfillment_config` as it stands, what happens to a paid order line for a Joe Bean coffee (ShipStation) and for a Joe Coffee coffee (expect the manual email). Confirm neither errors, and that a mixed cart splits correctly.
6. **Live safety:** how test and live Stripe modes are kept apart now (`commerce_stripe_mode`, `applyLiveGateOverride`, the pre-launch gate), and confirm that nothing in this brief can create a live charge. Say who can reach checkout on production today.
7. **Readers of `v_dial_coffee_availability`** and of `v_coffee_sellable_candidate` through it: what changes for each when the map's rule moves to the coffee (`v_dial_placement_input`, `v_dial_placement`, `dial_edge_core`, `v_customer_match_current`, the match's in-stock check, the admin face's "not sellable" dot).
8. **The three page fixes:** (a) is there a short customer name for a coffee anywhere (`coffee_dial_slot` names, a `coffees` column), and what does `/map` use; (b) where `/map`'s notes line comes from today (it shows flavor-wheel terms such as "Caramelized, Cocoa") and whether `coffees.flavor_descriptors_roaster` holds the roaster's own words for all 18; (c) why the trail face dashes most dots.

**STOP.** Show Dana: the price table before and after (items 1 and 2), the name table (item 4), and anything on production that already sits on 2 lb or 5 lb.

## Task 0.5: Dana's manual steps
None. Nothing is changed in the Stripe dashboard or in ShipStation.

---

## Part A: Schema (additive, idempotent; `comments.sql` for every change)

A1 **`v_dial_coffee_availability`** per the CTO call: sellable = active coffee, an active SKU at the anchor size, a `coffee_retail_price` row at the anchor size. Update its comment and the comments of its readers. It no longer reads `v_coffee_sellable_candidate`.

A2 **A short customer name**, only if Task 0 item 8a finds none: `coffees.short_name` (text, nullable; the pages fall back to the full name), written through `catalogService.updateCoffee`. No roaster name in it.

A3 **Integrity check** (boot, report only): a coffee whose home-slot price and retail price differ at the same active size.

A4 If Task 0 item 3 agrees: `catalogService.setSizeActive`, declared as `coffee_size`'s writer beside `seed`.

## Part B: Backend

B1 `matchService.me` / the map reads: each coffee carries its 12 oz price and "buyable" from the new availability view; the step and first-bag reads return what `useCart` needs for a direct line (coffee id, weight, price in cents, display name). The notes line reads the roaster's words (item 8b), falling back to today's source when a coffee has none.

B2 Nothing changes in `resolveCart`, `checkoutService`, `finalizePaidOrder` or `subscriptionService` unless Task 0 item 4 names a slot assumption on the direct path. If it does, fix it with a branch in the existing function, covered by a test, and list it under deviations.

B3 **Seed script** `backend/src/scripts/ellaMapPrices_2026_11_18.ts`, through `catalogService` only, idempotent, `--dry-run`, `--expect-db`:
- a 12 oz SKU for each of the 18 that has none (`upsertSku`, cost NULL, code minted);
- `coffee_retail_price` at 12 oz for all 18 per Data 1;
- `coffee_slot_price` at 12 oz per the proposal Dana approves at the STOP;
- short names per Data 2, if A2 is built;
- 32 oz and 80 oz switched off, if Dana approves at the STOP.
It writes no 2 lb or 5 lb price and deletes none.

## Part C: Frontend

C1 `/map`: the first-bag card and each step's open view show the price chip ("$29.00 · 12 oz") and one button that adds the bag to the cart and records the choice (CTO call). When a coffee is not buyable the button records the choice only, as today. The cart, checkout and subscribe choice are the existing components, unchanged.

C2 `/map` and the trail use the short name where one exists (map labels especially). The cart and emails keep whatever name Dana chooses at the STOP for item 4.

C3 The trail face no longer dashes a dot for sellability (after this brief every map coffee is buyable; if one is not, it is drawn as a quiet dot like on `/map`).

C4 `/admin/map`: the coffee card shows the coffee's 12 oz price and "buyable" or the one missing thing (no SKU, no price). Read only; prices are edited where they are today.

## Part D: Tests

Vitest: the availability view (buyable with SKU and price; not without either; a decaf coffee is buyable); `resolveCart` accepts a direct line for a map coffee with no slot and for one that also holds a slot, at the pricing-table price, and refuses a stale price; the price-mismatch integrity check; the seed script twice; a switched-off size is refused by the cart. `tsc --noEmit` adds no error. All lints green.

## Part E: Data

1. Test DB, test Stripe mode: run the seed, run Acceptance.
2. **STOP.** Show Dana the production dry-run: every SKU to be created, every price row before and after, the sizes to switch off. After her yes: commit and push by path, check the startup log, apply on production, read back. No checkout is exercised on production.

### Data 1: 12 oz retail price

$29.00 (2900 cents) for: Benchmark, Half Moon, The Daily, Brazil, Fabricator, Blossom, The Waverly, Nightcap Decaf, Amsterdam, Great Heights, Big City, Indonesia, Geometric, La Familia, D.R. Congo, Cafè Feminista.

Tiger Stripe and The Village: the 12 oz price each has today, unchanged, copied to `coffee_retail_price`. If Task 0 finds either at or below $29, STOP and ask.

### Data 2: short names (only if A2 is built; Dana confirms at the STOP)

Fabricator House Roast → Fabricator · Tiger Stripe Espresso → Tiger Stripe · Blossom Dark Roast → Blossom · Geometric Filter Coffee → Geometric · Colombia La Familia Guarnizo → La Familia · Cafè Feminista: Montze Olvera → Cafè Feminista · Half Moon (Half Caff) → Half Moon. The other eleven keep their name.

## Acceptance (local, signed in as admin, test DB, Stripe test mode)

- All 18 coffees are buyable on `/admin/map`; none shows a missing SKU or price.
- `/map` for a Balanced customer: Benchmark with "$29.00 · 12 oz"; the three steps each open with a price. A step to Tiger Stripe or The Village shows its higher price.
- Adding The Daily (a coffee with no slot) from `/map` puts one 12 oz line in the cart at $29.00; a test-mode checkout completes; the order has one line for the right coffee and SKU; the fulfillment path for its roaster runs (manual email for Joe Coffee); the confirmation email names the coffee and no roaster.
- The same for a Joe Bean single (Brazil) through the ShipStation path in whatever mode the test setup uses, and for Nightcap Decaf.
- A cart line at 2 lb is refused with the existing "unavailable" message; no page offers 2 lb or 5 lb.
- The old Bloom page shows $29.00 at 12 oz for the slots the proposal covers and still works end to end; every `dial_surface` row says `lane`.
- The map labels read "La Familia" and "Fabricator"; the notes line under Benchmark reads the roaster's words; the trail face has no dashed dot.
- The price-mismatch check is clean.
- Screenshots of `/map` with prices, the cart with a map line, and the admin coffee card.

## Docs and closing (G6)

`README.md` here (brief 8; next is brief 4, the switch) and one line in `commerce/README.md`; `WHAT_WE_BUILT.md`; `WHAT_WE_BUILT_DB.md`; `comments.sql` then `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md`; `REGRESSION.md` (a map coffee is bought as a direct line at `coffee_retail_price`; the map's sellable rule is coffee, SKU and price; no page offers a switched-off size; a slot price and a retail price for the same coffee agree); `OPEN_TASKS.md` (close OT-126 for the map and OT-141; Joe Coffee on ShipStation; slot prices retire with brief 4; `cost_to_us` on the new SKUs); `CLOSING_REPORT_8.md`.

## Do not

- Do not make, attempt or simulate a live charge, and do not touch Stripe keys, the Stripe dashboard, webhooks or ShipStation settings.
- Do not put a price, a size or a coffee id in code or in a view body.
- Do not delete a price row, a SKU or a size.
- Do not change the customer Bloom page's layout, the lane dial, slots, slot assignments or any `dial_surface` row.
- Do not fork `resolveCart`, `finalizePaidOrder` or the subscription code.
- Do not show a roaster name to a customer.
- Do not touch Utopian's coffees, SKUs or prices.
- Do not write production before the STOP in Part E.
