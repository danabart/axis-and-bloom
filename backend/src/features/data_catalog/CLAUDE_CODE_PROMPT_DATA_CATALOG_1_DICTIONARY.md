# Data catalog, brief 1: the data dictionary (`COMMENT ON` for everything)

> Folder: `backend/src/features/data_catalog/` · Decided: 2026-10-13 to 2026-10-16 (Dana) · Model: Sonnet is fine
> Status: EXECUTED 2026-10-16, commit `6df9260`, deployed as revision `axis-bloom-backend-00750-2hj` (boot log `[db-comments] applied 1198 statements`). Closing report: `CLOSING_REPORT_1.md`.
> Read `README.md` in this folder first. No schema change in this brief: no table, column, view, index or grant is created, altered or dropped. Only `COMMENT ON` statements and one boot step that applies them.

## What this is

Every table, view and table column in the Cloud SQL database gets a description stored in the database itself (`pg_description`), written from what the code and the project docs already say about it. Postgres `COMMENT ON` is the storage; Dataplex / Knowledge Catalog will show these as descriptions once Dana enables the Cloud SQL integration; brief 2 lints that none are missing and generates `CATALOG.md` from them.

## Decisions already made (Dana). Do not re-open.

1. All comments live in ONE file, `backend/src/db/comments.sql`, grouped by table in the same order as `schema.sql`. Not scattered next to the DDL in `schema.sql`. Applied at boot right after `schema.sql`, same owner pool, fully idempotent (`COMMENT ON` replaces; nothing else to do).
2. Table and view comment format, one line, fields in this order, `|` separated:
   `Purpose: <one sentence> | Class: <master|fact|operating|snapshot|view|deprecated> | Writer: <service.function, seed, backfill, or "none (derived)"> | Readers: <views/services, or "none"> | Since: <brief or date>`
   Class follows the naming convention already in force (`WHAT_WE_BUILT_DB.md`, Customer ownership table): `coffee_*` master, `customer_*` fact, no prefix operating, `quiz_backup_*` snapshot, views view.
3. Column comment format: one sentence on meaning and unit; add `| Writer: <x>` only when the column's writer differs from the table's (e.g. `quiz_session_interpretation.valid_to`, written only by `closeCurrentInterpretation`). Enum and CHECK values are listed when they exist.
4. View columns are NOT commented (they inherit meaning from the view comment and the base columns). Lint in brief 2 requires: every table, every view, every table column.
5. Anything the code and docs do not settle gets the exact word `UNVERIFIED` at the start of the comment text. Never guess silently. The closing report lists every `UNVERIFIED` so Dana fixes only those.
6. Sources, in priority order: (a) the ownership tables and per-table text in `WHAT_WE_BUILT_DB.md`; (b) the closing reports and briefs under `backend/src/features/**`; (c) the SQL in `schema.sql` itself (constraints, CHECKs, FKs, column names); (d) the TypeScript that reads or writes the object. Where (a) and (d) disagree, the code wins and the comment says `(docs say X, code does Y)`.
7. Firestore has no schema to comment on. Its collections get the same one-line format in a hand-maintained block at the top of `comments.sql` as SQL comments (`-- firestore: <collection> | Purpose ... | Writer ... | Readers ...`), inventoried from `collection('...')` / `.doc(` calls in `backend/src`, `frontend/src` and `cloud-functions`. Brief 2's generator copies that block into `CATALOG.md`.
8. The existing `COMMENT ON COLUMN` lines for the five deprecated `coffee_sku` stock columns (`schema.sql`, 2026-09-30) move into `comments.sql` unchanged in wording, prefixed `Class: deprecated`. They are the only comments that exist today.

## Task 0 (report, read-only, before any write)

- Count of tables, views and table columns in schema `public` from `information_schema`, against production (`--expect-db` discipline as in `backfillQuizInterpretation.ts`). Report the numbers; these are the targets.
- Count of objects that already have a comment (`pg_description`). Expected: the five stock columns only.
- List every table not mentioned anywhere in `WHAT_WE_BUILT_DB.md` (grep by name). These are the ones most likely to end up `UNVERIFIED`; report them up front.
- List every Firestore collection name found in code, with the file that writes it and the files that read it.
- Confirm `backend/src/index.ts` applies `schema.sql` through the owner pool (the C1 Part B block) and report the exact line where `comments.sql` will be applied next.

STOP only if `pg_description` already holds comments beyond the five stock columns (someone started this by hand); report and wait.

## Part A: write `comments.sql`

- One `COMMENT ON TABLE` / `COMMENT ON VIEW` per object, one `COMMENT ON COLUMN` per table column, in `schema.sql` order, each table's block headed by `-- ── <table> ──`.
- Dollar-quote every comment (`$c$...$c$`) so apostrophes in prose never break the file.
- Objects dropped by earlier briefs do not appear. Objects that exist in prod but not in `schema.sql` (if Task 0 finds any) get a comment starting `UNVERIFIED: not in schema.sql` and are listed in the closing report.
- Length: a table comment is one line; aim for under 300 characters. Detail belongs in `WHAT_WE_BUILT_DB.md`, not in the comment.

## Part B: apply at boot

- In `backend/src/index.ts`, right after `schema.sql` is applied and before any integrity check: read `db/comments.sql`, run it on the same owner pool, log `[db-comments] applied N statements`. A failure here logs and continues (same posture as the `[db-roles]` warning); it must never stop the boot.
- Also add `npm run db:comments` (`tsx src/scripts/applyComments.ts`) so the file can be applied by hand after a comment edit without a deploy.

## Part C: tests

- A vitest that parses `comments.sql` and asserts every statement matches the format in decisions 2 and 3 (field order, allowed `Class` values, no empty field). It runs without a database.
- A vitest against the test database (`axisandbloom_test`, the existing pattern) that applies `schema.sql` then `comments.sql` and asserts zero uncommented tables, views and table columns. This is the same query brief 2 will lint with; put it in `src/services/dataCatalogQueries.ts` so brief 2 reuses it.

## Closing report (`CLOSING_REPORT_1.md` in this folder)

- Task 0 numbers before, and the same numbers after (expected: 100 percent commented).
- Every `UNVERIFIED` comment, as a table: object, what was unclear, where Dana should look.
- Every place docs and code disagreed (decision 6).
- The Firestore inventory.
- One paragraph for `WHAT_WE_BUILT.md` (next number) and one "As of" line for `WHAT_WE_BUILT_DB.md` saying comments now exist and where they live.

## Do not

- Do not change any DDL, grant, seed or data. Do not touch `schema.sql` except to remove the five stock-column `COMMENT ON` lines moved to `comments.sql`.
- Do not write comments into `WHAT_WE_BUILT_DB.md`; the comment file is the source now.
- Do not invent a purpose for a table you cannot trace; use `UNVERIFIED`.
