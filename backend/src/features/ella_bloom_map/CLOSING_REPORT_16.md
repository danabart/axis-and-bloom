# Closing report: Ella map 16, every card is measured from your spot

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_16_MEASURED_FROM_YOUR_SPOT.md`. **Task 0 only (2026-11-27). STOPPED for Dana.** Nothing in the code or the databases has changed.

- **G1.9:** before starting I listed the sessions. The only other one, danab-0a, confirmed it was idle: nothing running in the repo, the test DB or a deploy.
- **Read-only:** every read ran in `BEGIN READ ONLY … ROLLBACK`, on production and on the test DB.
- **Test and production:** the map is identical on both (18 coffees, 40 shown steps). Item 2 gives the same output on both apart from the header line.
- **Helper scripts** (in `backend/tmp/`): `em16_paths.mts` (items 2 and 3), `em16_variant.mts` (the alternative in question 1) and `em16_pages.mts` (items 4 and 5).
- **Their output** (in `backend/tmp/`):
  - `em16_paths_prod.md`: the full table, every spot by every coffee;
  - `em16_paths_test.md`;
  - `em16_variant_prod.md`;
  - `em16_pages_prod.md`.

## Task 0

### 1. Reader, writer, view and table list (G3.9 amended)

As the brief expects: no new table, view, reader or writer.

| what | existing | brief 16 |
|---|---|---|
| step pairs | `dialReads.activeStepWords` returns `from>to → button_word` only, from `v_dial_step WHERE on_active_map`. `on_active_map` already means the step is in the active version, is shown, and both ends are placed. | **Extend it** (the brief's own call, no new reader). The distance and the tie-break also need the step id, `basis_sort_order` and `move_code`. Its one reader is the brief 15 `joined_by_step` tag, which stays readable. |
| steps from a coffee | `dialReads.stepsFrom`, `offeredSteps` (the decaf filter) | reused as is |
| coffee's own line | `mapFacts.mapLine` (`coffees.map_line`), else the roaster's words (`coffeeSentence`) | reused for the top card beyond the comfort zone |
| move opposites | `dialReads.moveOpposites` (read again since brief 15) | reused if Dana chooses to cancel opposites (question 2) |
| parameters | `evidence_parameter` through its writer, shown on the admin card for the `dial_step_` prefix | two rows: `dial_comfort_zone_steps` (1) and `dial_path_max_changes` (3). The card for `dial_step_` will not show them; see question 6. |
| copy | `dial_customer_copy`, seeded in `schema.sql` if missing | the 8 rows of Data 1 |
| rows switched off | `matchService.setReasonChoice` (the one writer of `dial_reason_choice`) | `own_family`; `same_family`, `joined_by_step`, `leans_to_spot_family`, `other_direction` |
| summary composition | none | composed at read inside `matchService.steps` (G2.14). Nothing is stored. |

### 2. Every summary, for every spot

The brief's rules are applied exactly:
- distance over shown steps, in each step's own direction;
- ties broken in step-card order;
- the same word on adjacent steps said once, with "much" or "far";
- comfort zone 1 and limit 3.

The full table is in `backend/tmp/em16_paths_prod.md`.

**Tiger Stripe as the spot** (Dana's):

| coffee | distance | tag | way | summary | flags |
|---|---|---|---|---|---|
| Amsterdam | 2 | Outside your comfort zone · 2 steps from your spot | Less fruit → The Daily · Bolder → Amsterdam | Less fruit, and bolder. |  |
| Benchmark | 2 | Outside your comfort zone · 2 steps from your spot | Less fruit → The Daily · Lighter → Benchmark | Less fruit, and lighter. |  |
| Big City | 4 | Outside your comfort zone · 4 steps from your spot | Less fruit → The Daily · Bolder → Amsterdam · Bolder → Great Heights · Bolder → Big City | Less fruit, and far bolder. |  |
| Blossom | 1 | One step from your spot | Bolder → Blossom | - |  |
| Brazil | 2 | Outside your comfort zone · 2 steps from your spot | Bolder → Blossom · Lighter → Brazil | Bolder, and lighter. | opposites: "bolder" (bolder) and "lighter" (gentler) |
| Cafè Feminista | 4 | Outside your comfort zone · 4 steps from your spot | More fruit → Geometric · Lighter → La Familia · More delicate → The Village · More tropical → Cafè Feminista | More fruit, lighter, more delicate, and more tropical. | 4 kinds of change (limit 3) |
| D.R. Congo | 2 | Outside your comfort zone · 2 steps from your spot | More fruit → Geometric · Lighter → D.R. Congo | More fruit, and lighter. |  |
| Fabricator | 1 | One step from your spot | Lighter → Fabricator | - |  |
| Geometric | 1 | One step from your spot | More fruit → Geometric | - |  |
| Great Heights | 3 | Outside your comfort zone · 3 steps from your spot | Less fruit → The Daily · Bolder → Amsterdam · Bolder → Great Heights | Less fruit, and much bolder. |  |
| Half Moon | - | A different part of the map | - | - | no way |
| Indonesia | 2 | Outside your comfort zone · 2 steps from your spot | Bolder → Blossom · Earthier → Indonesia | Bolder, and earthier. |  |
| La Familia | 2 | Outside your comfort zone · 2 steps from your spot | More fruit → Geometric · Lighter → La Familia | More fruit, and lighter. |  |
| Nightcap Decaf | - | A different part of the map | - | - | no way |
| The Daily | 1 | One step from your spot | Less fruit → The Daily | - |  |
| The Village | 3 | Outside your comfort zone · 3 steps from your spot | More fruit → Geometric · Lighter → La Familia · More delicate → The Village | More fruit, lighter, and more delicate. |  |
| The Waverly | 1 | One step from your spot | More fruit → The Waverly | - |  |

The brief's examples come out as drafted:
- Benchmark: "Less fruit, and lighter."
- Amsterdam: "Less fruit, and bolder."
- Big City: "Less fruit, and far bolder." (4 steps)
- The Village: "More fruit, lighter, and more delicate." (3 steps)

One sentence in Tiger Stripe's table reads badly: Brazil, "Bolder, and lighter." The tie-break picks the way through Blossom; question 1 fixes it.

**The count by distance, for every spot:**

| spot | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | no way |
|---|---|---|---|---|---|---|---|---|---|
| Amsterdam | 2 | 3 | 5 | 4 | 1 | 0 | 0 | 0 | 2 |
| Benchmark | 3 | 5 | 5 | 2 | 0 | 0 | 0 | 0 | 2 |
| Big City | 1 | 1 | 1 | 2 | 5 | 4 | 1 | 0 | 2 |
| Blossom | 3 | 4 | 4 | 2 | 2 | 0 | 0 | 0 | 2 |
| Brazil | 2 | 4 | 4 | 2 | 2 | 1 | 0 | 0 | 2 |
| Cafè Feminista | 1 | 1 | 2 | 4 | 4 | 2 | 1 | 0 | 2 |
| D.R. Congo | 1 | 3 | 6 | 3 | 1 | 1 | 0 | 0 | 2 |
| Fabricator | 4 | 5 | 3 | 2 | 1 | 0 | 0 | 0 | 2 |
| Geometric | 4 | 6 | 3 | 1 | 1 | 0 | 0 | 0 | 2 |
| Great Heights | 2 | 1 | 2 | 5 | 4 | 1 | 0 | 0 | 2 |
| Half Moon | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 16 |
| Indonesia | 1 | 2 | 4 | 4 | 2 | 2 | 0 | 0 | 2 |
| La Familia | 3 | 5 | 4 | 2 | 1 | 0 | 0 | 0 | 2 |
| Nightcap Decaf (decaf) | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 16 |
| The Daily | 3 | 6 | 5 | 1 | 0 | 0 | 0 | 0 | 2 |
| The Village | 2 | 2 | 4 | 4 | 2 | 1 | 0 | 0 | 2 |
| The Waverly | 1 | 4 | 6 | 2 | 2 | 0 | 0 | 0 | 2 |
| Tiger Stripe | 5 | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 2 |

**Decaf.** Half Moon and Nightcap Decaf form an island. They are joined only to each other ("Half the caffeine" and "No caffeine"), and no step leaves them for a regular coffee or arrives from one. So every regular spot has 2 coffees with no way to them, and each decaf spot has 16.
- A regular customer cannot open a decaf coffee today: `/map?at=` returns 404 NOT_ON_MAP, through the decaf filter `passesTagFilter`.
- A decaf customer can open only decaf coffees.

So "A different part of the map" (`tag_no_way`) has no customer to show it to on today's map. No shortest way passes through a decaf coffee.

**Every sentence that reads badly: 73, on 16 spots** (not counting the 64 "no way" pairs above):

| reason | sentences |
|---|---|
| a change and its opposite, by move (bolder and gentler) or by word (more fruit and less fruit) | 46 |
| more kinds of change than the limit of 3 | 44 |
| the same word twice, not on adjacent steps, so not merged (for example "Lighter, much more fruit, and lighter.") | 8 |
| "More body, keep the fruit": a word that is two changes. Its comma breaks the joiner, and "much" or "far" would cover only "more body". | 14 |
| a word that does not take "much" or "far" | 0 (see item 3) |
| a way through a decaf coffee | 0 |

A sentence can have more than one reason.

**One summary for different kinds of change:** none. Only "far" covers three steps and four steps alike (for example "Far bolder." for bolder ×3 and bolder ×4), which is the rule as drafted. D.R. Congo and La Familia both read "More fruit, and lighter." from Tiger Stripe, because both are reached by the same kinds of change.

All 73:

| spot | coffee | distance | summary | why |
|---|---|---|---|---|
| Amsterdam | Blossom | 3 | Lighter, more fruit, and bolder. | opposites: "lighter" (gentler) and "bolder" (bolder) |
| Amsterdam | Cafè Feminista | 5 | Much lighter, brighter, more delicate, and more tropical. | 4 kinds of change (limit 3) |
| Amsterdam | D.R. Congo | 4 | Lighter, much more fruit, and lighter. | repeats "lighter" |
| Amsterdam | Indonesia | 4 | Lighter, more fruit, bolder, and earthier. | opposites: "lighter" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Benchmark | Blossom | 3 | Bolder, more fruit, and bolder. | repeats "bolder" |
| Benchmark | D.R. Congo | 3 | Brighter, more body, keep the fruit, and lighter. | opposites: "brighter" (gentler) and "more body, keep the fruit" (bolder); opposites: "more body, keep the fruit" (bolder) and "lighter" (gentler) |
| Benchmark | Geometric | 2 | Brighter, and more body, keep the fruit. | opposites: "brighter" (gentler) and "more body, keep the fruit" (bolder) |
| Benchmark | Indonesia | 4 | Bolder, more fruit, bolder, and earthier. | repeats "bolder"; 4 kinds of change (limit 3) |
| Big City | Blossom | 5 | Far lighter, more fruit, and bolder. | opposites: "lighter" (gentler) and "bolder" (bolder) |
| Big City | Cafè Feminista | 7 | Far lighter, brighter, more delicate, and more tropical. | 4 kinds of change (limit 3) |
| Big City | D.R. Congo | 6 | Far lighter, much more fruit, and lighter. | repeats "lighter" |
| Big City | Indonesia | 6 | Far lighter, more fruit, bolder, and earthier. | opposites: "lighter" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Blossom | Amsterdam | 3 | Brighter, less fruit, and bolder. | opposites: "brighter" (gentler) and "bolder" (bolder) |
| Blossom | Big City | 5 | Brighter, less fruit, and far bolder. | opposites: "brighter" (gentler) and "bolder" (bolder) |
| Blossom | Cafè Feminista | 5 | Brighter, more fruit, lighter, more delicate, and more tropical. | 5 kinds of change (limit 3) |
| Blossom | Great Heights | 4 | Brighter, less fruit, and much bolder. | opposites: "brighter" (gentler) and "bolder" (bolder) |
| Blossom | The Village | 4 | Brighter, more fruit, lighter, and more delicate. | 4 kinds of change (limit 3) |
| Brazil | Amsterdam | 4 | Bolder, brighter, less fruit, and bolder. | opposites: "bolder" (bolder) and "brighter" (gentler); repeats "bolder"; opposites: "brighter" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Brazil | Big City | 6 | Bolder, brighter, less fruit, and far bolder. | opposites: "bolder" (bolder) and "brighter" (gentler); repeats "bolder"; opposites: "brighter" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Brazil | Cafè Feminista | 5 | More going on, more fruit, lighter, more delicate, and more tropical. | 5 kinds of change (limit 3) |
| Brazil | Great Heights | 5 | Bolder, brighter, less fruit, and much bolder. | opposites: "bolder" (bolder) and "brighter" (gentler); repeats "bolder"; opposites: "brighter" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Brazil | The Daily | 3 | Bolder, brighter, and less fruit. | opposites: "bolder" (bolder) and "brighter" (gentler) |
| Brazil | The Village | 4 | More going on, more fruit, lighter, and more delicate. | 4 kinds of change (limit 3) |
| Brazil | The Waverly | 3 | Bolder, brighter, and more fruit. | opposites: "bolder" (bolder) and "brighter" (gentler) |
| Brazil | Tiger Stripe | 2 | Bolder, and brighter. | opposites: "bolder" (bolder) and "brighter" (gentler) |
| Cafè Feminista | Amsterdam | 5 | More delicate, sweeter, more body, and much bolder. | opposites: "more delicate" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Cafè Feminista | Big City | 7 | More delicate, sweeter, more body, and far bolder. | opposites: "more delicate" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Cafè Feminista | Blossom | 5 | More delicate, sweeter, more body, keep the fruit, more body, and bolder. | opposites: "more delicate" (gentler) and "more body, keep the fruit" (bolder); opposites: "more delicate" (gentler) and "more body" (bolder); opposites: "more delicate" (gentler) and "bolder" (bolder); 5 kinds of change (limit 3) |
| Cafè Feminista | Brazil | 5 | More delicate, sweeter, more body, more going on, and simpler. | 5 kinds of change (limit 3) |
| Cafè Feminista | D.R. Congo | 4 | More delicate, sweeter, more body, keep the fruit, and lighter. | opposites: "more delicate" (gentler) and "more body, keep the fruit" (bolder); opposites: "more body, keep the fruit" (bolder) and "lighter" (gentler); 4 kinds of change (limit 3) |
| Cafè Feminista | Fabricator | 4 | More delicate, sweeter, more body, and more going on. | 4 kinds of change (limit 3) |
| Cafè Feminista | Geometric | 3 | More delicate, sweeter, and more body, keep the fruit. | opposites: "more delicate" (gentler) and "more body, keep the fruit" (bolder) |
| Cafè Feminista | Great Heights | 6 | More delicate, sweeter, more body, and far bolder. | opposites: "more delicate" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Cafè Feminista | Indonesia | 6 | More delicate, sweeter, more body, keep the fruit, more body, bolder, and earthier. | opposites: "more delicate" (gentler) and "more body, keep the fruit" (bolder); opposites: "more delicate" (gentler) and "more body" (bolder); opposites: "more delicate" (gentler) and "bolder" (bolder); 6 kinds of change (limit 3) |
| Cafè Feminista | The Daily | 4 | More delicate, sweeter, more body, and bolder. | opposites: "more delicate" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Cafè Feminista | The Waverly | 5 | More delicate, sweeter, more body, keep the fruit, more body, and more fruit. | opposites: "more delicate" (gentler) and "more body, keep the fruit" (bolder); opposites: "more delicate" (gentler) and "more body" (bolder); 5 kinds of change (limit 3) |
| Cafè Feminista | Tiger Stripe | 4 | More delicate, sweeter, more body, keep the fruit, and more body. | opposites: "more delicate" (gentler) and "more body, keep the fruit" (bolder); opposites: "more delicate" (gentler) and "more body" (bolder); 4 kinds of change (limit 3) |
| D.R. Congo | Benchmark | 3 | More body, less fruit, and rounder. | opposites: "more body" (bolder) and "rounder" (gentler) |
| D.R. Congo | Brazil | 3 | More body, less fruit, and simpler. | opposites: "more body" (bolder) and "simpler" (gentler) |
| D.R. Congo | Cafè Feminista | 4 | More body, lighter, more delicate, and more tropical. | opposites: "more body" (bolder) and "lighter" (gentler); opposites: "more body" (bolder) and "more delicate" (gentler); 4 kinds of change (limit 3) |
| D.R. Congo | La Familia | 2 | More body, and lighter. | opposites: "more body" (bolder) and "lighter" (gentler) |
| D.R. Congo | The Village | 3 | More body, lighter, and more delicate. | opposites: "more body" (bolder) and "lighter" (gentler); opposites: "more body" (bolder) and "more delicate" (gentler) |
| Fabricator | Blossom | 2 | Simpler, and bolder. | opposites: "simpler" (gentler) and "bolder" (bolder) |
| Fabricator | Cafè Feminista | 4 | More fruit, lighter, more delicate, and more tropical. | 4 kinds of change (limit 3) |
| Fabricator | Indonesia | 3 | Simpler, bolder, and earthier. | opposites: "simpler" (gentler) and "bolder" (bolder) |
| Great Heights | Blossom | 4 | Much lighter, more fruit, and bolder. | opposites: "lighter" (gentler) and "bolder" (bolder) |
| Great Heights | Cafè Feminista | 6 | Far lighter, brighter, more delicate, and more tropical. | 4 kinds of change (limit 3) |
| Great Heights | D.R. Congo | 5 | Much lighter, much more fruit, and lighter. | repeats "lighter" |
| Great Heights | Indonesia | 5 | Much lighter, more fruit, bolder, and earthier. | opposites: "lighter" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Indonesia | Amsterdam | 4 | Cleaner, brighter, less fruit, and bolder. | opposites: "brighter" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Indonesia | Benchmark | 4 | Cleaner, brighter, less fruit, and lighter. | 4 kinds of change (limit 3) |
| Indonesia | Big City | 6 | Cleaner, brighter, less fruit, and far bolder. | opposites: "brighter" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Indonesia | Cafè Feminista | 6 | Cleaner, brighter, more fruit, lighter, more delicate, and more tropical. | 6 kinds of change (limit 3) |
| Indonesia | D.R. Congo | 4 | Cleaner, brighter, more fruit, and lighter. | 4 kinds of change (limit 3) |
| Indonesia | Great Heights | 5 | Cleaner, brighter, less fruit, and much bolder. | opposites: "brighter" (gentler) and "bolder" (bolder); 4 kinds of change (limit 3) |
| Indonesia | La Familia | 4 | Cleaner, brighter, more fruit, and lighter. | 4 kinds of change (limit 3) |
| Indonesia | The Village | 5 | Cleaner, brighter, more fruit, lighter, and more delicate. | 5 kinds of change (limit 3) |
| La Familia | D.R. Congo | 2 | More body, keep the fruit, and lighter. | opposites: "more body, keep the fruit" (bolder) and "lighter" (gentler) |
| La Familia | Indonesia | 4 | More body, keep the fruit, more body, bolder, and earthier. | 4 kinds of change (limit 3) |
| The Daily | Cafè Feminista | 4 | Lighter, brighter, more delicate, and more tropical. | 4 kinds of change (limit 3) |
| The Village | Blossom | 4 | Sweeter, more body, keep the fruit, more body, and bolder. | 4 kinds of change (limit 3) |
| The Village | Brazil | 4 | Sweeter, more body, more going on, and simpler. | 4 kinds of change (limit 3) |
| The Village | D.R. Congo | 3 | Sweeter, more body, keep the fruit, and lighter. | opposites: "more body, keep the fruit" (bolder) and "lighter" (gentler) |
| The Village | Indonesia | 5 | Sweeter, more body, keep the fruit, more body, bolder, and earthier. | 5 kinds of change (limit 3) |
| The Village | The Waverly | 4 | Sweeter, more body, keep the fruit, more body, and more fruit. | 4 kinds of change (limit 3) |
| The Waverly | Brazil | 3 | Less fruit, bolder, and lighter. | opposites: "bolder" (bolder) and "lighter" (gentler) |
| The Waverly | Cafè Feminista | 5 | Less fruit, more fruit, lighter, more delicate, and more tropical. | opposites: "less fruit" and "more fruit"; 5 kinds of change (limit 3) |
| The Waverly | D.R. Congo | 3 | Less fruit, more fruit, and lighter. | opposites: "less fruit" and "more fruit" |
| The Waverly | Geometric | 2 | Less fruit, and more fruit. | opposites: "less fruit" and "more fruit" |
| The Waverly | La Familia | 3 | Less fruit, more fruit, and lighter. | opposites: "less fruit" and "more fruit" |
| The Waverly | The Village | 4 | Less fruit, more fruit, lighter, and more delicate. | opposites: "less fruit" and "more fruit"; 4 kinds of change (limit 3) |
| Tiger Stripe | Brazil | 2 | Bolder, and lighter. | opposites: "bolder" (bolder) and "lighter" (gentler) |
| Tiger Stripe | Cafè Feminista | 4 | More fruit, lighter, more delicate, and more tropical. | 4 kinds of change (limit 3) |

### 3. Words

The active map has 17 step words. Every comparative takes "much" and "far" well.

| word | moves | much | far | flag |
|---|---|---|---|---|
| Bolder | bolder | much bolder | far bolder |  |
| Brighter | gentler | much brighter | far brighter |  |
| Cleaner | different | much cleaner | far cleaner |  |
| Earthier | different | much earthier | far earthier |  |
| Half the caffeine | - | much half the caffeine | far half the caffeine | not a comparative |
| Less fruit | different | much less fruit | far less fruit |  |
| Lighter | gentler | much lighter | far lighter |  |
| More body | different, bolder | much more body | far more body |  |
| More body, keep the fruit | bolder | much more body, keep the fruit | far more body, keep the fruit | two changes in one word: "much"/"far" covers only the first |
| More delicate | gentler | much more delicate | far more delicate |  |
| More fruit | different | much more fruit | far more fruit |  |
| More going on | different | much more going on | far more going on |  |
| More tropical | different | much more tropical | far more tropical |  |
| No caffeine | - | much no caffeine | far no caffeine | not a comparative |
| Rounder | gentler | much rounder | far rounder |  |
| Simpler | gentler | much simpler | far simpler |  |
| Sweeter | different | much sweeter | far sweeter |  |

**Flags:**
- **"Half the caffeine" and "No caffeine"** do not take a strength word ("much no caffeine"). They join only the two decaf coffees (one step each way), so they never reach a summary today.
- **"More body, keep the fruit"** (one step: La Familia → Geometric, #2922; corrected at Part A, Task 0 named two) is the one word that is two changes. "Far more body, keep the fruit" reads wrongly, and in a list its comma looks like a separator. It is in 14 of the 73 sentences.
- **"Brighter"** is filed under the move `gentler`, so "Brighter … bolder" counts as an opposite. Whether a brighter cup is the opposite of a bolder one is Dana's call (question 2).

### 4. The pages, with brief 16 applied

These pages were composed on production from today's `steps()`, with the brief's rules applied in the script:
- **The spot page:** unchanged.
- **The top card of a looked-at page:** inside the comfort zone, the coffee's spot-page step card word for word. Outside it, the summary and then the coffee's own line.
- **The step cards while looking:** the distance from the spot and the step's line, with no lead and no quiz answer.

Persons 85, 33 and 23 have no spot on production, so they are read as their start rule, as in brief 15. The summaries use the brief's rules as drafted.

### Dana: spot Tiger Stripe

#### On the spot (as today, unchanged)

- **Top · Tiger Stripe**: Coffee should feel like a reward for you: warm, rich, comforting. A little bitterness tastes serious to you. Chocolate first, with a little lift. Built for espresso.
- **Lead** **Blossom**: For you, a good cup is strong and satisfying. A darker roast than Tiger Stripe, with a fuller body.
- **Geometric**: Next to your coffee, you'd reach for something fresh and lively. More fruit than Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it.
- **The Daily**: Coffee is a daily ritual for you, and you're particular about it. Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite.
- **Fabricator**: You taste a black coffee first, then make it richer. Tiger Stripe with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body.
- **The Waverly**: A coffee with no bitterness would bother you. Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange.

#### Looking at · The Daily

- **Top · The Daily** · One step from your spot: Coffee is a daily ritual for you, and you're particular about it. Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite.
- *One step from The Daily*
  - **Amsterdam** · Outside your comfort zone · 2 steps from your spot: A step darker than The Daily: smoother, with less acidity.
  - **Benchmark** · Outside your comfort zone · 2 steps from your spot: The same chocolate as The Daily, rounder and softer.
  - **Tiger Stripe** · Your spot: The Daily with a fruit edge: chocolate first, cherry behind. Built for espresso.

#### Looking at · Fabricator

- **Top · Fabricator** · One step from your spot: You taste a black coffee first, then make it richer. Tiger Stripe with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body.
- *One step from Fabricator*
  - **Geometric** · One step from your spot: Made from the same coffees as Fabricator, with more fruit, and sweeter.
  - **Brazil** · Outside your comfort zone · 2 steps from your spot: Simpler than Fabricator: chocolate, almond, honey.
  - **Tiger Stripe** · Your spot: More body than Fabricator, with cherry where the citrus was. Built for espresso.
  - **Benchmark** · Outside your comfort zone · 2 steps from your spot: Rounder than Fabricator: pure chocolate, softer, no citrus.

#### Looking at · Benchmark

- **Top · Benchmark** · Outside your comfort zone · 2 steps from your spot: Less fruit, and lighter. This is the cup where nothing sticks out: pure chocolate, round and soft.
- *One step from Benchmark*
  - **The Daily** · One step from your spot: The same chocolate as Benchmark, livelier, with a bit more bite.
  - **La Familia** · Outside your comfort zone · 2 steps from your spot: Lighter in the cup than Benchmark: caramel and honey, with a little clementine.
  - **Fabricator** · One step from your spot: More going on than Benchmark: hazelnut, a little citrus, a dry finish.

#### Looking at · Amsterdam

- **Top · Amsterdam** · Outside your comfort zone · 2 steps from your spot: Less fruit, and bolder. Deep and smooth, with dark chocolate and walnut.
- *One step from Amsterdam*
  - **Great Heights** · Outside your comfort zone · 3 steps from your spot: The same Brazil as Amsterdam, roasted darker.
  - **The Daily** · One step from your spot: Lighter and sweeter than Amsterdam.

#### Looking at · Big City

- **Top · Big City** · Outside your comfort zone · 4 steps from your spot: Less fruit, and far bolder. French roast and burnt sugar.
- *One step from Big City*
  - **Great Heights** · Outside your comfort zone · 3 steps from your spot: Less smoke than Big City, more fudge.

#### Looking at · The Village

- **Top · The Village** · Outside your comfort zone · 3 steps from your spot: More fruit, lighter, and more delicate. Floral, with apple blossom and grapefruit.
- *One step from The Village*
  - **Cafè Feminista** · Outside your comfort zone · 4 steps from your spot: Creamier than The Village: papaya and candied coconut.
  - **La Familia** · Outside your comfort zone · 2 steps from your spot: Softer and sweeter than The Village: caramel and honey.

#### Looking at · Half Moon

- today: 404 NOT_ON_MAP (the page cannot be opened; tag would be "A different part of the map")

### Person 85: spot La Familia

#### On the spot (as today, unchanged)

- **Top · La Familia**: You'd rather have something gentler. For you, a good cup is smooth and easy the whole way. You're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end.
- **Lead** **The Village**: A little further the same way: just as light, with more flower and citrus in it.
- **Benchmark**: Too bitter is what would bother you most. Rounder than La Familia: pure chocolate, less fruit.
- **Geometric**: You're still discovering coffee. Keeps the fruit of La Familia and adds weight: bright fruit over caramel.

#### Looking at · Benchmark

- **Top · Benchmark** · One step from your spot: Too bitter is what would bother you most. Rounder than La Familia: pure chocolate, less fruit.
- *One step from Benchmark*
  - **Fabricator** · Outside your comfort zone · 2 steps from your spot: More going on than Benchmark: hazelnut, a little citrus, a dry finish.
  - **The Daily** · Outside your comfort zone · 2 steps from your spot: The same chocolate as Benchmark, livelier, with a bit more bite.
  - **La Familia** · Your spot: Lighter in the cup than Benchmark: caramel and honey, with a little clementine.

#### Looking at · Amsterdam

- **Top · Amsterdam** · Outside your comfort zone · 3 steps from your spot: More body, and much bolder. Deep and smooth, with dark chocolate and walnut.
- *One step from Amsterdam*
  - **The Daily** · Outside your comfort zone · 2 steps from your spot: Lighter and sweeter than Amsterdam.
  - **Great Heights** · Outside your comfort zone · 4 steps from your spot: The same Brazil as Amsterdam, roasted darker.

### Person 33: spot The Daily

#### On the spot (as today, unchanged)

- **Top · The Daily**: A little bitterness tastes serious to you. A coffee with no bitterness would bother you. This is chocolate with some strength: our everyday cup.
- **Lead** **Amsterdam**: The next size up in strength: darker and smoother.
- **Benchmark**: For you, a good cup is smooth and easy the whole way. The same chocolate as The Daily, rounder and softer.
- **Tiger Stripe**: With a black coffee, your first thought is what flavors are in it. The Daily with a fruit edge: chocolate first, cherry behind. Built for espresso.

#### Looking at · Benchmark

- **Top · Benchmark** · One step from your spot: For you, a good cup is smooth and easy the whole way. The same chocolate as The Daily, rounder and softer.
- *One step from Benchmark*
  - **Fabricator** · Outside your comfort zone · 2 steps from your spot: More going on than Benchmark: hazelnut, a little citrus, a dry finish.
  - **The Daily** · Your spot: The same chocolate as Benchmark, livelier, with a bit more bite.
  - **La Familia** · Outside your comfort zone · 2 steps from your spot: Lighter in the cup than Benchmark: caramel and honey, with a little clementine.

#### Looking at · The Village

- **Top · The Village** · Outside your comfort zone · 3 steps from your spot: Lighter, brighter, and more delicate. Floral, with apple blossom and grapefruit.
- *One step from The Village*
  - **Cafè Feminista** · Outside your comfort zone · 4 steps from your spot: Creamier than The Village: papaya and candied coconut.
  - **La Familia** · Outside your comfort zone · 2 steps from your spot: Softer and sweeter than The Village: caramel and honey.

### Person 23: spot Geometric

#### On the spot (as today, unchanged)

- **Top · Geometric**: Bitter coffee tastes burnt to you. For you, a good cup feels alive and changes as you drink it. Coffee is a daily ritual for you, and you're particular about it. So: bright fruit, with caramel under it to make it an everyday cup.
- **Lead** **La Familia**: Lighter and sweeter: caramel, honey, a little clementine.
- **Fabricator**: A cup where every sip tastes the same would bother you. Made from the same coffees as Geometric, with less fruit: drier and nuttier.
- **Tiger Stripe**: Coffee is a daily ritual for you, and you're particular about it. More chocolate and body than Geometric, with the fruit behind.
- **D.R. Congo**: With a black coffee, your first thought is what flavors are in it. Lighter than Geometric: clementine and nectarine over caramel and light chocolate.

#### Looking at · Fabricator

- **Top · Fabricator** · One step from your spot: A cup where every sip tastes the same would bother you. Made from the same coffees as Geometric, with less fruit: drier and nuttier.
- *One step from Fabricator*
  - **Brazil** · Outside your comfort zone · 2 steps from your spot: Simpler than Fabricator: chocolate, almond, honey.
  - **Geometric** · Your spot: Made from the same coffees as Fabricator, with more fruit, and sweeter.
  - **Tiger Stripe** · One step from your spot: More body than Fabricator, with cherry where the citrus was. Built for espresso.
  - **Benchmark** · Outside your comfort zone · 2 steps from your spot: Rounder than Fabricator: pure chocolate, softer, no citrus.

#### Looking at · Big City

- **Top · Big City** · Outside your comfort zone · 5 steps from your spot: More body, less fruit, and far bolder. French roast and burnt sugar.
- *One step from Big City*
  - **Great Heights** · Outside your comfort zone · 4 steps from your spot: Less smoke than Big City, more fudge.

### 5. Repetition check

Across all of Dana's pages, a sentence about her appears on more than one page only where a one-step coffee repeats its own spot-page card, as expected:
- "Coffee is a daily ritual for you, and you're particular about it.": the spot page and The Daily;
- "You taste a black coffee first, then make it richer.": the spot page and Fabricator.

Persons 85, 33 and 23 show the same pattern:
- 85: Benchmark;
- 33: Benchmark;
- 23: Fabricator.

Two repeats sit within a spot page itself (85: "You're still discovering coffee."; 23: "Coffee is a daily ritual…"). They come from the brief 15 reuse pass and are unchanged, since the spot page stays as it is.

No sentence about the customer appears on a looked-at card outside the comfort zone, or on any step card while looking.

## What Dana needs to decide before Part A

1. **Repeats that are not next to each other, and ties.** Your decision 4 says each kind of change is named once. The CTO call merges only adjacent repeats, which leaves 8 sentences like "Lighter, much more fruit, and lighter."

   I propose:
   - (a) merge every repeat wherever it sits, counting all of them;
   - (b) among equally short ways, prefer one with no opposite pair, then the fewest kinds of change, then step-card order.

   Measured on the same map (`backend/tmp/em16_variant_prod.md`), the 73 bad sentences drop to 64. Tiger Stripe's Brazil becomes "Lighter, and simpler." (by Fabricator) instead of "Bolder, and lighter." (by Blossom). Tiger Stripe's other summaries stay the same. Yes or no?
2. **A change and its opposite on the only shortest way** (34 left after 1). For example, Brazil to Tiger Stripe reads "Bolder, and brighter." Choose one:
   - (a) keep both words. They are what the map shows step by step.
   - (b) drop both when two words are opposite moves (the `dial_move` opposites) or "more X" and "less X". This could leave no summary, and then the card shows only the tag and the coffee's line.
   - (c) keep only the later one.

   Also: does "brighter" (filed under the move `gentler`) count as the opposite of "bolder"?
3. **Over the limit** (43 left after 1, up to 6 kinds, for example Indonesia to Cafè Feminista: "Cleaner, brighter, more fruit, lighter, more delicate, and more tropical."). With `dial_path_max_changes` = 3, choose one:
   - (a) the first 3 in the way's order;
   - (b) the 3 strongest (most steps), ties in the way's order;
   - (c) no summary beyond the limit: tag and line only.
4. **"More body, keep the fruit"** (14 sentences). This one word is two changes. Choose one:
   - (a) use it as written;
   - (b) a summary form per word. That is a new column or table, so it needs your yes under G3.9.
   - (c) split the word at its comma and take the first part. That puts a rule in code (G2.1).
   - (d) change the step word to "More body" through its writer, with the fruit kept in its line. That changes an existing step, so it needs your yes.

   I recommend (d), else (a).
5. **Decaf.** "A different part of the map" cannot show today, because a regular customer cannot open a decaf coffee and a decaf customer cannot open a regular one. Keep the row for when the island is joined? Yes or no.
6. **Where the two parameters show.** The admin card shows only the prefix `dial_step_`. Should I add a second card for `dial_comfort_zone_` and `dial_path_`, or name the first parameter `dial_path_comfort_zone_steps` and add one card for `dial_path_`? I recommend the second.
7. **Step-card tags while looking**, measured from the spot. On Tiger Stripe's Fabricator page, Tiger Stripe's card reads "Your spot" and Geometric's "One step from your spot". Brazil and Benchmark read "Outside your comfort zone · 2 steps from your spot". As drafted. Confirm?

**STOP.** Nothing has been written to the code or either database.

## Dana's answers (2026-11-27)

1. Yes to (a) and (b): merge every repeat wherever it sits; among equally short ways, prefer one with no opposite pair, then the fewest kinds of change, then step-card order.
2. A summary is shown only when it is clean. A way with a change and its opposite (opposite moves by `dial_move`, or "more X" and "less X") gets no summary, only the tag and the coffee's own line. "Brighter" and "bolder" count as opposites, because their moves are.
3. (c): no summary beyond the limit, only the tag and the line.
4. (d): rename the step word to "More body" through its writer; the fruit stays in its line.
5. Yes: keep the `tag_no_way` row.
6. The second option: `dial_path_comfort_zone_steps` and `dial_path_max_changes`, on one admin card.
7. Confirmed: step cards while looking carry their distance from the spot.

At the Part E STOP, Dana also asked for: for every spot, how many coffees get a summary and how many get tag and line only, and the full table for Tiger Stripe.

## Parts A to D, built on the test DB (2026-11-28). STOPPED before the push

Nothing is committed or pushed, and production has not been written.

### What was built

- **A. Schema and data.**
  - In `schema.sql`, the "ELLA'S BLOOM MAP 16" block, additive and inserted only if missing: the 8 copy rows of Data 1 and the parameters `dial_path_comfort_zone_steps` (1, range 1 to 5) and `dial_path_max_changes` (3, range 1 to 6).
  - No new table, view, reader or writer.
  - Seed `backend/src/scripts/ellaMapMeasuredFromSpot_2026_11_27.ts` (`--dry-run`, `--apply`, `--expect-db`; wrapper `backend/tmp/em16_seed.mjs test|prod [--apply]`):
    - switches off `own_family`, `same_family`, `joined_by_step`, `leans_to_spot_family` and `other_direction` through `setReasonChoiceInTx`;
    - renames the word on step #2922 (La Familia → Geometric) from "More body, keep the fruit" to "More body" through `setStepInTx`, keeping its line, basis, shown flag, notes, direction and card clause;
    - publishes the next `L<n> measured from your spot (Ella map 16)` and refuses if a placement moves.
  - `comments.sql`: the `dial_customer_copy` comment names the new codes and the four `tag_<relation>` rows read by nothing since this brief (898 characters).
  - `dataCatalogIntegrity`: the 8 codes and 2 keys are added to checks 9 and 10.
- **B. Backend.**
  - `dialReads.activeStepWords` is extended rather than copied: it now returns each step's id, destination name, word, basis order and move, in step-card order. Its brief 15 reader still works.
  - In `matchService`, four pure functions, each exported for the tests:
    - `pathParts`: each kind of change once, counted;
    - `hasOpposite`: opposite moves, or "more X" and "less X";
    - `shortestWays`: every shortest way, then the tie-break of answer 1;
    - `pathSummary` and `distanceTag`.
  - `steps()` while looking:
    - the top card is the coffee's spot-page card inside the comfort zone, else the clean summary and the coffee's own line;
    - every step card is its line alone, with its distance tag;
    - no lead;
    - admins get the distance, the way, and the summary's state and words.
  - The spot page is unchanged. Its step cards carry no tag now, because the `spot_relation` rows are off.
- **C. Frontend.**
  - `/map` needed no change: with no lead while looking, "One step from {coffee}" already takes the heading, and the summary is part of the card's text.
  - `/admin/map`:
    - a new card, "How far a coffee is from the spot" (prefix `dial_path_`);
    - "Read it as" has a "Look at {coffee}" link on every card and "Back to the spot", through the existing route `GET /api/admin/map/reasons`, extended with `?at=`;
    - each basis line shows the distance, the way taken, and the summary's state and words.
- **D. Tests.**
  - New `dialMap16.test.ts` (13 tests), covering:
    - the summary: once, much, far, non-adjacent repeats merged, custom joiners, opposites by move and by word, the limit;
    - every tag;
    - the distance for every pair on the test map, checked against a plain search, plus Tiger Stripe's walk and Brazil's tie-break;
    - no summary repeats a word, and a summary is shared only by coffees reached by the same kinds of change;
    - the seed: idempotent, rows off, the word renamed with its line kept, no comma word left;
    - Dana's spot page, word for word;
    - every one-step coffee's looked-at card equals its spot-page card;
    - the walk and the summaries;
    - no lead, no answer and a distance tag on every step card while looking, for every coffee a regular customer can open;
    - the comfort zone at 2 and back;
    - the decaf island;
    - integrity.
  - The pins of briefs 9, 10, 14 and 15 are updated (below).

### The seed on the test DB

- **Dry run:** 7 writes (5 rows off, 1 step, 1 publish). The 8 copy rows show as "same", because the schema seeds them.
- **Apply:** 6 rows written, published "L6 measured from your spot (Ella map 16)" as v295 (18 placements), retired v278.
- **Rerun:** 0 writes.
- **Outputs:** `backend/tmp/em16_seed_test_dry.md` and `backend/tmp/em16_seed_test_apply.md`.
- **On production** the next label will be L7: the active version there is L6 = v8, from brief 15.

### Tests

- **Map suites:** all pass except the known baseline from before brief 15, unchanged: dialMap7's three start-rule tests, and dialMap9 "person 81" (OT-190).
- **Lints, type-checks and frontend tests:**
  - all six lints pass;
  - backend tsc is clean;
  - frontend tsc shows only the 7 known errors;
  - the frontend map and admin tests pass 28 of 28.
- **Updated because brief 16 changes them (expected):**
  - **dialMap15.**
    - Spot-page cards have no tag.
    - The looked-at pages (Fabricator, Benchmark, The Daily, The Village) are pinned in their brief 16 wording.
    - The late-kind tests now read a spot page whose spot is Fabricator: Brazil and Benchmark take `family_lean`, then `own_family` once `family_lean` is off, then the line alone. `own_family` is switched back on inside the rollback for that test, so the mechanism stays tested.
    - The tag-row test switches the four rows back on inside the rollback and still proves first-match order. While looking, the tag is the distance whatever those rows say.
    - The quiz-taken-by-someone-else test now expects no tags.
    - The "elsewhere" test expects answers only on spot pages.
  - **dialMap14:** Blossom's looked-at card is its spot-page card; there is no lead while looking (also with `dial_spot_not_lead_when_looking` at 0); Brazil shows "Lighter, and simpler." and its line.
  - **dialMap9 and dialMap10:** with reuse off, person 85's Geometric carries its line alone (own_family is off).
  - Every test helper that applies the brief 15 seed now applies the brief 16 seed too, so the suites hold after a fresh test DB.

### In the browser (local, test DB, the Zzz test admin, whose spot is Tiger Stripe)

- **Spot page, laptop and phone:** exactly the current text. Blossom leads under "Where we'd take you next"; there are no tags.
- **The walk, by clicking each step card's name:**

  | coffee | tag | card |
  |---|---|---|
  | The Daily | One step from your spot | her spot-page card |
  | Amsterdam | Outside your comfort zone · 2 steps from your spot | "Less fruit, and bolder." and its line |
  | Great Heights | Outside your comfort zone · 3 steps from your spot | "Less fruit, and much bolder." and its line |
  | Big City | Outside your comfort zone · 4 steps from your spot | "Less fruit, and far bolder." and its line |

  The count rises by one at each step, and "Outside your comfort zone" appears from Amsterdam on.
- **The Village** (via Geometric and La Familia): "Outside your comfort zone · 3 steps from your spot · More fruit, lighter, and more delicate."
- **While looking:** no page shows "Where we'd take you next"; the step cards are equals under "One step from {coffee}", each with its distance from Tiger Stripe.
- **Text checks:** no page errors; no banned word ("elsewhere" included); none of her answers outside the comfort zone or on a step card while looking.
- **Admin:**
  - The comfort zone set to 2 saved (HTTP 200). Amsterdam then read "2 steps from your spot" and Great Heights "Outside your comfort zone · 3 steps from your spot". Set back to 1 (HTTP 200; the card shows current 1, previous 2).
  - "Read it as" showed, for Amsterdam: "tag by outside_comfort · 2 steps from the spot · way Less fruit → The Daily · Bolder → Amsterdam · summary shown (less fruit, bolder)". "Look at" and "Back to the spot" both worked.
- **Clean-up:** the test admin was demoted afterwards and the servers stopped.
- **Unchanged:** every `dial_surface` row is still model 1 (`lane`), and nothing under the Bloom page outside `map/` changed.
- **Screenshots** (in this folder):
  - `map16_{laptop,phone}_looking_the_daily.png`
  - `map16_{laptop,phone}_looking_amsterdam.png`
  - `map16_{laptop,phone}_looking_big_city.png`
  - `map16_{laptop,phone}_looking_the_village.png`
  - `map16_admin_parameters.png`
  - `map16_admin_read_it_as.png`

### Deviations, for Dana to see

1. **Copy rows and parameters** are seeded in `schema.sql` (insert if missing), as in brief 15. The production seed reports them as "same".
2. **One step, not two.** Only one step carried "More body, keep the fruit" (La Familia → Geometric, #2922). Task 0 named two by mistake; corrected above. Its line already keeps the fruit, so only the word changed.
3. **"More X" and "less X"** is matched in code by a pattern of your wording (Q2). Opposite moves come from `dial_move.opposite_move_id`. The word rule has no row of its own; say if you want one.
4. **A comfort zone of 2 or more** changes the label only. A coffee at 2 steps has no spot-page card to repeat, so its looked-at card is still the summary and line, with no answer quoted. Answers appear only on cards that exist on the spot page.
5. **"Read it as" reads looked-at pages** through the existing admin route, extended with `?at=`. No new reader.
6. **`dial_spot_not_lead_when_looking`** (brief 14) has no effect any more, since no step leads while looking. It is listed in OT-198 with the rows switched off.
7. **The copy writer trims its text.** Editing `path_join` or `path_last_join` on `/admin/map` would drop the trailing space (OT-199). The schema seed carries the space.
8. **Half Moon is hidden from a regular customer** by its own category tag (any tagged coffee is, under the existing rule), as well as having no way to it from a regular spot.

## Part E STOP: what Dana asked to see

As built on the test DB, whose map is identical to production's except for the renamed word. Comfort zone 1, at most 3 kinds of change. Source: `backend/tmp/em16_counts_test.md`.

### For every spot: what each other coffee's "Looking at" card gets

| spot | its spot-page card (inside the zone) | summary + line | tag + line only: opposites | tag + line only: over the limit | no way |
|---|---|---|---|---|---|
| Amsterdam | 2 | 10 | 2 | 1 | 2 |
| Benchmark | 3 | 12 | 0 | 0 | 2 |
| Big City | 1 | 11 | 2 | 1 | 2 |
| Blossom | 3 | 7 | 3 | 2 | 2 |
| Brazil | 2 | 8 | 0 | 5 | 2 |
| Cafè Feminista | 1 | 2 | 10 | 2 | 2 |
| D.R. Congo | 1 | 9 | 5 | 0 | 2 |
| Fabricator | 4 | 10 | 0 | 1 | 2 |
| Geometric | 4 | 11 | 0 | 0 | 2 |
| Great Heights | 2 | 10 | 2 | 1 | 2 |
| Half Moon | 1 | 0 | 0 | 0 | 16 |
| Indonesia | 1 | 6 | 3 | 5 | 2 |
| La Familia | 3 | 11 | 1 | 0 | 2 |
| Nightcap Decaf | 1 | 0 | 0 | 0 | 16 |
| The Daily | 3 | 11 | 0 | 1 | 2 |
| The Village | 2 | 10 | 1 | 2 | 2 |
| The Waverly | 1 | 9 | 5 | 0 | 2 |
| Tiger Stripe | 5 | 9 | 0 | 1 | 2 |
| **all 18 spots** | 40 | 146 | 34 | 22 | 64 |

### Tiger Stripe as the spot

| coffee | distance | tag | way | the card gets | summary |
|---|---|---|---|---|---|
| Amsterdam | 2 | Outside your comfort zone · 2 steps from your spot | Less fruit → The Daily · Bolder → Amsterdam | summary + line | Less fruit, and bolder. |
| Benchmark | 2 | Outside your comfort zone · 2 steps from your spot | Less fruit → The Daily · Lighter → Benchmark | summary + line | Less fruit, and lighter. |
| Big City | 4 | Outside your comfort zone · 4 steps from your spot | Less fruit → The Daily · Bolder → Amsterdam · Bolder → Great Heights · Bolder → Big City | summary + line | Less fruit, and far bolder. |
| Blossom | 1 | One step from your spot | Bolder → Blossom | its spot-page card | - |
| Brazil | 2 | Outside your comfort zone · 2 steps from your spot | Lighter → Fabricator · Simpler → Brazil | summary + line | Lighter, and simpler. |
| Cafè Feminista | 4 | Outside your comfort zone · 4 steps from your spot | More fruit → Geometric · Lighter → La Familia · More delicate → The Village · More tropical → Cafè Feminista | tag + line (4 kinds of change) | - |
| D.R. Congo | 2 | Outside your comfort zone · 2 steps from your spot | More fruit → Geometric · Lighter → D.R. Congo | summary + line | More fruit, and lighter. |
| Fabricator | 1 | One step from your spot | Lighter → Fabricator | its spot-page card | - |
| Geometric | 1 | One step from your spot | More fruit → Geometric | its spot-page card | - |
| Great Heights | 3 | Outside your comfort zone · 3 steps from your spot | Less fruit → The Daily · Bolder → Amsterdam · Bolder → Great Heights | summary + line | Less fruit, and much bolder. |
| Half Moon | - | A different part of the map | - | tag + line (no way) | - |
| Indonesia | 2 | Outside your comfort zone · 2 steps from your spot | Bolder → Blossom · Earthier → Indonesia | summary + line | Bolder, and earthier. |
| La Familia | 2 | Outside your comfort zone · 2 steps from your spot | More fruit → Geometric · Lighter → La Familia | summary + line | More fruit, and lighter. |
| Nightcap Decaf | - | A different part of the map | - | tag + line (no way) | - |
| The Daily | 1 | One step from your spot | Less fruit → The Daily | its spot-page card | - |
| The Village | 3 | Outside your comfort zone · 3 steps from your spot | More fruit → Geometric · Lighter → La Familia · More delicate → The Village | summary + line | More fruit, lighter, and more delicate. |
| The Waverly | 1 | One step from your spot | More fruit → The Waverly | its spot-page card | - |

### The 56 cards that show the tag and line only (no summary), with the kinds of change on the way

| spot | coffee | distance | kinds of change | why |
|---|---|---|---|---|
| Amsterdam | Blossom | 3 | lighter, more fruit, bolder | a change and its opposite |
| Amsterdam | Cafè Feminista | 5 | lighter, brighter, more delicate, more tropical | 4 kinds of change |
| Amsterdam | Indonesia | 4 | lighter, more fruit, bolder, earthier | a change and its opposite |
| Big City | Blossom | 5 | lighter, more fruit, bolder | a change and its opposite |
| Big City | Cafè Feminista | 7 | lighter, brighter, more delicate, more tropical | 4 kinds of change |
| Big City | Indonesia | 6 | lighter, more fruit, bolder, earthier | a change and its opposite |
| Blossom | Amsterdam | 3 | brighter, less fruit, bolder | a change and its opposite |
| Blossom | Big City | 5 | brighter, less fruit, bolder | a change and its opposite |
| Blossom | Cafè Feminista | 5 | brighter, more fruit, lighter, more delicate, more tropical | 5 kinds of change |
| Blossom | Great Heights | 4 | brighter, less fruit, bolder | a change and its opposite |
| Blossom | The Village | 4 | brighter, more fruit, lighter, more delicate | 4 kinds of change |
| Brazil | Amsterdam | 4 | more going on, more body, less fruit, bolder | 4 kinds of change |
| Brazil | Big City | 6 | more going on, more body, less fruit, bolder | 4 kinds of change |
| Brazil | Cafè Feminista | 5 | more going on, more fruit, lighter, more delicate, more tropical | 5 kinds of change |
| Brazil | Great Heights | 5 | more going on, more body, less fruit, bolder | 4 kinds of change |
| Brazil | The Village | 4 | more going on, more fruit, lighter, more delicate | 4 kinds of change |
| Cafè Feminista | Amsterdam | 5 | more delicate, sweeter, more body, bolder | a change and its opposite |
| Cafè Feminista | Big City | 7 | more delicate, sweeter, more body, bolder | a change and its opposite |
| Cafè Feminista | Blossom | 5 | more delicate, sweeter, more body, bolder | a change and its opposite |
| Cafè Feminista | Brazil | 5 | more delicate, sweeter, more body, more going on, simpler | 5 kinds of change |
| Cafè Feminista | D.R. Congo | 4 | more delicate, sweeter, more body, lighter | a change and its opposite |
| Cafè Feminista | Fabricator | 4 | more delicate, sweeter, more body, more going on | 4 kinds of change |
| Cafè Feminista | Geometric | 3 | more delicate, sweeter, more body | a change and its opposite |
| Cafè Feminista | Great Heights | 6 | more delicate, sweeter, more body, bolder | a change and its opposite |
| Cafè Feminista | Indonesia | 6 | more delicate, sweeter, more body, bolder, earthier | a change and its opposite |
| Cafè Feminista | The Daily | 4 | more delicate, sweeter, more body, bolder | a change and its opposite |
| Cafè Feminista | The Waverly | 5 | more delicate, sweeter, more body, more fruit | a change and its opposite |
| Cafè Feminista | Tiger Stripe | 4 | more delicate, sweeter, more body | a change and its opposite |
| D.R. Congo | Benchmark | 3 | more body, lighter | a change and its opposite |
| D.R. Congo | Brazil | 3 | more body, less fruit, simpler | a change and its opposite |
| D.R. Congo | Cafè Feminista | 4 | more body, lighter, more delicate, more tropical | a change and its opposite |
| D.R. Congo | La Familia | 2 | more body, lighter | a change and its opposite |
| D.R. Congo | The Village | 3 | more body, lighter, more delicate | a change and its opposite |
| Fabricator | Cafè Feminista | 4 | more fruit, lighter, more delicate, more tropical | 4 kinds of change |
| Great Heights | Blossom | 4 | lighter, more fruit, bolder | a change and its opposite |
| Great Heights | Cafè Feminista | 6 | lighter, brighter, more delicate, more tropical | 4 kinds of change |
| Great Heights | Indonesia | 5 | lighter, more fruit, bolder, earthier | a change and its opposite |
| Indonesia | Amsterdam | 4 | cleaner, brighter, less fruit, bolder | a change and its opposite |
| Indonesia | Benchmark | 4 | cleaner, brighter, less fruit, lighter | 4 kinds of change |
| Indonesia | Big City | 6 | cleaner, brighter, less fruit, bolder | a change and its opposite |
| Indonesia | Cafè Feminista | 6 | cleaner, brighter, more fruit, lighter, more delicate, more tropical | 6 kinds of change |
| Indonesia | D.R. Congo | 4 | cleaner, brighter, more fruit, lighter | 4 kinds of change |
| Indonesia | Great Heights | 5 | cleaner, brighter, less fruit, bolder | a change and its opposite |
| Indonesia | La Familia | 4 | cleaner, brighter, more fruit, lighter | 4 kinds of change |
| Indonesia | The Village | 5 | cleaner, brighter, more fruit, lighter, more delicate | 5 kinds of change |
| La Familia | D.R. Congo | 2 | more body, lighter | a change and its opposite |
| The Daily | Cafè Feminista | 4 | lighter, brighter, more delicate, more tropical | 4 kinds of change |
| The Village | Brazil | 4 | sweeter, more body, more going on, simpler | 4 kinds of change |
| The Village | D.R. Congo | 3 | sweeter, more body, lighter | a change and its opposite |
| The Village | Indonesia | 5 | sweeter, more body, bolder, earthier | 4 kinds of change |
| The Waverly | Cafè Feminista | 5 | less fruit, more fruit, lighter, more delicate, more tropical | a change and its opposite |
| The Waverly | D.R. Congo | 3 | less fruit, more fruit, lighter | a change and its opposite |
| The Waverly | Geometric | 2 | less fruit, more fruit | a change and its opposite |
| The Waverly | La Familia | 3 | less fruit, more fruit, lighter | a change and its opposite |
| The Waverly | The Village | 4 | less fruit, more fruit, lighter, more delicate | a change and its opposite |
| Tiger Stripe | Cafè Feminista | 4 | more fruit, lighter, more delicate, more tropical | 4 kinds of change |

### The pages of Task 0 item 4, as built

Composed by the built `steps()` on the test DB. Dana's pages come from the Zzz test admin, whose spot page matches hers card for card; persons 85, 33 and 23 are read as their start rule. Dana's Half Moon: 404 NOT_ON_MAP (decaf).

#### Dana

- **Top**: Coffee should feel like a reward for you: warm, rich, comforting. A little bitterness tastes serious to you. Chocolate first, with a little lift. Built for espresso.
- **Lead** **Blossom**: For you, a good cup is strong and satisfying. A darker roast than Tiger Stripe, with a fuller body.
- **Geometric**: Next to your coffee, you'd reach for something fresh and lively. More fruit than Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it.
- **The Daily**: Coffee is a daily ritual for you, and you're particular about it. Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite.
- **Fabricator**: You taste a black coffee first, then make it richer. Tiger Stripe with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body.
- **The Waverly**: A coffee with no bitterness would bother you. Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange.

#### Dana looking at The Daily

- **Top** · One step from your spot: Coffee is a daily ritual for you, and you're particular about it. Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite.
- **Benchmark** · Outside your comfort zone · 2 steps from your spot: The same chocolate as The Daily, rounder and softer.
- **Amsterdam** · Outside your comfort zone · 2 steps from your spot: A step darker than The Daily: smoother, with less acidity.
- **Tiger Stripe** · Your spot: The Daily with a fruit edge: chocolate first, cherry behind. Built for espresso.

#### Dana looking at Fabricator

- **Top** · One step from your spot: You taste a black coffee first, then make it richer. Tiger Stripe with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body.
- **Geometric** · One step from your spot: Made from the same coffees as Fabricator, with more fruit, and sweeter.
- **Brazil** · Outside your comfort zone · 2 steps from your spot: Simpler than Fabricator: chocolate, almond, honey.
- **Tiger Stripe** · Your spot: More body than Fabricator, with cherry where the citrus was. Built for espresso.
- **Benchmark** · Outside your comfort zone · 2 steps from your spot: Rounder than Fabricator: pure chocolate, softer, no citrus.

#### Dana looking at Benchmark

- **Top** · Outside your comfort zone · 2 steps from your spot: Less fruit, and lighter. This is the cup where nothing sticks out: pure chocolate, round and soft.
- **The Daily** · One step from your spot: The same chocolate as Benchmark, livelier, with a bit more bite.
- **La Familia** · Outside your comfort zone · 2 steps from your spot: Lighter in the cup than Benchmark: caramel and honey, with a little clementine.
- **Fabricator** · One step from your spot: More going on than Benchmark: hazelnut, a little citrus, a dry finish.

#### Dana looking at Amsterdam

- **Top** · Outside your comfort zone · 2 steps from your spot: Less fruit, and bolder. Deep and smooth, with dark chocolate and walnut.
- **Great Heights** · Outside your comfort zone · 3 steps from your spot: The same Brazil as Amsterdam, roasted darker.
- **The Daily** · One step from your spot: Lighter and sweeter than Amsterdam.

#### Dana looking at Great Heights

- **Top** · Outside your comfort zone · 3 steps from your spot: Less fruit, and much bolder. The same idea as Amsterdam, roasted darker.
- **Big City** · Outside your comfort zone · 4 steps from your spot: Darker again than Great Heights: French roast and burnt sugar.
- **Amsterdam** · Outside your comfort zone · 2 steps from your spot: The same Brazil as Great Heights in a lighter roast, with more caramel.

#### Dana looking at Big City

- **Top** · Outside your comfort zone · 4 steps from your spot: Less fruit, and far bolder. French roast and burnt sugar.
- **Great Heights** · Outside your comfort zone · 3 steps from your spot: Less smoke than Big City, more fudge.

#### Dana looking at The Village

- **Top** · Outside your comfort zone · 3 steps from your spot: More fruit, lighter, and more delicate. Floral, with apple blossom and grapefruit.
- **Cafè Feminista** · Outside your comfort zone · 4 steps from your spot: Creamier than The Village: papaya and candied coconut.
- **La Familia** · Outside your comfort zone · 2 steps from your spot: Softer and sweeter than The Village: caramel and honey.

#### Dana looking at Brazil

- **Top** · Outside your comfort zone · 2 steps from your spot: Lighter, and simpler. The base on its own: chocolate, almond and honey.
- **Blossom** · One step from your spot: Darker than Brazil, with a fuller body.
- **Fabricator** · One step from your spot: More going on than Brazil: citrus and spice added.

#### Dana looking at Cafè Feminista

- **Top** · Outside your comfort zone · 4 steps from your spot: Soft and tropical, with papaya and candied coconut.
- **The Village** · Outside your comfort zone · 3 steps from your spot: More delicate than Cafè Feminista: more floral, with grapefruit.

#### Dana: NOT_ON_MAP


#### P85 (read as the start rule)

- **Top**: You'd rather have something gentler. For you, a good cup is smooth and easy the whole way. You're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end.
- **Lead** **The Village**: A little further the same way: just as light, with more flower and citrus in it.
- **Benchmark**: Too bitter is what would bother you most. Rounder than La Familia: pure chocolate, less fruit.
- **Geometric**: You're still discovering coffee. Keeps the fruit of La Familia and adds weight: bright fruit over caramel.

#### P85 looking at Benchmark (read as the start rule)

- **Top** · One step from your spot: Too bitter is what would bother you most. Rounder than La Familia: pure chocolate, less fruit.
- **The Daily** · Outside your comfort zone · 2 steps from your spot: The same chocolate as Benchmark, livelier, with a bit more bite.
- **La Familia** · Your spot: Lighter in the cup than Benchmark: caramel and honey, with a little clementine.
- **Fabricator** · Outside your comfort zone · 2 steps from your spot: More going on than Benchmark: hazelnut, a little citrus, a dry finish.

#### P85 looking at Amsterdam (read as the start rule)

- **Top** · Outside your comfort zone · 3 steps from your spot: More body, and much bolder. Deep and smooth, with dark chocolate and walnut.
- **Great Heights** · Outside your comfort zone · 4 steps from your spot: The same Brazil as Amsterdam, roasted darker.
- **The Daily** · Outside your comfort zone · 2 steps from your spot: Lighter and sweeter than Amsterdam.

#### P33 (read as the start rule)

- **Top**: A little bitterness tastes serious to you. A coffee with no bitterness would bother you. This is chocolate with some strength: our everyday cup.
- **Lead** **Amsterdam**: The next size up in strength: darker and smoother.
- **Benchmark**: For you, a good cup is smooth and easy the whole way. The same chocolate as The Daily, rounder and softer.
- **Tiger Stripe**: With a black coffee, your first thought is what flavors are in it. The Daily with a fruit edge: chocolate first, cherry behind. Built for espresso.

#### P33 looking at Benchmark (read as the start rule)

- **Top** · One step from your spot: For you, a good cup is smooth and easy the whole way. The same chocolate as The Daily, rounder and softer.
- **The Daily** · Your spot: The same chocolate as Benchmark, livelier, with a bit more bite.
- **La Familia** · Outside your comfort zone · 2 steps from your spot: Lighter in the cup than Benchmark: caramel and honey, with a little clementine.
- **Fabricator** · Outside your comfort zone · 2 steps from your spot: More going on than Benchmark: hazelnut, a little citrus, a dry finish.

#### P33 looking at The Village (read as the start rule)

- **Top** · Outside your comfort zone · 3 steps from your spot: Lighter, brighter, and more delicate. Floral, with apple blossom and grapefruit.
- **Cafè Feminista** · Outside your comfort zone · 4 steps from your spot: Creamier than The Village: papaya and candied coconut.
- **La Familia** · Outside your comfort zone · 2 steps from your spot: Softer and sweeter than The Village: caramel and honey.

#### P23 (read as the start rule)

- **Top**: Bitter coffee tastes burnt to you. For you, a good cup feels alive and changes as you drink it. Coffee is a daily ritual for you, and you're particular about it. So: bright fruit, with caramel under it to make it an everyday cup.
- **Lead** **La Familia**: Lighter and sweeter: caramel, honey, a little clementine.
- **Fabricator**: A cup where every sip tastes the same would bother you. Made from the same coffees as Geometric, with less fruit: drier and nuttier.
- **Tiger Stripe**: Coffee is a daily ritual for you, and you're particular about it. More chocolate and body than Geometric, with the fruit behind.
- **D.R. Congo**: With a black coffee, your first thought is what flavors are in it. Lighter than Geometric: clementine and nectarine over caramel and light chocolate.

#### P23 looking at Fabricator (read as the start rule)

- **Top** · One step from your spot: A cup where every sip tastes the same would bother you. Made from the same coffees as Geometric, with less fruit: drier and nuttier.
- **Geometric** · Your spot: Made from the same coffees as Fabricator, with more fruit, and sweeter.
- **Brazil** · Outside your comfort zone · 2 steps from your spot: Simpler than Fabricator: chocolate, almond, honey.
- **Tiger Stripe** · One step from your spot: More body than Fabricator, with cherry where the citrus was. Built for espresso.
- **Benchmark** · Outside your comfort zone · 2 steps from your spot: Rounder than Fabricator: pure chocolate, softer, no citrus.

#### P23 looking at Big City (read as the start rule)

- **Top** · Outside your comfort zone · 5 steps from your spot: More body, less fruit, and far bolder. French roast and burnt sugar.
- **Great Heights** · Outside your comfort zone · 4 steps from your spot: Less smoke than Big City, more fudge.

**STOP.** Nothing committed or pushed; production untouched. After Dana's yes: commit by path and push (the deploy seeds the copy rows and the parameters); then, on production, the seed dry run and apply (L7), the read-back, the counts above again, `catalog:md` and the smoke of `/map`.

## Dana's change before the push (2026-11-28): opposite words come from the step rows. STOPPED

Dana: remove the "more X / less X" pattern. Two step words are opposites when they are the two directions of the same step pair on the active map, read from the step rows, in addition to the opposite moves. No new table.

**Built.**
- `matchService.stepWordOpposites` reads the pairs from `dialReads.activeStepWords`: A -> B says one word, B -> A the other.
- `hasOpposite` uses those pairs and the `dial_move` opposites. The pattern is removed.
- No new table or reader.
- The pure tests pass, including a new check that "Less fruit" and "More fruit" are not opposites unless a step pair makes them so.

**STOPPED: a Tiger Stripe row changed.** Cafè Feminista still gets the tag and line only, but now for a different reason. Its way names more delicate and more tropical, which are the two directions of The Village <-> Cafè Feminista, so they count as opposites. It used to be "4 kinds of change". The customer sees the same card. Every other Tiger Stripe row is unchanged.

| coffee | distance | way | before | now |
|---|---|---|---|---|
| Cafè Feminista | 4 | More fruit -> Geometric · Lighter -> La Familia · More delicate -> The Village · More tropical -> Cafè Feminista | tag + line (4 kinds of change) | tag + line (a change and its opposite) |

**All 18 spots** (`backend/tmp/em16_counts_test.md`):

| | spot-page card | summary + line | tag + line: opposites | tag + line: over the limit | no way |
|---|---|---|---|---|---|
| before (word pattern) | 40 | 146 | 34 | 22 | 64 |
| now (step pairs) | 40 | 132 | 60 | 10 | 64 |

The step pairs make some words opposites that the pattern did not:
- more body / more fruit (Tiger Stripe <-> Geometric);
- more delicate / sweeter;
- more delicate / more tropical;
- more going on / simpler;
- more going on / rounder;
- earthier / cleaner.

Summaries the step pairs remove that opposite moves alone would show (the last three were already removed by the pattern):

| spot | coffee | distance | summary it had | step-pair opposites on the way |
|---|---|---|---|---|
| Benchmark | Brazil | 2 | More going on, and simpler. | more going on / simpler |
| Benchmark | Cafè Feminista | 3 | Brighter, more delicate, and more tropical. | more delicate / more tropical |
| Brazil | Benchmark | 2 | More going on, and rounder. | more going on / rounder |
| Cafè Feminista | Benchmark | 3 | More delicate, sweeter, and more body. | more delicate / sweeter |
| Cafè Feminista | La Familia | 2 | More delicate, and sweeter. | more delicate / sweeter |
| D.R. Congo | The Waverly | 3 | Much more body, and more fruit. | more body / more fruit |
| Fabricator | The Waverly | 2 | More body, and more fruit. | more body / more fruit |
| Geometric | Cafè Feminista | 3 | Lighter, more delicate, and more tropical. | more delicate / more tropical |
| Geometric | The Waverly | 2 | More body, and more fruit. | more body / more fruit |
| La Familia | Brazil | 3 | More body, more going on, and simpler. | more going on / simpler |
| La Familia | Cafè Feminista | 2 | More delicate, and more tropical. | more delicate / more tropical |
| La Familia | The Waverly | 3 | Much more body, and more fruit. | more body / more fruit |
| The Village | The Waverly | 4 | Sweeter, much more body, and more fruit. | more body / more fruit |
| The Waverly | D.R. Congo | 3 | Less fruit, more fruit, and lighter. | less fruit / more fruit |
| The Waverly | Geometric | 2 | Less fruit, and more fruit. | less fruit / more fruit |
| The Waverly | La Familia | 3 | Less fruit, more fruit, and lighter. | less fruit / more fruit |

**Dana, 2026-11-28: go ahead with the rule as it stands.** The 13 lost summaries and the option of an explicit opposites list are logged as OT-200. Part E follows.

## Part E, on production (2026-11-28). DONE

1. **Tests before the push.**
   - The brief 16 tests pass 13 of 13. One pin was updated for the amended rule: Cafè Feminista's reason is now "a change and its opposite" (more delicate and more tropical are the two directions of one step pair); the customer still sees the tag and the line only.
   - All six lints pass. Backend tsc is clean; frontend tsc shows only the 7 known errors.
2. **Commit and deploy.**
   - Committed by path as 93d001e (33 files, the ten screenshots included; not `commerce/CLOSING_REPORT_6.md`, the Genova fonts or `misc/`) and pushed.
   - The Deploy run succeeded and revision 00911 is serving.
   - The boot added the 8 copy rows (read back word for word, `path_join` with its space) and the two parameters (1 and 3).
   - The startup log has no ERROR. `[data-catalog]` reported #6 (dead tables, already there) and #4 (CATALOG.md stale until regenerated in step 5).
3. **Seed.**
   - The dry run planned 7 writes: 5 rows off, step #99 renamed, the publish. The copy rows showed as "same".
   - The apply wrote 6 rows and published "L7 measured from your spot (Ella map 16)" as v9 (18 placements), retiring v8.
   - A rerun plans 0 writes.
   - Output: `backend/tmp/em16_seed_prod_dry.md` and `backend/tmp/em16_seed_prod_apply.md`.
4. **Read back.**
   - `own_family` and the four `spot_relation` rows are off; `family_lean` and the other step supports are on, in order.
   - Step #113 (La Familia -> Geometric, the successor of #99) reads "More body", move `bolder`, basis `our_guess`. Its line "Keeps the fruit of {from} and adds weight: bright fruit over caramel." and its card clause are kept.
   - No step word with a comma is left on the active map.
   - v9 is active and v8 retired; 18 placements.
5. **The counts again**, on production (`backend/tmp/em16_counts_prod.md`). They are identical to the test DB, row for row.

| spot | its spot-page card (inside the zone) | summary + line | tag + line only: opposites | tag + line only: over the limit | no way |
|---|---|---|---|---|---|
| Amsterdam | 2 | 10 | 3 | 0 | 2 |
| Benchmark | 3 | 10 | 2 | 0 | 2 |
| Big City | 1 | 11 | 3 | 0 | 2 |
| Blossom | 3 | 7 | 4 | 1 | 2 |
| Brazil | 2 | 6 | 3 | 4 | 2 |
| Cafè Feminista | 1 | 0 | 14 | 0 | 2 |
| D.R. Congo | 1 | 8 | 6 | 0 | 2 |
| Fabricator | 4 | 9 | 2 | 0 | 2 |
| Geometric | 4 | 9 | 2 | 0 | 2 |
| Great Heights | 2 | 10 | 3 | 0 | 2 |
| Half Moon | 1 | 0 | 0 | 0 | 16 |
| Indonesia | 1 | 6 | 4 | 4 | 2 |
| La Familia | 3 | 8 | 4 | 0 | 2 |
| Nightcap Decaf | 1 | 0 | 0 | 0 | 16 |
| The Daily | 3 | 11 | 1 | 0 | 2 |
| The Village | 2 | 9 | 3 | 1 | 2 |
| The Waverly | 1 | 9 | 5 | 0 | 2 |
| Tiger Stripe | 5 | 9 | 1 | 0 | 2 |
| **all 18 spots** | 40 | 132 | 60 | 10 | 64 |

   **Tiger Stripe as the spot:**

| coffee | distance | tag | way | the card gets | summary |
|---|---|---|---|---|---|
| Amsterdam | 2 | Outside your comfort zone · 2 steps from your spot | Less fruit → The Daily · Bolder → Amsterdam | summary + line | Less fruit, and bolder. |
| Benchmark | 2 | Outside your comfort zone · 2 steps from your spot | Less fruit → The Daily · Lighter → Benchmark | summary + line | Less fruit, and lighter. |
| Big City | 4 | Outside your comfort zone · 4 steps from your spot | Less fruit → The Daily · Bolder → Amsterdam · Bolder → Great Heights · Bolder → Big City | summary + line | Less fruit, and far bolder. |
| Blossom | 1 | One step from your spot | Bolder → Blossom | its spot-page card | - |
| Brazil | 2 | Outside your comfort zone · 2 steps from your spot | Lighter → Fabricator · Simpler → Brazil | summary + line | Lighter, and simpler. |
| Cafè Feminista | 4 | Outside your comfort zone · 4 steps from your spot | More fruit → Geometric · Lighter → La Familia · More delicate → The Village · More tropical → Cafè Feminista | tag + line (a change and its opposite) | - |
| D.R. Congo | 2 | Outside your comfort zone · 2 steps from your spot | More fruit → Geometric · Lighter → D.R. Congo | summary + line | More fruit, and lighter. |
| Fabricator | 1 | One step from your spot | Lighter → Fabricator | its spot-page card | - |
| Geometric | 1 | One step from your spot | More fruit → Geometric | its spot-page card | - |
| Great Heights | 3 | Outside your comfort zone · 3 steps from your spot | Less fruit → The Daily · Bolder → Amsterdam · Bolder → Great Heights | summary + line | Less fruit, and much bolder. |
| Half Moon | - | A different part of the map | - | tag + line (no way) | - |
| Indonesia | 2 | Outside your comfort zone · 2 steps from your spot | Bolder → Blossom · Earthier → Indonesia | summary + line | Bolder, and earthier. |
| La Familia | 2 | Outside your comfort zone · 2 steps from your spot | More fruit → Geometric · Lighter → La Familia | summary + line | More fruit, and lighter. |
| Nightcap Decaf | - | A different part of the map | - | tag + line (no way) | - |
| The Daily | 1 | One step from your spot | Less fruit → The Daily | its spot-page card | - |
| The Village | 3 | Outside your comfort zone · 3 steps from your spot | More fruit → Geometric · Lighter → La Familia · More delicate → The Village | summary + line | More fruit, lighter, and more delicate. |
| The Waverly | 1 | One step from your spot | More fruit → The Waverly | its spot-page card | - |

6. **Catalog.** CATALOG.md was regenerated from axisandbloom (235 tables, 123 views, 2,013 columns). Its hash 62135b5a… matches the live hash in the boot log.
7. **Smoke** (`backend/tmp/em16_smoke_prod.mts`, read-only, the deployed code, Dana's account; output `backend/tmp/em16_smoke_prod.md`). 0 problems.
   - **Her spot page** is word for word as before: Blossom leads, and the step cards have no tags.
   - **The Daily and Fabricator** are each "One step from your spot", with her spot-page card exactly.
   - **Further out:**

     | coffee | tag | card |
     |---|---|---|
     | Benchmark | 2 steps | "Less fruit, and lighter." and its line |
     | Amsterdam | 2 steps | "Less fruit, and bolder." and its line |
     | Great Heights | 3 steps | "Less fruit, and much bolder." and its line |
     | Big City | 4 steps | "Less fruit, and far bolder." and its line |
     | The Village | 3 steps | "More fruit, lighter, and more delicate." and its line |
     | Brazil | 2 steps | "Lighter, and simpler." and its line |
     | Cafè Feminista | 4 steps | its line only |

     Each tag from 2 steps on reads "Outside your comfort zone · n steps from your spot".
   - **While looking:** no lead, every step card has a distance tag, and none quotes an answer. No answer appears outside the comfort zone, and no customer text says "elsewhere".
   - **Not on the map:** `?at=999999` and Half Moon both return 404 NOT_ON_MAP.
   - The production web.app is behind the Cloudflare bot check, and the API needs a signed-in customer, so the smoke reads through the service, as in briefs 14 and 15. The browser acceptance ran locally on the test DB (above).

