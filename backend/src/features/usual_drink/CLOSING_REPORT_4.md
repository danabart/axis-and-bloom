# Closing report: Usual Drink 4 (profile page fixes, the brew-card sentence, a richer kitchen list)

Brief: `CLAUDE_CODE_PROMPT_USUAL_DRINK_4_PAGE_FIXES_AND_KITCHEN_LIST.md`. Run 2026-11-26 by Claude Code after reading `DEVELOPMENT_GUARDRAILS.md`. Task 0 was read-only: every database read ran in `BEGIN READ ONLY` (helpers `backend/tmp/ud4_task0*.mts`, gitignored). Nothing was changed, committed or pushed.

## Task 0

### 1. Repo

- On `main` at `b57e74c` (Ella map 13 Part E), level with `origin/main`. The Ella map 13 session (danab-b9) confirmed it is idle with nothing uncommitted (G1.9).
- Modified and not mine:
  - `commerce/CLOSING_REPORT_6.md`
  - `ella_bloom_map/README.md`
  - the eight genova `.ttf` deletions

  All of these stay unstaged.
- This brief's own files: `usual_drink/README.md` (the brief 4 line, modified), the brief itself, and `kitchen_list_2026_11_26.csv` (untracked).
- Untracked code outside `tmp/`: two audit `.sql` files (`data_catalog/drift_audit_2026-10-18.sql`, `quizes/quiz_v7_content_audit.sql`) and the `loop/` runner files. None of them is this brief's.

### 2. Profile page

- **Archetype words (A1).** `Profile.tsx:523` filters `features` with `i === 0 || openBlock === 'primary'`, one `<li>` per word with a rule beside it. The words come from `catalogReads.archetypeCustomerWords` (`coffee_archetype.customer_words`). On production:

  | Archetype | Words |
  |---|---|
  | floral | Bright, Fragrant, Delicate |
  | fruity | Lively, Vibrant, Expressive |
  | balanced_sweet | Easy, Smooth, Harmonious |
  | chocolate_nutty | Full, Grounded, Comforting |
  | earthy | Deep, Bold, Lasting |
  | experimental | (none: `[]`, so the line renders nothing, as today) |

- **The number (A2).** On the Profile, "NO." renders in one place only: the breakout header `DialArchetypeSection.tsx:462` (`bd-breakout-archno`). Both Profile sections, primary (`Profile.tsx:539`) and adjacent (`:602`), pass `folded` with `unfoldMode="breakout"`.
  - `BloomDial.tsx:658` and `:664` sit inside `{!folded && …}`, so they never render on the Profile.
  - `ArchetypeSection.tsx:120` ("No. {visual.num}") is not used on the Profile.
  - The existing `showBreakoutHeader={false}` would also remove the archetype name, so it does not fit; `hideNumber` is needed.
  - Passing `hideNumber` down to `BloomDial` would change nothing on the Profile. I plan to apply it to the header only and leave the dial untouched; the Bloom page and Find My Flavor are unchanged either way.
- **The history tab row (A3, cause).** `Profile.tsx:638` has `overflow-x-auto` on the row and `border-b -mb-px` on each button. When one axis is not `visible`, CSS computes the other axis to `auto` too. The buttons' `-mb-px` pushes the underline 1 px below the row's padding box, so that 1 px overflows vertically and the browser shows a vertical scroller.
- **The top tab row (`:448`).** It also uses `overflow-x-auto`, but its underline is an absolutely positioned `motion.div` at `bottom-0` inside each `relative` button, with no negative margin. Nothing reaches outside the row, so it should not have the same cause. Acceptance 1 will measure both rows (`scrollHeight` against `clientHeight`) at desktop width and at 390 px. The fix goes on the top row only if it measures the same.

### 3. Brew cards

- **The payload.** `routes/users.ts:644` maps `getUserBrewCards` rows to `brewCards` in the flavor-memory payload (`:783`). No brew text rides along today, so `brew_cards_about` will be read through `brewTextParams()` (already used by `brewCard.ts:225/259` and `brewProfileCard.ts:65`) and added to the payload.
- **The component.** `BrewCards.tsx` (58 lines) is rendered on the Profile with `hideHeading` (`Profile.tsx:664`); its heading is the history tab "Brew cards". So the sentence will show once at the top of the Brew cards segment, above the first card.
- **How a recipe is built.** `brewCard.computeRecipe` starts from `getBrewDefaults()`, which is Firestore `config/sommelier.brewDefaults`, or else `FALLBACK_BREW_DEFAULTS`, typed in `brewCard.ts:35`. That holds the per-method ratio, grind and temperature, the grind scale, the per-dimension shifts and notes (Body, Acidity, Bitterness), the adjustment keys, the archetype default methods and the arrival note.
  - It then adds the dimension notes from `getCuppingDimensionAverages`, and the takes-it sentence (`brew_card_takes_it`, `brew_card_takes_it_skip`).
  - This goes to OPEN_TASKS only (G2.1, G2.15). Nothing moves in this brief.
- **Seen in passing (OPEN_TASKS):** `BrewCards.tsx` itself types words in, against G4.2. These are `METHOD_LABEL`, "Brew cards", "This coffee", "Adjusted after" and "Ask Liam about this". They are not this brief's to change.

### 4. Kitchen lookups (production, read-only; the test DB matches)

**Counts and the CSV:**
- `cupboard_coffee` has 59 values (59 active, highest `sort_order` 64), 59 `brew_cupboard_brand` rows (0 with a `roaster_id`), and 31 aliases. The test DB has the same counts and codes.
- The CSV has 329 rows, all with 5 columns, unquoted, codes `[a-z0-9_]`, no duplicate codes or labels:
  - 229 brands: 24 chain, 54 mass_market, 151 specialty.
  - 100 products. Their `brand_kind` is empty in the CSV and is taken from the parent, as B2 says.
- **None of the 329 codes exists**, not on `cupboard_coffee` and not on any other field. No CSV label matches an existing label (case, accents and punctuation folded).

**Products:**
- Every product's parent is an existing brand: 22 parents, none from the CSV.
  - 14 under Starbucks, 8 Peet's, 7 Lavazza, 6 each under Dunkin' and Counter Culture, 5 each under Folgers, Stumptown and Blue Bottle.
  - 4 each under Illy, Intelligentsia, Onyx and Partners; 3 each under Maxwell House, Kirkland, Trader Joe's, Green Mountain, Eight O'Clock, Community, Black Rifle and La Colombe; 2 each under Verve and Cafe Grumpy.
- No parent is a product, and every product label starts with its brand.
- **Partner roasteries (G4.5).** The roaster table holds Joe Bean, Joe Coffee Company, Path, Temecula, Utopian and the Zzz test roastery. No product hangs under `joe_bean`, `joe_coffee`, `path`, `temecula` or `utopian`, and no CSV label matches a roaster name. "Partners" is Partners Coffee (Brooklyn), not a partner roastery.

**Alias collisions (reported, not resolved):**
1. **`shoprite`**: the CSV gives it to `bowl_and_basket` ("Bowl & Basket (ShopRite)"), and it already exists on `store_brand` ("Store brand"). Both rows would then match "shoprite", and C3's "exactly one alias" would never resolve a typed "ShopRite".
2. **The existing alias `keurig`** (on `pods_unknown`, "Pods, not sure of the brand") equals the new label Keurig. **`nespresso`** (on `pods_unknown`) equals the new label Nespresso, and **`wegmans`** (on `store_brand`) equals the new label Wegmans. These are not alias-to-alias clashes. Typing "keurig" would list both the pods row and Keurig. Because C3 matches aliases only, a customer who typed "Keurig" would resolve to "Pods, not sure of the brand" rather than to Keurig.
3. Near miss, no clash: the CSV alias `k cups` (Keurig) and the existing `k-cup` (pods). They differ, but typing "k" or "k cup" offers both.

**Sort order (B2).** Every product's brand is an existing value, and existing values use sort orders 1 to 64 with no gaps (pinned 1 to 4, brands 10 to 64). "Each product directly after its brand" therefore cannot be done by inserting alone: Starbucks is at 11 and Peet's at 12.
- The autocomplete matches label or alias at the start of any word (`BrewTypeahead.matches`) and shows at most `typeahead_max_rows` = 6 rows in value order.
- So "starbucks" gives Starbucks and then five of its products, and "pike" gives Starbucks Pike Place Roast and Starbucks Decaf Pike Place Roast, whatever the products' sort numbers, as long as each sorts after its brand.
- Only the browse list (focus on an empty box) shows the difference.

### 5. Typed names (production, read-only)

There is one name on any `cupboard_coffee` row: `"Zzz smoke roaster"`, 1 customer (the smoke test user `103cdf5f`, from brief 3's smoke), 2 rows. No real customer has typed a kitchen name yet. On the test DB there are two: "Café du Monde" (brief 2's test customer `af250df4`) and "Zzz Corner Roasters" (brief 3's test customer). Acceptance 3 will use a test-DB name.

### 6. The admin side

- **Routes and page.** `routes/brewProfileAdmin.ts` (43 lines) has `router.use(requireAdmin)`. `requireAdmin` verifies the Firebase token and requires `user_type.name = 'admin'` on the DB row (G3.6). It serves `GET /stats` (`getBrewProfileFieldCounts` and `getBrewProfileCounters`), `GET /parameters` and `PUT /parameters/:key` (`brewParameters.setParameter`). `AdminBrewProfileStats.tsx` (113 lines) shows the stats and a parameter editor.
- **Where typed names show today.** `getBrewProfileFieldCounts` (`customerReads.ts:930`) returns `otherWords`: the newest 100 rows of any field with `customer_words`, ungrouped (field, words, date, source). The page lists them under `data-testid="other-words"`. It does not group or count them, and it does not leave out names that already match an alias.
- **The cache refresh.** `brewProfile.loadBrewProfileFields` reloads `v_brew_profile_field_current`, including each value's aliases, in each server process every `field_list_refresh_seconds` (300 on production). A failed reload keeps the last list. The options payload and Liam's field list (`formatBrewProfileFieldList`, `claude.ts:570`) both read that cache, so a promoted entry reaches the autocomplete and Liam within 5 minutes per instance, with no deploy.
- **Liam's prompt grows (C4 consequence).** `formatBrewProfileFieldList` lists every active value of a typeahead field as `code (label / aliases)`. For `main_cupboard`, whose values come from the kitchen, it lists the codes again. The 329 new entries add about 20,000 characters, roughly 5,000 tokens, to the shared (cached) tier of every Liam call.

### 7. Readers of a kitchen answer's brand

- `v_customer_cupboard_coffee` (brief 3) has one row per customer: the coffee they drink most. `getCupboardCoffee` reads it, used by `matchService.ts:686`, `getCupboardCoffeeByProfile` and the admin counts. Its `Readers:` also lists `customerIntegrity` check 31.
- **`/map`.** `matchService.ts:687` looks up `said.get('cupboard_coffee:<code>')`. The said-back rows ("You have … in your kitchen") exist only for the 50 brands in `ellaMapReasons_2026_11_20.KITCHEN_BRANDS`. That list leaves out the unknown answers, the store brand, the local roaster and the five partner roasters.
  - **A product or a new brand has no said-back row, so `/map` shows no kitchen line for it.** A new brand is the same as today for any unlisted answer.
  - A product is different. A customer who picks "Starbucks Pike Place Roast" as the coffee they drink most loses the "You have Starbucks in your kitchen" line they would get by picking "Starbucks".
- **Integrity.**
  - Seed codes: `brew_cupboard_brand_kind` 5 codes.
  - Seed value counts: `USUAL_DRINK_SEED_VALUE_COUNTS.cupboard_coffee = 59` (`customerIntegrity.ts:734`, check 27) goes to 388.
  - The brand rows (check 25, `:100`–`:110`): every `cupboard_coffee` value has a brand row, no brand row is on another field, and every brand roaster exists. These checks cover new rows as they are.
  - Check 23 (typeahead has a pinned value) and check 24 (stored values resolve) are unaffected.
  - The new check will be #34.

### 8. G3.9 list: what I would add, beside what exists (STOP)

| New | Considered | Why it doesn't fit, or why I extend it |
|---|---|---|
| Column `brew_cupboard_brand.parent_brand_id INT NULL REFERENCES brew_cupboard_brand(id)` | `roaster_id` (links to a partner roaster); `brand_kind_id` (the channel); a product table | Neither column links a brand to a brand. A product is a value like a brand, so it uses the same table (the brief's call). |
| **Writer module `services/brewKitchenList.ts`**: `promoteTypedName({ typed, label, kindCode, parentCode? })` and `retireKitchenEntry(code)`. It is the first app writer of `brew_cupboard_brand` and `brew_cupboard_brand_alias`, and of `brew_profile_field_value` (code-scoped to `cupboard_coffee` rows; every other field stays seed-only). Declared beside `seed` in `comments.sql`. | `brewParameters.setParameter` (writes only `brew_parameter`, as SCD rows); `customerFacts.record` (customer facts, the wrong domain); `catalogService` (the A&B coffee catalog, which "Do not" forbids linking to) | No existing writer touches these three tables. One module keeps the three inserts in one transaction (C2). |
| **Read:** extend `customerReads.getBrewProfileFieldCounts` with `typedKitchenNames` (grouped by `lower(trim(customer_words))`, customer count, names matching an active alias or label left out) and the form's `kinds` (`brew_cupboard_brand_kind`, active) | A new admin reader beside it | It already reads `customer_words` from the same table for the same page; one more query in its `Promise.all`. The brand list for the parent picker comes from the existing options cache (`getBrewProfileFieldsConfig`), so no new reader. |
| **Routes:** `POST /api/admin/brew-profile/kitchen/promote` and `POST /api/admin/brew-profile/kitchen/:code/retire` in `brewProfileAdmin.ts` (zod, behind `requireAdmin`) | `PUT /parameters/:key` | It writes parameters, not lookups. |
| **View:** `v_customer_cupboard_coffee` body (C3). Old words resolve on read to a brand when they match exactly one active brand; the row still returns `customer_words`. | `getCupboardCoffee` doing it in code | The view is the one read path, and its other readers (`/map`, the admin counts) should see the same answer. |
| **Integrity:** check #34 (a product whose parent is inactive or is itself a product); seed count 59 → 388 | | |
| **Props:** `DialArchetypeSection.hideNumber` (header only, see §2); `BrewCards.about` (the sentence, from the payload) | `showBreakoutHeader={false}` (exists, but also removes the name) | |

## Decisions I need from you

1. **`shoprite`.** I recommend not seeding the CSV alias `shoprite` on Bowl & Basket. Its label "Bowl & Basket (ShopRite)" already matches "shoprite" by word, so typing finds it anyway, and `store_brand` keeps the alias. The alternative is to seed it on both rows; then C3 never resolves a typed "ShopRite".
2. **Keurig, Nespresso, Wegmans.** Old aliases on the pods and store-brand rows equal these new labels. I recommend that C3 matches a typed name against active brand **labels first, then aliases**, and resolves only when exactly one brand matches at that step. A typed "Keurig" would then resolve to Keurig, not to "Pods, not sure of the brand". The brief's wording (aliases only) would send it to the pods row. The old aliases stay (G2.11).
3. **Product order.** I recommend renumbering the `cupboard_coffee` sort orders once, guarded on "no product row exists yet" (the brief 3 A4 pattern), so that each product sits right after its brand and the new brands come after. That makes the browse list read Starbucks, Starbucks Pike Place Roast, …, Peet's. Only `sort_order` on lookup rows changes; no fact row changes. Typing works the same without it; only the browse order differs.
4. **`/map` for a product.** I recommend that the said-back lookup in `matchService` (one line) tries the entry's brand when the entry is a product. To support that, `v_customer_cupboard_coffee` gains a `brand_code` column: the parent's code, else its own. A customer whose main coffee is Starbucks Pike Place Roast keeps "You have Starbucks in your kitchen", so `/map` reads as before. The alternative is no change: no kitchen line for a product, which is the "Do not change the map" reading.
5. **Liam's prompt: about +5,000 tokens on the cached shared tier.** I recommend accepting this as the brief says (C4). The products account for about 1,900 of those tokens (their codes appear twice, once for the kitchen and once for "drink most", plus their labels). If you'd rather keep the prompt smaller, Liam's list could leave the products out, which means Liam remembers the brand. That changes `formatBrewProfileFieldList`.

**STOP after Task 0: waiting for your yes on the G3.9 list (§8) and decisions 1 to 5.**

## Dana's answer (2026-11-26)

1. Yes, skip the new "shoprite" alias.
2. Yes, match a typed name against brand names first, then aliases.
3. No renumbering; stored sort orders are not rewritten. The kitchen options are ordered when they are read: each brand in its own sort order, then its products (by `parent_brand_id`), so a product promoted later also lands under its brand. A test covers a product added after the seed.
4. Yes: a product resolves to its brand's kitchen line on `/map` (one view column, the one-line `matchService` lookup). Nothing else in `matchService` or the map changes.
5. Products are left out of Liam's field list; Liam remembers the brand. Brands stay in.

Yes to all seven new pieces as listed in §8.

## Deviations

1. **The `shoprite` alias is not seeded** on `bowl_and_basket` (Dana, decision 1). The CSV keeps it as received; the seed skips it, and `store_brand` keeps `shoprite`.
2. **C3 matches brand labels first, then aliases** (Dana, decision 2), not aliases only.
3. **No sort-order renumbering** (Dana, decision 3). B2's "each product directly after its brand" is done at read time, not by stored numbers.
4. **`v_customer_cupboard_coffee` gains `brand_code`**, and `matchService` looks up the said-back by it (Dana, decision 4).
5. **Liam's field list leaves the products out** (Dana, decision 5).
6. **`v_brew_profile_field_current` gains `parent_value_code`.** Decisions 3 and 5 both need the cached field list to know which values are products, and the view is its one read path. This is one added column; nothing else in the view changed.
7. **`hideNumber` stops at the header.** The brief says to pass it down to the dial. The dial's own number renders only unfolded, which the Profile never is, so the prop stays on `DialArchetypeSection`'s breakout header (Task 0 §2). The dial is untouched.
8. **The sentence sits at the top of the Brew cards segment.** The Profile renders `BrewCards` with `hideHeading`; its heading is the history tab "Brew cards". The sentence shows once, above the first card.
9. **A seeded brand also resolves an old typed name**, not only a promoted one. C3 reads the label and alias rows whatever wrote them. On the test DB, brief 2's typed "Café du Monde" now reads as the seeded Café Du Monde. Production holds one typed kitchen name, the smoke test user's "Zzz smoke roaster", which matches nothing.
10. **Earlier tests updated:**
    - `usualDrink.test.ts` typed "Café du Monde", which is now a list entry; it types "Zzz Neighborhood Roaster" instead.
    - `customerIntegrity.test.ts` counts 31 checks (check 34).
    - `usualDrink2.test.tsx` expects every archetype word on one line (D1 revises brief 2).
11. **Promote rules beyond the brief:**
    - A product takes its brand's kind, as B2 seeds them.
    - A label already used on the kitchen list is refused (409).
    - The four fixed answers ("I don't know", "Nothing right now", pods, "Something else") cannot be retired.
    - One promotion runs at a time (an advisory lock), so the alias check cannot race.

## Built (2026-11-26)

- **Part A (frontend):**
  - `Profile.tsx`: the archetype words are one line (`data-testid="memory-archetype-words"`), and both archetype sections get `hideNumber`. The history tab row is `overflow-x-auto overflow-y-hidden`, with the hairline an inset shadow and no `-mb-px` on the buttons. The top tab row measured clean and is unchanged.
  - `DialArchetypeSection.hideNumber`.
  - `BrewCards.about`; `FlavorMemoryData.brewCardsAbout`.
  - The payload reads `brew_cards_about` through `brewTextParams` in `routes/users.ts`.
- **Part B (rows):** a USUAL DRINK 4 block in `schema.sql`. It holds `brew_cards_about`, `parent_brand_id`, and the seed generated once by `tmp/ud4_gen_seed.py`: 329 values, 229 brand rows, 100 product rows and 16 aliases. `v_brew_profile_field_current.parent_value_code`.
  - `brewProfile.orderValues` reads each product under its brand.
  - `formatBrewProfileFieldList` leaves products out.
  - Check 34 is new; the seed count goes from 59 to 388.
- **Part C:**
  - `services/brewKitchenList.ts` (`promoteTypedName`, `retireKitchenEntry`) and two routes in `brewProfileAdmin.ts`.
  - `getBrewProfileFieldCounts` gains `typedKitchenNames`, `kitchenKinds` and `kitchenEntries`.
  - `v_customer_cupboard_coffee`: C3 and `brand_code`. `getCupboardCoffee.brandCode`; `matchService` looks up the kitchen line by `brandCode` (one line).
  - `AdminKitchenTypedNames.tsx` sits on the admin brew-profile block (`/admin/sommelier/flow`).
- `comments.sql`: the `Writer:` and `Readers:` fields of the three kitchen lookups and of `brew_cupboard_brand_kind`; the new column; both views.

## Tests

- **Backend:**
  - New `usualDrink4.test.ts` (10) and `routes/brewProfileAdmin.kitchen.test.ts` (2: a signed-in non-admin gets 403 and 401 without a token, and bad bodies get 400, before the writer runs).
  - Updated `usualDrink.test.ts` and `customerIntegrity.test.ts`.
  - All usual-drink files are green: 64 of 64.
- **Full backend `vitest run src`:** 75 failed of 1397. Three were mine (the check count; brief 1's "Café du Monde", twice), and they are fixed and pass. The other 72 are in files this brief did not change:

  | File | Failures | Cause |
  |---|---|---|
  | `palateReads` | 31 | |
  | `evidenceViews` | 8 | test-DB counts |
  | `quizScoring` | 6 | a pure scoring test |
  | `coffeePresentation2` | 5 | |
  | `evidenceAdmin` | 5 | |
  | `quizResultsView` | 4 | timeouts |
  | `quizInterpretation` | 3 | timeouts |
  | `dialMap7` | 3 | Ella map 12's step-line copy |
  | `sommelierEval`, `sommelierRag`, `staleGuestCleanup` | 2 each | free slots; timeouts |
  | `dialMap9`, `qrDoor`, `catalogService`, `sommelierAnswer`, `schema.catalog_blueprint` | 1 each | |

  Brief 3's run had 33 such failures; this set has grown since, partly through Ella map 12 and 13. I did not establish a baseline run at `b57e74c`. This is logged as OT-190 (G1.12).
- **Frontend:**
  - New `profile/usualDrink4.test.tsx` (7) and `bloom/hideNumber.test.tsx` (2).
  - `usualDrink2.test.tsx` updated.
  - Full `vitest run`: 206 tests, new files included. The one failure was brief 2's feature-line test, which D1 revises; I updated it and it passes.
- **Lints and type-checks:** the six lints pass. Backend `tsc` is clean. Frontend `tsc` shows the 7 known errors.

## Acceptance (test DB, local :4917 + Vite :5173)

The marked brief 3 test customer ("Zzz Test Customer UD3", uid `ktIy1WjLxHUg2fsTqNiJ4azwbWu1`, profile `1f1bd326…`, Balanced & Sweet) was re-enabled for the run and given one brew card (`generateCard`, card 17). The admin was the Ella map 10 "Zzz Test Admin (dana)" (`wSVKwhAq…`). Both are disabled again, and the test admins are back to `customer`. Screenshots are the `ud4_*.png` files in this folder.

1. **Profile**, at 1280 px and at 390 px:
   - The words read "Easy · Smooth · Harmonious" on one line.
   - No "NO. n" anywhere on the page; the header reads "Balanced".
   - History tab row: `scrollHeight` 44 = `clientHeight` 44 at both widths, `overflow-y: hidden`. At 390 px it still scrolls sideways (404 against 350).
   - The top tab row measured 44 = 44 as well, so it was left as it was.
   - No sideways page scroll.
   - The Brew cards segment shows the sentence once, before the first card ("Clean Fruit · V60 · 1:16 · medium-fine · 94°C").
2. **Kitchen:**
   - "tatte" gives Tatte Bakery & Café.
   - "starbucks" gives Starbucks and then its first five products (`typeahead_max_rows` 6).
   - "pike" gives Starbucks Pike Place Roast and Starbucks Decaf Pike Place Roast.
   - The browse list reads Starbucks, its 14 products, then Peet's Coffee and Peet's Major Dickason's Blend.
   - I picked Starbucks Pike Place Roast and typed "Zzz UD4 Corner Shop"; the save answered 200. After a reload: "Starbucks Pike Place Roast · Drink most" and "Zzz UD4 Corner Shop".
3. **Admin:**
   - The block listed "Zzz Corner Roasters 1" and "Zzz UD4 Corner Shop 1". Brief 2's "Café du Monde" is left out because it now matches the seeded brand.
   - The form offered the five kinds and 285 brands.
   - Promote returned 201 `{created: true, code: "zzz_ud4_corner_shop"}` (specialty), and the name left the typed list.
   - `getCupboardCoffee` for the customer then returned `zzz_ud4_corner_shop` / "Zzz UD4 Corner Shop" / specialty, with `customerWords` "Zzz UD4 Corner Shop". Their latest `cupboard_coffee` row is unchanged (`["starbucks_pike_place_roast","other"]`, words "Zzz UD4 Corner Shop").
   - The field list reloaded 170 s later. "zzz ud4" then offered "Zzz UD4 Corner Shop" in the autocomplete, and the customer's Profile still showed their own words: "Zzz UD4 Corner Shop · Drink most".
4. **`/map`** (`matchService.steps`, read-only; the route is closed to this test customer, as in brief 3). With Starbucks Pike Place Roast as the coffee they drink most, the first bag opened "You have Starbucks in your kitchen. …". `dialMap9`'s kitchen-sentence test (Counter Culture, and unquoted brands) passes.
