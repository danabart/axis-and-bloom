# Claude Code Prompt — Bloom Dial Base Data, Part 1: Seeds + Hop Endpoint

**Goal:** Load the Bloom Dial base data (archetypes, dial positions, category tags, and the hop graph) and build the missing hop-authoring endpoint. This is the low-ripple half — nothing here changes the "one home position per coffee" invariant (that's Part 2). Seam/guest positions are explicitly out of scope here.

**Source of truth for all data:** `backend/src/features/bloom_dial_base_data/Bloom_Dial_Base_Data.xlsx`, with the reasoning in `Bloom_Dial_Base_Data_Reasoning.md` and the table/column mapping in `Bloom_Dial_Deployment_Mapping.md` (same folder). Read all three before starting.

**Verified starting facts (do not re-derive — confirm, then build):**
- Admin routes live in `backend/src/routes/admin.ts`, mounted at `/api/admin`, all behind `requireAdmin`.
- Archetype + home position are written today by `POST /api/admin/coffees/:id/archetype` (supersedes `archetype_assignments`; if `vocabulary_id` given, DELETEs all `dial_archetype_positions` for the coffee and inserts one). Leave this endpoint's behavior alone in Part 1.
- `dial_coffee_relationships` currently has **no write or read route** and is only read by `services/dialSuggestion.ts` and `services/sommelierRag.ts` (via `v_dial_navigation`). `frontend/src/app/components/admin/AdminDial.tsx` already calls `GET/POST/DELETE /api/admin/dial/relationships` — build to that exact contract.
- `getAvgCuppingScore(coffeeId, dimensionId)` already exists in `services/dialSuggestion.ts` and is already imported into `admin.ts`.
- Dimensions: Acidity=5, Bitterness=6, Body=7, Savory/Depth=9. Enums: `hop_direction_enum('more','less')`, `hop_type_enum('within_archetype','bridge_archetype','category_hop')`, `confidence_enum('low','medium','high')`.

---

## Phase A — Base-data seeds (SQL only, no code)

Generate idempotent, run-once seed files under `backend/src/db/seeds/`. Each file header must say "Do NOT add to schema.sql — not idempotent for repeated archetype history" where relevant. Resolve coffee ids with `(SELECT MIN(id) FROM coffees WHERE name=:name AND roaster=:roaster)`. Read the **Archetype Map** tab for every value.

1. `archetype_assignments_base.sql` — one non-superseded assignment per placed coffee, matching the *Archetype* column. This includes:
   - **Feather In Cap → balanced_sweet** (resolves the seed conflict; supersede any existing non-superseded row first).
   - The 6 previously-unplaced coffees at their proposed archetypes (Kopi Safari→earthy, Sleepwalker/Decaf/Hazelnut/Chocolate→chocolate_nutty, Vanilla→balanced_sweet), `confidence='low'`, `notes='Pre-cupping proposal — tune after cupping'`.
   - Use the supersede-then-insert pattern already in `POST /coffees/:id/archetype`. Skip a coffee only if it already has the exact same non-superseded archetype.

2. `dial_positions_base.sql` — upsert `dial_archetype_positions` to the **Dial Positions** tab, honoring the **spread rule** (these differ from the older `dial_positions_path_tcr.sql`, so they must UPDATE):
   - Moved home positions: 6-Bean Espresso→Full(4), Blonde Blend→Bright(3), Colombia (TCR)→Lively(4), Vantablack→Intense(4), Uganda→Intense(4). All other placed coffees per the tab.
   - Resolve `vocabulary_id` via `SELECT id FROM dial_position_vocabulary WHERE archetype=:archetype AND sort_order=:slot`.
   - `is_default` per the tab (the `*` rows). Use `INSERT ... ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default`.
   - Set `is_guest = false` on every row **only if** the `is_guest` column exists (it won't until Part 2 — guard with a check, or omit and let Part 2 default handle it).
   - The 6 off-dial coffees get **no** position row (they stay unplaced until cupped).

3. `coffee_category_base.sql` — tag categories per the *Category* column via `coffee_category_assignment` (resolve `category_id` from `coffee_category` by name: Experimental, Decaf, Half-Caf, Flavored). Kopi Safari→Experimental, Sleepwalker→Half-Caf, Decaf→Decaf, Vanilla/Hazelnut/Chocolate→Flavored. `ON CONFLICT DO NOTHING`. Note in the header: Kopi Safari may already be tagged Experimental via the legacy `archetype='experimental'` path — the assignment above now makes earthy its real archetype, so confirm the Experimental tag comes only from `coffee_category_assignment` going forward.

---

## Phase B — Hop-authoring endpoint (Gap B, code)

Add to `admin.ts` (so they mount under `/api/admin`, behind `requireAdmin`). **First read `AdminDial.tsx`** and match the request/response field names it already expects — do not invent a shape.

- `GET /dial/relationships` — list hops. Return each row joined to coffee names + roaster and dimension name (mirror `v_dial_navigation`, but include ids so the UI can edit/delete). 
- `POST /dial/relationships` — create one hop. Body: `from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes`. Validation:
  - **Hard reject** a `within_archetype` hop whose two coffees do **not** share the same current (non-superseded) archetype; **hard reject** a `bridge_archetype` hop whose two coffees **do** share one. (Logical contradiction, not a judgment call.)
  - **Soft warning (non-blocking)**: if both coffees have merged cupping scores on `dimension_id` (`getAvgCuppingScore`), and the claimed `direction` contradicts the score delta, return the created row with a `warning` field. Never block on this — cupping is sparse.
  - Respect the unique key `(from_coffee_id, to_coffee_id, dimension_id, direction)` — on conflict return 409. Hops are **add-only** (append pattern, no in-place edit), consistent with `archetype_assignments`.
  - `category_hop` creation is **out of scope** — reject it here with a clear message; those stay SQL-only for now.
- `DELETE /dial/relationships/:id` — remove one hop.

Keep the existing `getAvgCuppingScore` import; don't duplicate query logic.

---

## Phase C — Hop seed (SQL)

`dial_relationships_base.sql` from the **Dial Turns** and **Bridge Hops** tabs. Each "more"/"less" pair in the workbook = two rows. Columns map 1:1: `from_coffee_id`, `to_coffee_id` (resolve by name+roaster), `dimension_id` (by name), `direction`, `delta`, `hop_type`, `is_recommended` (TRUE/FALSE), `confidence`, `notes`. Include the **secondary-dimension** bridge rows for CN↔Earthy (Savory/Depth) and Fruity↔Floral (Body) — they're legal because `dimension_id` is in the unique key. `ON CONFLICT (from_coffee_id,to_coffee_id,dimension_id,direction) DO NOTHING`.

**One `category_hop` row (special handling):** the Bridge Hops tab's `Bali Blue → Experimental (category)` row is `hop_type='category_hop'`, not a coffee→coffee bridge. Seed it with `from_coffee_id` = Bali Blue, `to_category_id` = the Experimental `coffee_category` id, and `to_coffee_id = NULL` (and the reverse row with the sides swapped) — the CHECK constraints require exactly-one-of coffee/category per side. Insert it **only in this SQL seed**; the Phase B endpoint deliberately rejects `category_hop` creation. Note it is excluded from `v_dial_navigation` (which inner-joins coffees on both sides), so it does not reach Liam until category traversal is built — that's expected, not a bug.

**Retire/convert one row:** the Session-001 seed (`migrations/bloom_dial_seed_2026_06_23.sql`) created a Crosshatch↔Feather In Cap **body** `bridge_archetype` hop assuming Feather = chocolate_nutty. With Feather now balanced_sweet (Phase A), that's a within-archetype pair — DELETE those two rows (both directions) so a `bridge_archetype` hop doesn't connect two same-archetype coffees. (A within_archetype Dial Turn between them already exists in the hop seed if appropriate.)

---

## Verification checklist

- [ ] `SELECT archetype, COUNT(*) FROM archetype_assignments WHERE superseded_at IS NULL GROUP BY 1` — 6 archetypes incl. the proposals; Feather is balanced_sweet.
- [ ] `SELECT * FROM v_dial_positions` — 6-Bean at Full, Colombia(TCR)/Blonde/Vantablack/Uganda at their spread slots.
- [ ] `GET /api/admin/dial/relationships` returns the seeded hops; the Navigation Hops page loads.
- [ ] `POST` a bad `within_archetype` hop (two different archetypes) → 400; a bad `bridge_archetype` (same archetype) → 400.
- [ ] No `bridge_archetype` row connects two coffees of the same current archetype (the retired Crosshatch↔Feather row is gone).
- [ ] Liam unaffected: `sommelierRag.ts` still reads `v_dial_navigation` unchanged.

## Out of scope (Part 2)
Seam/guest positions, the `is_guest` column, the position-endpoint change, and any `v_dial_positions`/allocation filtering. Do not touch `POST /coffees/:id/archetype` here.
