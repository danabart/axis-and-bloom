# Flavor Intelligence Page — Part 1 of 2: Backend (roaster-blind list, personalization data, deeper stats)

This build is split into two Claude Code sessions, run in order: **this file (backend)**, then `CLAUDE_CODE_PROMPT_FLAVOR_INTELLIGENCE_PART2_FRONTEND.md` in this same folder. Part 2 depends on every endpoint/response shape in this file being live — don't start Part 2 until Part 1's testing task is complete. Same split pattern as The Bloom (`backend/src/features/the_bloom_page/`), for the same reason: verify the data layer against real DB rows before any frontend code depends on it.

## Context

This is the "distinct future project" flagged in `backend/src/features/ai_agent_liam/NOTE_FLAVOR_INTELLIGENCE_PAGE.md` and in the IA memory carried over from The Bloom planning: `/coffees` (`CoffeesPage.tsx`) stays permanently as a secondary, opt-in "flavor intelligence" destination — deeper stats, more SCA descriptor detail — reachable from The Bloom but not part of its primary browse/shop flow. It is **not** a rebuild. Today's page already has the right content model (AI editorial content, three-source descriptor wheel, dimension bars, compatibility badge, compare mode) — see `WHAT_WE_BUILT.md` §"Our Coffees Page" for the full existing feature list. This build reorganizes and deepens it; it does not replace it.

Three things are wrong with the page today, and this file fixes the backend-facing two of them:

1. **It leaks roaster identity and raw coffee names.** `GET /api/coffees` (the flat list `CoffeesPage.tsx` calls) returns `c.roaster` and `c.name` directly — real internal names, not the customer-facing alias. This was flagged and *explicitly deferred* in The Bloom Part 1 backend build (`CLAUDE_CODE_PROMPT_THE_BLOOM_PART1_BACKEND.md`, Decision #2: "Leave `GET /api/coffees` exactly as it is... fixing that leak is explicitly out of scope for this build"). This is that follow-up. Per Dana (2026-07-12): the Flavor Intelligence page should be roaster-blind too, matching The Bloom's drop-ship confidentiality rule — real roaster/coffee identity must never reach the customer anywhere on this page, same standard as The Bloom.
2. **The sidebar is a flat, unsorted list of every coffee row**, with no grouping and no sense of "yours first." Fixed in Part 2, but depends on the list shape this file defines.
3. **The page under-uses data it already has.** `v_collaborative_flavor_wheel` already carries `wheel_category`/`wheel_subcategory` per descriptor, `GET /api/coffees/:id/dimensions` already returns `session_count`, and `v_archetype_dimension_comparison` already computes target-vs-actual per archetype — none of this reaches the UI today. Part 2 needs one new small endpoint from this file to surface the archetype-level version of that last one.

## Hard constraint — white-label / drop-ship confidentiality, absolute

Confirmed explicitly by Dana (2026-07-12), same standard as The Bloom: **roastery identity must never be visible to a customer anywhere on this page — not de-emphasized, not visible-if-you-look-hard, never.** No raw `roaster` name, no raw coffee `name`, no exact `origin` string. This is a white-label, drop-ship model — the business relationship with a specific roastery is never something a customer should be able to infer.

**Revised 2026-07-12, same day** — Dana wants `process` and `roast_level` shown after all (they're standard, generic flavor-education vocabulary — "washed," "natural," "medium roast" — shared across many roasters and not identifying on their own), and wants `origin` shown too, but bucketed to a broad geographic region rather than the exact string. Exact origin as currently stored (`coffees.origin`, e.g. `"Sidama, Ethiopia"`, `"Sul de Minas, Brazil"`, `"Huehuetenango, Guatemala"`) is specific enough to plausibly narrow down a roaster's actual lot, especially combined with process — that specificity is what stays hidden. See Decision #7 below for the bucketing mechanism. Updated safe list: archetype, dial slot/position (`platformName`, `positionLabel`), **`process`, `roast_level`, broad `originRegion`** (not exact `origin`), dimension scores, SCA descriptors, and AI-synthesized editorial content. Still never: `roaster`, raw coffee `name`, exact `origin`.

## Data model recap (for reference, no changes needed to understand this)

- `coffee_alias` — `platform_name` (customer-facing name), `archetype`, `dial_sort_order`, `coffee_id`, `priority`, `is_active`. Live slot archetype/position is `dial_archetype_positions`/`archetype_assignments`, not the stored columns — same `COALESCE` pattern used everywhere else in this codebase.
- `resolveBlendForSlot(archetype, dialSortOrder, weightOz)` (`backend/src/services/blendResolver.ts`) — the stock-aware, priority-ordered resolver that decides which real coffee currently fulfills a slot. Returns `coffee_name`/`roaster` internally; never let those leave a public route.
- `GET /api/coffees/archetypes` (`backend/src/routes/coffees.ts`, built for The Bloom Part 1) — **already the exact roaster-blind, archetype-grouped, slot-based catalogue this page needs.** Every archetype → every dial position → resolved `coffeeId` (opaque, never rendered) + `platformName`, `isActive`. This is the single source of truth for "what coffees exist, roaster-blind, grouped by archetype" — The Bloom's shopping cards and this page's exploration cards must read the same catalogue, or the two pages will eventually disagree about what's currently sellable/explorable.
- `GET /api/coffees/:id/content`, `/:id/dimensions`, `/:id/flavor-wheel` — already sanitized (Bloom Part 1c): no roaster or raw coffee name in any of these three. `:id` is the opaque `coffeeId` from `/archetypes`, never displayed.
- `v_archetype_dimension_comparison` — target range (`min_score`/`ideal_score`/`max_score`) **plus** `avg_actual` and `coffee_count` per archetype × dimension. `v_archetype_vectors` (feeding `GET /api/axis/vectors`, which this page's `useCompatibility` hook already calls) only exposes the target range, not `avg_actual`/`coffee_count` — that's the one genuinely new piece of data this page needs.
- `user_lifecycle_state` / `GET /api/users/homepage-state` (`requireAuth`) — already returns `{ stageCode, archetype, daysSinceQuiz, pendingFeedback, usualBlend, nextDeliveryDate }`. This is the existing, already-computed signal for "is this a new user, a fresh quiz-taker, a repeat customer, a subscriber" — see `WHAT_WE_BUILT_DB.md` §"User lifecycle status" for the full `stageCode` list. **No new backend work needed for personalization** — Part 2 consumes this endpoint directly instead of inventing page-specific logic.
- `lookup_value` — the existing controlled-vocabulary pattern for admin dropdowns (`category` + `value` + `label` + `sort_order`, `ON CONFLICT DO UPDATE` seeding), already used for `roast_level`, `process`, `blend_or_single`, `brew_method`. Decision #7 adds a new category to this same table rather than inventing a new lookup mechanism.
- `dial_archetype_positions.is_default` — already exists and is already curated (e.g. `balanced_sweet`'s default is "Feather In Cap"/"Guatemala," seeded in `dial_positions_path_tcr.sql`). This is the existing "which slot is the classic/default one for this archetype" signal — Decision #8 exposes it publicly for default-selection use.

---

## Decisions

**Decision #1 — Reuse `GET /api/coffees/archetypes` as the list source; do not build a new list endpoint.**
It already returns everything the reorganized sidebar needs: archetype grouping, resolved `coffeeId` per active slot, `platformName`, position label. Building a second, parallel "all coffees" endpoint would let this page and The Bloom drift out of sync about what's currently active/sellable — the exact problem the roaster-blind endpoints were built to prevent. The only gap: this endpoint's `slots` array is scoped to `dial_position_vocabulary` rows (i.e., shoppable positions). If there is ever a cupped, archetype-assigned coffee with no `coffee_alias`/dial-position row at all (a coffee that exists in the catalogue but was never placed on a Dial), it will not appear here or on The Bloom. Confirmed acceptable: a coffee with no customer-facing alias has nothing safe to call it by anyway, so it has no business appearing on a public page regardless of which endpoint serves the list.

**Decision #2 — `GET /api/coffees` (the flat, roaster-leaking list) is superseded for public/frontend use, not deleted.**
Grep the frontend for any other caller before touching frontend code (Part 2's job) — but on the backend, leave the route itself alone; it costs nothing to keep and admin tooling may still depend on similar query shapes elsewhere. Just confirm in Part 1 testing that nothing new is built against it.

**Decision #3 — New endpoint: `GET /api/coffees/archetype-stats?archetype=`**
Public, no auth, roaster-blind (it never touches coffee identity at all — archetype-level aggregate only). Returns the `v_archetype_dimension_comparison` rows for one archetype:
```
GET /api/coffees/archetype-stats?archetype=chocolate_nutty

{
  archetype: "chocolate_nutty",
  archetypeLabel: "Chocolate & Nutty",
  dimensions: [
    {
      dimension: "Body",
      displayOrder: 3,
      targetMin: 8, targetIdeal: 11, targetMax: 14,
      avgActual: 10.4,
      coffeeCount: 3
    },
    ...
  ]
}
```
`avgActual`/`coffeeCount` may be `null`/`0` for an archetype with no cupping data yet — return the row anyway (`null`, not omitted) so the frontend can render an explicit "not enough data yet" state rather than a silently missing dimension. Bridge `archetype_enum` → `archetype.name` the same way `v_archetype_dimension_comparison` already does internally (see `WHAT_WE_BUILT_DB.md`); don't re-derive that CASE mapping in the route, the view already resolved it.

**Decision #4 — Deep-link contract changes from `?coffee={coffeeId}` to `?archetype={archetype}&slot={dialSortOrder}` — and this is not hypothetical, a live consumer already exists and must be updated.**
Today's page reads `?coffee={coffeeId}` (see `CoffeesPage.tsx`'s `searchParams.get('coffee')`) and scrolls that raw coffee into view. Two problems with keeping that: (1) it's the wrong identity now that the page is slot-based — a slot's occupant can change under `resolveBlendForSlot` without the slot's meaning changing, so a link built around a raw `coffeeId` can go stale even though the slot it pointed at is still perfectly valid; (2) — **correction to an earlier draft of this doc, which claimed Bloom's explore link "isn't wired up yet."** That was checked against the wrong file (`BloomPage.tsx` directly) and was wrong — The Bloom's reveal UI was split out into `frontend/src/app/components/bloom/RevealedPanel.tsx` (Bloom Part 4), and it **is** live today: `exploreLink={coffeeId ? \`/coffees?coffee=${coffeeId}\` : '/coffees'}`. This is a real, shipped link using the old raw-`coffeeId` contract, not a future one to flag for later — **updating it is part of this build, see Part 2's link-update decision.**

New contract: `?archetype={archetype_enum}&slot={dialSortOrder}` on the new route (`/flavor-intelligence` — see Decision #5) — human-legible, stable across which physical coffee fulfills the slot, and never exposes a raw internal ID in a shareable URL. **Keep a backward-compatible fallback** for the old `?coffee={id}` param regardless (cheap insurance, and this project's own `FlavorQuiz.tsx` `?result=` pattern shows short-lived query params do leak into bookmarks/screenshots in practice): resolve it server-side via one query — `SELECT aa.archetype, dpv.sort_order FROM archetype_assignments aa JOIN dial_archetype_positions dap ON dap.coffee_id = aa.coffee_id JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id WHERE aa.coffee_id = $1 AND aa.superseded_at IS NULL` — then redirect (client-side, in Part 2) to the new param shape on the new route.

**Decision #5 — Route changes from `/coffees` to `/flavor-intelligence`; file renamed to match; `/coffees` becomes a redirect, not removed.**
Reversed from an earlier draft of this doc, which recommended keeping the URL as-is — Dana confirmed she'd prefer the URL to change too (2026-07-12). The page already renders an H1 of "Flavor Intelligence" (`CoffeesPage.tsx` line ~160); this brings the route and nav label in line with it.

- New route: `/flavor-intelligence`, rendering the renamed component (`CoffeesPage.tsx` → `FlavorIntelligencePage.tsx`, confirmed with Dana — do the rename, not just a route change on top of the old file name).
- `/coffees` (bare, no params) → redirect to `/flavor-intelligence`.
- `/coffees?coffee={id}` → resolve via Decision #4's fallback query, then redirect to `/flavor-intelligence?archetype=&slot=`.
- **Every internal link currently pointing at `/coffees` must be updated to `/flavor-intelligence` as part of this build** — this is real, not hypothetical (see Decision #4's correction above). Full list of files found, backend-relevant context only here (Part 2 owns the actual edits): `frontend/src/app/App.tsx` (route definition + new redirect route), `frontend/src/app/components/bloom/RevealedPanel.tsx` (the live explore-link, needs a new `dialSortOrder` prop threaded down from `PositionCard.tsx`, which already has `slot.dialSortOrder` in scope), `frontend/src/app/components/Sommelier.tsx` (plain `navigate('/coffees', ...)`), `frontend/src/app/components/Home.tsx`, `frontend/src/app/components/Footer.tsx`, `frontend/src/app/components/Navigation.tsx`, `frontend/src/app/components/FlavorQuiz.tsx`. This supersedes Part 2's original narrower "just the nav label" decision — see Part 2's updated decision for the full per-file breakdown.

**Decision #6 — Compare mode moves from raw-coffee picking to slot picking.**
Today's compare dropdown lists raw `coffee.name` values pulled from the flat `GET /api/coffees` list — a direct roaster/identity leak in the compare UI specifically (worth calling out since it's easy to fix the sidebar and miss this). Part 2's compare picker must be built from the same `/api/coffees/archetypes` slots (i.e., `platformName` + `archetypeLabel`, resolving to `coffeeId` internally for the three per-coffee fetches) — no new backend endpoint needed for this, just a Part 2 wiring change flagged here so it isn't missed.

**Decision #7 — Origin shown as a broad region bucket, not the exact string; `process`/`roast_level` shown directly.**
New `lookup_value` category: `origin_region`. Seed list checked directly against the real 29-coffee catalogue (`backend/src/db/seeds/coffees_path_tcr.sql`) rather than picked generically — five values actually needed today, plus two kept as deliberate headroom per Dana (2026-07-12):

| Value | Covers (from the real catalogue) |
|---|---|
| `East Africa` | Ethiopia, Uganda, Tanzania, Kenya — including the Uganda & Ethiopia blend, since both source countries are in this region |
| `Central America` | Honduras, Guatemala, Costa Rica |
| `South America` | Colombia, Brazil |
| `Southeast Asia & Pacific` | Indonesia (Sumatra, Bali), Papua New Guinea |
| `Multi-Origin / Blend` | Anything the roastery itself didn't pin to one region: Breakfast Blend, 6-Bean Espresso Blend, Kopi Safari, the flavored blends (Vanilla/Hazelnut/Chocolate), Blonde Blend ("Central America & Africa"), Noam Blend ("Central Blend" — ambiguous enough to flag rather than assume; could arguably be `Central America` instead, admin's call during backfill), and Path coffees whose own `origin` column already just says "Central/South America" (Nocturnal Dark Roast, Vantablack Ultra-Dark, Sleepwalker Half-Caf) |
| `Caribbean` | Headroom — no current coffee, kept for a likely near-term addition (e.g. Jamaica, Dominican Republic) |
| `South Asia` | Headroom — no current coffee, kept for a likely near-term addition (e.g. India) |

Do not seed beyond these seven for this pass — Decision #9 below adds a real admin path to extend the list later without a code deploy, which is the better lever for genuinely speculative regions (Arabian Peninsula, Central Africa, etc.) rather than pre-seeding options nothing uses yet.

**This table covers the 29 coffees in `coffees_path_tcr.sql` only.** Three earlier coffees — Crosshatch, Ethiopia, and Feather In Cap (Path, "Session 001," seeded before this file existed) — aren't in that seed file, and their exact `origin` strings weren't findable in any file checked while writing this doc (only their archetype/dial-position assignments were). `Ethiopia` obviously buckets to `East Africa`; `Crosshatch` and `Feather In Cap` need the admin doing the backfill to look up their actual `coffees.origin` value directly (`SELECT id, name, origin FROM coffees WHERE name IN ('Crosshatch', 'Feather In Cap')`) rather than assuming from this table.

New column: `coffees.origin_region_id INTEGER REFERENCES lookup_value(id)`, nullable, idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `schema.sql`, same pattern as every other additive column in this file. **Do not auto-derive the bucket by parsing the existing free-text `origin` column** — strings like `"Sul de Minas, Brazil"` are easy, but `"Uganda & Ethiopia Blend"` isn't, and getting it wrong is worse than leaving it unset. Instead: add `origin_region_id` as an admin-editable dropdown next to the existing `process`/`roast_level` editors in `AdminCoffees.tsx`'s `EditForm` (sourced from `lookup_value WHERE category = 'origin_region'`, same dropdown pattern already used for those two fields), and do a one-time manual backfill pass over the current ~29-coffee catalogue as part of this build using the table above — it's a small, finite, human judgment call, not something worth automating for this data size.

Expose the three now-permitted descriptive fields on `GET /api/coffees/:id/content` (already the endpoint Part 2 fetches on card-open for the detail header/description layer — extending it avoids a fourth per-coffee fetch): add `process` (from `coffees.process`, direct — no longer hidden), `roastLevel` (from `coffees.roast_level`, direct), and `originRegion` (the `lookup_value.label` for `coffees.origin_region_id`, `null` if unset — never the raw `coffees.origin` column, which stays server-side only and must never appear in any public response).

**Decision #8 — Expose `isDefault` per slot on `GET /api/coffees/archetypes`.**
Needed for Part 2's landing-page default selection (no `?archetype=`/`?slot=` param, nothing to deep-link to yet — see Part 2 Decision #3). Add `isDefault: boolean` to each slot in the existing response.

**Join carefully — `dial_archetype_positions.is_default` is keyed by `(coffee_id, archetype)`, not by `(archetype, dial_sort_order)` alone**, and more than one `coffee_id` can legitimately carry `is_default = true` for what looks like "the same" slot: `dial_positions_path_tcr.sql` marks *both* Path's Feather In Cap *and* TCR's Guatemala as the default for `balanced_sweet`'s classic position, since `coffee_alias`/`dial_archetype_positions` track this per fulfilling roaster (priority 1 vs. priority 2), not per abstract slot. Querying `is_default` by `(archetype, dial_sort_order)` alone would be ambiguous. Instead, look it up **for the specific `coffee_id` that `resolveBlendForSlot` already resolved for that slot** — the existing code in this endpoint already does exactly this pattern one query later for `platformName` (`WHERE ca.coffee_id = $1 AND ...`, using `resolved.coffee_id`); add `isDefault` to that same lookup (or a one-line addition to the existing query) rather than a separate query keyed differently. Done this way, each slot in the response still has exactly one `isDefault` value, matching whichever coffee is actually resolved for it right now.

This data is already curated per archetype (admin-managed via the existing Bloom Dial admin tooling) — this decision only exposes it publicly, it doesn't change what the field means or how it's set.

**Decision #9 — Basic admin CRUD for `lookup_value`, so future categories/values (origin regions or anything else) don't require a code deploy.**
Confirmed by Dana (2026-07-12): worth adding now, not deferring. Today `GET /api/admin/lookups` is the only endpoint touching this table — every value, including the seven `origin_region` rows above, only exists because it's in `schema.sql`. Add:
- `POST /api/admin/lookups` — body `{ category, value, label, sortOrder? }`, upserts on the existing `UNIQUE (category, value)` constraint (`ON CONFLICT (category, value) DO UPDATE SET label = EXCLUDED.label, sort_order = COALESCE(EXCLUDED.sort_order, lookup_value.sort_order)`) — same idempotent-upsert spirit already used for seeding this table in `schema.sql`. Works for adding a new value to an existing category (e.g. a new origin region) or, incidentally, a brand-new category, though nothing in this build needs the latter.
- `PATCH /api/admin/lookups/:id` — update `label`/`sort_order` on an existing row.
- `DELETE /api/admin/lookups/:id` — remove a row. `coffees.process`/`coffees.roast_level` are plain TEXT (not FKs — see the "how `coffees` and `lookup_value` relate" note below), so deleting a value they reference by convention just removes it from future dropdown options; existing coffees keep whatever text they already have, nothing breaks retroactively. `coffees.origin_region_id` **is** a real FK (Decision #7), so a `DELETE` on a region still in use will hit the default `RESTRICT` behavior — catch that and return a `409` with a clear message ("still assigned to N coffees"), the same pattern `DELETE /api/admin/categories/:id` already uses for `coffee_category` rows still referenced by a Bloom Dial hop, rather than surfacing a raw Postgres FK error.

Frontend: the lightest-weight option is an inline "+ Add new value" affordance next to each existing `LookupSelect` dropdown in `AdminCoffees.tsx` (scoped to that dropdown's `category`), rather than a separate admin page — this table only ever needs simple category-scoped adds, not a general-purpose editor.

**Note for whoever builds this — how `coffees` and `lookup_value` relate (worth stating explicitly, easy to assume wrong):** `lookup_value` is a pure reference/vocabulary table — it holds the menu of valid options per category, nothing coffee-specific. The actual per-coffee data lives directly on `coffees` itself (`coffees.process`, `coffees.roast_level`, `coffees.roast_shade`, `coffees.origin`, `coffees.roaster` — all plain `TEXT`, populated from what the roastery provided when each coffee was added). `process`/`roast_level` are TEXT-matched to `lookup_value.value` by convention only, not a foreign key — the admin dropdown just constrains what you're offered to pick from. `origin_region_id` (Decision #7) is the one field in this build that breaks from that convention and uses a real FK instead, a deliberate choice for stronger consistency on a brand-new field, not a retrofit of the older columns.

---

## Testing

Before starting Part 2:
- `GET /api/coffees/archetypes` — confirm it returns all 5 real archetypes + `experimental`, each with resolved `coffeeId`s matching what's currently live on The Bloom (cross-check against `BloomPage.tsx`'s rendered cards) — the two pages must agree.
- `GET /api/coffees/archetype-stats?archetype=chocolate_nutty` (and at least one archetype with sparse/no cupping data, to confirm the `null`/`0` path doesn't throw) — confirm no `roaster`/coffee-name field anywhere in the payload.
- Confirm none of this file's endpoints (`/archetypes`, `/archetype-stats`, `/:id/content`, `/:id/dimensions`, `/:id/flavor-wheel`) return `roaster`, raw coffee `name`, or the exact `origin` string anywhere in the response — check the actual JSON, not just what the current frontend happens to render (see the Hard constraint section above). `process`, `roastLevel`, and bucketed `originRegion` are expected and fine.
- Confirm `/:id/content`, `/:id/dimensions`, `/:id/flavor-wheel` still return cleanly for every `coffeeId` surfaced by `/archetypes` (a coffee could theoretically be missing cupping data — endpoints should return empty arrays, not error).
- Old-param fallback: hit the new redirect-resolution query directly for a couple of known `coffeeId`s and confirm it resolves to the correct current `archetype`/`slot`.
- Route redirect (Decision #5): confirm `/coffees` (bare) redirects to `/flavor-intelligence`, and `/coffees?coffee={id}` redirects to `/flavor-intelligence?archetype=&slot=` with the correct resolved values — this is backend-adjacent (the resolution query) even though the redirect itself fires client-side in Part 2.
- `GET /api/users/homepage-state` — no changes made here, just confirm it still returns `archetype` correctly for a signed-in test user with a completed quiz, since Part 2 depends on reading it as-is.
- `GET /api/coffees/archetypes` — confirm every slot now includes `isDefault`, and that exactly one slot per archetype has `isDefault: true` (matches `dial_archetype_positions`, e.g. `balanced_sweet` → Feather In Cap/Guatemala per the original seed).
- `GET /api/coffees/:id/content` — confirm the response now also includes `process`, `roastLevel`, and `originRegion` (label or `null`), and that `originRegion` never echoes the raw `coffees.origin` string for any coffee, including ones with `origin_region_id` unset.
- Origin-region backfill: spot-check a handful of coffees in `AdminCoffees.tsx` — confirm the new dropdown is populated from `lookup_value WHERE category = 'origin_region'` and that assigning a value persists and is reflected in `/:id/content`.
- `lookup_value` admin CRUD (Decision #9): add a value via the new inline UI and confirm it appears in `GET /api/admin/lookups` and the relevant dropdown without a redeploy; confirm `DELETE` on an `origin_region` value currently assigned to a coffee returns a clean `409`, not a raw FK error; confirm `DELETE` on an unused `process`/`roast_level` value succeeds and doesn't touch any existing coffee's stored text.

---

## Final task — actually run these tests, don't just read the code and assume it passes

Per Dana directly: this build isn't done when the code is written, it's done when it's been tested and any bugs found are fixed. `backend/package.json` already has `"test": "vitest run"` (Vitest is installed; grep the repo for existing `*.test.ts` files first to match whatever conventions, if any, already exist before adding new ones — as of this doc being written there were none in this area, so use your judgment on structure).

Before marking Part 1 complete:
1. Write and run real Vitest tests (or, at minimum, real `curl`/script-driven requests against a running local instance if a full test harness would be disproportionate) for every new/changed endpoint: `GET /api/coffees/archetypes` (`isDefault` correctness per Decision #8's corrected join), `GET /api/coffees/archetype-stats` (including the sparse-data `null` path), the extended `GET /api/coffees/:id/content` (`process`/`roastLevel`/`originRegion` present and correctly `null`-safe), the legacy `?coffee=` resolution query, and the new `lookup_value` CRUD endpoints (including the `409`-on-referenced-delete path).
2. Actually execute every bullet in the Testing section above against a running backend, not just visually trace the code — this is exactly the kind of gap ("looks right, wasn't run") that testing exists to catch.
3. If anything fails: fix it and re-test, don't hand off a known-broken endpoint with a note about it. If something is ambiguous enough that you're guessing at intended behavior, flag it clearly for Dana rather than guessing silently.
4. Leave whatever test files you write in place (not thrown away after a manual pass) so Part 2 — and any future work on this endpoint — has real regression coverage, not just this doc's checklist.
