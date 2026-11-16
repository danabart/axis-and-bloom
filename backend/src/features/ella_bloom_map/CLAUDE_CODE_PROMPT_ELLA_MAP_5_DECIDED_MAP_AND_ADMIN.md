# Claude Code brief. Ella's Bloom Map 5: the decided map and the simplified admin page

Workstream: ella_bloom_map (`README.md` here; briefs 1 to 3 and their closing reports are the system as built) · Written 2026-11-16 by the CTO session · Model: Sonnet · Dana runs it; push = deploy · **Test mode.** Admin only. No customer surface changes, no price, no SKU, no Stripe.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every word, basis, ring and size cut is a row; new numbers go in `evidence_parameter` with the `dial_` prefix) · G2.2 surrogate `id` PK on every new table · G2.3 prefixes `dial_` (map) and `coffee_` (a catalog decision) · G2.4 CATALOG.md checked (below) · G2.5 one writer per table, declared in `comments.sql` (`lint:lineage` green) · G2.7 vocabularies are lookup tables · G2.8 additive, idempotent schema · G2.11 retire, never delete · G2.12 evidence untouched, decisions are a separate layer · G2.17 `comments.sql` then `catalog:md`, commit `CATALOG.md` · G2.20 nothing a roaster gave us is edited · G3.1 routes call services · G3.6 admin gated server-side · G3.9 reuse, do not fork · G4.1 reuse `EllaMapFace` · G4.2 nothing typed in · G4.3 `tsc --noEmit` · G5.1 vitest · G1.6 push is deploy, one closing report.
Mode: test. STOP points: after Task 0; before any production data write (Part E).

**Goal.** Dana paused the map on 2026-11-14 because it had become too complicated. The map is assumption driven today, not data driven, so the page should say what was decided, not what was calculated. This brief (1) lets a coffee be placed and connected by decision alone, (2) enters the map Dana and the CTO session agreed on 2026-11-15 and 16 for the 18 Joe Bean and Joe Coffee coffees, and (3) rebuilds `/admin/map` as one map and two tables. Mockup: `map5_mockup_admin.png` in this folder. `map5_mockup_customer.png` is the next brief's page; it is here only so you can see what the data must serve.

**Decisions already made (Dana, 2026-11-15 and 2026-11-16; do not re-open).**

1. The five archetypes stay. Family is the wedge, lean is the lane, distance from Balanced is the ring, dot size is sweetness.
2. Knowledge about a coffee comes from the roastery: its notes and its 1 to 5 dimension ratings. Family, lean and ring are our assignment. Cupping and customer answers will confirm or replace a decision later.
3. Steps between coffees are decided rows, not calculated. A roaster's stated cousin proposes a step; our judgement can add one or veto one.
4. All 18 coffees in Data 1 are on the map and can be a first bag or a step, including the three Joe Bean singles that have not been cupped. Guessed steps show like any other step.
5. Utopian is paused: its coffees get no decision here and do not appear on the new version. Do not deactivate or edit anything of theirs in this brief.
6. The admin page may be replaced. **The customer Bloom page and every `dial_surface` row stay exactly as they are.** A new customer page is the next brief, and Dana switches when she says so.
7. The calculated machinery from briefs 1 to 3 (parameters, cuts, grades, lean suggestion, `v_dial_edge`, `v_dial_hop`, the graph check, the decisions log) is kept in the database and in code. The new page does not read it. Nothing is dropped.
8. The espresso tie-break (Tiger Stripe for an espresso drinker) is left out of this version.

CTO calls for this brief, reversible, flag if the code disagrees:

- **Ring is a decision, like lean already is.** A current ring decision wins over the calculated ring. With no ring decision the calculated ring is used as today.
- **A coffee is placeable when it has a current family, lean and ring decision**, with or without cupping. Missing dimension values stay NULL on the placement.
- **Dot size reads the roaster's own sweetness rating (1 to 5)** when the coffee has a submitted portal response, mapped to size 1 to 3 by two new parameters (`dial_size_roaster_cut_1` default 4, `dial_size_roaster_cut_2` default 5: below the first is size 1, from the first is size 2, from the second is size 3). With no roaster rating, size is NULL and the dot is drawn dashed. Pooled cupping sweetness no longer sets the size for a coffee that has a roaster rating.
- **A founder pick is never refused for its evidence grade.** If the first-match grade floor is a parameter, the brief lowers it to the lowest grade; if it is in code, move it to a `dial_` parameter with that default.

**CATALOG.md check (G2.4).** Objects considered for the three new tables:

- Steps. `coffee_hop` requires a `dimension_id` and a more or less direction, has no customer word and no basis, and is marked for retirement in brief 4. `v_dial_edge` and `v_dial_hop` are calculated from placements. `dial_hop_phrase` and `dial_move` hold the four calculated moves' words, not a relation between two coffees. Nothing stores "from this coffee, with this word, to that coffee, on this basis". New: `dial_step` and its lookup `dial_step_basis`.
- Ring. `dial_placement.ring` is a copy made at the cut, not a decision. `coffee_lean_assignment` is one fact (the lane). `dial_ring_cut` holds thresholds for the calculation. New: `coffee_ring_assignment`, the same shape and history pattern as `coffee_lean_assignment`.
- Everything else reuses what exists: `coffee_archetype_assignment`, `coffee_lean_assignment`, `dial_first_match`, `dial_map_version`, `dial_placement`, `dial_lane`, `dial_ring`, `dial_wedge`, `evidence_parameter`.

---

## Task 0: Verify (write into `CLOSING_REPORT_5.md`; STOP after)

Read-only. Test DB and production (through the proxy, `--expect-db axisandbloom`).

1. For each of the 18 coffees in Data 1: does a `coffees` row exist, is it active, which roaster, its current family (`coffee_archetype_assignment`), current lean, and whether it has a submitted roastery portal response with a Sweetness rating. List any coffee that has no `coffees` row. Do not create one; that is a STOP item for Dana.
2. `dial_wedge`: for each family, which neighbour is `side_a` and which is `side_b`. Data 1 and Data 3 name the lean by the neighbour family; translate with this.
3. `v_dial_placement_preview` and `dialPlacementService.cutVersion`: where ring, size and "placeable" are decided today, and the smallest change that makes a ring decision win and lets an uncupped coffee through. Say which you will do before Part A.
4. `dial_first_match` and `dialPlacementService.setFirstMatch`: the current rows, and where the grade floor lives.
5. `AdminEllaMap.tsx`, `EllaMapFace.tsx`, `mapGeometry.ts`, `lib/mapAdmin.ts`: the props and calls as built, and whether `EllaMapFace` can draw a line between two coffees with a style per line.
6. The active map version on production, and what reads it besides `/admin/map` and the admin-only `/map` page. Expect nothing customer facing (every `dial_surface` row on `lane`); if anything customer facing would change when a new version is activated, STOP.
7. Utopian coffees: active or not, placed in the active version or not. Report only.

## Task 0.5: Dana's manual steps
None.

---

## Part A: Schema (additive, idempotent; `comments.sql` for every object and column)

A1 **`dial_step_basis`** (lookup, G2.7): `id`, `code UNIQUE`, `label`, `sort_order`, `line_style` (the admin face's line for this basis: `solid`, `dashed`, `dotted`). Seed: `roaster_said` "Roaster said" solid, `recipe_or_ratings` "Recipe or ratings" dashed, `our_guess` "Our guess" dotted.

A2 **`dial_step`**: one decided step in one direction. `id`, `from_coffee_id` and `to_coffee_id` (FK `coffees.id`, ON DELETE RESTRICT, CHECK they differ), `button_word` (text, what the customer would say: "Bolder"), `customer_line` (text, nullable: the one thing that changes; when NULL the pages show the destination coffee's signature notes), `basis_id` (FK), `is_shown` (boolean, default true), `notes`, `decided_by`, `created_at`, `superseded_at`. One current row per ordered pair (partial unique index on `(from_coffee_id, to_coffee_id) WHERE superseded_at IS NULL`). A change supersedes and inserts, like `dial_first_match`.

A3 **`coffee_ring_assignment`**: `id`, `coffee_id` (FK, RESTRICT), `ring` (smallint, 0 for the center family only, else 1 to 3; validate against `dial_ring` and the family), `basis` (jsonb), `notes`, `decided_by`, `created_at`, `superseded_at`. One current row per coffee. Add its history view beside `v_coffee_lean_assignment_history` if that pattern is how lean history is read.

A4 **Placement input.** Per Task 0 item 3: the preview's ring is the current `coffee_ring_assignment.ring` when one exists, else the calculated ring. Placeable when family, lean and ring decisions are all current. Size per the CTO call. Add a flag `ring_decided` to the placement flags so the difference stays visible. The calculated ring stays available as the suggestion (store it beside the decision the way the lean suggestion is stored, if that is cheap; otherwise leave it out and say so).

A5 **Parameters**: `dial_size_roaster_cut_1`, `dial_size_roaster_cut_2` in `evidence_parameter`, and the first-match grade floor if it was in code.

A6 **`v_dial_step`**: current shown steps over the active version's placed coffees, with both coffee names, basis code, label and line style. This is the one read for steps (G2.5).

## Part B: Backend

B1 Writers, one each: `dialPlacementService.setStep` (supersede and insert; also used to switch `is_shown`), `catalogService.setRingInTx` (same pattern as `setLeanInTx`). Declare both in `comments.sql`.

B2 Reads in `dialReads`: `steps(mode)` from `v_dial_step`, and the ring decision on the placement read.

B3 Admin routes beside the existing map routes: `GET /api/admin/map/steps`, `PUT /api/admin/map/steps` (from, to, word, line, basis, shown), `PATCH /api/admin/map/ring/:coffeeId` (ring, basis text required). zod, admin gate, one service call each.

B4 **`POST /api/admin/map/publish`**: cuts a version from the current decisions and activates it in one call, by calling the existing `cutVersion` and activate functions (label and reason in the body). Reuse; do not fork.

B5 **Seed script** `backend/scripts/ellaMapDecided_2026_11_16.ts`: enters Data 1, 2 and 3 through the service functions (`setMatchArchetypeInTx` with source `manual`, `setLeanInTx`, `setRingInTx`, `setStep`, `setFirstMatch`), idempotent (running twice changes nothing), `--dry-run` prints what it would write. Every decision's notes say "Assumption map, CTO session 2026-11-15/16". It does not publish. Declared as a writer where the lineage lint needs it.

## Part C: Frontend

C1 **`EllaMapFace`** gains an optional `steps` prop (pairs with a line style) and draws one line per pair under the dots. Names on. A coffee with no size is a dashed outline. Nothing else about the face changes; the customer use of the face is untouched.

C2 **`admin/AdminEllaMap.tsx`** is rebuilt as the mockup. Top to bottom:

- Title, and the active version's label and date in one quiet line.
- **The map**: every placed coffee, every shown step, the legend (three line styles from `dial_step_basis`, dot size, dashed dot).
- **Tap a coffee** opens one card: name, roaster, the roaster's notes and 1 to 5 ratings (read only), family (link to the Calibration workbench, as today), lean (the three lane buttons, as today), ring (buttons 1 to 3, or "center"), a required basis text for a change, and that coffee's steps.
- **Table 1, where each quiz result starts**: the current `dial_first_match` rows as "quiz result, first bag", editable through the existing `PUT /map/first-match`.
- **Table 2, steps between coffees**: from, word, to, basis chip, shown or not. A row opens to edit the word, the customer line and the basis, and shows the step back beside it. Rows sort by basis order, then from.
- **Publish this map**: one button, asks for a short reason, calls B4. A line under it says what is unpublished (count of decisions newer than the active version).

C3 **The old page moves, it is not deleted.** Today's `AdminEllaMap` becomes `/admin/map/advanced` (Preview and Active modes, placement table, parameters, hops, graph check, phrases, versions, surfaces, decisions, customer words), reachable from one quiet "Advanced" link on the new page. No behaviour change there.

C4 Labels, basis words, lane and ring words come from the API. The page types in only chrome (headings, button verbs).

## Part D: Tests

Vitest: `setStep` (supersede, one current row per ordered pair, `is_shown`), `setRingInTx` (one current row, ring 0 only for the center family), the placement input (ring decision wins; an uncupped coffee with three decisions is placeable; size from a roaster rating at each cut; NULL size with no rating), `publish` (one version cut and active, the previous one retired), the seed script run twice. `tsc --noEmit` adds no error. All lints green.

## Part E: Data (test DB first; production only after Dana's yes)

1. Test DB: run the seed script, publish as "L1 assumption map", run Acceptance.
2. **STOP.** Show Dana the dry-run output against production and the list from Task 0 item 1. After her yes: run the seed script on production, then publish on production with the same label. Nothing customer facing reads it (Task 0 item 6).

### Data 1: the 18 coffees (family, lean, ring)

Lean is named by the neighbour family it leans toward; translate to `side_a` / `side_b` with Task 0 item 2. For Balanced the lean is the direction inside the center.

| Coffee | Roaster | Family | Lean | Ring |
|---|---|---|---|---|
| Benchmark | Joe Coffee | Balanced | toward Chocolate & Nutty | 0 |
| Half Moon | Joe Coffee | Balanced | toward Chocolate & Nutty | 0 |
| The Daily | Joe Coffee | Chocolate & Nutty | middle | 1 |
| Brazil (single origin) | Joe Bean | Chocolate & Nutty | middle | 1 |
| Fabricator | Joe Bean | Chocolate & Nutty | toward Fruity | 1 |
| Tiger Stripe | Joe Bean | Chocolate & Nutty | toward Fruity | 2 |
| Blossom | Joe Bean | Chocolate & Nutty | toward Fruity | 3 |
| The Waverly | Joe Coffee | Chocolate & Nutty | toward Fruity | 3 |
| Nightcap Decaf | Joe Coffee | Chocolate & Nutty | toward Earthy | 1 |
| Amsterdam | Joe Coffee | Chocolate & Nutty | toward Earthy | 2 |
| Great Heights | Joe Coffee | Chocolate & Nutty | toward Earthy | 3 |
| Big City | Joe Coffee | Earthy | toward Chocolate & Nutty | 2 |
| Indonesia (single origin) | Joe Bean | Earthy | middle | 2 |
| Geometric | Joe Bean | Fruity | toward Chocolate & Nutty | 1 |
| La Familia | Joe Coffee | Fruity | toward Floral | 1 |
| D.R. Congo (single origin) | Joe Bean | Fruity | middle | 1 |
| Cafè Feminista | Joe Coffee | Fruity | middle | 2 |
| The Village | Joe Coffee | Floral | toward Fruity | 2 |

Where a coffee already has this family or lean, write nothing for that fact. Where it differs, the new decision supersedes the old one (history kept).

### Data 2: steps (each pair is two `dial_step` rows, one per direction)

| # | From → To | Word | Customer line | Back: word | Back: customer line | Basis |
|---|---|---|---|---|---|---|
| 1 | Benchmark → The Daily | Bolder | The same chocolate, livelier, with a bit more bite. | Lighter | Rounder, pure chocolate. | roaster_said |
| 2 | The Daily → Amsterdam | Bolder | Darker and smoother, with less acidity. | Lighter | Lighter and sweeter. | recipe_or_ratings |
| 3 | Amsterdam → Great Heights | Bolder | The same Brazil, roasted darker. | Lighter | A lighter roast, with more caramel. | recipe_or_ratings |
| 4 | Great Heights → Big City | Bolder | French roast and burnt sugar. | Lighter | Less smoke, more fudge. | roaster_said |
| 5 | Benchmark → La Familia | Brighter | Caramel and honey with a little clementine. Lighter in the cup. | More body | Pure chocolate, rounder, less fruit. | recipe_or_ratings |
| 6 | La Familia → The Village | More delicate | More floral and more citrus. | Sweeter | Caramel and honey, softer. | roaster_said |
| 7 | The Village → Cafè Feminista | More tropical | Papaya and candied coconut, creamier. | More delicate | More floral, with grapefruit. | roaster_said |
| 8 | Fabricator → Geometric | More fruit | The same family with more fruit, and sweeter. | Less fruit | Drier and nuttier. | roaster_said |
| 9 | Fabricator → Brazil | Simpler | The base on its own: chocolate, almond, honey. | More going on | Adds citrus and spice. | recipe_or_ratings |
| 10 | Brazil → Blossom | Bolder | A darker roast with a fuller body. | Lighter | Lighter, plain chocolate. | recipe_or_ratings |
| 11 | Blossom → Tiger Stripe | Brighter | A lighter roast with more fruit. | Bolder | A darker roast with a fuller body. | roaster_said |
| 12 | Tiger Stripe → Geometric | More fruit | More fruit, and sweeter. | More body | More chocolate and body. | recipe_or_ratings |
| 13 | Half Moon → Nightcap Decaf | No caffeine | Almond, molasses, cola. | Half the caffeine | Walnut and toffee. | roaster_said |
| 14 | La Familia → Geometric | More body, keep the fruit | Bright fruit over caramel, with more weight. | Lighter | Sweeter and lighter: caramel and honey. | our_guess |
| 15 | Benchmark → Fabricator | More going on | Hazelnut, a little citrus, a dry finish. | Rounder | Pure chocolate, softer, no citrus. | our_guess |
| 16 | Tiger Stripe → The Waverly | More fruit | Fig and orange over dark chocolate. | Less fruit | Chocolate first, cherry behind. | our_guess |
| 17 | D.R. Congo → Geometric | More body | (NULL: show Geometric's notes) | Lighter | (NULL: show D.R. Congo's notes) | our_guess |
| 18 | Blossom → Indonesia | Earthier | (NULL: show Indonesia's notes) | Cleaner | (NULL: show Blossom's notes) | our_guess |

Not a step, on purpose: The Waverly and Amsterdam. Joe Coffee names them cousins; Dana's cupping says they are not neighbours. Leave the roaster's answer as received (G2.20) and write no `dial_step` row.

### Data 3: where each quiz result starts (`dial_first_match`, status `founder_pick`)

| Family | Lean asked | First bag |
|---|---|---|
| Balanced | toward Chocolate & Nutty, and middle | Benchmark |
| Balanced | toward Fruity | La Familia |
| Chocolate & Nutty | middle | The Daily |
| Chocolate & Nutty | toward Fruity | Fabricator |
| Chocolate & Nutty | toward Earthy | Amsterdam |
| Earthy | every lane | Amsterdam |
| Fruity | toward Chocolate & Nutty | Geometric |
| Fruity | middle, and toward Floral | Cafè Feminista |
| Floral | every lane | The Village |

The rule that turns a quiz result into a family and a lean is the next brief. This brief writes the rows only and does not change `matchService`.

---

## Acceptance (local, signed in as admin, test DB)

- `/admin/map` shows 18 coffees in the cells of Data 1 and 18 lines in three styles, matching `map5_mockup_admin.png` in substance (exact dot positions inside a cell are the face's fan-out, not the mockup's).
- The three uncupped Joe Bean singles are placed. Coffees with no roaster Sweetness rating are dashed; list which ones.
- Table 1 shows the rows of Data 3; table 2 shows 36 rows.
- Changing Blossom's ring from 3 to 2 with a basis text, then Publish, moves the dot and adds a version; the earlier decision is in the history.
- Switching step 18 to not shown removes its line after Publish and removes nothing from the table.
- `/admin/map/advanced` renders the old page unchanged.
- The customer Bloom page, the quiz result and the profile render exactly as before; every `dial_surface` row still says `lane`.
- Screenshot of the new page in the closing report.

## Docs and closing (G6)

`README.md` here: add this brief as number 5 and note that the next brief is the customer page (first bag, steps, trail, the quiz-to-lean rule, prices). `WHAT_WE_BUILT.md`; `WHAT_WE_BUILT_DB.md` one "As of" line; `comments.sql` then `npm run catalog:md -- --expect-db axisandbloom` and commit `CATALOG.md`; `REGRESSION.md` (a ring decision wins over the calculated ring; a step exists only as a `dial_step` row; publish is the only way a decision reaches the active map; nothing here changes a customer surface); `OPEN_TASKS.md` (espresso tie-break; ordering of two coffees inside one lane, Blossom has less fruit than Tiger Stripe and the cell cannot say so); `CLOSING_REPORT_5.md` with Task 0, the dry-run, evidence, deviations, and what the customer-page brief needs (the `v_dial_step` shape, the face's `steps` prop).

## Do not

- Do not change, switch or restyle any customer page, `dial_surface` row, `matchService`, the quiz, or the lane dial.
- Do not touch prices, SKUs, sizes, Stripe or ShipStation.
- Do not drop, rename or stop computing anything from briefs 1 to 3.
- Do not create, retire or edit a `coffees` row, a roastery, or anything a roastery submitted.
- Do not write production before the STOP in Part E.
- Do not put a word, a basis, a ring or a cut in code or in a view body.
