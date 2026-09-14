# Claude Code Prompt — Catalog Blueprint, Brief 1: schema, views, integrity

**Series:** Catalog Blueprint (see `README.md` in this folder). This is brief 1 of 5. It is additive only: nothing that exists today is dropped, renamed, or re-pointed. Old readers keep working unchanged. Brief 2 (service + routes), brief 3 (readers onto views), brief 4 (admin UI), brief 5 (drop old tables) follow.

**Goal:** Give the catalog its real entities and its single read path, and make every invariant we care about either enforced by the database or visible on an admin page — before any coffee is placed again. After this brief: `withTransaction()` exists; `archetype` is one reference table keyed by the enum code; `coffee_dial_slot` and `coffee_slot_assignment` exist with every constraint; five views (`v_coffee_archetype`, `v_coffee`, `v_coffee_slot`, `v_coffee_sellable_slot`, `v_coffee_hop`) are the only place a slot is ever derived; `catalogIntegrity.ts` runs at boot, on `GET /api/admin/catalog/integrity`, on an admin page, and in vitest.

**Why this needs a build (context, not instructions):** Today "which coffee fills slot (archetype, position)" is not stored anywhere. It is re-derived at read time by joining `archetype_assignments` + `dial_archetype_positions` + `coffee_alias`, and four readers derive it four different ways (admin list / Liam names; `blendResolver`; hops / legacy links; dial graph). `archetype` itself has two identities: the UUID `archetype` table ("Chocolate & Nutty") used by quiz and users, and `archetype_enum` ('chocolate_nutty') used by the whole catalog, joined only by a hand-typed CASE (admin.ts L55, L1760) and label maps retyped in 10+ files. Both roasteries are deactivated and there are zero active coffees, so we build the target model directly, with no dual-write and no migration of placement rows (decision N1, N3 — Dana, 2026-09-13).

**Decisions already made (Dana, 2026-09-10 and 2026-09-13) — implement as stated, don't re-open:**

- D1: match archetype (`archetype_assignments`, what Liam/quiz reason with) and placement (which slot a coffee fills) are two first-class facts with two names. Views expose both; no reader may confuse them.
- D5: a coffee has exactly one active **home** assignment (its identity) and any number of **guest** assignments. Guests can fulfil the slot they guest on, ranked below home occupants.
- D3: `hop_type` is derived from the two endpoints' current home slots, never stored (stored column dropped in brief 5).
- D6 / N4: slot spec (band on the archetype's dominant dimension + descriptor families) and certification columns exist from day one. Posture is warn + record, never block — the check itself is brief 2's job; this brief only creates the columns and the view fields.
- N2: one archetype identity. The `archetype` table gains `code archetype_enum UNIQUE`; the UUID `id` stays for the existing quiz FKs (`quiz_session.resulting_archetype_id`, `quiz_answer.resulting_archetype_id`, `quiz_answer_archetype_score.archetype_id`, `archetype_vector`). All new FKs use `code`.
- N3: Path / Temecula coffees, SKUs, cupping data and stories stay as inactive history. **No placement rows are backfilled into `coffee_slot_assignment`.** It starts empty.
- N6: business logic lives in TypeScript (brief 2), not PL/pgSQL. Constraints and views live in SQL.

**Naming convention (Dana, 2026-09-13) — applies to every object this series creates:** every catalog table, enum and view starts with `coffee_` (views: `v_coffee_…`) so the catalog groups together in any SQL listing. New objects in this brief follow it (`coffee_dial_slot`, `coffee_slot_assignment`, `coffee_slot_role_enum`, `v_coffee_archetype`, `v_coffee`, `v_coffee_slot`, `v_coffee_sellable_slot`, `v_coffee_hop`). Surviving legacy tables (`archetype`, `archetype_assignments`, `roaster_blend`, `dial_coffee_relationships`, `dial_slot_price`) keep their names in briefs 1–4 and are renamed in brief 5 (`coffee_archetype`, `coffee_archetype_assignment`, `coffee_sku`, `coffee_hop`, `coffee_slot_price`) when every reader is already being touched. Do not rename anything existing in this brief.

## Task 0 — Verify current state (confirm, don't assume)

Read and confirm before touching anything. Stop and report if any of these is not what the file says.

- `backend/src/db/client.ts` — `db` is a `pg.Pool`, max 10. No transaction helper exists. Eight sites do `await db.connect()` by hand (admin.ts L691, L747; companyGiftRedemption.ts; companyGiftsAdmin.ts; orders.ts; tokenService.ts ×2; userLifecycle.ts). Four placement writes still run `db.query('BEGIN')` on the pool (admin.ts ~L820, ~L1135, ~L2170; dialSuggestion.ts ~L252) — **do not touch those four in this brief**; brief 2 rewrites them.
- `backend/src/db/schema.sql` — applied whole at every boot by `index.ts` (`await db.query(schema)`), one implicit transaction, no BEGIN/COMMIT in the file. Idempotency pattern: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL END $$` for constraints, and the self-healing `DO $$ BEGIN CREATE UNIQUE INDEX … EXCEPTION WHEN unique_violation THEN NULL END $$` block used by `coffees_active_natural_key` (~L1210). Views use `DROP VIEW IF EXISTS x; CREATE VIEW x AS …` (see `v_dial_positions` ~L2986).
- Tables in play: `archetype` (L22: id UUID, name UNIQUE, description, is_active) · `dial_archetype_config` (L1432: archetype enum PK, dominant_dimension_id, has_bloom_dial, is_archetype) · `dial_position_vocabulary` (L1446: archetype, dimension_id, sort_order, label, description; 24 rows seeded ~L1944) · `dial_slot_alias` (L1612: archetype, dial_sort_order, platform_name UNIQUE; 24 rows seeded) · `dial_slot_price` (L1681: archetype, dial_sort_order, weight_oz, retail_price_cents) · `archetype_assignments` (L1420) · `dial_archetype_positions` (L1457) · `coffee_alias` (L1593) · `dial_coffee_relationships` (L1484) · `coffees` (L1078 + lifecycle block ~L1105) · `roaster_blend` (L372) · `coffee_category` / `coffee_category_assignment` (L1506, L1528) · `user_bloom_dial_current_position` (L1663).
- `coffee_dimensions` ids used as dominant dimension: 7 Body (chocolate_nutty), 5 Acidity (balanced_sweet, fruity), 9 Savory / Depth (floral), 6 Bitterness (earthy); experimental has none (`is_archetype = false`). Scale 0–15.
- Descriptor evidence already exists: `v_collaborative_flavor_wheel` (~L2442) unions internal cupping, roastery and client descriptors per coffee with `wheel_category` / `wheel_subcategory` from `cupping_note`. Dimension evidence: `cupping_score_values` (value_min/value_max per dimension per taster) under `cupping_scores.is_merged`.
- Pattern to clone for integrity: `services/quizIntegrity.ts` (`QuizIntegrityCheck { id, name, pass, expected, actual, details? }`, `QuizIntegrityReport { ranAt, allPass, checks }`), its boot hook in `index.ts` (~L215, non-fatal try/catch, `console.warn('[quiz-integrity] …')`), `GET /api/admin/quiz/integrity` (admin.ts L3107), and `frontend/src/app/components/admin/AdminQuizIntegrity.tsx` mounted in `AdminDashboard.tsx` L141.
- Tests: vitest (`npm test` in backend), `vitest.config.ts`, DB-backed tests follow `db/schema.roastery_lifecycle.test.ts` (require `DATABASE_URL`, fixtures named `Vitest…`, deleted in `finally` + `afterAll`).
- Repo is on `main`, level with `origin/main` at `745418a`. `git status` through the Cowork mount shows CRLF noise; `git diff --ignore-all-space --stat` is the truth.

## Part A — `withTransaction()` (`backend/src/db/client.ts`)

```ts
export type Tx = pg.PoolClient;
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}
```

Export it next to `db`. Add a unit test (`db/client.test.ts`) that proves a throw inside `fn` rolls back (insert a `Vitest…` roaster row inside, throw, assert it is absent). Do **not** migrate the eight hand-rolled `db.connect()` sites in this brief — brief 2 does the catalog ones; the rest are out of scope.

## Part B — Schema (`backend/src/db/schema.sql`, idempotent, additive only; mirror the whole block into `backend/src/db/migrations/catalog_blueprint_1_2026_09_13.sql`)

Place the block after the Bloom Dial tables and before the views section, under a header `-- CATALOG BLUEPRINT · brief 1 (2026-09-13)` with a two-line pointer to this file. Comments in the house style: say *why*, cite the decision, keep it short.

### B1. One archetype identity

```sql
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS code archetype_enum;
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS sort_order INT;
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS has_bloom_dial BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS is_archetype BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS dominant_dimension_id INT REFERENCES coffee_dimensions(id);
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS descriptor_families TEXT[] NOT NULL DEFAULT '{}';
-- wheel_category values from cupping_note that count as "on family" for D6; brief 2 reads it.

-- One-time backfill of code from name (the only place the name↔code map is ever written down again):
UPDATE archetype SET code = CASE name
  WHEN 'Chocolate & Nutty' THEN 'chocolate_nutty' WHEN 'Balanced & Sweet' THEN 'balanced_sweet'
  WHEN 'Fruity' THEN 'fruity' WHEN 'Earthy' THEN 'earthy' WHEN 'Floral' THEN 'floral'
  WHEN 'Experimental' THEN 'experimental' END::archetype_enum
WHERE code IS NULL;

-- Copy dial config across (dial_archetype_config stays until brief 5; from now on archetype is the owner):
UPDATE archetype a SET
  has_bloom_dial = dac.has_bloom_dial, is_archetype = dac.is_archetype,
  dominant_dimension_id = dac.dominant_dimension_id
FROM dial_archetype_config dac WHERE dac.archetype = a.code;

UPDATE archetype SET sort_order = CASE code
  WHEN 'floral' THEN 1 WHEN 'fruity' THEN 2 WHEN 'balanced_sweet' THEN 3
  WHEN 'chocolate_nutty' THEN 4 WHEN 'earthy' THEN 5 WHEN 'experimental' THEN 6 END
WHERE sort_order IS NULL;   -- CANONICAL_ARCHETYPE_ORDER from coffees.ts L617

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS archetype_code_key ON archetype(code);
EXCEPTION WHEN unique_violation THEN NULL; END $$;
```

Do **not** make `code` NOT NULL yet (a fresh database seeds `archetype` by name first; the backfill above runs on the same boot and fills it — `index.ts` gets a boot warning if any row is still NULL, see Part D). `descriptor_families` seed values: chocolate_nutty `{'Nutty/Cocoa','Sweet'}`, balanced_sweet `{'Sweet','Nutty/Cocoa','Fruity'}`, fruity `{'Fruity','Sour/Fermented'}`, floral `{'Floral','Fruity'}`, earthy `{'Green/Vegetative','Spices','Roasted'}`, experimental `{}` — **verify these strings against the actual `DISTINCT wheel_category` values in `cupping_note` before seeding and use the real spellings**; if a category does not exist, leave it out and list what you found in the build log.

### B2. `coffee_dial_slot` — the promise

```sql
CREATE TABLE IF NOT EXISTS coffee_dial_slot (
  id                       SERIAL PRIMARY KEY,
  archetype                archetype_enum NOT NULL REFERENCES archetype(code),
  sort_order               INT NOT NULL CHECK (sort_order BETWEEN 1 AND 4),
  name                     TEXT NOT NULL,          -- customer-facing, was dial_slot_alias.platform_name
  position_label           TEXT NOT NULL,          -- was dial_position_vocabulary.label
  position_description     TEXT,
  dimension_id             INT REFERENCES coffee_dimensions(id),
  is_landing_default       BOOLEAN NOT NULL DEFAULT false,
  spec_band_lo             NUMERIC,                -- D6: acceptable merged-cupping range on dimension_id
  spec_band_hi             NUMERIC,
  spec_descriptor_families TEXT[] NOT NULL DEFAULT '{}',   -- empty = inherit archetype.descriptor_families
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now(),
  UNIQUE (archetype, sort_order),
  UNIQUE (name),
  CHECK (spec_band_lo IS NULL OR spec_band_hi IS NULL OR spec_band_lo <= spec_band_hi)
);
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffee_dial_slot_one_landing_default
    ON coffee_dial_slot(archetype) WHERE is_landing_default = true;
EXCEPTION WHEN unique_violation THEN NULL; END $$;
```

Backfill (idempotent, `ON CONFLICT (archetype, sort_order) DO NOTHING`) from `dial_slot_alias` JOIN `dial_position_vocabulary` on (archetype, sort_order). Expect exactly 24 rows. `is_landing_default`: set `true` for `sort_order = 2` on every archetype **only if** no row for that archetype has it yet (this replaces the per-coffee `dial_archetype_positions.is_default`, which was keyed on free-text roaster and produced duplicate defaults — Slot Truth Map F7). Spec bands stay NULL; Dana sets them from the admin page in brief 4.

The `archetype(code)` FK requires `archetype_code_key` to exist first — order the statements accordingly and note it in the comment.

### B3. `coffee_slot_assignment` — placement and fulfilment as one fact

```sql
DO $$ BEGIN
  CREATE TYPE coffee_slot_role_enum AS ENUM ('home', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS coffee_slot_assignment (
  id                  SERIAL PRIMARY KEY,
  slot_id             INT NOT NULL REFERENCES coffee_dial_slot(id),
  coffee_id           INT NOT NULL REFERENCES coffees(id),
  role                coffee_slot_role_enum NOT NULL,
  priority            INT NOT NULL DEFAULT 1 CHECK (priority >= 1),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  deactivated_at      TIMESTAMPTZ,
  deactivation_reason TEXT CHECK (deactivation_reason IS NULL OR deactivation_reason IN ('roaster','manual','moved')),
  placement_note      TEXT,        -- required by brief 2 when the D6 check warns
  certified_at        TIMESTAMPTZ,
  certified_by        TEXT,
  certification_note  TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (slot_id, coffee_id)
);
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffee_slot_assignment_one_active_home
    ON coffee_slot_assignment(coffee_id) WHERE role = 'home' AND is_active = true;
EXCEPTION WHEN unique_violation THEN NULL; END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffee_slot_assignment_one_active_per_priority
    ON coffee_slot_assignment(slot_id, priority) WHERE is_active = true;
EXCEPTION WHEN unique_violation THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS coffee_slot_assignment_slot_active_idx ON coffee_slot_assignment(slot_id) WHERE is_active = true;
```

No backfill (N3). Nothing writes to it in this brief; brief 2's service is its only writer.

### B4. Tighten what stays

```sql
-- archetype_assignments: one current row per coffee (Slot Truth Map F4)
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS archetype_assignments_one_current
    ON archetype_assignments(coffee_id) WHERE superseded_at IS NULL;
EXCEPTION WHEN unique_violation THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE assignment_source_enum AS ENUM ('cupping', 'manual', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE archetype_assignments ADD COLUMN IF NOT EXISTS source assignment_source_enum;
UPDATE archetype_assignments SET source = CASE WHEN assigned_from_session_id IS NOT NULL THEN 'cupping' ELSE 'manual' END::assignment_source_enum WHERE source IS NULL;

-- roaster_blend: one active SKU per (coffee, weight)
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS roaster_blend_one_active_per_weight
    ON roaster_blend(coffee_id, weight_oz) WHERE is_active = true AND coffee_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- dial_slot_price: re-key onto the slot (composite columns stay until brief 5)
ALTER TABLE dial_slot_price ADD COLUMN IF NOT EXISTS slot_id INT REFERENCES coffee_dial_slot(id);
UPDATE dial_slot_price p SET slot_id = s.id FROM coffee_dial_slot s
 WHERE p.slot_id IS NULL AND s.archetype = p.archetype AND s.sort_order = p.dial_sort_order;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS dial_slot_price_slot_weight_key ON dial_slot_price(slot_id, weight_oz) WHERE slot_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- user_bloom_dial_current_position: same, additive
ALTER TABLE user_bloom_dial_current_position ADD COLUMN IF NOT EXISTS slot_id INT REFERENCES coffee_dial_slot(id);
UPDATE user_bloom_dial_current_position u SET slot_id = s.id FROM coffee_dial_slot s
 WHERE u.slot_id IS NULL AND s.archetype = u.archetype AND s.sort_order = u.dial_sort_order;
```

Every partial unique index above is in the self-healing block on purpose: if inactive history somehow violates one, the boot must not roll back, and Part D's boot check reports which index is missing. `coffees.roaster_id NOT NULL`, `roaster_blend.coffee_id NOT NULL` and dropping `roaster_blend.archetype_id` wait for brief 5.

## Part C — Views (`schema.sql`, views section, `DROP VIEW IF EXISTS` + `CREATE VIEW`; do not filter inactive rows *inside* views — expose `is_active` columns so admin "show inactive" can still read them; the exception is `v_coffee_sellable_slot`, whose whole meaning is "active and buyable")

- **`v_coffee_archetype`** — one row per `archetype`: `code, label (= name), description, sort_order, has_bloom_dial, is_archetype, dominant_dimension_id, dominant_dimension_name, descriptor_families, uuid (= id)`. This is what replaces every hand-typed enum→label map in brief 3.
- **`v_coffee`** — one row per coffee (active or not): all `coffees` columns except free-text `roaster`; `roaster_name` from `roaster` via `roaster_id` (fall back to the text column only when `roaster_id IS NULL`, and expose `roaster_name_is_fallback BOOLEAN` so the integrity check can count them); `match_archetype, match_confidence, match_source, match_session_id` from the current `archetype_assignments` row; `category_codes TEXT[]` from `coffee_category_assignment`; `has_story` (= `story_published`); `is_active, deactivated_at, deactivation_reason`.
- **`v_coffee_slot`** — one row per `coffee_slot_assignment` (active or not): `assignment_id, coffee_id, coffee_name, roaster_id, slot_id, archetype AS placement_archetype, sort_order, slot_name, position_label, role, priority, assignment_is_active, coffee_is_active, certified_at, placement_note`, **and** `match_archetype` from `v_coffee` side by side, plus `placement_matches_match BOOLEAN` (= placement_archetype = match_archetype). The column names `placement_archetype` and `match_archetype` are deliberate (D1); never expose a bare `archetype` here.
- **`v_coffee_sellable_slot`** — one row per (slot, weight_oz) that a customer can buy right now. Rule, in this order: the slot is active and has a `name`; candidates are `coffee_slot_assignment` rows on the slot with `is_active` and an active coffee (`coffees.is_active`), **ordered by `role = 'home'` first, then `priority`** (D5); a candidate counts only if `roaster_blend` has an active row for that `coffee_id` at that `weight_oz`; the first such candidate wins (`DISTINCT ON (slot_id, weight_oz)`); price comes from `dial_slot_price` by `slot_id, weight_oz` and the row is present only when a price exists. Columns: `slot_id, archetype, sort_order, slot_name, position_label, is_landing_default, weight_oz, coffee_id, coffee_name, roaster_id, role, priority, blend_id, roaster_sku, shopify_variant_id, retail_price_cents`. Category exclusions from `blendResolver.ts` (decaf / half_caf / flavored never fill a flavor slot; experimental-tagged coffees only fill the experimental dial) are enforced here too, expressed against `v_coffee.category_codes`, so the rule lives in exactly one place.
- **`v_coffee_hop`** — one row per `dial_coffee_relationships` row: its columns, both coffees' names and active flags, `from_slot_id, from_archetype, to_slot_id, to_archetype` from each coffee's active **home** `coffee_slot_assignment`, and `hop_type_derived` = `'within_archetype'` when both home archetypes are equal, `'bridge_archetype'` when both exist and differ, NULL when either end has no home. Keep the stored `hop_type` column exposed as `hop_type_stored` so the integrity check can diff them until brief 5 drops it.

Every view must carry a one-paragraph comment stating what one row means and which readers will move onto it (brief 3), in the style of the existing view comments.

## Part D — `catalogIntegrity.ts` + boot + endpoint + page

**`backend/src/services/catalogIntegrity.ts`** — clone the shape of `quizIntegrity.ts` exactly (`CatalogIntegrityCheck`, `CatalogIntegrityReport`, `runCatalogIntegrityChecks()`), read-only, every check a real query, no auto-fix. Checks, numbered, each with a plain-English `name`, `expected`, `actual`, and `details[]` naming offending ids:

1. Every `archetype` row has `code`, `sort_order`, and for `is_archetype = true` a `dominant_dimension_id`.
2. `coffee_dial_slot` has exactly one active row per (archetype with `has_bloom_dial`, sort_order 1–4) and exactly one `is_landing_default` per archetype.
3. Every required index exists (query `pg_indexes` for: `archetype_code_key`, `coffee_dial_slot_one_landing_default`, `coffee_slot_assignment_one_active_home`, `coffee_slot_assignment_one_active_per_priority`, `archetype_assignments_one_current`, `roaster_blend_one_active_per_weight`, `dial_slot_price_slot_weight_key`, `coffees_active_natural_key`). A missing one means the self-healing block skipped it: report which.
4. Every active `coffee_slot_assignment` points at an active coffee and an active slot.
5. Every active coffee with an active assignment has exactly one active home (0 or ≥2 are both failures).
6. Every active coffee has a current `archetype_assignments` row (match archetype), and a `roaster_id`. (`details`: coffees missing either.)
7. `v_coffee_slot`: rows where `placement_matches_match = false` — **informational, not a failure** (D1 says divergence is legitimate); list them so Dana can see them. `pass` is always true; `actual` carries the count.
8. Placed but not sellable: active slots that have an active assignment but no row in `v_coffee_sellable_slot` at 12 oz, with the reason per slot (no active 12 oz SKU / no price / no name). Informational (`pass` true), listed.
9. Sellable slots: count of distinct slots in `v_coffee_sellable_slot` at 12 oz, per archetype. Informational.
10. `v_coffee_hop`: rows where `hop_type_stored <> hop_type_derived`, or where either end has no active home (stale hop). Failure if any.
11. `v_coffee` rows with `roaster_name_is_fallback = true` among active coffees. Failure if any.
12. `dial_slot_price` rows with `slot_id IS NULL`; `user_bloom_dial_current_position` rows with `slot_id IS NULL`. Failure if any.
13. Legacy tables still populated for **active** coffees (`dial_archetype_positions`, `coffee_alias` rows whose coffee is active) — informational until brief 3, becomes a failure in brief 5; expose a `severity: 'info' | 'fail'` field on the check type for this, defaulting to `'fail'`.

`allPass` counts only `severity = 'fail'` checks.

**Boot (`index.ts`):** a new non-fatal block right after the quiz-integrity one, identical shape, prefix `[catalog-integrity]`, one `console.warn` per failing check with `expected` / `actual`. Also one warning if any `archetype.code IS NULL`.

**Endpoint:** `GET /api/admin/catalog/integrity` in `routes/admin.ts` next to `/quiz/integrity`, same error handling.

**Page:** `frontend/src/app/components/admin/AdminCatalogIntegrity.tsx`, cloned from `AdminQuizIntegrity.tsx` (same fetch pattern, same pass/fail rendering; render `severity = 'info'` checks with a neutral style and their `details` expanded). Mount it in `AdminDashboard.tsx` directly under `<AdminQuizIntegrity />`. No other frontend changes.

## Part E — Tests (vitest, DB-backed, follow `schema.roastery_lifecycle.test.ts`; every fixture prefixed `Vitest`, deleted in `finally` and `afterAll` in dependency order: coffee_slot_assignment → roaster_blend → coffees → roaster)

`backend/src/db/schema.catalog_blueprint.test.ts`:

- `archetype.code` is populated for all six rows and unique; `v_coffee_archetype` returns 6 rows in `sort_order` 1–6.
- `coffee_dial_slot` has 24 rows; inserting a 25th with an existing (archetype, sort_order) fails; a second `is_landing_default` on the same archetype fails.
- `coffee_slot_assignment`: a second active home for the same coffee fails; the same (slot, coffee) twice fails; two active rows at the same (slot, priority) fail; a guest row alongside a home row succeeds.
- `archetype_assignments`: a second row with `superseded_at IS NULL` for the same coffee fails.
- `v_coffee_sellable_slot`: fixture = one active `Vitest` roaster + coffee + current match row + home assignment on floral/2 + active 12 oz `roaster_blend` + a `dial_slot_price` row for that slot at 12 oz → exactly one row for that slot at 12 oz with the fixture's `blend_id`; deactivate the blend → row disappears; add a second coffee as guest priority 2 with its own SKU and deactivate the home coffee → the guest now resolves (D5); tag the coffee `decaf` → row disappears.
- `v_coffee_hop`: two fixture coffees with homes on different archetypes and a hop between them → `hop_type_derived = 'bridge_archetype'`; move one home (deactivate + insert) so both match → `'within_archetype'`.
- `withTransaction` rollback test (Part A).

`backend/src/services/catalogIntegrity.test.ts`: against the seeded DB, `runCatalogIntegrityChecks()` returns `allPass = true` on checks 1–6, 10–12 (13 may be informational). Create a fixture that violates check 5 (coffee with two homes is impossible now; instead deactivate a coffee that still has an active assignment) and assert check 4 fails with the coffee id in `details`.

## Part F — Docs

- `WHAT_WE_BUILT.md`: append a build-log entry in the same format as the latest entries: "Catalog Blueprint · brief 1 — schema, views, integrity", what exists now, what is deliberately **not** done yet (old tables untouched, readers untouched, no service), and the numbered check list from Part D.
- `WHAT_WE_BUILT_DB.md`: new section **"Catalog ownership table"** with one row per fact: fact · table.column · only writer (write "brief 2: catalogService.<fn>" for now) · read through (view). Rows: archetype identity and label; slot identity, name, landing default, spec; placement (home/guest, priority, active); certification; match archetype; SKU; slot price; user dial position; hop physics; hop type (derived). Also update the table count in the header and add the five views to the Views list.
- This folder's `README.md`: flip brief 1's status to EXECUTED with the commit hash.

## Don'ts (scope fence)

- Do not drop, rename or alter the meaning of any existing column or table. `dial_archetype_positions`, `coffee_alias`, `dial_slot_alias`, `dial_position_vocabulary`, `dial_archetype_config`, stored `hop_type`, `roaster_blend.archetype_id`, `coffees.roaster` all stay exactly as they are until brief 5.
- Do not change any reader (`blendResolver.ts`, `sommelierRag.ts`, `coffees.ts`, `axis.ts`, dial graph, QR door, brew card…). Brief 3.
- Do not change any write endpoint in `admin.ts` and do not touch the four pool-level BEGIN/COMMIT blocks. Brief 2.
- Do not delete or edit seed files, and leave the in-schema Kopi Safari position seed (~L1972) alone. Brief 2 retires them.
- Do not add spec-check or blast-radius logic. Columns only. Brief 2.
- No new npm dependencies.

## Definition of done

- `npm run build` clean; `npm test` green including the new DB-backed tests against a database with `schema.sql` applied twice in a row (idempotency: second application must be a no-op with no errors).
- Boot log shows `[catalog-integrity]` warnings only for check 13 (legacy rows for inactive coffees are fine and should not even warn; if it warns for anything else, fix the data or the check before finishing).
- `/admin` shows the Catalog integrity panel under the Quiz integrity panel with every non-informational check green.
- `git diff --ignore-all-space --stat` lists only: `client.ts`, `client.test.ts`, `schema.sql`, the new migration file, `catalogIntegrity.ts` + test, `schema.catalog_blueprint.test.ts`, `index.ts`, `admin.ts` (one new GET), `AdminCatalogIntegrity.tsx`, `AdminDashboard.tsx`, the two WHAT_WE_BUILT docs, and this folder's README.
- Finish with a short report: what you verified in Task 0 that differed from this brief (if anything), the real `wheel_category` strings you seeded into `descriptor_families`, the `coffee_dial_slot` row count after backfill, and the integrity report from the first boot.
