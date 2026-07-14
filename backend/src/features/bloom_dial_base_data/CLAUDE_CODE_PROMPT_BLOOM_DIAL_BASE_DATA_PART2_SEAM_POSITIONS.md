# Claude Code Prompt — Bloom Dial Base Data, Part 2: Seam (Guest) Positions

**Goal:** Let one coffee sit on more than one archetype's dial — a **home** position plus optional **guest** positions at adjacent-archetype edges (the "seam" idea). This is the high-ripple half: it touches the position write path, a shared view, and allocation. Do Part 1 first.

**Decision already made:** distinguish home vs guest with a **stored `is_guest` boolean** on `dial_archetype_positions` (not derived). To keep the flag from drifting, the archetype endpoint stays the sole owner of the *home* row, and guests are written only through the new seam path. Enforce this invariant everywhere:

> A coffee's `is_guest = false` row must always be on the coffee's current (non-superseded) `archetype_assignments.archetype`. Every other dial row for that coffee is `is_guest = true`.

**Source of truth for the seam data:** the **Seam Positions** tab of `Bloom_Dial_Base_Data.xlsx` (same folder). Reasoning: `Bloom_Dial_Base_Data_Reasoning.md` §"Seam positions". The three seams: 6-Bean Espresso → earthy Gentle(1); Colombia (TCR) → fruity Bright(3); Guatemala (TCR) → chocolate_nutty Lighter(1).

**Verified starting facts:**
- `dial_archetype_positions` already has `UNIQUE(archetype, coffee_id)` — the schema already allows one row per archetype per coffee. The only blocker is application code, not the table.
- `POST /api/admin/coffees/:id/archetype` (in `admin.ts`) currently runs `DELETE FROM dial_archetype_positions WHERE coffee_id=$1` then inserts one row — this is what must change so it stops wiping guest rows.
- `v_dial_positions` is defined in `migrations/bloom_dial_seed_2026_06_23.sql` (and mirrored in `schema.sql`); it joins `dial_archetype_positions` and is read by the public Bloom page and admin.
- Allocation/fulfilment reads positions in `services/blendResolver.ts` (and `coffee_alias` logic in `admin.ts`). These must treat only home rows as real.

---

## Phase 1 — Schema

Add to `schema.sql` (idempotent, same style as the existing category ALTERs):
```sql
ALTER TABLE dial_archetype_positions
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;
```
A guest row must never be a default — add a guard:
```sql
-- a guest position can't also be the archetype's default
ALTER TABLE dial_archetype_positions
  ADD CONSTRAINT dap_guest_not_default CHECK (NOT (is_guest AND is_default));
```
(Wrap in the same `DO $$ ... IF NOT EXISTS` pattern the file uses for constraints.)

## Phase 2 — Home write path (change, don't wipe)

In `POST /coffees/:id/archetype`: stop deleting *all* positions for the coffee. Instead manage only the **home** row:
- Delete/replace only the coffee's existing `is_guest = false` row(s) (the old home, e.g. when archetype changes), then upsert the new home row with `is_guest = false`.
- Leave every `is_guest = true` row untouched.
- The existing "clear previous default for same archetype + roaster" step must consider only `is_guest = false` rows.
- Edge case: if the coffee's new home archetype equals an archetype it currently guests on, promote that row (`is_guest = false`) rather than creating a duplicate (the unique key would block it anyway).

## Phase 3 — Seam (guest) endpoints

New admin routes in `admin.ts` (`/api/admin`, `requireAdmin`):
- `POST /dial/positions/guest` — body `{ coffee_id, archetype, vocabulary_id }`. Insert `dial_archetype_positions` with `is_guest = true`, `is_default = false`. Hard reject if `archetype` equals the coffee's current home archetype (that's a home move, not a seam). `ON CONFLICT (archetype, coffee_id)` → 409.
- `DELETE /dial/positions/guest/:id` — remove a guest row (must have `is_guest = true`; refuse to delete a home row through this path).

(UI wiring on `AdminCoffees.tsx` for adding/removing a seam is a nice-to-have follow-up, not required here — the seed below is enough to go live.)

## Phase 4 — Teach the readers about guests

- `v_dial_positions`: add `is_guest` to the SELECT so consumers can filter. Recreate the view (it's `CREATE OR REPLACE`-style in the migration).
- Public Bloom page / any "coffees on this archetype's dial" query that should show only real members: filter `WHERE is_guest = false`, OR intentionally include guests but label them (decide per the page's intent — default to home-only for allocation-relevant reads, include guests only where the seam is meant to be a discovery affordance).
- `services/blendResolver.ts` and the `coffee_alias`/allocation queries in `admin.ts`: **home-only** — add `is_guest = false` so a guest position can never be picked for fulfilment or counted as a slot occupant.
- Liam is already safe: `sommelierRag.ts` reads `v_dial_navigation` (hops), not `v_dial_positions`, so guests don't affect his RAG. Confirm, don't change.

## Phase 5 — Seam seed (SQL)

`dial_seam_positions.sql` from the **Seam Positions** tab: three rows, `is_guest = true`, `is_default = false`.
- 6-Bean Espresso Blend (TCR) → `archetype='earthy'`, vocab sort_order 1 (Gentle).
- Colombia (TCR) → `archetype='fruity'`, vocab sort_order 3 (Bright).
- Guatemala (TCR) → `archetype='chocolate_nutty'`, vocab sort_order 1 (Lighter).
Resolve coffee ids by name+roaster and `vocabulary_id` by `(archetype, sort_order)`. `ON CONFLICT (archetype, coffee_id) DO NOTHING`.

---

## Verification checklist

- [ ] `POST /coffees/:id/archetype` on a coffee that has a guest row does **not** delete the guest.
- [ ] Re-tagging a coffee's archetype moves its `is_guest=false` row but leaves guests; exactly one home row per coffee.
- [ ] The three seam coffees show two `dial_archetype_positions` rows each (one home `is_guest=false`, one guest `is_guest=true`); the guest is never `is_default`.
- [ ] `v_dial_positions` exposes `is_guest`; allocation (`blendResolver.ts`) never returns a guest row.
- [ ] The `dap_guest_not_default` CHECK rejects an attempt to set a guest row as default.
- [ ] Liam's RAG output unchanged.

## Out of scope
Any auto-promotion of guests to home, computed positions (`is_computed`), and cupping-driven retuning — all deferred until cupping data lands, per the "deploy now, tune later" decision.
