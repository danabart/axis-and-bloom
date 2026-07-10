# Claude Code prompt — Bloom Dial follow-up 1: priority swap, alias editing, hop validation + suggestions

Follow-up to `CLAUDE_CODE_PROMPT_BLOOM_DIAL_REORG.md` (already deployed) in this same folder — read that first for full context on the tables/pages involved. This prompt addresses gaps found after using the deployed reorg: a real bug (priority swap), a missing feature (alias editing), a navigation call, and two new pieces of hop-graph behavior (validation at creation time, and computed suggestions from cupping data). Do the phases in order; each is independently testable.

---

## Phase 1 — Fix the priority-swap bug (parallel miss to the Phase 1 position fix)

**Bug:** `PATCH /api/admin/coffee-alias/:id` in `backend/src/routes/admin.ts` (the endpoint the Coffees page's rank editor calls) does a plain `UPDATE coffee_alias SET priority = $1 WHERE id = $2` — no check for whether another alias already holds that priority within the same slot. Result: setting a coffee's rank to a number another coffee already has produces two aliases at the same rank (e.g. two "2nd choice") and nobody at the rank that got vacated. The equivalent dial-*position* endpoint (`PATCH /dial/positions/:id`) already has correct swap logic from the original reorg — this one was missed.

**Fix:** before updating, determine which *other* alias rows are "in the same slot" as the one being edited — same live archetype and dial position, i.e. the same derivation `GET /api/admin/coffee-alias` already uses (`COALESCE(aa.archetype, ca.archetype)` / `COALESCE(dpv.sort_order, ca.dial_sort_order)`, joined via `dial_archetype_positions` and `archetype_assignments`), not the possibly-stale stored `coffee_alias.archetype`/`dial_sort_order` columns directly. Among those, find the one currently holding the target `priority`. If one exists, swap in a transaction (give it the mover's old priority); if none does, update as today.

**Test:** in Coffees, set two different coffees within the same alias slot to rank 1 and rank 2. Then edit the rank-2 one to rank 1 — confirm the formerly-rank-1 coffee becomes rank 2 (swap), not both landing on 1. Confirm Blends & SKUs reflects the swap immediately (it already reads live, no change needed there).

---

## Phase 2 — Alias editing (rename + active/inactive)

**Gap:** the Coffees page can create a new alias and edit its rank, but there's no way to rename an existing alias's `platform_name` or toggle `coffee_alias.is_active` — that column exists and is returned by the API but nothing in either admin page shows or changes it.

**2a. Backend:** extend `PATCH /api/admin/coffee-alias/:id` to also accept `platform_name` (string) and `is_active` (boolean) alongside the existing `priority`, updating whichever fields are present (`COALESCE`-style partial update, same pattern used elsewhere in this file, e.g. `admin/inventory/:id`). Keep the existing priority-swap fix from Phase 1 scoped only to when `priority` is actually being changed.

**2b. Frontend, `AdminCoffees.tsx`:** in the `EditForm`'s alias section (where `existingAlias` is shown), turn the plain `platform_name` text into an editable field (small "Edit" toggle like the rank editor already uses — click to reveal a text input + Save/Cancel) and add an active/inactive toggle badge next to the rank badge, matching the visual style already used for blend active/inactive toggles in `AdminInventory.tsx`. Both call the extended `PATCH /api/admin/coffee-alias/:id`.

**Test:** rename an existing alias's platform name from Coffees, confirm it persists after reload and shows the new name on Blends & SKUs. Toggle an alias inactive, confirm `is_active` flips in the DB (decide alongside this whether an inactive alias should still display on Blends & SKUs or be visually deprioritized — simplest: keep showing it, just with a muted "Inactive" badge, consistent with how inactive blends already display there).

---

## Phase 3 — Move "Bloom Dial" out of the Sommelier AI nav section

In `frontend/src/app/components/admin/AdminLayout.tsx`, move the `{ to: '/admin/dial', label: 'Bloom Dial' }` entry out of the `Sommelier AI` section and into `Catalogue & Supply`, alongside Coffees, Roasteries, and Blends & SKUs. Reasoning: the hop graph now feeds the archetype-adjacency summary and the Coffees suggestion cross-check (both catalogue/archetype concerns) in addition to Liam's RAG context — it's no longer primarily a Sommelier-AI-only tool. No change to the route, the label text itself, or the page's own heading ("Navigation Hops") — this is purely which section of the sidebar it's grouped under.

---

## Phase 4 — Validate hops at creation time

Hops stay add-only (confirmed: no in-place edit, remove-and-re-add is the intended pattern, consistent with the append/supersede style already used for `archetype_assignments` and `dial_position_signal` elsewhere in this system) — this phase is about catching nonsense *before* it's committed, not adding an edit UI.

In `POST /api/admin/dial/relationships` (`backend/src/routes/admin.ts`), before the existing insert:

**4a. Hard validation (400, reject — these are logical contradictions, not judgment calls):**
- `from_coffee_id === to_coffee_id` → "A hop needs two different coffees."
- Look up both coffees' current archetype (`archetype_assignments`, `superseded_at IS NULL`). If either has none → "Both coffees need an archetype assigned before a hop can be added."
- `hop_type = 'within_archetype'` but the two archetypes differ → "Dial Turn hops must connect two coffees in the same archetype — these are tagged {archetype A} and {archetype B}."
- `hop_type = 'bridge_archetype'` but the two archetypes are the *same* → "Hop relationships must connect two different archetypes — both these coffees are tagged {archetype}."

**4b. Soft validation (still save, return a `warning` string in the response instead of blocking — this is a judgment call, not a contradiction, and cupping data can be sparse or wrong):** if both coffees have merged cupping data on `dimension_id` (same query pattern as `getDialSuggestion` in `backend/src/services/dialSuggestion.ts`), compute whether `to_coffee`'s avg score is actually higher or lower than `from_coffee`'s — reuse the exact convention already established in `findHopConflict` in that file: **`direction: 'more'` means `to_coffee` has more of the dimension than `from_coffee`.** If the real cupping data contradicts the claimed direction, include e.g. `warning: "Cupping data suggests this is backwards — {to_coffee} currently scores lower on {dimension} than {from_coffee} per existing sessions."` in the 201 response. Also warn (not block) if a hop already exists between the same pair + dimension with the *opposite* direction (the exact duplicate case is already caught by the existing unique constraint / 409).

**4c. Frontend, `AdminDial.tsx`:** after a successful `handleAddHop`, if the response includes a `warning`, show it as a dismissible amber note near the form instead of just closing it silently.

**Test:** try adding a hop between two coffees you know are tagged different archetypes with `hop_type: within_archetype` — confirm it's rejected with a clear message. Try the reverse (same archetype, `bridge_archetype`) — same. Add a hop between two coffees with real, known cupping data (e.g. from Session 001) in a direction you know contradicts their actual scores — confirm it still saves but returns a warning, and the warning shows in the UI.

---

## Phase 5 — Computed hop suggestions from cupping data (within-archetype only)

You confirmed hops should end up data-driven, not purely hand-curated. This is the first real piece of that: suggest *new* Dial Turn hops directly from cupping scores that already exist — no guessing, no new mapping tables, same "compute from what's measured" approach as the Phase 3 position suggestion and Phase 5 signal infrastructure from the original reorg prompt. Cross-archetype (Hop/bridge) suggestions are **not** part of this phase — deciding which dimensions make two different archetypes "close enough" to bridge is a judgment call that needs the archetype-adjacency data this system is still accumulating, not something to compute from a single dimension the way within-archetype comparisons can be. Flag that as a future phase once `v_archetype_adjacency` has real volume to reason from, don't attempt it here.

**5a. Backend**, e.g. `GET /api/admin/dial/hop-suggestions`: for every pair of coffees that currently share the same real archetype (`dial_archetype_config.is_archetype = true`) and both have merged cupping data on that archetype's dominant dimension, compute each coffee's avg score (same query as `getDialSuggestion`) and the delta between them. Reuse that archetype's bucket width (`(target_max - target_min) / N`, same as the Phase 3 suggestion math) as the meaningfulness threshold — only surface a suggestion when the delta is at least one bucket width, since anything smaller isn't a distinguishable difference on that archetype's own scale. Skip any pair where a `within_archetype` hop already exists between them on that dimension (in either direction). Return `{ from_coffee_id, from_coffee_name, to_coffee_id, to_coffee_name, dimension_id, dimension_name, direction, delta, archetype }` for each suggestion, `direction` computed the same way as Phase 4b (`'more'` if the "to" coffee scores higher).

**5b. Frontend, `AdminDial.tsx`:** add a section (e.g. below the existing archetype-adjacency summary) — "Suggested Dial Turns (from cupping data)" — listing each suggestion with a one-click "Add" button that pre-fills and submits `POST /api/admin/dial/relationships` with `hop_type: 'within_archetype'`, `confidence: 'medium'`, and a note like `"Suggested from cupping data — {delta} pt difference on {dimension}"`. Empty state: "No suggestions yet — needs at least two cupped coffees in the same archetype with a meaningful score difference." Given there are currently only 3 real cupping sessions in the system, expect this list to be short or empty at first — that's correct behavior, not a bug, and it'll grow as more sessions get logged.

**Test:** using the known Session 001 scores (Crosshatch, Ethiopia, Feather In Cap — see `WHAT_WE_BUILT_DB.md`), confirm any pair sharing an archetype with a large enough delta on the right dimension shows up as a suggestion, confirm accepting it creates the hop correctly (and it passes Phase 4's validation, since it's generated from real archetype/direction data), and confirm it disappears from the suggestion list once accepted (no duplicate suggestion for a pair that already has a hop).

---

## Explicitly out of scope — do not build

- Any in-place edit UI for an existing hop's fields — confirmed intentional, add-only stays add-only.
- Cross-archetype (bridge) hop suggestions — needs more from `v_archetype_adjacency` first; not this pass.
- Any auto-commit of a suggested hop — Phase 5 suggestions always require an explicit "Add" click, same as every other suggestion in this system.
- Deleting or deactivating aliases in bulk, or any alias reassignment (changing which coffee an alias points to) — Phase 2 is rename + active toggle only.
