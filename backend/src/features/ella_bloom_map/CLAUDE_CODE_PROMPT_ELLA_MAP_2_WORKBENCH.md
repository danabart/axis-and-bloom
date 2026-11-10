# Claude Code brief — Ella's Bloom Map 2: Workbench

Workstream: ella_bloom_map (`README.md` here; design `misc/palate_model/BLOOM_DIAL_HUB_MODEL_REV3_2026-11-09.md`, read sections 2, 4, 7 (the workbench paragraph) and 9 first; brief 1's `CLOSING_REPORT_1.md` for the API as built) · Written 2026-11-10 by the CTO session, to run after brief 1 ships · Model: Sonnet · Dana runs it; push = deploy · **Test mode.** Admin only; no customer surface.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every number and label on the page comes from the brief 1 API and `evidence_parameter`) · G2.5 reads via `dialReads`, writes via `dialPlacementService` and `catalogService.setLean` only · G3.1 routes call services · G3.6 admin gated server-side · G3.9 reuse · G4.1 reuse shared components (`EvidenceParametersCard`, `LookupSelect`, `AdminCalibrationWorkbench` decision pattern, `bloomVisuals` palette) · G4.2 nothing typed in · G4.3 `tsc --noEmit` clean · G5.1 vitest for any new service function · G1.6 push is deploy, one closing report.
STOP point: after Task 0 only.

**Goal.** One admin page, "Ella's Bloom Map" at `/admin/map`, where Dana runs the acceptance gate (Rev 3 section 9): sees every catalog coffee placed by the current rules beside its evidence and flags, records lean decisions, edits the map's parameters, checks hops and the graph, fills first matches and phrases, cuts a version and activates it. The face component built here (`EllaMapFace`) is the picture brief 3 reuses for customers, so it is built once, in `components/bloom/map/`, not inside the admin folder.

**Decisions already made (Dana 2026-11-10, Rev 3; do not re-open).** R3.1 to R3.10 as in brief 1. UX for this page from Rev 3 section 7: full face with every placed coffee, sellable or not; grades and flags visible; lean suggestion beside decision; tap only; nothing rotates or drags.
CTO calls for this brief, reversible, flag if the code disagrees:
1. `EllaMapFace` is one SVG component with props `{ placements, highlightCoffeeId?, hops?, size: 'thumb' | 'full', showGrades?: boolean, onTapCoffee? }`. Geometry: center disc, four wedges in `dial_wedge.angle_order`, three rings of equal width, three lane positions inside a wedge (side A near its seam, middle, side B near its seam), dot radius by size class, dimmed dots for not-sellable, seam labels from `dial_seam.label` where `is_labelled`. Several coffees in one cell fan out around the cell's point.
2. The page has two modes, a toggle at the top: **Preview** (current evidence and parameters, the `*_preview` reads) and **Active version** (the cut the customers would see). Everything below the toggle follows it; the cut button lives in Preview mode only.
3. A lean decision is made inline on the placement row: the three lanes as buttons with the suggestion marked, a required basis text, saved through `PATCH /api/admin/map/lean/:coffeeId`. The archetype decision stays where it is today (Calibration workbench); the row links to it.
4. Parameters reuse `EvidenceParametersCard` with the `dial_` prefix (brief 1 Task 0 item 8 says whether the card or the endpoint needs the prefix); a change re-fetches the preview.

---

## Task 0 — Verify (write into `CLOSING_REPORT_2.md`; STOP after)

1. Brief 1's API as built: every `GET /api/admin/map/*` shape (field names, codes vs labels), the `PATCH /map/lean`, `POST /map/versions`, `/activate`, `PUT /map/first-match`, `PUT /map/phrases` bodies and their error codes. What `graphCheck` returns.
2. `AdminLayout.tsx` nav: where "Bloom Dial" sits under Catalogue & Supply; add "Ella's Bloom Map" beside it (the old entry stays).
3. `AdminCalibrationWorkbench.tsx`: how a decision with a basis is entered and shown (the pattern to copy for the lean); `EvidenceParametersCard.tsx` props; `bloomVisuals.ts` archetype colours; `LookupSelect`; `useArchetypes`.
4. `BloomDial.tsx`: what it draws for an archetype wedge and dot that can be reused as colour and typography tokens; do not reuse its geometry or rotation code.
5. Production, read-only: the preview row count and the active version (expect none).

## Task 0.5 — Dana's manual steps
None.

---

## Part A — Schema
None expected. If a read the page needs is missing from brief 1, add it to `dialReads` and its view, with `comments.sql` and `catalog:md`, and say so.

## Part B — Backend
Only what Task 0 item 1 shows is missing for the page; routes call `dialReads` / `dialPlacementService` / `catalogService.setLean`. No new writer.

## Part C — Frontend

C1 **`components/bloom/map/EllaMapFace.tsx`** per CTO call 1, plus `mapGeometry.ts` (wedge angles from `angle_order`, ring radii, lane offsets, fan-out) and a legend component (three dot sizes with the words from the API's size labels; archetype colours). Tap on a dot calls `onTapCoffee`. No gesture other than tap. Renders at `thumb` (fits a card header) and `full` (fills the column).

C2 **`admin/AdminEllaMap.tsx`** at `/admin/map`, nav entry beside Bloom Dial. Sections, top to bottom:
- **Mode toggle** (Preview | Active version) and, in Active mode, the active version's label, cut date, reason and parameter snapshot.
- **Face**: `EllaMapFace` full size with grades shown; tapping a dot scrolls to and highlights its placement row and shows its hop set under the face.
- **Placement table**: one row per catalog coffee from the preview (or the version): coffee, roaster, family (link to the Calibration workbench row), ruler and value, ring, lane decision with the inline decision control (CTO call 3) and the suggestion with both scores, size with sweetness, grade with sessions and cuppers, `is_sellable`, flags as chips, `inputs_used` expandable. Not-placeable coffees listed at the bottom with the reason. Sort and filter by family, flag, grade, sellable.
- **Parameters**: `EvidenceParametersCard` filtered to `dial_`; saving re-fetches the preview and the graph check.
- **Hops**: for the coffee selected on the face or the table: its bolder, gentler, different (ranked, with adjacency rank and distance), siblings, and which directions are edge states; every row shows the deltas the move line will use.
- **Graph check** (gate step 4): reachable from the center, unreachable sellable coffees, coffees with no bolder / gentler / different, roaster cousin pairs reproduced or not. Red when any sellable coffee of grade ≥ C is unreachable.
- **First match**: table of archetype × lane side → coffee with status; edit through `PUT /map/first-match`; a coffee under the grade floor is refused by the API and the message shown.
- **Phrases**: `dial_hop_phrase` rows (default and per family) editable through `PUT /map/phrases`; a live example rendered with a real edge ("Bolder than Tiger Stripe: darker roast, more body").
- **Versions**: list with status; in Preview mode the **Cut version** button (label and reason required) and, on a draft, **Activate** with a confirmation that names what changes (the active version, if any, is retired). Nothing in this brief makes any customer surface read the version.

C3 **Copy**: labels, status words, lane names, size words, grade descriptions all from the API; the page types in only chrome (button verbs, section headings).

---

## Part D — Tests
Vitest for any service function added; `mapGeometry` unit tests (angle per wedge, lane offsets, fan-out determinism). `tsc --noEmit` adds no error.

## Acceptance (local, signed in as admin, test DB)
- `/admin/map` renders the preview for every catalog coffee; the nine Joe coffees show the Rev 3 section 6 cells (with the differences brief 1 already listed); flags visible.
- A lean decision saved on Fabricator (middle, basis text) shows at once in the table and moves nothing else; the superseded row is visible in the row's history.
- Changing `dial_ring_cut_1` on the parameters card changes rings in Preview and not in Active.
- Graph check matches `dialReads.graphCheck` output from brief 1's closing report.
- Cut a version labelled `test-wb-1`, activate it, confirm Active mode shows it and Preview still changes with parameters; leave it active on the **test DB only**.
- Screenshots of the face at `full` and `thumb` in the closing report.

## Docs and closing (G6)
`WHAT_WE_BUILT.md`; `REGRESSION.md`: the page never writes a placement directly, parameters change the preview only, cut and activate are the only two version actions; `OPEN_TASKS.md`; `CLOSING_REPORT_2.md` with screenshots and what brief 3 needs (the `EllaMapFace` props as built, the API shapes).

## Do not
- Do not reuse `BloomDial.tsx` geometry, rotation or drag; do not add rotation or drag to `EllaMapFace`.
- Do not let the page write `dial_placement`, `coffee_archetype_assignment` or any parameter outside `evidence_parameter`.
- Do not build the customer page, the buttons or `matchService`; do not add a `dial_surface` switch; those are briefs 3 and 4.
- Do not type a threshold, label or coffee name into the frontend.
- Do not open a PR or hand Dana manual steps.
