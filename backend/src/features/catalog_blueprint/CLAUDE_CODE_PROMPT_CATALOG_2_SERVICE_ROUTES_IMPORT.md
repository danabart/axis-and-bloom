# Claude Code Prompt — Catalog Blueprint, Brief 2: catalogService, thin routes, import

**Series:** Catalog Blueprint (`README.md` in this folder). Brief 2 of 5. Depends on brief 1 (`f4a9685`): `withTransaction()`, `coffee_dial_slot`, `coffee_slot_assignment`, the five `v_coffee_*` views and `catalogIntegrity.ts` all exist. Brief 3 (readers onto views), brief 4 (admin UI), brief 5 (drop legacy) follow.

**Goal:** After this brief there is exactly one way to change the catalog: `backend/src/services/catalogService.ts`. Every verb (create a coffee, set its match archetype, place it on a slot, move it, add a guest, rank it, retire it, edit a SKU, name or price a slot, set a slot spec, add a hop, activate or deactivate a roastery) is one exported function that runs in one real transaction, applies the movement guardrail, and returns an integrity report for what it touched. New admin endpoints under `/api/admin/catalog/*` expose the verbs; the old placement write endpoints are retired; a bulk importer with dry-run replaces the seed files. Readers and the admin pages are untouched (briefs 3 and 4).

**Why this needs a build (context, not instructions):** all placement writes already live in `routes/admin.ts`, but as ~30 inline SQL statements across nine endpoints with no shared rules, four of them "transactional" via `db.query('BEGIN')` on the pool (not atomic). `POST /coffees` creates a coffee with free-text `roaster` and no `roaster_id`. The roastery deactivate/reactivate cascade is correct but inline. Nothing writes to the brief-1 tables yet. With the catalog empty, this is the moment the rules get one home.

**Decisions already made (Dana, 2026-09-10 and 2026-09-13) — implement as stated, don't re-open:**

- D1: match archetype and placement are two facts. `setMatchArchetype` and `placeCoffee` are separate verbs; neither derives from the other. `placeCoffee` may *warn* when placement archetype ≠ match archetype; it never blocks (Kopi Safari is the canonical legitimate divergence).
- D5: one active home per coffee; unlimited guests; guests fulfil their slot below home occupants (already encoded in `v_coffee_sellable_slot`).
- D6 / N4: every place/move evaluates the coffee against the target slot's spec. Posture is **warn + record**: an out-of-spec placement requires a `placementNote` and then saves. No hard gate; expose `CATALOG_SPEC_HARD_GATE=false` in config for later.
- N3: nothing is backfilled from legacy tables. Reactivating a roastery restores coffees and SKUs only; placements are re-created deliberately through `placeCoffee` (or the importer).
- N6: rules in TypeScript, constraints in SQL. No PL/pgSQL business logic.
- N7: bulk import is part of this brief.
- Naming (Dana): new tables/enums/views start with `coffee_`. New route prefix is `/api/admin/catalog`. Service file is `catalogService.ts` (services are not tables; no prefix needed).

## Task 0 — Verify current state (confirm, don't assume)

- `git log -1` is `f4a9685` or a descendant; `coffee_dial_slot` has 24 rows, `coffee_slot_assignment` 0 rows; `runCatalogIntegrityChecks()` reports `allPass: true`.
- `db/client.ts` exports `db`, `withTransaction`, `Tx`.
- Old placement write endpoints in `routes/admin.ts` (line numbers as of `f4a9685`): `POST /coffees` L265 · `PATCH /coffees/:id` L291 · `POST /coffees/:id/archetype` L806 (pool BEGIN) · `DELETE /coffees/:id` L883 · `POST /coffee-alias` L1022 · `PATCH /coffee-alias/slot` L1059 · `PATCH /coffee-alias/:id` L1087 (pool BEGIN in the swap branch) · `PATCH /slot-prices` L1240 · `PATCH /dial/vocabulary/:id` L2071 · `POST /dial/positions` L2092 · `PATCH /dial/positions/:id` L2116 (pool BEGIN in the swap branch) · `DELETE /dial/positions/:id` L2197 · `POST /dial/positions/guest` L2214 · `DELETE /dial/positions/guest/:id` L2247 · `POST /dial/relationships` L2266 · `DELETE /dial/relationships/:id` L2360 · `PATCH /inventory/:id` L3001 · `POST /inventory/:id/restock` L3047 · `POST /roasters/:id/deactivate` L684 and `/reactivate` L740 (hand-rolled `db.connect()`, correct).
- `services/dialSuggestion.ts` `recordCuppingSignal()` ~L252 uses pool-level BEGIN/COMMIT on `dial_position_signal` (not a catalog table, but the same bug class). `getAvgCuppingScore(coffeeId, dimensionId)` L61 returns the merged-cupping average on a dimension; reuse it, do not re-implement.
- `v_collaborative_flavor_wheel` (schema.sql ~L2442) gives per-coffee descriptors with `wheel_category` from internal, roastery and client sources.
- `archetype.descriptor_families` seeded in brief 1 with the real `wheel_category` strings ('Nutty / Cocoa', 'Sour / Fermented', 'Green / Vegetative', 'Sweet', 'Fruity', 'Floral', 'Spices', 'Roasted').
- `middleware/apiEventLog.ts` captures every admin route automatically (`call_type` from `req.route.path`); no per-route work is needed for the new endpoints to be logged.
- Seed files are run manually, never at boot (WHAT_WE_BUILT_DB.md L7). `schema.sql` ~L1972 still contains the boot-time Kopi Safari `dial_archetype_positions` seed.
- Frontend admin pages (`AdminCoffees.tsx`, `AdminDial.tsx`, `AdminInventory.tsx`) call the old endpoints. They are **not** changed in this brief; after this brief their placement buttons will receive `410 Gone` until brief 4 rewires them. That is expected and accepted (the catalog is empty and no roastery is onboarded before brief 5).
- There is no existing CI grep infrastructure (`.github/workflows/deploy.yml` has none). CI greps are brief 3's job.

## Part A — `backend/src/services/catalogService.ts`

One file, one exported function per verb. Every function: takes an `input` object and a `ctx: { actor: string }` (admin uid or `'import'` / `'system'`), runs inside `withTransaction`, writes `created_by` / `updated_at` where the columns exist, and returns `CatalogWriteResult`:

```ts
export interface CatalogWriteResult<T = unknown> {
  result: T;                             // what changed (ids, the new row)
  warnings: PlacementWarning[];          // D6 evidence warnings, divergence warnings
  integrity: CatalogIntegrityCheck[];    // checks 4, 5, 6, 8 re-run for the touched coffee/slot only
}
export type PlacementWarning =
  | { kind: 'band_out_of_spec'; dimension: string; coffeeAvg: number; lo: number; hi: number }
  | { kind: 'band_no_data'; dimension: string }              // no merged cupping score on the dimension
  | { kind: 'band_no_spec' }                                 // slot has no band yet
  | { kind: 'descriptor_off_family'; families: string[]; coffeeTop: string[] }
  | { kind: 'placement_diverges_from_match'; match: string; placement: string };
```

Errors are thrown as `CatalogError extends Error { status: 400 | 404 | 409; code: string; detail?: unknown }` so routes map them 1:1 (`res.status(err.status).json({ error: err.code, detail })`). Codes: `COFFEE_NOT_FOUND`, `SLOT_NOT_FOUND`, `ROASTER_NOT_FOUND`, `COFFEE_INACTIVE`, `SLOT_INACTIVE`, `HOME_EXISTS`, `PRIORITY_TAKEN`, `NOTE_REQUIRED`, `ALREADY_ASSIGNED`, `SKU_EXISTS`, `ROASTER_STATE`, `INVALID_INPUT`.

### A1. Verbs and signatures

```ts
createCoffee(input: { roasterId: string; name: string; origin?; blendOrSingle?; process?; roastLevel?; roastShade?; flavorDescriptorsRoaster?: string[]; categoryCodes?: string[] }, ctx) → { coffeeId }
  // roaster must exist and be active; name unique per roaster (the existing index enforces; pre-check for a clean 409);
  // writes coffees.roaster_id AND coffees.roaster (= roaster.name, kept in sync until brief 5 drops the text column);
  // categoryCodes → coffee_category_assignment rows.
updateCoffee(input: { coffeeId; ...same optional fields...; categoryCodes? }, ctx)
  // metadata only. Never touches placement, match, or active flags.
retireCoffee(input: { coffeeId; reason: 'manual' }, ctx)
  // coffees.is_active=false + stamps; cascades coffee_slot_assignment (is_active=false, deactivation_reason='manual') and roaster_blend rows of this coffee (reason 'manual'). Returns counts.
restoreCoffee(input: { coffeeId }, ctx)
  // inverse for reason='manual' rows only; placements are NOT restored (N3 — re-place deliberately). Returns counts.

setMatchArchetype(input: { coffeeId; archetype: ArchetypeCode; confidence: 'low'|'medium'|'high'; source: 'cupping'|'manual'|'import'; sessionId?: number; notes? }, ctx)
  // supersedes the current archetype_assignments row (superseded_at=now()) and inserts the new one. No-op (no new row) if identical archetype+confidence.
  // Returns warnings: placement_diverges_from_match if the coffee has an active home on another archetype.

placeCoffee(input: { coffeeId; slotId; role: 'home'|'guest'; priority?: number; placementNote?: string; certify?: { by: string; note?: string } }, ctx)
  // THE guarded operation. Runs the three layers (A2). Inserts coffee_slot_assignment (or re-activates an inactive row for the same slot+coffee, preserving its id).
  // priority default: next free priority on the slot. role='home' when the coffee already has an active home → 409 HOME_EXISTS (use moveCoffee).
moveCoffee(input: { coffeeId; toSlotId; priority?; placementNote?; certify? }, ctx)
  // home only. In one transaction: deactivate the current home row (deactivation_reason='moved'), then placeCoffee(role='home') on the target. Same three layers against the target.
addGuest(input, ctx)          // = placeCoffee with role='guest'; kept as its own name for readability of call sites
removeFromSlot(input: { coffeeId; slotId; reason: 'manual'|'moved' }, ctx)
  // is_active=false + stamps on that assignment row. Never deletes.
setPriority(input: { slotId; ordered: number[] /* coffee ids, priority 1..n */ }, ctx)
  // rewrites priorities for all active assignments on the slot in one transaction (two-phase: set to negative temp values, then final — avoids tripping the (slot_id, priority) partial unique mid-way). Every active assignment on the slot must appear exactly once → else 400.
certifyPlacement(input: { coffeeId; slotId; by: string; note? }, ctx)   // stamps certified_at/by/note

upsertSku(input: { coffeeId; weightOz: number; blendName?; roasterSku?; shopifyVariantId?; costToUs?; quantityAvailable?; safetyStockBuffer?; isActive? }, ctx) → { blendId }
  // roaster_blend keyed by (coffee_id, weight_oz) active; roaster_id copied from the coffee; blend_name defaults to the coffee name; inventory_status computed with the existing computeInventoryStatus() (move that helper out of admin.ts into this file or a shared util). archetype_id is never written.
restockSku(input: { blendId; quantity }, ctx)   // the existing /inventory/:id/restock semantics, moved.

renameSlot(input: { slotId; name?; positionLabel?; positionDescription? }, ctx)
setSlotSpec(input: { slotId; bandLo?: number|null; bandHi?: number|null; descriptorFamilies?: string[] }, ctx)   // validates lo<=hi and that families ⊆ known wheel_category values
setSlotPrice(input: { slotId; weightOz; retailPriceCents }, ctx)   // upsert on dial_slot_price by (slot_id, weight_oz); also writes the legacy archetype/dial_sort_order columns from the slot row so old readers keep working until brief 3
setLandingDefault(input: { slotId }, ctx)     // clears the archetype's other landing default, sets this one, one transaction

setHop(input: { fromCoffeeId; toCoffeeId; dimensionId; direction: 'more'|'less'; delta?; isRecommended?; confidence?; notes? }, ctx)
  // upsert on the existing unique (from,to,dimension,direction). hop_type: until brief 5 drops the column it is NOT NULL, so write the value derived from both coffees' current active homes (both exist → within/bridge; else 'within_archetype' and add warning hop_type_provisional). Warn (never block) when direction contradicts merged cupping on the dimension (same soft-warn the old endpoint had — port it).
removeHop(input: { hopId }, ctx)              // real delete (hops have no history semantics today)

deactivateRoastery(input: { roasterId; note? }, ctx) / reactivateRoastery(input: { roasterId }, ctx)
  // moved from admin.ts L684/L740 verbatim in semantics, plus: deactivate also cascades coffee_slot_assignment rows of the roastery's coffees (reason 'roaster'); the legacy coffee_alias cascade is kept until brief 5. reactivate restores coffees + roaster_blend (+ coffee_alias, legacy) exactly as today and does NOT restore coffee_slot_assignment (N3). buildDeactivationPreview() moves here too; its "slots that would empty" query switches to v_coffee_sellable_slot (exclude the roastery's coffee ids and diff).
```

### A2. The movement guardrail (inside `placeCoffee` / `moveCoffee`, in this order)

1. **Structural — hard blocks (`CatalogError` 404/409):** slot exists and is active; coffee exists and is active; for `home`, no other active home (`HOME_EXISTS`); requested priority not taken by another active row (`PRIORITY_TAKEN`, unless `priority` omitted → next free); same (slot, coffee) already active → `ALREADY_ASSIGNED`.
2. **Evidence — warn + record (D6):** `evaluatePlacement(tx, coffeeId, slotId)`:
   - Band: dimension = slot's `dimension_id` (fallback: archetype's `dominant_dimension_id`). `coffeeAvg` from `getAvgCuppingScore(coffeeId, dimensionId)` (note it queries via `db`, not `tx`; that is fine for a read). If slot `spec_band_lo`/`hi` are NULL → `band_no_spec`. If no score → `band_no_data`. If outside [lo, hi] → `band_out_of_spec`.
   - Descriptors: families = slot `spec_descriptor_families` if non-empty else archetype `descriptor_families`. Coffee's top categories = top 3 `wheel_category` by row count from `v_collaborative_flavor_wheel` for the coffee (all sources). If families is non-empty and the intersection with the coffee's top categories is empty → `descriptor_off_family`. No descriptors at all → no warning (nothing to judge).
   - Divergence: placement archetype ≠ current match archetype → `placement_diverges_from_match`.
   - **Rule:** if any `band_out_of_spec` or `descriptor_off_family` warning exists and `placementNote` is empty → throw `NOTE_REQUIRED` (400) listing the warnings. With a note, save and store the note in `placement_note`. `band_no_data`, `band_no_spec`, divergence never require a note. If `process.env.CATALOG_SPEC_HARD_GATE === 'true'`, `band_out_of_spec` / `descriptor_off_family` throw 409 `SPEC_VIOLATION` instead (default off; document in `.env.example`).
3. **Blast radius — informational:** `previewPlacement(input)` (exported, no writes, also called by the route `GET /api/admin/catalog/placement-preview`) returns: the evidence warnings above; hops touching this coffee whose `hop_type_derived` would change; count of `user_bloom_dial_current_position` rows on the source and target slots; whether the target slot has a name, a 12 oz price, and whether the coffee has an active 12 oz SKU (so the admin sees "placed but not sellable" before confirming); the current occupant list of the target slot with priorities.

### A3. Integrity report per write

After the write, inside the same transaction, run a scoped version of checks 4, 5, 6 and 8 from `catalogIntegrity.ts` limited to the touched coffee/slot. Refactor `catalogIntegrity.ts` so each check is a function taking an optional `{ coffeeId?, slotId?, tx? }` scope and `runCatalogIntegrityChecks()` composes them unscoped; the service composes the scoped subset. Same check ids and names, so the admin can recognise them.

### A4. Rules of the file

- Every SQL statement on `coffees`, `archetype_assignments`, `coffee_slot_assignment`, `coffee_dial_slot`, `dial_slot_price`, `roaster_blend`, `dial_coffee_relationships`, `coffee_category_assignment`, `roaster` (active flags) lives in this file. `routes/*.ts` contain none after this brief (brief 3's CI grep will enforce it).
- All reads inside verbs go through the `v_coffee_*` views where a view exists (`v_coffee` for coffee state, `v_coffee_slot` for assignments, `v_coffee_sellable_slot` for sellability).
- Legacy tables (`dial_archetype_positions`, `coffee_alias`, `dial_slot_alias`, `dial_position_vocabulary`) are **never written** by the service, with the single exception of the roastery cascade keeping `coffee_alias.is_active` in step (documented inline, removed in brief 5).
- `console.info('[catalog] <verb>', { actor, ...ids, warnings: warnings.map(w => w.kind) })` after each successful write, same convention as `[admin/roasters deactivate]`.

## Part B — `backend/src/services/catalogImport.ts` + CLI

Manifest format (JSON; one file per roastery is the expected use):

```jsonc
{
  "roaster": { "name": "Path Coffee Roasters" },           // must already exist (create it on /admin/roasters first); matched by name, case/space-insensitive
  "coffees": [
    {
      "name": "Ethiopia Guji", "origin": "Ethiopia", "process": "washed", "roastLevel": "light",
      "flavorDescriptorsRoaster": ["jasmine", "bergamot"], "categoryCodes": [],
      "match": { "archetype": "floral", "confidence": "medium", "source": "import" },
      "home":   { "slot": "floral/2", "priority": 1, "placementNote": "spread for connectivity" },
      "guests": [ { "slot": "fruity/1", "priority": 2 } ],
      "skus":   [ { "weightOz": 12, "roasterSku": "PATH-GUJI-12", "costToUs": 11.5 }, { "weightOz": 80 } ],
      "certify": { "by": "dana", "note": "cupped 2026-09-20" }
    }
  ],
  "slotPrices": [ { "slot": "floral/2", "weightOz": 12, "retailPriceCents": 2200 } ]   // optional
}
```

`slot` is `"<archetype>/<sort_order>"` or a slot name (`"Perfumed & Expressive"`); resolve via `coffee_dial_slot`. `importCatalog(manifest, { dryRun: boolean, actor })`: validates the whole manifest first (unknown archetype, unknown slot, duplicate coffee names, missing 12 oz SKU → collected as errors, not thrown one at a time), then in **one transaction** calls the service verbs per coffee in order createCoffee → setMatchArchetype → upsertSku (all) → placeCoffee(home) → addGuest (each) → certifyPlacement, then setSlotPrice for each price. Dry run = same transaction, `ROLLBACK` at the end, report returned as if applied. Report: per coffee, the ids it would get / got, warnings (with `NOTE_REQUIRED` surfaced as an error naming the coffee and the missing note), and the unscoped integrity report after the batch. Idempotency: a coffee whose (roaster, name) already exists and is active → error `COFFEE_EXISTS` for that row (the importer is for entry, not sync; re-runs must be deliberate). Add `"mode": "skip_existing"` as the one escape hatch.

CLI: `backend/src/scripts/catalogImport.ts` → `npm run catalog:import -- path/to/manifest.json [--apply]` (dry-run is the default; `--apply` writes). Prints the report as a table. Add the script to `package.json`. Also `POST /api/admin/catalog/import` with the manifest as body and `?apply=true`, same function, for brief 4's upload button.

## Part C — Routes (`backend/src/routes/admin.ts`, behind the existing `requireAdmin`)

New, all thin (validate → call service → map `CatalogError` → `res.json(result)`):

```
POST   /catalog/coffees                       createCoffee
PATCH  /catalog/coffees/:id                   updateCoffee
POST   /catalog/coffees/:id/retire            retireCoffee
POST   /catalog/coffees/:id/restore           restoreCoffee
PUT    /catalog/coffees/:id/match             setMatchArchetype
POST   /catalog/coffees/:id/placements        placeCoffee (body.role home|guest)
POST   /catalog/coffees/:id/move              moveCoffee
DELETE /catalog/coffees/:id/placements/:slotId  removeFromSlot
POST   /catalog/coffees/:id/placements/:slotId/certify  certifyPlacement
GET    /catalog/placement-preview?coffeeId&slotId&role   previewPlacement
PUT    /catalog/slots/:slotId/priorities      setPriority
PATCH  /catalog/slots/:slotId                 renameSlot
PUT    /catalog/slots/:slotId/spec            setSlotSpec
PUT    /catalog/slots/:slotId/prices          setSlotPrice
POST   /catalog/slots/:slotId/landing-default setLandingDefault
PUT    /catalog/coffees/:id/skus              upsertSku
POST   /catalog/skus/:blendId/restock         restockSku
POST   /catalog/hops                          setHop
DELETE /catalog/hops/:id                      removeHop
POST   /catalog/import?apply=true|false       importCatalog
GET    /catalog/archetypes                    SELECT * FROM v_coffee_archetype
GET    /catalog/slots                         v_coffee_dial_slot rows + occupant summary from v_coffee_slot + sellable flag at 12 oz from v_coffee_sellable_slot
GET    /catalog/coffees?include_inactive      v_coffee (+ placements from v_coffee_slot nested)
GET    /catalog/coffees/:id                   one v_coffee row + placements + skus + hops (from v_coffee_hop)
```

The four `GET`s exist so brief 4 has something to read; they are view-only selects. Roastery endpoints `POST /roasters/:id/deactivate|reactivate` and `GET /roasters/:id/deactivation-preview` keep their paths (AdminRoasters.tsx uses them) but become thin wrappers over the service.

Retired (replace the handler body with `res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' })`, keep the route registered so api_event still records attempts): `POST /coffees`, `PATCH /coffees/:id`, `DELETE /coffees/:id`, `POST /coffees/:id/archetype`, `POST /coffee-alias`, `PATCH /coffee-alias/slot`, `PATCH /coffee-alias/:id`, `PATCH /slot-prices`, `PATCH /dial/vocabulary/:id`, `POST /dial/positions`, `PATCH /dial/positions/:id`, `DELETE /dial/positions/:id`, `POST /dial/positions/guest`, `DELETE /dial/positions/guest/:id`, `POST /dial/relationships`, `DELETE /dial/relationships/:id`, `PATCH /inventory/:id`, `POST /inventory/:id/restock`. Delete the now-dead helper code they used (the swap logic, the `computeInventoryStatus` copy once moved). Leave every `GET` in admin.ts alone (brief 3/4). Leave `/coffees/:id/story`, `/refresh-summary`, `/refresh-content`, categories CRUD (`/categories*`), `/coffee-categories*` and cupping `/sessions/*` endpoints alone: story, categories-as-reference-data and cupping are not placement writes. (`/coffee-categories` POST/DELETE do write `coffee_category_assignment`; move those two onto `updateCoffee({ categoryCodes })` semantics via the service but keep their paths, since AdminCoffees uses them for tagging and tagging is not being redesigned.)

Also in this brief: `services/dialSuggestion.ts` `recordCuppingSignal()` moves onto `withTransaction` (the last pool-level BEGIN in the codebase after the retired handlers are gone). Grep `db.query('BEGIN')` across `backend/src` must return zero hits when you are done.

## Part D — Seeds and the boot-time seed

- Move `db/seeds/dial_positions_base.sql`, `dial_positions_path_tcr.sql`, `dial_seam_positions.sql`, `coffee_alias_path_tcr.sql`, `dial_relationships_base.sql`, `archetype_assignments_base.sql`, `archetype_assignments_path_tcr.sql`, `coffees_path_tcr.sql`, `roaster_blend_both.sql` into `db/seeds/_retired/` with a `README.md` stating they are history (the 2026-06/08 Path + Temecula catalog), must never be run again, and that catalog data enters through `catalogImport` only. Reference-data seeds (`cupping_notes_sca_wheel.sql`, `sensory_lexicon_attributes_wcr.sql`, `archetype_vectors.sql`, `scoring_v1.sql`, session/descriptor seeds) stay where they are.
- Remove the boot-time Kopi Safari `dial_archetype_positions` seed block from `schema.sql` (~L1972). It writes a legacy table by free-text name match on every boot. Mirror the removal in the migration file convention (a migration that does nothing is not needed; a comment in schema.sql where the block was suffices).
- Write `backend/src/features/catalog_blueprint/manifests/EXAMPLE_manifest.json`: two fictional coffees on a fictional roastery, one with an out-of-spec placement carrying a note, exercising every field. It is documentation and the fixture for Part E; it is not run against prod.

## Part E — Tests (vitest, DB-backed, `Vitest` fixture prefix, cleanup in `finally` + `afterAll` in dependency order)

`services/catalogService.test.ts`:
- `createCoffee` sets `roaster_id` and the text `roaster`; inactive roaster → `ROASTER_NOT_FOUND`/409; duplicate name same roaster → 409.
- `placeCoffee(home)` then a second `placeCoffee(home)` on another slot → `HOME_EXISTS`; `moveCoffee` succeeds and the old row is inactive with `deactivation_reason='moved'` and the same coffee now has exactly one active home.
- `placeCoffee(guest)` on the home's slot → `ALREADY_ASSIGNED`; on another slot → ok; `v_coffee_sellable_slot` resolves the guest when the home occupant is retired (D5).
- Priority: two coffees on one slot, `setPriority` reorders them without a unique violation; a `placeCoffee` with a taken priority → `PRIORITY_TAKEN`.
- D6: set a spec band on a fixture slot, give the fixture coffee merged cupping scores outside it (insert a `cupping_sessions` + `cupping_session_coffees` + `cupping_scores(is_merged=true)` + `cupping_score_values` fixture) → `placeCoffee` without note throws `NOTE_REQUIRED`; with note saves and `placement_note` is stored and warnings contain `band_out_of_spec`; inside the band → no note required. Descriptor family: coffee with three roastery descriptors in 'Nutty / Cocoa' placed on a floral slot → `descriptor_off_family`.
- `setMatchArchetype` supersedes correctly (exactly one current row) and returns `placement_diverges_from_match` when the home is elsewhere.
- `retireCoffee` cascades assignments and SKUs; `restoreCoffee` restores coffee + SKUs but not assignments.
- `deactivateRoastery` cascades `coffee_slot_assignment`; `reactivateRoastery` does not restore it.
- `setHop` writes `hop_type` matching `v_coffee_hop.hop_type_derived` when both homes exist.
- Atomicity: force a failure after the assignment insert inside `placeCoffee` (e.g. an invalid `certify.by` type check placed after the insert) and assert nothing was written.

`services/catalogImport.test.ts`: `EXAMPLE_manifest.json` against a `Vitest` roaster: dry run writes nothing (row counts unchanged) and reports two coffees with the expected warnings; apply writes everything and the unscoped integrity report is `allPass`; a second apply reports `COFFEE_EXISTS` for both and writes nothing; `skip_existing` mode reports skipped.

`routes/admin.catalog.test.ts` (supertest is not in the repo; follow whatever pattern `admin.roasters.test.ts` uses): a retired endpoint returns 410; `POST /catalog/coffees` without `roasterId` returns 400 `INVALID_INPUT`.

## Part F — Docs

- `WHAT_WE_BUILT.md`: build-log entry "Catalog Blueprint · brief 2 — catalogService, thin routes, import": the verb list, the guardrail order, the retired endpoints (and that the admin pages' placement buttons return 410 until brief 4), the importer usage, and that `db.query('BEGIN')` no longer exists in the codebase.
- `WHAT_WE_BUILT_DB.md` "Catalog ownership table": replace every "brief 2: catalogService.<fn>" placeholder with the real function name; add a row for `coffee_category_assignment` (writer `updateCoffee`), `dial_position_signal` (writer `recordCuppingSignal`, unchanged), and note the legacy `coffee_alias` cascade exception.
- `backend/.env.example`: `CATALOG_SPEC_HARD_GATE=false` with a one-line comment.
- This folder's `README.md`: brief 2 → EXECUTED with the commit hash; brief 3 row gains the note "CI grep infra does not exist yet — brief 3 creates `npm run lint:catalog` and the deploy.yml step".

## Don'ts (scope fence)

- No reader changes: `blendResolver.ts`, `sommelierRag.ts`, `routes/coffees.ts`, `routes/axis.ts`, dial graph/positions/navigation GETs, `qrDoor`, `brewCard`, `beatEngine`, cron. Brief 3.
- No frontend changes at all. Brief 4.
- No schema changes beyond removing the Kopi Safari seed block. No table drops, no renames, no NOT NULLs. Brief 5.
- No `archetype`-table label changes (a separate thread owns the "Balanced" rename).
- Do not write to legacy placement tables from the service except the documented `coffee_alias` cascade exception.
- No new npm dependencies except what tests strictly need (prefer none).

## Definition of done

- `npm run build` clean; `npm test`: all new tests green; the pre-existing 18 failures (blendResolver / sommelierRag / quizScoring, empty-catalog related) unchanged and listed in the report, nothing new failing.
- `grep -rn "db.query('BEGIN')" backend/src` → 0 hits. `grep -rnE "(INSERT INTO|UPDATE|DELETE FROM) (coffees|archetype_assignments|coffee_slot_assignment|coffee_dial_slot|dial_slot_price|roaster_blend|dial_coffee_relationships|coffee_category_assignment)\b" backend/src/routes backend/src/services --include=*.ts | grep -v catalogService.ts | grep -v test` → 0 hits (except `orders.ts`'s stock decrement on `roaster_blend`, which is a commerce write and stays; list it in the report).
- Dry-run of `EXAMPLE_manifest.json` against prod via the CLI produces a report with no errors (it must NOT be applied to prod: the roaster in the manifest does not exist there, so the validator should stop it with `ROASTER_NOT_FOUND`; that stop is the expected result and proves the guard).
- Boot log: `[catalog-integrity]` clean except check 13.
- Closing report: Task 0 deviations, the final verb list with any signature changes you had to make and why, the list of retired endpoints, the `db.query('BEGIN')` grep result, the two DML greps, and the prod dry-run output.
