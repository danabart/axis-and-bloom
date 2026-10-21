# Closing report: cupping evidence brief 5 (the Balance cupping, 2026-10-21)

Brief: `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_5_BALANCE_CUPPING.md`. Loader: `load/loadCuppingEvidence5.ts` (`npm run load:cupping-evidence-5 -- --target test | --target prod --expect-db axisandbloom`). Helpers were copied from loader 2, not extracted, so loader 2 is untouched. `WHAT_WE_BUILT.md` #229.

**Status: done on test and prod, 2026-10-21.**

**How it ran.**
1. A first test run surfaced four questions; Dana ruled on them the same day (banana, mapping rows, Camila's sample numbers, test pinning).
2. The loader was fixed for rulings 1 to 3.
3. The test DB was refreshed from prod.
4. The loader ran twice on test, then twice on prod.

**Prod matches test row for row.** The before-states were identical apart from the database name. Both runs' logs are identical. The after-states differ only in the dial signals' `computed_at`. Same ids on both.

## Session and session coffees

**Session 40:**
- 2026-10-21, `exact`, `ab_0_15_8dim`, not blind, roaster not present, location null.
- `record_source`: `paper: Balance Cupping - Oct 21 2026.pdf (4 pages; misc/roasteries/Balance Cupping)`.
- `transcribed_by` `Claude (CTO session)` on 2026-10-21; `checked_by` `blind second read 2026-10-21 (TRANSCRIPTION_CHECK_BRIEF_5_2026-10-21.md)`.
- `session_notes` and `brew_defaults` exactly as decisions 1 and 2.
- 4 `cupping_brew_params` rows: dose 8.5, water 150, ratio 17.65, grind `21`, device `cupping bowl`.

The coffees were resolved at run time by (roaster, name), one row each: Union 2934, Benchmark 2905, Fabricator House Roast 2917, Geometric Filter Coffee 2915.

| order | sc | coffee | sample_note | Dana | Camila | merged | merge_note |
|---|---|---|---|---|---|---|---|
| 1 | 64 | Union (2934) | Dana sample 1; Camila sample 5 | 128 | 129 | 130 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Bitterness; one cupper: Body, Finish Length |
| 2 | 65 | Benchmark (2905) | Dana sample 2; Camila sample 6 | 131 | 132 | 133 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; one cupper: Finish Length |
| 3 | 66 | Fabricator House Roast (2917) | Dana sample 3; Camila sample 1 | 134 | 135 | 136 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Flavor; one cupper: Body, Finish Length |
| 4 | 67 | Geometric Filter Coffee (2915) | Dana sample 4; Camila sample 2 | 137 | 138 | 139 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Sweetness, Bitterness; one cupper: Finish Length |

- **Disagreement lists** are exactly B5's.
- **Calls:** `archetype_call`, `archetype_call_secondary`, `position_call` and `slot_call_id` are null on all 12 rows. The cupper `call_note`s and `overall_notes` are as B4; the merged rows concatenate them per cupper.
- **Values, descriptors and calls** were checked row by row against B1 to B4.
- **Banana** (ruling 1): Dana's Benchmark Acidity row is `1`, `raw_value` `1; faint mark at 0 read as struck`, `notes` `banana (acidity character: low, banana-like; Dana 2026-10-21)`. The merged Acidity is `0–1` with notes `Dana: banana (…)`. There is no Other Fruit row and no banana mapping.
- **Readers' comments** are left out of `notes` per the rulings: `caramel / burn(?)`, `spicier(?)`, `light ~bitter ~acid sweet acid`.
- **Struck words** stay in `notes` only, as `~word`.

## Mapping rows (12, `source_kind = 'cupper'`, `note = 'loader 2026-10-21; rule: …'`)

| words | node | tier | rule |
|---|---|---|---|
| tangerine | Citrus Fruit | 2 | node |
| strawberry | Strawberry | 3 | exact |
| caramel | Caramelized | 3 | exact (Dana's ruling; loader 2's formula would say `contains`) |
| fruity tea | Black Tea | 2 | node |
| brown sugar | Brown Sugar | 2 | exact |
| honey | Honey | 3 | exact |
| sugar | Sweet | 1 | node |
| smoky | Smoky | 3 | exact |
| smokey | Smoky | 3 | contains |
| spicier | Brown Spice | 2 | node |
| dark choc | Dark Chocolate | 3 | contains |
| light fruity | Fruity | 1 | node |

Mapping counts: cupper 31 → 43; roaster rows unchanged (67). No other mapping row was written.

**Left unmapped, in text only:** `savory`, `butter`, `sweetish`, `silky`, `2% milk`, `like tea`, and the unreadable `burn(?)`. `banana` is an acidity note, not a word to map.

## Dial signal (cupping), before → after

All on dimension 5 (Acidity); basis `archetype_vector (May 2026 targets)` before and after. Each earlier row was superseded by the service when its merge refreshed the coffee.

| coffee | before (id, slot, raw, n) | after (id, slot, raw, n) |
|---|---|---|
| Union 2934 | 19, slot 3, 5.5, 1 | 21, slot 3, 3.5, 2 |
| Benchmark 2905 | 10, slot 3, 2.5, 1 | 22, slot 3, 0.5, 2 |
| Fabricator 2917 | 17, slot 7, 6, 1 | 23, slot 7, 4, 2 |
| Geometric 2915 | 15, slot 3, 4, 1 | 24, slot 3, 3, 2 |

- The suggested slot did not move on any of the four.
- The loader makes no extra `refreshDialSignal` call: `mergeByRule` already makes it, and each refresh writes a row.

## evidenceIntegrity (prod, after the load)

```
db axisandbloom catalog allPass true
[evidence-integrity] check #2 — No current merged row without a current cupper row on the same sample: 3 (e.g. score 1 (sample 1, coffee 1); score 2 (sample 2, coffee 2); score 3 (sample 3, coffee 3))
[evidence-integrity] check #6 — No coffee with a home placement and an assignment without a basis: 1 (e.g. Flying Jewel (2891))
```

These are the two known fails (#2 the Path seed's merged rows, #6 Flying Jewel); the other six checks pass. The test DB gave the same output.

## Views (prod)

- **`v_coffee_dimension_range`:** all four coffees read session 40 on every dimension, with `n_sessions` 2 and `all_ab_scale` true.
- **`v_evidence_coverage.evidence_newer_than_decision`:** false → **true** for 2905, 2915, 2917 and 2934.
- **`v_coffee_dimension_history`, Benchmark (2905):**

| dimension | session 36 (merged 77) | session 40 (merged 133) |
|---|---|---|
| Fragrance | words only | 5–6 |
| Aroma | words only | 6–7 |
| Flavor | words only | 6–8 |
| Sweetness | 8–10 | 5 |
| Acidity | 1–4 | 0–1 |
| Bitterness | 2–4 | 1–2 |
| Body | – | 4–5 |
| Finish Length | – | 4 |
| Finish Character | words only | words only |
| Mouthfeel | words only | words only |

## Sessions 35 to 39 untouched

The 59 score rows of sessions 35 to 39 (ids, supersede state, `merge_note`) are identical before and after on test and on prod, and match `CLOSING_REPORT_2.md`.

## Runs

**Run 1** wrote, on test and prod alike:
- 12 mappings;
- 1 session;
- 4 session coffees (+4 brew rows);
- 8 cupper rows (`ab_0_15`);
- 4 merges.

**Run 2 on prod** (`tmp/b5_run2_prod.log`, identical to test's):
```
# loadCuppingEvidence5 → axisandbloom
coffees: Union=2934, Benchmark=2905, Fabricator House Roast=2917, Geometric Filter Coffee=2915
mapping 'tangerine': already loaded (→ Citrus Fruit)
… (12 mappings: already loaded)
session BAL (40): already loaded
session coffee Union (64): already loaded
… (4 session coffees, 8 cupper rows, 4 merges: already loaded)

# counts this run
  cupper rows already: 8
  mappings already: 12
  merges already: 4
```

## Test changes (ruling 4: pin, do not bump; test-only)

The views keep each cupper's latest session, so a value assertion pins the session id **and** uses a coffee whose rows still come from that session. The effect of a later session is tested by coffee id: Tiger Stripe 2914 has one session; Geometric 2915 has two.

| file / test | before | after |
|---|---|---|
| `src/db/evidenceViews.test.ts` A1 "Joe Bean Geometric Acidity: the cuppers disagree (Dana 4-7, Camila 1)" | Geometric's latest rows | **"Joe Bean Blossom Aroma, session 37: the cuppers disagree (Dana 6, Camila 11)"**, `cupper_session_id = 37`. Geometric's s37 rows are no longer its current ones, so the disagreement case moved to Blossom, cupped only in s37. |
| A1 "Tiger Stripe Acidity: the cuppers agree" | no session | `cupper_session_id = 37` |
| A1 "Joe Coffee: one row per coffee x dimension (one cupper)" | all of Joe Coffee | `cupper_session_id = 36` |
| A3 "Blossom: Dana earthy, Camila no call" | no session | `v_evidence_archetype_call.session_id = 37` |
| A3 "every brief 2 coffee has a basis and no newer evidence than its decision" | 21 rows all false | split: "every brief 2 coffee has a basis" (unchanged), plus the positive test **"evidence newer than the decision: false for Tiger Stripe (2914), true for Geometric (2915)"** |
| A5 "no control sample and no repeat yet" | `repeatability` null everywhere | split: "no control sample yet" (unchanged), plus the positive test **"repeat cupping: 2914 has 1 session, 2915 has 2 (`v_evidence_coverage.n_sessions`), and a repeat gives Dana / Camila a non-null `repeatability`"** |
| `src/routes/evidenceAdmin.test.ts` coffee endpoint | Benchmark `calls.length` 1 | calls pinned to La Familia (2903, only s36): `[['Dana', 36, 'balanced_sweet']]` |
| roastery endpoint | `staleDecisions` 0 | coverage by id: 2914 false, 2915 true; `staleDecisions` equals the number of coverage rows with newer evidence |
| workbench write test | `SELECT id FROM cupping_sessions ORDER BY id DESC LIMIT 1` | session 37 |

No test reads "the latest session in the DB" any more.

**Full suite on the refreshed and loaded test DB:** 799 passed, 6 failed. The six are the OT-19 `quizScoring` failures only (`tmp/b5_fullsuite2.log`).

**Other checks:**
- Six lints (`catalog`, `retention`, `customer`, `lineage`, `roastery-portal`, `cupping`) exit 0.
- `npm run build` exits 0.
- `runCatalogIntegrityChecks().allPass = true` on test and prod.

## Workbench

All four coffees now show as "newer evidence than the decision". Open the roastery's workbench, then pick the coffee in its queue; the workbench has no per-coffee link.

- Union: `/admin/roastery-portal?roastery=bbf250d1-e433-4233-a30b-437fe62bcc4a&view=workbench`
- Benchmark: `/admin/roastery-portal?roastery=f42ad179-9ef4-410a-a92e-464eae1d84ce&view=workbench`
- Fabricator House Roast, Geometric Filter Coffee: `/admin/roastery-portal?roastery=19098f5c-99b9-4d7c-90ef-ee33d1e896b7&view=workbench`

## Commit

One commit straight to main:
- loader and `package.json` script;
- the two test files;
- brief status line;
- `WHAT_WE_BUILT.md` #229;
- `WHAT_WE_BUILT_DB.md` line;
- folder README status line;
- this report.

No schema change, so no `comments.sql` / `CATALOG.md` change.
