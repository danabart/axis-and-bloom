# Claude Code prompt — Bloom Dial follow-up 1: priority swap, alias editing, hop validation + suggestions

Follow-up to `CLAUDE_CODE_PROMPT_BLOOM_DIAL_REORG.md` (already deployed) in this same folder — read that first for full context on the tables/pages involved. This prompt addresses gaps found after using the deployed reorg: a real bug (priority swap), a missing feature (alias editing), a navigation call, and two new pieces of hop-graph behavior (validation at creation time, and computed suggestions from cupping data). Do the phases in order; each is independently testable.

---

## Phase 1 — Fix the priority-swap bug (parallel miss to the Phase 1 position fix)

**Bug:** `PATCH /api/admin/coffee-alias/:id` in `backend/src/routes/admin.ts` (the endpoint the Coffees page's rank editor calls) does a plain `UPDATE coffee_alias SET priority = $1 WHERE id = $2` — no check for whether another alias already holds that priority within the same slot. Result: setting a coffee's rank to a number another coffee already has produces two aliases at the same rank (e.g. two "2nd choice") and nobody at the rank that got vacated. The equivalent dial-*position* endpoint (`PATCH /dial/positions/:id`) already has correct swap logic from the original reorg — this one was missed.

**Fix:** before updating, determine which *other* alias rows are "in the same slot" as the one being edited — same live archetype and dial position, i.e. the same derivation `GET /api/admin/coffee-alias` already uses (`COALESCE(aa.archetype, ca.archetype)` / `COALESCE(dpv.sort_order, ca.dial_sort_order)`, joined via `dial_archetype_positions` and `archetype_assignments`), not the possibly-stale stored `coffee_alias.archetype`/`dial_sort_order` columns directly. Among those, find the one currently holding the target `priority`. If one exists, swap in a transaction (give it the mover's old priority); if none does, update as today.

**Test:** in Coffees, set two different coffees within the same alias slot to rank 1 and rank 2. Then edit the rank-2 one to rank 1 — confirm the formerly-rank-1 coffee becomes rank 2 (swap), not both landing on 1. Confirm Blends & SKUs reflects the swap immediately (it already reads live, no change needed there).

---

## Phase 2 — Alias editing (rename at the slot level + per-coffee active/inactive)

**Gap, and a correction to how it was first scoped:** the Coffees page can create a new alias and edit its rank, but there's no way to rename an existing alias's `platform_name` or toggle `coffee_alias.is_active`. The name a user will actually click to fix this is the **"Slot Name" column** in the archetype matrix table on the Coffees page (`archVocab.map` → `<td>{alias}</td>`, sourced from `aliasMap`) — that's the visible "alias" in the UI, not the small per-coffee display buried inside a single coffee's expanded edit row. Those are not the same thing, and the difference matters:

`platform_name` is stored once **per `coffee_alias` row (per coffee)**, not once per slot — confirmed in `backend/src/db/seeds/coffee_alias_path_tcr.sql`, e.g. `'Classic Balanced'` is inserted as the `platform_name` on *two separate rows*, one for Feather In Cap (Path) and one for Guatemala (TCR), both at `archetype = 'balanced_sweet', dial_sort_order = 2`. A slot with two fulfillment choices (1st/2nd) has the same name stored twice. Renaming through a single coffee's alias row (`PATCH /coffee-alias/:id`, the original plan) would only update *that one row*, leaving the other coffee at the same slot with the old name — reintroducing exactly the kind of per-row duplication/desync this whole reorg has been about eliminating (same failure mode as the original `dial_sort_order`/`archetype` duplication fixed in `CLAUDE_CODE_PROMPT_BLOOM_DIAL_REORG.md` Phase 1, just on `platform_name` this time). Renaming needs to happen at the **slot level** — archetype + live dial position — and fan out to every `coffee_alias` row that currently belongs to that slot.

**2a. Backend — new endpoint**, e.g. `PATCH /api/admin/coffee-alias/slot`, body `{ archetype, dial_sort_order, platform_name }`. Identify which `coffee_alias` rows currently belong to that slot using the **same live derivation** `GET /api/admin/coffee-alias` already uses (join through `dial_archetype_positions` / `dial_position_vocabulary` / `archetype_assignments`, `COALESCE`'d with the stored columns) — not a plain `WHERE archetype = $1 AND dial_sort_order = $2` against the possibly-stale stored columns, since that could miss a row whose stored value has drifted:

```sql
WITH slot_alias_ids AS (
  SELECT ca.id
  FROM coffee_alias ca
  LEFT JOIN dial_archetype_positions dap ON dap.coffee_id = ca.coffee_id
  LEFT JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
  LEFT JOIN archetype_assignments aa ON aa.coffee_id = ca.coffee_id AND aa.superseded_at IS NULL
  WHERE COALESCE(aa.archetype, ca.archetype) = $1
    AND COALESCE(dpv.sort_order, ca.dial_sort_order) = $2
)
UPDATE coffee_alias SET platform_name = $3 WHERE id IN (SELECT id FROM slot_alias_ids)
RETURNING id;
```

Return the count of rows updated (0 → 404, "No aliases found at this slot").

**2b. Frontend, `AdminCoffees.tsx`:** make the "Slot Name" table cell itself the edit control — click to reveal a text input + Save/Cancel (same click-to-edit interaction already used for rank), calling the new `PATCH /api/admin/coffee-alias/slot` with that row's `archValue` and `v.sort_order`. This replaces the plain-text `{alias}` cell; it does **not** live inside the per-coffee `EditForm` — it's a property of the position row in the matrix, visible and editable whether or not any coffee's edit row is currently open.

**2c. Active/inactive stays per-coffee, and stays where originally planned.** `is_active` is genuinely a property of one coffee's specific fulfillment choice (this particular coffee, at this rank, for this slot) — not the slot's name — so extend `PATCH /api/admin/coffee-alias/:id` (the existing per-alias-row endpoint) to also accept `is_active`, and add the toggle next to the rank badge in the `EditForm`'s alias section, as originally planned.

**Test:** rename a slot with two fulfillment choices (e.g. "Classic Balanced," Feather In Cap + Guatemala) via the Slot Name cell, then confirm *both* underlying `coffee_alias` rows show the new name (query `coffee_alias` directly, or check Blends & SKUs, which groups by this same slot). Toggle one coffee's alias inactive via its `EditForm` and confirm the *other* coffee at the same slot is unaffected.

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
