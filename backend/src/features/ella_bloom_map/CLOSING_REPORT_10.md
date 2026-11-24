# Closing report 10: the reasons on `/map`, Rev 2

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_10_REASONS_REV2.md` · Design: `DESIGN_MAP_REASONS_REV2_2026-11-21.md` · Read first: `DEVELOPMENT_GUARDRAILS.md` (G3.9 as amended 2026-11-23), `CATALOG.md` (generated 2026-11-21, hash 7b8b7029).

## Task 0 (2026-11-23, read only on the test DB and production)

Nothing was written to either database. Queries ran in `BEGIN READ ONLY` (`backend/tmp/md.mjs`, `backend/tmp/em10_q*.sql`). Production: active map "L4 step directions (Ella map 9)", 18 placements, 36 shown steps, 73 current said-back rows. Test DB: active "L3 step directions (Ella map 9)" (the same placements and steps; the label differs because the two databases count versions separately).

`DEVELOPMENT_GUARDRAILS.md` has an uncommitted change in the working tree (the G3.9 amendment). It is not mine, and I have left it as it is.

### Item 1: readers, writers and views this brief would add or change (G3.9)

**New objects (each needs Dana's yes)**

| New | Kind | Considered instead | Why that does not fit |
|---|---|---|---|
| `dial_reason_choice_kind` (`id`, `code` UNIQUE, `label`, `sort_order`; seeded `step_support`, `lead_source`) | table (lookup, G2.7) | a text `kind` column | G2.7: a set of kinds is a lookup table |
| `dial_reason_choice` (`id`, `kind_id`, `code`, `label`, `sort_order`, `is_active`, `decided_by`, `created_at`, `superseded_at`; one current row per kind and code) | table | `dial_step_basis` (ordered, but it says why a step exists and has no switch); `dial_surface` (one switch per surface, no order); `dial_customer_copy` (sentences); `evidence_parameter` (numbers with a range); `dial_move` (vocabulary of moves) | None of them holds an ordered list of steps in an algorithm with a switch per row. I propose supersede and insert, like the other `dial_` decision rows, so every reorder keeps its history and nothing is deleted. |
| `v_dial_reason_choice` (current rows with the kind code, plus `is_current` for history) | view | none | The new table's one read path (G2.5) |
| `dialReads.reasonChoices(runner)` | reader | `dialReads.customerCopy` and `getParameters` (each reads one other table) | It reads the new view. Its callers: `matchService.steps`, the admin route and integrity check 15. |
| `dialPlacementService.setReasonChoiceInTx` / `setReasonChoice` | writer | none for this table | The one writer of `dial_reason_choice`: set the order, switch on or off, never delete |

**Changed objects (existing, extended)**

| Object | Change |
|---|---|
| `dial_said_back` + `v_dial_said_back` + `v_dial_said_back_fact` | `move_id` (nullable FK to `dial_move`), carried as `move_code` |
| `dialPlacementService.setSaidBackInTx` | takes `moveCode` (undefined keeps the current value, null means none) |
| `dialReads.saidBack`, `saidBackFacts` | also return `move_code` |
| `coffees.map_line` + `v_coffee` + `v_dial_coffee_availability` | new column, not blank when set |
| `catalogService.updateCoffeeInTx` | takes `mapLine`, like `shortName` |
| route `PATCH /api/admin/catalog/coffees/:id` | passes `mapLine` (the `/admin/map` coffee card calls it) |
| `dialReads.mapCoffees` | also returns `map_line`. It takes the family from `v_dial_placement.archetype_code` (the brief's source) instead of `v_coffee.match_archetype`; the two agree for all 18 coffees on prod today. |
| `dial_start_condition.family_code` (nullable `archetype_enum`) | Seeded once in a DO block: `fruity_gt_cn` and `fruity_gt_balanced` → `fruity`, `cn_gt_zero` → `chocolate_nutty`, `always` and `espresso_at_home` → none. Carried as `condition_family_code` through `v_dial_start_rule` and `v_dial_start`, then `dialReads.startRules` / `startForSession`. |
| Branch parent family (see "Where the branch-parent family comes from" below) | `dial_wedge.branches_from_code` (nullable `archetype_enum`), carried through `v_dial_placement` as `family_branches_from_code` |
| `dial_customer_copy` row `no_support` | an insert through the seed. No new reader; `dialReads.customerCopy` already reads every row. |
| `customerReads.getCupboardCoffee`, `getCoffeeFeeling` | Take either key (item 3). The two `…ByProfile` copies go away. |
| `matchService.steps` | The composition is replaced in place. No second composer, and the response keeps its shape. |
| Seed scripts | read through views (item 4) |
| `dataCatalogIntegrity.dialMapChecks` | new checks 15 (a reason-choice code the service does not know) and 16 (a map coffee with no `map_line`) |

**Reused as they are:** `customerReads.getMatchCurrent`, `getMatchTrail` (reads `v_customer_match_trail`), `customerContext`, `dialReads.quizAnswers` (reads `v_dial_quiz_answer`), `dialReads.stepsFrom`, `placementActive`, `customerCopy`, `evidenceReads.getParameters`, `getCardPresentations`.

**Where the brief's named facts come from**

- **The destination coffee's family:** `v_dial_placement.archetype_code`, read through `dialReads.mapCoffees`, which already limits itself to placed coffees.
- **Where the branch-parent family comes from:** the quiz does not hold it. On prod the branch quizzes say only which family *triggers* them:
  - `v7-branch-earthy` is triggered by `chocolate_nutty`;
  - `v7-branch-floral` by `fruity`;
  - `v7-branch-balanced` by `balanced_sweet`.

  No column says which family a branch *leads to*. Branch answers score for no family (`quiz_answer_archetype_score` is empty for them), and the switch to Earthy or Floral exists only in the quiz version's name and in code (`quizScoring.BRANCH_ANSWER_EFFECTS`, `historicalBranchAnswerCode`).
  - The per-session `branched_from_code` (`v_dial_start_input`) is the customer's own branch, not the destination's.
  - Writing a "leads to" column on `quiz` would change quiz content, which the brief rules out.
  - **Proposed:** `dial_wedge.branches_from_code` (dial domain, editable map data), seeded once as earthy → chocolate_nutty and floral → fruity, and carried through the existing `v_dial_placement`. No new view. **Needs your call.**
- **A first match when no current start rule names the coffee** (item 2): through the existing `getMatchTrail` (`v_customer_match_trail`). The coffee sentence then comes from the coffee's `map_line` (`mapCoffees`).

### Item 2: Dana's account on production

- **Profile:** `5d005443-a7a9-4ee2-893e-0745735431bf` (Dana-Admin).
- **Trail:**

  | # | When (UTC) | Version | Move | Coffee | Source |
  |---|---|---|---|---|---|
  | 1 | 2026-11-12 22:33 | L0 (v1) | `quiz_result` | Tiger Stripe | quiz |
  | 2 | 22:48 | L0 | `stay` | Tiger Stripe | map |
  | 3 | 22:53 | L0 | `stay` | Tiger Stripe | map |
  | 4 | 22:54 | L0 | `stay` | Tiger Stripe | map |

  - Step 1's inputs: `"rule":"derived"`, `asked_cell` chocolate_nutty / middle, 3 candidates, **no `rule_id`**. It was recorded before the start rules existed (brief 7, 2026-11-17).
  - The `stay` rows ("Same again") came from the L0 workbench, trigger `hop`, 0 candidates.
- **Quiz:** session `68ed228c` (2026-11-12, self-taken): Chocolate & Nutty 9, no branch switch. Answers, in quote order:

  | Answer | Weight |
  |---|---|
  | `v7_branch_cn_stay` | branch |
  | `v7_q5_a` | 3 |
  | `v7_q2_a` | 2 |
  | `v7_q4_a` | 2 |
  | `v7_q1_a` | 1 |
  | `v7_q3_a` | 1 |
  | `v7_q6_c` | 0, the treat question |

- **Setup answers:** brew methods espresso; usual drink cortado and french press; **feeling `different`**; no kitchen brand.
- **The rule her answers win today:** #14 chocolate_nutty "Otherwise" → **The Daily**, not Tiger Stripe. Rule #12 (Tiger Stripe) needs Fruity above Balanced **and** espresso at home. She has espresso at home, but Fruity 0 is not above Balanced 0.
- **Why the page said "You are here"**, two causes, each enough on its own:
  - Her current move is `stay`, and brief 9 treats every move except `quiz_result` as "has a bag".
  - Brief 9's `firstBagRule` returns no rule for her. The recorded decision has no `rule_id`, and the live winning rule names The Daily, not Tiger Stripe. So the page has no Founder's pick and no reasoning, and the step cards carry only the "If you want…" openers.
- **Can "first match" be read from the move alone? No.** Her current move is `stay`.
  - **Proposed reading (data, no move list in code):** the position is a first match when its coffee is the coffee of the customer's latest `quiz_result` decision, and no decision since then picked another coffee (only "Same again").
  - It reads from `getMatchTrail`, which `firstBagRule` already calls.
  - A customer with no decision, read through "Read it as", counts as a first match, as in brief 9 (C8).
  - **Needs your yes:** "Same again" means they had at least one bag, but the card still says "Founder's pick". That is what the design's worked page for your account shows.

### Item 3: the duplicate lookups from brief 9

| Function | Key | Callers |
|---|---|---|
| `customerReads.getCupboardCoffee(uid)` | sign-in id | `usualDrink.test.ts` only (7 calls) |
| `customerReads.getCoffeeFeeling(uid)` | sign-in id | `usualDrink.test.ts` only (7 calls) |
| `customerReads.getCupboardCoffeeByProfile(profileId)` | profile id | `matchService.steps` |
| `customerReads.getCoffeeFeelingByProfile(profileId)` | profile id | `matchService.steps` |

**Proposed:** one function per lookup, `getCupboardCoffee(key: { uid } | { profileId }, runner)` and `getCoffeeFeeling(key, runner)`. Each returns today's full row (`CupboardCoffeeRow`, `CoffeeFeelingRow`).
- The key resolves through the two existing helpers (`resolveCanonicalUserId`, `canonicalOfProfile`).
- `matchService` passes `{ profileId }`, and the tests pass `{ uid }`.
- The two `…ByProfile` functions are removed, along with their import in `matchService`.

`getBrewDecafByProfile` has no sign-in-id twin, so it is not a duplicate.

### Item 4: direct table reads in the seed scripts

- **`ellaMapReasons_2026_11_20.ts`:**
  - `dial_said_back` → `v_dial_said_back WHERE is_current`
  - `dial_start_rule` → `v_dial_start_rule WHERE is_current`
  - `dial_step` → `v_dial_step WHERE is_current AND is_shown`
  - quiz content and brew values (`quiz_answer`, `quiz_question`, `quiz`, `brew_profile_field_value`) → `v_dial_said_back_fact`, which lists exactly these facts
  - `coffees` → `v_coffee WHERE is_active`
  - The schema probe (`information_schema`) stays.
- **`ellaMapDecided_2026_11_16.ts`:** `dial_step` (2 reads) → `v_dial_step WHERE is_current`. **Needs your call:** this one-off script, already run on prod, also reads 9 other base tables directly: `coffee_archetype_assignment`, `coffee_lean_assignment`, `coffee_ring_assignment`, `coffees`, `dial_first_match`, `dial_lane`, `dial_wedge`, `dial_first_match_status`, `roaster`. I propose changing only the `dial_step` reads, as the brief names, and listing the rest in OPEN_TASKS.
- **The new seed `ellaMapReasonsRev2_2026_11_23.ts`** reads only views.

### Item 5: Data 1 and Data 2 beside production

- **Data 1:** all 22 quiz answer codes are current answers of the active quizzes on prod, and all 3 feelings (bolder, gentler, different) are active brew values.
  - The fourth feeling value, `happy` ("I'm happy with it"), has no row in Data 1 or today, so it is never used. No call needed.
  - `v7_q1_b` stays as it is (`is_quoted` false, phrase kept); the seed leaves that row alone.
- **Data 2:** the 18 coffees are exactly the 18 placements on prod, under their map names: Benchmark, Half Moon, Brazil, The Daily, Fabricator, Tiger Stripe, Blossom, The Waverly, Nightcap Decaf, Amsterdam, Great Heights, Big City, Indonesia, Geometric, La Familia, D.R. Congo, Cafè Feminista, The Village.
- **Indonesia:**
  - The roaster's notes (`flavor_descriptors_roaster`): "Dark Chocolate, Apricot, Caramel, Raisin, Cedar".
  - **Proposed `map_line`, from those words only:** "Dark chocolate, apricot and caramel, with raisin and cedar." **Needs your yes.**

### Item 6: what stops being read

The design's list is confirmed, with these readers today:

| Stops being read | Reader today | After this brief |
|---|---|---|
| copy `told_us_two`, `told_us_one`, `also_said`, `asked_for`, `step_away`, `step_against` | `matchService.steps`; `dataCatalogIntegrity` lists them as expected seed rows | Rows stay. They drop off the integrity check's expected-seed list, so nothing asks for rows no one reads. |
| `dial_step.when_line` | `matchService.steps`, `dialReads.steps` / `stepsFrom`, the admin step editor (`AdminEllaMap.tsx`), `setStepInTx` | Column stays, written by nothing new. **Proposed:** the admin step editor stops showing it, and `stepsFrom` stops selecting it. |
| `dial_start_rule.lead_quote_family_code` | `matchService.steps`, the admin rule editor, `setStartRuleInTx`, `dialReads` | Column stays (NULL on all 9 rules). **Proposed:** the admin rule editor stops showing it. |
| parameter `dial_away_max_points` | `matchService.steps`, the integrity seed list | Row stays and drops off the seed list. |
| parameter `dial_quote_other_answers` (B2: the rule-condition sentence replaces it) | `matchService.steps`, the integrity seed list | Row stays and drops off the seed list. |

**Also no longer read, beyond the design's list:**
- **`dial_move.opposite_move_id` and `dialReads.moveOpposites`:** their only use was `step_against`.
- **`dial_start_rule.customer_reason`:** it remains the trail page's sentence (`me()` → `firstBagReason`) and an admin field, but it is no longer a `/map` fallback. **Needs your call:** for a first match with no usable answers (a quiz taken by someone else, or an old session with no stored answer ids), the design's rules give the coffee sentence alone. Brief 9 gave the rule's `customer_reason`. That reason is a customer sentence plus a coffee sentence ("You like a stronger cup with a little lift, and you make espresso. This one was built for it."), so it fits the new layout. **I recommend keeping it** as the top card's text when no answer is usable and the rule names the coffee.

All of these are listed in OPEN_TASKS for a later decision; nothing is dropped.

### Item 7: the five pages, written by hand from the rules

**How I applied the rules**
- **Answer order:** the branch answer first, then the heavier question, then the question number. A quiz taken by someone else, the treat question and a never-quoted row are not used.
- **The customer's family** is the family read plus the family the quiz branched from. A destination's family includes the family it branches from.
- **Step order:** as shown today (basis, then button word, then name).
- **A tie among setup-direction steps:** the rule's lead if it is one of them, otherwise the first in step order. This is brief 9's tie rule.
- **Each answer is used once:** the top card, then the lead, then the other steps in order.
- **Coffee lines:** a step's coffee sentence is its `customer_line`, otherwise the destination's `map_line`.
- **The rule's lead card** carries only the rule's `lead_line`, as in the design's examples. The top card is its customer part, so that card is one sentence, not two.

**Your account (Tiger Stripe; first match by the reading in item 2; no rule names Tiger Stripe; feeling `different`)**
- **Founder's pick, Tiger Stripe:** "Coffee should feel like a reward for you: warm, rich, comforting. A little bitterness tastes serious to you. Chocolate first, with a little lift. Built for espresso." (same as the design)
- **Lead, Geometric (your setup answer):** "You'd like a change from what you drink now. More fruit, and sweeter." **Differs from the design.**
  - The design leads with Blossom by strongest support, but the lead order puts the setup answer first.
  - Your feeling is `different`, and two steps from Tiger Stripe go that way: Geometric and The Waverly. Geometric is first in step order.
- **Blossom:** "For you, a good cup is strong and satisfying. A darker roast with a fuller body." (the design's lead text, now on a plain step)
- **The Waverly:** "Coffee is a daily ritual for you, and you're particular about it. Fig and orange over dark chocolate." (same as the design)
- **If you want the design's page:** move "strongest support" ahead of "setup answer" in the lead order. That is a row order on `/admin/map`, not code. Or confirm Geometric.

**Person 85 (La Familia, rule #10 `fruity_gt_cn`, quiz only): same as the design on every card**
- **Founder's pick:** "You'd rather have something gentler. For you, a good cup is smooth and easy the whole way. You're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end."
- **Lead, The Village:** "A little further the same way: just as light, with more flower and citrus in it."
- **Benchmark:** "Too bitter is what would bother you most. Pure chocolate, rounder, less fruit."
- **Geometric:** "Your answers point elsewhere. Bright fruit over caramel, with more weight."

**Person 33 (The Daily, rule #14 `always`, quiz only): same as the design on every card**
- **Founder's pick:** "A little bitterness tastes serious to you. A coffee with no bitterness would bother you. This is chocolate with some strength: our everyday cup."
- **Lead, Amsterdam:** "The next size up in strength: darker and smoother."
- **Benchmark:** "For you, a good cup is smooth and easy the whole way. Rounder, pure chocolate."
- 33's `v7_q1_b` is never quoted, so their second Balanced answer is not used.

**Person 23 (Geometric, rule #16 `cn_gt_zero`, quiz only): the design has no worked page**
- **Founder's pick:** "Bitter coffee tastes burnt to you. For you, a good cup feels alive and changes as you drink it. Coffee is a daily ritual for you, and you're particular about it. So: bright fruit, with caramel under it to make it an everyday cup."
- **Lead, La Familia:** "Lighter and sweeter: caramel, honey, a little clementine."
- **Fabricator:** "A cup where every sip tastes the same would bother you. Drier and nuttier." **Flag: this pairing reads loosely.** Fabricator is "different"; the answer argues for "different" but not toward less fruit. It is the design's "Known limits" case. The fix is a row edit, or switching off "direction" for this kind.
- **Tiger Stripe:** "Your answers point elsewhere. More chocolate and body."
- **D.R. Congo:** "With a black coffee, your first thought is what flavors are in it. Clementine and nectarine over caramel and light chocolate." The step has no line, so its `map_line` is used.

**Person 81 (Benchmark, first match from L0 with no `rule_id`; the live rule #11 names Benchmark; kitchen Counter Culture; feeling gentler): same as the design on every card**
- **Founder's pick:** "You have Counter Culture Coffee in your kitchen. Too bitter is what would bother you most. You smooth a black coffee before you try it. This is the cup where nothing sticks out, and it works however you make it."
- **Lead, La Familia (setup answer):** "You'd like something gentler than what you drink now. Caramel and honey with a little clementine. Lighter in the cup."
- **The Daily:** "A little bitterness tastes serious to you. The same chocolate, livelier, with a bit more bite."
- **Fabricator:** "For you, a good cup feels alive and changes as you drink it. Hazelnut, a little citrus, a dry finish."

**The top card after a step, as I would build it:** up to two unused answers for the position coffee's family (including its branch parent), in the answer order, then the coffee's `map_line`. If no answer fits, the `map_line` alone.

**For acceptance:** the test DB has your profile, but with an older quiz session and no trail. Acceptance would use a marked test account with your production answers, setup answers and trail: a `quiz_result` on Tiger Stripe with no `rule_id`, then a `stay`.

### Calls needed before Part A

1. Approve the new objects: `dial_reason_choice_kind`, `dial_reason_choice`, `v_dial_reason_choice`, `dialReads.reasonChoices`, and `dialPlacementService.setReasonChoiceInTx` (supersede and insert).
2. The branch-parent family as `dial_wedge.branches_from_code` (earthy → chocolate_nutty, floral → fruity), carried through `v_dial_placement`.
3. "First match" read as: the coffee of the latest `quiz_result`, and no decision since then picked another coffee. "Same again" keeps "Founder's pick".
4. Your page's lead: Geometric (setup answer first, as the design's lead order says), or reorder so strongest support comes first (Blossom).
5. Indonesia's `map_line`: "Dark chocolate, apricot and caramel, with raisin and cedar."
6. With no usable answers, keep the rule's `customer_reason` as the top card text (recommended), or show the coffee sentence alone.
7. `ellaMapDecided_2026_11_16.ts`: only its `dial_step` reads move to `v_dial_step`; the other 9 direct reads go to OPEN_TASKS.
8. The admin editors stop showing `when_line` and the lead quote family. The columns stay.

## Dana's calls (2026-11-24)

1. **Approved new objects:**
   - tables `dial_reason_choice_kind`, `dial_reason_choice`;
   - view `v_dial_reason_choice`;
   - reader `dialReads.reasonChoices`;
   - writer `dialPlacementService.setReasonChoiceInTx`.
2. **Branch parent:** `dial_wedge.branches_from_code`, carried through `v_dial_placement`; an OPEN_TASKS line for the hard-coded mapping in `quizScoring` (OT-166).
3. **First match** as proposed; "Same again" keeps "Founder's pick".
4. **Lead order and ties:**
   - The lead order stays: setup answer, start rule, strongest support.
   - Among several steps in the setup direction, the strongest quiz support wins (step-card order), then the rule's lead, then step order. So Dana's page leads with The Waverly.
5. **Indonesia:** "Dark chocolate, apricot and caramel, with raisin and cedar."
6. **No usable answer:** `customer_reason`, when the rule names the coffee.
7. **`ellaMapDecided_2026_11_16.ts`:** only its `dial_step` reads move; the other nine are OT-167.
8. **Admin editors:** they no longer show `when_line` or the lead quote family.
9. **Direction kind:** "direction" stays switched on.
10. **Guardrails:** Dana's G3.9 amendment in `DEVELOPMENT_GUARDRAILS.md` is committed with this brief.

## Parts A to D (test DB, 2026-11-24)

### A. Schema

Everything is additive and idempotent, with `comments.sql` lines for each change.

- **A1:** `dial_said_back.move_id`, carried through `v_dial_said_back` and `v_dial_said_back_fact`.
- **A2:** `coffees.map_line` (not blank, check `coffees_map_line_not_blank`), carried through `v_coffee` (appended last) and `v_dial_coffee_availability`.
- **A3:**
  - `dial_reason_choice_kind` (step_support, lead_source);
  - `dial_reason_choice` (supersede and insert, one current row per kind and code);
  - `v_dial_reason_choice`;
  - request-pool grants: no UPDATE except `superseded_at`.
- **A4:** `dial_start_condition.family_code`, set once (fruity_gt_cn and fruity_gt_balanced → fruity, cn_gt_zero → chocolate_nutty), carried through `v_dial_start_rule` and `v_dial_start` as `condition_family_code` and `also_condition_family_code`.
- **A5:** the copy row `no_support`, "Your answers point elsewhere." (inserted if missing).
- **A6:** `dial_wedge.branches_from_code`, set once (earthy → chocolate_nutty, floral → fruity), carried through `v_dial_placement` as `family_branches_from_code`.
- **A7:**
  - data-catalog check 15: a reason-choice code the service does not know (`matchService.KNOWN_REASON_CHOICES`);
  - check 16: a coffee on the active map with no `map_line`.
  - A quoted phrase with no direction is fine.
  - The expected-seed list drops the six retired copy frames and adds `no_support` and the two reason-choice kinds. The two retired parameters stay on the parameter list because their rows still exist.

### B. Backend

**B1, writers (reused, plus one new):**
- `setSaidBackInTx` takes `moveCode` (a customer move; undefined keeps the current value).
- `catalogService.updateCoffeeInTx` takes `mapLine` (no roaster name, at most 200 characters), passed by `PATCH /api/admin/catalog/coffees/:id`.
- New: `setReasonChoiceInTx` (order, switch, label; supersede and insert; never deletes).

**B2, `matchService.steps`:** brief 9's composition is replaced in place, and the response keeps its shape.
- `firstBag` is the top card whenever there is a quiz, with a new `labelCode`. Basis (admins only) gains `choice`.
- **First match:** `firstMatchDecision` reads the trail through `getMatchTrail`. `ruleForDecision` is brief 9's `firstBagRule`, now keyed by the quiz decision; it still serves `me()` through `firstBagReason`.
- **Step support and lead sources:** dispatched in row order from `dialReads.reasonChoices`. An unknown code is skipped.
- **Each fact used once:** the top card first, then the lead, then the other steps in shown order.
- **The step's coffee sentence:** its `customer_line`, else the destination's `map_line`, else its notes.
- **No longer read by the composition:** `when_line`, the brief 9 frames, `lead_quote_family_code`, `dial_away_max_points`, `dial_quote_other_answers`, `moveOpposites` (OT-165).

**B3, one function per lookup:** `customerReads.getCupboardCoffee` and `getCoffeeFeeling` take `{ uid }` or `{ profileId }`. The `…ByProfile` copies are removed, and `usualDrink.test.ts` now passes `{ uid }`.

**Item 4, seed scripts read through views:**
- **`ellaMapReasons_2026_11_20.ts`** reads `v_dial_said_back`, `v_dial_said_back_fact`, `v_dial_start_rule`, `v_dial_step` and `v_coffee`. It now needs the map 9 schema, and it no longer writes back a Data 1 phrase that has changed since. Without that guard, a rerun would revert the Rev 2 sentences.
- **`ellaMapDecided_2026_11_16.ts`:** its two `dial_step` reads now go through `v_dial_step`.

**B4, admin routes:** `GET` and `PUT /api/admin/map/reason-choices`. `PUT /said-back` takes `move`. `reasons?profileId=` works unchanged on the new composition.

### C. Frontend

**C1, `/map`:** the top card shows its label (Founder's pick / You are here, from the copy row its `labelCode` names) and its text whenever there is a quiz. With no quiz, it shows the notes as before. "Add my first bag" shows only before any bag. A step card is the name, its text and the price chip.

**C2, `/admin/map`:**
- "What we say back" gets an "Argues for" picker per row; the options are the customer moves from the API.
- The coffee card edits `map_line`.
- New card "5. How a card is chosen", with Up, Down and On per row.
- The rule editor no longer shows the lead quote family, and the step editor no longer shows `when_line`. Neither is sent, so the stored values stay.

### D. Tests

- **`dialMap10.test.ts`:** 11 of 11 pass.
  - **Pages pinned word for word:** Dana's account and persons 85, 33, 23 and 81, with no brief 9 frame or `when_line` in any text and each answer used once per page.
  - **Top card in every state:** first match by the rule, "Same again", after a step, and no quiz.
  - **Fallbacks:** `customer_reason` with no usable answer; a proxy quiz and a never-quoted row are not used.
  - **Choices as data:** support kinds in order, switched off and reordered, all off giving `no_support`; lead sources in order and each switched off, all off giving no lead; an unknown code skipped and reported by check 15.
  - **Writers:** `setReasonChoiceInTx` supersedes and never deletes; `setSaidBackInTx` takes a direction; `updateCoffeeInTx` takes a map line and refuses the roaster's name; check 16 reports a missing map line.
  - **Lookups:** the folded lookups return the same row by either key.
- **`dialMap9.test.ts`:** 16 of 16 pass. The tests that pinned brief 9's frames were moved to Rev 2:
  - two sentences, no frame;
  - the condition's answer instead of "You also said";
  - `no_support` instead of `step_away`;
  - the feeling sentence instead of `asked_for`;
  - person 81's Rev 2 page.

  The Earthy fixture now stores `branchedFrom` like a real Earthy session, because its Chocolate & Nutty answer used to arrive only through "You also said".
- **`dialMap7.test.ts`:** the step test now expects "You are here" after a step.
- **Targeted run of 13 files:**
  - The dialMap 1/5/7/8/9/10 tests, `matchService`, `mapAdmin`, `dataCatalogIntegrity`, `usualDrink`, `catalogService`, `admin.catalog` and `cartResolver`: 157 pass, 5 fail.
  - The `mapAdmin` parameters failure was mine; I put the two keys back, and `mapAdmin` plus `dataCatalogIntegrity` then passed 6 of 6.
  - Three `dialMap7` tests fail because brief 11 changed rule chocolate_nutty #3 on the test DB today (OT-169, below).
  - One `catalogService` test fails on test-DB slot data ("Priority 2 is already taken on slot 23"). It is in `placeCoffee`, which this brief does not touch. I did not rerun it on the code from before this brief.
- **Not run:** the full suite (114 files; too slow last time).
- **Checks:** `tsc --noEmit` is clean for the backend; the frontend has its 7 errors from before. All six lints pass.

### Test-DB seed (`ellaMapReasonsRev2_2026_11_23.ts`)

- **Apply:** 48 rows: 24 sentences with directions, 18 `map_line`s and 6 choices. The copy row was already there from the schema.
- **Second run:** 0 writes.
- **No publish:** said-back rows, map lines and choice rows are not versioned.
- **`v7_q1_b`:** stays never quoted (unchanged).
- **The brief 9 script, rerun as a dry run:** 0 writes and 25 skipped (its changed phrases are left alone).
- **Boot of the local backend on the test DB:** 16 checks; only #4 (CATALOG.md stale until the regeneration) and #6 (27 dead candidates, known) have findings.

### Acceptance (local, signed in as marked Zzz test admins, test DB)

- **Fixtures:** `tmp/em10_admin.mts`: "dana" has Dana's production answers, setup feeling "different", and an L0-style `quiz_result` on Tiger Stripe with no `rule_id`, then "Same again". "p81" is person 81, decided through the quiz door.
- **`/map`, Dana's shape:** Founder's pick, Tiger Stripe. Lead The Waverly, then Blossom, then Geometric "Your answers point elsewhere." Screenshot `map10_customer_dana.png`.
- **`/map`, person 81:** Founder's pick, Benchmark, with the kitchen sentence. Lead La Familia. Screenshot `map10_customer_p81.png`.
- **Checks on the page:** no page errors. No roaster name, "explore", "confidence", "You told us", "You also said", "You asked for", "If you want", "See it" or "Make it my next bag" anywhere.
- **"How a card is chosen"** (screenshot `map10_admin_how_chosen.png`), each change read back in "Read it as" on the next read:

  | Change | "Read it as" after it |
  |---|---|
  | Setup answer switched off | Blossom leads; Geometric gets the feeling sentence; The Waverly gets "Coffee is a daily ritual…" |
  | "Family" moved up | Blossom opens with "Coffee is a daily ritual…" |
  | Strongest support moved to the top | Blossom leads |
  | Everything put back | Dana's page again |

- **"What we say back":** v7_q1_a's direction set to Bolder, then back to none; v7_q2_b's never-quote switch on, then off. Screenshot `map10_admin_said_back.png`.
- **The coffee card's `map_line`:** Brazil edited, then put back. On the first attempt the restore did not click because my script did not wait for the reload. The seed put the line back, and the rerun then edited and restored it through the UI.
- **The rule editor:** no lead-quote control. Full page screenshot `map10_admin_full.png`.
- **Afterwards:** the seed's dry run writes 0, every choice is on in its order, v7_q2_b is quoted, and every `dial_surface` row is `lane`. The Zzz admins are demoted and disabled. Both local servers are stopped and their ports checked free. Brief 9's servers had been left running since 2026-11-20; they are stopped now too.

### Another session ran brief 11 on the test DB today

`ellaMapTigerStart_2026_11_24` superseded rule chocolate_nutty #3 on the test DB (Fabricator → Tiger Stripe, 15:53 UTC, before this brief's Part A). `CLOSING_REPORT_11.md` says it stopped before its production apply. It changed no code that this brief touches.

**Effects:**
- Three `dialMap7` tests now fail on the test DB (OT-169).
- After brief 11's production apply, a Chocolate & Nutty customer with Fruity above Balanced starts on Tiger Stripe, and their top card uses rule #3's new lines.

The five pages below do not depend on that rule.

### Production dry run (read only, 2026-11-24)

**49 write, 0 skipped:** 24 sentences, 18 `map_line`s, 6 choices and 1 copy row. The Ella map 10 schema is not on production yet, so directions, `map_line` and the choice rows read as empty; after the deploy the copy row exists and the count is 48. Full output: `backend/tmp/em10_dry_prod.md`.

## STOP before Part E (production)

**On Dana's yes:**
1. Commit by path, including Dana's `DEVELOPMENT_GUARDRAILS.md`, and push (deploy). Check the startup log.
2. On production: dry run, then `--apply --expect-db axisandbloom`. A second run writes nothing.
3. Read the five pages on production.
4. `npm run catalog:md -- --expect-db axisandbloom`, then commit `CATALOG.md` and the run record.
