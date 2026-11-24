# Closing report 11: Tiger Stripe as the first bag for Chocolate & Nutty leaning fruity

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_11_TIGER_STRIPE_START.md` · Read first: `DEVELOPMENT_GUARDRAILS.md` · Script: `backend/src/scripts/ellaMapTigerStart_2026_11_24.ts`

Status: **done on production 2026-11-24** (Dana's go the same day). Test DB first, then the production dry run, the STOP, and the production apply.

## Task 0 (2026-11-24, read only on both databases)

Queries ran in `BEGIN READ ONLY` (`backend/tmp/em11_t0.sql`, `em11_t0b.sql`; output `em11_t0_test.txt`, `em11_t0_prod.txt`). Production: active map v6 "L4 step directions (Ella map 9)", 18 placements. Test DB: active v125 "L3 step directions (Ella map 9)", 18 placements.

1. **The nine current rules** are the same on both databases (production ids 10 to 18, test ids 215 to 229). Each row stores all of its words itself, on `dial_start_rule`: `customer_reason`, `coffee_line`, `lead_to_coffee_id`, `lead_line` (and `lead_quote_family_code`, NULL on all nine). The one writer of all of them is `dialPlacementService.setStartRuleInTx`. Reads go through `v_dial_start_rule` and `v_dial_start`. Brief 10 added no other place to store them.
   - The rule that changes, production #13 / test #229: `chocolate_nutty` p3, `fruity_gt_balanced`, no also-condition, Fabricator House Roast. Its admin label is "Fruity points higher than Balanced points". Its customer reason is "You asked for a stronger cup and picked one bright answer. This is chocolate and nut first, with a little lift." Its coffee line is "This is chocolate and nut first, with a little lift." Its lead is Geometric, with the lead line "The same family with more fruit, and sweeter."
   - **Functions called (G3.9):** `dialPlacementService.setStartRuleInTx`, the existing writer, used as is. The script reads only through views: `v_dial_start_rule`, `v_coffee`, `v_dial_placement`, `v_dial_step`, `v_dial_start`, `v_customer_quiz_current` and `v_customer_match_trail`. The brief adds no service function, reader or view.
2. **Brief 10 is not applied on either database, not even in part.** None of its objects exist: `coffees.map_line`, `dial_reason_choice`, `v_dial_reason_choice`, `dial_wedge.branches_from_code`, `dial_said_back.move_id` and `dial_start_condition.family_code`. Its closing report is a Task 0 that stopped for Dana's eight calls, and none of its code is in the tree.
3. **No publish is needed.** Start rules are not versioned (brief 7), and `v_dial_start` reads the current rows directly. `setStartRuleInTx` only requires that the coffee is placed on the active map, and that the lead is a current shown step from it.
4. **Current quiz results per first bag, before** (`v_dial_start` joined to `v_customer_quiz_current`; "real" means not test and not staff, by the rule of the 2026-11-15 pull):

   | First bag | Prod all | Prod real | Test all | Test real |
   |---|---|---|---|---|
   | Benchmark | 38 | 26 | 44 | 26 |
   | The Daily | 21 | 16 | 440 | 436 |
   | Fabricator | 14 | 13 | 16 | 13 |
   | La Familia | 13 | 12 | 16 | 12 |
   | Geometric | 8 | 7 | 8 | 7 |
   | Cafè Feminista | 3 | 3 | 3 | 3 |
   | The Village | 2 | 1 | 2 | 1 |
   | Amsterdam | 1 | 1 | 1 | 0 |
   | Tiger Stripe | 0 | 0 | 1 | 0 |

   Every Fabricator start is family `chocolate_nutty` with no espresso answer (14 on prod, 16 on test).
5. **Recorded first-match decisions on Fabricator:**
   - **Production: none.** No `customer_match_decision` on prod picks Fabricator, so no prod customer's `/map` changes beyond the rule.
   - **Test DB: two, both test fixtures.**
     - `dc89c4fc`: a `quiz_result` with `rule_id` 195, an older superseded row of the same family and priority.
     - `e7fcc0ea`: a `quiz_result` with no `rule_id` ("derived", from L1).
   - How they read after the change (`matchService.steps`, read only):
     - **dc89c4fc** stays on Fabricator, "Founder's pick", with the recorded row's reason: "…chocolate and nut first, with a little lift." `firstBagRule` falls back to the recorded row because the current row now names a different coffee. That row predates brief 9, so it has no coffee line and no lead, and none of its steps is marked as the lead.
     - **e7fcc0ea** stays on Fabricator with no Founder's pick card. The live winning row now names Tiger Stripe, not the position's coffee. This is the same shape as Dana's own account in closing report 10, item 2.
     - Nothing was rewritten.
6. **Tiger Stripe passes the start door** on both databases:
   - active, and placed (family `chocolate_nutty`);
   - anchor 12 oz SKU in stock;
   - retail price $32.00 (Fabricator is $29.00), `is_sellable` true;
   - grade rank 3, above the floor of 1;
   - no category tags.

   Geometric is a current shown step from Tiger Stripe (step 48 on prod, 158 on test, "More fruit"), so it can be the lead.

Nothing in Task 0 contradicts the decision block.

## Test DB run (2026-11-24)

- **Dry run:** 1 write (`em11_test_dry.txt`).
- **Apply:** 1 row written. New rule #235 (`decided_by` `script:ellaMapTigerStart_2026_11_24`); #229 superseded, not deleted. The other eight current rules are identical before and after (the script compares them in the same transaction).
- **Second run:** 0 rows written ("Plan: unchanged").
- **`v_dial_start` after:** Tiger Stripe 17 (1 before + 16 from Fabricator), Fabricator 0. Every other count is unchanged.
- **Integrity checks** (catalog 1–15, data catalog 1–14, customer): identical before and after (`em11_checks_test_before.txt` / `_after.txt`). The one FAIL, data catalog 6 (27 dead-table candidates), was there before.
- **`/map` read as the rule** (C8 "Read it as", a Chocolate & Nutty customer with Fruity above Balanced and no espresso answer, `b0cba02d`):
  - Position: Tiger Stripe, "Founder's pick". Text: "You told us coffee should feel like a reward: warm, rich, comforting, and a little bitterness tastes serious to you. You also said your first thought with a black coffee is what flavors are in it. This one is chocolate first with a little lift, and it holds up however you brew it."
  - Lead: Geometric, "More fruit, and sweeter."
  - Then Blossom and The Waverly.
- **Lints and type check:** `lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:cupping`, `lint:lineage` and `tsc --noEmit` are all green.

## Production dry run (2026-11-24, `--expect-db axisandbloom`)

Plan: write, for one row (#13). It names Tiger Stripe with the three sentences and Geometric as the lead, and keeps the admin label, the notes and the lead quote family (NULL). 14 current quiz results start on this row today. No recorded decision picks Fabricator. Full output: `backend/tmp/em11_prod_dry.txt`. Production checks baseline: `em11_checks_prod_before.txt` (65 PASS; only data catalog 6 fails, as before).

## Looked off, left alone

- **Two "little lift" sentences now sit side by side in the same family.** The new rule's sentences ("chocolate first, with a little lift") are close to the espresso row's ("chocolate first with a little lift, and it was built for espresso"). That is intended; Dana can edit either on `/admin/map`.
- **The new lead line repeats the step's own line.** The lead line "More fruit, and sweeter." is also step 48's own `customer_line`, so the lead card shows the step's own words.
- **A decaf customer whose quiz reads as this rule** (test `4b3c09f0`) is shown Tiger Stripe under "Read it as", with no step cards, because the decaf filter removes every step. The quiz door itself (`firstMatchFor`) would not give a decaf customer Tiger Stripe. This was the same with Fabricator before the change.

Dana, at the go: leave all three as they are.

## Production apply (2026-11-24, after Dana's go)

- **Apply** (19:21:08 UTC, `--expect-db axisandbloom`): 1 row written.
  - New rule **#19** (`decided_by` `script:ellaMapTigerStart_2026_11_24`): Tiger Stripe Espresso, with the three sentences and Geometric as the lead.
  - **#13 (Fabricator) is superseded** at 19:21:05, and kept. The history of `chocolate_nutty` p3 is now #4 Fabricator (brief 7), then #13 Fabricator (brief 9), then #19 Tiger Stripe.
  - The other eight current rules are identical before and after (ids 10, 11, 12, 14, 15, 16, 17, 18).
  - Output: `backend/tmp/em11_prod_apply.txt`.
- **Second run:** 0 rows written, "Plan: unchanged".
- **The rule row, before and after:**

  | Field | Before (#13) | After (#19) |
  |---|---|---|
  | Coffee | Fabricator House Roast | Tiger Stripe Espresso |
  | Customer reason | You asked for a stronger cup and picked one bright answer. This is chocolate and nut first, with a little lift. | You asked for a stronger cup and picked one bright answer. This is chocolate first, with a little lift. |
  | Coffee line | This is chocolate and nut first, with a little lift. | This one is chocolate first with a little lift, and it holds up however you brew it. |
  | Lead | Geometric Filter Coffee | Geometric Filter Coffee |
  | Lead line | The same family with more fruit, and sweeter. | More fruit, and sweeter. |
  | Family, priority, condition, admin label, notes, lead quote family | — | unchanged |

- **`v_dial_start` over the current quiz results, after:**

  | First bag | All (before → after) | Real (before → after) |
  |---|---|---|
  | Benchmark | 38 → 38 | 26 → 26 |
  | The Daily | 21 → 21 | 16 → 16 |
  | Fabricator | 14 → 0 | 13 → 0 |
  | Tiger Stripe | 0 → 14 | 0 → 13 |
  | La Familia | 13 → 13 | 12 → 12 |
  | Geometric | 8 → 8 | 7 → 7 |
  | Cafè Feminista | 3 → 3 | 3 → 3 |
  | The Village | 2 → 2 | 1 → 1 |
  | Amsterdam | 1 → 1 | 1 → 1 |

- **Recorded first-match decisions on Fabricator: none on production**, so nobody's recorded position changes.

### Brief 10 was pushed while this ran (G1.9)

Another session pushed brief 10, `06ae2cd`, at 19:21:20 UTC, 12 seconds after this apply. Its deploy (run 45469350543) went green at about 19:24. Brief 10's build-log entry says its production seed waits at its own Part E STOP, so production now has brief 10's schema and code but not its data. I did not run brief 10's seed or touch any of its objects.

What this means for the read-back:
- **Data written by this brief:** none of it is affected. Brief 10's seed sets coffee `map_line`s and reason choices; it does not write start rules. Rule #19 is still current after the new revision booted.
- **Integrity checks:** I compared them after the deploy (`em11_checks_prod_before.txt` / `_after.txt`). Every check that existed before passes or fails exactly as before, except data catalog 4 ("CATALOG.md stale"): brief 10's schema changed the live database. Brief 10's new checks are present: 15 passes (0 reason-choice rows), and 16 fails (18 map coffees have no `map_line` yet). Both follow from brief 10's seed not being run; nothing here comes from this brief.
- **`/map`, read as the rule on production** (two real Chocolate & Nutty customers with Fruity above Balanced and no espresso answer, `b0cba02d` and `f2c68521`; read only, `em11_readas_prod.txt`):
  - Tiger Stripe as "Founder's pick", with the new reason. The text ends with the new coffee line: "This one is chocolate first with a little lift, and it holds up however you brew it."
  - Steps: Blossom, Geometric and The Waverly.
  - **With brief 10's code and none of its seed data:**
    - No step is marked as the lead, because there are no lead-source choice rows yet.
    - Every step card opens "Your answers point elsewhere."
    - The quoted answers start lower-case ("coffee should feel like a reward: …").
  - So the DONE line "Geometric as the lead step" holds on the test DB (brief 9 code, above) and on the data: #19 names Geometric as the lead, and integrity check 14 passes. On production `/map` it will show once brief 10's seed has run. Whoever runs that seed should check this page afterwards.
- **`/admin/map` table 1** reads `v_dial_start_rule WHERE is_current`. That now returns #19 for `chocolate_nutty` p3. Not checked in a browser: G1.9, a deploy was running on Dana's machine.

### One more risk, left alone

Brief 9's one-off seed, `backend/src/scripts/ellaMapReasons_2026_11_20.ts`, still lists `chocolate_nutty` p3 as Fabricator House Roast in its data block. Run again with `--apply`, it would put Fabricator back through `setStartRuleInTx`. It has already been run on both databases and is not meant to run again. Nobody should rerun it without first changing that line.

## Lints and checks

`lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:cupping`, `lint:lineage` and `tsc --noEmit` are all green. They ran twice: before the go, and again before the commit, on the tree that includes `06ae2cd`. The brief adds no table, view or column, so there is no `comments.sql` or `CATALOG.md` change from it. The `CATALOG.md` regeneration after brief 10's schema belongs to brief 10's close.

## What the next brief needs

Nothing from this one. The holds on Fabricator, Brazil, Indonesia and D.R. Congo for launch remain a separate decision, not applied here.

**Later the same day (Dana, 2026-11-24):** the lead sentence of `chocolate_nutty` p3 is now "The next step toward fruit: sweeter and lighter, with the chocolate still underneath." It was set through `setStartRuleInTx`, superseding production rule #19 with #20 (test DB: #235 by #240). This script's `leadLine` matches, and a dry run reports it unchanged on both databases.
