# Claude Code brief. Ella's Bloom Map 16: every card is measured from your spot

Workstream: ella_bloom_map · Written 2026-11-27 by the CTO session · Corrects brief 15 (`CLOSING_REPORT_15.md`) · Builds on brief 14 (`DESIGN_MAP_POSITION_2026-11-26.md`) · Model: the cheaper/faster model (G1.13) · Dana runs it; push = deploy · Acceptance in **test mode on the test DB**.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every tag, word, joiner, strength word and limit is a row or a parameter) · G2.4 CATALOG.md checked before any new table or view (none is expected) · G2.5 one writer per table, reads through views · G2.11 switch off or supersede, never delete · G2.14 text is composed at read; nothing composed is stored · G2.17 `comments.sql` then `catalog:md` if the schema changes · G2.19 a quiz taken by someone else is never used · **G3.9 as amended 2026-11-23: Task 0 lists every reader function, writer function, view and table this brief would add or change, beside the existing ones considered, and STOPS for Dana's yes** · G4.1 props, not forks · G4.2 nothing typed in · G4.4 positive register ("Outside your comfort zone" is an honest state label and is allowed; no sentence predicts how a coffee will taste to the customer) · G4.5 · G4.6 `/map` stays behind the pre-launch gate and admin-only · G5.1 vitest · G1.6 push is deploy, one closing report · **G1.9 one execution at a time: confirm no other session is running before you start and before you push.**
Mode: test. STOP points: after Task 0; before the push.

**Goal.** Dana walked `/map` on 2026-11-27 after brief 15. Three things broke her trust in the page:

1. Every coffee she landed on opened with the same sentence about her ("Coffee should feel like a reward for you…"), on fruity and floral coffees too.
2. The sentences did not change with the place on the map.
3. Nothing showed how far a coffee is from her spot. Amsterdam and Big City read like any other card, and Amsterdam was tagged "Same family as your spot". For her, Amsterdam is Tiger Stripe with the fruit removed and then roasted darker: two changes away, and the page said nothing about it.

**Her standing instruction, 2026-11-27:** the cases she names are examples. Apply the rule to every coffee and every spot, not only the ones listed here.

**Decisions already made (Dana, 2026-11-27; do not re-open).**

1. **Everything on a card is measured from the customer's spot.** A card says how far the coffee is from the spot and what changed on the way.
2. **The tag is the distance in steps** from the spot, over the published steps. This replaces the family tags of brief 15.
3. **The comfort zone is the spot and one step around it.** A coffee further out carries "Outside your comfort zone" beside its step count. It is a definition, not a prediction.
4. **Beyond one step, the card carries a summary of what is different.** Each kind of change is named once. Repeats are merged into one stronger word. It is a summary, not a route: it never names the spot's coffee, never says "from" or "then", and never lists the same change again and again. The tag already says how far the coffee is.
5. **The customer's answers are quoted only on the spot page and on a "Looking at" card inside the comfort zone.** A one-step coffee's "Looking at" card says exactly what its step card says on the spot page: the same answer, the same line. Further out, no quiz answer is quoted.
6. **No filler.** `own_family` is switched off. No sentence about the customer appears unless it was chosen for that coffee on the spot page.
7. **"Where we'd take you next" appears on the spot page only.** While the customer looks at another coffee, all its steps are shown as equals under "One step from {coffee}".
8. **No sentence predicts a taste or a dislike.** Distance and changes are facts of the map. What the customer thinks of a coffee comes only from their feedback.
9. Briefs 10, 12, 13 and 14 stay. The spot page's top card and step sentences stay exactly as they are today. The customer Bloom page, the lane dial and every `dial_surface` row stay as they are.

CTO calls, reversible, flag if the code or the data disagrees:

- **Distance** is the fewest published, shown steps from the spot to the coffee, following steps in their own direction, on the active map. Ties between equally short ways are broken the way step cards are ordered today (basis order, then word, then id), so the answer is always the same.
- **The comfort zone's size is a parameter** (`dial_comfort_zone_steps`, 1). So is the most kinds of change a summary names (`dial_path_max_changes`, 3).
- **The summary is built from the words already on the steps** (`dial_step.button_word`, lower-cased), in the order of the way:
  - the same word on steps next to each other is said once, with a strength word by count: twice "much", three times or more "far" (both copy rows);
  - the parts are joined by copy rows: ", " between parts and ", and " before the last one;
  - the sentence starts with a capital and ends with a full stop: "Less fruit, and far bolder."
  - No new sentence is written per coffee, and no model is called.
- **A coffee no way reaches** (for example the decaf pair from a regular spot) carries its own tag and no summary.
- **On the spot page, step cards carry no distance tag.** They are all one step away and the headings say so.
- **While looking at a coffee:**
  - the top card: the tag; then, inside the comfort zone, what its step card says on the spot page; outside it, the summary and the coffee's own line;
  - each step card: the tag (measured from the spot, not from the looked-at coffee) and the step's line. No quiz answer;
  - the spot's own coffee keeps the "Your spot" tag.
- **The brief 15 rows are switched off, not deleted:** `own_family`, and the `spot_relation` rows `same_family`, `joined_by_step`, `leans_to_spot_family`, `other_direction`. `family_lean` stays on: it still serves one-step cards on a spot page. Their copy rows stay, read by nothing (OT).
- **All step pairs are read once** through the existing `dialReads.activeStepWords`. If it lacks what the distance needs, extend it; do not add a reader.

---

## Task 0: Verify (write into `CLOSING_REPORT_16.md`; STOP after)

Read-only, test DB and production.

1. **Reader, writer, view and table list (G3.9 amended).** Expected: no new table, view, reader or writer; two parameters, copy rows, rows switched off.
2. **Every summary, for every spot.** For each of the 18 coffees as the spot, the distance, the tag and the summary sentence for each of the other 17. Write the full table to a file under `backend/tmp/`. In the report give:
   - the full table for Tiger Stripe as the spot;
   - the count by distance, for every spot;
   - **every sentence that reads badly**, whatever the spot: a change followed by its opposite, more kinds of change than the limit, a word that does not take "much" or "far", a way that passes through a decaf coffee, a coffee with no way to it.
3. **Words.** List the distinct step words on the active map and show each with "much" and "far" in front. Flag any that needs a different strength form.
4. **Write out by hand**, with this brief applied:
   - Dana on her spot (unchanged, to confirm);
   - Dana looking at The Daily, Fabricator, Benchmark, Amsterdam, Big City, The Village and Half Moon;
   - the spot page and two looked-at pages for persons 85, 33 and 23, one inside and one outside the comfort zone each.
5. **Repetition check.** Across all of Dana's pages in item 4, list any sentence about her that appears on more than one page. Expected: only where a one-step coffee repeats its own spot-page card.

**STOP.** Show Dana items 2 (Tiger Stripe's table and every flagged sentence), 3 and 4.

## Parts

**A. Data and schema.** The two parameters; the copy rows of Data 1; the five rows switched off through their writer. Schema only if Task 0 shows it is needed, with Dana's yes.

**B. Backend.** `matchService.steps`:
- the distance from the spot for the looked-at coffee and for every step card;
- the tag from the distance and the comfort-zone parameter;
- the summary;
- inside the comfort zone, the looked-at card composed as that coffee's step card on the spot page;
- no lead and no quiz answer on step cards while looking;
- admins get the way that was taken, for "Read it as".

**C. Frontend.** `/map`: the new tag and the summary on the "Looking at" card; tags on step cards while looking; no lead section while looking. `/admin/map`: the two parameters; "Read it as" shows the way, the distance and the words used.

**D. Tests.** The distance for every pair on the test map. The summary: one word once, two the same, three the same, a change and its opposite, the limit. The comfort-zone parameter at 1 and at 2. A one-step coffee's "Looking at" card equals its spot-page step card. No quiz answer beyond the comfort zone. No lead while looking. A coffee with no way to it. The spot page is byte-for-byte what it is today. The pinned pages of briefs 14 and 15 updated.

**E. Push.** Test DB first. **STOP before the push:** the pages of Task 0 item 4 as built, and the flagged sentences as built. Push after Dana's yes, then the seed on production, the read-back, `catalog:md` if needed, and the smoke of `/map`.

---

## Data 1: the copy rows (drafts)

| code | text |
|---|---|
| tag_steps_one | One step from your spot |
| tag_steps_many | {n} steps from your spot |
| tag_outside_comfort | Outside your comfort zone · {steps} |
| tag_no_way | A different part of the map |
| path_join | ", " (between parts) |
| path_last_join | ", and " (before the last part) |
| path_twice | much {word} |
| path_more | far {word} |

`{steps}` is the text of `tag_steps_many`. `tag_your_spot` exists.

## The pages this should give Dana (wording follows the rows; these show the shape)

- **Looking at · The Daily** · One step from your spot · the same card as on her spot page: "Coffee is a daily ritual for you, and you're particular about it. Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite."
- **Looking at · Benchmark** · Outside your comfort zone · 2 steps from your spot · "Less fruit, and lighter." Then Benchmark's own line.
- **Looking at · Amsterdam** · Outside your comfort zone · 2 steps from your spot · "Less fruit, and bolder." Then Amsterdam's own line.
- **Looking at · Big City** · Outside your comfort zone · 4 steps from your spot · "Less fruit, and far bolder." Then Big City's own line.
- **Looking at · The Village** · Outside your comfort zone · its step count · the changes, each once, for example "More fruit, lighter, and more floral." Then The Village's own line.
- On every one of these pages, the steps below are equals under "One step from {coffee}", each with its own distance from Tiger Stripe.

## Acceptance (local, signed in as admin, test DB)

- Dana's spot page is unchanged.
- No sentence about the customer appears on a "Looking at" card outside the comfort zone, or on any step card while looking.
- Walking Tiger Stripe, The Daily, Amsterdam, Great Heights, Big City shows the step count rising by one each time and "Outside your comfort zone" from Amsterdam on.
- No two different coffees show the same summary sentence unless they are reached by the same kinds of change.
- No summary repeats a word.
- No page shows "Where we'd take you next" while looking.
- Setting the comfort zone to 2 on `/admin/map` moves the label out by one step on the next read; put it back.
- The old Bloom page is unchanged; every `dial_surface` row says `lane`.
- Laptop and phone. Click every new control in a browser. Screenshots: looking at The Daily, Amsterdam, Big City and The Village; the admin parameters; "Read it as".

## Docs and closing (G6)

`README.md` here; `WHAT_WE_BUILT.md`; `REGRESSION.md` (every card off the spot page is tagged with its distance from the spot; beyond the comfort zone a card summarises the changes and quotes no quiz answer; no lead while looking; no filler sentence); `OPEN_TASKS.md` (rows and copy no longer read); `CLOSING_REPORT_16.md`; `comments.sql` and `catalog:md` only if the schema changed.

## Do not

- Do not call a model to write or summarise anything.
- Do not list the same change more than once in a summary.
- Do not name the spot's coffee in a summary, and do not write "from" or "then" in it.
- Do not quote a quiz answer outside the comfort zone, or on a step card while looking.
- Do not write a sentence that predicts how a coffee will taste to the customer.
- Do not change the spot page.
- Do not delete a row; switch it off.
- Do not fix only the coffees named in this brief: the rule is for every coffee and every spot.
- Do not add a reader, writer, view or table Dana did not approve at the Task 0 STOP.
- Do not build any part of the household map.
- Do not change the customer Bloom page, the lane dial or any `dial_surface` row.
- Do not push before the STOP in Part E.
