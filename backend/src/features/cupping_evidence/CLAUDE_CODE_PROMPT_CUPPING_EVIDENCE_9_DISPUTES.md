# Cupping Evidence, brief 9: disputes. Mark a cupper value, or a whole cupper row, as not to be trusted, without touching the sheet as written. First use: Dana / Feminista / Body, session 42.

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-11-09 (CTO session; decisions by Dana) · Model: Sonnet is fine · Mode: test first; Part E live on Dana's go
> Contract: `DESIGN_CUPPING_EVIDENCE.md` v4 (observe / reconcile / decide), brief 1 (supersede transition, immutability triggers, `cuppingService`), brief 3 (the `v_evidence_*` views, one row per cupper), brief 4 (the workbench), brief 6 (pooled range over merged rows).
> Status: **not started**.

**Guardrails (`DEVELOPMENT_GUARDRAILS.md`).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (no new number; the only rule is "an open dispute is skipped") · G2.2 surrogate `id` PK; the natural key `(cupping_score_id, dimension_id)` open-at-a-time is a partial UNIQUE index · G2.3 prefix `cupping_` (the evidence domain's existing prefix) · G2.4 CATALOG.md checked, see Task 0 · G2.5 one writer: `cuppingService` (the module that already writes `cupping_scores`); reads via `v_cupping_score_dispute` and the existing evidence views · G2.12 evidence insert-only: the sheet row and its values are never changed; the dispute is its own observation with one withdraw transition, like supersede · G2.17 `comments.sql` → `catalog:md` · G3.1 routes call the service · G3.3 idempotent (a second raise on the same open target returns the existing dispute) · G5.1 Part D tests · G1.6 push is deploy, one closing report.
Mode: test, then live. STOP points: (1) after test acceptance and the closing report, for Dana's go to deploy; (2) Part E is Dana's own button on the live site, then verify.

## Why

Cupping scores are relative to the table. On 2026-11-06 five light, bright coffees were cupped together and Feminista's body came out 8–10 (Dana, "full or a bit heavy") and 7 (Camila). Brewed in a French press on 2026-11-09 it was the thinnest coffee in the catalog. The sheet is right about what was marked; the number should not drive the pooled range, the dial signal, the descriptor consensus or anything a customer or Liam reads. Today there is no way to say so: `cupping_scores` can only be **superseded** by a replacement row (re-save, transcription correction, re-merge), which rewrites what the paper says, and `cupper_calibration_offset` corrects a systematic bias, it does not ignore a value. Decisions 1 to 3 below are Dana's (2026-11-09).

## Decisions (Dana, 2026-11-09). Do not re-open.

1. **A dispute is an observation beside the row, not a change to it.** New insert-only table `cupping_score_dispute`; the disputed `cupping_score_values` row stays as written. Withdrawing is a timestamp, never a delete.
2. **Granularity: one value or the whole row.** `dimension_id` set = that cupper's value on that dimension; `dimension_id` null = the whole cupper row (all its values, descriptors and calls). Only **cupper** rows can be disputed (`NOT is_merged`); the merged row is derived and is re-merged instead.
3. **Admin portal only**: raised and withdrawn from the Calibration workbench (Dimensions tab), by an admin, with a written reason. No cupper-facing surface.
4. **Effect = re-merge by rule.** Raising or withdrawing a dispute re-runs `mergeByRule` for that session coffee inside the same transaction; `mergeByRule` skips open disputes. The old merged row is superseded with reason `merged by rule again (dispute <id> raised|withdrawn)`; the pooled range (`v_coffee_dimension_range`, which reads merged rows), the dial signal (recorded by the merge) and everything downstream follow by themselves. If the current merged row is a **manual** merge (`saveManualMerge`), the dispute is still recorded but nothing is re-merged; the response says so and the workbench shows "manual merge in place; re-merge is yours".
5. **A whole-row dispute needs another undisputed cupper row** on the same session coffee; otherwise 409 (`LAST_CUPPER_ROW`: "dispute the values, or supersede the row"). A value-level dispute is always allowed; a dimension with no undisputed value simply leaves the merged row without that dimension (one-cupper or none).
6. **Views show, they do not hide.** Every view that reads cupper-row values (`v_evidence_*` per cupper, `v_cupping_scores_readable`, `v_coffee_dimension_history`) gains `is_disputed` (and `dispute_reason`) from the open dispute; the calibration and consensus views **exclude** disputed values and rows; the readable and history views keep them, flagged. No view filters by a literal reason.
7. **First use (Part E)**: session 42, Dana's cupper row on Cafè Feminista: Montze Olvera (coffee 2902), dimension 7 (Body), reason `Scored relative to a flight of five light coffees; French press 2026-11-09 (22 g, X54 at 26, 4-5 min) read as the thinnest coffee in the catalog. Dana 2026-11-09.` Raised by Dana in the workbench on the live site. Expected after: Feminista's merged Body for session 42 = Camila's 7 alone (one cupper on Body), pooled Body range moves accordingly, the signal row is re-recorded by the merge, sessions 35 to 41 untouched.

## Task 0 (read-only, findings in the closing report before Part A)

1. `CATALOG.md` check (G2.4): confirm nothing fits. Considered: `cupping_scores.superseded_at / superseded_by_id / supersede_reason` (replaces a row with a successor; whole row; rewrites the evidence), `cupper_calibration_offset` (a correction per cupper and dimension, applied to every value, not an exclusion of one), `evidence_parameter` (numbers, not facts), `roastery_remark` (the roaster's voice). State it in one line.
2. `mergeByRule` (`services/cuppingService.ts` ~L600–L700): confirm the two queries that read cupper heads and values (the ones at ~L607 and ~L616) are the only path into the merge, so the dispute filter lands in one place.
3. List every view that joins `cupping_score_values` or `cupping_scores` cupper rows (grep `schema.sql`; today: `v_coffee_dimension_range` via merged rows only, `v_coffee_dimension_history`, `v_coffee_dimension_range_calibrated`, `v_cupping_scores_readable`, the seven `v_evidence_*`, `v_evidence_descriptor_consensus`, `v_collaborative_flavor_wheel`). For each, say: merged-only (no change), cupper rows shown (flag), cupper rows aggregated (exclude).
4. Confirm the immutability triggers on `cupping_scores` / `cupping_score_values` (`schema.sql` ~L3305) and the `REVOKE UPDATE, DELETE` for `ab_app` (~L10403), so the new table can follow the same pattern.
5. On prod, read-only: session 42's cupper row ids for Feminista (Dana's and Camila's), the current merged row id, its `merge_note`, Feminista's current pooled Body range and dial signal row. These are the "before" for Part E.

## PART A: schema (`schema.sql`, idempotent, additive)

```sql
CREATE TABLE IF NOT EXISTS cupping_score_dispute (
  id                 SERIAL PRIMARY KEY,
  cupping_score_id   INTEGER NOT NULL REFERENCES cupping_scores(id),
  dimension_id       INTEGER REFERENCES coffee_dimensions(id),   -- NULL = the whole cupper row
  reason             TEXT NOT NULL,
  raised_by_uid      TEXT NOT NULL,                              -- admin uid from AuthRequest
  created_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  withdrawn_at       TIMESTAMPTZ,
  withdrawn_by_uid   TEXT,
  withdrawn_reason   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS cupping_score_dispute_open_uq
  ON cupping_score_dispute (cupping_score_id, COALESCE(dimension_id, 0)) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS cupping_score_dispute_score_idx ON cupping_score_dispute (cupping_score_id);
```

- Immutability: a trigger in the brief 1 pattern allows exactly one UPDATE per row, the one that sets `withdrawn_at` (with `withdrawn_by_uid`, `withdrawn_reason`) from NULL, and raises on any other UPDATE or on DELETE. `REVOKE DELETE, TRUNCATE` for `ab_app` as for the score tables.
- A CHECK or trigger that `cupping_score_id` points at a cupper row (`NOT is_merged`); the service checks too.
- `v_cupping_score_dispute`: the read path; one row per dispute with the cupper name, session, coffee, dimension name, `is_open`.
- Views per decision 6: add `is_disputed BOOLEAN` and `dispute_reason` where cupper values are shown; exclude open disputes where they are aggregated (`v_coffee_dimension_range_calibrated`'s cupper inputs, the calibration views, `v_evidence_descriptor_consensus`, `v_collaborative_flavor_wheel` if it reads cupper rows). `v_coffee_dimension_range` reads merged rows and needs no change; say so.
- `comments.sql` for the table, its columns and the view (`Writer: cuppingService.raiseDispute, cuppingService.withdrawDispute`), then `npm run catalog:md -- --expect-db axisandbloom`, `CATALOG.md` committed.

## PART B: service and routes

`services/cuppingService.ts` (the one writer of the evidence tables):

- `raiseDispute({ cuppingScoreId, dimensionId: number | null, reason, raisedByUid })` in one `withTransaction`: validate (cupper row, current, not superseded; dimension exists on that row when given; decision 5 for whole-row), insert, then `mergeByRule(sessionCoffeeId)` unless the current merged row is manual (decision 4). Idempotent: an open dispute on the same target returns it unchanged with `alreadyOpen: true`. Returns the dispute, the new merged score id (or `null` + `manualMergeInPlace: true`), and the merge's `union` summary.
- `withdrawDispute({ disputeId, withdrawnByUid, reason })`: the one transition, then the same re-merge rule.
- `mergeByRule`: the heads query excludes cupper rows with an open whole-row dispute; the values query excludes `(cupping_score_id, dimension_id)` pairs with an open value dispute; descriptors and calls of a whole-row-disputed cupper are excluded with the row. `merge_note` gains `; disputed: <Cupper> <Dimension>[, …]` or `; disputed row: <Cupper>` so the merged row says what it left out. The `n` passed by the loaders stays what it is (the number of cuppers on the sheet); a disputed dimension counts as one-cupper in the union, as today for an unmarked line.
- `refreshDialSignal`: no change; the merge records it.

`routes/evidenceAdmin.ts` (behind `requireAdmin`, zod, thin): `POST /api/admin/evidence/disputes` `{ cuppingScoreId, dimensionId?, reason }`, `POST /api/admin/evidence/disputes/:id/withdraw` `{ reason }`, and the workbench bundle (`GET /workbench/coffee/:coffeeId`) carries the coffee's disputes (open and withdrawn) and the `is_disputed` flags on the per-cupper dimension rows. Mutations are logged by `api_event` already; no extra logging.

## PART C: workbench (frontend, `AdminCalibrationWorkbench.tsx`, Dimensions tab)

- Each per-cupper cell gets a small "Mark inaccurate" action; each cupper column header gets "Mark row inaccurate". Both open the existing inline confirm pattern (as the roastery lifecycle dialog) with a required reason, then call the route and reload the bundle.
- A disputed cell is greyed with a strike and shows the reason on hover; a disputed row greys the column. "Withdraw" sits on the same cell/header for an open dispute and asks for a reason.
- When the response says `manualMergeInPlace`, show one line: "Recorded. The current merged row is a manual merge; re-merge it from the Archetype tab if you want the pool to follow."
- The Evidence panel on the Coffees page (brief 3) lists open disputes for the coffee in one line each. Nothing else changes; no new page.

## PART D: tests (vitest, test DB)

- Value dispute: raise → `mergeByRule` output lacks that cupper's value on that dimension, the other cupper's value stands, `merge_note` names it; the old merged row is superseded with the dispute reason; the pooled range view moves; the signal row is re-recorded.
- Whole-row dispute: the row's values, descriptors and calls are out; with one other cupper the merge is one-cupper everywhere; on the last undisputed row → 409 `LAST_CUPPER_ROW`.
- Withdraw: re-merge restores the previous union exactly (values, descriptors, calls).
- Idempotency: raise twice → one open row, `alreadyOpen: true`; withdraw twice → 409.
- Immutability: UPDATE of `reason` raises; DELETE raises; the withdraw transition succeeds once.
- Manual merge in place: dispute recorded, no re-merge, `manualMergeInPlace: true`.
- Merged row cannot be disputed (400).
- Fixtures: a disposable `Vitest` session on free slots, as the brief 3 tests do; nothing on sessions 35 to 42.

## PART E: first use (live, Dana's button)

1. After deploy green and a clean startup log, Claude Code pastes the Task 0.5 "before" (Feminista session 42 rows, merged Body, pooled Body, signal) and **STOPs**.
2. Dana, on the live site: Roastery Feedback → Joe Coffee → workbench → Feminista → Dimensions → Dana's Body cell → Mark inaccurate, with the reason in decision 7.
3. Claude Code verifies read-only: one open dispute row; a new merged row for session 42 / Feminista with Body from Camila alone (7) and `merge_note` naming the dispute; the old merged row superseded with the dispute reason; Feminista's pooled Body range and `session_weights` after; the dial signal row after; `v_coffee_dimension_history` shows the flagged cupper value; sessions 35 to 41 and every other session 42 row unchanged; `runCatalogIntegrityChecks` and `evidenceIntegrity` unchanged apart from what the re-merge explains.

## Docs and closing
`WHAT_WE_BUILT.md` entry (brief 9: why a dispute is not a supersede, the re-merge rule, the manual-merge exception), `WHAT_WE_BUILT_DB.md` "As of" line, `comments.sql` + `CATALOG.md`, `REGRESSION.md` ("an open dispute leaves the pooled range, the signal and the consensus; a withdrawn one returns; the sheet row never changes"), README line in this folder, `CLOSING_REPORT_9.md` with Task 0 findings, the view-by-view list, test evidence, Part E before/after. One commit straight to main, pushed.

## Do not
Do not update or delete any `cupping_scores` or `cupping_score_values` row. Do not add a filter on a literal reason or cupper name anywhere. Do not re-merge a manual merge. Do not build a cupper-facing surface. Do not touch `cupper_calibration_offset`: a dispute is not a calibration. Do not run Part E yourself; it is Dana's button.
