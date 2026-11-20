# Cupping Evidence, brief 10: closing report

Brief: `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_10_NOV20_CUPPING.md` · Run 2026-11-20 · Loader `load/loadCuppingEvidence10.ts`, `npm run load:cupping-evidence-10`.
Status: **done on test and on prod** (2026-11-20). Test: two runs, the second wrote nothing; stopped for Dana's go. Prod on her go: two runs, the second wrote nothing.

Dana confirmed every decision on 2026-11-20, decision 8 and the word mappings of decision 9 included ("yes to everything").

## Task 0 (read-only, prod `axisandbloom` and test `axisandbloom_test`)

| check | prod | test | result |
|---|---|---|---|
| Joe Bean Roasters / Joe Coffee Company | active / active | same | ok (Utopian inactive, not used) |
| Brazil, Indonesia, D.R. Congo (Joe Bean) | 2939, 2940, 2941, one row each, active | 4301, 4302, 4303 | ok, resolved by name at run time |
| The Daily (Joe Coffee) | 2907, active | 2907 | ok |
| sessions so far | The Daily: 36 only; the three Joe Bean: none | same | as the brief |
| session dated 2026-11-20 / this record source | none | none | ok |
| dial signal rows (cupping) for the four | none | none | before = nothing |
| pooled range before | The Daily: Sweetness 6–9, Acidity 3–4, Bitterness 4–6 (session 36, weight 1); the others none | same | |
| sessions 35–42 fingerprint | 102 scores (sum id 12189, 2 superseded, md5 477bd570…), 902 values (md5 483e2477…) | | recorded for the after check |
| cupper mappings | 69 current | 69 | |

**Expected-to-exist words (decision 9):** all present as cupper rows: chocolate, milk chocolate → Chocolate; dark chocolate → Dark Chocolate; cocoa → Cocoa; caramel → Caramelized; sugar → Sweet; honey → Honey; almond → Almond; nuts, roasted nuts → Nutty; dried fruits → Dried Fruit; fruity, fruits → Fruity; orange → Orange; clementine → Citrus Fruit; burnt → **Roast** (tier 3); tea → **Black Tea** (tier 2).

**New words:** none had a cupper row. `apricot` had a roaster row only (→ Other Fruit), so a cupper row is written, as the convention says. Every new node exists and is active: Fruity (1), Caramelized (3), Chocolate (3), Raisin (3), Other Fruit (2), Woody (3), Cereal (2), Hazelnut (3). `Green / Vegetative` exists at **tier 1 and tier 2**; the loader takes tier 1, as the brief says.

**One discrepancy in the brief's context text (no effect on the load):** "What this is" says session 36 has no Sweetness / Acidity / Bitterness / Body from Dana on The Daily. In fact session 36 (score 80) has Dana's **Sweetness 6–9, Acidity 3–4 (raw `3-4; crossed 1`), Bitterness 4–6**. What it lacks is Fragrance, Aroma, Flavor and Body. Nothing in this brief depends on it, so I went on.

## What was built

- `backend/src/features/cupping_evidence/load/loadCuppingEvidence10.ts`: loader 8's shape and run code, copied (loaders 2, 5, 7 and 8 untouched). The roaster precondition names Joe Bean and Joe Coffee only (decision 3). `FLAVOR_LINE_IS_CALL = true` (decision 7). It goes through `noteMappingService.setNoteMapping` and `cuppingService` (`createSession`, `addSessionCoffee`, `saveCupperScore`, `mergeByRule`), reads through `cuppingReads`, `noteMappingReads` and `roasteryPortalReads`, and contains no SQL.
- `backend/package.json`: `load:cupping-evidence-10`.
- No schema, table, view, comment or catalog change, so `CATALOG.md` does not change (G2.4 / G2.17 n/a).

Lints: `lint:cupping` clean, `lint:lineage` clean, `tsc --noEmit` clean.

## Evidence (test DB `axisandbloom_test`)

Run 1 (`tmp/b10_run1_test.log`): 1 session, 4 session coffees, 8 cupper rows, 4 merges, 12 mappings created, 17 mappings "already loaded".
Run 2 (`tmp/b10_run2_test.log`): **wrote nothing**: 29 mappings, 8 cupper rows and 4 merges all "already loaded", no new session or session coffee.

**Session 1977**: 2026-11-20, exact, `ab_0_15_8dim`, not blind, roaster not present, location null; record source, transcription, checked_by, session notes and brew defaults exactly as decisions 1 and 2.

| order | coffee | session coffee | sample_note | brew row |
|---|---|---|---|---|
| 1 | Brazil (4301) | 2322 | Dana page 3 sample 1; Camila page 2 sample 1 | 8.5 g / 150 g / 17.65, cupping bowl |
| 2 | Indonesia (4302) | 2323 | Dana page 3 sample 2; Camila page 2 sample 2 | same |
| 3 | D.R. Congo (4303) | 2324 | Dana page 4 sample 1; Camila page 1 sample 1 | same |
| 4 | The Daily (2907) | 2325 | Dana page 4 sample 2; Camila page 1 sample 2 | same |

**Scores**:

| coffee | Dana | Camila | merged | merged call | merge_note |
|---|---|---|---|---|---|
| Brazil | 4726 (`balanced_sweet`) | 4727 (null) | 4728 | balanced_sweet | union_v1; cupper disagreement (gap > 2) on: Fragrance, Flavor, Body, Finish Length |
| Indonesia | 4729 (`chocolate_nutty`) | 4730 (null) | 4731 | chocolate_nutty | union_v1; disagreement on: Fragrance, Finish Length; one cupper: Aroma, Flavor |
| D.R. Congo | 4732 (`fruity`) | 4733 (null) | 4734 | fruity | union_v1 (no disagreement) |
| The Daily | 4735 (`chocolate_nutty`) | 4736 (null) | 4737 | chocolate_nutty | union_v1 (no disagreement) |

The disagreement lists **reproduce B5 exactly**. There are 62 numeric cupper values (78 value rows including words-only lines), and one span (Dana / Brazil / Aroma 6–8). The loaded grid was compared with B1 cell by cell and every cell matches. The call notes and `overall_notes` are as B4; the merged rows carry both cuppers' notes.

**Decision 8 cells as loaded:**

| cell | loaded | raw_value |
|---|---|---|
| Dana / Indonesia / Body (Mouthfeel line) | 4 | `4; circle at 6 scribbled with a tail stroke, read as struck` |
| Dana / The Daily / Bitterness | 3 | `3; faint circle at 1 read as ghosted` |
| Camila / D.R. Congo / Sweetness | 6 | `6; one oval round the 6 with a small scribble at its upper left, read as live` |
| Camila / The Daily / Acidity | 1 | `1; oval at 0 scribbled over, read as struck` |
| Camila / Indonesia / Aroma, Flavor | no value; notes only (`wood / sweet`, `fruits`) | — |
| Camila / D.R. Congo / Fragrance | Fruity row, no Berry row | notes `fruits (no berries)` |
| Camila / Indonesia / Fragrance, third word | text only | notes `fruits, raisins, nature` |

**Descriptors:** 38 cupper descriptor rows, exactly B3 (Brazil 5 + 6, Indonesia 7 + 3, D.R. Congo 5 + 4, The Daily 4 + 4). `burnt` → Roast and `tea` → Black Tea come from the existing mappings. No struck or negated word made a row.

**Mappings written (12, all `source_kind = 'cupper'`, note `loader 2026-11-20; rule: …`):** light fruits → Fruity (contains) · a bit of fruits → Fruity (contains) · light caramel → Caramelized (contains) · light chocolate → Chocolate (contains) · raisins → Raisin (exact) · apricot → Other Fruit (contains) · wood → Woody (exact) · cedar → Woody (contains) · leaves → Green / Vegetative tier 1 (contains) · popcorn → Cereal (contains) · nuttella → Hazelnut (contains) · nutella → Hazelnut (contains). The 17 that already existed were not touched, and no other mapping row was written. Left text only (decision 9): sweet, sweetness, round, silky, creamy, nature, bitterness, biter, bitter, light acidity, acid, and `like almond milk texture` (Mouthfeel notes).

**Dial signal, before → after** (written by `mergeByRule`; there were no rows before for any of the four). It fired for all four, and all four have `suggested_slot_id` null because the slots have no band:

| coffee | signal | archetype | dimension | raw | n | note |
|---|---|---|---|---|---|---|
| Brazil | 39 | chocolate_nutty | 7 Body | 4.5 | 1 | no suggestion: slots 1–4 of Chocolate & Nutty have no band |
| Indonesia | 40 | earthy | 6 Bitterness | 1 | 1 | no suggestion: slots 1–4 of Earthy have no band |
| D.R. Congo | 41 | fruity | 5 Acidity | 6 | 1 | no suggestion: slots 1–4 of Fruity have no band |
| The Daily | 42 | chocolate_nutty | 7 Body | 7 | 2 | no suggestion: slots 1–4 of Chocolate & Nutty have no band |

The signal follows the catalog archetype, not the cupper call. Brazil's signal is Chocolate & Nutty even though Dana called it Balance, and Indonesia's is Earthy even though she called it C&N.

**Pooled range after** (`v_coffee_dimension_range`, merged):
- **Brazil** (one session, weight 1, s1977): Fragrance 7–10, Aroma 6–9, Flavor 7–10, Sweetness 12, Acidity 0–1, Bitterness 0–1, Body 2–7, Finish Length 5–10.
- **The Daily** (session_weights `[{s1977, 0.622}, {s36, 0.378}]` on the dimensions both sessions have): Sweetness 7.24–9 (mid 8.12), Acidity 1.76–2.76 (mid 2.26), Bitterness 3.38–4.13 (mid 3.76). New with s1977 alone: Fragrance 4–6, Aroma 6, Flavor 6–7, Body 6–8, Finish Length 8. `sessions_disagree` false everywhere.

**Coverage after:** all four have 2 cuppers, `has_merged`, and latest session 1977. The three Joe Bean coffees went from 0 sessions / 1 source to 1 session / 2 sources.

**Deviation from DONE: `evidence_newer_than_decision`.** It is **true for The Daily only**. For Brazil, Indonesia and D.R. Congo it stays **NULL**. The view (`schema.sql` around line 9201) returns NULL when the assignment has no `match_session_id` and the placement has no `placed_from_session_id`. Those three were decided from the portal answers with no session basis, so there is no decision date to be newer than. I did not change anything: the loader writes no catalog row and the view is out of scope. In the workbench they will show as "first cupping, no session basis" rather than as stale.

**Integrity:** `runCatalogIntegrityChecks()` allPass true, before and after. `evidenceIntegrity` output is identical before and after: #2 has 3 (test fixture scores 1–3) and #6 has 3 (Colombia La Familia Guarnizo 2903, The Village 2904, Tiger Stripe 2914; this is test-DB state, and prod differs). This session added nothing to either check (`tmp/b10_integrity_before_test.txt` = `tmp/b10_integrity_after_test.txt`).

**Sessions 35–42:** unchanged (score and value fingerprints identical before and after). No supersede, and no dispute raised or withdrawn.

## Production (`axisandbloom`, 2026-11-20, on Dana's go)

Before: the probe was identical to Task 0 (`tmp/b10_before_prod.txt`). Integrity: catalog allPass true; evidence #2 has 3 (scores 1–3), #6 has 3 (Colombia La Familia Guarnizo 2903, The Village 2904, Tiger Stripe 2914).

Run 1 (`tmp/b10_run1_prod.log`): 12 mappings created and 17 already there; **session 43**; session coffees Brazil **78**, Indonesia **79**, D.R. Congo **80**, The Daily **81**.

| coffee | Dana | Camila | merged | merged call | disagreement (gap > 2) |
|---|---|---|---|---|---|
| Brazil (2939) | 171 | 172 | 173 | balanced_sweet | Fragrance, Flavor, Body, Finish Length |
| Indonesia (2940) | 174 | 175 | 176 | chocolate_nutty | Fragrance, Finish Length; one cupper: Aroma, Flavor |
| D.R. Congo (2941) | 177 | 178 | 179 | fruity | none |
| The Daily (2907) | 180 | 181 | 182 | chocolate_nutty | none |

Run 2 (`tmp/b10_run2_prod.log`): **wrote nothing**: 29 mappings, 8 cupper rows and 4 merges all "already loaded".

After (`tmp/b10_after_prod.txt`):
- Values, descriptors, call notes, merge notes and pooled ranges are **identical to the test DB**, compared row by row with ids masked: 62 numeric values and one span, 38 descriptors.
- The 12 cupper mappings written match the test run; cupper mappings went from 69 to 81 current.
- Dial signals **39** Brazil (chocolate_nutty, Body 4.5), **40** Indonesia (earthy, Bitterness 1), **41** D.R. Congo (fruity, Acidity 6), **42** The Daily (chocolate_nutty, Body 7, n 2), all with `suggested_slot_id` null (no band). There were none before.
- The Daily's pooled range: session_weights s43 0.622 / s36 0.378. Sweetness 7.24–9, Acidity 1.76–2.76, Bitterness 3.38–4.13; Fragrance 4–6, Aroma 6, Flavor 6–7, Body 6–8 and Finish Length 8 come from s43 alone. Brazil's is as on test.
- `evidence_newer_than_decision`: The Daily true; Brazil, Indonesia, D.R. Congo null (no session basis; see the deviation above).
- Sessions 35–42 are unchanged: scores 102 (md5 477bd570…) and values 902 (md5 483e2477…), the same as before.
- Integrity after = before (`tmp/b10_integrity_before_prod.txt` = `tmp/b10_integrity_after_prod.txt`).

Commit **`20df396`**: loader, npm script, brief status line, `WHAT_WE_BUILT.md` entry 279, README line and status, this report. Pushed to main. Deploy run 44797706680 **green** (backend and frontend) → revision **axis-bloom-backend-00882-grh**. Startup log: `DB schema verified`; `[data-catalog]` report only, 1 of 11 checks with findings (#6 dead-table candidates, as before); `[evidence-integrity]` #2 = 3 and #6 = 3, the same as before the load; no ERROR. Lints (all six) and `tsc --noEmit` were green before the push. The full vitest suite was not run: the change is a standalone loader script that no test imports, and the suite has known baseline failures (OT-117).

## Workbench

- Joe Bean: `/admin/roastery-portal?roastery=19098f5c-99b9-4d7c-90ef-ee33d1e896b7&view=workbench`
- Joe Coffee: `/admin/roastery-portal?roastery=f42ad179-9ef4-410a-a92e-464eae1d84ce&view=workbench`

## For Dana afterwards (no action in this brief)

Two calls differ from where the coffee sits today: **Brazil** is Chocolate & Nutty in the catalog and Dana called it Balance; **Indonesia** is Earthy and she called it fruity C&N. D.R. Congo (Fruity) and The Daily (C&N) agree with their placement. Any move is her placement pass in the workbench.
