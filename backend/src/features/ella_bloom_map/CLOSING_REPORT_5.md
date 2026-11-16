Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_5_DECIDED_MAP_AND_ADMIN.md`. **Status: DONE on production 2026-11-16.** Commit `9930d73` (the brief), deploy green, revision `axis-bloom-backend-00863-zkc`; seed applied on production (61 rows) and "L1 assumption map" published (version 2); `CATALOG.md` regenerated from production in the follow-up commit. The production record is the next section; everything after it is the report as written at the Part E STOP.

## Production (2026-11-16, after Dana's yes)

Dana's answers at the STOP: the slots stay as they are (La Familia floral #1, The Village fruity #1; OT-137 stays open for the switch brief); one hidden direction keeps the line, as built (OT-139 done); the `evidenceViews` case pinned to La Familia being Floral follows the new family in the same commit (now fruity, basis = the seed's note); the other failures stay in OPEN_TASKS.

1. **Commit and push:** `9930d73`, files by path only (the genova fonts and `commerce/README.md` left out). Deploy run 43924213208: backend and frontend green. **Startup log** of `axis-bloom-backend-00863-zkc`: no ERROR lines; `[db-comments] applied 2162 statements`; `[data-catalog]` 2 of 11 checks with findings: #4 `CATALOG.md` stale (expected until step 5) and #6 dead-table candidates (long-standing). The map checks 7 to 11 are clean. Other boot findings are long-standing: catalog integrity #6 (The Waverly, fixed by step 3), quiz #10, evidence #2 and #6, sommelier #3.
2. **Second dry run:** 61 write / 16 unchanged / 29 skipped, **identical line for line** to the first (diff empty apart from the timestamp).
3. **Apply:** `--apply --expect-db axisandbloom`: **61 rows written**, no error; the dial signal was refreshed for the four family changes. A third dry run: **0 write**, 77 unchanged.
4. **Publish:** `dialPlacementService.publish` (the function `POST /api/admin/map/publish` calls) through `backend/tmp/em5_publish.mts`: **version 2 "L1 assumption map", 13 placements, version 1 (L0) retired.**
5. **State read back (read-only):** L1 active, L0 retired. 13 placements in the Data 1 cells: chocolate_nutty Fabricator 1/side_a, Nightcap Decaf 1/side_b, The Daily 1/middle, Amsterdam 2/side_b, Tiger Stripe 2/side_a, Blossom 3/side_a, The Waverly 3/side_a (grade D, uncupped); balanced_sweet Benchmark 0/side_a; fruity La Familia 1/side_b, Geometric 1/side_a, Cafè Feminista 2/middle; earthy Big City 2/side_a; floral The Village 2/side_a. Every placement carries `ring_decided` and has a size (no dashed dot). `v_dial_step`: 22 current rows, all 22 on the map, **11 lines**. 15 first-match cells. Floor 1, roaster cuts 4 and 5. Every `dial_surface` row `lane`. 0 active coffees without a family.
6. **`CATALOG.md`:** `npm run catalog:md -- --expect-db axisandbloom` (215 tables, 108 views, 1839 columns, hash `bf257b50…`, the live hash the boot check reported), committed and pushed in the follow-up commit.

Not done in a browser on production: no admin password on prod and no test admin there (brief 2 rule), so the page was verified on the test DB and the data on production. Dana can open `/admin/map` signed in to see L1.

---


Dana's go (2026-11-16): option (a), enter what exists (13 coffees); size reads the roaster's rating only; the admin face dashes a dot with no size and customer pages keep today's behaviour; families with confidence `low`, source `manual`; the grade floor to 1 stays behind this STOP; and before the STOP, list what a customer would see differently for the four coffees whose family changes.

**Correction to Task 0:** 13 coffees but **11 pairs (22 step rows)**, not 13 pairs (26). Five pairs touch a missing coffee, plus steps 3 and 4 (Great Heights) and 10 (Brazil), so 7 pairs wait (OT-136). I miscounted in Task 0.

---

## Part E: what the production write does

### 1. What a customer would see differently for the four family changes

The script changes four catalog families on production: **Nightcap Decaf** fruity to chocolate_nutty, **La Familia** (Colombia La Familia Guarnizo) floral to fruity, **The Village** fruity to floral, and **The Waverly** none to chocolate_nutty. It does not touch slots, SKUs, prices or `dial_surface`. I audited every read of the coffee's family (`v_coffee.match_archetype` / `coffee_archetype_assignment`), and spot-checked the reads below in code.

On production these four coffees have **0 order lines**. La Familia holds the slot **floral #1 home** and The Village **fruity #1 home**, and both are sellable and in stock. Nightcap Decaf is not in any slot (decaf, not sellable through the slot view, OT-126) and has one active SKU. The Waverly has no slot and no SKU.

**What does not change (decided by the slot, not the family):**
- **Lane dial and Bloom page:** the BloomDial and slot cards (`coffeeCardReads.getFamilyCards`, `v_coffee_archetype_adjacency`) read the slot. La Familia stays in Floral and The Village in Fruity there.
- **Orders and subscriptions:** which coffee is offered, carted or shipped (`blendResolver`, `v_coffee_sellable_candidate`, `subscriptionService`) and prices: all slot-based.
- **The quiz result and the customer map:** the map reads the stored `dial_placement` of the active version, which is cut only by Publish. Every `dial_surface` row stays `lane`.
- **Past orders relabelled on the Flavor Memory page** (`v_customer_timeline` reads the live family): none, because there are no orders of these four.

**What changes:**

| Surface | What a customer sees | Coffees | Visible today? |
|---|---|---|---|
| Category coffee card (`coffeeCardReads.ts:135`, `OtherCategoryCard` "Matches {family}", card colour on Bloom and Shop all, the compatibility badge) | "Matches Fruity" becomes "Matches Chocolate & Nutty"; it moves to the Chocolate & Nutty section of the flavor page | Nightcap Decaf (decaf category card) | Behind the pre-launch curtain |
| Signature and accent notes (`v_coffee_customer_descriptor`: signature = notes in the family's `descriptor_families`) on cards, `/:id/flavor-wheel`, Liam's key flavors, order and arrival emails, stories | **Nightcap Decaf:** Almond and Molasses move from accent to signature. **The Village:** Rose moves from accent to signature (Grapefruit, Other Fruit, Rose; then Honey, Vanilla). **La Familia** and **The Waverly:** no change (checked on prod) | Nightcap Decaf, The Village | Curtain for pages; emails only on an order (none) |
| Bag QR story page (`routes/coffees.ts:990`, public, outside the curtain) | Family label changes. The dial-position line disappears, because it shows only when the home slot's family equals the coffee's family | La Familia, The Village | Public, but no bags of these were ever ordered |
| Cart, subscription renewal and household email label (`cartResolver.directDisplay`, `subscriptionShipment.ts:220`, `householdEmails.ts:82`) | The family word on a direct or category line | Nightcap Decaf (category); dial lines use the slot family | Only on an order (none) |
| Liam (`sommelierRag.ts:604`: family first, slot as fallback) | Grouping and label in Liam's catalog block, and the candidate pool per quiz family; the decaf-only "nearest decaf to their match" now reads Nightcap Decaf as Chocolate & Nutty | All four (The Waverly enters a family pool; it is not sellable, so it is not offered) | Subscribers and admins; shared block re-renders within 10 minutes; open sessions keep old text (OT-138) |
| Axis stats (`/api/axis/stats`, the Axis page) | Coffees per family: Chocolate & Nutty +2, Fruity -1, Floral 0; "last tightened" date moves to the write date | n/a | Behind the curtain |
| Brew card default method by family (`brewCard.ts:164`) | Default method for a new brew card on these coffees follows the new family | all four | Only after an order |

Two other effects, neither visible to customers:
- **Comparison profiles:** `v_archetype_dimension_profile` (comfort-zone pill, adjacent/distant labels) is built per family from cupped midpoints. Nightcap Decaf, La Familia and The Village are cupped, so the Fruity, Floral and Chocolate & Nutty reference profiles shift a little for every coffee's comfort-zone sentence. Behind the curtain.
- **Lane-dial signal:** `refreshDialSignal` runs for the four after commit, as `setMatchArchetype` does. It rewrites their `dial_position_signal`, read only by the dormant consensus view, admin evidence and the Axis stats date.

**Bottom line:** no customer-visible change today, as far as the data shows. The four have no orders, so no emails, carts, renewals or bags are affected, and the curtain hides the pages. Once the curtain lifts, the changes are card labels, three notes moving from accent to signature, and Liam's grouping. Separately, La Familia and The Village will disagree between their family and their lane-dial slot until the slots move (OT-137), and the bag story page drops its dial-position line while they disagree.

### 2. Dry run against production (read-only, 2026-11-16 17:16 UTC)

`npx tsx src/scripts/ellaMapDecided_2026_11_16.ts --dry-run --expect-db axisandbloom` ran in a `BEGIN READ ONLY` transaction. The production schema does not have the brief-5 tables yet, so ring decisions and steps read as empty.

**Plan: 61 write, 16 unchanged, 29 skipped.** Skipped (no `coffees` row): Half Moon, Brazil, Great Heights, Indonesia, D.R. Congo.

| Section | Write | What |
|---|---|---|
| family | 4 | The Waverly (none to chocolate_nutty), Nightcap Decaf (fruity to chocolate_nutty), La Familia (floral to fruity), The Village (fruity to floral) |
| lean | 7 | The Daily middle, The Waverly side_a, Nightcap Decaf side_b, Amsterdam side_b, Big City side_a, La Familia middle to side_b, The Village side_b to side_a |
| ring | 13 | Every present coffee, per Data 1 (no ring decisions exist) |
| parameter | 1 | `dial_min_grade_rank_first_match` 3 to 1 |
| first match | 14 | Every cell of Data 3 except balanced_sweet x side_a (already Benchmark) |
| steps | 22 | Pairs 1, 2, 5, 6, 7, 8, 11, 12, 14, 15, 16, both directions |

The full fact-by-fact output is in the appendix at the end of this report.

Not touched: Utopian (inactive, unchanged), The Waverly and Amsterdam as a step (not written, G2.20), every roaster's portal answers, slots, SKUs, prices, `dial_surface`.

### 3. On your yes, in this order

1. Commit (files by path only) and push. **This deploys:** `schema.sql` adds `coffee_ring_assignment`, `dial_step_basis`, `dial_step`, the two views, two parameters and three flags. From then on the production *preview* sizes dots by the roaster rating; the active version L0 and every customer surface are unchanged. Then check the deploy and the startup log (`[data-catalog]`, integrity, no ERROR).
2. `--dry-run` again on production. Expect the same 61 rows.
3. `--apply --expect-db axisandbloom`: one transaction, then the dial signal refresh for the four.
4. Publish on production as **"L1 assumption map"** (`POST /api/admin/map/publish`, admin).
5. `npm run catalog:md -- --expect-db axisandbloom`, then commit and push `CATALOG.md` and the evidence. `CATALOG.md` cannot be regenerated before the deploy, because it reads the production database.

---

## What was built

- **Schema** (`schema.sql`, additive, applied twice clean by the test setup): `coffee_ring_assignment` (supersede; `suggested_ring`; insert trigger: a `dial_ring` code and 0 exactly for the center family) and `v_coffee_ring_assignment_history`; `dial_step_basis` (3 seeds), `dial_step` (one current row per ordered pair, `CHECK` from <> to, wall-clock `created_at`), `v_dial_step`; parameters `dial_size_roaster_cut_1/2` (4, 5); flags `ring_decided`, `ring_decision_mismatch`, `no_roaster_sweetness`; grants supersede-only. `v_dial_placement_input` gains `roaster_sweetness`. `v_dial_placement_preview`: the ring decision wins when it fits the family, else the calculated ring (kept as `calculated_ring`); placeable also with a lean and a fitting ring decision; size from the roaster rating. `comments.sql` covers every new object and column, and the preview, input and size-cut comments are updated.
- **Backend:** `catalogService.setRingInTx`/`setRing`; `dialPlacementService.setStepInTx`/`setStep`, `publishInTx`/`publish`; `cutVersionInTx` stamps `cut_at` with `clock_timestamp()` and checks the roaster cuts; `dialReads.steps`, `ringHistory`, `unpublished`, `decidedMap`, `vocabulary.stepBases`; `roasteryPortalReads.roasterFactsForCoffees`; `evidenceParameterService` orders the two roaster cuts; integrity checks 9 and 10 know the new seeds and keys. Routes: `GET /decided`, `GET|PUT /steps`, `PATCH /ring/:coffeeId`, `GET /ring/:coffeeId/history`, `POST /publish`.
- **Seed:** `backend/src/scripts/ellaMapDecided_2026_11_16.ts`.
- **Frontend:** `AdminEllaMap.tsx` is the new page; `AdminEllaMapAdvanced.tsx` is the old page, moved by `git mv` and unchanged apart from its name; route `map/advanced`. `EllaMapFace` gains `steps` and `dotStyle`; `EllaMapLegend` gains `lines` and `noSizeLabel`; `lib/mapAdmin.ts` gains the calls.

**CATALOG.md check (G2.4), repeated:** steps: `coffee_hop` (dimension and direction, no word or basis, marked for retirement), `v_dial_edge`/`v_dial_hop` (calculated), and `dial_hop_phrase`/`dial_move` (the moves' words) cannot hold "from this coffee, with this word, to that coffee, on this basis", hence `dial_step` and `dial_step_basis`. Ring: `dial_placement.ring` is a copy at the cut, and `dial_ring_cut` holds thresholds, hence `coffee_ring_assignment`. Everything else reuses existing objects.

## Evidence (test DB `axisandbloom_test`, 2026-11-16)

- **Seed:** dry run 62 write / 15 unchanged / 29 skipped (the test DB differs from prod in Blossom's lean). `--apply`: 62 rows. Second dry run: **0 write**, 77 unchanged.
- **Acceptance in the browser** (marked Zzz test admin, test DB only, demoted and disabled after; local backend :4917, Vite :5174):
  - Before: L0, 12 dots, 0 lines. **Published "L1 assumption map": 13 dots, 11 lines in three styles, 0 dashed dots** (every placed coffee has a roaster Sweetness rating). Table 1 has 15 rows (Data 3 cells); table 2 has **22 rows**. Unpublished line: "Every decision is on the published map." Screenshot: `map5_admin_L1.png`.
  - **Blossom ring 3 to 2** with a basis: card "Saved. Publish to put it on the map." (`map5_admin_card.png`). Published L2: the dot moved from (608, 143) to (577, 286). Ring history shows "two steps out, Acceptance…" (current) above "the edge, Assumption map…" (superseded).
  - **Hiding step 16:** the row hidden was The Waverly to Tiger Stripe. Before publish: the unpublished line read "1 decision not yet published: 1 step" and the face still had 11 lines. Published L3: still 11 lines, because the pair's other direction is shown (one line per pair, OT-139). Hiding the other direction too (API, same admin) and publishing L4 gave **10 lines**, 20 active step rows, and all 22 rows still in the table. Screenshot: `map5_admin_L3.png`.
  - `/admin/map/advanced` renders the old page (heading "Ella's Bloom Map", Preview and Active toggle; `map5_admin_advanced.png`). No page errors.
  - Customer side: every `dial_surface` row is still `lane`. The face's default dot style is unchanged and the customer pages (`MapPage`, `MapQuizStart`, `MapTrail`) pass neither `steps` nor `dotStyle`. I did not re-screenshot the customer Bloom page, quiz result and profile; their code paths are unchanged.
- **Tests:** `dialMap5.test.ts` 5/5, `dialMap.test.ts` 14/14, `mapAdmin.test.ts` 4/4, frontend `mapGeometry` 6/6. `tsc --noEmit`: backend clean; frontend 7 errors, all pre-existing (ArchetypeSection, useAdjacentArchetype, Profile), none in touched files. All six lints clean.
- **Full backend run** (`npx vitest run src`, OT-122): 29 failed / 1219 passed / 6 skipped. Against the Usual Drink 1 baseline of 25:
  - **Mine, fixed and rerun green:** `dialMap` grade-floor case (the floor is now 1 on the test DB; the case sets it to B inside its rollback) and `dialMap5` placement case (picked a coffee without a ring decision; the seed gave them all one).
  - **Caused by the seed's data, kept as data-pinned tests (OT-140):** `evidenceViews` "La Familia: catalog floral" (now fruity). Gone: `guard` (The Waverly now has a family, catalog check 6) and the 2 `catalogImport` failures.
  - **Unrelated:** `qrDoor` cleanup FK (`checkout_session_order_id_fkey`), `lintCatalog`/`lintCustomer`/`householdService` timeouts at 5 s under load, `sommelierRag` free-slot fixture (2, was 1). The rest is the baseline: evidenceViews 7, quizScoring 6, evidenceAdmin 3, sommelierEval 2, sommelierAnswer 1, catalogService 1, schema.catalog_blueprint 1.

## Deviations from the brief, and why

1. **13 coffees and 11 pairs instead of 18 and 18** (Dana's option a; OT-136). Acceptance counts follow: 13 dots, 11 lines, 22 rows.
2. **Seed path:** `backend/src/scripts/` instead of `backend/scripts/`, so the Part D test can import it (`tsc` rootDir is `src`; the lineage lint treats both folders as `backfill:`). It writes nothing directly, so no `Writer:` entry is needed.
3. **Steps are versioned by time, not copied:** "publish is the only way a decision reaches the active map" needed the active map's steps frozen at the cut. `v_dial_step` reads the `dial_step` rows in force at `dial_map_version.cut_at` (supersede history), so there is no extra snapshot table. For that the cut stamps `cut_at` with `clock_timestamp()` and steps use wall-clock times.
4. **`v_dial_step` holds current rows too:** it is the one read for both the admin table (`is_current`, shown or not) and the face (`on_active_map`). The brief's "current shown steps over the active version" is the `on_active_map` set.
5. **Table 2 has one row per direction** (36 in the brief, 22 here) with the step back beside the open row, as the brief says. The mockup shows one row per pair.
6. **One line per pair** on the face. Hiding one direction keeps the line (OT-139).
7. **The calculated ring is stored** as `suggested_ring` on the decision (A4 "if cheap": it was).
8. **Ring decision fit:** a ring decision that no longer fits a changed family is ignored, with the flag `ring_decision_mismatch`, instead of breaking the cut.
9. **`no_size_value` kept:** the pooled-sweetness flag still exists (nothing from briefs 1 to 3 is dropped); the new `no_roaster_sweetness` drives the dashed dot.
10. **Stale processes:** a backend (`tmp/boot_testdb.mjs`) and a Vite on :5173, both left running from the brief 3 acceptance on 2026-11-12. I stopped the backend so the current code could serve :4917 and left the :5173 Vite running.

## What the customer-page brief needs

- `v_dial_step` filtered on `on_active_map`: `from_coffee_id`, `to_coffee_id`, names, `button_word`, `customer_line` (NULL means show the destination's signature notes), `basis_code`, `line_style`. Read it through `dialReads.steps('active')`.
- `EllaMapFace` `steps={[{ from_coffee_id, to_coffee_id, line_style }]}` (one line per pair, dash per basis) and `dotStyle` (`'size'` dashes a no-size dot; the default keeps the sellable style).
- First bags: `dial_first_match` rows per family and lane (15 cells, floor now 1). The quiz-to-lean rule and the espresso tie-break (OT-134) are that brief's.
- Prices, the five missing coffees (OT-136) and the family vs slot question (OT-137) are open.

---

## Task 0 as written before the go (2026-11-16)

### Decisions for Dana before Part A (answered: see the top)

1. **STOP item (item 1). Five of the 18 coffees have no `coffees` row, on test or on production:** Half Moon, Great Heights (Joe Coffee), Brazil, Indonesia, D.R. Congo (Joe Bean). Each exists only as a roastery portal lineup coffee with a submitted response and `roastery_portal_coffee.coffee_id` NULL. Without a `coffees` row they cannot get a family, lean or ring decision, a placement, a step (every FK is `coffees.id`), or a first-match row. What that does to the brief:
   - Data 1: 13 of 18 coffees can be entered.
   - Data 2: steps 9, 10, 13, 17, 18 touch one of the five, so **26 of 36 `dial_step` rows** can be written (13 pairs, not 18).
   - Data 3: unaffected. All eight first-bag coffees exist.
   - Acceptance "18 coffees, 18 lines, three uncupped Joe Bean singles placed" cannot pass as written.

   Options: (a) run Part A to D now and enter the 13 coffees and 13 pairs; the seed script's dry run lists the skipped rows, and a later run adds them once the coffees exist (the script is idempotent, so a rerun only adds what is new). (b) Create the five `coffees` rows first, in their own step through the catalog writer. That is outside this brief ("Do not create… a `coffees` row"). It also needs a choice about linking `roastery_portal_coffee.coffee_id`: that row belongs to the roaster's portal lineup, so G2.20 applies. Only a linked portal coffee gives `v_roastery_portal_coffee_hint` the roaster's notes and Sweetness rating. **I recommend (a).**
2. **Size with no roaster rating (CTO call 3 reads two ways).** "With no roaster rating, size is NULL and the dot is drawn dashed" and "pooled cupping sweetness no longer sets the size for a coffee that *has* a roaster rating" disagree about a cupped coffee with no rating. I propose that size reads the roaster's rating only and is NULL otherwise. In practice nothing hangs on it today: all 13 placeable coffees have a submitted Sweetness rating, so no dot would be dashed.
3. **The dashed dot already means something on the face.** Today `EllaMapFace` dashes and dims a dot when the coffee is **not sellable**. The customer `/map`, `MapQuizStart` and `MapTrail` use the same face. I propose an optional prop (default = today's behaviour, so customer pages are unchanged). With it, the admin page dashes a dot that has no size and keeps sellability out of the dot style. Say if you would rather the admin face show both.

If you say go with no other answer, I take (a), roaster-only size, and the optional prop.

---

### Task 0 findings

#### 1. The 18 coffees (production; test DB is the same unless noted)

Lean is translated with item 2. "Writes" is what the seed would do: family or lean only where it differs; ring for every coffee, because there are no ring decisions yet. Roaster size uses the proposed cuts (4 and 5): rating 1 to 3 gives size 1, rating 4 gives 2, rating 5 gives 3. "Calc ring" is today's preview ring.

| Data 1 coffee | `coffees` row | Active | Roaster | Family now → Data 1 | Lean now → Data 1 | Ring (calc → decided) | Portal submitted, Sweetness | Size | Writes |
|---|---|---|---|---|---|---|---|---|---|
| Benchmark | 2905 Benchmark | yes | Joe Coffee | balanced_sweet = | side_a = | 0 → 0 | yes, 4 | 2 | ring |
| Half Moon | **none** (portal only: "Half Moon (Half Caff)") | | Joe Coffee | | | | yes (v2), 4 | | STOP |
| The Daily | 2907 The Daily | yes | Joe Coffee | chocolate_nutty = | none → middle | 2 → 1 | yes, 3 | 1 | lean, ring |
| Brazil | **none** (portal only: "Brazil") | | Joe Bean | | | | yes, 5 | | STOP |
| Fabricator | 2917 Fabricator House Roast | yes | Joe Bean | chocolate_nutty = | side_a = | 1 → 1 | yes, 5 | 3 | ring |
| Tiger Stripe | 2914 Tiger Stripe Espresso | yes | Joe Bean | chocolate_nutty = | side_a = | 1 → 2 | yes, 4 | 2 | ring |
| Blossom | 2916 Blossom Dark Roast | yes | Joe Bean | chocolate_nutty = | side_a = (**test: side_b**, so test gets a lean row) | 3 → 3 | yes, 3 | 1 | ring (+ lean on test) |
| The Waverly | 2936 The Waverly | yes | Joe Coffee | **none** → chocolate_nutty | none → side_a | not in preview (no family) → 3 | yes (v2), 4 | 2 | family, lean, ring |
| Nightcap Decaf | 2909 Nightcap Decaf | yes | Joe Coffee | **fruity** → chocolate_nutty | none → side_b | 3 → 1 | yes, 4 | 2 | family, lean, ring |
| Amsterdam | 2906 Amsterdam | yes | Joe Coffee | chocolate_nutty = | none → side_b | 2 → 2 | yes, 3 | 1 | lean, ring |
| Great Heights | **none** (portal only) | | Joe Coffee | | | | yes (v2), 3 | | STOP |
| Big City | 2908 Big City | yes | Joe Coffee | earthy = | none → side_a | 3 → 2 | yes, 2 | 1 | lean, ring |
| Indonesia | **none** (portal only: "Indonesia") | | Joe Bean | | | | yes, 2 | | STOP |
| Geometric | 2915 Geometric Filter Coffee | yes | Joe Bean | fruity = | side_a = | 2 → 1 | yes, 4 | 2 | ring |
| La Familia | 2903 Colombia La Familia Guarnizo | yes | Joe Coffee | **floral** → fruity | middle → side_b | 2 → 1 | yes, 5 | 3 | family, lean, ring |
| D.R. Congo | **none** (portal only: "D.R. Congo") | | Joe Bean | | | | yes, 5 | | STOP |
| Cafè Feminista | 2902 Cafè Feminista: Montze Olvera | yes | Joe Coffee | fruity = | middle = | 3 → 2 | yes, 4 | 2 | ring |
| The Village | 2904 The Village | yes | Joe Coffee | **fruity** → floral | side_b → side_a | 2 → 2 | yes, 4 | 2 | family, lean, ring |

Notes:
- The ids are the same on test and production (2902 to 2936), so the seed can address coffees by id and check the name. Several Data 1 names are short forms of the catalog name (Fabricator, Tiger Stripe, Blossom, Geometric, La Familia, Cafè Feminista).
- Three coffees change family (Nightcap Decaf, La Familia, The Village), and The Waverly gets its first one. A lane code is relative to the wedge (side_a/side_b name the neighbours), so their lean is rewritten in the same run. The seed writes family first, then lean.
- `setMatchArchetypeInTx` needs a `confidence` (`confidence_enum`: low, medium, high). The brief names none. I propose `low` for the four family writes ("assumption map"), source `manual`. Existing rows are untouched where the family matches.
- The Waverly having no family is the known catalog integrity #6 finding from brief 3. Data 1 resolves it.
- Nightcap Decaf: decaf is never sellable through the slot view (OT-126), so it places as not sellable. That has no effect on the admin page.

#### 2. `dial_wedge` sides (identical on test and production)

| Family | side_a | side_b |
|---|---|---|
| balanced_sweet (center) | chocolate_nutty | fruity |
| chocolate_nutty | fruity | earthy |
| fruity | chocolate_nutty | floral |
| earthy | chocolate_nutty | floral |
| floral | fruity | earthy |

Lanes: `dial_lane` side_a (1), middle (2), side_b (3). Translation used above: C&N toward Fruity = side_a, toward Earthy = side_b; Balanced toward C&N = side_a, toward Fruity = side_b; Fruity toward C&N = side_a, toward Floral = side_b; Earthy toward C&N = side_a; Floral toward Fruity = side_a. Data 3's Balanced "toward Fruity" is side_b; "toward C&N and middle" is side_a plus middle.

#### 3. Where ring, size and "placeable" are decided today, and the change I will make

Today, all inside `v_dial_placement_preview` (schema.sql around line 11030):
- **Input set** (`v_dial_placement_input`): active coffees whose `v_coffee.match_archetype` is an `is_archetype` family. No family means no row (The Waverly today).
- **Placeable** (`base` CTE): `wedge_id IS NOT NULL AND has_merged_row AND (is_center OR ruler_value IS NOT NULL)`. Cupping is required, which is the blocker for uncupped coffees.
- **Ring** (`ruled` CTE): center gives 0; otherwise the pooled ruler value against `dial_ring_cut_1/2`.
- **Size** (`ruled` CTE): pooled cupping Sweetness against `dial_size_cut_1/2`.
- **Grade**: no clean merged row gives `D`. `dial_placement.grade_id` is NOT NULL, so an uncupped coffee carries grade D, which is fine.
- `cutVersionInTx` copies every `is_placeable` preview row into `dial_placement`, which requires `ring` NOT NULL and lets `size` be NULL. It snapshots every `dial_` parameter into `dial_map_version.parameters` and writes `dial_ring_cut` / `dial_size_cut` from the cupping cuts.

The smallest change, which I will make (in the view only; `cutVersionInTx` stays as it is):
- `v_dial_placement_input`: add `roaster_sweetness`, read from `v_roastery_portal_coffee_hint.dimensions` by the `dimension_id` of `dial_reading` code `sweetness`, the same lookup the view already uses. No label is typed in.
- `base`: LEFT JOIN the current `coffee_ring_assignment`. Then `is_placeable = wedge_id IS NOT NULL AND ((has_merged_row AND (is_center OR ruler_value IS NOT NULL)) OR (lean decided AND ring decided))`. The family decision is implied by the input set. A cupped coffee with no decisions places exactly as today.
- `ruled`: `ring = COALESCE(decided ring, calculated ring)`, and the calculated value is kept as `suggested_ring`. `size` comes from `roaster_sweetness` against `dial_size_roaster_cut_1/2`, NULL without a rating (decision 2 above).
- `flags` gains `ring_decided` (and `dial_flag` gets its row, or integrity check 9 reports it). `inputs_used` gains a ring entry and a size source entry.
- `coffee_ring_assignment` stores `suggested_ring`, the calculated ring read from the preview at write time, the way `setLeanInTx` stores the lean suggestion. That is cheap, so I will do it (A4).
- `dataCatalogIntegrity.DIAL_PARAMETER_KEYS` gets the two new keys (check 10).
- Side effect, noted here and not fixed: `dial_size_cut` rows keep recording the cupping size cuts on every new version, while the roaster cuts are in the version's parameter snapshot. I will say so in the size cut's comment.

#### 4. `dial_first_match` and the grade floor

Current rows, the same on production and test: one row, id 1, balanced_sweet × side_a → Benchmark (2905), `founder_pick`, decided by `seed` on 2026-11-10.

The grade floor is a **parameter**: `dial_min_grade_rank_first_match` = 3 (grade B; D 1, C 2, B 3, A 4). It is read in three places:
- `setFirstMatchInTx` refuses a write below the floor. It also refuses a coffee with **no preview row** ("has no placement in the preview, so it has no grade"), so the seed must write the family, lean and ring decisions before the first matches.
- `dialReads.firstMatches` shows it on screen only (`meets_grade_floor_*`).
- `matchService.firstMatchFor` reads it from the **active version's** parameter snapshot.

The Data 3 picks on the production preview: Benchmark B, The Daily **C**, Fabricator B, Amsterdam B, Geometric A, La Familia **C**, Cafè Feminista B, The Village B. At floor 3 the writer would refuse The Daily and La Familia. Per the CTO call, the parameter goes to 1 (D). On production that is a parameter write, so it sits behind the Part E STOP. The seed sets it through the parameter writer, and it reaches `matchService` only with the next publish. No floor exists in code, so A5 adds no third parameter.

#### 5. Frontend as built

- `EllaMapFace` props: `placements` (FacePlacement: geometry fields plus `coffee_name`, `is_sellable`), `wedges`, `seams?`, `highlightCoffeeId?`, `hops?` ({to_coffee_id, relation}, drawn **only from the highlighted coffee**, with the dash pattern keyed by relation in a local map), `path?` (one polyline for the trail), `size` ('thumb'|'full'), `labelMode?` ('name'|'none'), `onTapCoffee?`. **It cannot draw a line between an arbitrary pair with a style per line**, so C1's `steps` prop is new work. I will draw it under the dots, with the style from `dial_step_basis.line_style` mapped to a dash pattern in the face, as chrome. A no-size dot is already drawn at the smallest radius (`dotRadius(null)` = 10). The dashed-dot clash is decision 3 above.
- Face users: `AdminEllaMap`, `MapPage`, `MapQuizStart`, `MapTrail`. The new props are optional, so the customer face is untouched.
- `mapGeometry.ts`: `layoutDots` fans out coffees that share a cell, in coffee_id order (the "fan-out" the acceptance note mentions). `cellPoint` places a dot by archetype, ring and lane. Nothing needs to change there.
- `EllaMapLegend` takes `sizes` and `families`. The admin legend needs line styles and the dashed dot added, through an optional prop.
- `lib/mapAdmin.ts` already has get/put helpers for placements (preview and active), hops, graph check, versions, wedges, first match, phrases, vocabulary, lean history, cut, activate, set first match and phrase, surfaces, decisions and customer copy. I will add steps, ring and publish beside them.
- Route: `App.tsx:153` `<Route path="map" element={<AdminEllaMap />} />`. C3 adds `map/advanced` for today's page, moved as is.

#### 6. The active version and who reads it

Production: **L0** (id 1), active since 2026-11-12 18:17 UTC, 12 placements (all Joe Coffee and Joe Bean). It is the only version. Every `dial_surface` row (customer_face, quiz_result, profile_trail, reorder_email, liam_context, qr_door, axis_stats) is on `lane`.

Readers of the active version besides `/admin/map` and the admin-only `/map`:
- **`routes/quiz.ts`**: every quiz completion calls `matchService.decide`, "whatever the quiz_result surface says". It writes `customer_match_decision` / `customer_match_candidate` against the active version and its first matches. This is a log; nothing renders it while `quiz_result` is on `lane`. After a publish, new quiz decisions are recorded against L1 and the Data 3 founder picks. Not customer facing, so not a STOP, but you should know that this write changes.
- `routes/beats.ts` `?move=`: links only exist in emails sent while `reorder_email` is `map`, so none exist.
- `routes/cron.ts` `dialInMapButtons`: gated by `surfaceIsMap('reorder_email')`, which is false.
- Integrity checks 8 (placements on inactive coffees) and 11 (current positions on a coffee not placed in the active version). Production has 2 current match decisions, Tiger Stripe and Benchmark, both on L0, and both are in Data 1. Check 11 stays clean after L1.

Nothing customer facing changes when a new version is activated. No STOP here.

#### 7. Utopian (report only)

Roaster `Utopian` is inactive, and all 10 of its coffees (2891, 2927 to 2935) are inactive on production and test. None is placed in L0. Because the input set takes only active coffees, none can be placed in a new version either. Seven have submitted portal responses; they stay as received.

---

### Plan for Part A once you say go (no change to the brief beyond the three decisions)

Per the brief: A1 `dial_step_basis`, A2 `dial_step`, A3 `coffee_ring_assignment` (+ `v_coffee_ring_assignment_history`, beside the lean history view), A4 as in item 3, A5 the two roaster cuts, A6 `v_dial_step`. B1 to B5: the seed script declared as `backfill:ellaMapDecided_2026_11_16`, entering family, then lean, ring, the floor parameter, first match and steps, and skipping rows for the five missing coffees with a printed list. C, D, then E with its STOP before production.

---

## Appendix: production dry run, fact by fact

Ella map 5 seed, DRY RUN on axisandbloom (2026-11-16T17:16:43.061Z)

Plan: 61 write, 16 unchanged, 29 skipped.
No active coffees row (skipped with their facts and steps): Half Moon, Brazil, Great Heights, Indonesia, D.R. Congo.

### family (4 write)

| subject | now | next | action |
|---|---|---|---|
| Benchmark (2905) | balanced_sweet | balanced_sweet | same |
| Half Moon |  | balanced_sweet | skip (no active coffees row) |
| The Daily (2907) | chocolate_nutty | chocolate_nutty | same |
| Brazil |  | chocolate_nutty | skip (no active coffees row) |
| Fabricator (2917) | chocolate_nutty | chocolate_nutty | same |
| Tiger Stripe (2914) | chocolate_nutty | chocolate_nutty | same |
| Blossom (2916) | chocolate_nutty | chocolate_nutty | same |
| The Waverly (2936) | (none) | chocolate_nutty | write |
| Nightcap Decaf (2909) | fruity | chocolate_nutty | write |
| Amsterdam (2906) | chocolate_nutty | chocolate_nutty | same |
| Great Heights |  | chocolate_nutty | skip (no active coffees row) |
| Big City (2908) | earthy | earthy | same |
| Indonesia |  | earthy | skip (no active coffees row) |
| Geometric (2915) | fruity | fruity | same |
| La Familia (2903) | floral | fruity | write |
| D.R. Congo |  | fruity | skip (no active coffees row) |
| Cafè Feminista (2902) | fruity | fruity | same |
| The Village (2904) | fruity | floral | write |

### lean (7 write)

| subject | now | next | action |
|---|---|---|---|
| Benchmark (2905) | side_a | side_a | same |
| Half Moon |  | side_a | skip (no active coffees row) |
| The Daily (2907) | (none) | middle | write |
| Brazil |  | middle | skip (no active coffees row) |
| Fabricator (2917) | side_a | side_a | same |
| Tiger Stripe (2914) | side_a | side_a | same |
| Blossom (2916) | side_a | side_a | same |
| The Waverly (2936) | (none) | side_a | write |
| Nightcap Decaf (2909) | (none) | side_b | write |
| Amsterdam (2906) | (none) | side_b | write |
| Great Heights |  | side_b | skip (no active coffees row) |
| Big City (2908) | (none) | side_a | write |
| Indonesia |  | middle | skip (no active coffees row) |
| Geometric (2915) | side_a | side_a | same |
| La Familia (2903) | middle | side_b | write |
| D.R. Congo |  | middle | skip (no active coffees row) |
| Cafè Feminista (2902) | middle | middle | same |
| The Village (2904) | side_b | side_a | write |

### ring (13 write)

| subject | now | next | action |
|---|---|---|---|
| Benchmark (2905) | (none) | 0 | write |
| Half Moon |  | 0 | skip (no active coffees row) |
| The Daily (2907) | (none) | 1 | write |
| Brazil |  | 1 | skip (no active coffees row) |
| Fabricator (2917) | (none) | 1 | write |
| Tiger Stripe (2914) | (none) | 2 | write |
| Blossom (2916) | (none) | 3 | write |
| The Waverly (2936) | (none) | 3 | write |
| Nightcap Decaf (2909) | (none) | 1 | write |
| Amsterdam (2906) | (none) | 2 | write |
| Great Heights |  | 3 | skip (no active coffees row) |
| Big City (2908) | (none) | 2 | write |
| Indonesia |  | 2 | skip (no active coffees row) |
| Geometric (2915) | (none) | 1 | write |
| La Familia (2903) | (none) | 1 | write |
| D.R. Congo |  | 1 | skip (no active coffees row) |
| Cafè Feminista (2902) | (none) | 2 | write |
| The Village (2904) | (none) | 2 | write |

### parameter (1 write)

| subject | now | next | action |
|---|---|---|---|
| dial_min_grade_rank_first_match | 3 | 1 | write |

### first_match (14 write)

| subject | now | next | action |
|---|---|---|---|
| balanced_sweet x side_a | Benchmark (2905, founder_pick) | Benchmark (2905) | same |
| balanced_sweet x middle | (none) | Benchmark (2905) | write |
| balanced_sweet x side_b | (none) | La Familia (2903) | write |
| chocolate_nutty x middle | (none) | The Daily (2907) | write |
| chocolate_nutty x side_a | (none) | Fabricator (2917) | write |
| chocolate_nutty x side_b | (none) | Amsterdam (2906) | write |
| earthy x side_a | (none) | Amsterdam (2906) | write |
| earthy x middle | (none) | Amsterdam (2906) | write |
| earthy x side_b | (none) | Amsterdam (2906) | write |
| fruity x side_a | (none) | Geometric (2915) | write |
| fruity x middle | (none) | Cafè Feminista (2902) | write |
| fruity x side_b | (none) | Cafè Feminista (2902) | write |
| floral x side_a | (none) | The Village (2904) | write |
| floral x middle | (none) | The Village (2904) | write |
| floral x side_b | (none) | The Village (2904) | write |

### step (22 write)

| subject | now | next | action |
|---|---|---|---|
| #1 Benchmark -> The Daily | (none) | "Bolder" / "The same chocolate, livelier, with a bit more bite." / roaster_said | write |
| #1 The Daily -> Benchmark | (none) | "Lighter" / "Rounder, pure chocolate." / roaster_said | write |
| #2 The Daily -> Amsterdam | (none) | "Bolder" / "Darker and smoother, with less acidity." / recipe_or_ratings | write |
| #2 Amsterdam -> The Daily | (none) | "Lighter" / "Lighter and sweeter." / recipe_or_ratings | write |
| #3 Amsterdam -> Great Heights |  | "Bolder" / "The same Brazil, roasted darker." / recipe_or_ratings | skip (no active coffees row for Great Heights) |
| #3 Great Heights -> Amsterdam |  | "Lighter" / "A lighter roast, with more caramel." / recipe_or_ratings | skip (no active coffees row for Great Heights) |
| #4 Great Heights -> Big City |  | "Bolder" / "French roast and burnt sugar." / roaster_said | skip (no active coffees row for Great Heights) |
| #4 Big City -> Great Heights |  | "Lighter" / "Less smoke, more fudge." / roaster_said | skip (no active coffees row for Great Heights) |
| #5 Benchmark -> La Familia | (none) | "Brighter" / "Caramel and honey with a little clementine. Lighter in the cup." / recipe_or_ratings | write |
| #5 La Familia -> Benchmark | (none) | "More body" / "Pure chocolate, rounder, less fruit." / recipe_or_ratings | write |
| #6 La Familia -> The Village | (none) | "More delicate" / "More floral and more citrus." / roaster_said | write |
| #6 The Village -> La Familia | (none) | "Sweeter" / "Caramel and honey, softer." / roaster_said | write |
| #7 The Village -> Cafè Feminista | (none) | "More tropical" / "Papaya and candied coconut, creamier." / roaster_said | write |
| #7 Cafè Feminista -> The Village | (none) | "More delicate" / "More floral, with grapefruit." / roaster_said | write |
| #8 Fabricator -> Geometric | (none) | "More fruit" / "The same family with more fruit, and sweeter." / roaster_said | write |
| #8 Geometric -> Fabricator | (none) | "Less fruit" / "Drier and nuttier." / roaster_said | write |
| #9 Fabricator -> Brazil |  | "Simpler" / "The base on its own: chocolate, almond, honey." / recipe_or_ratings | skip (no active coffees row for Brazil) |
| #9 Brazil -> Fabricator |  | "More going on" / "Adds citrus and spice." / recipe_or_ratings | skip (no active coffees row for Brazil) |
| #10 Brazil -> Blossom |  | "Bolder" / "A darker roast with a fuller body." / recipe_or_ratings | skip (no active coffees row for Brazil) |
| #10 Blossom -> Brazil |  | "Lighter" / "Lighter, plain chocolate." / recipe_or_ratings | skip (no active coffees row for Brazil) |
| #11 Blossom -> Tiger Stripe | (none) | "Brighter" / "A lighter roast with more fruit." / roaster_said | write |
| #11 Tiger Stripe -> Blossom | (none) | "Bolder" / "A darker roast with a fuller body." / roaster_said | write |
| #12 Tiger Stripe -> Geometric | (none) | "More fruit" / "More fruit, and sweeter." / recipe_or_ratings | write |
| #12 Geometric -> Tiger Stripe | (none) | "More body" / "More chocolate and body." / recipe_or_ratings | write |
| #13 Half Moon -> Nightcap Decaf |  | "No caffeine" / "Almond, molasses, cola." / roaster_said | skip (no active coffees row for Half Moon) |
| #13 Nightcap Decaf -> Half Moon |  | "Half the caffeine" / "Walnut and toffee." / roaster_said | skip (no active coffees row for Half Moon) |
| #14 La Familia -> Geometric | (none) | "More body, keep the fruit" / "Bright fruit over caramel, with more weight." / our_guess | write |
| #14 Geometric -> La Familia | (none) | "Lighter" / "Sweeter and lighter: caramel and honey." / our_guess | write |
| #15 Benchmark -> Fabricator | (none) | "More going on" / "Hazelnut, a little citrus, a dry finish." / our_guess | write |
| #15 Fabricator -> Benchmark | (none) | "Rounder" / "Pure chocolate, softer, no citrus." / our_guess | write |
| #16 Tiger Stripe -> The Waverly | (none) | "More fruit" / "Fig and orange over dark chocolate." / our_guess | write |
| #16 The Waverly -> Tiger Stripe | (none) | "Less fruit" / "Chocolate first, cherry behind." / our_guess | write |
| #17 D.R. Congo -> Geometric |  | "More body" / (destination notes) / our_guess | skip (no active coffees row for D.R. Congo) |
| #17 Geometric -> D.R. Congo |  | "Lighter" / (destination notes) / our_guess | skip (no active coffees row for D.R. Congo) |
| #18 Blossom -> Indonesia |  | "Earthier" / (destination notes) / our_guess | skip (no active coffees row for Indonesia) |
| #18 Indonesia -> Blossom |  | "Cleaner" / (destination notes) / our_guess | skip (no active coffees row for Indonesia) |
