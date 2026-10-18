# Cupping Evidence, brief 1 (v3): the foundation. Reference tables, schema, write door, read door, immutability, lint. No data.

> Folder: `backend/src/features/cupping_evidence/` · v3 written 2026-10-17 (review session; decisions by Dana 2026-10-16/17) · Model: Sonnet is fine
> Status: EXECUTED 2026-10-18. Parts A+B in `e9345da` (deployed, revision axis-bloom-backend-00756-mml), Part C in the follow-up commit; record in `WHAT_WE_BUILT.md` #224 and `CLOSING_REPORT_1.md` in this folder · Replaces the v2 brief (kept as `SUPERSEDED_…_1_FOUNDATION_v2.md`).
> Contract: `DESIGN_CUPPING_EVIDENCE.md` (v3 header and amended sections), `DESIGN_CUPPING_EVIDENCE_v3_CHANGES.md` (why), `DESIGN_CUPPING_EVIDENCE_v3_SKETCH.md` (inventory, writers, readers, known alignment issues). Read all three first. This brief creates no evidence row. Brief 2 loads data only after this is deployed.

## What this is

The five `cupping_*` tables predate the blueprint discipline: writes are inline SQL in `routes/admin.ts` (upserts and delete-reinsert), reads hit the base tables from four files, no lint covers them, every FK cascades on delete, and nothing records which scale a cupper used, whether she was blind, who she is as a row, or what the printed sheet looked like. This brief brings them to the standard the catalog, the customer tables and the roastery portal already meet: reference tables instead of literals, one write door, one read door over views, DB-level immutability with one supersede transition, lints in CI, comments and catalog. It also creates `roastery_remark` for what roasters say outside the portal form, and closes the one path by which raw cupping rows reached customers.

## Decisions already made (Dana). Do not re-open.

1. **Nothing hard-coded.** Cuppers, scales, sheet formats, thresholds, stop words and word mappings are rows (Part A1). No service, loader or view definition names a cupper, a conversion or a threshold.
2. **Stored as observed, converted in reads.** `cupping_score_values.value_min/max` hold the value on the scale the cupper used; `cupping_to_ab()` converts to 0 to 15 inside the views from `cupping_scale_step`. A word is stored at the SCA node the cupper named and never a more specific one (`cupping_note.tier`).
3. **Naming.** Domain word first, `cupping_` stays, nothing renamed. New tables are singular. `Class:` in `comments.sql` carries the layer: reference = master, evidence = fact, decision = operating, reconcile = view.
4. **One supersede transition per `cupping_scores` row**, cupper rows and merged rows alike: set `superseded_at`, `superseded_by_id`, `supersede_reason` once, change nothing else. Values, descriptors and remarks never change. Deletes raise. FKs RESTRICT, including the decision tables' coffee FKs.
5. **Score Entry keeps its UX.** Re-saving a cupper row supersedes the current one (`supersede_reason = 'edited in Score Entry'`) and inserts the new one in the same transaction. No upsert, no delete-reinsert, no `CUPPING_CUPPER_ROW_EXISTS` error.
6. **Latest session, history kept.** `v_coffee_dimension_range` reads the latest current merged row per coffee; `v_coffee_dimension_history` keeps every session. The decision tables get `basis JSONB` and `coffee_slot_assignment.placed_from_session_id` (columns only; brief 4 writes them).
7. **Evidence reaches customers through decisions only.** `v_collaborative_flavor_wheel`'s internal branch reads current merged rows only and exposes `tier`.
8. **Dial signal.** `cuppingService.refreshDialSignal(coffeeId)` is the one caller of `dialSuggestion.recordCuppingSignal`, which gains a retract path; fired after a merge, after the loader's manifest, and from `catalogService.setMatchArchetype` on an archetype change; only when every contributing cupper row is `ab_0_15`. **What the signal rests on (Dana, 2026-10-17):** `getDialSuggestion` buckets the merged midpoint by `coffee_dial_slot.spec_band_lo/hi` when every active slot of the archetype has a band, and falls back to the archetype's `archetype_vector` target range (`v_archetype_dimension_comparison`, the May 2026 targets) split evenly across the slots when any band is NULL, which is the case today. `dial_position_signal.notes` records which basis was used. Brief 3's `slot_spec_check` reads the bands only; the two readings are visibly different until the bands are set, then agree without a code change.
9. **Sessions** carry `session_date NOT NULL` + `session_date_precision`, `is_blind`, `roaster_present`, `sheet_format` FK, `record_source` (files only), `transcribed_by / transcribed_at / checked_by`. Session coffees carry `roast_date`, `blind_code`, `sample_note`, `is_control`. `cupping_brew_params` gets its first writer.
10. **Legacy rows** are tagged by the DEFAULT-swap trick, not by date. The guard trigger compares `to_jsonb(OLD)` minus the three supersede keys.
11. No strict mode anywhere. The lints block in CI; the boot check only reports. Immutability tests run inside rolled-back transactions.
15. **Every new table has a surrogate `id` primary key**; its natural or composite key is a `UNIQUE` constraint. FKs to the lookups may still reference the unique `code` (readability), as the house already does for `coffee_dial_slot` and `lookup_value`.
12. **`cupping_note` is a tree.** `parent_id` (self-FK) is added with the tier rows and backfilled from the text labels; family roll-up is a join up the tree, never a string match. `wheel_category` / `wheel_subcategory` stay as denormalised display columns.
13. **One writer for the mapping table.** `roastery_portal_note_mapping` gets its own small `noteMappingService` (`setNoteMapping`, `listMappings`), the table's one declared writer; `roasteryPortalService` calls it. No portal module writes cupping facts.
14. **`cupping_sessions.brew_method` is deprecated** the moment `saveBrewParams` exists: the brew lives in `cupping_brew_params`; `createSession` stops taking `brewMethod`; the column stays.

## Task 0 (report, read-only; STOP only where it says so)

- Every file with DML on a `cupping_*` table and every file with `FROM` / `JOIN cupping_*` outside `schema.sql`, seeds and tests. Expected: writes only in `routes/admin.ts` (9: upserts on `cupping_scores` and `cupping_score_values`, delete-reinsert on `cupping_score_descriptors`, inserts on sessions and session coffees, three DELETEs); reads in `routes/admin.ts` (16), `routes/coffees.ts` (11), `services/brewCard.ts` (3), `services/dialSuggestion.ts` (6). One line per query: purpose and which view will serve it.
- Current definitions of `v_cupping_scores_readable`, `v_coffee_dimension_range`, `v_coffee_descriptor`, `v_collaborative_flavor_wheel`, `v_coffee_dial_position_consensus`, `v_archetype_vectors`. Which of them read a `cupping_*` base table.
- Every FK on the five `cupping_*` tables, on `coffee_archetype_assignment.coffee_id`, `coffee_slot_assignment.coffee_id`, `dial_position_signal.coffee_id`, with its `ON DELETE` action and constraint name (auto-named; report them). `coffee_archetype_assignment.assigned_from_session_id` is SET NULL and stays.
- Every row in `cupping_sessions` and `cupping_scores` on test and prod: count, `taster_name` values, `is_merged` counts, which sessions came from `db/seeds/session_001_path_2026_05_27.sql` (expected `taster_name = 'session_1_merged'`). Rows for coffee 2891 (Flying Jewel): report session id, taster names, values; brief 2 needs to know.
- `comments.sql` lines for the six cupping tables and `dial_position_signal`: the current `Writer:` fields (expected `admin.POST …`; brew params `none`), and how `lineage.json` / `npm run lint:lineage` resolve a writer module. These fields are rewritten in Part C in the same commit as Part B, or CI fails.
- `cupping_note` rows: count per `wheel_category`, the existing tier-1 rows (`('Fruity','Fruity','Fruity')`, `('Floral','Floral','Floral')`, `('Roasted','Roasted','Roast')`, any other where descriptor = category), and whether a `tier` or `parent_id` column exists (expected no).
- `roastery_portal_note_mapping`: columns, the partial unique index, and `roasteryPortalService.setNoteMapping`'s signature (the loader and brief 2 call it with `source_kind`).
- `catalogService` ~line 200 (`descriptor_off_family`): confirm it reads `v_collaborative_flavor_wheel` with `COUNT(*)` and list which rows count today. `routes/orders.ts` `SELECT DISTINCT cupping_note_id FROM v_collaborative_flavor_wheel`. `roasteryPortalReads` ~821 reading `v_coffee_dimension_range` (which columns). These three change behaviour with A5 and A6; report, do not change them beyond what Part B says.
- `dialSuggestion.recordCuppingSignal` and `getAvgCuppingScore` / `getAvgCuppingScoresBatch`: current SQL; `dial_position_signal`'s three declared writers.
- Which readers of `coffee_dimensions.is_numeric` change behaviour when 1, 2, 3 flip to true (`v_cupping_scores_readable` midpoint, `v_archetype_vectors`, Score Entry form, `v_coffee_dimension_range` CROSS JOIN). If any breaks rather than showing three more numeric rows, STOP and report.
- Grant loops for `ab_app` and `reporting_ro`, and the customer-table pattern that revokes `UPDATE, DELETE, TRUNCATE` after the loop.
- `SHOW TimeZone` on test and prod; `cupping_sessions.created_at` type and default (expected `TIMESTAMPTZ DEFAULT now()`).
- The `comments.sql` format header, the `catalog:md` command, the house test helper for a rolled-back transaction (if none, say so; Part C defines one).

## PART A: schema (`backend/src/db/schema.sql`, idempotent, placed with the cupping block unless said otherwise)

### A1. Reference tables (Class: master). All `CREATE TABLE IF NOT EXISTS`, seeded by idempotent `INSERT … ON CONFLICT DO NOTHING`, commented.

```sql
CREATE TABLE IF NOT EXISTS cupper (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,              -- 'Dana', 'Camila'
  is_active  BOOLEAN NOT NULL DEFAULT true,
  since      DATE,
  note       TEXT
);
-- seed: Dana, Camila (since null; Dana may set it in Score Entry later)

CREATE TABLE IF NOT EXISTS cupping_scale (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,              -- 'ab_0_15', 'grid_0_5', 'word_3', 'legacy'
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('numeric','ordinal')),
  scale_min  NUMERIC,                           -- numeric scales
  scale_max  NUMERIC,
  note       TEXT
);
CREATE TABLE IF NOT EXISTS cupping_scale_step (  -- how a native value maps to the 0 to 15 line
  id         SERIAL PRIMARY KEY,
  scale_code TEXT NOT NULL REFERENCES cupping_scale(code),
  raw_label  TEXT NOT NULL,                     -- numeric: '0'..'5'; ordinal: 'low','medium','high'
  ab_min     NUMERIC NOT NULL CHECK (ab_min BETWEEN 0 AND 15),
  ab_max     NUMERIC NOT NULL CHECK (ab_max BETWEEN 0 AND 15 AND ab_max >= ab_min),
  UNIQUE (scale_code, raw_label)
);
-- seed: ab_0_15 numeric 0..15 (no steps: identity); legacy numeric 0..15 (identity, flagged in views);
--       grid_0_5 numeric 0..5 steps 0→0-1, 1→2-4, 2→5-7, 3→8-10, 4→11-13, 5→14-15;
--       word_3 ordinal steps low→0-5, medium→5-10, high→10-15.

CREATE TABLE IF NOT EXISTS cupping_sheet_format (
  id       SERIAL PRIMARY KEY,
  code     TEXT NOT NULL UNIQUE,                -- 'ab_0_15_9dim','ab_0_15_8dim','ab_0_15_6dim','freeform_grid','legacy_wide','score_entry'
  label    TEXT NOT NULL,
  since    DATE,
  note     TEXT
);
CREATE TABLE IF NOT EXISTS cupping_sheet_line (  -- which dimension a printed line feeds
  id           SERIAL PRIMARY KEY,
  sheet_format TEXT NOT NULL REFERENCES cupping_sheet_format(code),
  line_label   TEXT NOT NULL,                   -- 'Fragrance', 'Mouthfeel light to heavy', 'Aftertaste words', …
  dimension_id INT  NOT NULL REFERENCES coffee_dimensions(id),
  is_numeric   BOOLEAN NOT NULL,
  display_order INT,
  UNIQUE (sheet_format, line_label)
);
-- seed per DESIGN §6.2: ab_0_15_8dim: Fragrance→1 numeric+words, Aroma→2, Flavor→3, Sweetness→4, Acidity→5, Bitterness→6,
--   'Mouthfeel light to heavy'→7 numeric, 'Mouthfeel words'→12 text, 'Aftertaste short to long'→10 numeric, 'Aftertaste words'→11 text.
--   ab_0_15_9dim adds 'Depth'→9. freeform_grid: Frag→1 text, Aroma→2 text, Flavor→3 text, Acidity→5, Mouth→12 text, Bitter→6, Sweet→4, After→11 text.

CREATE TABLE IF NOT EXISTS evidence_parameter (
  id            SERIAL PRIMARY KEY,
  key           TEXT NOT NULL,
  value         NUMERIC NOT NULL,
  since         TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,
  note          TEXT,
  UNIQUE (key, since)
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_parameter_current ON evidence_parameter (key) WHERE superseded_at IS NULL;
-- seed: cupper_gap 2 · roaster_rank_gap 2 · spearman_min_n 5 · spearman_rho_cut -0.5 · rank_corr_min_n 3 · calibration_min_n 20
CREATE OR REPLACE FUNCTION param(p_key TEXT) RETURNS NUMERIC AS $$
  SELECT value FROM evidence_parameter WHERE key = p_key AND superseded_at IS NULL;
$$ LANGUAGE sql STABLE;

CREATE TABLE IF NOT EXISTS evidence_stop_word (
  id    SERIAL PRIMARY KEY,
  word  TEXT NOT NULL UNIQUE,                   -- lower-cased
  since DATE NOT NULL DEFAULT current_date,
  note  TEXT
);
-- seed: sweet, sweetness, fruits, fruit, fruity, light, acid, acidity, bitter, bitterness, dry, creamy, juicy, silky, tea like, intensity

CREATE TABLE IF NOT EXISTS cupper_calibration_offset (   -- empty on purpose; the named home for §7.5
  id            SERIAL PRIMARY KEY,
  cupper_id     INT NOT NULL REFERENCES cupper(id),
  dimension_id  INT NOT NULL REFERENCES coffee_dimensions(id),
  offset_value  NUMERIC NOT NULL,
  basis         TEXT NOT NULL,
  since         TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ
);
```
`cupping_note`: `ALTER TABLE cupping_note ADD COLUMN IF NOT EXISTS tier SMALLINT NOT NULL DEFAULT 3 CHECK (tier IN (1,2,3))`; `ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES cupping_note(id)`; `CHECK ((tier = 1) = (parent_id IS NULL))` added `NOT VALID` and validated after the backfill. Backfill `tier = 1` where `descriptor = wheel_category` and `wheel_subcategory = wheel_category`. Seed the SCA tier-2 nodes as rows with `tier = 2`, `descriptor = wheel_subcategory`, for every distinct `(wheel_category, wheel_subcategory)` in the existing seed that has no row yet (Berry, Citrus Fruit, Dried Fruit, Other Fruit, Brown Sugar, Vanilla, Vanillin, Overall Sweet, Sweet Aromatics, Nutty, Cocoa, Brown Spice, Pungent, Pepper, Burnt, Cereal, Tobacco, Pipe Tobacco, Olive Oil, Raw, Green/Vegetative, Beany, Sour Aromatics, Alcohol/Fermented, Chemical, Papery/Musty, Black Tea, Floral, …: derive from the data, do not type a list), and tier-1 rows for any category still missing one. Then backfill `parent_id`: every tier-3 row → the tier-2 row with the same `(wheel_category, wheel_subcategory)`; every tier-2 row → the tier-1 row with the same `wheel_category`; tier-1 rows null. Afterwards `SELECT count(*) FROM cupping_note WHERE tier > 1 AND parent_id IS NULL` is 0, the CHECK is validated, and a recursive CTE from any leaf reaches a tier-1 row in at most two steps (test in C2). From here on `wheel_category` / `wheel_subcategory` are denormalised display columns; every family roll-up in a view joins `parent_id`. Nothing invented: every row is a node the SCA wheel publishes. Report the rows added and the backfill counts.
`roastery_portal_note_mapping`: `ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'roaster' CHECK (source_kind IN ('roaster','cupper'))`; the partial unique index becomes `(normalized_words, source_kind) WHERE superseded_at IS NULL` (drop and recreate, idempotent). The writer moves to `services/noteMappingService.ts` (B8).
`coffee_dimensions` 1, 2, 3 numeric: the v2 UPDATE, unchanged.

### A2. `cupping_sessions`
```sql
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS record_source          TEXT NOT NULL DEFAULT 'legacy';          -- then SET DEFAULT 'score_entry'
ALTER TABLE cupping_sessions ALTER COLUMN record_source SET DEFAULT 'score_entry';
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS sheet_format           TEXT REFERENCES cupping_sheet_format(code);
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS session_date_precision TEXT NOT NULL DEFAULT 'exact' CHECK (session_date_precision IN ('exact','estimated'));
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS is_blind               BOOLEAN;
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS roaster_present        BOOLEAN;
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS transcribed_by         TEXT;
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS transcribed_at         DATE;
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS checked_by             TEXT;
```
`brew_method` is deprecated in place: the column stays, nothing new writes it, its comment says `DEPRECATED since 2026-10: the brew lives in cupping_brew_params.brew_device`; `v_cupping_session` exposes `brew_device` from the first session coffee's brew params and keeps `brew_method` as a legacy column for the seed session.
`session_date` becomes NOT NULL: first `UPDATE cupping_sessions SET session_date = created_at::date, session_date_precision = 'estimated' WHERE session_date IS NULL`, then `ALTER COLUMN session_date SET NOT NULL` in an idempotent `DO` block. Legacy tagging, date-free: rows that received `record_source = 'legacy'` from the first default are the legacy rows; the Path seed session additionally gets `record_source = 'seed:session_001_path_2026_05_27.sql', sheet_format = 'legacy_wide'` (keyed on its `session_1_merged` child, as in v2). Report the counts.

### A3. `cupping_session_coffees`
```sql
ALTER TABLE cupping_session_coffees ADD COLUMN IF NOT EXISTS roast_date  DATE;
ALTER TABLE cupping_session_coffees ADD COLUMN IF NOT EXISTS blind_code  TEXT;
ALTER TABLE cupping_session_coffees ADD COLUMN IF NOT EXISTS sample_note TEXT;
ALTER TABLE cupping_session_coffees ADD COLUMN IF NOT EXISTS is_control  BOOLEAN NOT NULL DEFAULT false;
```

### A4. `cupping_scores`
```sql
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS cupper_id                INT REFERENCES cupper(id);
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS scale_code               TEXT NOT NULL DEFAULT 'legacy' REFERENCES cupping_scale(code);
ALTER TABLE cupping_scores ALTER COLUMN scale_code SET DEFAULT 'ab_0_15';
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS archetype_call           archetype_enum;
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS archetype_call_secondary archetype_enum;
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS position_call            TEXT;
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS slot_call_id             INT REFERENCES coffee_dial_slot(id);
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS call_note                TEXT;
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS merge_rule               TEXT CHECK (merge_rule IS NULL OR merge_rule IN ('union_v1','manual','legacy'));
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS merge_note               TEXT;
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS superseded_at            TIMESTAMPTZ;
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS superseded_by_id         INT REFERENCES cupping_scores(id);
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS supersede_reason         TEXT;
```
Backfill, idempotent and date-free: `UPDATE cupping_scores SET merge_rule = 'legacy' WHERE is_merged AND merge_rule IS NULL AND scale_code = 'legacy'`; `UPDATE cupping_scores s SET cupper_id = c.id FROM cupper c WHERE s.cupper_id IS NULL AND NOT s.is_merged AND s.taster_name = c.name` (names other than the seeded cuppers stay null and are reported). `taster_name` stays as a legacy column (comment: deprecated, `cupper_id` is the key; nothing new writes it except `'merged'` is no longer written at all).
Constraints (idempotent `DO` blocks):
- `cupping_scores_row_shape`: `CHECK ((is_merged AND cupper_id IS NULL AND merge_rule IS NOT NULL) OR (NOT is_merged AND merge_rule IS NULL AND (cupper_id IS NOT NULL OR scale_code = 'legacy')))`, added `NOT VALID`, validated after the backfill.
- `cupping_scores_supersede_shape`: `CHECK ((superseded_at IS NULL) = (superseded_by_id IS NULL) AND (superseded_at IS NULL) = (supersede_reason IS NULL))`.
- Drop `UNIQUE (session_coffee_id, taster_name)`; create `cupping_scores_one_current_cupper UNIQUE (session_coffee_id, cupper_id) WHERE superseded_at IS NULL AND NOT is_merged` and `cupping_scores_one_current_merged UNIQUE (session_coffee_id) WHERE superseded_at IS NULL AND is_merged`. The legacy seed rows (null `cupper_id`) are outside the first index by construction; report that they are.

### A5. `cupping_score_values`
`ADD COLUMN IF NOT EXISTS raw_value TEXT`. Existing `value_min/max` stay; for `scale_code <> 'ab_0_15'` rows they hold the native value (brief 2 writes them that way; no existing row is converted).
Function:
```sql
CREATE OR REPLACE FUNCTION cupping_to_ab(p_scale TEXT, p_min NUMERIC, p_max NUMERIC, p_raw TEXT)
RETURNS TABLE (ab_min NUMERIC, ab_max NUMERIC) AS $$
  -- numeric identity scales: pass through; stepped numeric: look up floor(p_min) and floor(p_max); ordinal: look up p_raw
  …
$$ LANGUAGE sql STABLE;
```
Behaviour: `ab_0_15` and `legacy` return `(p_min, p_max)`; a scale with steps returns `(min(step.ab_min) over the steps spanned, max(step.ab_max))`; an ordinal scale resolves `lower(trim(p_raw))`; unknown label → `(null, null)` and the readable view carries `conversion_error = true`. Unit-tested in SQL (Part C).

### A6. FKs, immutability, grants
- Every `ON DELETE CASCADE` on the five `cupping_*` tables, and on `coffee_archetype_assignment.coffee_id`, `coffee_slot_assignment.coffee_id`, `dial_position_signal.coffee_id` → `ON DELETE RESTRICT` (drop + re-add in a `DO` block keyed on `confdeltype = 'c'`). Report constraint names.
- `cupping_evidence_immutable()` BEFORE UPDATE OR DELETE raises on `cupping_score_values`, `cupping_score_descriptors` (same shape as `roastery_portal_*_immutable`).
- `cupping_scores_guard()` BEFORE UPDATE OR DELETE: DELETE raises. UPDATE allowed only when `OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL AND NEW.superseded_by_id IS NOT NULL AND NEW.supersede_reason IS NOT NULL AND (to_jsonb(OLD) - 'superseded_at' - 'superseded_by_id' - 'supersede_reason') = (to_jsonb(NEW) - 'superseded_at' - 'superseded_by_id' - 'supersede_reason')`; anything else raises. Applies to cupper rows and merged rows alike.
- `cupping_sessions`, `cupping_session_coffees`: UPDATE allowed (header metadata); DELETE stopped by RESTRICT while children exist.
- `cupping_brew_params`: BEFORE UPDATE allowed (brew params are header-like, editable until a score exists; after that, UPDATE raises; implement as a trigger that checks for a `cupping_scores` row under the same session coffee). DELETE raises.
- Grants after the `ab_app` loop: `REVOKE UPDATE, DELETE, TRUNCATE ON cupping_score_values, cupping_score_descriptors FROM ab_app; REVOKE DELETE, TRUNCATE ON cupping_scores, cupping_brew_params FROM ab_app;`.

### A7. `roastery_remark`
The CREATE TABLE of DESIGN §4.7, verbatim, with the v2 brief's `roastery_remark_immutable` trigger, `roastery_remark_guard()` BEFORE INSERT (ownership rules), indexes, grants (`ab_app` SELECT, INSERT), and `v_roastery_remark` (every column plus `roaster_name`, `coffee_name`, `portal_coffee_name`, `cupping_note_descriptor`, `wheel_category`, `wheel_subcategory`, `tier`, `is_current`). Unchanged from v2 except `tier`.

### A8. Decision tables, columns only
```sql
ALTER TABLE coffee_archetype_assignment ADD COLUMN IF NOT EXISTS basis JSONB;
ALTER TABLE coffee_slot_assignment      ADD COLUMN IF NOT EXISTS basis JSONB;
ALTER TABLE coffee_slot_assignment      ADD COLUMN IF NOT EXISTS placed_from_session_id INT REFERENCES cupping_sessions(id) ON DELETE SET NULL;
```
Nothing writes them in this brief. `catalogService.setMatchArchetype` / `placeCoffee` accept and store them in brief 4.

### A9. Views (DROP + CREATE where no dependent chain forbids it; otherwise CREATE OR REPLACE with the column list unchanged)
- `v_cupping_scores_readable`: every existing column name kept; `archetype` / `archetype_confidence` from `v_coffee`; `value_min/max` become the converted 0 to 15 pair via `cupping_to_ab`, plus `native_min`, `native_max`, `raw_value`, `conversion_error`; appended: `session_id`, `session_coffee_id`, `score_id`, `cupper_id`, `cupper_name` (from `cupper`; `'merged'` for merged rows; `taster_name` for legacy rows with null cupper), `record_source`, `sheet_format`, `session_date_precision`, `is_blind`, `roaster_present`, `is_control`, `blind_code`, `sample_note`, `scale_code`, the five call columns, `merge_rule`, `merge_note`, `transcribed_by`, `checked_by`; `WHERE cs.superseded_at IS NULL`.
- `v_coffee_dimension_range`: one row per coffee × dimension from the **latest** current merged row (by `session_date DESC, created_at DESC`); columns kept (`coffee_id, dimension_id, dimension_name, value_min, value_max, n_scores, basis`) with `value_min/max` converted; added `session_id`, `session_date`, `n_sessions` (distinct sessions with a current merged row), `midpoint`, `all_ab_scale` (`bool_and(scale_code = 'ab_0_15')` over the cupper rows behind that merged row; a legacy merged row with no cupper rows → false). The `unmerged` fallback stays (latest session, cupper rows converted).
- New `v_coffee_dimension_history`: one row per coffee × dimension × session (current merged row of each session), converted, with `session_date`, `is_blind`, `is_control`, `scale_codes text[]`, `all_ab_scale`.
- New `v_coffee_dimension_range_calibrated`: `v_coffee_dimension_range` with the current `cupper_calibration_offset` applied to the midpoint per cupper behind the merge (documented, unread; `Readers: none yet`).
- New `v_cupping_session` and `v_cupping_session_coffee` (as v2, plus `cupper_names`, `is_control`, brew params columns, `transcribed_by`, `checked_by`).
- `v_collaborative_flavor_wheel`: internal branch `JOIN cupping_scores cs ON cs.id = csd.cupping_score_id AND cs.is_merged AND cs.superseded_at IS NULL`; all three branches expose `cn.tier`. `v_coffee_descriptor` carries `tier`. (Column additions only, so `CREATE OR REPLACE` works with the dependent chain; if it does not, drop and recreate the chain explicitly and say so.)
- `v_coffee_dial_position_consensus`, `v_archetype_vectors`: filter superseded merged rows if Task 0 shows they read one; report.

## PART B: services and routes

### B1. `services/cuppingService.ts`, the only writer of `cupping_*` (every write in `withTransaction`)
- `createSession({ sessionDate, sessionDatePrecision = 'exact', location, sessionNotes, recordSource, sheetFormat, isBlind, roasterPresent, transcribedBy?, transcribedAt?, checkedBy?, brewDefaults? })` → id (no `brewMethod`; the brew is `brewDefaults.brewDevice`). `recordSource` required; Score Entry passes `'score_entry'` and `sheetFormat = 'score_entry'`. `brewDefaults` (`{ doseGrams, waterGrams, ratio, waterTemperatureCelsius, steepTimeMinutes, brewDevice, notes }`) is applied by `addSessionCoffee` to each new session coffee as its `cupping_brew_params` row unless overridden.
- `updateSessionHeader(sessionId, { … })`: header metadata only.
- `addSessionCoffee(sessionId, coffeeId, { displayOrder, roastDate?, blindCode?, sampleNote?, isControl?, brew? })` → id; writes the brew params row from `brew` or the session's defaults.
- `updateSessionCoffee(scId, { … })`, `saveBrewParams(scId, params)` (allowed until a score exists; `CUPPING_HAS_EVIDENCE` after).
- `saveCupperScore({ sessionCoffeeId, cupperId, scaleCode, archetypeCall, archetypeCallSecondary, positionCall, slotCallId, callNote, overallNotes, values: [{ dimensionId, valueMin, valueMax, rawValue, notes }], descriptors: [{ cuppingNoteId, intensity, customNotes }] })` → score id. Validation: `cupperId` active; numeric dimension: `valueMin <= valueMax`, both within the **scale's** `scale_min/max` for numeric scales, or both null for ordinal scales with `rawValue` set; text dimension: both null; `rawValue` required when `scaleCode <> 'ab_0_15'` or `valueMin <> valueMax`; `slotCallId` active. If a current row exists for `(sessionCoffeeId, cupperId)`: insert the new row first, then supersede the old one (`superseded_at = now()`, `superseded_by_id = new id`, `supersede_reason = input.supersedeReason ?? 'edited in Score Entry'`) in the same transaction, then `mergeByRule` if a current merged row exists (so the merge follows the correction). Never calls the dial signal directly.
- `mergeByRule(sessionCoffeeId, { n = param('cupper_gap') } = {})` → merged id. Reads current cupper rows, converts each through the same step table (`unionScores` works on converted 0 to 15 pairs and receives `scale_code` per row), builds the merged row per DESIGN §6.3 (`is_merged = true`, `cupper_id = null`, `scale_code = 'ab_0_15'`, `merge_rule = 'union_v1'`, `merge_note` with the scale codes and the disagreement list, values with `raw_value = 'union of: Dana 2-8, Camila 3'`, descriptors union with per-cupper `custom_notes`), supersedes the previous merged row (`'merged by rule again'`), then calls `refreshDialSignal(coffeeId)`.
- `saveManualMerge(sessionCoffeeId, input, reason)`: same path, `merge_rule = 'manual'`.
- `refreshDialSignal(coffeeId)`: reads `v_coffee_dimension_range` for the coffee; if the latest merged row has `all_ab_scale = true` → `recordCuppingSignal(coffeeId)`; otherwise `recordCuppingSignal(coffeeId, { retract: true })` (supersedes the current cupping signal, writes none) and appends `'; no dial signal (converted scale)'` to the merged row's `merge_note` before insert when called from a merge. Exported; called by `mergeByRule`, `saveManualMerge`, the brief 2 loader, and `catalogService.setMatchArchetype` when the archetype changes (one import; the lint allows exactly that call site).
- `removeEmptySession` / `removeEmptySessionCoffee`: only when nothing is underneath (`CUPPING_HAS_EVIDENCE`).
- `listCuppers()`, `addCupper(name)` (admin door for the `cupper` table; Score Entry's select reads it).
- `unionScores(rows, n)` pure, exported, as v2 B2 plus `scaleCodes` and `allAbScale` from the rows' `scale_code`.

### B2. `dialSuggestion.ts`
- `getAvgCuppingScore` / `getAvgCuppingScoresBatch` move onto `cuppingReads.getMergedRange(s)` (midpoint of the latest merged range; same for one session, different for several; say so in the closing report).
- `getDialSuggestion`: if every active slot of the archetype has `spec_band_lo/hi` set, the suggested slot is the one whose band contains the midpoint (nearest band when none contains it, `is_outlier = true`), `basis = 'spec_band'`; otherwise the existing `archetype_vector` bucketing, `basis = 'archetype_vector (May 2026 targets)'`. The returned object carries `basis`; `recordCuppingSignal` writes it into `dial_position_signal.notes`. No other behaviour change; the public dial endpoints that show the suggestion show the basis string too.
- `recordCuppingSignal(coffeeId, { retract = false } = {})`: `retract` supersedes the current `source = 'cupping'` row for the coffee and inserts nothing. The table keeps its declared writers; `comments.sql` `Writer:` unchanged.

### B3. `services/cuppingReads.ts`, the only TS reader of `cupping_*` base tables besides the service, over views only
`getMergedRange(coffeeId, dimensionId)`, `getMergedRanges(coffeeId)`, `getDimensionHistory(coffeeId)`, `getDescriptors(coffeeId)` (`v_coffee_descriptor`), `getOverallNotes`, `getScoresForSessionCoffee(scId)`, `listSessions()`, `listSessionCoffees(sessionId)`, `listCuppers()`, `listScales()`, `listSheetFormats()`, `getSheetLines(format)`. `routes/coffees.ts` (11 reads), `routes/admin.ts` (16), `brewCard.ts` (3), `dialSuggestion.ts` (6) call these. Views are open to any `*Reads` module (`roasteryPortalReads` keeps its `v_coffee_dimension_range` read; column names unchanged).

### B4. Routes
`routes/admin.ts` Score Entry endpoints keep URLs and shapes and become thin callers: `POST /sessions` → `createSession` (`recordSource: 'score_entry'`); `PATCH /sessions/:id` (new) → `updateSessionHeader`; `POST /sessions/:id/coffees` → `addSessionCoffee`; `PATCH /sessions/:sid/coffees/:scId` (new) → `updateSessionCoffee` / `saveBrewParams`; `POST /scores` → `saveCupperScore` (body carries `cupperId`; re-save supersedes) or `saveManualMerge` when `is_merged`; `POST /sessions/:sid/coffees/:scId/merge` (new) → `mergeByRule`; `DELETE /scores/:scoreId` → 405 "cupping evidence is immutable; save again to supersede"; `DELETE /sessions/:id`, `…/coffees/:scId` → `removeEmpty*` (409 on evidence). `GET /cuppers`, `POST /cuppers`, `GET /scales`, `GET /sheet-formats` (new, admin). `routes/roasteryRemarkAdmin.ts` as v2.
`routes/coffees.ts` and `routes/orders.ts` keep their SQL on views; `orders.ts`'s `SELECT DISTINCT cupping_note_id FROM v_collaborative_flavor_wheel` now returns decision-layer notes only (intended; report the before/after count for one coffee on test).

### B5. Score Entry (frontend, minimal)
Session form: Blind, Roaster present, Sheet format (select from `/sheet-formats`), Date precision, brew defaults prefilled 8.5 g / 150 g. Session coffee row: Roast date, Blind code, Sample note, Control checkbox. Score form: Cupper (select from `/cuppers`, replaces the free-text taster name), Scale (select from `/scales`, default A&B 0 to 15), the call fields; dimensions 1 to 3 numeric with a notes field. "Save" on an existing row shows "Saving again supersedes the current row" and calls the same endpoint. "Delete score" removed; "Merge by rule" added per session coffee. No redesign.

### B6. `catalogService.setMatchArchetype`
After a successful write where the archetype changed, call `cuppingService.refreshDialSignal(coffeeId)` (the import is allowed by name in `lint-cupping`; `lint-catalog` unaffected). No other change to the catalog service in this brief.

### B7. `services/roasteryRemarkService.ts` / `roasteryRemarkReads.ts`: as v2 B6.

### B8. `services/noteMappingService.ts` / `noteMappingReads.ts`
`setNoteMapping({ normalizedWords, cuppingNoteId, sourceKind, adminId?, note? })` (`roastery_portal_note_mapping` gains `note TEXT`) (supersedes the current row for the same words and kind, inserts the new one, one transaction) and `listMappings({ sourceKind?, currentOnly = true })`. The one declared writer of `roastery_portal_note_mapping`. `roasteryPortalService` replaces its own DML on the table with a call to this service (its three statements, Task 0 lists them); `roasteryPortalReads` keeps reading the view. The brief 2 loader and brief 4's "map" link call this service. `lint-roastery-portal`'s DML rule for `roastery_portal_note_mapping` names `noteMappingService.ts` as the only allowed file; `comments.sql` `Writer:` becomes `noteMappingService.setNoteMapping`.

## PART C: lint, tests, comments, docs

### C1. `scripts/lint-cupping.mjs` (clone `lint-roastery-portal.mjs`)
Rule 1: DML on `cupping_*` tables (sessions, session_coffees, brew_params, scores, score_values, score_descriptors) outside `services/cuppingService.ts` fails (`schema.sql`, `db/seeds/`, `*.test.ts` exempt). The reference tables (`cupper`, `cupping_scale*`, `cupping_sheet_*`, `evidence_parameter`, `evidence_stop_word`, `cupper_calibration_offset`) are seed-only except `cupper` via `cuppingService.addCupper`; DML on them elsewhere fails too. Rule 2: `FROM` / `JOIN` on those base tables outside `cuppingService.ts`, `cuppingReads.ts`, `schema.sql`, seeds, tests fails. Rule 3: `recordCuppingSignal(` only in `cuppingService.ts` and its definition; `refreshDialSignal(` only in `cuppingService.ts`, `catalogService.ts`, the brief 2 loader path (`features/cupping_evidence/load/`), tests. Rule 4 (brief 3 adds): `FROM v_evidence_` only in `evidenceReads.ts`, `schema.sql`, tests. Probe each rule, delete the probes. `"lint:cupping"` in `package.json`; a step in `deploy.yml` beside `lint:catalog`, `lint:customer`, `lint:retention`, `lint:roastery-portal`, `lint:lineage`.
`lint-roastery-portal.mjs`: `roastery_remark` added to the DML rule (service `roasteryRemarkService.ts`) and to the base-table read rule; `roastery_portal_note_mapping`'s DML rule now names `noteMappingService.ts` only.

### C2. Tests
- `services/cupping.test.ts`: `unionScores` (ranges, single cupper, text dims, converted scales → `allAbScale = false`, agreeing and disagreeing calls, gap exactly n agrees, n + 1 disagrees, n read from `param('cupper_gap')`); `saveCupperScore` validation (numeric bounds on the scale's own range, `rawValue` rules, text dim rejects values, ordinal scale requires null values + raw); re-save supersedes (one current row, old row carries the three columns, merged row re-merged); `mergeByRule` twice → one current merged row; `refreshDialSignal` fires only when `all_ab_scale` (spy on `recordCuppingSignal`, assert `retract` otherwise); `removeEmptySession` refusal; `addSessionCoffee` writes brew defaults.
- `db/cuppingImmutability.test.ts` inside a transaction that rolls back: UPDATE and DELETE on values / descriptors rejected; DELETE on scores rejected; UPDATE on a cupper row that changes a value rejected; the one permitted transition succeeds once (cupper row and merged row) and fails the second time; a transition that also changes another column rejected; `DELETE FROM cupping_sessions` with children fails (RESTRICT); `DELETE FROM coffees` for a coffee with an assignment fails (RESTRICT).
- `db/cuppingToAb.test.ts`: identity, grid steps (0→0-1 … 5→14-15), word steps, unknown label → nulls + `conversion_error`, a range spanning steps (grid 1 to 3 → 2-10).
- `db/cuppingNoteTree.test.ts`: every tier-3 row has a tier-2 parent whose parent is tier-1; a recursive CTE from Blueberry reaches Berry then Fruity; `parent_id` agrees with the text labels on every row; inserting a tier-2 row without a parent fails the CHECK.
- `services/dialSuggestion.test.ts` (extend): with NULL bands the suggestion carries `basis = 'archetype_vector …'`; setting bands on all slots of a fixture archetype inside a rolled-back transaction flips it to `basis = 'spec_band'` and picks the slot whose band contains the midpoint.
- `services/noteMapping.test.ts`: supersede-and-insert for the same words and kind; `roaster` and `cupper` mappings for the same words coexist; `roasteryPortalService` no longer contains DML on the table (grep in the test).
- `services/roasteryRemark.test.ts`: as v2.
- Score Entry smoke on the test DB: create session (blind, sheet format, brew defaults) → add coffee (blind code, control) → save two cupper rows with `cupperId` → merge by rule → readable view shows converted values, one current merged row, `merge_rule = 'union_v1'`, disagreement list → save one cupper row again → old row superseded, new current, merged row re-merged → still one current merged row.
- Schema applies cleanly twice on the test DB.

### C3. Comments and catalog
`comments.sql`: table comments for the eight new tables (Class: master; Writer: seed, or `cuppingService.addCupper` for `cupper`), `roastery_remark` (Class: fact; Writer: `roasteryRemarkService.recordRemarks`), the **rewritten `Writer:` fields of the six cupping tables** (`cuppingService.createSession, cuppingService.updateSessionHeader, cuppingService.removeEmptySession; seed` and so on; `cupping_brew_params`: `cuppingService.addSessionCoffee, cuppingService.saveBrewParams`), updated `Readers:`, every new column, the five new or changed views, the two functions, `cupping_note.tier` and `cupping_note.parent_id` (and `wheel_category` / `wheel_subcategory` re-commented as denormalised display columns), `roastery_portal_note_mapping.source_kind` with `Writer: noteMappingService.setNoteMapping`, `cupping_sessions.brew_method` marked DEPRECATED, `dial_position_signal.notes` re-commented to name the basis string, the two decision-table columns. `lineage.json` updated if it lists module aliases. `npm run lint:lineage` green. `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md`. Boot check reports zero uncommented objects among those touched.

### C4. Docs
`CLAUDE.md`: one line under the data catalog rules: "**Every table has a surrogate `id` primary key** (SERIAL or UUID; Dana, 2026-10-17). A natural or composite key is kept as a `UNIQUE` constraint beside it, never as the primary key. Existing composite-key and natural-key tables are retrofitted in their own brief, not opportunistically."
`WHAT_WE_BUILT_DB.md`: one dated section "Cupping evidence": reference tables, write door, read door, immutability and the single supersede transition, latest-session range, the wheel view change, `roastery_remark`, legacy tagging. `WHAT_WE_BUILT.md`: one entry. This brief's status line.

## CONSTRAINTS
- No backup step before Part A (Dana, 2026-10-17): the cupping tables hold only the Path seed, which `db/seeds/session_001_path_2026_05_27.sql` recreates, and every other table this brief touches gets a constraint change, not a data change. Apply on the test DB first, twice; then prod.
- No evidence row is created by this brief. Test fixtures live inside rolled-back transactions or a `Portal Test Roastery A`-style fixture roastery, never in the three real roasteries.
- No change to any coffee, assignment, placement, slot, price, portal response, mapping or customer row. `catalogService` changes only by the one `refreshDialSignal` call in B6.
- `npm run build` clean; the six lints green (`lint:cupping`, `lint:lineage` included); all tests green; `AdminScoreEntry` works end to end on the test DB.
- Deploy order: schema + services + routes in one commit (Parts A, B); lint + tests + comments + docs in a second (Part C) **but the `Writer:` rewrite of C3 ships in the first commit**, or `lint:lineage` fails between them. Straight to main. Report the legacy counts from prod after deploy.
- Do not act as Dana or any real person; use a marked `Zzz Test` admin where the API needs one, demoted and disabled at the end.

## DONE =
Eight reference tables seeded and commented; `cupping_note.tier` and `parent_id` with the SCA tier-1/2 nodes and a validated tree; `roastery_portal_note_mapping.source_kind` written only by `noteMappingService`; `brew_method` deprecated; `getDialSuggestion` band-first with its basis recorded; `cuppingService.ts` the only file with DML on `cupping_*`; `cuppingReads.ts` the only other base-table reader; `cupping_to_ab()` and `param()`; one supersede transition on every `cupping_scores` row proven by tests; FKs RESTRICT on the cupping and decision tables; the legacy seed tagged by default-swap; `v_coffee_dimension_range` latest-session with `all_ab_scale`, `v_coffee_dimension_history`, `v_collaborative_flavor_wheel` internal = current merged only with `tier`; `refreshDialSignal` wired from merge and from `setMatchArchetype`; `basis JSONB` and `placed_from_session_id` columns present; `roastery_remark` with trigger, guard, view, service, route; Score Entry works with cupper select, scale select and merge button; `lint:cupping` and `lint:lineage` green in `deploy.yml`; `CATALOG.md` regenerated; `WHAT_WE_BUILT_DB.md` updated.

Closing report: Task 0 findings; constraint names changed; legacy counts on test and prod; prod rows for coffee 2891; tier-2 rows added to `cupping_note`; readers of `is_numeric` that needed a change; the before/after of the three behaviour changes (D6 family warning rows, feedback-form note list, portal dominant-dimension read); test results; commit hashes.
