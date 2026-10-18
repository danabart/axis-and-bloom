> **SUPERSEDED 2026-10-16, never executed.** Replaced by the v2 series in `backend/src/features/cupping_evidence/` (DESIGN_CUPPING_EVIDENCE.md + briefs 1, 2, 3). Kept for history only. Do not run.

# Cupping Evidence, brief 2: load the Joe Bean and Utopian cupping sessions, Utopian website notes, lineup links

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-16 (CTO session; decisions by Dana) · Model: Sonnet is fine
> Status: NOT EXECUTED · Depends on `cupping_joe_coffee/CLAUDE_CODE_PROMPT_CUPPING_JOE_COFFEE_1.md` Rev 2 (Parts A0 and A) being deployed. Do not start before `cuppingService.saveScore`, `mergeByRule`, `roastery_remark` with `channel = 'website'` and `lint:cupping` exist in main.
> Contract: `DESIGN_CUPPING_EVIDENCE.md` §5 (loading rules). Read it first. This brief is data only: no schema, no new table, no view, no placement, no SKU beyond the bare 12 oz row the importer requires, no change to any coffee that already has an archetype.

## What this is

Two more cuppings go into the evidence layer, per cupper, as written, with a rule-merged row per coffee:

1. **Joe Bean Roasters**, 2026-09-30, Dana + Camila, four blends on A&B 0 to 15 sheets. Source: `misc/roasteries/Joe Bean/Cupping 1 - Sep 2026/CUPPING_NOTES_Joe_Bean_2026-09-30.md` (transcribed 2026-10-14 from `Dana 1.jpg`, `Dana 2.jpg`, `Camila 1.jpg`, `Camila 2.jpg`).
2. **Utopian Coffee Co.**, three flights, Dana + Camila, ten coffees, two sheet formats. Source: `misc/roasteries/Utopian/CUPPING_NOTES.md` (transcribed 2026-10-16 from `IMG_3747` to `IMG_3755`). Utopian's own published notes come from `misc/roasteries/intake/Roaster_Intake_Utopian.xlsx` and go in as `roastery_remark` rows, `channel = 'website'`.

Every value below was transcribed from handwriting and checked. Load it as written; do not reinterpret a number or a word. The `match: close / far` verdicts and the "Patterns" section of the Utopian file are analysis, not evidence, and are **not** loaded (DESIGN §5.5).

## Decisions already made (Dana). Do not re-open.

1. One `cupping_scores` row per cupper per coffee, `is_merged = false`, then one rule-merged row through `cuppingService.mergeByRule(sessionCoffeeId, { n: 2 })`. Never a hand merge in this brief.
2. Ranges as written. A single mark is `min = max`. Several marks: the span, marks listed in `notes`. Crossed-out marks are not counted and are recorded in `notes` as `crossed: 4`. Struck-through words are kept in the text with a `~` prefix, as the notes files do.
3. Camila's **word scale** (Utopian flights B and C grids): low = 0 to 5, medium = 5 to 10, high = 10 to 15; the word stays in `notes` as `word scale: low`.
4. Camila's **0 to 5 grid integers** (Utopian flight A): `value × 3`, width 3 (`v×3 − 1` to `v×3 + 1`, clamped to 0 to 15): 0 → 0–1, 1 → 2–4, 2 → 5–7, 3 → 8–10, 4 → 11–13, 5 → 14–15; the integer stays in `notes` as `grid 0-5: 5`.
5. Dana's "two readings" on acidity (e.g. 3–4 and 6–8 lime) are one range spanning both, `notes` = `two readings: 3-4 and 6-8 (lime)`.
6. Dimension mapping (as brief 1): numeric Mouthfeel light to heavy = 7 Body; numeric Aftertaste short to long = 10 Finish Length; Mouthfeel words = 12; Aftertaste words = 11 Finish Character; Fragrance, Aroma, Flavor words = 1, 2, 3. The A&B sheet's numeric intensity on Fragrance / Aroma / Flavor is kept as text in the dimension's `notes` (`intensity 7-9: chocolate, almonds, ...`); dimensions 1 to 3 are free-text in the DB and this brief does not change that (open point in DESIGN §11).
7. Descriptors: every word with a wheel leaf also goes to `cupping_score_descriptors` by exact `cupping_note.descriptor`, `intensity` null, `custom_notes` = the sheet's words; two words on one leaf = one row, both words. Conventions carried from brief 1: berries / berry → Blueberry; nuts → Hazelnut; cocoa / milk chocolate / chocolate → Chocolate; spice(s) → Cinnamon; tea / black tea / green tea → Black Tea; burned / burnt / roast / roasty → Roast; citrus → Orange; dried fruits → Raisin; sugarcane / cane → Molasses; syrup → Maple Syrup. Words with no leaf (sweet, fruits, creamy, juicy, tea like, happy, BBQ chips, soy) stay in the text dimension only.
8. The cupper's blind call goes to the call columns (brief 1 Rev 2). An SCA family tick or circle is a `call_note`, not an archetype call. "Earthy" written under "Other" on the family line is a call note, not a call.
9. Each cupped coffee needs a `coffees` row. The nine new Utopian coffees and the four Joe Bean blends are created through the import manifest path, **unplaced**, with a bare `{ weightOz: 12 }` SKU (importer requirement; unplaced = invisible). Their match archetype is **provisional**: `confidence = 'low'` unless both cuppers made the same call (then `'medium'`), `source = 'cupping'`, and `notes` carries the basis line in the DESIGN §7.3 shape ending with `provisional, pending the calibration pass (DESIGN §7.4)`. Flying Jewel (coffee 2891) already exists and already has its assignment; it is not touched, its cupping rows attach to it.
10. Utopian's published notes are evidence from a fifth source and go to `roastery_remark` with `channel = 'website'`. Where a note maps cleanly to a wheel leaf the mapping is also remembered in `roastery_portal_note_mapping` so a future portal submission with the same words maps the same way. Joe Bean's and Joe Coffee's website text is not loaded here (not transcribed yet).
11. Nothing is deleted, superseded or re-merged. If a step fails midway, report what was written and stop.

## Task 0 (report, read-only; STOP only where it says so)

- `cuppingService.ts` exports `createSession`, `addSessionCoffee`, `saveScore`, `mergeByRule`; `roastery_remark.channel` accepts `'website'`; `lint:cupping` exists and is green. If any is missing, STOP: brief 1 Rev 2 has not landed.
- Roasters: `Joe Bean Roasters` and `Utopian Coffee Co.` exist and are active (report ids). Utopian lineup: ten active `roastery_portal_coffee` rows, Flying Jewel linked to coffee 2891, the other nine `coffee_id IS NULL`. Joe Bean lineup: seven active rows, the four blends below among them, all `coffee_id IS NULL`. If a lineup row for one of these thirteen coffees already has a `coffee_id`, STOP and report.
- `coffees` rows with `roaster_id` of either roastery: expected exactly one (2891). If more, STOP and report.
- `v_roastery_portal_coffee` prefill values (origin, process, roast level, blend/single, decaf) for the thirteen lineup rows: these are the manifest's prefill; report them next to the table in B1 and use the lineup's values where the two differ (the lineup came from the roaster's site through portal parts 1 and 6).
- `lookup_value` codes present for `roast_level`, `process`, `blend_or_single` (the importer validates against them; report which of `medium-light`, `medium-dark`, `double fermentation`, `co-ferment`, `mountain_water` exist). Where a value in B1 has no lookup code, use the lineup's stored value; if the lineup has none, pass null and report; never invent a code.
- Every `cupping_note` leaf named in sections B and C exists by exact `descriptor`. For a name that exists under a slightly different spelling, use the existing one and report the pair. For a name that does not exist at all (candidates: Pepper, Sweet Aromatics, Herb-like, Woody, Salty, Ashy, Tobacco), carry the word in the text dimension only and report it; do not STOP and do not create a leaf.
- `coffee_dial_slot` row for `fruity/1` (id, name, position_label): used once as `slot_call_id` (Pearl, Dana).
- `coffee_category.code = 'decaf'` active.
- Last-modified date of `misc/roasteries/intake/Roaster_Intake_Utopian.xlsx` (becomes `said_on` for the website remarks).

## PART A: catalog rows and lineup links

### A1. Manifest `backend/src/features/cupping_evidence/manifests/joe_bean_2026_09_30.json`

Roaster `Joe Bean Roasters`. No `home`, no `guests`, no `certify`. `skus: [{ "weightOz": 12 }]`. `flavorDescriptorsRoaster: []` (Joe Bean's notes arrive through portal acceptance). `categoryCodes: []`.

| name (as in the lineup) | blendOrSingle | roastLevel | process | origin | match.archetype | confidence | source | notes (basis line) |
|---|---|---|---|---|---|---|---|---|
| Tiger Stripe Espresso | blend | lineup value | lineup value | lineup value | chocolate_nutty | low | cupping | basis: cupping 2026-09-30 (Dana=chocolate_nutty "DEF"; Camila=no call, Nutty/Cocoa circled); roaster portal (Kathy Turiano 2026-10-14) see v_roastery_portal_current_response; A&B rule 2026-10-14: C&N blend with a fruity accent is plain C&N; provisional, pending the calibration pass (DESIGN §7.4) |
| Geometric Filter Coffee | blend | lineup value | lineup value | lineup value | balanced_sweet | medium | cupping | basis: cupping 2026-09-30 (Dana=balanced_sweet "DEF"; Camila=balanced_sweet); provisional, pending the calibration pass (DESIGN §7.4) |
| Blossom Dark Roast | blend | dark | lineup value | lineup value | earthy | low | cupping | basis: cupping 2026-09-30 (Dana=earthy, med-strong; Camila=no call, wrote Earthy under Other); roaster classifies bean-driven as C&N; A&B family rule is roast-driven (2026-10-16); Earthy vs C&N-bold left open 2026-10-14; provisional, pending the calibration pass (DESIGN §7.4) |
| Fabricator House Roast | blend | lineup value | lineup value | lineup value | fruity | low | cupping | basis: cupping 2026-09-30 (Dana=fruity light, "Balance" partly crossed out; Camila=no call, Fruity family ticked); provisional, pending the calibration pass (DESIGN §7.4) |

### A2. Manifest `backend/src/features/cupping_evidence/manifests/utopian_2026_09.json`

Roaster `Utopian Coffee Co.`. Same shape. Flying Jewel is **not** in the manifest. Prefill from the Utopian notes file, cross-checked against the lineup (Task 0); lineup wins on a difference.

| name (as in the lineup) | blendOrSingle | roastLevel | process | origin | categoryCodes | match.archetype | confidence | source | notes (basis line) |
|---|---|---|---|---|---|---|---|---|---|
| Espresso Volo | blend | medium-dark | washed, natural | | [] | earthy | medium | cupping | basis: cupping flight B (Dana=earthy "Light Earth"; Camila=earthy); website: Fragrant Berries, Cocoa, Sweet Tobacco; provisional, pending the calibration pass (DESIGN §7.4) |
| Peru Chirinos | single | light | washed | Chirinos, Cajamarca, Peru (Geisha) | [] | floral | low | cupping | basis: cupping flight A 2026-09-13 (Dana=no call, jasmine/tea; Camila=floral); website: Mango Puree, Narcissi, Honeycomb; provisional, pending the calibration pass (DESIGN §7.4) |
| Obsidian | blend | dark | washed | | [] | earthy | medium | cupping | basis: cupping flight B (Dana=earthy; Camila=earthy "Standard"); website: Palo Santo, Campfire 'Mallows, Mrs. Buttersworth; provisional, pending the calibration pass (DESIGN §7.4) |
| Decaf Mexico Veracruz | single | medium | washed | Veracruz, Mexico | [decaf] | balanced_sweet | low | cupping | basis: cupping flight B (Dana=balanced_sweet, "choc & nut" struck; Camila=chocolate_nutty); cuppers disagree; website: Red Apple, Flaky Croissant, Walnut Butter; provisional, pending the calibration pass (DESIGN §7.4) |
| Peru Joel Silva | single | medium-light | natural | Chirinos, Cajamarca, Peru | [] | fruity | low | cupping | basis: cupping flight A 2026-09-13 (Dana=no call, citrus/orange; Camila=fruity); website: Ground Cherry, Ube Halo Halo, Crunchy Sweetness; provisional, pending the calibration pass (DESIGN §7.4) |
| Mexico Alva Flores | single | medium | washed | Santa Cruz Ozolotepec, Oaxaca, Mexico | [] | fruity | low | cupping | basis: cupping flight A 2026-09-13 (no call from either cupper; both wrote berries / black tea); website: Black Plum, Honeycomb, Champorado; lot was end-of-run; provisional, pending the calibration pass (DESIGN §7.4) |
| Pearl | blend | light | washed, natural | | [] | fruity | low | cupping | basis: cupping flight C (Dana=fruity, "Bloom dial: light fruity"; Camila=no call, Floral family ticked); largest cupper disagreement of the session; website: Citrusy, Bright, Sweet, juicy fruit with a backbone of chocolate; provisional, pending the calibration pass (DESIGN §7.4) |
| Union | blend | medium | washed | | [] | balanced_sweet | medium | cupping | basis: cupping flight C (Dana=balanced_sweet; Camila=balanced_sweet, "limit of floral and fruity"); website: Smooth, caramel sauce, buttered pastry, pistachio (roaster reads it Balanced; Dana unsure, 2026-10-16); zero descriptor overlap; provisional, pending the calibration pass (DESIGN §7.4) |
| Colombia Andres Martinez | single | medium-light | double fermentation | Cauca, Colombia | [] | fruity | low | cupping | basis: cupping flight A 2026-09-13 (no call from either cupper; both wrote dried fruit / berries / citrus); website: Fragrant Jasmine, Green Melon, Almond Butter; lot was end-of-run; provisional, pending the calibration pass (DESIGN §7.4) |

Run both manifests with `npm run catalog:import` dry run on the test DB, then apply, then the same on prod. `runCatalogIntegrityChecks().allPass` must be true after each apply. Report every warning.

### A3. Lineup links
`linkLineupCoffeeToCatalog(portalCoffeeId, coffeeId)` for the four Joe Bean rows and the nine Utopian rows. Afterwards `v_roastery_portal_coffee` shows Joe Bean 4 of 7 linked (the three single origins stay unlinked: not cupped, no catalog row) and Utopian 10 of 10.

## PART B: Joe Bean, session 2026-09-30

### B1. Session
`createSession({ sessionDate: '2026-09-30', brewMethod: 'cupping', location: null, sessionNotes: 'Joe Bean Roasters, cupping 1. Dana + Camila. Four blends, blind codes TIGER / GEOMETRIC / BLOSSOM / FABRICATION. A&B 0 to 15 sheets; ratio, grind, water temp, steep, cups not recorded. Sheets 3 and 4 (Brazil, Indonesia, D.R. Congo single origins) are not in the folder and are not loaded. Transcribed 2026-10-14 from Dana 1.jpg, Dana 2.jpg, Camila 1.jpg, Camila 2.jpg. Per-cupper rows loaded as written; merged row by rule (union of ranges, n = 2), see cupping_evidence brief 2.' })`

`addSessionCoffee` display_order 1 to 4: Tiger Stripe Espresso, Geometric Filter Coffee, Blossom Dark Roast, Fabricator House Roast.

### B2. Numeric values (0 to 15). `–` = no row.

| coffee | cupper | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|
| Tiger Stripe | Dana | 2–8, notes `five marks: 2, 4, 5, 6, 8; unresolved` | 3–8, notes `marks at 3, 5, 8` | 2–5 | 7–9 | – |
| Tiger Stripe | Camila | 3 | 2 | 3 | 5 | 8 |
| Geometric | Dana | 4–9, notes `marks at 4, 6, 7, 9` | 10–12 | 1–4 | 8–10 | – |
| Geometric | Camila | 1 | 5 | 2 | 6 | 3 |
| Blossom | Dana | 0 | 3–5 | 7 | 8–10 | – |
| Blossom | Camila | 0 | 0 | 6 | 9 | 15 |
| Fabricator | Dana | 4–7, notes `marks at 4, 5, 6, 7` | 8–10 | 2–5 | 4–7 | – |
| Fabricator | Camila | 7 | 5, notes `a scribbled mark near 2-3 as well` | 5 | 4 | 7 |

### B3. Text dimensions (`notes`, null min/max; verbatim, lower-cased)

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 12 Mouthfeel | 11 Finish Character |
|---|---|---|---|---|---|---|
| Tiger Stripe | Dana | intensity 4: sweet, milk choc, caramel | intensity 4: light fruit, sweet-honey?, choc | chocolate, berries | silky | sweet, tea like, light acid |
| Tiger Stripe | Camila | intensity 4: fruity tea, jasmine | intensity 8: orange, bitter choc, smoky | intensity 5: nuts | creamy | smoky, black tea |
| Geometric | Dana | intensity 5: cocoa, chocolate, almonds | intensity 5: almonds, spice? | almonds | silky | sweet, tea like |
| Geometric | Camila | intensity 7: almonds (~fruity / berries, crossed out) | intensity 11: chocolate, sweet, honey | intensity 8: tea (dark) | silky | – |
| Blossom | Dana | intensity 8: cocoa, rust?, honey, smokey | intensity 6: smokey, earth | earthy, roasty | silky | bitter |
| Blossom | Camila | intensity 13: salty, smoky, BBQ chips | intensity 11: after fire, syrup | intensity 11: cigarette, tobacco | silky | – |
| Fabricator | Dana | intensity 8: honey, sweet, choc milk, orange, cherry? | intensity 5: orange-fruits, sweet | oranges / fruits | – | sweet, light acid |
| Fabricator | Camila | intensity 10: orange, dried fruits | intensity 3: flower, sweet, "not citrus" | intensity 8: fruits, raspberry, jasmine flower | – | – |

### B4. Descriptors (leaf by exact name; `custom_notes` = the words)

| coffee | cupper | leaf ← words |
|---|---|---|
| Tiger Stripe | Dana | Chocolate ← milk choc, choc, chocolate · Caramelized ← caramel · Honey ← sweet-honey? · Blueberry ← berries |
| Tiger Stripe | Camila | Jasmine ← jasmine · Orange ← orange · Dark Chocolate ← bitter choc · Smoky ← smoky · Hazelnut ← nuts · Black Tea ← fruity tea, black tea |
| Geometric | Dana | Chocolate ← cocoa, chocolate · Almond ← almonds · Cinnamon ← spice? |
| Geometric | Camila | Almond ← almonds · Chocolate ← chocolate · Honey ← honey · Black Tea ← tea (dark) |
| Blossom | Dana | Chocolate ← cocoa · Honey ← honey · Smoky ← smokey · Musty / Earthy ← earth, earthy · Roast ← roasty |
| Blossom | Camila | Salty ← salty · Smoky ← smoky · Ashy ← after fire · Maple Syrup ← syrup · Tobacco ← cigarette, tobacco |
| Fabricator | Dana | Honey ← honey · Chocolate ← choc milk · Orange ← orange, oranges · Cherry ← cherry? |
| Fabricator | Camila | Orange ← orange · Raisin ← dried fruits · Raspberry ← raspberry · Jasmine ← flower, jasmine flower |

### B5. Call columns and `overall_notes`

| coffee | cupper | archetype_call | secondary | position_call | slot_call_id | call_note | overall_notes |
|---|---|---|---|---|---|---|---|
| Tiger Stripe | Dana | chocolate_nutty | null | null | null | "DEF"; Nutty / Cocoa family ticked | Acidity line has five marks, unresolved. |
| Tiger Stripe | Camila | null | null | null | null | no call written; Nutty / Cocoa family circled | |
| Geometric | Dana | balanced_sweet | null | null | null | "DEF" (written "Balance") | |
| Geometric | Camila | balanced_sweet | null | null | null | | |
| Blossom | Dana | earthy | null | med-strong | null | | |
| Blossom | Camila | null | null | null | null | no call written; wrote "Earthy" under Other on the family line; acidity and sweetness lines marked with an asterisk | |
| Fabricator | Dana | fruity | balanced_sweet | light | null | "Balance" partly crossed out, then "Fruity, light" | |
| Fabricator | Camila | null | null | null | null | no call written; Fruity family ticked | |

### B6. Merge
`mergeByRule(sessionCoffeeId, { n: 2 })` for each of the four. Expected disagreement flags in the merged `overall_notes` (a check on `unionScores`, not something to force): Tiger Stripe none; Geometric: Acidity, Sweetness; Blossom: Sweetness; Fabricator: Sweetness. Merged archetype call: Geometric = balanced_sweet (both agree); the other three null with both calls in `call_note`.

## PART C: Utopian, three flights

Three sessions (the sheets came in three physical sets; dates for B and C are not on the sheets):

| flight | session_date | sheets | coffees (display_order) | session_notes |
|---|---|---|---|---|
| A | 2026-09-13 | freeform grid: Dana IMG_3754, Camila IMG_3755 | Mexico Alva Flores, Peru Chirinos, Colombia Andres Martinez, Peru Joel Silva | Utopian flight A, first Utopian cupping (Dana's record, 2026-09-13). Freeform grid: Dana 0 to 15 ranges; Camila integers on a 0 to 5 relative grid, converted v×3 width 3 (brief 2 decision 4), originals in notes. Transcribed 2026-10-16. Merged by rule (union, n = 2). |
| B | null | freeform grid: Dana IMG_3753, Camila IMG_3751 | Espresso Volo, Obsidian, Decaf Mexico Veracruz | Utopian flight B. Date not on the sheets; photographed 2026-10-16; between 2026-09-14 and 2026-10-16. Freeform grid: Dana 0 to 15 ranges; Camila words low / medium / high converted to thirds (decision 3), words in notes. Transcribed 2026-10-16. Merged by rule (union, n = 2). |
| C | null | A&B 0 to 15 sheets: Dana IMG_3750 (Flying Jewel, Union), IMG_3749 (Pearl); Camila IMG_3747 (Flying Jewel, Union), IMG_3748 (Pearl) | Flying Jewel (coffee 2891), Union, Pearl | Utopian flight C. Date not on the sheets; photographed 2026-10-16; Flying Jewel was placed 2026-09-27 with the note "Bloom dial: light fruity" from this sheet, so the flight is likely before that. A&B sheets, 0 to 15. Transcribed 2026-10-16. Merged by rule (union, n = 2). |

`brewMethod: 'cupping'`, `location: null` on all three.

### C1. Numeric values (0 to 15 after conversion). `–` = no row.

| coffee | cupper | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|
| Alva Flores | Dana | 3–4, notes `grape` | 7–10 | 0–3 | – | – |
| Alva Flores | Camila | 0–1, notes `grid 0-5: 0` | 0–1, notes `grid 0-5: 0` | 11–13, notes `grid 0-5: 4` | – | – |
| Chirinos | Dana | 3–8, notes `two readings: 3-4 and 6-8 (lime)` | 4–6 | 0–4 | – | – |
| Chirinos | Camila | 2–4, notes `grid 0-5: 1` | 14–15, notes `grid 0-5: 5` | 0–1, notes `grid 0-5: 0` | – | – |
| Andres Martinez | Dana | 4–8, notes `two readings: 4-6 and 6-8 (lime)` | 2–4 | 0–4 | – | – |
| Andres Martinez | Camila | 14–15, notes `grid 0-5: 5` | 8–10, notes `grid 0-5: 3` | 5–7, notes `grid 0-5: 2` | – | – |
| Joel Silva | Dana | 4–8, notes `two readings: 4-6 and 6-8 (lemon)` | 4–5 | 0–4 | – | – |
| Joel Silva | Camila | 14–15, notes `grid 0-5: 5` | 5–7, notes `grid 0-5: 2` | 5–7, notes `grid 0-5: 2` | – | – |
| Espresso Volo | Dana | 4–6 | 0–4 | 5–7 | – | – |
| Espresso Volo | Camila | 0–5, notes `word scale: low` | 0–5, notes `word scale: low` | 0–5, notes `word scale: low` | – | – |
| Obsidian | Dana | 0–4 | 0–4 | 10–13 | – | – |
| Obsidian | Camila | 0–5, notes `word scale: low` | 0–5, notes `word scale: low` | 5–10, notes `word scale: medium` | – | – |
| Decaf Veracruz | Dana | 2–4 | 4–6 | 0–4 | – | – |
| Decaf Veracruz | Camila | 0–5, notes `word scale: low` | 5–10, notes `word scale: medium` | 0–5, notes `word scale: low` | – | – |
| Flying Jewel | Dana | 0–4, notes `marks at 0, 2, 4; berries` | 5 | 4–5 | 5 | 5 |
| Flying Jewel | Camila | 4–5 | 4 | 0 | 3 | 5 |
| Union | Dana | 4–5, notes `orange` | 5 | 3–8, notes `marks at 3 and 8` | 7 | – |
| Union | Camila | 2–6, notes `marks at 2, 3, 6; heavy rework on the line` | 1 | 1 | 1 | 2 |
| Pearl | Dana | 3–7, notes `marks at 3 and 7` | 9 | 3 | 5–7 | – |
| Pearl | Camila | 0–1 | 2 | 2 | 2 | 3 |

Freeform grids (flights A and B) have a "mouthfeel" line in words only: those words go to dimension 12, no Body value.

### C2. Text dimensions

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 12 Mouthfeel | 11 Finish Character |
|---|---|---|---|---|---|---|
| Alva Flores | Dana | fruity, berry | berries, dried fruits, black tea (?) | black tea | light | black tea, bitterness |
| Alva Flores | Camila | fruits, berry | honey, burnt | tobacco vibes | tea | bitter |
| Chirinos | Dana | flower, jasmin | jasmin, tea, green tea | tea, jasmin | light | tea |
| Chirinos | Camila | tea (maybe fruity / floral?), soft fruits, jasmin | weak black tea, jasmin, caramel, ~orange (?) | flower, rose | tea | refreshing, happy |
| Andres Martinez | Dana | cocoa, burnt, berries, dried fruits | dried fruits, blackberries | berries, raspberries, citrus | light | dry, acid |
| Andres Martinez | Camila | dried fruits, orange (?), sweet fruits with a bit of acidity | sweet black tea, dried orange | dried fruits, ~tea | tea | acid, dried |
| Joel Silva | Dana | orange, citrus | fruit, tea, orange | citrus, orange | light | tea like, acidity |
| Joel Silva | Camila | tea, herbal, sweet fruits, orange | fruity, sweet berries, acidity | tea, strawberry | light (~tea) | acid, ~a bit bitter |
| Espresso Volo | Dana | burned, tobacco, ashy | fruits, berries, cocoa or milk chocolate | smokey, soft sweet, dark choc | juicy | light bitter, dry, light |
| Espresso Volo | Camila | citrus fruits, dark chocolate | creamy (?), sugar, milk chocolate | orange (dried), dark chocolate, smoky | syrup | bitter, dry |
| Obsidian | Dana | berries, cocoa, tobacco, smokey | almonds, nuts, sweet | roast, burnt | light syrup | low bitter |
| Obsidian | Camila | soy, spices, BBQ, ~fruits | burnt (in the oven), smoky | tobacco, burnt | syrup | bitter (low) |
| Decaf Veracruz | Dana | cocoa, tobacco, smokey, berries | prune (?), sugarcane, ~fruits ~berries | sweet | juicy | low acid, sweet |
| Decaf Veracruz | Camila | fruits | sugar sweet, cane (?), almond tea | fruity, pomegranate, chocolate | juicy (~syrup) | sweet, sugary |
| Flying Jewel | Dana | intensity 7-9: chocolate, almonds, fruits, berries, apple (marked x) | intensity 7 | fruits, ~chocolate | creamy | acid, light, ~berries |
| Flying Jewel | Camila | berry | brown sugar, ~chocolate (?) | berries, raspberry | – | berries |
| Union | Dana | intensity 7-9: fruits, pomegranate, chocolate | intensity 5: fruits, black tea, ~nuts | dark chocolate, fruit, orange | – | light acid |
| Union | Camila | sour fruity | black tea, sweet aromatics | light citrus (?) | dry | – |
| Pearl | Dana | intensity 7-9: cocoa, nuts | intensity 5: light cocoa, fruits, dried fruits | fruits, citrus | silky | acid |
| Pearl | Camila | pepper | black tea, jasmin | tea | light | short, smoky light |

### C3. Descriptors

| coffee | cupper | leaf ← words |
|---|---|---|
| Alva Flores | Dana | Blueberry ← berry, berries · Raisin ← dried fruits · Black Tea ← black tea · Grape ← grape |
| Alva Flores | Camila | Blueberry ← berry · Honey ← honey · Roast ← burnt · Tobacco ← tobacco vibes |
| Chirinos | Dana | Jasmine ← jasmin · Black Tea ← tea, green tea · Lime ← lime |
| Chirinos | Camila | Jasmine ← jasmin · Black Tea ← tea, weak black tea · Caramelized ← caramel · Rose ← rose |
| Andres Martinez | Dana | Chocolate ← cocoa · Roast ← burnt · Blackberry ← blackberries · Raisin ← dried fruits · Raspberry ← raspberries · Blueberry ← berries · Lime ← lime |
| Andres Martinez | Camila | Raisin ← dried fruits · Orange ← orange (?), dried orange · Black Tea ← sweet black tea |
| Joel Silva | Dana | Orange ← orange · Lemon ← lemon · Black Tea ← tea |
| Joel Silva | Camila | Orange ← orange · Blueberry ← sweet berries · Strawberry ← strawberry · Black Tea ← tea · Herb-like ← herbal |
| Espresso Volo | Dana | Roast ← burned · Tobacco ← tobacco · Ashy ← ashy · Blueberry ← berries · Chocolate ← cocoa or milk chocolate · Smoky ← smokey · Dark Chocolate ← dark choc |
| Espresso Volo | Camila | Dark Chocolate ← dark chocolate · Chocolate ← milk chocolate · Orange ← citrus fruits, orange (dried) · Smoky ← smoky |
| Obsidian | Dana | Blueberry ← berries · Chocolate ← cocoa · Tobacco ← tobacco · Smoky ← smokey · Almond ← almonds · Hazelnut ← nuts · Roast ← roast, burnt |
| Obsidian | Camila | Cinnamon ← spices · Smoky ← smoky · Roast ← burnt (in the oven), burnt · Tobacco ← tobacco |
| Decaf Veracruz | Dana | Chocolate ← cocoa · Tobacco ← tobacco · Smoky ← smokey · Blueberry ← berries · Prune ← prune (?) · Molasses ← sugarcane |
| Decaf Veracruz | Camila | Molasses ← cane (?) · Almond ← almond tea · Pomegranate ← pomegranate · Chocolate ← chocolate |
| Flying Jewel | Dana | Chocolate ← chocolate · Almond ← almonds · Blueberry ← berries · Apple ← apple (marked x) |
| Flying Jewel | Camila | Blueberry ← berry, berries · Caramelized ← brown sugar · Raspberry ← raspberry |
| Union | Dana | Pomegranate ← pomegranate · Chocolate ← chocolate · Black Tea ← black tea · Dark Chocolate ← dark chocolate · Orange ← orange |
| Union | Camila | Sour Aromatics ← sour fruity · Black Tea ← black tea · Sweet Aromatics ← sweet aromatics · Orange ← light citrus (?) |
| Pearl | Dana | Chocolate ← cocoa, light cocoa · Hazelnut ← nuts · Raisin ← dried fruits · Orange ← citrus |
| Pearl | Camila | Pepper ← pepper · Black Tea ← black tea, tea · Jasmine ← jasmin · Smoky ← smoky light |

### C4. Call columns and `overall_notes`

| coffee | cupper | archetype_call | secondary | position_call | slot_call_id | call_note | overall_notes |
|---|---|---|---|---|---|---|---|
| Alva Flores | Dana | null | null | null | null | no call written | |
| Alva Flores | Camila | null | null | null | null | no call written | |
| Chirinos | Dana | null | null | null | null | no call written | Acidity read twice: 3-4 and 6-8 lime. |
| Chirinos | Camila | floral | null | null | null | | |
| Andres Martinez | Dana | null | null | null | null | no call written | Acidity read twice: 4-6 and 6-8 lime. |
| Andres Martinez | Camila | null | null | null | null | no call written | |
| Joel Silva | Dana | null | null | null | null | no call written | Acidity read twice: 4-6 and 6-8 lemon. |
| Joel Silva | Camila | fruity | null | null | null | | |
| Espresso Volo | Dana | earthy | null | light | null | written "Light Earth" | |
| Espresso Volo | Camila | earthy | null | null | null | "acid" and "light" written then struck | |
| Obsidian | Dana | earthy | null | null | null | | |
| Obsidian | Camila | earthy | null | Standard | null | "medium" struck | |
| Decaf Veracruz | Dana | balanced_sweet | null | null | null | "choc & nut" written then struck | |
| Decaf Veracruz | Camila | chocolate_nutty | null | null | null | | |
| Flying Jewel | Dana | null | null | null | null | no call written; Fruity family ticked | |
| Flying Jewel | Camila | null | null | null | null | no call written; Fruity family ticked | |
| Union | Dana | balanced_sweet | null | null | null | written "balanced" | |
| Union | Camila | balanced_sweet | null | null | null | Floral / Fruity boxed together on the family line; wrote "limit of floral and fruity" | |
| Pearl | Dana | fruity | null | light fruity | fruity/1 (Task 0 id) | Fruity family ticked; wrote "Bloom dial: light fruity"; slot id set because "light" is the lowest position of the Fruity dial | |
| Pearl | Camila | null | null | null | null | no call written; Floral family ticked | |

### C5. Merge
`mergeByRule(sessionCoffeeId, { n: 2 })` for all ten. Disagreement = the gap between the two cuppers' ranges is greater than n (overlapping ranges, or a gap of exactly 2, agree). Expected flags (a check on `unionScores`, not something to force): Alva Flores: Sweetness, Bitterness; Chirinos: Sweetness; Andres Martinez: Acidity, Sweetness; Joel Silva: Acidity; Volo: none; Obsidian: none; Decaf: none; Flying Jewel: Bitterness; Union: Sweetness, Body; Pearl: Sweetness, Body. Flight B flags nothing because Camila's word-scale thirds are five points wide and overlap Dana's ranges; that is the honest consequence of decision 3, not a bug. Merged archetype call: Volo = earthy, Obsidian = earthy, Union = balanced_sweet; all others null.

## PART D: Utopian website notes → `roastery_remark`

Through `recordRemarks`. Common values: `roaster_id` = Utopian, `channel = 'website'`, `said_by = 'Utopian Coffee Co. (utopiancoffee.com)'`, `said_on` = the intake xlsx last-modified date (Task 0), `recorded_by = 'Dana'`, `record_source = 'utopiancoffee.com via misc/roasteries/intake/Roaster_Intake_Utopian.xlsx (Sep 2026)'`, `coffee_id` = the catalog coffee, `portal_coffee_id` = the lineup row, `cupping_session_coffee_id` null. One `descriptor` row per published note (verbatim, capitalised as published), one `process` row and one `general` row for the roast level. Where a leaf fits, `cupping_note_id` is set and the same `normalized_words → leaf` is written to `roastery_portal_note_mapping` (through its service); where no leaf fits, `cupping_note_id` null and no mapping row.

| coffee | descriptor remarks (verbatim → leaf or null) | process | roast (topic general) |
|---|---|---|---|
| Flying Jewel | Berries → Blueberry · Sweet Cream → null · Cocoa → Chocolate | Washed + Natural | Medium-Light |
| Espresso Volo | Fragrant Berries → Blueberry · Cocoa → Chocolate · Sweet Tobacco → Tobacco | Washed + Natural | Medium-Dark |
| Peru Chirinos | Mango Puree → null · Narcissi → null · Honeycomb → Honey | Washed | Light |
| Obsidian | Palo Santo → Woody · Campfire 'Mallows → Smoky · Mrs. Buttersworth → Maple Syrup | Washed | Dark |
| Decaf Mexico Veracruz | Red Apple → Apple · Flaky Croissant → null · Walnut Butter → Hazelnut (nut convention) | Washed, Mountain Water decaf | Medium |
| Peru Joel Silva | Ground Cherry → null · Ube Halo Halo → null · Crunchy Sweetness → null | Natural | Medium-Light |
| Mexico Alva Flores | Black Plum → null · Honeycomb → Honey · Champorado → Chocolate | Washed | Medium |
| Pearl | Citrusy → Orange · Bright → null (also one `dimension` row: "Bright") · Sweet → null · juicy fruit with a backbone of chocolate → Chocolate | Washed + Natural | Light |
| Union | Smooth → null (also one `dimension` row: "Smooth") · caramel sauce → Caramelized · buttered pastry → null · pistachio → Hazelnut (nut convention) | Washed | Medium |
| Colombia Andres Martinez | Fragrant Jasmine → Jasmine · Green Melon → null · Almond Butter → Almond | Double fermentation | Medium-Light |

Expected: 30 descriptor rows + 2 dimension rows + 10 process rows + 10 roast rows = 52 remarks; 16 note mappings. The eight uncupped Utopian coffees in the xlsx are not loaded (no lineup row, no catalog row).

## CONSTRAINTS

- Test DB first, end to end (A → B → C → D), then prod. Dry run of both manifests on prod first.
- Loader script `backend/src/features/cupping_evidence/load_cupping_evidence_2.ts`, idempotent by natural key (roaster + coffee name + session_date/flight label + taster): re-running must not create a second row; it reports "already loaded" instead.
- Use a marked `Zzz Test` admin identity only where the services require one; never act as Dana or Camila beyond `taster_name` / `recorded_by` values, which are data.
- No placement, no price, no guest slot, no SKU beyond the bare 12 oz rows, no change to coffee 2891's assignment or placement, no portal response / link / respondent touched.
- `lint:cupping`, `lint:roastery-portal`, `lint:catalog` green; `npm run build` clean; `runCatalogIntegrityChecks().allPass = true` on test and prod after the imports.
- Commits: manifests + loader + this brief's status line + one `WHAT_WE_BUILT.md` entry + a dated line in `WHAT_WE_BUILT_DB.md`'s Cupping tool section. Straight to main.

## DONE =

Thirteen new catalog coffees (4 Joe Bean, 9 Utopian), all unplaced, each with a provisional low/medium assignment carrying its basis line; thirteen lineup rows linked; four sessions (Joe Bean 2026-09-30; Utopian A 2026-09-13, B, C) with 14 session coffees, 28 per-cupper score rows and 14 rule-merged rows, values, descriptors and call columns exactly as in B2–B5 and C1–C4; 52 Utopian website remarks readable through `v_roastery_remark`; 16 note mappings; integrity green.

Closing report: coffee ids; session ids; per session coffee the three score ids (Dana, Camila, merged) and the merged `overall_notes` line; the leaf names that were missing or respelled (Task 0); the import warnings; the admin URLs (Coffees page, Roastery Feedback for Joe Bean and Utopian).
