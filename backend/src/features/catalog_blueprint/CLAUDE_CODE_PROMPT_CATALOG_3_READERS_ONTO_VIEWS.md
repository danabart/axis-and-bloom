# Claude Code Prompt — Catalog Blueprint, Brief 3: every reader onto the views

**Series:** Catalog Blueprint (`README.md` in this folder). Brief 3 of 5. Depends on brief 2 (`97c87a9`, deployed). Brief 4 (admin UI + admin GETs) and brief 5 (drop legacy) follow.

**Goal:** After this brief, no customer-facing or service code derives a slot, a coffee's archetype, or an archetype's label from base tables. Every read goes through `v_coffee_archetype`, `v_coffee`, `v_coffee_slot`, `v_coffee_sellable_slot`, `v_coffee_hop` (plus one new candidate view). The Bloom page, checkout, Liam, the Axis page, hops, QR door, brew cards, beats and cron all answer from the same rows, so the floral-versus-fruity disagreement becomes structurally impossible. A lint script enforces it in CI. **Public API response shapes do not change**: the frontend is untouched in this brief.

**Why this needs a build:** the four "which slot is this coffee in" formulas (A: admin list / Liam names, B: `blendResolver`, C: hops / legacy-slot, D: dial graph) are still live code, all reading `dial_archetype_positions` + `coffee_alias` + `archetype_assignments`, which the service no longer writes. Right now the service writes the new tables and the site reads the old ones; nothing placed through `catalogService` is visible anywhere. This brief closes that gap. It is the one visible-behaviour change of the series, so it gets the one careful review.

**Decisions already made (don't re-open):**
- D1: readers name which archetype they want. `match_archetype` (from `v_coffee`) for reasoning: Liam's "your family", quiz, Axis stats, beats, brew card copy. `placement_archetype` / slot (from `v_coffee_slot` / `v_coffee_sellable_slot`) for anything that shows or sells a dial position. Never `COALESCE` the two.
- D2: Liam's recommendation candidates come only from `v_coffee_sellable_slot` at 12 oz. Conversation about a coffee the customer owns (my_coffee, brew card, QR, SMS) keeps unrestricted naming via `v_coffee`.
- D3: hop type is `v_coffee_hop.hop_type_derived`; the stored column is never read again.
- D5: `v_coffee_sellable_slot` already ranks home first, then guests by priority. The resolver adopts that rule (today it is guest-blind).
- Landing default is a slot property (`coffee_dial_slot.is_landing_default`), no longer a per-coffee flag. Public responses keep the field name `isDefault` on the slot object with the new meaning.
- Naming: new views start with `v_coffee_`. Frontend label maps stay as they are (a separate thread owns the "Balanced" rename; brief 4 may fetch labels from `/api/coffees/archetypes`).
- Admin GET endpoints (`/api/admin/coffee-alias`, `/dial/graph`, `/dial/positions`, `/dial/navigation`, `/dial/hop-suggestions`, `/dial/vocabulary`, `/dial/slot-aliases`, `/slot-prices`, `/coffees`, `/inventory*`, `/archetypes`, `/dial/consensus/:id`) are **not** in this brief; brief 4 replaces them together with the pages that call them. They go on the lint allow-list with a brief-4 expiry.

## Task 0 — Verify current state (confirm, don't assume)

Line numbers as of `97c87a9`. Stop and report if any differ materially.

- `git log -1` is `97c87a9` or a descendant; `origin/main` contains it; deploy green.
- `services/catalogService.ts` exports `placeCoffee`, `createCoffee`, `setMatchArchetype`, `upsertSku`, `setSlotPrice`, `setHop` (needed for test fixtures) and `buildDeactivationPreview` (already reads `v_coffee_sellable_slot`).
- `db.query('BEGIN')` → 0 hits. Catalog DML outside the service: only story/AI-summary column updates on `coffees` (admin.ts L1161; coffees.ts L45, L397, L502), `orders.ts` L196 stock decrement, `qrDoor.ts` L61 `qr_token`. These stay.
- Legacy-table readers outside admin.ts and the catalog files: `routes/coffees.ts` (34 refs: `/archetypes` L693, `/experimental` L791, `/archetype-order` L867, `/other-categories` L925, `/archetype-stats` L999, `/:id/legacy-slot` L1040, `/:coffeeId/hops` L1074, `/:id/story` L1278, helpers L60–110 and `buildSlotsForArchetype` L526) · `routes/axis.ts` (8 refs; `/vectors` L9, `/adjacency` L53, `/stats` L111) · `services/blendResolver.ts` (8) · `services/sommelierRag.ts` (20: `toEnum` L25, `getDescriptors` L53, `getAliases` L85, `FALLBACK_ADJACENCY` L147, `getAdjacentArchetypes` L163, `fetchCoffeesByArchetypes` L190, `fetchSommelierCoffees` L224) · `services/dialSuggestion.ts` (5: vocabulary count L29, `dial_archetype_config` L173/L246, vocabulary L199) · `services/dialPositionSignal.ts` L28 · `routes/sommelier.ts` L146 · `routes/users.ts` L583, L761 · `routes/cron.ts` L293 · `routes/orders.ts` L354 · `services/beatEngine.ts` L149 · `services/brewCard.ts` L167 · `services/qrDoor.ts` L274 · `services/behavioralConfidence.ts` L70 (`roaster_blend.archetype_id`, a column nobody writes).
- Hand-typed archetype label/key maps in the backend: `routes/coffees.ts` L53 `ARCHETYPE_LABEL` · `routes/axis.ts` L96 · `routes/users.ts` L33 and L38 `ARCHETYPE_NAME_TO_KEY` · `routes/sommelier.ts` L86 `ARCHETYPE_NAME_TO_KEY` · `services/dialSuggestion.ts` L3 `ARCHETYPE_LABEL` · `services/sommelierRag.ts` L25 `toEnum` and L147 `FALLBACK_ADJACENCY` (keyed on display names) · `routes/admin.ts` L53 and L1211 CASE expressions (admin, brief 4).
- Legacy views still defined in `schema.sql`: `v_dial_positions` (0 TS readers), `v_archetype_adjacency` (readers: `sommelierRag.getAdjacentArchetypes`, admin `/dial/archetype-adjacency`), `v_dial_navigation` (0 TS readers), `v_dial_position_consensus` (reader: admin `/dial/consensus/:coffeeId`, built on `dial_position_signal`, not on placement — leave it).
- `dial_position_signal.suggested_vocabulary_id` (schema.sql L1722) references `dial_position_vocabulary`; `dialSuggestion.recordCuppingSignal` writes it. That column is re-keyed in brief 5; until then `dialSuggestion.ts` may read `dial_position_vocabulary` for the id mapping only (allow-listed).
- Liam session snapshot: `routes/sommelier.ts` stores `catalogText` and `storyCandidates` in `sommelier_sessions.context_data` at session start (L614–628) and reuses them on later turns.
- Public response contract consumers: `frontend/src/app/components/bloom/*` (`/api/coffees/archetypes`, `/experimental`, `/archetype-order`, `/other-categories`), `coffee-info/*` (`/:id/hops`, `/:id/legacy-slot`, `/:id/story`, `/:id/content`), `axis/*` (`/api/axis/*`). Read each consumer once to list the fields it uses before touching the endpoint; the field list goes in the closing report.
- `.github/workflows/deploy.yml` has no lint step. `backend/package.json` scripts: `dev`, `build`, `start`, `db:migrate`, `test`, `catalog:import`.

## Part A — One new view and one redefined view (`schema.sql`, mirrored into `migrations/catalog_blueprint_3_<date>.sql`)

- **`v_coffee_sellable_candidate`** — the pre-`DISTINCT ON` candidate list that `v_coffee_sellable_slot` picks from, exposed so the resolver can report `skipped` and honour `excludeCoffeeIds`: one row per (active slot, active assignment, active coffee, weight in `BLOOM_WEIGHTS_OZ`), with `blend_id` **nullable** (LEFT JOIN on active `roaster_blend` at that weight), `retail_price_cents` nullable, `rank` = row_number over (slot_id, weight_oz) ordered home-first then priority, and `is_sellable` = blend and price both present. Category exclusions apply here. Then redefine `v_coffee_sellable_slot` as `SELECT … FROM v_coffee_sellable_candidate WHERE is_sellable` with `DISTINCT ON (slot_id, weight_oz) ORDER BY slot_id, weight_oz, rank` — **same output columns as today** (brief 1 tests must still pass unchanged).
- **`v_archetype_adjacency`** redefined on `v_coffee_hop` (`hop_type_derived = 'bridge_archetype'`, both coffees active, both archetypes `is_archetype` via `v_coffee_archetype`) with the same output columns. Add a comment that it is kept under its old name until brief 5 renames it `v_coffee_archetype_adjacency`.
- Drop nothing. `v_dial_positions` and `v_dial_navigation` have no TS readers; brief 5 drops them.

## Part B — `backend/src/services/catalogReads.ts` (the only place base-table names for the catalog may appear outside the service)

Small typed helpers over the views, so readers do not each re-type the same SELECT:

```ts
getArchetypes(): Promise<ArchetypeRow[]>                // SELECT * FROM v_coffee_archetype ORDER BY sort_order; cached in-process for 60 s (labels change once a quarter, not per request)
archetypeLabel(code): Promise<string>                   // from the cache; unknown code → the code itself (never throw in a read path)
archetypeCode(labelOrCode): Promise<ArchetypeCode|null> // case-insensitive on label, passthrough on code; replaces toEnum / ARCHETYPE_NAME_TO_KEY
getCoffee(coffeeId): Promise<CoffeeRow|null>            // v_coffee
getCoffees(filter: { active?: boolean; matchArchetype?; ids?: number[] })
getHomeSlot(coffeeId): Promise<CoffeeSlotRow|null>      // v_coffee_slot role='home' active
getSlotsForCoffee(coffeeId)                              // all active assignments
getSellableSlots(filter: { archetype?; weightOz?; slotId? }) // v_coffee_sellable_slot
getSellableCandidates(slotId, weightOz)                  // v_coffee_sellable_candidate ordered by rank
getSlots(archetype?)                                     // coffee_dial_slot rows (+ position label, landing default)
getHops(filter: { coffeeId?; fromCoffeeId?; direction?; recommendedOnly? }) // v_coffee_hop
getCatalogVersion(): Promise<string>                     // GREATEST(max(updated_at)) across coffee_slot_assignment, coffee_dial_slot, coffees, roaster_blend, dial_slot_price, as ISO string — the Liam snapshot key
```

Every function takes an optional `runner: Tx | typeof db` last, defaulting to `db`, so the service can reuse them inside transactions later. No business logic here: filters and shapes only.

## Part C — Reader migrations (file by file; response shapes preserved unless stated)

**`services/blendResolver.ts`** — `resolveBlendForSlot(archetype, sortOrder, weightOz, { excludeCoffeeIds })` keeps its signature and `ResolvedBlend` shape. Body: resolve `slotId` from `(archetype, sortOrder)` via `getSlots`, read `getSellableCandidates(slotId, weightOz)`, drop excluded ids, `skipped` = candidates before the winner that have no `blend_id` (reason `'no active blend at that weight'`, as today) or no price (new reason `'no price at that weight'`), winner = first `is_sellable`. Guests now resolve (D5). `computeCollectionOffer` reads `getSellableSlots({ archetype, weightOz })` per weight. Delete the inline category-exclusion SQL; the view owns it.

**`routes/coffees.ts`** — the public Bloom API. Same JSON shapes, new sources:
- `/archetypes`: archetype list + dimension labels from `v_coffee_archetype` (`is_archetype = true`, ordered by `sort_order`); slots from `getSlots` (`positionLabel`, `description`, `platformName` = slot `name`, `isDefault` = `is_landing_default`); `isActive`/`coffeeId`/`prices` from `getSellableSlots({ archetype })` grouped by slot; `archetypeLabel` from `archetypeLabel()`. `buildSlotsForArchetype` and its two-formula lookup are deleted. `computeDoorMap()` (qrDoor) keeps its contract.
- `/experimental`, `/archetype-order`, `/other-categories`, `/archetype-stats`: read `v_coffee` (`match_archetype`, `category_codes`, `is_active`) and `v_coffee_sellable_slot`; whatever today derives "which coffees are on the experimental dial" from `dial_archetype_positions` now means "active assignments on slots with `archetype = 'experimental'`" via `v_coffee_slot`.
- `/:id/legacy-slot` and `/:coffeeId/hops`: slot = `getHomeSlot(id)`; hops = `getHops({ coffeeId })`, `hop_type` in the response = `hop_type_derived`, target coffee's slot from its home row. If the coffee has no active home, `legacy-slot` returns the same "no slot" shape it returns today.
- `/:id/story`, `/:id/content`, `/:id/flavor-wheel`, `/:id/dimensions`: coffee state and archetype from `getCoffee` (`match_archetype`); these are owned-coffee surfaces (D2 exception).
- Helpers at L60–110 (whatever composes archetype + position for a coffee) are replaced by `getHomeSlot` / `getCoffee`.
- `ARCHETYPE_LABEL` constant deleted; `CANONICAL_ARCHETYPE_ORDER` / `DEFAULT_ARCHETYPE_ORDER` replaced by `v_coffee_archetype.sort_order` (the values were seeded to match in brief 1).

**`services/sommelierRag.ts`** —
- `toEnum` → `archetypeCode()`; `FALLBACK_ADJACENCY` re-keyed on codes and consulted only when `v_archetype_adjacency` is empty (as today).
- `getAliases(coffeeIds)`: name = home slot name from `v_coffee_slot`; fallback to any active guest slot name; else the coffee's name. No `coffee_alias`, no `DISTINCT ON` over three tables.
- `fetchSommelierCoffees`: candidate pool for every `ragFocus` is `DISTINCT coffee_id FROM v_coffee_sellable_slot WHERE weight_oz = 12` (D2), joined to `v_coffee` for name / summary / `match_archetype`, then the existing per-archetype-limit logic applies on `match_archetype` (reasoning) while the alias text names the slot (placement). `alternatives`: `getHops({ fromCoffeeId IN excludeCoffeeIds, direction: 'less', recommendedOnly: true })`, targets filtered to sellable. `getDescriptors` unchanged (cupping tables, not placement).
- `buildCatalogText`: unchanged shape; `archetypeLabel()` for labels.

**`routes/sommelier.ts`** — session start stores `catalogVersion: await getCatalogVersion()` in `context_data` next to `catalogText`. On every later turn that reads `catalogText` from `context_data`, compare `getCatalogVersion()` with the stored one; if different, rebuild `catalogText` (and `storyCandidates`) via the same functions used at session start, write both back to `context_data`, and log `[sommelier] catalog snapshot refreshed`. L146 (`archetype_assignments`) → `getCoffee().match_archetype`; `ARCHETYPE_NAME_TO_KEY` → `archetypeCode()`.

**`routes/axis.ts`** — `/adjacency` on the redefined `v_archetype_adjacency`; `/stats` and `/vectors` archetype counts on `v_coffee.match_archetype` for active coffees (the Axis page reasons about match, D1); hop counts on `v_coffee_hop` with both coffees active. L96 label map → `archetypeLabel()`. `ACTIVE_COFFEE_SQL` may stay for the `coffees` joins that are not about placement.

**`routes/users.ts`** (L583, L761), **`routes/cron.ts`** (L293), **`routes/orders.ts`** (L354), **`services/beatEngine.ts`** (L149), **`services/brewCard.ts`** (L167), **`services/qrDoor.ts`** (L274), **`services/dialPositionSignal.ts`** (L28): each `archetype_assignments` read → `getCoffee(id).match_archetype`; each `dial_archetype_config` read → `getArchetypes()` (`dominant_dimension_id`). `users.ts` L33 archetype copy table (name/color/features) keeps its copy but is keyed by code and takes `name` from `archetypeLabel()`; `ARCHETYPE_NAME_TO_KEY` → `archetypeCode()`.

**`services/dialSuggestion.ts`** — labels via `archetypeLabel()`; `dial_archetype_config` → `getArchetypes()`; slot count/labels from `getSlots(archetype)`; the **only** remaining legacy read is the `(archetype, sort_order) → dial_position_vocabulary.id` mapping needed to write `dial_position_signal.suggested_vocabulary_id` (allow-listed, brief 5 re-keys that column to `slot_id`). `getDialSuggestion` returns the same shape plus `suggested_slot_id`.

**`services/behavioralConfidence.ts`** L70 — archetype from `v_coffee.match_archetype` via `roaster_blend.coffee_id`; `rb.archetype_id` is never read again.

**`index.ts`** — no change expected; confirm no legacy reads in the boot checks.

## Part D — Lint: `npm run lint:catalog` + CI step

`backend/scripts/lint-catalog.mjs` (node, no deps): greps `backend/src/**/*.ts` (excluding `*.test.ts`, `db/seeds/_retired/**`, `db/migrations/**`) and fails with file:line for:

1. `db.query('BEGIN')` anywhere.
2. DML (`INSERT INTO|UPDATE|DELETE FROM`) on `coffee_slot_assignment|coffee_dial_slot|archetype_assignments|dial_slot_price|dial_coffee_relationships|coffee_category_assignment|roaster_blend|archetype` outside `services/catalogService.ts`, and `INSERT INTO coffees|DELETE FROM coffees` outside it. Allow-list (explicit file + pattern list at the top of the script, each with an expiry note): `routes/orders.ts` `UPDATE roaster_blend` (commerce stock, permanent); `UPDATE coffees SET (story|story_draft|story_published|story_admin_edited|story_generated_at|ai_summary|surprise_note|three_voice_story|qr_token)` in `routes/admin.ts`, `routes/coffees.ts`, `services/qrDoor.ts` (content columns, permanent).
3. Any reference to `dial_archetype_positions|coffee_alias|dial_slot_alias|dial_position_vocabulary|dial_archetype_config|v_dial_positions|v_dial_navigation` outside the allow-list: `routes/admin.ts` (expires brief 4), `services/dialSuggestion.ts` vocabulary mapping only (expires brief 5), `services/catalogService.ts` roastery `coffee_alias` cascade (expires brief 5), `services/catalogIntegrity.ts` check 13 (expires brief 5), `db/schema.sql`.
4. `'Chocolate & Nutty'|'Balanced & Sweet'|'Fruity'|'Earthy'|'Floral'|'Experimental'` as string literals in `routes/` and `services/` outside `routes/admin.ts` (expires brief 4) and test files. (Labels come from `v_coffee_archetype`.)

Add `"lint:catalog": "node scripts/lint-catalog.mjs"` to `package.json` and run it in `.github/workflows/deploy.yml` right before `npm run build` for the backend, so a violation fails the deploy. Also call it from `npm test` via a tiny vitest that spawns the script (so local `npm test` catches it too).

## Part E — Tests

- **Rewrite** `services/blendResolver.test.ts` and `services/sommelierRag.test.ts` against fixtures built through `catalogService` (`createCoffee` → `setMatchArchetype` → `upsertSku` → `placeCoffee` → `setSlotPrice`), `Vitest` prefix, cleanup in dependency order. This also retires the pre-existing empty-catalog failures in those two files; list any remaining pre-existing failures (quizScoring) in the report, untouched.
- `services/catalogReads.test.ts`: `archetypeCode('Chocolate & Nutty') === 'chocolate_nutty'`, `archetypeCode('chocolate_nutty')` passthrough, unknown → null; `getCatalogVersion()` changes after a `placeCoffee`.
- `routes/coffees.contract.test.ts` (spin up express like `admin.roasters.test.ts`): with a fixture coffee placed as home on `floral/2` with a 12 oz SKU and price, `GET /api/coffees/archetypes` returns 5 archetypes ordered `floral, fruity, balanced_sweet, chocolate_nutty, earthy`, each with 4 slots carrying exactly the keys `dialSortOrder, positionLabel, description, isActive, platformName, isDefault, prices, coffeeId`; floral slot 2 is `isActive: true` with the fixture `coffeeId`, `isDefault: true`; every other slot `isActive: false`. Retire the fixture coffee → floral/2 `isActive: false`. Add a guest at priority 2 on the same slot with its own SKU and retire the home coffee → the guest's `coffeeId` (D5). `GET /api/coffees/:id/hops` and `/:id/legacy-slot` return the same keys they return today (read the frontend consumer to list them; assert on that list).
- `routes/sommelier` snapshot refresh: unit-level test of the refresh branch (stored version ≠ current → rebuild called once), mocking the two builders.
- Brief 1 view tests (`schema.catalog_blueprint.test.ts`) must pass unchanged after the `v_coffee_sellable_slot` refactor.

## Part F — Docs

- `WHAT_WE_BUILT.md`: build-log entry "Catalog Blueprint · brief 3 — readers onto views": the reader-by-reader table (file → view), the behaviour changes a customer could notice (guests now fulfil slots; Liam only recommends sellable coffee; landing default is per slot), the lint rules and their allow-list with expiries, and the snapshot-refresh rule for Liam.
- `WHAT_WE_BUILT_DB.md`: add `v_coffee_sellable_candidate`; note `v_archetype_adjacency` is now derived from `v_coffee_hop`; mark `v_dial_positions` / `v_dial_navigation` "no readers, dropped in brief 5".
- This folder's `README.md`: brief 3 → EXECUTED + hash; brief 4 row gains "removes the admin.ts lint allow-list"; brief 5 row gains "re-key `dial_position_signal.suggested_vocabulary_id` → `slot_id`, drop `v_dial_positions`/`v_dial_navigation`, rename `v_archetype_adjacency`".

## Don'ts (scope fence)

- No frontend changes. If a response shape would have to change to use the views, stop and report instead of changing it.
- No `routes/admin.ts` changes except none at all (its legacy reads are allow-listed until brief 4).
- No writes anywhere new; `catalogService.ts` is the only writer and this brief does not add verbs.
- No schema changes beyond Part A (no drops, renames, columns).
- No label text changes (the "Balanced" rename is another thread).

## Definition of done

- `npm run lint:catalog` passes with the allow-list exactly as specified (report the final allow-list).
- `npm run build` clean; `npm test` green except the listed pre-existing quizScoring failures; brief 1 and brief 2 tests unchanged and green.
- Ship in one go: commit `catalog: brief 3 — readers onto views (Catalog Blueprint)`, push, deploy green (lint step visible in the workflow log), startup log `DB schema verified` and `[catalog-integrity]` clean.
- Smoke on prod, in this order: `GET /api/coffees/archetypes` returns 5 archetypes × 4 slots, all `isActive: false`, every slot has `platformName` and `positionLabel`; `GET /api/axis/adjacency` returns 200 with an empty list; the Bloom page renders with empty slots and no console errors; a Liam session starts and answers one message (expect it to say it has no coffees to recommend right now, in its own words); `GET /api/admin/catalog/integrity` `allPass: true`.
- Closing report, once: Task 0 deviations; the reader-by-reader table; the field lists you read from each frontend consumer and confirmed preserved; the final lint allow-list; the behaviour changes; commit hash, deploy URL, startup-log excerpt, smoke results.
