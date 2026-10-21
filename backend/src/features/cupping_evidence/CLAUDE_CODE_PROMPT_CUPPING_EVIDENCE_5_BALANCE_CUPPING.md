# Cupping Evidence, brief 5: load the Balance cupping of 2026-10-21 (one cross-roaster session, Dana + Camila, four coffees already in the catalog). Data only.

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-21 (CTO session; decisions by Dana) · Model: Sonnet is fine
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v3 §6 (loading rules) and brief 2 (`CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_2_LOADS.md`), whose decisions 1 to 7, 11, 12, 15, 17, 18, 19 apply unchanged. Read brief 2 and its loader `load/loadCuppingEvidence2.ts` first: this brief is the same shape with one session. No schema, no new table, no view, no catalog change of any kind (no assignment, placement, price, SKU, mapping of a roaster word, portal row).
> Status: **DONE 2026-10-21** on test and prod (session 40; loader `load/loadCuppingEvidence5.ts`). Closing report: `CLOSING_REPORT_5.md`. `WHAT_WE_BUILT.md` #229.

## What this is

On 2026-10-21 Dana and Camila cupped four coffees side by side that had each been cupped before in their own roastery's session: Utopian **Union** (coffee 2934, session 35), Joe Coffee **Benchmark** (2905, session 36), Joe Bean **Fabricator House Roast** (2917, session 37) and Joe Bean **Geometric Filter Coffee** (2915, session 37). The point of the flight was the balanced end of the dial: how these four sit next to each other on one table. Source: `misc/roasteries/Balance Cupping/Balance Cupping - Oct 21 2026.pdf` (CamScanner, 4 pages: Dana sheets 1 and 2 of 4 = samples 1 to 4; Camila sheets 1 and 3 of 4 = samples 1, 2, 5, 6). The printed sheet is the current A&B sheet, `ab_0_15_8dim`, native `ab_0_15` for both cuppers.

Every value below was transcribed from the scan by the CTO session and checked by a blind second read of the same scans (two independent readers, 2026-10-21; the diff is in `TRANSCRIPTION_CHECK_BRIEF_5_2026-10-21.md`). Load as written; do not reinterpret a number or a word.

This load adds a **second session** on four coffees that already have a merged row, an assignment and (Benchmark) a placement. Nothing about those decisions changes here. What changes by itself, through the views: `v_coffee_dimension_range` moves to this session for the four coffees (latest session wins), `v_coffee_dimension_history` gains a row per dimension, `evidence_newer_than_decision` becomes true for all four, and `refreshDialSignal` records a new signal from this session (both cuppers native `ab_0_15`, so the signal fires). The four coffees will therefore appear in the workbench queue as "newer evidence than the decision". That is the intended result; the calibration pass is Dana's, not this brief's.

## Decisions (Dana, 2026-10-21). Do not re-open.

1. **One new session**, `sheetFormat: 'ab_0_15_8dim'`, `sessionDate: '2026-10-21'`, `sessionDatePrecision: 'exact'`, `isBlind: false` (no blind codes written, coffee names filled in by both cuppers, Blind Y/N not ticked), `roasterPresent: false`, `location: null`, `recordSource: 'paper: Balance Cupping - Oct 21 2026.pdf (4 pages; misc/roasteries/Balance Cupping)'`, `transcribedBy: 'Claude (CTO session)'`, `transcribedAt: '2026-10-21'`, `checkedBy: 'blind second read 2026-10-21 (TRANSCRIPTION_CHECK_BRIEF_5_2026-10-21.md)'`, `sessionNotes: 'Balance cupping: four coffees from three roasteries cupped side by side to compare the balanced end of the dial (Union, Benchmark, Fabricator, Geometric). All four were cupped before in their roastery sessions (35, 36, 37). Not blind. Grind 21 on Dana\'s sheet 1; ratio, water temp, steep, cups not recorded. No archetype call written by either cupper on any sample; no SCA family ticked. Merged by rule (union, n = 2).'`.
2. **Brew.** `brewDefaults: { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl', grindSize: '21', notes: 'standard A&B cupping protocol (Dana, 2026-10-16); grind 21 from Dana\'s sheet 1; temperature and steep time not recorded' }`. (`grindSize` is already a `BrewParams` field.)
3. **Cross-roaster session.** The session has no roaster. Each sample names its coffee by `(roaster name, coffee name)` exactly as stored: `('Utopian', 'Union')`, `('Joe Coffee Company', 'Benchmark')`, `('Joe Bean Roasters', 'Fabricator House Roast')`, `('Joe Bean Roasters', 'Geometric Filter Coffee')`. Resolve to ids at run time; never a literal coffee id in the loader (the ids above are for the report only). If any lookup returns 0 or 2+ rows: STOP, report, write nothing.
4. **Display order** = Dana's sample numbers: 1 Union, 2 Benchmark, 3 Fabricator, 4 Geometric. Camila's sheet numbers (1, 2, 5, 6) go in `sample_note` per session coffee: `'Dana sample N; Camila sample M'`.
5. **Rows.** One `cupping_scores` row per cupper per coffee through `saveCupperScore` (`cupperId` from `cupper`, `scale_code = 'ab_0_15'`), then `mergeByRule(sessionCoffeeId, { n: 2 })`. Eight cupper rows, four merged rows. No supersede: these are new rows on a new session; the earlier sessions' rows stay as they are.
6. **Marks.** Brief 2 decision 2 applies: a scribbled-over or clearly ghosted mark is never counted and is named in `raw_value`; a struck word stays in `notes` as `~word` and never becomes a descriptor row. Where two live circles sit on one line the value is the span.
7. **No calls.** Both cuppers left Archetype call, Secondary, Confidence and the SCA family boxes empty on all eight samples. `archetype_call`, `archetype_call_secondary`, `position_call`, `slot_call_id` are null everywhere. Camila wrote "+ Classic" after the coffee name on Benchmark; that is a `call_note`, not a call (the call line is blank, and "Classic" is also the public name of `chocolate_nutty/2`, so it is ambiguous on paper). The merged `archetype_call` is therefore null for all four.
8. **Words → SCA node**, same rule as brief 2 decision 6 (most specific node the cupper named, never deeper; containment for a fruit or spice not on the wheel; no node → the word stays in `notes` only and shows in the unmapped-words view). New conventions this brief writes through `noteMappingService.setNoteMapping` (`source_kind = 'cupper'`, `note = 'loader 2026-10-21; rule: <exact | node | contains>'`) **before any score is loaded**, only where the word is not already mapped (look it up first; an existing row wins and is not rewritten):
   - `tangerine` → **Citrus Fruit** (tier 2; contains, like clementine)
   - `strawberry` → Strawberry (leaf)
   - `caramel` → Caramelized (leaf; already mapped by brief 2, reuse)
   - `brown sugar` → **Brown Sugar** (tier 2; node)
   - `honey` → Honey (leaf)
   - `sugar` → **Sweet** (tier 1; the generic family word, same reasoning as fruity → Fruity)
   - `smoky` / `smokey` → Smoky (leaf)
   - `spicier` → the node `spice` already maps to (brief 2: Brown Spice); `rule: node`
   - `dark choc` → Dark Chocolate (leaf; `bitter choc` already there, add `dark choc`)
   - `fruity tea` → Black Tea (already mapped by brief 2, reuse)
   - `light fruity` → **Fruity** (tier 1; `rule: node`)
   - No node, stays in text only: `savory`, `butter`, `sweetish`, `silky`, `2% milk`, `like tea`, and the unreadable aroma word on Camila's Union (B3). `banana` on Dana's Benchmark Acidity line describes the acidity (low, banana-like), not a flavor: Acidity row `notes`, no descriptor, no mapping (Dana, 2026-10-21).
   - Every cupper word the loader resolves through the table has its own `source_kind = 'cupper'` row, including words that already have a roaster row (caramel, honey, strawberry, fruity tea): 12 rows in all (engineer's question, ruled 2026-10-21).
   Words already covered by brief 2's mapping rows: cocoa, nuts, chocolate, citrus, black tea, tea, fruity, honey, caramel, spice, dark chocolate, roasted/roasty.
9. **Order.** Mappings → session header → session coffees (with brew rows) → cupper rows → merges → `refreshDialSignal` for the four coffees. Nothing is updated afterwards.
10. **Loader.** A new script `load/loadCuppingEvidence5.ts`, run as `npm run load:cupping-evidence-5`, built on the same `n / t / merge / Row / Sample / SessionSpec` shapes as loader 2 with one difference: `Sample` carries `roaster` (the loader's `ROASTERS` map is reused). Either copy the helpers or extract them to `load/shared.ts`; if you extract, loader 2 must still run on the test DB and report `already loaded` for every step, byte-for-byte the same log as its last run, and that log goes in the closing report. Services only (`cuppingService`, `noteMappingService`), no SQL (`lint:lineage`, `lint:cupping`). Idempotent by natural key: second run writes nothing and says `already loaded` per step.
11. **Test DB first, whole run**, twice (second run clean). Closing report, then STOP for Dana's go before prod.

## PART A: the session

`createSession({ … decision 1 and 2 … })`, then `addSessionCoffee` ×4 (decision 3, 4). Expected: 1 session, 4 session coffees, 4 `cupping_brew_params` rows with dose 8.5 / water 150 / ratio 17.65 / grind 21.

## PART B: cupper rows

Dimension ids as in brief 2 decision 5: 1 Fragrance, 2 Aroma, 3 Flavor, 4 Sweetness, 5 Acidity, 6 Bitterness, 7 Body (Mouthfeel light to heavy), 10 Finish Length (Aftertaste short to long), 11 Finish Character (aftertaste words), 12 Mouthfeel words.

### B1. Numeric values (0 to 15, native). `–` = no row on that dimension. `raw_value` given only where it differs from `'<min>-<max>'` / `'<v>'`.

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|---|---|---|
| Union | Dana | 9 | 8 | 6 | 4, raw `4; faint marks at 1 and 3 read as struck` | 9 | 0 | – | – |
| Union | Camila | 8 | 7 | 7 | 3 | 8 | 4 | 9 | 2, raw `2; mark at 6-7 scribbled out` |
| Benchmark | Dana | 5 | 6–7 | 6 | 1, raw `1; faint mark at 0 read as struck`, notes `banana (acidity character: low, banana-like; Dana 2026-10-21)` | 5, raw `5; faint mark at 4 read as struck` | 2, raw `2; faint marks at 4 and 5 read as struck` | 5 | – |
| Benchmark | Camila | 6, raw `6; mark at 10 scribbled out` | 6 | 8 | 0 | 5 | 1 | 4 | 4 |
| Fabricator | Dana | 7, raw `7; smudged mark at 8 read as struck` | 7 | 7 | 4, raw `4; faint mark at 2 read as struck` | 3 | 3, raw `3; faint mark at 6 read as struck` | – | – |
| Fabricator | Camila | 9, raw `9; mark at 11 scribbled out` | 8 | 4 | 4, raw `4; mark at 3 scribbled out` | 4 | 5, raw `5; bold circle drawn over hatch strokes, live (Dana confirmed 2026-10-21); mark at 8 scribbled out` | 6 | 5 |
| Geometric | Dana | 8, raw `8; faint mark at 10 read as struck` | 8 | 8 | 4, raw `4; faint mark at 6 read as struck` | 10 | 1 | 4 | – |
| Geometric | Camila | 10, raw `10; mark at 6-7 scribbled out` | 9 | 7 | 2 | 7, raw `7; mark at 0-1 scribbled out` | 4 | 4 | 4 |

Camila / Fabricator / Bitterness was the one cell the three readers did not agree on; Dana confirmed it as 5 (2026-10-21). Load 5. Dana left Body and Finish Length unmarked on three of her four sheets (words only on Mouthfeel and Aftertaste): no row on 7 / 10 there, the words go to 12 / 11.

### B2. Words on 1, 2, 3, 11, 12 (`notes`; verbatim, lower-cased, spelling kept except where noted)

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 12 Mouthfeel | 11 Finish Character |
|---|---|---|---|---|---|---|
| Union | Dana | cocoa, nuts | sugar, sweet, black tea | sweet | silky | sweet, light acidity |
| Union | Camila | smoky / savory(?) | caramel / burn(?) (unreadable: burn / corn / iorn across three readers) | butter / caramel | silky? | caramel |
| Benchmark | Dana | cocoa, brown sugar or spice | chocolate, caramel | cocoa | 2% milk - less | ~light ~bitterness sweet |
| Benchmark | Camila | spicier(?) (or spicies) | caramel / sugar | smokey? / dark chocolate | – | caramel / honey |
| Fabricator | Dana | cocoa, brown sugar, honey | cocoa, sweetish | dark choc?, ~roasted, fruity - citrus | silky | light ~bitter ~acid sweet acid (the second acid may also be struck; words only, no load impact) |
| Fabricator | Camila | fruity (tangerine) | fruity / nuts | citrus / nuts | – | citrus |
| Geometric | Dana | cocoa, sweet - fruit | cocoa, sweet - fruit | sweet | ~2% milk, like tea | sweet + acid lingers, and they are balanced |
| Geometric | Camila | light fruity / fruity tea | strawberry / honey | honey | – | honey / strawberry |

### B3. Descriptors (node ← words; a struck word never makes a row)

| coffee | cupper | node ← words |
|---|---|---|
| Union | Dana | Cocoa ← cocoa · Nutty ← nuts · Sweet ← sugar · Black Tea ← black tea |
| Union | Camila | Smoky ← smoky · Caramelized ← caramel (aroma, flavor, aftertaste: one row, three words) · (savory, butter, the unreadable word: no node) |
| Benchmark | Dana | Cocoa ← cocoa (fragrance, flavor) · Brown Sugar ← brown sugar · Brown Spice ← spice · Chocolate ← chocolate · Caramelized ← caramel · (banana is an acidity note, not a descriptor: no row) |
| Benchmark | Camila | Brown Spice ← spicier · Caramelized ← caramel (aroma, aftertaste) · Sweet ← sugar · Smoky ← smokey? · Dark Chocolate ← dark chocolate · Honey ← honey |
| Fabricator | Dana | Cocoa ← cocoa (fragrance, aroma) · Brown Sugar ← brown sugar · Honey ← honey · Dark Chocolate ← dark choc? · Citrus Fruit ← citrus (roasted is struck: no row) |
| Fabricator | Camila | Fruity ← fruity · Citrus Fruit ← tangerine, citrus · Nutty ← nuts |
| Geometric | Dana | Cocoa ← cocoa · Fruity ← fruit |
| Geometric | Camila | Fruity ← light fruity · Black Tea ← fruity tea · Strawberry ← strawberry · Honey ← honey |

Camila / Union / Aroma, second word: three readers, three readings (burn, corn, iorn). It is unreadable: `notes` carries `burn(?)`, no descriptor row, no mapping. Not a question for Dana unless Camila remembers.

### B4. Call columns and `overall_notes`

| coffee | cupper | archetype_call | call_note | overall_notes |
|---|---|---|---|---|
| Union | Dana | null | no call written; no family ticked | |
| Union | Camila | null | no call written; no family ticked | |
| Benchmark | Dana | null | no call written; no family ticked | Flavor notes (hot): "balanced coffee with no edges." |
| Benchmark | Camila | null | no call written; "+ Classic" written in small script after the coffee name (not on the call line; left as a note) | |
| Fabricator | Dana | null | no call written; no family ticked | Flavor notes (hot): "Very similar to Union. Union is a bit more acid and more sweet." |
| Fabricator | Camila | null | no call written; "Tangerine" also written above the Roast field | Bitterness line: mark at 8 scribbled out; the 5 is a bold circle over hatch strokes, confirmed live by Dana 2026-10-21. |
| Geometric | Dana | null | no call written; no family ticked | |
| Geometric | Camila | null | no call written; no family ticked | |

`archetype_call_secondary`, `position_call`, `slot_call_id`: null everywhere.

### B5. Merge

`mergeByRule(sessionCoffeeId, { n: 2 })` ×4. Expected disagreement lists with `param('cupper_gap') = 2` (gap between the two ranges greater than 2), from the values in B1; the test run must reproduce them or the closing report explains the cell:

| coffee | cupper disagreement (gap > 2) | one cupper only |
|---|---|---|
| Union | Bitterness (0 vs 4) | Body, Finish Length (Dana unmarked) |
| Benchmark | none (largest gap: Flavor 6 vs 8) | Finish Length |
| Fabricator | Flavor (7 vs 4) | Body, Finish Length (Bitterness 3 vs 5 is within the gap) |
| Geometric | Sweetness (10 vs 7), Bitterness (1 vs 4) | Finish Length |

Merged `archetype_call` null ×4 (no cupper called). Dial signal: `refreshDialSignal` for the four coffees after the merges; both rows native `ab_0_15`, so a signal is recorded for each, basis per brief 1 (spec bands when every slot has one, else `archetype_vector`), and the earlier signal from the roastery session is superseded by the service's own rule, not by the loader.

## CONSTRAINTS
- Loader `backend/src/features/cupping_evidence/load/loadCuppingEvidence5.ts`, `npm run load:cupping-evidence-5`, test DB first end to end, twice; prod only after Dana's go. Idempotent by natural key (DESIGN §6.6).
- Services only. No SQL in the loader. No `taster_name` string anywhere (cupper ids).
- No catalog write: no assignment, placement, price, SKU, lineup row, portal row, remark, roaster-word mapping. The only mapping rows are the `source_kind = 'cupper'` conventions in decision 8, and only for words with no existing row.
- No row of sessions 35 to 39 is touched, superseded or re-merged.
- `lint:cupping`, `lint:lineage` green; `npm run build` clean; `runCatalogIntegrityChecks().allPass = true` on test after the load; `evidenceIntegrity` report run on test, its output in the closing report.
- Nothing is deleted anywhere. If a step fails midway, report what was written and stop; the next run continues.
- Commits: loader (+ `shared.ts` if extracted) + `package.json` script + this brief's status line + one `WHAT_WE_BUILT.md` entry + a dated line in `WHAT_WE_BUILT_DB.md`'s Cupping evidence section + README status line in this folder. Straight to main. No schema change, so no `comments.sql` / `CATALOG.md` change.

## DONE =
One new session (2026-10-21, `ab_0_15_8dim`, not blind) with 4 session coffees in Dana's order and 4 brew rows; 8 cupper rows and 4 merged rows with values, `raw_value`, notes, descriptors and call notes exactly as in B1 to B4; disagreement lists as in B5 (or explained); 4 new dial signals; the new cupper mappings from decision 8 and no other mapping row; `v_coffee_dimension_range` for the four coffees now reads from this session; `v_coffee_dimension_history` shows two sessions for each; `evidence_newer_than_decision = true` for the four in `v_evidence_coverage`; sessions 35 to 39 unchanged (row counts and `merge_note` identical to `CLOSING_REPORT_2.md`); integrity green; second run writes nothing.

Closing report: session id; the four session coffee ids; per session coffee the score ids (Dana, Camila, merged) and the merged `merge_note`; the mapping rows written (word → node → rule) and the words left unmapped; the dial signal rows (coffee, basis, position) before and after; the `evidenceIntegrity` output; the first rows of `v_coffee_dimension_history` for Benchmark; the workbench URL for one of the four coffees.
