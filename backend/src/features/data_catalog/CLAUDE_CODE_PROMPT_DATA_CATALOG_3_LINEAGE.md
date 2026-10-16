# Data catalog, brief 3: lineage (who writes, who reads), one-writer rule, table activity

> Folder: `backend/src/features/data_catalog/` · Decided: 2026-10-16 (Dana) · Model: Sonnet is fine
> Status: NOT EXECUTED · Depends on brief 1 (comments carry the declared `Writer:`); brief 2 is expected but not required (if brief 2 has not run, write the lineage sections to `LINEAGE.md` in this folder instead of `CATALOG.md`, and skip the System Health part). Decided 2026-10-16: no strict mode, nothing at boot ever exits; the one-writer rule blocks in CI only
> Read `README.md` in this folder first.

## What this is

Dana, 2026-10-13: "I don't have control who is writing to what, who is reading from what, and eventually everything impacts the data integrity." This brief makes that visible from two independent sources and enforces the one rule that matters:

- **Declared**: what each table's comment says its writer is (brief 1).
- **Static**: what the code actually does, from a scan of every SQL string in `backend/src` (plus `cloud-functions`).
- **Observed**: what actually ran against the database, from `pg_stat_statements` with `application_name` set per pool, and `pg_stat_user_tables` for tables nobody touches.

The one-writer rule: every table has exactly one writer. Declared and static must agree. A second, undeclared writer fails `npm run lint:lineage`, which `deploy.yml` runs before the build, so the push never reaches production. Nothing at boot exits (decided 2026-10-16: no strict mode anywhere).

## Decisions already made (Dana). Do not re-open.

1. The one-writer rule is enforced in CI only (`lint:lineage` in `deploy.yml`, exit 1). The boot check in `dataCatalogIntegrity.ts` reports it as `severity: 'info'` like every other check; the boot never exits. There is no `CATALOG_LINT_MODE`.
2. A "writer" is a file (service module) that holds an `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` or `COPY` against the table, or calls a SQL function that does (the `quiz_assert_*` / `quiz_retire_answer` family; list them explicitly). `schema.sql` seeds and `backend/scripts/*` backfills are writers too, named `seed` and `backfill:<script>`; a table may declare `Writer: <service>; seed` to allow both, and that counts as one declared set, not two writers.
3. A "reader" is any file with a `SELECT ... FROM|JOIN <table>` on the table or on a view that depends on it (`v_data_view_dependency`, brief 2). Readers are informational; no rule limits them. The existing per-domain lints (`lint-catalog` rule on reading tables instead of views, etc.) keep their own stricter rules untouched.
4. `application_name` per pool: `axis-bloom-backend` for `db` (the request pool), `axis-bloom-backend-owner` for `ownerPool()`, `script:<basename>` for anything under `backend/scripts` and `backend/src/scripts`, `cloud-function:<name>` for cloud functions. Set via the `application_name` option on `new Pool(...)`, not via the connection string, so Cloud SQL socket URLs stay as they are.
5. Observed data is advisory. It needs `pg_stat_statements` (Dana's console flag) and resets on instance restart, so it is reported with its `stats_reset` timestamp and never used to fail anything.
6. The deprecated stock columns rule (`lint-catalog` rule 6) and every existing lint stay as they are. This brief does not replace them; it is the general case over every table.

## Task 0 (report, read-only)

- `SHOW shared_preload_libraries` includes `pg_stat_statements` and `SELECT * FROM pg_extension WHERE extname='pg_stat_statements'` returns a row. If the flag is on but the extension is missing, create it (`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`, owner pool, in `schema.sql`, idempotent). If the flag is off, STOP after Parts A and B and report; Parts C and D need it.
- Every table's declared `Writer:` field from `v_data_catalog` (or from `comments.sql` if brief 2 has not run).
- The list of every `.ts`/`.mjs` file under `backend/src`, `backend/scripts`, `cloud-functions` that contains a SQL verb against a table (first pass of the scanner, dry). Report tables with more than one static writer NOW, before enforcement, so Dana sees the real state up front. Expected offenders are the ones `WHAT_WE_BUILT_DB.md` already admits (e.g. `user_bloom_dial_current_position`, `newsletter_subscriber`, `sommelier_evaluation` with two writer modules).

STOP and report after Task 0 if more than ten tables have two or more static writers. Dana decides whether to declare or to fix before enforcement turns on.

## Part A: the scanner, `scripts/lineage-scan.mjs`

- Same style as `lint-catalog.mjs` (no deps, plain file walk, `.test.ts` and `db/migrations` excluded, `db/seeds/_retired` excluded).
- Finds SQL in template literals and strings; resolves table names after `INSERT INTO`, `UPDATE`, `DELETE FROM`, `TRUNCATE`, `FROM`, `JOIN`, `COPY` (quoted identifiers like `"order"` handled). Calls to the SQL write functions in decision 2 count as writes to the tables those functions write (hardcode the map, with a comment pointing at `schema.sql`).
- Output `backend/lineage.json`: `{ generated_at, tables: { <table>: { writers: [{file, verbs}], readers: [{file, via_view?}] } } }`. Deterministic ordering.
- Rules (exit 1 on failure, print `file:line  message`, CI-quiet when clean):
  1. **One writer.** Static writers of a table, as a set of modules, must equal the declared set in the table's comment. Extra static writer = failure. Declared writer with no static writer = warning (dead door).
  2. Any table with zero static readers and zero view readers = warning (dead table candidate).
- `npm run lint:lineage`; added to `deploy.yml` next to the other four lints (it needs no database: it compares code against `comments.sql`, parsing the `Writer:` field from the file, not from the DB).
- A vitest wrapper like `lintCatalog.test.ts` so `npm test` runs it.

## Part B: `application_name`

- `backend/src/db/client.ts`: both pools get `application_name` per decision 4. Scripts and cloud functions that build their own pool get `script:`/`cloud-function:` names; grep for every `new Pool(` to find them.
- A boot log line `[db] application_name=axis-bloom-backend` so it is visible in Cloud Run logs.

## Part C: observed lineage and activity (needs `pg_stat_statements`)

Two views in `schema.sql`, SELECT to `ab_app` and `reporting_ro`:

- `v_data_lineage_observed`: from `pg_stat_statements` joined to `pg_stat_statements_info` for `stats_reset`: `application_name` is not stored there, so use the `userid` + a parse of the query text for the table name and verb; one row per `(table_name, verb, application_name_or_role, calls, last_seen = now())`. If parsing `pg_stat_statements.query` for the table name proves unreliable, fall back to per-role only and say so in the closing report. Do not spend more than a bounded effort on the parser; advisory data (decision 5).
- `v_data_table_activity`: from `pg_stat_user_tables`: `table_name, n_tup_ins, n_tup_upd, n_tup_del, seq_scan, idx_scan, last_autoanalyze, stats_reset`, plus `is_dead_candidate` = no inserts, updates, deletes or scans since the reset and the reset is older than 30 days.

## Part D: surfaces

- `CATALOG.md` (brief 2's insertion point): a "Lineage" section per table (declared writer, static writers, static readers, views that read it) and an "Activity" section (dead candidates first, then the rest, with `stats_reset`). The generator reads `lineage.json` and the two views.
- `dataCatalogIntegrity.ts` gains check 5, one writer (`info`, same finding as the CI rule, so System Health shows it too), computed from `lineage.json` shipped in the image against `v_data_catalog`'s `writer` field, and check 6, dead-table candidates (`info`).
- System Health "Data catalog" card gains: tables with more than one writer (red), declared writers with no code (amber), dead candidates (grey), and the `stats_reset` date. Same `/system-health` JSON, under `dataCatalog.lineage`.

## Closing report (`CLOSING_REPORT_3.md`)

- Task 0's real multi-writer list and what was done with each (declared in the comment, or fixed in code, or left failing and why).
- `lineage.json` summary: tables, writers, readers, dead candidates.
- Whether observed lineage parsed table names or fell back to per-role.
- `WHAT_WE_BUILT.md` entry; one "As of" line in `WHAT_WE_BUILT_DB.md`.

## Do not

- Do not fix a multi-writer table by deleting one writer's code without saying so in the report; declare or fix, and list it.
- Do not use the Dataplex Data Lineage API; it bills premium processing and does not see Cloud Run anyway.
- Do not make observed data (Part C) fail anything, ever.
