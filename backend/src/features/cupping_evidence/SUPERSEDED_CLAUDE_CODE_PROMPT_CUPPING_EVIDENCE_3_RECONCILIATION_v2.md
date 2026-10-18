# Cupping Evidence, brief 3: the reconciliation views and the read-only admin surfaces

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-16 (CTO session; decisions by Dana) · Model: Sonnet for the views and tests; Dana reads the view definitions in the closing report before anything is built on them
> Status: NOT EXECUTED · Depends on briefs 1 and 2 being deployed (the views are tested against the loaded rows).
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v2 §7 and §8. Read it first. This brief stores nothing: seven views, their tests, grants, comments, and three read-only admin surfaces. No view writes the catalog. No write path of any kind is added.

## What this is

The evidence is in (brief 2). This brief lines it up: per coffee per dimension, per coffee per descriptor family, per coffee archetype and slot, per roastery calibration, per cupper calibration, coverage, unmapped words. Dana reads these when she decides an assignment through the existing admin pages (DESIGN §8.4). Flags are never gates.

## Decisions already made (Dana). Do not re-open.

1. Views only. No table, no materialized view, no stored flag, no "confidence score" computed by a formula.
2. Dimensions: cupper vs cupper on the shared 0 to 15 scale, disagreement when the gap between ranges exceeds 2 (overlap or gap exactly 2 agree). Us vs roaster by rank within the roaster's own lineup, never by value; rank gap ≥ 2 flags. The roaster's rank is a flag, never a catalog value.
3. Descriptors compared at the SCA family level only (`cupping_note.wheel_category`), through `roastery_portal_note_mapping` for roaster words.
4. Calibration views (7.4, 7.5) use `scale_code = 'ab_0_15'` cupper rows only; `legacy`, `word_3`, `grid_0_5` are excluded. Spearman `inverted` requires n ≥ 5; below that the column is null and `note = 'n too small'`.
5. Every view reads evidence through existing views where one fits (`v_coffee_dimension_range`, `v_cupping_scores_readable`, `v_roastery_remark`, `v_roastery_portal_current_response`, `v_collaborative_flavor_wheel`, `v_coffee`, `v_coffee_slot`), never a base table except where a needed column exists only there; then the base view gains the column first (brief 1 rule).
6. The admin surfaces are read-only. The existing assignment and placement dialogs are not changed; the evidence panel links to them.
7. The data-driven proposal column (DESIGN §8.5) is **not** built. If the view work makes it obvious, write one paragraph in the closing report; do not add the column.

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

### A1. `v_evidence_dimension`: one row per coffee × numeric dimension
```
coffee_id, coffee_name, roaster_id, roaster_name, dimension_id, dimension_name,
dana_min, dana_max, camila_min, camila_max,            -- latest current cupper row per cupper for this coffee (most recent session_date); null when she did not score it
merged_min, merged_max, merged_midpoint, n_sessions,   -- from v_coffee_dimension_range (current merged rows)
scale_codes,                                           -- text[] of the cupper rows behind the merge, e.g. {ab_0_15, grid_0_5}
cuppers_agree,                                         -- null when one cupper; true when ranges overlap or gap <= 2
roaster_value_1_5,                                     -- current submitted portal response, null when not scored
roaster_rank_in_lineup, ab_rank_in_lineup, lineup_n,   -- dense ranks within the roastery's coffees that have both a merged midpoint and a roaster value; null otherwise
rank_gap, roaster_agrees,                              -- |rank diff|; true when rank_gap < 2
flag,                                                  -- 'none' | 'cuppers_disagree' | 'roaster_disagrees' | 'both' | 'one_source' (no roaster value and one cupper)
is_blind, roaster_present                              -- of the session the merged row came from
```
Ranks: `DENSE_RANK() OVER (PARTITION BY roaster_id, dimension_id ORDER BY value)` on both sides; ties share a rank. A roastery with fewer than two coffees scored on both sides gives null ranks.

### A2. `v_evidence_descriptor`: one row per coffee × SCA family
```
coffee_id, coffee_name, roaster_id, family,
named_by_dana, named_by_camila,                        -- any current cupper row of that cupper has a leaf in the family
named_by_roaster_form,                                 -- current submitted response note mapped (cupping_note_id or mapping table) to the family
named_by_roaster_remark,                               -- v_roastery_remark, channel <> 'website', is_current, topic = 'descriptor', leaf in family
named_by_roaster_website,                              -- same, channel = 'website'
named_by_customer,                                     -- v_collaborative_flavor_wheel source = client, or customer_feedback_descriptor
accepted_in_catalog,                                   -- roastery_coffee_descriptors active row in the family
named_by_ab, named_by_roaster,                         -- OR of the respective columns
hit, miss, extra                                       -- ab AND roaster; roaster AND NOT ab; ab AND NOT roaster
```
Families come from `cupping_note.wheel_category` of active leaves. Unmapped roaster words do not appear here (they appear in A7).

### A3. `v_evidence_archetype`: one row per coffee
```
coffee_id, coffee_name, roaster_id, roaster_name,
dana_call, camila_call, merged_call,                   -- archetype_call of the latest current rows (per cupper; merged)
dana_position_call, camila_position_call, dana_slot_call_id, camila_slot_call_id,
roaster_form_proposal,                                 -- proposed_archetype of the current submitted response
roaster_remark_proposals,                              -- text[] distinct proposed_archetype from current classification remarks (table + website)
catalog_archetype, catalog_confidence, catalog_source, assigned_from_session_id, basis,   -- from v_coffee / coffee_archetype_assignment current row (notes)
catalog_home_slot_id, catalog_home_slot_name, placement_note,                           -- from v_coffee_slot (home, active)
slot_spec_check,                                       -- 'in_band' | 'out_of_band' | 'no_band' | 'no_merged_range', reusing the D6 logic on the current merged range
cupper_calls_agree,                                    -- null when fewer than two calls; dana_call = camila_call
roaster_agrees_with_catalog,                           -- null when no proposal; any proposal = catalog_archetype
flag,                                                  -- 'none' | 'cuppers_disagree' | 'roaster_disagrees' | 'both' | 'no_basis' (catalog assignment with empty notes) | 'out_of_band'
is_blind, roaster_present, last_cupped
```

### A4. `v_evidence_roastery_calibration`: one row per roastery × numeric dimension
```
roaster_id, roaster_name, dimension_id, dimension_name,
n,                                                     -- coffees with an ab_0_15 merged midpoint and a roaster value
spearman_rho,                                          -- null when n < 3
mean_rank_gap,
inverted,                                              -- rho < -0.5 AND n >= 5; null otherwise
note,                                                  -- 'n too small' when n < 5; null otherwise
n_blind, n_roaster_present,
archetype_crosstab,                                    -- jsonb {"earthy": {"chocolate_nutty": 2}, ...}: our merged_call × their form proposal, per roastery (same value on every dimension row; it is per roastery)
descriptor_hit, descriptor_miss, descriptor_extra      -- counts from A2 over the roastery's coffees (same value on every dimension row)
```
Spearman: rank both sides (dense), compute Pearson on the ranks in SQL (`corr()` over the ranks). No extension needed.

### A5. `v_evidence_cupper_calibration`: one row per cupper × numeric dimension × blind flag
```
taster_name, dimension_id, dimension_name, is_blind,
n,                                                     -- ab_0_15 cupper rows of this cupper with a value on this dimension
mean_range_width,
n_with_other_cupper, mean_signed_gap_to_other,         -- this cupper's midpoint minus the other's, where both scored the same session coffee
n_disagreements,                                       -- gap > 2
n_with_roaster, mean_signed_gap_to_roaster_rank        -- this cupper's rank within the lineup minus the roaster's rank, where both exist
```

### A6. `v_evidence_coverage`: one row per active catalog coffee
```
coffee_id, coffee_name, roaster_id, roaster_name, is_placed,
has_cupping_dana, has_cupping_camila, has_merged, n_sessions, last_cupped, scale_codes,
has_portal_submitted, portal_version, portal_submitted_at,
has_remark_table, has_remark_website, n_remarks,
has_customer_feedback, n_customer_feedback,
n_sources,                                             -- count of true among: any cupping, portal submitted, remark table, remark website, customer feedback (0 to 5)
catalog_archetype, catalog_confidence, assignment_basis_present,   -- notes not null and starts with 'basis:'
flag_unreconciled                                      -- any flag <> 'none' in A1 (any dimension) or A3 for this coffee
```

### A7. `v_evidence_unmapped_words`: one row per distinct word with no wheel leaf
```
word,                                                  -- lower-cased, trimmed
source,                                                -- 'roaster_form' | 'roaster_remark' | 'roaster_website' | 'cupper_notes'
n_coffees, example_coffee_id, example_coffee_name, first_seen, last_seen
```
Sources: portal notes with `cupping_note_id IS NULL` and no current mapping for `normalized_words`; current descriptor remarks with `cupping_note_id IS NULL`; cupper `notes` on dimensions 1, 2, 3, 11, 12 split on commas, minus words that match an active leaf's `descriptor` or a current mapping, minus a small stop list kept in the view (`sweet`, `sweetness`, `fruits`, `fruit`, `fruity`, `light`, `acid`, `acidity`, `bitter`, `bitterness`, `dry`, `creamy`, `juicy`, `silky`, `tea like`, `intensity`). Struck words (`~` prefix) excluded.

### A8. Tests (`db/evidenceViews.test.ts`, against the brief 2 rows on the test DB)
- A1: Joe Bean Geometric Acidity → `cuppers_disagree`; Tiger Stripe Acidity → agree (Dana 2–8, Camila 3); Utopian Volo rows carry `scale_codes` containing `word_3`; Joe Coffee rows have `camila_*` null and `cuppers_agree` null; rank columns null where the roaster did not score that dimension or fewer than two of its coffees have both sides.
- A2: Joe Coffee Benchmark: family Sweet (Caramelized, from Dana) and Nutty / Cocoa present; `named_by_roaster_form` follows the current submitted response; Utopian Union: `extra` on every A&B family (zero overlap, website only).
- A3: Blossom: `dana_call = earthy`, `camila_call` null, catalog earthy low, `flag` depends on the form proposal (chocolate_nutty → `roaster_disagrees`); La Familia: `dana_call = balanced_sweet`, catalog floral, `basis` present; every coffee loaded by brief 2 has `basis` not null (`no_basis` count = 0 among them); the Path seed coffees may show `no_basis` and that is expected (report the count).
- A4: Joe Bean n < 5 on every dimension → `inverted` null, `note = 'n too small'`; `spearman_rho` computed where n ≥ 3; `archetype_crosstab` for Joe Coffee shows the Natalie/staff proposals against Dana's merged calls.
- A5: Dana rows exist for `is_blind` true (Joe Bean) and false (Joe Coffee, Utopian C); `word_3` / `grid_0_5` rows do not count toward `n`.
- A6: every brief 2 coffee has `n_sources ≥ 2` except where expected (list them); coffee 2891 shows its cupping and website remark; the four placed Joe Coffee coffees are `is_placed`.
- A7: contains `white floral`, `orange blossom`, `mango puree`, `ube halo halo`, `happy`, `bbq chips`; does not contain `honeycomb` (mapped) or `berries` (leaf by convention through the descriptor row).
- Every view: `SELECT` succeeds as `reporting_ro`; no view reads a `cupping_*`, `roastery_portal_*`, `roastery_remark` or `customer_feedback_*` base table (grep the definitions; the lints already enforce it for TS, this test enforces it for the views themselves).

## PART B: read-only admin surfaces (`cuppingReads` / `roasteryPortalReads` / a new `evidenceReads.ts` over the A views; routes behind `requireAdmin`)

### B1. Evidence panel on the Coffees page (per coffee, collapsed by default)
Three tabs reading A1, A2, A3 for that coffee: Dimensions (a row per dimension: Dana range, Camila range, merged range, roaster 1 to 5 and rank, flag), Descriptors (families as chips: hit / miss / extra, who named it), Archetype & slot (every call and proposal, the catalog's answer, its basis line, the band check). A "Decide" link opens the existing assignment dialog; nothing in the panel writes. Session rows link to Score Entry.

### B2. Calibration tab under Roastery Feedback (per roastery)
A4 as a table (dimension, n, rho, mean rank gap, inverted, note), the archetype crosstab as a small grid, descriptor hit / miss / extra totals, and the list of that roastery's coffees from A6 with `flag_unreconciled`. A second table from A5 (per cupper) with a blind / not-blind toggle. All read-only.

### B3. System Health card "Cupping evidence"
From A6: coffees with evidence from 2+ sources / total active; coffees with `flag_unreconciled`; placed coffees with no cupping; assignments without a basis line; from A7: unmapped words count. Clicking opens Roastery Feedback → Calibration. Report-only, like every other card.

### B4. Routes
`GET /api/admin/evidence/coffee/:coffeeId` (A1 + A2 + A3 for one coffee), `GET /api/admin/evidence/roastery/:roasterId` (A4 + A5 + A6 filtered), `GET /api/admin/evidence/summary` (B3 numbers), `GET /api/admin/evidence/unmapped-words` (A7). `evidenceReads.ts` is the only TS reader of the `v_evidence_*` views (add that rule to `lint-cupping.mjs`: `FROM v_evidence_` only in `evidenceReads.ts`, `schema.sql`, tests).

## PART C: comments, catalog, docs
`comments.sql`: a table-style comment per view (Purpose | Class: view | Writer: none (derived) | Readers: evidenceReads.<fn>, admin <page> | Since: 2026-10), view columns are not commented (house rule). `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md`. `WHAT_WE_BUILT_DB.md` Cupping evidence section: a dated paragraph listing the seven views and what each answers. `WHAT_WE_BUILT.md`: one entry. This brief's status line.

## CONSTRAINTS
- No table, no materialized view, no trigger, no write path, no change to any assignment, placement, portal row, mapping or cupping row.
- Views are created on the test DB first; the closing report pastes the seven `CREATE VIEW` definitions **before** Part B is built, and stops there for Dana to read them. Part B starts only after she says go (the session that runs this brief may be a new one; the definitions in `schema.sql` are the handoff).
- `npm run build` clean; all lints green (`lint:cupping` with the new `v_evidence_` rule); tests green; schema applies twice.
- Commits: Part A (views, tests, comments, `CATALOG.md`); Part B + C after Dana's go. Straight to main.

## DONE =
Seven `v_evidence_*` views exist, commented, granted to `reporting_ro`, tested against the brief 2 rows, reading only through views; the Coffees page evidence panel, the Roastery Feedback Calibration tab and the System Health card read them through `evidenceReads.ts`; nothing writes; `CATALOG.md` regenerated.

Closing report (Part A): the seven view definitions; the test results with the specific expectations above; the `no_basis` count and which coffees; the Joe Bean and Joe Coffee rank tables as they come out; the unmapped-words list. Then STOP for Dana's read. Closing report (Part B + C): the admin URLs and the System Health numbers on prod.
