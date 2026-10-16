# Closing report: data catalog brief 3 (lineage, one-writer rule, table activity)

> Brief: `CLAUDE_CODE_PROMPT_DATA_CATALOG_3_LINEAGE.md` · Executed 2026-10-16 · Not committed, not deployed (waiting for Dana's go-ahead)

## Task 0, the stop, and Dana's decisions

Task 0 (read-only) found:
- **`pg_stat_statements`:** in `shared_preload_libraries` on production, but no row in `pg_extension` (version 1.10 available). Part C creates it.
- **Declared writers:** read for all 115 tables from `v_data_catalog`.
- **Dry scan:** a throwaway prototype found 50 files with write verbs and **16 tables with two or more app writer modules** (33 counting seeds and backfills). That is over the brief's threshold of ten, so it stopped and reported.

Dana decided (2026-10-16):
1. **Set match.** A table's static writer modules must equal its declared set. Today's multi-writer tables pass once declared, and any *new* undeclared writer fails CI. They are recorded below as "declared, candidates to consolidate", with `user_profile` and `coffees` first.
2. **Writer format.** `module.function` entries separated by commas, groups separated by semicolons: `Writer: catalogService.createCoffee, catalogService.updateCoffee; seed; backfill:migrateSavedItems`. Only the module part (before the dot) is compared, so function names stay for humans and `CATALOG.md`. The ~50 non-conforming fields were to be rewritten into real module names.
3. **Two scanner additions.**
   - The probe marker `// lineage: probe, not a write`, on the statement's line or the line above, with every use reported in `lineage.json`.
   - `customerFacts.insertFact(…, 'customer_x')` counted as a write by `customerFacts`.

## The multi-writer tables: what was done with each

**All were declared** (decision 1). Nothing was fixed in code, and no writer's code was deleted. The final count is **15**, not 16: `quiz_session` dropped out because its second "writer" was a probe (see "Probes" below).

| # | Table | App writer modules (static = declared) | Notes |
|---|---|---|---|
| 1 | `user_profile` | admin, auth, companyGiftRedemption, household, quiz, staleGuestCleanup, users (+ seed) | **Consolidate first.** 7 modules. `staleGuestCleanup` (DELETE of stale anonymous guests) was a writer **no earlier list named**: not brief 1's comment and not Task 0's table. The first real scanner run caught it, and it is now declared. |
| 2 | `coffees` | admin, catalogService, coffees, qrDoor (+ seed) | **Consolidate second.** `admin.PATCH /api/admin/coffees/:id/story`, the AI/story writers in `coffees.ts`, and `qrDoor.mintTokenForCoffee` all write outside `catalogService`. |
| 3 | `token_events` | auth, orders, tokenService (+ `manual:grant_tokens`) | The order bonus is inline SQL in `orders.ts`, not `tokenService.grantTokens` (which has no callers). |
| 4 | `user_tokens` | auth, orders, tokenService (+ `manual:grant_tokens`) | Same as `token_events`. |
| 5 | `dial_position_signal` | dialPositionSignal, dialSuggestion, orders (+ seed) | `orders` only supersedes a prior onsite row. |
| 6 | `company_gift_code` | companyGiftRedemption, companyGiftsAdmin, cron | Mint, redeem, expire. |
| 7 | `sommelier_evaluation` | outcomeTracker, sommelier, sommelierEvaluator | |
| 8 | `newsletter_subscriber` | newsletter, unsubscribe (+ seed, `backfill:backfillUnsubscribeTokens`, `backfill:correct-subscriber-archetypes`) | |
| 9 | `beat_event` | beatEngine, cron (+ `backfill:backfill-beat-respond-tokens`) | |
| 10 | `roaster` | admin, catalogService | `admin` creates and edits; `catalogService` deactivates and reactivates. |
| 11 | `sommelier_sms_feedback` | cron, liamSmsFeedback | |
| 12 | `subscription` | companyGiftRedemption, cron | |
| 13 | `transactional_email_log` | newsletter, roasteryPortalNotify | |
| 14 | `user_brew_card` | brewCard, cron | |
| 15 | `user_email` | auth, users | |

**Probes.** `customerIntegrity.ts:145` runs `UPDATE quiz_session SET id = id WHERE false`. It is a grant probe that changes no row. It carries the marker and is listed in `lineage.json` → `probes` and in `CATALOG.md`.

**The Writer field rewrite.** 76 of the 115 table `Writer:` fields changed:
- **Kept:** brief 1's wording, including its parentheticals, wherever its module really writes the table.
- **Added:** entries generated from the scan (module plus enclosing function, with routes given their full `/api/...` path) for writers it did not name.
- **Dropped:** fragments that named no module (`+4 more`, `household routes`, bare function names), plus retired or migration-only sources.
- **Normalized:** seeds became `seed`; scripts became `backfill:<script>`; the SQL function run by hand became `manual:grant_tokens`. The scanner never expects `manual:` in code.
- **`catalog_change`:** now declared as `customerFacts.catalogChange (via catalogService.logCatalogChange, …)`, because that is where its SQL lives.

**Hard stop on table comment length.** Keeping every function name makes four table comments longer than brief 1's own 600-character hard stop: `user_profile` 784, `coffees` 704, `coffee_slot_assignment` 662, `roastery_portal_coffee` 626. The stop was raised to 1000; the brief's aim of under 300 is unchanged.

## `lineage.json` summary (`npm run lint:lineage`, 2026-10-16)

| | |
|---|---|
| Tables | 115 (99 with a static writer, 16 with none) |
| Writer modules | 41 (36 app modules, `seed`, 4 backfill scripts) in 49 files |
| Readers | 820 file→table edges from 65 files; 90 tables read directly in code, 2 more only through views |
| Undeclared writers (rule 1, fails CI) | **0** |
| Multi-writer tables (declared) | 15 (above) |
| Dead doors (warning) | 1: `newsletter_subscriber_backup_20260925`. Its script creates the table through a variable (`CREATE TABLE ${BACKUP_TABLE} AS`), which a static scan cannot resolve. |
| Dead table candidates (warning) | 23: `archetype_relationship`, `archetype_tunable_variable`, `cupping_brew_params`, `cupping_note_dimension_weight`, `customer_order_kind`, `liam_sms_feedback`, `newsletter_subscriber_backup_20260925`, `notification_log`, the four `quiz_backup_20261008_*`, `quiz_vector`, `roastery_blend_vector`, `roastery_shipment_details`, `sensory_lexicon_attribute`, `sensory_source`, `user_archetype_tuning`, `user_coffee_profile`, `user_lifecycle_event`, `user_payment_detail`, `user_roaster_link`, `user_vector_state` |
| Probes | 1 (above) |

How the scanner works:
- **No dependencies, no database.**
- **Scope:** walks `backend/src`, `backend/scripts` and `cloud-functions`; tests, `db/migrations`, `db/seeds/_retired` and `db/functions` are excluded.
- **Comment masking uses a small lexer, not a regex.** During this brief a regex masker let a `/*` inside a string blank out real code, which hid 8 of `catalogService.ts`'s `coffee_slot_assignment` writes. A test now plants that exact case.
- **Ambiguous names fail.** If two app files with the same name both write tables, the scan fails rather than merging them.
- **Not committed.** `lineage.json` is gitignored. CI generates it, and the Docker build ships CI's copy for boot check 5.

## Observed lineage: table names parsed, no fallback

- **`v_data_lineage_observed`.** It parses table names from the normalized query text by regex: the INSERT/UPDATE/DELETE target, plus every FROM/JOIN as a SELECT. On the test DB it returned real per-table rows (for example `coffee_archetype_assignment SELECT axisbloom 1590 calls`), so the per-role-only fallback was not needed. Limits, all advisory (decision 5):
  - `pg_stat_statements` has no `application_name`, so the role stands in.
  - A caller without `pg_read_all_stats` sees only its own statements. That includes `ab_app`, which System Health uses.
  - CTE writes and dynamic SQL are approximate.
  - `pg_stat_statements_info.stats_reset` is **2026-05-21**: the library has been preloaded and collecting since then.
- **Where the extension lives.** It was created in its own schema, `extensions`, not `public`. In `public`, its two views would have been uncommented objects for brief 2's check 1. It is wrapped in `DO … EXCEPTION`: a database without it gets a NOTICE and no view, never a failed boot.
- **`v_data_table_activity`.** It reads `pg_stat_user_tables` plus the database `stats_reset`, and computes `is_dead_candidate` (no insert, update, delete or scan since a reset older than 30 days, or an unknown reset). **Caveat:** today's test-database clone ran a full export of production, which seq-scans every table. Production's observed dead-candidate list will therefore be empty until the next stats reset is 30 days old. The static list (23) is what says something today.

## `application_name` (Part B)

- **Pools:** `db` is `axis-bloom-backend` and `ownerPool()` is `axis-bloom-backend-owner`, both set through the Pool option. Connection strings are untouched.
- **Scripts:** any process launched from a `scripts/` folder (`backend/scripts` or `backend/src/scripts`) is `script:<basename>` on both pools, detected from the entry file, so no per-script edits were needed. The two scripts with their own pool (`audit-quiz-emails.mjs`, `refresh-test-db.mjs`) name themselves.
- **Cloud functions:** none touch the database (`image-optimizer` uses Storage only), so there is no `cloud-function:` name yet.
- **Boot log:** a new line, `[db] application_name=axis-bloom-backend (owner pool: axis-bloom-backend-owner)`.

## Surfaces (Part D)

- **Boot checks 5 and 6**, both `info`:
  - **Check 5, one writer:** `lineage.json` from the image compared with the live `Writer:` fields, the same comparison CI makes. A TS twin of the scanner's field parser is tested to agree with it on every table.
  - **Check 6, dead candidates:** static plus observed.
- **System Health** `dataCatalog.lineage` contains:
  - `multiWriter` (shown red on the card);
  - `undeclared`;
  - `deadDoors` (amber);
  - `deadCandidates` (grey, tagged static and/or observed);
  - `probes`;
  - `statsReset`;
  - `generatedAt`.
- **`CATALOG.md`:**
  - **Lineage:** one table row per table (declared modules, static writers with verbs, reader modules, views that read it) plus the probe list.
  - **Activity:** dead candidates (observed, then static), then every other table.
  - **Rewrites:** a second footer, `lineage-hash`, makes the generator rewrite the file only when static lineage or the dead/active split changes, never for live counts, which are on System Health. `--force` rewrites anyway.
  - **Activity is rendered only when generating from production.** The committed file was generated from the same-day production clone (`axisandbloom_test`), so its Activity section is a placeholder until it is regenerated from production after the deploy.

## Tests, CI, docs

- **New: `src/scripts/lineageScan.test.ts`** (4 tests):
  - the scan passes, with 0 undeclared writers, the probe listed, and `customer_*` written by `customerFacts`;
  - a planted second writer fails;
  - a planted probe is suppressed and listed;
  - a `/*` inside a string does not hide code.
- **Extended:**
  - `dataCatalogQueries.test.ts`: `declaredWriterModules` cases, plus agreement with the scanner on all 115 tables.
  - `dataCatalogIntegrity.test.ts`: six checks, all `info`; check 5 is empty against a freshly scanned `lineage.json`; check 6 covers every static dead candidate; check 5 is `skipped` without `lineage.json`.
  - `comments.format.test.ts`: the hard stop raised to 1000.
- **Results:** data-catalog tests 30 of 30. Backend `tsc` is clean. Frontend `tsc` shows the 13 known errors, none in `AdminSystemHealth.tsx`. Lints: `lint:catalog`, `lint:customer`, `lint:retention`, `lint:roastery-portal` and `lint:lineage` all exit 0.
- **Full suite:** `npx vitest run --no-file-parallelism` with `dist/**` excluded (Dana, 2026-10-16), proxy up: 54 test files, 683 passed, 6 failed. All six are the known `quizScoring.test.ts` failures (OT-19); nothing else failed. (A first, parallel run was stopped by Claude Code because the machine was critically low on memory; it was not a test failure.)
- **Schema checked on the test DB:** applied twice with no error, the extension created in `extensions`, and 0 uncommented objects after `comments.sql`.
- **`deploy.yml`:** a "Lint lineage" step next to the other lints, before the Docker build. The Dockerfile ships `lineage.json` with the same glob trick as `CATALOG.md`.
- **Docs:**
  - `CLAUDE.md` gained the one-writer rule and the Writer format (Dana's decisions only);
  - `WHAT_WE_BUILT.md` #222;
  - one "As of" line in `WHAT_WE_BUILT_DB.md`.

## Not done

- **Consolidating the 15 multi-writer tables** (decision 1: declared now, candidates later).
- **Production verification:** the boot log, `[db] application_name=…`, checks 5 and 6, and regenerating `CATALOG.md` from production so Activity fills in. Pending commit and deploy.
- **The 84 `UNVERIFIED`s from brief 1.**
