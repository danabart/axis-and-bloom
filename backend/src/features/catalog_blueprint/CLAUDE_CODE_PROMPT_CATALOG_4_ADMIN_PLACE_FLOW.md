# Claude Code Prompt — Catalog Blueprint, Brief 4: the admin gets one door

**Series:** Catalog Blueprint (`README.md` in this folder). Brief 4 of 5. Depends on brief 3 (`da62da7`, deployed). Brief 5 (drop legacy, renames) follows.

**Goal:** After this brief, the admin portal places, moves, ranks, prices and retires coffee only through `catalogService` (via `/api/admin/catalog/*`), and reads only through the `v_coffee_*` views. The Coffees page becomes the single entry door ("Place a coffee": coffee + match + home slot + 12 oz SKU + guests, in one confirmed transaction with the blast-radius preview shown first). The Bloom Dial page keeps its Map and Journey lenses and its edit gestures, now backed by the service. The Inventory page edits SKUs only. The Roasteries page's preview and cascade reflect the new placement table. The integrity page grows the "placed, not yet sellable" list and a catalog-changes feed. The `routes/admin.ts` lint allow-list from brief 3 is removed.

**Why this needs a build:** since brief 2, every placement button on `/admin/coffees`, `/admin/dial` and `/admin/inventory` returns `410 RETIRED`, and those pages still read the legacy tables (which hold only inactive Path/Temecula rows). Dana cannot place a coffee from the UI; the only working door is the CLI importer. Brief 5 drops the legacy tables, so the admin has to be off them first.

**Decisions already made — implement as stated, don't re-open:**
- D1: the admin shows both facts side by side, named: "Match" (archetype_assignments, reasoning) and "Home slot" / "Guest slots" (placement). No combined "archetype" column anywhere in the admin.
- D5: one home per coffee, unlimited guests, guests fulfil below the home occupant. The UI never offers a second home; it offers "Move home" or "Add guest".
- D6: the placement form runs `GET /catalog/placement-preview` before confirming and shows the warnings. An out-of-spec placement demands a note in the form (the service enforces `NOTE_REQUIRED`; the form should ask before the round-trip).
- Landing default is a slot property (`is_landing_default`), set from the Dial page with `POST /catalog/slots/:slotId/landing-default`. The per-coffee star is gone.
- **Page strategy (CTO recommendation, 2026-09-14):** `AdminCoffees.tsx` (1602 lines) is rebuilt as a new `AdminCatalog.tsx` at the same route `/admin/coffees` (nav label stays "Coffees"), because most of the old page is alias-row, vocabulary and slot-price editing that has no counterpart in the new model; the story editor and the category tagging sections are carried over as extracted components, not rewritten. `AdminDial.tsx` (1372 lines) is **adapted in place**: same Map/Journey rendering, data source and edit actions swapped. `AdminInventory.tsx` is trimmed to SKU-only. `AdminRoasters.tsx` is adjusted for the new preview shape. Reuse rule (Dana): never re-implement dial, card or reveal logic that exists elsewhere; import it.
- Naming: new backend objects start with `coffee_`; new admin GET endpoints live under `/api/admin/catalog/*`.
- Frontend archetype labels: components under `admin/` take labels from `GET /api/admin/catalog/archetypes` (`v_coffee_archetype`), not from the hardcoded maps in `coffee-info/archetypeConstants.ts` etc. Public (non-admin) frontend maps stay (a separate thread owns the "Balanced" rename).

## Task 0 — Verify current state (confirm, don't assume)

Line numbers as of `da62da7`.

- `git log -1` is `da62da7` or a descendant; `origin/main` contains it; `npm run lint:catalog` passes with the current allow-list.
- `/api/admin/catalog/*` exists (brief 2): write verbs + `GET /catalog/archetypes`, `/catalog/slots`, `/catalog/coffees?include_inactive`, `/catalog/coffees/:id`, `/catalog/placement-preview`, `/catalog/integrity`, `POST /catalog/import`. Read `routes/admin.ts` from `const catalogRouter = Router()` (~L2324) to the end and list the exact response shapes of the four GETs; extend them, do not fork them.
- Legacy-reading admin GETs still live and still serving the pages: `/archetypes` L47 (CASE label map), `/coffees` L216, `/roasters` L355, `/roasters/:id/deactivation-preview` L449, `/sessions/:id/coffees` L521, `/dial/slot-aliases` L579, `/coffee-alias` L604, `/slot-prices` L673, `/coffee-prices` L701, `/dial/graph` L1186, `/dial/positions` L1312, `/dial/dimension-config` L1342, `/dial/navigation` L1376, `/dial/hop-suggestions` L1404, `/dial/archetype-adjacency` L1475, `/dial/vocabulary` L1503, `/inventory/coffees-lookup` L2117, `/inventory` L2137. The second CASE label map is at ~L1211.
- `services/catalogService.ts` `buildDeactivationPreview` (~L920) still reads `dial_archetype_positions` and `coffee_alias` for `home_archetype`, `guest_positions`, `is_default`, the `aliases` counts and the "default archetype" query; `slotsGoingEmpty` already comes from `v_coffee_sellable_slot`. `buildReactivationPreview` (~L1022) counts `coffee_alias`.
- Frontend: `AdminCoffees.tsx` state at L236–318 (coffees, vocab, aliases, slotAliases, slotPrices, categories, coffeeCategories, archetypeOptions, story editing, alias rank/name/toggle, slot/price/vocab-label editing); story editor around L1544; category management sections around L1389–1480. `AdminDial.tsx`: lenses L240–252, `editMode` L264, click handling L536–550, calls `/api/admin/dial/positions*`, `/dial/relationships*`, `/coffees`. `AdminInventory.tsx`: state L70–82, calls `/inventory*`, `/coffee-alias`. `AdminRoasters.tsx`: preview types L36–50 include `aliases` counts. `AdminLayout.tsx` L18–21 nav. `App.tsx` L104 route `coffees` → `AdminCoffees`. `AdminCatalogIntegrity.tsx` (131 lines) renders `severity: 'info'` checks with details.
- `api_event` columns: `id, occurred_at, call_type, method, path, firebase_uid, is_anonymous, request_body, body_truncated, response_status, response_error, duration_ms`. Catalog writes appear with `call_type` derived from `/catalog/...` route patterns (confirm the exact `call_type` strings by grepping `middleware/apiEventLog.ts` and one live row).
- Brief 1 known issue: `schema.sql` re-seeds `archetype.descriptor_families` whenever a row's array is empty; this brief adds editing, so the seed needs a guard.

## Part A — Backend: admin read endpoints on the views, legacy admin reads retired

Extend the `catalogRouter` (all view-backed, all thin):

```
GET /catalog/archetypes                      already exists; add label + sort + dominant dimension name + descriptor_families (from v_coffee_archetype)
GET /catalog/slots?archetype=                per slot: id, archetype, sort_order, name, position_label, position_description, dimension_id, is_landing_default, spec_band_lo/hi, spec_descriptor_families, is_active,
                                             occupants: [{ coffee_id, coffee_name, roaster_name, role, priority, certified_at, placement_note }] from v_coffee_slot (active only),
                                             sellable_12oz: boolean and resolved coffee_id from v_coffee_sellable_slot, prices: [{ weight_oz, retail_price_cents }]
GET /catalog/coffees?include_inactive&roaster_id&match_archetype&q   v_coffee rows + placements (from v_coffee_slot) + skus (roaster_blend by coffee, active + inactive) + category_codes + story flags
GET /catalog/coffees/:id                     the above for one coffee + hops (v_coffee_hop) + cupping summary (getAvgCuppingScore on the archetype's dominant dimension, merged sessions count) + recent api_event rows for this coffee (see Part D)
GET /catalog/graph                           what AdminDial needs: slots (as above, all archetypes) + active placements + hops from v_coffee_hop (both coffees active) — one payload, replaces /dial/graph + /dial/positions + /dial/navigation
GET /catalog/hop-suggestions                 existing dialSuggestion-based endpoint moved under /catalog and reading slots via getSlots (it already does since brief 3); same response shape
GET /catalog/changes?limit=100&coffee_id=    Part D
GET /catalog/not-sellable                    Part D
PUT /catalog/archetypes/:code/descriptor-families   body { families: string[] } → catalogService.setArchetypeDescriptorFamilies (new verb, validates against DISTINCT wheel_category in cupping_note)
```

Then **retire** (410 RETIRED, same pattern as brief 2, routes kept registered): `/archetypes` (root one; keep `/catalog/archetypes`), `/coffees`, `/dial/slot-aliases`, `/coffee-alias`, `/slot-prices`, `/coffee-prices`, `/dial/graph`, `/dial/positions`, `/dial/dimension-config`, `/dial/navigation`, `/dial/hop-suggestions`, `/dial/archetype-adjacency`, `/dial/vocabulary`, `/inventory/coffees-lookup`, `/inventory`. Delete both CASE label maps. Keep: `/lookups`, `/stats`, `/roasters*`, `/sessions*`, `/flavor-wheel/:coffeeId`, `/cupping-notes`, `/categories*`, `/coffee-categories*`, `/dimensions`, `/scores/*`, `/dial/consensus/:coffeeId` (dial_position_signal, not placement), sommelier, ai-ops, qr, quiz/catalog integrity, system-health — but any of the kept ones that reads a legacy placement table or `archetype_assignments` directly moves onto `catalogReads` / the views (grep them; `/stats`, `/sessions/:id/coffees`, `/flavor-wheel` are the likely ones).

`buildDeactivationPreview` / `buildReactivationPreview` in `catalogService.ts`: replace the `dial_archetype_positions` / `coffee_alias` reads with `v_coffee_slot` (home archetype, guest count) and `coffee_slot_assignment` counts; the preview shape changes from `aliases: {total, active}` to `placements: { total, active, homes, guests }`, `slotsGoingEmpty` unchanged, and the old `isDefault`-based "default archetype" clause is replaced by "landing-default slots whose current sellable occupant is this roastery's coffee" (from `v_coffee_sellable_slot` + `coffee_dial_slot.is_landing_default`). Keep the legacy `coffee_alias` **cascade** (write) as is; brief 5 removes it. After this, the only legacy reads left in `catalogService.ts` are inside that cascade.

`schema.sql`: guard the `descriptor_families` seed so it runs once: add `archetype.descriptor_families_seeded_at TIMESTAMPTZ`, seed `WHERE descriptor_families_seeded_at IS NULL` and stamp it; mirror into `migrations/catalog_blueprint_4_<date>.sql`.

Update `scripts/lint-catalog.mjs`: remove the `routes/admin.ts` entries from rules 3 and 4. Rule 4 gains `frontend/src/app/components/admin/**` for the six label literals (admin components must fetch labels).

## Part B — Frontend: `AdminCatalog.tsx` replaces `AdminCoffees.tsx` at `/admin/coffees`

One page, three regions, all data from `/api/admin/catalog/*`:

**B1. Coffee list (default view).** Filters: roastery, match archetype, active/inactive, text. Columns: name · roastery · Match (label + confidence + source) · Home slot (archetype label + slot name, or "not placed") · Guests (count, expandable) · 12 oz SKU (present/absent, active) · Sellable (from `/catalog/slots` resolution: "Sellable on <slot>", "Placed, not sellable: <reason>", "Not placed") · categories · story (published / draft / none). Row actions: Edit metadata · Set match · Move home · Add guest · Manage SKUs · Retire / Restore · Story (opens the carried-over story editor). Every action is a small modal that calls one `/catalog/*` verb, shows `warnings` from `CatalogWriteResult` after saving, and refreshes the row.

**B2. "Place a coffee" (the door).** A single multi-step form (one component, one submit): 1) roastery (active roasteries from `/roasters`) + coffee metadata (reuse `LookupSelect` from the old page for origin/process/roast lookups) + categories; 2) match archetype + confidence + source (default `manual`; `cupping` requires a session id from `/sessions`); 3) home slot picker (archetype tabs → 4 slots with name, position label, current occupants, sellable flag, spec band if set) + priority (default next free) ; 4) 12 oz SKU (roaster SKU, cost, quantity; 5 lb optional); 5) guests (optional, same picker, multiple); 6) **Preview**: calls `GET /catalog/placement-preview` for the home (and each guest) and renders the warnings and blast radius (hops that re-derive, users whose saved dial position changes, "target slot has no price at 12 oz", occupant list); if any `band_out_of_spec` / `descriptor_off_family` warning is present, a required "placement note" field appears; 7) Confirm → one call to `POST /catalog/import?apply=true` with a one-coffee manifest built from the form (this is deliberate: the importer already does the whole sequence in one transaction and returns the per-coffee report; do not re-implement the sequence client-side). Show the returned report (ids, warnings, scoped integrity) and link to the new row. Also a "Bulk import" button on the same region: file picker for a manifest JSON → `POST /catalog/import` dry-run first, show the report, then an "Apply" button that re-posts with `apply=true`.

**B3. Slots & pricing.** Per archetype (tabs, labels from `/catalog/archetypes`): the 4 slots as cards: name (rename inline → `PATCH /catalog/slots/:id`), position label, landing-default marker (set → `POST …/landing-default`), prices per weight (edit → `PUT …/prices`), spec band lo/hi on the dominant dimension + descriptor families multi-select (edit → `PUT …/spec`; families from `DISTINCT wheel_category`), occupants ordered by home-first then priority with drag-to-reorder → `PUT …/priorities`, certify button per occupant → `POST …/certify`. Archetype-level descriptor families editable in a small header per tab → `PUT /catalog/archetypes/:code/descriptor-families`.

Carried over from `AdminCoffees.tsx` as extracted components (move, don't rewrite): the story editor (with `PATCH /coffees/:id/story`, `/refresh-content`, violations display), the category admin (`/categories*`, `/coffee-categories*`), and `LookupSelect`. Delete `AdminCoffees.tsx` when nothing imports it; update `App.tsx` L104 and any lazy imports.

## Part C — Frontend: `AdminDial.tsx` adapted in place, `AdminInventory.tsx` trimmed, `AdminRoasters.tsx` adjusted

**AdminDial.tsx:** data from `GET /catalog/graph` only (map the payload to the shapes the existing Map/Journey renderers already take; if a renderer needs a field that no longer exists, e.g. per-coffee `is_default`, replace it with the slot-level `is_landing_default` and adjust the star affordance to sit on the slot). Edit mode actions: move a coffee to another slot → `POST /catalog/coffees/:id/move` (after `placement-preview`, showing warnings; note field when required); add guest → `POST /catalog/coffees/:id/placements` role guest; remove from slot → `DELETE …/placements/:slotId`; star → `POST /catalog/slots/:id/landing-default`; add hop → `POST /catalog/hops` (shows the cupping-contradiction warning if returned); remove hop → `DELETE /catalog/hops/:id`; hop suggestions → `GET /catalog/hop-suggestions`. Roaster lens and the seam/island rendering unchanged. Every write shows `warnings` inline and re-fetches the graph.

**AdminInventory.tsx:** list = `GET /catalog/coffees?include_inactive` flattened to SKUs (coffee name, roastery, weight, SKU, variant, cost, quantity, buffer, status, active); edit → `PUT /catalog/coffees/:id/skus`; restock → `POST /catalog/skus/:blendId/restock`; toggle active → `PUT …/skus` with `isActive`. The old "link blend to coffee" and alias columns are removed: a SKU is created from the coffee (Place-a-coffee or "Manage SKUs"), never orphaned. Nav label stays "Blends & SKUs".

**AdminRoasters.tsx:** preview types and copy updated to the new preview shape (`placements` instead of `aliases`; "N placements will be marked inactive"; on reactivate: "coffees and SKUs are restored; placements are not, place them again from Coffees" — positive register, say what happens, not what is missing).

**AdminCatalogIntegrity.tsx:** two new panels under the checks: "Placed, not yet sellable" from `GET /catalog/not-sellable` (coffee, slot, reason, link to the coffee row) and "Catalog changes" from `GET /catalog/changes` (time, actor, verb, coffee/slot, status; filter by coffee).

Labels: an `useArchetypes()` hook in `admin/` (fetch `/catalog/archetypes` once, cache in module scope) used by every admin component that shows an archetype name; no admin component imports `archetypeConstants.ts` after this brief.

## Part D — Backend: "not sellable" and "changes"

- `GET /catalog/not-sellable`: active slots that have at least one active assignment but no `v_coffee_sellable_slot` row at 12 oz → `[{ slot_id, archetype, sort_order, slot_name, coffee_id, coffee_name, reasons: ['no_active_12oz_sku' | 'no_price_12oz' | 'coffee_inactive' | 'category_excluded'] }]`. Reuse integrity check 8's query (extract it into `catalogReads.getNotSellable()` and have the check call it too).
- `GET /catalog/changes?limit&coffee_id&slot_id`: `api_event` rows where `path LIKE '/api/admin/catalog/%'` and `method <> 'GET'`, newest first, mapped to `{ at, actor: firebase_uid, verb: call_type, method, path, status: response_status, coffee_id / slot_id parsed from path or request_body when present, error: response_error }`. Filter by coffee/slot on the parsed ids. Nothing new is stored.

## Part E — Tests

- `routes/admin.catalog.test.ts`: extend with the GETs (`/catalog/slots` shape incl. occupants + sellable flag on a fixture; `/catalog/graph` returns 24 slots and the fixture placement + one hop; `/catalog/not-sellable` lists a placed-unpriced fixture with `no_price_12oz`; `/catalog/changes` returns the write just made with its `call_type`); every retired GET returns 410.
- `services/catalogService.test.ts`: `buildDeactivationPreview` returns `placements` counts from `coffee_slot_assignment` and no longer touches legacy tables (assert by a spy on `db.query` text, or by the lint rule).
- Frontend: `npm run build` (vite) clean; `npx tsc --noEmit` must not add to the 12 known pre-existing errors (list them before and after). Component tests are not in the repo; do not introduce a test runner.
- Lint: `npm run lint:catalog` passes with the reduced allow-list (report it).

## Part F — Docs

- `WHAT_WE_BUILT.md`: entry "Catalog Blueprint · brief 4 — the admin gets one door": page-by-page what changed, the retired admin GETs, the preview shape change, the changes feed, and screenshots' worth of description of the Place-a-coffee flow (steps and what the preview shows).
- `WHAT_WE_BUILT_DB.md`: `descriptor_families_seeded_at`; ownership table rows for `archetype.descriptor_families` (writer `setArchetypeDescriptorFamilies`).
- `README.md` here: brief 4 → EXECUTED + hash; brief 5 row: add "remove `coffee_alias` cascade from `catalogService`; drop `dial_archetype_positions`, `coffee_alias`, `dial_slot_alias`, `dial_position_vocabulary`, `dial_archetype_config`, `v_dial_positions`, `v_dial_navigation`; re-key `dial_position_signal.suggested_vocabulary_id` → `suggested_slot_id`; rename `v_archetype_adjacency` → `v_coffee_archetype_adjacency`; renames per naming convention; NOT NULLs; integrity check 13 → fail; lint allow-list → permanent entries only".

## Don'ts (scope fence)

- No schema drops or renames (brief 5). Only the `descriptor_families_seeded_at` column.
- No changes to public (non-admin) frontend components or public API routes.
- No new write verbs except `setArchetypeDescriptorFamilies`; everything else uses brief 2's verbs. If a UI action has no verb, stop and report rather than adding inline SQL.
- No re-implementation of dial rendering, journey logic, cards or reveal panels; adapt the existing components' data source.
- No label text changes.

## Definition of done

- `npm run lint:catalog` passes with `routes/admin.ts` no longer allow-listed; `grep -rn "archetypeConstants" frontend/src/app/components/admin` → 0 hits.
- Backend build + tests green (pre-existing quizScoring failures unchanged); frontend build clean; tsc error count unchanged.
- Ship in one go: commit `catalog: brief 4 — admin gets one door (Catalog Blueprint)`, push, deploy green, startup log clean.
- Smoke on prod (`?preview=true`), in order: `/admin/coffees` loads the empty list and the Place-a-coffee form opens; run the form through step 6 on a **fictional** coffee against a fictional roastery you create on `/admin/roasters` for this purpose → the preview renders warnings (expect `band_no_spec` and probably `band_no_data`) → confirm → the coffee appears in the list as "Placed, not sellable: no price" → set a 12 oz price on that slot in Slots & pricing → the row flips to "Sellable" and `/api/coffees/archetypes` shows that slot `isActive: true` → retire the coffee → slot back to `isActive: false` → deactivate the fictional roastery from `/admin/roasters` (preview shows `placements`) → confirm `/api/admin/catalog/integrity` `allPass: true`. Leave the fictional roastery and coffee **inactive** in prod (do not delete; they are the first rows placed through the door and the integrity page should show them as history). `/admin/dial` renders the map with the retired coffee absent; `/admin/inventory` lists the fictional SKU as inactive.
- Closing report, once: Task 0 deviations; the retired GET list; the final lint allow-list; the exact prod smoke sequence with what each step showed; commit hash, deploy URL, startup-log excerpt.
