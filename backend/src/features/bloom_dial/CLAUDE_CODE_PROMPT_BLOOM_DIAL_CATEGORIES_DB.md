# Claude Code prompt — Coffee categories: database infrastructure + Coffees page UI

Scope note: this covers the schema, the mechanical data backfill, and the Coffees-page UI to manage categories and tag coffees with them. **Category-hop creation** (actually building a hop with a category endpoint, from the Navigation Hops page) stays out of scope — that's a different page, and `is_hoppable` (§4/§5 in Phase 1) is infrastructure for it, not the feature itself; it can be created directly in SQL for now. Companion docs in `backend/src/features/bloom_dial/`: `BLOOM_DIAL_ALLOCATION_SPEC.md` for full background. Do Phase 1 before Phase 2 — the UI has nothing to call until the tables and endpoints exist.

---

# Phase 1 — Database infrastructure

## Context

`experimental` currently sits in `archetype_enum` as if it were a sixth peer flavor family alongside `chocolate_nutty`/`balanced_sweet`/`fruity`/`earthy`/`floral`. It isn't — it's a cross-cutting **category**, the same kind of thing as "Decaf," "Half-Caf," or "Flavored" (which today aren't tracked at all — several real coffees, e.g. `Decaf`, `Sleepwalker Half-Caf`, `Vanilla`, `Hazelnut`, `Chocolate`, sit with `archetype = NULL` and no categorization whatsoever, identified only by their name). A coffee's category (if any) should be independent of its archetype and dial position — tagging a coffee "Decaf" doesn't replace or exempt it from needing a real archetype and a real position the same as any other coffee; it's an additional, orthogonal tag. A coffee can also have no archetype and no category yet — that's a normal, acceptable state (the existing "Unplaced" section on the Coffees page already handles no-archetype coffees; nothing about that changes).

## 1. New table: `coffee_category`

```sql
-- Cross-cutting categories, orthogonal to archetype. Admin-extensible —
-- seeded with the 4 known today, more can be added later without a schema change.
-- is_hoppable: whether a coffee tagged with this category can be a hop endpoint
-- (§4/§5 below). Only 'experimental' is hoppable today — Decaf/Half-Caf/Flavored
-- are format constraints, not flavor destinations, so "try this next" doesn't
-- apply to them the way it does to Experimental. Same pattern as
-- dial_archetype_config.is_archetype from the earlier reorg — a flag on the
-- data, not a hardcoded string check, so opening this up later for another
-- category is a one-row UPDATE, not a schema or code change.
CREATE TABLE IF NOT EXISTS coffee_category (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  is_hoppable BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO coffee_category (code, label, sort_order, is_hoppable) VALUES
  ('experimental', 'Experimental', 1, true),
  ('decaf',        'Decaf',        2, false),
  ('half_caf',     'Half-Caf',     3, false),
  ('flavored',     'Flavored',     4, false)
ON CONFLICT (code) DO NOTHING;
```

## 2. New table: `coffee_category_assignment` (many-to-many)

```sql
-- A coffee can carry more than one category (e.g. a seasonal decaf);
-- a category obviously applies to many coffees. Independent of
-- archetype_assignments / dial_archetype_positions — no FK relationship
-- between them, a coffee can have a category with no archetype yet, or vice versa.
CREATE TABLE IF NOT EXISTS coffee_category_assignment (
  id          SERIAL PRIMARY KEY,
  coffee_id   INT REFERENCES coffees(id) ON DELETE CASCADE,
  category_id INT REFERENCES coffee_category(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (coffee_id, category_id)
);
```

## 3. Backfill known category tags (mechanical — no cupping judgment needed, we already know what these coffees are by name)

```sql
-- Kopi Safari — currently the one coffee tagged archetype='experimental'.
-- This backfills its CATEGORY tag only. Its archetype needs a real tasting
-- decision (out of scope here) — do not auto-assign one.
INSERT INTO coffee_category_assignment (coffee_id, category_id)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Kopi Safari' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT id FROM coffee_category WHERE code = 'experimental')
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Kopi Safari' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (coffee_id, category_id) DO NOTHING;

-- Decaf / Half-Caf / Flavored — Path Coffee Roasters (per WHAT_WE_BUILT_DB.md's
-- catalogue table, these currently have archetype = NULL and no categorization).
INSERT INTO coffee_category_assignment (coffee_id, category_id)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Decaf' AND roaster = 'Path Coffee Roasters'),
       (SELECT id FROM coffee_category WHERE code = 'decaf')
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Decaf' AND roaster = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (coffee_id, category_id) DO NOTHING;

INSERT INTO coffee_category_assignment (coffee_id, category_id)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Sleepwalker Half-Caf' AND roaster = 'Path Coffee Roasters'),
       (SELECT id FROM coffee_category WHERE code = 'half_caf')
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Sleepwalker Half-Caf' AND roaster = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (coffee_id, category_id) DO NOTHING;

INSERT INTO coffee_category_assignment (coffee_id, category_id)
SELECT (SELECT MIN(id) FROM coffees WHERE name = v.coffee_name AND roaster = 'Path Coffee Roasters'),
       (SELECT id FROM coffee_category WHERE code = 'flavored')
FROM (VALUES ('Vanilla'), ('Hazelnut'), ('Chocolate')) AS v(coffee_name)
WHERE (SELECT MIN(id) FROM coffees WHERE name = v.coffee_name AND roaster = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (coffee_id, category_id) DO NOTHING;
```

(Verify the roaster string and exact coffee names against the live `coffees` table before running — the above matches the catalogue as documented in `WHAT_WE_BUILT_DB.md`; adjust if any have since changed.)

## 4. Extend `dial_coffee_relationships` for category-endpoint hops

`from_coffee_id`/`to_coffee_id` are already nullable in the current schema — no `DROP NOT NULL` needed. Add matching nullable category columns and a constraint ensuring exactly one endpoint type is set per side:

```sql
ALTER TABLE dial_coffee_relationships ADD COLUMN IF NOT EXISTS from_category_id INT REFERENCES coffee_category(id);
ALTER TABLE dial_coffee_relationships ADD COLUMN IF NOT EXISTS to_category_id   INT REFERENCES coffee_category(id);

DO $$ BEGIN
  ALTER TABLE dial_coffee_relationships ADD CONSTRAINT chk_from_endpoint
    CHECK ((from_coffee_id IS NOT NULL) <> (from_category_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE dial_coffee_relationships ADD CONSTRAINT chk_to_endpoint
    CHECK ((to_coffee_id IS NOT NULL) <> (to_category_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

A hop can now be coffee→coffee (today's only case), coffee→category, category→coffee, or category→category. Note the existing `UNIQUE(from_coffee_id, to_coffee_id, dimension_id, direction)` constraint won't meaningfully dedupe category-endpoint hops (`NULL <> NULL` in Postgres uniqueness — same caveat already documented elsewhere in this schema for `coffee_alias`'s NULL-archetype rows). That's acceptable for now; don't try to fix it in this pass.

**Only `experimental` is a valid category-hop endpoint today** (`coffee_category.is_hoppable = true`) — Decaf, Half-Caf, and Flavored are not connectable via hops. Postgres `CHECK` constraints can't reference another table, so this isn't enforced at the DB level here — it's a rule for whichever future pass builds the actual category-hop creation endpoint (out of scope in this DB-only prompt, see below) to enforce: reject any `from_category_id`/`to_category_id` where the referenced `coffee_category.is_hoppable` isn't `true`, the same way route-level validation already works elsewhere in this codebase (Phase 4's hop checks in `admin.ts` — no triggers used anywhere in this schema, keep it that way).

## 5. New `hop_type_enum` value for category-involving hops

```sql
ALTER TYPE hop_type_enum ADD VALUE IF NOT EXISTS 'category_hop';
```

A category-endpoint hop is a fuzzier signal than a coffee-to-coffee one (a category doesn't have a single dimension score the way a specific coffee does — different coffees under "Decaf" could score differently), so it gets its own `hop_type` rather than being forced into `within_archetype`/`bridge_archetype`. Whatever validation/adjacency logic reads `hop_type` (the Phase 4 hop-creation checks and `v_archetype_adjacency` from the earlier reorg work) should treat `category_hop` rows as out of scope for the archetype-consistency checks and the adjacency rollup — those assume both endpoints are coffees with a real archetype, which won't hold here. Don't modify that logic in this pass; just make sure nothing errors if a `category_hop` row exists (e.g. any query that assumes `from_coffee_id`/`to_coffee_id` are always non-null should already be scoped to `hop_type IN ('within_archetype','bridge_archetype')` or should tolerate NULLs — check `v_archetype_adjacency`'s definition and adjust its `WHERE` clause to explicitly exclude `hop_type = 'category_hop'` if it doesn't already).

## 6. Guard against `experimental` being assigned as an archetype going forward

In `POST /api/admin/coffees/:id/archetype` (`backend/src/routes/admin.ts`), reject `archetype = 'experimental'` with a clear error, e.g. `"'experimental' is a category, not an archetype — tag the coffee under Categories instead."` This is the actual mechanism that retires `experimental` from being chosen as an archetype going forward; the `is_archetype = false` flag on `dial_archetype_config` (from the earlier reorg) only ever guarded *suggestion* logic, not assignment itself.

## Phase 1 — explicitly out of scope

- The actual `POST /dial/relationships` changes needed to accept `from_category_id`/`to_category_id` in a request, including the `is_hoppable` check (§4) — building an actual category-hop is a Navigation Hops page feature, not a Coffees page one, and stays out of scope for this whole prompt (Phase 1 and 2 both). Category-endpoint hops can only be created directly in SQL for now (see Phase 1 Test below). Enforcing `is_hoppable` is documented here so it isn't lost, not built here.
- Assigning a real archetype to Kopi Safari, Decaf, Sleepwalker Half-Caf, Vanilla, Hazelnut, or Chocolate — that needs an actual tasting/cupping decision, not something to script.
- Deleting or altering the existing `experimental` row in `dial_archetype_config`, its `dial_position_vocabulary` entries, or Kopi Safari's current `dial_archetype_positions` row — leave as legacy scaffolding; it'll clean itself up naturally the normal way (delete-then-insert) once Kopi Safari is re-assigned a real archetype through the existing endpoint.
- Any change to `v_archetype_adjacency`'s core logic beyond making sure `category_hop` rows don't break it (§5) — a fuller "category adjacency" concept is future work, not this pass.

## Phase 1 — Test

- `SELECT * FROM coffee_category ORDER BY sort_order;` returns 4 rows, only `experimental` with `is_hoppable = true`.
- `SELECT cc.label, c.name FROM coffee_category_assignment cca JOIN coffee_category cc ON cc.id = cca.category_id JOIN coffees c ON c.id = cca.coffee_id;` shows Kopi Safari → Experimental, Decaf → Decaf, Sleepwalker Half-Caf → Half-Caf, and Vanilla/Hazelnut/Chocolate → Flavored.
- Insert a test `dial_coffee_relationships` row directly via SQL with `to_coffee_id = NULL`, `to_category_id` set to the `experimental` category's id, `hop_type = 'category_hop'` — confirm it saves. Confirm a row with both `to_coffee_id` and `to_category_id` set (or both NULL) is rejected by the new CHECK constraint. (Raw-SQL test only — there's no endpoint to do it through the API, by design, see out-of-scope above.)
- Attempt `POST /api/admin/coffees/:id/archetype` with `archetype: 'experimental'` — confirm it's rejected with the new error message.
- Confirm `v_archetype_adjacency` still runs without error after a `category_hop` row exists.

---

# Phase 2 — Coffees page UI

Categories management and per-coffee tagging live on the Coffees page (`AdminCoffees.tsx`) — the same page that already handles archetype, dial position, and alias, per the earlier decision to keep every placement concern in one place rather than fragmenting into a new nav entry.

## 2a. Backend — category CRUD

```
GET   /api/admin/categories          — all coffee_category rows (including inactive, so an admin can reactivate one), ordered by sort_order
POST  /api/admin/categories          — create { code, label } — is_hoppable is NOT accepted from the client here; it defaults false and stays a deliberate, manual flag (per §1 in Phase 1 — hoppability is a considered decision, not a checkbox an admin flips casually when adding a new category)
PATCH /api/admin/categories/:id      — update { label, is_active }
```

## 2b. Backend — per-coffee category assignment

```
GET    /api/admin/coffee-categories       — all coffee_category_assignment rows, joined with coffee name and category label/code (mirrors the shape GET /api/admin/coffee-alias already returns)
POST   /api/admin/coffee-categories       — assign { coffee_id, category_id }
DELETE /api/admin/coffee-categories/:id   — remove one assignment
```

## 2c. Frontend — Categories panel

A compact, collapsible section on `AdminCoffees.tsx`, placed below the header/"+ Add Coffee" button and above the archetype matrix (it's a small, infrequently-touched management tool, not the main focus of the page). Lists existing categories with their active/inactive state (toggle via `PATCH /api/admin/categories/:id`) and a "+ Add category" form (label text input; derive `code` from it — lowercase, spaces to underscores — rather than asking the admin to type a slug by hand).

## 2d. Frontend — per-coffee tagging

In the `EditForm` (same place archetype/confidence/dial-position/alias already live), add a "Categories" row: a checkbox per active category, checked if a `coffee_category_assignment` exists for this coffee. Toggling calls `POST`/`DELETE /api/admin/coffee-categories` immediately (no separate Save step needed — same immediate-toggle pattern already used for alias active/inactive).

## 2e. Frontend — category badges in the matrix

In `CoffeeChip`, show a small badge next to the coffee's name for each category it carries (e.g. a muted "Decaf" pill). This applies in the archetype matrix (a categorized coffee still displays under its real archetype, same as any coffee) **and** in the "Unplaced" section (a coffee can have a category and no archetype yet — e.g. Kopi Safari today — and should still show its category badge there).

## Phase 2 — explicitly out of scope

- Editing a category's `is_hoppable` flag from this UI at all — that stays a deliberate backend/manual decision (direct SQL), not something exposed to click.
- Deleting a category outright (only deactivate) — avoids orphaning `coffee_category_assignment` rows silently.
- Category-hop creation UI (Navigation Hops page) — unaffected by this prompt, still a future pass.

## Phase 2 — Test

- Create a new category ("Seasonal") via the panel, confirm it appears immediately and can be assigned to a coffee.
- Tag Kopi Safari with "Experimental" via its `EditForm` checkbox (it should already be tagged from the Phase 1 backfill — confirm the checkbox reflects that on load), confirm it shows a badge in the Unplaced section (it has no archetype yet).
- Tag a coffee that already has a real archetype (e.g. mark any Balanced & Sweet coffee "Seasonal" for testing) and confirm its badge shows correctly inside the archetype matrix, not just Unplaced.
- Deactivate a category and confirm it stops appearing as a checkbox option for *new* tagging, without removing existing assignments already using it.
