# Cupping evidence, brief 4: closing report

> 2026-10-18. Brief: `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_4_WORKBENCH.md`. `WHAT_WE_BUILT.md` #227.
> **Commits:** `e425aff` backend (workbench reads, `composeBasis`, the three endpoint fields, tests; deployed) · the frontend + docs commit right after it (the workbench page, the shared write helpers, this report).
> **Nothing on prod was assigned, placed or accepted.** The page was built and smoke-tested on the test DB against the brief 2 rows as a marked Zzz Test admin (created for the run, then demoted and disabled). Dana's calibration pass is next (DESIGN §12 row 5).

## Task 0: endpoint shapes (as found, before any file)

| Endpoint (existing) | Body | Response | Errors |
|---|---|---|---|
| `PUT /api/admin/catalog/coffees/:id/match` | `{ archetype, confidence, source, sessionId?, notes? }` **+ `basis?`** | `{ coffeeId, warnings[] }` | 400 `INVALID_INPUT` (missing fields; with brief 4 also a basis that is not a JSON object); `CatalogError` → `{ error: <code>, message, detail }` |
| `POST /api/admin/catalog/coffees/:id/placements` | `{ slotId, role, priority?, placementNote?, certify? }` **+ `basis?`, `placedFromSessionId?`** | 201 `{ assignmentId, warnings[] }` | 409 `ALREADY_ASSIGNED`, `HOME_EXISTS`, `PRIORITY_TAKEN`; 400 `NOTE_REQUIRED` (band or family warning without a note); 409 `SPEC_VIOLATION` only under `CATALOG_SPEC_HARD_GATE` |
| `POST /api/admin/catalog/coffees/:id/move` | `{ toSlotId, priority?, placementNote?, certify? }` **+ `basis?`, `placedFromSessionId?`** | `{ assignmentId, warnings[] }` | as placements |
| `POST /api/admin/catalog/coffees/:id/placements/:slotId/certify` | `{ by, note? }` | `{ assignmentId }` | 400 `by` required; 404 no active assignment |
| `PUT /api/admin/catalog/slots/:slotId/priorities` | `{ ordered: coffeeId[] }` | `{ slotId }` | 400 unless every active row is listed once |
| `POST /api/admin/roastery-portal/responses/:id/accept` | `{ items: { basics?: { <field>: { include, value? } }, notes?: [{ rank, include, cuppingNoteId?, remember? }] } }` | 201 `{ acceptanceId, coffeeId, createdCoffee, applied, warnings, integrity }` | portal errors (`RoasteryPortalError`) |
| `GET /api/admin/catalog/placement-preview?coffeeId&slotId&role` (read) | — | `{ warnings[] … }` | 400, 404 |

Warning kinds: `band_out_of_spec`, `band_no_data`, `band_no_spec`, `descriptor_off_family`, `placement_diverges_from_match`.

**Frontend callers before this brief:** none shared; each dialog fetched inline (`AdminCatalog.tsx` `SetMatchModal` always `source: 'manual'`, `PlaceModal` preview + confirm, the slot card's certify and priorities; `AdminDial.tsx` its own preview and placement; `AdminRoasteryPortal.tsx` `AcceptPanel`). To reuse rather than write a fourth copy, the calls moved once into `frontend/src/app/lib/catalogWrites.ts`, used by the workbench and by the Coffees page's Set match / Place dialogs and the acceptance view (same requests as before). `AdminDial.tsx` and the slot card were left as they were (no redesign).

**Other Task 0 facts:** brief 3 reads `GET /api/admin/evidence/coffee/:id` → `{ dimensions, descriptors, archetype, calls }`, `/roastery/:id` → `{ calibration, cuppers, coverage, staleDecisions }`; Roastery Feedback has no tabs, it routes on URL parameters, so the workbench is `&view=workbench` beside brief 3's `&view=calibration`; `useArchetypes()` (`GET /api/admin/catalog/archetypes`, with `dominant_dimension_id`) and `GET /api/admin/catalog/slots` (with `dimension_id`, `spec_band_lo/hi`, occupants) feed the selects; `assignment_source_enum` = cupping, manual, import; `basis JSONB` on both assignment tables and `placed_from_session_id` existed (brief 1) and were never written; cuppers Dana (1), Camila (2), named only in rows.

## Endpoint fields added (decision 3, nothing else)
- `PUT …/coffees/:id/match`: **`basis`** → `coffee_archetype_assignment.basis`.
- `POST …/coffees/:id/placements` and `POST …/coffees/:id/move`: **`basis`** → `coffee_slot_assignment.basis`, **`placedFromSessionId`** → `placed_from_session_id`.
- Validated (`basis` a JSON object, `placedFromSessionId` a positive integer), stored as given.
- **One consequence, stated in Task 0:** `setMatchArchetype` skipped a write when archetype and confidence were unchanged, which would have dropped the basis of every "Confirm". The no-op test now also compares the basis (key order ignored, since jsonb reorders keys), so a confirmation carrying its basis writes one new row and an identical repeat writes none (route test).
- Two reads in the brief 3 evidence router: `GET /api/admin/evidence/workbench/:roasterId` (the queue) and `GET /api/admin/evidence/workbench/coffee/:coffeeId` (the brief 3 bundle + coffee basics with category codes, its sessions, the roaster's current submitted response through `roasteryPortalReads.getCoffeeHint`, the latest website capture's descriptor remarks, the accepted descriptors). `evidenceReads.ts` stays the only `v_evidence_` reader; `lint:roastery-portal` kept the portal read inside `roasteryPortalReads`.

## Choices where the brief left a gap
1. **When the rule is required.** Decision 2: "when the decision differs from what every source said". Implemented as: required unless every cupper on the coffee called the chosen archetype **and** every roaster proposal (form, remarks) proposed it; a cupper's "no call" (or a form with no proposal) supports nothing; always when the slot is out of band. This matches all seven brief vectors (Blossom, La Familia, Union required; Geometric "all agree" confirmed). On the live rows **Geometric's roaster form proposes fruity**, so confirming Geometric on the real page needs a rule; the brief's "confirm Geometric with `confirmed`" assumed the roaster agreed.
2. **Certify** asks for a "certified by" name (as the Coffees page's certify does) instead of sending `by: 'dana'`: the page names no person.
3. **Descriptor card:** the roaster's notes come from the existing `acceptance-preview` read; Accept sends the same `items` the acceptance view builds (no basics; every already-active note stays included so nothing is retired; ticked mapped notes added). An unmapped word's "map" opens the existing acceptance view, which holds the mapping control.
4. **Decaf** coffees show the slot card closed with the category rule stated; a coffee nobody cupped shows the archetype card with source `manual`, the "guess until cupped" line, and a basis that says `cupping: none`.
5. **No frontend test runner exists** (no Vitest or Playwright in `frontend/`): the frontend `composeBasis` copy runs the same 11 vectors inside the backend suite (loaded by a run-time path), which also checks that `composeBasis` (both copies) and the workbench page name no cupper. The page itself was smoke-tested over HTTP and built, not clicked through in a browser.

## Queue counts per roastery on prod (through `getWorkbenchQueue`, after the backend deploy)

| Roastery | Coffees | Flagged | Stale decisions | No basis | Placed, never cupped | Top of the queue |
|---|---|---|---|---|---|---|
| Joe Bean Roasters | 4 | 4 | 0 | 0 | 0 | Blossom, Fabricator, Geometric |
| Joe Coffee Company | 8 | 5 | 0 | 0 | 0 | Benchmark, La Familia, Nightcap Decaf |
| Utopian | 10 | 10 | 0 | 1 (Flying Jewel) | 0 | Flying Jewel, Andres Martinez, Decaf Veracruz |

## Tests and smoke
- `evidenceBasis.test.ts`: the seven brief vectors (Blossom; Geometric all agree → `confirmed`; La Familia; Union; one cupper only; a placement out of band, plus `no_band`; a third cupper row appearing in text and json with no code change), a coffee nobody cupped, determinism / one line / JSON round-trip, `bandCheck`, and no cupper name in the sources: 11 × 2 copies.
- `routes/evidenceAdmin.test.ts` (extended): queue ordering, the bundle shape, 400 / 404; a write through the existing match and placement endpoints on a Vitest coffee on a free slot: `notes` starting `basis:`, `basis` stored, `assigned_from_session_id` and `placed_from_session_id` set, an identical repeat a no-op, a non-object basis a 400, `v_evidence_coverage.assignment_basis_present` true.
- Before the backend commit: six lints, backend build, full suite **797 passed, 6 failed** (OT-19) on a test DB freshly refreshed from prod; before the frontend commit: six lints, both builds.
- **Smoke (test DB, local backend on :4917, Zzz Test admin):** Joe Bean queue → 4 coffees; Blossom's bundle and composed basis `basis: cupping s37 (Dana=earthy, Camila=no call; blind); roaster form v1 (Kathy Turiano)=chocolate_nutty; roaster remarks=none; website=Turbinado Sugar, Toffee, Dark Chocolate`, rule required; the acceptance preview for Blossom's response; Geometric confirmed through `PUT …/match` with a rule → one new assignment row, `v_evidence_archetype.basis` = `basis: cupping s37 (Dana=balanced_sweet, Camila=balanced_sweet; blind); roaster form v1 (Kathy Turiano)=fruity; …; rule: …`, `basis_json` with calls and rule, `assigned_from_session_id` s37, `assignment_basis_present` true, the queue's basis dot green. **`flag_unreconciled` stays true for Geometric** (A3 `roaster_disagrees`, Acidity `cuppers_disagree`): a basis records the decision, it does not reconcile the evidence. All 14 checks PASS. That one Geometric row is on the test DB only.

## Admin URLs
- Calibration workbench: https://www.axisandbloomcoffee.com/admin/roastery-portal?roastery=19098f5c-99b9-4d7c-90ef-ee33d1e896b7&view=workbench (Joe Bean; any roastery → **Workbench**)
- Read-only Calibration (brief 3): https://www.axisandbloomcoffee.com/admin/roastery-portal?roastery=19098f5c-99b9-4d7c-90ef-ee33d1e896b7&view=calibration
