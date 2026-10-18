# Cupping evidence, brief 1 (v3): closing report

> Run 2026-10-18. Commits: `e9345da` (Parts A + B + every `comments.sql` line), Part C commit after it (lint, tests, `CATALOG.md`, docs). Deployed revision `axis-bloom-backend-00756-mml`. Record: `WHAT_WE_BUILT.md` #224, `WHAT_WE_BUILT_DB.md` "Cupping evidence", `SOMMELIER_BUILT.md` S111. No evidence row created.

## Task 0 findings (given in full before any file was touched)

- **Code on `cupping_*` base tables: 24 statements** (the brief's 16/11/3/6 were line counts). `routes/admin.ts` 9 DML (as expected) + 8 reads; `routes/coffees.ts` 4; `services/brewCard.ts` 1; `services/dialSuggestion.ts` 2. `cupping_brew_params`: no reference anywhere. Outside lint scope: `backend/check-bars.mjs` and root `check-bars.mjs` (one ad-hoc read each, untouched).
- Score Entry lives in `AdminCupping.tsx` (no `AdminScoreEntry` file); `DELETE /scores/:id` and `DELETE /sessions/:id` had no frontend caller.
- **Views:** `v_cupping_scores_readable` read base tables, no TS reader; `v_coffee_dimension_range` unioned every merged row; `v_collaborative_flavor_wheel` internal branch read every descriptor row (33 cupper + 16 merged on prod). `v_coffee_dial_position_consensus` and `v_archetype_vectors` read no cupping table. **Found beyond the list:** `v_archetype_dimension_comparison` averaged every `cupping_score_values` row off the base tables (feeds public `/archetype-stats`); repointed at `v_coffee_dimension_range`.
- **Rows (test = prod):** 4 sessions, 9 session coffees, 13 scores (Dana 5, Camila 5, `session_1_merged` 3), 108 values, 49 descriptors, 0 brew params. Session 1 = the Path seed. **Coffee 2891 (Flying Jewel):** session 35 / session coffee 42 / score 69, Camila only, no merged row; Sweetness 4, Acidity 4-5, Bitterness 0, Body 3, Finish 5 ("Berries"); descriptors Raspberry, Caramelized.
- **`cupping_note`:** 84 rows, no tier-1 rows at all, 10 rows with NULL subcategory (SCA tier-2 nodes without children). No `tier` / `parent_id`.
- `roastery_portal_note_mapping`: 0 rows; DML in `roasteryPortalService.ts` at 803, 805, 987. `lint-roastery-portal` rule 3 had to admit the new `noteMappingService.ts`.
- `is_numeric` readers: all filter `value_min IS NOT NULL`; the 32 values on dims 1 to 3 are notes only. Nothing breaks, no STOP.
- `TimeZone` UTC on both; `cupping_sessions.created_at` `TIMESTAMPTZ DEFAULT now()`; no house rolled-back-transaction helper (C2 adds `src/test/withRollback.ts`).

## Constraint names changed to RESTRICT

`session_coffees_session_id_fkey`, `session_coffees_coffee_id_fkey`, `brew_params_session_coffee_id_fkey`, `cupping_scores_session_coffee_id_fkey`, `cupping_score_values_cupping_score_id_fkey`, `cupping_score_values_dimension_id_fkey`, `cupping_score_descriptors_cupping_score_id_fkey`, `cupping_score_descriptors_cupping_note_id_fkey`, `coffee_archetype_assignment_coffee_id_fkey`, `dial_position_signal_coffee_id_fkey` (all CASCADE before), `coffee_slot_assignment_coffee_id_fkey` (NO ACTION before). Keyed on table + column, not name (a fresh database names them differently). `cupping_scores_session_coffee_id_taster_name_key` dropped for the two partial unique indexes; `cupping_scores_superseded_by_id_fkey` made DEFERRABLE INITIALLY DEFERRED.

## Legacy counts (date-free tagging)

Test and prod identical: sessions **1** `seed:session_001_path_2026_05_27.sql` / `legacy_wide` + **3** `legacy`; scores **13** `scale_code = legacy`, of which 10 cupper rows got `cupper_id` (Dana 5, Camila 5; none left NULL) and 3 merged rows `merge_rule = legacy`. Legacy seed rows (NULL `cupper_id`) sit outside the cupper index by construction.

## Prod rows for coffee 2891

Unchanged by the brief. Range (unmerged, session 35): Sweetness 4, Acidity 4-5, Bitterness 0, Body 3, Finish 5, `all_ab_scale = false`. **For brief 2:** every value is ≤ 5, which looks like Camila's 0 to 5 grid typed into Score Entry; the row is tagged `legacy` (identity) and reads as 0 to 15. Its 2 descriptors leave the public wheel (cupper row, no merge).

## Tier-2 rows added to `cupping_note`

17: Floral (the tier-2 node), Berry, Citrus Fruit, Dried Fruit, Other Fruit, Raw, Cocoa, Nutty, Chemical, Papery / Musty, Burnt, Cereal, Alcohol / Fermented, Sour, Brown Spice, Pungent, Brown Sugar. Plus 9 tier-1 rows (one per category). Backfill: 10 existing NULL-subcategory rows set to tier 2; every tier-3 row (74) points at its tier-2 parent, every tier-2 row (27) at its tier-1 parent; 0 rows with `tier > 1 AND parent_id IS NULL`; `cupping_note_tier_parent` validated. New nodes are tagged `sca_flavor_wheel`. **Inherited SCA mislabels (reported, not fixed):** the 7 Green / Vegetative leaves sit under Raw (SCA: under the Green/Vegetative sub-group), Anise under Pungent (SCA: Brown Spice), SCA's "Brown, Roast" split into two leaves.

## Readers of `is_numeric` that needed a change

None broke. Score Entry renders dimensions 1 to 3 as numeric (min, max, paper, words); the public dimension endpoints and the brew card now read `cuppingReads` anyway.

## The three behaviour changes, before / after (prod)

| Check | Before | After |
|---|---|---|
| D6 family warning (`v_collaborative_flavor_wheel` top 3 families) | coffee 1: Fruity, Sweet, Nutty/Cocoa (16 rows); 5: Fruity, Nutty/Cocoa, Roasted (15); 6: Roasted, Nutty/Cocoa (13); 2891: Fruity, Sweet (2) | 1: same set (8 rows); 5: same set (3); 6: same set (2); 2891: no rows (no warning possible). No placement's D6 result changes. |
| Feedback-form note list (`orders.ts` DISTINCT note ids) | 1: 10; 5: 10; 6: 5; 2891: 2 | 1: 6; 5: 3; 6: 2; 2891: 0. Intended: customers are offered decision-layer words only. |
| Portal dominant-dimension read (`roasteryPortalReads` 821) | NULL range for every submitted response (none is linked to a catalog coffee) | Same. For a linked coffee it now shows the latest session; column names unchanged. |

Also: `/archetype-stats` Fruity averages unchanged (4.00 / 4.50 / 0.00 / 3.00 / 5.00, 1 coffee). `GET /api/coffees/:id/dimensions` now returns the latest merged range of active coffees only; the Path coffees are inactive, so `/1/dimensions` returns notes and no dimensions. The current cupping dial signal (coffee 1, slot 5) is untouched; nothing re-fires it.

## Deviations from the brief (none touches a closed decision)

1. Tier-1 rows are `(category, NULL, category)`, NULL-subcategory rows are tier 2 (prod had no tier-1 rows; the brief's shape would collide with the tier-2 Floral node).
2. `cupping_sessions.brew_defaults JSONB`: `createSession`'s `brewDefaults` had nowhere to live between calls; brief 2's loader may add coffees in a later run.
3. `cupping_brew_params` DELETE follows the same rule as UPDATE (allowed while unscored), and `ab_app` keeps DELETE on it: with RESTRICT and an always-written brew row, an unconditional raise would make every sample undeletable.
4. `superseded_by_id` FK deferred to commit: the one-current-row indexes forbid inserting the replacement first.
5. Two views added for Score Entry (`v_cupping_score`, `v_cupping_score_descriptor`); `v_archetype_dimension_comparison` moved and repointed.
6. All `comments.sql` lines in the first commit (the comments test fails on any uncommented object); `param()` / `cupping_to_ab()` documented in `--` lines (the parser takes TABLE/VIEW/COLUMN only). `lint-roastery-portal`'s note-mapping rule in the first commit, its `roastery_remark` rule in the second.
7. `recordCuppingSignal` (non-retract) supersedes every current cupping signal of the coffee before inserting, so an archetype change cannot leave the old archetype's signal current.
8. `/sheet-formats` also returns each format's lines; `addCupper` rejects a case-insensitive duplicate.

## Test results

Full suite (`npx vitest run --no-file-parallelism --exclude 'dist/**'`): **731 passed, 6 failed** (the pre-existing OT-19 `quizScoring.test.ts` six, a pure unit file this brief does not touch). 48 new tests in 7 files: `db/cuppingToAb`, `db/cuppingNoteTree`, `db/cuppingImmutability` (rolled back), `services/cupping`, `services/dialSuggestion` (new file; none existed), `services/noteMapping` (rolled back), `services/roasteryRemark`. Fixed for the new constraints: `catalogService.test.ts` (D6 band fixture now a persistent inactive Zzz coffee cupped through the service), `liamProfile.test.ts`, `palateReads.test.ts` (fixture rows shaped for the CHECKs). Lints: `lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:lineage`, `lint:cupping` all clean; every new rule proven with a probe file, probes deleted. `npm run build` clean in backend and frontend. Score Entry smoke over HTTP on the test DB: 21 / 21 (create session with blind / sheet format / brew defaults, add a control sample with a blind code, two cuppers on two scales, merge by rule with the disagreement listed and no dial signal, converted values, re-save supersedes and re-merges, DELETE score 405, scored sample and non-empty session 409, brew params locked 409, header PATCH, remarks list, stats). Test fixtures left on the test DB under `Zzz Cupping Test Roastery` / `Zzz D6 Band Fixture Roastery` (both inactive) and cuppers `Zzz Cupper A/B`; the Zzz Test admin (`zzz-test-admin-ce1-…@example.test`, profile in the test DB only) is demoted and disabled.

## Not done

Browser click-through of Score Entry (API checked end to end only). The three seed mislabels. `db/seeds/session_001_path_2026_05_27.sql` would now fail the row-shape CHECK if re-run (its merged rows have no `merge_rule`). `setMatchArchetypeInTx` called from the importer or portal accept does not refresh the signal (only `setMatchArchetype` does, per B6).
