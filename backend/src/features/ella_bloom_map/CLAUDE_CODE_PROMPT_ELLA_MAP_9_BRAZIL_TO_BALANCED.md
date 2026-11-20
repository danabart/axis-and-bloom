# Ella's Bloom Map, brief 9: Brazil moves from Chocolate & Nutty to Balanced. One coffee, three decisions, one publish. Data only.

> Folder: `backend/src/features/ella_bloom_map/` · Written 2026-11-20 (CTO session; decision by Dana) · Model: Sonnet is fine · Mode: test first, then live on Dana's go
> Contract: brief 5 (`CLAUDE_CODE_PROMPT_ELLA_MAP_5_DECIDED_MAP_AND_ADMIN.md`: family, lean and ring are decisions; `publish` cuts and activates) and its seed `backend/src/scripts/ellaMapDecided_2026_11_16.ts`, which is the template for the script here. No schema, no view, no new table, no code beyond one script.
> Run after **cupping evidence brief 10** (`../cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_10_NOV20_CUPPING.md`) is done on the same database, so the basis below points at a session that exists. If brief 10 has not run on a database, STOP there.
> Status: **done on prod 2026-11-20** (v5 "L3 Brazil to Balanced (cupping 2026-11-20)"; `CLOSING_REPORT_9_BRAZIL_TO_BALANCED.md`).

**Guardrails (`DEVELOPMENT_GUARDRAILS.md`).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (the decision is rows, entered through the services) · G2.4 no new table or view · G2.5 / G2.6 one writer, one door: `catalogService.setMatchArchetypeInTx`, `setLeanInTx`, `setRingInTx` and the existing publish function, exactly as the brief 5 seed calls them; no SQL writes in the script · G2.12 the cupping evidence and the roaster's portal answer are not touched; the decision is its own layer · G2.13 each change logged to `catalog_change` by the services · G3.3 idempotent, a second run writes nothing and publishes nothing · G3.7 prod only with `--expect-db axisandbloom` and after the STOP · G1.5 / G1.6 one run, one closing report.
Mode: test, then live. One STOP: after the test run and the production dry-run, for Dana's go.

## Decision (Dana, 2026-11-20). Do not re-open.

After cupping Brazil on 2026-11-20 with Camila: "the reason we decided to put it as balanced is because its very round and very sweet", then "im ok with moving brazil to balance". Evidence behind it: Dana's call on the sheet is Balance; both cuppers scored Sweetness 12 of 15 with Acidity 0 to 1 and Bitterness 0 to 1; Joe Bean proposed `balanced_sweet` on the portal form (2026-10-14) with Sweetness as the dominant dimension.

1. **Family**: Joe Bean **Brazil** (prod coffee 2939; resolve by `('Joe Bean Roasters', 'Brazil')`, exactly one active row or STOP) goes from `chocolate_nutty` to `balanced_sweet`. Source and confidence: use the values the service accepts for a decision made from A&B's own cupping (Task 0 names them; the brief 5 seed used confidence low, source manual for assumptions, which this no longer is). Basis note, stored as the service stores it: `'Dana 2026-11-20 after the cupping of 2026-11-20 (session <id>): very round and very sweet; her call Balance; Sweetness 12/15 from both cuppers; roaster proposed balanced_sweet (portal v1, 2026-10-14). Was chocolate_nutty, middle, ring 1 (assumption map 2026-11-16).'`
2. **Lean**: toward `chocolate_nutty` (the lane Benchmark and Half Moon sit in; translate with `dial_wedge` as the seed's `laneFor` does). CTO default, same lane as the other two chocolate-based Balanced coffees.
3. **Ring**: 0 (the center family's ring, as Benchmark and Half Moon). CTO default.
4. **Not changed**: the first bag for Balanced stays **Benchmark** (Dana is considering Brazil as the default but has not decided; `dial_first_match` and `dial_start_rule` are not touched). The four step rows through Brazil stay as written (pair 9 Fabricator / Brazil, pair 10 Brazil / Blossom); no new step is added. No price, SKU, slot, name or portal row changes. No other coffee changes.
5. **Publish** through the existing publish function with the label `'L<n> Brazil to Balanced (cupping 2026-11-20)'`, where `<n>` continues the active version's numbering as Task 0 finds it.

## Task 0 (read-only, both databases; findings in the closing report)

- Brazil's current family (with source, confidence, basis), lean, ring, placement row and flags; that brief 10's session exists and its id.
- The source and confidence codes available for decision 1 and which fit "decided from our own cupping".
- The active map version and its label; whether anything is waiting unpublished (if there is, STOP and list it: this brief publishes only its own three changes).
- Every `dial_step`, `dial_first_match` and `dial_start_rule` row that names Brazil. Expected: four step rows, no first-match row, no start rule. If a rule or a step refuses the new family (a check that a step joins neighbouring lanes, for example), STOP and report instead of working around it.
- The placement preview for Brazil with the three decisions applied, beside Benchmark and Half Moon.

## Task

One script, `backend/src/scripts/ellaMapBrazilBalanced_2026_11_20.ts`, the seed's shape and safety (`--dry-run` default, `--apply`, `--expect-db`, one transaction, the same service functions, the dial signal refreshed after commit as `setMatchArchetype` does). It carries only decisions 1 to 3 as data. Then publish (decision 5).

Order: test DB dry-run, apply, publish, second run writes nothing. STOP with the production dry-run printed. After Dana's go: production apply, publish, second run writes nothing.

## DONE =
Brazil is `balanced_sweet`, leaning `chocolate_nutty`, ring 0, on the active map version, with the basis stored and three `catalog_change` rows; 18 coffees on the map as before; the four steps through Brazil still published and shown; first-match and start rules unchanged; `runCatalogIntegrityChecks()` before and after; `/admin/map` shows Brazil in Balanced and "Nothing to publish".

Closing report: Task 0 findings; the dry-run tables (test and prod); the three decisions as stored; the published version before and after; the four step rows as `/map` now reads them from Brazil and to Brazil; anything that looked off with Brazil sitting in Balanced (a step word that no longer fits, for example), listed and left alone. Commits straight to main: the script, this brief's status line, the README line, a `WHAT_WE_BUILT.md` entry, `CLOSING_REPORT_9.md`.
