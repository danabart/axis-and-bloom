# Claude Code brief: bag sizes table (12 oz · 2 lb · 5 lb) + "Visible to customers" in admin

Written 2026-09-27 by the CTO session. Feature/fix brief: push-is-deploy applies (see Definition of done).

## Why

1. Dana placed her first real coffee (Flying Jewel, id 2891, Utopian, home fruity/4 "Jammy & Aromatic", active 12 oz SKU) and could not find it on The Bloom or Flavor Intelligence. Cause: slot 10 has no 12 oz price, so `v_coffee_sellable_slot` has no row for it. The Coffees list's "Sellable" column did say "Placed, not sellable: no price", but in grey text that reads like every other cell, so she missed it. The column also has real gaps: it checks only the **home** placement (never guests), only **12 oz**, and never says when a coffee is **outranked** by another coffee in the same slot. Public visibility actually means "wins the slot at any size" (`buildSlotsForArchetype`: `winner12 ?? winner80`).
2. Bag sizes are hardcoded as `12` and `80` in several places. Dana will sell **three** sizes: **12 oz, 2 lb (32 oz), 5 lb (80 oz)** ("everyone sells those three sizes"). Note: 2 lb, not 3 lb.

Live state checked 2026-09-27: exactly one active coffee (Flying Jewel); 32 inactive (Temecula, Path, Zzz Test); no inactive coffee holds an active placement; 20 of 24 slots have no 12 oz price; public `/api/coffees/archetypes` and `/experimental` show zero active slots.

## Decisions already made (Dana, 2026-09-27)

- **S1 Size list lives in a new table `coffee_size`** (catalog naming rule: `coffee_` prefix). Every reader and writer uses it; a 4th size later is one row, no code change. Seed: `12 → "12 oz"`, `32 → "2 lb"`, `80 → "5 lb"`.
- **S2 12 oz stays the anchor size.** Importer still requires a 12 oz SKU. Liam (sommelierRag, D2) still recommends sellable **12 oz** only. Subscriptions stay 12 oz. 2 lb and 5 lb are optional extras. The anchor is a column on `coffee_size` (`is_anchor`, exactly one true), not a literal `12` scattered in code.
- **S3 "Visible to customers" = the coffee wins at least one of its placements (home or guest) at at least one active size.** Same rule the Bloom page already uses, extended to all sizes. Computed in SQL from the same view the public pages read, so admin and customer pages can never disagree.
- **S4 Scope: Coffees-list column + badge on each slot card + fix links.** Each reason links to where it gets fixed.
- Settled earlier and **not re-opened**: D5 (one home per coffee, unlimited guests, guests fulfil slots; home first then priority), D2 (Liam 12 oz sellable only), catalog write door = `catalogService.ts` only, views = only read path, lint + integrity rules.

## Catalog guardrails this brief must keep (non-negotiable)

These are the Catalog Blueprint house rules. Every Part below is written to fit them; if an implementation choice would break one, STOP and report instead of working around it.

1. **One write door.** Every catalog write goes through a named verb in `services/catalogService.ts`, inside `withTransaction`, logged with `logCatalogChange`, returning `{ result, warnings, integrity }`. This brief adds **no new write verb**: the size check is a new hard block inside the existing `upsertSkuInTx`, `setSlotPriceInTx` and `setCoffeeRetailPrice` (so the importer, which calls the same `*InTx` functions, inherits it for free). `coffee_size` rows come only from the idempotent seed in `schema.sql`, the same way `coffee_archetype` was seeded in brief 1. `coffee_size` is added to `lint-catalog.mjs` `DML_TABLES`, so any future TS write to it outside `catalogService.ts` fails lint and CI.
2. **One read path.** Anything derived (who wins a slot, what is sellable, what is visible and why) is a SQL view: `v_coffee_sellable_candidate`, `v_coffee_sellable_slot`, the new `v_coffee_visibility` and `v_coffee_visibility_summary`. Route and page code never recomputes these rules. Every reader goes through a typed helper in `services/catalogReads.ts`: new `getSizes()`, `getAnchorSize()`, `getCoffeeVisibility(coffeeIds?)`, `getSlotVisibility(slotIds?)`, and the rebuilt `getNotSellable()`. `routes/admin.ts` and `routes/coffees.ts` call those helpers; **no inline SQL against these views or `coffee_size` in route files.** The only TS-side logic allowed is presentation (grouping rows, ordering by `size_sort_order`, choosing which coffee id to show on a public card), and it must use the view's columns, not re-derive them.
3. **Constraints, not comments.** Sizes are enforced by FKs to `coffee_size(weight_oz)` (after Task 0 proves the data is clean), the single-anchor partial unique index and the `weight_oz > 0` CHECK. Admin inputs are selects built from `/sizes`, but the database and the service are what actually refuse a bad size.
4. **Integrity is part of done.** New fail-type check 14 (one active anchor; every SKU / slot price / retail price weight exists in `coffee_size`), checks 8 and 9 rewritten on the new views, all green at boot and on `/api/admin/catalog/integrity`.
5. **Lint grows with the rules.** New `lint-catalog.mjs` rule 5, **no bag-size literals**: in `backend/src/routes/` and `backend/src/services/`, flag a numeric literal `12`, `32` or `80` compared to, assigned to or listed as a weight (`weightOz`, `weight_oz`, `*_WEIGHT*`, `*_WEIGHTS*`). Allow-list: `schema.sql` seed (not scanned anyway), `*.test.ts`, and nothing else unless Task 0 finds a real case, which must be named in the report. Same spirit as rule 4 (no archetype label literals). Wire it into the existing vitest wrapper so `npm test` and `deploy.yml` enforce it.
6. **Naming.** Every new object starts with `coffee_` / `v_coffee_` (Dana's 2026-09-13 rule).
7. **Test DB only; no prod writes; never delete raw data.**

## Task 0: verify first (read-only, report findings in the closing report)

1. `grep -rnE "\b(12|80)\b" backend/src frontend/src` filtered to weight/size/oz/lb usage. Known sites (confirm, and find any others): `schema.sql` `v_coffee_sellable_candidate` (`CROSS JOIN (VALUES (12::numeric), (80::numeric))`); `routes/coffees.ts` `BLOOM_WEIGHTS_OZ = [12, 80]`, `buildSlotsForArchetype` (only 12 + 80 queried), `computeCollectionOfferFromSlots` (`=== 12`), `/other-categories`; `services/blendResolver.ts` `COLLECTION_WEIGHTS_OZ`; `services/catalogReads.ts` `NOT_SELLABLE_WEIGHT_OZ` + `getNotSellable`; `services/catalogService.ts` `previewPlacement` (`weight_oz = 12`), `PREVIEW_WEIGHT_OZ`; `services/catalogImport.ts` (12 oz SKU required, keep); `services/catalogIntegrity.ts` checks 8 + 9; `services/sommelierRag.ts` (`weightOz: 12`, keep via anchor); admin `AdminCatalog.tsx` (`SlotCard` price12/price80, `handleSavePrice(12 | 80)`, `sellableSummary`, `NOT_SELLABLE_REASON_SHORT`, `ManageSkusModal` weight input), `AdminInventory.tsx`, `AdminCatalogIntegrity.tsx`; public `bloom/types.ts formatWeight`, `DialArchetypeSection.tsx`, `OtherCategoryCard.tsx`, `usePositionCardData.ts`, `dial/archetypeConfig.ts`.
2. On the **test DB** (and read-only on prod): `SELECT DISTINCT weight_oz` from `coffee_sku`, `coffee_slot_price`, `coffee_retail_price`. Any value not in {12, 32, 80} → STOP and report before adding FKs (do not delete or rewrite rows; see raw-data rule).
3. Whole-frontend caller grep for every admin endpoint whose response shape you change (`/api/admin/catalog/slots`, `/coffees`, `/not-sellable`). Lesson from 49c6671: retiring or reshaping an endpoint needs every caller listed.

## Part A: `coffee_size` table

- `coffee_size (weight_oz NUMERIC PRIMARY KEY, label TEXT NOT NULL, sort_order INT NOT NULL UNIQUE, is_anchor BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true, created_at, updated_at)`; partial unique index so at most one `is_anchor = true`; CHECK `weight_oz > 0`.
- Seed idempotently in `schema.sql` (`INSERT … ON CONFLICT (weight_oz) DO NOTHING`): (12, '12 oz', 1, true), (32, '2 lb', 2, false), (80, '5 lb', 3, false). Schema must apply twice cleanly (globalSetup already does this).
- FKs `coffee_sku.weight_oz`, `coffee_slot_price.weight_oz`, `coffee_retail_price.weight_oz` → `coffee_size(weight_oz)`, added idempotently, only if Task 0 item 2 is clean. `order_line_item.weight_oz` gets **no** FK (it is a purchase-time snapshot).
- Writer: seed only for now. Add `coffee_size` to `lint-catalog.mjs` `DML_TABLES`. No admin UI to edit sizes (out of scope).
- Reader: `catalogReads.getSizes()` (active, by sort_order) and `getAnchorSize()`, cached 60 s like archetype labels. Plain lookup read inside `catalogReads.ts`, same precedent as `getSlots()` on `coffee_dial_slot`; no other file queries `coffee_size`.

## Part B: views

- `v_coffee_sellable_candidate`: replace the `VALUES` cross join with `CROSS JOIN coffee_size sz WHERE sz.is_active`; expose `weight_oz`, `size_label`, `size_sort_order`. `v_coffee_sellable_slot` follows. Keep the column names readers use today. Drop/recreate dependents in the right order, idempotent.
- New `v_coffee_visibility`: one row per **active placement (home and guest) × active size**. Columns: `coffee_id, coffee_name, assignment_id, slot_id, archetype, sort_order, slot_name, role, priority, weight_oz, size_label, size_sort_order, is_anchor_size, is_winner` (this coffee is the `v_coffee_sellable_slot` row for that slot × size), `winner_coffee_id, winner_coffee_name` (null when nobody wins), and boolean reason flags: `slot_inactive_or_unnamed, coffee_inactive, category_excluded, no_active_sku, no_slot_price, outranked` (sellable candidate but another coffee wins). Plus `v_coffee_visibility_summary`: one row per coffee (all coffees, including unplaced): `is_visible` (any `is_winner`), `is_placed`, `visible_slot_count`.
- `getNotSellable()` is rebuilt on `v_coffee_visibility` (keep the endpoint working for the integrity page; extend its reasons with `outranked` and `slot_inactive_or_unnamed`, and with sizes). Integrity check 8 becomes "Placed but not visible to customers (informational)"; check 9 becomes "Visible slots per archetype, per size (informational)".
- New integrity check **14 (fail-type)**: exactly one active anchor size; every `coffee_sku` / `coffee_slot_price` / `coffee_retail_price` weight exists in `coffee_size`.

## Part C: public readers onto `coffee_size`

- `routes/coffees.ts`: delete `BLOOM_WEIGHTS_OZ`; `buildSlotsForArchetype` queries `getSellableSlots` once for the archetype (all sizes) and groups; `prices[]` in size sort order, each `{ weightOz, retailPriceCents, label }`; `isActive` = any size wins; `coffeeId` = anchor-size winner, else the first size by sort order that has a winner. `/other-categories` loops `getSizes()`. `computeCollectionOfferFromSlots` picks the anchor size first, then sort order.
- `blendResolver.ts`: `COLLECTION_WEIGHTS_OZ` → `getSizes()` order (anchor first, then 2 lb, then 5 lb). Order-time resolution must accept 32 oz.
- `sommelierRag.ts`, `catalogImport.ts` (12 oz SKU required), `previewPlacement`: use `getAnchorSize()` instead of literal 12. Behaviour unchanged.
- `catalogService`: `upsertSku`, `setSlotPrice`, `setCoffeeRetailPrice` hard-block a weight not in active `coffee_size` → `CatalogError(400, 'UNKNOWN_SIZE')`. The importer validates the same way in its dry run.
- Frontend public: size buttons already render from `prices[]`; use the API `label` (fallback to `formatWeight`); default selection = the anchor (`12 oz`) when present. Make sure the 2 lb button fits the card at 375 px width. Cart/checkout keys already include `weightOz`; confirm a 32 oz line works end to end through `POST /api/orders` validation (resolver).

## Part D: admin

- All admin reads below go through the `catalogReads.ts` helpers named in guardrail 2 (no inline SQL in `admin.ts`). `GET /api/admin/catalog/sizes`. `GET /api/admin/catalog/coffees` adds `visibility: { isVisible, isPlaced, placements: [{ assignmentId, slotId, archetype, sortOrder, slotName, role, priority, sizes: [{ weightOz, label, isWinner, reasons[], winnerCoffeeName }] }] }` from the two views. `GET /api/admin/catalog/slots` adds per slot `visibility: { sizes: [{ weightOz, label, winnerCoffeeId, winnerCoffeeName }] }` and `prices` for every size; retire `sellable_12oz` / `sellable_12oz_coffee_id` only after the caller grep shows no other reader.
- **Coffees list:** rename the "Sellable" column to **"Visible to customers"**. Top line: a clear badge, green **Visible** or red **Hidden** (unplaced coffees: grey **Not placed** with a Place link; inactive: grey **Retired**). Under it, one line per placement, home and guests: `Fruity · Jammy & Aromatic (home): 12 oz ✗ no slot price · 2 lb ✗ no SKU · 5 lb ✗ no SKU`. Winning sizes show ✓. Readable at a glance, not grey-on-grey.
- **Fix links** (each reason is a link or button):
  - `no_slot_price` → switch to the Slots & pricing tab, scroll to that slot card, focus that size's price input.
  - `no_active_sku` → open Manage SKUs for that coffee with that size preselected.
  - `outranked` → the slot card's priorities list (text: "shown instead: <winner>").
  - `coffee_inactive` → the row's Restore action. `category_excluded` → Edit metadata. `slot_inactive_or_unnamed` → the slot card name field.
- **Slots & pricing:** `SlotCard` renders one price input per active size from `/sizes` (replaces `price12`/`price80`). Each card gets the same badge: **Visible** (with "showing <coffee> at 12 oz · 2 lb") or **Hidden** with the reason per size.
- `ManageSkusModal` and the Place-a-coffee SKU step: size is a select from `/sizes`, not a free number. `AdminInventory.tsx` shows the size label. `AdminCatalogIntegrity.tsx` reflects the renamed checks 8/9 and new check 14.

## Tests (test DB only, `axisandbloom_test` guard stays)

View + service tests: 12 oz SKU without slot price → hidden, reason `no_slot_price`; add price → visible; guest with lower rank → `outranked` naming the winner; coffee with 12 oz + 2 lb SKUs and only a 2 lb slot price → visible (S3), Liam's 12 oz reader still excludes it (S2); `setSlotPrice` at 48 oz → `UNKNOWN_SIZE`; importer without a 12 oz SKU still rejected; `buildSlotsForArchetype` returns prices in 12 / 2 lb / 5 lb order with labels; collection offer prefers 12 oz. Pre-existing quizScoring baseline failures are not a gate.

## Don'ts

- No prod data writes. Do not set any prices or SKUs in prod; Dana sets prices in the admin after deploy. Never delete raw data.
- Do not change D5, D2, subscription size, or Stripe logic (the unexecuted Stripe brief uses `price_data` from slot prices and is size-generic; leave the file alone and just mention in the report if anything there needs a note).
- No admin UI to add/edit sizes. No new write path outside `catalogService.ts`.

## Docs

`WHAT_WE_BUILT.md` new entry; `WHAT_WE_BUILT_DB.md` ownership table (`coffee_size`: seed-owned, read via `catalogReads.getSizes`; new views); `backend/src/features/catalog_blueprint/README.md` gets a one-line "follow-up" pointer to this brief.

## Definition of done (one go, one closing report)

commit → push to `main` → deploy green → startup log clean (schema applied, integrity 14 checks, 11 fail-type green) → `npm run lint:catalog` clean with rule 5 active → prod smoke, read-only:
1. `GET /api/admin/catalog/sizes` returns 12 oz / 2 lb / 5 lb.
2. Coffees list: Flying Jewel shows red **Hidden**, line `Fruity · Jammy & Aromatic (home): 12 oz ✗ no slot price · 2 lb ✗ no SKU · 5 lb ✗ no SKU`; the "no slot price" link lands on the fruity/4 12 oz price input.
3. Slot card fruity/4 shows three price inputs and the Hidden badge.
4. Public `/api/coffees/archetypes` and `/experimental` still respond 200 with no active slots (unchanged state), each slot's `prices` empty.
5. Closing report: commits, Task 0 findings (every hardcode site found, distinct weights in data), test results, smoke results, anything deferred.
