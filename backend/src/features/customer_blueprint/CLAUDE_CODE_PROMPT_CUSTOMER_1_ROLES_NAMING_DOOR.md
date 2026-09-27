# Claude Code Prompt — Customer Blueprint, Brief C1: roles, naming, the door

**Series:** Customer Blueprint (see `README.md` in this folder). This is brief 1 of 3. It is additive only: no existing write path moves, no store is retired, no reader changes. Everything that works today keeps working unchanged. C2 (move the facts) and C3 (views and retirements) follow.

**Goal:** Make the customer side of the database enforce its own rules before any fact is written into it. After this brief: a `customer_*` table is append-only because the database says so, not because a comment asks; the request pool runs as `ab_app` and cannot UPDATE or DELETE a fact; every new fact table exists (empty) with the common columns and an idempotency key; `customerFacts.ts` is the only INSERT path and exposes no update or delete function; `catalogService.ts` writes a `catalog_change` row on every catalog write; `lint-customer.mjs` fails the build on any new violation; `customerIntegrity.ts` runs at boot, on `GET /api/admin/customer/integrity`, on an admin panel, and in vitest.

**Why this needs a build (context, not instructions):** Surveyed 2026-09-26 from `backend/src`. One quiz completion in `routes/quiz.ts` writes seven stores inline (`quiz_session`, `quiz_session_interpretation`, the Firestore user doc, `users/{uid}/quiz_sessions/{id}`, `confidence_profile`, `taste_journey`, lifecycle). One feedback submission in `routes/orders.ts` writes four, and on revision does `DELETE FROM user_flavor_feedback … ; INSERT …`, rewriting a fact. `computeBehavioralConfidence` has four call sites. The frontend never reads Firestore directly, so nothing forces the SQL/Firestore split. Readers pick whichever store their author knew (`/flavor-memory` reads `taste_journey` and falls back to `quiz_session`: two sources for one screen). The subscriber-archetype drift fixed in #190/#191 was one copy going stale; the Hoboken "reopened quiz overwrote my data" incident was a copy being resynced by a page-load effect. The catalog solved the same class of problem with one door, views, a lint and boot checks (Catalog Blueprint, 2026-09-13/16). This series applies that pattern to customer facts, plus what facts allow that master data does not: database-level immutability.

**Decisions already made (Dana, 2026-09-26 and 2026-09-27; D-numbers refer to the Liam Recommendation Map) — implement as stated, don't re-open:**

- D2: three classes of data. Operating tables (mutable, full DML for the app), master data (`coffee_*`, one door), facts (`customer_*` plus `quiz_session`, `quiz_session_interpretation`, `"order"`, `order_line_item`: append-only, the analysis layer).
- D3: several fact tables at their own grain, one writer each. No generic observation table.
- D6: every fact row carries `occurred_at` (database clock, never application code), `recorded_at` (when learned of later), `source`, `source_id`, `catalog_version`.
- D10: naming. `customer_` means append-only. Existing quiz/order tables keep their names and are listed explicitly in the grant block. `v_customer_*`, `v_palate_*` for views (C3).
- D11: roles. `ab_owner` = today's login role (applies `schema.sql`, runs backfills); `ab_app` = the Cloud Run request pool, INSERT+SELECT on facts, UPDATE/DELETE revoked, column-level UPDATE on `quiz_session_interpretation (valid_to, is_current)`; `reporting_ro` unchanged. Two connection strings in Secret Manager: migrate as owner, serve as app.
- D12: integrity = prefix-driven grants (database) + one door with no update function (code) + `lint-customer.mjs` (build) + `customerIntegrity.ts` (boot).
- D15: facts key on `user_profile.id`, never `firebase_uid` or email. Facts hold ids only, no PII. `customer_identity_link` joins two profiles that are one person; rows are never re-keyed.
- D16: no Type 1 anywhere. `catalogService.ts` writes a `catalog_change` fact on every catalog write from this brief on; `coffee_*` rows become SCD2 in a later Catalog Blueprint 2.
- D17: controlled change. Facts: `UNIQUE (source, source_id)`, inserts use `ON CONFLICT DO NOTHING`, collisions logged. Operating tables: named transitions per mutable field (C2/C3 apply this; C1 only adds the lint rule scaffold).
- D18: `order_kind` is a dimension on the order line: `manual`, `subscription_renewal`, `gift_redemption`, `liam_followed`.
- D9: `api_event` is the replay source. No second event log.
- CTO-pattern rules: Task 0 verify-first; commit by explicit file list, never `git add -A` (the working tree shows ~155 CRLF-churn "modified" files plus two old uncommitted August edits); push is deploy; one closing report; prod steps by Claude Code with STOP checkpoints, nothing by hand.

## Task 0 — Verify current state (confirm, don't assume)

Read and confirm before touching anything. Stop and report if any of these is not what the file says.

- `backend/src/index.ts` ~L144: `schema.sql` is applied at boot with `await db.query(schema)` on the request pool from `db/client.ts`. `db/migrate.ts` is a standalone script (`npm run db:migrate`) that does the same and is not used by the deploy. Both use `process.env.DATABASE_URL`. There is exactly one connection string in `.github/workflows/deploy.yml` (~L99 `--set-secrets "DATABASE_URL=DATABASE_URL:latest,…"`), `infra/cloud-run-backend.yaml` (~L24) and `infra/deploy.sh` (~L24).
- `backend/src/db/client.ts`: `db` is a `pg.Pool` (max 10); `withTransaction()` and `Tx` exist (Catalog brief 1). `isUnixSocket` handling for `host=/cloudsql/`.
- `backend/src/db/schema.sql` ~L3805–3830: the `reporting_ro` pattern. `DO $$ … CREATE ROLE reporting_ro NOLOGIN …`, `GRANT CONNECT` via `format()`, `GRANT USAGE ON SCHEMA public`, `GRANT SELECT ON` a named list of views, re-run every boot. Dana enables LOGIN + password manually (README "Manual GCP steps"). No `ab_app`, no `ab_owner` role exists. `WHAT_WE_BUILT_DB.md` has a `### Roles` table (~L260) with one row.
- Idempotency conventions in `schema.sql`: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL END $$` for constraints, `DROP VIEW IF EXISTS x; CREATE VIEW x AS …`. Timestamps: most use `DEFAULT timezone('utc', now())`, some bare `now()`.
- Existing columns this brief builds on: `order_line_item.intended_for_user_id UUID REFERENCES user_profile(id)` (~L733) exists and is **never written** (`services/qrDoor.ts` ~L334 has a TODO saying so; it is read at ~L205 and ~L343). `"order".household_id` (~L689). `user_profile.firebase_uid TEXT UNIQUE NOT NULL`, `household_id`. `newsletter_subscriber.email PK, user_id UUID NULL`.
- Dead tables from an earlier design, **do not reuse, do not drop in this brief** (C3 drops them after a boot check proves they are empty): `user_recommendation_log` (~L862, zero code refs), `user_feedback_event` (one ref), `chat_message` (zero refs), `sommelier_messages` (one dormant read, `routes/sommelier.ts` ~L1184).
- `services/catalogService.ts`: every catalog verb runs inside `withTransaction(tx => …)` and returns an integrity report. Confirm the list of exported verbs (place, move, addGuest, setPriority, retire, deactivateRoastery, reactivateRoastery, import paths, …) — the exact names are what Part D wires.
- `services/catalogIntegrity.ts`: `CatalogIntegrityCheck { id, name, pass, expected, actual, details?, informational? }`, `runCatalogIntegrityChecks({tx?})`, boot hook in `index.ts` ~L245 (non-fatal, `console.warn('[catalog-integrity] …')`), `GET /api/admin/catalog/integrity` in `routes/admin.ts`, `frontend/src/app/components/admin/AdminCatalogIntegrity.tsx` (confirm the file name) mounted in `AdminDashboard.tsx`.
- `backend/scripts/lint-catalog.mjs`: four rules, allow-lists with expiry notes, `npm run lint:catalog`, vitest wrapper `services/lintCatalog.test.ts`, invoked in `deploy.yml` before the backend build. `lint-retention.mjs` is its sibling with the same shape. `EXCLUDED_DIR_SEGMENTS` skips `db/migrations` and `.test.ts`.
- `services/quizSession.ts`: `recordScoredInterpretation()` inserts the SCD2 row and flips the previous row's `valid_to`/`is_current` (confirm the exact UPDATE statement; it is the only legitimate UPDATE on a fact table and Part A's column-level grant must match its column list exactly). `services/quizInterpretationBackfill.ts` does the same under `--apply`.
- Firestore write sites on customer paths today (the allow-list for lint rule 3 must name exactly these; anything else is a new violation): `routes/quiz.ts` (user doc `set`, `quiz_sessions/{id} set`, `taste_journey set`), `routes/orders.ts` (`feedback_events add`, `confidence_profile set`, feedback doc `update supersededAt`), `routes/users.ts` (`brew_profile` ×2, `dial_events`, `liam_saves`), `services/brewProfile.ts` (`brew_profile`), `services/behavioralConfidence.ts` (`confidence_profile`), `services/liamSmsFeedback.ts` (`feedback_events`, `confidence_profile`), `services/sommelierEvaluator.ts` (`sommelier_evaluations add`), `services/outcomeTracker.ts` (`sommelier_evaluations update`), `routes/sommelier.ts` (`sommelier_sessions/{id}/messages` — permanent, the transcript), `services/staleGuestCleanup.ts`, `services/tokenService.ts` (user doc, token balance). Grep `\.(set|add|update)\(` over `src/**/*.ts` excluding tests and list what you find; if the list differs from the above, use what you find and say so in the report.
- Tests: vitest (`npm test` in backend), DB-backed tests follow `db/schema.roastery_lifecycle.test.ts` (require `DATABASE_URL`, fixtures named `Vitest…`, deleted in `finally` + `afterAll`). Note: with Part A applied, a DB-backed test that connects as `ab_app` cannot delete its fixtures from fact tables; test fixtures for facts must use the owner connection string (`OWNER_DATABASE_URL`, Part B) or a transaction that is rolled back.
- Repo: `main`, level with `origin/main` at `6f34238`. `git diff --ignore-all-space --stat` is the truth.

## Part A — Roles and the prefix-driven grant block (`backend/src/db/schema.sql`; mirror into `backend/src/db/migrations/customer_blueprint_1_2026_09_27.sql`)

Place the block at the very end of `schema.sql`, after the `reporting_ro` block, under `-- CUSTOMER BLUEPRINT · brief C1 (2026-09-27)` with a two-line pointer to this file. It must be the last thing in the file so every table created above it, in this brief or later, is covered on the same boot.

### A1. The application role

Same pattern as `reporting_ro`: created `NOLOGIN` here; LOGIN + password set in the cutover (Part G), never in a committed file.

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ab_app') THEN CREATE ROLE ab_app NOLOGIN; END IF;
END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO ab_app', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO ab_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ab_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ab_app;
```

`ab_owner` is not created: it is the name this series uses for **today's login role**, whatever `DATABASE_URL` connects as. Document its actual role name in `WHAT_WE_BUILT_DB.md` (Part H) after reading it with `SELECT current_user` during Task 0.

### A2. Prefix-driven grants, re-run every boot

Three classes, three grant shapes. The loop is the point: a table's name decides its privileges, so a `customer_*` table added later in C2 is immutable from the boot that creates it, with no grant to remember.

```sql
-- Facts: every customer_% table plus the four named ones. INSERT + SELECT, never UPDATE/DELETE (D11, D12).
DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND (tablename LIKE 'customer\_%' ESCAPE '\'
           OR tablename IN ('quiz_session', 'quiz_session_interpretation', 'order', 'order_line_item'))
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON %I TO ab_app', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM ab_app', t);
  END LOOP;
END $$;

-- The one sanctioned fact UPDATE: SCD2 flip on the interpretation row (D11). Column list must equal the
-- UPDATE in quizSession.recordScoredInterpretation() — verify in Task 0 and adjust here if it differs.
GRANT UPDATE (valid_to, is_current) ON quiz_session_interpretation TO ab_app;

-- Operating tables and master data: everything else in public that is not a fact and not a view. Full DML.
DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND NOT (tablename LIKE 'customer\_%' ESCAPE '\'
               OR tablename IN ('quiz_session', 'quiz_session_interpretation', 'order', 'order_line_item'))
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ab_app', t);
  END LOOP;
END $$;

-- Views: SELECT.
DO $$ DECLARE v text; BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public'
  LOOP EXECUTE format('GRANT SELECT ON %I TO ab_app', v); END LOOP;
END $$;
```

Notes for the engineer:
- `api_event` is a fact by nature (capture-first log, never deleted) but is **not** in the fact list in this brief: its writer is middleware that may UPDATE a row with the response status. Leave it under the operating grant and record in the report whether it does UPDATE; C2 decides.
- `quiz_session` has a `context_data` JSONB that older code paths may UPDATE (the resync path was fixed in #191, but grep `UPDATE quiz_session` and report every hit). If a live UPDATE exists, this brief does not remove it; add a temporary `GRANT UPDATE (context_data) ON quiz_session TO ab_app` with a comment `-- TEMP until C2 removes <file:line>`, and list it in the report. Do not silently widen the grant.
- The loops run as the owner every boot, so a table renamed into or out of the `customer_` prefix changes class on the next boot. That is intended; `customerIntegrity` check 1 (Part F) reports the current state.

### A3. Common columns for facts and the new fact tables (DDL only, empty, no writers in this brief except `catalog_change`)

Every `customer_*` table has these columns first, in this order, with these exact names:

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id         UUID NOT NULL REFERENCES user_profile(id),          -- facts key on user_profile.id, never firebase_uid or email (D15)
occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()), -- database clock; application code never sets it except on backfill
recorded_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()), -- differs from occurred_at only when learned of later (webhook, backfill)
source          TEXT NOT NULL,                                       -- onsite | liam | sms | shopify | qr | backfill | backfill_detected
source_id       TEXT NOT NULL,                                       -- the id in the source system; with source, the idempotency key (D17)
catalog_version TEXT,                                                -- getCatalogVersion() at occurred_at (D16); NULL only on backfilled rows
UNIQUE (source, source_id)
```

`catalog_change` is the one `customer_`-less fact: it is about the catalog, not a customer, so it has no `user_id` and its name has no prefix. It is listed by name in both grant loops (add it to the fact `IN (…)` list) and follows the same common columns minus `user_id`, plus `changed_by TEXT` (admin uid or 'import').

Create these tables. Column lists are the contract; C2 and L3 write them, C3 reads them. Keep FKs and CHECKs as written; add an index on `(user_id, occurred_at)` to every `customer_*` table.

| table | specific columns |
|---|---|
| `customer_identity_link` | `from_user_id UUID NOT NULL REFERENCES user_profile(id)`, `to_user_id UUID NOT NULL REFERENCES user_profile(id)`, `how TEXT NOT NULL CHECK (how IN ('email_match','household_claim','admin'))`, `CHECK (from_user_id <> to_user_id)`. `user_id` = `from_user_id` (the profile being linked away). |
| `customer_feedback_event` | `order_line_item_id UUID REFERENCES order_line_item(id)`, `coffee_id INT NOT NULL REFERENCES coffees(id)`, `rating SMALLINT CHECK (rating BETWEEN 1 AND 5)`, `expectation TEXT`, `raw_text TEXT`, `supersedes_id UUID REFERENCES customer_feedback_event(id)`, `channel TEXT NOT NULL CHECK (channel IN ('onsite','sms','liam'))`. Partial unique index: at most one row per `order_line_item_id` that is not itself superseded — implement as a view-time rule in C3, not a constraint (a chain A←B←C is legal). |
| `customer_feedback_descriptor` | child of the above: `feedback_event_id UUID NOT NULL REFERENCES customer_feedback_event(id)`, `cupping_note_id UUID NOT NULL REFERENCES cupping_note(id)`, `UNIQUE (feedback_event_id, cupping_note_id)`. Common columns minus `catalog_version`; `source_id` = `feedback_event_id || ':' || cupping_note_id`. |
| `customer_brew_profile_change` | `field TEXT NOT NULL CHECK (field IN ('brew_methods','grinder','takes_it','decaf_constraint','aversions'))`, `value TEXT`, `op TEXT NOT NULL CHECK (op IN ('set','add','remove','clear'))`, `session_id INT` (sommelier session when source = 'liam'). |
| `customer_dial_event` | `event_type TEXT NOT NULL CHECK (event_type IN ('explicit_save','add_to_cart'))`, `slot_id UUID REFERENCES coffee_dial_slot(id)`, `coffee_id INT REFERENCES coffees(id)`, `archetype_code archetype_enum`. |
| `customer_liam_recommendation` | `session_id INT NOT NULL REFERENCES sommelier_sessions(id)`, `turn SMALLINT NOT NULL`, `message_id TEXT NOT NULL` (Firestore message doc id), `coffee_id INT REFERENCES coffees(id)`, `slot_id UUID REFERENCES coffee_dial_slot(id)`, `candidate_coffee_ids INT[] NOT NULL`, `palate_read_version TEXT`, `detected BOOLEAN NOT NULL DEFAULT false` (true when written by alias detection, not a marker), `CHECK (coffee_id IS NOT NULL OR slot_id IS NOT NULL)`. |
| `customer_liam_question` | `session_id INT NOT NULL REFERENCES sommelier_sessions(id)`, `turn SMALLINT NOT NULL`, `message_id TEXT NOT NULL`, `kind TEXT NOT NULL CHECK (kind IN ('thread','palate','brew'))`, `archetype_code archetype_enum`, `question TEXT NOT NULL`, `reply TEXT`, `reply_message_id TEXT`. The reply is filled by a second insert-free path: C1 creates the table; L3 decides whether the reply is a separate row (`customer_liam_reply`) or a column set once. **Default for this brief: separate table `customer_liam_reply`** (`question_id UUID NOT NULL REFERENCES customer_liam_question(id) UNIQUE`, `reply TEXT NOT NULL`, `message_id TEXT NOT NULL`), so no fact is ever updated. |
| `customer_liam_action` | `session_id INT NOT NULL REFERENCES sommelier_sessions(id)`, `message_id TEXT NOT NULL`, `action_type TEXT NOT NULL CHECK (action_type IN ('open_dial','retake_quiz','save_recipe'))`. |
| `customer_bag_claim` | `qr_scan_event_id UUID REFERENCES qr_scan_event(id)` (confirm that table's PK type in Task 0), `order_line_item_id UUID REFERENCES order_line_item(id)`, `coffee_id INT NOT NULL REFERENCES coffees(id)`. |
| `catalog_change` | `entity TEXT NOT NULL`, `entity_id TEXT NOT NULL`, `action TEXT NOT NULL`, `before JSONB`, `after JSONB`, `changed_by TEXT`. |

`order_kind` (D18): a dimension table `customer_order_kind (code TEXT PRIMARY KEY, label TEXT NOT NULL)` seeded with the four codes, and `ALTER TABLE order_line_item ADD COLUMN IF NOT EXISTS order_kind TEXT REFERENCES customer_order_kind(code)`. Backfill existing rows to `'manual'` in the same block (`UPDATE … WHERE order_kind IS NULL`, runs as owner at boot, idempotent). Then `ALTER … SET DEFAULT 'manual'`. `orders.ts` does not change in this brief; the default covers new rows and C2 sets the other kinds. Note `customer_order_kind` is a dimension, not a fact: exclude it from the fact loop by adding `AND tablename <> 'customer_order_kind'` to both loops, with a comment. (Alternative rejected: naming it `order_kind` without the prefix would hide that it belongs to the customer side.)

## Part B — Owner/app pool split at boot (`backend/src/db/client.ts`, `backend/src/index.ts`, `backend/src/db/migrate.ts`)

- `client.ts`: add `export const ownerConnectionString = process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL ?? ''` and `export function ownerPool(): pg.Pool` (max 2, same ssl/socket handling). Keep `db` exactly as it is: it becomes the app pool the moment `DATABASE_URL` points at `ab_app` (Part G). Add `export async function whoAmI(pool: pg.Pool): Promise<string>` (`SELECT current_user`).
- `index.ts` ~L144: apply `schema.sql` through `ownerPool()`, then `.end()` it. Every boot check that follows stays on `db`. Immediately after the schema apply, log one line: `[db-roles] schema applied as <owner user>; request pool is <app user>`. If `OWNER_DATABASE_URL` is unset, log `[db-roles] OWNER_DATABASE_URL not set — schema applied by the request pool role; fact grants are written but NOT enforcing until the cutover (Customer Blueprint C1, Part G)` as `console.warn`. Boot must never fail because of the split.
- `migrate.ts`: same, through `ownerPool()`.
- Scripts under `backend/scripts/` that write facts or run backfills (`backfillQuizInterpretation.ts`, future C2 scripts) use `ownerPool()`; add a one-line guard at the top of `backfillQuizInterpretation.ts` that refuses to run when `whoAmI()` returns `ab_app`.

## Part C — The door: `backend/src/services/customerFacts.ts` and the empty `customerReads.ts`

`customerFacts.ts` exports a single object `record` with one function per fact table created in Part A (`record.identityLink`, `record.feedback`, `record.feedbackDescriptor`, `record.brewProfileChange`, `record.dialEvent`, `record.liamRecommendation`, `record.liamQuestion`, `record.liamReply`, `record.liamAction`, `record.bagClaim`, `record.catalogChange`). Rules:

- Each takes a typed input and an optional `tx?: Tx`, builds one `INSERT … ON CONFLICT (source, source_id) DO NOTHING RETURNING id`, and returns `{ id: string | null, inserted: boolean }`. On conflict it logs `console.warn('[customerFacts:DUPLICATE] <table> source=<source> source_id=<id>')` and returns `inserted: false`. Never throws on a duplicate.
- `occurred_at` is not a parameter except through an explicit `backfill` variant (`record.feedback.backfill({... occurredAt, recordedAt})`) that is the only way to set it, and only usable through `ownerPool()` (assert `whoAmI() !== 'ab_app'`).
- `catalog_version` is filled by calling `getCatalogVersion()` (from `catalogReads.ts`) unless the caller passes one.
- The module exports **no** update, delete or upsert function. A vitest (`customerFacts.test.ts`) asserts the export surface by name so a future edit that adds `update*` fails the test, and asserts the duplicate path (insert twice, second returns `inserted: false`, row count 1).
- `customerReads.ts` is created with a header comment and no exports yet; it is the file lint rule 4 names as the only place a `customer_*` table may be SELECTed from, so C3 has somewhere to put the views' readers.

Only one writer is wired in this brief: **Part D**. No route changes.

## Part D — `catalog_change` through the existing door (`backend/src/services/catalogService.ts`)

Inside every exported verb's `withTransaction(tx => …)`, after the write and before the integrity report, call `record.catalogChange({ entity, entityId, action: '<verb name>', before, after, changedBy }, tx)`. `before`/`after` are the row(s) the verb touched, as returned by a `SELECT … FOR UPDATE` before and a `SELECT` after; where a verb touches many rows (import), one `catalog_change` row per affected coffee/slot, `source = 'catalogService'`, `source_id = '<tx-scoped uuid>:<entity>:<entityId>'`. Keep the diff cheap: whole rows as JSONB, no field-level diffing (C3 or Catalog Blueprint 2 derives that). `changedBy` is the admin uid the route already has, or `'import'`.

Add a boot-time assertion to `customerIntegrity` (Part F, check 6) that the number of `catalog_change` rows is ≥ the number of `api_event` rows for catalog admin routes since cutover (informational, not a failure; it measures whether any verb was missed).

## Part E — `backend/scripts/lint-customer.mjs` (+ `npm run lint:customer`, vitest wrapper `services/lintCustomer.test.ts`, `deploy.yml` step beside `lint:catalog`)

Clone `lint-catalog.mjs`'s structure (file walk, allow-lists with expiry notes, `file:line  message`, exit 1). Four rules:

1. **INSERT into a fact table outside the door.** Fact tables = every `customer_*` name found in `schema.sql` (parse `CREATE TABLE IF NOT EXISTS customer_…` at lint time so the list never goes stale) plus `catalog_change`. Allowed writer: `services/customerFacts.ts`. Allow-list for this brief: none. (`quiz_session`, `quiz_session_interpretation`, `"order"`, `order_line_item` are **not** in rule 1 yet: their writers are `quizSession.ts` and `orders.ts` and stay so until C2 decides whether they move behind the door. Say so in a comment.)
2. **UPDATE or DELETE on any fact table, anywhere, including the door.** Same table list plus the four named ones. Allow-list: `services/quizSession.ts` (the SCD2 flip, permanent), `services/quizInterpretationBackfill.ts` (permanent, owner-only script), `routes/orders.ts` `DELETE FROM user_flavor_feedback` (**not** a fact table by name, so not matched; listed here only as a reminder that C2 removes it). Any `UPDATE quiz_session` found in Task 0 gets an entry with `note: 'TEMP until C2'`.
3. **Firestore writes on customer paths.** Match `firestoreDb.(doc|collection)(\`users/` followed within the same statement chain by `.set(`, `.add(`, `.update(` (multi-line: read the file, find each `firestoreDb.` occurrence, scan forward to the next `;`). Allowed permanently: `routes/sommelier.ts` messages collection. Allow-list: exactly the sites found in Task 0, each with `note: 'until C2'` or `'until C3'` per the map's inventory (feedback/brew/dial/confidence → C2; taste_journey/user doc/quiz_sessions copy/evaluations → C3). A new Firestore write anywhere fails the build from this brief on.
4. **Direct SELECT from a `customer_*` table outside `services/customerReads.ts`.** Allowed: `customerReads.ts`, `customerIntegrity.ts`, `customerFacts.ts` (its RETURNING/duplicate check), test files (excluded already). Scope: `customer_*` and `catalog_change` only; the four named tables have dozens of legitimate readers today and C3 moves them.

## Part F — `backend/src/services/customerIntegrity.ts` + `GET /api/admin/customer/integrity` + admin panel + vitest

Clone the `catalogIntegrity.ts` shape (`CustomerIntegrityCheck`, `CustomerIntegrityReport`, one function per check, `runCustomerIntegrityChecks({tx?})`). Boot hook in `index.ts` next to the catalog one, non-fatal, `console.warn('[customer-integrity] check #n failed — …')`. Admin route in `routes/admin.ts` next to the catalog one; panel `AdminCustomerIntegrity.tsx` cloned from the catalog panel and mounted in `AdminDashboard.tsx`. Checks:

1. **Grant coverage.** For every `customer_*` table and the four named ones: `has_table_privilege('ab_app', t, 'INSERT')` is true and `has_table_privilege('ab_app', t, 'UPDATE')` and `'DELETE'` are false. Failure lists the table. (Column-level: `has_column_privilege('ab_app','quiz_session_interpretation','valid_to','UPDATE')` true; `'quiz_session_id'` false.)
2. **Request pool identity.** `whoAmI(db) = 'ab_app'` in production (`NODE_ENV === 'production'`); informational elsewhere. Until Part G lands this check fails on prod by design; the boot line from Part B explains why.
3. **Live immutability probe.** Inside a transaction on `db` that is always rolled back: `UPDATE quiz_session SET id = id WHERE false` must raise `permission denied` when the pool is `ab_app`. Pass = it raised; fail = it succeeded. Skipped (informational) when check 2 is not `ab_app`.
4. **Common columns and idempotency key.** Every `customer_*` table has `occurred_at`, `recorded_at`, `source`, `source_id`, a `UNIQUE (source, source_id)` constraint and an index on `(user_id, occurred_at)` (where `user_id` exists). Query `information_schema` + `pg_indexes`.
5. **No future facts.** `COUNT(*) WHERE occurred_at > now() + interval '5 minutes'` across all fact tables = 0.
6. **catalog_change coverage** (informational, Part D).
7. **Dead tables are empty** (informational; C3 drops them): `user_recommendation_log`, `user_feedback_event`, `chat_message`, `sommelier_messages`.
8. **order_kind populated.** `COUNT(*) FROM order_line_item WHERE order_kind IS NULL` = 0.
9. **Names follow the convention.** Every table whose name starts with `customer_` is in the fact grant loop's result set except `customer_order_kind`; no view name starts with `customer_` (views are `v_customer_*`).

Vitest: `customerIntegrity.test.ts` runs the report against the test DB and asserts checks 1, 4, 8, 9 pass and 2/3 are informational when not `ab_app`.

## Part G — Cutover to two connection strings (prod; run by Claude Code, STOP before each irreversible step; Dana says go/hold)

Preconditions: Parts A–F committed, pushed, deploy green, boot log shows the `[db-roles] OWNER_DATABASE_URL not set` warning and `[customer-integrity]` checks 1, 4, 8, 9 passing.

1. Read the current owner role name: `SELECT current_user` through the existing proxy path used for the interpretation backfill. Report it. **STOP.**
2. Generate a password (32 random bytes, base64, never printed to the transcript; write it straight into Secret Manager as `APP_DATABASE_URL`, built from the existing `DATABASE_URL` value with the user and password replaced). Create `OWNER_DATABASE_URL` as a copy of today's `DATABASE_URL`. Report the two secret names and versions. **STOP.**
3. `ALTER ROLE ab_app LOGIN PASSWORD '<from step 2>'` via the proxy. Verify: connect as `ab_app`, `SELECT current_user`, then `UPDATE quiz_session SET id = id WHERE false` must fail with permission denied, `INSERT`-privilege check via `has_table_privilege` true. Report. **STOP.**
4. `deploy.yml` (~L99), `infra/cloud-run-backend.yaml`, `infra/deploy.sh`: `DATABASE_URL` now maps to `APP_DATABASE_URL:latest`; add `OWNER_DATABASE_URL=OWNER_DATABASE_URL:latest`. Commit + push (this is the deploy). Watch the boot log for `[db-roles] schema applied as <owner>; request pool is ab_app` and `[customer-integrity]` all passing including 2 and 3. Smoke (Part I). **STOP** only if any of that is not green; otherwise close.
5. Rollback (document, do not execute): point `DATABASE_URL` back at the owner secret and redeploy; nothing in the schema needs reverting.

## Part H — Docs

- `WHAT_WE_BUILT.md`: new entry (next number after the current last) titled "Customer Blueprint C1 — roles, naming, the door", with the boot-log lines, the check list, the lint rules, and every Task 0 deviation.
- `WHAT_WE_BUILT_DB.md`: `### Roles` table gains `ab_app` (and names the owner role); new `### Customer ownership table` in the catalog table's format: every fact table, its class, its writer (`customerFacts.record.<fn>` or "none yet (C2/L3)"), its readers ("none yet (C3)"); `order_kind` dimension; the naming convention paragraph.
- `backend/src/features/customer_blueprint/README.md`: status cell for C1 → EXECUTED + commit hash.
- `OPEN_TASKS.md`: any TEMP grant or allow-list entry from Task 0, each with "removed by C2".

## Part I — Definition of done (all of it, one closing report)

1. `npm run lint:catalog && npm run lint:customer && npm test` green locally (DB-backed tests need `DATABASE_URL`; fact-table fixtures need `OWNER_DATABASE_URL` or a rolled-back transaction).
2. Commit by explicit file list (`git add <files>`; never `git add -A`; `git diff --cached --stat` must show only this brief's files; pause and show it before committing). Message: `customer: blueprint C1 - ab_app role, prefix-driven grants, fact DDL, customerFacts door, lint + integrity`.
3. Push → `deploy.yml` runs → deploy green → startup log clean (no errors; the `[db-roles]` warning is expected until Part G step 4).
4. Part G steps 1–4 with the STOPs.
5. Smoke on prod after step 4: complete a quiz with the test user `quiz-scenario-test@axisandbloom.test` (uid `0BeUD1zIdCTyO4v78kofJVkFtfo1`, exclude from analysis); confirm a `quiz_session` + interpretation row landed (INSERT works as `ab_app`); place an order via the existing test path if one exists, else confirm `order_line_item.order_kind = 'manual'` on the latest real row; open a Liam session and send one turn; run one catalog admin verb on a test slot and confirm a `catalog_change` row; `GET /api/admin/customer/integrity` all green; `quiz_session` and `newsletter_subscriber` row counts + md5 unchanged versus a snapshot taken before step 4.
6. One closing report: what shipped, every Task 0 deviation, every TEMP entry, the boot-log lines, the integrity report, the smoke results.

**Guardrails:** additive only; no existing write path moves and no Firestore write is removed (C2); do not touch the 37-case quiz calibration fixture or `quizScoring.ts`; do not run any prod step outside Part G; never print the password; never `git add -A`; if `ab_app` cannot INSERT into any table a live route writes (a table the fact loop caught by mistake, e.g. a future `customer_` operating table), revert the deploy to the owner string first and report, do not widen grants live.
