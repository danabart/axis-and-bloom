# Bloom Dial Allocation — Spec & Design Log

Companion to `WHAT_WE_BUILT.md` / `WHAT_WE_BUILT_DB.md`. This document captures the reasoning behind the Coffees / Blends & SKUs / Bloom Dial admin pages, the sync problem between them, and the plan for moving dial-position assignment from a manual guess to a data-backed suggestion as more cupping, flavor-wheel, and customer feedback data comes in.

Written 2026-07-09, updated 2026-07-09. Stage 2's infrastructure (tables, cupping-source population, rollup view) is now in scope for the next pass, dormant by default — see §3 Stage 2 for exactly what's built vs. still deliberately left empty. §1.3's page-ownership question has been resolved (see below) and everything here is folded into `CLAUDE_CODE_PROMPT_BLOOM_DIAL_REORG.md`, in this same folder.

---

## 1. The problem

Three admin pages touch the same underlying question — "where does this coffee sit, and which one do we actually sell" — but they don't agree with each other:

- **Coffees** (`AdminCoffees.tsx`) — assigns a coffee's archetype and its position within that archetype (`dial_archetype_positions.vocabulary_id`), via ← → arrows and an edit form.
- **Blends & SKUs** (`AdminInventory.tsx`) — shows archetype → dial slot → fulfillment choices (1st/2nd pick) → SKU/Shopify/stock, grouped by `coffee_alias.dial_sort_order` and ranked by `coffee_alias.priority`.
- **Bloom Dial** (`AdminDial.tsx`, header reads "Navigation Hops") — manages `dial_coffee_relationships`, the directional hop graph between coffees. It does not show the position matrix at all, despite the name.

### 1.1 Confirmed bug: position is stored twice

`dial_archetype_positions.vocabulary_id` (edited on Coffees) and `coffee_alias.dial_sort_order` (read by Blends & SKUs) are two independent columns on two independent tables. Nothing keeps them in sync. Moving a coffee's position via the Coffees page arrows only calls `PATCH /api/admin/dial/positions/:id` — it never touches `coffee_alias`. So a coffee can show one position on Coffees and a different one on Blends & SKUs, indefinitely, with no error surfaced anywhere.

Related: the arrow-move endpoint overwrites `vocabulary_id` without checking whether another position row already occupies the target slot for the same roaster — no swap, no collision warning.

Same failure mode, second instance: `coffee_alias.archetype` is *also* a separately-stored copy of the coffee's archetype, independent from `archetype_assignments.archetype`. If a coffee gets re-tagged to a different archetype on Coffees, its alias row's `archetype` column doesn't follow — same class of drift as the position bug, just on a different column.

### 1.2 "Choice" (priority ranking) is on the wrong page

`coffee_alias.priority` (1st choice / 2nd choice — which roaster fulfills a slot first) is edited on Blends & SKUs today. That's a merchandising/allocation decision — which coffee *represents* a slot — not a roastery-stock fact. Blends & SKUs' own page copy already claims its purpose is roastery connection/stock status; the rank editor contradicts that. There's also no way to create a *new* `coffee_alias` row from any admin page — the "No Alias Assigned" empty state on Blends & SKUs tells the admin to "assign an alias via the Coffees page," but Coffees has no alias-creation UI either. That's a gap, not just a misplacement.

### 1.3 Page-ownership decision — resolved

Two options were on the table: (A) leave Coffees owning catalogue + archetype + position, and treat "Bloom Dial" as the hop-graph page only; or (B) move the position matrix into Bloom Dial (dial shape = positions + hops together) and reduce Coffees to catalogue/cupping entry only.

**Decision: (A).** Position assignment is a judgment call made from the same cupping data that lives on the coffee record, so it stays on Coffees alongside archetype assignment. "Bloom Dial" was never actually a duplicate of Coffees in content — the sidebar label just implied it might be. That implication turns out to be intentional, not a bug: "Bloom Dial" is the marketing/brand name for that sidebar entry, and it should stay. The page underneath (`AdminDial.tsx`) has only ever managed the hop graph, and its own `<h1>` already reads "Navigation Hops" — that's the correct internal/technical name for what the page does, distinct from the brand name used in nav. **No naming change needed anywhere** — the current split (brand name "Bloom Dial" in the sidebar, functional name "Navigation Hops" as the page heading) already matches what's wanted. No component or route moves either.

### 1.4 Hop graph isolation — resolved

The hop graph (`dial_coffee_relationships`) was built with the intent of eventually feeding "computed dial positions" — that's literally in `WHAT_WE_BUILT_DB.md`'s own description of the table — but that connection was never built. Today it feeds only Liam's RAG context; archetype tagging and dial position assignment run entirely separately and never consult it. That's real isolation, not just a naming quirk, and closing it needs no new tables:

- **Cross-archetype adjacency** (chocolate/nutty ↔ earthy, fruity ↔ floral, etc.) is already represented by `bridge_archetype` rows in `dial_coffee_relationships` — just at the coffee level, not the archetype level. Rather than hand-curating a second, archetype-level adjacency table, derive it live: group existing bridge hops by the pair of archetypes their `from_coffee`/`to_coffee` currently belong to (via `archetype_assignments`), and surface hop count, direction, and confidence per archetype pair. One graph, read at two granularities — no parallel structure.
- **Within-archetype consistency**: `within_archetype` hops make an ordering claim about two coffees on the same dimension that the Stage 1 cupping suggestion (§3) also makes a claim about. Those two are allowed to disagree — when they do, that's signal worth surfacing, not something to silently ignore.

**Terminology:** "hop" was always the umbrella word for a row in `dial_coffee_relationships`, covering both moving within an archetype (adjusting intensity along its dominant dimension) and jumping to a different one. Worth having distinct, descriptive names for the two — same idea as "Bloom Dial" (brand) and "Navigation Hops" (function) already coexisting for the page itself:

- **Dial Turn** — a `within_archetype` hop. Turning the dial, staying in the same flavor family, moving along its dominant dimension (e.g. Classic → Bold).
- **Hop** (or **Bridge Hop** where it needs disambiguating from Dial Turn) — a `bridge_archetype` hop. Leaving the family.

Display/vocabulary change only — the underlying `hop_type_enum` values (`within_archetype` / `bridge_archetype`) are not renamed at the database level, only relabeled wherever they're shown to an admin.

Full build details in `CLAUDE_CODE_PROMPT_BLOOM_DIAL_REORG.md`, Phase 4.

---

## 2. Recommended fixes — scoped for the next Claude Code pass

1. **Stop storing position (and archetype) twice.** `dial_archetype_positions` and `archetype_assignments` become the single sources of truth. The `GET /api/admin/coffee-alias` response derives `dial_sort_order` and `archetype` live from those tables instead of trusting the stored `coffee_alias` columns, falling back to the stored value only for rows with no matching position (e.g. Half-Caf/Decaf, which have `archetype = NULL` by design). The `coffee_alias` columns stay in the schema as a legacy fallback for now — not dropped in this pass.
2. **Fix the arrow-move collision.** `PATCH /api/admin/dial/positions/:id` swaps with whichever coffee already occupies the target slot (same archetype + same roaster) instead of silently overwriting.
3. **Move rank/priority editing to Coffees**, next to archetype + position assignment. Blends & SKUs becomes read-only for position/rank — active toggle, SKU, Shopify variant ID, restock only.
4. **Add alias creation** on Coffees — currently impossible via any admin page.
5. **Connect the hop graph** to archetype adjacency (derived view, §1.4) and cross-check it against the cupping suggestion (§1.4, §3 Stage 1) — the hop graph stops being Liam-only.
6. **Build the multi-source signal infrastructure** (§3 Stage 2) now, dormant by default — tables, cupping-source population, and a rollup view, with zero-weighted/empty placeholders for sources that don't have real data yet. No auto-write to the live position from this.

No page is renamed, merged, or removed — see §5 below. All six items are written up as one Claude Code prompt: `CLAUDE_CODE_PROMPT_BLOOM_DIAL_REORG.md`.

## 5. What this reorg actually changes

Three pages remain, at their current routes, none merged or deleted. What changes is *who's allowed to write what*, not what exists:

| | Coffees | Blends & SKUs | Bloom Dial (nav) / Navigation Hops (page) |
|---|---|---|---|
| Today | writes archetype + position | writes position (via alias, unsynced) + priority + SKU/Shopify/stock | writes hop graph only |
| After this pass | writes archetype + position + priority + alias creation | reads position + priority (derived, no longer editable here); writes SKU/Shopify/active/restock | unchanged — writes hop graph only |

**Where dial position is actually controlled:** on Coffees, both before and after this pass — the manual dropdown/arrows, and after Phase 3 (§3 Stage 1) an "Apply suggestion" button, all write through the same existing endpoint (`PATCH /api/admin/dial/positions/:id`). There is exactly one control surface for the live position; Blends & SKUs and Navigation Hops never write to it, today or after this reorg. If Stage 2 (below) is ever built, its auto-promotion would also go through this same single endpoint/table — not a second control path.

---

## 3. The allocation model — from manual to computed

### Stage 0 — today

Dial position is a pure manual pick (`dial_archetype_positions.vocabulary_id` set by hand). Correct for the amount of data that exists: two tasters, a handful of cupping sessions. The schema already anticipates this changing — `is_computed`, `delta_from_default`, and `last_computed_at` columns exist on `dial_archetype_positions` and are currently unused.

### Stage 1 — cupping-based suggestion (buildable now)

Each archetype already has a designated **dominant dimension** (`dial_archetype_config`: chocolate_nutty→Body, balanced_sweet & fruity→Acidity, earthy→Bitterness, floral→Savory/Depth) and a **target range** on that dimension (`archetype_vector.min_score`/`max_score`, exposed via the view `v_archetype_dimension_comparison`). Combined with a coffee's own merged cupping score on that dimension (`cupping_score_values` via `cupping_scores.is_merged = true`), that's enough to compute a suggested slot without any new tables.

**Algorithm** (per coffee, computed live, never persisted or auto-applied):

1. Get the coffee's current archetype (`archetype_assignments`, `superseded_at IS NULL`). No archetype → no suggestion.
2. Get `dominant_dimension_id` for that archetype (`dial_archetype_config`).
3. Get the coffee's avg merged cupping score on that dimension:
   ```sql
   SELECT ROUND(AVG((csv.value_min + csv.value_max) / 2.0), 2) AS avg_score,
          COUNT(DISTINCT cs.session_coffee_id) AS session_count
   FROM cupping_score_values csv
   JOIN cupping_scores cs ON cs.id = csv.cupping_score_id AND cs.is_merged = true
   JOIN cupping_session_coffees scc ON scc.id = cs.session_coffee_id
   WHERE scc.coffee_id = $1 AND csv.dimension_id = $2
   ```
   No rows → no suggestion. Don't guess without data.
4. Get `target_min`/`target_max` for (archetype, dimension) from `v_archetype_dimension_comparison`.
5. Get the ordered `dial_position_vocabulary` rows for (archetype, dimension_id) — count = N.
6. `bucket_width = (target_max - target_min) / N`
   `raw_bucket = floor((avg_score - target_min) / bucket_width) + 1`
   `suggested_sort_order = clamp(raw_bucket, 1, N)`
   `is_outlier = raw_bucket < 1 OR raw_bucket > N` (score falls outside the archetype's normal range for this dimension — surface as a warning, e.g. "worth double-checking the archetype assignment," not as a routine suggestion; no one-click apply for outliers)
7. Look up the `vocabulary_id` for (archetype, dimension_id, suggested_sort_order) and return it with the label, avg score, session count, and outlier flag.

**UI:** shown as a hint next to the existing manual position control on Coffees — "Suggested: Bold (avg Acidity 9.2/15, 2 sessions)" with a one-click apply that reuses the existing `PATCH /api/admin/dial/positions/:id`. Never auto-writes. Outliers get a warning style and no one-click apply — those require opening the full edit form.

**Corrected understanding, from a later pass: `experimental` is not a true archetype.** `dial_archetype_config` has rows for 5 of the 6 `archetype_enum` values — `experimental` was missing. The first instinct was to treat this as a bug to defensively guard around (missing row → skip). The real explanation is more fundamental: `experimental` was never a real flavor family the way `chocolate_nutty`/`balanced_sweet`/`fruity`/`earthy`/`floral` are — it's a cross-cutting *category*, conceptually the same kind of thing as "Decaf" or "Half-Caf" (which already carry no archetype at all), not a sixth peer flavor family. A coffee tagged experimental should eventually be able to *also* carry a real archetype (e.g. an experimental coffee that's fundamentally chocolate/nutty) rather than experimental being its only tag — that fuller decoupling is real future work, not done here (see the Claude Code prompt's "out of scope" list).

The immediate fix: `dial_archetype_config` gets a new `is_archetype BOOLEAN` column, `true` for the 5 real archetypes, `false` for `experimental` — an explicit, intentional flag rather than an implicit "row exists or doesn't." Every step of the Stage 1 algorithm that depends on archetype-level config now checks this flag and returns "no suggestion" for `experimental`-tagged coffees (currently just Kopi Safari) rather than erroring or guessing. Full detail in the Claude Code prompt, Phase 3a.

This is what's ready to build now — see the accompanying Claude Code prompt.

### Stage 2 — multi-source signal infrastructure (buildable now, dormant by default)

**Status: in scope, as of this update.** The reasoning below originally deferred this whole stage on the theory that infrastructure shouldn't be built before there's data to feed it. That's still true for the *content* of one table (see below), but not for the schema, the rollup logic, or the promotion gating — those can exist now, wired but inert, the same way Phase 3's suggestion returns nothing when there's no cupping data instead of needing to not exist at all. The distinction that actually matters: a `sample_size`/`reliability_weight` of zero safely does nothing regardless of when the code was written; a *guessed* row in the descriptor→dimension mapping table would sit there looking like validated fact when it isn't, which is a data-quality problem, not a scheduling one. So: build the tables, the cupping-source population, and the rollup view now (Phase 5 in the prompt) — leave `cupping_note_dimension_weight` empty rather than pre-seeded, and leave the feedback sources unpopulated because their upstream questions don't collect dimension-specific data yet, not because of any artificial waiting period.

Two tables are involved:

- **`dial_position_signal`** — the actual "signal table": one row per source's opinion about a coffee's position (cupping, wheel, or feedback). Fully specified just below.
- **`cupping_note_dimension_weight`** *(name proposed here, not fixed elsewhere)* — the smaller "opinion encoding" table that `roastery_wheel`/`client_wheel` signals depend on: `(cupping_note_id, dimension_id, direction, weight)`, e.g. a row saying `Citrus → Acidity → more → 0.7`. This is what turns a descriptor mention into a claim about a dimension. It's the piece described earlier as encoding a judgment call rather than reading a measurement — don't build it until there's enough descriptor volume to check it against real cupping scores.

Design for later:

**New table: `dial_position_signal`** — one row per opinion, superseded rather than deleted (same pattern as `archetype_assignments`):

| Column | Purpose |
|---|---|
| `coffee_id`, `archetype`, `dimension_id` | what this opinion is about; `archetype` stored explicitly so a later re-tag doesn't reinterpret old signals |
| `source` | `cupping` \| `roastery_wheel` \| `client_wheel` \| `sms_feedback` \| `onsite_feedback` |
| `suggested_vocabulary_id` | precise bucket guess, when the source is confident enough |
| `direction` (`more`/`less`) | for weaker sources that can only nudge, not place precisely |
| `raw_value`, `sample_size` | the actual measurement and how many observations back it — drives weighting |
| `confidence` | reuses `confidence_enum` |
| `computed_at`, `superseded_at` | history, same convention as `archetype_assignments` |

**Per-source population:**
- `cupping` — same algorithm as Stage 1, just written as a row instead of computed live; `sample_size` = sessions merged.
- `roastery_wheel` / `client_wheel` — depends on a descriptor→dimension mapping (e.g. Citrus/Lemon → higher Acidity, Jasmine/Rose → lower Savory/Depth) that **does not exist yet**. This is the highest-effort, most opinion-encoded piece — don't build it until there's enough descriptor volume across coffees to validate the mapping against actual cupping data. Stays low-confidence and direction-only even once built.
- `sms_feedback` — already carries parsed rating + descriptors per reply (`sommelier_sms_feedback`), usable once there's enough volume.
- `onsite_feedback` — currently just a 1–5 satisfaction rating + free note (`user_feedback_event` via `POST /api/orders/:orderId/feedback`), not dimension-specific. **Gap:** to use this source, the feedback question itself needs to target the relevant axis ("brighter or heavier than expected?"), not overall satisfaction.

**Rollup:** a view grouping current (non-superseded) signals per (coffee_id, archetype), weighting each by `sample_size × source reliability` (cupping highest, feedback next, wheel-derived lowest until validated — reliability weights live in a small config table so they can be retuned once you can check whether a source's suggestions were actually right). Produces a consensus bucket, total sample size, and an **agreement measure** — sources clustering together vs. genuinely conflicting (e.g. cupping says Bold, feedback trend says Approachable) should be distinguished, never silently averaged into a middle ground nobody observed.

**Promotion rule:** only auto-write to `dial_archetype_positions.vocabulary_id` when (a) `is_computed = true` for that row — the moment an admin manually overrides a position, it flips to `false` and the system goes hands-off until re-enabled — (b) total sample size clears a set bar, and (c) sources agree. Anything short of that surfaces as an advisory in the admin UI instead of writing anything.

**Side benefit:** if signals for a coffee's currently-assigned archetype keep landing outside that archetype's normal range or keep conflicting regardless of volume, that's evidence the archetype tag itself may be wrong — a natural early-warning system for archetype drift (e.g. a chocolate/nutty coffee reading consistently earthy), which is the same concern behind wanting cross-archetype "hop" awareness.

---

## 4. Not in scope for this round

- **Decoupling "category" from "archetype."** `experimental` gets marked `is_archetype = false` (§3 Stage 1), but a coffee still can't hold a real archetype and a category simultaneously — `archetype_assignments.archetype` / `coffee_alias.archetype` still accept only one of the 6 enum values. Properly separating "which of the 5 real flavor families" from "cross-cutting category" (experimental, and eventually Decaf/Half-Caf, which already sit outside the archetype system entirely) is a real, separate migration — it would need Kopi Safari (currently tagged purely `experimental`) migrated to a genuine archetype based on its actual cupping profile, plus changes to the archetype dropdown/matrix UI in `AdminCoffees.tsx` and `AdminInventory.tsx`. Named here deliberately so it doesn't get lost, not attempted in this pass.
- **Content** of `cupping_note_dimension_weight` — the table exists (Phase 5), but stays empty. Populating it means asserting a descriptor genuinely correlates with a dimension, which isn't something to guess at; it needs enough cupping volume to check against.
- **`roastery_wheel` / `client_wheel` signal population** — blocked on the mapping above having real content, not on anything else.
- **`sms_feedback` / `onsite_feedback` signal population** — blocked on the feedback questions themselves being redesigned to ask about a specific dimension rather than general satisfaction. A separate product decision, not resolved by this pass.
- **Any auto-write from the consensus view to `dial_archetype_positions`** — the promotion rule described above (sample size + agreement bar) is documented as the eventual mechanism, but isn't wired up in this pass. All position changes stay manual (via the existing Apply action) until that's explicitly decided later.
- Dropping the legacy `coffee_alias.dial_sort_order` / `archetype` columns outright — leave them as fallback fields until the derived-value approach has been verified in production.

Everything in §2 (items 1–6) plus the Stage 1 cupping suggestion (§3) and the Stage 2 infrastructure (§3, tables/rollup/cupping-population only) is scoped for the next pass — see `CLAUDE_CODE_PROMPT_BLOOM_DIAL_REORG.md` in this folder.
