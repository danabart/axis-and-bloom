# Cupping Evidence, brief 3: the reconciliation views and the read-only admin surfaces

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-16 (CTO session; decisions by Dana) · Model: Sonnet for the views and tests; Dana reads the view definitions in the closing report before anything is built on them
> **v3 (2026-10-17):** views are one row per cupper (nothing hard-coded), thresholds come from `evidence_parameter` through `param()`, the stop list from `evidence_stop_word`, calibration reads `v_coffee_dimension_history`, and the D6 family warning moves onto `v_evidence_descriptor`. The v2 text is kept as `SUPERSEDED_…_3_RECONCILIATION_v2.md`.
> Status: NOT EXECUTED · Depends on briefs 1 v3 and 2 v3 being deployed (the views are tested against the loaded rows).
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v2 §7 and §8. Read it first. This brief stores nothing: seven views, their tests, grants, comments, and three read-only admin surfaces. No view writes the catalog. No write path of any kind is added.

## What this is

The evidence is in (brief 2). This brief lines it up: per coffee per dimension, per coffee per descriptor family, per coffee archetype and slot, per roastery calibration, per cupper calibration, coverage, unmapped words. Dana reads these when she decides an assignment through the existing admin pages (DESIGN §8.4). Flags are never gates.

## Decisions already made (Dana). Do not re-open.

1. Views only. No table, no materialized view, no stored flag, no "confidence score" computed by a formula.
2. **Nothing hard-coded.** No cupper name in any view: views that compare cuppers are one row per coffee × dimension × cupper (joined to `cupper`); the UI pivots. Every threshold comes from `param('<key>')` (`cupper_gap`, `roaster_rank_gap`, `spearman_min_n`, `spearman_rho_cut`, `rank_corr_min_n`); the stop list from `evidence_stop_word`.
3. Dimensions: cupper vs cupper on the converted 0 to 15 line (`cupping_to_ab`), disagreement when the gap between ranges exceeds `param('cupper_gap')` (overlap or a gap equal to it agree). Us vs roaster by rank within the roaster's own lineup, never by value; `rank_gap >= param('roaster_rank_gap')` flags. The roaster's rank is a flag, never a catalog value.
4. Descriptors compared at the SCA family level only, where the family is the tier-1 ancestor reached by joining `cupping_note.parent_id` up the tree (a recursive CTE or two self-joins; never a match on `wheel_category` text). Roaster words reach a node through `roastery_portal_note_mapping`; cupper words are stored at the node they named (tier 1, 2 or 3).
5. Calibration views (A4, A5) use `scale_code = 'ab_0_15'` cupper rows only; `legacy`, `word_3`, `grid_0_5` are excluded. Rank correlation uses average ranks for ties (`RANK()` corrected, or `PERCENT_RANK`); `inverted` requires `n >= param('spearman_min_n')`; below that the column is null and `note = 'n too small'`.
6. **Latest session for the catalog, history for calibration.** Per-coffee views read `v_coffee_dimension_range` (latest current merged row); A4 and A5 read `v_coffee_dimension_history`, which also gives repeatability (same cupper, same coffee, two sessions) and the control-coffee comparison.
7. Every view reads evidence through existing views where one fits (`v_coffee_dimension_range`, `v_coffee_dimension_history`, `v_cupping_scores_readable`, `v_roastery_remark`, `v_roastery_portal_current_response`, `v_collaborative_flavor_wheel`, `v_coffee`, `v_coffee_slot`), never a base table except where a needed column exists only there; then the base view gains the column first.
8. The admin surfaces are read-only. The existing assignment and placement dialogs are not changed; the evidence panel links to them.
9. The data-driven proposal column (DESIGN §8.5) is **not** built. If the view work makes it obvious, write one paragraph in the closing report; do not add the column.
10. One catalog-side change is allowed here, because the input moves: `catalogService`'s D6 `descriptor_off_family` warning reads families through `evidenceReads.getFamilies(coffeeId)` (over `v_evidence_descriptor`, `named_by_ab OR named_by_roaster`) instead of counting rows of the wheel view. Still a flag, never a gate.

## Task 0 (report, read-only)

- Row counts after brief 2: sessions, cupper rows by `scale_code`, merged rows by `merge_rule`, remarks by `channel`, submitted portal responses by roastery, note mappings. These are the test fixtures.
- Column lists of the seven base views in decision 5. Any column the §A views need that is missing: list it; add it to the base view in A0 before building.
- How `v_roastery_portal_current_response` exposes the seven 1 to 5 dimension values and the ranked notes (column names), and how `v_collaborative_flavor_wheel` labels its `source` values.
- How `coffee_dial_slot.spec_band_lo/hi` and `spec_descriptor_families` are read by the existing D6 check (function or query name), so 7.3 reuses it rather than re-implementing it.
- Whether `reporting_ro` exists on test and prod and how the existing views grant to it.
- The existing System Health card list and the component that renders a card (to add one card, not a new page).

## PART A: the views (`schema.sql`, DROP VIEW + CREATE VIEW, in dependency order, granted to `reporting_ro`)

### A0. Base view additions (only what Task 0 found missing)
Typical: `v_cupping_scores_readable` needs `coffee_id`, `roaster_id`, `taster_name`, `scale_code`, `is_blind`, `roaster_present`, `session_date`, `score_id` exposed as plain columns; `v_coffee_dimension_range` needs `all_ab_scale`, `n_sessions`, `midpoint` (brief 1 added them; confirm).

### A1. `v_evidence_dimension`: one row per coffee × numeric dimension × cupper
```
coffee_id, coffee_name, roaster_id, roaster_name, dimension_id, dimension_name,
cupper_id, cupper_name,                                -- from cupper; one row per cupper who has a current row for this coffee (latest session per cupper)
cupper_min, cupper_max, cupper_midpoint, cupper_scale_code, cupper_session_id, cupper_session_date,   -- converted through cupping_to_ab
merged_min, merged_max, merged_midpoint, merged_session_id, merged_session_date, n_sessions, all_ab_scale,   -- from v_coffee_dimension_range (latest), repeated on every cupper row
scale_codes,                                           -- text[] of the cupper rows behind the latest merge
cuppers_agree,                                         -- null when one cupper; true when every pair of current cupper ranges overlaps or gaps by <= param('cupper_gap'); same value on every row of the coffee × dimension
roaster_value_1_5,                                     -- current submitted portal response, null when not scored
roaster_rank_in_lineup, ab_rank_in_lineup, lineup_n,   -- average ranks within the roastery's coffees that have both a merged midpoint and a roaster value; null otherwise
rank_gap, roaster_agrees,                              -- |rank diff|; true when rank_gap < param('roaster_rank_gap')
flag,                                                  -- 'none' | 'cuppers_disagree' | 'roaster_disagrees' | 'both' | 'one_source'
is_blind, roaster_present, is_control                  -- of the session the merged row came from
```
A roastery with fewer than two coffees scored on both sides gives null ranks. No column is named after a person.

### A2. `v_evidence_descriptor`: one row per coffee × SCA family
```
coffee_id, coffee_name, roaster_id, family,
named_by_dana, named_by_camila,                        -- any current cupper row of that cupper has a leaf in the family
named_by_roaster_form,                                 -- current submitted response note mapped (cupping_note_id or mapping table) to the family
named_by_roaster_remark,                               -- v_roastery_remark, channel <> 'website', is_current, topic = 'descriptor', leaf in family
named_by_roaster_website,                              -- same, channel = 'website', **latest capture only**: the rows whose said_on is the max said_on for that roaster × coffee × 'website' (a later capture of the page replaces, in this view, what an earlier one said; every capture stays in v_roastery_remark and in the history)
named_by_customer,                                     -- v_collaborative_flavor_wheel source = client, or customer_feedback_descriptor
accepted_in_catalog,                                   -- roastery_coffee_descriptors active row in the family
named_by_ab, named_by_roaster,                         -- OR of the respective columns
hit, miss, extra                                       -- ab AND roaster; roaster AND NOT ab; ab AND NOT roaster
```
Families are the tier-1 ancestors via `parent_id` of active nodes; `family` carries that row's `descriptor`. Unmapped roaster words do not appear here (they appear in A7).

### A3. `v_evidence_archetype`: one row per coffee, plus `v_evidence_archetype_call`: one row per coffee × cupper
`v_evidence_archetype_call`:
```
coffee_id, cupper_id, cupper_name, session_id, session_date, is_blind,
archetype_call, archetype_call_secondary, position_call, slot_call_id, call_note    -- the cupper's latest current row for the coffee
```
`v_evidence_archetype`:
```
coffee_id, coffee_name, roaster_id, roaster_name,
cupper_calls,                                          -- jsonb {"Dana":"earthy","Camila":null} aggregated from v_evidence_archetype_call (display only; the per-row view is the data)
n_cuppers_called, cupper_calls_agree,                  -- null when fewer than two calls; true when all non-null calls are equal
merged_call, merged_call_note,                         -- from the latest current merged row
roaster_form_proposal,                                 -- proposed_archetype of the current submitted response
roaster_remark_proposals,                              -- text[] distinct proposed_archetype from current classification remarks (table + website)
catalog_archetype, catalog_confidence, catalog_source, assigned_from_session_id, basis, basis_json,   -- from v_coffee / coffee_archetype_assignment current row
catalog_home_slot_id, catalog_home_slot_name, placement_note, placed_from_session_id,                -- from v_coffee_slot (home, active)
latest_session_id, latest_session_date,
evidence_newer_than_decision,                          -- latest_session_date > the session date of assigned_from_session_id or placed_from_session_id (null when neither is set)
slot_spec_check,                                       -- 'in_band' | 'out_of_band' | 'no_band' | 'no_merged_range', reusing the D6 logic on the latest merged range; reads coffee_dial_slot.spec_band only ('no_band' everywhere until the bands are set; the dial signal meanwhile rests on archetype_vector, see brief 1 decision 8)
dial_signal_basis,                                     -- notes of the current cupping dial_position_signal ('spec_band' | 'archetype_vector …' | null)
roaster_agrees_with_catalog,                           -- null when no proposal; any proposal = catalog_archetype
flag,                                                  -- 'none' | 'cuppers_disagree' | 'roaster_disagrees' | 'both' | 'no_basis' (catalog assignment with null basis_json and empty notes) | 'out_of_band' | 'stale_decision' (evidence_newer_than_decision)
is_blind, roaster_present, last_cupped
```

### A4. `v_evidence_roastery_calibration`: one row per roastery × numeric dimension
```
roaster_id, roaster_name, dimension_id, dimension_name,
n,                                                     -- coffees with an ab_0_15 latest merged midpoint and a roaster value
rank_corr,                                             -- average-rank correlation; null when n < param('rank_corr_min_n')
mean_rank_gap,
inverted,                                              -- rank_corr < param('spearman_rho_cut') AND n >= param('spearman_min_n'); null otherwise
note,                                                  -- 'n too small' when n < param('spearman_min_n'); null otherwise
n_blind, n_roaster_present,
archetype_crosstab,                                    -- jsonb {"earthy": {"chocolate_nutty": 2}, ...}: our merged_call × their form proposal, per roastery (same value on every dimension row)
descriptor_hit, descriptor_miss, descriptor_extra      -- counts from A2 over the roastery's coffees (same value on every dimension row)
```
Ranks: `RANK()` with the average-tie correction (`(RANK() + COUNT(*) OVER (PARTITION BY … , value) - 1) / 2.0`), or `PERCENT_RANK()`; not `DENSE_RANK`. Pearson over the ranks with `corr()`. No extension needed.

### A5. `v_evidence_cupper_calibration`: one row per cupper × numeric dimension × blind flag
```
cupper_id, cupper_name, dimension_id, dimension_name, is_blind,
n,                                                     -- ab_0_15 cupper rows of this cupper with a value on this dimension (all sessions, from v_coffee_dimension_history joined to the cupper rows)
mean_range_width,
n_with_other_cupper, mean_signed_gap_to_other,         -- this cupper's midpoint minus the mean of the other cuppers' midpoints on the same session coffee
n_disagreements,                                       -- gap > param('cupper_gap')
n_with_roaster, mean_signed_gap_to_roaster_rank,       -- this cupper's rank within the lineup minus the roaster's rank, where both exist
n_control, mean_signed_gap_to_catalog,                 -- on session coffees with is_control: this cupper's midpoint minus the catalog's latest merged midpoint for that coffee as it stood before the control session
n_repeat, repeatability                                -- coffees this cupper scored in two or more sessions; mean absolute gap between her midpoints across sessions
```

### A6. `v_evidence_coverage`: one row per active catalog coffee
```
coffee_id, coffee_name, roaster_id, roaster_name, is_placed,
cuppers_with_rows,                                     -- text[] of cupper names with a current row (display); n_cuppers
has_merged, n_sessions, last_cupped, latest_session_id, scale_codes, n_control_sessions,
has_portal_submitted, portal_version, portal_submitted_at,
has_remark_table, has_remark_website, n_remarks,
has_customer_feedback, n_customer_feedback,
n_sources,                                             -- count of true among: any cupping, portal submitted, remark table, remark website, customer feedback (0 to 5)
catalog_archetype, catalog_confidence, assignment_basis_present,   -- basis_json IS NOT NULL, or notes starts with 'basis:' for rows written before brief 4
evidence_newer_than_decision,
flag_unreconciled                                      -- any flag <> 'none' in A1 (any dimension, any cupper) or A3 for this coffee
```

### A7. `v_evidence_unmapped_words`: one row per distinct word with no SCA node
```
word,                                                  -- lower-cased, trimmed, struck words (~ prefix) excluded
source,                                                -- 'roaster_form' | 'roaster_remark' | 'roaster_website' | 'cupper_notes'
n_coffees, example_coffee_id, example_coffee_name, first_seen, last_seen
```
Sources: portal notes with `cupping_note_id IS NULL` and no current mapping for `normalized_words` (`source_kind = 'roaster'`); current descriptor remarks with `cupping_note_id IS NULL`; cupper `notes` on dimensions 1, 2, 3, 11, 12 split on commas, minus words that match an active `cupping_note.descriptor` at any tier or a current mapping (`source_kind = 'cupper'`), minus `evidence_stop_word`. No list in the view definition.

### A8. Tests (`db/evidenceViews.test.ts`, against the brief 2 rows on the test DB)
- A1: Joe Bean Geometric Acidity → `cuppers_disagree` (Dana 4–7, Camila 1); Tiger Stripe Acidity → agree (Dana 4–6, Camila 3); Utopian Volo rows carry `scale_codes` containing `word_3` and converted `cupper_min/max` 0–5 for Camila's `low`; Joe Coffee has one row per coffee × dimension (Dana only) with `cuppers_agree` null; rank columns null where the roaster did not score that dimension or fewer than two of its coffees have both sides; no column name contains a cupper's name.
- A2: Joe Coffee Benchmark: families Sweet (Caramelized), Nutty / Cocoa (Cocoa, Nutty) and Spices (Brown Spice) present from Dana; Feminista: Fruity from the tier-2 node Berry; `named_by_roaster_form` follows the current submitted response; Utopian Union: `extra` on every A&B family (zero overlap, website only); Joe Bean Tiger Stripe: Fruity family is a `miss` (website names Fig, Apple, Pear, Cherry; no cupper named a fruit) unless the portal form or a cupper did; `named_by_roaster_website` is non-null for coffees of all three roasteries.
- A3: Blossom: `v_evidence_archetype_call` has Dana = earthy and Camila = null, `cupper_calls` reflects both, catalog earthy low, `flag` depends on the form proposal (chocolate_nutty → `roaster_disagrees`); Union: both calls null, `merged_call` null, catalog balanced_sweet low; La Familia: Dana = balanced_sweet, catalog floral, `basis` present; every brief 2 coffee has `basis` not null (`no_basis` = 0 among them); `evidence_newer_than_decision` false for all of them; the Path seed coffees may show `no_basis` (report the count).
- A4: Joe Bean n < `param('spearman_min_n')` on every dimension → `inverted` null, `note = 'n too small'`; `rank_corr` computed where n ≥ `param('rank_corr_min_n')`; superseding `spearman_min_n` to 3 in `evidence_parameter` inside a rolled-back transaction changes the output with no view change; `archetype_crosstab` for Joe Coffee shows the Natalie/staff proposals against Dana's merged calls.
- A5: rows for cupper Dana exist for `is_blind` true (Joe Bean) and false (Joe Coffee, Utopian C); `word_3` / `grid_0_5` rows do not count toward `n`; `n_control` = 0 and `repeatability` null everywhere (no control and no repeat yet); Flying Jewel counts as a repeat only if Task 0 of brief 2 found an earlier session for it.
- A6: every brief 2 coffee has `n_sources ≥ 2` except where expected (list them); coffee 2891 shows its cupping and website remark; the four placed Joe Coffee coffees are `is_placed`.
- A7: contains `white floral`, `orange blossom`, `mango puree`, `ube halo halo`, `happy`, `bbq chips`; does not contain `honeycomb` (mapped), `berries` (mapped to Berry, `source_kind = 'cupper'`) or `sweet` (stop word); adding `happy` to `evidence_stop_word` inside a rolled-back transaction removes it.
- Every view: `SELECT` succeeds as `reporting_ro`; no view reads a `cupping_*`, `roastery_portal_*`, `roastery_remark` or `customer_feedback_*` base table; no view definition contains a cupper's name, a numeric threshold literal (grep for `'Dana'`, `'Camila'`, `>= 5`, `> 2`, `-0.5`) or a join on `wheel_category` / `wheel_subcategory` text (families come from `parent_id`); every count test filters to the three roasteries by id.

## PART B: read-only admin surfaces (`cuppingReads` / `roasteryPortalReads` / a new `evidenceReads.ts` over the A views; routes behind `requireAdmin`)

### B1. Evidence panel on the Coffees page (per coffee, collapsed by default)
Three tabs reading A1, A2, A3 for that coffee: Dimensions (a row per dimension, one column per cupper built from the rows, merged range, roaster 1 to 5 and rank, flag), Descriptors (families as chips: hit / miss / extra, who named it), Archetype & slot (every call and proposal, the catalog's answer, its basis line, the band check). A "Decide" link opens the existing assignment dialog; nothing in the panel writes. Session rows link to Score Entry.

### B2. Calibration tab under Roastery Feedback (per roastery)
A4 as a table (dimension, n, rho, mean rank gap, inverted, note), the archetype crosstab as a small grid, descriptor hit / miss / extra totals, and the list of that roastery's coffees from A6 with `flag_unreconciled`. A second table from A5 (per cupper, including controls and repeatability) with a blind / not-blind toggle. A "stale decisions" count from A3 (`evidence_newer_than_decision`). All read-only.

### B3. System Health card "Cupping evidence"
From A6: coffees with evidence from 2+ sources / total active; coffees with `flag_unreconciled`; placed coffees with no cupping; assignments without a basis line; from A7: unmapped words count; from B00: the failing integrity checks by name. Clicking opens Roastery Feedback → Calibration. Report-only, like every other card.

### B00. `services/evidenceIntegrity.ts` (report-only, the fourth piece of the blueprint pattern)
Same shape as `catalogIntegrity.ts`: a list of named checks, each returning `{ ok, count, sample }`, run at boot (report, never block) and on demand from the System Health card. Checks: every `cupping_*` table and `roastery_remark` has a `Writer:` in `comments.sql` naming its service; no current merged row whose session coffee has no current cupper row; no superseded `cupping_scores` row without a live `superseded_by_id` target; no `cupping_score_descriptors` row whose node is inactive; no mapping row (`roastery_portal_note_mapping`) pointing at an inactive node; no coffee with a home placement and `basis IS NULL AND notes NOT LIKE 'basis:%'`; no `cupping_sessions` row with `session_date_precision = 'estimated'` older than `param('estimated_date_review_days')` (seed 90) without a note; no website remark set for a roaster × coffee older than `param('website_recapture_days')` (seed 180). Two new `evidence_parameter` rows, seeded here. `WHAT_WE_BUILT_DB.md` lists the checks.

### B0. `catalogService` D6 family warning
`descriptor_off_family` reads `evidenceReads.getFamilies(coffeeId)` (families with `named_by_ab OR named_by_roaster` from A2, ordered by how many sources named them) instead of its own `COUNT(*)` over the wheel view. Same warning shape; report before/after for the four placed Joe Coffee coffees on the test DB.

### B4. Routes
`GET /api/admin/evidence/coffee/:coffeeId` (A1 + A2 + A3 + A3's call rows for one coffee), `GET /api/admin/evidence/roastery/:roasterId` (A4 + A5 + A6 filtered), `GET /api/admin/evidence/summary` (B3 numbers), `GET /api/admin/evidence/unmapped-words` (A7). `evidenceReads.ts` is the only TS reader of the `v_evidence_*` views (add that rule to `lint-cupping.mjs`: `FROM v_evidence_` only in `evidenceReads.ts`, `schema.sql`, tests).

## PART C: comments, catalog, docs
`comments.sql`: a table-style comment per view (Purpose | Class: view | Writer: none (derived) | Readers: evidenceReads.<fn>, admin <page> | Since: 2026-10), view columns are not commented (house rule). `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md`. `WHAT_WE_BUILT_DB.md` Cupping evidence section: a dated paragraph listing the seven views and what each answers. `WHAT_WE_BUILT.md`: one entry. This brief's status line.

## CONSTRAINTS
- No table, no materialized view, no trigger, no write path, no change to any assignment, placement, portal row, mapping or cupping row. The only `catalogService` change is B0.
- Views are created on the test DB first; the closing report pastes the seven `CREATE VIEW` definitions **before** Part B is built, and stops there for Dana to read them. Part B starts only after she says go (the session that runs this brief may be a new one; the definitions in `schema.sql` are the handoff).
- `npm run build` clean; all lints green (`lint:cupping` with the new `v_evidence_` rule); tests green; schema applies twice.
- Commits: Part A (views, tests, comments, `CATALOG.md`); Part B + C after Dana's go. Straight to main.

## DONE =
Seven `v_evidence_*` views exist, commented, granted to `reporting_ro`, tested against the brief 2 rows, reading only through views; the Coffees page evidence panel, the Roastery Feedback Calibration tab and the System Health card read them through `evidenceReads.ts`; nothing writes; `CATALOG.md` regenerated.

Closing report (Part A): the seven view definitions; the test results with the specific expectations above; the `no_basis` count and which coffees; the Joe Bean and Joe Coffee rank tables as they come out; the unmapped-words list. Then STOP for Dana's read. Closing report (Part B + C): the admin URLs and the System Health numbers on prod.
