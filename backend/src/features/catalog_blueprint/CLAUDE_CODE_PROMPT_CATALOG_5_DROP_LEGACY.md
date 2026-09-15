# Claude Code Prompt — Catalog Blueprint, Brief 5: drop the legacy, finish the names

**Series:** Catalog Blueprint (`README.md` in this folder). Brief 5 of 5. Depends on brief 4 (`a016140` + `dd79ef8`, deployed). After this brief the series is complete and the first roastery enters through the importer.

**Goal:** Remove every legacy placement table, view and column, so the model in the database is exactly the model in the Blueprint and nothing can silently fall back to old data; then rename the surviving catalog tables to the `coffee_` convention. Two deploys, in this order, each independently reversible until the next one lands: **Stage A** drops and tightens; **Stage B** renames.

**Why two stages:** dropping is irreversible in data but easy in code (nothing reads the legacy tables since brief 4); renaming is reversible in data but touches every file that names a table (~75 SQL sites across schema and code). Mixing them means a rename typo and a data drop in the same deploy. Separately, each one is a small, reviewable diff with a clean boot log between.

**Decisions already made — implement as stated, don't re-open:**
- N3: legacy placement rows are dropped, not migrated. Coffees, SKUs, cupping, stories, orders stay.
- Naming (Dana, 2026-09-13 + N8 2026-09-15): every catalog table/enum/view starts with `coffee_`. Renames in Stage B: `archetype` → `coffee_archetype`, `archetype_assignments` → `coffee_archetype_assignment`, `roaster_blend` → `coffee_sku`, `dial_coffee_relationships` → `coffee_hop`, `dial_slot_price` → `coffee_slot_price`, `v_archetype_adjacency` → `v_coffee_archetype_adjacency`. `coffees` stays `coffees`. Enum `archetype_enum` stays (it is a type, and renaming a type buys nothing).
- N9 (Dana, 2026-09-15): `coffees.roaster` (free text) is dropped in Stage A; `coffees.roaster_id` becomes NOT NULL.
- D3: stored `hop_type` is dropped; `v_coffee_hop.hop_type_derived` is the only hop type.
- Integrity check 13 flips from informational to failing once its subject no longer exists (it becomes "no legacy tables exist"), and the lint allow-list keeps only its permanent entries.

## Task 0 — Verify current state (confirm, don't assume)

Line numbers as of `dd79ef8`.

- `git log -1` is `dd79ef8` or a descendant; `origin/main` contains it; deploy green; `npm run lint:catalog` passes.
- Remaining legacy-table references in TS (non-test): `services/catalogIntegrity.ts` (5, check 13) · `services/catalogService.ts` (2, the `coffee_alias` cascade in deactivate/reactivate) · `services/dialSuggestion.ts` (1, the `(archetype, sort_order) → dial_position_vocabulary.id` mapping). Zero elsewhere. Confirm with the lint script's rule 3 pattern.
- `dial_position_signal` columns: `id, coffee_id, archetype, dimension_id, source, suggested_vocabulary_id, direction, raw_value, sample_size, confidence, computed_at, superseded_at, notes`. `suggested_vocabulary_id` references `dial_position_vocabulary(id)` (schema.sql ~L1722). `v_dial_position_consensus` (~L3063) is built on `dial_position_signal` + `dial_source_weight` and, via its `vocab_weights` CTE, on the vocabulary. Admin `GET /dial/consensus/:coffeeId` reads it.
- `coffees.roaster` (text) readers: `routes/admin.ts` L462 (session coffees list) and L1016 (story specificity check), `routes/cron.ts` L296, `services/beatEngine.ts` L154. `catalogService.createCoffee` writes it in sync with `roaster_id`.
- `roaster_blend.archetype_id` (UUID → archetype): written by nobody, read by nobody since brief 3 (confirm: 0 TS refs).
- Stored `dial_coffee_relationships.hop_type` (`hop_type_enum NOT NULL`): written by `catalogService.setHop` with the derived value; read only as `hop_type_stored` in `v_coffee_hop` and integrity check 10.
- Legacy views still defined: `v_dial_positions`, `v_dial_navigation` (0 readers), `v_dial_position_consensus` (1 reader, keep but rebuild).
- Table-context references to `archetype` (pattern `(FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|ON|EXISTS)\s+archetype\b`): 55 in `schema.sql`, 20 in TS across `index.ts`, `routes/quiz.ts` (7), `routes/sommelier.ts`, `routes/users.ts` (2), `services/behavioralConfidence.ts`, `catalogIntegrity.ts`, `catalogService.ts` (2), `quizIntegrity.ts` (3), `quizSession.ts`, `userSignals.ts`. The bare word `archetype` also appears ~490 times as a **column** name; the rename must never touch those.
- Other rename targets: `archetype_assignments` 25 refs / 14 TS files, 15 in schema; `roaster_blend` 53 / 13, 29 in schema (plus `order_line_item.blend_id` FK, `orders.ts` stock decrement, `chk_roaster_blend_deactivation_reason`, `roaster_blend_one_active_per_weight`); `dial_coffee_relationships` 11 / 6, 12 in schema; `dial_slot_price` 11 / 5, 9 in schema (`dial_slot_price_slot_weight_key`). Frontend references the *response fields* (`blend_id`, etc.), never table names; confirm with a grep of `frontend/src` for the five table names (expect only `bloom/types.ts` and `usePositionCardData.ts` mentioning `roaster_blend`/`archetype_assignments` in comments or field names, not queries).
- **Boot mechanics that make this brief dangerous:** `schema.sql` is applied whole at every boot with `CREATE TABLE IF NOT EXISTS <old name>`. If a table is renamed in the database but the `CREATE` in `schema.sql` still says the old name, the next boot recreates an **empty** table under the old name and the code that was pointed at the new name keeps working while the old one silently returns. Every rename below therefore (1) rewrites the `CREATE TABLE` to the new name and (2) precedes it with a guarded `ALTER TABLE … RENAME TO` that runs only when the old table exists and the new one does not. Every drop removes the `CREATE` block entirely and adds `DROP TABLE IF EXISTS … CASCADE`. Re-applying `schema.sql` twice must be a no-op both times.

## Stage A — Drop and tighten (one commit, one deploy)

### A1. Re-key the cupping signal before its vocabulary disappears

```sql
ALTER TABLE dial_position_signal ADD COLUMN IF NOT EXISTS suggested_slot_id INT REFERENCES coffee_dial_slot(id);
UPDATE dial_position_signal s SET suggested_slot_id = cds.id
FROM dial_position_vocabulary v JOIN coffee_dial_slot cds ON cds.archetype = v.archetype AND cds.sort_order = v.sort_order
WHERE s.suggested_slot_id IS NULL AND s.suggested_vocabulary_id = v.id;
-- then, in the same stage, after the app code below no longer reads it:
ALTER TABLE dial_position_signal DROP COLUMN IF EXISTS suggested_vocabulary_id;
```

Order inside `schema.sql`: the backfill must run **before** `DROP TABLE dial_position_vocabulary`. Put A1, then A2's drops, in that sequence. `services/dialSuggestion.ts` `recordCuppingSignal` writes `suggested_slot_id` (from `getSlots`) and its last legacy read is deleted. `v_dial_position_consensus` is rebuilt with `coffee_dial_slot` in place of the vocabulary CTE, same output columns, and renamed `v_coffee_dial_position_consensus` (it is catalog-side); admin `GET /dial/consensus/:coffeeId` selects from the new name.

### A2. Drop the legacy tables and views

Remove their `CREATE` blocks, their seeds (`dial_slot_alias` INSERTs ~L1620–1660, `dial_position_vocabulary` INSERTs ~L1944, `dial_archetype_config` INSERTs ~L1928), their `ALTER … ADD COLUMN IF NOT EXISTS` lines and their `DO $$ … CONSTRAINT` blocks from `schema.sql`, and add, after A1:

```sql
DROP VIEW IF EXISTS v_dial_positions;
DROP VIEW IF EXISTS v_dial_navigation;
DROP TABLE IF EXISTS dial_archetype_positions CASCADE;
DROP TABLE IF EXISTS coffee_alias CASCADE;
DROP TABLE IF EXISTS dial_slot_alias CASCADE;
DROP TABLE IF EXISTS dial_position_vocabulary CASCADE;
DROP TABLE IF EXISTS dial_archetype_config CASCADE;
```

`CASCADE` here may only ever remove objects that depend on these five tables; before writing it, run `SELECT … FROM pg_depend` (or `\d+` in Cloud SQL Studio) for each and list the dependents in the report. Expected: their own indexes/constraints, `v_dial_positions`, `v_dial_navigation`, the old `v_dial_position_consensus`, and the `dial_position_signal.suggested_vocabulary_id` FK (already dropped in A1). Anything else → stop and report.

Delete the `dap_guest_not_default` constraint block and any comment that documents these tables as live.

Two brief-1 blocks in `schema.sql` still *read* the legacy tables at boot and must be replaced in the same stage, or a fresh database would come up with an empty dial: (1) the `coffee_dial_slot` backfill (`INSERT INTO coffee_dial_slot … SELECT … FROM dial_slot_alias JOIN dial_position_vocabulary …`) becomes a static, idempotent seed of the 24 slots generated from prod's current `coffee_dial_slot` rows (`archetype, sort_order, name, position_label, position_description, dimension_id, is_landing_default`, `ON CONFLICT (archetype, sort_order) DO NOTHING`; spec columns are never seeded); (2) the `UPDATE archetype … FROM dial_archetype_config` copy becomes a static seed of `has_bloom_dial, is_archetype, dominant_dimension_id` per code, applied only `WHERE dominant_dimension_id IS NULL AND is_archetype` (i.e. once). Prove both on a scratch database: apply `schema.sql` to an empty database and assert 24 slots and 6 archetypes with the expected config. Keep `dial_source_weight`, `dial_position_signal`, `cupping_note_dimension_weight`: they are cupping-side, not placement.

### A3. Drop dead columns, add the NOT NULLs

```sql
ALTER TABLE roaster_blend DROP COLUMN IF EXISTS archetype_id;
ALTER TABLE dial_coffee_relationships DROP COLUMN IF EXISTS hop_type;            -- D3
DROP TYPE IF EXISTS hop_type_enum;                                              -- only after the column is gone and v_coffee_hop casts to TEXT instead
ALTER TABLE dial_slot_price DROP COLUMN IF EXISTS archetype, DROP COLUMN IF EXISTS dial_sort_order;   -- slot_id is the key since brief 1
ALTER TABLE user_bloom_dial_current_position DROP COLUMN IF EXISTS dial_sort_order;               -- keep (user_id, archetype) PK + slot_id
ALTER TABLE coffees DROP COLUMN IF EXISTS roaster;                              -- N9
```

Then, each in a self-healing `DO $$ … EXCEPTION WHEN others THEN NULL END $$` block with a matching boot warning in `index.ts` if it did not take: `ALTER TABLE coffees ALTER COLUMN roaster_id SET NOT NULL` (precondition: `SELECT COUNT(*) FROM coffees WHERE roaster_id IS NULL` = 0 in prod; if not, list the ids in the report and stop — do not guess a roastery), `ALTER TABLE roaster_blend ALTER COLUMN coffee_id SET NOT NULL` (same precondition on `roaster_blend`), `ALTER TABLE archetype ALTER COLUMN code SET NOT NULL`, `ALTER TABLE dial_slot_price ALTER COLUMN slot_id SET NOT NULL`, and `UNIQUE (slot_id, weight_oz)` as a full constraint replacing the partial index from brief 1. `v_coffee_hop`: `hop_type_derived` becomes `TEXT` (`'within_archetype' | 'bridge_archetype'`), `hop_type_stored` column removed; `catalogService.setHop` stops writing `hop_type` and the `hop_type_provisional` warning is deleted; integrity check 10 keeps only the "both ends have an active home" half.

`coffees.roaster` readers (`admin.ts` L462, L1016; `cron.ts` L296; `beatEngine.ts` L154) → `getCoffee(id).roaster_name`. In `schema.sql`, delete the boot-time backfills that read the text column: the second pass of the `coffees.roaster_id` backfill (`lower(trim(c.roaster)) = lower(trim(r.name))`, roastery-lifecycle block ~L1150) and any remaining `coffees.roaster` mention in the `roaster_blend.coffee_id` name-match backfill (~L404); the first pass (from `roaster_blend.roaster_id`) may stay until the NOT NULL makes it moot, then delete it too. Also delete the `index.ts` boot warning that lists coffees with `roaster_id IS NULL` by printing `c.roaster` (it can no longer compile against the dropped column; the NOT NULL replaces it). `v_coffee.roaster_name` loses its fallback and `roaster_name_is_fallback` is removed; integrity check 11 becomes "every active coffee has a roaster_id" (now guaranteed by NOT NULL; keep it as a cheap assertion). `catalogService.createCoffee` stops writing the text column. `dial_slot_price`: `setSlotPrice` stops writing the composite columns.

### A4. Service, integrity, lint, docs for Stage A

- `catalogService.deactivateRoastery` / `reactivateRoastery`: delete the `coffee_alias` cascade branches and the `aliases` fields from both previews (brief 4 already switched the UI to `placements`; remove the dead fields from the response types and `AdminRoasters.tsx` types).
- `catalogIntegrity.ts` check 13 → "no legacy placement objects exist": query `information_schema.tables` / `pg_views` for the seven names above; `severity: 'fail'`, pass when none exist.
- `scripts/lint-catalog.mjs`: rule 3 allow-list → empty (permanent exceptions only remain in rules 2 and 4); add the seven legacy names to rule 3's banned list permanently so they can never come back.
- `db/seeds/_retired/README.md`: add "the tables these seeded no longer exist as of brief 5"; leave the files (history).
- Migration mirror: `migrations/catalog_blueprint_5a_<date>.sql` with the exact statements in order.
- Tests: `schema.catalog_blueprint.test.ts` gains: the seven legacy objects do not exist; `coffees.roaster` column does not exist; `roaster_id` NOT NULL rejects an insert without it; `dial_position_signal.suggested_slot_id` populated for any pre-existing rows (count equality with rows that had a vocabulary id, captured before the drop in the migration as a `RAISE NOTICE`... simpler: assert no row has `suggested_slot_id IS NULL AND raw_value IS NOT NULL` after boot). `catalogIntegrity.test.ts`: check 13 passes and is `severity: 'fail'`.
- `WHAT_WE_BUILT.md` entry "Catalog Blueprint · brief 5a — legacy dropped"; `WHAT_WE_BUILT_DB.md` table count and views list updated, ownership table rows for the removed columns deleted.
- **Ship Stage A**: commit `catalog: brief 5a — drop legacy placement tables (Catalog Blueprint)`, push, deploy green, boot log: `DB schema verified`, `[catalog-integrity]` clean (check 13 now passing as a failing-type check), no `[roastery-lifecycle]` warnings. Smoke: `GET /api/coffees/archetypes` still 5 × 4 slots; `/admin/coffees`, `/admin/dial`, `/admin/inventory`, `/admin/roasters` render; `GET /api/admin/dial/consensus/<any coffee id>` returns 200; `GET /api/admin/catalog/integrity` `allPass: true`. Then apply `schema.sql` a second time by hand against prod and confirm it is a no-op (no errors, same table list). Only then start Stage B.

## Stage B — Rename to the convention (one commit, one deploy)

### B1. Schema mechanics (`schema.sql`, before the first `CREATE TABLE` of each renamed table, in dependency order: `archetype` first)

For each pair (old → new):

```sql
DO $$ BEGIN
  IF to_regclass('public.<old>') IS NOT NULL AND to_regclass('public.<new>') IS NULL THEN
    ALTER TABLE <old> RENAME TO <new>;
  END IF;
END $$;
```

then rewrite every `CREATE TABLE IF NOT EXISTS <old>`, `ALTER TABLE <old>`, `INSERT INTO <old>`, `UPDATE <old>`, `REFERENCES <old>(`, `FROM/JOIN <old>` in `schema.sql` (including inside views, DO blocks and seeds) to `<new>`. Rename the indexes and constraints that carry the old name so `pg_indexes` stays readable: `ALTER INDEX IF EXISTS roaster_blend_one_active_per_weight RENAME TO coffee_sku_one_active_per_weight` (and the same for `dial_slot_price_slot_weight_key` → `coffee_slot_price_slot_weight_key`, `chk_roaster_blend_deactivation_reason` → `chk_coffee_sku_deactivation_reason`, `archetype_code_key` → `coffee_archetype_code_key`, `archetype_assignments_one_current` → `coffee_archetype_assignment_one_current`, plus whatever `\di` shows with the old prefixes); the `CREATE … IF NOT EXISTS` lines that create them use the new names. Postgres keeps FKs, PKs and sequences attached through a rename, so `order_line_item.blend_id → coffee_sku(id)` needs no change beyond the `REFERENCES` text in `schema.sql`. Views: `DROP VIEW IF EXISTS v_archetype_adjacency; CREATE VIEW v_coffee_archetype_adjacency AS …` (and every view body that names a renamed table is rewritten, they are all `DROP … CREATE` already). The `archetype` seed block (~L1880) and the quiz seed DO-blocks (~L1992–2240) reference `archetype` by table name inside PL/pgSQL: rewrite those too (the pattern list below finds them).

The **only** safe rewrite pattern for `archetype`: `\b(FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|EXISTS|ON)\s+archetype\b(?!_)` plus `to_regclass('public.archetype')` and `ALTER INDEX … ON archetype(`; never a bare `\barchetype\b`. Run the rewrite with a script (node or sed with those exact regexes), then `git diff` and read every changed line in `schema.sql` before building; the report lists the count per pattern.

### B2. Code

Same regex approach across `backend/src/**/*.ts` (tests included this time) for the five names, then `npm run build`. Expected sites: TS files listed in Task 0. `catalogReads.ts`, `catalogService.ts`, `catalogIntegrity.ts`, `catalogImport.ts`, `orders.ts` (`UPDATE roaster_blend` → `UPDATE coffee_sku`), `users.ts`, `quiz*.ts`, `sommelier*.ts`, `behavioralConfidence.ts`, `brewCard.ts`, `engagementMetrics.ts`, `liamSmsFeedback.ts`, `qrDoor.ts`, `index.ts` boot checks, `dialSuggestion.ts`. TypeScript identifiers (function names, variables like `blendId`, response fields like `blend_id`) are **not** renamed: this brief renames tables, not the API. `lint-catalog.mjs`: table lists updated to the new names, old names added to the banned list.

### B3. Docs and done

- `WHAT_WE_BUILT_DB.md`: table groups and the ownership table use the new names; a "Renamed in brief 5b" mapping table (old → new) at the top of the catalog section so old docs and migrations stay readable. `WHAT_WE_BUILT.md` entry "Catalog Blueprint · brief 5b — renamed to the coffee_ convention" with the same mapping.
- Migration mirror `migrations/catalog_blueprint_5b_<date>.sql`.
- This folder's `README.md`: briefs 5a/5b → EXECUTED + hashes; a closing paragraph "Series complete on <date>. Catalog data enters via `npm run catalog:import` or the Place-a-coffee form only."
- Tests: the whole suite green after the rename (pre-existing quizScoring failures unchanged; if the rename touches `quizScoring.test.ts` fixtures, fix only the table names). `schema.catalog_blueprint.test.ts` asserts the five new tables exist and the five old names resolve to nothing (`to_regclass` NULL).
- **Ship Stage B**: commit `catalog: brief 5b — rename catalog tables to coffee_ convention (Catalog Blueprint)`, push, deploy green, boot log clean. Smoke: the same list as Stage A plus: complete a quiz end to end on prod (`?preview=true`) and confirm the result archetype renders (quiz FKs survived the `archetype` rename); place-and-retire one more fictional coffee through `/admin/coffees` (SKU write hits `coffee_sku`); `GET /api/admin/catalog/integrity` `allPass: true`. Apply `schema.sql` twice by hand; second run is a no-op.

## Don'ts (scope fence)

- No behaviour changes, no new verbs, no UI changes beyond removing the dead `aliases` fields.
- Do not rename `coffees`, `archetype_enum`, any column, any TypeScript identifier or any API field.
- Do not touch files under `db/migrations/` or `db/seeds/_retired/` (history).
- Never run a `DROP` against prod by hand; every drop lands through `schema.sql` at boot, after the deploy of the code that no longer needs the object.
- Stop and report instead of guessing at: a NULL `roaster_id`, an unexpected `pg_depend` dependent, or any `archetype` occurrence the regex does not classify cleanly.

## Definition of done

- Two commits, two green deploys, two clean boot logs, both smoke lists passed, `schema.sql` idempotent after each stage.
- `npm run lint:catalog` passes with rule 3's allow-list empty.
- `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'coffee%' ORDER BY 1` on prod returns: `coffee_archetype, coffee_archetype_assignment, coffee_category, coffee_category_assignment, coffee_dial_slot, coffee_dimensions, coffee_hop, coffee_retail_price, coffee_sku, coffee_slot_assignment, coffee_slot_price, coffees` (plus any other pre-existing `coffee*` table; list the full result).
- Closing report, once per stage: Task 0 deviations, the `pg_depend` dependents list (A), the NULL-precondition counts (A), the per-pattern rewrite counts (B), commit hashes, deploy URLs, boot-log excerpts, smoke results.
