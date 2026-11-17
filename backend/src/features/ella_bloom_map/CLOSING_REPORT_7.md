# Closing report 7: the match rule and the customer page

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_7_MATCH_RULE_AND_CUSTOMER_PAGE.md`. **Status 2026-11-17: DONE on production.** Code 2699b6b (deploy rev `axis-bloom-backend-00867-m9v`); the start rule entered and the two dead-end picks retired; `CATALOG.md` regenerated. See "Production" below.

`DEVELOPMENT_GUARDRAILS.md` read first. It is unchanged since 2026-11-08 (7939920).

Dana's answers (2026-11-17): first bags ignore sellability and show no price until brief 8, with the in-stock and grade checks kept; nine rows (the "dark, smoky" Chocolate & Nutty row and its condition code dropped; nothing else used it); a tie in an old Earthy result goes to the family the quiz branched from, otherwise Balanced; only the two dead-end first-match picks are retired, the other 13 stay on the advanced page; the move code `step`; build from the mockup and the brief.

Dana's go (2026-11-17): "Yes. Go to production in the order you listed. Stop and tell me if the second seed dry run shows anything other than 9 writes and 2 retirements." The stop was not hit.

---

## Production (2026-11-17 UTC)

1. **Commit and deploy:** 2699b6b pushed. Brief 7 files were added by path; `comments.sql` was staged without the Commerce 4 `stripe_customer_id` hunk, which stays in the tree. Deploy run 44132887288 was green (backend and frontend).
   - Startup log of `axis-bloom-backend-00867-m9v`: "DB schema verified".
   - The integrity warnings are the same four as before (sommelier #3, evidence #2 and #6, quiz #10), plus "CATALOG.md stale", which step 4 fixes.
2. **Seed:**
   - The second dry run, now reading the deployed views, showed **9 write, 2 retire, 0 unchanged, 0 missing**, the same rows as the first.
   - `--apply` at 17:07:52 wrote 11 rows. A rerun plans 0 write, 11 unchanged.
3. **Read back:**
   - **Rules:** 9 current rules, decided by `script:ellaMapStartRules_2026_11_17`.
   - **First-match picks:** Earthy side_b (Amsterdam) and Floral side_b (The Village) are retired and kept in the history; 13 current rows remain. The Earthy x Floral seam is closed (`is_open` false).
   - **The real view:** `v_dial_start` gives the same first bag as the Task 0 simulation for all 99 current sessions.
   - **Real customers (78):** Benchmark 26, The Daily 16, Fabricator 13, La Familia 12, Geometric 7, Cafè Feminista 3, The Village 1.
   - **The nine people:** 92, 95, 42 Benchmark; 85 La Familia; 88, 96, 33 The Daily; 86, 87 Fabricator.
   - **Surfaces:** every `dial_surface` row is `lane`.
   - **The gap:** no quiz was completed between the deploy and the seed, so no first-bag decision was skipped.
4. **CATALOG.md:** regenerated from production (217 tables, 112 views, 1,858 columns). Its hash, `4f18b512…`, is the live hash the startup log reported. Docs updated, committed and pushed with it.

---

## Part E: the production dry run and the counts (read-only, 2026-11-17)

### 1. The start-rule seed

`npx tsx src/scripts/ellaMapStartRules_2026_11_17.ts --dry-run --expect-db axisandbloom` (`BEGIN READ ONLY`). Production does not have the brief 7 schema yet, so no rule exists and the closed sides are the ones the schema closes on its first boot:

Ella map 7 start rules, DRY RUN on axisandbloom (2026-11-17T16:22:43.578Z)

Plan: 9 write, 2 retire, 0 unchanged, 0 missing.

The Ella map 7 schema is not on this database yet: no start rule exists, and the closed sides are the ones the schema closes on its first boot.

| section | subject | now | next | action |
|---|---|---|---|---|
| start_rule | balanced_sweet #1 | (none) | fruity_gt_cn -> Colombia La Familia Guarnizo ("Fruity points higher than Chocolate & Nutty points") | write |
| start_rule | balanced_sweet #9 | (none) | always -> Benchmark ("Otherwise") | write |
| start_rule | chocolate_nutty #2 | (none) | fruity_gt_balanced + espresso_at_home -> Tiger Stripe Espresso ("Fruity points higher than Balanced points, and makes espresso at home") | write |
| start_rule | chocolate_nutty #3 | (none) | fruity_gt_balanced -> Fabricator House Roast ("Fruity points higher than Balanced points") | write |
| start_rule | chocolate_nutty #9 | (none) | always -> The Daily ("Otherwise") | write |
| start_rule | earthy #9 | (none) | always -> Amsterdam ("Always") | write |
| start_rule | fruity #1 | (none) | cn_gt_zero -> Geometric Filter Coffee ("Any Chocolate & Nutty points") | write |
| start_rule | fruity #9 | (none) | always -> Cafè Feminista: Montze Olvera ("Otherwise") | write |
| start_rule | floral #9 | (none) | always -> The Village ("Always") | write |
| first_match | earthy side_b (toward floral, closed) | Amsterdam | (retired) | retire |
| first_match | floral side_b (toward earthy, closed) | The Village | (retired) | retire |

The 9 rules are Data 1 without the dropped row. The 2 retirements are the first-match picks on the closed sides (Amsterdam on Earthy toward Floral, The Village on Floral toward Earthy); they are superseded, not deleted, and stay in the history. Nothing else is written by the script. The schema itself, on its first boot, adds the new tables and views, closes the Earthy x Floral seam, marks Earthy for the old-result reading, and seeds the parameter, the five conditions, the `step` move, the `closed_side` flag and twelve customer-copy rows.

### 2. Task 0 item 6, again on production (78 real current quiz results, same as at Task 0)

| First bag | People |
|---|---|
| Benchmark | 26 |
| The Daily | 16 |
| Fabricator | 13 |
| La Familia | 12 |
| Geometric | 7 |
| Cafè Feminista | 3 |
| The Village | 1 |

Persons 92, 95, 42 Benchmark; 85 La Familia; 88, 96, 33 The Daily; 86, 87 Fabricator, as expected. On the test DB the real view, `v_dial_start`, gives the same first bag as this simulation for all 185 current sessions.

### 3. On your yes, in this order

1. Commit by path (only my hunks of `comments.sql`; the Commerce 4 changes stay out) and push. The deploy applies the schema at boot. Check the deploy and the startup log.
2. Run the seed `--dry-run` again (expect **9 write, 2 retire**; if it shows anything else, I stop), then `--apply --expect-db axisandbloom`.
3. Read back: 9 current rules; the two picks retired; `v_dial_start` over the real current results gives the counts above; every `dial_surface` row `lane`.
4. Regenerate `CATALOG.md` from production (it needs the new objects there), update the docs with the production evidence, commit and push.

Between the deploy (step 1) and the seed (step 2) the quiz door finds no start rule: a quiz taken in those minutes saves as always, and its first-match decision is skipped and logged (`[quiz/match-decision]`), as the door already does on any failure. The customer pages are all on `lane`, so nobody sees a difference.

---

## What was built

- **Schema (A):**
  - `dial_seam.is_open` (Earthy x Floral false, set once when the column is added) and `v_dial_wedge_lane`, the one read for which leans may be offered; preview flag `closed_side`.
  - `dial_start_condition` (always, fruity_gt_cn, fruity_gt_balanced, cn_gt_zero, espresso_at_home) and `dial_start_rule` (supersede-only grants), with `v_dial_start_rule` (every row, the history).
  - `v_dial_start_input`: per completed quiz session, the raw points per family code from `quiz_session.context_data` (mapped from the stored display names), the family as read, one boolean per condition and the same as jsonb.
  - `v_dial_start`: the winning current row per session.
  - Parameter `dial_earthy_branch_reworded_on` (20261009, YYYYMMDD in the numeric table) and `dial_wedge.old_branch_reads_scores` (Earthy).
  - `dial_move` row `step`; twelve `dial_customer_copy` rows for the page.
  - Comments for every object; the integrity seed lists know the new codes and key.
- **Backend (B):**
  - `dialPlacementService.setStartRule(InTx)`: supersede and insert; refuses an unplaced coffee, an unknown family or condition, an empty label or reason.
  - `setFirstMatchInTx` has a retire option (supersede, insert nothing).
  - `catalogService.setLeanInTx` refuses a closed side (`CLOSED_SIDE`).
  - `matchService`: `firstMatchFor` reads `v_dial_start`, falls back to the center family's always row, and keeps the in-stock, grade-floor and decaf checks without requiring sellability. The decision records `rule`, `rule_id`, `family_read`, `scores` and `conditions`. `DELICATE_FAMILY`, `DELICATE_TOWARD`, `SIDE_A_FAMILIES` and `firstMatchCell` are gone.
  - `matchService.steps` (`GET /api/map/steps`): the position, the first-bag reason before any bag, and the published shown steps leaving the position (word, coffee, the customer line or the destination's notes, a price where one exists).
  - `decide` with move `step` accepts only one of those steps and records the step id and word.
  - `me` names the published step that joins two choices, adds the customer's own line (`customerReads.getMatchTrailLines`, from `v_customer_feedback_current`) and the first-bag reason.
  - The customer face shows every placed coffee.
  - `moves()` and the calculated hops stay for the email and the beats (both on `lane`) and the advanced page.
  - Admin `GET|PUT /api/admin/map/start-rules`.
  - Seed `backend/src/scripts/ellaMapStartRules_2026_11_17.ts`.
- **Frontend (C):**
  - `/map` rebuilt from the mockup: heading and one line; the map with the customer's coffee named, an arrow to each step's coffee, every other coffee a quiet unnamed dot, the family names at the corners; "Your first bag" with the reason (or "You are here" after a bag) and a price chip where one exists; one card per step with "See it" opening the coffee and "Make it my next bag"; the closing line. No "Same again", no compatibility sentence, no comfort-zone label.
  - `EllaMapFace` gains `arrowsTo` and `quietOthers` (names placed so they do not overlap); the admin face and its defaults are unchanged.
  - `MapTrail` lists the word, the coffee, the date and the customer's own line.
  - `MapQuizStart` adds the reason.
  - `/admin/map`: table 1 is the rule (family, when, first bag, the reason, each editable, with History); the lean buttons leave out a closed side; the publish button reads "Publish N changes", or "Nothing to publish" and disabled.

## Evidence (test DB, 2026-11-17)

- **Seed:** the dry run planned 9 write, 2 retire. `--apply` wrote 11, and a rerun plans 0 write, 11 unchanged.
- **The view against the simulation:** `v_dial_start` gives the same first bag as the read-only simulation for all 185 current sessions on the test DB.
- **Browser** (marked Zzz test admins on the test DB, one per customer, demoted and disabled afterwards; backend :4917, Vite :5174; each quiz session went through the real quiz door):

  | Customer | First bag | Steps shown | Arrows | Other dots |
  |---|---|---|---|---|
  | Balanced, no bag | Benchmark, with its reason and $29.00 · 12 oz | Bolder The Daily, Brighter La Familia, More going on Fabricator | 3 | 14 quiet, unnamed |
  | Balanced, Fruity above C&N | La Familia | More delicate The Village, More body Benchmark, More body, keep the fruit Geometric | 3 | 14 |
  | C&N, Fruity above Balanced | Fabricator | More fruit Geometric, Simpler Brazil, Rounder Benchmark | 3 | 14 |
  | the same, espresso usual drink | Tiger Stripe | Bolder Blossom, More fruit Geometric, More fruit The Waverly | 3 | 14 |

  - "Make it my next bag" on The Daily moved the dot. The page then read "Your next step" and "You are here: The Daily", with Lighter Benchmark and Bolder Amsterdam, and no first-bag reason.
  - The trail lists "Your start · Benchmark" and "Bolder · The Daily" with their dates.
  - No roaster name, ring, lane, grade, version, basis or "Same again" text appears on any `/map` page.
  - Screenshots: `map7_customer_balanced.png`, `map7_customer_step_open.png`, `map7_customer_after.png`, `map7_customer_lafamilia.png`, `map7_customer_fabricator.png`, `map7_customer_tiger.png`, `map7_trail.png`.
- **Admin:**
  - Table 1 shows the nine rows in Dana's words (`map7_admin_table1.png`).
  - Changing Balanced "Otherwise" to The Daily with a new reason saved and showed at once; History showed the earlier Benchmark row (`map7_admin_table1_history.png`). Putting it back restored Benchmark and the reason, and the seed then planned 0 changes.
  - Big City (Earthy) offers "Leans Chocolate & Nutty" and "Middle"; The Village (Floral) offers "Leans Fruity" and "Middle".
  - The publish button reads "Nothing to publish" and is disabled.
  - The two retired picks are gone from the current rows (13 remain on the advanced page) and present in the history.
- **Customer side unchanged:** the Bloom page renders as before (`map7_bloom_page.png`). Every `dial_surface` row is `lane`.
- **Checks:**
  - `tsc --noEmit`: backend clean; frontend the same 7 known errors (Profile, ArchetypeSection, useAdjacentArchetype), none in touched files.
  - All six lints clean.
  - `dialMap7` 5/5 and `matchService` 7/7; `mapAdmin`, `dialMap`, `dialMap5`, `dialMap6`, `dataCatalogIntegrity`, `dataCatalogQueries`, `customerIntegrity` and `usualDrink` all pass.
  - **Full backend suite** (`npx vitest run src`): 1,239 passed, 24 failed, 6 skipped.
    - One failure was caused by this run: the `quizInterpretation` backfill's data guard saw `quiz_session` change because I was creating the acceptance customers on the test DB at the same time. Run alone it passes, 26/26.
    - The other 23 are in files that import nothing this brief changed. They are test-DB data and fixture drift of the kind OT-140 records:
      - `evidenceViews` 7 and `evidenceAdmin` 4;
      - `quizScoring` 6;
      - `sommelierRag` 2 (no free slots), `sommelierEval` 2 and `sommelierAnswer` 1;
      - `catalogService` 1 (a slot priority taken);
      - `schema.catalog_blueprint` 1;
      - `qrDoor` cleanup.

      Recorded in OT-140; brief 5 recorded 25 of the same kind.

## Deviations

1. **The family is read from the stored primary, not from the quiz's match field with an override** (Task 0 said the latter). Every Balanced-branch answer stores Balanced as the primary, so decision 3 holds without a family code in the view, and the result is the same for every real session.
2. **The old Earthy reading is keyed by data:** `dial_wedge.old_branch_reads_scores` (true for Earthy) plus the date parameter, instead of the family code in the view (G2.1). The date is stored as 20261009 because the parameter table is numeric.
3. **The customer face now shows every placed coffee**, not only the sellable, in-stock ones, because three first bags are not sellable yet. On `/map` the other coffees are quiet dots. The trail's and the quiz piece's faces (both admin-only and on `lane`) also show them, the unsellable ones dimmed as before.
4. **No "Same again" on the new page at all**, before or after a bag, as in the mockup.
5. **`dial_move` `step` is not marked a customer move:** that flag drives the calculated-hop phrase table, and a step's word is its own.
6. **The seed's pre-deploy dry run** names the pair the schema closes (`CLOSED_PAIR_ON_DEPLOY`), because production has no `v_dial_wedge_lane` until the deploy. After the deploy it reads the view.
7. **Acceptance fixtures:** the quiz sessions, interpretations and one usual-drink answer of the Zzz customers were inserted directly on the test DB, marked, and decided through the real quiz door.
8. **The price** is the anchor-size slot price (`v_coffee_sellable_slot`, through `catalogReads`) where a coffee holds a slot; otherwise none.
9. **`CATALOG.md`** is regenerated after the production deploy, because it reads production's comments (as in brief 5).

---

## Task 0 as written before the go

### The result and the four questions (answered by Dana 2026-11-17)

**Data 1 over production gives the expected start for all nine people.** Across the 78 real current quiz results (not test, not staff), it gives these starts:

| First bag | People |
|---|---|
| Benchmark | 26 |
| The Daily | 16 |
| Fabricator | 13 |
| La Familia | 12 |
| Geometric | 7 |
| Cafè Feminista | 3 |
| The Village | 1 |
| Amsterdam | 0 |
| Tiger Stripe | 0 |

| Person | Expected | Rule gives |
|---|---|---|
| 92 | Benchmark | Benchmark |
| 95 | Benchmark | Benchmark |
| 42 | Benchmark | Benchmark |
| 85 | La Familia | La Familia |
| 88 | The Daily | The Daily |
| 96 | The Daily | The Daily |
| 33 | The Daily | The Daily |
| 86 | Fabricator | Fabricator |
| 87 | Fabricator | Fabricator (no espresso answer) |

Nobody starts on Amsterdam. No real customer has a new-wording Earthy result; the only one on production is a staff account's earlier session. Nobody starts on Tiger Stripe either, because no real customer has an espresso usual drink.

**Questions (each changes what I build):**

1. **Three first bags are not sellable today.** The Daily, Geometric and Amsterdam are `is_sellable` false on production. Today's first match only accepts a coffee that is sellable, in stock and at or above the grade floor (`matchService.firstMatchFor`). With that filter kept, 23 of the 78 (The Daily 16, Geometric 7) would not get their row's coffee. **I propose `v_dial_start` does not filter on sellability**, the same as the brief's call for steps. Those coffees show without a price until brief 8. I would keep the in-stock and grade-floor checks; all ten start coffees pass both today. Yes, or keep the sellable filter?
2. **The Chocolate & Nutty row "Picked the dark, smoky answer" can never win.** A session that picked that answer is stored with Earthy as its primary, so it reads on the Earthy row, which gives Amsterdam anyway. Old Earthy sessions read as their highest score, but they have no branch answer stored, so the condition is false for them. **Keep it as a harmless tenth row, or drop it** (nine rows, no `branch_dark_smoky` code)? I'd drop it.
3. **A tie when an old Earthy result is read from its scores.** There is no tie on production today: all 10 read as Chocolate & Nutty. Ties are possible, though: the five scored answers carry 9 points between three families, so 4/4/1 or 3/3/3 can happen. **I propose a tie goes to the family the quiz branched from** (Chocolate & Nutty for 9 of the 10), and otherwise to the center (Balanced, read from `dial_wedge.is_center`). Yes?
4. **Should the old family-by-lane first-match rows be retired too?** Besides the two dead-end rows the brief names, 13 other `dial_first_match` rows stay current. After this brief, nothing customer-facing reads them; they move to `/admin/map/advanced`. I'd leave them as they are (the brief says do not delete), only retiring the two. Yes?

Everything else below fits the brief or is a small adaptation that I'll make as written.

---

### Task 0 findings

#### 1. The quiz facts the rule needs

| Fact | Where it lives | Read through |
|---|---|---|
| Three raw scores | `quiz_session.context_data -> 'scores'`, keys `Balanced` / `Chocolate & Nutty` / `Fruity`, with older spellings `Balanced & Sweet`, `balanced`, `chocolate`, `fruity`. A missing key means 0. | No view carries them per session. `v_subscriber_quiz_results` has them only for a subscriber's latest session, so `v_dial_start_input` reads `quiz_session` directly (declared in `comments.sql`, as the 2026-11-15 pull did). |
| Primary family | `quiz_session.resulting_archetype_id` | `v_customer_quiz_current.archetype_code` |
| The quiz's own match and lean | `quiz_session_interpretation` (current): `match_archetype`, `intensity_lean` | `v_customer_quiz_current.match_archetype_code`, `intensity_lean` |
| Branch quiz and answer | `quiz_session.branch_answer_id` → `quiz_answer.answer_code`; the quiz is the answer's `quiz.version` | `v_customer_quiz_current.branch_answer_code`, `branched_from` |
| Date | `quiz_session.completed_at` | `v_customer_quiz_current.completed_at` |
| Which session is current | self-taken first, then latest (G2.19) | `v_customer_quiz_current` (`customerReads.getCurrentQuizSessionId`) |

**The stored scores already exclude the food answer.** In v7 the treat question (Q6) has weight 0 and no `quiz_answer_archetype_score` rows. Q1 to Q5 weigh 1, 2, 1, 2 and 3, so the scores total 9. Every one of the 78 real sessions totals exactly 9, including the 8 older `v1`-interpretation sessions. The `v_quiz_scoring_matrix` weights agree.

**Branch answer codes (v7, current text):**

| Branch quiz | Code | Result | Answer |
|---|---|---|---|
| `v7-branch-earthy` (from Chocolate & Nutty) | `v7_branch_cn_stay` | chocolate_nutty | "Coffee that feels like a reward. Warm, rich, comforting." |
| | `v7_branch_cn_earthy` | earthy | "Coffee with a kick. Dark, strong, a bit smoky." |
| `v7-branch-floral` (from Fruity) | `v7_branch_fruity_stay` | fruity | "Bright and lively. Every sip a little different." |
| | `v7_branch_fruity_floral` | floral | "Light and delicate, and more about the smell than the taste." |
| `v7-branch-balanced` (since 2026-10-09) | `v7_branch_bal_cozy` | balanced_sweet | "The cozy, dessert-like feeling. Soft and sweet." |
| | `v7_branch_bal_fruit` | balanced_sweet | "A little sweetness that reminds you of fruit…" |
| | `v7_branch_bal_floral` | balanced_sweet | "The smell. You'd catch yourself breathing it in…" |

**Old against new Earthy results.** The rewording kept the answer code. `v7_branch_cn_earthy` has three SCD2 rows:
- `fbf0241f`: the old text "Deep and intense…", valid to 2026-10-09 16:50:17Z;
- `0def0583`: the old text again, zero-length (valid_from = valid_to);
- `0a902d71`: "Dark, strong, a bit smoky", current.

The code alone cannot tell old from new. Two things can:
- **`branch_answer_id` was only stored from 2026-10-09.** All 22 Earthy and Floral sessions before then have none, and every one after has one.
- **The cut-over is clean.** No session completed between 16:50Z, when the rewording landed, and the first branch session at 16:53Z. No Earthy or Floral session after the cut-over lacks a branch answer.

So "old Earthy" = primary Earthy and completed before `dial_earthy_branch_reworded_on` (2026-10-09). `branch_dark_smoky` = the branch answer is `v7_branch_cn_earthy` and the session completed on or after that date. Both read the parameter; neither has a literal.

**Floral from the Balanced branch** is already stored with primary **Balanced**: every Balanced-branch answer results in `balanced_sweet`. Only the interpretation's `match_archetype` says Floral, with `intensity_lean` 'delicate'. That is 2 real people (95 is one). Today `matchService` reads `match_archetype`, which is why 95 starts in the Fruity wedge toward Floral today.

`family_read` will start from `match_archetype_code` (falling back to the primary when there is no interpretation), so the override for decision 3 is written out in the view. It changes nothing else: `match_archetype` differs from the primary only for those 2 people.

Per family after the reading: Balanced 38, Chocolate & Nutty 29 (10 of them old Earthy), Fruity 10, Floral 1 (an old Fruity-branch Floral), Earthy 0.

#### 2. Espresso at home

- `brew_drink_base_method.code = 'espresso'`. Seven usual drinks have it: americano, americano with milk, cortado, espresso, iced americano, iced latte, latte. All seven are `is_home_drink` true; the only non-home drink is "I mostly buy my coffee out" (base `none`).
- So `espresso_at_home` = the customer has a `v_customer_usual_drink` row with `base_method = 'espresso'`.
- **Usual-drink answers on production:** 1 person in all, and that one is a test account (latte, home). No real customer has one, so the espresso row changes no start today.
- The separate brew-profile field `brew_methods` holds 'espresso' for one staff account. The brief names the usual drink, so I will not read `brew_methods`.

#### 3. The match code today, and the smallest change

**What reads the match today:**
- **The quiz route** (`routes/quiz.ts:276`) calls `matchService.decide({trigger: 'quiz_result'})` after every quiz save. It runs whatever `quiz_result` says, best-effort and idempotent on the session. `decide` → `firstMatchFor` → `firstMatchCell`, which applies the code rule (`DELICATE_FAMILY`, `DELICATE_TOWARD`, `SIDE_A_FAMILIES`) to `match_archetype` and `intensity_lean`. It then takes the `dial_first_match` founder pick of that cell, else a derived pick, else the center's, filtered to sellable, in stock and at or above the floor.
- **`/api/map/me`** returns the position, the "start here" sentence and the trail. Its move words come from `dial_hop_phrase`. `MapQuizStart` and `MapTrail` read it.
- **`/api/map/moves`** returns the position plus the four calculated moves (`v_dial_hop` via `dialReads.hopsFromCoffee`, then `rankMoves`). Each card carries a move line and a compatibility sentence. `MapPage` reads it.
- **`/api/map/decide`** takes moves stay, bolder, gentler or different. A coffee is accepted only if it is in that calculated set.
- **The dial-in email and beats** (`cron.ts` `dialInMapButtons`, `routes/beats.ts`) use `moves()` and `decide` with the same four moves. Both are gated by `reorder_email`, which is `lane`, so neither runs today.

**Smallest change:**
- **First bag:** `firstMatchFor` reads `v_dial_start` for the session; there is one row per session, already decided. The three constants and `firstMatchCell` go.
  - Fallback: Balanced's `always` row, read from the table by `family_code` = the center wedge, not typed in.
  - Recorded in the decision's `inputs`: `rule_id`, `family_read`, the three scores and the conditions that held.
  - The decaf filter stays as it is, so a decaf customer still gets no first match (OT-126).
- **Steps:** a new `matchService.steps(profileId)` for the map. It returns the published, shown steps leaving the position from `v_dial_step` (`on_active_map`), ordered by basis then word, each with:
  - the word, the destination and its signature notes;
  - the customer line, or the destination's signature notes when the line is NULL;
  - a price where one exists.

  `moves()` and `rankMoves` stay as they are for the email, the beats and the advanced page.
- **A step choice needs a move code.** `customer_match_decision.move_id` references `dial_move`, while a step's word is free text. I'll seed one `dial_move` row, `step` ('Step on the map', a customer move), and accept `move: 'step'` in `/api/map/decide`. In that branch, `decide` checks that the coffee is a shown, published step from the current position and records the `dial_step` id in `inputs`. The trail then takes the step's own word.
- **`/me`** gains the first-bag reason, shown only while the only decision is the quiz's. The "start here" sentences stay in copy.

#### 4. The closed side (Earthy and Floral)

- `dial_wedge`: Earthy has `side_b_archetype` floral, and Floral has `side_b_archetype` earthy. The pair is one row in `dial_seam`: (earthy, floral), `label` NULL, `is_labelled` false. **A boolean `is_open` on `dial_seam` fits** (default true, false for that row). Any lane that is a side resolves to its seam through the wedge's side archetype, with no family code involved.
- **`dial_first_match` rows on those two lanes:** id 9, earthy × side_b → Amsterdam, and id 15, floral × side_b → The Village. Both are current; A2 retires them.
- **Lean decisions on them:**
  - Earthy toward Floral: none ever.
  - Floral toward Earthy: one, now superseded. The Village was set side_b on 2026-11-10 and moved to side_a by the brief 5 seed on 2026-11-16.
  - No current lean sits on a closed side, and no placement does.
- **`setFirstMatch` cannot retire without a replacement:** its supersede path always inserts a new row. I'll add a retire option to `setFirstMatchInTx`, a parameter rather than a second writer (G3.9). `setLeanInTx`, which is in `catalogService`, not `dialPlacementService`, gets the refusal for a closed side.

#### 5. The customer pieces as built

- **`/map`** (`App.tsx:224`, `PrelaunchGate` > `AdminRoute` > `MapPage`):
  - a thumb face, then a position card with the sentence, the notes and the compatibility sentence;
  - a "Same again" button: the `stay` move's `button_label` from `dial_hop_phrase` (`dial_move` 'stay' is labelled 'Same again');
  - three move buttons that reveal cards with a move line, the notes, the compatibility sentence and "Choose this";
  - a "See the whole map" sheet.
- **The compatibility sentence** comes from `compatibilityReads.compareCoffee(coffee, {archetype})` through `matchService.presentation`. It is not on the new page.
- **`MapQuizStart`** (inside `FlavorQuiz` at `FlavorQuiz.tsx:1618`) renders only when `quiz_result` = map. It shows a thumb face and `/me`'s sentence.
- **`MapTrail`** (on `Profile.tsx:650`) renders only when `profile_trail` = map. It shows the move word and coffee per decision, and the full face with `path` joining the dots.
- **`EllaMapFace` props:**
  - `placements`, `wedges`, `seams`, `highlightCoffeeId`, `hops`, `path`, `size`, `labelMode` ('name' | 'none'), `onTapCoffee`;
  - from brief 5: `steps` and `dotStyle`.

  For C1 it needs optional props for named step arrows, unnamed other dots and corner family names. The admin defaults stay.
- **`lib/mapCustomer.ts`:** `getMapSurfaces`, `getMapFace`, `getMapMe`, `getMapMoves`, `decideMove`, `useMapFetch`.
- **`/api/map`:** `/surfaces`, `/face`, `/me`, `/moves` and `/decide`. All except `/surfaces` need an admin, or a `dial_surface` that says map.
- **`dial_customer_copy` today:** `choose_this`, `email_map_intro`, `moved_to`, `no_longer_available`, `see_whole_map`, `start_at_base`, `start_here`, `trail_start`, `trail_title`. C6 adds new codes; none is renamed.

#### 6. The rule over production

This is the table at the top. It used the 2026-11-15 pull's own `person_n` numbering and test/staff flags, in one `READ ONLY` transaction. Every one of the nine people still has the scores, dates and branch answers in the pull's CSV.

---

### Other things found

- **Published steps on production:** 36, all on the map, 0 current steps off it. The acceptance's lists match:
  - Benchmark → The Daily (Bolder), La Familia (Brighter), Fabricator (More going on);
  - La Familia → The Village, Benchmark, Geometric;
  - Fabricator → Geometric, Brazil, Benchmark;
  - The Daily → Benchmark (Lighter), Amsterdam (Bolder).

  Geometric has two "Lighter" steps (D.R. Congo and La Familia). The D.R. Congo one has no customer line, so its card shows D.R. Congo's notes.
- **Half Moon and Nightcap Decaf are an island.** Their only steps go to each other ("No caffeine", "Half the caffeine"). With today's tag filter, regular customers see untagged coffees only and a decaf customer gets no first bag (OT-126), so no customer reaches either. They stay steps on the map; nothing changes.
- **The customer's own line in the trail** comes from `v_customer_feedback_current.raw_text`: the latest feedback the customer left on that coffee. `v_customer_match_trail` does not carry it, so B4 joins it on coffee.
- **Dana's PDF is not in the repo.** I'll build C1 and C2 from Part C's description and `map5_mockup_customer.png`.
- **Existing quiz-result decisions are not rewritten.** There are 2 on production, decided with the code rule. A new quiz from a person writes a new decision through `v_dial_start`.
- **CATALOG.md (G2.4):** I agree with the brief's check. `dial_first_match` is keyed by family and lane only; `quiz_session_interpretation` holds the quiz's own verdict; `dial_customer_copy` holds fixed sentences. New objects: `dial_start_condition`, `dial_start_rule`, `v_dial_start_input`, `v_dial_start`, the parameter `dial_earthy_branch_reworded_on`, the `dial_seam.is_open` column, and the `dial_move` row `step`.
- **The tree:** the Commerce 4 changes (`stripe.ts`, the subscription files, `comments.sql`, `MANUAL_SETUP_IDS.md`, `commerce/README.md`) are still uncommitted. I'll add files by path and stage only my own `comments.sql` hunks.
