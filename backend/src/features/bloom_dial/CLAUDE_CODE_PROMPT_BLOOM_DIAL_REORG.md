# Claude Code prompt — reorganize Coffees / Blends & SKUs / Bloom Dial admin pages

Full background/rationale is in `BLOOM_DIAL_ALLOCATION_SPEC.md`, in this same folder — read it first for context, but this prompt is self-contained enough to execute from directly. Do the phases in order; each is independently testable before moving to the next.

---

## Context

Axis & Bloom is a coffee subscription platform. Backend is Node/Express + TypeScript + PostgreSQL (schema in `backend/src/db/schema.sql`), admin routes in `backend/src/routes/admin.ts`, admin frontend in `frontend/src/app/components/admin/`.

Three admin pages currently overlap in confusing ways:

- **Coffees** (`AdminCoffees.tsx`, route `/admin/coffees`) — catalogue, archetype assignment (`archetype_assignments`), and dial position assignment (`dial_archetype_positions.vocabulary_id`) via an edit form and ← → arrows.
- **Blends & SKUs** (`AdminInventory.tsx`, route `/admin/inventory`) — shows archetype → dial slot → fulfillment choices (1st/2nd pick) → SKU/Shopify/stock, grouped by `coffee_alias.dial_sort_order` and ranked by `coffee_alias.priority`.
- **Bloom Dial** in the sidebar (`AdminDial.tsx`, route `/admin/dial`) — despite the nav label, this page only manages `dial_coffee_relationships` (the directional "hop" graph between coffees for cross-archetype navigation). Its own page heading already reads "Navigation Hops."

Two real bugs fall out of this (not a naming problem — "Bloom Dial" is the intentional marketing name for the sidebar entry, kept as-is; the page's own heading already reads "Navigation Hops," the correct internal/technical name for what it does; that split is deliberate, do not touch it):

1. **Position and archetype are each stored twice, unsynced.** `dial_archetype_positions.vocabulary_id`/`archetype` (edited on Coffees) and `coffee_alias.dial_sort_order`/`archetype` (read by Blends & SKUs) are independent columns on independent tables with nothing keeping them equal. Moving a coffee's position or re-tagging its archetype on Coffees never touches `coffee_alias`, so the two pages can silently disagree about where a coffee sits.
2. **The arrow-move endpoint can collide.** `PATCH /api/admin/dial/positions/:id` overwrites `vocabulary_id` without checking whether another coffee (same archetype, same roaster) already occupies the target slot.
3. **Priority ranking (1st/2nd choice) is edited on the wrong page**, and there's no way to create a new `coffee_alias` row anywhere in the admin UI. Blends & SKUs' own copy says its job is roastery/stock connection, but it also carries a merchandising decision (which coffee represents a slot) that belongs next to the other curation decisions on Coffees.
4. **The hop graph is isolated.** `dial_coffee_relationships` (the "Navigation Hops" table, shown on the page under the "Bloom Dial" nav entry) was documented from the start as intended to eventually feed "computed dial positions," but today it only feeds Liam's chat context. Archetype tagging and dial position assignment never consult it, even though `bridge_archetype` hops already encode exactly the cross-archetype adjacency (chocolate/nutty ↔ earthy, fruity ↔ floral) that would otherwise require inventing a whole new table.

No pages are being removed, merged, or renamed in this pass — Coffees, Blends & SKUs, and the Navigation Hops page (under the "Bloom Dial" nav entry) all stay exactly where they are, at their current routes. What changes is which page is allowed to *write* position/priority (Coffees, exclusively, after this pass) versus which just *reads and displays* it (Blends & SKUs) — a role separation, not a page count change.

Additionally, dial position assignment today is a pure manual guess with zero connection to the cupping data already being collected, even though the data needed to compute a sensible suggestion already exists.

---

## Phase 1 — Fix the desync and the collision bug

**1a. Derive, don't duplicate, in the alias read path.**

In `backend/src/routes/admin.ts`, `GET /api/admin/coffee-alias` currently returns `ca.dial_sort_order` and `ca.archetype` straight from the `coffee_alias` table. Change the query so that for each alias row, `dial_sort_order` and `archetype` are computed live from `dial_archetype_positions` (joined via `coffee_id`, then to `dial_position_vocabulary` for `sort_order`) and `archetype_assignments` (`superseded_at IS NULL`) respectively — falling back to the stored `coffee_alias` values only when no matching row exists (this covers Half-Caf/Decaf rows, which have `archetype = NULL` by design and aren't on the Bloom Dial at all). Keep the response shape identical (`dial_sort_order`, `archetype` field names unchanged) so `AdminInventory.tsx`'s existing grouping logic doesn't need to change.

Do **not** drop the `coffee_alias.dial_sort_order` / `archetype` columns in this pass — leave them in the schema as a legacy fallback, and add a SQL comment above the `coffee_alias` table definition in `schema.sql` noting they're superseded by `dial_archetype_positions` / `archetype_assignments` and only used as a fallback for coffees with no live position.

Joining `dial_archetype_positions` by `coffee_id` alone is safe and unambiguous: `POST /api/admin/coffees/:id/archetype` already does `DELETE FROM dial_archetype_positions WHERE coffee_id = $1` before inserting the new archetype's row, so a coffee never accumulates stale rows from a previous archetype — at most one `dial_archetype_positions` row exists per coffee at any time. No need to additionally filter the join by matching archetype.

**1b. Fix the arrow-move collision.**

In `PATCH /api/admin/dial/positions/:id`, when `vocabulary_id` is being updated: before overwriting, check whether another `dial_archetype_positions` row already exists for the same `archetype` and the same coffee's `roaster` at the target `vocabulary_id`. If one does, swap the two rows' `vocabulary_id` values in a single transaction instead of leaving the mover overwrite silently. If none does, update as today.

**Test:** move a coffee via the Coffees page arrows into a slot already occupied by another coffee of the same roaster — confirm they swap rather than both landing on the same slot. Re-tag a coffee's archetype or move its position on Coffees, then reload Blends & SKUs — confirm it now reflects the same slot without any manual alias edit.

---

## Phase 2 — Move rank/priority to Coffees; make Blends & SKUs read-only for it; add alias creation

**2a. New backend endpoint.** Add `POST /api/admin/coffee-alias` to create a new alias row — body `{ platform_name, archetype, coffee_id, priority }`. Server-side, look up the coffee's current `dial_archetype_positions` sort order for `archetype` and use that to populate `dial_sort_order` on insert (don't accept `dial_sort_order` from the client — keep the single-source-of-truth rule intact for new rows too, consistent with Phase 1a). Return the created row. The existing `PATCH /api/admin/coffee-alias/:id` (priority update) needs no changes — it's just being called from a different page now.

**2b. `AdminCoffees.tsx` — add alias/priority controls to the existing `EditForm`.** Next to the archetype/confidence/dial-position controls already there:
- If the coffee already has a `coffee_alias` row (the page already fetches `/api/admin/coffee-alias`), show its `platform_name` and a rank input — reuse the same rank-editing interaction currently in `AdminInventory.tsx` (the ordinal badge that becomes a number input on click) — wired to `PATCH /api/admin/coffee-alias/:id`.
- If the coffee has an archetype and a dial position but no alias row yet, show a small "+ Create alias" control (platform name text input, priority number input) wired to the new `POST /api/admin/coffee-alias`.

**2c. `AdminInventory.tsx` — remove rank editing.** Delete the click-to-edit priority badge and its associated state (`rankAliasId`, `rankValue`, `rankSaving`, `rankErr`) and handler (`handleRankSave`). Replace with a plain, non-interactive ordinal badge (still shows "1st choice ★" / "2nd choice" etc., just not clickable). Update the page's descriptive paragraph at the top to say choices are set on the Coffees page and this page reflects roastery fulfillment status only.

**Test:** create a brand-new alias from Coffees for a coffee that has none yet, confirm it appears correctly grouped on Blends & SKUs. Confirm Blends & SKUs no longer has any way to edit rank or position.

---

## Phase 3 — Cupping-based dial position suggestion

Add a computed, non-destructive suggestion for where a coffee should sit on the dial, based on cupping data that already exists. Read-only against existing tables — no schema changes, no new tables, never auto-writes the live position.

Each archetype has a designated dominant dimension (`dial_archetype_config`: chocolate_nutty→7/Body, balanced_sweet & fruity→5/Acidity, earthy→6/Bitterness, floral→9/Savory-Depth) and a target range on that dimension (`archetype_vector.min_score`/`max_score`, exposed via the view `v_archetype_dimension_comparison(archetype, dimension, target_min, target_ideal, target_max, avg_actual, coffee_count)` — note `archetype` there is the TEXT label like `'Chocolate & Nutty'`, bridged from the enum via a CASE already defined in that view in `schema.sql`; read it before writing this so the mapping matches exactly).

**3a. Schema first: `experimental` is not a true flavor archetype — mark it as such.** `dial_archetype_config` has no row for `experimental`. That's not an oversight to patch around defensively — `experimental` was never a real flavor family the way `chocolate_nutty`/`balanced_sweet`/`fruity`/`earthy`/`floral` are. It's a cross-cutting category, conceptually the same kind of thing as "Decaf" or "Half-Caf" (which already carry no archetype at all) rather than a sixth peer flavor family — a coffee tagged experimental should eventually be able to *also* carry one of the 5 real archetypes (e.g. an experimental coffee that's fundamentally chocolate/nutty), rather than experimental being its only tag. That fuller decoupling (letting a coffee hold a real archetype and a category simultaneously) is a bigger change and explicitly out of scope for this pass — see below — but the data model should stop being ambiguous about which of the 6 `archetype_enum` values are real archetypes right now:

```sql
ALTER TABLE dial_archetype_config ADD COLUMN IF NOT EXISTS is_archetype BOOLEAN NOT NULL DEFAULT true;

INSERT INTO dial_archetype_config (archetype, dominant_dimension_id, has_bloom_dial, is_archetype)
VALUES ('experimental', NULL, true, false)
ON CONFLICT (archetype) DO UPDATE SET is_archetype = EXCLUDED.is_archetype;
```

`is_archetype` defaults to `true` for the 5 existing rows (chocolate_nutty, balanced_sweet, fruity, earthy, floral) via the column default — no separate update needed for them. `has_bloom_dial = true` for the new experimental row is intentional, not a mistake: it still has real vocabulary entries and a real coffee (Kopi Safari) positioned on it, so it still needs to display; `is_archetype = false` is the narrower, new flag meaning "don't treat this as a true flavor family for suggestion or adjacency logic."

**3b. Backend helper**, e.g. `backend/src/services/dialSuggestion.ts`, exporting `getDialSuggestion(coffeeId: number)`. Every step below that can fail to find a row must return `null` rather than proceed with a missing value — this is a "no suggestion available yet" function, never a "guess anyway" function:
1. Look up the coffee's current archetype (`archetype_assignments`, `superseded_at IS NULL`). No archetype → return `null`.
2. Look up the `dial_archetype_config` row for that archetype. **No row, or `is_archetype = false` → return `null`.** (`experimental` is the only current case, per 3a above — this is now an explicit, intentional check, not a defensive guess.)
3. Query the coffee's avg merged cupping score on that dimension:
   ```sql
   SELECT ROUND(AVG((csv.value_min + csv.value_max) / 2.0), 2) AS avg_score,
          COUNT(DISTINCT cs.session_coffee_id) AS session_count
   FROM cupping_score_values csv
   JOIN cupping_scores cs ON cs.id = csv.cupping_score_id AND cs.is_merged = true
   JOIN cupping_session_coffees scc ON scc.id = cs.session_coffee_id
   WHERE scc.coffee_id = $1 AND csv.dimension_id = $2
   ```
   No rows (or `avg_score IS NULL`) → return `null` (don't guess without data).
4. Look up `target_min`/`target_max` for (archetype, dimension) via `v_archetype_dimension_comparison`. **No row found → return `null`** — defensive; don't assume every archetype/dimension pair has confirmed coverage in `archetype_vector`.
5. Look up the ordered `dial_position_vocabulary` rows for (archetype, dimension_id) — count = `N`. **`N = 0` → return `null`** (also prevents a divide-by-zero in the next step).
6. Compute: `bucket_width = (target_max - target_min) / N`; `raw_bucket = floor((avg_score - target_min) / bucket_width) + 1`; `suggested_sort_order = clamp(raw_bucket, 1, N)`; `is_outlier = raw_bucket < 1 || raw_bucket > N`.
7. Look up the `vocabulary_id` for (archetype, dimension_id, suggested_sort_order); return `{ suggested_vocabulary_id, suggested_label, suggested_sort_order, avg_score, session_count, is_outlier, dimension_name }`.

**3c.** Wire into `GET /api/admin/coffees` — add the suggestion object (or `null`) to each coffee alongside the existing `dial_position_id`/`dial_vocab_id`/`dial_is_default`/`dial_position_sort` fields. Per-coffee queries are fine at this catalogue size (~30 coffees).

**3d.** In `AdminCoffees.tsx`, show a small inline hint where dial position is displayed/edited when a suggestion exists and differs from the current position — e.g. "Suggested: Bold (avg Acidity 9.2/15, 2 sessions)" with an "Apply" action calling the existing `handleMovePosition(coffee, suggested_vocabulary_id)`. If `is_outlier` is true, style as a warning ("cupping score is unusually high for this archetype — worth double-checking the archetype assignment") with **no** one-click apply — outliers require opening the full edit form. No cupping data → show nothing for that coffee. Coffees tagged `experimental` will never show a suggestion, by design (3a) — that's expected, not a bug to chase.

**Test:** pick a coffee with known Session 001 cupping data (Crosshatch, Ethiopia, or Feather In Cap — see `WHAT_WE_BUILT_DB.md`) and confirm the suggestion is a sane bucket for its known numbers. Confirm a coffee with no cupping data shows no suggestion. Confirm Apply moves the coffee the same way the existing arrows do. Confirm Kopi Safari (currently tagged `experimental`) shows no suggestion and no error, and confirm `SELECT is_archetype FROM dial_archetype_config WHERE archetype = 'experimental'` returns `false` while the other 5 rows return `true`.

---

## Phase 4 — Connect the hop graph: archetype adjacency + within-archetype consistency check

The hop graph (`dial_coffee_relationships`) currently only feeds Liam's RAG context. This phase makes it a second, cross-checking input into archetype tagging and dial position, without any new tables — everything here is a read/aggregation over data that already exists (and degrades gracefully to "nothing yet" while the hop graph is still empty, same as Phase 3 does for coffees with no cupping data).

**Terminology — introduce two display labels, no enum/schema renames:**
- **"Dial Turn"** — display label for a `within_archetype` hop (moving within one archetype's dominant dimension, e.g. Classic → Bold).
- **"Hop"** (or **"Bridge Hop"** when it needs disambiguating) — display label for a `bridge_archetype` hop (crossing to a different archetype).
Apply these only in UI copy and any new response fields (e.g. a `hop_type_label` computed alongside the existing `hop_type` value). Do **not** rename the `hop_type_enum` values (`within_archetype` / `bridge_archetype`) or any column names — this is display-only.

**4a. Archetype adjacency view.** Add a view (or equivalent query), e.g. `v_archetype_adjacency` in `schema.sql`: group `dial_coffee_relationships` rows where `hop_type = 'bridge_archetype'` by the pair of archetypes their `from_coffee_id`/`to_coffee_id` currently belong to (join `archetype_assignments`, `superseded_at IS NULL`, on both sides), and return one row per unordered archetype pair with hop count, a breakdown of `direction`, and average `confidence` (map `confidence_enum` low/medium/high to 1/2/3 to average, or just show the distribution — either is fine). Filter to pairs where both archetypes have `dial_archetype_config.is_archetype = true` (per Phase 3a) — `experimental` isn't a true flavor family, so a hop involving an experimental-tagged coffee shouldn't be reported as archetype "adjacency" the same way a real fruity↔floral connection would be. Expose via `GET /api/admin/dial/archetype-adjacency`.

**4b. Surface it on the Navigation Hops page.** In `AdminDial.tsx`, add a small read-only summary section (above or below the existing hop table) listing each archetype pair with at least one bridge hop — e.g. "Fruity ↔ Floral — 3 hops, high confidence." Empty state: "No cross-archetype connections recorded yet." Also update the "Hop Type" dropdown in the existing "Add Hop" form to show "Dial Turn" / "Hop" instead of the raw "Within Archetype" / "Bridge Archetype" text — the value posted to the backend is unchanged (`within_archetype` / `bridge_archetype`).

**4c. Cross-check within-archetype hops against the Phase 3 suggestion.** Extend `getDialSuggestion` (from Phase 3): after computing `suggested_sort_order` using the coffee's dominant dimension (from step 2), look up `within_archetype` hops in `dial_coffee_relationships` where `dimension_id` matches that same dominant dimension and either `from_coffee_id` or `to_coffee_id` is this coffee. `dial_coffee_relationships` has no `archetype` column of its own — a hop only counts as relevant here if the *other* coffee in the pair currently shares this coffee's archetype (check via `archetype_assignments`, `superseded_at IS NULL`, on both sides); skip hops where the other coffee has since drifted to a different archetype. For each remaining hop, check whether its claimed ordering (`direction: 'more'`/`'less'` relative to the other coffee) is consistent with the two coffees' cupping-derived positions. If a hop and the cupping data disagree, add a `hop_conflict` field to the suggestion response — e.g. `{ conflicting_coffee: 'Feather In Cap', note: 'Dial Turn data suggests this should be positioned differently relative to Feather In Cap than the cupping-based suggestion indicates' }`. Surface this in `AdminCoffees.tsx` next to the existing suggestion hint, styled the same as the outlier warning from Phase 3 (informational, no one-click action).

**Test:** manually add a `within_archetype` hop between two coffees in the same archetype via the Navigation Hops page using the relabeled dropdown, confirm it saves with the correct underlying enum value. Add a `bridge_archetype` hop between two coffees in different archetypes, confirm it appears in the new adjacency summary with the right pair and count. Confirm a coffee with no hops shows no `hop_conflict` field and the rest of Phase 3 behaves unchanged.

---

## Phase 5 — Multi-source signal infrastructure (dormant: no auto-write, no new UI)

Build the plumbing for future signal sources (flavor-wheel descriptors, SMS feedback, onsite feedback) now, so turning one on later is a data/weight change, not an engineering project. Nothing in this phase changes what the admin sees or what gets written to the live position — it runs entirely alongside Phases 1–4.

**5a. New tables in `schema.sql`:**

```sql
CREATE TABLE IF NOT EXISTS dial_position_signal (
  id                     SERIAL PRIMARY KEY,
  coffee_id              INT REFERENCES coffees(id) ON DELETE CASCADE,
  archetype              archetype_enum NOT NULL,
  dimension_id           INT REFERENCES coffee_dimensions(id) NOT NULL,
  source                 TEXT NOT NULL CHECK (source IN ('cupping','roastery_wheel','client_wheel','sms_feedback','onsite_feedback')),
  suggested_vocabulary_id INT REFERENCES dial_position_vocabulary(id),
  direction              TEXT CHECK (direction IN ('more','less')),
  raw_value              NUMERIC,
  sample_size            INT NOT NULL DEFAULT 1,
  confidence             confidence_enum DEFAULT 'medium',
  computed_at            TIMESTAMPTZ DEFAULT now(),
  superseded_at          TIMESTAMPTZ,
  notes                  TEXT
);

-- Empty on purpose — do not seed rows. Table shape only; content requires
-- validating a descriptor's real correlation to a dimension, which needs
-- cupping data volume that doesn't exist yet. See BLOOM_DIAL_ALLOCATION_SPEC.md §3 Stage 2.
CREATE TABLE IF NOT EXISTS cupping_note_dimension_weight (
  id             SERIAL PRIMARY KEY,
  cupping_note_id INT REFERENCES cupping_note(id) NOT NULL,
  dimension_id   INT REFERENCES coffee_dimensions(id) NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('more','less')),
  weight         NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (cupping_note_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS dial_source_weight (
  source            TEXT PRIMARY KEY CHECK (source IN ('cupping','roastery_wheel','client_wheel','sms_feedback','onsite_feedback')),
  reliability_weight NUMERIC NOT NULL
);
INSERT INTO dial_source_weight (source, reliability_weight) VALUES
  ('cupping', 3), ('sms_feedback', 1), ('onsite_feedback', 1),
  ('roastery_wheel', 0), ('client_wheel', 0)
ON CONFLICT (source) DO NOTHING;
```

`roastery_wheel`/`client_wheel` start at reliability `0` deliberately — not because the mechanism doesn't work, but because `cupping_note_dimension_weight` has no validated rows yet, so anything computed from it shouldn't count even once such rows exist, until someone explicitly raises the weight after checking a mapping against real cupping data.

**5b. Populate the one source that has real data: `cupping`.** Add `recordCuppingSignal(coffeeId)` (e.g. in `backend/src/services/dialSuggestion.ts`, alongside `getDialSuggestion` from Phase 3 — call `getDialSuggestion` internally rather than recomputing, so all of Phase 3's null-guards apply here too: no archetype, `is_archetype = false` (e.g. `experimental`, per 3a), no cupping data, no `archetype_vector` coverage, or no vocabulary rows should all result in a no-op, not a malformed insert): if `getDialSuggestion` returns a result, supersede any existing non-superseded `dial_position_signal` row for `(coffee_id, archetype, dimension_id, source='cupping')`, then insert a new one with the freshly computed `suggested_vocabulary_id`, `raw_value` (the avg score), and `sample_size` (session count). Call this from the existing `POST /api/admin/scores` handler in `admin.ts` after a successful merged-score upsert, for the affected coffee/dimension. This gives the signal table real history over time as new cupping sessions get logged — no manual step required.

**5c. Rollup view.** Add `v_dial_position_consensus` to `schema.sql`: group current (`superseded_at IS NULL`) `dial_position_signal` rows by `(coffee_id, archetype)`, join `dial_source_weight` for `reliability_weight`, and compute a weighted consensus `suggested_vocabulary_id` (weighted mode is fine — ties can just take the highest-weighted source), `total_sample_size` (plain sum, unweighted, for display), and `weighted_sample_size` (sum of `sample_size * reliability_weight`, used for any future promotion threshold). With only `cupping` weighted above zero right now, this view will simply mirror what Phase 3 already computes — that's expected and correct; it becomes meaningfully different once other sources have both rows and nonzero weight.

**5d.** Expose read-only via `GET /api/admin/dial/consensus/:coffeeId`. Do **not** wire this into any frontend page yet, and do **not** add any auto-write path from this view to `dial_archetype_positions` — that stays a human decision via the existing Phase 3 "Apply" button. Building an apply-flow for the consensus view specifically would be redundant right now since it can't differ from Phase 3's suggestion until a second source has real weight and rows.

**Test:** save a new merged cupping score via the existing scores endpoint for a coffee, confirm a `dial_position_signal` row appears with `source = 'cupping'` and any prior row for that coffee/archetype/dimension/source got `superseded_at` set. Query `v_dial_position_consensus` for that coffee and confirm it matches Phase 3's suggestion. Confirm `cupping_note_dimension_weight` has zero rows and `roastery_wheel`/`client_wheel` are `0` in `dial_source_weight`. Confirm nothing was written to `dial_archetype_positions` as a side effect of this phase.

---

## Explicitly out of scope — do not build

- **Decoupling "category" from "archetype" entirely.** This pass only adds an `is_archetype` flag (Phase 3a) so the system stops treating `experimental` as a sixth peer flavor family for suggestion/adjacency purposes. It does **not** let a coffee hold a real archetype (e.g. `chocolate_nutty`) *and* a category tag (e.g. `experimental`) at the same time — `archetype_assignments.archetype` and `coffee_alias.archetype` still accept only one of the 6 `archetype_enum` values, so an experimental-tagged coffee is still exclusively "experimental," not "experimental AND some real archetype." Doing that properly (matching how "Decaf"/"Half-Caf" already sit outside the archetype system entirely) means introducing a real, separate category field, migrating Kopi Safari (currently the one coffee tagged purely `experimental`) to also carry a genuine archetype based on its actual cupping profile, and reworking the archetype dropdown/matrix UI in `AdminCoffees.tsx` and `AdminInventory.tsx` accordingly. That's a bigger, separate piece of work — flag it as a deliberate next decision, don't fold it into this pass.
- Populating `cupping_note_dimension_weight` with any rows, guessed or otherwise — table shape only in this pass. Don't invent descriptor→dimension mappings; that's a future validation task, not a migration.
- `roastery_wheel` / `client_wheel` signal population — blocked on the mapping table above actually having validated content, which isn't happening this pass.
- `sms_feedback` / `onsite_feedback` signal population — blocked on the feedback questions themselves being redesigned to target a specific dimension (e.g. "brighter or heavier than expected?" instead of a generic 1–5 rating). That's a product/UX decision, not something building the table shape unlocks.
- Any auto-write from `v_dial_position_consensus` to `dial_archetype_positions` — stays fully manual via the Phase 3 Apply button, same as everything else in this prompt.
- Any new frontend UI for the consensus view — Phase 5 is backend infrastructure only this pass.
- Dropping the legacy `coffee_alias.dial_sort_order`/`archetype` columns — leave as fallback fields.
- Renaming `hop_type_enum` values or any `dial_coffee_relationships` columns — Phase 4's "Dial Turn"/"Hop" terminology is display-only.
- The `/admin/dial` route path and sidebar label ("Bloom Dial") — unchanged. Phase 4 does add a read-only summary section and relabels one dropdown inside the existing Navigation Hops page, but nothing about its route, its core hop-CRUD functionality, or the nav entry itself changes.
