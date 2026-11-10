# Cupping Evidence, brief 9: disputes. Closing report

> Brief: `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_9_DISPUTES.md` · Run 2026-11-09 to 2026-11-10 · **Done:** test DB, deployed, Part E passed on prod.

## Status

**Deployed 2026-11-10:**
- Commit `196616f` was pushed to main. Deploy run 42856503724 passed (backend and frontend), and the new revision is `axis-bloom-backend-00848-wvm`.
- Startup log: no ERROR lines; `[db-comments]` applied 1773 statements; `[data-catalog]` reports 169 tables, 87 views and 1517 columns, with nothing uncommented.
- The only boot finding beyond what was already open was CATALOG.md being stale, and that was expected. CATALOG.md was then regenerated from prod (catalog-hash `2b28a93…`, equal to the live hash) and committed.
- Evidence integrity shows the same two known findings, #2 and #6 (Tiger Stripe). Quiz #10 and sommelier #3 were already open.
- Part E passed on production on 2026-11-10 (section below).

**Before the deploy (2026-11-09):**

- **Done:** built, and tested on `axisandbloom_test` (refreshed from prod at the start of this run). All six lints, backend `tsc`, frontend `tsc` (no new errors) and `vite build` are green.
- **Not done:** nothing is committed, pushed or deployed.
- **After the deploy:** `CATALOG.md` is regenerated from prod (the new table only exists there once the deploy runs `schema.sql`), as in brief 6.

## Task 0 findings (read-only)

1. **CATALOG.md check (G2.4).** Nothing fits:
   - `cupping_scores.superseded_*` replaces a row with a successor, so it rewrites the evidence.
   - `cupper_calibration_offset` is a correction applied to every value of a cupper × dimension; it cannot exclude a single value.
   - `evidence_parameter` holds numbers, not facts.
   - `roastery_remark` is the roaster's voice.
   - So a new `cupping_score_dispute` table, prefix `cupping_`.
2. **`mergeByRule`.** Every merge (`mergeByRule`, the re-merge inside `saveCupperScore`, and now raise/withdraw) goes through `mergeInTx → loadCupperRows`. Its heads query and values query are the only path into `unionScores`, so the dispute filter lives in one function.
   - `n` from the loaders is the cupper gap (2), not the number of cuppers. A dispute re-merge uses `param('cupper_gap')`, which is 2 on prod, so the gap is unchanged.
3. **Views that read cupper rows**, with what each one now does:

| View | Reads | Brief 9 |
|---|---|---|
| `v_collaborative_flavor_wheel` | merged rows only | no change, follows the merge |
| `v_coffee_dimension_range` | merged values; `behind_merged` counts the cupper rows behind each merge (`n_scores`, `all_ab_scale`) | values follow the merge; a whole-row-disputed cupper row is no longer counted behind it, so `all_ab_scale` matches the merge's own `allAbScale` (deviation below) |
| `v_coffee_dimension_history` | merged values; the `bc` lateral reads cupper scale codes | values follow; whole-row-disputed rows are excluded from `scale_codes` / `all_ab_scale` |
| `v_coffee_dimension_range_calibrated` | cupper values (aggregated) | open disputes excluded |
| `v_cupping_scores_readable` | every value (shown) | flag: `is_disputed`, `dispute_reason`, `dispute_id` (the value's own dispute, else the row's) |
| `v_cupping_score` | every header (shown) | flag (row level) |
| `v_cupping_score_descriptor` | every descriptor (shown) | flag (row level) |
| `v_cupping_session`, `v_cupping_session_coffee` | cupper names only | no change: who was at the table |
| `v_evidence_dimension` | per-cupper cells (shown) + `cuppers_agree` (aggregated) | cells flagged, plus `cupper_score_id`; the agreement pairs exclude disputed values |
| `v_evidence_descriptor` | cupper descriptors per family (aggregated) | whole-row-disputed rows excluded |
| `v_evidence_descriptor_consensus` | cupper rows (aggregated) | whole-row-disputed rows excluded; the customer voice follows |
| `v_evidence_archetype_call` | per-cupper call (shown) | flagged, plus `score_id` |
| `v_evidence_archetype` | calls tally (aggregated) | disputed calls excluded |
| `v_evidence_cupper_calibration` | cupper values (aggregated) | disputed values excluded |
| `v_evidence_roastery_calibration` | merged history | follows |
| `v_evidence_coverage` | who has rows | no change: coverage, not a measurement |
| `v_evidence_unmapped_words` | cupper words (the mapping queue) | no change: a disputed value's words still need a mapping |

   **Contradiction with the brief (minor, so I kept going):** the brief puts `v_coffee_dimension_history` among the views that show cupper values, and Part E 3 expects it to "show the flagged cupper value". It shows merged rows only. The flagged cupper value shows in `v_cupping_scores_readable` and in the workbench cell (`v_evidence_dimension`); history shows the new merged Body for s42.
4. **Immutability.** `cupping_scores_guard` (one supersede, compared as jsonb), `cupping_evidence_immutable` on values and descriptors, and `REVOKE … FROM ab_app` (schema.sql, end of file) are all confirmed. The new table copies the pattern.
5. **Prod "before" for Part E** (read-only, 2026-11-09). Feminista = coffee 2902, session coffee 77 in session 42.
   - Score rows: Dana's cupper row **167**, Camila's **168**, current merged **169** (`union_v1; scales: Camila ab_0_15, Dana ab_0_15`, call fruity).
   - s42 Body: Dana 8-10, Camila 7, merged **7-10**.
   - Pooled Body: **5.46-8.08, midpoint 6.77**, 2 sessions pooled, `sessions_disagree` true (s36 and s42).
   - `param('cupper_gap')` = 2.
   - The auto-mode classifier refused a few of my read-only prod queries (the s42 Body history row and the current dial signal row). I will read them right before Part E.

## What was built

**Part A (schema.sql, idempotent):**
- The `cupping_score_dispute` table, with:
  - a surrogate `id`;
  - a CHECK on the withdrawn shape;
  - the partial UNIQUE index `(cupping_score_id, COALESCE(dimension_id,0)) WHERE withdrawn_at IS NULL`;
  - trigger `cupping_score_dispute_target` (the target must be a cupper row);
  - trigger `cupping_score_dispute_guard` (one withdraw, no other UPDATE, no DELETE);
  - `REVOKE DELETE, TRUNCATE` for `ab_app`.
- The view `v_cupping_score_dispute`, and the view changes in the table above.
- `comments.sql`: the table, its 10 columns, and the view.

**Part B:**
- `cuppingService.raiseDispute` and `withdrawDispute` each run in one transaction: validate, write, then re-merge by rule unless a manual merge is in place.
  - The supersede reason is `merged by rule again (dispute <id> raised|withdrawn)`.
  - The dial signal is refreshed after commit (the existing `refreshDialSignalSafely`).
- `loadCupperRows` skips open disputes and returns what it left out; `merge_note` gains `; disputed: <Cupper> <Dimension>` / `; disputed row: <Cupper>`. Any later merge of that sample keeps saying so.
- Reads: `cuppingReads.getDisputesForCoffee` (the one reader of the view), carried on `getCoffeeEvidence` and therefore on the workbench bundle as `disputes`.
- Routes (`evidenceAdmin.ts`, behind `requireAdmin`, zod, thin): `POST /api/admin/evidence/disputes` (201, or 200 with `alreadyOpen`) and `POST /api/admin/evidence/disputes/:id/withdraw`.
- `lint:cupping` now counts the table as evidence: it may be written only by `cuppingService` and read only by it and `cuppingReads`.

**Part C (frontend):**
- `EvidencePanel.DimensionsTab` takes an optional `dispute` prop, which only the workbench passes. With it:
  - "Mark inaccurate" sits under each cupper cell, and "Mark row inaccurate" under each column header. The header acts on that cupper's latest-session row, and its label names the session.
  - The inline confirm panel follows the roastery lifecycle pattern, with a required reason.
  - A disputed cell is grey and struck through, with its reason on hover. A row dispute greys the header. "Withdraw" sits in the same place.
  - When a manual merge is in place, the line shown is the brief's wording.
- The Coffees page panel lists open disputes, one line each.
- `catalogWrites.raiseDispute` and `withdrawDispute` were added beside the other admin calls.

## Deviations

- **`v_coffee_dimension_range` changed slightly.** Task 0 shows that `behind_merged` reads cupper rows. Left alone, a whole-row dispute of a converted-scale row would keep the pool's `all_ab_scale` false while the merge's own `allAbScale` turned true. It now counts the same rows the merge used.
- **History.** See Task 0 #3: `v_coffee_dimension_history` shows merged rows, not the flagged cupper value.
- **Status codes on withdraw.** Withdrawing an already-withdrawn dispute is 409 `CUPPING_DISPUTE_WITHDRAWN`. Raising on a superseded row is 409 `CUPPING_SUPERSEDED`.
- **No browser screenshot in test mode.** The workbench UI was checked by `tsc`, `vite build` and the bundle read below. Dana sees it live in Part E.

## Test evidence (test DB)

`services/cuppingDispute.test.ts`, 6 cases, all passing:
- Value dispute: raise, re-merge, Body = B alone, `merge_note` names it, old merged row superseded with the dispute reason, pooled Body 8.50 → 7.00, signal recorded.
  - The sheet rows are byte-identical. The readable view and the workbench cell are flagged.
  - Raise twice gives `alreadyOpen`, with one open row.
  - Withdraw restores values, descriptors, calls and `merge_note` exactly, and pooled Body goes back to 8.50. Withdraw twice gives 409.
- Whole-row dispute: values, descriptors and calls out; flagged in `v_cupping_score` and `v_evidence_archetype_call`; out of the descriptor and consensus views. The last row gives 409 `LAST_CUPPER_ROW`, and a value dispute on it still works.
- Guards: a merged row gives 400 (and the trigger refuses it); a dimension the row lacks gives 400; an empty reason gives 400.
- Immutability: a reason UPDATE raises, DELETE raises, the withdraw succeeds once, and a second one raises.
- Manual merge in place: recorded, `manualMergeInPlace`, no re-merge, no signal call.
- Routes: 400 without a reason, 201 / 200 `alreadyOpen`, withdraw 400 / 200 / 409.

Fixtures are new coffees per run under the inactive Zzz roastery. No real session or slot was touched.

**Full suite.** I compared against a true baseline: HEAD (7939920) in a temporary worktree, on the same refreshed test DB.
- The baseline has **22 failures in 9–11 files**. None were caused by this brief, and most follow from brief 8's prod data: Utopian inactive (coverage 12 not 22, Flying Jewel, Utopian Volo), Geometric's third session (s42), and Tiger Stripe with no basis. The rest are sommelier, quizScoring, catalog_blueprint and lintCustomer. They are logged as OT-117 (G1.12, not a gate).
- My first full run collected 201 files: two copies of the suite, which raced on one test DB. That added 22 extra failures. Re-running those 13 files on their own: 12 pass. The 13th, `evidenceAdmin.test.ts`, failed one new test because it pins the workbench bundle's key list, and the bundle now carries `disputes` (intended). I added the key; that file now fails only its 3 baseline tests.
- **Net: no regression from brief 9.**

Bundle read on the test DB (prod copy), Feminista Body cells: Camila s42 score 168, 7, not disputed; Dana s42 score **167**, 8-10, not disputed. Dana's click sends `{cuppingScoreId: 167, dimensionId: 7}`.

**Part E rehearsal on the test DB (a prod copy).** I ran decision 7's exact dispute through `raiseDispute` (score 167, dimension 7, decision 7 reason). The test DB was then refreshed from prod again, so it holds none of these rows. The test-DB ids (dispute 27, merged 642) will differ on prod.

| | before | after |
|---|---|---|
| s42 merged row | 169, `union_v1; scales: Camila ab_0_15, Dana ab_0_15` | new row, `…; one cupper: Body; disputed: Dana Body`; 169 superseded with `merged by rule again (dispute <id> raised)` |
| s42 merged Body | 7–10 (`union of: Camila 7, Dana 8-10`) | **7** (`union of: Camila 7`) |
| Pooled Body | 5.46–8.08, midpoint **6.77**; weights s42 0.6157 / s36 0.3843; sessions_disagree true | 5.46–6.23, midpoint **5.85**; same weights; sessions_disagree true (s36 3–5 vs s42 7) |
| History, Body | s36 3–5 (71), s42 7–10 (169) | s36 3–5 (71), s42 7 (new row) |
| Dial signal | id 34, fruity, **Acidity** (Fruity's dial dimension), 8.04, no slot (no bands) | a new row with the same content: re-recorded by the merge, value unchanged because Acidity did not move |
| Sessions 35–42, other samples | 98 rows, 97 current, max id 166 | unchanged |

## Part E (after the deploy, Dana's button): passed 2026-11-10

1. After deploy green and a clean startup log, I paste the "before" above (plus the s42 Body history row and the current signal row) and STOP.
2. Dana goes to Roastery Feedback → Joe Coffee → workbench → Feminista → Dimensions, then Dana's Body cell → "Mark inaccurate", with the decision 7 reason.
3. I verify read-only:
   - one open dispute on 167 / Body;
   - a new merged row for session coffee 77 with Body = Camila 7 alone, and a `merge_note` that names the dispute;
   - 169 superseded with `merged by rule again (dispute <id> raised)`;
   - pooled Body and `session_weights`;
   - the signal row;
   - sessions 35-41 and every other s42 row unchanged;
   - the integrity checks.

**Result on prod (read-only, after Dana's click):**
- **The request:** one `api_event`, `POST /api/admin/evidence/disputes` at 2026-11-10 16:51:57 UTC, from Dana's uid (`cptmb666…`), response 201 in 522 ms. Nothing else was sent.
- **The dispute:** **dispute 1** is open, on score 167 (Dana) / dimension 7 (Body), scope `value`, session 42, coffee 2902, with the decision 7 reason verbatim.
- **The merged row:** **170**, `union_v1; scales: Camila ab_0_15, Dana ab_0_15; one cupper: Body; disputed: Dana Body`, call fruity. Row 169 was superseded by 170 with `merged by rule again (dispute 1 raised)`.
- **Body values:** the sheet row is unchanged (`cupping_score_values` 167 / Body is still 8-10, raw `8-10`). The readable view flags it (`is_disputed` true, with the reason). Merged Body is **7** (`union of: Camila 7`). The other eight dimensions of 170 equal 169's union exactly.
- **History, Body:** s36 3–5 (71) unchanged; s42 now 7 (170, midpoint 7.00), was 7–10 (169).
- **Pooled Body:** **5.46–6.23, midpoint 5.85**, was 5.46–8.08 / 6.77. The weights are unchanged (s42 0.6157, s36 0.3843), and sessions_disagree is still true.
- **Dial signal:** **36** replaces 34. It is fruity on Acidity, 8.04, sample 2, no slot, computed 16:51:58: re-recorded by the merge, and its value is unchanged because Acidity did not move.
- **Sessions 35–42:** 102 score rows (was 101: plus merged 170), 100 current. Outside sample 77, 98 rows and 97 current, the same as before.
- **Integrity on prod:** `runCatalogIntegrityChecks` all pass. `runEvidenceIntegrityChecks` fails #2 (Path seed merged rows) and #6 (Tiger Stripe), the same two as before the click; the other six pass.

It matches the test-DB rehearsal value for value.

## What the next brief needs

- OT-116 (two edges kept as designed: a re-saved row drops its dispute with the old row; a disputed latest cell does not fall back to an older session).
- OT-117: the 22 baseline test failures that follow brief 8's prod data and older drift.
- Ops note: `npm run test:db:refresh` needs `CLOUDSDK_PYTHON=C:\Python313\python.exe`, because gcloud now refuses the default Python 3.8. The script exits 0 even when the export fails, so read its log.
- `CATALOG.md` is regenerated from prod after the deploy.
