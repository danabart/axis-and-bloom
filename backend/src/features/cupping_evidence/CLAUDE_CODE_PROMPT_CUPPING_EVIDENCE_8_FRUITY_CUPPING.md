# Cupping Evidence, brief 8: load the Fruity cupping of 2026-11-06 (one cross-roaster session, Dana + Camila, five coffees already in the catalog), then retire Utopian. Data only, plus one deactivation Dana presses herself.

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-11-08 (CTO session; decisions by Dana) · Model: Sonnet is fine · Mode: test first, then live on Dana's go
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v4 and **brief 7** (`CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_7_EARTHY_CUPPING.md`), which this brief repeats with a different sheet set: same loader shape (`load/loadCuppingEvidence7.ts` is the template), same decisions 1 to 11 of brief 5 unless a line below says otherwise. Brief 2's decisions 1 to 7, 11, 12, 15, 17, 18, 19 apply as they did in briefs 5 and 7. No schema, no new table, no view, no catalog change of any kind from the loader (no assignment, placement, price, SKU, roaster-word mapping, portal row). The pooled range (brief 6) absorbs this session by itself.
> Part C is new to this series: Utopian has stopped working with us. Their cupping is loaded first (Parts A, B), then Dana deactivates the roastery through the existing soft-deactivation (`catalogService.deactivateRoastery`, `/admin/roasters`, WHAT_WE_BUILT #170) Their portal link stays live (Dana, 2026-11-08: she still wants to use it). Nothing is deleted.
> Status: **DONE 2026-11-08** on test and prod (prod session 42; loader `load/loadCuppingEvidence8.ts`). Decisions 7 (fruity ×5) and 8 (4) as ruled. Utopian deactivated by Dana 2026-11-09 02:33 UTC; portal link kept live (G2.20). Closing report: `CLOSING_REPORT_8.md`.

**Guardrails (`DEVELOPMENT_GUARDRAILS.md`).** Read it before Task 0. This brief touches:
G2.5 one writer: `cuppingService` / `noteMappingService` only, no SQL in the loader (`lint:lineage`, `lint:cupping`) · G2.11 Utopian is retired, not deleted (the existing cascade; no row removed anywhere) · G2.12 evidence is insert-only: Utopian's sessions, scores, remarks and portal answers stay as written after the deactivation · G2.20 we never touch data we received: Utopian's portal link, lineup and answers stay exactly as they are · G3.3 idempotent by natural key, second run writes nothing · G1.5 / G1.6 one run, one closing report, push is deploy (there is no code change beyond the loader and the npm script) · G1.10 Dana does no manual ops: her two steps are production buttons (Task 0.5).
Mode: test, then live. STOP points: (1) after the test closing report, for Dana's go to prod; (2) after the prod load and the deactivation preview, for Dana to press Deactivate; then verify.

## What this is

On 2026-11-06 Dana and Camila cupped the fruity end of the dial side by side: Utopian **Flying Jewel** (coffee 2891, last cupped session 35), Utopian **Pearl** (2933, session 35), Joe Bean **Geometric Filter Coffee** (2915, session 37, blind), Joe Coffee **The Village** (2904, session 36, Dana only) and Joe Coffee **Cafè Feminista: Montze Olvera** (2902, session 36, Dana only). Source: `misc/roasteries/Cupping/Fruity Cupping/Fruity Cupping - Nov 6 2026 - Dana and Camila.pdf` (CamScanner, 6 pages, every page printed "Sheet 1 of 4": Dana pages 1 to 3 = Flying Jewel / Pearl, Geometric / The Village, Feminista / an abandoned form; Camila pages 4 to 6 = Feminista / blank, Flying Jewel / Pearl, Geometric / The Village). The printed sheet is `ab_0_15_8dim`, native `ab_0_15` for both cuppers.

Every value below was transcribed from the scan by the CTO session and checked by a blind second read (two independent readers, 2026-11-08; the diff is in `TRANSCRIPTION_CHECK_BRIEF_8_2026-11-08.md`). Load as written; do not reinterpret a number or a word.

New in this session: Dana marked most lines as a **span** (two live circles), so most of her values are ranges (brief 5 decision 6: two live circles = the span; `raw_value` = `'<min>-<max>'`). Every earlier session on these five coffees is native `ab_0_15` (sessions 35, 36, 37; Flying Jewel's legacy row 69 is superseded), so after this load the pooled range is all `ab_0_15` for all five and `refreshDialSignal` records a signal for each. For The Village and Feminista this is the first session with Camila. All five will show "newer evidence than the decision".

## Decisions (Dana, 2026-11-08). Do not re-open.

1. **One new session**: `sheetFormat: 'ab_0_15_8dim'`, `sessionDate: '2026-11-06'`, `sessionDatePrecision: 'exact'`, `isBlind: false` (no blind codes, coffee and roaster names filled in by both cuppers, Blind Y/N not ticked anywhere), `roasterPresent: false`, `location: null`, `recordSource: 'paper: Fruity Cupping - Nov 6 2026 - Dana and Camila.pdf (6 pages; misc/roasteries/Cupping/Fruity Cupping)'`, `transcribedBy: 'Claude (CTO session)'`, `transcribedAt: '2026-11-08'`, `checkedBy: 'blind second read 2026-11-08 (TRANSCRIPTION_CHECK_BRIEF_8_2026-11-08.md)'`, `sessionNotes: 'Fruity cupping: five coffees from three roasteries cupped side by side at the fruity end of the dial (Flying Jewel, Pearl, Geometric, The Village, Feminista). All five cupped before (sessions 35, 36, 37). Not blind. Ratio, grind, water temp, steep, cups not recorded. Dana marked spans (two circles) on most lines. No archetype call on the call line by either cupper; Dana ruled 2026-11-08 that her call is fruity for all five (see call notes); Camila boxed "THE CITRUS" under Pearl\'s family boxes. Dana\'s page 3 sample 2 was started and abandoned (Fragrance 7-9 marked, words struck, no coffee named): not loaded. Camila\'s page 5 is undated. Last session with Utopian before the roastery was retired (2026-11-08). Merged by rule (union, n = 2).'`
2. **Brew**: `brewDefaults: { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl', notes: 'standard A&B cupping protocol (Dana, 2026-10-16); grind, temperature and steep time not recorded on the sheets' }`.
3. **Cross-roaster**, per-sample roaster as in brief 5: `('Utopian', 'Flying Jewel')`, `('Utopian', 'Pearl')`, `('Joe Bean Roasters', 'Geometric Filter Coffee')`, `('Joe Coffee Company', 'The Village')`, `('Joe Coffee Company', 'Cafè Feminista: Montze Olvera')`. Resolve at run time, exactly one row each or STOP. The loader's roaster precondition (all three active) stays as in loader 7: this is why every loader run, including the second "already loaded" runs and the loader 5 / 7 checks, happens **before** Part C.
4. **Display order** = Dana's pages: 1 Flying Jewel, 2 Pearl, 3 Geometric, 4 The Village, 5 Feminista. `sample_note` per session coffee: `'Dana page N sample M; Camila page N sample M'` (Flying Jewel: Dana p1 s1, Camila p5 s1; Pearl: Dana p1 s2, Camila p5 s2; Geometric: Dana p2 s1, Camila p6 s1; The Village: Dana p2 s2, Camila p6 s2; Feminista: Dana p3 s1, Camila p4 s1).
5. **Rows**: ten cupper rows, five merged rows, `mergeByRule(…, { n: 2 })`. No supersede.
6. **Marks**: brief 2 decision 2 and brief 5 decision 6 (struck, X'd and ghosted marks never counted, named in `raw_value`; two live circles = the span; struck words `~word`, never a descriptor). An underline beneath a circle is not a strike (Camila / Flying Jewel / Fragrance).
7. **Calls.** The Archetype call line is blank on all ten samples. **Dana ruled 2026-11-08: "They are all fruity."** Her five rows get `archetype_call = 'fruity'`, `position_call` null; her flavor-notes line (where there is one) goes in `call_note` as written. Camila's rows: `archetype_call` null; "THE CITRUS" (Pearl) and "↳ balanced" (Feminista) are `call_note`s. Merged call `fruity` ×5 (a cupper with no call does not block one). `archetype_call_secondary` and `slot_call_id` null everywhere. No loader flag: the ruling is made.
8. **One cell for Dana (same shape as brief 5's Fabricator Bitterness)**: Camila / Pearl / Sweetness. The oval at 4 has three short strokes across its left half; the mark at 8–9 is heavily scribbled out. **Default: 4 is live** (an oval drawn over light strokes, as Dana confirmed for Fabricator), `raw_value` `'4; oval over three light strokes read as live; mark at 8-9 scribbled out'`. If Dana rules the 4 struck, the line has no row and Sweetness becomes a one-cupper dimension on Pearl. The loader carries this as `PEARL_CAMILA_SWEETNESS: 4 | null` and refuses to run while it is unset; the brief's default is 4.
9. **Words → SCA node**, brief 5 decision 8 (most specific node named, never deeper; containment; no node → `notes` only). New cupper conventions this brief writes (`source_kind = 'cupper'`, `note = 'loader 2026-11-08; rule: <exact | node | contains>'`, only where no cupper row exists yet; an existing row wins and is not rewritten; every word the loader resolves through the table gets a cupper row, as ruled in brief 5):
   - `orange` → **Orange** (leaf; exact) · `lemon` → Lemon (existing, brief 7) · `clementine` → **Citrus Fruit** (tier 2; contains, as the roaster row of brief 2) · `bergamote` → **Citrus Fruit** (tier 2; contains; SCA has no bergamot leaf) · `citrus` → Citrus Fruit (existing)
   - `grape` → **Grape** (leaf; exact) · `coconut` → **Coconut** (leaf; exact) · `papaya` → **Other Fruit** (tier 2; contains, as the roaster row of brief 2) · `strawberry` → Strawberry (existing) · `strawberry juice` → **Strawberry** (leaf; contains) · `berries` → Berry (existing)
   - `fruit`, `fruits`, `gentle fruit`, `light fruit`, `sweet fruit`, `creamy fruit`, `fruit sweetness` → **Fruity** (tier 1; contains, like `light fruity` in brief 5) · `fruity` → Fruity (existing)
   - `toffee` → **Brown Sugar** (tier 2; node, as the roaster row of brief 2) · `honey` → Honey (existing) · `sugar` → Sweet (existing, brief 5)
   - `choc`, `a bit chocolate` → **Chocolate** (contains) · `chocolate` → Chocolate (existing) · `cocoa` → Cocoa (existing)
   - `spice` → Brown Spice (existing) · `smoky` → Smoky (existing)
   - No node, text only: `sweet`, `acid`, `bright`, `silky`, `milk`, `cream`, `creamy`, `full`, `a bit heavy`, `balanced`, `like`, the `8` after bergamote, and the scribbled-out word on Camila's Village aroma.
   - `strawberry acid` on Dana's Feminista Acidity line describes the acidity (strawberry-like), as `banana` did in brief 5: Acidity row `notes`, no descriptor, no mapping.
10. **Order, loader, test-first**: brief 5 decisions 9 to 11. New script `load/loadCuppingEvidence8.ts`, `npm run load:cupping-evidence-8`; loaders 5 and 7 must still report `already loaded` end to end on test (run them before Part C; afterwards they refuse on the active-roaster precondition, which is expected and not to be relaxed).
11. **Utopian** (Part C): retired through the existing soft-deactivation, by Dana, after the prod load. Their evidence (sessions 35, 38, 39, 40, 41 and this one), remarks, portal lineup and answers, orders and QR tokens stay exactly as they are. Their portal link is **not** revoked (Dana, 2026-11-08: "I still want to use this"; G2.20, we never touch data we received). The slots and defaults that go empty are Dana's placement pass, not this brief's.

## PART A: the session
`createSession` (decisions 1, 2), `addSessionCoffee` ×5 (decisions 3, 4). Expected: 1 session, 5 session coffees, 5 brew rows.

## PART B: cupper rows

Dimension ids as before: 1 Fragrance, 2 Aroma, 3 Flavor, 4 Sweetness, 5 Acidity, 6 Bitterness, 7 Body, 10 Finish Length, 11 Finish Character (aftertaste words), 12 Mouthfeel words.

### B1. Numeric values (0 to 15, native). `–` = no row. A span is `min–max` (`raw_value` `'<min>-<max>'`); `raw_value` spelled out only where it differs from `'<v>'` / `'<min>-<max>'`.

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|---|---|---|
| Flying Jewel | Dana | 9–10, raw `9-10; mark at 13 X'd out` | 8–9 | 8–10 | 10–12 | 5–6 | 0 | 10 | 10–12 |
| Flying Jewel | Camila | 4–6, raw `4-6; the 4 is underlined, not struck` | 8, raw `8; oval encloses the 8, spans toward 9` | 4 | 7, raw `7; marks at 2 and 4 scribbled out` | 5 | 2 | 4 | 4 |
| Pearl | Dana | 9–10, raw `9-10; mark at 13 X'd out` | 7–8 | 10–12 | 12–14 | 4, raw `4; mark at 2 scribbled out` | 0 | 8–10 | 7–9 |
| Pearl | Camila | 5 | 8, raw `8; oval encloses the 8, spans toward 9` | 5 | 9, raw `9; mark at 1 scribbled out` | **4** (decision 8), raw `4; oval over three light strokes read as live; mark at 8-9 scribbled out` | 0 | 2 | 4 |
| Geometric | Dana | 9–11 | 6–8 | 7–8 | 6–7, raw `6-7; mark at 4 X'd out` | 5, raw `5; mark at 7 scribbled out` | 0 | 8–10 | 8–9, raw `8-9; mark at 11 X'd out` |
| Geometric | Camila | 8, raw `8; marks at 5 and 7 scribbled out` | 8 | 6 | 5, raw `5; mark at 2 scribbled out` | 6 | 0 | 8, raw `8; mark at 3-4 scribbled out` | 5 |
| The Village | Dana | 6–8 | 5–7 | 7–8, raw `7-8; mark at 9 X'd out` | 4–5, raw `4-5; mark at 7 X'd out` | 5–7 | 1–2, raw `1-2; mark at 3 scribbled out, mark at 5 X'd out` | 7–8 | 5, raw `5; marks at 8 and 10 X'd out` |
| The Village | Camila | 9, raw `9; the figure 9 written above the line over a scribbled-out mark at 8-9; mark at 6 scribbled out` | 9 | 7 | 3 | 6 | 0 | 5 | 3 |
| Feminista | Dana | 9–11, raw `9-11; faint stroke at 7, not a mark` | 8–10 | 8–10 | 9, raw `9; mark at 5 scribbled out, mark at 7 X'd out`, notes `strawberry acid (acidity character; Dana 2026-11-06)` | 8–10 | 0 | 8–10 | 8–10 |
| Feminista | Camila | 10, raw `10; mark at 7 scribbled out` | 10 | 6 | 9, raw `9; marks at 4 and 6 scribbled out` | 7 | 0, raw `0; mark at 2-3 scribbled out` | 7 | 6 |

Both cuppers marked every line on every sheet, so every row has eight numeric values (no one-cupper dimensions, unless decision 8 goes the other way on Pearl's Sweetness). Three readers agree on all 80 cells after the rulings in the check file (Camila's two aroma ovals read as 8; Dana's lighter circles at 9 on Geometric and Feminista are the scan, both pairs live).

### B2. Words on 1, 2, 3, 11, 12 (`notes`; verbatim, lower-cased, spelling kept except where noted)

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 12 Mouthfeel | 11 Finish Character |
|---|---|---|---|---|---|---|
| Flying Jewel | Dana | cocoa, fruity, sweet | cocoa, berries | citrus | – | acid - bright |
| Flying Jewel | Camila | berries / chocolate | fruits / sugar | berries / cream | – | light fruit |
| Pearl | Dana | sweet, citrus - maybe orange li… (cut off at the page edge) | sweet, lemon | citrus - orange or clementine | – | bright - citrus |
| Pearl | Camila | fruity citrus | sweet / clementine | clementine? | – | – |
| Geometric | Dana | strawberry, sweet | sweet - toffee | strawberry, fruit sweetness | ~silky | bright and sweet (a "-" written under bright, a "+" under sweet) |
| Geometric | Camila | berries / a bit chocolate | strawberry / choc / honey | strawberry juice / honey | – | honey |
| The Village | Dana | spice, | gentle fruit - grape | gentle fruit, | silky | sweet ~and ~bright |
| The Village | Camila | smoky | sweet / sugar / ~(scribbled out, unreadable) | bergamote / 8 | creamy | – |
| Feminista | Dana | fruit - coconut | milk, sweet - papaya | fruit - maybe papaya | full or a bit heavy | sweet |
| Feminista | Camila | fruits / sweet | honey / sweet | fruity / creamy fruit … (one word cut off at the page edge), "↳ balanced" written under it | – | sweet fruit |

### B3. Descriptors (node ← words; a struck word never makes a row)

| coffee | cupper | node ← words |
|---|---|---|
| Flying Jewel | Dana | Cocoa ← cocoa (fragrance, aroma) · Fruity ← fruity · Berry ← berries · Citrus Fruit ← citrus |
| Flying Jewel | Camila | Berry ← berries (fragrance, flavor) · Chocolate ← chocolate · Fruity ← fruits, light fruit · Sweet ← sugar |
| Pearl | Dana | Citrus Fruit ← citrus (fragrance, flavor, aftertaste), clementine · Orange ← orange (fragrance, flavor) · Lemon ← lemon |
| Pearl | Camila | Fruity ← fruity · Citrus Fruit ← citrus, clementine (aroma, flavor) |
| Geometric | Dana | Strawberry ← strawberry (fragrance, flavor) · Brown Sugar ← toffee · Fruity ← fruit sweetness (silky is struck: no row, and no node anyway) |
| Geometric | Camila | Berry ← berries · Chocolate ← a bit chocolate, choc · Strawberry ← strawberry, strawberry juice · Honey ← honey (aroma, flavor, aftertaste) |
| The Village | Dana | Brown Spice ← spice · Fruity ← gentle fruit (aroma, flavor) · Grape ← grape (bright is struck on the aftertaste line; text only anyway) |
| The Village | Camila | Smoky ← smoky · Sweet ← sugar · Citrus Fruit ← bergamote (the scribbled aroma word: no row) |
| Feminista | Dana | Fruity ← fruit (fragrance, flavor) · Coconut ← coconut · Other Fruit ← papaya (aroma, flavor) (strawberry acid: Acidity note, no row) |
| Feminista | Camila | Fruity ← fruits, fruity, creamy fruit, sweet fruit · Honey ← honey |

### B4. Call columns, `call_note`, `overall_notes`

| coffee | cupper | archetype_call | call_note | overall_notes |
|---|---|---|---|---|
| Flying Jewel | Dana | fruity | call line blank; fruity ruled by Dana 2026-11-08 ("They are all fruity"); flavor notes (hot): "Very similar to pearl."; no family ticked | |
| Flying Jewel | Camila | null | no call; no family ticked | |
| Pearl | Dana | fruity | call line blank; fruity ruled by Dana 2026-11-08; flavor notes (hot): "this is very citrus. Both of utopian are almost the same."; no family ticked | |
| Pearl | Camila | null | no call; "THE CITRUS" written in capitals in a hand-drawn box under the family boxes; no box ticked | |
| Geometric | Dana | fruity | call line blank; fruity ruled by Dana 2026-11-08; flavor notes (hot): "this is more on the sweet side"; no family ticked | |
| Geometric | Camila | null | no call; no family ticked | |
| The Village | Dana | fruity | call line blank; fruity ruled by Dana 2026-11-08; flavor notes (hot): "This is gentle fruity. Its more balanced cup."; no family ticked | |
| The Village | Camila | null | no call; no family ticked | Aroma: third word scribbled out, unreadable; no row for it. |
| Feminista | Dana | fruity | call line blank; fruity ruled by Dana 2026-11-08; flavor notes blank; no family ticked | Her page 3 sample 2 (no coffee named) was started and abandoned: Fragrance 7-9 marked, "cocoa, fruits - coconut" and "milk" struck; not loaded. |
| Feminista | Camila | null | no call; "↳ balanced" written under the flavor words; no family ticked | |

`position_call`, `archetype_call_secondary`, `slot_call_id`: null everywhere.

### B5. Merge
`mergeByRule` ×5. Expected disagreement lists with `cupper_gap = 2` (gap between the two ranges greater than 2), from B1; the test run must reproduce them or the closing report explains the cell:

| coffee | cupper disagreement (gap > 2) | one cupper only |
|---|---|---|
| Flying Jewel | Fragrance (9–10 vs 4–6), Flavor (8–10 vs 4), Acidity (10–12 vs 7), Body (10 vs 4), Finish Length (10–12 vs 4); Bitterness (0 vs 2: gap 2, **not**) | none |
| Pearl | Fragrance (9–10 vs 5), Flavor (10–12 vs 5), Acidity (12–14 vs 9), Body (8–10 vs 2), Finish Length (7–9 vs 4) | none (Sweetness, if decision 8 goes to null) |
| Geometric | Finish Length (8–9 vs 5) | none |
| The Village | none (largest gaps 2: Aroma 5–7 vs 9, Body 7–8 vs 5, Finish Length 5 vs 3) | none |
| Feminista | none (largest gaps 2: Flavor 8–10 vs 6, Finish Length 8–10 vs 6) | none |

Merged `archetype_call`: fruity ×5 (decision 7). Dial signal: fires for all five (every pooled session native `ab_0_15`); the closing report records the row before and after per coffee. Flying Jewel's and Pearl's signals are recorded and then the coffees go inactive in Part C; the rows stay (evidence).

## PART C: retire Utopian (after the prod load; Dana presses the buttons)

Utopian roaster id `bbf250d1-e433-4233-a30b-437fe62bcc4a` (loader 2's map; confirm by name in Task 0). The cascade already exists: `catalogService.deactivateRoastery` (roaster, coffees, SKUs, slot assignments; reason stamped `'roaster'`; already-inactive rows skipped) behind `POST /api/admin/roasters/:id/deactivate`, with `GET …/deactivation-preview` and the `/admin/roasters` dialog (#170, first real use Temecula). The portal link is left alone. Nothing new is built here.

**C1 (Claude Code, read-only, after both prod loader runs and the loader 5 / 7 checks):** fetch the deactivation preview for Utopian and paste it whole into the closing report: coffees (with home archetype, default, guest positions), SKUs and slot assignments counts, `slotsGoingEmpty`, `archetypesLosingDefault`, `hopsGoingDark`, `openOrderLines`, `activeSubscribersOnTheseSlots`, `alreadyManuallyInactive`. Also list the Utopian rows that will **not** change: cupping sessions 35, 38, 39 (and their coffees in 40, 41, this one), `cupping_scores` count, `roastery_remark` count, portal lineup and response counts, order lines. **STOP** there.

**C2 (Dana, Task 0.5):** `/admin/roasters` → Utopian → `Deactivate…` (note: whatever she types; suggestion "stopped working with us, 2026-11"). Dana says done. The portal link is not touched.

**C3 (Claude Code, read-only verify):** `roaster.is_active = false` with `deactivated_at` and the note; cascade counts equal the preview; every touched row stamped `deactivation_reason = 'roaster'`; the counts from C1 unchanged (sessions, scores, remarks, portal rows, orders); the portal link still unrevoked; `runCatalogIntegrityChecks()` and `evidenceIntegrity` output before and after (check #6's Flying Jewel line may change; say what happened, change nothing); the fruity dial on the public site renders its empty slots with the existing empty-slot state; a Flying Jewel `/coffee/2891/story` by id still serves (owned-bag rule, #170 decision 5); loaders 5, 7, 8 now refuse on their active-roaster precondition (expected; say so, do not relax it). The slots going empty and the archetypes losing their default go to `OPEN_TASKS.md` as Dana's placement pass, one line.

## CONSTRAINTS
As brief 7: services only, no SQL, cupper ids, no catalog write from the loader, no row of sessions 35 to 41 touched, lints and build green, integrity green, nothing deleted, test DB twice then STOP for Dana's go, commits straight to main (loader, npm script, status lines, `WHAT_WE_BUILT*.md`, README line, `OPEN_TASKS.md` line, `REGRESSION.md` unchanged unless Part C shows a gap, `CLOSING_REPORT_8.md`). Part C writes nothing from Claude Code; the two writes are Dana's buttons. Reactivation stays available (`POST …/reactivate`) and is not exercised.

## DONE =
One new session (2026-11-06, `ab_0_15_8dim`, not blind) with 5 session coffees in Dana's order and 5 brew rows; 10 cupper rows and 5 merged rows exactly as B1 to B4 (decision 8 as ruled); disagreement lists as B5 (or explained); 5 dial signal rows recorded; the new cupper mappings of decision 9 and no other mapping row; pooled ranges for the five coffees now include this session; `evidence_newer_than_decision = true` for all five; sessions 35 to 41 unchanged; second run writes nothing; loaders 5 and 7 `already loaded` before Part C. Then Utopian inactive with its cascade verified, its portal link still live, all its evidence counts unchanged.

Closing report: session id; session coffee ids with sample notes; score ids per cupper and merged with `merge_note`; decisions 7 and 8 as ruled; mapping rows written and words left unmapped; dial signal rows before and after for the five; the pooled range and `session_weights` for Flying Jewel and The Village; `evidenceIntegrity` output; the workbench URLs (Utopian `/admin/roastery-portal?roastery=bbf250d1-e433-4233-a30b-437fe62bcc4a&view=workbench`, Joe Bean `…=19098f5c-99b9-4d7c-90ef-ee33d1e896b7…`, Joe Coffee `…=f42ad179-9ef4-410a-a92e-464eae1d84ce…`); Part C's preview, before/after counts and integrity output.
