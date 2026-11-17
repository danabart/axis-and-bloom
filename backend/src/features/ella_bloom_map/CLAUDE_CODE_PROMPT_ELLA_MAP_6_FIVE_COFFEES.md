# Claude Code brief. Ella's Bloom Map 6: the five coffees that are not in the catalog yet

Workstream: ella_bloom_map (`README.md` here; `CLOSING_REPORT_5.md` for the map as built and OT-136) · Written 2026-11-16 by the CTO session · Model: Sonnet · Dana runs it; push = deploy · **Test mode.** Admin only. No customer surface, no slot, no SKU, no price.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.5 one writer (the catalog is written only through `roasteryPortalService.acceptResponse`, which calls `catalogService`; map decisions only through the brief 5 seed script) · G2.6 one door for a write · G2.11 reference content is created and retired, never deleted · G2.12 evidence untouched · G2.20 nothing a roaster gave us is edited (accepting a response reads it and writes our catalog; the response stays as submitted) · G3.9 reuse, do not fork · G5.2 acceptance on the test DB first · G1.6 push is deploy, one closing report.
Mode: test. STOP points: after Task 0; before any production write.

**Goal.** Brief 5 published the map with 13 of the 18 coffees, because five exist only as roastery portal lineup coffees with a submitted response and no catalog coffee: **Half Moon** and **Great Heights** (Joe Coffee), **Brazil**, **Indonesia** and **D.R. Congo** (Joe Bean). This brief brings the five into the catalog through the existing acceptance door, reruns the brief 5 seed so they get their family, lean, ring and the seven waiting step pairs, and publishes the map with all 18.

**Decisions already made (Dana, 2026-11-16; do not re-open).**

1. All 18 coffees are on the map, including the three Joe Bean singles that have not been cupped.
2. The five come in through `roasteryPortalService.acceptResponse`. No `coffees` row is created any other way.
3. Slots, SKUs and prices are not part of this brief. The five will not be sellable yet, and that is expected. Prices come with the customer-page brief.
4. The customer Bloom page and every `dial_surface` row stay as they are.

CTO calls, reversible, flag if the code disagrees:

- **Basics** (origin, process, roast level, blend or single, caffeine): include every one the roaster filled in, as stated.
- **Notes:** include a roaster note when a remembered mapping to a flavor wheel term already exists for its words. For a note with no remembered mapping, propose one wheel term at the Task 0 STOP and wait for Dana's yes; do not choose one silently. A note Dana does not approve is left out of this acceptance and listed in `OPEN_TASKS.md`. A later acceptance can add it.
- **Actor:** the acceptance is recorded with Dana's admin uid if the script can resolve it from the admin profile, else with a NULL admin profile and the actor string `script:ellaMapFiveCoffees`.

---

## Task 0: Verify (append to a new `CLOSING_REPORT_6.md`; STOP after)

Read-only, test DB and production.

1. For each of the five: the `roastery_portal_coffee` row, its latest **submitted** response (id, version, date), the basics the roaster gave, and each note with its rank and words.
2. For each note: the remembered mapping if one exists (`roastery_portal_note_mapping`), with the wheel term's descriptor and category. For each note without one: your proposed wheel term, and one line on why.
3. What `acceptResponse` writes when it creates a coffee: which `coffees` columns, whether the new coffee is active, and anything else it sets (descriptors, the portal link). Confirm it writes no family, slot, SKU or price.
4. What a new active coffee with no family, slot or SKU does to the boot integrity checks and to any customer read, between the acceptance and the seed rerun. Both happen in the same run, so say only what would be visible if the run stopped halfway.
5. Run the brief 5 seed with `--dry-run` as if the five existed, or reason from its code: the rows it will add (expect 5 families, 5 leans, 5 rings, 14 step rows for pairs 3, 4, 9, 10, 13, 17, 18).

**STOP.** Show Dana one table: coffee, note, wheel term, "remembered" or "proposed". She answers yes, or names the rows to change or drop.

## Task 0.5: Dana's manual steps
None.

---

## Part A: Schema
None.

## Part B: The script

`backend/src/scripts/ellaMapFiveCoffees_2026_11_16.ts`, beside the brief 5 seed:

- For each of the five, calls `acceptResponse` once with the latest submitted response, the basics per the CTO call, and the notes Dana approved (with `remember: true` for a newly approved mapping, so the next roaster using the same words is prefilled).
- Idempotent: a portal coffee already linked to a catalog coffee is skipped and reported, never accepted twice by this script.
- `--dry-run` prints what it would accept. `--expect-db` guards the database name, as the seed does.
- Then the existing brief 5 seed runs unchanged (`ellaMapDecided_2026_11_16.ts`). If it needs the five catalog names to match Data 1's short names, add the mapping the way it already handles Fabricator, Tiger Stripe and the others. Do not fork the seed.

## Part C: Frontend
None. The admin page already draws whatever the published version holds.

## Part D: Tests

Vitest for the script on the test DB: five coffees created and linked, a second run creates nothing, the response rows are byte-for-byte unchanged before and after (G2.20). All lints and `tsc --noEmit` clean.

## Part E: Data

1. **Test DB:** run the script, run the seed, publish as "L2 assumption map, 18 coffees". Run Acceptance.
2. **STOP.** Show Dana the production dry-run of both scripts. After her yes: commit and push if anything is uncommitted, check the startup log, run the script on production, run the seed on production, publish with the same label.

## Acceptance (test DB, signed in as admin)

- `/admin/map` shows **18 coffees** in the cells of brief 5's Data 1 and **18 lines** in three styles. The bolder ladder runs Benchmark, The Daily, Amsterdam, Great Heights, Big City without a gap.
- Brazil, Indonesia and D.R. Congo are placed although they have no cupping.
- Table 2 shows 36 step rows. Steps 17 and 18 have no customer line; say what the page shows in its place.
- List any dashed dot (a coffee with no roaster Sweetness rating). Task 0 of brief 5 found a rating for all five, so expect none.
- The five roaster responses are unchanged. Each has one new row in `roastery_portal_acceptance` with `created_coffee` true.
- The customer Bloom page renders exactly as before; every `dial_surface` row still says `lane`; no slot, SKU or price row was written.

## Docs and closing (G6)

`README.md` here (brief 6, and that the customer-page brief is next); `WHAT_WE_BUILT.md`; `OPEN_TASKS.md` (close OT-136; add any note left out; note that the five are not sellable until the price brief); `REGRESSION.md` (a catalog coffee from a portal lineup is created only by `acceptResponse`); `CLOSING_REPORT_6.md` with the note table as approved, the dry-runs and the evidence. `CATALOG.md` only if a comment changed.

## Do not

- Do not create a `coffees` row by any path other than `acceptResponse`.
- Do not edit, re-save or re-submit a roaster's response or lineup row, other than the catalog link that acceptance itself sets.
- Do not write a family, slot, SKU or price in the acceptance script. Family, lean and ring come from the seed.
- Do not choose a flavor wheel term for an unmapped note without Dana's yes.
- Do not touch any customer page or `dial_surface` row.
- Do not write production before the STOP in Part E.
