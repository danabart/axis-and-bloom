# Ella's Bloom Map 9 (Brazil to Balanced): closing report

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_9_BRAZIL_TO_BALANCED.md` · Run 2026-11-20 · Script `backend/src/scripts/ellaMapBrazilBalanced_2026_11_20.ts`.
Status: **done on test and on production (2026-11-20).** Test: apply, publish, second run wrote nothing; stopped with the production dry run. Production on Dana's go ("Keep confidence at medium"): apply, publish, second run wrote nothing.

**File name (deviation).** The brief asks for `CLOSING_REPORT_9.md`. That file already holds the Task 0 report of the other brief 9 (`CLAUDE_CODE_PROMPT_ELLA_MAP_9_PERSONAL_REASONS.md`, uncommitted, stopped for Dana), so this report is `CLOSING_REPORT_9_BRAZIL_TO_BALANCED.md` and the other file is untouched.

Precondition: cupping evidence brief 10 is done on both databases (test session 1977, prod session 43).

## Task 0 (read-only, both databases)

| item | prod `axisandbloom` | test `axisandbloom_test` |
|---|---|---|
| Brazil `('Joe Bean Roasters', 'Brazil')` | 2939, one active row | 4301 |
| brief-10 session | 43 | 1977 |
| family | chocolate_nutty, low, manual, no session, no basis; notes "Assumption map, CTO session 2026-11-15/16" | same |
| lean / ring | middle / 1 | same |
| active placement | L2 (v3): chocolate_nutty, middle, ring 1, grade D, flags `no_cupping_rows, no_size_value, ring_decided`, not sellable at cut | L2 (v55): same |
| active version | **v3 "L2 assumption map, 18 coffees"**, 18 placements | v55 with the same label, 18 placements |
| waiting unpublished | **0** family / lean / ring / step | 20 family rows, all on vitest fixture coffees (`PT Dim …`); none is placeable (the preview has 18 placeable coffees, none `PT`), so a cut carries none of them. Not map decisions, so no STOP |
| steps naming Brazil | 4, as expected: #27 Fabricator → Brazil "Simpler", #28 Brazil → Fabricator "More going on", #29 Brazil → Blossom "Bolder", #30 Blossom → Brazil "Lighter"; all shown | same rows (ids 79 to 82) |
| first match naming Brazil | none | none |
| start rule naming Brazil | none | none |
| Balanced today | Benchmark (side_a, ring 0, grade B), Half Moon (side_a, ring 0, grade D); first match side_a and middle = Benchmark, side_b = La Familia; start rules p1 La Familia, p9 Benchmark | same |

**Codes for decision 1.** `assignment_source_enum` = cupping, manual, import, so source is **`cupping`** with `assigned_from_session_id` = the brief-10 session. For confidence, the service takes low, medium or high. The precedent for a family decided from our own cupping is the coffee presentation loaders (`setMatch2916.ts` / `setMatch2917.ts`): `high` when at least two cupper rows of the session all call the family, else `medium`. In session 43 Dana called balanced_sweet and Camila made no call, so the script reads **`medium`**. The basis is stored as those loaders and the workbench store it: `notes` = the brief's note; `basis` = `composeBasis` over the current evidence (`evidenceReads.getBasisRows`), finalized with the note as its rule. With a basis JSON, `assignment_basis_present` is true. `ruleRequired` is true (Camila made no call), and the note is the rule.

**Lean.** On the Balanced wedge, `dial_wedge` side_a = chocolate_nutty, so "toward chocolate_nutty" = **`side_a`**, the lane of Benchmark and Half Moon (`laneFor`, imported from the brief 5 seed).

**Nothing refuses.** `v_dial_step` ties a step to its two coffees being on the active map, not to their families. `setRingInTx` allows ring 0 only in the center family, so the order is family, then lean, then ring, in one transaction. `setLeanInTx` refuses only a closed side, and side_a on Balanced is open.

**`catalog_change`.** The brief 5 seed logs each change with `logCatalogChange` (the `*InTx` functions do not log on their own). The script does the same: three rows.

## The script

Brief 5 seed shape and safety: `--dry-run` by default, `--apply`, `--expect-db` checked from `DATABASE_URL` before connecting and from `current_database()` after, and one transaction.
- **`--apply`:** in one transaction it runs `setMatchArchetypeInTx`, `setLeanInTx` and `setRingInTx` (each with `logCatalogChange`), then `dialPlacementService.publishInTx` (the publish door: cut and activate). After commit it refreshes the dial signal (`refreshDialSignalsAfterImport`), as `setMatchArchetype` does.
- **Publish condition:** it publishes only when the active version does not already place Brazil as balanced_sweet / side_a / ring 0. That makes a second run a no-op.
- **Label:** `L<n+1> Brazil to Balanced (cupping 2026-11-20)` from the active label's `L<n>`, which gives **L3** on both databases.
- **`--dry-run`:** prints the plan from a READ ONLY transaction. Then it rehearses the real service calls and the cut in a transaction that is always rolled back, to print the placement Brazil would get. Nothing persists (checked: prod still has 3 versions afterwards).

The only data the script carries is decisions 1 to 3, plus the label from decision 5. Decision 4 (first match, start rule, steps, prices, SKUs, slots, names, portal) is not touched. `tsc --noEmit` is clean.

## Test DB (`axisandbloom_test`)

Dry run (`backend/tmp/em9b_dry_test.txt`): 4 write. The rehearsal cut has 18 placements, with Brazil in Balanced.

Apply 1 (`backend/tmp/em9b_apply1_test.txt`): **3 decision rows; published v124 "L3 Brazil to Balanced (cupping 2026-11-20)", 18 placements, retired v55**; dial signal refreshed.
Apply 2 (`backend/tmp/em9b_apply2_test.txt`): **0 decision rows, publish none** (all four "same").

Read-back (`backend/tmp/em9b_after_test.txt`):
- Family: balanced_sweet, medium, cupping, session 1977, the brief's note, basis JSON present.
- Lean side_a; ring 0. Both carry decided_by `script:ellaMapBrazilBalanced_2026_11_20` and a note naming the session and the decision number.
- `catalog_change`: 3 rows by the script: `setMatchArchetype` (chocolate_nutty → balanced_sweet), `setLean`, `setRing`.
- Active version v124 L3, 18 placements. Balanced = Benchmark (side_a, 0, size 2, B), **Brazil (side_a, 0, size 3, B)**, Half Moon (side_a, 0, size 2, D).
- `dialReads.unpublished()` (the count `/admin/map` shows) = **0, total 0**, so the page reads "Nothing to publish".
- First match: 13 rows, Balanced still Benchmark / Benchmark / La Familia. Start rules: 9 rows, Balanced still La Familia p1 / Benchmark p9. Unchanged.
- Dial signal: a new current row, 43, balanced_sweet, dimension 5 Acidity, raw 0.5, `suggested_slot_id` null (Balanced slots have no band).
- Integrity: `runCatalogIntegrityChecks()` allPass true and the evidence checks are the same before and after (#2 = 3 test fixtures; #6 = 3: La Familia 2903, The Village 2904, Tiger Stripe 2914; Brazil has no home slot, so it is not in #6).

**The four steps, as `/map` reads them** (`dialReads.stepsFrom`, which `matchService.steps` uses):

| direction | from (family) | to (family) | button | line |
|---|---|---|---|---|
| from Brazil | Brazil (Balanced) | Blossom Dark Roast (C&N) | Bolder | A darker roast with a fuller body. |
| from Brazil | Brazil (Balanced) | Fabricator House Roast (C&N) | More going on | Adds citrus and spice. |
| to Brazil | Fabricator House Roast (C&N) | Brazil (Balanced) | Simpler | The base on its own: chocolate, almond, honey. |
| to Brazil | Blossom Dark Roast (C&N) | Brazil (Balanced) | Lighter | Lighter, plain chocolate. |

All four are still published and shown (`on_active_map` true).

## Production dry run (`axisandbloom`, read only)

`backend/tmp/em9b_dry_prod.txt`. Integrity before: catalog allPass true; evidence #2 = 3, #6 = 3 (2903, 2904, 2914).

| decision | now | next | action |
|---|---|---|---|
| family | chocolate_nutty (low, manual) | balanced_sweet (medium, cupping, s43) | write |
| lean | middle | side_a | write |
| ring | 1 | 0 | write |
| publish | L2 assumption map, 18 coffees (v3): Brazil chocolate_nutty, middle, ring 1 | L3 Brazil to Balanced (cupping 2026-11-20) | write |

Stored notes: *Dana 2026-11-20 after the cupping of 2026-11-20 (session 43): very round and very sweet; her call Balance; Sweetness 12/15 from both cuppers; roaster proposed balanced_sweet (portal v1, 2026-10-14). Was chocolate_nutty, middle, ring 1 (assumption map 2026-11-16).*
Basis (composeBasis): `basis: cupping s43 (Dana=balanced_sweet, Camila=no call; not blind); roaster form v1 (Kathy Turiano)=balanced_sweet; roaster remarks=none; website=none`, with the note as rule.

Rehearsal (rolled back): 3 decision rows; publish "L3 Brazil to Balanced (cupping 2026-11-20)" with 18 placements, retiring v3. Balanced on that cut:

| coffee | lane | ring | size | sweetness | acidity | bitterness | body | grade | flags |
|---|---|---|---|---|---|---|---|---|---|
| Benchmark | side_a | 0 | 2 | 6.57 | 1.28 | 2.09 | 4.50 | B | ring_decided |
| **Brazil** | side_a | 0 | 3 | 12.00 | 0.50 | 0.50 | 4.50 | B | ring_decided |
| Half Moon (Half Caff) | side_a | 0 | 2 | | | | | D | no_cupping_rows, no_size_value, ring_decided |

The four steps are unchanged and still on the active map after the rehearsal cut.

## Things that looked off with Brazil in Balanced (listed, left alone)

1. **All four of Brazil's steps now cross families.** Both neighbours (Fabricator, Blossom) are Chocolate & Nutty, and Brazil has no step to Benchmark or Half Moon. From Brazil, `/map` offers only moves out of Balanced. The words still read right ("Simpler" and "Lighter, plain chocolate" into Brazil; "Bolder" and "More going on" out of it). Since brief 8 the step card shows the destination's family label, so the Fabricator and Blossom cards now land on a Balanced coffee.
2. **Brazil is a bigger dot than Benchmark and Half Moon** (size 3 vs 2), from its Sweetness 12. It is the same size it had in C&N.
3. **Grade B on one session.** Brazil has 1 session and 2 cuppers, Benchmark 2 and 2, and both read B.
4. Brazil has no stored three-voice story (empty), so no customer text names its old family.

## Production (`axisandbloom`, 2026-11-20, on Dana's go)

Apply 1 (`backend/tmp/em9b_apply1_prod.txt`): **3 decision rows; published v5 "L3 Brazil to Balanced (cupping 2026-11-20)", 18 placements, retired v3 (L2)**; dial signal refreshed. The version id is 5, not 4: the dry run's rehearsal took sequence value 4 before it rolled back, which is harmless.
Apply 2 (`backend/tmp/em9b_apply2_prod.txt`): **0 decision rows, publish none.**

Read-back (`backend/tmp/em9b_after_prod.txt`):
- Family: balanced_sweet, medium, cupping, session 43, the brief's note, basis present. Lean side_a; ring 0.
- `catalog_change`: setMatchArchetype (chocolate_nutty → balanced_sweet), setLean, setRing, all by `script:ellaMapBrazilBalanced_2026_11_20`.
- Active version: v5 L3, reason "Dana 2026-11-20: Brazil to Balanced after the cupping of 2026-11-20 (session 43); brief 9", 18 placements. Balanced = Benchmark (side_a, 0, size 2, B), **Brazil (side_a, 0, size 3, B)**, Half Moon (side_a, 0, size 2, D).
- `dialReads.unpublished()` total 0, so `/admin/map` shows "Nothing to publish".
- First match: 13 rows, Balanced still Benchmark / Benchmark / La Familia. Start rules: 9 rows. Unchanged.
- Dial signal: 43, balanced_sweet, Acidity 0.5, no band.
- Steps (`v_dial_step` on prod): #27 Fabricator → Brazil "Simpler", #28 Brazil → Fabricator "More going on", #29 Brazil → Blossom "Bolder", #30 Blossom → Brazil "Lighter". All are shown, in the active version, and on the active map.
- Integrity after = before (catalog allPass true; evidence #2 = 3, #6 = 3).

**Read-back note.** The first read-back through `dialReads.stepsFrom` failed with `column "move_code" does not exist`. The cause is uncommitted edits in the working tree: `dialReads.ts`, `schema.sql` and `comments.sql`, written at 15:13–15:15 local by another session working in the repo during this run (G1.9). Deployed code and the production schema are fine. The apply path did not touch those files (catalogService, dialPlacementService and the evidence reads are unmodified). The steps were read back from `v_dial_step` on prod instead. The other session's files were left untouched and are not in this commit.

Commit: the script, this brief's status line, the README line, `WHAT_WE_BUILT.md` #280 and this report, staged by path.
