# Closing report: cupping evidence brief 7 (the Earthy / C&N cupping, 2026-10-23), test DB

Brief: `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_7_EARTHY_CUPPING.md`. Loader: `load/loadCuppingEvidence7.ts` (`npm run load:cupping-evidence-7 -- --target test`). It is loader 5's shape and run code, copied, not extracted, so loader 5 is untouched.

**Status: done on test, then on prod after Dana's go (2026-10-23). Prod session 41. The three readings below were accepted as made. Prod verification is the last section.**

**Loader 5** still reports `already loaded` end to end on test: 8 cupper rows, 12 mappings and 4 merges, all already there (`tmp/b7_loader5_check.log`).

## Decision 7 (Dana, 2026-10-23): her flavor-notes line is her call

Dana's message left the decision-7 placeholder unfilled, so I asked before loading; she answered **"Flavor-notes line is my call"**. The loader carries this as `FLAVOR_LINE_IS_CALL = true` and refuses to run while it is unset.

| Coffee | Dana's row | Camila's row | Merged row |
|---|---|---|---|
| Obsidian | `earthy` | null | `earthy` |
| Espresso Volo | `chocolate_nutty` | null | `chocolate_nutty` |
| Blossom | `chocolate_nutty`, position `dark` | null | `chocolate_nutty`, position `dark` |
| Amsterdam | `chocolate_nutty` | null | `chocolate_nutty` |
| Big City | `earthy`, position `light` | null | `earthy`, position `light` |

- These are B4's right-hand column.
- Camila's ticks and words stay call notes; her rows have `archetype_call` null.
- Each merged call is Dana's: under the merge rule, a cupper with no call does not block one.
- `archetype_call_secondary` and `slot_call_id` are null everywhere.
- The call notes are as B4 on all ten rows.

## Ids (test DB; prod will get its own)

**Session 385**:
- 2026-10-23 exact, `ab_0_15_8dim`, not blind, roaster not present, location null.
- Provenance and session notes as in decision 1; brew defaults as in decision 2 (grind not recorded, so null).
- On test the session id is 385 because test-suite fixtures used the ids in between; prod continues from 40.

| order | sc | coffee | sample_note | Dana | Camila | merged | merge_note |
|---|---|---|---|---|---|---|---|
| 1 | 568 | Obsidian (2929) | Dana page 1 sample 1; Camila page 5 sample 1 | 955 | 956 | 957 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Bitterness, Body |
| 2 | 569 | Espresso Volo (2927) | Dana page 1 sample 2; Camila page 5 sample 2 | 958 | 959 | 960 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Aroma, Flavor, Finish Length |
| 3 | 570 | Blossom Dark Roast (2916) | Dana page 2 sample 1; Camila page 6 sample 1 | 961 | 962 | 963 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Bitterness, Finish Length |
| 4 | 571 | Amsterdam (2906) | Dana page 2 sample 2; Camila page 6 sample 2 | 964 | 965 | 966 | union_v1; scales: Camila ab_0_15, Dana ab_0_15 |
| 5 | 572 | Big City (2908) | Dana page 3 sample 1; Camila page 4 sample 1 | 967 | 968 | 969 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Finish Length |

- **Disagreements:** exactly as B5, including Volo's Body (gap 2, not a disagreement) and Big City's Acidity and Sweetness (gap 2, not).
- **One-cupper dimensions:** none.
- **Brew rows:** 5, each 8.5 g / 150 g / ratio 17.65, cupping bowl.
- **Values, descriptors and notes:** loaded as B1 to B4, every `raw_value` as written. Three readings, all the brief's own text:
  - **B2 cells are loaded verbatim, readers' brackets included.** Examples: `(unreadable: ashes / amber / apricot across three readers) / caramel or syrup`, `… (then "gr…" cut off at the page edge)`, `dark chocolate /`. The check rules "keep the text", and loader 2 did the same.
  - **Amsterdam / Camila / aftertaste:** no row on dimension 11. B2 shows `~(scribbled out, unreadable)`, but the transcription check and B4 rule "no row on 11, named in `overall_notes`", and that is what was loaded.
  - **Volo / Dana / aftertaste:** "bitter ~dark with fruits touch" stays in `notes`. B3 gives no Fruity row for "fruits", so none was written.

## Mapping rows written (`source_kind = 'cupper'`, `note = 'loader 2026-10-23; rule: …'`)

| words | node | tier | rule |
|---|---|---|---|
| `tabaco` | Tobacco | 2 | node |
| `tobacco` | Tobacco | 2 | exact |
| `ash` | Ashy | 3 | contains |
| `ashy` | Ashy | 3 | exact |
| `baking chocolate` | Dark Chocolate | 3 | contains |
| `sweet almond` | Almond | 3 | contains |
| `almond` | Almond | 3 | exact |
| `salty` | Salty | 3 | exact |
| `lemon` | Lemon | 3 | exact |
| `earthy` | Musty / Earthy | 3 | contains |
| `light earthy` | Musty / Earthy | 3 | contains |
| `walnut` | Nutty | 2 | contains (as the brief states) |

- **Counts:** cupper mappings 43 → 55. Roaster rows unchanged (67 current).
- **Reused cupper rows** (not rewritten): smokey, smoky, berries, dark choc, dark chocolate, chocolate, cocoa, caramel, sugar, syrup, spicier, fruity, burnt.
- **Tobacco** is a tier-2 node in our tree (the brief says leaf). It doesn't change any row.

**Left unmapped (text only):** `deep`, `milk like`, `smooth`, `silky`, `creamy`, `gripy`, `tea like`, `wine` / `te…` (cut off), `sweet`, `bitter`, `light`, and the unreadable first aroma word on Camila's Obsidian.

## Dial signal (cupping), before → after

| coffee | archetype | before | after |
|---|---|---|---|
| Blossom (2916) | earthy | id 16, slot 15, 6.5, n 1 | **id 25, slot 15, 6.81, n 2** |
| Amsterdam (2906) | chocolate_nutty | id 11, slot 24, 7.5, n 1 | **id 26, slot 24, 6.28, n 2** |
| Big City (2908) | earthy | id 12, slot 15, 8, n 1 | **id 27, slot 16, 8.61, n 2: the suggested slot moved, earthy 15 → 16** |
| Obsidian (2929) | earthy | none | none (see below) |
| Espresso Volo (2927) | earthy | none | none (see below) |

- **Recorded by the merges.** The loader makes no extra refresh. Each new row's notes read `archetype_vector (May 2026 targets); pooled 2 sessions (ratio 0.667, half-life 365 d), latest s385`.
- **Big City's slot moved.** Its pooled Bitterness rose from 8 to 8.61, and the suggestion moved from earthy slot 15 to slot 16. This is a suggestion only: nothing in the catalog changed, and the placement is Dana's.
- **No signal for Obsidian and Volo.** This is the rule working:
  - Session 39 is Camila's `word_3` scale. On every dimension where it has a value (Sweetness, Acidity, Bitterness), the pooled range is not all `ab_0_15`, Bitterness included, which is earthy's dial dimension.
  - Their other dimensions pool from session 385 alone and are native.
  - `refreshDialSignal` records only when every merged dimension is all `ab_0_15`, so it retracted: no row, as before.

## Pooled range after the load

**Big City (2908).** Pooled with session 36, which was Dana alone.

| dimension | range | midpoint | sessions | weights |
|---|---|---|---|---|
| Sweetness | 3.39–5.39 | 4.39 | 2 | s385 0.61 / s36 0.39 |
| Acidity | 0–2 | 1.00 | 2 | s385 0.61 / s36 0.39 |
| Bitterness | 7.61–9.61 | 8.61 | 2 | s385 0.61 / s36 0.39 |
| Body | 6.39–8.39 | 7.39 | 2 | s385 0.61 / s36 0.39 |
| Fragrance | 7–9 | 8.00 | 1 | s385 |
| Aroma | 6–7 | 6.50 | 1 | s385 |
| Flavor | 6 | 6.00 | 1 | s385 |
| Finish Length | 7–10 | 8.50 | 1 | s385 |

- Before the load: Sweetness 4–6, Acidity 0–2, Bitterness 7–9, Body 7–9, all from session 36.
- No `sessions_disagree`.
- 0.61 / 0.39: session 36 is 21 days older than 385.

**Obsidian (2929).** Pooled with session 39, which used Camila's word scale.

| dimension | range | midpoint | sessions | weights | all ab_0_15 | sessions disagree |
|---|---|---|---|---|---|---|
| Sweetness | 2.46–5.61 | 4.04 | 2 | s385 0.61 / s39 0.39 | no | **yes** |
| Acidity | 0–2.54 | 1.27 | 2 | s385 0.61 / s39 0.39 | no | no |
| Bitterness | 5–9.93 | 7.46 | 2 | s385 0.61 / s39 0.39 | no | **yes** |
| Fragrance | 6–7 | 6.50 | 1 | s385 | yes | – |
| Aroma | 6 | 6.00 | 1 | s385 | yes | – |
| Flavor | 6–7 | 6.50 | 1 | s385 | yes | – |
| Body | 4–7 | 5.50 | 1 | s385 | yes | – |
| Finish Length | 9–10 | 9.50 | 1 | s385 | yes | – |

- Before the load: Sweetness 0–5, Acidity 0–5, Bitterness 5–13, from session 39 alone (word scale, converted).
- The weights are 0.61 / 0.39: session 39 is dated 2026-09-20 (estimated), 33 days before 385.

## Evidence newer than the decision

True for all five; `n_sessions` is 2 each. Before the load it was false for all five.

## Sessions 35 to 40 untouched

All 71 score rows of sessions 35 to 40 are identical before and after: ids, supersede state and `merge_note`.

## Runs

**Run 1** (`tmp/b7_run1_test.log`) wrote:
- 12 mappings;
- 1 session;
- 5 session coffees (+5 brew rows);
- 10 cupper rows (`ab_0_15`);
- 5 merges, which recorded the 3 signals.

**Run 2** (`tmp/b7_run2_test.log`): `already loaded` at every step, nothing written.
```
  cupper rows already: 10
  mappings already: 12
  merges already: 5
```

## Checks (test DB)

- `runCatalogIntegrityChecks().allPass = true`.
- `evidenceIntegrity`: the two known failures only.
  ```
  [evidence-integrity] check #2 — No current merged row without a current cupper row on the same sample: 3 (e.g. score 1 (sample 1, coffee 1); score 2 (sample 2, coffee 2); score 3 (sample 3, coffee 3))
  [evidence-integrity] check #6 — No coffee with a home placement and an assignment without a basis: 1 (e.g. Flying Jewel (2891))
  ```
- The six lints exit 0; `npm run build` exits 0; tsc clean.
- No test file changed. The data load touches no test assertion: the brief 3 tests pin sessions 36 / 37 and coffees 2914 / 2915.

## Workbench

All five coffees now show as "newer evidence than the decision". Open the roastery's workbench, then pick the coffee:

- Obsidian, Espresso Volo: `/admin/roastery-portal?roastery=bbf250d1-e433-4233-a30b-437fe62bcc4a&view=workbench`
- Blossom Dark Roast: `/admin/roastery-portal?roastery=19098f5c-99b9-4d7c-90ef-ee33d1e896b7&view=workbench`
- Amsterdam, Big City: `/admin/roastery-portal?roastery=f42ad179-9ef4-410a-a92e-464eae1d84ce&view=workbench`

## Prod, on Dana's go

1. Loader 7 on prod twice.
2. Then loader 5 once on prod, to confirm `already loaded`.
3. The same state, integrity and signal checks.
4. One commit straight to main: the loader, the npm script, the brief's status line, `WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`, the README line and this report.

## Prod (2026-10-23, after Dana's go)

**Before.** The prod before-state was identical to test's, apart from the database name.

**Run 1** (`tmp/b7_run1_prod.log`) wrote:
- 12 mappings;
- **session 41**;
- session coffees 68 to 72 (+5 brew rows);
- cupper rows 140 to 153;
- merged rows 142, 145, 148, 151, 154.

**Run 2:** `already loaded` at every step; 0 lines say "created".

| order | sc | coffee | Dana | Camila | merged | merged call | merge_note |
|---|---|---|---|---|---|---|---|
| 1 | 68 | Obsidian (2929) | 140 | 141 | 142 | earthy | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Bitterness, Body |
| 2 | 69 | Espresso Volo (2927) | 143 | 144 | 145 | chocolate_nutty | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Aroma, Flavor, Finish Length |
| 3 | 70 | Blossom Dark Roast (2916) | 146 | 147 | 148 | chocolate_nutty, position dark | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Bitterness, Finish Length |
| 4 | 71 | Amsterdam (2906) | 149 | 150 | 151 | chocolate_nutty | union_v1; scales: Camila ab_0_15, Dana ab_0_15 |
| 5 | 72 | Big City (2908) | 152 | 153 | 154 | earthy, position light | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Finish Length |

**Verified on prod** (read-only `tmp/b7_state.mjs prod 41`, compared with the test after-state, ids normalised):
- **The rows match test row for row.** That covers all ten cupper rows and five merged rows: values, `raw_value`, notes, descriptors, call notes and `overall_notes`; the merge notes and disagreement lists; Dana's five archetype calls and positions on her rows and the merged rows; Camila's rows with null calls. Also the five sample notes and brew rows, the pooled ranges and `session_weights` for Big City and Obsidian, and `evidence_newer_than_decision = true` for all five.
- **The only differences** are the database name and test's leftover superseded roaster-mapping rows (current roaster rows: 67 on both).
- **The 12 cupper mapping rows** exist (`note LIKE 'loader 2026-10-23%'`). Cupper mappings: 43 → 55.
- **Dial signals:**
  - Blossom: id 25, slot 15, 6.81.
  - Amsterdam: id 26, slot 24, 6.28.
  - **Big City: id 27, slot 16, 8.61** (was slot 15).
  - Each new row's notes read `archetype_vector (May 2026 targets); pooled 2 sessions (ratio 0.667, half-life 365 d), latest s41`.
  - **No signal row for Obsidian or Volo.**
- **Sessions 35 to 40:** the 71 score rows are identical before and after.
- **Loader 5 on prod:** `already loaded` end to end (8 cupper rows, 12 mappings, 4 merges).
- **`runCatalogIntegrityChecks().allPass = true`.**
- **`evidenceIntegrity`:** the two known checks (#2 and #6) and nothing else. **Check #6 now lists two coffees on prod.**
  ```
  [evidence-integrity] check #2 — No current merged row without a current cupper row on the same sample: 3 (e.g. score 1 (sample 1, coffee 1); score 2 (sample 2, coffee 2); score 3 (sample 3, coffee 3))
  [evidence-integrity] check #6 — No coffee with a home placement and an assignment without a basis: 2 (e.g. Flying Jewel (2891); Tiger Stripe Espresso (2914))
  ```
  - **Tiger Stripe Espresso (2914) is new in check #6, and not from this load.** It was placed home on slot 23 at 2026-10-22 17:21 UTC (`coffee_slot_assignment` 1752, no basis). Its archetype was re-assigned `chocolate_nutty` / high / manual at 2026-10-22 19:31 UTC (assignment 1229, no notes or basis).
  - This load wrote no catalog row: no slot or archetype assignment today for any of the five coffees, and Tiger Stripe is not in session 41.
  - It is the "2914 basis" item already open from the coffee presentation brief. A basis line through the workbench clears it.
