# Data catalog: dictionary, lint, lineage

> Decided 2026-10-13 to 2026-10-16 (Dana). Three briefs, run in order. Brief 3 can run before brief 2 if needed, but not before brief 1.

## Why

Dana, 2026-10-13: "I don't remember anything, and we keep adding more tables, more views, and it's already out of control. I don't have control who is writing to what, who is reading from what." `WHAT_WE_BUILT_DB.md` is hand-maintained and already drifts (its header says 69 tables; the real count passed 86 in September). The fix is a catalog that is the database describing itself, with a lint so an undescribed object or a second writer cannot ship unnoticed.

## The three briefs

| # | File | What it leaves behind |
|---|---|---|
| 1 | `CLAUDE_CODE_PROMPT_DATA_CATALOG_1_DICTIONARY.md` | `backend/src/db/comments.sql`: a `COMMENT ON` for every table, view and table column, applied at boot after `schema.sql`. Firestore collections inventoried in the same format. |
| 2 | `CLAUDE_CODE_PROMPT_DATA_CATALOG_2_LINT_AND_CATALOG_MD.md` | `v_data_catalog` view, `dataCatalogIntegrity.ts` boot check with `CATALOG_LINT_MODE`, `npm run catalog:md` generating `CATALOG.md` at the repo root, System Health card, CLAUDE.md rule. |
| 3 | `CLAUDE_CODE_PROMPT_DATA_CATALOG_3_LINEAGE.md` | `scripts/lineage-scan.mjs` (writer/reader map from code, one-writer rule enforced), `application_name` per pool, `v_data_lineage` + `v_data_table_activity` from `pg_stat_statements` / `pg_stat_user_tables`, lineage and dead-table sections in `CATALOG.md` and System Health. |

## Lint mode (decided 2026-10-16)

One lint, one switch. `CATALOG_LINT_MODE=report` (default, production today): findings go to the boot log and the System Health card, boot continues. `CATALOG_LINT_MODE=strict` (the dev environment when it exists): any finding fails the boot. The one-writer rule (brief 3) fails the boot in both modes; a second writer on a table is the drift we are preventing, not a documentation gap.

## Dana's console steps (not in any brief)

1. Cloud SQL instance → Dataplex / Knowledge Catalog integration → enable. One toggle. Reads table and view comments from brief 1 as descriptions. Do not create a "connector job" (that path bills Dataproc Serverless); the instance toggle is enough.
2. Cloud SQL instance → Flags → add `cloudsql.enable_pg_stat_statements = on`. Requires a restart. Brief 3 Task 0 checks this and stops if it is off.

## Division with `WHAT_WE_BUILT_DB.md`

`WHAT_WE_BUILT_DB.md` keeps the history and the why (as-of notes, decisions, useful queries). `CATALOG.md` is generated from the database and is the what, now. After brief 2 the hand-maintained ownership tables in `WHAT_WE_BUILT_DB.md` are replaced by one pointer line to `CATALOG.md`; nothing else in that file changes.
