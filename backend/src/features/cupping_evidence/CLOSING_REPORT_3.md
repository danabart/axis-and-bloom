# Cupping evidence, brief 3: closing report

> 2026-10-18. Brief: `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_3_RECONCILIATION.md`. `WHAT_WE_BUILT.md` #226. Part A stopped for Dana's read of the view definitions; her go (2026-10-18) came with one change (A5, below) and the rulings that Union, Tiger Stripe, mango puree and Flying Jewel are the data being right and the eight choices stand. Parts B and C followed without a second stop, as she said.
>
> **Commits:** `911f3a6` Part A (views, tests, comments, Part 0 test fixes; revision `axis-bloom-backend-00760-f6n`) · `3589c7b` CATALOG.md from prod · `65d4b44` Parts B + C (revision `axis-bloom-backend-00762-fcx`) · the commit after it: this report and CATALOG.md regenerated after B.

## Part 0

**Test DB = prod.** Refreshed from prod (`npm run test:db:refresh`). The brief 2 rows match `CLOSING_REPORT_2.md` exactly: 5 sessions (35 to 39), 22 session coffees, 36 cupper rows, 22 merged rows, 223 remarks, 98 mappings, 21 coffees, 3 slot prices. After a suite run the test DB also holds the suite's persistent fixtures (brief 1's Zzz cupping fixtures, a portal test roastery, 2 remarks, 4 superseded mappings); every count in the view tests filters to the three roasteries by id.

**The catalog tests that assumed live slots were empty: 20 tests in 10 files, not nine.** The nine in brief 2's report came from a run before the $29 prices existed; once fruity/1, floral/1 and balanced_sweet/2 hold a priced, sellable coffee, more tests fail, and several were destructive. Their cleanups deleted (or first overwrote, then deleted) the 12 oz price of the slot they used: `sommelierRag` and `coffees.test` on floral/1 and fruity/1, `coffees.contract` on fruity/1 ($29 → $16 → deleted), `blendResolver` on balanced_sweet/2. On the test DB this happened twice during this run; each time a refresh from prod restored the three $29 rows. Prod was never touched by a test.

The fix is one helper, `src/test/freeSlots.ts`: `freeSlots()` / `freeSlotsInOneArchetype()` pick, at run time, active slots of real archetypes with **no active placement and no 12 oz price**, so a fixture never lands on a live slot and its 12 oz price cleanup only removes rows it created; `liveSellableCoffeeIds()` / `liveSellableArchetypes()` let a pool or collection test leave the real sellable coffees out.

| File | Change |
|---|---|
| `db/schema.catalog_blueprint.test.ts` | the six slot tests (D1/D5 ×4, sellable slot, hop) run inside `withRollback` on free slots |
| `services/catalogImport.test.ts` | the example manifest's slots are rewritten to free slots of the same archetype before the first import; cleanup deletes only those slots' 12 oz rows |
| `routes/coffees.test.ts` | shared fixture, inactive-coffee and hop tests on free slots (the hop test takes four free slots of whichever archetype has four) |
| `routes/coffees.contract.test.ts` | floral/2 must be free (it is floral's landing default the test asserts); the "every other slot is empty" loop skips slots a real coffee fills; the hops/legacy-slot test on two free slots |
| `services/sommelierRag.test.ts` | free slots; the secondary archetype is whichever real archetype still has three free slots (fruity has two); the composition block passes the live sellable coffees as dislikes so its pool is the fixture's own |
| `services/catalogService.test.ts` | floral/1 + floral/3, fruity/4 (Flying Jewel's home) and balanced_sweet/2 replaced by free slots |
| `services/blendResolver.test.ts` | both collection tests on free slots; the "below the minimum" test on an archetype with no real sellable coffee |
| `services/catalogSizes.test.ts` | its five slots (balanced_sweet/2 among them) picked from free slots at run time |
| `services/palateReads.test.ts`, `services/liamProfile.test.ts` | already one transaction that always rolls back; their expected output (the C3 fixture JSON) is tied to the real sort_order 1 slots, so they keep those slots and now deactivate **every** active placement inside that transaction first. The one place a test still touches a live slot, never committed. |

Full suite after Part 0: **732 passed, 6 failed** (the OT-19 `quizScoring` six), and the 12 oz prices on the test DB were unchanged by the run.

**Logged, not done:** the loader file name stands (`loadCuppingEvidence2.ts`); `schema.sql` cannot build an empty database (its own brief).

## Task 0 (read-only, reported before any Part A file)

- **Rows (prod):** sessions 8 (5 from brief 2); current cupper rows by scale: `ab_0_15` 29, `grid_0_5` 4, `word_3` 3, `legacy` 9 (+1 superseded); merged rows by rule: `union_v1` 22, `legacy` 3; remarks by channel: `cupping_table` 38, `website` 185; submitted portal responses (coffees / versions): Joe Bean 7/7, Joe Coffee 11/15, Utopian 7/8; note mappings: roaster 67, cupper 31.
- **Base views:** `v_coffee_dimension_range` already carries `all_ab_scale`, `n_sessions`, `midpoint`, `session_id`; `v_cupping_scores_readable` carries everything A0 lists (coffee_id, scale_code, is_blind, roaster_present, session_date, score_id, cupper_id/name, is_control). Roaster 1 to 5 values exist only in `v_roastery_portal_coffee_hint.dimensions` (JSON, keyed by `coffee_dimensions` ids, latest submitted response per catalog coffee). **Missing everywhere:** the portal's ranked notes (`roastery_portal_response_note`), the note mappings (`roastery_portal_note_mapping` has no view), the SCA tree (`cupping_note.parent_id`), the sheet lines, the current dial signal's `notes`, the assignment's `notes`/`basis`, the placement's `placed_from_session_id`, the slot's band.
- **`v_collaborative_flavor_wheel.source`:** `internal` (143), `roastery` (64); no `client` rows yet. Customer words come from `v_customer_feedback_current.descriptor_note_ids`.
- **D6:** TypeScript, `catalogService.evaluatePlacement` (`catalogService.ts:166`). Band: the latest merged midpoint (`dialSuggestion.getAvgCuppingScore`) on the slot's `dimension_id`, else the archetype's dominant dimension, against `spec_band_lo/hi`. Families: top 3 `wheel_category` by row count on the wheel view (`catalogService.ts:204-213`). A view cannot call it, so A3's `slot_spec_check` states the same band rule in SQL.
- **`reporting_ro`:** exists on test and prod; views are granted one by one (`GRANT SELECT ON v_… TO reporting_ro`).
- **System Health:** one page, `frontend/src/app/components/admin/AdminSystemHealth.tsx` (sections: Retention, call types, client errors, Data catalog), fed by `GET /api/admin/system-health`. The new card is one more section and one more field in that response.

## Part A: what was built (test DB only)

### Choices made where the brief left a gap (none reopens a decision)

1. **A2 names no cupper.** Its sketch lists `named_by_dana` / `named_by_camila`; decision 2 (closed) and A8's test forbid a cupper's name in a view. A2 carries `named_by_cuppers text[]` built from the cupper rows (the A3 `cupper_calls` pattern) plus `named_by_ab`, and an `n_sources` count the D6 change will order by.
2. **A0 adds four small views and appends columns**, because A8 forbids reading `cupping_*` / `roastery_portal_*` base tables and decision 7 says the base view gains the column first: `v_cupping_note_family` (node → tier-1 family by `parent_id`, recursive), `v_cupping_sheet_line`, `v_note_mapping_current`, `v_dial_position_signal_current`; `v_coffee` + `match_notes`, `match_basis`; `v_coffee_slot` + `placed_from_session_id`, `placement_basis`, `slot_dimension_id`, `spec_band_lo`, `spec_band_hi`; `v_roastery_portal_coffee_hint` + `notes` (rank, roaster_words, cupping_note_id of the same response). Appended last, nothing renamed.
3. **Average ranks.** A4's sketch formula `(RANK() + COUNT(*) OVER (…, value) - 1) / 2.0` halves untied ranks and is not an average rank with ties; the views use `RANK() + (COUNT(*) OVER (…, value) - 1) / 2.0` (the mean position of a tied group), as decision 5 asks.
4. **Flags.** A1: `both` / `cuppers_disagree` / `roaster_disagrees` as written; `one_source` = neither comparison exists (one cupper and no roaster rank). A3, first that applies: `both`, `cuppers_disagree` (calls differ), `roaster_disagrees` (no proposal equals the catalog), `no_basis`, `out_of_band`, `stale_decision`, `none`. A6 `flag_unreconciled` = any A1 flag ≠ `none` (so `one_source` counts, as written) or the A3 flag ≠ `none`.
5. **A7, word dimensions from rows.** "cupper notes on dimensions 1, 2, 3, 11, 12" without a list: the dimensions some printed sheet records as words (`v_cupping_sheet_line.is_numeric = false`), which is exactly {1, 2, 3, 11, 12}. A transcriber's parenthesis is dropped before matching (`apple (marked x)` → `apple`, `light (~tea)` → `light`, then a stop word); edge punctuation off. The mapping exclusion applies to portal notes (roaster kind) and cupper words (cupper kind); a remark is unmapped when its own `cupping_note_id` is null, as the brief says. A portal note is the whole note, as the mapping table keys it.
6. **`evidence_newer_than_decision`** = the latest session date is after the earlier of the assignment's and the placement's session dates; null when neither is set.
7. **A4 rows:** every roastery × numeric dimension where either side has a value (n can be 0). **A5:** the roaster-rank comparison ranks each cupper's latest row per coffee within the roastery's lineup.
8. **One structural literal:** "fewer than two coffees with both sides gives null ranks" is `lineup_n >= 2` in A1 and A5 (a rank needs two items); every threshold the brief names is `param()`.

### Something Dana should look at before Part B

- **`mean_signed_gap_to_roaster_rank` (A5) was 0.00 by construction** (both rank vectors over the same coffees sum to n(n+1)/2). **Changed on Dana's go:** replaced by `mean_abs_gap_to_roaster_rank` (mean |cupper average rank − roaster average rank| over the same coffees) and `rank_corr_to_roaster` (correlation of the two average-rank vectors, null below `param('rank_corr_min_n')`); comment and A5 test updated. Dana's rows (test DB, the same rows as prod): not blind Sweetness n 15, mean |gap| 1.67, corr 0.515; Acidity 1.67 / 0.484; Bitterness 1.40 / 0.598; Body (n 8) 1.00 / 0.581.
- **Rulings (Dana, 2026-10-18): the four below are the data being right and the brief's expectations wrong; nothing changed.**
- **Union is not "extra on every family".** At the family level the website's caramel sauce (Sweet) and pistachio (Nutty / Cocoa) meet the cuppers' words, so Union has two hits; the brief's "zero overlap" was counted on words.
- **Tiger Stripe's Fruity is a hit, not a miss.** Both cuppers named a Fruity-family node (Dana: "berries" → Berry; Camila: "orange" → Orange), so the brief's "unless a cupper did" applies.
- **`mango puree` is not unmapped.** Brief 2's loader mapped it to Other Fruit (tier 2, rule `node`), so A7 leaves it out; `orange blossom` is mapped for the website (Floral) but La Familia's table remark "Orange blossom." has no node, so it appears as a `roaster_remark` word.
- **Flying Jewel shows `no_basis`.** Its assignment (fruity, high, manual) predates the basis convention and brief 2 left it alone on purpose.

### Test results against the brief's expectations (`db/evidenceViews.test.ts`, 30 tests with the A5 change, all pass on the test DB)

| Brief expectation | Result |
|---|---|
| A1 Geometric Acidity → `cuppers_disagree` (Dana 4–7, Camila 1) | as expected (flag `cuppers_disagree`; rank gap 1.5 < 2, so not `both`) |
| A1 Tiger Stripe Acidity → agree (Dana 4–6, Camila 3) | as expected |
| A1 Volo: `scale_codes` contain `word_3`, Camila's "low" converted 0–5 | as expected (Acidity, Bitterness, Sweetness) |
| A1 Joe Coffee one row per coffee × dimension, `cuppers_agree` null | as expected (30 rows, 30 keys, 1 cupper) |
| A1 ranks null without a roaster value or with fewer than two coffees on both sides | as expected (Nightcap Finish Length: lineup_n 1, ranks null) |
| A2 Benchmark: Sweet (Caramelized), Nutty / Cocoa, Spices from Dana | as expected |
| A2 Feminista: Fruity from tier-2 Berry | as expected |
| A2 `named_by_roaster_form` follows the current submitted response | as expected |
| A2 Union: `extra` on every A&B family | **differs:** Sweet and Nutty / Cocoa are hits (website caramel sauce, pistachio); Floral, Fruity, Sour / Fermented extra; no miss |
| A2 Tiger Stripe: Fruity a `miss` unless a cupper or the form did | both cuppers did (Berry, Orange) and the form too: a hit |
| A2 `named_by_roaster_website` non-null for all three roasteries | as expected |
| A3 Blossom: Dana earthy, Camila null, catalog earthy low, form chocolate_nutty → `roaster_disagrees` | as expected |
| A3 Union: both calls null, merged null, catalog balanced_sweet low | as expected |
| A3 La Familia: Dana balanced_sweet, catalog floral, basis present | as expected |
| A3 every brief 2 coffee has a basis; `evidence_newer_than_decision` false | as expected for all 21 (Flying Jewel, pre-brief-2, is `no_basis`) |
| A4 Joe Bean n < `spearman_min_n` → `inverted` null, `n too small` | as expected (n = 4) |
| A4 `rank_corr` computed where n ≥ `rank_corr_min_n` | as expected (null where one side is constant: Joe Bean Bitterness, all 3s) |
| A4 superseding `spearman_min_n` to 3 (rolled back) changes the output, no view change | as expected (`inverted` false, note null) |
| A4 Joe Coffee crosstab | see below |
| A5 Dana has blind (Joe Bean) and not-blind rows | as expected |
| A5 `word_3` / `grid_0_5` rows do not count toward n | as expected |
| A5 `n_control` 0, `repeatability` null | as expected for Dana and Camila (Flying Jewel's old row 69 is superseded, so no repeat) |
| A6 every brief 2 coffee `n_sources ≥ 2` | as expected; three at exactly 2 (Andres Martinez, Alva Flores, Chirinos: no portal submission, no table remark) |
| A6 Flying Jewel shows cupping and website remark | as expected |
| A6 the four placed Joe Coffee coffees are `is_placed` | as expected |
| A7 contains white floral, orange blossom, mango puree, ube halo halo, happy, bbq chips | all but **mango puree** (mapped to Other Fruit by brief 2's loader) |
| A7 excludes honeycomb, berries, sweet | as expected |
| A7 adding `happy` to `evidence_stop_word` (rolled back) removes it | as expected |
| Every view readable by `reporting_ro` | as expected (12 views incl. A0) |
| No view reads a `cupping_*`, `roastery_portal_*`, `roastery_remark`, `customer_feedback_*` base table | as expected (the evidence views read only `coffee_dimensions` and `evidence_stop_word` directly) |
| No cupper name, no `>= 5` / `> 2` / `-0.5`, no `wheel_category` text in any definition; no column named after a cupper | as expected |

Schema applied twice on the test DB with no error (the pre-drop makes the second boot clean), then `comments.sql`.

### `no_basis`: 9 coffees (test DB = prod for these)
| coffee_id | coffee | roaster | catalog archetype | source |
|---|---|---|---|---|
| 3 | Feather In Cap | Path Coffee Roasters | balanced_sweet | manual |
| 5 | Noam Blend | Path Coffee Roasters | chocolate_nutty | manual |
| 6 | Nocturnal Dark Roast | Path Coffee Roasters | earthy | manual |
| 14 | Vanilla | Path Coffee Roasters | balanced_sweet | manual |
| 21 | Brazil Santos | Temecula Coffee Roasters | chocolate_nutty | manual |
| 32 | Kopi Safari | Temecula Coffee Roasters | experimental | manual |
| 1803 | Zzz Test Coffee (Catalog Blueprint smoke test) | Zzz Test Roastery | fruity | manual |
| 2888 | Zzz Test Coffee 5b | Zzz Test Roastery | earthy | manual |
| 2891 | Flying Jewel | Utopian | fruity | manual |

### Archetype crosstab (our merged call × their form proposal)
- **Joe Coffee:** balanced_sweet × {balanced_sweet 1, floral 1, fruity 1}; chocolate_nutty × chocolate_nutty 1; earthy × earthy 1; no_call × {chocolate_nutty 2, fruity 1}.
- **Joe Bean:** balanced_sweet × fruity 1; chocolate_nutty × fruity 1; earthy × chocolate_nutty 1; fruity × balanced_sweet 1.
- **Utopian:** earthy × chocolate_nutty 2; fruity × fruity 2; floral × no_proposal 1; no_call × {balanced_sweet 2, fruity 1}.

### Calibration (A4) as it comes out
| Roastery | Dimension | n | rank_corr | mean rank gap | inverted | note |
|---|---|---|---|---|---|---|
| Joe Coffee | Sweetness | 8 | 0.719 | 1.38 | false | |
| Joe Coffee | Acidity | 8 | 0.663 | 1.38 | false | |
| Joe Coffee | Bitterness | 8 | 0.901 | 0.75 | false | |
| Joe Coffee | Body | 5 | 0.667 | 1.00 | false | |
| Joe Coffee | Finish Length | 1 | | 0.00 | | n too small |
| Joe Bean | Sweetness | 4 | 0.632 | 0.75 | | n too small |
| Joe Bean | Acidity | 4 | 0.000 | 1.25 | | n too small |
| Joe Bean | Bitterness | 4 | | 0.75 | | n too small |
| Joe Bean | Body | 4 | 0.447 | 1.00 | | n too small |
| Joe Bean | Finish Length | 4 | 0.775 | 0.50 | | n too small |
| Utopian | Sweetness, Acidity | 3 | −0.866 | 1.33 | | n too small |
| Utopian | Bitterness | 3 | 1.000 | 0.00 | | n too small |
| Utopian | Body | 3 | −1.000 | 1.33 | | n too small |
| Utopian | Finish Length | 3 | 0.866 | 0.33 | | n too small |

Utopian's n is 3 because flights A and B are on converted scales (decision 5 keeps them out); only flight C counts.

### Joe Bean and Joe Coffee rank tables (A1, as they come out)
Average ranks within the roastery's coffees that have both a merged midpoint and a roaster value (1 = lowest). `roaster_agrees` = rank gap < `param('roaster_rank_gap')` (2).

| roaster_name | coffee_name | dimension_name | merged_midpoint | roaster_1_5 | ab_rank | roaster_rank | rank_gap | roaster_agrees | lineup_n |
|---|---|---|---|---|---|---|---|---|---|
| Joe Coffee Company | Amsterdam | Sweetness | 5.5 | 3 | 2 | 2.5 | 0.5 | true | 8 |
| Joe Coffee Company | Amsterdam | Acidity | 2.5 | 1 | 2.5 | 1.5 | 1 | true | 8 |
| Joe Coffee Company | Amsterdam | Bitterness | 6.5 | 4 | 7 | 6 | 1 | true | 8 |
| Joe Coffee Company | Amsterdam | Body | 7.5 | 4 | 3 | 4 | 1 | true | 5 |
| Joe Coffee Company | Benchmark | Sweetness | 9 | 4 | 8 | 5.5 | 2.5 | false | 8 |
| Joe Coffee Company | Benchmark | Acidity | 2.5 | 2 | 2.5 | 4 | 1.5 | true | 8 |
| Joe Coffee Company | Benchmark | Bitterness | 3 | 3 | 3 | 4 | 1 | true | 8 |
| Joe Coffee Company | Big City | Sweetness | 5 | 2 | 1 | 1 | 0 | true | 8 |
| Joe Coffee Company | Big City | Acidity | 1 | 1 | 1 | 1.5 | 0.5 | true | 8 |
| Joe Coffee Company | Big City | Bitterness | 8 | 5 | 8 | 8 | 0 | true | 8 |
| Joe Coffee Company | Big City | Body | 8 | 5 | 4 | 5 | 1 | true | 5 |
| Joe Bean Roasters | Blossom Dark Roast | Sweetness | 2.5 | 3 | 1 | 1 | 0 | true | 4 |
| Joe Bean Roasters | Blossom Dark Roast | Acidity | 0 | 3 | 1 | 1.5 | 0.5 | true | 4 |
| Joe Bean Roasters | Blossom Dark Roast | Bitterness | 6.5 | 3 | 4 | 2.5 | 1.5 | true | 4 |
| Joe Bean Roasters | Blossom Dark Roast | Body | 9 | 5 | 4 | 3.5 | 0.5 | true | 4 |
| Joe Bean Roasters | Blossom Dark Roast | Finish Length | 15 | 5 | 4 | 4 | 0 | true | 4 |
| Joe Coffee Company | Cafè Feminista: Montze Olvera | Sweetness | 8 | 4 | 6 | 5.5 | 0.5 | true | 8 |
| Joe Coffee Company | Cafè Feminista: Montze Olvera | Acidity | 6.5 | 4 | 7 | 6.5 | 0.5 | true | 8 |
| Joe Coffee Company | Cafè Feminista: Montze Olvera | Bitterness | 1.5 | 2 | 1 | 2 | 1 | true | 8 |
| Joe Coffee Company | Cafè Feminista: Montze Olvera | Body | 4 | 2 | 1 | 1.5 | 0.5 | true | 5 |
| Joe Coffee Company | Colombia La Familia Guarnizo | Sweetness | 8.5 | 5 | 7 | 8 | 1 | true | 8 |
| Joe Coffee Company | Colombia La Familia Guarnizo | Acidity | 5 | 4 | 5.5 | 6.5 | 1 | true | 8 |
| Joe Coffee Company | Colombia La Familia Guarnizo | Bitterness | 3.5 | 2 | 4 | 2 | 2 | false | 8 |
| Joe Bean Roasters | Fabricator House Roast | Sweetness | 7.5 | 5 | 3 | 4 | 1 | true | 4 |
| Joe Bean Roasters | Fabricator House Roast | Acidity | 6 | 3 | 4 | 1.5 | 2.5 | false | 4 |
| Joe Bean Roasters | Fabricator House Roast | Bitterness | 3.5 | 3 | 2.5 | 2.5 | 0 | true | 4 |
| Joe Bean Roasters | Fabricator House Roast | Body | 5.5 | 4 | 1 | 1.5 | 0.5 | true | 4 |
| Joe Bean Roasters | Fabricator House Roast | Finish Length | 7 | 4 | 2 | 2 | 0 | true | 4 |
| Joe Bean Roasters | Geometric Filter Coffee | Sweetness | 8.5 | 4 | 4 | 2.5 | 1.5 | true | 4 |
| Joe Bean Roasters | Geometric Filter Coffee | Acidity | 4 | 4 | 2 | 3.5 | 1.5 | true | 4 |
| Joe Bean Roasters | Geometric Filter Coffee | Bitterness | 2.5 | 3 | 1 | 2.5 | 1.5 | true | 4 |
| Joe Bean Roasters | Geometric Filter Coffee | Body | 8 | 4 | 3 | 1.5 | 1.5 | true | 4 |
| Joe Bean Roasters | Geometric Filter Coffee | Finish Length | 3 | 4 | 1 | 2 | 1 | true | 4 |
| Joe Coffee Company | Nightcap Decaf | Sweetness | 6 | 4 | 3.5 | 5.5 | 2 | false | 8 |
| Joe Coffee Company | Nightcap Decaf | Acidity | 7 | 2 | 8 | 4 | 4 | false | 8 |
| Joe Coffee Company | Nightcap Decaf | Bitterness | 4 | 4 | 5 | 6 | 1 | true | 8 |
| Joe Coffee Company | Nightcap Decaf | Body | 9 | 3 | 5 | 3 | 2 | false | 5 |
| Joe Coffee Company | Nightcap Decaf | Finish Length | 9 | 4 |  |  |  |  | 1 |
| Joe Coffee Company | The Daily | Sweetness | 7.5 | 3 | 5 | 2.5 | 2.5 | false | 8 |
| Joe Coffee Company | The Daily | Acidity | 3.5 | 2 | 4 | 4 | 0 | true | 8 |
| Joe Coffee Company | The Daily | Bitterness | 5 | 4 | 6 | 6 | 0 | true | 8 |
| Joe Coffee Company | The Village | Sweetness | 6 | 4 | 3.5 | 5.5 | 2 | false | 8 |
| Joe Coffee Company | The Village | Acidity | 5 | 5 | 5.5 | 8 | 2.5 | false | 8 |
| Joe Coffee Company | The Village | Bitterness | 2.5 | 2 | 2 | 2 | 0 | true | 8 |
| Joe Coffee Company | The Village | Body | 6 | 2 | 2 | 1.5 | 0.5 | true | 5 |
| Joe Bean Roasters | Tiger Stripe Espresso | Sweetness | 3.5 | 4 | 2 | 2.5 | 0.5 | true | 4 |
| Joe Bean Roasters | Tiger Stripe Espresso | Acidity | 4.5 | 4 | 3 | 3.5 | 0.5 | true | 4 |
| Joe Bean Roasters | Tiger Stripe Espresso | Bitterness | 3.5 | 3 | 2.5 | 2.5 | 0 | true | 4 |
| Joe Bean Roasters | Tiger Stripe Espresso | Body | 7 | 5 | 2 | 3.5 | 1.5 | true | 4 |
| Joe Bean Roasters | Tiger Stripe Espresso | Finish Length | 8 | 4 | 3 | 2 | 1 | true | 4 |

### Unmapped words (A7), as they come out

86 words: 73 from cupper notes, 8 from roaster websites, 3 portal-form notes, 2 table remarks (the suite's own fixture words on the test DB, "zzz …" and the portal test roastery's, are left out of this list; prod has none). Portal-form entries are whole notes, as the mapping table keys them.

| source | word | n_coffees | example |
|---|---|---|---|
| cupper_notes | above a scribbled-out word | 1 | Flying Jewel |
| cupper_notes | after fire | 1 | Blossom Dark Roast |
| cupper_notes | almonds | 4 | Flying Jewel |
| cupper_notes | almond tea | 1 | Decaf Mexico Veracruz |
| cupper_notes | ashy finish | 1 | Nocturnal Dark Roast |
| cupper_notes | balanced | 1 | Benchmark |
| cupper_notes | balanced and soft | 1 | Noam Blend |
| cupper_notes | bbq | 1 | Obsidian |
| cupper_notes | bbq chips | 1 | Blossom Dark Roast |
| cupper_notes | bitter and sour — lingers | 1 | Nocturnal Dark Roast |
| cupper_notes | blackberries | 1 | Colombia Andres Martinez |
| cupper_notes | bold | 1 | Nocturnal Dark Roast |
| cupper_notes | caramel | 5 | Colombia La Familia Guarnizo |
| cupper_notes | cherry like | 1 | Fabricator House Roast |
| cupper_notes | cigarette | 1 | Blossom Dark Roast |
| cupper_notes | citric | 1 | Crosshatch |
| cupper_notes | clean — no aftertaste | 1 | Crosshatch |
| cupper_notes | cocoa or milk chocolate | 1 | Espresso Volo |
| cupper_notes | dark choc | 1 | Espresso Volo |
| cupper_notes | dried | 1 | Colombia Andres Martinez |
| cupper_notes | dried orange | 1 | Colombia Andres Martinez |
| cupper_notes | earth | 1 | Blossom Dark Roast |
| cupper_notes | earthy | 1 | Blossom Dark Roast |
| cupper_notes | earthy finish | 1 | Nocturnal Dark Roast |
| cupper_notes | fruity tea | 1 | Tiger Stripe Espresso |
| cupper_notes | green | 1 | The Village |
| cupper_notes | green tea bitterness | 1 | Colombia La Familia Guarnizo |
| cupper_notes | happy | 1 | Peru Chirinos Geisha |
| cupper_notes | heavy | 1 | Nocturnal Dark Roast |
| cupper_notes | herbal | 1 | Peru Joel Silva Chirinos |
| cupper_notes | jasmin | 2 | Peru Chirinos Geisha |
| cupper_notes | jasmine flower | 1 | Fabricator House Roast |
| cupper_notes | light acid | 4 | The Village |
| cupper_notes | light acidity | 1 | Cafè Feminista: Montze Olvera |
| cupper_notes | light bitter | 1 | Espresso Volo |
| cupper_notes | light bitterness | 1 | Amsterdam |
| cupper_notes | light citrus | 1 | Union |
| cupper_notes | light cocoa | 1 | Pearl |
| cupper_notes | light fruit | 1 | Tiger Stripe Espresso |
| cupper_notes | light syrup | 1 | Obsidian |
| cupper_notes | like apple juice | 1 | Crosshatch |
| cupper_notes | lingering acid | 1 | Crosshatch |
| cupper_notes | long finish | 1 | Nocturnal Dark Roast |
| cupper_notes | low acid | 1 | Decaf Mexico Veracruz |
| cupper_notes | low bitter | 1 | Obsidian |
| cupper_notes | milk choc | 1 | Tiger Stripe Espresso |
| cupper_notes | musty | 1 | Big City |
| cupper_notes | musty/earthy | 1 | Nocturnal Dark Roast |
| cupper_notes | not citrus | 1 | Fabricator House Roast |
| cupper_notes | oranges / fruits | 1 | Fabricator House Roast |
| cupper_notes | raspberries | 1 | Colombia Andres Martinez |
| cupper_notes | refreshing | 1 | Peru Chirinos Geisha |
| cupper_notes | rust | 1 | Blossom Dark Roast |
| cupper_notes | short | 1 | Pearl |
| cupper_notes | smokey | 4 | Blossom Dark Roast |
| cupper_notes | smoky light | 1 | Pearl |
| cupper_notes | soft fruits | 1 | Peru Chirinos Geisha |
| cupper_notes | soft sweet | 1 | Espresso Volo |
| cupper_notes | sour fruity | 1 | Union |
| cupper_notes | sour — full body | 1 | Crosshatch |
| cupper_notes | soy | 1 | Obsidian |
| cupper_notes | sugar | 1 | Espresso Volo |
| cupper_notes | sugar sweet | 1 | Decaf Mexico Veracruz |
| cupper_notes | sugary | 1 | Decaf Mexico Veracruz |
| cupper_notes | sweet berries | 1 | Peru Joel Silva Chirinos |
| cupper_notes | sweet black tea | 1 | Colombia Andres Martinez |
| cupper_notes | sweet fruits | 1 | Peru Joel Silva Chirinos |
| cupper_notes | sweet fruits with a bit of acidity | 1 | Colombia Andres Martinez |
| cupper_notes | sweet-honey | 1 | Tiger Stripe Espresso |
| cupper_notes | tobacco vibes | 1 | Mexico Alva Flores |
| cupper_notes | very bitter | 1 | Nocturnal Dark Roast |
| cupper_notes | weak black tea | 1 | Peru Chirinos Geisha |
| cupper_notes | whole milk | 1 | Colombia La Familia Guarnizo |
| roaster_form | apple blossom, candied grapefruit, apricot | 1 | The Village |
| roaster_form | caramel, honey, clementine | 1 | Colombia La Familia Guarnizo |
| roaster_form | papaya, milk duds, candied coconut | 1 | Cafè Feminista: Montze Olvera |
| roaster_remark | orange blossom | 1 | Colombia La Familia Guarnizo |
| roaster_remark | white floral | 1 | Colombia La Familia Guarnizo |
| roaster_website | buttered pastry | 1 | Union |
| roaster_website | cola | 1 | Nightcap Decaf |
| roaster_website | crunchy sweetness | 1 | Peru Joel Silva Chirinos |
| roaster_website | flaky croissant | 1 | Decaf Mexico Veracruz |
| roaster_website | graham cracker | 1 | Fabricator House Roast |
| roaster_website | milk duds | 1 | Cafè Feminista: Montze Olvera |
| roaster_website | sweet cream | 1 | Flying Jewel |
| roaster_website | ube halo halo | 1 | Peru Joel Silva Chirinos |

## The view definitions (in `schema.sql`, Part A)

The pre-drop of the eight evidence views sits before the first view drop in `schema.sql`; the block below sits just before the customer grant block (which stays last). The A0 base-view columns are appended to the existing `v_coffee`, `v_coffee_slot` and `v_roastery_portal_coffee_hint` definitions; their new definitions follow the evidence block.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CUPPING EVIDENCE brief 3, Part A (2026-10-18): the reconciliation views
-- (backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_3_RECONCILIATION.md,
-- DESIGN_CUPPING_EVIDENCE.md §7). Views only: nothing stored, nothing written.
-- No cupper name, number or label in any definition: cuppers come from the
-- `cupper` rows through the base views (one row per cupper), thresholds from
-- param(), the stop list from evidence_stop_word, SCA families from
-- cupping_note.parent_id (v_cupping_note_family). They read evidence through
-- views only (A0 below adds the three small views and the columns the
-- existing ones lacked). Pre-dropped near the top of this file (before the
-- first view drop), so every base view they read can drop and recreate itself
-- on each boot without meeting a dependent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A0. Base views the evidence views need ───────────────────────────────────

-- Each SCA node with its tier-1 ancestor (the family), walked up parent_id.
-- A family is a join, never a match on wheel_category text (decision 4).
DROP VIEW IF EXISTS v_cupping_note_family;
CREATE VIEW v_cupping_note_family AS
WITH RECURSIVE up AS (
  SELECT n.id AS cupping_note_id, n.id AS ancestor_id, n.parent_id, n.tier
  FROM cupping_note n
  UNION ALL
  SELECT up.cupping_note_id, p.id, p.parent_id, p.tier
  FROM up JOIN cupping_note p ON p.id = up.parent_id
)
SELECT n.id AS cupping_note_id, n.descriptor, n.tier, n.is_active,
       f.id AS family_id, f.descriptor AS family
FROM cupping_note n
JOIN up ON up.cupping_note_id = n.id AND up.tier = 1
JOIN cupping_note f ON f.id = up.ancestor_id;

-- The printed sheets' lines (which dimension each line feeds, numbers or words).
DROP VIEW IF EXISTS v_cupping_sheet_line;
CREATE VIEW v_cupping_sheet_line AS
SELECT l.id, l.sheet_format, l.line_label, l.dimension_id, l.is_numeric, l.display_order
FROM cupping_sheet_line l;

-- The current word → SCA node mappings, roaster and cupper (one writer:
-- noteMappingService). Superseded rows stay in the table.
DROP VIEW IF EXISTS v_note_mapping_current;
CREATE VIEW v_note_mapping_current AS
SELECT m.id, m.normalized_words, m.cupping_note_id, m.source_kind, m.note, m.created_at
FROM roastery_portal_note_mapping m
WHERE m.superseded_at IS NULL;

-- The current cupping dial signal per coffee and its basis line.
DROP VIEW IF EXISTS v_dial_position_signal_current;
CREATE VIEW v_dial_position_signal_current AS
SELECT s.id, s.coffee_id, s.archetype, s.dimension_id, s.source, s.suggested_slot_id,
       s.raw_value, s.sample_size, s.notes, s.computed_at
FROM dial_position_signal s
WHERE s.superseded_at IS NULL;

-- ── A1. v_evidence_dimension: coffee × numeric dimension × cupper ───────────
CREATE VIEW v_evidence_dimension AS
WITH cupper_latest AS (
  -- each cupper's latest current row per coffee and dimension, converted
  SELECT DISTINCT ON (r.coffee_id, r.dimension_id, r.cupper_id)
         r.coffee_id, r.dimension_id, r.cupper_id, r.cupper_name,
         r.value_min AS cupper_min, r.value_max AS cupper_max,
         ROUND((r.value_min + r.value_max) / 2.0, 2) AS cupper_midpoint,
         r.scale_code AS cupper_scale_code, r.session_id AS cupper_session_id, r.session_date AS cupper_session_date
  FROM v_cupping_scores_readable r
  WHERE NOT r.is_merged AND r.cupper_id IS NOT NULL AND r.is_numeric
    AND r.value_min IS NOT NULL AND r.value_max IS NOT NULL
  ORDER BY r.coffee_id, r.dimension_id, r.cupper_id, r.session_date DESC, r.score_id DESC
),
cupper_pairs AS (
  -- agree when every pair of ranges overlaps or gaps by <= param('cupper_gap'); null with one cupper
  SELECT a.coffee_id, a.dimension_id,
         bool_and(GREATEST(a.cupper_min - b.cupper_max, b.cupper_min - a.cupper_max, 0) <= param('cupper_gap')) AS cuppers_agree
  FROM cupper_latest a
  JOIN cupper_latest b ON b.coffee_id = a.coffee_id AND b.dimension_id = a.dimension_id AND b.cupper_id > a.cupper_id
  GROUP BY a.coffee_id, a.dimension_id
),
merged AS (
  SELECT r.coffee_id, r.dimension_id, r.dimension_name, r.value_min, r.value_max, r.midpoint,
         r.session_id, r.session_date, r.n_sessions, r.all_ab_scale
  FROM v_coffee_dimension_range r
  WHERE r.basis = 'merged'
),
roaster_value AS (
  -- the current submitted portal response's 1 to 5 value (portal dimension ids are coffee_dimensions ids)
  SELECT h.coffee_id, (d->>'dimension_id')::int AS dimension_id, (d->>'value')::numeric AS roaster_value_1_5
  FROM v_roastery_portal_coffee_hint h
  CROSS JOIN LATERAL jsonb_array_elements(h.dimensions) d
  WHERE d->>'value' IS NOT NULL
),
both_sides AS (
  SELECT vc.roaster_id, m.coffee_id, m.dimension_id, m.midpoint, rv.roaster_value_1_5
  FROM merged m
  JOIN roaster_value rv ON rv.coffee_id = m.coffee_id AND rv.dimension_id = m.dimension_id
  JOIN v_coffee vc ON vc.id = m.coffee_id
  WHERE m.midpoint IS NOT NULL
),
ranked AS (
  -- average ranks within the roastery's coffees that have both sides (ties share the mean position)
  SELECT b.coffee_id, b.dimension_id,
         COUNT(*) OVER (PARTITION BY b.roaster_id, b.dimension_id) AS lineup_n,
         RANK() OVER (PARTITION BY b.roaster_id, b.dimension_id ORDER BY b.midpoint)
           + (COUNT(*) OVER (PARTITION BY b.roaster_id, b.dimension_id, b.midpoint) - 1) / 2.0 AS ab_rank,
         RANK() OVER (PARTITION BY b.roaster_id, b.dimension_id ORDER BY b.roaster_value_1_5)
           + (COUNT(*) OVER (PARTITION BY b.roaster_id, b.dimension_id, b.roaster_value_1_5) - 1) / 2.0 AS roaster_rank
  FROM both_sides b
),
ranks AS (
  SELECT k.coffee_id, k.dimension_id, k.lineup_n,
         CASE WHEN k.lineup_n >= 2 THEN ROUND(k.roaster_rank, 1) END AS roaster_rank_in_lineup,
         CASE WHEN k.lineup_n >= 2 THEN ROUND(k.ab_rank, 1) END AS ab_rank_in_lineup,
         CASE WHEN k.lineup_n >= 2 THEN ROUND(abs(k.ab_rank - k.roaster_rank), 1) END AS rank_gap
  FROM ranked k
),
assembled AS (
  SELECT
    vc.id AS coffee_id, vc.name AS coffee_name, vc.roaster_id, vc.roaster_name,
    cl.dimension_id, d.name AS dimension_name,
    cl.cupper_id, cl.cupper_name,
    cl.cupper_min, cl.cupper_max, cl.cupper_midpoint, cl.cupper_scale_code, cl.cupper_session_id, cl.cupper_session_date,
    m.value_min AS merged_min, m.value_max AS merged_max, m.midpoint AS merged_midpoint,
    m.session_id AS merged_session_id, m.session_date AS merged_session_date, m.n_sessions, m.all_ab_scale,
    h.scale_codes,
    cp.cuppers_agree,
    rv.roaster_value_1_5,
    rk.roaster_rank_in_lineup, rk.ab_rank_in_lineup, rk.lineup_n, rk.rank_gap,
    CASE WHEN rk.rank_gap IS NULL THEN NULL ELSE rk.rank_gap < param('roaster_rank_gap') END AS roaster_agrees,
    s.is_blind, s.roaster_present, sc.is_control
  FROM cupper_latest cl
  JOIN v_coffee vc ON vc.id = cl.coffee_id
  JOIN coffee_dimensions d ON d.id = cl.dimension_id
  LEFT JOIN merged m ON m.coffee_id = cl.coffee_id AND m.dimension_id = cl.dimension_id
  LEFT JOIN v_coffee_dimension_history h ON h.coffee_id = m.coffee_id AND h.dimension_id = m.dimension_id AND h.session_id = m.session_id
  LEFT JOIN cupper_pairs cp ON cp.coffee_id = cl.coffee_id AND cp.dimension_id = cl.dimension_id
  LEFT JOIN roaster_value rv ON rv.coffee_id = cl.coffee_id AND rv.dimension_id = cl.dimension_id
  LEFT JOIN ranks rk ON rk.coffee_id = cl.coffee_id AND rk.dimension_id = cl.dimension_id
  LEFT JOIN v_cupping_session s ON s.id = m.session_id
  LEFT JOIN v_cupping_session_coffee sc ON sc.session_id = m.session_id AND sc.coffee_id = m.coffee_id
)
SELECT a.*,
  CASE
    WHEN a.cuppers_agree IS FALSE AND a.roaster_agrees IS FALSE THEN 'both'
    WHEN a.cuppers_agree IS FALSE THEN 'cuppers_disagree'
    WHEN a.roaster_agrees IS FALSE THEN 'roaster_disagrees'
    WHEN a.cuppers_agree IS NULL AND a.roaster_agrees IS NULL THEN 'one_source'
    ELSE 'none'
  END AS flag
FROM assembled a;

-- ── A2. v_evidence_descriptor: coffee × SCA family ───────────────────────────
CREATE VIEW v_evidence_descriptor AS
WITH portal_note AS (
  -- the current submitted response's notes, at their own node or through a current roaster mapping
  SELECT h.coffee_id, COALESCE((n->>'cupping_note_id')::uuid, mp.cupping_note_id) AS cupping_note_id
  FROM v_roastery_portal_coffee_hint h
  CROSS JOIN LATERAL jsonb_array_elements(h.notes) n
  LEFT JOIN v_note_mapping_current mp
    ON mp.source_kind = 'roaster'
   AND mp.normalized_words = regexp_replace(lower(btrim(n->>'roaster_words')), '\s+', ' ', 'g')
),
website_latest AS (
  -- the latest capture of each roaster × coffee website (an earlier capture stays in v_roastery_remark)
  SELECT roaster_id, coffee_id, max(said_on) AS said_on
  FROM v_roastery_remark
  WHERE channel = 'website' AND is_current AND coffee_id IS NOT NULL
  GROUP BY roaster_id, coffee_id
),
named AS (
  SELECT d.coffee_id, d.cupping_note_id, 'cupper'::text AS src, s.cupper_name
  FROM v_cupping_score_descriptor d
  JOIN v_cupping_score s ON s.id = d.cupping_score_id
  WHERE NOT d.is_merged AND s.cupper_id IS NOT NULL
  UNION ALL
  SELECT pn.coffee_id, pn.cupping_note_id, 'roaster_form', NULL FROM portal_note pn WHERE pn.cupping_note_id IS NOT NULL
  UNION ALL
  SELECT r.coffee_id, r.cupping_note_id, 'roaster_remark', NULL
  FROM v_roastery_remark r
  WHERE r.is_current AND r.topic = 'descriptor' AND r.channel <> 'website' AND r.cupping_note_id IS NOT NULL AND r.coffee_id IS NOT NULL
  UNION ALL
  SELECT r.coffee_id, r.cupping_note_id, 'roaster_website', NULL
  FROM v_roastery_remark r
  JOIN website_latest wl ON wl.roaster_id = r.roaster_id AND wl.coffee_id = r.coffee_id AND wl.said_on = r.said_on
  WHERE r.is_current AND r.topic = 'descriptor' AND r.channel = 'website' AND r.cupping_note_id IS NOT NULL
  UNION ALL
  SELECT f.coffee_id, unnest(f.descriptor_note_ids), 'customer', NULL
  FROM v_customer_feedback_current f
  WHERE f.coffee_id IS NOT NULL
  UNION ALL
  SELECT w.coffee_id, w.cupping_note_id, 'accepted', NULL
  FROM v_collaborative_flavor_wheel w
  WHERE w.source = 'roastery'
),
per_family AS (
  SELECT nm.coffee_id, fam.family_id, fam.family,
         array_agg(DISTINCT nm.cupper_name ORDER BY nm.cupper_name) FILTER (WHERE nm.src = 'cupper') AS named_by_cuppers,
         bool_or(nm.src = 'cupper')          AS named_by_ab,
         bool_or(nm.src = 'roaster_form')    AS named_by_roaster_form,
         bool_or(nm.src = 'roaster_remark')  AS named_by_roaster_remark,
         bool_or(nm.src = 'roaster_website') AS named_by_roaster_website,
         bool_or(nm.src = 'customer')        AS named_by_customer,
         bool_or(nm.src = 'accepted')        AS accepted_in_catalog,
         count(DISTINCT CASE WHEN nm.src = 'cupper' THEN 'cupper:' || nm.cupper_name ELSE nm.src END) AS n_sources
  FROM named nm
  JOIN v_cupping_note_family fam ON fam.cupping_note_id = nm.cupping_note_id AND fam.is_active
  GROUP BY nm.coffee_id, fam.family_id, fam.family
)
SELECT vc.id AS coffee_id, vc.name AS coffee_name, vc.roaster_id,
       pf.family_id, pf.family,
       COALESCE(pf.named_by_cuppers, ARRAY[]::text[]) AS named_by_cuppers,
       pf.named_by_ab, pf.named_by_roaster_form, pf.named_by_roaster_remark, pf.named_by_roaster_website,
       pf.named_by_customer, pf.accepted_in_catalog,
       (pf.named_by_roaster_form OR pf.named_by_roaster_remark OR pf.named_by_roaster_website) AS named_by_roaster,
       (pf.named_by_ab AND (pf.named_by_roaster_form OR pf.named_by_roaster_remark OR pf.named_by_roaster_website)) AS hit,
       (NOT pf.named_by_ab AND (pf.named_by_roaster_form OR pf.named_by_roaster_remark OR pf.named_by_roaster_website)) AS miss,
       (pf.named_by_ab AND NOT (pf.named_by_roaster_form OR pf.named_by_roaster_remark OR pf.named_by_roaster_website)) AS extra,
       pf.n_sources
FROM per_family pf
JOIN v_coffee vc ON vc.id = pf.coffee_id;

-- ── A3. v_evidence_archetype_call (coffee × cupper) and v_evidence_archetype (coffee) ──
CREATE VIEW v_evidence_archetype_call AS
SELECT DISTINCT ON (s.coffee_id, s.cupper_id)
       s.coffee_id, s.cupper_id, s.cupper_name, s.session_id, ss.session_date, ss.is_blind,
       s.archetype_call, s.archetype_call_secondary, s.position_call, s.slot_call_id, s.call_note
FROM v_cupping_score s
JOIN v_cupping_session ss ON ss.id = s.session_id
WHERE NOT s.is_merged AND s.cupper_id IS NOT NULL
ORDER BY s.coffee_id, s.cupper_id, ss.session_date DESC, s.id DESC;

CREATE VIEW v_evidence_archetype AS
WITH calls AS (
  SELECT c.coffee_id,
         jsonb_object_agg(c.cupper_name, c.archetype_call) AS cupper_calls,
         count(c.archetype_call) AS n_cuppers_called,
         CASE WHEN count(c.archetype_call) < 2 THEN NULL
              ELSE count(DISTINCT c.archetype_call) = 1 END AS cupper_calls_agree
  FROM v_evidence_archetype_call c
  GROUP BY c.coffee_id
),
merged_call AS (
  SELECT DISTINCT ON (s.coffee_id) s.coffee_id, s.archetype_call AS merged_call, s.call_note AS merged_call_note
  FROM v_cupping_score s
  JOIN v_cupping_session ss ON ss.id = s.session_id
  WHERE s.is_merged
  ORDER BY s.coffee_id, ss.session_date DESC, s.id DESC
),
latest_session AS (
  SELECT DISTINCT ON (s.coffee_id) s.coffee_id, ss.id AS session_id, ss.session_date, ss.is_blind, ss.roaster_present
  FROM v_cupping_score s
  JOIN v_cupping_session ss ON ss.id = s.session_id
  ORDER BY s.coffee_id, ss.session_date DESC, ss.id DESC
),
remark_proposals AS (
  SELECT r.coffee_id, array_agg(DISTINCT r.proposed_archetype::text ORDER BY r.proposed_archetype::text) AS proposals
  FROM v_roastery_remark r
  WHERE r.is_current AND r.topic = 'classification' AND r.proposed_archetype IS NOT NULL AND r.coffee_id IS NOT NULL
  GROUP BY r.coffee_id
),
home AS (
  SELECT DISTINCT ON (s.coffee_id) s.coffee_id, s.slot_id, s.slot_name, s.placement_note, s.placed_from_session_id,
         s.slot_dimension_id, s.spec_band_lo, s.spec_band_hi, s.placement_archetype
  FROM v_coffee_slot s
  WHERE s.role = 'home' AND s.assignment_is_active
  ORDER BY s.coffee_id, s.priority, s.assignment_id
),
signal AS (
  SELECT DISTINCT ON (g.coffee_id) g.coffee_id, g.notes
  FROM v_dial_position_signal_current g
  WHERE g.source = 'cupping'
  ORDER BY g.coffee_id, g.computed_at DESC, g.id DESC
),
assembled AS (
  SELECT
    vc.id AS coffee_id, vc.name AS coffee_name, vc.roaster_id, vc.roaster_name,
    ca.cupper_calls, COALESCE(ca.n_cuppers_called, 0) AS n_cuppers_called, ca.cupper_calls_agree,
    mc.merged_call, mc.merged_call_note,
    hint.proposed_archetype AS roaster_form_proposal,
    rp.proposals AS roaster_remark_proposals,
    vc.match_archetype AS catalog_archetype, vc.match_confidence AS catalog_confidence, vc.match_source AS catalog_source,
    vc.match_session_id AS assigned_from_session_id, vc.match_notes AS basis, vc.match_basis AS basis_json,
    hm.slot_id AS catalog_home_slot_id, hm.slot_name AS catalog_home_slot_name, hm.placement_note, hm.placed_from_session_id,
    ls.session_id AS latest_session_id, ls.session_date AS latest_session_date,
    CASE WHEN vc.match_session_id IS NULL AND hm.placed_from_session_id IS NULL THEN NULL
         ELSE ls.session_date > LEAST(sa.session_date, sp.session_date) END AS evidence_newer_than_decision,
    CASE
      WHEN hm.slot_id IS NULL THEN NULL
      WHEN hm.spec_band_lo IS NULL AND hm.spec_band_hi IS NULL THEN 'no_band'
      WHEN rng.midpoint IS NULL THEN 'no_merged_range'
      WHEN (hm.spec_band_lo IS NOT NULL AND rng.midpoint < hm.spec_band_lo)
        OR (hm.spec_band_hi IS NOT NULL AND rng.midpoint > hm.spec_band_hi) THEN 'out_of_band'
      ELSE 'in_band'
    END AS slot_spec_check,
    sig.notes AS dial_signal_basis,
    CASE WHEN hint.proposed_archetype IS NULL AND rp.proposals IS NULL THEN NULL
         ELSE vc.match_archetype::text = ANY (array_remove(COALESCE(rp.proposals, ARRAY[]::text[]) || hint.proposed_archetype::text, NULL)) END
      AS roaster_agrees_with_catalog,
    ls.is_blind, ls.roaster_present, ls.session_date AS last_cupped
  FROM v_coffee vc
  LEFT JOIN calls ca ON ca.coffee_id = vc.id
  LEFT JOIN merged_call mc ON mc.coffee_id = vc.id
  LEFT JOIN latest_session ls ON ls.coffee_id = vc.id
  LEFT JOIN v_roastery_portal_coffee_hint hint ON hint.coffee_id = vc.id
  LEFT JOIN remark_proposals rp ON rp.coffee_id = vc.id
  LEFT JOIN home hm ON hm.coffee_id = vc.id
  LEFT JOIN v_cupping_session sa ON sa.id = vc.match_session_id
  LEFT JOIN v_cupping_session sp ON sp.id = hm.placed_from_session_id
  LEFT JOIN v_coffee_archetype ar ON ar.code = hm.placement_archetype
  LEFT JOIN v_coffee_dimension_range rng
    ON rng.coffee_id = vc.id AND rng.basis = 'merged' AND rng.dimension_id = COALESCE(hm.slot_dimension_id, ar.dominant_dimension_id)
  LEFT JOIN signal sig ON sig.coffee_id = vc.id
)
SELECT a.*,
  CASE
    WHEN a.cupper_calls_agree IS FALSE AND a.roaster_agrees_with_catalog IS FALSE THEN 'both'
    WHEN a.cupper_calls_agree IS FALSE THEN 'cuppers_disagree'
    WHEN a.roaster_agrees_with_catalog IS FALSE THEN 'roaster_disagrees'
    WHEN a.catalog_archetype IS NOT NULL AND a.basis_json IS NULL AND COALESCE(btrim(a.basis), '') = '' THEN 'no_basis'
    WHEN a.slot_spec_check = 'out_of_band' THEN 'out_of_band'
    WHEN a.evidence_newer_than_decision THEN 'stale_decision'
    ELSE 'none'
  END AS flag
FROM assembled a;

-- ── A4. v_evidence_roastery_calibration: roastery × numeric dimension ───────
CREATE VIEW v_evidence_roastery_calibration AS
WITH latest_ab AS (
  -- each coffee's latest merged session per dimension, native A&B scale only (decision 5)
  SELECT DISTINCT ON (h.coffee_id, h.dimension_id) h.coffee_id, h.dimension_id, h.midpoint, h.session_id, h.is_blind
  FROM v_coffee_dimension_history h
  ORDER BY h.coffee_id, h.dimension_id, h.session_date DESC, h.merged_score_id DESC
),
roaster_value AS (
  SELECT h.coffee_id, (d->>'dimension_id')::int AS dimension_id, (d->>'value')::numeric AS value_1_5
  FROM v_roastery_portal_coffee_hint h
  CROSS JOIN LATERAL jsonb_array_elements(h.dimensions) d
  WHERE d->>'value' IS NOT NULL
),
both_sides AS (
  SELECT vc.roaster_id, l.coffee_id, l.dimension_id, l.midpoint, rv.value_1_5, l.is_blind, s.roaster_present
  FROM latest_ab l
  JOIN v_coffee_dimension_history hh ON hh.coffee_id = l.coffee_id AND hh.dimension_id = l.dimension_id AND hh.session_id = l.session_id AND hh.all_ab_scale
  JOIN roaster_value rv ON rv.coffee_id = l.coffee_id AND rv.dimension_id = l.dimension_id
  JOIN v_coffee vc ON vc.id = l.coffee_id
  LEFT JOIN v_cupping_session s ON s.id = l.session_id
  WHERE l.midpoint IS NOT NULL
),
ranked AS (
  SELECT b.*,
         RANK() OVER (PARTITION BY b.roaster_id, b.dimension_id ORDER BY b.midpoint)
           + (COUNT(*) OVER (PARTITION BY b.roaster_id, b.dimension_id, b.midpoint) - 1) / 2.0 AS ab_rank,
         RANK() OVER (PARTITION BY b.roaster_id, b.dimension_id ORDER BY b.value_1_5)
           + (COUNT(*) OVER (PARTITION BY b.roaster_id, b.dimension_id, b.value_1_5) - 1) / 2.0 AS roaster_rank
  FROM both_sides b
),
per_dim AS (
  SELECT k.roaster_id, k.dimension_id, count(*) AS n,
         corr(k.ab_rank, k.roaster_rank) AS rho,
         avg(abs(k.ab_rank - k.roaster_rank)) AS mean_rank_gap,
         count(*) FILTER (WHERE k.is_blind) AS n_blind,
         count(*) FILTER (WHERE k.roaster_present) AS n_roaster_present
  FROM ranked k
  GROUP BY k.roaster_id, k.dimension_id
),
crosstab_cells AS (
  SELECT ea.roaster_id, COALESCE(ea.merged_call::text, 'no_call') AS ours,
         COALESCE(ea.roaster_form_proposal::text, 'no_proposal') AS theirs, count(*) AS n
  FROM v_evidence_archetype ea
  WHERE ea.merged_call IS NOT NULL OR ea.roaster_form_proposal IS NOT NULL
  GROUP BY 1, 2, 3
),
crosstab_rows AS (
  SELECT roaster_id, ours, jsonb_object_agg(theirs, n) AS cells FROM crosstab_cells GROUP BY roaster_id, ours
),
crosstab AS (
  SELECT roaster_id, jsonb_object_agg(ours, cells) AS archetype_crosstab FROM crosstab_rows GROUP BY roaster_id
),
descriptor_counts AS (
  SELECT ed.roaster_id,
         count(*) FILTER (WHERE ed.hit) AS descriptor_hit,
         count(*) FILTER (WHERE ed.miss) AS descriptor_miss,
         count(*) FILTER (WHERE ed.extra) AS descriptor_extra
  FROM v_evidence_descriptor ed
  GROUP BY ed.roaster_id
),
roaster_dims AS (
  -- every roastery × numeric dimension where either side has a value
  SELECT DISTINCT vc.roaster_id, l.dimension_id FROM latest_ab l JOIN v_coffee vc ON vc.id = l.coffee_id
  UNION
  SELECT DISTINCT vc.roaster_id, rv.dimension_id FROM roaster_value rv JOIN v_coffee vc ON vc.id = rv.coffee_id
)
SELECT rd.roaster_id, vr.roaster_name, rd.dimension_id, d.name AS dimension_name,
       COALESCE(pd.n, 0) AS n,
       CASE WHEN COALESCE(pd.n, 0) >= param('rank_corr_min_n') THEN ROUND(pd.rho::numeric, 3) END AS rank_corr,
       ROUND(pd.mean_rank_gap, 2) AS mean_rank_gap,
       CASE WHEN COALESCE(pd.n, 0) >= param('spearman_min_n') AND pd.rho IS NOT NULL THEN pd.rho < param('spearman_rho_cut') END AS inverted,
       CASE WHEN COALESCE(pd.n, 0) < param('spearman_min_n') THEN 'n too small' END AS note,
       COALESCE(pd.n_blind, 0) AS n_blind, COALESCE(pd.n_roaster_present, 0) AS n_roaster_present,
       COALESCE(ct.archetype_crosstab, '{}'::jsonb) AS archetype_crosstab,
       COALESCE(dc.descriptor_hit, 0) AS descriptor_hit, COALESCE(dc.descriptor_miss, 0) AS descriptor_miss,
       COALESCE(dc.descriptor_extra, 0) AS descriptor_extra
FROM roaster_dims rd
JOIN coffee_dimensions d ON d.id = rd.dimension_id AND d.is_numeric
JOIN (SELECT DISTINCT roaster_id, roaster_name FROM v_coffee) vr ON vr.roaster_id = rd.roaster_id
LEFT JOIN per_dim pd ON pd.roaster_id = rd.roaster_id AND pd.dimension_id = rd.dimension_id
LEFT JOIN crosstab ct ON ct.roaster_id = rd.roaster_id
LEFT JOIN descriptor_counts dc ON dc.roaster_id = rd.roaster_id;

-- ── A5. v_evidence_cupper_calibration: cupper × numeric dimension × blind ──
CREATE VIEW v_evidence_cupper_calibration AS
WITH rows_ab AS (
  -- every current cupper row on the native A&B scale, all sessions (calibration reads history)
  SELECT r.cupper_id, r.cupper_name, r.dimension_id, r.coffee_id, r.session_id, r.session_coffee_id, r.session_date,
         r.is_blind, r.is_control, r.value_min, r.value_max,
         (r.value_min + r.value_max) / 2.0 AS midpoint
  FROM v_cupping_scores_readable r
  WHERE NOT r.is_merged AND r.cupper_id IS NOT NULL AND r.scale_code = 'ab_0_15' AND r.is_numeric
    AND r.value_min IS NOT NULL AND r.value_max IS NOT NULL
),
vs_other AS (
  SELECT a.cupper_id, a.dimension_id, a.session_coffee_id, a.is_blind,
         a.midpoint - avg(b.midpoint) AS signed_gap,
         bool_or(GREATEST(a.value_min - b.value_max, b.value_min - a.value_max, 0) > param('cupper_gap')) AS disagrees
  FROM rows_ab a
  JOIN rows_ab b ON b.session_coffee_id = a.session_coffee_id AND b.dimension_id = a.dimension_id AND b.cupper_id <> a.cupper_id
  GROUP BY a.cupper_id, a.dimension_id, a.session_coffee_id, a.is_blind, a.midpoint
),
cupper_latest AS (
  SELECT DISTINCT ON (r.cupper_id, r.dimension_id, r.coffee_id) r.*
  FROM rows_ab r
  ORDER BY r.cupper_id, r.dimension_id, r.coffee_id, r.session_date DESC, r.session_id DESC
),
roaster_value AS (
  SELECT h.coffee_id, (d->>'dimension_id')::int AS dimension_id, (d->>'value')::numeric AS value_1_5
  FROM v_roastery_portal_coffee_hint h
  CROSS JOIN LATERAL jsonb_array_elements(h.dimensions) d
  WHERE d->>'value' IS NOT NULL
),
vs_roaster AS (
  -- this cupper's average rank and the roaster's within the roastery's lineup, where both exist
  -- (a signed mean of their difference is zero by construction, so A5 reports
  -- the mean absolute gap and the correlation of the two rank vectors)
  SELECT x.cupper_id, x.dimension_id, x.is_blind, x.cupper_rank, x.roaster_rank
  FROM (
    SELECT cl.cupper_id, cl.dimension_id, cl.is_blind, vc.roaster_id,
           COUNT(*) OVER (PARTITION BY cl.cupper_id, cl.dimension_id, vc.roaster_id) AS lineup_n,
           RANK() OVER (PARTITION BY cl.cupper_id, cl.dimension_id, vc.roaster_id ORDER BY cl.midpoint)
             + (COUNT(*) OVER (PARTITION BY cl.cupper_id, cl.dimension_id, vc.roaster_id, cl.midpoint) - 1) / 2.0 AS cupper_rank,
           RANK() OVER (PARTITION BY cl.cupper_id, cl.dimension_id, vc.roaster_id ORDER BY rv.value_1_5)
             + (COUNT(*) OVER (PARTITION BY cl.cupper_id, cl.dimension_id, vc.roaster_id, rv.value_1_5) - 1) / 2.0 AS roaster_rank
    FROM cupper_latest cl
    JOIN roaster_value rv ON rv.coffee_id = cl.coffee_id AND rv.dimension_id = cl.dimension_id
    JOIN v_coffee vc ON vc.id = cl.coffee_id
  ) x
  WHERE x.lineup_n >= 2
),
vs_catalog AS (
  -- control samples: this cupper's midpoint minus the coffee's latest merged midpoint before the control session
  SELECT c.cupper_id, c.dimension_id, c.is_blind, c.midpoint - prior.midpoint AS signed_gap
  FROM rows_ab c
  CROSS JOIN LATERAL (
    SELECT h.midpoint FROM v_coffee_dimension_history h
    WHERE h.coffee_id = c.coffee_id AND h.dimension_id = c.dimension_id AND h.session_date < c.session_date
    ORDER BY h.session_date DESC, h.merged_score_id DESC LIMIT 1
  ) prior
  WHERE c.is_control
),
repeats AS (
  -- coffees this cupper scored in two or more sessions: mean absolute gap between her midpoints, over session pairs
  SELECT a.cupper_id, a.dimension_id, a.is_blind, a.coffee_id, avg(abs(a.midpoint - b.midpoint)) AS mean_gap
  FROM rows_ab a
  JOIN rows_ab b ON b.cupper_id = a.cupper_id AND b.dimension_id = a.dimension_id AND b.coffee_id = a.coffee_id AND b.session_id > a.session_id
  GROUP BY a.cupper_id, a.dimension_id, a.is_blind, a.coffee_id
),
base AS (
  SELECT r.cupper_id, r.cupper_name, r.dimension_id, r.is_blind,
         count(*) AS n, avg(r.value_max - r.value_min) AS mean_range_width
  FROM rows_ab r
  GROUP BY r.cupper_id, r.cupper_name, r.dimension_id, r.is_blind
)
SELECT b.cupper_id, b.cupper_name, b.dimension_id, d.name AS dimension_name, b.is_blind,
       b.n, ROUND(b.mean_range_width, 2) AS mean_range_width,
       (SELECT count(*) FROM vs_other o WHERE o.cupper_id = b.cupper_id AND o.dimension_id = b.dimension_id AND o.is_blind IS NOT DISTINCT FROM b.is_blind) AS n_with_other_cupper,
       (SELECT ROUND(avg(o.signed_gap), 2) FROM vs_other o WHERE o.cupper_id = b.cupper_id AND o.dimension_id = b.dimension_id AND o.is_blind IS NOT DISTINCT FROM b.is_blind) AS mean_signed_gap_to_other,
       (SELECT count(*) FILTER (WHERE o.disagrees) FROM vs_other o WHERE o.cupper_id = b.cupper_id AND o.dimension_id = b.dimension_id AND o.is_blind IS NOT DISTINCT FROM b.is_blind) AS n_disagreements,
       (SELECT count(*) FROM vs_roaster v WHERE v.cupper_id = b.cupper_id AND v.dimension_id = b.dimension_id AND v.is_blind IS NOT DISTINCT FROM b.is_blind) AS n_with_roaster,
       (SELECT ROUND(avg(abs(v.cupper_rank - v.roaster_rank)), 2) FROM vs_roaster v WHERE v.cupper_id = b.cupper_id AND v.dimension_id = b.dimension_id AND v.is_blind IS NOT DISTINCT FROM b.is_blind) AS mean_abs_gap_to_roaster_rank,
       (SELECT CASE WHEN count(*) >= param('rank_corr_min_n') THEN ROUND(corr(v.cupper_rank, v.roaster_rank)::numeric, 3) END
          FROM vs_roaster v WHERE v.cupper_id = b.cupper_id AND v.dimension_id = b.dimension_id AND v.is_blind IS NOT DISTINCT FROM b.is_blind) AS rank_corr_to_roaster,
       (SELECT count(*) FROM vs_catalog c WHERE c.cupper_id = b.cupper_id AND c.dimension_id = b.dimension_id AND c.is_blind IS NOT DISTINCT FROM b.is_blind) AS n_control,
       (SELECT ROUND(avg(c.signed_gap), 2) FROM vs_catalog c WHERE c.cupper_id = b.cupper_id AND c.dimension_id = b.dimension_id AND c.is_blind IS NOT DISTINCT FROM b.is_blind) AS mean_signed_gap_to_catalog,
       (SELECT count(*) FROM repeats p WHERE p.cupper_id = b.cupper_id AND p.dimension_id = b.dimension_id AND p.is_blind IS NOT DISTINCT FROM b.is_blind) AS n_repeat,
       (SELECT ROUND(avg(p.mean_gap), 2) FROM repeats p WHERE p.cupper_id = b.cupper_id AND p.dimension_id = b.dimension_id AND p.is_blind IS NOT DISTINCT FROM b.is_blind) AS repeatability
FROM base b
JOIN coffee_dimensions d ON d.id = b.dimension_id;

-- ── A6. v_evidence_coverage: one row per active catalog coffee ───────────────
CREATE VIEW v_evidence_coverage AS
WITH cupping AS (
  SELECT s.coffee_id,
         array_agg(DISTINCT s.cupper_name ORDER BY s.cupper_name) FILTER (WHERE NOT s.is_merged AND s.cupper_id IS NOT NULL) AS cuppers_with_rows,
         count(DISTINCT s.cupper_id) FILTER (WHERE NOT s.is_merged) AS n_cuppers,
         bool_or(s.is_merged) AS has_merged,
         array_agg(DISTINCT s.scale_code ORDER BY s.scale_code) FILTER (WHERE NOT s.is_merged) AS scale_codes
  FROM v_cupping_score s
  GROUP BY s.coffee_id
),
sessions AS (
  SELECT sc.coffee_id, count(DISTINCT sc.session_id) AS n_sessions,
         count(DISTINCT sc.session_id) FILTER (WHERE sc.is_control) AS n_control_sessions
  FROM v_cupping_session_coffee sc
  WHERE sc.has_scores
  GROUP BY sc.coffee_id
),
remarks AS (
  SELECT r.coffee_id,
         bool_or(r.channel <> 'website') AS has_remark_table,
         bool_or(r.channel = 'website') AS has_remark_website,
         count(*) AS n_remarks
  FROM v_roastery_remark r
  WHERE r.is_current AND r.coffee_id IS NOT NULL
  GROUP BY r.coffee_id
),
feedback AS (
  SELECT f.coffee_id, count(*) AS n_customer_feedback
  FROM v_customer_feedback_current f
  WHERE f.coffee_id IS NOT NULL
  GROUP BY f.coffee_id
),
placed AS (
  SELECT DISTINCT s.coffee_id FROM v_coffee_slot s WHERE s.assignment_is_active
),
unreconciled AS (
  SELECT coffee_id FROM v_evidence_dimension WHERE flag <> 'none'
  UNION
  SELECT coffee_id FROM v_evidence_archetype WHERE flag <> 'none'
)
SELECT vc.id AS coffee_id, vc.name AS coffee_name, vc.roaster_id, vc.roaster_name,
       (pl.coffee_id IS NOT NULL) AS is_placed,
       COALESCE(cu.cuppers_with_rows, ARRAY[]::text[]) AS cuppers_with_rows,
       COALESCE(cu.n_cuppers, 0) AS n_cuppers,
       COALESCE(cu.has_merged, false) AS has_merged,
       COALESCE(se.n_sessions, 0) AS n_sessions,
       ea.last_cupped, ea.latest_session_id,
       COALESCE(cu.scale_codes, ARRAY[]::text[]) AS scale_codes,
       COALESCE(se.n_control_sessions, 0) AS n_control_sessions,
       (hint.coffee_id IS NOT NULL) AS has_portal_submitted, hint.version AS portal_version, hint.submitted_at AS portal_submitted_at,
       COALESCE(rm.has_remark_table, false) AS has_remark_table,
       COALESCE(rm.has_remark_website, false) AS has_remark_website,
       COALESCE(rm.n_remarks, 0) AS n_remarks,
       (fb.coffee_id IS NOT NULL) AS has_customer_feedback,
       COALESCE(fb.n_customer_feedback, 0) AS n_customer_feedback,
       ((cu.coffee_id IS NOT NULL)::int + (hint.coffee_id IS NOT NULL)::int + COALESCE(rm.has_remark_table, false)::int
         + COALESCE(rm.has_remark_website, false)::int + (fb.coffee_id IS NOT NULL)::int) AS n_sources,
       vc.match_archetype AS catalog_archetype, vc.match_confidence AS catalog_confidence,
       CASE WHEN vc.match_archetype IS NULL THEN NULL
            ELSE (vc.match_basis IS NOT NULL OR COALESCE(vc.match_notes LIKE 'basis:%', false)) END AS assignment_basis_present,
       ea.evidence_newer_than_decision,
       (ur.coffee_id IS NOT NULL) AS flag_unreconciled
FROM v_coffee vc
LEFT JOIN cupping cu ON cu.coffee_id = vc.id
LEFT JOIN sessions se ON se.coffee_id = vc.id
LEFT JOIN remarks rm ON rm.coffee_id = vc.id
LEFT JOIN feedback fb ON fb.coffee_id = vc.id
LEFT JOIN placed pl ON pl.coffee_id = vc.id
LEFT JOIN v_roastery_portal_coffee_hint hint ON hint.coffee_id = vc.id
LEFT JOIN v_evidence_archetype ea ON ea.coffee_id = vc.id
LEFT JOIN unreconciled ur ON ur.coffee_id = vc.id
WHERE vc.is_active;

-- ── A7. v_evidence_unmapped_words: one row per distinct word × source ───────
CREATE VIEW v_evidence_unmapped_words AS
WITH word_dimensions AS (
  -- the dimensions a printed sheet records as words (rows, not a list)
  SELECT DISTINCT l.dimension_id FROM v_cupping_sheet_line l WHERE NOT l.is_numeric
),
raw AS (
  SELECT regexp_replace(lower(btrim(n->>'roaster_words')), '\s+', ' ', 'g') AS word,
         'roaster_form'::text AS source, h.coffee_id, h.submitted_at::date AS seen_on
  FROM v_roastery_portal_coffee_hint h
  CROSS JOIN LATERAL jsonb_array_elements(h.notes) n
  WHERE n->>'cupping_note_id' IS NULL
  UNION ALL
  SELECT regexp_replace(lower(btrim(r.remark)), '\s+', ' ', 'g'),
         CASE WHEN r.channel = 'website' THEN 'roaster_website' ELSE 'roaster_remark' END,
         r.coffee_id, r.said_on
  FROM v_roastery_remark r
  WHERE r.is_current AND r.topic = 'descriptor' AND r.cupping_note_id IS NULL
  UNION ALL
  SELECT regexp_replace(lower(btrim(w.word)), '\s+', ' ', 'g'), 'cupper_notes', r.coffee_id, r.session_date
  FROM v_cupping_scores_readable r
  JOIN word_dimensions wd ON wd.dimension_id = r.dimension_id
  CROSS JOIN LATERAL regexp_split_to_table(r.notes, ',') AS w(word)
  WHERE NOT r.is_merged AND r.cupper_id IS NOT NULL AND r.notes IS NOT NULL
),
cleaned AS (
  -- a transcriber's parenthesis ("apple (marked x)", "light (~tea)") is not the
  -- cupper's word; edge punctuation off ("spice?" is "spice"); struck words
  -- (~word) are never words
  SELECT regexp_replace(
           btrim(regexp_replace(rw.word, '\([^)]*(\)|$)', ' ', 'g')),
           '^[^[:alnum:]~]+|[^[:alnum:]]+$', '', 'g') AS word,
         rw.source, rw.coffee_id, rw.seen_on
  FROM raw rw
  WHERE rw.word IS NOT NULL
)
SELECT c.word, c.source,
       count(DISTINCT c.coffee_id) AS n_coffees,
       min(c.coffee_id) AS example_coffee_id,
       (SELECT vc.name FROM v_coffee vc WHERE vc.id = min(c.coffee_id)) AS example_coffee_name,
       min(c.seen_on) AS first_seen, max(c.seen_on) AS last_seen
FROM cleaned c
WHERE c.word <> '' AND c.word NOT LIKE '~%'
  AND NOT EXISTS (SELECT 1 FROM evidence_stop_word sw WHERE lower(sw.word) = c.word)
  -- portal notes and cupper words: minus the current mapping of their kind
  -- (a remark's own cupping_note_id is its mapping, filtered in raw)
  AND (c.source NOT IN ('roaster_form', 'cupper_notes')
       OR NOT EXISTS (SELECT 1 FROM v_note_mapping_current mp WHERE mp.normalized_words = c.word
                        AND mp.source_kind = CASE WHEN c.source = 'cupper_notes' THEN 'cupper' ELSE 'roaster' END))
  AND (c.source <> 'cupper_notes'
       OR NOT EXISTS (SELECT 1 FROM v_cupping_note_family f WHERE f.is_active AND lower(f.descriptor) = c.word))
GROUP BY c.word, c.source;

GRANT SELECT ON v_cupping_note_family, v_cupping_sheet_line, v_note_mapping_current, v_dial_position_signal_current,
  v_evidence_dimension, v_evidence_descriptor, v_evidence_archetype_call, v_evidence_archetype,
  v_evidence_roastery_calibration, v_evidence_cupper_calibration, v_evidence_coverage, v_evidence_unmapped_words
  TO reporting_ro;
```

### A0: the three existing views with their appended columns

```sql
CREATE OR REPLACE VIEW v_coffee AS
SELECT
  c.id, c.name, c.origin, c.blend_or_single, c.process, c.roast_level, c.roast_shade,
  c.flavor_descriptors_roaster, c.ai_summary, c.surprise_note, c.three_voice_story,
  c.story, c.story_draft, c.story_published, c.story_admin_edited, c.story_generated_at,
  c.roaster_id,
  r.name                          AS roaster_name,
  aa.archetype                    AS match_archetype,
  aa.confidence                   AS match_confidence,
  aa.source                       AS match_source,
  aa.assigned_from_session_id     AS match_session_id,
  COALESCE(cat.category_codes, ARRAY[]::TEXT[]) AS category_codes,
  c.story_published               AS has_story,
  c.is_active, c.deactivated_at, c.deactivation_reason,
  aa.notes                        AS match_notes,
  aa.basis                        AS match_basis
FROM coffees c
LEFT JOIN roaster r              ON r.id = c.roaster_id
LEFT JOIN coffee_archetype_assignment aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
LEFT JOIN (
  SELECT cca.coffee_id, ARRAY_AGG(cc.code ORDER BY cc.code) AS category_codes
  FROM coffee_category_assignment cca
  JOIN coffee_category cc ON cc.id = cca.category_id
  GROUP BY cca.coffee_id
) cat ON cat.coffee_id = c.id;

CREATE OR REPLACE VIEW v_coffee_slot AS
SELECT
  csa.id                       AS assignment_id,
  csa.coffee_id,
  vc.name                      AS coffee_name,
  vc.roaster_id,
  csa.slot_id,
  cds.archetype                AS placement_archetype,
  cds.sort_order,
  cds.name                     AS slot_name,
  cds.position_label,
  csa.role,
  csa.priority,
  csa.is_active                AS assignment_is_active,
  vc.is_active                 AS coffee_is_active,
  csa.certified_at,
  csa.placement_note,
  vc.match_archetype,
  (cds.archetype = vc.match_archetype) AS placement_matches_match,
  csa.placed_from_session_id,
  csa.basis                    AS placement_basis,
  cds.dimension_id             AS slot_dimension_id,
  cds.spec_band_lo,
  cds.spec_band_hi
FROM coffee_slot_assignment csa
JOIN coffee_dial_slot cds ON cds.id = csa.slot_id
JOIN v_coffee         vc  ON vc.id  = csa.coffee_id;

CREATE OR REPLACE VIEW v_roastery_portal_coffee_hint AS
WITH latest AS (
  SELECT DISTINCT ON (pc.coffee_id)
         pc.coffee_id, pc.id AS portal_coffee_id, pc.roaster_id, r.id AS response_id, r.version,
         r.submitted_at, r.submitted_by_respondent_id, r.proposed_archetype, r.dominant_dimension_id
  FROM roastery_portal_coffee pc
  JOIN roastery_portal_response r ON r.portal_coffee_id = pc.id AND r.status = 'submitted'
  WHERE pc.coffee_id IS NOT NULL
  ORDER BY pc.coffee_id, r.submitted_at DESC, r.version DESC
)
SELECT
  l.coffee_id,
  l.portal_coffee_id,
  l.response_id,
  l.version,
  l.submitted_at,
  resp.name AS respondent_name,
  l.proposed_archetype,
  l.dominant_dimension_id,
  pd.label AS dominant_dimension_label,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'dimension_id', rd.dimension_id, 'label', d.label, 'low_label', d.low_label,
             'high_label', d.high_label, 'value', rd.value) ORDER BY d.sort_order)
    FROM roastery_portal_response_dimension rd
    JOIN roastery_portal_dimension d ON d.dimension_id = rd.dimension_id
    WHERE rd.response_id = l.response_id
  ), '[]'::jsonb) AS dimensions,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'rank', n.rank, 'roaster_words', n.roaster_words, 'cupping_note_id', n.cupping_note_id) ORDER BY n.rank)
    FROM roastery_portal_response_note n
    WHERE n.response_id = l.response_id
  ), '[]'::jsonb) AS notes
FROM latest l
LEFT JOIN roastery_portal_respondent resp ON resp.id = l.submitted_by_respondent_id
LEFT JOIN roastery_portal_dimension pd ON pd.dimension_id = l.dominant_dimension_id;
```


## Parts B and C (after Dana's go, 2026-10-18)

**What was built.**
- `services/evidenceReads.ts`: `getCoffeeEvidence`, `getRoasteryEvidence`, `getEvidenceSummary`, `getUnmappedWords`, `getFamilies`. The only TypeScript reader of the `v_evidence_*` views; `lint:cupping` rule 4 enforces it (proven with a probe file, deleted).
- `services/evidenceIntegrity.ts`: eight report-only checks, each `{ id, name, ok, count, sample }`, logged at boot (`[evidence-integrity]`) and shown on System Health. It reads through views; the one check that needs superseded rows (no view shows them) calls the new `cuppingReads.getSupersededWithoutTarget`, so `lint:cupping` stays as it was. Two `evidence_parameter` rows seeded: `estimated_date_review_days` 90, `website_recapture_days` 180.
- **B0, the D6 change:** `catalogService.evaluatePlacement`'s `descriptor_off_family` takes the top three of `evidenceReads.getFamilies(coffeeId)` (families named by our cuppers or the roaster, most sources first) instead of counting wheel-view rows. Same warning shape, still a flag. Accepted catalog descriptors alone no longer drive it (that is what `named_by_ab OR named_by_roaster` means); the old test built its case from accepted descriptors, so it now uses a persistent, normally inactive Zzz fixture whose roaster website names three Nutty / Cocoa notes, plus a test that pins the accepted-only case.
- `routes/evidenceAdmin.ts` (`requireAdmin`, GET only): `/api/admin/evidence/coffee/:coffeeId`, `/roastery/:roasterId`, `/summary`, `/unmapped-words`. `GET /api/admin/system-health` gains `cuppingEvidence` (summary + integrity), reported in place on failure.
- Frontend (read-only): Coffees page, an **Evidence** button per coffee opens a panel (Dimensions with one column per cupper built from the rows / Descriptors as hit-miss-extra chips with who named each / Archetype & slot with the basis and band check; "Decide archetype…" and "Decide placement…" open the page's existing Set match / Place dialogs). Roastery Feedback → a roastery → **Calibration** (`?roastery=<id>&view=calibration`): rank agreement, crosstab, descriptor totals, the roastery's coffees with `flag_unreconciled`, the cupper table with a blind toggle, the stale-decision count. System Health → **Cupping evidence** card, linking to Roastery Feedback. Score Entry takes no session parameter, so session links go to Score Entry and show the session id.
- Docs: `WHAT_WE_BUILT.md` #226, `WHAT_WE_BUILT_DB.md` (views and the eight checks), the brief's status line, the folder README; every new view's comment names its readers; `CATALOG.md` regenerated from prod after each deploy (71 views).

**D6 before / after on the four placed Joe Coffee coffees** (top three families vs the slot's families; test DB = prod rows):

| Coffee | Slot (families) | Before: wheel rows | warns | After: evidence | warns |
|---|---|---|---|---|---|
| Benchmark | Classic Balanced (Sweet, Nutty / Cocoa, Fruity) | Nutty / Cocoa, Sweet, Spices | no | Spices, Nutty / Cocoa, Sweet | no |
| Cafè Feminista | Clean Fruit (Fruity, Sour / Fermented) | Fruity | no | Fruity, Nutty / Cocoa, Sweet | no |
| La Familia Guarnizo | Light Floral Edge (Floral, Fruity) | Sweet, Nutty / Cocoa, Floral | no | Nutty / Cocoa, Sweet, Floral | no |
| The Village | Clean Fruit (Fruity, Sour / Fermented) | Sweet, Green / Vegetative | **yes** | Sweet, Floral, Fruity | no |

**Tests.** `routes/evidenceAdmin.test.ts` (9: the four routes, 400s, system-health section, `getFamilies`, the integrity checks), the two D6 tests, `db/evidenceViews.test.ts` (30). Before the B + C commit: six lints, backend and frontend builds green; full suite **772 passed, 6 failed** (the OT-19 six); the test DB's 12 oz prices unchanged by the run. The frontend's project-wide `tsc` reports 13 errors, all in files this brief did not touch (Bloom, Footer, Home, Profile, TheAxis); the Vite build CI runs is clean.

## System Health "Cupping evidence" on prod (revision `axis-bloom-backend-00762-fcx`, 2026-10-18)

| Number | Value |
|---|---|
| Active coffees with evidence from 2+ sources | **22 / 22** |
| With a flag to reconcile | **19** |
| Placed, never cupped | **0** |
| Assignments without a basis line | **1** (Flying Jewel) |
| Unmapped words | **86** |

The 19 each carry at least one real disagreement (cuppers or roaster rank on some dimension, or the archetype), not only `one_source`. The three without a flag: Amsterdam, Big City, Cafè Feminista.

**Evidence integrity on prod:** 6 of 8 pass. **#2** fails 3: the Path seed's three legacy merged rows (samples 1 to 3, coffees 1 to 3) have no cupper rows, by construction of the seed. **#6** fails 1: Flying Jewel (2891), placed, assignment without a basis. Both are the boot log's only `[evidence-integrity]` lines.

## Admin URLs
- Coffees page, Evidence panel: https://www.axisandbloomcoffee.com/admin/coffees (Evidence on any coffee's row)
- Roastery Feedback, Calibration: https://www.axisandbloomcoffee.com/admin/roastery-portal?roastery=f42ad179-9ef4-410a-a92e-464eae1d84ce&view=calibration (Joe Coffee), `…19098f5c-99b9-4d7c-90ef-ee33d1e896b7…` (Joe Bean), `…bbf250d1-e433-4233-a30b-437fe62bcc4a…` (Utopian)
- System Health: https://www.axisandbloomcoffee.com/admin/system-health

## Not done / for later
- The data-driven proposal column (DESIGN §8.5): not built (decision 9). One paragraph: with `v_evidence_coverage.n_sources` at 2+ for all 22 coffees, the obvious first proposal is a slot from the merged range against `spec_band` once the bands are set (today every slot is `no_band`), and a family from `v_evidence_descriptor` hits; both would be one column in `v_evidence_archetype`, never a writer.
- No browser click-through of the three surfaces (API and builds checked; the frontend has no component tests).
- `schema.sql` still cannot build an empty database (its own brief). Brief 4 (the workbench) not started.
