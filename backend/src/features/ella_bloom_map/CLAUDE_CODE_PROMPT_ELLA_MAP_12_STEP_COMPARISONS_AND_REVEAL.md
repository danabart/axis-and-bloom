# Claude Code brief. Ella's Bloom Map 12: step cards compare to where you are, the treat answer, and "More about this coffee"

Workstream: ella_bloom_map · Written 2026-11-25 by the CTO session · Builds on brief 10 (`DESIGN_MAP_REASONS_REV2_2026-11-21.md`, `CLOSING_REPORT_10.md`) · Model: the cheaper/faster model (G1.13) · Dana runs it; push = deploy · Acceptance in **test mode on the test DB**.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every sentence, order and switch is a row; no answer code, family code or coffee id in code or a view body) · G2.4 CATALOG.md checked before any new table or view (none is expected) · G2.5 one writer per table, reads through views · G2.11 supersede, never delete · G2.14 text is composed at read; nothing composed is stored · G2.17 `comments.sql` then `catalog:md` if the schema changes · G2.19 a quiz taken by someone else is never used · G3.9 as amended 2026-11-23: Task 0 lists every reader function, writer function and view this brief would add, beside the existing ones considered, and STOPS for Dana's yes · **G4.1 reuse the shared reveal component; do not build a second one** · G4.2 nothing typed in · G4.4 positive register · G4.5 no roaster name, no award name, never "explore" or "confidence" · G4.6 `/map` stays behind the pre-launch gate and admin-only · G5.1 vitest · G1.6 push is deploy, one closing report · **G1.9 one execution at a time: confirm no other session is running before you start and before you push.**
Mode: test. STOP points: after Task 0; before the production seed.

**Goal.** Dana read her own `/map` on 2026-11-25. The cards are better, and three things are missing: a step card does not say how the coffee relates to the one she is on; a step no answer supports ("Your answers point elsewhere. More fruit, and sweeter.") is too thin to understand; and there is no way to read more about a coffee.

**Decisions already made (Dana, 2026-11-25; do not re-open).**

1. **Every step's coffee sentence is a comparison to the coffee the customer is on:** what stays, what changes. The 36 step lines are rewritten (Data 1).
2. **The treat answer (v7 Q6) may be used on step cards only**, as the last kind of support, when nothing else supports the step. It never affects the match, the start rule, the lead or the top card. This revises her 2026-11-15 call for wording only.
3. **"More about this coffee" on every card, working like "Reveal full profile" on the Bloom Dial:** a click opens a card beneath with the rest of the coffee's information. The card itself stays name and reasoning.
4. The layout stays two parts: a sentence about the customer, then a sentence about the coffee. No lead-ins.
5. The customer Bloom page, the lane dial and every `dial_surface` row stay as they are.

CTO calls, reversible, flag if the code disagrees:

- **The comparison lives in `dial_step.customer_line`**, which is already one row per ordered pair, written by `setStepInTx`. The placeholder `{from}` is filled with the position coffee's map name at read, as `dial_customer_copy` does with `{coffee}`. No new column.
- **The treat is one more row in "How a card is chosen":** a `step_support` choice with code `treat`, last in order, on. It picks the customer's treat answer when that answer's family is the destination coffee's family (including its branch parent) and no earlier kind found support. The treat answers get their own said-back sentences (Data 2). They must stay out of the top card and every other kind: Task 0 says how that holds today (brief 10 uses only answers with weight above 0) and confirms no new column is needed.
- **The reveal reuses the Bloom Dial's panel** (`RevealedPanel` or whatever "Reveal full profile" renders today) with the coffee's own parts only: notes, the one description, brew tags. The comfort-zone label and the compatibility sentence do not appear on `/map` (Dana, 2026-11-12). If the component cannot hide them, add a prop; do not fork it.
- **A step line change reaches `/map` through Publish** (brief 9). The seed publishes in its transaction and refuses if any placement would move.

---

## Task 0: Verify (write into `CLOSING_REPORT_12.md`; STOP after)

Read-only, test DB and production.

1. **Why Dana's page leads with Blossom.** On 2026-11-24 production read The Waverly as her lead, from her setup answer "something different". On 2026-11-25 her page shows Blossom as the lead and The Waverly below. Read her current setup answers and their history (`v_customer_coffee_feeling`, the change rows since 2026-11-24) and the lead-source rows. Say what changed and whether Usual Drink 2 or 3 changed how the feeling is stored or read. If the page is wrong, say so and STOP; if her answer simply changed, say that.
2. **Reader, writer and view list (G3.9 amended)** for everything this brief would add or change. Expected: none new. Name where the treat answer's family comes from (the quiz's food signal) and through which existing view.
3. **The reveal:** which component and which read "Reveal full profile" uses on the Bloom page, what it shows, and how `/map` can show the coffee parts only. List the fields a customer would see for Tiger Stripe.
4. **Data 1 beside production:** all 36 current shown steps, each with its line today and the proposed line. Flag any proposed line that claims something neither the current lines nor the roaster's notes say.
5. **Write out by hand** Dana's page and the pages of persons 85, 33, 23 and 81 with Data 1 and Data 2 applied.

**STOP.** Show Dana items 1, 3 and 5, and the full table of item 4.

## Parts

**A. Data and schema.** The `treat` choice row; the three treat sentences through `setSaidBackInTx`; the 36 lines through `setStepInTx`. Schema only if Task 0 shows it is needed, with Dana's yes.

**B. Backend.** `matchService.steps`: fill `{from}`; the `treat` kind, dispatched from the choice rows like the others. Each card carries what the reveal needs, or the page calls the existing read; reuse, do not fork.

**C. Frontend.** `/map`: "More about this coffee" on the top card and every step card opens the shared panel beneath that card; one open at a time. Its label is a `dial_customer_copy` row (`more_about`). `/admin/map`: the treat sentences appear in "What we say back"; the new choice row appears in "How a card is chosen".

**D. Tests.** `{from}` is filled on every step card; the treat is used only on a step card, only as the last kind, only when its family matches, and never when switched off; the top card and the lead never use it; the five pinned pages updated. The reveal shows no comfort-zone label, no compatibility sentence and no roaster name.

**E. Seed, then production.** `backend/src/scripts/ellaMapStepComparisons_2026_11_25.ts`, same shape as the earlier seeds, reading through views. Test DB first. **STOP before production:** the dry run and the five pages as built. Apply after Dana's yes, publishing as the next `L<n>` "step comparisons (Ella map 12)".

---

## Data 1: the 36 step lines

`{from}` is the coffee the customer is on. Written only from words already on the steps, the start rules and the coffee sentences.

| from → to | line |
|---|---|
| Benchmark → The Daily | The same chocolate as {from}, livelier, with a bit more bite. |
| The Daily → Benchmark | The same chocolate as {from}, rounder and softer. |
| The Daily → Amsterdam | A step darker than {from}: smoother, with less acidity. |
| Amsterdam → The Daily | Lighter and sweeter than {from}. |
| Amsterdam → Great Heights | The same Brazil as {from}, roasted darker. |
| Great Heights → Amsterdam | The same Brazil as {from} in a lighter roast, with more caramel. |
| Great Heights → Big City | Darker again than {from}: French roast and burnt sugar. |
| Big City → Great Heights | Less smoke than {from}, more fudge. |
| Benchmark → La Familia | Lighter in the cup than {from}: caramel and honey, with a little clementine. |
| La Familia → Benchmark | Rounder than {from}: pure chocolate, less fruit. |
| La Familia → The Village | Just as light as {from}, with more flower and citrus. |
| The Village → La Familia | Softer and sweeter than {from}: caramel and honey. |
| The Village → Cafè Feminista | Creamier than {from}: papaya and candied coconut. |
| Cafè Feminista → The Village | More delicate than {from}: more floral, with grapefruit. |
| Fabricator → Geometric | The same family as {from}, with more fruit, and sweeter. |
| Geometric → Fabricator | The same family as {from} with the fruit turned down: drier and nuttier. |
| Fabricator → Brazil | The base of {from} on its own: chocolate, almond, honey. |
| Brazil → Fabricator | {from} with more going on: citrus and spice added. |
| Brazil → Blossom | Darker than {from}, with a fuller body. |
| Blossom → Brazil | Lighter than {from}: plain chocolate. |
| Blossom → Tiger Stripe | A lighter roast than {from}, with more fruit. |
| Tiger Stripe → Blossom | The same idea as {from}, roasted darker: a fuller body, with less fruit showing. |
| Tiger Stripe → Geometric | The furthest step from {from}: fruit comes first here, sweeter and lighter, with the chocolate behind it. |
| Geometric → Tiger Stripe | More chocolate and body than {from}, with the fruit behind. |
| Tiger Stripe → The Waverly | Close to {from}: chocolate underneath, with more fruit on top, fig and orange. |
| The Waverly → Tiger Stripe | Close to {from} with less fruit: chocolate first, cherry behind. |
| La Familia → Geometric | Keeps the fruit of {from} and adds weight: bright fruit over caramel. |
| Geometric → La Familia | Lighter and sweeter than {from}: caramel, honey, a little clementine. |
| Benchmark → Fabricator | More going on than {from}: hazelnut, a little citrus, a dry finish. |
| Fabricator → Benchmark | Rounder than {from}: pure chocolate, softer, no citrus. |
| D.R. Congo → Geometric | More body than {from}: bright fruit over caramel. |
| Geometric → D.R. Congo | Softer than {from}: clementine and nectarine over caramel and light chocolate. |
| Blossom → Indonesia | Earthier than {from}: dark chocolate, apricot and caramel, with raisin and cedar. |
| Indonesia → Blossom | Cleaner than {from}: a darker roast with a fuller body. |
| Half Moon → Nightcap Decaf | No caffeine at all, where {from} has half: almond, molasses, cola. |
| Nightcap Decaf → Half Moon | Half the caffeine back: walnut and toffee. |

The start rules' lead sentences are already written relative to the first bag and stay as they are.

## Data 2: the treat sentences

| answer | sentence |
|---|---|
| v7_q6_a | Next to your coffee, you'd reach for something rich and comforting. |
| v7_q6_b | Next to your coffee, you'd reach for something soft and sweet. |
| v7_q6_c | Next to your coffee, you'd reach for something fresh and lively. |

## The page this should give Dana (if Task 0 item 1 finds her lead is right)

- Blossom: "For you, a good cup is strong and satisfying. The same idea as Tiger Stripe, roasted darker: a fuller body, with less fruit showing."
- Geometric: "Next to your coffee, you'd reach for something fresh and lively. The furthest step from Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it."
- The Waverly: "Coffee is a daily ritual for you, and you're particular about it. Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange."

## Acceptance (local, signed in as admin, test DB)

- Every step card names the coffee the customer is on and says what changes.
- A step nothing else supports uses the treat sentence when its family matches; otherwise "Your answers point elsewhere."
- Switching the `treat` row off on `/admin/map` removes it on the next read.
- "More about this coffee" opens beneath each card, shows the coffee's notes and description, and shows no comfort-zone label, compatibility sentence or roaster name.
- The top card and the lead never use the treat.
- The old Bloom page is unchanged; every `dial_surface` row says `lane`.
- Click every new control in a browser. Screenshots: Dana's page, one card with the panel open, the two admin tables.

## Docs and closing (G6)

`README.md` here; `WHAT_WE_BUILT.md`; `REGRESSION.md` (a step card compares to the position coffee; the treat is step-card-only and last; the reveal on `/map` shows coffee parts only); `OPEN_TASKS.md`; `CLOSING_REPORT_12.md`; `comments.sql` and `catalog:md` only if the schema changed.

## Do not

- Do not call a model to write or rewrite a customer sentence.
- Do not let the treat answer change a match, a start rule, a lead or a top card.
- Do not build a second reveal component.
- Do not add a reader, writer or view Dana did not approve at the Task 0 STOP.
- Do not change a step's coffees, word, direction or basis; only its line.
- Do not change the customer Bloom page, the lane dial or any `dial_surface` row.
- Do not write production before the STOP in Part E.
