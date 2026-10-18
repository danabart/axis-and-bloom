# Cupping Evidence, brief 1: the foundation (schema, write door, read door, immutability, lint). No data.

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-16 (CTO session; decisions by Dana) · Model: Sonnet is fine
> Status: NOT EXECUTED · Replaces `cupping_joe_coffee/SUPERSEDED_CLAUDE_CODE_PROMPT_CUPPING_JOE_COFFEE_1.md` Parts A0 and A (never run).
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v2, §4, §5, §6.3, §10, §11. Read it first. This brief creates no evidence row. Brief 2 loads data only after this is deployed.

## What this is

The five `cupping_*` tables predate the blueprint discipline: writes are inline SQL in `routes/admin.ts`, reads hit the base tables from four files, no lint covers them, every FK cascades on delete, and nothing records which scale a cupper used or whether she was blind. This brief brings them to the standard the catalog and the roastery portal already meet, adds the evidence columns the loads need, and creates `roastery_remark` for what roasters say outside the portal form. Three parts, in order: Part A schema, Part B services and routes, Part C lint, tests, comments, docs.

## Decisions already made (Dana). Do not re-open.

1. Dimensions 1 Fragrance, 2 Aroma, 3 Flavor become numeric 0 to 15 (the printed sheet scores eight dimensions). Existing text-only rows on them stay valid.
2. Every cupper row is `is_merged = false`. The merged row is always produced by `mergeByRule` (or Score Entry's manual merge), `taster_name = 'merged'`, also for a one-cupper session.
3. Evidence values are immutable at the database level: triggers and RESTRICT FKs, not only service discipline. The only permitted change on `cupping_scores` is setting `superseded_at` (+ `superseded_by_id`, `supersede_reason`) on a merged row once.
4. Converted scales are a column (`scale_code`), the paper value is a column (`raw_value`). Never only a note string.
5. Sessions record `record_source`, `sheet_format`, `is_blind`, `roaster_present`. Session coffees record `roast_date`, `blind_code`, `sample_note`.
6. The dial signal (`recordCuppingSignal`) is called from `cuppingService` only, and only when every cupper row behind the merge is `scale_code = 'ab_0_15'`.
7. `roastery_remark` is a new insert-only table (DESIGN §3 says why nothing existing fits). Corrections use `supersedes_id`; the old row is never touched.
8. Legacy rows (the Path seed session, any Score Entry session created before this brief) are tagged, not changed: `scale_code = 'legacy'`, `record_source` backfilled, `sheet_format = 'legacy_wide'` on the seed session.
9. No strict mode anywhere. The lint blocks in CI like the existing four; the boot check only reports (data catalog posture, 2026-10-16).
10. Nothing is deleted or dropped. `ON DELETE CASCADE` → `RESTRICT` is a constraint change, not a data change.

## Task 0 (report, read-only; STOP only where it says so)

- Every file with DML on a `cupping_*` table and every file with `FROM` / `JOIN cupping_*` outside `schema.sql`, seeds and tests. Expected: writes only in `routes/admin.ts`; reads in `routes/admin.ts`, `routes/coffees.ts`, `services/brewCard.ts`, `services/dialSuggestion.ts`. One line per query: purpose and which view (existing or to add) will serve it.
- Current definitions (columns) of `v_cupping_scores_readable`, `v_coffee_dimension_range`, `v_coffee_descriptor`, `v_collaborative_flavor_wheel`, `v_coffee_dial_position_consensus`.
- Every FK on the five `cupping_*` tables with its `ON DELETE` action (expected: all CASCADE; `coffee_archetype_assignment.assigned_from_session_id` is SET NULL and stays).
- Every row in `cupping_sessions` and `cupping_scores` on test and prod: count, `taster_name` values, `is_merged` counts, which sessions came from the seed `db/seeds/session_001_path_2026_05_27.sql` (expected `taster_name = 'session_1_merged'`). These are the rows the legacy backfill tags. If prod has rows for coffee 2891 (Flying Jewel) report them: brief 2 needs to know.
- Whether any TS code or the frontend calls `DELETE /api/admin/scores/:scoreId`, `/sessions/:id`, `/sessions/:sessionId/coffees/:scId` (expected: Score Entry buttons only), and how `POST /api/admin/scores` is authenticated (expected `requireAdmin`) and whether it calls `recordCuppingSignal`.
- Which readers of `coffee_dimensions.is_numeric` would change behaviour when 1, 2, 3 flip to true: `v_cupping_scores_readable` (midpoint), `v_archetype_vectors`, `roastery_portal_dimension` seed (joins by name on seven names, unaffected), the Score Entry form, `v_coffee_dimension_range` (CROSS JOIN over all dimensions). Report each in one line. If any reader would break (not just show three more numeric rows), STOP and report.
- The grant loops in `schema.sql` for `ab_app` and `reporting_ro`, and how the customer tables revoke `UPDATE, DELETE, TRUNCATE` after the loop (the pattern to copy).
- `SHOW TimeZone` on test and prod; the type and default of `cupping_sessions.created_at` and `roastery_portal_response.created_at` (both expected `TIMESTAMPTZ DEFAULT now()`); `roastery_remark.load_dts` copies that form, not the older `timezone('utc', now())`.
- The `comments.sql` format header and the `catalog:md` command (`CLAUDE.md`).

## PART A: schema (`backend/src/db/schema.sql`, idempotent, placed with the cupping block)

### A1. `coffee_dimensions` 1, 2, 3 numeric
```sql
UPDATE coffee_dimensions
   SET is_numeric = true, scale_min = 0, scale_max = 15,
       scale_min_label = COALESCE(scale_min_label, 'faint'),
       scale_max_label = COALESCE(scale_max_label, 'intense')
 WHERE id IN (1, 2, 3) AND is_numeric = false;
```
Placed after the `coffee_dimensions` seed INSERT. Comment lines for the three rows' meaning go to `comments.sql` (table comment unchanged; the column comment on `is_numeric` gains "1 to 3 numeric since cupping evidence brief 1, 2026-10").

### A2. `cupping_sessions`
```sql
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS record_source   TEXT NOT NULL DEFAULT 'score_entry';
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS sheet_format    TEXT CHECK (sheet_format IS NULL OR sheet_format IN ('ab_0_15_8dim','ab_0_15_6dim','freeform_grid','legacy_wide'));
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS is_blind        BOOLEAN;
ALTER TABLE cupping_sessions ADD COLUMN IF NOT EXISTS roaster_present BOOLEAN;
```
Legacy backfill, idempotent, runs every boot and matches nothing after the first time:
```sql
UPDATE cupping_sessions SET record_source = 'seed:session_001_path_2026_05_27.sql', sheet_format = 'legacy_wide'
 WHERE record_source = 'score_entry' AND sheet_format IS NULL
   AND id IN (SELECT DISTINCT sc.session_id FROM cupping_session_coffees sc JOIN cupping_scores cs ON cs.session_coffee_id = sc.id WHERE cs.taster_name = 'session_1_merged');
UPDATE cupping_sessions SET record_source = 'legacy:pre-2026-10 (score entry or seed)'
 WHERE record_source = 'score_entry' AND created_at < '2026-10-17';
```
(The second statement's date is the deploy date of this brief; set it to the actual deploy day so sessions created through the new service afterwards keep `'score_entry'`. Report the date used.)

### A3. `cupping_session_coffees`
```sql
ALTER TABLE cupping_session_coffees ADD COLUMN IF NOT EXISTS roast_date  DATE;
ALTER TABLE cupping_session_coffees ADD COLUMN IF NOT EXISTS blind_code  TEXT;
ALTER TABLE cupping_session_coffees ADD COLUMN IF NOT EXISTS sample_note TEXT;
```

### A4. `cupping_scores`
```sql
ALTER TABLE cupping_scores ADD COLUMN IF NOT EXISTS scale_code               TEXT NOT NULL DEFAULT 'ab_0_15' CHECK (scale_code IN ('ab_0_15','word_3','grid_0_5','legacy'));
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
Constraints, each in an idempotent `DO` block:
- `cupping_scores_merged_shape`: `CHECK ((is_merged AND taster_name = 'merged' AND merge_rule IS NOT NULL) OR (NOT is_merged AND merge_rule IS NULL))`, added `NOT VALID` then validated after the legacy backfill below (the seed row has `taster_name = 'session_1_merged'`; the backfill sets `merge_rule = 'legacy'` on it and the check is written to accept `taster_name IN ('merged','session_1_merged')` for `is_merged` rows).
- `cupping_scores_supersede_shape`: `CHECK ((superseded_at IS NULL) = (superseded_by_id IS NULL))`.
- Drop `UNIQUE (session_coffee_id, taster_name)`; create `CREATE UNIQUE INDEX IF NOT EXISTS cupping_scores_one_current ON cupping_scores (session_coffee_id, taster_name) WHERE superseded_at IS NULL`.
Legacy backfill: `UPDATE cupping_scores SET scale_code = 'legacy' WHERE created_at < '<deploy day>' AND scale_code = 'ab_0_15'; UPDATE cupping_scores SET merge_rule = 'legacy' WHERE is_merged AND merge_rule IS NULL AND created_at < '<deploy day>';` (these UPDATEs run in `schema.sql` before the immutability trigger of A6 is created in the same file, and match nothing on later boots; put the trigger creation after them and say so in a comment).

### A5. `cupping_score_values`
```sql
ALTER TABLE cupping_score_values ADD COLUMN IF NOT EXISTS raw_value TEXT;
```

### A6. FKs and immutability on the five `cupping_*` tables
- For each FK listed in DESIGN §4.6, a `DO` block: if `pg_constraint.confdeltype = 'c'` for that constraint name, `ALTER TABLE … DROP CONSTRAINT …, ADD CONSTRAINT … FOREIGN KEY (…) REFERENCES … ON DELETE RESTRICT`. Report the constraint names found (they were auto-named).
- Function `cupping_evidence_immutable()` RETURNS trigger: `RAISE EXCEPTION 'cupping evidence is immutable (% on %, id %)', TG_OP, TG_TABLE_NAME, OLD.id USING ERRCODE = 'integrity_constraint_violation'`. Triggers BEFORE UPDATE OR DELETE on `cupping_score_values` and `cupping_score_descriptors` (DROP TRIGGER IF EXISTS + CREATE).
- Function `cupping_scores_guard()` BEFORE UPDATE OR DELETE on `cupping_scores`: DELETE always raises. UPDATE raises unless `OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL AND NEW.superseded_by_id IS NOT NULL AND OLD.is_merged = true` and `row(NEW.*) ` equals `row(OLD.*)` on every column except `superseded_at`, `superseded_by_id`, `supersede_reason` (compare column by column; list them). Cupper rows (`is_merged = false`) can never be updated.
- Grants, right after the `ab_app` loop: `REVOKE UPDATE, DELETE, TRUNCATE ON cupping_score_values, cupping_score_descriptors FROM ab_app; REVOKE DELETE, TRUNCATE ON cupping_scores FROM ab_app;`. `cupping_sessions` and `cupping_session_coffees` keep their grants (header metadata is editable; DELETE is stopped by RESTRICT while children exist).

### A7. `roastery_remark`
The CREATE TABLE in DESIGN §4.7, verbatim, placed with the `roastery_portal_*` block before the grant loops. Plus:
- `roastery_remark_immutable` trigger (BEFORE UPDATE OR DELETE raises, same function shape as `roastery_portal_acceptance_immutable`).
- `roastery_remark_guard()` BEFORE INSERT: `coffee_id` (when set) must have `coffees.roaster_id = NEW.roaster_id`; `portal_coffee_id` (when set) must have `roastery_portal_coffee.roaster_id = NEW.roaster_id`; `said_by_respondent_id` (when set) must have `roastery_portal_respondent.roaster_id = NEW.roaster_id`; `supersedes_id` (when set) must point at a row with the same `roaster_id`; `cupping_session_coffee_id` (when set) must point at a session coffee whose `coffee_id` equals `NEW.coffee_id` when both are set.
- Indexes `roastery_remark_coffee_idx (coffee_id)`, `roastery_remark_roaster_idx (roaster_id, said_on)`, `roastery_remark_supersedes_idx (supersedes_id)`.
- Grants: after the loop, `REVOKE UPDATE, DELETE, TRUNCATE ON roastery_remark FROM ab_app`.
- View `v_roastery_remark` (DROP VIEW + CREATE VIEW): every column plus `roaster_name`, `coffee_name`, `portal_coffee_name`, `cupping_note_descriptor`, `wheel_category`, `wheel_subcategory`, `is_current` (`NOT EXISTS (SELECT 1 FROM roastery_remark n WHERE n.supersedes_id = r.id)`), ordered by `said_on, coffee_id, topic`. Granted to `reporting_ro`.

### A8. Views touched
- `v_cupping_scores_readable`: DROP + CREATE with every existing column name kept; its `archetype` / `archetype_confidence` columns now come from `v_coffee` instead of a direct join on `coffee_archetype_assignment` (catalog reads go through the catalog views); these appended: `session_id`, `session_coffee_id`, `score_id`, `record_source`, `sheet_format`, `is_blind`, `roaster_present`, `blind_code`, `sample_note`, `scale_code`, `archetype_call`, `archetype_call_secondary`, `position_call`, `slot_call_id`, `call_note`, `merge_rule`, `merge_note`, `raw_value`, `superseded_at`; `WHERE cs.superseded_at IS NULL`.
- `v_coffee_dimension_range`: the `merged` CTE adds `AND cs.superseded_at IS NULL`; add `n_sessions` (distinct sessions behind the merged range), `midpoint`, `all_ab_scale` (`bool_and` over the cupper rows of those session coffees that `scale_code = 'ab_0_15'`; legacy merged rows with no cupper rows count as `false`). Keep every existing column name and the `unmerged` fallback.
- New `v_cupping_session` (sessions with coffee count, cupper names, merged count, `record_source`, `sheet_format`, `is_blind`, `roaster_present`) and `v_cupping_session_coffee` (session coffee rows with coffee and roaster names, `roast_date`, `blind_code`, `sample_note`, current merged score id) for Score Entry's list reads, granted to `reporting_ro`.
- `v_coffee_dial_position_consensus` and `v_archetype_vectors`: unchanged unless Task 0 shows they read a superseded merged row; then add the same filter and report it.

## PART B: services and routes

### B1. `services/cuppingService.ts`, the only writer
Exports, every write in `withTransaction`:
- `createSession({ sessionDate, brewMethod, location, sessionNotes, recordSource, sheetFormat, isBlind, roasterPresent })` → session id. `recordSource` required (Score Entry passes `'score_entry'`).
- `updateSessionHeader(sessionId, { sessionDate?, location?, sessionNotes?, sheetFormat?, isBlind?, roasterPresent? })`: header metadata only.
- `addSessionCoffee(sessionId, coffeeId, { displayOrder, roastDate?, blindCode?, sampleNote? })` → session coffee id.
- `updateSessionCoffee(scId, { roastDate?, blindCode?, sampleNote?, displayOrder? })`.
- `saveCupperScore({ sessionCoffeeId, tasterName, scaleCode, archetypeCall, archetypeCallSecondary, positionCall, slotCallId, callNote, overallNotes, values: [{ dimensionId, valueMin, valueMax, rawValue, notes }], descriptors: [{ cuppingNoteId, intensity, customNotes }] })` → score id. Rejects `tasterName = 'merged'`. Validation: for a numeric dimension, `valueMin <= valueMax`, both within `coffee_dimensions.scale_min/max`, or both null with `notes` or `rawValue` set; for a text dimension both null; `rawValue` required when `scaleCode <> 'ab_0_15'` or `valueMin <> valueMax`; `slotCallId` must be an active slot; a second current row for the same (session coffee, taster) throws `CUPPING_CUPPER_ROW_EXISTS` (immutable: corrections follow DESIGN §6.4). Never calls `recordCuppingSignal`.
- `mergeByRule(sessionCoffeeId, { n = 2 } = {})` → merged score id. Reads current cupper rows for the session coffee (throws `CUPPING_NO_CUPPER_ROWS` if none), computes `unionScores(rows, n)` (B2), supersedes the current merged row if any (`superseded_at = now()`, `superseded_by_id` = the new id, `supersede_reason = 'merged by rule again'`; insert the new row first, then update the old one, same transaction), inserts the merged row (`taster_name = 'merged'`, `is_merged = true`, `scale_code = 'ab_0_15'`, `merge_rule = 'union_v1'`, `merge_note`, call columns per the rule, values with `raw_value = 'union of: Dana 2-8, Camila 3'`, descriptors with concatenated `custom_notes`). After commit, if `unionScores` reported `allAbScale = true`, calls `recordCuppingSignal(coffeeId)`; otherwise appends `; no dial signal (converted scale)` to `merge_note` before insert.
- `saveManualMerge(sessionCoffeeId, input, reason)`: Score Entry's hand merge, same supersede path, `merge_rule = 'manual'`, `merge_note = reason`, signal under the same `allAbScale` condition computed from the current cupper rows.
- There is no public "supersede" or "retract" function. Superseding happens only inside `mergeByRule` and `saveManualMerge`, where a replacement row always exists (`superseded_by_id` is NOT NULL by the check constraint). The way to retract a wrong merge is to save a correct one.
- `removeEmptySession(sessionId)` / `removeEmptySessionCoffee(scId)`: only when no `cupping_scores` row exists underneath (and for a session, no session coffee), otherwise throw `CUPPING_HAS_EVIDENCE`.

### B2. `unionScores(rows, n)`, pure, exported, unit-tested
Input: the cupper rows with their values and descriptors. Output: `{ values, descriptors, archetypeCall, archetypeCallSecondary, positionCall, slotCallId, callNote, mergeNote, disagreements, allAbScale }` exactly per DESIGN §6.3: union of ranges per numeric dimension; one-cupper dimensions listed; descriptors union with per-cupper `custom_notes`; a call only when every cupper who made a call made the same one, otherwise null with all calls in `callNote`; disagreement when the gap between two cuppers' ranges is greater than `n` (overlap or gap exactly `n` agree); text dimensions: `notes` concatenated per cupper (`Dana: …; Camila: …`), min/max null.

### B3. `services/cuppingReads.ts`, the only reader, over views only
- `getMergedRange(coffeeId, dimensionId)` / `getMergedRanges(coffeeId)` on `v_coffee_dimension_range` (replaces `dialSuggestion.getAvgCuppingScore(sBatch)` and `brewCard`'s query; `dialSuggestion` keeps its public functions and calls these).
- `getDescriptors(coffeeId)` on `v_coffee_descriptor`; `getOverallNotes(coffeeId)` and `getScoresForSessionCoffee(scId)` on `v_cupping_scores_readable`; `listSessions()` on `v_cupping_session`; `listSessionCoffees(sessionId)` on `v_cupping_session_coffee`.
- `routes/coffees.ts` (the four cupping reads Task 0 found) and `routes/admin.ts` Score Entry reads call these. After this part `FROM cupping_` appears only in `cuppingService.ts`, `cuppingReads.ts`, `schema.sql`, seeds and tests.

### B4. Routes
`routes/admin.ts` Score Entry endpoints keep their URLs and request/response shapes and become thin callers: `POST /sessions` → `createSession` (adds `recordSource: 'score_entry'`), `PATCH /sessions/:id` (new, header fields) → `updateSessionHeader`, `POST /sessions/:id/coffees` → `addSessionCoffee`, `POST /scores` → `saveCupperScore` when `is_merged` is false, `saveManualMerge` when true; `POST /sessions/:sid/coffees/:scId/merge` (new) → `mergeByRule`; `DELETE /scores/:scoreId` → returns 405 with the message "cupping evidence is immutable; save a new merge instead" (the UI button is removed, see B5); `DELETE /sessions/:id`, `/sessions/:sid/coffees/:scId` → the `removeEmpty*` functions (409 on `CUPPING_HAS_EVIDENCE`).
`routes/roasteryRemarkAdmin.ts` at `/api/admin/roastery-remarks` behind `requireAdmin`: `GET ?roasterId=&coffeeId=&currentOnly=` → `roasteryRemarkReads.listRemarks`; `POST` (array body) → `roasteryRemarkService.recordRemarks`.

### B5. Score Entry (frontend, minimal)
- Session form gains Blind (yes/no), Roaster present (yes/no), Sheet format (select), and the session coffee row gains Roast date, Blind code, Sample note. All optional.
- Score form: Scale (select, default A&B 0 to 15), and the three archetype/position call fields; dimensions 1 to 3 now render numeric inputs with a notes field like the other five (they already do for numeric dimensions).
- "Delete score" button removed; "Merge by rule" button added per session coffee; a merged row that was superseded is not shown (the view filters it).
No redesign. Same page, same layout.

### B6. `services/roasteryRemarkService.ts` / `roasteryRemarkReads.ts`
`recordRemarks(input: RemarkInput[], ctx)` in one `withTransaction`; validates `channel`, `topic`, archetype code via `catalogReads.archetypeCode()`, wheel leaf existence and `is_active`, the ownership rules (the guard trigger is the backstop); returns inserted rows. `listRemarks({ roasterId?, coffeeId?, currentOnly = true })` from `v_roastery_remark`.

## PART C: lint, tests, comments, docs

### C1. `scripts/lint-cupping.mjs` (clone `lint-roastery-portal.mjs`)
Rule 1: DML (`INSERT INTO`, `UPDATE`, `DELETE FROM`) on any `cupping_*` table outside `services/cuppingService.ts` fails (`schema.sql` is not scanned, same as `lint-catalog.mjs`, which is what allows the one-time legacy tagging UPDATEs of A2 and A4; seeds under `db/seeds/` and `*.test.ts` exempt). Rule 2: `FROM` / `JOIN` on a `cupping_*` base table outside `cuppingService.ts`, `cuppingReads.ts`, `schema.sql`, seeds and tests fails. Rule 3: `recordCuppingSignal(` called anywhere but `cuppingService.ts` (and its own definition in `dialSuggestion.ts`) fails. Prove each rule with a probe file, then delete the probes. `"lint:cupping": "node scripts/lint-cupping.mjs"` in `package.json`; a step in `.github/workflows/deploy.yml` beside the other four.
`scripts/lint-roastery-portal.mjs`: `roastery_remark` added to the DML rule (service `roasteryRemarkService.ts`) and to the base-table read rule (allowed in `roasteryRemarkService.ts`, `roasteryRemarkReads.ts`, `schema.sql`, tests). Probe, prove, delete.

### C2. Tests
- `services/cupping.test.ts`: `unionScores` (ranges, single cupper, text dims, converted scales → `allAbScale = false`, agreeing and disagreeing calls, gap exactly n agrees, gap n + 1 disagrees); `saveCupperScore` validation (numeric bounds, `rawValue` required for converted scale, text dim rejects values, second current row rejected); `mergeByRule` twice → one current merged row, the first carries `superseded_at`, `superseded_by_id`, `supersede_reason`; the signal is recorded only when all rows are `ab_0_15` (spy on `recordCuppingSignal`); `removeEmptySession` refusal.
- `db/cuppingImmutability.test.ts`: UPDATE and DELETE on `cupping_score_values` / `cupping_score_descriptors` rejected; DELETE on `cupping_scores` rejected; UPDATE on a cupper row rejected; UPDATE on a merged row that changes anything but the three supersede columns rejected; the one permitted transition succeeds once and fails the second time; `DELETE FROM cupping_sessions` with children fails with a FK violation (RESTRICT), succeeds on an empty session.
- `services/roasteryRemark.test.ts`: insert-only (UPDATE and DELETE rejected), the five ownership rules, topic/column consistency, `supersedes_id` chain and `is_current`, lint green. House fixture pattern (`Portal Test Roastery A`).
- Score Entry smoke on the test DB: create session (blind, sheet format) → add coffee (blind code) → save two cupper rows → merge by rule → readable view shows one current merged row with `merge_rule = 'union_v1'` and the disagreement list → merge again → still one current row → the previous one is superseded.
- Schema applies cleanly twice on the test DB (every block idempotent).

### C3. Comments and catalog (`CLAUDE.md`)
`backend/src/db/comments.sql`: a `COMMENT ON` line for `roastery_remark` (table: Purpose | Class: fact | Writer: roasteryRemarkService.recordRemarks | Readers: v_roastery_remark | Since: 2026-10), every new column on the six tables, the three new views, and updated table comments on the five `cupping_*` tables (Writer: `cuppingService.*`; Readers: the views). Then `npm run catalog:md -- --expect-db axisandbloom` through the proxy and commit the regenerated `CATALOG.md`. The boot check must report zero uncommented objects among the ones this brief touched.

### C4. Docs
`WHAT_WE_BUILT_DB.md`: one dated section "Cupping evidence" pointing at `DESIGN_CUPPING_EVIDENCE.md`: the write door, the read door, immutability (triggers, RESTRICT), the new columns, `roastery_remark`, the legacy tagging. `WHAT_WE_BUILT.md`: one entry. This brief's status line at the top of this file.

## CONSTRAINTS
- Before Part A is applied on prod: a Cloud SQL on-demand backup of `axis-bloom-db` (Dana presses it, the brief waits; the closing report names the backup id). This brief changes constraints and triggers on five tables that hold the only copy of the Path cupping.
- No evidence row is created by this brief. Test fixtures are created and removed inside tests through the service's `removeEmpty*` paths and transactions, never by deleting scored rows (write tests so fixtures are superseded or left in a dedicated test session, the way the portal tests do).
- No change to any coffee, assignment, placement, slot, price, portal response or mapping.
- `npm run build` clean; the five lint scripts green (`lint:cupping` included); all new and existing tests green; `AdminScoreEntry` works end to end on the test DB.
- Deploy order: schema + services in one commit (Parts A and B), lint + tests + comments + docs in a second (Part C). Straight to main. Report the legacy backfill counts from prod after deploy (sessions tagged, scores tagged).
- Do not act as Dana or any real person; use a marked `Zzz Test` admin where the API needs one, demoted and disabled at the end.

## DONE =
`cuppingService.ts` is the only file with DML on `cupping_*`; `cuppingReads.ts` the only other reader besides `schema.sql`, seeds and tests; `lint:cupping` green and in `deploy.yml`; dimensions 1 to 3 numeric; every column of DESIGN §4.2 to §4.5 exists and is commented; FKs RESTRICT; immutability triggers proven by tests; the legacy seed session and scores tagged; `roastery_remark` with trigger, guard, view, service, route and lint rules; `v_cupping_scores_readable` and `v_coffee_dimension_range` filter superseded rows and carry the new columns; Score Entry works with the merge button; `CATALOG.md` regenerated; `WHAT_WE_BUILT_DB.md` updated.

Closing report: Task 0 findings; constraint names changed to RESTRICT; the backfill date used and the legacy counts on test and prod; whether prod has cupping rows for coffee 2891; any reader of `is_numeric` that needed a change; test results; the commit hashes.
