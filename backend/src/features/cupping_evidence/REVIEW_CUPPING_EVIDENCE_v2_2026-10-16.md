# CTO review of Cupping Evidence v2 (design + briefs 1 to 4), 2026-10-16

Second-opinion review, written from the files only (design, four briefs, `schema.sql`, `dialSuggestion.ts`, `routes/coffees.ts`). Nothing executed. Numbered so the design session can answer item by item.

## Verdict

The three-layer shape (observe, reconcile, decide), DB-level immutability, `scale_code` + `raw_value`, blind / roaster-present as columns, and "flags are never gates" are right and better than most production sensory systems. Three things would undermine it on day one; the rest are design-level fixes and measurement gaps.

## A. Must fix before brief 1 runs

**A1. Evidence already leaks straight to customers through `v_collaborative_flavor_wheel`, and the design does not touch it.**
The `'internal'` branch (`schema.sql` ~2789) reads every `cupping_score_descriptors` row: both cupper rows, the merged row, and (after brief 1) superseded merged rows. Public `GET /api/coffees/:id/flavor-wheel` does `COUNT(*) AS mentions` on it; `sommelierRag.ts`, `beatEngine.ts`, `routes/orders.ts`, `catalogService.ts:204` read it too. After brief 2, Feminista shows "Blueberry" twice (Dana row + merged row) although Dana wrote "berries". The wall between evidence and catalog has a pre-existing hole, and brief 3 decision 5 lists this view as a base to read from without noting it.
Fix (brief 1 A8): internal branch = `cs.is_merged AND cs.superseded_at IS NULL` only. Then decide whether our cupping descriptors should reach customers at all: §8.1 says descriptors are the roaster's facet and ours flag; the wheel view currently contradicts that.

**A2. Convention mapping fabricates leaves.**
berries → Blueberry, nuts → Hazelnut, spice → Cinnamon, citrus → Orange, tea → Black Tea, dried fruits → Raisin. Harmless at family level (brief 3), but every leaf-level reader (A1 above, `v_coffee_descriptor`, the sommelier) presents a specific flavor the cupper never named.
Options: (a) add tier-2 nodes to `cupping_note` (Berry, Nutty, Citrus Fruit, Brown Spice, Tea; the SCA wheel has them) and map generic words there; (b) a `mapping_kind` column on `cupping_score_descriptors` (`exact` / `convention`) and public readers take `exact` only. (a) is honest at every layer; brief 2's "never create a leaf" becomes "create tier-2 nodes, never invent a leaf".

**A3. The dial signal is silently lost by brief 2's ordering.**
`recordCuppingSignal` returns early when the coffee has no archetype (`dialSuggestion.ts:236-237`). Brief 2 wants sessions before the manifest (basis line needs `s<id>`), but `mergeByRule` fires the signal during the session load, before the coffee has an archetype. `mergeByRule` is the only caller, so it never fires again. Latent bug independent of this brief: an archetype change after cupping leaves a signal computed for the old archetype's dominant dimension.
Fix: `cuppingService.refreshDialSignal(coffeeId)` (the lint allows it), called by the brief 2 loader after the manifest and by `setMatchArchetype` on archetype change. Loader order: sessions → merges → manifest → refresh.

## B. Design-level fixes

**B1. Converted values are stored as evidence.** §2 says evidence is "on their own scale"; §6.2 stores `v×3` width 3 into `value_min/max`. The conversion is a reconciliation rule and will change (open point 13.1). Rows are immutable, so changing it means re-transcribing every grid / word row. Store native values (`grid 0-5: 4` → min = max = 4; `scale_code` says what it means) and convert in the readable view / range view through one SQL function. Nothing consumes converted values today: the dial signal is already suppressed for them.

**B2. Multi-session union only widens.** `v_coffee_dimension_range` takes MIN / MAX across all current merged rows across all sessions. Fix 0.4 handled re-merges, not re-cuppings: cup a coffee three times and the catalog range is the envelope of all three, forever. The calibration loop is designed to converge; the data structure can only diverge. It also destroys the intra-rater signal (same cupper, same coffee, two sessions), the cheapest calibration available. Options: latest session only (consistent with `v_evidence_dimension` "latest current cupper row"), or placement pins a session the way archetype does (`assigned_from_session_id`). Related: brief 1 B3 moves `getAvgCuppingScore` (mean of midpoints) onto the range view (midpoint of union); same for one session, different for two. Say so in the brief, and the dial reader must honour `all_ab_scale`.

**B3. Cupper rows can never be superseded, so a transcription error lives forever in the calibration views.** §6.4 supersedes the merged row, but the wrong cupper row stays current and `v_evidence_cupper_calibration` counts every current `ab_0_15` cupper row. Immutability means values never change; superseding does not change values. Allow the same single transition on cupper rows with `supersede_reason`. Also §6.4's "new session coffee row in the same session" gives two rows for one coffee with the same `session_date`; "latest per cupper" then picks arbitrarily.

**B4. Views hard-coded to two people.** `dana_min / camila_min`, and `taster_name = 'merged'` as a sentinel in a name column. A guest cupper, a Q-grader for calibration, or a third partner breaks every `v_evidence_*` shape. Keep one row per coffee × dimension × cupper in the views; pivot in the UI. `is_merged` already exists; the partial unique index can key on it instead of the sentinel.

**B5. Null session dates.** Flights B and C load with `session_date` null. Postgres `ORDER BY … DESC` puts NULLs first, so "latest session" picks them by accident; `last_cupped` is wrong; the basis line says `s<id>` with no date. Flight C is bounded (on or before 2026-09-27). Make `session_date` NOT NULL, store the best estimate, add `session_date_precision` (`exact` / `estimated`) or a `date_note`.

**B6. Legacy tagging by deploy date.** `WHERE created_at < '<deploy day>'` is fragile (same-day rows, re-runs on a restored DB). Idiomatic and date-free: `ADD COLUMN scale_code TEXT NOT NULL DEFAULT 'legacy'`, then `ALTER COLUMN scale_code SET DEFAULT 'ab_0_15'`. Every pre-existing row gets `legacy`; every new row gets `ab_0_15`.

**B7. The guard trigger lists columns.** `cupping_scores_guard` compares column by column; the next `ADD COLUMN` silently falls outside the guard. Use `to_jsonb(OLD) - 'superseded_at' - 'superseded_by_id' - 'supersede_reason' = to_jsonb(NEW) - …`.

**B8. `said_on` from file mtime.** The intake xlsx is not git-tracked; mtime is 2026-10-06 today and changes on copy. Write the literal date into brief 2.

**B9. The decision layer still cascades.** `coffee_archetype_assignment.coffee_id` and `dial_position_signal.coffee_id` are `ON DELETE CASCADE`. RESTRICT on evidence now protects any cupped coffee, but an uncupped coffee's assignments vanish with the row. Same `DO` block, two more constraints.

**B10. Basis as a string.** `assignment_basis_present = notes LIKE 'basis:%'` is the integrity check of the whole decision layer. `composeBasis` is deterministic, so emitting a `basis jsonb` beside the string is nearly free in brief 4 and expensive to retrofit. Deferred knowingly in §8.3; worth pulling forward. Dana's call.

**B11. Tests vs immutability.** Immutability tests must insert rows they can never delete; on a shared test DB brief 3's count-based expectations will drift. Run them inside a transaction that rolls back, or in a `Zzz Test` roastery the views exclude by convention.

**B12. Spearman on dense ranks.** `corr()` over `DENSE_RANK()` is not Spearman under ties (needs average ranks). At n ≈ 5 it is noise either way; use `RANK()` with the tie correction or label the column `rank_corr`.

## C. What is missing (measurement, not schema)

**C1. No absolute anchor.** Every calibration view measures agreement: Dana vs Camila, us vs the roaster's rank. Two untrained cuppers agreeing is not accuracy, and the roaster's rank is relative to a lineup only partly cupped. Cheapest fix: a control coffee in every session (a catalog coffee already placed), and once, a trained cupper on a subset. Schema: `cupping_session_coffees.is_control`. Views: intra-rater repeatability (same cupper, same coffee, two sessions), which B2 currently destroys.

**C2. Brew parameters not captured.** `cupping_brew_params` exists and is empty; the Joe Bean notes say ratio, temp, steep not recorded. For sensory evidence this is as large a confounder as blindness. The next printed sheet (`ab_0_15_9dim`) is the moment to add a brew box.

**C3. No named home for a correction.** §7.5 promises a per-cupper per-dimension correction "once n is in the twenties"; §8.1 says catalog values come from "our merged range only". Name where the correction lives now (a small versioned offset table applied in a view) so the merged-range-only rule does not become load-bearing. At ~10 coffees a month, n = 20 per dimension per cupper is about six months; C1 gets a usable signal sooner.

**C4. Transcription is a source without provenance columns.** Every brief 2 row came from Claude reading photos, checked by Dana; "transcribed 2026-10-11" lives inside a `record_source` string. `transcribed_by`, `transcribed_at`, `checked_by` as session columns. Transcription happened after the catalog decisions (10-11 to 10-16 vs 10-11 to 10-13), which is its own anchoring risk and worth being visible.

---

# Round 2 (same evening): Dana's answers and the proposed solutions

Dana's decisions: C1 no trained cupper is available (control coffee only). C2 brew protocol is standard, 8.5 g ground coffee / 150 g water; capture it. C4 a blind second transcription of the JPG/PDF sheets is being run by the review session; the diff against brief 2 will be a separate file. B3 yes, cupper rows must be supersedable; more sessions on the same coffees are expected. B4 nothing hard-coded, ever. B5 any September date is acceptable for Utopian flights B and C. A2 clarified below. For the rest, solutions below; each names the brief it lands in.

## A2, clarified
Not about roaster words. Roaster words (Honeycomb, Palo Santo, Campfire 'Mallows) are not SCA wheel terms and the design already handles them correctly: mapping table, unmapped-words view. A2 is about **our own cuppers'** generic words. The SCA wheel has three tiers: Fruity → Berry → Blueberry / Blackberry / Raspberry / Strawberry. "Berries" is the tier-2 node Berry, an official wheel node; `cupping_note` only has tier-3 leaves plus a few tier-1 rows ('Fruity','Fruity','Fruity'; 'Floral','Floral','Floral'; 'Roasted','Roasted','Roast'). Brief 2 maps "berries" to the tier-3 leaf Blueberry, which the cupper did not say.
Solution (brief 1): add `cupping_note.tier SMALLINT NOT NULL DEFAULT 3`, backfill the existing tier-1 rows to 1, and seed the tier-2 nodes as rows (Berry, Citrus Fruit, Dried Fruit, Other Fruit, Brown Sugar, Vanilla, Nutty, Cocoa, Brown Spice, Burnt, Cereal, Tea …) with `tier = 2`. Brief 2 maps berries → Berry, nuts → Nutty, citrus → Citrus Fruit, spice → Brown Spice, dried fruits → Dried Fruit, cocoa / chocolate → Cocoa, tea → Black Tea stays (it is a real leaf). Family-level comparison (brief 3) is unchanged since `wheel_category` is set on every tier. Customer-facing readers show tier-2 words honestly ("Berry") instead of an invented leaf.

## A1 solution (brief 1 A8)
`v_collaborative_flavor_wheel` internal branch: `JOIN cupping_scores cs ON … AND cs.is_merged AND cs.superseded_at IS NULL`. Brief 3 decision 5 gets a sentence: "this view is a decision-layer read of cupping descriptors (current merged rows only), not raw evidence".

## A3 solution (brief 1 B1 + brief 2 order)
`cuppingService.refreshDialSignal(coffeeId)`: recompute from the current merged rows of the coffee, fire `recordCuppingSignal` only when `all_ab_scale` is true, otherwise supersede any current cupping signal for the coffee and write none. Called by `mergeByRule`, by the brief 2 loader after the manifest, and by `catalogService.setMatchArchetype` when the archetype changes (a signal is per archetype). Brief 2 order: sessions → cupper rows → merges → manifest → `refreshDialSignal` for every loaded coffee.

## B1 + B4 solution: scales are data (brief 1)
Table `cupping_scale (code PK, label, scale_min, scale_max, kind CHECK IN ('numeric','ordinal'), to_ab_min_expr / to_ab_max_expr or a conversion table cupping_scale_step (scale_code, raw_label, ab_min, ab_max))`. Seed: `ab_0_15` (identity), `grid_0_5` (steps 0→0-1, 1→2-4, 2→5-7, 3→8-10, 4→11-13, 5→14-15), `word_3` (low→0-5, medium→5-10, high→10-15), `legacy`. `cupping_scores.scale_code` becomes a FK. `cupping_score_values.value_min/max` hold the native value (grid: 4/4; word: null with `raw_value = 'low'`), and a SQL function `cupping_to_ab(scale_code, value_min, value_max, raw_value)` returns the 0 to 15 pair, used by `v_cupping_scores_readable` and `v_coffee_dimension_range`. Changing a conversion = one row in `cupping_scale_step`, no re-transcription.

## B2 + B3 solution: sessions over time (brief 1)
- Cupper rows get the same single supersede transition as merged rows (`supersede_reason` required; `'transcription correction'`, `'re-cupped'`). Partial unique index unchanged (one current row per session coffee × cupper).
- `v_coffee_dimension_range` reads the **latest** current merged row per coffee (by `session_date`, tie-break `created_at`), carries `session_id`, `session_date`, `n_sessions`. New `v_coffee_dimension_history`: one row per coffee × dimension × session (current merged row of each), for the calibration views and intra-rater repeatability.
- `coffee_slot_assignment` gets `placed_from_session_id INT REFERENCES cupping_sessions(id)`, parallel to `assigned_from_session_id` on the archetype, written by the workbench (brief 4). A re-cupping then shows as "catalog placed from s12, latest evidence is s19" in `v_evidence_archetype` (new column `evidence_newer_than_decision`), instead of silently moving the range.

## B4 solution: the hard-coded list and where each goes (brief 1 unless noted)
| Hard-coded today | Data-driven home |
|---|---|
| `taster_name` 'Dana' / 'Camila' / 'merged'; view columns `dana_*`, `camila_*` | `cupper (id, name, is_active, since)`; `cupping_scores.cupper_id` FK (nullable only for the legacy seed row, tagged); `is_merged` already says merged, so no sentinel name. Views: one row per coffee × dimension × cupper; the UI pivots. |
| Scale conversions in the loader | `cupping_scale`, `cupping_scale_step` (above) |
| Word conventions (berries → …) in brief 2 | `roastery_portal_note_mapping` generalised: add `source_kind CHECK IN ('roaster','cupper')` (or a new `note_word_mapping` if the governance check says the portal table should stay portal-only); the loader looks words up, never carries a mapping in code |
| Stop list in `v_evidence_unmapped_words` | `evidence_stop_word (word PK, since, note)` |
| Thresholds: cupper gap 2, rank gap 2, Spearman n ≥ 5, rho < −0.5, n ≥ 3 | `evidence_parameter (key PK, value NUMERIC, since, note)` read by the views through a `param(key)` SQL function; changing a threshold is an INSERT with supersede, visible in the catalog |
| Sheet line → dimension mapping (Mouthfeel light-heavy = 7, Aftertaste short-long = 10, words = 11 / 12) in the loader | `cupping_sheet_line (sheet_format, line_label, dimension_id, is_numeric)`; `sheet_format` becomes a FK to `cupping_sheet_format (code, since, n_dimensions)`. The 9-dim sheet is then one INSERT, not a code change. |
| Brew protocol | `cupping_brew_params` rows (below) |

## B5 solution (brief 2)
Flights B and C: `session_date = '2026-09-20'`, plus brief 1 adds `cupping_sessions.session_date_precision TEXT NOT NULL DEFAULT 'exact' CHECK IN ('exact','estimated')` and `session_date` becomes NOT NULL. Flight C note keeps "on or before 2026-09-27 (Flying Jewel placed from this sheet)".

## B6, B7, B8, B9 solutions (brief 1 / brief 2)
B6: `ADD COLUMN scale_code TEXT NOT NULL DEFAULT 'legacy'` then `ALTER COLUMN scale_code SET DEFAULT 'ab_0_15'`; same trick for `merge_rule`. No dates in `schema.sql`.
B7: `cupping_scores_guard` compares `to_jsonb(OLD) - 'superseded_at' - 'superseded_by_id' - 'supersede_reason'` with the same on NEW.
B8: `said_on = '2026-10-06'` written literally in brief 2 D6.
B9: `coffee_archetype_assignment.coffee_id`, `coffee_slot_assignment.coffee_id` (check), `dial_position_signal.coffee_id`: CASCADE → RESTRICT in the same `DO` block as the cupping FKs.

## B10 solution (brief 4)
`coffee_archetype_assignment.basis JSONB`, `coffee_slot_assignment.basis JSONB`; `composeBasis` returns `{ text, json }`; `setMatchArchetype` / `placeCoffee` accept `basis` and write both. `assignment_basis_present` = `basis IS NOT NULL`. The string stays for humans.

## B11 solution (brief 1 C2)
Immutability tests run inside `withTransaction` with a forced rollback (the house test helper, or `BEGIN … ROLLBACK` around the probe). Brief 3's count tests filter to the three roasteries by id, never "all rows".

## B12 solution (brief 3 A4)
`RANK()` average-tie correction (`(RANK() + RANK() DESC reversed) / 2`, or `PERCENT_RANK`), column named `spearman_rho`; or keep `DENSE_RANK` and name the column `rank_corr`. Either is fine; just not "Spearman" over dense ranks.

## C1 solution (brief 1 + protocol)
`cupping_session_coffees.is_control BOOLEAN NOT NULL DEFAULT false`. Protocol: every session from now includes one already-placed catalog coffee as a control (blind when possible). `v_evidence_cupper_calibration` gains `n_control`, `mean_signed_gap_to_catalog` (this cupper's midpoint on a control vs the catalog range midpoint) and, from `v_coffee_dimension_history`, `repeatability` (mean absolute gap between the same cupper's midpoints on the same coffee across sessions). Controls are evidence like any other row; they are excluded from `v_coffee_dimension_range` only if Dana decides so (default: included).

## C2 solution (brief 1 + brief 2)
Brief 1: `cuppingService.saveBrewParams(sessionCoffeeId, { doseGrams, waterGrams, ratio, waterTemperatureCelsius, steepTimeMinutes, brewDevice, notes })`, the only writer of `cupping_brew_params` (today it has none); `createSession` accepts `brewDefaults` applied to every session coffee added. Score Entry session form: dose and water fields prefilled 8.5 / 150.
Brief 2: every session coffee in all five sessions gets `{ doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl', notes: 'standard A&B cupping protocol (Dana, 2026-10-16); temperature, grind and steep time not recorded on the sheets' }`. Not invented: the dose and water are Dana's stated standard; the unrecorded fields stay null.

## C3 solution (brief 1, shape only)
`cupper_calibration_offset (id, cupper_id, dimension_id, offset NUMERIC, basis TEXT, since, superseded_at)`, empty, commented "no rows until n ≥ param('calibration_min_n')". `v_coffee_dimension_range_calibrated` applies it; nothing reads that view until Dana says so. Names the home so §8.1's "merged range only" is a current rule, not a load-bearing one.

## C4 solution (brief 1)
`cupping_sessions.transcribed_by TEXT, transcribed_at DATE, checked_by TEXT` (null for Score Entry sessions). `record_source` keeps the file names only. Brief 2 fills them (`'Claude (Cowork session), checked by Dana'`, the dates already in the briefs). The blind second transcription diff from the review session is the first entry in `checked_by` worth its name.
