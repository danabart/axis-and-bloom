# Closing report: Ella map 15, every card says something about you

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_15_CARDS_ABOUT_YOU.md` · Run 2026-11-27.

**Status:** Task 0 done. **STOPPED for Dana.** Nothing changed: no code, no database, no commit.

- **G1.9:** one peer session (danab-0a) was listed. It confirmed it was idle, with nothing running in the repo, on the test DB or in a deploy.
- **Uncommitted file I didn't make:** `ella_bloom_map/README.md` has an edit from the CTO session that adds the brief 15 and 16 lines. I left it alone.
- **How the data was read:** every read ran inside `BEGIN READ ONLY … ROLLBACK`, on production and the test DB. The runners are git-ignored under `backend/tmp/`:
  - `em14_ro.mjs`: the SQL files `em15_q*.sql`.
  - `em15_words_prod.mts`: the roaster's words for item 3.
  - `em15_pages_prod.mts`: today's composed pages, plus each person's facts, from the real `matchService.steps`.
- **How the item 6 pages were built:** by hand, from today's output with the new rows applied.

## Task 0

### 1. Reader, writer, view and table list (G3.9 amended)

**Tables and views**

| | new | changed |
|---|---|---|
| Tables | none | Rows only (below) |
| Views | none | none |

**Rows, each through its existing writer**

| table | rows | writer |
|---|---|---|
| `dial_reason_choice_kind` | +1 `spot_relation` | `seed` (this table has no writer function), so it's a seed line in `schema.sql`. See Q3. |
| `dial_reason_choice` | +5 (`family_lean`, `own_family`, `same_family`, `leans_together`, `other_direction`), **plus 2 renumbered rows** (`direction` 3→4, `treat` 4→5). See Q2. | `dialPlacementService.setReasonChoiceInTx` |
| `dial_customer_copy` | +5 (Data 3) | `dialPlacementService.setCustomerCopyInTx` |
| `dial_step` | +4 (Data 1), basis `our_guess` | `dialPlacementService.setStepInTx` |
| `dial_map_version` | the next `L<n>` (L6 on production) | `dialPlacementService.publishInTx` |

**Readers.** No new one. One existing reader changes:
- `dialReads.mapCoffees` gains one column: the coffee's lean family, from a join to `v_dial_wedge_lane` (item 2).
- `mapFacts` then gives `lean(id)`.
- `v_dial_wedge_lane`'s `Readers:` gains `dialReads.mapCoffees` (comments.sql). See Q4.

**Writers.** None new.

**Code changed**
- `matchService.steps`.
- `KNOWN_REASON_CHOICES` gains `family_lean`, `own_family` and a `spot_relation` list. Without them, check 15 reports the new rows as unknown.
- `dataCatalogIntegrity.DIAL_COPY_CODES` gains the 5 codes.

**Frontend**
- `MapPage`: the tag and the heading; `mapCustomer` types.
- `AdminEllaMapReasons`. It already groups the choice rows by kind, so `spot_relation` shows as its own group with no new code. "Read it as" gains the tag row.

**New file:** the seed script `ellaMapCardsAboutYou_2026_11_27.ts`, named in the brief.

**Not as expected:** the brief expected no schema touch. There are two small ones:
- the kind row's seed line in `schema.sql`;
- the `comments.sql` text that lists the codes: the `dial_reason_choice` and `dial_reason_choice_kind` Purpose lines, and `v_dial_wedge_lane`'s Readers.

So `catalog:md` runs in Part E.

### 2. Where the lean comes from

- **Source:** a coffee's lean is its placement's lane. `v_dial_placement.lane_id` joins `v_dial_wedge_lane` on (`archetype_code`, `lane_id`), and `toward_archetype` is the lean family. A `middle` lane has none.
- **`mapFacts` does not read it today.** It reads `family_code` (the placement's family) and `family_branches_from_code` (the family the coffee's quiz branch comes from). That's why Benchmark and Brazil find nothing for Dana.
- **The spot's family and lean** are read the same way, since the spot is always among the ids `mapFacts` loads.

**The map on production** (the same 18 placements on the test DB, five of them under other coffee ids):

| family | coffee: lean (branch from) |
|---|---|
| Balanced | Benchmark, Brazil, Half Moon: all lean Chocolate & Nutty |
| Chocolate & Nutty | The Daily: middle · Blossom, Fabricator, The Waverly, **Tiger Stripe**: lean Fruity · Amsterdam, Great Heights, Nightcap Decaf: lean Earthy |
| Earthy | Indonesia: middle (branch Chocolate & Nutty) · Big City: leans Chocolate & Nutty (branch Chocolate & Nutty) |
| Floral | The Village: leans Fruity (branch Fruity). The only Floral coffee. |
| Fruity | Cafè Feminista, D.R. Congo: middle · Geometric: leans Chocolate & Nutty · La Familia: leans Floral |

### 3. Data 1 beside the roaster's words (production)

**The roaster's words**

| | Tiger Stripe | The Daily | Fabricator |
|---|---|---|---|
| Notes (roaster) | Chocolate, Peanut Butter, Pear, Fig, Almond, Cherry | (none in `flavor_descriptors_roaster`); website: Chocolate, Caramelized, Molasses | Hazelnut, Citrus, Cinnamon, Graham Cracker |
| Shown descriptors | Almond, Chocolate, Peanuts, Cherry, Apple, Dried Fruit | Chocolate, Caramelized, Molasses | Hazelnut, Citrus Fruit, Cinnamon |
| Best brew | Espresso ("classic espresso blend") | Batch brew / drip | Batch brew / drip |
| Roaster's 1–5: acidity · sweetness · bitterness · body | 4 · 4 · 3 · 5 | 2 · 3 · 4 · 3 | 3 · 5 · 3 · 4 |
| `map_line` (ours) | Chocolate first, with a little lift. Built for espresso. | Chocolate with some strength: our everyday cup. | Chocolate and nut first, with a little citrus and a dry finish. |

**The four lines**

| step | Data 1 line | check | proposed word / direction |
|---|---|---|---|
| Tiger Stripe → The Daily | {from} without the fruit: straight chocolate. | "Without the fruit" holds: The Daily has no fruit word. **"Straight chocolate" leaves out the caramel and molasses the roaster names.** Alternative: "{from} without the fruit: chocolate and caramel, with a bit more bite." (bitterness 3→4; "a bit more bite" is already on step 73). | **Less fruit** / different (as on steps 88 and 98) |
| The Daily → Tiger Stripe | {from} with a fruit edge: chocolate first, cherry behind. Built for espresso. | Holds. Chocolate and cherry are both the roaster's (cherry is its first-ranked note on the form); espresso is its best brew. "Chocolate first, cherry behind" is already on step 98. | **More fruit** / different (as on steps 95 and 97) |
| Tiger Stripe → Fabricator | The same chocolate as {from} with a different accent: hazelnut, a little citrus and spice, in a lighter body. | **"The same chocolate" is a claim neither roaster makes for Fabricator.** Its notes and story say hazelnut first; chocolate appears only in our `map_line`. Hazelnut, citrus and spice (cinnamon) hold, and so does "lighter body" (body 5→4). Alternative: "Nuttier than {from}: hazelnut, a little citrus and cinnamon, in a lighter body." | **Lighter** / gentler (body 5→4, acidity 4→3) |
| Fabricator → Tiger Stripe | More body than {from}, with cherry where the citrus was. Built for espresso. | Holds: body 4→5, cherry is Tiger Stripe's, citrus is Fabricator's. | **More body** / bolder (as on step 96, Geometric → Tiger Stripe) |

The words decide the card order within a basis (`basis_sort_order`, then `button_word`). With these four words:
- Dana's spot page: Blossom, Geometric, The Daily, Fabricator, The Waverly.
- Looking at Fabricator: Geometric, Brazil, Tiger Stripe, Benchmark.

### 4. The map with the two pairs added

- **Tiger Stripe's steps out:** Blossom (Bolder), Geometric (More fruit), The Waverly (More fruit), **The Daily** (Less fruit), **Fabricator** (Lighter). Five.
- **Steps into Tiger Stripe:** from Blossom, Geometric, The Waverly, **The Daily** and **Fabricator**.
- **No step exists today** between either pair, on either database (none current, none superseded).
- **Publish moves no placement.** `v_dial_placement_preview` (the rows a publish cuts from) and the active placements match exactly on both databases: family, center, ring, lane and size for all 18 coffees, with 0 differences.
- **Labels:** production is on `L5 step comparisons (Ella map 12)` (v7), so the next is L6. The test DB is on its own L4, so its next is L5. The seed reads the number from each database.

### 5. Answer repetition (spot pages, own_family on)

| person | cards that repeat an answer already on the page | today |
|---|---|---|
| Dana | 1: The Waverly reuses "Coffee should feel like a reward for you", which the top card says. Her six answers now cover 7 slots (top 2, lead, 4 cards). | 0 (3 steps) |
| 85 | 1: Geometric reuses "You're still discovering coffee." Unchanged. | 1 |
| 33 | 0 | 0 |
| 23 | 1: D.R. Congo reuses "Bitter coffee tastes burnt to you." Today the repeat is on Tiger Stripe. | 1 |
| 81 | 0 | 0 |

**`own_family` is never reached on a spot page.** Every card finds support before it, either from the new `family_lean` or from the reuse pass. On these five accounts it shows up only on a "Looking at" card (The Village, below). Every repeat above comes from the reuse pass (`dial_step_reuse_answer` = 1), which exists today.

### 6. The pages, by hand, with the new rows applied

**Reading the pages**
- A card reads: tag · the customer's sentence · the step line.
- Answers are taken in page order. The new rows are tried in this order:
  - **Step cards:** family and direction, family, **family_lean**, direction; then the reuse pass; then treat; then **own_family**.
  - **The lead:** chosen as today, with `family_lean` counted.
- `dial_quote_family_answers` = 2 and `dial_step_reuse_answer` = 1 on production.
- Dana's feeling ("happy") has no said-back row, so it is never quoted.
- The Data 1 lines are as drafted. With the alternatives from item 3, only the words of those two lines change.

**Dana on her spot (Tiger Stripe, Founder's pick).** Five steps. Lead and top card as today.
- **Top** (no tag): "Coffee should feel like a reward for you: warm, rich, comforting. A little bitterness tastes serious to you. Chocolate first, with a little lift. Built for espresso."
- **Lead, Blossom** · Same family as your spot · "For you, a good cup is strong and satisfying. A darker roast than Tiger Stripe, with a fuller body."
- **Geometric** · Close to your spot · (`family_lean`, the Chocolate & Nutty lean) "Coffee is a daily ritual for you, and you're particular about it. More fruit than Tiger Stripe: …"
  - Today this card is the treat ("you'd reach for something fresh and lively"). `family_lean` comes first, so the treat drops off her page. See Q11.
- **The Daily** · Same family as your spot · "You taste a black coffee first, then make it richer. Tiger Stripe without the fruit: straight chocolate."
- **Fabricator** · Same family as your spot · "A coffee with no bitterness would bother you. The same chocolate as Tiger Stripe with a different accent: …" See Q10.
- **The Waverly** · Same family as your spot · (reuse) "Coffee should feel like a reward for you: warm, rich, comforting. Close to Tiger Stripe: chocolate underneath, …"

**Dana looking at Fabricator.**
- **Looking at · Fabricator** · Same family as your spot · "Coffee should feel like a reward for you: warm, rich, comforting. The same chocolate as Tiger Stripe with a different accent: hazelnut, a little citrus and spice, in a lighter body."
- **Lead, Geometric** · Close to your spot · (`family_lean`) "Coffee is a daily ritual for you, and you're particular about it. Made from the same coffees as Fabricator, with more fruit, and sweeter."
  - **New: today this page has no lead.** `family_lean` counts toward the lead, so the lead is Geometric: the three steps tie on `family_lean`, and step order breaks the tie.
- **Brazil** · Close to your spot · "You taste a black coffee first, then make it richer. Simpler than Fabricator: chocolate, almond, honey."
- **Tiger Stripe** · Your spot · (family and direction) "A little bitterness tastes serious to you. More body than Fabricator, with cherry where the citrus was. Built for espresso." Never the lead.
- **Benchmark** · Close to your spot · "For you, a good cup is strong and satisfying. Rounder than Fabricator: pure chocolate, softer, no citrus." See Q10.
- No card says "elsewhere". The treat is unused.

**Dana looking at Benchmark** (no step joins Tiger Stripe and Benchmark, so the direction kinds don't apply to the looked-at card).
- **Looking at · Benchmark** · Close to your spot · (`family_lean`) "Coffee should feel like a reward for you: warm, rich, comforting. This is the cup where nothing sticks out: pure chocolate, round and soft."
- **Lead, The Daily** · Same family as your spot · "A little bitterness tastes serious to you. The same chocolate as Benchmark, livelier, with a bit more bite." As today.
- **La Familia** · Close to your spot · (treat) "Next to your coffee, you'd reach for something fresh and lively. Lighter in the cup than Benchmark: …" As today.
- **Fabricator** · Same family as your spot · "Coffee is a daily ritual for you, and you're particular about it. More going on than Benchmark: …"

**Dana looking at The Daily.**
- **Looking at · The Daily** · Same family as your spot · "Coffee should feel like a reward for you: warm, rich, comforting. Tiger Stripe without the fruit: straight chocolate."
- **Lead, Amsterdam** · Same family as your spot · "A little bitterness tastes serious to you. A step darker than The Daily: smoother, with less acidity." As today.
- **Benchmark** · Close to your spot · (`family_lean`) "Coffee is a daily ritual for you, and you're particular about it. The same chocolate as The Daily, rounder and softer." Today: "Your answers point elsewhere."
- **Tiger Stripe** · Your spot · "You taste a black coffee first, then make it richer. The Daily with a fruit edge: chocolate first, cherry behind. Built for espresso."

**Dana looking at The Village** (the one Floral coffee; no step from Tiger Stripe).
- **Looking at · The Village** · A different direction: Floral · (`own_family`; nothing else applies) "Coffee should feel like a reward for you: warm, rich, comforting. Floral, with apple blossom and grapefruit." No sentence says it suits her.
- No lead (none today either).
- **Cafè Feminista** · Close to your spot · (treat) "Next to your coffee, you'd reach for something fresh and lively. Creamier than The Village: papaya and candied coconut." As today.
- **La Familia** · Close to your spot · (treat, reused) "Next to your coffee, you'd reach for something fresh and lively. Softer and sweeter than The Village: caramel and honey." As today: the reused treat is tried before `own_family`.

**Person 85** (spot La Familia, Fruity leaning Floral; read as rule #10; her family is Balanced).
- **Top:** as today.
- **Lead, The Village** · Close to your spot · (start rule) "A little further the same way: just as light, with more flower and citrus in it."
- **Benchmark** · **A different direction: Balanced** · "Too bitter is what would bother you most. Rounder than La Familia: pure chocolate, less fruit." See Q12: Balanced is her own family.
- **Geometric** · Same family as your spot · (reuse) "You're still discovering coffee. Keeps the fruit of La Familia and adds weight: bright fruit over caramel."

**Person 33** (spot The Daily; read as rule #14). Gains the new step to Tiger Stripe.
- **Top:** as today.
- **Lead, Amsterdam** · Same family as your spot · (start rule) "The next size up in strength: darker and smoother."
- **Benchmark** · Close to your spot · "For you, a good cup is smooth and easy the whole way. The same chocolate as The Daily, rounder and softer."
- **Tiger Stripe** · Same family as your spot · (`family_lean`, Fruity) "With a black coffee, your first thought is what flavors are in it. The Daily with a fruit edge: chocolate first, cherry behind. Built for espresso."

**Person 23** (spot Geometric, Fruity leaning Chocolate & Nutty; read as rule #16).
- **Top:** as today.
- **Lead, La Familia** · Same family as your spot · (start rule) "Lighter and sweeter: caramel, honey, a little clementine."
- **Fabricator** · Close to your spot · (`family_lean`; same answer as today, through direction) "A cup where every sip tastes the same would bother you. Made from the same coffees as Geometric, with less fruit: drier and nuttier."
- **Tiger Stripe** · Close to your spot · (`family_lean`) "With a black coffee, your first thought is what flavors are in it. More chocolate and body than Geometric, with the fruit behind."
- **D.R. Congo** · Same family as your spot · (reuse) "Bitter coffee tastes burnt to you. Lighter than Geometric: …"

**Person 81** (spot Benchmark, a founders_pick decision; family Balanced).
- **Top:** as today.
- **Lead, La Familia** · **A different direction: Fruity** · (setup answer) "You'd like something gentler than what you drink now. Lighter in the cup than Benchmark: caramel and honey, with a little clementine."
- **The Daily** · Close to your spot · "A little bitterness tastes serious to you. The same chocolate as Benchmark, livelier, with a bit more bite."
- **Fabricator** · Close to your spot · (`family_lean`; same answer as today) "For you, a good cup feels alive and changes as you drink it. More going on than Benchmark: …"

**A customer whose quiz was taken by someone else** (profile `5e1b707b…`).
- This is the only such quiz on production; the test DB has the same one.
- The customer has no spot on production, so the page is read as rule #17: spot Cafè Feminista.
- **Top** (no tag): "You went for fruit all the way. This one is soft and tropical, with papaya and candied coconut." This is the rule's `customer_reason`, as today. See Q9.
- **Lead, The Village** · Close to your spot · (start rule) "More delicate: more floral, with grapefruit." No sentence about the customer.

## What Dana needs to answer before Part A

1. **Data 1 lines (item 3).**
   - Tiger Stripe → The Daily: as drafted, or "{from} without the fruit: chocolate and caramel, with a bit more bite."
   - Tiger Stripe → Fabricator: as drafted, or "Nuttier than {from}: hazelnut, a little citrus and cinnamon, in a lighter body." The draft's "the same chocolate" is not in Fabricator's roaster words.
   - The other two lines hold.
   - The words and directions: Less fruit / different, More fruit / different, Lighter / gentler, More body / bolder. Yes?
   - **I'd take both alternatives.**
2. **Order rows.** Placing `family_lean` after `family` and before `direction` means renumbering two rows through the one writer: `direction` 3→4 and `treat` 4→5. Then `family_lean` 3 and `own_family` 6. That's two more superseded rows than the brief counted. Yes?
3. **The `spot_relation` kind row** goes in as a seed line in `schema.sql`, because the kind table's writer is `seed`. Then `comments.sql` and `catalog:md` (item 1). Yes?
4. **The reader change.** `dialReads.mapCoffees` reads the lean through `v_dial_wedge_lane`: one more column on an existing reader, no new reader or view. Yes?
5. **The family in the tag** is the placement's family only, never the family a coffee's quiz branch comes from. Otherwise Indonesia and Big City, whose branch is Chocolate & Nutty, would read "Same family as your spot" for Dana. **Recommend placement only.**
6. **The heading while looking.** Today `steps_title` ("One step away") shows only when a page has no lead; otherwise the page shows "Where we'd take you next" and "Or one of these". With `family_lean`, looking at Fabricator now has a lead. Options:
   - (a) "One step from {coffee}" heads the whole step section while looking, with the lead and other titles beneath as today. **Recommended.**
   - (b) It replaces `steps_title` only, so it shows only on pages with no lead.
7. **The "Looking at" card** takes its answer first, in page order, so the steps get the remaining answers. It never reads the treat (brief 12: the top card and the lead never read it). **Recommend both.**
8. **`own_family` "then used"**: the used pass follows `dial_step_reuse_answer`, as every other kind's does. **Recommend yes.**
9. **No usable quiz.**
   - (a) The top card keeps the start rule's `customer_reason` ("You went for fruit all the way"), which is about the customer and comes from a quiz someone else took. Decision 9 keeps the top card as it is. Keep it, or show the rule's coffee line only?
   - (b) Without a usable quiz, is the setup feeling (the customer's own answer) still used, or does decision 8 silence it too? No such customer has a feeling today.
10. **Answers that don't match the step's direction.**
    - The family and `family_lean` choices take a family answer whatever direction it argues for, as `family` does today. Two pages show it:
      - "For you, a good cup is strong and satisfying." on Benchmark, "Rounder… softer", while looking at Fabricator;
      - "A coffee with no bitterness would bother you." on Fabricator, "Lighter", on her spot page.
    - Under decision 5 the answer and the line stand side by side, with no claim of fit. Keep it as it is, or add a rule later?
    - **Recommend keeping it** and noting it in OPEN_TASKS. Changing it would change the pinned pages of briefs 10 and 12.
11. **The treat loses ground.** `family_lean` comes before the treat, so Geometric on Dana's spot page now quotes "Coffee is a daily ritual…" instead of "you'd reach for something fresh and lively". Expected by the order. OK?
12. **What the tags say, by the rule as written:**
    - Tiger Stripe leans Fruity, so every Fruity coffee reads "Close to your spot" for Dana (La Familia, Cafè Feminista, Geometric).
    - Person 85 (spot La Familia) sees her own family, Benchmark, as "A different direction: Balanced".
    - Person 81's lead, La Familia, reads "A different direction: Fruity".
    - The tag is relative to the spot, not to the customer's family. OK?

**STOP (Task 0).** Nothing has changed on either database or in the code.

## Dana's answers (2026-11-27)

1. **Lines.**
   - Tiger Stripe → The Daily: the alternative, "{from} without the fruit: chocolate and caramel, with a bit more bite."
   - Tiger Stripe → Fabricator: "{from} with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body."
   - The other two as drafted.
   - Words and directions as proposed.
2. **Order.**
   - The existing step-support rows stay unchanged, with no renumbering: family and direction, family, direction.
   - Then the reuse pass, then treat, then **family_lean**, then **own_family**.
   - `family_lean` does not count toward the lead. The lead is chosen exactly as today.
3. Yes: the kind row is a `schema.sql` seed line.
4. Yes: `mapCoffees` reads the lean.
5. Yes: the tag uses the placement family only.
6. (a): "One step from {coffee}" heads the step section while looking.
7. Yes to both: the "Looking at" card takes its answer first, and it never reads the treat.
8. Yes: the `own_family` used pass follows `dial_step_reuse_answer`.
9. **No usable quiz.**
   - (a) The top card shows the rule's coffee line only, with no sentence about the customer.
   - (b) The customer's own setup feeling is still used.
10. **Direction preference, for `family_lean` and `own_family` only.** Answers are taken in this order:
    - an answer that argues for no direction;
    - then one for the step's own direction;
    - one arguing the opposite direction (`dial_move.opposite_move_id`) only when no other answer, used or unused, is left.

    It is a parameter switch, on by default. The existing `family` kind stays as it is (OPEN_TASKS).
11. Solved by 2: the treat keeps Geometric.
12. **`leans_together` is replaced by two rows, both showing "Close to your spot":**
    - (a) `joined_by_step`: a published step joins the coffee and the spot, either way;
    - (b) `leans_to_spot_family`: the coffee leans toward the spot's family.

    Order: same_family, joined_by_step, leans_to_spot_family, other_direction. The tag stays relative to the spot.

**How these are read into the build**
- **Direction preference (answer 10).** An answer for a third direction ("different" on a gentler step) is neither the step's direction nor its opposite. It ranks after the step's own direction and before the opposite. In full:
  - unused: no direction, the step's direction, any other direction;
  - then used (only while `dial_step_reuse_answer` is on), in the same order;
  - then the opposite, unused first.
  - With the switch off, an answer is taken unused first, then used, in answer order.
- **The parameter** is `dial_step_opposite_last` (1 = on), seeded in `schema.sql` like the other `dial_` parameters. The opposites are read through the existing `dialReads.moveOpposites`, unused since Ella map 10, so there's no new reader.
- **The tags have one copy row per relation row.** The tag text is `tag_<relation code>`, so each row's words can be edited and the two "Close to your spot" rows stay separate data:
  - `tag_same_family`: Same family as your spot
  - `tag_joined_by_step`: Close to your spot
  - `tag_leans_to_spot_family`: Close to your spot
  - `tag_other_direction`: A different direction: {family}
  - `tag_your_spot`: Your spot
  - `steps_title_from`: One step from {coffee}
- **The late kinds** (`treat`, `family_lean`, `own_family`) are tried after the reuse pass, in their row order: treat 4, family_lean 5, own_family 6. The rows still say the order; nothing is renumbered.
- **The heading (answer 6).** While looking, "One step from {coffee}" heads the step section. With a lead, "Where we'd take you next" and "Or one of these" stay beneath it. With no lead, it takes the place of "One step away", so the page doesn't show two headings.

## Item 5 and item 6 again, with Dana's answers

**Item 5 (spot pages): Dana 0, 85 1, 33 0, 23 1, 81 0.**
- Dana's five-step page uses each of her six answers once.
- The repeats for 85 and 23 are today's, from the reuse pass.
- `own_family` is not reached on any of these spot pages, nor is `family_lean`: every card finds support before them.

**Dana on her spot (Tiger Stripe, Founder's pick).** Lead and top card as today.
- **Top** (no tag): as today.
- **Lead, Blossom** · Same family as your spot · "For you, a good cup is strong and satisfying. A darker roast than Tiger Stripe, with a fuller body."
- **Geometric** · Close to your spot (joined by step) · (treat) "Next to your coffee, you'd reach for something fresh and lively. More fruit than Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it."
- **The Daily** · Same family as your spot · "Coffee is a daily ritual for you, and you're particular about it. Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite."
- **Fabricator** · Same family as your spot · "You taste a black coffee first, then make it richer. Tiger Stripe with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body."
- **The Waverly** · Same family as your spot · (the `family` kind, unchanged) "A coffee with no bitterness would bother you. Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange."

**Dana looking at Fabricator.** Heading "One step from Fabricator". No lead, as today.
- **Looking at · Fabricator** · Same family as your spot · "Coffee should feel like a reward for you: warm, rich, comforting. Tiger Stripe with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body."
- **Geometric** · Close to your spot (joined by step) · (treat) "Next to your coffee, you'd reach for something fresh and lively. Made from the same coffees as Fabricator, with more fruit, and sweeter."
- **Brazil** · Close to your spot (leans to the spot's family) · (`family_lean`) "Coffee is a daily ritual for you, and you're particular about it. Simpler than Fabricator: chocolate, almond, honey."
- **Tiger Stripe** · Your spot · "A little bitterness tastes serious to you. More body than Fabricator, with cherry where the citrus was. Built for espresso." Never the lead.
- **Benchmark** · Close to your spot (leans to the spot's family) · (`family_lean`) "You taste a black coffee first, then make it richer. Rounder than Fabricator: pure chocolate, softer, no citrus."

**Dana looking at Benchmark.**
- **Looking at · Benchmark** · Close to your spot (leans to the spot's family) · (`family_lean`) "Coffee should feel like a reward for you: warm, rich, comforting. This is the cup where nothing sticks out: pure chocolate, round and soft."
- **Lead, The Daily** · Same family as your spot · "A little bitterness tastes serious to you. The same chocolate as Benchmark, livelier, with a bit more bite." As today.
- **La Familia** · A different direction: Fruity · (treat) "Next to your coffee, you'd reach for something fresh and lively. Lighter in the cup than Benchmark: caramel and honey, with a little clementine."
- **Fabricator** · Same family as your spot · "Coffee is a daily ritual for you, and you're particular about it. More going on than Benchmark: hazelnut, a little citrus, a dry finish."

**Dana looking at The Daily.**
- **Looking at · The Daily** · Same family as your spot · "Coffee should feel like a reward for you: warm, rich, comforting. Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite."
- **Lead, Amsterdam** · Same family as your spot · "A little bitterness tastes serious to you. A step darker than The Daily: smoother, with less acidity." As today.
- **Benchmark** · Close to your spot (leans to the spot's family) · (`family_lean`) "Coffee is a daily ritual for you, and you're particular about it. The same chocolate as The Daily, rounder and softer."
- **Tiger Stripe** · Your spot · "You taste a black coffee first, then make it richer. The Daily with a fruit edge: chocolate first, cherry behind. Built for espresso."

**Dana looking at The Village** (Floral).
- **Looking at · The Village** · A different direction: Floral · (`own_family`) "Coffee should feel like a reward for you: warm, rich, comforting. Floral, with apple blossom and grapefruit."
- No lead.
- **Cafè Feminista** · A different direction: Fruity · (treat) "Next to your coffee, you'd reach for something fresh and lively. Creamier than The Village: papaya and candied coconut."
- **La Familia** · A different direction: Fruity · (treat, reused) "Next to your coffee, you'd reach for something fresh and lively. Softer and sweeter than The Village: caramel and honey."
  - The reused treat comes before `family_lean` and `own_family` by answer 2, so this card repeats it, as it does today.

**Person 85** (spot La Familia).
- **Top:** as today.
- **Lead, The Village** · Close to your spot (joined by step) · (start rule) "A little further the same way: just as light, with more flower and citrus in it."
- **Benchmark** · Close to your spot (joined by step) · "Too bitter is what would bother you most. Rounder than La Familia: pure chocolate, less fruit."
- **Geometric** · Same family as your spot · (reuse) "You're still discovering coffee. Keeps the fruit of La Familia and adds weight: bright fruit over caramel."

**Person 33** (spot The Daily). Gains the step to Tiger Stripe.
- **Top:** as today.
- **Lead, Amsterdam** · Same family as your spot · (start rule) "The next size up in strength: darker and smoother."
- **Benchmark** · Close to your spot (joined by step) · "For you, a good cup is smooth and easy the whole way. The same chocolate as The Daily, rounder and softer."
- **Tiger Stripe** · Same family as your spot · (direction) "With a black coffee, your first thought is what flavors are in it. The Daily with a fruit edge: chocolate first, cherry behind. Built for espresso."

**Person 23** (spot Geometric). The same texts as today, with tags.
- **Lead, La Familia** · Same family as your spot.
- **Fabricator** · Close to your spot (joined by step).
- **Tiger Stripe** · Close to your spot (joined by step).
- **D.R. Congo** · Same family as your spot.

**Person 81** (spot Benchmark). The same texts as today, with tags.
- **Lead, La Familia** · Close to your spot (joined by step).
- **The Daily** · Close to your spot (joined by step).
- **Fabricator** · Close to your spot (joined by step).

**The customer whose quiz was taken by someone else** (spot Cafè Feminista, read as rule #17).
- **Top** (no tag): "This one is soft and tropical, with papaya and candied coconut." The rule's coffee line only.
- **Lead, The Village** · Close to your spot (joined by step) · (start rule) "More delicate: more floral, with grapefruit."

## Parts A to D, built on the test DB (2026-11-27). STOPPED before the production seed

Nothing is committed or pushed, and production has not been written. Part E (the production seed) waits for Dana.

### What was built

- **Schema** (`schema.sql`, the "ELLA'S BLOOM MAP 15" block, additive only):
  - the kind `spot_relation`;
  - the copy rows `tag_same_family`, `tag_joined_by_step`, `tag_leans_to_spot_family`, `tag_other_direction`, `tag_your_spot` and `steps_title_from`, each inserted only if missing;
  - the parameter `dial_step_opposite_last` = 1.

  No new table, view, reader or writer. `comments.sql` was updated for the objects that are now read: `dial_move.opposite_move_id`, `v_dial_wedge_lane` and the copy codes.
- **Reads:**
  - `dialReads.mapCoffees` returns each coffee's lean (`v_dial_wedge_lane.toward_archetype`; the middle lane has none).
  - `dialReads.moveOpposites` and `dialReads.activeStepWords` are read again.
- **Cards** (`matchService.steps`):
  - The order is now: the existing rows, unchanged; then the reuse pass; then treat (4), family_lean (5) and own_family (6). The lead is chosen exactly as before. The late kinds never decide a lead.
  - The top card shows the rule's coffee line alone when the quiz was not taken by the customer.
  - Every card carries a tag relative to the spot.
  - There is no `no_support` part any more.
- **Seed:** `ellaMapCardsAboutYou_2026_11_27.ts`, with `--dry-run`, `--apply` and `--expect-db`. It writes:
  - Data 1: the 4 steps, with Dana's lines;
  - the 6 choice rows;
  - publish L5, which refuses if a placement moves.
- **Customer page** (`MapPage.tsx`):
  - a tag above each step card's name and above the "Looking at" name;
  - "One step from {coffee}" as the steps heading when looking at a coffee.
- **Admin page:**
  - Read it as shows "tag by <code>";
  - a new "How a step card takes an answer" card holds both `dial_step_` switches;
  - the tag rows are a third group in "How a card is chosen".
- **Unchanged:**
  - every `dial_surface` row still points at model 1 (`lane`), on both test and production (checked);
  - the Bloom page, the lane dial and existing steps.

### Seed on the test DB

- **Dry run:** 11 writes planned: 4 steps, 6 choices and the publish.
- **Apply:** wrote 10 rows and published "L5 one change from Tiger Stripe (Ella map 15)" as v278 (18 placements), retiring v260.
- **Rerun:** wrote 0.
- **Outputs:** `backend/tmp/em15_seed_test_dry.md` and `em15_seed_test_apply.md`.
- **Pages:** composed on the test DB (`tmp/em15_pages_test.mts`). Persons 85, 33 and 23 and the customer whose quiz was taken by someone else match the hand-written pages above. Dana's account on the test DB differs from production, so Dana's production pages are pinned by a fixture in `dialMap15.test.ts`, and they pass.

### Tests

- **Map suites:** 144 of 148 pass. The 4 failures are the known baseline from before this brief, unchanged:
  - dialMap7, the three start-rule tests;
  - dialMap9, "person 81" (OT-190).
- **New tests:**
  - `dialMap15.test.ts` (10 tests): Dana's spot page; the Fabricator, Benchmark, The Daily and Village pages; the late kinds switched off and never a lead; the opposite switch; the tag rows; the quiz taken by someone else; no "elsewhere"; integrity.
  - `mapTags.test.tsx` (4 tests).
  - The map and admin frontend tests pass 28 of 28.
- **Checks:** backend tsc is clean. Frontend tsc shows only the 7 known errors. All six lints pass.
- **Pins updated because the cards now say more (expected):**
  - dialMap10: Dana's 5 cards; P33 gains Tiger Stripe; the reuse-off texts; the proxy and all-off cases.
  - dialMap12: the treat-for-another-family case is now family_lean.
  - dialMap14: the Blossom and Brazil "Looking at" cards.
  - dialMap5: counts only Data 2's pairs.
  - dialMap7 and dialMap9: the `tag` key, the coffee line and own_family.
- **Fixed in passing:** `dataCatalogIntegrity.test` still expected 16 checks after brief 14 added check 17. It now expects 17.

### In the browser (local, test DB, the Zzz test admin)

- **Laptop and phone, the spot page** (Tiger Stripe, Founder's pick).
  - Lead: Blossom, "Same family as your spot".
  - Then:
    - Geometric, "Close to your spot";
    - The Daily, "Same family";
    - Fabricator, "Same family", with Dana's new line;
    - The Waverly, "Same family".
  - Every card starts with a sentence about the customer.
- **Fabricator, opened by a click on its card.**
  - The tag "Same family as your spot" is shown above the name.
  - The heading is "One step from Fabricator".
  - The four step cards: Geometric, Close; Brazil, Close; Tiger Stripe, "Your spot", with "More body than Fabricator…"; Benchmark, Close.
- **The Village** (`?at=`).
  - Tag "A different direction: Floral". Cafè Feminista and La Familia each read "A different direction: Fruity".
- **Admin:**
  - The three groups show with the new rows.
  - Turning own_family off and on saves and reads back. The Village cards did not change, because their answers come from earlier kinds.
  - same_family moved down, then up, back to its place.
  - With same_family off, all five spot cards read "Close to your spot". Turned back on.
  - Read it as shows "tag by same_family / joined_by_step" on each card.
- **Clean-up:** every admin change was put back. The test admin was demoted afterwards and the servers stopped.
- **Checks:** no page errors, and none of the forbidden words appeared, "elsewhere" included.
- **Screenshots:** `map15_{laptop,phone}_{spot,looking_fabricator,looking_floral}.png`, `map15_admin_rows.png` and `map15_admin_read_it_as.png`.

### Deviations, for Dana to see

1. The six copy rows are seeded in `schema.sql`, inserted only if missing, as earlier briefs' copy was. The production seed then has nothing to write for copy; it reports them as "same".
2. One copy row per relation (`tag_<code>`), so each tag's words can be edited on its own. The two "Close to your spot" rows hold the same words today.
3. The switch for answer 10 is named `dial_step_opposite_last`, and it sits beside `dial_step_reuse_answer` on the admin page.
4. How the order in answer 10 is read:
   - for family_lean and own_family, in order: no direction, then the step's direction, then another direction (unused first, then used, when reuse is on), then the opposite direction (unused, then used);
   - with the switch off: the first unused answer, else the first used one.
5. **"Quiz taken by someone else"** means: the session has at least one answer the customer did not give. A self-taken session with no stored answers still counts as the customer's own.
6. The heading "One step from {coffee}" shows only when looking at a coffee. With a lead it sits above the lead; without one it replaces "Or one of these".

### Part E, when Dana says go

In order, with Dana's go-ahead:

1. Commit by path and push. The deploy runs `schema.sql`, which adds the kind, the copy rows and the parameter.
2. On production, run the seed dry run, then the apply (`node tmp/em15_seed.mjs prod`, then `--apply`).
3. Read back the steps, the choices and L5.
4. Repeat the item 5 counts.
5. Run `npm run catalog:md -- --expect-db axisandbloom`.
6. Smoke-test /map through the API.

## Part E, on production (2026-11-27). DONE

1. **Commit and deploy.** Committed by path as cca65fc (33 files, the eight screenshots included) and pushed. The Deploy run succeeded and revision 00909 is serving. The boot added the kind `spot_relation`, the six copy rows (read back word for word) and `dial_step_opposite_last` = 1 (row 62).
2. **Seed.**
   - The dry run planned 11 writes: 4 steps, 6 choices and the publish. The copy rows showed as "same".
   - The apply wrote 10 rows and published "L6 one change from Tiger Stripe (Ella map 15)" as version 8, with 18 placements, retiring v7.
   - A rerun plans 0 writes (17 unchanged).
   - Output: `backend/tmp/em15_seed_prod_apply.md`.
3. **Read back.**
   - The four steps are current, in the active version and on the map. Each has your words, direction and line, basis `our_guess`:
     - Tiger Stripe → The Daily, "Less fruit";
     - The Daily → Tiger Stripe, "More fruit";
     - Tiger Stripe → Fabricator, "Lighter";
     - Fabricator → Tiger Stripe, "More body".
   - The 13 choice rows are all on, in order:
     - step_support: family_and_direction 1, family 2, direction 3, treat 4, family_lean 5, own_family 6;
     - spot_relation: same_family 1, joined_by_step 2, leans_to_spot_family 3, other_direction 4;
     - lead_source: unchanged.
   - Version 8 is active and v7 is retired.
4. **Item 5 again**, counted from the composed pages (`backend/tmp/em15_pages_prod_after.md`):

   | person | predicted | on production |
   |---|---|---|
   | Dana | 1 | **0**: The Waverly takes her q4 answer. The prediction missed that Geometric takes her treat answer (q6), which leaves an unused answer for The Waverly. |
   | 85 | 1 | 1: Geometric reuses "You're still discovering coffee." |
   | 33 | 0 | 0 |
   | 23 | 1 | 1. The repeat is on Tiger Stripe ("Coffee is a daily ritual for you…", also on the top card), not on D.R. Congo as predicted. |
   | 81 | 0 | 0 |

   The customer whose quiz was taken by someone else still reads as drafted: the rule's coffee line only, then The Village.
5. **Catalog.** CATALOG.md was regenerated from axisandbloom: 235 tables, 123 views, 2,013 columns.
6. **Smoke** (`backend/tmp/em15_smoke_prod.mts`, read-only, with the deployed code). The /map API needs a signed-in customer: without a token every route returns 401. The production web.app is behind the Cloudflare bot check, so I read Dana's pages through the service instead.
   - **Her spot:** Blossom leads, "Same family as your spot". Geometric is "Close to your spot". The Daily, Fabricator and The Waverly are "Same family". Every card opens with a sentence about her and every card has a price.
   - **Looking at Fabricator:** "Same family as your spot" sits above the name. Brazil and Benchmark are taken by `family_lean`. Tiger Stripe is "Your spot", with "More body than Fabricator…".
   - **Looking at The Village:** "A different direction: Floral". The top card is taken by `own_family`. Both steps read "A different direction: Fruity".
   - **A coffee not on the map** (`?at=999999`): 404 NOT_ON_MAP.
   - **"Your answers point elsewhere."** No card says it. The text still exists as the copy row `no_support`, which goes out with the page's copy, but no frontend code reads it (OT-197).
   - **The customer whose quiz was taken by someone else** has no spot, so they get an empty /map, as before this brief.
