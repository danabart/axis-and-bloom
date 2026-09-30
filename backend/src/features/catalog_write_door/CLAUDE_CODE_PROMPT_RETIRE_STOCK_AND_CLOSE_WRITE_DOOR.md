# Claude Code brief: retire stock tracking + close the last catalog write-door gaps

Written 2026-09-30 by the CTO session, after reviewing bf5cc8e (Catalog Sizes + Visibility, WHAT_WE_BUILT #201). Feature/fix brief: push-is-deploy applies.

## Why

1. **We don't hold inventory.** Every roaster ships orders directly. `coffee_sku.quantity_available`, `safety_stock_buffer` and `inventory_status` are numbers we invent: the admin asks for a quantity, shows "out of stock" (Flying Jewel shows 0 / out_of_stock while being perfectly orderable), offers a Restock button, sorts the Blends & SKUs page by fake stock, and `routes/orders.ts` decrements the number after every order. Nothing customer-facing reads it (`blendResolver` deliberately never checks quantity). A misleading "out of stock" is worse than none. The real availability lever already exists: the SKU's `is_active` switch, which feeds `v_coffee_sellable_candidate` and the Visible column.
2. **Two catalog tables are still written outside `catalogService.ts`**, and the lint doesn't watch either: `coffee_retail_price` (inline `PATCH /api/admin/coffee-prices`; the 2026-09-27 brief wrongly named a `setCoffeeRetailPrice` verb that never existed) and `coffee_category` (inline POST / PATCH / DELETE `/api/admin/categories`). `routes/coffees.ts` also reads `coffee_retail_price` with inline SQL (`/other-categories`). The category DELETE is risky: `coffee_category_assignment` cascades, so deleting "Decaf" would silently untag every decaf coffee and put it on the dial.

## Decisions already made (Dana, 2026-09-30)

- **R1 Retire stock tracking.** No quantity, buffer, stock status or restock anywhere in the admin or the order path. The SKU switch is the one availability lever, labelled **Available from roaster / Paused**. DB columns stay untouched (no drop, no data change), marked deprecated; a later cleanup may drop them.
- **R2 One brief** for both the stock retirement and the write-door gaps.
- Not re-opened: the 2026-09-27 decisions S1–S4, D5, D2, and all catalog guardrails.
- A roaster-reported status (Available / Temporarily out / Discontinued) is a possible later step, not this brief.

## Catalog guardrails (unchanged, non-negotiable)

One write door (`catalogService.ts`, `withTransaction`, `logCatalogChange`, returns `{ result, warnings, integrity }`); one read path (views + `catalogReads.ts` helpers, no inline catalog SQL in route files); constraints not comments; integrity green; lint grows with the rules; `coffee_` naming; test DB only; no prod data writes; never delete raw data. If a step would break one, STOP and report.

## Task 0 (read-only, report in the closing report)

1. Every reader and writer of `quantity_available`, `safety_stock_buffer`, `inventory_status`, `last_restocked_at`, `inventory_last_synced_at` across backend, frontend, tests, `catalogImport.ts` manifests and docs. Known: `routes/orders.ts` (~L236–253 decrement), `catalogService.ts` (`upsertSkuInTx` qty/buffer/status, `restockSku`, `computeInventoryStatus`), `routes/admin.ts` (PATCH sku body, `POST /catalog/skus/:blendId/restock`), `AdminInventory.tsx` (Qty / Buffer, Status, Restock, stock sort, edit form), `AdminCatalog.tsx` (`ManageSkusModal` Qty + status + quantity input), `admin.catalog.test.ts`.
2. Every writer and reader of `coffee_retail_price` and `coffee_category` outside `catalogService.ts` / `catalogReads.ts`. Known: `admin.ts` GET/PATCH `/coffee-prices`, POST/PATCH/DELETE `/categories`, GET `/categories`; `coffees.ts` `/other-categories`.
3. Whole-frontend caller grep for every endpoint whose body or response changes (lesson from 49c6671).

## Part A: retire stock tracking

- `routes/orders.ts`: delete the post-order decrement loop. Remove its `RULE2_ALLOWLIST` entry in `lint-catalog.mjs`, so `coffee_sku` becomes fully protected by the write door.
- `catalogService.ts`: `upsertSkuInTx` / `upsertSku` no longer accept or write `quantityAvailable` / `safetyStockBuffer` / `inventory_status`; new rows take the column defaults. Delete `restockSku` and `computeInventoryStatus`.
- `routes/admin.ts`: `POST /api/admin/catalog/skus/:blendId/restock` → 410 `RETIRED` (same pattern as the other retired paths). The SKU PATCH/POST rejects `quantityAvailable` / `safetyStockBuffer` with 400 `FIELD_RETIRED` (the frontend stops sending them in the same commit).
- `schema.sql`: `COMMENT ON COLUMN` for the five columns: `DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.` Idempotent. No DROP, no UPDATE of existing values.
- Lint: add the five column names to a new **rule 6, deprecated stock columns**: any reference in `backend/src/routes|services/**/*.ts` fails (test files excluded). This is how "not read or written" is enforced rather than just commented.
- Admin UI:
  - `AdminInventory.tsx` (Blends & SKUs): remove Qty / Buffer, Status, Restock and the stock-based sort (sort by coffee name, then size order). The status cell becomes the switch **Available from roaster** / **Paused** (existing `is_active` toggle). Edit form drops quantity and buffer. Page intro text: say that availability is the roaster's, controlled by this switch.
  - `AdminCatalog.tsx` `ManageSkusModal` and the Place-a-coffee SKU step: no quantity input, no Qty column; status shows Available from roaster / Paused.
  - Visible column: when the reason is `no_active_sku` and the coffee has a paused SKU at that size, show **SKU paused** instead of "no SKU" (presentation only, derived from `coffee.skus` already in the payload; the link still opens Manage SKUs at that size).

## Part B: close the write-door gaps

- New verbs in `catalogService.ts`, each in `withTransaction`, logged, returning the standard result, size-checked where relevant: `setCoffeeRetailPrice({ coffeeId, weightOz, retailPriceCents })` (uses the existing `assertKnownSize`, then the upsert moved from `admin.ts`), `createCategory`, `updateCategory` (label, is_active), `deleteCategory`.
- `deleteCategory` hard-blocks with `CatalogError(409, 'CATEGORY_IN_USE')` when any `coffee_category_assignment` row exists for it (preview count in the message); only an unused category can be deleted. Deactivating (`is_active=false`) stays available. No cascade ever runs from the app.
- Reads: `catalogReads.getCoffeeRetailPrices({ includeInactive })` and `getCategories()`; `admin.ts` GET `/coffee-prices`, GET `/categories` and `coffees.ts` `/other-categories` call them. No inline SQL on these tables in route files.
- Routes become thin wrappers with `handleCatalogError`. Response shapes unchanged.
- `lint-catalog.mjs` `DML_TABLES` += `coffee_retail_price`, `coffee_category`.
- Stale comment in `admin.ts` above GET `/coffee-prices` ("$32.00/12oz, $185.00/5lb defaults") contradicts `coffees.ts` (unset prices are omitted, not defaulted); fix the comment to match the code.
- Admin UI: the category Remove button shows the `CATEGORY_IN_USE` message and suggests deactivating.

## Tests (test DB only)

Order placement no longer changes `coffee_sku` (row unchanged before/after); restock endpoint 410; SKU upsert with `quantityAvailable` → 400; lint rule 6 flags a planted reference; `setCoffeeRetailPrice` at 48 oz → `UNKNOWN_SIZE`, at 12 oz logs a change row; `deleteCategory` on an assigned category → 409 and assignments intact; on an unused one → deleted; `/other-categories` output unchanged for a fixture coffee.

## Don'ts

No DROP COLUMN, no UPDATE of existing stock values, no prod data writes. Don't touch the Stripe brief (the CTO already struck its "inventory decrement" step). Don't add a roaster-status feature.

## Docs

`WHAT_WE_BUILT.md` new entry; `WHAT_WE_BUILT_DB.md` (deprecated columns, new owners for `coffee_retail_price` and `coffee_category`); `catalog_blueprint/README.md` one-line pointer.

## Definition of done (one go, one closing report)

Stage only this brief's files → commit → push to `main` → deploy green → startup log clean (integrity green) → `npm run lint:catalog` clean with rules 5 and 6 → prod smoke, read-only: Blends & SKUs shows no quantity, stock status or Restock, and Flying Jewel's 12 oz SKU shows **Available from roaster**; `POST …/restock` returns 410; GET `/api/admin/coffee-prices` and `/api/coffees/other-categories` return the same data as before → one closing report (commits, Task 0 findings, tests, smoke, anything deferred).
