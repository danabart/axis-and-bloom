# Ella's Bloom Map 9: closing report (personal reasons on `/map`)

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_9_PERSONAL_REASONS.md`. Run started 2026-11-20.

**Status (2026-11-20): Task 0 done; Dana's yes with her calls; Parts A to D done on the test DB. STOPPED before the Part E production seed.** Nothing written to production; nothing committed or pushed. The production dry run is below.

Task 0 queries ran in a `BEGIN READ ONLY` transaction through `backend/tmp/md.mjs` (test DB and production via the proxy on 5433). Helper SQL: `backend/tmp/em9_t0a.sql` to `em9_t0e.sql` (gitignored).

Read first: `DEVELOPMENT_GUARDRAILS.md`, `CATALOG.md` (the `dial_*`, `quiz_*`, `brew_*` and `v_customer_*` entries), the brief in full.

---

## Task 0 findings

### 1. Answers per session

- Main-quiz answers live in `quiz_session.context_data -> 'answerIds'` (a JSON array of `quiz_answer.id`). The branch answer is only in `quiz_session.branch_answer_id`; it is **never** in `answerIds` (0 of 15 sessions with a branch answer on prod).
- **No view gives one row per session × answer.** `v_dial_start_input` reads only `context_data -> 'scores'`; `v_customer_quiz_current` carries only `branch_answer_code`. Nothing unnests `answerIds`.
- The branch answers score nothing: they have no `quiz_answer_archetype_score` row with a non-zero score. Their family comes from the branch quiz (`quiz.trigger_archetype_id`) and the result, not from scores (see correction C1).
- **Proposed `v_dial_quiz_answer`** (A6): one row per current session (`v_customer_quiz_current`) × answer picked (the `answerIds` elements plus `branch_answer_id`). Columns: `quiz_session_id`, `canonical_user_id`, `is_self_taken` (`taken_by_user_id IS NULL`), `answer_id`, `answer_code`, `is_branch`, `q_number`, `weight` (question weight × answer weight), `family_code` (the family the answer scored for; for the branch answer, the session's result family), `points`.
- **Production counts (current results, `v_customer_quiz_current`):** 99 current results. 80 have stored answers, 19 do not (all completed before 2026-08-14). 1 was taken by proxy. **79 are quotable** (self-taken, with stored answers). 10 have a branch answer. Every stored answer id resolves to a current `v7_*` answer.
- Test DB: 508 current results, 82 with answers, 134 by proxy (test fixtures), 81 quotable.

### 2. `answer_code` among current answers

- Unique among current rows: yes. 52 current rows with a NULL code all belong to inactive quizzes. The active v7 main quiz and its three branches have 0 NULL codes. Test DB and prod are the same.
- Active codes: `v7_q1_a..c`, `v7_q2_a..c`, `v7_q3_a..c`, `v7_q4_a..c`, `v7_q5_a..c`, `v7_q6_a..c` (Q6 has question weight 0), `v7_branch_bal_cozy|fruit|floral` (quiz `v7-branch-balanced`, trigger Balanced), `v7_branch_cn_stay|earthy` (quiz `v7-branch-earthy`, trigger Chocolate & Nutty), `v7_branch_fruity_stay|floral` (quiz `v7-branch-floral`, trigger Fruity).
- **Data 1 names no code that does not exist, and misses no current code other than Q6.** The feeling codes `bolder`, `gentler`, `different` exist as `brew_profile_field_value.code` (field `coffee_feeling`); `happy` maps to move `stay` and gets no row, as Data 1 says.
- The phrases fit the answer texts. Q2's question is "what made it good?", so "a good cup is …" reads correctly.

### 3. Start rules and shown steps on production

- **Start rules:** 9 current rows, ids 1 to 9, all written by `script:ellaMapStartRules_2026_11_17` on 2026-11-17. **0 superseded rows**, so no rule has been edited since. Each coffee and condition matches Data 2. Every Data 2 lead is a current shown step from the rule's coffee.
- **Steps:** 36 current rows, all shown and all on the active map. The last write was 2026-11-17 15:16 UTC, so no step has changed since brief 7. The test DB matches prod (md5 of every rule reason and step line).
- **Data 3 covers 22 of the 36.** Correction C6: it misses **Geometric → D.R. Congo** (step 34, "Lighter", no line), which leaves a start coffee. The other 13 uncovered steps leave coffees that are not first bags. All 14 are proposed in the table below.
- 97 of 99 prod quiz results have **no map position**. See C8.

### 4. `dial_move` opposites

There is no way to say bolder and gentler are opposites. Moves are `quiz_result, stay, bolder, gentler, different, liam, sibling, step` (ids 1 to 7 and 232). **Proposed A5:** `dial_move.opposite_move_id` (nullable self-reference), seeded bolder ↔ gentler. `different` has no opposite.

### 5. Setup facts

- `v_customer_cupboard_coffee`: one row per canonical customer with `code`, `label` (the listed brand's label), `brand_kind`, `roaster_id` and `customer_words` (the words on the "other" row). The label is the list's label, never the free words. Read by `customerReads.getCupboardCoffee(uid)`.
- `v_customer_coffee_feeling`: one row per canonical customer with `code`, `label`, `move_code` (via `brew_coffee_feeling` → `dial_move`). Read by `customerReads.getCoffeeFeeling(uid)`.
- Both readers take a **Firebase uid**. `matchService.steps` has a profile id. I will add a profile-id variant beside them (the same view and SELECT), the same pattern as `getBrewDecafByProfile`.
- On prod, one customer has a brand (Counter Culture, person 81) and two have a feeling (gentler, different).
- **The list holds values that are not brands** (correction C5): `dont_know`, `nothing`, `pods_unknown`, `other`, `store_brand` ("Another supermarket's own brand"), `local_roaster` ("A local roaster not on this list"). It also holds **our partner roasters' own names** (`joe_bean`, `joe_coffee`; the two active roasters are Joe Bean Roasters and Joe Coffee Company), and `brew_cupboard_brand.roaster_id` is NULL on every row. "You have {brand} in your kitchen." would read wrong for the first group and would name a roaster for the second (G4.5).

### 6. Where a non-versioned map number lives

`evidence_parameter` (key, value, `superseded_at`, note with a Range), read with `param('<key>')`. This is the precedent of `dial_earthy_branch_reworded_on`, listed in `dataCatalogIntegrity.ts`. Proposed keys: `dial_quote_family_answers` = 2, `dial_quote_other_answers` = 1, and `dial_away_max_points` = 0 or 1 (C3).

### 7. The page with nothing known

- `matchService.steps` returns `position: null` with no steps for any customer with no `customer_match_decision`. `MapPage.tsx` then renders an empty `<main data-testid="map-empty">`.
- A position that came from a pick (`move_code` ≠ `quiz_result`) gets `hasBag: true`, `firstBag: null`, and shows "You are here", the coffee's notes and the steps.
- **Prod: only 2 customers have a position.** One is `quiz_result` (person 81, Benchmark). One is `stay` (that customer also has a quiz). No customer has a position without a quiz. The other 97 quiz results have no position (OT-124, no backfill yet), so `/map` is blank for them today.

### 8. Proposed `move` and `when_line` for the steps Data 3 does not cover

All marked **proposed**, in the Data 3 voice. `customer_line` stays as it is.

| step id | from → to | button word (today) | customer_line (today) | move (proposed) | when_line (proposed) |
|---|---|---|---|---|---|
| 34 | Geometric → D.R. Congo | Lighter | (none: notes) | gentler | If you want it softer, with more citrus. |
| 26 | Big City → Great Heights | Lighter | Less smoke, more fudge. | gentler | If you want less smoke. |
| 25 | Great Heights → Big City | Bolder | French roast and burnt sugar. | bolder | If you want it darker still. |
| 24 | Great Heights → Amsterdam | Lighter | A lighter roast, with more caramel. | gentler | If you want it lighter. |
| 13 | Blossom → Tiger Stripe | Brighter | A lighter roast with more fruit. | gentler | If you want a lighter roast. |
| 30 | Blossom → Brazil | Lighter | Lighter, plain chocolate. | gentler | If you want it simpler. |
| 35 | Blossom → Indonesia | Earthier | (none: notes) | different | If you want it earthier. |
| 36 | Indonesia → Blossom | Cleaner | (none: notes) | different | If you want it cleaner. |
| 29 | Brazil → Blossom | Bolder | A darker roast with a fuller body. | bolder | If you want a darker roast. |
| 28 | Brazil → Fabricator | More going on | Adds citrus and spice. | different | If you want more going on. |
| 33 | D.R. Congo → Geometric | More body | (none: notes) | bolder | If you want more weight. |
| 22 | The Waverly → Tiger Stripe | Less fruit | Chocolate first, cherry behind. | different | If you want less fruit. |
| 31 | Half Moon → Nightcap Decaf | No caffeine | Almond, molasses, cola. | different | If you want no caffeine at all. |
| 32 | Nightcap Decaf → Half Moon | Half the caffeine | Walnut and toffee. | different | If you want a little caffeine back. |

---

## Corrections to the brief (for Dana's yes)

- **C1. Which answers count "for the family as read".** Branch answers score for no family. Earthy and Floral results are reached through a branch, and their main answers scored Chocolate & Nutty or Fruity. Read literally, an Earthy or Floral customer would have no family answers to quote. **Proposed:** an answer counts for the family when it scored for `family_read` or for the family the quiz branched from (`v_dial_start_input.branched_from_code`, a join, no code). The branch answer counts for the result's family and is quoted first. Today this touches no prod customer (0 Earthy readers; 2 Floral, both without a stored branch answer); the test DB has 1 Earthy with a branch answer.
- **C2. Person 85's quoted answers.** The B2 order (branch first, then weight high to low, then question number) quotes q5_b + q2_b ("you'd rather have something gentler and smoother, and a good cup is smooth and easy the whole way"). The approved example quotes q2_b + q4_b. People 33, 23 and 81 come out as in Data 4. Options: (a) keep the B2 order and accept 85's different pair; (b) add `dial_said_back.quote_rank` (a nullable number Dana sets per phrase) as the first sort key. **Recommend (a).**
- **C3. The away sentence for 85.** B2 adds `step_away` only when the customer gave **no** points to the destination's family. 85 gave Fruity 1 point (q1_c), so Geometric gets no away sentence, while Data 4 says it does. **Proposed:** parameter `dial_away_max_points` = 1 (at or below counts as "gave nothing"). Effect on the others: 23's Tiger Stripe and Fabricator cards also get it (23 gave Chocolate & Nutty 1 point); 33 and 81 are unchanged.
- **C4. The same answer can be quoted twice.** For 85, q1_c is the "also said" answer and also the lead's Fruity quote. Dana's example does this ("You also said you're still discovering coffee" … "You said you're curious"), so I keep it unless told otherwise.
- **C5. Kitchen brand.** **Proposed:** quote the kitchen through `dial_said_back` like every other fact: a third source `cupboard_coffee`, `fact_code` = the value code, `says_back` = the brand as we say it. It would be seeded for the named chain, mass-market and specialty brands, except `store_brand`, `local_roaster` and the partner brands (`joe_bean`, `joe_coffee`; also `utopian`, `temecula`, `path` if Dana counts past partners). A value with no row is never quoted, and the `kitchen` copy becomes "You have {brand} in your kitchen." filled from that row. The alternative (quote any `chain`/`mass_market`/`specialty` label) would name partners and read "You have A local roaster not on this list in your kitchen."
- **C6. Data 3 misses Geometric → D.R. Congo** (proposed above).
- **C7. Two steps in the same direction.** With the Data 3 tags, Fabricator has two gentler steps (Brazil, Benchmark) and Tiger Stripe and The Village each have two different steps. **Proposed tie rule** for the feeling lead: the rule's lead when it is among them, otherwise the first in today's step order (basis, then word).
- **C8. No position for 97 of 99 prod quiz results.** The composition sits inside `steps()`, which needs a position, so for these customers `/map` stays blank whatever we write. "Read it as" for people 85, 33 and 23 would also show nothing, on prod and on the test DB. Options: (a) when a customer has a self-taken quiz and no decision, `steps()` and the preview read the session's winning rule from `v_dial_start` as a read-only position (nothing written; the first write is still the quiz door or the chip); (b) do the OT-124 backfill first (brief 4's job). **Recommend (a)** for the preview only, leaving the customer page as it is until brief 4. Dana's call.
- **C9. Person 81 is not on the test DB** (the copy predates 2026-11-14). People 85, 33 and 23 are there with the same answers. For acceptance, Part D adds a test fixture with 81's answers, kitchen and feeling.
- **C10. Readers take a uid** (item 5): I will add profile-id variants in `customerReads`, reusing the views.

---

## Data 1: as it would be written (`dial_said_back`)

Unchanged from the brief: all 25 rows, sources `quiz_answer` (22) and `coffee_feeling` (3). No Q6 row and no `happy` row. If C5 is approved, a third source `cupboard_coffee` adds one row per quotable brand (the proposed list is in C5).

## Data 2: as it would be written (rules 1 to 9 on prod)

Unchanged from the brief. Mapping to the prod rows: La Familia = rule 1 · Benchmark = 2 · Tiger Stripe = 3 · Fabricator = 4 · The Daily = 5 · Amsterdam = 6 · Geometric = 7 · Cafè Feminista = 8 · The Village = 9. Every lead is a shown step from the rule's coffee: steps 7, 5, 21, 11, 3, 23, 18, 10, 9. `lead_quote_family_code` = `fruity` on rules 1 to 4, NULL on 5 to 9.

## Data 3: as it would be written

The brief's 22 rows (step ids 1, 5, 19, 7, 17, 6, 3, 2, 11, 27, 20, 15, 21, 14, 23, 4, 18, 16, 12, 10, 9, 8) plus the 14 proposed rows above once Dana says yes, so all 36 shown steps carry a move and a `when_line`.

---

## The four people composed by hand (the brief's rules; no code exists yet)

These use C1 and C7. C2 is shown as option (a). C3 is shown at 0 (the brief as written), with the change at 1 in brackets.

- **85 (La Familia).** First bag: "You told us you'd rather have something gentler and smoother, and a good cup is smooth and easy the whole way. You also said you're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end." Lead The Village: "You told us you're still discovering coffee. This is more of that: just as light, with more flower and citrus in it." Geometric: "If you like the fruit and want more coffee under it. Bright fruit over caramel, with more weight." [at 1: + "This moves away from the answers you gave."] Benchmark: "If the fruit turns out to be more than you wanted. Pure chocolate, rounder, less fruit."
- **33 (The Daily).** "You told us a little bitterness tastes serious to you, and a coffee with no bitterness would bother you. You also said a good cup is smooth and easy the whole way. This is chocolate with some strength: our everyday cup." Lead Amsterdam: "The next size up in strength: darker and smoother." Benchmark: "If it has more bite than you wanted. Rounder, pure chocolate."
- **23 (Geometric).** "You told us bitter coffee tastes burnt to you, and a good cup feels alive and changes as you drink it. You also said coffee is a daily ritual and you're particular about it. So: bright fruit, with caramel under it to make it an everyday cup." Lead La Familia: "Lighter and sweeter: caramel, honey, a little clementine." Tiger Stripe: "If you want more weight. More chocolate and body." Fabricator: "If you want less fruit. Drier and nuttier." [at 1: both + the away sentence] D.R. Congo: "If you want it softer, with more citrus. Clementine, Nectarine, Caramel, Light Chocolate" (proposed `when_line`; no `customer_line`, so the notes).
- **81 (Benchmark, test account).** "You have Counter Culture Coffee in your kitchen. You told us too bitter is what would bother you most, and coffee is a reliable habit for you. You also said a little bitterness tastes serious to you. This is the cup where nothing sticks out, and it works however you make it." Lead La Familia (feeling gentler): "You asked for something gentler than what you drink now. Caramel and honey with a little clementine. Lighter in the cup." The Daily: "If you want more bite. The same chocolate, livelier, with a bit more bite. This goes the other way from what you asked for." Fabricator: "If you're curious. Hazelnut, a little citrus, a dry finish."

---

## Where production differs from what the brief assumes

1. Customers have no position: 97 of 99 quiz results have no match decision (C8). Only 2 positions exist on prod.
2. Person 81 is on prod only, not on the test DB (C9).
3. The branch answer is not in `answerIds`, and branch answers score no family (C1).
4. The cupboard list holds non-brand values and the partner roasters' names (C5).
5. Data 3 misses one step from a start coffee (C6).
6. Nothing else: the rules, the steps and the copy are as of 2026-11-17, with no edits since and no test/prod drift.

## Why a new table (G2.4), checked

As the brief says: `quiz_answer` (seed-written quiz content, SCD2), `dial_customer_copy` (one sentence per code, which would hide the mapping in code names), `brew_profile_field_value` / `brew_coffee_feeling` / `brew_cupboard_brand` (seed and owner SQL, no app writer). None fits, so `dial_said_back` plus its source lookup.

## Next

On Dana's yes (with her answers to C1 to C9): Parts A to D on the test DB in one run, one report, then STOP before the Part E production seed.

---

## Dana's calls at the Task 0 STOP (2026-11-20)

C1 yes (the family it scored for or the family the quiz branched from; branch answer first). C2: keep the brief's order, no rank column; `v7_q5_b` becomes "you'd rather have something gentler". C3 yes: `dial_away_max_points` = 1, a parameter. C5 yes: a kitchen brand is quoted only with its own said-back row; one row per listed real brand that is not a partner roaster, with its label as it is; none for the partners, "Nothing right now", "I don't know", "A local roaster not on this list". C7, C9, C10 yes. C8: "Read it as" reads the start rule's first bag as the position and writes nothing; no backfill; the customer page stays as it is. Yes to `dial_move.opposite_move_id` and to `evidence_parameter` for the counts. The 14 proposed steps yes, with two changes: Half Moon <-> Nightcap Decaf get no move (keep their `when_line`); Geometric -> D.R. Congo keeps "with more citrus" only if the roaster's notes say it, otherwise "If you want it softer.". Keep person 85's repeated answer.

How the two conditional calls came out:
- **D.R. Congo:** its roaster notes are "Clementine, Nectarine, Caramel, Light Chocolate". The word "citrus" is not there, so the line is **"If you want it softer."**.
- **Kitchen brands (C5):** 48 rows: 7 chains, 18 mass-market brands (not `store_brand`, "Another supermarket's own brand"), 23 specialty roasters. Not quoted: `nothing`, `dont_know`, `local_roaster` (Dana's three), `pods_unknown` ("Pods, not sure of the brand") and `other` ("Something else"), which are not brands, and every roaster we have a row for: `joe_bean`, `joe_coffee` (active) and `utopian`, `temecula`, `path` (past partners). Say if the three past partners should be quoted.

---

## Parts A to D (test DB)

### A. Schema (`schema.sql`, `comments.sql`; additive, idempotent)

- `dial_said_back_source` (lookup: `quiz_answer`, `coffee_feeling`, `cupboard_coffee`; `brew_field_code` names the brew field whose values are the facts, so no field code sits in code) and `dial_said_back` (supersede and insert, one current row per (source, fact), request pool may UPDATE `superseded_at` only). Views `v_dial_said_back` (the read path) and `v_dial_said_back_fact` (every fact the map could say back with its phrase: the admin table and checks 12, 13).
- `v_dial_quiz_answer` (A6): one row per current session x answer (answerIds plus the branch answer), self-taken, question number, weight, family (C1: the branch answer counts for the result family), points.
- `dial_start_rule.coffee_line`, `lead_to_coffee_id`, `lead_line`, `lead_quote_family_code` (through `v_dial_start_rule`, `v_dial_start`; `v_dial_start` also carries `branched_from_code`). `dial_step.move_id`, `when_line` (through `v_dial_step`). `dial_move.opposite_move_id`, set once for bolder <-> gentler.
- 11 `dial_customer_copy` rows (A7), and `evidence_parameter` `dial_quote_family_answers` 2, `dial_quote_other_answers` 1, `dial_away_max_points` 1.
- Integrity checks 12 (a phrase for no current fact), 13 (a quotable answer of the active quiz with no phrase), 14 (a start rule's lead off the steps), report only. The seed, copy and parameter lists of checks 9 and 10 gain the new codes.
- **G2.4:** the brief's `dial_said_back` reasoning stands. `v_dial_said_back_fact` is one view beyond the brief: the admin table and two integrity checks need the same "every quotable fact" list, and one view is one read path instead of the same SQL in two places.

### B. Backend

- **Writers (`dialPlacementService`):** `setSaidBackInTx` (new; a null phrase supersedes with no successor, nothing deleted; a phrase must name a fact `v_dial_said_back_fact` lists). `setStartRuleInTx` and `setStepInTx` take the new fields; a field left out keeps the current value, so the brief 5 and 7 scripts and the admin are unaffected. **Deviation:** a rule whose coffee changes with no lead named drops its lead (the superseded row keeps it), because the lead must be a step from the new coffee; the map 7 test that changes a rule's coffee caught this.
- **`matchService.steps`** composes as the brief says, plus C1 and C7. The answers come from `dialReads.quizAnswers`, the phrases from `dialReads.saidBack`, the kitchen and feeling from `customerReads.getCupboardCoffeeByProfile` / `getCoffeeFeelingByProfile` (C10), opposites from `dialReads.moveOpposites`, and the numbers from `getParameters('dial_')`. No family, answer or move code and no coffee id sits in the service: every comparison is a join on rows. `basis` (rule id, step id, copy codes, said-back ids, fact codes) is added only with `withBasis`: `/api/map/steps` passes it for admins. `readAsRule` (C8) reads the session's winning start rule as the position when there is no decision, read only.
- **Routes:** `/api/admin/map` gains `GET /said-back`, `GET /said-back/history`, `PUT /said-back`, `GET /customers?q=` (the "Read it as" search by email, admin only) and `GET /reasons?profileId=` (B3). `PUT /start-rules` and `PUT /steps` take the new fields.
- **Deviation (Publish):** a step's move and `when_line` travel with the step row, like its `customer_line` (the admin already says "Publish to put it on the map" for a step change). So the seed's step writes reach `/map` only through Publish. The script publishes in the same transaction (`--publish "<label>"`) and refuses, rolling everything back, if the new version's placements differ from the active one's. Start rules and phrases are not versioned and show at once.

### C. Frontend

- `/map` (`MapPage.tsx`): "Founder's pick" on the first bag with `firstBag.text`; the lead card first under "Where we'd take you next", the rest under "Or one of these" ("One step away" when there is no lead). A step card is the name, its text and the price chip ("$29.00 · 12 oz · Add"; "Choose this" when a coffee has no price), which calls today's `choose` (records the step, adds one bag). "See it", the expanded panel and the steps hint are gone. The first-bag button is unchanged.
- `/admin/map`: table 1 edits the personal line, the lead (only shown steps from the first bag are offered), the lead line and the family to quote; the steps table edits each step's move and opening; new panels "3. What we say back" (kitchen brands behind a checkbox) and "4. Read it as" (new file `AdminEllaMapReasons.tsx`).
- `npx tsc --noEmit` (frontend): the 7 known errors (ArchetypeSection, useAdjacentArchetype, Profile), none from this brief.

### D. Tests

- `src/services/dialMap9.test.ts`: **15 pass.** It covers all answers in one family; a split result (also-said); no stored answers, a proxy quiz and Q6 alone (all fall back to `customer_reason`, nothing quoted); the kitchen brand quoted, and a partner, "nothing" and the local roaster not quoted; C1 (an Earthy result quotes its branch answer, then its Chocolate & Nutty answer); a feeling with a matching step (it leads, with `asked_for`) and the opposite step's `step_against`; a feeling with no matching step (the rule's lead stays); `step_away` (85's Geometric, not Benchmark); no quiz after a step (no lead, no label, nothing quoted); "Read it as" (start rule, nothing written); person 81 word for word; a phrase edit showing on the next read; the three writers (supersede, a repeat changes nothing, clear retires, an unknown fact and a non-customer move are refused, a lead off the steps is refused); the three integrity checks firing.
- Changed to match this brief: `dialMap7.test.ts` (the step card keys gain `isLead`, `text`) and `dataCatalogIntegrity.test.ts` (14 checks, 12 to 14 clean).
- Targeted run (17 files: every map, match, integrity, comments, quiz-view, household-proxy and usual-drink suite): **224 pass, 6 fail**, all six in `quizScoring.test.ts` (the known OT-19 baseline, a pure unit test this brief does not touch). The full suite was started but stopped after 35 minutes at 11 of 114 files: DB-heavy files time out over the proxy. G1.12: not a gate; nothing in it was blocked by this brief.
- Lints: `lint:catalog`, `lint:retention`, `lint:customer`, `lint:lineage`, `lint:roastery-portal`, `lint:cupping` all exit 0; backend `tsc --noEmit` clean.
- One incident: the first local backend boot ran its schema apply while the full suite applied the schema on the same test DB, a deadlock that left views dropped. Both were stopped, `schema.sql` and `comments.sql` re-applied (118 views, all commented), and every run after that went one at a time.

### Seed on the test DB (Part E step 1)

`ellaMapReasons_2026_11_20.ts --apply --publish "L3 step directions (Ella map 9)"`: **118 rows** (73 said-back = 25 Data 1 + 48 kitchen brands; 9 start rules; 36 steps), published **version 125** with 18 placements (unchanged); a second run wrote nothing. Output: `backend/tmp/em9_apply_test.md`.

**The Brazil-to-Balanced brief ran in another session while this one worked** (test DB 20:11, prod 20:16 UTC, commits 09f6239 and ada3da4, pushed). Its commits touched only its own files. The test DB's v125 was cut after Brazil's L3 (v124), so it carries Brazil in Balanced plus the step directions; the placement check passed against it. On production the active version is now **v5 "L3 Brazil to Balanced (cupping 2026-11-20)"**, so the label there should be **L4**.

---

## Acceptance (local backend :4917 on the test DB, Vite :5174, marked Zzz test admins)

- **Read it as, the four people of Data 4 (as built):**
  - **85** (test DB, no decision: read from the start rule). First bag: "You told us you'd rather have something gentler, and a good cup is smooth and easy the whole way. You also said you're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end." Lead The Village: "You told us you're still discovering coffee. This is more of that: just as light, with more flower and citrus in it." Benchmark: "If the fruit turns out to be more than you wanted. Pure chocolate, rounder, less fruit." Geometric: "If you like the fruit and want more coffee under it. Bright fruit over caramel, with more weight. This moves away from the answers you gave." Rows: rule 211, facts v7_q5_b, v7_q2_b, v7_q1_c.
  - **33** (The Daily): "You told us a little bitterness tastes serious to you, and a coffee with no bitterness would bother you. You also said a good cup is smooth and easy the whole way. This is chocolate with some strength: our everyday cup." Lead Amsterdam: "The next size up in strength: darker and smoother." Benchmark: "If it has more bite than you wanted. Rounder, pure chocolate."
  - **23** (Geometric): "You told us bitter coffee tastes burnt to you, and a good cup feels alive and changes as you drink it. You also said coffee is a daily ritual and you're particular about it. So: bright fruit, with caramel under it to make it an everyday cup." Lead La Familia: "Lighter and sweeter: caramel, honey, a little clementine." Fabricator: "If you want less fruit. Drier and nuttier. This moves away from the answers you gave." Tiger Stripe: "If you want more weight. More chocolate and body. This moves away from the answers you gave." D.R. Congo: "If you want it softer. Clementine, Nectarine, Caramel, Light Chocolate."
  - **81** (prod only, so a test fixture with the same answers, kitchen and feeling; the Zzz admin `kitchen81` on `/map`): "You have Counter Culture Coffee in your kitchen. You told us too bitter is what would bother you most, and coffee is a reliable habit for you. You also said a little bitterness tastes serious to you. This is the cup where nothing sticks out, and it works however you make it." Lead La Familia: "You asked for something gentler than what you drink now. Caramel and honey with a little clementine. Lighter in the cup." The Daily: "If you want more bite. The same chocolate, livelier, with a bit more bite. This goes the other way from what you asked for." Fabricator: "If you're curious. Hazelnut, a little citrus, a dry finish."
- **`/map`, quiz only (Zzz `quiz85`):** the "Founder's pick" label, the paragraph above, one card under "Where we'd take you next", two under "Or one of these", no "See it" (0 elements). Screenshot `map9_customer_quiz85.png`.
- **Kitchen brand and feeling (Zzz `kitchen81`):** the paragraph opens with the brand; the lead follows the feeling. Screenshot `map9_customer_kitchen81.png`. **The price chip:** `POST /api/map/decide` 200, "In your cart.", the dot moves (Benchmark -> La Familia, then La Familia -> The Village); after a bag: "You are here", no founder label, the feeling still leads. Screenshot `map9_customer_after.png`.
- **No quiz:** the vitest case (no lead, no label, nothing quoted). On the test DB and production no customer has a position without a quiz (Task 0 item 7).
- **A proxy quiz and an old session:** both read their rule's `customer_reason` with nothing quoted ("You went for fruit all the way. …", "You like it gentle, and you are curious about something brighter. …"); their leads keep the rule's lead line.
- **A phrase edit on `/admin/map`** (`v7_q2_b`) changed the customer's text on the next read and in "Read it as"; then it was written back to the approved words (both edits are superseded rows on the test DB). Screenshots `map9_admin_said_back.png`, `map9_admin_read_it_as.png` (taken while the edit was live), `map9_admin_full.png`.
- **Words:** no roaster name, no "explore", no "confidence", no "See it", no "Make it my next bag" on any page read; no page errors.
- **Unchanged:** every `dial_surface` row is `lane`; the old Bloom page code is untouched.
- **Boot on the test DB:** 14 data-catalog checks, 2 with findings: #4 (`CATALOG.md` stale until `catalog:md` runs on prod) and #6 (the 27 known dead candidates). 12 to 14 are clean.
- The Zzz test admins were demoted to customer and disabled in Firebase afterwards; the local servers are stopped.

---

## STOP: Part E on production

**Production dry run** (`--dry-run --expect-db axisandbloom`, READ ONLY, 2026-11-20 20:42 UTC): **118 write, 0 unchanged, 0 skipped**. The Ella map 9 schema is not on production yet, so every "now" reads empty. That is 73 said-back rows, 9 start rules (each still names its Data 2 coffee) and 36 steps (every current shown step on prod; none skipped). Full table: `backend/tmp/em9_dry_prod.md`.

On Dana's yes, in one run:
1. Commit by path (the brief's files and the docs; not the genova deletions, `commerce/CLOSING_REPORT_6.md`, misc), push (= deploy, schema at boot), startup log (`[data-catalog]` 12 to 14, no ERROR).
2. Seed on production: `--dry-run` again (expect 118 write), then `--apply --publish "L4 step directions (Ella map 9)" --expect-db axisandbloom` (the publish refuses if any placement would change); a second run writes nothing.
3. Read back "Read it as" for 85, 33, 23 and 81 on production; `npm run catalog:md -- --expect-db axisandbloom`; commit `CATALOG.md` and the run record.

Open items: OT-161 (usual drink not quoted), OT-162 (the feedback level), OT-163 (97 of 99 prod quiz results have no decision, so their `/map` stays empty until the OT-124 backfill), OT-164 (retire `see_it`, `make_next_bag`, `steps_hint`, `why_this_one`).

## Part E (Dana's yes, 2026-11-20), three seed changes first

Applied on the test DB before production, through the writers:

1. `lead_quote_family_code` is NULL on all nine start rules (nothing is quoted before a lead line). The column stays.
2. Balanced, fruity above C&N (La Familia -> The Village): `lead_line` is now "A little further the same way: just as light, with more flower and citrus in it."
3. No said-back row for `v7_q1_b`. The list `DIAL_UNSAID_ON_PURPOSE` (`backend/src/services/dialSaidBackPolicy.ts`) told check 13 this was on purpose (replaced by data on 2026-11-21, see the correction below). The test DB's earlier `v7_q1_b` phrase was superseded with no successor (it stays in its history); production never had one.

Kitchen brands: Utopian, Temecula and Path stay out with the other partners (Dana).

Test DB: 5 writes (1 phrase superseded, 4 start rules), no step change so no publish; a rerun writes 0. dialMap9, dialMap7 and dataCatalogIntegrity tests 22/22 (person 81 now reads "...and you smooth a black coffee before you try it." where `v7_q1_b` was); tsc and the six lints clean.

## Part E on production (2026-11-20)

- Commit d7dcffc, pushed; Deploy run 44837138238 green; revision `axis-bloom-backend-00886-xfd`: "DB schema verified", "schema applied as axisbloom", no errors. Before the seed the boot log showed check #13 with 21 answers (v7_q1_b already left out) and #4 stale, as expected.
- Dry run: 117 write, 1 unchanged (v7_q1_b, none on purpose), 0 skipped (`backend/tmp/em9_dry_prod2.md`).
- `--apply --publish "L4 step directions (Ella map 9)" --expect-db axisandbloom`: 117 rows written (72 phrases, 9 start rules, 36 steps); published **version 6, 18 placements**, the same placements as L3. A rerun: 0 write, 118 unchanged.
- Map checks 7 to 14 on prod (read only): all clean. `npm run catalog:md -- --expect-db axisandbloom`: 229 tables, 118 views, 1957 columns, hash 3752c899… (matches the live hash in the boot log).
- Read it as on production (READ ONLY transaction; 85, 33 and 23 have no decision and read from their start rule; 81 reads from their real decision):
  - **85:** "You told us you'd rather have something gentler, and a good cup is smooth and easy the whole way. You also said you're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end." Lead The Village: "A little further the same way: just as light, with more flower and citrus in it." Benchmark: "If the fruit turns out to be more than you wanted. Pure chocolate, rounder, less fruit." Geometric: "If you like the fruit and want more coffee under it. Bright fruit over caramel, with more weight. This moves away from the answers you gave."
  - **33:** "You told us a little bitterness tastes serious to you, and a coffee with no bitterness would bother you. You also said a good cup is smooth and easy the whole way. This is chocolate with some strength: our everyday cup." Lead Amsterdam: "The next size up in strength: darker and smoother." Benchmark: "If it has more bite than you wanted. Rounder, pure chocolate."
  - **23:** "You told us bitter coffee tastes burnt to you, and a good cup feels alive and changes as you drink it. You also said coffee is a daily ritual and you're particular about it. So: bright fruit, with caramel under it to make it an everyday cup." Lead La Familia: "Lighter and sweeter: caramel, honey, a little clementine." Fabricator: "If you want less fruit. Drier and nuttier. This moves away from the answers you gave." Tiger Stripe: "If you want more weight. More chocolate and body. This moves away from the answers you gave." D.R. Congo: "If you want it softer. Clementine, Nectarine, Caramel, Light Chocolate."
  - **81:** "You have Counter Culture Coffee in your kitchen. You told us too bitter is what would bother you most, and you smooth a black coffee before you try it. You also said a little bitterness tastes serious to you. This is the cup where nothing sticks out, and it works however you make it." Lead La Familia: "You asked for something gentler than what you drink now. Caramel and honey with a little clementine. Lighter in the cup." The Daily: "If you want more bite. The same chocolate, livelier, with a bit more bite. This goes the other way from what you asked for." Fabricator: "If you're curious. Hazelnut, a little citrus, a dry finish."
- Unchanged: every `dial_surface` row is still `lane`; the old Bloom page is as it was.
