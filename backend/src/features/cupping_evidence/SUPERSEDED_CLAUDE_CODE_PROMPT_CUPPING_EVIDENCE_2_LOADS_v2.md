# Cupping Evidence, brief 2: load Joe Coffee, Joe Bean and Utopian (catalog rows, sessions per cupper, rule merges, roaster remarks, lineup links). Data only.

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-16 (CTO session; decisions by Dana) · Model: Sonnet is fine
> Status: NOT EXECUTED · Depends on brief 1 (`CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_1_FOUNDATION.md`) being deployed. Do not start before `cuppingService.saveCupperScore`, `mergeByRule`, `roastery_remark` and `lint:cupping` exist in main.
> Replaces the data parts of the two v1 briefs (`SUPERSEDED_…JOE_COFFEE_1.md` Part B and `SUPERSEDED_…EVIDENCE_2_LOADS.md`). The transcriptions below are the same ones Dana checked; only the row shapes changed.
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v2 §6 (loading rules). Read it first. This brief is data only: no schema, no new table, no view, no change to any coffee that already has an assignment, no placement except the four Joe Coffee placements Dana decided on 2026-10-11 to 10-13.

## What this is

Three roasteries' cuppings and what the roasters told us go into the evidence layer, per cupper, as written, with a rule-merged row per coffee:

1. **Joe Coffee Company** (New York), 2026-10-02, Dana only, eight coffees, with Natalie (marketing director) and Joe staff at the table. Not blind. Sources: `misc/roasteries/Joe Coffee/Cupping Oct 2, 2026/` (Dana's sheets `Joe Coffee - Cupping Notes - Dana.pdf`; Joe's "Coffee Profile" forms and loose pages; `CUPPING_NOTES_Joe_Coffee_2026-10-02.md`).
2. **Joe Bean Roasters**, 2026-09-30, Dana + Camila, four blends under blind codes. Source: `misc/roasteries/Joe Bean/Cupping 1 - Sep 2026/CUPPING_NOTES_Joe_Bean_2026-09-30.md` (from `Dana 1.jpg`, `Dana 2.jpg`, `Camila 1.jpg`, `Camila 2.jpg`).
3. **Utopian Coffee Co.**, three flights, Dana + Camila, ten coffees, two sheet formats. Source: `misc/roasteries/Utopian/CUPPING_NOTES.md` (from `IMG_3747` to `IMG_3755`). Utopian's published notes from `misc/roasteries/intake/Roaster_Intake_Utopian.xlsx` go in as `roastery_remark`, `channel = 'website'`.

Every value below was transcribed from handwriting and checked by Dana. Load it as written; do not reinterpret a number or a word. The `match: close / far` verdicts and the "Patterns" sections of the notes files are analysis, not evidence, and are **not** loaded.

## Decisions already made (Dana). Do not re-open.

1. One `cupping_scores` row per cupper per coffee (`is_merged = false`, through `saveCupperScore`), then one merged row through `mergeByRule(sessionCoffeeId, { n: 2 })`. Also for Joe Coffee (one cupper). Never a hand merge in this brief.
2. Ranges as written; a single mark is `min = max`; several marks are the span; crossed-out marks are not counted. `raw_value` carries the paper exactly (DESIGN §6.2); where the table below gives no `raw_value`, it is `'<min>-<max>'` (or `'<v>'` for a point).
3. Camila's word scale (Utopian flight B) → `scale_code = 'word_3'`; her 0 to 5 grid (flight A) → `scale_code = 'grid_0_5'`; conversions per DESIGN §6.2, originals in `raw_value`. Dana's and Camila's A&B sheets → `ab_0_15`.
4. Dana's "two readings" on acidity are one span, `raw_value = 'two readings: 3-4 and 6-8 (lime)'`.
5. Dimension mapping: numeric Mouthfeel light to heavy = 7 Body; numeric Aftertaste short to long = 10 Finish Length; mouthfeel words = 12; aftertaste words = 11 Finish Character; Fragrance, Aroma, Flavor = 1, 2, 3, **numeric since brief 1**: an "intensity N" on the sheet goes to `value_min/max`, the words to `notes`; a sheet with words only leaves min/max null.
6. Descriptors: every word with a wheel leaf also goes to `cupping_score_descriptors` by exact `cupping_note.descriptor`, `intensity` null, `custom_notes` = the sheet's words; two words on one leaf = one row, both words. Conventions: berries / berry → Blueberry; nuts → Hazelnut; cocoa / milk chocolate / chocolate → Chocolate; spice(s) → Cinnamon; tea / black tea / green tea → Black Tea; burned / burnt / roast / roasty → Roast; citrus → Orange; dried fruits → Raisin; sugarcane / cane → Molasses; syrup → Maple Syrup. Words with no leaf (sweet, fruits, creamy, juicy, tea like, happy, BBQ chips, soy) stay in the text dimension only.
7. The cupper's blind call goes to the call columns. A family tick or circle is a `call_note`, not a call. "Earthy" written under "Other" on the family line is a call note.
8. Each cupped coffee needs a `coffees` row. Joe Coffee's eight are created through the import manifest with the archetypes and placements Dana decided (four placed, four unplaced). Joe Bean's four and Utopian's nine new ones are created **unplaced** with a provisional assignment (`confidence = 'low'`, or `'medium'` when both cuppers made the same call; `source = 'cupping'`; basis line per DESIGN §8.3 ending `provisional, pending the calibration pass`). Every manifest coffee gets the bare `{ weightOz: 12 }` SKU the importer requires; unplaced stays invisible. Flying Jewel (coffee 2891) exists and keeps its assignment; its cupping rows attach to it.
9. Roaster remarks (table talk, Utopian's website) go to `roastery_remark` through `recordRemarks`. Where a website note maps cleanly to a leaf, the mapping is also remembered in `roastery_portal_note_mapping` through its service.
10. Joe Bean's and Joe Coffee's website text is not loaded here (not transcribed yet; DESIGN §13.4).
11. Nothing is deleted, superseded or re-merged. If a step fails midway, report what was written and stop; the loader is idempotent by natural key, so the next run continues.

## Task 0 (report, read-only; STOP only where it says so)

- `cuppingService.ts` exports `createSession`, `addSessionCoffee`, `saveCupperScore`, `mergeByRule`; `coffee_dimensions` 1, 2, 3 are `is_numeric = true`; `roastery_remark.channel` accepts `'website'` and `topic` accepts `'roast'`; `lint:cupping` exists and is green. If any is missing, STOP: brief 1 has not landed.
- Roasters: `Joe Coffee Company` (expected id `f42ad179-9ef4-410a-a92e-464eae1d84ce`), `Joe Bean Roasters`, `Utopian Coffee Co.` exist and are active (report ids).
- Submitted portal responses per roastery (all three have submitted, Dana 2026-10-16): report per lineup coffee the current submitted version and `submitted_at`. Not touched here; brief 3 reads them.
- Lineups: Joe Coffee eight active `roastery_portal_coffee` rows with the names in A1, all `coffee_id IS NULL`; Joe Bean seven active rows, the four blends in A2 among them, `coffee_id IS NULL`; Utopian ten active rows, Flying Jewel linked to 2891, the other nine `coffee_id IS NULL`. If a lineup row for one of these 21 coffees already has a `coffee_id`, STOP and report.
- `coffees` rows with `roaster_id` of the three roasteries: expected exactly one (2891). If more, STOP and report.
- **Coffee 2891 cupping rows**: any `cupping_session_coffees` / `cupping_scores` for 2891 on prod (brief 1's closing report says). If there is a hand-entered session for Flying Jewel from before 2026-09-27, report its session id, taster names and values; do not load Utopian flight C's Flying Jewel rows into a second session until Dana says whether the existing rows are the same cupping (then the existing session becomes flight C's session for that coffee and `sample_note` says so) or a different one. STOP at the Flying Jewel step only; load everything else.
- `v_roastery_portal_coffee` prefill values (origin, process, roast level, blend/single, decaf) for the 21 lineup rows; where they differ from the manifests below, the lineup's values win (the lineup came from the roaster's site through portal parts 1 and 6); report the differences.
- `lookup_value` codes for `roast_level`, `process`, `blend_or_single` (the importer validates against them; report which of `medium-light`, `medium-dark`, `double fermentation`, `co-ferment`, `mountain_water`, `honey` exist). Where a manifest value has no code, use the lineup's stored value; if the lineup has none, pass null and report; never invent a code.
- Every `cupping_note` leaf named below exists by exact `descriptor` and is active. For a name under a slightly different spelling, use the existing one and report the pair. For a name that does not exist (candidates: Pepper, Sweet Aromatics, Sour Aromatics, Herb-like, Woody, Salty, Ashy, Tobacco, Malic Acid, Fresh, Musty / Earthy), carry the word in the text dimension only and report it; never create a leaf.
- `coffee_dial_slot` rows for `fruity/1`, `floral/1`, `balanced_sweet/2` (ids, names) and the coffees that currently hold them with priorities; which coffee is priority 1 on `balanced_sweet/2` (it will move to priority 2).
- Active sizes in `coffee_size` (12 oz anchor) and whether `coffee_slot_price` has a 12 oz price for the three slots above.
- `coffee_category.code = 'decaf'` active.
- Last-modified date of `misc/roasteries/intake/Roaster_Intake_Utopian.xlsx` (becomes `said_on` for the website remarks).

## PART A: catalog rows and lineup links

Manifests under `backend/src/features/cupping_evidence/manifests/`. `npm run catalog:import` dry run on the test DB, apply, then dry run and apply on prod. `runCatalogIntegrityChecks().allPass` must be true after each apply; report every warning. `flavorDescriptorsRoaster: []` on every coffee (roaster notes arrive through portal acceptance and through `roastery_remark`, never copied into the coffee row).

### A1. `joe_coffee_2026_10_02.json` (roaster `Joe Coffee Company`)
Prefills exactly as portal part 7 loaded them from Joe's site. `match.source` is `cupping` where the archetype is Dana's call, `manual` where it is the roaster's.

| # | name (as in the lineup) | blendOrSingle | origin | process | roastLevel | match archetype | confidence | source | home slot | categoryCodes | 12 oz SKU |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Cafè Feminista: Montze Olvera | single | Sierra de Tenango, Hidalgo, Mexico (Montze Olvera) | honey | light | fruity | medium | cupping | fruity/1, next priority | [] | yes |
| 2 | Colombia La Familia Guarnizo | single | Huila, Colombia (The Guarnizo Family) | washed | light | floral | medium | manual | floral/1, next priority | [] | yes |
| 3 | The Village | single | Ngozi, Burundi (Turihamwe Women's Group) | washed | light | fruity | medium | cupping | fruity/1, next priority | [] | yes |
| 4 | Benchmark | blend | San Ignacio, Cajamarca, Peru | washed | medium | balanced_sweet | high | cupping | balanced_sweet/2, priority 1 | [] | yes |
| 5 | Amsterdam | blend | Cerrado, Minas Gerais, Brazil | natural | medium | chocolate_nutty | medium | cupping | none | [] | yes (bare) |
| 6 | The Daily | blend | Chiapas, Mexico and Huila, Colombia | washed | medium | chocolate_nutty | medium | manual | none | [] | yes (bare) |
| 7 | Big City | blend | Cerrado, Minas Gerais, Brazil and Nicaragua | natural, washed | dark | earthy | medium | cupping | none | [] | yes (bare) |
| 8 | Nightcap Decaf | single | Tapachula, Chiapas, Mexico (Muguira Family) | washed | medium | fruity | low | manual | none | [decaf] | yes (bare) |

`match.notes` (basis line) per coffee:
- 1: `basis: cupping s<id> 2026-10-02 (Dana=no call written; roaster present, not blind); roaster table (Joe staff)=fruity; rule: delicate fruity, Joe lineup → fruity/1`
- 2: `basis: cupping s<id> 2026-10-02 (Dana=balanced_sweet; roaster present, not blind); roaster table (Natalie)=floral; rule 2026-10-11: go with what Joe says → floral/1`
- 3: `basis: cupping s<id> 2026-10-02 (Dana=balanced_sweet or fruity; roaster present); roaster table=fruity; rule 2026-10-08: delicate fruity → fruity/1`
- 4: `basis: cupping s<id> 2026-10-02 (Dana=balanced_sweet); roaster table=balanced; rule 2026-10-13: Balanced default → balanced_sweet/2 priority 1`
- 5: `basis: cupping s<id> 2026-10-02 (Dana=chocolate_nutty); roaster table=chocolate and nutty; not placed (Dana 2026-10-11)`
- 6: `basis: cupping s<id> 2026-10-02 (Dana=no call written); roaster table=chocolate and nutty; not placed`
- 7: `basis: cupping s<id> 2026-10-02 (Dana=earthy, delicate earthy); roaster table=earth (delicate earth); not placed`
- 8: `basis: cupping s<id> 2026-10-02 (Dana=no call; last cup of the day, provisional); roaster table=fruity decaf; decaf category, not placed`
`<id>` is the session id from Part B, so the manifest is applied **after** Part B's session exists, or the importer's `notes` is updated through `catalogService` right after Part B (report which; never a direct UPDATE).

`home.placementNote`: 1 and 3 "delicate fruity, cupped 2026-10-02 at Joe Coffee"; 2 "delicate floral, cupped 2026-10-02 at Joe Coffee; roaster's classification"; 4 "classic balanced and sweet, Balanced default from 2026-10-13 (Dana)". `certify: { by: 'dana', note: 'cupped 2026-10-02' }` on 1 to 5 and 7; no certify on 6 and 8. Benchmark priority 1: if the manifest path cannot express "take priority 1 and shift the current holder down", place Benchmark through `catalogService.placeCoffee` + `setPriority` after the import (preview first, apply, report before and after for that slot). SKUs `{ weightOz: 12 }` only, no `roasterSku`, no `costToUs`.

### A2. `joe_bean_2026_09_30.json` (roaster `Joe Bean Roasters`)
No `home`, no `guests`, no `certify`. `skus: [{ "weightOz": 12 }]`. `categoryCodes: []`.

| name (as in the lineup) | blendOrSingle | roastLevel | process | origin | match.archetype | confidence | source | notes (basis line) |
|---|---|---|---|---|---|---|---|---|
| Tiger Stripe Espresso | blend | lineup value | lineup value | lineup value | chocolate_nutty | low | cupping | basis: cupping s<id> 2026-09-30 blind (Dana=chocolate_nutty "DEF"; Camila=no call, Nutty/Cocoa circled); roaster portal (Kathy Turiano 2026-10-14) see v_roastery_portal_current_response; A&B rule 2026-10-14: C&N blend with a fruity accent is plain C&N; provisional, pending the calibration pass |
| Geometric Filter Coffee | blend | lineup value | lineup value | lineup value | balanced_sweet | medium | cupping | basis: cupping s<id> 2026-09-30 blind (Dana=balanced_sweet "DEF"; Camila=balanced_sweet); provisional, pending the calibration pass |
| Blossom Dark Roast | blend | dark | lineup value | lineup value | earthy | low | cupping | basis: cupping s<id> 2026-09-30 blind (Dana=earthy, med-strong; Camila=no call, wrote Earthy under Other); roaster classifies bean-driven as C&N; A&B family rule is roast-driven (2026-10-16); Earthy vs C&N-bold left open 2026-10-14; provisional, pending the calibration pass |
| Fabricator House Roast | blend | lineup value | lineup value | lineup value | fruity | low | cupping | basis: cupping s<id> 2026-09-30 blind (Dana=fruity light, "Balance" partly crossed out; Camila=no call, Fruity family ticked); provisional, pending the calibration pass |

### A3. `utopian_2026_09.json` (roaster `Utopian Coffee Co.`)
Same shape. Flying Jewel is **not** in the manifest. Prefill from the Utopian notes file, cross-checked against the lineup (Task 0); lineup wins on a difference.

| name (as in the lineup) | blendOrSingle | roastLevel | process | origin | categoryCodes | match.archetype | confidence | source | notes (basis line) |
|---|---|---|---|---|---|---|---|---|---|
| Espresso Volo | blend | medium-dark | washed, natural | | [] | earthy | medium | cupping | basis: cupping flight B s<id> (Dana=earthy "Light Earth"; Camila=earthy; not blind); roaster portal submitted, see v_roastery_portal_current_response; website: Fragrant Berries, Cocoa, Sweet Tobacco; provisional, pending the calibration pass |
| Peru Chirinos | single | light | washed | Chirinos, Cajamarca, Peru (Geisha) | [] | floral | low | cupping | basis: cupping flight A s<id> 2026-09-13 (Dana=no call, jasmine/tea; Camila=floral; not blind); roaster portal submitted, see v_roastery_portal_current_response; website: Mango Puree, Narcissi, Honeycomb; provisional, pending the calibration pass |
| Obsidian | blend | dark | washed | | [] | earthy | medium | cupping | basis: cupping flight B s<id> (Dana=earthy; Camila=earthy "Standard"; not blind); roaster portal submitted, see v_roastery_portal_current_response; website: Palo Santo, Campfire 'Mallows, Mrs. Buttersworth; provisional, pending the calibration pass |
| Decaf Mexico Veracruz | single | medium | washed | Veracruz, Mexico | [decaf] | balanced_sweet | low | cupping | basis: cupping flight B s<id> (Dana=balanced_sweet, "choc & nut" struck; Camila=chocolate_nutty; cuppers disagree); roaster portal submitted, see v_roastery_portal_current_response; website: Red Apple, Flaky Croissant, Walnut Butter; provisional, pending the calibration pass |
| Peru Joel Silva | single | medium-light | natural | Chirinos, Cajamarca, Peru | [] | fruity | low | cupping | basis: cupping flight A s<id> 2026-09-13 (Dana=no call, citrus/orange; Camila=fruity); roaster portal submitted, see v_roastery_portal_current_response; website: Ground Cherry, Ube Halo Halo, Crunchy Sweetness; provisional, pending the calibration pass |
| Mexico Alva Flores | single | medium | washed | Santa Cruz Ozolotepec, Oaxaca, Mexico | [] | fruity | low | cupping | basis: cupping flight A s<id> 2026-09-13 (no call from either cupper; both wrote berries / black tea); roaster portal submitted, see v_roastery_portal_current_response; website: Black Plum, Honeycomb, Champorado; sample was an end-of-run lot; provisional, pending the calibration pass |
| Pearl | blend | light | washed, natural | | [] | fruity | low | cupping | basis: cupping flight C s<id> (Dana=fruity, "Bloom dial: light fruity"; Camila=no call, Floral family ticked); largest cupper disagreement of the session; roaster portal submitted, see v_roastery_portal_current_response; website: Citrusy, Bright, Sweet, juicy fruit with a backbone of chocolate; provisional, pending the calibration pass |
| Union | blend | medium | washed | | [] | balanced_sweet | medium | cupping | basis: cupping flight C s<id> (Dana=balanced_sweet; Camila=balanced_sweet, "limit of floral and fruity"); roaster portal submitted, see v_roastery_portal_current_response; website: Smooth, caramel sauce, buttered pastry, pistachio (roaster reads it Balanced; Dana unsure, 2026-10-16); zero descriptor overlap; provisional, pending the calibration pass |
| Colombia Andres Martinez | single | medium-light | double fermentation | Cauca, Colombia | [] | fruity | low | cupping | basis: cupping flight A s<id> 2026-09-13 (no call from either cupper; both wrote dried fruit / berries / citrus); roaster portal submitted, see v_roastery_portal_current_response; website: Fragrant Jasmine, Green Melon, Almond Butter; sample was an end-of-run lot; provisional, pending the calibration pass |

### A4. Lineup links
`linkLineupCoffeeToCatalog(portalCoffeeId, coffeeId)` for the eight Joe Coffee rows, the four Joe Bean rows and the nine Utopian rows. Afterwards `v_roastery_portal_coffee` shows Joe Coffee 8 of 8, Joe Bean 4 of 7 (the three single origins stay unlinked: not cupped, no catalog row), Utopian 10 of 10. The submitted portal responses are untouched; Dana accepts them from Roastery Feedback when she wants.

## PART B: Joe Coffee, session 2026-10-02 (Dana)

### B1. Session
`createSession({ sessionDate: '2026-10-02', brewMethod: 'cupping', location: 'Joe Coffee Company, New York', recordSource: 'paper: Joe Coffee - Cupping Notes - Dana.pdf; transcribed 2026-10-11', sheetFormat: 'ab_0_15_8dim', isBlind: false, roasterPresent: true, sessionNotes: 'Cupping at Joe Coffee with Natalie (marketing director) and Joe staff. Eight coffees, Dana scored (ranges). Roaster remarks captured in roastery_remark. Merged by rule (one cupper).' })`

`addSessionCoffee` display_order 1 to 8: Feminista, La Familia Guarnizo, The Village, Benchmark, Amsterdam, The Daily, Big City, Nightcap Decaf. `sampleNote` on Nightcap Decaf: `'last cup of the day; Dana considers her scores provisional'`.

### B2. Numeric values (0 to 15). `–` = no row. `raw_value` given where it differs from `'<min>-<max>'`.

| coffee | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|
| Feminista | 6–7, raw `6-7; crossed 4` | 7–9 | 0–3 | 3–5 | – |
| La Familia Guarnizo | 4–6 | 7–10 | 2–5 | – (the 9–11 mark was texture, see Mouthfeel) | – |
| The Village | 4–6, raw `4-6; crossed 3` | 5–7 | 1–4 | 5–7 | – |
| Benchmark | 1–4 | 8–10 | 2–4 | – | – |
| Amsterdam | 1–4 | 4–7 | 5–8, raw `5-8; crossed 3` | 6–9 | – |
| The Daily | 3–4, raw `3-4; crossed 1` | 6–9 | 4–6 | – | – |
| Big City | 0–2 | 4–6 | 7–9 | 7–9 | – |
| Nightcap Decaf | 6–8, raw `6-8; crossed 1, 3` | 5–7, raw `5-7; crossed 3` | 3–5, raw `3-5; crossed 7` | 8–10 | 8–10 |

### B3. Text on dimensions 1, 2, 3, 11, 12 (`notes`; this sheet has no intensity numbers on 1 to 3, so min/max null; verbatim, lower-cased, spelling corrected)

| coffee | 1 Fragrance | 2 Aroma | 3 Flavor | 12 Mouthfeel | 11 Finish Character |
|---|---|---|---|---|---|
| Feminista | fruits, berries | fruits, sweet | fruits | – | light acidity, sweetness |
| La Familia Guarnizo | sweet, honey, nuts | sweet, honey, caramel | – | whole milk; raw `9-11 mark on the Mouthfeel scale was texture, not weight` | green tea bitterness, ~sweetness |
| The Village | green | brown sugar | sweetness | – | light acid, sweetness |
| Benchmark | cocoa, nuts | caramel, sweet, spice | sweet, caramel | tea like | balanced |
| Amsterdam | cocoa, milk chocolate | nuts | chocolate, nuts | – | sweetness, light bitterness |
| The Daily | milk chocolate | chocolate | chocolate, caramel | – | sweetness |
| Big City | musty | roasted nuts, brown sugar | burned, nuts | silky | bitterness, light |
| Nightcap Decaf | nuts | nuts | almonds | silky | molasses, sweet; raw `a first word scribbled out, unreadable` |

### B4. Call columns and `overall_notes` (the sheet's call, not the catalog decision; Dana's own words only, roaster words are in B6)

| coffee | archetype_call | secondary | position_call | slot_call_id | call_note | overall_notes |
|---|---|---|---|---|---|---|
| Feminista | null | null | null | null | no call written | Sheet 1 of the day. |
| La Familia Guarnizo | balanced_sweet | null | null | null | call made at the table; roaster said floral (remark 12) | Catalog decision 2026-10-13 adopted Floral; this row keeps Dana's own call. |
| The Village | balanced_sweet | fruity | null | null | "Balanced or Fruity" | |
| Benchmark | balanced_sweet | null | null | null | | Drip coffee preferred (Dana's own remark). |
| Amsterdam | chocolate_nutty | null | null | null | | |
| The Daily | null | null | null | null | no call written | |
| Big City | earthy | null | delicate earthy | null | the "natural process" part of the line is Joe's (remark 32) | Bitterness 7–9 and aftertaste word "light" disagree; both kept as written. |
| Nightcap Decaf | null | null | null | null | no call; Nutty / Cocoa family ticked; "more fruity" on the line is Joe's (remark 38) | Last cup of the day; scores provisional. |

### B5. Descriptors (leaf by exact name; `custom_notes` = the sheet's words)

| coffee | leaf ← words |
|---|---|
| Feminista | Blueberry ← berries |
| La Familia Guarnizo | Honey ← honey · Caramelized ← caramel · Hazelnut ← nuts · Black Tea ← green tea |
| The Village | Fresh ← green · Caramelized ← brown sugar |
| Benchmark | Chocolate ← cocoa · Hazelnut ← nuts · Caramelized ← caramel · Cinnamon ← spice |
| Amsterdam | Chocolate ← cocoa, milk chocolate, chocolate · Hazelnut ← nuts |
| The Daily | Chocolate ← milk chocolate, chocolate · Caramelized ← caramel |
| Big City | Musty / Earthy ← musty · Hazelnut ← roasted nuts, nuts · Caramelized ← brown sugar · Roast ← burned |
| Nightcap Decaf | Hazelnut ← nuts · Almond ← almonds · Molasses ← molasses |

Then `mergeByRule` for each of the eight. Expected: eight merged rows, `merge_note` says `one cupper` on every dimension, no disagreement, dial signal fired (all `ab_0_15`).

### B6. Joe Coffee remarks (38 rows through `recordRemarks`)
Common: `roaster_id` Joe Coffee, `said_on = 2026-10-02`, `channel = 'cupping_table'`, `recorded_by = 'Dana'`, `coffee_id` the A1 coffee, `portal_coffee_id` the lineup row, `cupping_session_coffee_id` the B1 row, `said_by_respondent_id` null (Natalie is not a portal respondent). `said_by` is `Natalie (Joe Coffee, marketing director)` where the sheet says "she" or Dana attributed it to Natalie; otherwise `Joe Coffee staff at the cupping table`. `record_source` is `paper: <file>`.

| # | coffee | topic | remark (verbatim) | said_by | record_source | extra |
|---|---|---|---|---|---|---|
| 1 | Feminista | general | Single origin. | staff | Feminista profile | |
| 2 | Feminista | process | Interesting process. | staff | Feminista profile | |
| 3 | Feminista | brewing | Best brewing: pour-over and espresso. They don't expect espresso and it's surprising. | staff | Feminista profile | |
| 4 | Feminista | availability | Limited release, a specific line. If seasonal, can usually offer a similar profile when it runs out: yes. | staff | Feminista profile | |
| 5 | Feminista | general | Natalie's favorite among the fruity coffees. | Natalie | Dana's sheet | |
| 6 | La Familia | general | Single origin. | staff | La Familia profile | |
| 7 | La Familia | classification | Floral. | staff | La Familia profile | proposed_archetype = floral |
| 8 | La Familia | descriptor | White floral. | staff | La Familia profile | cupping_note_id null |
| 9 | La Familia | descriptor | Orange blossom. | staff | La Familia profile | cupping_note_id null |
| 10 | La Familia | brewing | Best brewing: pour-over and espresso. | staff | La Familia profile | |
| 11 | La Familia | brewing | Drip, pour over. | Natalie | Dana's sheet | |
| 12 | La Familia | classification | She sees it more as floral (Dana had called it Balanced). | Natalie | Dana's sheet | proposed_archetype = floral |
| 13 | The Village | general | Favorite. Single origin. | Natalie | Village profile | |
| 14 | The Village | classification | Fruity. | staff | Village profile | proposed_archetype = fruity |
| 15 | The Village | descriptor | Malic acidity. | staff | Village profile | cupping_note_id = Malic Acid (if the leaf exists, Task 0) |
| 16 | The Village | dimension | There is acidity here. Light roast, light fruity. | Natalie | Dana's sheet | |
| 17 | The Village | brewing | Best brewing: pour-over and espresso. | staff | Village profile | |
| 18 | The Village | availability | Typical notice before it becomes unavailable: 2+ months. "Similar profile when it runs out: yes" was marked and then crossed; unclear. | staff | Village profile | |
| 19 | Benchmark | classification | Balanced. | staff | Benchmark profile | proposed_archetype = balanced_sweet |
| 20 | Benchmark | brewing | Best brewing: drip and espresso. Good in a latte. | staff | Benchmark profile | |
| 21 | Benchmark | general | No edge. Good in a latte. Drip coffee preferred. | Natalie | Dana's sheet | |
| 22 | The Daily | classification | Chocolate and Nutty. | staff | Daily profile | proposed_archetype = chocolate_nutty |
| 23 | The Daily | brewing | Best brewing: drip and espresso. "Light". | staff | Daily profile | |
| 24 | The Daily | general | Their best they have; house drip. | Natalie | Dana's sheet | |
| 25 | Amsterdam | classification | Chocolate and nutty. | staff | Amsterdam loose page | proposed_archetype = chocolate_nutty |
| 26 | Amsterdam | dimension | Smooth. | staff | Amsterdam loose page | |
| 27 | Amsterdam | brewing | Brewing method: espresso, French press. | staff | Amsterdam loose page | |
| 28 | Amsterdam | brewing | Espresso recommended. | Natalie | Dana's sheet | |
| 29 | Amsterdam | origin | Coffee from Brazil, best they have. | Natalie | Dana's sheet | |
| 30 | Big City | classification | Earth (delicate earth). | staff | Big City loose page | proposed_archetype = earthy |
| 31 | Big City | dimension | Not bitter as much because of the natural process. | staff | Big City loose page | |
| 32 | Big City | process | It's natural process, so it removes bitterness. Delicate earthy. | Natalie | Dana's sheet | |
| 33 | Big City | brewing | 1 espresso, 2 drip. | staff | Big City loose page | |
| 34 | Big City | availability | Available all the time. | staff | Big City loose page | |
| 35 | Big City | general | Goes with food, in restaurants. Dark roast. | Natalie | Dana's sheet | |
| 36 | Nightcap Decaf | dimension | Strong acidity for a decaf. | staff | Nightcap loose page | |
| 37 | Nightcap Decaf | classification | Fruity decaf. | staff | Nightcap loose page | proposed_archetype = fruity |
| 38 | Nightcap Decaf | classification | More fruity. | Natalie | Dana's sheet | proposed_archetype = fruity |

File names for `record_source`: `Joe Coffee - Feminista - Roastery Notes.pdf`, `Joe Coffee - La Familia - Roastery Notes.pdf`, `Joe Coffee - The Village - Roastery Notes.pdf`, `Joe Coffee - Benchmark - Roastery Notes.pdf`, `Joe Coffee - The Daily - Roastery Notes.pdf`, `Joe Coffee - Amesterdam - Roastery Notes.pdf` (sic), `Joe Coffee - Big City - Roastery Notes.pdf`, `Joe Coffee - Roastery notes - Nightcup.pdf` (sic), `Joe Coffee - Cupping Notes - Dana.pdf`.

## PART C: Joe Bean, session 2026-09-30 (Dana + Camila, blind)

### C1. Session
`createSession({ sessionDate: '2026-09-30', brewMethod: 'cupping', location: null, recordSource: 'paper: Dana 1.jpg, Dana 2.jpg, Camila 1.jpg, Camila 2.jpg (misc/roasteries/Joe Bean/Cupping 1 - Sep 2026); transcribed 2026-10-14', sheetFormat: 'ab_0_15_8dim', isBlind: true, roasterPresent: false, sessionNotes: 'Joe Bean Roasters, cupping 1. Four blends under blind codes. Ratio, grind, water temp, steep, cups not recorded. Sheets 3 and 4 (Brazil, Indonesia, D.R. Congo single origins) are not in the folder and are not loaded. Merged by rule (union, n = 2).' })`

`addSessionCoffee` display_order 1 to 4 with `blindCode`: Tiger Stripe Espresso `TIGER`, Geometric Filter Coffee `GEOMETRIC`, Blossom Dark Roast `BLOSSOM`, Fabricator House Roast `FABRICATION`.

### C2. Numeric values (0 to 15; dimensions 1, 2, 3 carry the sheet's intensity). `–` = no row.

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|---|---|---|
| Tiger Stripe | Dana | 4 | 4 | – | 2–8, raw `marks at 2, 4, 5, 6, 8; unresolved` | 3–8, raw `marks at 3, 5, 8` | 2–5 | 7–9 | – |
| Tiger Stripe | Camila | 4 | 8 | 5 | 3 | 2 | 3 | 5 | 8 |
| Geometric | Dana | 5 | 5 | – | 4–9, raw `marks at 4, 6, 7, 9` | 10–12 | 1–4 | 8–10 | – |
| Geometric | Camila | 7 | 11 | 8 | 1 | 5 | 2 | 6 | 3 |
| Blossom | Dana | 8 | 6 | – | 0 | 3–5 | 7 | 8–10 | – |
| Blossom | Camila | 13 | 11 | 11 | 0 | 0 | 6 | 9 | 15 |
| Fabricator | Dana | 8 | 5 | – | 4–7, raw `marks at 4, 5, 6, 7` | 8–10 | 2–5 | 4–7 | – |
| Fabricator | Camila | 10 | 3 | 8 | 7 | 5, raw `5; a scribbled mark near 2-3 as well` | 5 | 4 | 7 |

Where a cupper wrote words on 1, 2 or 3 without an intensity (Dana's Flavor), the row has null min/max and the words in `notes`.

### C3. Words on 1, 2, 3, 11, 12 (`notes`; verbatim, lower-cased)

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 12 Mouthfeel | 11 Finish Character |
|---|---|---|---|---|---|---|
| Tiger Stripe | Dana | sweet, milk choc, caramel | light fruit, sweet-honey?, choc | chocolate, berries | silky | sweet, tea like, light acid |
| Tiger Stripe | Camila | fruity tea, jasmine | orange, bitter choc, smoky | nuts | creamy | smoky, black tea |
| Geometric | Dana | cocoa, chocolate, almonds | almonds, spice? | almonds | silky | sweet, tea like |
| Geometric | Camila | almonds, ~fruity / berries | chocolate, sweet, honey | tea (dark) | silky | – |
| Blossom | Dana | cocoa, rust?, honey, smokey | smokey, earth | earthy, roasty | silky | bitter |
| Blossom | Camila | salty, smoky, BBQ chips | after fire, syrup | cigarette, tobacco | silky | – |
| Fabricator | Dana | honey, sweet, choc milk, orange, cherry? | orange-fruits, sweet | oranges / fruits | – | sweet, light acid |
| Fabricator | Camila | orange, dried fruits | flower, sweet, "not citrus" | fruits, raspberry, jasmine flower | – | – |

### C4. Descriptors

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

### C5. Call columns and `overall_notes`

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

### C6. Merge
`mergeByRule` for each of the four. Expected disagreement lists (a check on `unionScores`, not something to force): Tiger Stripe none; Geometric: Acidity, Sweetness; Blossom: Sweetness; Fabricator: Sweetness (dimensions 1 to 3 may add to these now that they are numeric; report what the rule says). Merged archetype call: Geometric = balanced_sweet; the other three null with both calls in `call_note`. Dial signal fired on all four (all `ab_0_15`).

## PART D: Utopian, three flights (Dana + Camila, not blind)

| flight | session_date | sheetFormat | recordSource | coffees (display_order) | sessionNotes |
|---|---|---|---|---|---|
| A | 2026-09-13 | freeform_grid | `paper: IMG_3754 (Dana), IMG_3755 (Camila) (misc/roasteries/Utopian); transcribed 2026-10-16` | Mexico Alva Flores, Peru Chirinos, Colombia Andres Martinez, Peru Joel Silva | First Utopian cupping. Freeform grid: Dana 0 to 15 ranges; Camila integers on a 0 to 5 relative grid (scale_code grid_0_5). Merged by rule (union, n = 2). |
| B | null | freeform_grid | `paper: IMG_3753 (Dana), IMG_3751 (Camila) (misc/roasteries/Utopian); transcribed 2026-10-16` | Espresso Volo, Obsidian, Decaf Mexico Veracruz | Date not on the sheets; photographed 2026-10-16; between 2026-09-14 and 2026-10-16. Freeform grid: Dana 0 to 15 ranges; Camila words low / medium / high (scale_code word_3). Merged by rule; no dial signal (converted scale). |
| C | null | ab_0_15_8dim | `paper: IMG_3750, IMG_3749 (Dana), IMG_3747, IMG_3748 (Camila) (misc/roasteries/Utopian); transcribed 2026-10-16` | Flying Jewel (coffee 2891), Union, Pearl | Date not on the sheets; photographed 2026-10-16; Flying Jewel was placed 2026-09-27 with the note "Bloom dial: light fruity" from this sheet, so the flight is likely before that. Merged by rule (union, n = 2). |

`brewMethod: 'cupping'`, `location: null`, `isBlind: false`, `roasterPresent: false` on all three. `sampleNote` `'end-of-run lot'` on Mexico Alva Flores and Colombia Andres Martinez. Flying Jewel: see Task 0 before adding it to flight C.

### D1. Numeric values (0 to 15 after conversion; dimensions 1 to 3 numeric only where the sheet has an intensity). `–` = no row.

| coffee | cupper | scale | 1 Fragrance | 2 Aroma | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|---|---|---|
| Alva Flores | Dana | ab_0_15 | – | – | 3–4, notes `grape` | 7–10 | 0–3 | – | – |
| Alva Flores | Camila | grid_0_5 | – | – | 0–1, raw `grid 0-5: 0` | 0–1, raw `grid 0-5: 0` | 11–13, raw `grid 0-5: 4` | – | – |
| Chirinos | Dana | ab_0_15 | – | – | 3–8, raw `two readings: 3-4 and 6-8 (lime)` | 4–6 | 0–4 | – | – |
| Chirinos | Camila | grid_0_5 | – | – | 2–4, raw `grid 0-5: 1` | 14–15, raw `grid 0-5: 5` | 0–1, raw `grid 0-5: 0` | – | – |
| Andres Martinez | Dana | ab_0_15 | – | – | 4–8, raw `two readings: 4-6 and 6-8 (lime)` | 2–4 | 0–4 | – | – |
| Andres Martinez | Camila | grid_0_5 | – | – | 14–15, raw `grid 0-5: 5` | 8–10, raw `grid 0-5: 3` | 5–7, raw `grid 0-5: 2` | – | – |
| Joel Silva | Dana | ab_0_15 | – | – | 4–8, raw `two readings: 4-6 and 6-8 (lemon)` | 4–5 | 0–4 | – | – |
| Joel Silva | Camila | grid_0_5 | – | – | 14–15, raw `grid 0-5: 5` | 5–7, raw `grid 0-5: 2` | 5–7, raw `grid 0-5: 2` | – | – |
| Espresso Volo | Dana | ab_0_15 | – | – | 4–6 | 0–4 | 5–7 | – | – |
| Espresso Volo | Camila | word_3 | – | – | 0–5, raw `low` | 0–5, raw `low` | 0–5, raw `low` | – | – |
| Obsidian | Dana | ab_0_15 | – | – | 0–4 | 0–4 | 10–13 | – | – |
| Obsidian | Camila | word_3 | – | – | 0–5, raw `low` | 0–5, raw `low` | 5–10, raw `medium` | – | – |
| Decaf Veracruz | Dana | ab_0_15 | – | – | 2–4 | 4–6 | 0–4 | – | – |
| Decaf Veracruz | Camila | word_3 | – | – | 0–5, raw `low` | 5–10, raw `medium` | 0–5, raw `low` | – | – |
| Flying Jewel | Dana | ab_0_15 | 7–9 | 7 | 0–4, raw `marks at 0, 2, 4; berries` | 5 | 4–5 | 5 | 5 |
| Flying Jewel | Camila | ab_0_15 | – | – | 4–5 | 4 | 0 | 3 | 5 |
| Union | Dana | ab_0_15 | 7–9 | 5 | 4–5, notes `orange` | 5 | 3–8, raw `marks at 3 and 8` | 7 | – |
| Union | Camila | ab_0_15 | – | – | 2–6, raw `marks at 2, 3, 6; heavy rework on the line` | 1 | 1 | 1 | 2 |
| Pearl | Dana | ab_0_15 | 7–9 | 5 | 3–7, raw `marks at 3 and 7` | 9 | 3 | 5–7 | – |
| Pearl | Camila | ab_0_15 | – | – | 0–1 | 2 | 2 | 2 | 3 |

Freeform grids (flights A and B) have a "mouthfeel" line in words only: those words go to dimension 12, no Body value. Dimension 3 Flavor has no intensity on any Utopian sheet: words only.

### D2. Words on 1, 2, 3, 11, 12 (`notes`)

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
| Flying Jewel | Dana | chocolate, almonds, fruits, berries, apple (marked x) | – | fruits, ~chocolate | creamy | acid, light, ~berries |
| Flying Jewel | Camila | berry | brown sugar, ~chocolate (?) | berries, raspberry | – | berries |
| Union | Dana | fruits, pomegranate, chocolate | fruits, black tea, ~nuts | dark chocolate, fruit, orange | – | light acid |
| Union | Camila | sour fruity | black tea, sweet aromatics | light citrus (?) | dry | – |
| Pearl | Dana | cocoa, nuts | light cocoa, fruits, dried fruits | fruits, citrus | silky | acid |
| Pearl | Camila | pepper | black tea, jasmin | tea | light | short, smoky light |

### D3. Descriptors

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

### D4. Call columns and `overall_notes`

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

### D5. Merge
`mergeByRule` for all ten. Expected disagreement lists (a check, not a target): Alva Flores: Sweetness, Bitterness; Chirinos: Sweetness; Andres Martinez: Acidity, Sweetness; Joel Silva: Acidity; Volo, Obsidian, Decaf: none (Camila's thirds overlap Dana's ranges: the honest consequence of the conversion, and the reason these rows are `word_3`); Flying Jewel: Bitterness; Union: Sweetness, Body; Pearl: Sweetness, Body. Merged archetype call: Volo = earthy, Obsidian = earthy, Union = balanced_sweet; all others null. Dial signal: flights A and B none (converted scales, `merge_note` says so); flight C yes.

### D6. Utopian website notes → `roastery_remark` (52 rows through `recordRemarks`)
Common: `roaster_id` Utopian, `channel = 'website'`, `said_by = 'Utopian Coffee Co. (utopiancoffee.com)'`, `said_on` = the intake xlsx last-modified date (Task 0), `recorded_by = 'Dana'`, `record_source = 'utopiancoffee.com via misc/roasteries/intake/Roaster_Intake_Utopian.xlsx (Sep 2026)'`, `coffee_id` the catalog coffee, `portal_coffee_id` the lineup row, `cupping_session_coffee_id` null. One `descriptor` row per published note (verbatim, capitalised as published), one `process` row, one `roast` row. Where a leaf fits, `cupping_note_id` is set and the same `normalized_words → leaf` is written to `roastery_portal_note_mapping` through its service; where no leaf fits, null and no mapping row.

| coffee | descriptor remarks (verbatim → leaf or null) | process | roast |
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

Expected: 30 descriptor + 2 dimension + 10 process + 10 roast = 52 remarks; 16 note mappings. The eight uncupped Utopian coffees in the xlsx are not loaded (no lineup row, no catalog row).

## CONSTRAINTS
- Loader `backend/src/features/cupping_evidence/load_cupping_evidence_2.ts`, run with `npm run` on the test DB first end to end (A → B → C → D), then prod. Idempotent by natural key (DESIGN §6.6): a re-run reports `already loaded` per step and inserts nothing twice.
- Dry run of every manifest on prod first (`ROASTER_NOT_FOUND` must not happen).
- Use a marked `Zzz Test` admin identity only where the services require one; never act as Dana or Camila beyond `taster_name` / `recorded_by` values, which are data.
- No placement, price, guest slot or SKU beyond what A1 states; no change to coffee 2891's assignment or placement; no portal response, link or respondent touched; no slot created, renamed, priced or deactivated; no other roastery's coffee moves except the one priority shift on `balanced_sweet/2`.
- `lint:cupping`, `lint:roastery-portal`, `lint:catalog` green; `npm run build` clean; `runCatalogIntegrityChecks().allPass = true` on test and prod after the imports.
- Nothing is deleted anywhere. If a step fails midway, report what was written; do not clean up.
- Commits: manifests + loader + this brief's status line + one `WHAT_WE_BUILT.md` entry + a dated line in `WHAT_WE_BUILT_DB.md`'s Cupping evidence section. Straight to main. No schema change, so no `comments.sql` / `CATALOG.md` change.

## DONE =
21 catalog coffees exist (8 Joe Coffee: Feminista, The Village on `fruity/1`, La Familia on `floral/1`, Benchmark on `balanced_sweet/2` priority 1, each with a 12 oz SKU and visible in `v_coffee_sellable_slot`; the other four unplaced; Nightcap carries `decaf`. 4 Joe Bean and 9 Utopian unplaced with provisional assignments carrying their basis lines); 21 lineup rows linked; five sessions (Joe Coffee 2026-10-02 not blind, roaster present; Joe Bean 2026-09-30 blind; Utopian A 2026-09-13, B, C) with 22 session coffees, 36 cupper rows (8 + 8 + 20) and 22 rule-merged rows, values with `raw_value`, descriptors and call columns exactly as above; 38 Joe Coffee table remarks and 52 Utopian website remarks readable through `v_roastery_remark`; 16 note mappings; integrity green; Flying Jewel handled per Task 0.

Closing report: coffee ids; session ids; per session coffee the score ids (per cupper and merged) and the merged `merge_note`; the leaf names that were missing or respelled; the import warnings; the before/after of `balanced_sweet/2`; the Flying Jewel finding; the admin URLs (Coffees page, Roastery Feedback for the three roasteries).
