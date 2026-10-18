# Cupping Evidence, brief 2: load Joe Coffee, Joe Bean and Utopian (catalog rows, sessions per cupper, rule merges, roaster remarks, lineup links). Data only.

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-16 (CTO session; decisions by Dana) · Model: Sonnet is fine
> **v3 (2026-10-17):** this brief was corrected against a blind second read of the sheets (`TRANSCRIPTION_CHECK_BRIEF_2_2026-10-16.md`) and aligned with brief 1 v3 (reference tables, native-scale values, SCA tiers, supersede, brew params, provenance). The v2 text is kept as `SUPERSEDED_…_2_LOADS_v2.md`. Where this file and the check disagree, the check wins; where the check says "Dana decides", the default in `DESIGN_CUPPING_EVIDENCE_v3_CHANGES.md` §4 applies and is already written into the tables below.
> Status: **DONE 2026-10-18** on test and prod (`95aa0fe`, revision `axis-bloom-backend-00758-9zk`; docs commit after it). Closing report: `CLOSING_REPORT_2.md`. `WHAT_WE_BUILT.md` #225.
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
2. Ranges as written; a single mark is `min = max`; several marks are the span. **A crossed-out or scribbled-over mark is never counted** and is named in `raw_value` (`'4-6; marks at 2 and 8 struck'`). A struck word stays in `notes` as `~word` and never becomes a descriptor row. `raw_value` carries the paper exactly; where the table gives none, it is `'<min>-<max>'` (or `'<v>'` for a point).
3. Camila's word scale (Utopian flight B) → `scale_code = 'word_3'`, `value_min/max` null, `raw_value = 'low'`; her 0 to 5 grid (flight A) → `scale_code = 'grid_0_5'`, `value_min = value_max = <the digit>`, `raw_value = 'grid 0-5: 4'`. **Native values are stored; nothing is converted in the loader.** The views convert through `cupping_to_ab()` and `cupping_scale_step`. Dana's and Camila's A&B sheets → `ab_0_15`.
4. **Withdrawn.** Dana's second acidity readings on Utopian flight A are struck on the paper (Chirinos, Andres Martinez) or overwritten and read as struck (Joel Silva). The live reading loads; `raw_value = '3-4; second reading 6-8 struck (lime)'`; `~lime` / `~lemon` stay in the acidity `notes`; no Lime / Lemon descriptor row.
5. Dimension mapping: numeric Mouthfeel light to heavy = 7 Body; numeric Aftertaste short to long = 10 Finish Length; mouthfeel words = 12; aftertaste words = 11 Finish Character; Fragrance, Aroma, Flavor = 1, 2, 3, **numeric since brief 1**: an "intensity N" on the sheet goes to `value_min/max`, the words to `notes`; a sheet with words only leaves min/max null.
6. Descriptors: every word that names an SCA node goes to `cupping_score_descriptors` at **the most specific node the cupper named, never deeper** (`cupping_note.tier`), `intensity` null, `custom_notes` = the sheet's words; two words on one node = one row, both words. The generic words resolve through `roastery_portal_note_mapping` with `source_kind = 'cupper'`, written once by the loader through `noteMappingService.setNoteMapping` before any score is loaded: berries / berry → **Berry** (tier 2); nuts / roasted nuts → **Nutty** (tier 2); cocoa → **Cocoa** (tier 2); chocolate / milk chocolate / choc / choc milk → Chocolate (a leaf under Cocoa); dark chocolate / bitter choc → Dark Chocolate (leaf); spice / spices → **Brown Spice** (tier 2); citrus / citrus fruits → **Citrus Fruit** (tier 2); dried fruits → **Dried Fruit** (tier 2); tea / black tea / green tea / tea like → Black Tea (a leaf); burned / burnt / roasty → Roast (leaf); sugarcane / cane → Molasses; syrup → Maple Syrup; fruits / fruit / fruity → **Fruity** (tier 1); flower / floral → **Floral** (tier 1). The tables below are already written with these nodes; the loader looks each word up in the mapping table and refuses an unmapped convention. Words with no SCA node (sweet, creamy, juicy, happy, BBQ chips, soy) stay in the text dimension only.
7. The cupper's blind call goes to the call columns. A family tick or circle is a `call_note`, not a call. "Earthy" written under "Other" on the family line is a call note.
8. Each cupped coffee needs a `coffees` row. Joe Coffee's eight are created through the import manifest with the archetypes and placements Dana decided (four placed, four unplaced). Joe Bean's four and Utopian's nine new ones are created **unplaced** with a provisional assignment (`confidence = 'low'`, or `'medium'` when both cuppers made the same **unstruck** call; `source = 'cupping'`; basis line per DESIGN §8.3 ending `provisional, pending the calibration pass`). Union is `low`: both cuppers wrote "balanced" and struck it. Every manifest coffee gets the bare `{ weightOz: 12 }` SKU the importer requires; unplaced stays invisible. Flying Jewel (coffee 2891) exists and keeps its assignment; its cupping rows attach to it.
9. Roaster remarks (table talk, Utopian's website) go to `roastery_remark` through `recordRemarks`. Where a website note maps cleanly to a node, the mapping is also remembered in `roastery_portal_note_mapping` through `noteMappingService.setNoteMapping` (`source_kind = 'roaster'`).
10. Joe Coffee's and Joe Bean's published notes are loaded too (D7, D8), captured from their product pages on 2026-10-18 by the review session, so all three roasteries carry the same five sources from day one.
11. Nothing is deleted, superseded or re-merged. If a step fails midway, report what was written and stop; the loader is idempotent by natural key, so the next run continues.
12. **Brew protocol.** Every session is created with `brewDefaults: { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl', notes: 'standard A&B cupping protocol (Dana, 2026-10-16); temperature, grind and steep time not recorded on the sheets' }`, so every session coffee gets a `cupping_brew_params` row. Unrecorded fields stay null.
13. **Dates.** Utopian flights B and C: `sessionDate: '2026-09-20', sessionDatePrecision: 'estimated'`. All other sessions `'exact'`.
14. **Provenance.** Every session: `transcribedBy: 'Claude (CTO session)'`, `transcribedAt` = the date already in `recordSource`, `checkedBy: 'Dana; blind second read 2026-10-16 (TRANSCRIPTION_CHECK_BRIEF_2_2026-10-16.md)'`. `recordSource` names files only (drop the `; transcribed <date>` suffix).
15. **Cuppers by id.** `saveCupperScore` takes `cupperId` from `cupper` (Dana, Camila). No taster name anywhere in the loader.
16. **Order** (corrected on the test run, 2026-10-18: a session coffee needs its `coffees` row first). Session headers → manifests (Part A, with the session ids in the basis lines; the importer takes `match.notes` and `match.sessionId`) → session coffees and brew rows → cupper rows → merges → `refreshDialSignal` for every loaded coffee (the importer also refreshes on create). Nothing is updated afterwards.
17. **Loader module.** One script under `features/cupping_evidence/load/`, calling `cuppingService`, `roasteryRemarkService`, `noteMappingService.setNoteMapping`, `catalogImport` and `catalogService` only. No SQL in the loader (`lint:lineage`, `lint:cupping`). No `brewMethod` argument anywhere: the brew is `brewDefaults`.
18. **Test DB first, whole run.** The entire loader (Parts A to D8) runs against the test DB first; the closing report shows the row counts per part and the first rows of `v_cupping_scores_readable`, `v_roastery_remark` and `v_coffee_dimension_range` for one coffee per roastery; prod only after Dana says go. Brief 3's tests need the test rows anyway.
19. **Mappings written by the loader are reviewable.** Every `noteMappingService.setNoteMapping` call from the loader passes `note = 'loader 2026-10-18; rule: <exact | node | contains>'` so `SELECT … FROM roastery_portal_note_mapping WHERE note LIKE 'loader %'` lists every judgment this brief made, for Dana to confirm or supersede from the workbench. `created_by_admin_id` stays null (no person made them). Brief 1's `noteMappingService.setNoteMapping` takes `note`; the table gets a `note TEXT` column there.

## Task 0 (report, read-only; STOP only where it says so)

- `cuppingService.ts` exports `createSession`, `addSessionCoffee`, `saveCupperScore`, `mergeByRule`, `refreshDialSignal`; `cupper` has Dana and Camila; `cupping_scale_step` has the grid and word steps; `cupping_sheet_format` has `ab_0_15_8dim` and `freeform_grid`; `cupping_note` has `tier` and the tier-2 nodes Berry, Nutty, Cocoa, Brown Spice, Citrus Fruit, Dried Fruit; `roastery_portal_note_mapping.source_kind` exists; `coffee_dimensions` 1, 2, 3 are numeric; `roastery_remark.channel` accepts `'website'`; `lint:cupping` and `lint:lineage` are green. If any is missing, STOP: brief 1 v3 has not landed.
- Roasters: `Joe Coffee Company` (`f42ad179-9ef4-410a-a92e-464eae1d84ce`), `Joe Bean Roasters` (`19098f5c-99b9-4d7c-90ef-ee33d1e896b7`), **`Utopian`** (`bbf250d1-e433-4233-a30b-437fe62bcc4a`; the roaster row is named `Utopian`, not `Utopian Coffee Co.`; the longer name is only the free-text `said_by` of the website remarks) exist and are active (report ids).
- Submitted portal responses per roastery (all three have submitted, Dana 2026-10-16): report per lineup coffee the current submitted version and `submitted_at`. Not touched here; brief 3 reads them.
- Lineups: Joe Coffee has 11 active `roastery_portal_coffee` rows: the 8 of A1 plus The Waverly Espresso, Great Heights and Half Moon (Half Caff), which are not cupped and are left unlinked; the 8 are `coffee_id IS NULL`; Joe Bean seven active rows, the four blends in A2 among them, `coffee_id IS NULL`; Utopian ten active rows, Flying Jewel linked to 2891, the other nine `coffee_id IS NULL`. If a lineup row for one of these 21 coffees already has a `coffee_id`, STOP and report.
- `coffees` rows with `roaster_id` of the three roasteries: expected exactly one (2891). If more, STOP and report.
- **Coffee 2891 cupping rows, decided (Dana, 2026-10-18).** Brief 1's closing report found session **35** / session coffee **42** / score **69**: Camila's row only, Sweetness 4, Acidity 4–5, Bitterness 0, Body 3, Finish 5, tagged `legacy` by the backfill, no merged row. Those are exactly Camila's Flying Jewel values on IMG_3747 (the printed 0 to 15 sheet; the blind second read agrees), so session 35 **is** Utopian flight C, hand-entered in Score Entry before the placement of 2026-09-27. It is not a 0 to 5 grid; the values are low because the coffee is delicate. Confirm the three ids and values on prod and report; no STOP.
- `v_roastery_portal_coffee` prefill values (origin, process, roast level, blend/single, decaf) for the 21 lineup rows; where they differ from the manifests below, the lineup's values win (the lineup came from the roaster's site through portal parts 1 and 6); report the differences.
- `lookup_value` codes for `roast_level`, `process`, `blend_or_single` (the importer validates against them; report which of `medium-light`, `medium-dark`, `double fermentation`, `co-ferment`, `mountain_water`, `honey` exist). Where a manifest value has no code, use the lineup's stored value; if the lineup has none, pass null and report; never invent a code.
- Every `cupping_note` leaf named below exists by exact `descriptor` and is active. For a name under a slightly different spelling, use the existing one and report the pair. For a name that does not exist (candidates: Pepper, Sweet Aromatics, Sour Aromatics, Herb-like, Woody, Salty, Ashy, Tobacco, Malic Acid, Fresh, Musty / Earthy), carry the word in the text dimension only and report it; never create a leaf.
- `coffee_dial_slot` rows for `fruity/1`, `floral/1`, `balanced_sweet/2` (ids, names) and the coffees that currently hold them with priorities; which coffee is priority 1 on `balanced_sweet/2` (it will move to priority 2).
- Active sizes in `coffee_size` (12 oz anchor) and whether `coffee_slot_price` has a 12 oz price for the three slots above.
- `coffee_category.code = 'decaf'` active.
- `said_on` for the website remarks is the literal `2026-10-06` (the intake xlsx capture date; not computed from a file).

## PART 0: brief 1 leftovers (small, before any load)

0. **Logged, not done here:** `schema.sql` cannot build an empty database (an object is referenced before it is created; found on the test run). Pre-existing, reported in `CLOSING_REPORT_2.md`, fixed in its own small brief.

1. **Fresh-DB boot.** `db/seeds/session_001_path_2026_05_27.sql` would now fail the `cupping_scores_row_shape` CHECK if re-run (its merged rows have no `merge_rule`, no `scale_code`). Update the seed so a fresh database boots: `is_merged = true, merge_rule = 'legacy', scale_code = 'legacy'` on its merged rows, `cupper_id` null and `scale_code = 'legacy'` on any cupper rows, keyed idempotently as it is today. Prove it by applying `schema.sql` plus the seed on an empty schema in the test instance (a throwaway schema or database, dropped afterwards); prod is unaffected (the seed matches nothing there).
2. **Signal refresh from the importer.** `setMatchArchetypeInTx`, as called by `catalogImport` and by portal acceptance, does not call `cuppingService.refreshDialSignal` (only `setMatchArchetype` does). Add the call after commit on the importer path too (brief 1 decision 8 intends every archetype change to refresh it); the loader's explicit refresh in decision 16 stays as the belt to this brace.
3. **Two SCA parent fixes in the `cupping_note` seed** (master data, editable; idempotent UPDATEs): Anise → parent Brown Spice (SCA puts it there, not under Pungent); the seven Green/Vegetative leaves (Under-ripe, Peapod, Fresh, Dark Green, Vegetative, Hay-like, Herb-like) → parent the tier-2 node "Green/Vegetative" (create it if the tree has only Raw, Olive Oil and Beany at tier 2 under that family), not Raw. Re-run the tree test. The "Brown, Roast" split into two leaves is logged, not changed (descriptor rows may point at both; family roll-up is unaffected).
4. **Flying Jewel's public wheel is empty on prod** until step (6) of flight C runs. If Dana wants it back before this brief runs, she presses "Merge by rule" on session 35 in Score Entry; the merge this brief does later supersedes that one. Not a step of this brief.

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

### A3. `utopian_2026_09.json` (roaster `Utopian`, id `bbf250d1-…`)
Coffee names are the lineup names **as stored**: `Peru Chirinos Geisha` and `Peru Joel Silva Chirinos` (the tables below say "Chirinos" and "Joel Silva" for short). Prefill values come from the lineup where it has one (Task 0, 2026-10-18): Andres Martinez process `other` and roast `light-medium`; Joel Silva roast `light-medium`; Chirinos origin without "(Geisha)"; Joe Bean's Tiger Stripe, Geometric and Fabricator have no roast or process in the lineup and get null. `lookup_value` has `light-medium`, not `medium-light`; it has neither `double fermentation` nor `mountain_water`: the roaster's exact words live in the `process` remark rows (D6), never in an invented code. Decaf Veracruz carries the `decaf` category from its name and the website; the lineup's deprecated `is_decaf` is null and is not consulted.
Same shape. Flying Jewel is **not** in the manifest. Prefill from the Utopian notes file, cross-checked against the lineup (Task 0); lineup wins on a difference.

| name (as in the lineup) | blendOrSingle | roastLevel | process | origin | categoryCodes | match.archetype | confidence | source | notes (basis line) |
|---|---|---|---|---|---|---|---|---|---|
| Espresso Volo | blend | medium-dark | washed, natural | | [] | earthy | medium | cupping | basis: cupping flight B s<id> (Dana=earthy "Light Earth"; Camila=earthy; not blind); roaster portal submitted, see v_roastery_portal_current_response; website: Fragrant Berries, Cocoa, Sweet Tobacco; provisional, pending the calibration pass |
| Peru Chirinos Geisha | single | light | washed | Chirinos, Cajamarca, Peru | [] | floral | low | cupping | basis: cupping flight A s<id> 2026-09-13 (Dana=no call, jasmine/tea; Camila=floral; not blind); roaster portal: not submitted as of 2026-10-18; website: Mango Puree, Narcissi, Honeycomb; provisional, pending the calibration pass |
| Obsidian | blend | dark | washed | | [] | earthy | medium | cupping | basis: cupping flight B s<id> (Dana=earthy; Camila=earthy "Standard"; not blind); roaster portal submitted, see v_roastery_portal_current_response; website: Palo Santo, Campfire 'Mallows, Mrs. Buttersworth; provisional, pending the calibration pass |
| Decaf Mexico Veracruz | single | medium | washed | Veracruz, Mexico | [decaf] | balanced_sweet | low | cupping | basis: cupping flight B s<id> (Dana=balanced_sweet, "choc & nut" struck; Camila=chocolate_nutty; cuppers disagree); roaster portal submitted, see v_roastery_portal_current_response; website: Red Apple, Flaky Croissant, Walnut Butter; provisional, pending the calibration pass |
| Peru Joel Silva Chirinos | single | light-medium | natural | Chirinos, Cajamarca, Peru | [] | fruity | low | cupping | basis: cupping flight A s<id> 2026-09-13 (Dana=no call, citrus/orange; Camila=fruity); roaster portal submitted, see v_roastery_portal_current_response; website: Ground Cherry, Ube Halo Halo, Crunchy Sweetness; provisional, pending the calibration pass |
| Mexico Alva Flores | single | medium | washed | Santa Cruz Ozolotepec, Oaxaca, Mexico | [] | fruity | low | cupping | basis: cupping flight A s<id> 2026-09-13 (no call from either cupper; both wrote berries / black tea); roaster portal: not submitted as of 2026-10-18; website: Black Plum, Honeycomb, Champorado; sample was an end-of-run lot; provisional, pending the calibration pass |
| Pearl | blend | light | washed, natural | | [] | fruity | low | cupping | basis: cupping flight C s<id> (Dana=fruity, "Bloom dial: light fruity"; Camila=no call, Floral family ticked); largest cupper disagreement of the session; roaster portal submitted, see v_roastery_portal_current_response; website: Citrusy, Bright, Sweet, juicy fruit with a backbone of chocolate; provisional, pending the calibration pass |
| Union | blend | medium | washed | | [] | balanced_sweet | low | cupping | basis: cupping flight C s<id> (Dana=no call, wrote "balanced" and struck it; Camila=no call, Floral and Fruity boxed together, "limit of floral and fruity", wrote BALANCED in the margin and struck it; not blind); roaster portal submitted, see v_roastery_portal_current_response; website: Smooth, caramel sauce, buttered pastry, pistachio (roaster reads it Balanced; Dana unsure, 2026-10-16); zero descriptor overlap; provisional, pending the calibration pass |
| Colombia Andres Martinez | single | light-medium | other (lineup; the roaster's "Double fermentation" is a process remark) | Cauca, Colombia | [] | fruity | low | cupping | basis: cupping flight A s<id> 2026-09-13 (no call from either cupper; both wrote dried fruit / berries / citrus); roaster portal: not submitted as of 2026-10-18; website: Fragrant Jasmine, Green Melon, Almond Butter; sample was an end-of-run lot; provisional, pending the calibration pass |

### A3b. Slot prices (Dana, 2026-10-18), after the prod load
`catalogService.setSlotPrice({ slotId, weightOz: 12, retailPriceCents: 2900 })` on `fruity/1`, `floral/1` and `balanced_sweet/2` (the `PUT /api/admin/catalog/slots/:slotId/prices` door, as the Zzz Test admin on test, as the loader's catalog context on prod), unless the slot already has a 12 oz price, which is then left alone and reported. Afterwards Feminista, The Village, La Familia and Benchmark appear in `v_coffee_sellable_slot`; report the four rows. No other slot and no other size is priced by this brief.

### A4. Lineup links
`linkLineupCoffeeToCatalog(portalCoffeeId, coffeeId)` for the eight Joe Coffee rows, the four Joe Bean rows and the nine Utopian rows. Afterwards `v_roastery_portal_coffee` shows Joe Coffee 8 of 8, Joe Bean 4 of 7 (the three single origins stay unlinked: not cupped, no catalog row), Utopian 10 of 10. The submitted portal responses are untouched; Dana accepts them from Roastery Feedback when she wants.

## PART B: Joe Coffee, session 2026-10-02 (Dana)

### B1. Session
`createSession({ sessionDate: '2026-10-02', sessionDatePrecision: 'exact', brewMethod: 'cupping', location: 'Joe Coffee Company, New York', recordSource: 'paper: Joe Coffee - Cupping Notes - Dana.pdf (4 pages; sheets printed 1 of 4 twice, 2 of 4, 3 of 4)', transcribedBy: 'Claude (CTO session)', transcribedAt: '2026-10-11', checkedBy: 'Dana; blind second read 2026-10-16', brewDefaults: <decision 12>, sheetFormat: 'ab_0_15_8dim', isBlind: false, roasterPresent: true, sessionNotes: 'Cupping at Joe Coffee with Natalie (marketing director) and Joe staff. Eight coffees, Dana scored (ranges). Roaster remarks captured in roastery_remark. Merged by rule (one cupper).' })`

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
| Amsterdam | chocolate_nutty | null | null | null | "can be earthy" written after the call | Coffee from Brazil, best they have (Joe's, remark table). |
| The Daily | null | null | null | null | no call written | |
| Big City | earthy | null | delicate earthy | null | the "natural process" part of the line is Joe's (remark 32) | Bitterness 7–9 and aftertaste word "light" disagree; both kept as written. |
| Nightcap Decaf | null | null | null | null | no call; Nutty / Cocoa family ticked; "more fruity" on the line is Joe's (remark 38) | Last cup of the day; scores provisional. |

### B5. Descriptors (leaf by exact name; `custom_notes` = the sheet's words)

| coffee | leaf ← words |
|---|---|
| Feminista | Berry ← berries |
| La Familia Guarnizo | Honey ← honey · Caramelized ← caramel · Nutty ← nuts · Black Tea ← green tea |
| The Village | Fresh ← green · Caramelized ← brown sugar |
| Benchmark | Cocoa ← cocoa · Nutty ← nuts · Caramelized ← caramel · Brown Spice ← spice |
| Amsterdam | Cocoa ← cocoa · Chocolate ← milk chocolate, chocolate · Nutty ← nuts |
| The Daily | Chocolate ← milk chocolate, chocolate · Caramelized ← caramel |
| Big City | Musty / Earthy ← musty · Nutty ← roasted nuts, nuts · Caramelized ← brown sugar · Roast ← burned |
| Nightcap Decaf | Nutty ← nuts · Almond ← almonds · Molasses ← molasses |

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
`createSession({ sessionDate: '2026-09-30', sessionDatePrecision: 'exact', brewMethod: 'cupping', location: null, recordSource: 'paper: Dana 1.jpg, Dana 2.jpg, Camila 1.jpg, Camila 2.jpg (misc/roasteries/Joe Bean/Cupping 1 - Sep 2026)', transcribedBy: 'Claude (CTO session)', transcribedAt: '2026-10-14', checkedBy: 'Dana; blind second read 2026-10-16', brewDefaults: <decision 12>, sheetFormat: 'ab_0_15_8dim', isBlind: true, roasterPresent: false, sessionNotes: 'Joe Bean Roasters, cupping 1. Four blends under blind codes (Blind Y/N not ticked on the sheets; blind per Dana). Date on sheets 2 of 4 only. Ratio, grind, water temp, steep, cups not recorded. Sheets 3 and 4 (Brazil, Indonesia, D.R. Congo single origins) are not in the folder and are not loaded. Merged by rule (union, n = 2).' })`

`addSessionCoffee` display_order 1 to 4 with `blindCode`: Tiger Stripe Espresso `TIGER`, Geometric Filter Coffee `GEOMETRIC`, Blossom Dark Roast `BLOSSOM`, Fabricator House Roast `FABRICATION`.

### C2. Numeric values (0 to 15; dimensions 1, 2, 3 carry the sheet's intensity). `–` = no row.

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|---|---|---|
| Tiger Stripe | Dana | 4 | 4 | – | 4–6, raw `4-6; marks at 2 (X'd) and 8 (scribbled) struck` | 3–5, raw `3-5; mark at 8 scribbled out` | 2–5 | 7–9 | – |
| Tiger Stripe | Camila | 4 | 8 | 5 | 3 | 2 | 3 | 5 | 8 |
| Geometric | Dana | 5 | 5 | – | 4–7, raw `marks at 4, 6, 7; 9 scribbled out` | 10–12 | 1–4 | 8–10 | – |
| Geometric | Camila | 7 | 11 | 8 | 1 | 5 | 2 | 6 | 3 |
| Blossom | Dana | 8 | 6 | – | 0 | 3–5 | 7 | 8–10 | – |
| Blossom | Camila | 13 | 11 | 11 | 0 | 0 | 6 | 9 | 15 |
| Fabricator | Dana | 8 | 5 | – | 5–7, raw `marks at 5, 6, 7; the 4 overdrawn, read as struck` | 8–10 | 2–5 | 5–7, raw `marks at 5, 7; the 4 overdrawn, read as struck` | – |
| Fabricator | Camila | 10 | 3 | 8 | 7 | 5, raw `5; a scribbled mark near 2-3 as well` | 5 | 4 | 7 |

Where a cupper wrote words on 1, 2 or 3 without an intensity (Dana's Flavor), the row has null min/max and the words in `notes`.

### C3. Words on 1, 2, 3, 11, 12 (`notes`; verbatim, lower-cased)

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 12 Mouthfeel | 11 Finish Character |
|---|---|---|---|---|---|---|
| Tiger Stripe | Dana | sweet, milk choc, caramel | light fruit, sweet-honey?, choc | chocolate, berries? | silky | ~sweet, tea like, light acid |
| Tiger Stripe | Camila | fruity tea, jasmine | orange, bitter choc, smoky | nuts | creamy | smoky, black tea |
| Geometric | Dana | cocoa, chocolate, almonds | almonds, spice? | almonds | silky | sweet, tea like |
| Geometric | Camila | almonds, ~fruity / berries | chocolate, sweet, honey | tea (dark) | silky | – |
| Blossom | Dana | cocoa, rust?, honey, smokey | smokey, earth | earthy, roasty | silky | bitter |
| Blossom | Camila | salty, smoky, BBQ chips | after fire, syrup | cigarette, tobacco | silky | – |
| Fabricator | Dana | ~honey, sweet, choc milk, orange (inserted above the struck honey), ?. cherry like (interlinear) | ~orange, fruits, sweet | oranges / fruits | – | sweet, light acid |
| Fabricator | Camila | orange, dried fruits | flower, sweet, "not citrus" | fruits, raspberry, jasmine flower | – | – |

### C4. Descriptors

| coffee | cupper | leaf ← words |
|---|---|---|
| Tiger Stripe | Dana | Chocolate ← milk choc, choc, chocolate · Caramelized ← caramel · Honey ← sweet-honey? · Berry ← berries |
| Tiger Stripe | Camila | Jasmine ← jasmine · Orange ← orange · Dark Chocolate ← bitter choc · Smoky ← smoky · Nutty ← nuts · Black Tea ← fruity tea, black tea |
| Geometric | Dana | Cocoa ← cocoa · Chocolate ← chocolate · Almond ← almonds · Brown Spice ← spice? |
| Geometric | Camila | Almond ← almonds · Chocolate ← chocolate · Honey ← honey · Black Tea ← tea (dark) |
| Blossom | Dana | Cocoa ← cocoa · Honey ← honey · Smoky ← smokey · Musty / Earthy ← earth, earthy · Roast ← roasty |
| Blossom | Camila | Salty ← salty · Smoky ← smoky · Ashy ← after fire · Maple Syrup ← syrup · Tobacco ← cigarette, tobacco |
| Fabricator | Dana | Chocolate ← choc milk · Orange ← orange, oranges · Cherry ← cherry? (honey is struck: no row) |
| Fabricator | Camila | Orange ← orange · Dried Fruit ← dried fruits · Raspberry ← raspberry · Jasmine ← flower, jasmine flower |

### C5. Call columns and `overall_notes`

| coffee | cupper | archetype_call | secondary | position_call | slot_call_id | call_note | overall_notes |
|---|---|---|---|---|---|---|---|
| Tiger Stripe | Dana | chocolate_nutty | null | null | null | "DEF"; Nutty / Cocoa family ticked | Acidity line has five marks, unresolved. |
| Tiger Stripe | Camila | null | null | null | null | no call written; Nutty / Cocoa family circled | |
| Geometric | Dana | balanced_sweet | null | null | null | "DEF" (written "Balance") | |
| Geometric | Camila | balanced_sweet | null | null | null | | |
| Blossom | Dana | earthy | null | med-strong | null | | |
| Blossom | Camila | null | null | null | null | no call written; wrote "Earthy" under Other on the family line; acidity and sweetness lines marked with an asterisk | |
| Fabricator | Dana | fruity | null | light | null | "Balance" scribbled out before "Fruity, light" (a struck word is not a secondary call) | |
| Fabricator | Camila | null | null | null | null | no call written; Fruity family ticked | |

### C6. Merge
`mergeByRule` for each of the four. Disagreement lists as the rule produced them on the test run (gap from `param('cupper_gap')`): Tiger Stripe: Aroma; Geometric: Aroma, Sweetness, Acidity; Blossom: Fragrance, Aroma, Sweetness (Aftertaste is one-cupper: Dana did not score Finish Length); Fabricator: Sweetness. Merged archetype calls per DESIGN §6.3 ("filled when every cupper who made a call made the same one"; a cupper with no call does not block it): Tiger = chocolate_nutty, Geometric = balanced_sweet, Blossom = earthy, Fabricator = fruity. Prod must match. Merged archetype call: Geometric = balanced_sweet; the other three null with both calls in `call_note`. Dial signal fired on all four (all `ab_0_15`).

## PART D: Utopian, three flights (Dana + Camila, not blind)

| flight | session_date | sheetFormat | recordSource | coffees (display_order) | sessionNotes |
|---|---|---|---|---|---|
| A | 2026-09-13 | freeform_grid | `paper: IMG_3754 (Dana), IMG_3755 (Camila) (misc/roasteries/Utopian)` | Mexico Alva Flores, Peru Chirinos, Colombia Andres Martinez, Peru Joel Silva | First Utopian cupping. Freeform grid: Dana 0 to 15 ranges; Camila integers on a 0 to 5 relative grid (scale_code grid_0_5). Merged by rule (union, n = 2). |
| B | 2026-09-20 (estimated) | freeform_grid | `paper: IMG_3753 (Dana), IMG_3751 and IMG_3752 (Camila, the same sheet photographed twice) (misc/roasteries/Utopian)` | Espresso Volo, Obsidian, Decaf Mexico Veracruz | Date not on the sheets; estimated 2026-09-20 (between 2026-09-14 and 2026-10-16). Freeform grid: Dana 0 to 15 ranges; Camila words low / medium / high (scale_code word_3, native values null, raw_value the word). Merged by rule; no dial signal (converted scale). |
| C | 2026-09-20 (estimated; on or before 2026-09-27) | ab_0_15_8dim | `paper: IMG_3750, IMG_3749 (Dana), IMG_3747, IMG_3748 (Camila) (misc/roasteries/Utopian); sample 2 of IMG_3748 and IMG_3749 blank` | Flying Jewel (coffee 2891), Union, Pearl | Date not on the sheets; estimated 2026-09-20; Flying Jewel was placed 2026-09-27 with the note "Bloom dial: light fruity" from this sheet, so the flight is on or before that. Merged by rule (union, n = 2). |

`location: null`, `isBlind: false`, `roasterPresent: false`, `transcribedBy: 'Claude (CTO session)'`, `transcribedAt: '2026-10-16'`, `checkedBy: 'Dana; blind second read 2026-10-16'`, `brewDefaults: <decision 12>` on all three. `sampleNote` `'end-of-run lot'` on Mexico Alva Flores and Colombia Andres Martinez.

**Flight C is session 35, not a new session.** Through `cuppingService` only: (1) `updateSessionHeader(35, { sessionDate: '2026-09-20', sessionDatePrecision: 'estimated', sheetFormat: 'ab_0_15_8dim', isBlind: false, roasterPresent: false, recordSource: <flight C record source>, transcribedBy, transcribedAt, checkedBy, brewDefaults, sessionNotes: <flight C notes> + ' Session created by hand in Score Entry for Flying Jewel before 2026-09-27; Union and Pearl added and Dana\'s rows loaded by brief 2.' })`; (2) `saveBrewParams(42, <decision 12>)`; (3) `addSessionCoffee(35, Union)` and `addSessionCoffee(35, Pearl)` with display order 2 and 3; (4) Camila's existing row 69 is **superseded, not edited**: `saveCupperScore` for session coffee 42, cupper Camila, `scaleCode: 'ab_0_15'`, the same five values with `raw_value` as D1, the words of D2 and the descriptors of D3 (Berry ← berry, berries; Caramelized ← brown sugar; Raspberry ← raspberry), `supersedeReason: 'legacy re-tag: same values, entered in Score Entry from IMG_3747; blind second read 2026-10-16 agrees; scale is the printed 0 to 15 sheet'`; the old row keeps its one transition; (5) Dana's Flying Jewel row on session coffee 42 per D1 to D4; (6) `mergeByRule` on 42, 43, 44. Afterwards `v_coffee_dimension_range` for 2891 shows `all_ab_scale = true` and the public flavor wheel for Flying Jewel shows the merged descriptors again (it is empty on prod since brief 1, because a cupper row alone never reaches customers).

### D1. Numeric values (0 to 15 after conversion; dimensions 1 to 3 numeric only where the sheet has an intensity). `–` = no row.

| coffee | cupper | scale | 1 Fragrance | 2 Aroma | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|---|---|---|
| Alva Flores | Dana | ab_0_15 | – | – | 3–4, notes `grape` | 7–10 | 0–3 | – | – |
| Alva Flores | Camila | grid_0_5 | – | – | 0, raw `grid 0-5: 0` | 0, raw `grid 0-5: 0` | 4, raw `grid 0-5: 4` | – | – |
| Chirinos | Dana | ab_0_15 | – | – | 3–4, raw `3-4; second reading 6-8 struck (lime)`, notes `~lime` | 4–6 | 0–4 | – | – |
| Chirinos | Camila | grid_0_5 | – | – | 1, raw `grid 0-5: 1` | 5, raw `grid 0-5: 5` | 0, raw `grid 0-5: 0` | – | – |
| Andres Martinez | Dana | ab_0_15 | – | – | 4–6, raw `4-6; second reading 6-8 struck (lime)`, notes `~lime` | 2–4 | 0–4 | – | – |
| Andres Martinez | Camila | grid_0_5 | – | – | 5, raw `grid 0-5: 5` | 3, raw `grid 0-5: 3` | 2, raw `grid 0-5: 2` | – | – |
| Joel Silva | Dana | ab_0_15 | – | – | 4–6, raw `4-6; second reading 6-8 overwritten, read as struck (lemon)`, notes `~lemon` | 4–5, raw `4-5; the 5 overwritten` | 0–4 | – | – |
| Joel Silva | Camila | grid_0_5 | – | – | 5, raw `grid 0-5: 5` | 2, raw `grid 0-5: 2` | 2, raw `grid 0-5: 2` | – | – |
| Espresso Volo | Dana | ab_0_15 | – | – | 4–6 | 0–4 | 5–7 | – | – |
| Espresso Volo | Camila | word_3 | – | – | null, raw `low` | null, raw `low` | null, raw `low` | – | – |
| Obsidian | Dana | ab_0_15 | – | – | 0–4 | 0–4 | 10–13 | – | – |
| Obsidian | Camila | word_3 | – | – | null, raw `low` | null, raw `low` | null, raw `medium` | – | – |
| Decaf Veracruz | Dana | ab_0_15 | – | – | 2–4 | 4–6 | 0–4 | – | – |
| Decaf Veracruz | Camila | word_3 | – | – | null, raw `low` | null, raw `medium` | null, raw `low` | – | – |
| Flying Jewel | Dana | ab_0_15 | 7–9 | 7 | 2–4, raw `marks at 2, 4; 0 X'd out; berries` | 5 | 4, raw `4; 6 scribbled out` | 5 | 5 |
| Flying Jewel | Camila | ab_0_15 | – | – | 4–5 | 4 | 0 | 3 | 5 |
| Union | Dana | ab_0_15 | 7–9, raw `boxes 7 / 9 (max glyph could be 5)` | 5 | 5, raw `5; 4 struck`, notes `orange` | 5 | 3, raw `3; 8 X'd out` | 7 | – |
| Union | Camila | ab_0_15 | – | – | 6, raw `6; scribble over 0-1 and a circle at 3 struck` | 1 | 1 | 1 | 2 |
| Pearl | Dana | ab_0_15 | 7–9 | 5 | 3, raw `3; 7 struck (diagonal stroke)` | 9 | 3 | 7, raw `7; 5 filled in / struck` | – |
| Pearl | Camila | ab_0_15 | – | – | 0–2, raw `marks at 0 and 2` | 2 | 2 | 2 | 3 |

Freeform grids (flights A and B) have a "mouthfeel" line in words only: those words go to dimension 12, no Body value. Dimension 3 Flavor has no intensity on any Utopian sheet: words only. Grid and word values above are **native** (decision 3); the 0 to 15 reading is the views' job.

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
| Obsidian | Dana | ~berries, cocoa, tobacco, smokey | almonds, nuts, sweet | roast, burnt | light syrup | low bitter |
| Obsidian | Camila | soy, spices, BBQ, ~fruits | burnt (in the oven), smoky | tobacco, burnt | syrup | bitter (low) |
| Decaf Veracruz | Dana | cocoa, tobacco, smokey, berries | ~fruits ~berries ~prune (?), sugarcane | sweet | juicy | low acid, sweet |
| Decaf Veracruz | Camila | fruits | sugar sweet, cane (?), almond tea | fruity, pomegranate, chocolate | juicy (~syrup) | sweet, sugary |
| Flying Jewel | Dana | chocolate, almonds, fruits, berries | apple (marked x), above a scribbled-out word | ~[illegible], fruits | creamy | acid, ~bitter, light |
| Flying Jewel | Camila | berry | brown sugar, ~chocolate (?) | berries, raspberry | – | berries |
| Union | Dana | fruits, pomegranate, chocolate | fruits, black tea, ~nuts | dark chocolate, fruit, orange | – | light acid |
| Union | Camila | sour fruity | black tea, sweet aromatics | light citrus (?) | dry | – |
| Pearl | Dana | cocoa, nuts | light cocoa, fruits, dried fruits | fruits, citrus | silky | acid |
| Pearl | Camila | pepper | black tea, jasmin | tea | light | short, smoky light |

### D3. Descriptors

| coffee | cupper | leaf ← words |
|---|---|---|
| Alva Flores | Dana | Berry ← berry, berries · Dried Fruit ← dried fruits · Black Tea ← black tea · Grape ← grape |
| Alva Flores | Camila | Berry ← berry · Honey ← honey · Roast ← burnt · Tobacco ← tobacco vibes |
| Chirinos | Dana | Jasmine ← jasmin · Black Tea ← tea, green tea (lime is struck: no row) |
| Chirinos | Camila | Jasmine ← jasmin · Black Tea ← tea, weak black tea · Caramelized ← caramel · Rose ← rose |
| Andres Martinez | Dana | Cocoa ← cocoa · Roast ← burnt · Blackberry ← blackberries · Dried Fruit ← dried fruits · Raspberry ← raspberries · Berry ← berries (lime is struck: no row) |
| Andres Martinez | Camila | Dried Fruit ← dried fruits · Orange ← orange (?), dried orange · Black Tea ← sweet black tea |
| Joel Silva | Dana | Orange ← orange · Citrus Fruit ← citrus · Black Tea ← tea (lemon is struck: no row) |
| Joel Silva | Camila | Orange ← orange · Berry ← sweet berries · Strawberry ← strawberry · Black Tea ← tea · Herb-like ← herbal |
| Espresso Volo | Dana | Roast ← burned · Tobacco ← tobacco · Ashy ← ashy · Berry ← berries · Cocoa ← cocoa or milk chocolate · Smoky ← smokey · Dark Chocolate ← dark choc |
| Espresso Volo | Camila | Dark Chocolate ← dark chocolate · Chocolate ← milk chocolate · Citrus Fruit ← citrus fruits · Orange ← orange (dried) · Smoky ← smoky |
| Obsidian | Dana | Cocoa ← cocoa · Tobacco ← tobacco · Smoky ← smokey · Almond ← almonds · Nutty ← nuts · Roast ← roast, burnt (berries is struck: no row) |
| Obsidian | Camila | Brown Spice ← spices · Smoky ← smoky · Roast ← burnt (in the oven), burnt · Tobacco ← tobacco |
| Decaf Veracruz | Dana | Cocoa ← cocoa · Tobacco ← tobacco · Smoky ← smokey · Berry ← berries (fragrance) · Molasses ← sugarcane (prune is struck: no row) |
| Decaf Veracruz | Camila | Molasses ← cane (?) · Almond ← almond tea · Pomegranate ← pomegranate · Chocolate ← chocolate |
| Flying Jewel | Dana | Chocolate ← chocolate · Almond ← almonds · Berry ← berries · Fruity ← fruits · Apple ← apple (marked x) |
| Flying Jewel | Camila | Berry ← berry, berries · Caramelized ← brown sugar · Raspberry ← raspberry |
| Union | Dana | Pomegranate ← pomegranate · Chocolate ← chocolate · Black Tea ← black tea · Dark Chocolate ← dark chocolate · Orange ← orange |
| Union | Camila | Sour Aromatics ← sour fruity · Black Tea ← black tea · Sweet Aromatics ← sweet aromatics · Citrus Fruit ← light citrus (?) |
| Pearl | Dana | Cocoa ← cocoa, light cocoa · Nutty ← nuts · Dried Fruit ← dried fruits · Citrus Fruit ← citrus |
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
| Union | Dana | null | null | null | null | wrote "balanced" next to Other and struck it through | |
| Union | Camila | null | null | null | null | Floral and Fruity boxed together on the family line, "limit of floral and fruity"; wrote BALANCED in the right margin and struck it | |
| Pearl | Dana | fruity | null | light fruity | fruity/1 (Task 0 id) | Fruity family ticked; wrote "Bloom dial: light fruity"; slot id set because "light" is the lowest position of the Fruity dial | |
| Pearl | Camila | null | null | null | null | no call written; Floral family ticked | |

### D5. Merge
`mergeByRule` for all ten. Expected disagreement lists (a check, not a target): Alva Flores: Sweetness, Bitterness; Chirinos: Sweetness; Andres Martinez: Acidity, Sweetness; Joel Silva: Acidity; Volo, Obsidian, Decaf: none (Camila's thirds overlap Dana's ranges: the honest consequence of the conversion, and the reason these rows are `word_3`); Flying Jewel: Bitterness; Union: Sweetness, Body; Pearl: Sweetness, Body. Merged archetype calls per DESIGN §6.3 (a cupper with no call does not block the other's): Volo = earthy, Obsidian = earthy, Chirinos = floral, Joel Silva = fruity, Pearl = fruity; Decaf Veracruz null (balanced_sweet vs chocolate_nutty), Union null (both struck), Alva Flores, Andres Martinez and Flying Jewel null (no call). Disagreement lists as produced on the test run: Alva Flores Sweetness, Bitterness; Chirinos Sweetness; Andres Martinez Sweetness, Acidity; Joel Silva Acidity; flight B none; Flying Jewel Bitterness; Union Sweetness, Body; Pearl Sweetness, Body. Dial signal: flights A and B none (converted scales, `merge_note` says so); flight C yes. Prod must match.

### D6. Utopian website notes → `roastery_remark` (52 rows through `recordRemarks`)
Common: `roaster_id` Utopian, `channel = 'website'`, `said_by = 'Utopian Coffee Co. (utopiancoffee.com)'`, `said_on = '2026-10-06'` (literal), `recorded_by = 'Dana'`, `record_source = 'utopiancoffee.com via misc/roasteries/intake/Roaster_Intake_Utopian.xlsx (Sep 2026)'`, `coffee_id` the catalog coffee, `portal_coffee_id` the lineup row, `cupping_session_coffee_id` null. One `descriptor` row per published note (verbatim, capitalised as published), one `process` row, one `roast` row. Where a leaf fits, `cupping_note_id` is set and the same `normalized_words → leaf` is written to `roastery_portal_note_mapping` through its service; where no leaf fits, null and no mapping row.

| coffee | descriptor remarks (verbatim → leaf or null) | process | roast |
|---|---|---|---|
| Flying Jewel | Berries → Berry · Sweet Cream → null · Cocoa → Cocoa | Washed + Natural | Medium-Light |
| Espresso Volo | Fragrant Berries → Berry · Cocoa → Cocoa · Sweet Tobacco → Tobacco | Washed + Natural | Medium-Dark |
| Peru Chirinos | Mango Puree → Other Fruit (tier 2) · Narcissi → Floral (tier 1) · Honeycomb → Honey | Washed | Light |
| Obsidian | Palo Santo → Woody · Campfire 'Mallows → Smoky · Mrs. Buttersworth → Maple Syrup | Washed | Dark |
| Decaf Mexico Veracruz | Red Apple → Apple · Flaky Croissant → null · Walnut Butter → Nutty (tier 2) | Washed, Mountain Water decaf | Medium |
| Peru Joel Silva | Ground Cherry → Other Fruit (tier 2) · Ube Halo Halo → null · Crunchy Sweetness → null | Natural | Medium-Light |
| Mexico Alva Flores | Black Plum → Other Fruit (tier 2) · Honeycomb → Honey · Champorado → Chocolate | Washed | Medium |
| Pearl | Citrusy → Citrus Fruit · Bright → null (also one `dimension` row: "Bright") · Sweet → null · juicy fruit with a backbone of chocolate → Chocolate | Washed + Natural | Light |
| Union | Smooth → null (also one `dimension` row: "Smooth") · caramel sauce → Caramelized · buttered pastry → null · pistachio → Nutty (tier 2) | Washed | Medium |
| Colombia Andres Martinez | Fragrant Jasmine → Jasmine · Green Melon → Other Fruit (tier 2) · Almond Butter → Almond | Double fermentation | Medium-Light |

Expected: 30 descriptor + 2 dimension + 10 process + 10 roast = 52 remarks; 20 note mappings (`source_kind = 'roaster'`; roaster words follow the same rule as ours: the most specific SCA node the word names, never deeper). The eight uncupped Utopian coffees in the xlsx are not loaded (no lineup row, no catalog row).


### D7. Joe Coffee website notes → `roastery_remark` (captured 2026-10-18)
Common: `roaster_id` Joe Coffee Company, `channel = 'website'`, `said_by = 'Joe Coffee Company (joecoffeecompany.com)'`, `said_on = '2026-10-18'` (capture date, literal), `recorded_by = 'Claude (review session); not yet checked by Dana'`, `record_source = '<product URL>; captured 2026-10-18'`, `coffee_id` the A1 coffee, `portal_coffee_id` the lineup row, `cupping_session_coffee_id` null. One `descriptor` row per published tasting note and per flavour word in the description paragraph (verbatim, capitalised as published; the description-paragraph words carry `record_source = '<URL> (description paragraph)'`), one `process` row, one `roast` row, `general` / `brewing` / `origin` rows where the page states them. Mapping rule (all three website tables and our own words): the most specific SCA node the word names, never deeper; a word that is an instance of a node without being one maps to the nearest node that certainly contains it, going up a tier rather than guessing a leaf (Clementine → Citrus Fruit, Apricot → Other Fruit, Apple Blossom → Floral); where no node contains it, null and no mapping row (it appears in the unmapped-words view). Dimension words (bright, smooth, full-bodied) are `dimension` rows, not descriptors. Task 0 confirms the leaves named here exist (`Coconut`, `Grapefruit`, `Rose`, `Vanilla`, `Almond`, `Dark Chocolate`, `Molasses`); any that does not → null and report.

| coffee (URL slug) | tasting notes (verbatim → node) | description-paragraph words (verbatim → node) | process | roast | other rows |
|---|---|---|---|---|---|
| Cafè Feminista: Montze Olvera (`cafe-feminista-montze-olvera`) | Papaya → Other Fruit (tier 2) · Milk Duds → null · Candied Coconut → Coconut | milk chocolate → Chocolate · toasted caramel → Caramelized · ripe papaya → Other Fruit (tier 2) · candied coconut → Coconut · warm, sugar-browning richness → Brown Sugar (tier 2) | Honey | Light | origin: "Sierra de Tenango, Hidalgo, México; Montze Olvera; Typica & Marsellesa; 1400 MASL" · general: "a coffee to enjoy on its own or in milk" |
| Colombia La Familia Guarnizo (`colombia-la-familia-guarnizo-1`) | Caramel → Caramelized · Honey → Honey · Clementine → Citrus Fruit (tier 2) | stone fruit → Other Fruit (tier 2) · almonds → Almond | Washed | Light | origin: "Huila, Colombia; The Guarnizo Family; Caturra, Colombia; 1600-1800 MASL" · dimension: "medium acidity" · general: "a customer favorite" |
| The Village (`the-village`) | Apple Blossom → Floral (tier 1) · Candied Grapefruit → Grapefruit · Apricot → Other Fruit (tier 2) | honeyed → Honey · ripe, stone-fruit sweetness → Other Fruit (tier 2) · melon → Other Fruit (tier 2) · orange blossom → Floral (tier 1) · rosewater → Rose · vanilla → Vanilla | Washed | Light | origin: "Ngozi, Burundi; Turihamwe Women's Group; Bourbon; 1750 MASL" · general: "complex and delicate flavors … unfurl and lengthen in the aftertaste" |
| Benchmark (`benchmark`) | Cocoa → Cocoa (tier 2) · Spice → Brown Spice (tier 2) · Caramel → Caramelized | (none beyond the notes) | Washed | Medium | origin: "San Ignacio, Cajamarca, Peru; El Guayacan Smallholder Farmers; Typica, Caturra, Bourbon; 1,600-2,100 MASL; Blend" · general: "smooth, balanced, and robust" · brewing: "Cortado, cappuccino, drip coffee—you really can't go wrong with this one" · general: "designed to shine both in milk and on its own" |
| Amsterdam (`amsterdam`) | Dark Chocolate → Dark Chocolate · Walnut → Nutty (tier 2) · Caramel → Caramelized | chocolate → Chocolate · nut → Nutty (tier 2) · toffee → Brown Sugar (tier 2) | Natural | Medium | origin: "Cerrado, Minas Gerais, Brazil; Veloso Family; Red Catuaí; 1066 MASL; Blend" · general: "Rich, sweet, and comforting" · roast (second row): "a deeper roast profile" · brewing: "the perfect drip coffee option" |
| The Daily (`the-daily`) | Chocolate → Chocolate · Caramel → Caramelized · Molasses → Molasses | (none) | Washed | Medium | origin: "Tapachula, Chiapas, Mexico (Muguira Family; Sarchimor, Marsellesa, H16; 2350 MASL) and Huila, Colombia (El Paraíso Growers' Association; Caturra, Colombia, Catuai; 1300-1800 MASL); Blend" · general: "built around seasonally fresh components, typically coffees from South America" · general: "a satisfying, drink-every-day blend" |
| Big City (`big-city`) | Burnt Sugar → Brown Sugar (tier 2) · Baking Chocolate → Dark Chocolate · Roasted Almond → Almond | burnt sugar → Brown Sugar (tier 2) · baking chocolate → Dark Chocolate · roasted nuts → Nutty (tier 2) | Natural, Washed | French Roast (Dark) | origin: "Cerrado, Minas Gerais, Brazil (Veloso Family) and South Caribbean Autonomous Region, Nicaragua (smallholder farmers); Red Catuai, Peaberry Robusta; 200-1,500 MASL; Blend" · dimension: "full-bodied" · general: "Sturdy and sweet" · general: "crafted for wide appeal … without ever compromising on sweetness" |
| Nightcap Decaf (`nightcap-decaf`) | Almond → Almond · Molasses → Molasses · Cola → null | (none) | Washed (decaffeination method not stated) | Medium | origin: "Tapachula, Chiapas, Mexico; Muguira Family; Sarchimor, Marsellesa, H16; 2350 MASL; Single Origin" · brewing: "Whether prepared as brewed coffee or espresso" · general: "sweet, rich, and drinkable around the clock" |

Expected: 24 tasting-note descriptor rows + 19 description-paragraph descriptor rows + 8 process + 9 roast + 2 dimension + 8 origin + about 14 general / brewing = about 84 remarks; 20 new or confirmed note mappings. Report the exact counts.

### D8. Joe Bean website notes → `roastery_remark` (captured 2026-10-18)
Common as D7 with `roaster_id` Joe Bean Roasters, `said_by = 'Joe Bean Roasters (shop.joebeanroasters.com)'`. The site states no origin, process or roast level for its blends except where quoted; nothing is inferred. The site-wide brewing tip ("We recommend using a 1:16 ratio by weight, 60g of coffee for every 1,000g of water"; "Using filtered (but not distilled) water") appears on every product page; it is loaded **once**, about the roastery, with `coffee_id = null`, `portal_coffee_id = null`, `topic = 'brewing'`. Per-coffee `brewing` rows carry only what a page says about that coffee.

| coffee (URL slug) | tasting notes (verbatim → node) | description-paragraph words (verbatim → node) | process | roast | other rows |
|---|---|---|---|---|---|
| Tiger Stripe Espresso (`tiger-stripe-espresso-2lb`) | Chocolate → Chocolate · Peanut Butter → Peanuts · Almond → Almond · Fig → Dried Fruit (tier 2) · Apple → Apple · Pear → Pear · Cherry → Cherry | chocolate → Chocolate · almond → Almond · fruit → Fruity (tier 1) | not stated | not stated | dimension: "sweet & full-bodied" · general: "Winner of a 2023 Golden Bean medal, this classic espresso blend" · brewing: "Use an 18g dose; aim for a 40g – 45g yield; 35 sec - 40 sec shot time" · general: "perfect on its own, or with steamed milk" · origin: "community-blended micro-lots sourced through our farming partners" |
| Geometric Filter Coffee (`geometric-filter-coffee-2lb`) | Toffee → Brown Sugar (tier 2) · Strawberry → Strawberry · Apricot → Other Fruit (tier 2) · Honey → Honey | citrus → Citrus Fruit (tier 2) · caramel → Caramelized | not stated | not stated | general: "A beautiful combination of citrus and caramel, this three part blend" · general: "appealing to those who love bright, fruity coffees" · brewing: "perfect for manual pour-over brewing" (and automatic drip) |
| Blossom Dark Roast (`blossom-dark-roast-2lb`) | Dark Chocolate → Dark Chocolate · Black Cherry → Cherry · Toffee → Brown Sugar (tier 2) · Turbinado Sugar → Brown Sugar (tier 2) | chocolate → Chocolate · black cherry → Cherry · toffee → Brown Sugar (tier 2) | not stated | "This is our darkest roasted coffee" | dimension: "Full-bodied" · general: "surprisingly sweet and flavorful" · general: "a pleasant finish" |
| Fabricator House Roast (`fabricator-house-roast-2lb`) | Hazelnut → Hazelnut · Citrus → Citrus Fruit (tier 2) · Graham Cracker → null · Cinnamon → Cinnamon | hazelnut → Hazelnut · light citrus → Citrus Fruit (tier 2) · graham cracker → null · cinnamon → Cinnamon | "the Brazil element contains naturally processed coffee grown in the Mogiana region" | not stated | dimension: "medium-bodied" · general: "beautifully balanced" · origin: "combines coffees from Colombian and Brazilian; the Colombia blend is directly sourced through our on-the-ground partners; the Brazil element … Mogiana region" · brewing: "tastes great brewed a variety of ways including auto drip, pour over, and even espresso" |

Expected: 19 tasting-note descriptor rows + 11 description-paragraph descriptor rows + 1 process + 1 roast + 3 dimension + 3 origin + about 12 general / brewing + 1 roastery-level brewing row = about 51 remarks; about 14 new or confirmed note mappings. Report the exact counts.

**Reading the two tables in brief 3.** `v_evidence_descriptor.named_by_roaster_website` now has values for all three roasteries. Joe Bean's site names Fruity-family notes on Tiger Stripe (Fig, Apple, Pear, Cherry) that neither cupper wrote and the roaster's portal form may not either; that is a `miss` worth seeing, not a load error.

## CONSTRAINTS
- Loader `backend/src/features/cupping_evidence/load_cupping_evidence_2.ts`, run with `npm run` on the test DB first end to end (A → B → C → D), then prod. Idempotent by natural key (DESIGN §6.6): a re-run reports `already loaded` per step and inserts nothing twice.
- Dry run of every manifest on prod first (`ROASTER_NOT_FOUND` must not happen).
- Use a marked `Zzz Test` admin identity only where the services require one; never act as Dana or Camila beyond `taster_name` / `recorded_by` values, which are data.
- No placement, price, guest slot or SKU beyond what A1 states; no change to coffee 2891's assignment or placement; no portal response, link or respondent touched; no slot created, renamed, priced or deactivated; no other roastery's coffee moves except the one priority shift on `balanced_sweet/2`.
- `lint:cupping`, `lint:roastery-portal`, `lint:catalog` green; `npm run build` clean; `runCatalogIntegrityChecks().allPass = true` on test and prod after the imports.
- Nothing is deleted anywhere. If a step fails midway, report what was written; do not clean up.
- Commits: manifests + loader + this brief's status line + one `WHAT_WE_BUILT.md` entry + a dated line in `WHAT_WE_BUILT_DB.md`'s Cupping evidence section. Straight to main. No schema change, so no `comments.sql` / `CATALOG.md` change.

## DONE =
21 catalog coffees exist (8 Joe Coffee: Feminista, The Village on `fruity/1`, La Familia on `floral/1`, Benchmark on `balanced_sweet/2` priority 1, each with a 12 oz SKU and visible in `v_coffee_sellable_slot` at $29 for 12 oz on their three slots (A3b); the other four unplaced; Nightcap carries `decaf`. 4 Joe Bean and 9 Utopian unplaced with provisional assignments carrying their basis lines); 21 lineup rows linked; five sessions (Joe Coffee 2026-10-02 not blind, roaster present; Joe Bean 2026-09-30 blind; Utopian A 2026-09-13, B, C) with 22 session coffees, 36 cupper rows (8 + 8 + 20) and 22 rule-merged rows, values with `raw_value`, descriptors and call columns exactly as above; 38 Joe Coffee table remarks and 52 Utopian website remarks readable through `v_roastery_remark`; 16 note mappings; integrity green; Flying Jewel handled per Task 0.

Closing report: coffee ids; session ids; per session coffee the score ids (per cupper and merged) and the merged `merge_note`; the leaf names that were missing or respelled; the import warnings; the before/after of `balanced_sweet/2`; the Flying Jewel finding; the admin URLs (Coffees page, Roastery Feedback for the three roasteries).
