# Cupping Evidence, brief 4: the Calibration workbench (decide through the admin UI, evidence beside the decision, basis composed from the rows)

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-16 (CTO session; decisions by Dana) · Model: Sonnet is fine
> **v3 (2026-10-17):** the basis is stored twice, as the text line and as `basis JSONB`; placements record `placed_from_session_id`; the page shows `evidence_newer_than_decision`; no cupper name is hard-coded anywhere in the page or in `composeBasis`. The v2 text is kept as `SUPERSEDED_…_4_WORKBENCH_v2.md`.
> Status: NOT EXECUTED · Depends on briefs 1 v3, 2 v3 and 3 v3 being deployed.
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v2 §8 (decision rules, §8.4 in particular). Read it first. This brief adds one admin page and one reads extension. **No schema, no new table, no new view, no new writer.** Every write goes through an existing `catalogService` or `roasteryPortalService` door over an existing `/api/admin` endpoint.

## What this is

Brief 3 lines the evidence up; this brief puts the decision next to it. Today an assignment is made on the Coffees page or the Bloom Dial page with the evidence somewhere else, and the basis is typed from memory or not at all (the Aug 27 drift problem). The workbench shows, for one coffee of one roastery, everything every source said, and offers the three decisions (archetype, dial slot, accepted descriptors) as forms whose basis line is composed from the rows on screen. Dana confirms or changes, the existing door writes, the view updates.

## Decisions already made (Dana). Do not re-open.

1. The workbench never computes or recommends a decision. No "suggested archetype", no score, no default other than the current catalog value. The data-driven proposal column (DESIGN §8.5) is not built.
2. The basis is mandatory on every archetype and placement write from this page, composed by a pure function from the evidence rows (`composeBasis`) that returns `{ text, json }`: the text line in the DESIGN §8.3 shape for humans, and a JSON object (`{ sessions: [ids], calls: {<cupper>: <call>}, roaster_form: {...}, roaster_remarks: [...], website: [...], merged_range: {...}, band: {...}, rule: '...' }`) for the machine. Both are written: `notes` / `placement_note` get the text, `basis` gets the JSON. One free-text "rule" part Dana types; the composed part is not editable; the rule part is required when the decision differs from what every source said.
3. Writes use the existing endpoints only: `PUT /api/admin/catalog/coffees/:id/match` (`setMatchArchetype`, with `sessionId`, `notes` and **`basis`**), `POST /api/admin/catalog/coffees/:id/placements` and `POST …/move` (`placeCoffee`, with `placementNote`, **`basis`** and **`placedFromSessionId`**), `POST …/placements/:slotId/certify`, `PUT /api/admin/catalog/slots/:slotId/priorities`, `POST /api/admin/roastery-portal/responses/:id/accept` (`acceptResponse`). The three bold fields are the expected additions to the endpoints and the service inputs (brief 1 created the columns); never a new endpoint.
4. The impact previews and warnings the existing dialogs show (D6 band warning, priority shift, placement note required when out of band) are shown here too, from the same service responses. Nothing is bypassed.
5. Read-only for anyone who is not an admin; the page lives behind `requireAdmin` like the rest of `/api/admin`.
6. No redesign of the Coffees page or the Bloom Dial page. They keep their dialogs; the workbench is a third door to the same services, and the coverage view shows which assignments were made without a basis, whichever door they came through.

## Task 0 (report, read-only)

- The exact request and response shapes of the six endpoints in decision 3 (body fields, warnings array, error codes), and the frontend helpers that call them today (`AdminCatalog.tsx`, `AdminDial.tsx`, `AdminRoasteryPortal.tsx`): the workbench reuses those helpers, it does not duplicate fetch code.
- `evidenceReads.ts` (brief 3) exports and the shapes of `GET /api/admin/evidence/coffee/:coffeeId` and `/roastery/:roasterId`.
- How `AdminRoasteryPortal.tsx` is structured (tabs?) so the workbench is a tab there (preferred) or a sibling route under the same menu entry.
- The archetype list hook (`useArchetypes.ts`) and the slot list source used by `AdminDial.tsx`, for the selects.
- Whether `coffee_archetype_assignment.source` accepts `'cupping'` with a `sessionId` and `'manual'` without (expected yes; `assignment_source_enum`). That `basis JSONB` exists on both assignment tables and `placed_from_session_id` on `coffee_slot_assignment` (brief 1), and that `setMatchArchetype` / `placeCoffee` do not yet write them (this brief adds the inputs).
- The `cupper` rows and how brief 3's `v_evidence_archetype_call` exposes per-cupper calls (the page builds its labels from those rows; no cupper name appears in page code).
- Counts after brief 2: coffees per roastery with `flag_unreconciled`, with `assignment_basis_present = false`, placed without cupping. These are the queue sizes the page will show on day one.

## PART A: reads (`services/evidenceReads.ts`, over views only)

- `getWorkbenchQueue(roasterId)`: from `v_evidence_coverage` joined to `v_evidence_archetype`: one row per coffee of the roastery with `coffee_id`, `coffee_name`, `is_placed`, `catalog_archetype`, `catalog_confidence`, `catalog_home_slot_name`, `assignment_basis_present`, `evidence_newer_than_decision`, `flag_unreconciled`, `n_sources`, `last_cupped`, ordered: flagged first, then stale decisions, then no basis, then by name.
- `getWorkbenchCoffee(coffeeId)`: the brief 3 per-coffee bundle (`v_evidence_dimension` rows, one per dimension × cupper; `v_evidence_descriptor` rows; the `v_evidence_archetype` row and its `v_evidence_archetype_call` rows) plus, for the descriptor form, the roaster's current submitted response id and its notes with their mapping status (from `roasteryPortalReads`, existing), and the active `roastery_coffee_descriptors` (existing read).
- Route `GET /api/admin/evidence/workbench/:roasterId` and `GET /api/admin/evidence/workbench/coffee/:coffeeId`, behind `requireAdmin`, in the brief 3 evidence router. `lint-cupping`'s `FROM v_evidence_` rule already confines these reads to `evidenceReads.ts`.

## PART B: `composeBasis` (pure, `backend/src/services/evidenceBasis.ts`, unit-tested, also imported by the frontend through the shared types package if one exists, otherwise duplicated in `frontend/src/app/lib/evidenceBasis.ts` with the same test vectors)

Input: the `v_evidence_archetype` row for the coffee, its `v_evidence_archetype_call` rows (one per cupper, in `cupper_id` order), and, for a placement, the `v_evidence_dimension` rows of the slot's dimension and the slot's band. Output: `{ text, json }`. `text` is the composed prefix of the basis line in the DESIGN §8.3 shape, deterministic, one line, no trailing rule; cupper names come from the rows, never from code:

```
basis: cupping s<assigned_from_session_id or latest session> (<cupper_name>=<call or 'no call'>[, <cupper_name>=<call or 'no call'>]…; <'blind' | 'not blind'><', roaster present' when true>); roaster form v<n> (<respondent>)=<proposal or 'no proposal'>; roaster remarks=<distinct proposals or 'none'>; website=<up to 3 descriptor remarks or 'none'>
```
`json` carries the same facts structured: `{ sessions: [...], calls: { "<cupper_name>": "<call>|null" }, blind, roaster_present, roaster_form: { version, respondent, proposal }, roaster_remarks: [...], website: [...], merged_range: { dimension_id, min, max, session_id } | null, band: { slot_id, lo, hi, check } | null, rule }`. A cupper who did not cup the coffee is absent from both.
For a placement, append `; merged <dimension> <min>-<max> vs band <lo>-<hi> (<in_band | out_of_band | no_band>)`. The final stored note is `text + '; rule: ' + ruleText`, and `json.rule = ruleText`. `ruleText` is required when the chosen archetype differs from every cupper's call and every roaster proposal, or when the chosen slot is `out_of_band`; otherwise it may be empty and the stored line ends with `; rule: confirmed`. Tests: Joe Bean Blossom (all sources differ → rule required), Geometric (all agree → `confirmed`), Joe Coffee La Familia (one cupper balanced, roaster floral, chosen floral → rule required and the composed part names both), Utopian Union (both calls null, struck → `no call` for both, rule required), a coffee only one cupper cupped (the other absent), a placement out of band, and a third cupper row added in the fixture appearing in the text and the json with no code change.

## PART C: the page (`frontend/src/app/components/admin/AdminCalibrationWorkbench.tsx`, a tab "Calibration" in `AdminRoasteryPortal.tsx` next to the brief 3 read-only Calibration tab, or that tab gains the right-hand decision column; Task 0 decides which is less code)

Layout, desktop first (this is an admin tool), one roastery at a time (the roastery selector already on the page):

**Left: queue.** The `getWorkbenchQueue` list with a flag dot, basis dot, sources count, current archetype and slot. Click selects a coffee. Counters at the top: flagged, without basis, placed without cupping.

**Centre: evidence for the selected coffee.** The three brief 3 panels (Dimensions, Descriptors, Archetype & slot) reused as components from brief 3 B1, not reimplemented. Session rows link to Score Entry; remark rows show channel and who said it; a struck word keeps its `~`.

**Right: decisions.** Three cards, each with the current value on top, the form below, and the composed basis preview updating live.

1. *Archetype.* Select (archetypes), confidence (low / medium / high), source (`cupping` when a session is linked, `manual` otherwise; shown, not chosen), session (the latest session of this coffee, preselected, changeable), rule text, composed basis preview, and a "newer evidence since this decision" line when `evidence_newer_than_decision`. Button "Confirm" when the select equals the current archetype (writes a new assignment row only if the confidence or the basis changes; the service's no-op rule applies), "Change" otherwise. Calls `PUT …/match` with `{ archetype, confidence, source, sessionId, notes: text + rule, basis: json }`. Shows the returned warnings. On success the centre and the queue refresh.
2. *Dial slot.* Current home slot and priority; select of that archetype's active slots with their band on the dominant dimension and the live `in_band / out_of_band` check against the merged range (from `v_evidence_dimension`); placement note = composed basis text for placement + rule, `basis` = the json, `placedFromSessionId` = the selected session; priority input; preview via the existing preview helper where one exists. "Place" (`POST …/placements`, role home) when unplaced, "Move" (`POST …/move`) when placed, then "Certify" (`POST …/certify` with `by: 'dana'` and the note) as a second explicit click, never automatic. Shows warnings; out of band requires the rule text (the service already requires a note; the page requires the rule part).
3. *Descriptors.* The roaster's current submitted notes (words, mapped leaf, family, hit / miss / extra from the descriptor view) with a checkbox each, the already-accepted ones checked and disabled, plus the cupper leaves that are `extra` shown greyed (ours never enter the roaster descriptor set from here; they are evidence only). "Accept" calls `POST /api/admin/roastery-portal/responses/:id/accept` with the chosen items, exactly as the existing acceptance UI does. Where a roaster word has no mapping, a "map" link opens the existing mapping control, which now calls `noteMappingService.setNoteMapping`; no new mapping UI.

Behaviour rules: every write disables the form until the response returns; a 409 or a `CatalogError` shows the service message verbatim; nothing optimistic. After any write the page re-fetches the coffee bundle and the queue; the basis dot turns green when `assignment_basis_present` is true. A coffee that is decaf shows the slot card disabled with the category rule stated. A coffee with no cupping shows the archetype card with `source = 'manual'` and a visible line "no Axis & Bloom cupping; assignment is a guess until cupped" and the composed basis says `cupping: none`. Nothing in the page names a cupper; labels come from the rows.

## PART D: tests, lint, docs

- `evidenceBasis.test.ts`: the seven vectors of Part B plus determinism (same input → same text and same json) and that the text never contains a newline; `JSON.parse(JSON.stringify(json))` round-trips.
- `evidenceReads.test.ts` (extend): queue ordering (flagged → no basis → name), the bundle shape.
- Route tests: the two GETs behind `requireAdmin`; a write from the page's helper hits the existing endpoint and the resulting `coffee_archetype_assignment` row carries `notes` starting with `basis:`, `basis` not null and `assigned_from_session_id` set; a placement carries `basis` and `placed_from_session_id` (through the existing route test fixtures; no new write path to test). `v_evidence_coverage.assignment_basis_present` true afterwards.
- Playwright or the house frontend smoke, whichever exists: open the tab, select Joe Bean, select Blossom, see the three cards, the composed basis preview contains `Dana=earthy`; confirm Geometric with `confirmed`; verify in `v_evidence_archetype` that `basis` is present and `flag_unreconciled` dropped for Geometric.
- Lints green (`lint:cupping`, `lint:catalog`, `lint:roastery-portal`): the page writes through existing routes only; `evidenceReads.ts` remains the only `v_evidence_` reader.
- `WHAT_WE_BUILT.md` entry; `WHAT_WE_BUILT_DB.md` Cupping evidence section: one paragraph "decisions are made in the Calibration workbench; the basis is composed by `composeBasis`". No `comments.sql` / `CATALOG.md` change (no schema).

## CONSTRAINTS
- No schema, view, table, trigger, grant or lint rule change except the two GET routes and the reads module extension.
- No change to `catalogService`, `roasteryPortalService` or their endpoints beyond the three input fields of decision 3 (`basis` on match and placements, `placedFromSessionId` on placements), stored as given, validated as JSON objects.
- No decision is made by this brief: the page is built and smoke-tested on the test DB against the brief 2 rows; on prod nothing is assigned, placed or accepted by Claude Code. Dana does the calibration pass herself afterwards (DESIGN §12 row 5).
- Straight to main, one commit for backend reads + basis + tests, one for the frontend + docs.

## DONE =
Under Roastery Feedback, a Calibration workbench: queue on the left (flagged first), the brief 3 evidence in the centre, three decision cards on the right over the existing catalog and acceptance endpoints, with a basis line composed from the evidence and mandatory on every archetype and placement write; `composeBasis` pure and tested; no new writer; lints green; smoke test passes on the test DB.

Closing report: the Task 0 endpoint shapes; the queue counts per roastery on prod (how many coffees are flagged, how many have no basis); the two admin URLs; any endpoint field that had to be added.
