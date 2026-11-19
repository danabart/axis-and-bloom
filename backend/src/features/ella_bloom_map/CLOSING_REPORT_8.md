# Closing report: Ella's Bloom Map 8, prices and every map coffee buyable

**Status 2026-11-18: Parts A to D built and accepted on the test DB. STOPPED at the Part E STOP, before any production write.** Nothing committed, pushed or written to production. The production dry run is below.

Guardrails read before Task 0. `DEVELOPMENT_GUARDRAILS.md` changed since brief 7 in one place: G2.9 (amended 2026-11-18, Commerce 5) now sets `created_at`/`updated_at` defaults to `now()`. `coffee_sku` still defaults to `timezone('utc', now())`. This brief creates SKU rows but does not alter that table's defaults.

## Dana's answers (2026-11-18)

1. The Village is **$32.00** at 12 oz, like Tiger Stripe. The price check (integrity check 15) compares against the slot a coffee actually wins (`v_coffee_sellable_slot`), not its home slot.
2. Names **(a)**: map lines carry the map's name (short name, else the coffee's name) in the cart, Stripe, the order email and ShipStation.
3. The price list as proposed. No slot price changes; slot 8 stays without a 12 oz price.
4. 2 lb and 5 lb switched off through `catalogService.setSizeActive`; the size check added to the direct cart path.
5. `coffees.short_name` built, with the seven names in Data 2.
6. No Stripe test key: checkout accepted with Stripe stubbed against the test DB.

## What was built (uncommitted until Part E)

- **Schema** (`schema.sql`, `comments.sql`):
  - `coffees.short_name` (nullable, check `coffees_short_name_not_blank`), and `v_coffee.short_name`.
  - `v_dial_coffee_availability` at coffee grain. Sellable means an active coffee, an active SKU at the active anchor size, and a `coffee_retail_price` row at that size. Decaf and half-caf are no longer excluded.
  - The view also carries `weight_oz`, `size_label`, `sku_id`, `price_cents`, `has_sku`, `has_price` and `map_name`.
  - Copy rows `add_first_bag` and `added_to_cart`.
  - Comments: view columns are described in the view's comment (comments decision 4: view columns carry no comment of their own). `coffee_size` gains the writer `catalogService.setSizeActive`.
- **Backend:**
  - `catalogService.setSizeActive(InTx)` (the anchor cannot be switched off; a catalog change row; the size cache cleared).
  - `setCoffeeRetailPriceInTx` split out, and `updateCoffee` takes `shortName` (trimmed, not blank, 40 characters at most, no roaster name).
  - `blendResolver.resolveCoffeeBlend` refuses a switched-off size.
  - `cartResolver.directDisplay` gives a coffee on the active map its map name. Dial lines keep the house name.
  - Integrity check 15 (`checkSlotRetailPriceAgree`, info).
  - `dialReads.mapCoffees`/`mapName`, and `decidedMap.availability`.
  - `matchService` step cards carry the price with weight, `familyLabel` and the map name. The notes are the roaster's words, else the signature descriptors.
- **Frontend:**
  - `/map`: price chip; "Add my first bag to the cart"; a step choice records the step, then adds the bag; "In your cart.".
  - The trail face draws quiet dots and no dashes (`quietOthers`).
  - `/admin/map` coffee card: the price, "Buyable" or what is missing, and the name it is shown as.
- **Seed** `backend/src/scripts/ellaMapPrices_2026_11_18.ts`:
  - `--dry-run` (the default) plans in a `READ ONLY` transaction; `--apply` writes in one transaction through the catalog writers.
  - `--expect-db` must match the database it reaches.
- **Tests:**
  - `dialMap8.test.ts` (8 cases) and the `cartResolver.test.ts` map-name case.
  - Suites that test the switched-off sizes switch them on for the run through `setSizeActive` (`src/test/allSizesOn.ts`): `catalogSizes`, `catalogImport`, `admin.catalog`, and `catalogService`'s 5 lb SKU code case.
  - The `dialMap` fixture now gives its coffees a `coffee_retail_price` row.
  - `dialMap7` reads step names as map names, and step cards include `familyLabel`.

## Evidence on the test DB

- **Seed:** 33 writes (6 SKUs, 18 retail prices, 7 short names, 2 sizes off). The rerun wrote 0 (45 unchanged). All 18 map coffees are buyable, and check 15 is clean.
- **Edges:** 306 on the test DB (18 sellable coffees), against 42 on production today (7). See OT-160.
- **Full backend suite:**
  - The run also picked up an old ignored `dist/` build from 2026-10-04 (69 stale compiled failures); I left it alone.
  - In `src/`: 52 failures in the full run. The brief 8 ones were fixed (`comments.format` 1, `catalogSizes` 8, `catalogImport` 4, `admin.catalog` 1, `catalogService` SKU code 1, `dialMap` 4, `dialMap7` 1), and the fixed files then pass 112 of 112, apart from the D5 baseline.
  - `palateReads` (15) and `quizResultsView` (2) timed out under the full run and pass alone (99 of 99).
  - The rest is the known OT-140 baseline: `evidenceViews` 7, `evidenceAdmin` 4, `quizScoring` 6, `sommelierRag` 2, `sommelierEval` 2, `sommelierAnswer` 1, `catalogService` D5 1, `schema.catalog_blueprint` 1, `qrDoor`.
- **Typecheck and lints:** backend `tsc --noEmit` exits 0, and all six lints exit 0 (catalog, lineage, customer, retention, roastery-portal, cupping). Frontend tsc: 7 errors, all in files this brief does not touch.
- **Browser** (`tmp/em8_ui.mjs`, two marked Zzz test admins, local Vite on the test-DB backend; screenshots `map8_*.png` in this folder):
  - No page errors, and no roaster name on the page.
  - Balanced starts at Benchmark: "Cocoa, Spice, Caramel" (the roaster's words), "$29.00 · 12 oz", "Add my first bag to the cart", then "In your cart.".
  - The steps The Daily, La Familia and Fabricator are each $29.00. Choosing Bolder moves the dot to The Daily and adds it.
  - The cart shows "Benchmark" and "The Daily" at $29.00 each, $58.00 in total.
  - La Familia's step The Village shows "$32.00 · 12 oz". The trail has no dashed dots.
  - Admin cards read "$32.00 · 12 oz Buyable Shown as Tiger Stripe" and "Half Moon … Shown as Half Moon".
  - The Bloom page shows no 2 lb or 5 lb. A 2 lb quote returns 409 `unavailable`; a 12 oz quote returns 200 at 2900.
- **Checkout with Stripe stubbed** (`tmp/em8_checkout.accept.ts.txt`, run once by path, then renamed out of the suite):
  - The Daily, Brazil and Nightcap Decaf: one line each at $29.00 under the map name, no failed step, the manual request, and a confirmation email with no roaster name.
  - Brazil's ShipStation preview item is `AB-0041` "Brazil".
  - The mixed cart (La Familia, The Village, Tiger Stripe) shows $29, $32 and $32 under the map names, and one request per roaster (Joe Coffee, Joe Bean). Tiger Stripe's ShipStation item is "Tiger Stripe".
- **`dial_surface`:** all 7 rows on both databases are unchanged (`model_id` 1, last changed 2026-11-12).
- **Zzz test admins** `balanced` and `lafamilia`: demoted in the test DB and disabled in Firebase; their token files are deleted. Their test orders stay in the test DB as evidence.

## Deviations and findings

- **The test DB never got Commerce 6's roaster-SKU mint**, so the first mixed checkout stopped at "No roaster SKU for Tiger Stripe Espresso" (ShipStation's guard). Production has a code on every active 12 oz SKU (AB-0001 to AB-0015), and the seed mints codes for the three SKUs it creates.
  - I replayed the mint on the test DB only (`tmp/em8_mint_test.ts`, actor `claude:ella-map-8-test-replay`, 12 codes AB-0120 to AB-0131). The mixed cart then passed.
- **ShipStation itself was not exercised.** The test DB runs it as manual (`shipstation_enabled` 0). The acceptance builds the ShipStation payload with `buildShipStationOrder` and checks it.
- **Comments:** the first draft gave `v_dial_coffee_availability` per-column comments, which `comments.format` rejects for views. They were moved into the view's comment.

## Part E: the production dry run (read-only, 2026-11-19T02:47Z UTC, `--expect-db axisandbloom`)

**30 write, 15 unchanged, 0 missing.** Same result as the first dry run.
- **SKUs to create (3, 12 oz, Joe Coffee Company, code minted, no cost; OT-158):** Great Heights, Half Moon (Half Caff), The Waverly. The other 15 SKUs are unchanged (AB-0001 to AB-0015).
- **Retail prices (18, none today):** $29.00 for 16 coffees; **$32.00 for Tiger Stripe Espresso and The Village.**
- **Slot prices:** none change. Every slot a map coffee wins at 12 oz is already at its retail price, so check 15 is clean.
- **Short names (7):** Fabricator, Tiger Stripe, Blossom, Geometric, La Familia, Cafè Feminista, Half Moon.
- **Sizes:** 2 lb on → off, 5 lb on → off. Nothing live is on either size.

**After Dana's yes:**
1. Commit by path (never `commerce/CLOSING_REPORT_6.md`, the genova fonts or the untracked misc files), then push (= deploy).
2. Check the startup log.
3. Run `ellaMapPrices_2026_11_18.ts --apply --expect-db axisandbloom` and read it back.
4. Run `npm run catalog:md -- --expect-db axisandbloom` and commit `CATALOG.md`.

## Task 0 questions (answered above)

1. **The Village has no price of its own, and the price it borrows is $29.00 (STOP item, Data 1).**
   - The Village has no `coffee_retail_price` row. Its only price is its home slot's: slot 7 "Clean Fruit" at $29.00 (2900 cents).
   - It is the second coffee on that slot (priority 2). Cafè Feminista wins the slot, so The Village cannot be bought today.
   - **Tiger Stripe is $32.00** (slot 23 "Coado", set by you on 2026-10-22). The two differ, and The Village is not above $29.
   - Choose The Village's 12 oz price: **$29.00** (like the rest), **$32.00** (like Tiger Stripe), or **$34.00**.
   - If it is above $29, the brief's price check (A3: home-slot price against retail price) would flag The Village for as long as it sits second on slot 7. I'd compare the price of the slot the coffee actually wins (`v_coffee_sellable_slot`), not its home slot. Then The Village is not checked against Clean Fruit, and Tiger Stripe is checked against Coado.
2. **The cart and the order email name eight coffees by their slot's house name, not the name `/map` shows (STOP item, item 4).**
   - `directDisplay` returns the home slot's name when there is one. The Village and Cafè Feminista would both reach the cart as **"Clean Fruit"**.
   - Choose:
     - **(a)** Map lines carry the map's name (the short name, else the coffee's name) in the cart, Stripe, the order email and ShipStation. I recommend this: one coffee, one name, and no two coffees share one.
     - **(b)** Keep the house names, as the old Bloom page does.
   - (a) is a branch in `directDisplay` used only for direct lines (B2), with a test. On production the direct path is used today only by four inactive Path coffees and one cancelled subscription, so nothing live changes name.
3. **The price list: is the proposal below right?**
   - Every slot that a map coffee wins at 12 oz is already $29.00, except Coado (Tiger Stripe, $32.00). **No slot price changes.**
   - **Geometric's slot 8 "Bright & Tart" has no 12 oz price**, so Geometric is not on the old Bloom page today. I propose leaving it so: Geometric is bought from `/map` at its retail price. Adding a slot price would also put it on the old Bloom page, which the brief keeps as it is.
4. **Switch 2 lb and 5 lb off?** Nothing on production is on either size (item 3). I recommend yes, through a new `catalogService.setSizeActive`.
   - The direct cart path does not read `coffee_size.is_active` today. I'd add that check to `resolveCoffeeBlend` (B2), so a switched-off size is refused by the cart as the brief's test expects.
5. **Short names (Data 2): build `coffees.short_name`?** No short customer name exists anywhere (item 8a). I recommend building it with the seven names in Data 2.
6. **Stripe test key for the local acceptance.**
   - `backend/.env` holds no `STRIPE_SECRET_KEY`, so Stripe is `disabled` locally, and the test key in Secret Manager (v1) is disabled.
   - Without a test key I would accept checkout by calling `finalizePaidOrder` against the test DB with a stubbed Stripe, the way the vitest suite does. With a test key in `.env` I would run a real Stripe test-mode checkout.
   - I will not put any key in place myself.

## The price table (items 1 and 2)

Production.
- **Slot price:** the 12 oz price of the coffee's home slot.
- **Retail price:** `coffee_retail_price` at 12 oz.
- **Buyable direct:** whether `resolveCart`'s `coffeeId` branch accepts the coffee at 12 oz today.

None of the 18 has a retail price row, so **none is buyable as a direct line today**. Seven are sellable through a slot.

| Coffee (id) | Roaster | Category | Home slot | Active SKUs | Slot price | Retail price | Buyable direct | Map sellable | **After** (retail 12 oz) |
|---|---|---|---|---|---|---|---|---|---|
| Benchmark (2905) | Joe Coffee | | 4 Classic Balanced | 12 oz AB-0003 | $29.00 (5 lb $185) | none | no | yes | $29.00 |
| Cafè Feminista: Montze Olvera (2902) | Joe Coffee | | 7 Clean Fruit (p1, wins) | 12 oz AB-0007 | $29.00 (5 lb $185) | none | no | yes | $29.00 |
| Colombia La Familia Guarnizo (2903) | Joe Coffee | | 11 Light Floral Edge | 12 oz AB-0005 | $29.00 (5 lb $185) | none | no | yes | $29.00 |
| The Village (2904) | Joe Coffee | | 7 Clean Fruit (p2, outranked) | 12 oz AB-0006 | $29.00 (borrowed) | none | no | yes (candidate) | **Q1** |
| Amsterdam (2906) | Joe Coffee | | none | 12 oz AB-0001 | none | none | no | no | $29.00 |
| Big City (2908) | Joe Coffee | | none | 12 oz AB-0002 | none | none | no | no | $29.00 |
| The Daily (2907) | Joe Coffee | | none | 12 oz AB-0008 | none | none | no | no | $29.00 |
| Nightcap Decaf (2909) | Joe Coffee | decaf | none | 12 oz AB-0004 | none | none | no | no | $29.00 |
| Great Heights (2938) | Joe Coffee | | none | **none** | none | none | no | no | $29.00 + new SKU |
| Half Moon (Half Caff) (2937) | Joe Coffee | half_caf | none | **none** | none | none | no | no | $29.00 + new SKU |
| The Waverly (2936) | Joe Coffee | | none | **none** | none | none | no | no | $29.00 + new SKU |
| Fabricator House Roast (2917) | Joe Bean | | 24 Quieta Non Movere | 12 oz AB-0009 | $29.00 | none | no | yes | $29.00 |
| Tiger Stripe Espresso (2914) | Joe Bean | | 23 Coado | 12 oz AB-0012 | **$32.00** (5 lb $185) | none | no | yes | **$32.00** (copied) |
| Blossom Dark Roast (2916) | Joe Bean | | 1 There's No Place Like Home | 12 oz AB-0011 | $29.00 (5 lb $185) | none | no | yes | $29.00 |
| Geometric Filter Coffee (2915) | Joe Bean | | 8 Bright & Tart | 12 oz AB-0010 | **none** (5 lb $185) | none | no | no | $29.00 |
| Brazil (2939) | Joe Bean | | none | 12 oz AB-0013 | none | none | no | no | $29.00 |
| Indonesia (2940) | Joe Bean | | none | 12 oz AB-0014 | none | none | no | no | $29.00 |
| D.R. Congo (2941) | Joe Bean | | none | 12 oz AB-0015 | none | none | no | no | $29.00 |

- **Writes on production:**
  - 18 `coffee_retail_price` rows at 12 oz (16 at $29.00, Tiger Stripe at $32.00, The Village per Q1).
  - **3 new 12 oz SKUs** (Great Heights, Half Moon, The Waverly; all Joe Coffee, cost NULL, codes minted).
  - **0 slot price changes** (Q3).
- **Every SKU:** all 15 existing SKUs are 12 oz, active, with no cost and a minted `AB-` code. No coffee holds an active SKU at 2 lb or 5 lb.
- **The test DB differs:**
  - Brazil, Indonesia, D.R. Congo, Great Heights and Half Moon have **other ids there** (4299 to 4303).
  - Brazil, Indonesia and D.R. Congo have **no SKU there** (Commerce 6 made them on production only).
  - No test-DB SKU has a code.
  - So the seed finds coffees by name, never by id, and on the test DB creates 6 SKUs, not 3.

**Every other price on production** (not for these 18): "all prices" would not cover these, and the proposal leaves every one alone.

| Row | Price | Who sells at it today |
|---|---|---|
| Slot 2 Working Late Hours, 12 oz | $32.00 | nobody (no coffee on the slot) |
| Slot 5 Bright & Balanced, 12 oz | $32.00 | nobody |
| Slot 6 Lively & Vivid, 12 oz | $32.00 | nobody |
| Slot 20 The Unexpected, 12 oz | $32.00 | nobody |
| 5 lb at $185.00 on 16 slots (1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 16, 17, 18, 20, 23) | $185.00 | nobody (no 5 lb SKU is active) |
| `coffee_retail_price` for 4 Path coffees (Sleepwalker Half-Caf, Decaf, Hazelnut, Chocolate; all inactive): 12 oz | $32.00 | nobody (coffees inactive) |
| The same 4 Path coffees: 5 lb | $185.00 | nobody (coffees inactive) |
| Slots 9, 13, 14, 15, 19, 21, 22 | no price | nobody |

Utopian: 10 coffees, all inactive, no slots, no price rows; untouched. No price exists anywhere at 2 lb.

## The name table (item 4)

- **`/map` name:** `v_dial_placement.coffee_name`, which is `coffees.name`.
- **Cart, Stripe, order email name:** `directDisplay(coffeeId)`, which is the home slot's name, else `coffees.name`. ShipStation takes the same `display_name` as the item name.
- **Bag QR page name:** `resolveQrDisplayName`, which is the slot alias, else the family label (never `coffees.name`).

| Coffee | `/map` shows | Cart and email would show | Bag QR page shows | Differ |
|---|---|---|---|---|
| Benchmark | Benchmark | **Classic Balanced** | Classic Balanced | **yes** |
| Cafè Feminista: Montze Olvera | Cafè Feminista: Montze Olvera | **Clean Fruit** | Clean Fruit | **yes** |
| The Village | The Village | **Clean Fruit** (same as Cafè Feminista) | family label | **yes** |
| Colombia La Familia Guarnizo | Colombia La Familia Guarnizo | **Light Floral Edge** | Light Floral Edge | **yes** |
| Fabricator House Roast | Fabricator House Roast | **Quieta Non Movere** | Quieta Non Movere | **yes** |
| Tiger Stripe Espresso | Tiger Stripe Espresso | **Coado** | Coado | **yes** |
| Blossom Dark Roast | Blossom Dark Roast | **There's No Place Like Home** | There's No Place Like Home | **yes** |
| Geometric Filter Coffee | Geometric Filter Coffee | **Bright & Tart** | Bright & Tart | **yes** |
| Amsterdam, Big City, The Daily, Nightcap Decaf, Great Heights, Half Moon (Half Caff), The Waverly, Brazil, Indonesia, D.R. Congo | the coffee's name | the same name | the family label ("Balanced", "Fruity" ...) | no (QR differs) |

**8 of 18 differ**, and two different coffees would share "Clean Fruit". See Q2.

- With (a), the bag QR page still shows the slot alias or the family label. Renaming it is out of this brief's scope; I'd open a task for it.
- The 10 unslotted coffees reach the cart under `coffees.name`, the roaster's own coffee name. No roaster (company) name is in any of them (G4.5 holds). Website 4's OT-70 rule was "never the raw `coffees.name`" for the Shop; the map uses it by design.

## Anything on production already on 2 lb or 5 lb

Nothing live.
- Checkout session lines: 7, all 12 oz.
- Order lines: 7, all 12 oz.
- Subscription items: 3, all 12 oz, all cancelled.
- Open checkout sessions: 0.
- Carts: the cart is client-side only (`CartContext`, browser storage); there is no server cart to count.
- Active SKUs at 2 lb or 5 lb: 0. There are 27 inactive ones (26 at 5 lb, 1 at 2 lb).
- Price rows: 16 slot prices at 5 lb, and 4 at 5 lb for the inactive Path coffees. None at 2 lb.

---

## Task 0 findings

### 1. The 18 coffees

See the price table.
- `v_dial_placement` holds exactly 18 coffees on both databases, all active.
- Categories: only Nightcap Decaf (decaf) and Half Moon (half_caf) carry one.
- `v_dial_coffee_availability.is_sellable` is true for 7 coffees: the 6 slot winners, plus The Village, because a candidate row counts even when outranked.
- `in_stock` is false for Great Heights, Half Moon and The Waverly on production; the test DB adds Brazil, Indonesia and D.R. Congo.

### 2. Other prices

See the second table.
- **Proposal:** the 12 oz slot prices that non-premium map coffees win are 24, 1, 4, 7 and 11. All are already $29.00, so nothing changes. Coado stays at $32.00 for Tiger Stripe. Slot 8 has none and stays so (Q3).
- **Left alone:** slots 2, 5, 6 and 20 at $32.00, every 5 lb price, and the Path rows.

### 3. Sizes

`coffee_size` on both DBs: 12 oz (anchor), 2 lb (32) and 5 lb (80), all active.
- **Who reads `is_active`:** `catalogReads.getSizes` (the only query, cached 60 s), and three views:
  - `v_coffee_sellable_candidate`, `sz.is_active`;
  - the anchor read of `v_dial_coffee_availability` (anchor only);
  - a view at schema.sql:7609 (`is_anchor AND is_active`).
- **Old Bloom page and Shop:** price buttons render active sizes from slot candidates. No 2 lb or 5 lb SKU is active, so customers see only 12 oz today. Switching the sizes off removes nothing a customer sees.
- **Cart:**
  - **Dial lines:** `resolveBlendForSlot` uses the candidate view, so they are refused at a switched-off size ("unavailable").
  - **Direct lines:** `resolveCoffeeBlend` does **not** read `coffee_size`. A 2 lb direct line is refused today only because no 2 lb SKU or price exists. I'd add the size check there (Q4).
  - **Collections:** they use the anchor, so they are unaffected.
- **`resolveBlendForSlot` fallback:** it tries active sizes only, anchor first, so it simply stops trying 2 lb and 5 lb.
- **Subscriptions and renewals:** every item is 12 oz. Renewal goes through `resolveBlendForSlot` / `resolveCoffeeBlend` at the item's weight, so it is unaffected.
- **Admin:**
  - Supply's price inputs and SKU selects (GET `/catalog/sizes`) lose the 2 lb and 5 lb columns. The rows stay in the database.
  - Inventory labels the 27 inactive SKUs "80 oz"/"32 oz" instead of "5 lb"/"2 lb" (its fallback).
  - `assertKnownSize` then refuses a new SKU or price at those sizes (400 `UNKNOWN_SIZE`), as does the catalog importer.
  - Liam's catalog block (`sommelierRag` reads `getSizes`) stops listing them.
- **Integrity checks:** check 14 is still clean (one active anchor; every weight is still a `coffee_size` row).
- **The right door:** yes, `catalogService.setSizeActive(weightOz, active)`. It refuses the anchor, logs `catalog_change`, clears the size cache, and is declared beside `seed` as `coffee_size`'s writer.

### 4. The direct line end to end (coffee with no slot)

The path is `resolveCart` → `checkoutService` → `finalizePaidOrder` → fulfillment → emails → `v_order_reportable`.

- **`resolveCart`:** the `coffeeId` branch needs an active SKU at the weight, an active coffee and a `coffee_retail_price` row, and refuses a stale client price (409). There is no slot assumption, but the name and size questions are Q2 and Q4.
- **The line:** carries `archetypeLabel` from the coffee's match family (fine), with `source` 'direct'.
- **`checkoutService`:** stores `display_name` per line and sends it to Stripe as the product name, with the description "12 oz · Family". No slot assumption.
- **`finalizePaidOrder`:** writes `order_line_item` with `display_name` and `weight_oz`. No slot assumption.
- **Subscriptions:** `createPaidSubscriptionFromCheckout` stores a direct line as `signup_coffee_id` with no archetype. Renewal (`subscriptionShipment.resolveItem`) re-resolves it through `resolveCoffeeBlend` plus `retailPriceCents` plus `directDisplay`. It works for a slotless coffee.
- **Emails:** they read the line's `display_name`. `householdEmails` reads `directDisplay` for the family only.
- **`v_order_reportable`:** it is mode and status based, not slot based.
- **Bag QR story:** it names by alias or family label (see the name table). That is a third name, but not an error.

### 5. Fulfillment

- **Production:** `shipstation_enabled` = 1. One active config: Joe Bean, `shipstation`, tag `roaster:joe-bean`. Joe Coffee has no config row.
- **How requests are made:** `createRequestsForOrder` groups lines by roaster (one request per roaster, in sequence).
  - A Joe Bean line goes to ShipStation, with the item sku set to `roaster_sku`. A missing code becomes "needs attention", not an error; all Joe Bean SKUs have codes.
  - A Joe Coffee line goes to `manual` (`awaiting_manual`, the manual fulfillment email). The three new Joe Coffee SKUs need no code for that path, but get one minted anyway.
- **A mixed cart:** two requests, each with its own lines. Neither path errors.
- **Test DB:** `shipstation_enabled` = 0 and no config rows, so every request there is manual. Acceptance shows the ShipStation adapter being *chosen* only if a test config is set; I would not turn ShipStation on in the test DB without your say.

### 6. Live safety

- **How live and test stay apart:** the Stripe mode comes from the key (`stripeMode()`: `sk_live_` is live, any other key is test, no key is disabled). Production runs the live key from Secret Manager. Each order and session records `stripe_mode` (`commerce_stripe_mode`: test false, live true for reporting).
- **The live gate:** `applyLiveGateOverride` is off on production (`live_gate_override_cents` 0, email empty).
- **This brief cannot create a live charge:**
  - Locally there is no Stripe key at all (Q6), and the test DB is used.
  - On production, Part E writes catalog rows only, and no checkout is exercised.
- **Who can reach checkout on production today:**
  - `POST /api/checkout/session` requires a signed-in, non-anonymous account. Nothing else gates the API.
  - The `/cart` page sits behind the pre-launch curtain, which `?preview=true` lifts for the browser session.
  - So any signed-in account that calls the API, or uses the preview bypass, can pay live today for the 6 slot coffees. There is 1 live order (Quieta Non Movere).
  - **After Part E, the same holds for all 18 coffees.** That is the brief's goal, but it widens what a live charge can buy before launch.

### 7. Readers of `v_dial_coffee_availability`

When the rule moves to "coffee, SKU and price":
- **`v_dial_placement_input`** (11138): carries `is_sellable` and `in_stock` into the placement rules and the preview's `not sellable` reading. More coffees read as sellable; `is_sellable_at_cut` on existing cuts is stored and does not change.
- **`v_dial_placement`** (11328) and **`v_dial_placement_preview`**: `is_sellable` and `in_stock`. They feed the admin face's dashed "not sellable" dot, `/admin/map/advanced`'s sellable filter and reachability graph, and `dialReads` start points (center and sellable).
- **`dial_edge_core`** (11394): **edges are built only from and to sellable coffees.** Today the edge set covers 7 coffees; after the change it covers the buyable 18.
  - This changes the computed hops `me()` ranks, and `decide`'s bolder, gentler and different moves (`matchService` lines 210 and 408).
  - The published steps on `/map` (`v_dial_step`, from `dial_step` rows) do not change.
  - I'll put the edge counts before and after into the test-DB run.
- **`v_customer_match_current`** (11828): `is_sellable` and `in_stock` of the customer's current coffee.
- **The match's in-stock check** (`matchService.firstMatchFor`): it reads `in_stock`, not `is_sellable`, so it is unchanged. The three SKU-less coffees become in stock when their SKU is made.
- **Decaf:** decaf and half-caf stop being excluded (OT-126 closed for the map). The match's decaf filter (`passesTagFilter`) is untouched.
- **`v_coffee_sellable_candidate`:** no longer read by the map. The old Bloom page, `v_coffee_sellable_slot` and `v_coffee_visibility` keep it.

### 8. The three page fixes

- **(a) Short name:**
  - None exists. `coffees` has no such column. `coffee_category_assignment.customer_name` is empty for both category map coffees, and slot names are house names (Q2).
  - `/map` uses `coffees.name` (through `v_dial_placement.coffee_name` and `v_dial_step`).
- **(b) The notes line:**
  - It comes from `coffeeCardReads.getCardPresentations` → `getCustomerDescriptors` → `signatureWords`: the signature rows of the cupping customer descriptors (flavor-wheel terms, such as "Caramelized, Cocoa").
  - `coffees.flavor_descriptors_roaster` holds the roaster's words for **14 of 18**, each as one comma string inside a JSON array, for example `["Cocoa, Spice, Caramel"]` for Benchmark.
  - Empty (`[]`) for **Big City, Geometric, Nightcap Decaf and The Daily**, so those four fall back to today's source.
- **(c) The trail dashes:**
  - `MapTrail` draws `EllaMapFace` with the default `dotStyle='sellable'` and without `quietOthers`, so every coffee with `is_sellable` false is drawn dashed.
  - That is 11 of 18 today. `/map` passes `quietOthers`, which is why it shows no dashes.
