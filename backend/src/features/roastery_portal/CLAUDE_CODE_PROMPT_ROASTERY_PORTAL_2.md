# Feature: Roastery Portal, part 2 (accept answers into the catalog + three follow-ups)

> Folder: `backend/src/features/roastery_portal/` · Decided: 2026-10-05 (Dana) · Model: Sonnet is fine
> Status: EXECUTED 2026-10-05 (commits 0e9fad3 + e6a4516 + docs on main, deploys green, acceptance verified live on the Zzz Test Roastery, cleaned up; see WHAT_WE_BUILT.md #210)
> Depends on: part 1 (`CLAUDE_CODE_PROMPT_ROASTERY_PORTAL_1.md`, executed, `WHAT_WE_BUILT.md` #209) and the Catalog Blueprint (`catalogService.ts` is the only catalog writer).

## What this is

Part 1 collects what roasters say. Nothing else in the platform knows about it yet. This brief adds the step where Dana accepts a submitted coffee and it becomes catalog data.

The integration point is one table. Every surface that shows or reasons about a coffee's flavor reads `v_collaborative_flavor_wheel`, whose roaster branch is `roastery_coffee_descriptors`. That table has no app writer today (seed files only). Once accepted notes are written there, these readers pick them up with no further change: the public flavor wheel and tasting notes (`GET /api/coffees/:id/flavor-wheel`), Liam's RAG (`sommelierRag.ts`), the lifecycle emails (`beatEngine.ts`, `cron.ts`), the placement guardrail's descriptor-family check (`catalogService.evaluatePlacement`), the palate views (`v_coffee_descriptor` and everything chained on it), and the order feedback chips. **Do not add a second path to any of them.**

The rule that keeps this from drifting: portal tables hold what the roaster said and are never edited after submit. Catalog tables hold what Dana decided. Accepting goes only through `catalogService`, records which response version it came from, and nothing is ever copied back from the catalog into the portal.

## Decisions already made (Dana, 2026-10-05). Do not re-open.

1. **Accept is per coffee, with a preview.** One "Review and accept" action per submitted coffee. The preview shows exactly what will change in the catalog and whether customers will see it now. Each item (a field, a note) has a tick, on by default. Nothing is applied until Dana confirms.
2. **Accept can create the catalog coffee.** If the lineup coffee has no `coffee_id`, accepting creates the coffee through `catalogService` and links the lineup row. It stays hidden from customers until placed and priced, exactly as any new coffee today.
3. **Mappings are remembered.** When Dana maps a roaster's words to a wheel term, the mapping is saved and offered as the suggestion the next time the same words appear, for any roastery. She always confirms; nothing is auto-applied.
4. **What is written on accept:** the ticked notes into `roastery_coffee_descriptors` (wheel term + their exact words), their words in order into `coffees.flavor_descriptors_roaster`, and the ticked basics (origin, process, roast level, blend or single) into `coffees`.
5. **What is never written:** the roaster's proposed family and their 1 to 5 dimension values. They are relative to the roaster's own lineup; cupping is 0 to 15 absolute. They are shown as hints only. No archetype assignment, no cupping row, no dial signal is created from portal data.
6. **Closest cousin is a hint, not a hop.** A hop needs a dimension and a direction, which the roaster does not give. Show the cousin where hops are created; Dana creates the hop.
7. **Brewing and "black or with milk" are out of scope.** They stay in the portal tables until roasters have answered.
8. A later submission never changes the catalog by itself. The coffee shows "Changed since accepted" and Dana accepts again.
9. Nothing is ever deleted. Retire, supersede, or version.
11. **Dominant dimension: note it and check whether it matches (Dana, 2026-10-05).** The roaster's "most dominant dimension" is shown next to ours, with a plain "Matches" / "Differs" marker. "Ours" is a decided fact, never a computed guess: the dimension of the slot the coffee is placed in (`coffee_dial_slot.dimension_id`), else the dominant dimension of its match archetype (`coffee_archetype.dominant_dimension_id`), else "not placed yet". The merged cupping range on the roaster's dominant dimension is shown beside it as context only. This is display and evidence. It never blocks, warns on, or changes a placement, and it does not derive a "dominant" dimension from cupping scores.
10. **The roaster's own words are internal only.** Words like "ube" or "Mexican dessert" are kept as evidence and for the mapping memory (`roastery_coffee_descriptors.notes`, `coffees.flavor_descriptors_roaster`). Customers and Liam only ever get the flavor wheel term they were mapped to. A note with no wheel term reaches no customer surface at all.

## Task 0: confirm before editing (report findings in the final report; STOP only if one contradicts this brief)

- `roastery_coffee_descriptors`: columns, the `UNIQUE (coffee_id, cupping_note_id)` constraint, row count in prod, and that no `.ts` file writes it.
- How `v_collaborative_flavor_wheel` is defined today (CREATE OR REPLACE, column list fixed because of its dependents) and the full list of its readers. If you find a reader not named in "What this is", report it.
- `catalogService.ts`: `createCoffeeInTx` / `createCoffee`, `updateCoffee` (no InTx variant today), `CreateCoffeeInput` / `UpdateCoffeeInput`, `logCatalogChange`, `scopedIntegrity`, and whether a new coffee is created active or inactive.
- `lint:catalog`: the table list behind "no catalog DML outside catalogService", and whether `roastery_coffee_descriptors` is on it.
- `coffees.process` is a single TEXT. The portal's `process_values` is an array.
- Whether a decaf category code exists in `coffee_category`.
- Every reader of `coffees.flavor_descriptors_roaster` and of `roastery_coffee_descriptors.notes` outside admin code (public routes, `sommelierRag.ts`, emails, `v_coffee` consumers). Decision 10 requires that none of them reaches a customer or Liam. If one does, STOP and report it before building.
- Where hops are created in admin (the page and form that call `setHop`) and where the 7-step "Place a coffee" flow lives in `AdminCatalog.tsx`.
- The image registry and bucket precedent from the image pipeline work (`frontend/src/design/assets`, `brandAssets` / `campaignAssets`), for follow-up F2.
- The Resend helper (`features/marketing/resendEmail.ts`) and how a transactional send is logged (`transactional_email_log`), for follow-up F3.
- How admin users and their emails are resolved (`user_type` name `admin`, `user_email`).

## TASK

### A. Schema (`schema.sql`, idempotent, applies cleanly twice)

1. `roastery_coffee_descriptors`: add `is_active BOOLEAN NOT NULL DEFAULT true`, `source_response_id INT REFERENCES roastery_portal_response(id)` (nullable; null = legacy seed row), `accepted_by_admin_id`, `accepted_at`, `retired_at`. Existing rows stay active and untouched. Do not rename the table in this brief.
2. `v_collaborative_flavor_wheel`: the roaster branch reads only `is_active` rows. Same column list, CREATE OR REPLACE, no dependent dropped.
3. `roastery_portal_acceptance` (insert-only log): `id`, `response_id` (must be a submitted version), `portal_coffee_id`, `coffee_id`, `created_coffee BOOLEAN`, `applied JSONB` (every item applied, with the catalog value before and after), `accepted_by_admin_id`, `accepted_at`. Reject UPDATE and DELETE with a trigger.
4. `roastery_portal_note_mapping` (the remembered translations): `id`, `normalized_words` (lowercased, trimmed, inner whitespace collapsed), `cupping_note_id`, `created_by_admin_id`, `created_at`, `superseded_at`. One active row per `normalized_words` (partial unique index). Changing a mapping supersedes the old row and inserts a new one.
5. Views:
   - `v_roastery_portal_progress`: add `accepted_version`, `accepted_at`, and `changed_since_accept` (a submitted version newer than the last accepted one exists).
   - `v_roastery_portal_coffee_hint`: per catalog `coffee_id`, from the latest submitted response of the linked lineup coffee: proposed family, dominant dimension, the 1 to 5 values with their portal labels, respondent and date.
   - `v_roastery_portal_cousin_hint`: per submitted response with a cousin: both lineup coffees, both `coffee_id`s when linked, the "what changes" text, and each coffee's roaster-stated dominant dimension (from its own latest submitted response, when it has one).
   - `v_roastery_portal_dimension_match` (decision 11): per catalog `coffee_id` with a submitted response: the roaster's dominant dimension, our dimension and where it came from (`slot` | `match_archetype` | null), `matches` (true / false / null when either side is missing), and the merged cupping range on the roaster's dimension read through the existing cupping read path (`v_coffee_dimension_range` if Task 0 confirms it is the current one). This view is the only definition of the match.

### B. Backend

1. **`catalogService.ts`** (the catalog door stays the only catalog writer):
   - Add `updateCoffeeInTx`, splitting `updateCoffee` the same way `createCoffee` / `createCoffeeInTx` are split. No behaviour change for existing callers.
   - Add `setRoasterDescriptorsInTx(tx, { coffeeId, notes: [{ cuppingNoteId, roasterWords }], sourceResponseId, actor })` and its public wrapper. Set semantics for that coffee: activate or insert the given rows (stamping source, admin, time), retire active rows not in the set (`is_active = false`, `retired_at`). Never delete. `logCatalogChange` + `scopedIntegrity` like its sibling verbs.
   - Add `roastery_coffee_descriptors` to the `lint:catalog` table list so no other file can write it.
2. **`roasteryPortalReads.ts`**:
   - `previewAcceptance(responseId)`: read-only. Returns: target coffee (existing, or "will be created" with the values it would get); for each basic field: catalog value now, roaster's value, whether they differ; for each note: their words, the roaster's wheel pick, the remembered-mapping suggestion when the roaster left it unmapped or picked differently, and whether that descriptor is already active for the coffee; the active roaster descriptors that would be retired; `visibleToCustomers` from `v_coffee_visibility`; and the read-only hints (family, dimensions, cousin).
   - Reads for the three new views and for the mapping list.
3. **`roasteryPortalService.ts`**:
   - `acceptResponse({ responseId, items, actor })`, ONE `withTransaction`: validate the response is submitted and belongs to an active lineup coffee → if no `coffee_id`, `createCoffeeInTx` and link the lineup row → `updateCoffeeInTx` with the ticked basics and the ordered `flavorDescriptorsRoaster` → `setRoasterDescriptorsInTx` with the ticked, mapped notes → upsert `roastery_portal_note_mapping` for every note whose final wheel term was chosen or changed by the admin and has "remember" ticked → insert the `roastery_portal_acceptance` row. All or nothing.
   - `items` carries, per note: include or not, the final `cuppingNoteId` (may be null: the note then goes only to `flavor_descriptors_roaster`), remember or not. Per basic field: include or not. For process, the single value the admin chose when the roaster gave several.
   - `setNoteMapping` / `supersedeNoteMapping` for the mappings list.
   - The service calls `catalogService` functions; it contains no catalog SQL itself (part 1's lint rule 2 stays green).
4. **Admin routes** under `/api/admin/roastery-portal`: `GET .../responses/:id/acceptance-preview`, `POST .../responses/:id/accept`, `GET .../acceptances?portalCoffeeId=`, `GET/POST/PATCH .../note-mappings`, `GET .../hints/coffee/:coffeeId`, `GET .../hints/cousins`.
5. No change to any public portal route. Remembered mappings are admin-side only; they are not exposed through the partner page's vocabulary bundle.

### C. Admin frontend

Reuse existing admin patterns and components; no new shared components.

1. `AdminRoasteryPortal.tsx`:
   - Coffee rows gain a state beside the roaster's: "Accepted, v2, date" or "Changed since accepted".
   - "Review and accept" on any submitted coffee opens the preview panel:
     - A banner when `visibleToCustomers` is true: "Customers will see these notes as soon as you accept."
     - Catalog coffee: "Linked to <name>" or "Will be created in the catalog (hidden until you place and price it)".
     - Basics table: field · in the catalog now · roaster says · tick. When the roaster gave several processes, a single-choice control picks the one that goes to the catalog.
     - Notes list in the roaster's order: their words · wheel term (the part 1 wheel picker, preset to the roaster's pick, or to the remembered suggestion marked "suggested from your earlier mapping") · tick · "remember this mapping" tick (shown only when the admin's term differs from, or fills in, the roaster's pick).
     - "Will be retired": roaster descriptors currently active for this coffee that are not in the new set.
     - Read-only hints block: proposed family, the 1 to 5 values labelled "relative to their lineup", closest cousin and what changes, and the dominant dimension line from `v_roastery_portal_dimension_match`: "Roaster says: Acidity · Ours: Acidity (slot Bright & Tart) · Matches", plus the cupping range when one exists.
   - The progress table gets a "Dominant dimension" column with the same Matches / Differs / dash marker, so mismatches across a lineup are visible at a glance.
     - Confirm → result summary with any `warnings` and `integrity` the catalog verbs returned.
   - A "Mappings" section: the remembered word → wheel term list, with change (supersede).
2. Place-a-coffee flow in `AdminCatalog.tsx`: when the chosen coffee has a row in `v_roastery_portal_coffee_hint`, show a small read-only "Roaster's view" box (proposed family, their dominant dimension with the match marker against the slot being chosen, their 1 to 5 values labelled relative, who and when). It never preselects or changes anything in the flow.
3. Where hops are created: a read-only "Roaster cousin hints" list from `v_roastery_portal_cousin_hint` for pairs where both coffees are in the catalog, showing each coffee's roaster-stated dominant dimension and the "what changes" text, each with a link that opens the existing create-hop form with the two coffees prefilled. Dimension and direction stay the admin's choice.

### F. Follow-ups from the part 1 review

- **F1, read lint.** Extend `lint-roastery-portal.mjs`: outside `roasteryPortalService.ts` and `roasteryPortalReads.ts`, no SQL may reference a `roastery_portal_*` table or a `v_roastery_portal_*` view. Every other file reads portal data by calling `roasteryPortalReads` functions. Inside `roasteryPortalReads.ts`, "current response" and progress come from the views, not from re-derived queries on the base tables. Prove the rule fails on a deliberate violation, then remove it.
- **F2, dial images.** Move the six PNGs from `frontend/public/bloom/dials/` into the image registry following the image pipeline precedent found in Task 0, repoint `bloomVisuals.ts`, and remove the files from `frontend/public`.
- **F3, submit email.** On submit, send one plain internal email through the existing Resend helper: "<Roastery>: <coffee> submitted by <name>", with the admin page link. Recipients: the email addresses of all users whose type is `admin`, resolved at send time. No environment variable, no hardcoded address. Log it the way other transactional sends are logged. A failed send never fails the submit.

## CONSTRAINTS

- The only new writer of catalog data is `catalogService.ts`. No file other than `roasteryPortalService.ts` writes `roastery_portal_*`.
- No write to `coffee_archetype_assignment`, any cupping table, `dial_position_signal`, or `coffee_hop` from this work.
- No change to public API shapes or to any customer-facing component. The only customer-visible effect is the intended one: accepted notes appear through the existing readers.
- No roaster or raw coffee name on any customer surface (house rule).
- **Do not act as Dana.** Do not mint tokens for her account or any real person's account. For admin API checks, create a marked test admin user (name starting `Zzz Test`), use it, and remove its admin type and disable it at the end. Report its uid.
- No new environment variables.
- `npx tsc --noEmit` clean in backend; no new errors in frontend (13 known errors in untouched files are not a gate); `vite build` clean; all lints and boot integrity checks green; `schema.sql` applies twice on the test database; existing tests green. Add tests for: accept creates and links a coffee; accept on a linked coffee updates only ticked items; set semantics retire without deleting; acceptance log is immutable; a mapping is remembered and suggested, and superseding keeps history; a failed step rolls the whole accept back; the view filters retired descriptors.
- No dev environment: production only, marked test data, retired afterwards (nothing deleted).

## DONE = commits pushed straight to `main`, deploy green, startup log clean, acceptance verified live, `WHAT_WE_BUILT.md` and `WHAT_WE_BUILT_DB.md` entries, Status above flipped. One report at the end.

## ACCEPTANCE (live production, Zzz Test Roastery only)

Reactivate one of the part 1 test lineup coffees (or add a new one), create a test link, and submit a response with three notes: one exact wheel word, one with a wheel pick, one with words only ("zzz ube").

1. Preview shows "Will be created in the catalog", the three notes, no customer banner.
2. In the preview, map "zzz ube" to a wheel term with "remember" ticked, untick the origin field, confirm. Result: a catalog coffee exists and is linked; `roastery_coffee_descriptors` has three active rows stamped with the response id; `flavor_descriptors_roaster` holds the three phrases in order; origin is unchanged; one `roastery_portal_acceptance` row; one mapping row.
3. `GET /api/coffees/<new id>/flavor-wheel` returns the three descriptors with source `roastery`. State the id. The string "zzz ube" appears in no public endpoint response for this coffee and not in Liam's RAG context for it (decision 10).
4. The coffee is not visible to customers (`v_coffee_visibility`).
5. Submit version 2 from the portal with one note removed and one new note typed as "zzz ube". The admin row shows "Changed since accepted". The catalog is unchanged until accept. The preview offers the remembered term for "zzz ube", marked as suggested, and lists the removed note under "Will be retired".
6. Accept version 2. The removed note's row is inactive with `retired_at`, not deleted, and no longer appears in the flavor-wheel endpoint.
7. Place-a-coffee shows the "Roaster's view" box for this coffee and changes nothing in the flow. With the test response's dominant dimension set to Acidity: choosing a fruity slot shows "Matches", choosing a chocolate slot shows "Differs", and the placement goes through either way with no new warning.
8. Submit triggers the F3 email to the test admin's address and a log row. Quote the log row.
9. F1: the lint fails on a deliberate violation and passes without it. F2: the six dial images load on the partner page from the registry.
10. `SELECT` proof: zero rows written by this work to `coffee_archetype_assignment`, cupping tables, `dial_position_signal`, `coffee_hop`.

Cleanup: retire the test coffee through `catalogService.retireCoffee`, set its roaster descriptors to the empty set, supersede the "zzz ube" mapping, deactivate the test lineup rows, revoke the test link, disable the test admin. **Do not accept, change or submit anything for Utopian or any real roastery.**
