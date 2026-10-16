# Closing report: data catalog brief 2 (lint, `v_data_catalog`, `CATALOG.md`, System Health)

> Brief: `CLAUDE_CODE_PROMPT_DATA_CATALOG_2_LINT_AND_CATALOG_MD.md` · Executed 2026-10-16 · Not committed, not deployed (waiting for Dana's go-ahead)

## Change of decision: no strict mode (Dana, 2026-10-16, after Task 0)

The brief specified a `CATALOG_LINT_MODE` switch: `report` (log and continue) or `strict` (fail the boot). **Dana removed it before any code was written.** As built:
- There is no `CATALOG_LINT_MODE` anywhere. The boot check always reports, to the boot log and the System Health card, and never calls `process.exit`.
- All four checks are `severity: 'info'`.
- The brief's strict-mode test became a report-mode test asserting the same things: checks 1 and 3 have zero findings; check 2 has exactly the 84 `UNVERIFIED` objects; check 4 passes against a temporary `CATALOG.md` rendered from the test DB.

The folder `README.md` ("Lint posture, revised the same day") and brief 3 were updated to match on 2026-10-16 (13:47, not by this brief): brief 3's one-writer rule is now enforced in CI only (`lint:lineage`), and the boot check reports it as info. Nothing in the catalog stops a boot.

Task 0 also settled two smaller points (Dana: "B and C as recommended"):
- **B. Test assertions.** The test reports exactly the dictionary's state instead of demanding zero findings, because the 84 `UNVERIFIED`s are real and Dana resolves them later.
- **C. Getting `CATALOG.md` into the image.** The Docker build context is `./backend` and `CATALOG.md` is at the repo root. deploy.yml's existing "Build & push image" step gained one line, `cp CATALOG.md backend/CATALOG.md`, and the Dockerfile copies it with a glob (`COPY package.json CATALOG.m[d] ./`), so a local build without the file still works and check 4 reports `skipped`. `backend/CATALOG.md` is gitignored.

## What was built

| Part | Where | Notes |
|---|---|---|
| A | `schema.sql`, after the roastery portal block and before the A2 grant loops | **`v_data_catalog`**: `object_type`, `table_name`, `column_name`, `data_type`, `is_nullable`, `comment`, `purpose`, `class`, `writer`, `readers`, `since`, `is_unverified`, plus **`ordinal_position`**. That column is an addition to the brief, so `CATALOG.md` lists columns in table order (0 for table and view rows). Its source is `pg_class`/`pg_attribute`/`obj_description`/`col_description`. `pg_views` turned out to be unnecessary, because `pg_class` with relkind `v` covers views. **`v_data_view_dependency`**: (`view_name`, `depends_on`, `depends_on_type`) from `pg_depend` on `pg_rewrite`. Both views use `CREATE OR REPLACE`, so their own comments survive every boot, unlike the 48 drop-and-recreate views (see closing report 1). `ab_app` gets SELECT through the A2 view loop; `reporting_ro` gets an explicit GRANT. Their comments are in `comments.sql`. |
| B | `services/dataCatalogIntegrity.ts`, wired in `index.ts` after the customer checks | 1: uncommented objects. 2: `UNVERIFIED` comments. 3: table/view comments that do not parse into exactly Purpose, Class, Writer, Readers, Since with an allowed Class. 4: `CATALOG.md` hash against the live hash (`skipped` when the file is absent; `stale` on mismatch). Same `CatalogIntegrityCheck` shape as the other checks. Boot logs one summary line plus one line per check with findings, naming at most 50 objects. Never throws out of the boot (`Data catalog check error (non-fatal)`). |
| B (shared) | `services/dataCatalogQueries.ts` | `parseRelationComment()`, `fetchCatalogRows()`, `fetchViewDependencies()`, `computeCatalogHash()` (sha256 of the sorted `type\ttable\tcolumn\tcomment` lines, so it is order-independent and comment-sensitive), `readCatalogMdHash()`. The boot check, the generator and System Health all use these. |
| C | `services/dataCatalogMd.ts` (pure renderer), `scripts/catalogMd.ts`, `npm run catalog:md` | `--expect-db` guard (default `axisandbloom_test`), `--out`. First line marks the file as generated. Header line gives date, database, counts, UNVERIFIED count, "lint: report only" and the short hash. Then the "Read before proposing a new table" rule, the Firestore block verbatim from `comments.sql`, tables by class (master, fact, operating, snapshot, deprecated, alphabetical within each) with a column table each, views with `reads:`, the brief 3 insertion point, and the `catalog-hash:` footer. **Determinism:** the brief wants both a generated-on timestamp and "same DB, same bytes". These were reconciled by making the timestamp a UTC date, and by having the generator leave an existing file untouched when its hash already matches. A second run printed `already matches … left untouched`. |
| D | `routes/admin.ts` `GET /api/admin/system-health`; `AdminSystemHealth.tsx` | JSON gains `dataCatalog: { ranAt, counts{tables, views, columns, unverified}, catalogMdStale, checks[{id, name, pass, actual, objects}] }`. There is no `mode` key, since modes were removed. If the checks themselves error, the section returns `{ error }` and the rest of the page still loads. A "Data catalog" card in the existing card style shows four counts, a "report only" badge, and one row per check; rows with objects open a `<details>` list. |
| E | tests, `deploy.yml`, `CLAUDE.md`, docs | See below. |

## Boot log excerpt

There is no strict run to show, because strict mode no longer exists. The excerpt below is from a real local boot (`npx tsx src/index.ts`, `DATABASE_URL` and `OWNER_DATABASE_URL` pointing at `axisandbloom_test`, port 4917, stopped after the lines appeared):

```
DB schema verified
[db-roles] schema applied as axisbloom; request pool is ab_app
[db-comments] applied 1200 statements
[quiz-integrity] check #10 failed — No newsletter_subscriber (with a linked quiz_session) disagrees with their latest scored archetype: … got 1 mismatch(es)
[data-catalog] report only: 115 tables, 50 views, 1035 columns; 1 of 4 checks with findings
[data-catalog] check #2 No comment is UNVERIFIED: 84 UNVERIFIED — coffee_archetype.is_active, coffee_sku.cost_to_us, coffee_sku.coffee_type, coffees.roast_shade, cupping_brew_params, … (+34 more)
Axis & Bloom API running on port 4917
```

- 1,200 statements were applied: brief 1's 1,198 plus the two new views.
- Checks 1, 3 and 4 have no line because they pass. Check 4 matched the repo-root `CATALOG.md`, which local dev finds at `../../../CATALOG.md`.
- `[quiz-integrity] #10` is the standing OT-32 finding and is unrelated to this brief.

## The first generated `CATALOG.md`

- **Counts:** 115 tables (14 master, 15 fact, 77 operating, 5 snapshot, 4 deprecated), 50 views, 1,035 table columns, 84 UNVERIFIED.
- **Size:** 2,832 lines, 214 KB.
- **catalog-hash:** `4779a3d7a148d8406341bc65f4939ccaba411c0ef1714975c5fab0b2381a35f9`

**Where it was generated from, and why.** The brief's generator reads `v_data_catalog`. That view does not exist in production until this brief deploys, and the file's hash must include the two new views and their comments. Generating from production before the deploy would therefore produce a file that is stale the moment the deploy lands. Instead:
1. `axisandbloom_test` was re-cloned from production today.
2. This brief's `schema.sql` and `comments.sql` were applied to it.
3. `CATALOG.md` was generated from it.

That database matches what production will be after this deploy. The header honestly says `from database axisandbloom_test`. **After the deploy**, `npm run catalog:md -- --expect-db axisandbloom` should print `already matches … left untouched`, and the boot log should show no check #4 line. Both get confirmed then.

## System Health JSON excerpt

Produced by the same function the route calls, against the test DB, with the object list cut to 3 entries here:

```json
{
  "dataCatalog": {
    "ranAt": "2026-10-16T17:58:32.151Z",
    "counts": { "tables": 115, "views": 50, "columns": 1035, "unverified": 84 },
    "catalogMdStale": false,
    "checks": [
      { "id": 1, "name": "Every table, view and table column has a comment", "pass": true, "actual": "0 uncommented", "objects": [] },
      { "id": 2, "name": "No comment is UNVERIFIED", "pass": false, "actual": "84 UNVERIFIED",
        "objects": ["coffee_archetype.is_active", "coffee_sku.cost_to_us", "coffee_sku.coffee_type", "… 81 more"] },
      { "id": 3, "name": "Every table and view comment has Purpose | Class | Writer | Readers | Since with an allowed Class", "pass": true, "actual": "0 malformed", "objects": [] },
      { "id": 4, "name": "CATALOG.md matches the live database", "pass": true, "actual": "hash match", "objects": [] }
    ]
  }
}
```

## Tests, CI, docs

- **`dataCatalogQueries.test.ts`** (no DB query), 10 tests:
  - parser: well-formed, UNVERIFIED prefix, colons inside a value, and five malformed shapes;
  - hash: 64-char hex, order-independent, changes on a comment edit, an added object or a renamed column;
  - renderer: deterministic, hash footer readable by the boot check, insertion point present, `|` escaped in cells, `reads:` line;
  - Firestore block extraction.
- **`dataCatalogIntegrity.test.ts`** (test DB), 2 tests, both report mode:
  - On a full production clone: every check is `info`; checks 1 and 3 have zero findings; **check 2 lists exactly the 84 `UNVERIFIED` objects in `comments.sql`**; check 4 passes against a `CATALOG.md` rendered from the same DB.
  - A stale file is reported `stale`; no file is reported `skipped`.
- **Brief 1's tests** (`comments.format.test.ts`, `comments.db.test.ts`) still pass with the two new view comments: 23 of 23 across the four data-catalog files.
- **Other checks:** backend `tsc --noEmit` clean. Frontend `tsc` shows the same 13 known errors (none in `AdminSystemHealth.tsx`), and `vite build` passes. `lint:catalog`, `lint:customer`, `lint:retention` and `lint:roastery-portal`: all exit 0.
- **Full suite** (`npx vitest run`): 97 files, 1,143 tests, 29 failed. **In `src/`:** the 6 known `quizScoring.test.ts` failures (OT-19), plus **5 new ones that come from the re-cloned test DB, not from this brief**: `routes/newsletter.test.ts` (1b) and 4 in `services/quizResultsView.test.ts`. All 5 fail with `null value in column "unsubscribe_token" of relation "newsletter_subscriber" violates not-null constraint`. Production has had `ALTER COLUMN unsubscribe_token SET NOT NULL` since #211 migration step 3, applied by hand and never added to `schema.sql` (which still has a nullable `ADD COLUMN … unsubscribe_token TEXT`). The old test-DB clone predated that step. Today's re-clone (see the incident below) carries production's constraint, and those two test files insert subscribers without a token. **Fixed in this commit (Dana, 2026-10-16), see "Drift found" below.** After the fix, the two files plus the four data-catalog files ran 45 of 45 green; the full suite was not re-run after the fix. **The other 18 failures** are stale compiled `dist/` copies (OT-36), now including `dist/` copies of the same two files.
- **`deploy.yml`:** no new step, with a comment where the lints run explaining why (the lint needs a database). There is one `cp` line in the existing build step (C above).
- **`CLAUDE.md`:** new at the repo root. It holds the decision 3 rule in Dana's words, plus "comments go in `comments.sql`", "never hand-edit `CATALOG.md`" and what the boot check reports.
- **`WHAT_WE_BUILT_DB.md`** (decision 5): `## Database Schema (69 Tables)` became `## Database Schema` with a one-line pointer to `CATALOG.md`. In the Catalog, Quiz content, Customer and Roastery portal sections, each ownership table is replaced by `Ownership is generated now: see CATALOG.md.` That is five table blocks, because the Quiz content section has two (content ownership, and the 4B interpretation layers). The prose around them is unchanged.
- **`WHAT_WE_BUILT.md`:** #221. It also carries brief 1's deploy facts, which were left on disk for this commit per Dana.

## Drift found: `newsletter_subscriber.unsubscribe_token` (fixed in this commit)

- **The drift.** Production has had `unsubscribe_token` NOT NULL since 2026-10-01, when #211 migration step 3 was run by hand. `schema.sql` still created it nullable, with a comment saying SET NOT NULL is "never on boot". So a fresh database built from `schema.sql` differed from production. The fresh clone made this visible, as 5 test failures.
- **`schema.sql`.** After the unique index, a `DO` block applies `ALTER COLUMN unsubscribe_token SET NOT NULL` only when no row has a NULL token; otherwise it raises a NOTICE and leaves the column alone, so it can never fail a boot. On production it is a no-op, since the column is already NOT NULL. The old comment is rewritten to record the drift. `globalSetup` applied `schema.sql` twice with no error.
- **`services/quizResultsView.test.ts`.** The crawl fixture now inserts each subscriber with a token minted the way `newsletter.ts` does (`randomBytes(32).toString('hex')`). That fixes 4 tests.
- **`routes/newsletter.test.ts` (1b).** A fixture token cannot fix this one: it tested "a pre-backfill row with no token gets one on its next subscribe", a row that can no longer exist. It is rewritten to pin the constraint instead: setting the token to NULL is refused with the not-null error, and the row keeps its 64-hex token. This changes the test's intent, which is why it is called out here.
- **CATALOG.md is not affected.** The hash covers names and comments, not nullability, and the test DB clone already had the constraint, so the file already says `no` for that column. A regenerate against the test DB printed `left untouched`.

## Incident during this brief: test database emptied, then restored

- **What happened.** To make the test DB an exact production clone, I ran the project's own `npm run test:db:refresh`. It deleted and recreated `axisandbloom_test`, then **failed at import** with `ERROR: must be member of role "axisbloom"`. The dump ends with statements for role `axisbloom`, most likely the default-privilege grants from Customer Blueprint C1. `gcloud sql import sql` runs as Cloud SQL's default import user, which is not a member of that role. The script was last changed 2026-09-16, before C1, so this bug predates this brief. Result: an empty test DB, and the script's prod dump (real user data) left in `gs://axis-bloom-db-transfers/test-db/`.
- **What I did.**
  1. Deleted that dump at once (`gcloud storage rm`); the prefix is empty.
  2. Re-ran the same steps by hand, adding `--user=axisbloom` to the import: export, delete DB, create DB, import, then delete the new dump at once (verified the prefix is empty again).
- **Result.** `axisandbloom_test` has 115 tables, 48 views (before this brief's two) and 1,035 columns, all commented, including `newsletter_subscriber_backup_20260925`, which the old clone lacked.
- **Fixed in this commit (Dana, 2026-10-16).** `scripts/refresh-test-db.mjs` now passes `--user=axisbloom` to `gcloud sql import sql`, with a comment explaining why.
- **Transfer bucket confirmed empty.** `gcloud storage ls -r gs://axis-bloom-db-transfers/` lists nothing: no production dump remains, from either the failed run or the manual re-clone.

## Not done

- Production verification: boot log on the next revision, and `catalog:md --expect-db axisandbloom` reporting `left untouched`. Pending commit and deploy.
- The 84 `UNVERIFIED`s (check 2 will list them on every boot until they are resolved).
