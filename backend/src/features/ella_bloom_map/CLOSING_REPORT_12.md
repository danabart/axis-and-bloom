# Closing report 12: step cards compare to where you are, the treat answer, "More about this coffee"

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_12_STEP_COMPARISONS_AND_REVEAL.md` · Read first: `DEVELOPMENT_GUARDRAILS.md`, `CATALOG.md`, `CLOSING_REPORT_10.md`.

## Task 0 (2026-11-26 UTC, read only on the test DB and production)

**Nothing was written to either database, and no code or schema was changed.**
- Queries ran in `BEGIN READ ONLY` through `backend/tmp/md.mjs` (`tmp/em12_q*.sql`).
- The composed pages came from `matchService.steps` inside `BEGIN READ ONLY` (`tmp/em12_readas_prod.mts`; output in `tmp/em12_pages_prod_today.md`).
- The reveal data came from the public `GET /api/coffees/:id/{content,flavor-wheel,dimensions}` on production.

**G1.9: no other session was running.**
- Before starting, I asked the one other Claude session listed (danab-0a). It confirmed that Usual Drink 3 is finished, that `806f723` was its last commit (pushed, and `main` = `origin/main`), and that nothing of its own is running.
- It left the Cloud SQL proxy up on 5433, which this run used.
- The working tree has only changes from before this run: `commerce/CLOSING_REPORT_6.md` and the deleted genova `.ttf` files.

**State on both databases**
- **Production:** the active map is v6, "L4 step directions (Ella map 9)".
  - 36 shown steps, all in the active version, none with a placeholder.
  - 6 current reason choices, all on.
  - `dial_step_reuse_answer` = 1.
- **Test DB:** the active map is v125, "L3 step directions (Ella map 9)".
  - The same 36 step lines, word for word.
  - The same 6 choices and the same parameter.
- **Next labels:** production would publish as **L5**, the test DB as L4.

### Item 1: why Dana's page leads with Blossom

**Her answer changed; the page is right for what is stored now.**

| When (UTC) | Source | `coffee_feeling` |
|---|---|---|
| 2026-11-20 16:36 | onsite | `different` ("I'd like something different", argues `different`) |
| **2026-11-25 18:49:30** | onsite, one save (`04774210…`) | **`happy`** ("I'm happy with it", argues `stay`) |

- **The 18:49 save** wrote nine fields at once from the Usual Drink routine card: brew methods espresso and french press, a burr grinder, black, Joe Bean in the kitchen, medium roast, `happy`, no decaf, and "to much acid".
- **`v_customer_coffee_feeling` now returns `happy`.**

**The composition on production today, read only:**
1. **Setup answer:** skipped. `happy` has no said-back row (brief 10 named it as never used), so there is no feeling fact.
2. **Start rule:** skipped. Her first match has no `rule_id`, and the live winning rule (#14, The Daily) does not name Tiger Stripe. Rule #20, Tiger Stripe with a Geometric lead, is not her rule: her Fruity 0 is not above Balanced 0.
3. **Strongest support:** used. Blossom leads with `v7_q2_a` ("For you, a good cup is strong and satisfying").

**Did Usual Drink 2 or 3 change how the feeling is stored or read? No.**
- The body of `v_customer_coffee_feeling` is the same in `06ae2cd` (brief 10) and `806f723`, and so is `getCoffeeFeeling`.
- The new writer is the routine save. It writes the same `customer_brew_profile_change` rows, one per field.
- **What Usual Drink 3 did change is the kitchen read.** `v_customer_cupboard_coffee` now takes a list and picks the main coffee.
  - Dana's kitchen is `["joe_bean"]`. Joe Bean has no said-back row, so her page has no kitchen sentence. That matches G4.5, since Joe Bean is a partner roaster.

**One thing only you can confirm:** that you picked "I'm happy with it" on that card at 18:49. If the card showed it pre-selected and you didn't choose it, that is a Usual Drink bug, not a map one. I could not tell which from the rows.

**Person 81 changed too.** On production this is the shared smoke-test user `quiz-scenario-test@` (`103cdf5f`).
- On 2026-11-25 at 21:03, the Usual Drink 3 smoke stored `["starbucks","other"]` with main `other` and the words "Zzz smoke roaster".
- Their top card has therefore lost "You have Counter Culture Coffee in your kitchen".
- This is test data from the smoke, not a code change. The pinned page on the test DB still has the sentence (its fixture is separate).

### Item 2: readers, writers and views (G3.9 amended)

**Not as expected: one change to an existing view and its reader. No new table, view, reader or writer.**

**Where the treat answer's family comes from**
- **Not `v_dial_quiz_answer.family_code`.** It takes the family from `quiz_answer_archetype_score`, and the three treat answers score for nothing on either database. `family_code` is empty on all 81 production treat rows.
- **The food signal** is `quiz_answer.resulting_archetype_id`, which `quizScorer.scoreAnswerIds` reads for Q6:
  - `v7_q6_a` → chocolate_nutty
  - `v7_q6_b` → balanced_sweet
  - `v7_q6_c` → fruity
- **The only view that carries it** is `v_customer_quiz_current.food_signal`, once per session, as the family *name*, not the code.
- **Every current answer has a resulting family** (Q1–Q6), so the family alone cannot pick out the treat. The treat is the answer with weight 0 (question weight 0).

**Proposed:**

| Object | Change | Considered instead | Why that does not fit |
|---|---|---|---|
| `v_dial_quiz_answer` | **new column `resulting_family_code`** (`quiz_answer.resulting_archetype_id` → code, for every answer, no condition in the body); `comments.sql` line, `catalog:md` | (a) put the treat family into `family_code` | `family_code` means "scored for" and feeds the top card and family support. Mixing in a second source changes its meaning. |
| | | (b) read `v_customer_quiz_current.food_signal` | It holds the family name, not the code, so the map would need a name-to-code mapping. |
| `dialReads.quizAnswers` | also selects `resulting_family_code` | — | the view's one reader (sole reader per `comments.sql`) |
| `matchService.steps` | the `treat` kind | — | changed in place, no second composer |
| `KNOWN_REASON_CHOICES.step_support` | gains `treat` | — | data-catalog check 15 knows the code |

**How the treat kind works**
- **Its pool:** self-taken answers with weight 0 and a current quoted said-back row, matched on `resulting_family_code`. It is a separate pool from `quizFacts`.

**How the treat stays out of everything else today, and stays out after**
- At `matchService.ts:661`, `quizFacts` keeps only `weight > 0`. The top card, the lead (all three sources) and the other step kinds read only `quizFacts` and `allFacts`, so the treat never reaches them.
- The treat pool is built separately and read only by the `treat` choice on step cards. No new column on `dial_said_back` or `dial_reason_choice` is needed.

**Its order:** after the reuse pass. A step tries the unused answers, then the used ones (`dial_step_reuse_answer`), then the treat, then `no_support`. That is "the last kind, when nothing else supports the step".

**Existing pieces, reused as they are**
- **Writers:** `setStepInTx`, `setSaidBackInTx` (it accepts unquotable facts; no change), `setReasonChoiceInTx`.
- **Readers:** `dialReads.saidBack`, `reasonChoices`, `customerCopy`, `stepsFrom`, `mapCoffees`.
- **The placeholder fill:** `fill()` (already used for `{coffee}` and `{brand}`).
- **Publish:** `dialPlacementService.publish`.
- **The admin table:** `v_dial_said_back_fact` lists the treat answers. They show greyed because `is_quotable` is weight > 0. They can still be given a sentence; I'd leave the grey as it is.

**`{from}` reaches customers through one function.** `customer_line` is read by `dialReads.steps` (admin), `stepsFrom` → `offeredSteps` → `matchService.steps` and the step move (which uses only coffee ids). Filling it in `stepLine` covers both the card's `text` and its `line`. The admin step editor shows the raw `{from}`.

**Needs your yes:** the new column `v_dial_quiz_answer.resulting_family_code` and its reader change.

### Item 3: the reveal

**Which component and which reads**
- The Bloom page's "Reveal the full profile" (`DialFieldLayout.tsx:236`) renders **`RevealedPanel variant="field"`**.
- Its data comes from `usePositionCardData`, which calls three public reads:
  - `GET /api/coffees/:id/content` (the description)
  - `GET /api/coffees/:id/flavor-wheel` (the notes)
  - `GET /api/coffees/:id/dimensions` (the cupping bars, fetched on first reveal)

**What the `field` variant shows**
1. "In the roaster's words", then the one description (`threeVoiceStory`).
2. "Cupping profile" bars.
3. "See the notes wheel", folded.
4. Links:
   - "Compare with the neighbour" (only when `onCompare` is passed);
   - "Full breakdown" and "Ask Liam" (both hidden when `prelaunch`);
   - "Your profile" (unless `hideProfileLink`).

**What it already leaves out**
- **The comfort-zone label** sits in `ComfortZoneAside`, a sibling on the Bloom page, not inside the panel.
- **The compatibility sentence:** the `field` variant calls `useCompatibility` with no coffee id.
- **The tags** (award, best brew) are not drawn by the panel at all.

**How `/map` uses it, with no fork**
- `/map` renders `RevealedPanel variant="field"` under the card.
- It passes no `onCompare`, `prelaunch` true, and `hideProfileLink` true (proposed).
- It fetches the same three reads, lazily on open. No new backend read.
- `usePositionCardData` takes a whole dial slot, with availability and hops, which `/map` does not have.
  - **Proposed:** move its three coffee fetches into a small shared hook that `usePositionCardData` itself calls, so there is still one copy of the fetching. **Needs your yes** (G3.9: a reader function on the frontend).
- **Brew tags:** the brief lists them, and the panel does not draw any. **Proposed:** one additive prop, `brewTags`, which `/map` fills from `content.tags` where `kind = 'brew'`. The award tag is never passed (G4.5). The Bloom page passes nothing, so it is unchanged.

**What a customer would see for Tiger Stripe (2914) on production today**
- **In the roaster's words:** "The roaster calls this an award-winning blend built on almond, chocolate, and peanuts, with a hint of cherry and apple threading through. We tasted the almond and chocolate too. It has moderate body and sweetness, with restrained acidity and bitterness, finishing long on the palate. The roaster recommends it as espresso, though it also shines in cold brew, batch brew, or pour-over, and drinks well black or with milk."
- **Cupping profile** (2 sessions):

  | Dimension | Score |
  |---|---|
  | Fragrance | 4 |
  | Aroma | 4–8 |
  | Flavor | 5 |
  | Sweetness | 2–5 |
  | Acidity | 3–6 |
  | Bitterness | 2–5 |
  | Body | 5–9 |
  | Finish | 8 |

- **The notes:** Almond, Chocolate and Peanuts (signature, confirmed by cupping); Cherry, Apple, Dried Fruit.
- **Brew tag:** Espresso. Not shown: "Award-winning, per the roaster".

**Flags**
- **"Award-winning" is in the description itself.** The description says "award-winning blend". It is not an award name, so G4.5 allows it, but it is there.
- **The notes don't agree.** Tiger Stripe's `flavor_descriptors_roaster` reads "Chocolate, Peanut Butter, Pear, Fig, Almond, Cherry", but the notes wheel and the description say almond, chocolate, peanuts, cherry, apple. The map card's notes and the panel would show different words.
- **Six of the 18 coffees have no description:** The Waverly, Half Moon, Great Heights, Brazil, Indonesia and D.R. Congo.
  - The Waverly, Half Moon and Great Heights also have no cupping bars and one note row. Their panel would hold a one-note wheel and nothing else.
  - **Proposed:** show "More about this coffee" only when the coffee has a description or cupping bars. That is a rule from the data, not a list.

**Not decided by the brief:** the cupping bars are "the coffee's own parts", but the brief lists only notes, description and brew tags. I recommend keeping the bars, as the Bloom reveal does. Say if you want them hidden; that would be a second additive prop.

### Item 4: Data 1 beside production

**The 36 pairs in Data 1 are exactly the 36 shown steps on production (and on the test DB).** No step is missing or extra.

- **Four steps have no line today** (59, 65, 66, 69). They show the destination's `map_line`.
- **"Today"** is what the card shows now: the step's line, or the `map_line` in italics where the step has none.
- **Flags** mark a proposed line that claims something neither the current lines (steps, start rules, coffee sentences) nor the roaster's notes say, or a line that breaks the brief.

| # | Step | From → to (word) | Today | Proposed (Data 1) | Flag |
|---|---|---|---|---|---|
| 1 | 37 | Benchmark → The Daily (Bolder) | The same chocolate, livelier, with a bit more bite. | The same chocolate as {from}, livelier, with a bit more bite. | |
| 2 | 44 | The Daily → Benchmark (Lighter) | Rounder, pure chocolate. | The same chocolate as {from}, rounder and softer. | |
| 3 | 43 | The Daily → Amsterdam (Bolder) | Darker and smoother, with less acidity. | A step darker than {from}: smoother, with less acidity. | |
| 4 | 52 | Amsterdam → The Daily (Lighter) | Lighter and sweeter. | Lighter and sweeter than {from}. | |
| 5 | 51 | Amsterdam → Great Heights (Bolder) | The same Brazil, roasted darker. | The same Brazil as {from}, roasted darker. | **F9** |
| 6 | 62 | Great Heights → Amsterdam (Lighter) | A lighter roast, with more caramel. | The same Brazil as {from} in a lighter roast, with more caramel. | **F9** |
| 7 | 61 | Great Heights → Big City (Bolder) | French roast and burnt sugar. | Darker again than {from}: French roast and burnt sugar. | |
| 8 | 60 | Big City → Great Heights (Lighter) | Less smoke, more fudge. | Less smoke than {from}, more fudge. | |
| 9 | 38 | Benchmark → La Familia (Brighter) | Caramel and honey with a little clementine. Lighter in the cup. | Lighter in the cup than {from}: caramel and honey, with a little clementine. | |
| 10 | 42 | La Familia → Benchmark (More body) | Pure chocolate, rounder, less fruit. | Rounder than {from}: pure chocolate, less fruit. | |
| 11 | 40 | La Familia → The Village (More delicate) | More floral and more citrus. | Just as light as {from}, with more flower and citrus. | |
| 12 | 58 | The Village → La Familia (Sweeter) | Caramel and honey, softer. | Softer and sweeter than {from}: caramel and honey. | |
| 13 | 57 | The Village → Cafè Feminista (More tropical) | Papaya and candied coconut, creamier. | Creamier than {from}: papaya and candied coconut. | |
| 14 | 56 | Cafè Feminista → The Village (More delicate) | More floral, with grapefruit. | More delicate than {from}: more floral, with grapefruit. | |
| 15 | 45 | Fabricator → Geometric (More fruit) | The same family with more fruit, and sweeter. | The same family as {from}, with more fruit, and sweeter. | **F1** |
| 16 | 55 | Geometric → Fabricator (Less fruit) | Drier and nuttier. | The same family as {from} with the fruit turned down: drier and nuttier. | **F1** |
| 17 | 46 | Fabricator → Brazil (Simpler) | The base on its own: chocolate, almond, honey. | The base of {from} on its own: chocolate, almond, honey. | **F2** |
| 18 | 68 | Brazil → Fabricator (More going on) | Adds citrus and spice. | {from} with more going on: citrus and spice added. | **F2** |
| 19 | 67 | Brazil → Blossom (Bolder) | A darker roast with a fuller body. | Darker than {from}, with a fuller body. | |
| 20 | 64 | Blossom → Brazil (Lighter) | Lighter, plain chocolate. | Lighter than {from}: plain chocolate. | |
| 21 | 63 | Blossom → Tiger Stripe (Brighter) | A lighter roast with more fruit. | A lighter roast than {from}, with more fruit. | |
| 22 | 50 | Tiger Stripe → Blossom (Bolder) | A darker roast with a fuller body. | The same idea as {from}, roasted darker: a fuller body, with less fruit showing. | **F3** |
| 23 | 48 | Tiger Stripe → Geometric (More fruit) | More fruit, and sweeter. | The furthest step from {from}: fruit comes first here, sweeter and lighter, with the chocolate behind it. | **F4** |
| 24 | 54 | Geometric → Tiger Stripe (More body) | More chocolate and body. | More chocolate and body than {from}, with the fruit behind. | |
| 25 | 49 | Tiger Stripe → The Waverly (More fruit) | Fig and orange over dark chocolate. | Close to {from}: chocolate underneath, with more fruit on top, fig and orange. | **F5** |
| 26 | 70 | The Waverly → Tiger Stripe (Less fruit) | Chocolate first, cherry behind. | Close to {from} with less fruit: chocolate first, cherry behind. | **F5** |
| 27 | 41 | La Familia → Geometric (More body, keep the fruit) | Bright fruit over caramel, with more weight. | Keeps the fruit of {from} and adds weight: bright fruit over caramel. | |
| 28 | 53 | Geometric → La Familia (Lighter) | Sweeter and lighter: caramel and honey. | Lighter and sweeter than {from}: caramel, honey, a little clementine. | |
| 29 | 39 | Benchmark → Fabricator (More going on) | Hazelnut, a little citrus, a dry finish. | More going on than {from}: hazelnut, a little citrus, a dry finish. | |
| 30 | 47 | Fabricator → Benchmark (Rounder) | Pure chocolate, softer, no citrus. | Rounder than {from}: pure chocolate, softer, no citrus. | |
| 31 | 69 | D.R. Congo → Geometric (More body) | *Bright fruit over caramel.* | More body than {from}: bright fruit over caramel. | |
| 32 | 59 | Geometric → D.R. Congo (Lighter) | *Clementine and nectarine over caramel and light chocolate.* | Softer than {from}: clementine and nectarine over caramel and light chocolate. | **F7** |
| 33 | 65 | Blossom → Indonesia (Earthier) | *Dark chocolate, apricot and caramel, with raisin and cedar.* | Earthier than {from}: dark chocolate, apricot and caramel, with raisin and cedar. | |
| 34 | 66 | Indonesia → Blossom (Cleaner) | *A darker roast with a fuller body.* | Cleaner than {from}: a darker roast with a fuller body. | **F6** |
| 35 | 71 | Half Moon → Nightcap Decaf (No caffeine) | Almond, molasses, cola. | No caffeine at all, where {from} has half: almond, molasses, cola. | |
| 36 | 72 | Nightcap Decaf → Half Moon (Half the caffeine) | Walnut and toffee. | Half the caffeine back: walnut and toffee. | **F8** |

**The flags, each with a line written only from words already there, for your pick**

- **F1, steps 45 and 55: "The same family".** On the map, Fabricator is Chocolate & Nutty and Geometric is Fruity (`v_dial_placement`). Step 45's line today already says it.
  - 45: "More fruit than {from}, and sweeter."
  - 55: "Less fruit than {from}: drier and nuttier."
- **F2, steps 46 and 68: Brazil as "the base of" Fabricator.** Nothing in the data says Fabricator is built on Brazil. Fabricator's roaster notes are Hazelnut, Citrus, Cinnamon, Graham Cracker. Today's 46 and Brazil's `map_line` ("The base on its own") imply the same. If Brazil is not a component of Fabricator:
  - 46: "Simpler than {from}: chocolate, almond, honey."
  - 68: "More going on than {from}: citrus and spice added."
- **F3, step 50: Blossom as "the same idea as" Tiger Stripe, with "less fruit showing".** No line or note says Blossom is Tiger Stripe roasted darker, and Blossom's notes include black cherry.
  - "A darker roast than {from}, with a fuller body."
- **F4, step 48: "The furthest step".** Nothing says it. The rest of the line comes from rule #20's lead line.
  - "More fruit than {from}: fruit comes first here, sweeter and lighter, with the chocolate behind it."
- **F5, steps 49 and 70: "Close to".** No line or note says the two are close.
  - 49: "More fruit than {from}: chocolate underneath, with fig and orange on top."
  - 70: "Less fruit than {from}: chocolate first, cherry behind."
- **F6, step 66: "a darker roast", now as a comparison to Indonesia.** No roast is stated for either coffee. Blossom's `map_line` was written beside Brazil.
  - "Cleaner than {from}: dark chocolate, black cherry and toffee." (Blossom's roaster notes)
- **F7, step 59: "Softer".** The button word is "Lighter", and nothing says softer.
  - "Lighter than {from}: clementine and nectarine over caramel and light chocolate."
- **F8, step 72: no `{from}`.** Decision 1 says every step line is a comparison, and Part D tests that `{from}` is filled on every card. This line would fail that test.
  - "Half the caffeine back, where {from} has none: walnut and toffee."
- **F9, steps 51 and 62: "The same Brazil" (wording only, not a claim).** "Brazil" is the origin here, but a coffee on the map is also called Brazil. Today's line already says it. Left as it is unless you want "The same beans as {from}".

### Item 5: the five pages with Data 1 and Data 2 applied (by hand)

**How these are built**
- Each page is production's composition today (`tmp/em12_pages_prod_today.md`). Every step's coffee sentence is replaced by its Data 1 line, with `{from}` = the position's map name, and the treat applies where nothing else supports a step.
- The lines are Data 1 as written. Where a flag's line would change a card, it is noted.
- **The start rule's lead cards keep the rule's `lead_line`** (the brief: "already written relative to the first bag"), so 85, 33 and 23 have the same lead as today.
- **The top cards are unchanged on every page.**

**Dana** (Tiger Stripe, Founder's pick; feeling `happy`, kitchen Joe Bean, neither said back). Same as the brief's expected page.
- **Top:** "Coffee should feel like a reward for you: warm, rich, comforting. A little bitterness tastes serious to you. Chocolate first, with a little lift. Built for espresso."
- **Lead, Blossom** (strongest support, `v7_q2_a`): "For you, a good cup is strong and satisfying. The same idea as Tiger Stripe, roasted darker: a fuller body, with less fruit showing." *(F3)*
- **Geometric** (**treat**: `v7_q6_c` → fruity = Geometric's family; no other answer supports it, used or not): "Next to your coffee, you'd reach for something fresh and lively. The furthest step from Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it." *(F4)*
- **The Waverly** (family, `v7_q1_a`): "Coffee is a daily ritual for you, and you're particular about it. Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange." *(F5)*

**Person 85** (La Familia, read as rule #10; no treat used, since every step has support)
- **Top:** "You'd rather have something gentler. For you, a good cup is smooth and easy the whole way. You're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end."
- **Lead, The Village** (start rule): "A little further the same way: just as light, with more flower and citrus in it."
- **Benchmark:** "Too bitter is what would bother you most. Rounder than La Familia: pure chocolate, less fruit."
- **Geometric:** "You're still discovering coffee. Keeps the fruit of La Familia and adds weight: bright fruit over caramel."
  - Since the reuse follow-up, this card reuses `v7_q1_c`. Brief 10 showed "Your answers point elsewhere." here.

**Person 33** (The Daily, read as rule #14)
- **Top:** "A little bitterness tastes serious to you. A coffee with no bitterness would bother you. This is chocolate with some strength: our everyday cup."
- **Lead, Amsterdam** (start rule): "The next size up in strength: darker and smoother."
- **Benchmark:** "For you, a good cup is smooth and easy the whole way. The same chocolate as The Daily, rounder and softer."

**Person 23** (Geometric, read as rule #16)
- **Top:** "Bitter coffee tastes burnt to you. For you, a good cup feels alive and changes as you drink it. Coffee is a daily ritual for you, and you're particular about it. So: bright fruit, with caramel under it to make it an everyday cup."
- **Lead, La Familia** (start rule): "Lighter and sweeter: caramel, honey, a little clementine."
- **Fabricator:** "A cup where every sip tastes the same would bother you. The same family as Geometric with the fruit turned down: drier and nuttier." *(F1: Fabricator is not Geometric's family; with F1's line: "…Less fruit than Geometric: drier and nuttier.")*
- **Tiger Stripe:** "Coffee is a daily ritual for you, and you're particular about it. More chocolate and body than Geometric, with the fruit behind."
- **D.R. Congo:** "With a black coffee, your first thought is what flavors are in it. Softer than Geometric: clementine and nectarine over caramel and light chocolate." *(F7)*

**Person 81** (Benchmark; production's smoke user, kitchen now `other` from the Usual Drink 3 smoke, so no kitchen sentence; feeling gentler)
- **Top:** "Too bitter is what would bother you most. You smooth a black coffee before you try it. This is the cup where nothing sticks out, and it works however you make it."
- **Lead, La Familia** (setup answer, `gentler`): "You'd like something gentler than what you drink now. Lighter in the cup than Benchmark: caramel and honey, with a little clementine."
- **The Daily:** "A little bitterness tastes serious to you. The same chocolate as Benchmark, livelier, with a bit more bite."
- **Fabricator:** "For you, a good cup feels alive and changes as you drink it. More going on than Benchmark: hazelnut, a little citrus, a dry finish."

**For Part D:** the pinned "Dana" fixture on the test DB carries feeling `different`, so it still leads with The Waverly. I would move it to `happy`, her production answer, so the pinned page is the one above. Say if you would rather keep `different` and pin both.

### Calls needed before Part A

1. **The treat's family:** add the column `v_dial_quiz_answer.resulting_family_code` and select it in `dialReads.quizAnswers` (item 2). The treat pool is answers with weight 0, and it is tried after the reuse pass.
2. **The reveal:**
   - a shared hook for the three coffee reads, used by `usePositionCardData` too;
   - one additive `brewTags` prop on `RevealedPanel` (never the award tag);
   - on `/map`: `prelaunch` true, `hideProfileLink` true, no compare link;
   - keep the cupping bars (recommended);
   - show "More about this coffee" only when the coffee has a description or cupping bars.
3. **The flagged lines F1–F8:** Data 1 as written, or the alternative under each flag (I'd take all eight alternatives). F9: leave as is.
4. **Dana's feeling:** confirm "I'm happy with it" was your pick on 2026-11-25.
5. **The test-DB "Dana" fixture:** move it to `happy`.

**STOP (Task 0). Nothing had changed on either database or in the code.**

## Parts A to D on the test DB (2026-11-26, after Dana's yes)

**Dana's calls, as applied**
- **1. Feeling:** "I'm happy with it" was her own pick. The edit view pre-fills the stored value ("different"), so "happy" needed a tap.
- **2. Treat family:** `v_dial_quiz_answer.resulting_family_code`, read by `dialReads.quizAnswers`. The treat is tried last, after the reuse pass.
- **3. Reveal:**
  - shared hook `useCoffeeDetail`;
  - `brewTags` on `RevealedPanel`;
  - cupping bars kept;
  - the button only when a coffee has a description or cupping bars.
- **4. Lines:**
  - the alternatives for F2, F3, F4, F6, F7 and F8;
  - F5 keeps "Close to {from}" on both lines;
  - F1 as Dana wrote it: step 45 "Made from the same coffees as {from}, with more fruit, and sweeter.", step 55 "Made from the same coffees as {from}, with less fruit: drier and nuttier.";
  - F9 left as it is.
- **5. The test copy of Dana's account:**
  - The test DB's clone of Dana's real account has no feeling row: it predates Usual Drink, and it sits on Amsterdam, not Tiger Stripe.
  - "The test copy" was therefore the pinned fixture in `dialMap10.test.ts` and the marked brief 10 test admin `Zzz Test Admin (Ella map 10, dana)`. Both now read `happy`; the admin got one `set` row, test DB only.

**What was built**
- **A (data):**
  - `v_dial_quiz_answer.resulting_family_code`;
  - `dial_customer_copy` `more_about`, from the map 12 block of `schema.sql`;
  - comments in `comments.sql`;
  - `DIAL_COPY_CODES` gains `more_about`.
- **B (backend):**
  - `{from}` is filled in step lines.
  - New `step_support` choice `treat`: step cards only, after every other kind and the reuse pass.
  - Seed `ellaMapStepComparisons_2026_11_25.ts`.
- **C (frontend):**
  - "More about this coffee" on `/map`: the top card and every step card, one panel open at a time;
  - `useCoffeeDetail`, also used by `usePositionCardData`;
  - `RevealedPanel.brewTags`.
- **D (tests and docs):**
  - `dialMap12.test.ts`, 8 tests;
  - `dialMap10.test.ts`, 11 tests, pinned pages updated;
  - `mapMoreAbout.test.tsx`, 3 tests;
  - REGRESSION "Ella's Bloom Map 12";
  - OT-180 to OT-182;
  - WHAT_WE_BUILT 287.

**Results**
- **Seed on the test DB (`--apply`):**
  - 40 rows written: 36 step lines, 3 treat sentences and 1 choice. `more_about` was already there from `schema.sql`.
  - Published "L4 step comparisons (Ella map 12)" as version 260: 18 placements, v125 retired.
  - A second `--apply` writes 0.
- **Production dry run (READ ONLY, `--expect-db axisandbloom`):**
  - 42 writes planned: 36 steps, 3 said back, 1 choice, 1 copy, and publish "L5 step comparisons (Ella map 12)" over v6.
  - After deploy, `schema.sql` inserts `more_about`, so the real run writes 41.
- **The five pages on the test DB** (`tmp/em12_pages_test.md`):
  - 85, 33 and 23 match item 5 word for word.
  - The test DB's clones of Dana and 81 are older than production (Dana on Amsterdam; 81 without feeling or kitchen), so their test-DB pages differ: Dana's shows "Lighter and sweeter than Amsterdam.", and 81's steps read "Your answers point elsewhere.".
  - The production-shaped pages for Dana and 81 are the pinned fixtures and the browser check below. Both match item 5.
- **Start-rule lead cards** (85, 33, 23) keep the rule's `lead_line`, so they don't name `{from}`. This is by design.
- **In the browser** (local Vite → backend on the test DB; marked Zzz test admins, switched back off afterwards):
  - **Dana fixture `/map`:**
    - Top: Tiger Stripe.
    - Lead Blossom: "… A darker roast than Tiger Stripe, with a fuller body."
    - Geometric (treat): "Next to your coffee, you'd reach for something fresh and lively. More fruit than Tiger Stripe: …"
    - The Waverly: "… Close to Tiger Stripe: …"
  - **Person 81 fixture `/map`:** matches item 5.
  - **"More about this coffee":**
    - It is on the top card and on every step card except The Waverly, which has no description and no cupping bars (OT-182).
    - Each click opened exactly one panel, with no links in it. Clicking the open card's button again closed it.
  - **Forbidden words:** none, except "award" inside Tiger Stripe's own description ("an award-winning blend"). That is OT-180, left as Dana asked.
  - **Admin "How a card is chosen":** shows "4. The treat answer …".
    - Switching it off turned Geometric into "Your answers point elsewhere."; switching it back on restored it.
    - The treat sentences show in "What we say back".
  - **`/bloom`:** no "More about" button, so the Bloom page is unchanged.
  - **`dial_surface`:** all seven rows say `lane` on both databases.
  - **Screenshots:** `map12_customer_dana.png`, `map12_customer_p81.png`, `map12_panel_open_top.png`, `map12_panel_open_step.png`, `map12_admin_how_chosen.png`, `map12_admin_said_back.png`, `map12_bloom_unchanged.png`.
- **Tests:**
  - Frontend: 185/185.
  - Backend: every test this brief touches passes. My first full run also failed `comments.format`, because the `dial_customer_copy` comment had grown to 1,022 characters; I shortened it and the test passes.
  - 38 other backend tests across 13 files fail, also when run alone. None of them reads anything this brief changed; I'm treating them as already failing before this brief:
    - `quizScoring`: a pure function test;
    - `dialMap7`: still expects Fabricator before brief 11's rule #20;
    - `evidenceViews` and `evidenceAdmin`;
    - `palateReads`, in the full run only;
    - `quizInterpretation` and `quizResultsView`: timeouts;
    - `sommelier*` and `staleGuestCleanup`;
    - `catalogService`, `schema.catalog_blueprint`, `qrDoor`.
- **Lints:** `lint:lineage`, `lint:catalog` and `lint:customer` exit 0. Backend tsc is clean. Frontend tsc shows 7 errors, all in files this brief didn't touch.

**Part E (production), waiting for Dana's go:**
1. Commit, then push. The push deploys, so it needs Dana's literal "push".
2. Run the seed with `--apply --expect-db axisandbloom`, then a rerun that writes 0.
3. Read the five pages on production.
4. Run `npm run catalog:md -- --expect-db axisandbloom` and commit CATALOG.md.

**STOP before production. Production is unchanged; the only production access was read-only.**
