# Closing report 6: the five coffees that are not in the catalog yet

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_6_FIVE_COFFEES.md`. **Status 2026-11-16: Parts B to D built, Part E step 1 done on the test DB; STOPPED at the Part E production STOP.** Nothing written to production; nothing committed or pushed (a push deploys).

Dana's answers (2026-11-16): the note table as it stands; the four roaster picks as-is; Great Heights: Chocolate; `remember: false` for all five; the acceptances recorded under her admin profile (Dana-Admin). No note was left out.

---

## Part E: the production dry runs (read-only, 2026-11-17 01:51 UTC)

### 1. The acceptance script

`npx tsx src/scripts/ellaMapFiveCoffees_2026_11_16.ts --dry-run --expect-db axisandbloom` (`BEGIN READ ONLY`):

Ella map 6, five coffees, DRY RUN on axisandbloom (2026-11-17T01:51:22.267Z); actor: the Dana-Admin profile (cptmb6…)

Plan: 5 accept, 0 skipped.

| coffee | action | response (version, submitted) | origin | process | roast | blend or single | caffeine | note | wheel term |
|---|---|---|---|---|---|---|---|---|---|
| Half Moon | accept | 8333fa32-7f9f-4c3d-aded-a3c7dd38af22 (v2, 2026-10-13) | Cerrado, Minas Gerais, Brazil \| Chiapas, Mexico | washed | medium | blend | half_caff | 1: Walnut, Sticky Toffee Pudding, Vanilla Bean | Vanilla (Sweet; roaster pick; remember false) |
| Great Heights | accept | e5316179-61d4-4b4c-b2c3-60e2cc5cbdfe (v2, 2026-10-13) | Cerrado, Minas Gerais, Brazil | natural | dark | single | regular | 1: Chocolate Fudge, Molasses, Cinnamon | Chocolate (Nutty / Cocoa; approved by Dana; remember false) |
| Brazil | accept | df0ab2c7-fa76-48eb-8e5b-001c0866e639 (v1, 2026-10-14) | Grown By Women Producers In The Mogiana Region of Brazil | natural | medium | single | regular | 1: Chocolate, Almond, Honey, Dried Fruits | Chocolate (Nutty / Cocoa; roaster pick; remember false) |
| Indonesia | accept | ecc164b1-6951-459e-bdc9-ca4122466a18 (v1, 2026-10-14) | Sumatra | wet-hulled | medium | single | regular | 1: Dark Chocolate, Apricot, Caramel, Raisin, Cedar | Dark Chocolate (Nutty / Cocoa; roaster pick; remember false) |
| D.R. Congo | accept | 5386b77b-148f-402c-a3a7-f6c874ae03d1 (v1, 2026-10-14) | Democratic Republic of the Congo Katanda | washed | medium | single | regular | 1: Clementine, Nectarine, Caramel, Light Chocolate | Orange (Fruity; roaster pick; remember false) |

Each acceptance creates an active `coffees` row with the lineup name, links the lineup coffee, and writes the basics above (Half Moon's caffeine gives the category `half_caf`; regular gives nothing). It sets `flavor_descriptors_roaster` to the note's words, adds one roaster descriptor with the term, and logs one `roastery_portal_acceptance` row (`created_coffee` true, accepted by Dana-Admin). No family, slot, SKU, price or remembered mapping.

### 2. The brief 5 seed

`--dry-run --expect-db axisandbloom` **before** the acceptance: **0 write, 77 unchanged, 29 skipped**. The 29 skipped rows are exactly what it will write once the five exist. On the test DB the same seed went from these 29 skips to 29 writes after the acceptance, plus one test-only row (see Evidence). They are:

| Section | Rows |
|---|---|
| family | Half Moon balanced_sweet, Brazil chocolate_nutty, Great Heights chocolate_nutty, Indonesia earthy, D.R. Congo fruity |
| lean | Half Moon side_a, Brazil middle, Great Heights side_b, Indonesia middle, D.R. Congo middle |
| ring | Half Moon 0, Brazil 1, Great Heights 3, Indonesia 2, D.R. Congo 1 |
| steps | 14: pairs 3, 4, 9, 10, 13, 17, 18 in both directions |

The skipped rows as printed on production:

| subject | now | next | action |
|---|---|---|---|
| Half Moon |  | balanced_sweet | skip (no active coffees row) |
| Brazil |  | chocolate_nutty | skip (no active coffees row) |
| Great Heights |  | chocolate_nutty | skip (no active coffees row) |
| Indonesia |  | earthy | skip (no active coffees row) |
| D.R. Congo |  | fruity | skip (no active coffees row) |
| Half Moon |  | side_a | skip (no active coffees row) |
| Brazil |  | middle | skip (no active coffees row) |
| Great Heights |  | side_b | skip (no active coffees row) |
| Indonesia |  | middle | skip (no active coffees row) |
| D.R. Congo |  | middle | skip (no active coffees row) |
| Half Moon |  | 0 | skip (no active coffees row) |
| Brazil |  | 1 | skip (no active coffees row) |
| Great Heights |  | 3 | skip (no active coffees row) |
| Indonesia |  | 2 | skip (no active coffees row) |
| D.R. Congo |  | 1 | skip (no active coffees row) |
| #3 Amsterdam -> Great Heights |  | "Bolder" / "The same Brazil, roasted darker." / recipe_or_ratings | skip (no active coffees row for Great Heights) |
| #3 Great Heights -> Amsterdam |  | "Lighter" / "A lighter roast, with more caramel." / recipe_or_ratings | skip (no active coffees row for Great Heights) |
| #4 Great Heights -> Big City |  | "Bolder" / "French roast and burnt sugar." / roaster_said | skip (no active coffees row for Great Heights) |
| #4 Big City -> Great Heights |  | "Lighter" / "Less smoke, more fudge." / roaster_said | skip (no active coffees row for Great Heights) |
| #9 Fabricator -> Brazil |  | "Simpler" / "The base on its own: chocolate, almond, honey." / recipe_or_ratings | skip (no active coffees row for Brazil) |
| #9 Brazil -> Fabricator |  | "More going on" / "Adds citrus and spice." / recipe_or_ratings | skip (no active coffees row for Brazil) |
| #10 Brazil -> Blossom |  | "Bolder" / "A darker roast with a fuller body." / recipe_or_ratings | skip (no active coffees row for Brazil) |
| #10 Blossom -> Brazil |  | "Lighter" / "Lighter, plain chocolate." / recipe_or_ratings | skip (no active coffees row for Brazil) |
| #13 Half Moon -> Nightcap Decaf |  | "No caffeine" / "Almond, molasses, cola." / roaster_said | skip (no active coffees row for Half Moon) |
| #13 Nightcap Decaf -> Half Moon |  | "Half the caffeine" / "Walnut and toffee." / roaster_said | skip (no active coffees row for Half Moon) |
| #17 D.R. Congo -> Geometric |  | "More body" / (destination notes) / our_guess | skip (no active coffees row for D.R. Congo) |
| #17 Geometric -> D.R. Congo |  | "Lighter" / (destination notes) / our_guess | skip (no active coffees row for D.R. Congo) |
| #18 Blossom -> Indonesia |  | "Earthier" / (destination notes) / our_guess | skip (no active coffees row for Indonesia) |
| #18 Indonesia -> Blossom |  | "Cleaner" / (destination notes) / our_guess | skip (no active coffees row for Indonesia) |

### 3. On your yes, in this order

1. Commit (files by path only) and push. This deploys the `acceptResponseInTx` split and the script; there is no schema change. Then check the deploy and the startup log.
2. Run the acceptance script `--dry-run` again (expect the same 5 accepts), then `--apply --expect-db axisandbloom` (one transaction for the five).
3. Run the seed `--dry-run` (expect **29 write**, 77 unchanged, 0 skipped; if it shows anything else, I stop), then `--apply`.
4. Publish "L2 assumption map, 18 coffees" (`dialPlacementService.publish`, as for L1).
5. Read back: 18 placements, 18 lines, 36 step rows, and the five responses' hashes unchanged. Then commit and push the docs. `CATALOG.md` is not regenerated because no comment changed.

---

## What was built

- **`roasteryPortalService.acceptResponseInTx`:** the accept body, unchanged, now runs inside a caller's transaction. `acceptResponse` calls it in its own transaction, so the admin route behaves as before (G3.9: a parameter, not a fork). The existing tests still pass: `roasteryPortalAccept`, `roasteryPortalPart3`, `roasteryPortal` and `dialMap5`, 57 in all.
- **`backend/src/scripts/ellaMapFiveCoffees_2026_11_16.ts`:**
  - The approved note table is data in the script (`FIVE`).
  - It plans each coffee through `roasteryPortalReads.getLineup` and `getCurrentResponse`, because the portal lint allows no direct read.
  - Each roaster pick must still be the approved term, or the plan stops.
  - The actor is the one admin profile named Dana-Admin; the script refuses if there is not exactly one.
  - `--dry-run`, `--apply` and `--expect-db` work as they do in the seed.
- **Seed:** unchanged. Its Data 1 already names the five lineup names.
- **Tests:** `dialMap6.test.ts`, 2 cases (see Evidence).

## Evidence (test DB, 2026-11-16/17)

- **Acceptance script:** the dry run planned 5 accepts. `--apply` created Half Moon 4299, Great Heights 4300, Brazil 4301, Indonesia 4302 and D.R. Congo 4303, each `created_coffee` true and accepted by Dana-Admin. A second dry run skipped all 5 ("already linked").
- **Seed:** the dry run showed **30 writes**: the 29 above plus Blossom's ring going back from 2 to 3. That 2 was drift left on the test DB by brief 5's acceptance; production has ring 3. `--apply` wrote 30; a rerun plans 0 write, 106 unchanged, 0 skipped.
- **Step 16:** brief 5's acceptance had also hidden it in both directions on the test DB. I switched it back to shown with `setStep` before publishing (test DB only, `tmp/em6_restore16.mts`).
- **Published "L2 assumption map, 18 coffees"** (version 55 on the test DB): **18 placements, 36 current step rows, all 36 on the map, 18 lines, no dashed dot.** The five, all grade D (no cupping linked) and placed by decision:

  | Coffee | Family | Ring | Lean | Size |
  |---|---|---|---|---|
  | Half Moon | balanced_sweet | 0 | side_a | 2 |
  | Brazil | chocolate_nutty | 1 | middle | 3 |
  | Great Heights | chocolate_nutty | 3 | side_b | 1 |
  | Indonesia | earthy | 2 | middle | 1 |
  | D.R. Congo | fruity | 1 | middle | 3 |

- **Catalog rows:** basics as the roaster stated them; Half Moon has `half_caf`; descriptors Vanilla (Half Moon), Chocolate (Great Heights), Chocolate (Brazil), Dark Chocolate (Indonesia), Orange (D.R. Congo); 0 slots, 0 SKUs, 0 prices.
- **Responses unchanged (G2.20):** the md5 of each response row with its notes and dimensions is identical on the test DB (accepted) and production (untouched): Brazil `ab11e149…`, D.R. Congo `f11056ce…`, Great Heights `6f55250b…`, Half Moon `38612dd0…`, Indonesia `457eabc3…`. Each has exactly one `roastery_portal_acceptance` row.
- **Browser:** marked Zzz test admin on the test DB, demoted and disabled afterwards; backend :4917, Vite :5174.
  - `/admin/map` shows "L2 assumption map, 18 coffees" with **18 dots and 18 lines: 7 solid (roaster said), 6 dashed (recipe or ratings), 5 dotted (our guess)**.
  - There are 36 step rows, no dashed dot, and the line "Every decision is on the published map".
  - The bolder ladder Benchmark, The Daily, Amsterdam, Great Heights, Big City is steps 1 to 4, all drawn. Screenshot `map6_admin_L2.png`.
- **Steps 17 and 18 (no customer line):**
  - The table row shows the word, the destination and the basis; the table never shows customer lines.
  - Opened, the line box is empty with the placeholder "The one thing that changes (empty: the destination's notes)".
  - The step back reads "Lighter → D.R. Congo" with no line under it (`map6_admin_step17.png`).
  - The customer-page brief shows the destination's signature notes in that place.
- **Customer side:** the Bloom page renders as before (`map6_bloom_page.png`, Floral, the lane dial). `/api/coffees/other-categories` does not return Half Moon. Every `dial_surface` row is `lane`, and no slot, SKU or price row was written.
- **Checks:** `tsc --noEmit` clean; all six lints clean; `dialMap6` 2/2; `dialMap5` and the portal accept tests 57/57.

## Deviations

1. **`acceptResponseInTx`:** the brief says the script "calls `acceptResponse`". It calls the in-transaction form instead, so the five go in one transaction and the test can roll back. Same body, same door.
2. **Test-DB drift corrected:** Blossom's ring (by the seed) and step 16 (by `setStep`), both left by brief 5's acceptance. Production has neither.
3. **Task 0 item 4 corrected:** Half Moon is listed on no customer page (see the correction below).

---

## Task 0 as written before the go

### The note table (approved by Dana 2026-11-16 as it stands)

Each of the five has **one** roaster note (rank 1): the whole list the roaster typed in one field. `acceptResponse` gives a note one wheel term. **None of the five notes has a remembered mapping** (`roastery_portal_note_mapping`, roaster, current). Four have a wheel term **the roaster picked themselves** in the portal; the brief's CTO call names only "remembered" and "proposed", so this third source needs your yes too (see the first point below the table).

| Coffee | Note (as the roaster typed it) | Wheel term | Source |
|---|---|---|---|
| Brazil | Chocolate, Almond, Honey, Dried Fruits | Chocolate (Nutty / Cocoa › Cocoa) | proposed: the roaster's own pick |
| D.R. Congo | Clementine, Nectarine, Caramel, Light Chocolate | Orange (Fruity › Citrus Fruit) | proposed: the roaster's own pick |
| Great Heights | Chocolate Fudge, Molasses, Cinnamon | Chocolate (Nutty / Cocoa › Cocoa) | proposed (the roaster picked none) |
| Half Moon (Half Caff) | Walnut, Sticky Toffee Pudding, Vanilla Bean | Vanilla (Sweet) | proposed: the roaster's own pick |
| Indonesia | Dark Chocolate, Apricot, Caramel, Raisin, Cedar | Dark Chocolate (Nutty / Cocoa › Cocoa) | proposed: the roaster's own pick |

Why these:
- **The four roaster picks:** `acceptResponse` already defaults a note to the roaster's own pick when no term is sent, and every one of the 14 earlier Joe Coffee and Joe Bean acceptances on production used the roaster's pick as the term (or words only when there was none). Taking the pick keeps the roaster's choice as received (G2.20 in spirit) and matches the precedent.
- **Great Heights:** "Chocolate Fudge" leads the list and Data 1 places it in Chocolate & Nutty; `Chocolate` is the same term the roaster picked for Brazil, from which Great Heights is roasted darker (step 3). Alternative: **words only** (no term), as The Village, Cafè Feminista and La Familia were accepted. Words only still keeps the roaster's words on the coffee (`flavor_descriptors_roaster`), but gives it no roaster descriptor row.

Three more answers I need with the table:
1. **Roaster picks count as "remembered"?** Yes means the four go in with the roaster's term, like the 14 before. No means I treat all five as proposals (the table above is then the proposal as it stands).
2. **`remember: true`?** The brief asks for it on a newly approved mapping. These notes are whole lists, so the remembered key would be the full list ("chocolate, almond, honey, dried fruits"), which only ever prefills that exact list again. None of the 14 earlier acceptances remembered one; production has 67 current roaster mappings, 2 of them lists. I recommend **no** (`remember: false`), as before. Say yes if you want them remembered anyway.
3. **Actor:** your admin profile resolves uniquely by name ("Dana-Admin", the actor of every earlier acceptance), so per the CTO call the five acceptances would be recorded under it. That records your profile on a run you approve but do not click; the alternative is a NULL admin profile and the actor string `script:ellaMapFiveCoffees`. I will use your profile unless you say otherwise.

---

### Task 0 findings

#### 1. The five on production (test DB identical, row for row)

All five lineup coffees are active, `coffee_id` NULL, no open draft, **no acceptance yet**. Latest submitted response each:

| Coffee | Roaster | Portal coffee | Response (version, submitted) | Origin | Process | Roast | Blend or single | Caffeine |
|---|---|---|---|---|---|---|---|---|
| Brazil | Joe Bean Roasters | `97700404…` | `df0ab2c7…` (v1, 2026-10-14) | Grown By Women Producers In The Mogiana Region of Brazil | natural | medium | single | regular |
| D.R. Congo | Joe Bean Roasters | `5c3d0417…` | `5386b77b…` (v1, 2026-10-14) | Democratic Republic of the Congo Katanda | washed | medium | single | regular |
| Indonesia | Joe Bean Roasters | `aadf6c22…` | `ecc164b1…` (v1, 2026-10-14) | Sumatra | wet-hulled | medium | single | regular |
| Great Heights | Joe Coffee Company | `89da39f1…` | `e5316179…` (v2, 2026-10-13) | Cerrado, Minas Gerais, Brazil | natural | dark | single | regular |
| Half Moon (Half Caff) | Joe Coffee Company | `4c0de469…` | `8333fa32…` (v2, 2026-10-13) | Cerrado, Minas Gerais, Brazil \| Chiapas, Mexico | washed | medium | blend | half_caff |

Basics per the CTO call (every one filled in, as stated): all five fields for all five coffees. They pass acceptance's own checks: `natural`, `washed` and `wet-hulled` are in the `process` vocabulary; caffeine `half_caff` maps to the existing category `half_caf` (Half Moon); `regular` applies nothing. The roaster's proposed family, their 1 to 5 ratings and brewing are never copied by acceptance (by design); the Sweetness rating is read live from the response by the map once the portal coffee is linked.

#### 2. Notes and mappings

See the table above. Every note is rank 1; no remembered mapping matches any of the five (normalized as acceptance does: lower case, trimmed, single spaces).

#### 3. What `acceptResponse` writes when it creates a coffee (`roasteryPortalService.ts:804`)

One transaction, through `catalogService` only:
- `createCoffeeInTx`: a `coffees` row with **name = the lineup name** ("Half Moon (Half Caff)", "Great Heights", "Brazil", "Indonesia", "D.R. Congo"), `roaster_id`, and **`is_active = true`**. It refuses a duplicate active name for the roaster (none exists).
- Logs `catalog_change` (`createCoffee`), then **links the portal coffee**: `roastery_portal_coffee.coffee_id` = the new id (the one portal write acceptance makes; the response rows are untouched).
- `updateCoffeeInTx`: the ticked basics (`origin`, `process`, `roast_level`, `blend_or_single`), `category_codes` for caffeine (Half Moon gets `half_caf`), and `flavor_descriptors_roaster` = the included notes' words in order; logged.
- `setRoasterDescriptorsInTx`: one `roastery_coffee_descriptors` row per included note with a term (source response id kept); logged.
- `setNoteMappingInTx` only for a note sent with `remember: true`.
- One insert-only `roastery_portal_acceptance` row (`created_coffee` true, `applied` JSON, `accepted_by_admin_id`).

It writes **no family** (`coffee_archetype_assignment`), **no slot**, **no SKU**, **no price**. Confirmed in the code: none of those functions is called. Precedent: The Waverly was created this way on 2026-11-12 (`created_coffee` true).

#### 4. A new active coffee with no family, slot or SKU

**If the run stopped between the acceptance and the seed:**
- Boot: catalog integrity **check 6** ("every active coffee has a current match archetype") fails for the five, as it did for The Waverly from 2026-11-12 until brief 5. Report only; it never blocks (G2.18). No other catalog check is hit: they test slot assignments, and the five have none.
- Customers: the five are not sellable (no slot, no SKU), so Liam's candidate pool, the shop slots, carts and shipments never see them. Axis stats count only coffees with a family, so they are not counted yet. **Half Moon** is the one exception: it is active with the `half_caf` category, so `/api/coffees/other-categories` lists it and the Bloom page's "Other categories" section would show a **Half-Caf card marked "Unpriced"** (`OtherCategoryCard`). Behind the pre-launch curtain.

  **Correction (Part E, test DB):** this was wrong. `/api/coffees/other-categories` lists a category coffee only when it has a customer-facing name (the category's `customer_name` or a home slot name, OT-70), and Half Moon has neither, so the endpoint does not return it; the current Bloom page does not render category coffees at all. Half Moon is on no customer page.

**After the seed (the normal end of the run), lasting until the price brief:**
- Check 6 is clean again (the seed gives each a family).
- ~~Half Moon's "Unpriced" Half-Caf card stays on the Bloom page, and it also appears under Balanced in the flavor page's category list.~~ Corrected: Half Moon is listed nowhere (no category customer name, OT-70). None of the five shows on a customer page.
- Axis stats: Balanced +1, Chocolate & Nutty +2 (Brazil, Great Heights), Earthy +1, Fruity +1. Behind the curtain.
- The map's admin page only after the publish; every `dial_surface` row stays `lane`.

#### 5. The brief 5 seed for the five (reasoned from its code; it cannot run "as if" without the rows)

The seed resolves coffees by roaster and name; its Data 1 names already include all five lineup names ("Half Moon (Half Caff)" is listed beside "Half Moon"), so no change to the seed is needed. After the acceptance it would write **29 rows**, and everything else stays "same" on both databases:

| Section | Rows | What |
|---|---|---|
| family | 5 | Half Moon balanced_sweet, Brazil chocolate_nutty, Great Heights chocolate_nutty, Indonesia earthy, D.R. Congo fruity (confidence low, source manual) |
| lean | 5 | Half Moon side_a, Brazil middle, Great Heights side_b, Indonesia middle, D.R. Congo middle |
| ring | 5 | Half Moon 0, Brazil 1, Great Heights 3, Indonesia 2, D.R. Congo 1 |
| parameter | 0 | floor already 1 |
| first match | 0 | no Data 3 cell names one of the five |
| steps | 14 | pairs 3, 4, 9, 10, 13, 17, 18, both directions |

Placement after publish: all five are placeable by decision (none has cupping rows linked to a catalog coffee, so all five are grade D, flag `no_cupping_rows`, including Half Moon and Great Heights). Size from the roaster's Sweetness: Half Moon 4 → 2, Great Heights 3 → 1, Brazil 5 → 3, Indonesia 2 → 1, D.R. Congo 5 → 3, so **no dashed dot**. The map would hold 18 coffees and 18 lines; the bolder ladder Benchmark, The Daily, Amsterdam, Great Heights, Big City is steps 1 to 4, unbroken.

---

### Plan once you answer

Part B as the brief says: `backend/src/scripts/ellaMapFiveCoffees_2026_11_16.ts` calls `acceptResponse` once per coffee with the latest submitted response, all five basics, and the approved notes; skips and reports a portal coffee already linked; `--dry-run` and `--expect-db` like the seed. Then the brief 5 seed unchanged. Part D tests on the test DB (five created and linked, a second run creates nothing, the five response rows byte-for-byte unchanged). Part E: test DB run, "L2 assumption map, 18 coffees", acceptance, then the STOP with both production dry runs.
