# Design: the reasons on `/map`, Rev 2

Workstream: ella_bloom_map · Written 2026-11-21 by the CTO session · **Status: design for Dana's yes. Nothing is built from this yet.** It revises what brief 9 built (`CLAUDE_CODE_PROMPT_ELLA_MAP_9_PERSONAL_REASONS.md`, live 2026-11-20).

## Why a revision

Dana looked at her own `/map` on 2026-11-21 and it was not what was agreed:

1. The top card showed "You are here" and a note list. No "Founder's pick", no reasoning.
2. The step cards said nothing about her. Brief 9 quotes quiz answers on the first-bag card only.
3. The sentences were glued from fragments: a frame ("You asked for…", "You told us…"), an opening clause ("If you want a darker roast.") and the old step line. Some pairs said the same thing twice.

Her calls, 2026-11-21:

- The top card always shows the pick and why it was chosen.
- With quiz data only, every card is backed by the customer's own quiz answers.
- No "You told us", no "You asked for". The mockup sentences are the direction.
- Answers are restated in our words, close to the quiz wording, not quoted exactly.

## The rule

Every card is two parts and nothing else:

1. **A sentence about the customer**, taken from something they answered. It stands on its own. No lead-in.
2. **A sentence about the coffee**: what it is (top card) or what changes in the cup (step card).

When no answer supports a step, part 1 is one honest sentence: "Your answers point elsewhere."

An answer is used once on a page. The top card takes its answers first, then the lead, then the other steps.

Still true from brief 9: no model writes anything; every sentence is a row Dana approved and can edit on `/admin/map`; the text is put together when the page loads and nothing is stored; a quiz taken by someone else is never used; the treat question is never used.

## What each card says

### Top card

| State | Label | Text |
|---|---|---|
| First match (any, including one recorded before the start rules) | Founder's pick | Up to two answers for the customer's family, branch answer first. Then the answer that triggered the rule, when the rule has a condition. Then the coffee sentence: the rule's own when the rule names this coffee, otherwise the coffee's plain sentence. |
| After a step | You are here | Up to two answers that support this coffee, then the coffee's plain sentence. If no answer supports it, the coffee sentence alone. |
| No quiz | none | The coffee's notes, as today. |

With setup answers, the kitchen sentence opens the top card ("You have Counter Culture Coffee in your kitchen."), as built.

### Step cards

Each step card looks for one supporting answer, in this order:

1. An unused answer for the destination coffee's family that also argues for the step's direction.
2. An unused answer for the destination coffee's family. One that argues for no direction is preferred.
3. An unused answer that argues for the step's direction.
4. None: "Your answers point elsewhere."

"The destination's family" includes the family it branches from in the quiz (Earthy counts Chocolate & Nutty answers, Floral counts Fruity answers), as brief 9 does.

Then the step's own line, as it is on the step today.

The setup answer "how do you feel about the coffee you drink now" is one more fact with a direction. It supports a step in that direction like any answer does.

### The lead

| What we have | The lead is |
|---|---|
| First match, and the start rule names this coffee | The rule's lead, with the rule's lead sentence (written to follow the top card). |
| Setup answer names a direction, and a step goes that way | That step, supported by the setup sentence. This wins over the rule's lead. |
| Otherwise (after a step, or a first match no rule explains) | The step with the strongest support: order 1 before 2 before 3 above, then the heavier quiz question. No support on any step means no lead. |

## What this needs that does not exist

- **Each answer sentence rewritten to stand alone** (Data 1), with the direction it argues for, if any. The direction is new data: one of bolder, gentler, different, or none.
- **One plain sentence per coffee** (Data 2), for a top card no start rule explains.
- **One copy row**: "Your answers point elsewhere."

## What goes away

Kept in the database, read by nothing: the frames `told_us_two`, `told_us_one`, `also_said`, `asked_for`, `step_away`, `step_against`; the steps' `when_line` ("If you want…"); the start rules' `lead_quote_family_code`. The setting `dial_away_max_points` is no longer read.

## Data 1: the answer sentences

| answer | sentence | argues for |
|---|---|---|
| v7_q1_a | Coffee is a daily ritual for you, and you're particular about it. | none |
| v7_q1_b | never used | |
| v7_q1_c | You're still discovering coffee. | different |
| v7_q2_a | For you, a good cup is strong and satisfying. | bolder |
| v7_q2_b | For you, a good cup is smooth and easy the whole way. | gentler |
| v7_q2_c | For you, a good cup feels alive and changes as you drink it. | different |
| v7_q3_a | You taste a black coffee first, then make it richer. | none |
| v7_q3_b | You smooth a black coffee before you try it. | gentler |
| v7_q3_c | With a black coffee, your first thought is what flavors are in it. | different |
| v7_q4_a | A coffee with no bitterness would bother you. | bolder |
| v7_q4_b | Too bitter is what would bother you most. | gentler |
| v7_q4_c | A cup where every sip tastes the same would bother you. | different |
| v7_q5_a | A little bitterness tastes serious to you. | bolder |
| v7_q5_b | You'd rather have something gentler. | gentler |
| v7_q5_c | Bitter coffee tastes burnt to you. | gentler |
| v7_branch_cn_stay | Coffee should feel like a reward for you: warm, rich, comforting. | none |
| v7_branch_cn_earthy | You want coffee with a kick: dark, strong, a bit smoky. | bolder |
| v7_branch_fruity_stay | For you, coffee is at its best bright and lively. | none |
| v7_branch_fruity_floral | For you, coffee is at its best light and delicate, and the smell matters most. | gentler |
| v7_branch_bal_cozy | You'd be sad to lose the cozy, dessert-like feeling. | none |
| v7_branch_bal_fruit | You'd be sad to lose that little sweetness that reminds you of fruit. | different |
| v7_branch_bal_floral | You'd be sad to lose the smell. | none |
| feeling: bolder | You'd like something bolder than what you drink now. | bolder |
| feeling: gentler | You'd like something gentler than what you drink now. | gentler |
| feeling: different | You'd like a change from what you drink now. | different |

## Data 2: one plain sentence per coffee

Written only from words already on the start rules and steps. Indonesia has none yet.

| coffee | sentence |
|---|---|
| Benchmark | This is the cup where nothing sticks out: pure chocolate, round and soft. |
| Half Moon | Half the caffeine, with walnut and toffee. |
| Brazil | The base on its own: chocolate, almond and honey. |
| The Daily | Chocolate with some strength: our everyday cup. |
| Fabricator | Chocolate and nut first, with a little citrus and a dry finish. |
| Tiger Stripe | Chocolate first, with a little lift. Built for espresso. |
| Blossom | A darker roast with a fuller body. |
| The Waverly | Fig and orange over dark chocolate. |
| Nightcap Decaf | No caffeine, with almond, molasses and cola. |
| Amsterdam | Deep and smooth, with dark chocolate and walnut. |
| Great Heights | The same idea as Amsterdam, roasted darker. |
| Big City | French roast and burnt sugar. |
| Indonesia | to be written from the roaster's notes |
| Geometric | Bright fruit over caramel. |
| La Familia | Caramel and honey, with a little clementine at the end. |
| D.R. Congo | Clementine and nectarine over caramel and light chocolate. |
| Cafè Feminista | Soft and tropical, with papaya and candied coconut. |
| The Village | Floral, with apple blossom and grapefruit. |

## Worked pages, by these rules

**Dana's account (Tiger Stripe, a first match recorded before the start rules; all Chocolate & Nutty answers).**
- Founder's pick, Tiger Stripe: "Coffee should feel like a reward for you: warm, rich, comforting. A little bitterness tastes serious to you. Chocolate first, with a little lift. Built for espresso."
- Lead, Blossom: "For you, a good cup is strong and satisfying. A darker roast with a fuller body."
- The Waverly: "Coffee is a daily ritual for you, and you're particular about it. Fig and orange over dark chocolate."
- Geometric: "Your answers point elsewhere. More fruit, and sweeter."

**Person 85 (La Familia, quiz only).**
- Founder's pick: "You'd rather have something gentler. For you, a good cup is smooth and easy the whole way. You're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end."
- Lead, The Village (the rule's): "A little further the same way: just as light, with more flower and citrus in it."
- Benchmark: "Too bitter is what would bother you most. Pure chocolate, rounder, less fruit."
- Geometric: "Your answers point elsewhere. Bright fruit over caramel, with more weight."

**Person 33 (The Daily, quiz only).**
- Founder's pick: "A little bitterness tastes serious to you. A coffee with no bitterness would bother you. This is chocolate with some strength: our everyday cup."
- Lead, Amsterdam (the rule's): "The next size up in strength: darker and smoother."
- Benchmark: "For you, a good cup is smooth and easy the whole way. Rounder, pure chocolate."

**Person 81 (Benchmark, quiz and setup).**
- Founder's pick: "You have Counter Culture Coffee in your kitchen. Too bitter is what would bother you most. You smooth a black coffee before you try it. This is the cup where nothing sticks out, and it works however you make it."
- Lead, La Familia (the setup answer): "You'd like something gentler than what you drink now. Caramel and honey with a little clementine. Lighter in the cup."
- The Daily: "A little bitterness tastes serious to you. The same chocolate, livelier, with a bit more bite."
- Fabricator: "For you, a good cup feels alive and changes as you drink it. Hazelnut, a little citrus, a dry finish."

## Known limits

- A supporting answer matches a step by family and direction, not by the step's exact notes. Some pairings will read loosely (The Waverly on Dana's page). "Read it as" on `/admin/map` shows every customer's page, and the fix is always an edit to a row.
- How the customer makes coffee is still not used. The espresso start rule keeps its own sentence.
- The page still does not know whether a bag was delivered or tasted. That comes with the feedback level.
- 97 of 99 existing quiz takers have no map position until the backfill (OT-124).

## Final decisions (Dana, 2026-11-23)

1. **The words** are rows, edited on `/admin/map`: one sentence per quiz answer and setup answer, one per coffee, one per step, and each start rule's coffee sentence, lead and lead sentence. No model writes or rewrites a customer sentence at the quiz and setup levels.
2. **Sentences are written per quiz answer, not per customer and not per combination of answers.** A customer's page is assembled from their own answers when the page loads. Nothing is stored per customer.
3. **The choosing is configuration on `/admin/map`:** the kinds of support a step card may use and the sources of the lead are ordered rows with an on/off switch each; the counts stay in the parameters table. Proposed order of support: family and direction, family, direction. Proposed order of the lead: setup answer, start rule, strongest support.
4. **The layout is fixed and not configurable:** one sentence about the customer, then one sentence about the coffee. No lead-ins, no third piece.
5. **Guardrails are enforced** (G3.9 as amended 2026-11-23): Task 0 lists every reader function, writer function and view the build would add beside the existing ones it considered, and stops for Dana's yes. The two duplicate kitchen and feeling lookups from brief 9 are folded back into one function each, and the seed scripts read through views.
6. Per-person writing by Liam starts only at the feedback level, in a later brief. That is where text is generated and stored.
