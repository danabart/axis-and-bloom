# Cupping Evidence, brief 10: load the cupping of 2026-11-20 (one cross-roaster session, Dana + Camila, four coffees already in the catalog: Brazil, Indonesia, D.R. Congo, The Daily). Data only.

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-11-20 (CTO session; decisions by Dana or by standing precedent, each marked) · Model: Sonnet is fine · Mode: test first, then live on Dana's go
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v4 and **brief 8** (`CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_8_FRUITY_CUPPING.md`, Parts A and B only), which this brief repeats with a different sheet set: same loader shape (`load/loadCuppingEvidence8.ts` is the template), same decisions as briefs 5, 7 and 8 unless a line below says otherwise. No schema, no new table, no view, no catalog change of any kind from the loader (no assignment, placement, price, SKU, roaster-word mapping, portal row). The pooled range (brief 6) and the dispute rule (brief 9) absorb this session by themselves.
> Status: **done on prod 2026-11-20** (session 43; `CLOSING_REPORT_10.md`).

**Guardrails (`DEVELOPMENT_GUARDRAILS.md`).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (no new number or rule; the values below are evidence, loaded as written) · G2.4 no new table or view · G2.5 one writer: `cuppingService` / `noteMappingService` only, no SQL in the loader (`lint:lineage`, `lint:cupping`); reads through the `*Reads` modules · G2.12 evidence is insert-only: no row of sessions 35 to 42 is touched, no supersede · G2.20 the sheets are loaded as received · G3.3 idempotent by natural key, a second run writes nothing · G3.7 prod only with `--expect-db axisandbloom` and after the STOP · G1.5 / G1.6 one run, one closing report, push is deploy (the only code is the loader and its npm script) · G1.10 Dana does no manual ops.
Mode: test, then live. One STOP: after the test closing report, for Dana's go to prod.

## What this is

On 2026-11-20 Dana and Camila cupped four coffees side by side: Joe Bean **Brazil** (prod coffee 2939), Joe Bean **Indonesia** (2940), Joe Bean **D.R. Congo** (2941) and Joe Coffee **The Daily** (2907). Source: `misc/roasteries/Cupping/Cupping - Nov 20 2026.pdf` (CamScanner, 4 pages, every page printed "Sheet 1 of 4": Camila page 1 = D.R. Congo / The Daily, page 2 = Brazil / Indonesia; Dana page 3 = Brazil / Indonesia, page 4 = D.R. Congo / The Daily). The printed sheet is `ab_0_15_8dim`, native `ab_0_15` for both cuppers.

This is the **first cupping** of Brazil, Indonesia and D.R. Congo: all three were accepted from the roaster's portal answers and placed on the map without cupping rows (Ella map brief 6: grade D, flag `no_cupping_rows`). For The Daily it is the second session (session 36, 2026-10-02, Dana only, no Sweetness / Acidity / Bitterness / Body from her) and the first with Camila.

Every value below was transcribed from the scan by the CTO session, read twice at 300 dpi by the same reader. **There was no blind second read this time** (briefs 2, 5, 7 and 8 had one). The cells that reader was not sure of are listed in decision 8 with the default taken. Load as written; do not reinterpret a number or a word.

## Decisions. Do not re-open.

1. **One new session**: `sheetFormat: 'ab_0_15_8dim'`, `sessionDate: '2026-11-20'`, `sessionDatePrecision: 'exact'`, `isBlind: false` (no blind codes, coffee and roaster names filled in by both cuppers, Blind Y/N not ticked on any page), `roasterPresent: false`, `location: null`, `recordSource: 'paper: Cupping - Nov 20 2026.pdf (4 pages; misc/roasteries/Cupping)'`, `transcribedBy: 'Claude (CTO session)'`, `transcribedAt: '2026-11-20'`, `checkedBy: 'same reader, second pass at 300 dpi, 2026-11-20; no blind second read; uncertain cells confirmed by Dana 2026-11-20 (brief 10 decision 8)'`, `sessionNotes: 'Cupping of 2026-11-20: four coffees from two roasteries cupped side by side (Brazil, Indonesia, D.R. Congo from Joe Bean; The Daily from Joe Coffee). First cupping of the three Joe Bean single origins; The Daily cupped before (session 36). Not blind. Ratio, grind, water temp, steep, cups not recorded. Archetype call line blank on all eight samples; Dana wrote a family reading on the flavor-notes line of all four of hers, loaded as her call (her standing ruling of 2026-10-23); Camila made no call. Camila marked no Aroma and no Flavor value on Indonesia. Merged by rule (union, n = 2).'`
2. **Brew**: `brewDefaults: { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl', notes: 'standard A&B cupping protocol (Dana, 2026-10-16); grind, temperature and steep time not recorded on the sheets' }`.
3. **Cross-roaster**, per-sample roaster as in brief 5: `('Joe Bean Roasters', 'Brazil')`, `('Joe Bean Roasters', 'Indonesia')`, `('Joe Bean Roasters', 'D.R. Congo')`, `('Joe Coffee Company', 'The Daily')`. Resolve at run time, exactly one active row each or STOP. **The loader's roaster precondition names Joe Bean and Joe Coffee only** (both active). Utopian is retired and is not part of this session; do not copy loader 8's three-roaster precondition.
4. **Display order** = Dana's pages: 1 Brazil, 2 Indonesia, 3 D.R. Congo, 4 The Daily. `sample_note`: Brazil `'Dana page 3 sample 1; Camila page 2 sample 1'` · Indonesia `'Dana page 3 sample 2; Camila page 2 sample 2'` · D.R. Congo `'Dana page 4 sample 1; Camila page 1 sample 1'` · The Daily `'Dana page 4 sample 2; Camila page 1 sample 2'`.
5. **Rows**: eight cupper rows, four merged rows, `mergeByRule(…, { n: 2 })`. No supersede. No dispute is raised by this brief.
6. **Marks**: brief 2 decision 2 and brief 5 decision 6 (struck, X'd, scribbled and ghosted marks never counted, named in `raw_value`; two live circles = the span; struck words `~word`, never a descriptor). Camila circles the printed number under the line (brief 7 ruling).
7. **Calls** (precedent: Dana, 2026-10-23, "Flavor-notes line is my call"; applied in briefs 7 and 8). The Archetype call line is blank on all eight samples. Dana's rows take `archetype_call` from her flavor-notes line, the line itself goes in `call_note` as written: Brazil `balanced_sweet` ("Balance") · Indonesia `chocolate_nutty` ("fruity C&N": the family named is C&N, fruity is the accent, same reading as the A&B rule of 2026-10-14) · D.R. Congo `fruity` ("fruity leaning chocolate. More fruits very light chocolate notes."; she also ticked the Fruity family box) · The Daily `chocolate_nutty` ("C&N"). `archetype_call_secondary`, `position_call`, `slot_call_id` null everywhere. Camila's rows: `archetype_call` null, no family ticked, nothing written by the boxes. Merged call = Dana's on all four (a cupper with no call does not block one). The loader carries this as `FLAVOR_LINE_IS_CALL = true`, as loader 7 did.
8. **Uncertain cells, defaults confirmed by Dana 2026-11-20** ("yes to everything", the word readings and the mappings of decision 9 included; one reader; each is carried in `raw_value` so the sheet reading is on record, and brief 9's dispute is the door if Dana later disagrees with one):
   - Dana / Indonesia / Mouthfeel: clean circle at 4; the circle at 6 has a scribble inside and a tail stroke. **4**, the 6 read as struck.
   - Dana / The Daily / Bitterness: heavy circle at 3; a faint grey circle at 1. **3**, the 1 read as ghosted (not a 1 to 3 span).
   - Camila / D.R. Congo / Sweetness: one oval round the printed 6 with a small scribble at its upper left and a loop at its foot. **6**.
   - Camila / The Daily / Acidity: oval at 1; the oval at 0 has a scribble over its top. **1**, the 0 read as struck.
   - Camila / Indonesia / Aroma and Flavor: no circle on either line (a short pen tick near 6 on Flavor is not a mark). **No row**; both are one-cupper dimensions on Indonesia.
   - Camila / D.R. Congo / Fragrance words: read as "fruits (no berries)". **Fruity row, no Berry row.**
   - Camila / Indonesia / Fragrance, third word: "nature" or "mature". Text only either way.
9. **Words → SCA node**, brief 5 decision 8 (most specific node named, never deeper; containment; no node → `notes` only). Cupper conventions (`source_kind = 'cupper'`, `note = 'loader 2026-11-20; rule: <exact | node | contains>'`, written only where no cupper row exists yet; an existing row wins and is not rewritten, whatever this list says; every word the loader resolves through the table gets a cupper row):
   - Expected to exist already: `chocolate` → Chocolate · `milk chocolate` → Chocolate · `dark chocolate` → Dark Chocolate · `cocoa` → Cocoa · `caramel` → Caramelized · `sugar` → Sweet · `honey` → Honey · `almond` → Almond · `nuts`, `roasted nuts` → Nutty · `dried fruits` → Dried Fruit · `fruity`, `fruits` → Fruity · `orange` → Orange · `clementine` → Citrus Fruit · `burnt` → the existing `burnt` mapping · `tea` → the existing `tea` mapping (brief 2)
   - New: `light fruits`, `a bit of fruits` → **Fruity** (tier 1; contains) · `light caramel` → **Caramelized** (contains) · `light chocolate` → **Chocolate** (contains) · `raisins` → **Raisin** (leaf; exact) · `apricot` → **Other Fruit** (tier 2; contains, as the roaster row of brief 2) · `wood` → **Woody** (leaf; exact) · `cedar` → **Woody** (leaf; contains) · `leaves` → **Green / Vegetative** (tier 1; contains) · `popcorn` → **Cereal** (tier 2; contains) · `nuttella` / `nutella` → **Hazelnut** (leaf; contains)
   - If Task 0 finds that one of the "new" nodes does not exist under that name in `cupping_note`, the word stays text only and the closing report says so; no node is created.
   - No node, text only: `sweet`, `sweetness`, `round`, `silky`, `creamy`, `nature`, `bitterness`, `biter`, `bitter`, `light acidity`, `acid`.
   - `like almond milk texture` on Dana's D.R. Congo Mouthfeel line describes the texture (as `banana` in brief 5 and `strawberry acid` in brief 8): Mouthfeel `notes`, no descriptor, no mapping.
   - Dana spells chocolate "choclate" / "cholate" throughout; `notes` carry `chocolate` (the one spelling normalised in this brief).
10. **Order, loader, test-first**: brief 5 decisions 9 to 11. New script `load/loadCuppingEvidence10.ts` (copy loader 8's shape, do not extract; loaders 2, 5, 7, 8 untouched), `npm run load:cupping-evidence-10`. Loaders 5, 7 and 8 refuse on their active-roaster precondition since Utopian was retired; that is expected, do not run them as a check and do not relax them.

## Task 0 (read-only, test DB and prod; findings in the closing report)

- The four coffees by `(roaster, name)`: id, active, and their sessions so far (expected: none for the three Joe Bean singles; session 36 for The Daily). STOP if any is missing, inactive or duplicated.
- That no session dated 2026-11-20 with this `recordSource` exists.
- For each word in decision 9: the current cupper mapping, if any; for each "new" node: that it exists in `cupping_note` with that tier.
- The dial signal row and the pooled range per coffee, before.

## PART A: the session
`createSession` (decisions 1, 2), `addSessionCoffee` ×4 (decisions 3, 4). Expected: 1 session, 4 session coffees, 4 brew rows.

## PART B: cupper rows

Dimension ids as before: 1 Fragrance, 2 Aroma, 3 Flavor, 4 Sweetness, 5 Acidity, 6 Bitterness, 7 Body (the sheet's Mouthfeel line, light to heavy), 10 Finish Length (the Aftertaste line), 11 Finish Character (aftertaste words), 12 Mouthfeel words.

### B1. Numeric values (0 to 15, native). `–` = no row. `raw_value` spelled out only where it differs from `'<v>'` / `'<min>-<max>'`.

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|---|---|---|
| Brazil | Dana | 7, raw `7; mark at 4 X'd out` | 6–8 | 7 | 0 | 12, raw `12; mark at 10 X'd out` | 1, raw `1; mark at 2 X'd out` | 7, raw `7; mark at 5 X'd out` | 10 |
| Brazil | Camila | 10 | 9 | 10, raw `10; mark at 7 scribbled out` | 1 | 12, raw `12; mark at 3 scribbled out` | 0 | 2 | 5 |
| Indonesia | Dana | 6, raw `6; mark at 4 X'd out` | 6 | 9 | 5, raw `5; mark at 3 scribbled out` | 8, raw `8; mark at 6 X'd out` | 2, raw `2; marks at 5 and 7 X'd out` | 4, raw `4; circle at 6 scribbled with a tail stroke, read as struck` | 6, raw `6; mark at 8 X'd out` |
| Indonesia | Camila | 9 | – | – | 4 | 7, raw `7; mark at 3 scribbled out` | 0 | 2 | 3 |
| D.R. Congo | Dana | 5 | 4 | 8 | 7 | 8, raw `8; mark at 10 X'd out` | 1 | 5 | 5 |
| D.R. Congo | Camila | 6 | 6 | 10, raw `10; mark at 7 scribbled out` | 5 | 6, raw `6; one oval round the 6 with a small scribble at its upper left, read as live` | 3, raw `3; mark at 0 scribbled out` | 6 | 3 |
| The Daily | Dana | 4 | 6 | 6 | 2, raw `2; marks at 0 and 3 X'd out` | 9, raw `9; mark at 10 X'd out` | 3, raw `3; faint circle at 1 read as ghosted` | 8 | 8 |
| The Daily | Camila | 6 | 6 | 7 | 1, raw `1; oval at 0 scribbled over, read as struck` | 8, raw `8; mark at 3 scribbled out` | 3, raw `3; marks at 1 and 2 scribbled out` | 6 | 8, raw `8; mark at 3 scribbled out` |

62 numeric cells (64 less Camila's two blank lines on Indonesia). One span (Dana / Brazil / Aroma).

### B2. Words on 1, 2, 3, 11, 12 (`notes`; verbatim, lower-cased, spelling kept except chocolate, decision 9)

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 12 Mouthfeel | 11 Finish Character |
|---|---|---|---|---|---|---|
| Brazil | Dana | chocolate, nuts, light fruits | ~(one struck word) chocolate | chocolate, almond, sweet - dried fruits | round | sweetness |
| Brazil | Camila | chocolate (milk), nuts, a bit of fruits | honey / chocolate / roasted nuts | roasted nuts / popcorn | – | popcorn (burnt) |
| Indonesia | Dana | wood - cedar. caramel, aprico… (cut off at the page edge) | leaves, raisins | dark chocolate, fruity | silky | ~bitterness light acidity - finish with ~bitterness maybe |
| Indonesia | Camila | fruits, raisins, nature | wood / sweet | fruits | – | fruits |
| D.R. Congo | Dana | fruity, light caramel | tea - sweet, orange | orange, light chocolate | like almond milk texture | sweet with light acid finish or biter - chocolate finish! |
| D.R. Congo | Camila | fruits (no berries) | caramel / clementine (written above a line that is fully scribbled out) | clementine / chocolate / caramel | silky? | fruity |
| The Daily | Dana | cocoa, caramel | chocolate, sweet - caramel or… (cut off at the page edge) | chocolate, caramel, sugar | ~round | sweet ~and ~noth ~of ~acid with a spike bitter ("with a spike bitter" written above the struck words) |
| The Daily | Camila | dark chocolate | dark chocolate / caramel | caramel / chocolate | creamy | nuttella |

Camila wrote Aroma and Flavor words on Indonesia without a value: those two rows carry `notes` only, as a words-only line does on any earlier sheet.

### B3. Descriptors (node ← words; a struck or negated word never makes a row)

| coffee | cupper | node ← words |
|---|---|---|
| Brazil | Dana | Chocolate ← chocolate (fragrance, aroma, flavor) · Nutty ← nuts · Fruity ← light fruits · Almond ← almond · Dried Fruit ← dried fruits |
| Brazil | Camila | Chocolate ← chocolate (milk), chocolate · Nutty ← nuts, roasted nuts (aroma, flavor) · Fruity ← a bit of fruits · Honey ← honey · Cereal ← popcorn (flavor, aftertaste) · burnt ← burnt (existing mapping) |
| Indonesia | Dana | Woody ← wood, cedar · Caramelized ← caramel · Other Fruit ← apricot · Green / Vegetative ← leaves · Raisin ← raisins · Dark Chocolate ← dark chocolate · Fruity ← fruity (bitterness is struck twice; text only anyway) |
| Indonesia | Camila | Fruity ← fruits (fragrance, flavor, aftertaste) · Raisin ← raisins · Woody ← wood |
| D.R. Congo | Dana | Fruity ← fruity · Caramelized ← light caramel · tea ← tea (existing mapping) · Orange ← orange (aroma, flavor) · Chocolate ← light chocolate, chocolate (aftertaste) |
| D.R. Congo | Camila | Fruity ← fruits, fruity · Caramelized ← caramel (aroma, flavor) · Citrus Fruit ← clementine (aroma, flavor) · Chocolate ← chocolate (berries is negated: no row) |
| The Daily | Dana | Cocoa ← cocoa · Caramelized ← caramel (fragrance, aroma, flavor) · Chocolate ← chocolate (aroma, flavor) · Sweet ← sugar (round is struck: no row, and no node anyway) |
| The Daily | Camila | Dark Chocolate ← dark chocolate (fragrance, aroma) · Caramelized ← caramel (aroma, flavor) · Chocolate ← chocolate · Hazelnut ← nuttella |

### B4. Call columns, `call_note`, `overall_notes`

| coffee | cupper | archetype_call | call_note | overall_notes |
|---|---|---|---|---|
| Brazil | Dana | balanced_sweet | call line blank; flavor notes (hot): "Balance" (her call, ruling 2026-10-23); no family ticked | |
| Brazil | Camila | null | no call; no family ticked | |
| Indonesia | Dana | chocolate_nutty | call line blank; flavor notes (hot): "fruity C&N" (her call, ruling 2026-10-23; C&N with a fruity accent); no family ticked | |
| Indonesia | Camila | null | no call; no family ticked | No Aroma or Flavor value marked; words only on both lines. |
| D.R. Congo | Dana | fruity | call line blank; flavor notes (hot): "fruity leaning chocolate. More fruits very light chocolate notes." (her call, ruling 2026-10-23); Fruity family box ticked | |
| D.R. Congo | Camila | null | no call; no family ticked | Aroma: the original line is fully scribbled out, unreadable; "caramel / clementine" written above it is the line as loaded. |
| The Daily | Dana | chocolate_nutty | call line blank; flavor notes (hot): "C&N"; (warm): "feels like Nutela" (her call, ruling 2026-10-23); no family ticked | |
| The Daily | Camila | null | no call; no family ticked | |

`position_call`, `archetype_call_secondary`, `slot_call_id`: null everywhere.

### B5. Merge
`mergeByRule` ×4. Expected disagreement lists with `cupper_gap = 2` (gap between the two ranges greater than 2), from B1; the test run must reproduce them or the closing report explains the cell:

| coffee | cupper disagreement (gap > 2) | one cupper only |
|---|---|---|
| Brazil | Fragrance (7 vs 10), Flavor (7 vs 10), Body (7 vs 2), Finish Length (10 vs 5); Aroma (6–8 vs 9: gap 1, **not**) | none |
| Indonesia | Fragrance (6 vs 9), Finish Length (6 vs 3); Bitterness and Body (gap 2, **not**) | Aroma, Flavor (Dana) |
| D.R. Congo | none (largest gaps 2: Aroma, Flavor, Acidity, Sweetness, Bitterness, Finish Length) | none |
| The Daily | none (largest gaps 2: Fragrance, Body) | none |

Merged `archetype_call`: Brazil balanced_sweet, Indonesia chocolate_nutty, D.R. Congo fruity, The Daily chocolate_nutty (decision 7). Dial signal: `mergeByRule` refreshes it; the closing report records the row before and after per coffee and says for which of the four it fired.

## What Dana will see afterwards (no action in this brief)

- The three Joe Bean singles stop being `no_cupping_rows`; all four coffees show "newer evidence than the decision" in the workbench.
- Two calls differ from where the coffee sits on the map today: **Brazil** is placed Chocolate & Nutty and Dana called it Balance (the roaster also proposed Balanced & Sweet); **Indonesia** is placed Earthy and Dana called it fruity C&N. D.R. Congo (Fruity) and The Daily agree with their placement. Any move is Dana's placement pass through the workbench, not this loader's.

## CONSTRAINTS
As brief 8 Parts A and B: services only, no SQL, cupper ids from the table, no catalog write from the loader, no row of sessions 35 to 42 touched, no dispute raised or withdrawn, lints and build green (`lint:cupping`, `lint:lineage`, `tsc --noEmit`), `evidenceIntegrity` and `runCatalogIntegrityChecks()` output before and after, nothing deleted, test DB twice (second run writes nothing) then STOP for Dana's go, then prod twice. Commits straight to main: loader, npm script, this brief's status line, `WHAT_WE_BUILT.md` entry, one `README.md` line and status line, `CLOSING_REPORT_10.md`. `REGRESSION.md` unchanged.

## DONE =
One new session (2026-11-20, `ab_0_15_8dim`, not blind) with 4 session coffees in Dana's order and 4 brew rows; 8 cupper rows and 4 merged rows exactly as B1 to B4; disagreement lists as B5 (or explained); the dial signal rows recorded; the cupper mappings of decision 9 that did not exist yet and no other mapping row; pooled ranges for the four coffees now include this session; `evidence_newer_than_decision = true` for all four; sessions 35 to 42 unchanged; second run writes nothing, on test and on prod.

Closing report: session id; session coffee ids with sample notes; score ids per cupper and merged with `merge_note`; decision 8 cells as loaded; mapping rows written, rows that already existed, words left unmapped; dial signal rows before and after for the four; the pooled range and `session_weights` for Brazil and The Daily; `evidenceIntegrity` output; the workbench URLs (Joe Bean `/admin/roastery-portal?roastery=19098f5c-99b9-4d7c-90ef-ee33d1e896b7&view=workbench`, Joe Coffee `…=f42ad179-9ef4-410a-a92e-464eae1d84ce…`).
