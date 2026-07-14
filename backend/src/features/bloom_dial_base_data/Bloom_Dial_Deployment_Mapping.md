# Bloom Dial Base Data — Mapping to DB & UI (deployment plan)

How each tab/column of `Bloom_Dial_Base_Data.xlsx` lands in the database and which admin surface owns it. Grounded in the current code (`backend/src/routes/admin.ts`, `frontend/src/app/components/admin/`), not the spec docs — where the two disagree, the code wins and it's flagged below.

## Write surfaces (there are three, not one)

1. **Admin UI** — for things the deployed API already supports (archetype, one dial position per coffee, category tags).
2. **Seed SQL** run in Cloud SQL Studio — for things with no working write API (the hop graph), matching the existing `backend/src/db/seeds/*.sql` pattern.
3. **Needs a small code change first** — for two things the current API cannot express (seam positions; a live hop-write endpoint). These go through a Claude Code prompt.

## Tab → DB → UI

| Workbook tab | DB table(s) | Write path (API) | Admin UI | Surface |
|---|---|---|---|---|
| Archetype Map — *Archetype* col | `archetype_assignments` | `POST /api/admin/coffees/:id/archetype` (supersedes prior, inserts new) | AdminCoffees — archetype control | **UI** |
| Archetype Map / Dial Positions — *home* position + *Default?* | `dial_archetype_positions` (one row/coffee) | same endpoint, with `vocabulary_id` + `dial_is_default` | AdminCoffees — position arrows / edit form | **UI** |
| Archetype Map — *Category* col | `coffee_category` (list) + coffee↔category join | `POST /api/admin/coffee-categories` `{coffee_id, category_id}` | AdminCoffees — Categories panel | **UI** |
| Dial Turns (within-archetype) | `dial_coffee_relationships` (`hop_type='within_archetype'`) | *(intended: `POST /api/admin/dial/relationships` — see Gap B)* | AdminDial "Navigation Hops" | **Seed SQL** |
| Bridge Hops (cross-archetype) | `dial_coffee_relationships` (`hop_type='bridge_archetype'`; Kopi Safari row → experimental) | same as above | AdminDial "Navigation Hops" | **Seed SQL** |
| Seam Positions | extra `dial_archetype_positions` rows where `archetype` ≠ the coffee's home archetype | none — current endpoint forbids it (Gap A) | — | **Code change** |
| Archetype Graph | *none* — adjacency is **derived** (`v_archetype_adjacency`) from the bridge hops | n/a | AdminDial adjacency read-out | **Doc only** |

## Column-level resolution

**Dial position** — the workbook stores `(archetype, sort_order)` + label. The API wants `vocabulary_id`:
```sql
SELECT id FROM dial_position_vocabulary
WHERE archetype = :archetype AND sort_order = :slot;   -- dimension_id is implied by archetype
```
`is_default` → `dial_is_default`. The endpoint already clears the previous default for that archetype+roaster before setting a new one.

**Hops** (`dial_coffee_relationships`) — resolve endpoints and dimension by name:
```sql
from_coffee_id = (SELECT MIN(id) FROM coffees WHERE name=:from_name AND roaster=:from_roaster)
to_coffee_id   = (SELECT MIN(id) FROM coffees WHERE name=:to_name   AND roaster=:to_roaster)
dimension_id   = (SELECT id FROM coffee_dimensions WHERE name=:dimension)   -- Acidity=5, Bitterness=6, Body=7, Savory/Depth=9
```
Direct column map: `direction` (more/less) · `delta` · `hop_type` · `is_recommended` (TRUE/FALSE) · `confidence` (high/medium/low) · `notes`. Unique key is `(from_coffee_id, to_coffee_id, dimension_id, direction)` — so the **secondary-dimension bridge rows for CN↔Earthy and Fruity↔Floral are legal extra rows** (different `dimension_id`), no conflict. Each "more"/"less" workbook pair = two rows.

**Category tags** — the four categories (Experimental, Decaf, Half-Caf, Flavored) live in `coffee_category`; tag a coffee with its `category_id`. Note the code comment in `POST /coffees/:id/archetype`: Kopi Safari's *Experimental* tag is still applied through the legacy `archetype='experimental'` path, so decide which mechanism owns it before double-tagging.

## Two gaps that need a Claude Code prompt

**Gap A — seam positions aren't writable.** `POST /coffees/:id/archetype` runs `DELETE FROM dial_archetype_positions WHERE coffee_id = $1` then inserts exactly one row. So a coffee can hold only one dial position through the API, even though the table's `UNIQUE(archetype, coffee_id)` permits one per archetype. To deploy the Seam Positions tab (6-Bean also on earthy, Colombia TCR also on fruity, Guatemala also on CN) we need either a new endpoint that adds a *guest* position without wiping the home one, or a deliberate SQL insert — plus a rule that a guest row never carries `is_default` and is ignored by allocation/SKU logic.

**Gap B — no live hop-write endpoint.** `AdminDial.tsx` posts to `/api/admin/dial/relationships`, but I could not find a matching handler in `admin.ts` or any mounted router; `dial_coffee_relationships` is currently only *read* (by `dialSuggestion.ts` and `sommelierRag.ts`). Until that endpoint is confirmed/implemented, all Dial Turns and Bridge Hops must be seeded via Cloud SQL Studio. Worth verifying against the deployed backend before assuming the Navigation Hops page can save.

## Suggested deployment order

Dependencies run top-down; each step assumes the previous committed.

1. **Archetype assignments** — resolve Feather In Cap first, then the 6 proposed archetypes. UI (per coffee) or a `archetype_assignments` seed.
2. **Home dial positions** — apply the spread moves (6-Bean→Full, Blonde→Bright, Colombia TCR→Lively, Vantablack/Uganda→Intense). These *supersede* the existing seeded positions, so it's a re-seed/overwrite, not a fresh insert.
3. **Category tags** — the 6 uncategorized coffees, via the Categories panel or a join-table seed.
4. **Hops** — seed `dial_coffee_relationships` (Dial Turns + Bridges, incl. secondary-dimension rows). No reliable UI path today.
5. **Seam positions** — only after Gap A is built; then SQL or the new endpoint.

Steps 1–3 are deployable now through the admin UI. Steps 4–5 want a Claude Code prompt: one to generate the hop seed (and, if desired, implement Gap B's endpoint), one for Gap A. I can write either.
