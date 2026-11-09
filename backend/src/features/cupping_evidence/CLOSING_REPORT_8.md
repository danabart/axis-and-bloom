# Closing report: cupping evidence brief 8 (the Fruity cupping, 2026-11-06), test DB

Brief: `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_8_FRUITY_CUPPING.md`. Loader: `load/loadCuppingEvidence8.ts` (`npm run load:cupping-evidence-8 -- --target test`). It copies loader 7's shape and run code rather than extracting it, so loaders 5 and 7 are untouched.

**Status: DONE.** Loaded on test, then on prod as session 42 (Dana's go, 2026-11-08). Utopian was deactivated by Dana on the live site (2026-11-09 02:33 UTC) and verified (C3). The portal link was **not** revoked: Dana's rule G2.20 (2026-11-08), "we never touch data we received", with the brief updated to match.

## Task 0 (test DB, read-only, 2026-11-08)

- **Roasters.** All three are active, with names matching loader 2's map: Utopian `bbf250d1-…`, Joe Bean Roasters `19098f5c-…`, Joe Coffee Company `f42ad179-…`.
- **Coffees.** Each `(roaster, name)` pair resolves to exactly one row:
  - Flying Jewel 2891
  - Pearl 2933
  - Geometric Filter Coffee 2915
  - The Village 2904
  - Cafè Feminista: Montze Olvera 2902
- **SCA nodes.** All 16 named nodes exist and are active, at the tiers the brief gives.
- **Existing cupper mappings, kept and not rewritten:** `fruit`, `fruits` and `choc` (decision 9 lists these three among the new conventions, but cupper rows already exist), plus `lemon`, `citrus`, `strawberry`, `berries`, `fruity`, `honey`, `sugar`, `chocolate`, `cocoa`, `spice` and `smoky`.
  - `clementine`, `papaya` and `toffee` had roaster rows only, so they get a cupper row each (as ruled in brief 5).
- **Prod Task 0** (`tmp/b8_probe_prod.txt`): identical to test, apart from the database name, test's fixture sessions and test's leftover superseded roaster-mapping rows.

## Decisions 7 and 8, as ruled by Dana 2026-11-08

- **Decision 7.** Dana's five rows carry `archetype_call = 'fruity'`, with "call line blank; fruity ruled by Dana 2026-11-08" in the call note. Flying Jewel's call note also quotes "They are all fruity".
  - Camila's five rows have `archetype_call` null. "THE CITRUS" (Pearl) and "↳ balanced" (Feminista) are kept as call notes.
  - All five merged calls are `fruity`. `position_call`, `archetype_call_secondary` and `slot_call_id` are null everywhere.
- **Decision 8.** The loader has `PEARL_CAMILA_SWEETNESS = 4` and refuses to run while the value is unset.
  - The row is 4–4, raw `4; oval over three light strokes read as live; mark at 8-9 scribbled out`.
  - With that row, Pearl has no one-cupper dimension.

## Ids (test DB; prod gets its own)

**Session 339:**
- 2026-11-06, exact date.
- `ab_0_15_8dim`, not blind, roaster not present, location null.
- Provenance and session notes as in decision 1; brew defaults as in decision 2.
- The id is 339 on test because test fixtures used the ids in between. On prod it should be 42.

| order | sc | coffee | sample_note | Dana | Camila | merged | merge_note |
|---|---|---|---|---|---|---|---|
| 1 | 458 | Flying Jewel (2891) | Dana page 1 sample 1; Camila page 5 sample 1 | 697 | 698 | 699 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Fragrance, Flavor, Acidity, Body, Finish Length |
| 2 | 459 | Pearl (2933) | Dana page 1 sample 2; Camila page 5 sample 2 | 700 | 701 | 702 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Fragrance, Flavor, Acidity, Body, Finish Length |
| 3 | 460 | Geometric Filter Coffee (2915) | Dana page 2 sample 1; Camila page 6 sample 1 | 703 | 704 | 705 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Finish Length |
| 4 | 461 | The Village (2904) | Dana page 2 sample 2; Camila page 6 sample 2 | 706 | 707 | 708 | union_v1; scales: Camila ab_0_15, Dana ab_0_15 |
| 5 | 462 | Cafè Feminista: Montze Olvera (2902) | Dana page 3 sample 1; Camila page 4 sample 1 | 709 | 710 | 711 | union_v1; scales: Camila ab_0_15, Dana ab_0_15 |

- **Disagreements:** exactly as in B5. Flying Jewel's Bitterness (gap 2) is not on the list, and neither are The Village's or Feminista's gaps of 2.
- **One-cupper dimensions:** none.
- **Brew rows:** 5, each 8.5 g / 150 g / ratio 17.65, cupping bowl, grind null.
- **Values:** checked cell by cell against B1, 92 value rows in all:
  - 80 numeric, each with its `raw_value` exactly as in B1.
  - 12 words-only rows on dimensions 11 and 12, where B2 has words.
  - Dana's Feminista Acidity carries the note `strawberry acid (acidity character; Dana 2026-11-06)`, with no descriptor row.
- **Words and descriptors:**
  - B2 words are verbatim in `notes`, including `~silky`, `sweet ~and ~bright` and `~(scribbled out, unreadable)`.
  - There are 31 descriptor rows, exactly B3. No struck word made a row.
  - `overall_notes` are as in B4: Camila on The Village, Dana on Feminista.

## Mapping rows written (`source_kind = 'cupper'`, `note = 'loader 2026-11-08; rule: …'`)

| words | node | tier | rule |
|---|---|---|---|
| `orange` | Orange | 3 | exact |
| `clementine` | Citrus Fruit | 2 | contains |
| `bergamote` | Citrus Fruit | 2 | contains |
| `grape` | Grape | 3 | exact |
| `coconut` | Coconut | 3 | exact |
| `papaya` | Other Fruit | 2 | contains |
| `strawberry juice` | Strawberry | 3 | contains |
| `gentle fruit` | Fruity | 1 | contains |
| `light fruit` | Fruity | 1 | contains |
| `sweet fruit` | Fruity | 1 | contains |
| `creamy fruit` | Fruity | 1 | contains |
| `fruit sweetness` | Fruity | 1 | contains |
| `toffee` | Brown Sugar | 2 | node |
| `a bit chocolate` | Chocolate | 3 | contains |

- **Counts:** cupper mappings went from 55 to 69. Roaster rows are unchanged (67 current).
- **No other mapping row** was written.
- **Left unmapped (text only):** `sweet`, `acid`, `bright`, `silky`, `milk`, `cream`, `creamy`, `full`, `a bit heavy`, `balanced`, `like`, the `8` after bergamote, the clipped `li…` and the clipped trailing word on Camila's Feminista flavor line, and the scribbled-out word on Camila's Village aroma.

## Dial signal (cupping), before → after

| coffee | archetype | before | after |
|---|---|---|---|
| Flying Jewel (2891) | fruity | id 18, slot 7, 3.5, n 1 | **id 30, slot null, 7.23, n 2** |
| Pearl (2933) | fruity | id 20, slot 7, 1.5, n 1 | **id 31, slot null, 7.71, n 2** |
| Geometric (2915) | balanced_sweet | id 24, slot 3, 3, n 2 | **id 32, slot null, 4.66, n 3** |
| The Village (2904) | fruity | id 9, slot 7, 5, n 1 | **id 33, slot null, 4.38, n 2** |
| Feminista (2902) | fruity | id 8, slot 7, 6.5, n 1 | **id 34, slot null, 8.04, n 2** |

- **All five signals were recorded** by the merges themselves. The loader makes no extra refresh call, so there is one new row per coffee, and each one supersedes the previous row.
- **No slot is suggested on any of the five.** The notes read `no suggestion: slot(s) 1, 2, 3, 4 of Fruity have no band; pooled 2 sessions (ratio 0.667, half-life 365 d), latest s339`. For Geometric they read `… of Balanced …, pooled 3 sessions`.
  - **This is not caused by the load.** Since coffee presentation brief 3 (2026-10-24, decision 2), a signal is still recorded when the archetype's slots have no `spec_band_lo/hi`, but `suggested_slot_id` is null.
  - The five "before" rows date from before that change, which is why they show slot 7 (or 3 for Geometric).
  - The fruity and balanced slots have no bands yet. That is the "no bands" item already open from the coffee presentation work. Nothing in the catalog changed.
  - **Archetype:** Geometric's signal stays under its current catalog archetype (`balanced_sweet`). Dana's call of `fruity` is evidence only; the catalog assignment is hers to make.

## Pooled range after the load

**Flying Jewel (2891).** Pooled with session 35, weights s339 0.62 / s35 0.38; all ranges `ab_0_15`.

| dimension | range | midpoint | sessions | sessions disagree |
|---|---|---|---|---|
| Fragrance | 5.14–9.62 | 7.38 | 2 | no |
| Aroma | 7.62–8.24 | 7.93 | 2 | no |
| Flavor | 4–10 | 7.00 | 1 (s339) | – |
| Sweetness | 4.62–5.62 | 5.12 | 2 | no |
| Acidity | 5.11–9.35 | 7.23 | 2 | **yes** |
| Bitterness | 0–2.76 | 1.38 | 2 | no |
| Body | 3.62–8.11 | 5.86 | 2 | **yes** |
| Finish Length | 4.38–9.35 | 6.86 | 2 | **yes** |

- Before the load, every range came from session 35 alone (Acidity 2–5, Body 3–5, Finish Length 5). Flavor had no value before.

**The Village (2904).** Pooled with session 36 (Dana alone), weights s339 0.62 / s36 0.38; all ranges `ab_0_15`.

| dimension | range | midpoint | sessions | sessions disagree |
|---|---|---|---|---|
| Fragrance | 6–9 | 7.50 | 1 (s339) | – |
| Aroma | 5–9 | 7.00 | 1 (s339) | – |
| Flavor | 7–8 | 7.50 | 1 (s339) | – |
| Sweetness | 5–7 | 6.00 | 2 | no |
| Acidity | 3.38–5.38 | 4.38 | 2 | no |
| Bitterness | 0.38–2.77 | 1.58 | 2 | no |
| Body | 5–7.62 | 6.31 | 2 | no |
| Finish Length | 3–5 | 4.00 | 1 (s339) | – |

- Fragrance, Aroma, Flavor and Finish Length are new: session 36 had no value on them.

## Evidence newer than the decision

| coffee | before | after |
|---|---|---|
| Pearl, The Village, Feminista | false, n_sessions 1 | **true, 2** |
| Geometric | true, 2 | true, 3 |
| Flying Jewel | null, 1 | **null**, 2 |

- **Flying Jewel stays null, not true.** It has no basis on its assignment: it is the known evidence-integrity check #6 coffee. The coverage view has no decision date to compare against, so the flag is null.
- The brief expects true for all five. This one cannot turn true until Flying Jewel's assignment gets a basis. That will not happen here, because the loader writes no catalog row, and Flying Jewel goes inactive in Part C.

## Sessions 35 to 41 untouched

All 86 score rows of sessions 35 to 41 are identical before and after: ids, supersede state and `merge_note`. Source files: `tmp/b8_before_test.txt` and `tmp/b8_after_test.txt`.

## Runs (test)

**Run 1** (`tmp/b8_run1_test.log`) wrote:
- 14 mappings (3 already loaded);
- 1 session;
- 5 session coffees (+5 brew rows);
- 10 cupper rows (`ab_0_15`);
- 5 merges, which recorded the 5 signals.

**Run 2** (`tmp/b8_run2_test.log`): `already loaded` at every step; 0 lines say "created".
```
  cupper rows already: 10
  mappings already: 17
  merges already: 5
```

**Loader 5** (`tmp/b8_loader5_check.log`): `already loaded` end to end; 8 cupper rows, 12 mappings and 4 merges; 0 created.

**Loader 7** (`tmp/b8_loader7_check.log`): `already loaded` end to end; 10 cupper rows, 12 mappings and 5 merges; 0 created.

## Checks (test DB)

- `runCatalogIntegrityChecks().allPass = true` before and after.
- `evidenceIntegrity` shows the same two known failures before and after, unchanged:
  ```
  [evidence-integrity] check #2 — No current merged row without a current cupper row on the same sample: 3 (e.g. score 1 (sample 1, coffee 1); score 2 (sample 2, coffee 2); score 3 (sample 3, coffee 3))
  [evidence-integrity] check #6 — No coffee with a home placement and an assignment without a basis: 2 (e.g. Flying Jewel (2891); Tiger Stripe Espresso (2914))
  ```
- The six lints (`catalog`, `retention`, `customer`, `roastery-portal`, `cupping`, `lineage`) exit 0.
- `tsc --noEmit` exits 0, and `npm run build` exits 0.
- No test file changed. The load touches no test assertion, because the tests pin sessions 36 and 37 and coffees 2914 and 2915 by id.

## Workbench

All five coffees carry this session (Flying Jewel's "newer evidence" flag is null, as explained above). Open the roastery's workbench, then pick the coffee:

- Flying Jewel, Pearl: `/admin/roastery-portal?roastery=bbf250d1-e433-4233-a30b-437fe62bcc4a&view=workbench`
- Geometric Filter Coffee: `/admin/roastery-portal?roastery=19098f5c-99b9-4d7c-90ef-ee33d1e896b7&view=workbench`
- The Village, Feminista: `/admin/roastery-portal?roastery=f42ad179-9ef4-410a-a92e-464eae1d84ce&view=workbench`

## Prod (2026-11-08, after Dana's go)

**Before.** Same as test's before-state. Integrity: `allPass = true`; evidence checks #2 and #6 as on test (`tmp/b8_integrity_before_prod.txt`).

**Run 1** (`tmp/b8_run1_prod.log`) wrote:
- 14 mappings (3 already loaded);
- **session 42**;
- session coffees 73 to 77 (+5 brew rows);
- cupper rows and merged rows as in the table below;
- 5 merges, which recorded dial signals 30 to 34.

**Run 2** (`tmp/b8_run2_prod.log`): `already loaded` at every step; 0 lines say "created" (10 cupper rows, 17 mappings, 5 merges).

**Loaders 5 and 7 on prod** (`tmp/b8_loader5_check_prod.log`, `tmp/b8_loader7_check_prod.log`): `already loaded` end to end, 0 created. Both ran before Part C.

| order | sc | coffee | Dana | Camila | merged | merged call | disagreements (gap > 2) |
|---|---|---|---|---|---|---|---|
| 1 | 73 | Flying Jewel (2891) | 155 | 156 | 157 | fruity | Fragrance, Flavor, Acidity, Body, Finish Length |
| 2 | 74 | Pearl (2933) | 158 | 159 | 160 | fruity | Fragrance, Flavor, Acidity, Body, Finish Length |
| 3 | 75 | Geometric Filter Coffee (2915) | 161 | 162 | 163 | fruity | Finish Length |
| 4 | 76 | The Village (2904) | 164 | 165 | 166 | fruity | none |
| 5 | 77 | Cafè Feminista: Montze Olvera (2902) | 167 | 168 | 169 | fruity | none |

**Verified on prod** (read-only `tmp/b8_state.mjs prod 42`, compared with the test after-state, ids normalised): **identical**.
- That covers the session header, sample notes and brew rows; all ten cupper rows and five merged rows (values, `raw_value`, notes, descriptors, call notes, `overall_notes`, merge notes); the 14 mapping rows; the pooled ranges and `session_weights` for Flying Jewel and The Village; and the coverage flags.
- **Dial signals:** ids 30 (Flying Jewel), 31 (Pearl), 32 (Geometric), 33 (The Village) and 34 (Feminista).
  - The values match test.
  - All five have `suggested_slot_id` null, for the no-band reason above.
  - The notes say `latest s42`.
- **Coverage:** `evidence_newer_than_decision` is true for 2902, 2904, 2915 and 2933, and null for 2891 (no basis, as on test).
- **Sessions 35 to 41:** all score rows are identical before and after.
- **Mappings:** cupper mappings went from 55 to 69. Roaster rows are unchanged (67).
- **Integrity after:**
  - `runCatalogIntegrityChecks().allPass = true`.
  - `evidenceIntegrity` shows the same two known checks (#2, #6: Flying Jewel and Tiger Stripe), unchanged.

## Part C1: Utopian deactivation preview (prod, read-only, after the prod load)

**Utopian is confirmed by name:** `bbf250d1-e433-4233-a30b-437fe62bcc4a`, active, `deactivated_at` null.

**How the preview was taken:** `tmp/b8_c1_preview.mts prod`, output in `tmp/b8_c1_preview_prod.txt`. The script calls `catalogService.buildDeactivationPreview`, the function behind `GET /api/admin/roasters/:id/deactivation-preview`, and runs every count in a READ ONLY transaction.

**The preview, whole:**
```json
{
  "roaster": { "id": "bbf250d1-e433-4233-a30b-437fe62bcc4a", "name": "Utopian", "isActive": true },
  "coffees": [
    { "id": 2935, "name": "Colombia Andres Martinez", "isActive": true, "homeArchetype": null, "isDefault": false, "guestPositions": 0 },
    { "id": 2930, "name": "Decaf Mexico Veracruz", "isActive": true, "homeArchetype": null, "isDefault": false, "guestPositions": 0 },
    { "id": 2927, "name": "Espresso Volo", "isActive": true, "homeArchetype": null, "isDefault": false, "guestPositions": 0 },
    { "id": 2891, "name": "Flying Jewel", "isActive": true, "homeArchetype": "fruity", "isDefault": false, "guestPositions": 0 },
    { "id": 2932, "name": "Mexico Alva Flores", "isActive": true, "homeArchetype": null, "isDefault": false, "guestPositions": 0 },
    { "id": 2929, "name": "Obsidian", "isActive": true, "homeArchetype": null, "isDefault": false, "guestPositions": 0 },
    { "id": 2933, "name": "Pearl", "isActive": true, "homeArchetype": null, "isDefault": false, "guestPositions": 0 },
    { "id": 2928, "name": "Peru Chirinos Geisha", "isActive": true, "homeArchetype": null, "isDefault": false, "guestPositions": 0 },
    { "id": 2931, "name": "Peru Joel Silva Chirinos", "isActive": true, "homeArchetype": null, "isDefault": false, "guestPositions": 0 },
    { "id": 2934, "name": "Union", "isActive": true, "homeArchetype": "balanced_sweet", "isDefault": false, "guestPositions": 0 }
  ],
  "blends": { "total": 11, "active": 11 },
  "placements": { "total": 2, "active": 2, "homes": 2, "guests": 0 },
  "slotsGoingEmpty": [ { "archetype": "balanced_sweet", "dialSortOrder": 3, "platformName": "Bright & Balanced" } ],
  "archetypesLosingDefault": [],
  "hopsGoingDark": 0,
  "openOrderLines": 0,
  "activeSubscribersOnTheseSlots": 0,
  "alreadyManuallyInactive": { "coffees": 0, "blends": 0, "placements": 0 }
}
```

**What the cascade will touch:** 10 coffees, 11 SKUs (blends) and 2 home placements.
- **Union (2934)** sits on balanced_sweet slot 3, "Bright & Balanced". **This slot goes empty.**
- **Flying Jewel (2891)** sits on fruity slot 4, "Jammy & Aromatic". The preview does not list this slot as going empty.
  - **Correction (C3):** I first wrote here that another active coffee must hold the slot. That was wrong: Flying Jewel was its only occupant.
  - The preview counts only slots that are sellable today (`v_coffee_sellable_slot` at the 12 oz anchor). Slot 10 had an 80 oz price but no 12 oz price, so it was not on sale, and the preview was right not to count it.
- **Nothing else changes:** no default lost, no hops going dark, no open order lines, no active subscribers on these slots, and nothing was already manually inactive.

**Portal link (unrevoked):** one row, `57e8dc4a-0897-4d0e-a428-8f953502e050`.
- Created 2026-10-07 18:38 UTC and last opened 2026-10-15 14:49 UTC.
- `revoked_at` is null. Under G2.20 it stays that way.

**Utopian rows that must not change.** C3 re-counts them after the buttons.

| what | count |
|---|---|
| cupping sessions with a Utopian coffee | 35 (3), 38 (4), 39 (3), 40 (1), 41 (2), 42 (2): 15 session coffees |
| `cupping_scores` on those session coffees | 46 |
| `roastery_remark` | 52 |
| portal lineup coffees (`roastery_portal_coffee`) | 10 |
| portal responses | 9 |
| portal lineup responses | 1 |
| portal respondents | 1 |
| order lines on Utopian SKUs | 0 |
| coffees with a `qr_token` / `qr_scan_event` rows | 0 / 0 |
| dial signal rows on Utopian coffees | 6 |

## Part C2 (Dana)

**Deactivate.** Dana pressed `Deactivate…` on `/admin/roasters` on the live site.
- `api_event`: `POST /api/admin/roasters/bbf250d1-…/deactivate` at 2026-11-09 02:33:27 UTC, status 200.
- No note was entered (request body `{}`).

**No revoke.** The portal link is not revoked. Dana ruled this on 2026-11-08: new rule G2.20, "we never touch data we received", added to `DEVELOPMENT_GUARDRAILS.md`. The brief's decision 11 and its C1 to C3 now say the same.

**Two earlier attempts reached no backend.** Each time, C3 found the roaster active and `api_event` held no deactivate request, so I stopped before committing. The third attempt landed.

## Part C3: verify (prod, read-only)

Source files: `tmp/b8_c3_after_prod.txt`, `tmp/b8_c3_integrity_prod.txt`, `tmp/b8_c3_loader{5,7,8}_refuse.log`, `tmp/b8_c3_archetypes.json`.

**The roaster.** Utopian has `is_active = false` and `deactivated_at` 2026-11-09 02:33:27.638 UTC. `deactivation_note` is null, because none was typed.

**The cascade equals the preview:**

| what | preview | after | stamp |
|---|---|---|---|
| coffees | 10 active | 10 inactive | all `deactivation_reason = 'roaster'` |
| SKUs (`coffee_sku`) | 11 active | 11 inactive | all `'roaster'` |
| placements (`coffee_slot_assignment`) | 2 active homes | 1741 (Flying Jewel, slot 10) and 1754 (Union, slot 5) inactive | both `'roaster'` |

**The portal link is still unrevoked:** `57e8dc4a-…`, `revoked_at` null (G2.20).

**The C1 counts are unchanged**, each identical to the C1 preview:

| what | count |
|---|---|
| session coffees (sessions 35, 38–42) | 15 |
| cupping scores | 46 |
| remarks | 52 |
| portal lineup coffees | 10 |
| portal responses | 9 |
| portal lineup responses | 1 |
| portal respondents | 1 |
| order lines | 0 |
| QR tokens / scans | 0 / 0 |
| dial signal rows | 6 |

**Integrity, before → after:**
- `runCatalogIntegrityChecks().allPass` was true and is still true.
- `evidenceIntegrity` check #2 is unchanged (3).
- **Check #6 went from 2 to 1.** Flying Jewel dropped off it: it no longer has an active home placement, so "home placement without a basis" no longer applies. Tiger Stripe Espresso (2914) remains. Nothing was changed to get this result.

**The public dial** (`GET /api/coffees/archetypes` on the prod backend):
- fruity: 1 Clean Fruit active (2902) · 2 Bright & Tart empty · 3 Vivid Fruit empty · 4 Jammy & Aromatic empty
- balanced_sweet: 1 Soft & Smooth empty · 2 Classic Balanced active (2905) · 3 Bright & Balanced empty · 4 Lively & Vivid empty
- Empty slots come back as `isActive: false`, `coffeeId: null` and no prices. That is the existing empty-slot shape the dial renders.
- I checked this at the API only. The customer pages sit behind the pre-launch curtain, and no rendered page was screenshotted.

**Owned-bag rule:** `GET /api/coffees/2891/story` (Flying Jewel, by id) still returns 200 with its story.

**Loaders 5, 7 and 8 now refuse.** Each exits 1 with `roaster utopian bbf250d1-… missing, renamed or inactive` and writes nothing. That is expected, and the precondition was not relaxed.

**Placement pass:** `OPEN_TASKS.md` OT-115 covers balanced_sweet slot 3 and fruity slot 4 (which had no 12 oz price). No archetype lost its default.

**`REGRESSION.md`:** unchanged. Part C showed no gap, because the cascade, the counts and the owned-bag rule behaved as #170 specified.
