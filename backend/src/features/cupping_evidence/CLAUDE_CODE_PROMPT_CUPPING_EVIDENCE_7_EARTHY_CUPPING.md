# Cupping Evidence, brief 7: load the Earthy / C&N cupping of 2026-10-23 (one cross-roaster session, Dana + Camila, five coffees already in the catalog). Data only.

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-23 (CTO session; decisions by Dana) · Model: Sonnet is fine
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v4 and **brief 5** (`CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_5_BALANCE_CUPPING.md`), which this brief repeats with a different sheet set: same loader shape (`load/loadCuppingEvidence5.ts` is the template; `shared.ts` if it was extracted), same decisions 1 to 11 of brief 5 unless a line below says otherwise. Brief 2's decisions 1 to 7, 11, 12, 15, 17, 18, 19 apply as they did in brief 5. No schema, no new table, no view, no catalog change of any kind (no assignment, placement, price, SKU, roaster-word mapping, portal row). Since brief 6 the pooled range absorbs this session by itself; nothing to do for that.
> Status: **DONE 2026-10-23** on test and prod (prod session 41; loader `load/loadCuppingEvidence7.ts`). Decision 7 ruled by Dana before the run: her flavor-notes line is her call. Closing report: `CLOSING_REPORT_7.md`. `WHAT_WE_BUILT.md` #232.

## What this is

On 2026-10-23 Dana and Camila cupped the dark end of the dial side by side: Utopian **Obsidian** (coffee 2929, last cupped session 39 on Camila's word scale), Utopian **Espresso Volo** (2927, session 39), Joe Bean **Blossom Dark Roast** (2916, session 37), Joe Coffee **Amsterdam** (2906, session 36, Dana only) and Joe Coffee **Big City** (2908, session 36, Dana only). The question on the table was earthy versus chocolate-nutty. Source: `misc/roasteries/Earthy Cupping/Earthy - C&N Cupping - Oct 23 2026.pdf` (CamScanner, 6 pages, every page printed "Sheet 1 of 4": Dana pages 1 to 3 = Obsidian, Volo / Blossom, Amsterdam / Big City; Camila pages 4 to 6 = Big City / Obsidian, Volo / Blossom, Amsterdam). The printed sheet is `ab_0_15_8dim`, native `ab_0_15` for both cuppers.

Every value below was transcribed from the scan by the CTO session and checked by a blind second read (two independent readers, 2026-10-23; the diff is in `TRANSCRIPTION_CHECK_BRIEF_7_2026-10-23.md`). Load as written; do not reinterpret a number or a word.

For Obsidian and Volo this is the **first native-scale session with both cuppers** (session 39 was Camila's low / medium / high words, so no dial signal has ever fired for them); after this load `all_ab_scale` is true for the pooled range only if every pooled session is all `ab_0_15`, which it is not (session 39 is `word_3`), so the dial signal still does not fire for those two. That is the rule working; say it in the closing report rather than working around it. For Amsterdam and Big City this is the first session with Camila. All five will show "newer evidence than the decision".

## Decisions (Dana, 2026-10-23). Do not re-open.

1. **One new session**: `sheetFormat: 'ab_0_15_8dim'`, `sessionDate: '2026-10-23'`, `sessionDatePrecision: 'exact'`, `isBlind: false` (no blind codes, coffee and roaster names filled in by both cuppers, Blind Y/N not ticked anywhere), `roasterPresent: false`, `location: null`, `recordSource: 'paper: Earthy - C&N Cupping - Oct 23 2026.pdf (6 pages; misc/roasteries/Earthy Cupping)'`, `transcribedBy: 'Claude (CTO session)'`, `transcribedAt: '2026-10-23'`, `checkedBy: 'blind second read 2026-10-23 (TRANSCRIPTION_CHECK_BRIEF_7_2026-10-23.md)'`, `sessionNotes: 'Earthy / C&N cupping: five dark coffees from three roasteries cupped side by side to separate earthy from chocolate-nutty (Obsidian, Espresso Volo, Blossom, Amsterdam, Big City). All five cupped before (sessions 36, 37, 39). Not blind. Ratio, grind, water temp, steep, cups not recorded. No archetype call on the call line by either cupper; Dana wrote her family reading on the flavor-notes line (see call notes). Merged by rule (union, n = 2).'`
2. **Brew**: `brewDefaults: { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl', notes: 'standard A&B cupping protocol (Dana, 2026-10-16); grind, temperature and steep time not recorded on the sheets' }`.
3. **Cross-roaster**, per-sample roaster as in brief 5: `('Utopian', 'Obsidian')`, `('Utopian', 'Espresso Volo')`, `('Joe Bean Roasters', 'Blossom Dark Roast')`, `('Joe Coffee Company', 'Amsterdam')`, `('Joe Coffee Company', 'Big City')`. Resolve at run time, exactly one row each or STOP.
4. **Display order** = Dana's pages: 1 Obsidian, 2 Espresso Volo, 3 Blossom, 4 Amsterdam, 5 Big City. `sample_note` per session coffee: `'Dana page N sample M; Camila page N sample M'` (Obsidian: Dana p1 s1, Camila p5 s1; Volo: Dana p1 s2, Camila p5 s2; Blossom: Dana p2 s1, Camila p6 s1; Amsterdam: Dana p2 s2, Camila p6 s2; Big City: Dana p3 s1, Camila p4 s1).
5. **Rows**: ten cupper rows, five merged rows, `mergeByRule(…, { n: 2 })`. No supersede.
6. **Marks**: brief 2 decision 2 (struck and ghosted marks never counted, named in `raw_value`; struck words `~word`, never a descriptor).
7. **Calls.** The Archetype call line is blank on all ten samples; `archetype_call`, `archetype_call_secondary`, `position_call`, `slot_call_id` null everywhere. Dana wrote a family reading on the flavor-notes line of four samples ("C&N", "C&N - Dark", "Earthy, this is the closest to both", "maybe light earthy"); Camila ticked Nutty / Cocoa on three and wrote "light earthy" or "chocolate and nutty" by the family boxes. **Default (consistent with brief 5's "+ Classic"): these are `call_note`s, not calls**, and the merged call is null. If Dana rules before the run that her flavor-notes line counts as her call, load `archetype_call` per the table in B4 (right-hand column) for Dana only; Camila's ticks stay notes either way.
8. **Words → SCA node**, brief 5 decision 8 (most specific node named, never deeper; containment; no node → `notes` only). New cupper conventions this brief writes (`source_kind = 'cupper'`, `note = 'loader 2026-10-23; rule: <exact | node | contains>'`, only where no cupper row exists yet; every word the loader resolves through the table gets a cupper row, as ruled in brief 5):
   - `tabaco` / `tobacco` → Tobacco (leaf); `ash` / `ashy` → Ashy (leaf); `smokey` / `smoky` → Smoky (existing)
   - `berries` → Berry (existing); `dark choc` / `dark chocolate` → Dark Chocolate (existing); `chocolate` → Chocolate (existing); `cocoa` → Cocoa (existing); `caramel` → Caramelized (existing); `sugar` → Sweet (existing, brief 5)
   - `baking chocolate` → **Dark Chocolate** (leaf; contains)
   - `sweet almond` → **Almond** (leaf; contains); `almond` → Almond
   - `salty` → Salty (existing node in the tree, used in brief 2); `lemon` → Lemon (leaf)
   - `syrup` → Maple Syrup (existing); `earthy` / `light earthy` → Musty / Earthy (existing)
   - `walnut` → **Nutty** (tier 2; contains: SCA has no walnut leaf)
   - `spicier` → the `spice` node (existing); `fruity` → Fruity (existing)
   - `burnt` → the existing `burnt` mapping
   - No node, text only: `deep`, `milk like`, `smooth`, `silky`, `creamy`, `gripy`, `tea like`, `wine` (if that is the reading), `sweet`, `bitter`, `light`.
9. **Order, loader, test-first**: brief 5 decisions 9 to 11. New script `load/loadCuppingEvidence7.ts`, `npm run load:cupping-evidence-7`; loader 5 must still report `already loaded` end to end on test.

## PART A: the session
`createSession` (decisions 1, 2), `addSessionCoffee` ×5 (decisions 3, 4). Expected: 1 session, 5 session coffees, 5 brew rows.

## PART B: cupper rows

Dimension ids as before: 1 Fragrance, 2 Aroma, 3 Flavor, 4 Sweetness, 5 Acidity, 6 Bitterness, 7 Body, 10 Finish Length, 11 Finish Character (aftertaste words), 12 Mouthfeel words.

### B1. Numeric values (0 to 15, native). `–` = no row. `raw_value` only where it differs from `'<v>'` / `'<min>-<max>'`.

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 5 Acidity | 4 Sweetness | 6 Bitterness | 7 Body | 10 Finish Length |
|---|---|---|---|---|---|---|---|---|---|
| Obsidian | Dana | 7 | 6 | 6 | 0 | 4, raw `4; faint marks at 2 and 3 read as struck` | 8, raw `8; mark at 11 X'd out` | 7, raw `7; faint mark at 11 read as struck` | 10 |
| Obsidian | Camila | 6 | 6 | 7 | 1 | 6 | 5, raw `5; faint mark at 3 read as struck` | 4 | 9 |
| Espresso Volo | Dana | 7 | 9 | 8 | 4, raw `4; faint mark at 0 read as struck` | 7, raw `7; faint mark at 5 read as struck` | 5, raw `5; faint marks at 8 and 13 read as struck` | 6, raw `6; faint mark at 11 read as struck` | 10 |
| Espresso Volo | Camila | 6 | 6 | 5 | 5 | 6 | 4, raw `4; faint mark at 1 read as struck` | 4 | 7, raw `7; faint mark at 5-6 read as struck` |
| Blossom | Dana | 6, raw `6; mark at 4 X'd out` | 5 | 9 | 0 | 3, raw `3; faint mark at 5 read as struck` | 9, raw `9; faint mark at 10 read as struck` | 9, raw `9; faint mark at 10 read as struck` | 10 |
| Blossom | Camila | 7 | 6 | 8, raw `8; faint mark at 5 read as struck` | 2 | 4 | 5, raw `5; faint mark at 3 read as struck` | 7, raw `7; faint mark at 4 read as struck` | 6 |
| Amsterdam | Dana | 7 | 7 | 8 | 0 | 6 | 6 | 6, raw `6; faint mark at 8 read as struck` | 5 |
| Amsterdam | Camila | 8 | 8 | 6 | 1, raw `1; faint mark at 3 read as struck` | 4 | 5, raw `5; faint mark at 2 read as struck` | 5 | 4 |
| Big City | Dana | 7 | 6 | 6 | 2, raw `2; faint mark at 0 read as struck` | 5, raw `5; faint marks at 6 and 8 read as struck` | 10, raw `10; faint marks at 8 and 9 read as struck` | 8 | 10 |
| Big City | Camila | 9 | 7 | 6, raw `6; faint mark at 7 read as struck` | 0 | 3 | 8, raw `8; faint mark at 4 read as struck` | 6 | 7, raw `7; faint mark at 3 read as struck` |

Both cuppers marked every line on every sheet, so every row has eight numeric values (no one-cupper dimensions this time). Three readers agree on all 80 cells after one correction (Camila's Aroma on Big City: the oval encloses the 7).

### B2. Words on 1, 2, 3, 11, 12 (`notes`; verbatim, lower-cased, spelling corrected where noted)

| coffee | cupper | 1 Fragrance | 2 Aroma | 3 Flavor | 12 Mouthfeel | 11 Finish Character |
|---|---|---|---|---|---|---|
| Obsidian | Dana | tobacco, ash | tobacco, deep, berries | tobacco or smokey | milk like, smooth | bitter |
| Obsidian | Camila | salty lemon(?) | (unreadable: ashes / amber / apricot across three readers) / caramel or syrup | smoky | – | syrup / smoky |
| Espresso Volo | Dana | dark choc, sweet, berries (then "gr…" cut off at the page edge) | sweet-berry, smell like wine/te… (cut off at the page edge) | berries | ~milky(?) tea like | bitter ~dark with fruits touch |
| Espresso Volo | Camila | berries / chocolate | chocolate / sugar | berries | – | tobacco / berries |
| Blossom | Dana | smokey, dark choc | dark choc | dark choc | smooth, silky | bitter lingers, bit of sweet |
| Blossom | Camila | smoky | sugar / chocolate | dark chocolate / | – | smoky / tobacco |
| Amsterdam | Dana | dark choc, caramel | dark choc, caramel, sweet | caramel | – | sweet - caramel |
| Amsterdam | Camila | caramel / dark chocolate (walnut?) | smoky / caramel(?) | dark chocolate | – | ~(scribbled out, unreadable) |
| Big City | Dana | ~tabaco, burnt or ashy | sugar, chocolate / cocoa | dark choc | more gripy | ~light bitter and a bit sweetness, smokey lingers |
| Big City | Camila | spicier(?) / fruity | sugar / sweet almond | baking chocolate (because of the mouth feel…, runs off the page) | creamy / earthy | sweet smoky |

### B3. Descriptors (node ← words; a struck word never makes a row)

| coffee | cupper | node ← words |
|---|---|---|
| Obsidian | Dana | Tobacco ← tobacco (fragrance, aroma, flavor) · Ashy ← ash · Berry ← berries · Smoky ← smokey |
| Obsidian | Camila | Salty ← salty · Lemon ← lemon · Caramelized ← caramel · Maple Syrup ← syrup (aroma, aftertaste) · Smoky ← smoky (flavor, aftertaste) (the first aroma word is unreadable: no row) |
| Espresso Volo | Dana | Dark Chocolate ← dark choc · Berry ← berries, sweet-berry (dark is struck: no second row) |
| Espresso Volo | Camila | Berry ← berries (fragrance, flavor, aftertaste) · Chocolate ← chocolate (fragrance, aroma) · Sweet ← sugar · Tobacco ← tobacco |
| Blossom | Dana | Smoky ← smokey · Dark Chocolate ← dark choc (fragrance, aroma, flavor) |
| Blossom | Camila | Smoky ← smoky (fragrance, aftertaste) · Sweet ← sugar · Chocolate ← chocolate · Dark Chocolate ← dark chocolate · Tobacco ← tobacco |
| Amsterdam | Dana | Dark Chocolate ← dark choc (fragrance, aroma) · Caramelized ← caramel (fragrance, aroma, flavor, aftertaste) |
| Amsterdam | Camila | Caramelized ← caramel (fragrance, aroma) · Dark Chocolate ← dark chocolate (fragrance, flavor) · Nutty ← walnut? · Smoky ← smoky |
| Big City | Dana | Roast ← burnt (via the existing `burnt` mapping) · Ashy ← ashy · Sweet ← sugar · Chocolate ← chocolate · Cocoa ← cocoa · Dark Chocolate ← dark choc · Smoky ← smokey (tabaco is struck: no Tobacco row) |
| Big City | Camila | Brown Spice ← spicier · Fruity ← fruity · Sweet ← sugar · Almond ← sweet almond · Dark Chocolate ← baking chocolate · Musty / Earthy ← earthy · Smoky ← smoky |

### B4. Call columns, `call_note`, `overall_notes`

| coffee | cupper | archetype_call (default) | call_note | overall_notes | if Dana rules her flavor-notes line is her call |
|---|---|---|---|---|---|
| Obsidian | Dana | null | no call on the call line; flavor notes (hot): "maybe light earthy"; no family ticked | | earthy |
| Obsidian | Camila | null | no call; "light earthy" written next to Other on the family line | | (stays null) |
| Espresso Volo | Dana | null | no call on the call line; flavor notes (hot): "C&N"; no family ticked | | chocolate_nutty |
| Espresso Volo | Camila | null | no call; Nutty / Cocoa ticked; "chocolate and nutty" written by the family line | | (stays null) |
| Blossom | Dana | null | no call on the call line; flavor notes (hot): "C&N - Dark"; no family ticked | | chocolate_nutty, position_call `dark` |
| Blossom | Camila | null | no call; Nutty / Cocoa ticked; "chocolate and nutty" written by the family line (first word unclear) | | (stays null) |
| Amsterdam | Dana | null | no call on the call line; flavor notes (hot): "C&N"; no family ticked | | chocolate_nutty |
| Amsterdam | Camila | null | no call; Nutty / Cocoa ticked; aftertaste words scribbled out | Aftertaste words fully scribbled out, unreadable; no row on 11. | (stays null) |
| Big City | Dana | null | no call on the call line; flavor notes (hot): "Earthy, this is the closest to both"; (warm): "its more earthy light"; no family ticked | "most bitter than the rest" written on the Bitterness line. | earthy, position_call `light` |
| Big City | Camila | null | no call; "Earthy" written under the family boxes; no box ticked | | (stays null) |

### B5. Merge
`mergeByRule` ×5. Expected disagreement lists with `cupper_gap = 2` (gap between the two ranges greater than 2), from B1; the test run must reproduce them or the closing report explains the cell:

| coffee | cupper disagreement (gap > 2) | one cupper only |
|---|---|---|
| Obsidian | Bitterness (8 vs 5), Body (7 vs 4) | none |
| Espresso Volo | Aroma (9 vs 6), Flavor (8 vs 5), Body (6 vs 4; gap 2, **not** a disagreement), Finish Length (10 vs 7) → **Aroma, Flavor, Finish Length** | none |
| Blossom | Bitterness (9 vs 5), Finish Length (10 vs 6) | none |
| Amsterdam | none (largest gaps 2: Flavor, Sweetness) | none |
| Big City | Acidity (2 vs 0: gap 2, not), Sweetness (5 vs 3: not), Finish Length (10 vs 7) → **Finish Length** | none |

Merged `archetype_call` null ×5 under the default of decision 7. Dial signal: fires for Blossom, Amsterdam, Big City (all their sessions native); **does not fire** for Obsidian and Volo (session 39 is `word_3`, so the pooled range is not all `ab_0_15`); the closing report says so per coffee.

## CONSTRAINTS
As brief 5: services only, no SQL, cupper ids, no catalog write, no row of sessions 35 to 40 touched, lints and build green, integrity green, nothing deleted, test DB twice then STOP for Dana's go, commits straight to main (loader, npm script, status lines, `WHAT_WE_BUILT*.md`, README line, `CLOSING_REPORT_7.md`).

## DONE =
One new session (2026-10-23, `ab_0_15_8dim`, not blind) with 5 session coffees in Dana's order and 5 brew rows; 10 cupper rows and 5 merged rows exactly as B1 to B4; disagreement lists as B5 (or explained); dial signals recorded for Blossom, Amsterdam, Big City and the reason none fired for Obsidian and Volo; the new cupper mappings of decision 8 and no other mapping row; pooled ranges for the five coffees now include this session (weights per the parameters); `evidence_newer_than_decision = true` for all five; sessions 35 to 40 unchanged; second run writes nothing.

Closing report: session id; session coffee ids with sample notes; score ids per cupper and merged with `merge_note`; mapping rows written and words left unmapped; dial signal rows before and after for the five; the pooled range and `session_weights` for Big City and Obsidian; `evidenceIntegrity` output; the workbench URLs.
