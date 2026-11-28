# Claude Code brief. Ella's Bloom Map 15: every card says something about you, and two steps from Tiger Stripe

Workstream: ella_bloom_map · Written 2026-11-27 by the CTO session · Builds on brief 14 (`DESIGN_MAP_POSITION_2026-11-26.md`, `CLOSING_REPORT_14.md`) and brief 10 (`DESIGN_MAP_REASONS_REV2_2026-11-21.md`) · Model: the cheaper/faster model (G1.13) · Dana runs it; push = deploy · Acceptance in **test mode on the test DB**.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every sentence, tag, order and switch is a row; no answer code, family code or coffee id in code or a view body) · G2.4 CATALOG.md checked before any new table or view (none is expected) · G2.5 one writer per table, reads through views · G2.11 supersede, never delete · G2.14 text is composed at read; nothing composed is stored · G2.17 `comments.sql` then `catalog:md` if the schema changes · G2.19 a quiz taken by someone else is never used · **G3.9 as amended 2026-11-23: Task 0 lists every reader function, writer function, view and table this brief would add or change, beside the existing ones considered, and STOPS for Dana's yes** · G4.1 reuse the shared components; props, not forks · G4.2 nothing typed in · G4.4 positive register: no sentence tells a customer a coffee is not for them or predicts they will dislike it · G4.5 no roaster name, no award name, never "explore" or "confidence" · G4.6 `/map` stays behind the pre-launch gate and admin-only · G5.1 vitest · G1.6 push is deploy, one closing report · **G1.9 one execution at a time: confirm no other session is running before you start and before you push.**
Mode: test. STOP points: after Task 0; before the production seed.

**Goal.** Dana walked her own `/map` on 2026-11-27 after brief 14. Knowing where she is on the map works well. Three things do not:

1. Looking at Fabricator, the cards for Brazil and Benchmark said "Your answers point elsewhere." It reads as "this coffee is not for you", and she drinks and likes those coffees.
2. The "Looking at" card says nothing about her.
3. The heading "One step away" does not say one step from what.

**Why it happens (CTO survey, `matchService.steps`).** A card looks for one of the customer's answers whose family is the coffee's own family, or whose direction is the step's direction. Benchmark and Brazil sit in Balanced, leaning toward Chocolate & Nutty. Dana's answers are Chocolate & Nutty, and her directional answers argue for bolder while those steps go simpler and rounder. Nothing matches, so the card prints the fallback.

**Decisions already made (Dana, 2026-11-27; do not re-open).**

1. **A step is one change.** By that rule Tiger Stripe is missing two steps: to Fabricator (the same coffee with different fruit) and to The Daily (the same coffee without the fruit). Add both, each way. Not Benchmark: it is the Balanced one, and it is already one step from The Daily.
2. **A coffee that leans toward a family is supported by the customer's answers for that family.**
3. **With a quiz, every card says something about the customer.** When an answer supports the coffee, the card says that, as today. When none does, the card carries one of the customer's own-family answers, and the tag says how the coffee relates to them.
4. **"Your answers point elsewhere." is retired.**
5. **No card claims a fit that is not there, and no card predicts a dislike.** For a coffee in another direction, the customer's own answer and the coffee's own line stand side by side, under a tag that names the direction. Nothing like "this may taste burned to you": that waits for real feedback.
6. **A tag on every card, relative to the customer's spot.**
7. **The "Looking at" card is built like a step card:** the tag, a sentence about the customer, then the coffee's line.
8. **With no usable quiz** (none, or one taken by someone else), a card says nothing about the customer. Tag and line only.
9. Everything decided in briefs 10, 12, 13 and 14 stays. The customer Bloom page, the lane dial and every `dial_surface` row stay as they are.

CTO calls, reversible, flag if the code or the data disagrees:

- **Two new rows in "How a card is chosen"** (`dial_reason_choice`, kind `step_support`), dispatched from the rows like the others:
  - `family_lean`: an unused answer whose family is the family the destination coffee leans toward. Placed after `family`, before `direction`.
  - `own_family`: one of the customer's own-family answers (the family as read, and the family the quiz branched from), unused first, then used. It is tried last, after the reuse pass and after `treat`, in the place where `no_support` is printed today.
- **`own_family` never decides the lead.** The lead is chosen as today from the supports that existed before this brief, plus `family_lean`.
- **The tag is three ordered, switchable rows** of a new kind `spot_relation` in `dial_reason_choice` (one new row in `dial_reason_choice_kind`; no new table), first match wins:
  1. `same_family`: the coffee's family is the spot's family.
  2. `leans_together`: the coffee leans toward the spot's family, or the spot leans toward the coffee's family.
  3. `other_direction`: anything else.
  The words are `dial_customer_copy` rows (Data 3). The spot's own coffee, when it shows as a card, carries the "Your spot" tag. The spot's own top card has no tag.
- **The "Looking at" customer sentence** uses the same support rows against the looked-at coffee. The direction kinds apply only when a published step joins the spot to it.
- **The heading while looking** is a new copy row with the coffee's name, "One step from {coffee}". On the spot page the headings stay as they are.
- **`no_support` stays in the table, read by nothing** (OT).
- **The new steps go in through `setStepInTx`** and reach `/map` through Publish, as in brief 12. Basis: `our_guess`, decided by Dana 2026-11-27.

---

## Task 0: Verify (write into `CLOSING_REPORT_15.md`; STOP after)

Read-only, test DB and production.

1. **Reader, writer, view and table list (G3.9 amended)** for everything this brief would add or change. Expected: no new table, view, reader or writer; one kind row, five choice rows, copy rows, four step rows.
2. **Where the lean comes from:** which existing view and column give a coffee's lean family, and whether `mapFacts` already reads it. Name the spot's family and lean the same way.
3. **Data 1 beside the roaster's words.** For each of the four lines: the notes and description on production for both coffees, and any claim in the line that neither says. Propose the step word and the direction for each, from the words and directions already on the map.
4. **The map with the two pairs added:** Tiger Stripe's steps, and confirm the publish moves no placement.
5. **Answer repetition.** Count, for Dana and for persons 85, 33, 23 and 81, how many cards on the spot page would repeat an answer already on the page once `own_family` is on.
6. **Write out by hand**, with the new rows applied:
   - Dana on her spot (now five steps).
   - Dana looking at Fabricator, Benchmark, The Daily, and one Floral coffee.
   - The spot pages of persons 85, 33, 23 and 81.
   - One customer whose quiz was taken by someone else.

**STOP.** Show Dana items 3, 5 and 6, and anything in 1, 2 or 4 that is not as expected.

## Parts

**A. Data and schema.** The `spot_relation` kind row; the `family_lean`, `own_family`, `same_family`, `leans_together`, `other_direction` choice rows; the copy rows of Data 3; the four step rows of Data 1. Schema only if Task 0 shows it is needed, with Dana's yes.

**B. Backend.** `matchService.steps`:
- the two new support kinds, in the order above; `own_family` in place of `no_support`, and never a lead source;
- the tag on every step card and on the looked-at coffee, from the `spot_relation` rows, with the family's customer label filled into the copy row;
- the looked-at coffee's customer sentence;
- with no usable quiz, no customer sentence and no `no_support` line.

**C. Frontend.** `/map`: the tag above the coffee's name on step cards and on the "Looking at" card; the heading with the coffee's name while looking. `/admin/map`: the new rows appear in "How a card is chosen", with the tag rows as their own group; "Read it as" shows which row gave each card its tag and its sentence.

**D. Tests.** A coffee leaning toward the customer's family takes a family answer. `own_family` is used only when nothing else supports the card, is never a lead, and is off when its row is off. No page with a usable quiz prints `no_support`. The three tags, their order, and "Your spot". The looked-at card carries a tag and a sentence. A quiz taken by someone else gives no customer sentence. The pinned pages of briefs 10, 12 and 14 updated. No customer text contains "elsewhere".

**E. Seed, then production.** `backend/src/scripts/ellaMapCardsAboutYou_2026_11_27.ts`, same shape as the earlier seeds, reading through views. Test DB first. **STOP before production:** the dry run and the pages of Task 0 item 6 as built. Apply after Dana's yes, publishing as the next `L<n>` "one change from Tiger Stripe (Ella map 15)".

---

## Data 1: the four step lines (drafts; Task 0 item 3 checks them)

`{from}` is the coffee the customer is on.

| from → to | line |
|---|---|
| Tiger Stripe → The Daily | {from} without the fruit: straight chocolate. |
| The Daily → Tiger Stripe | {from} with a fruit edge: chocolate first, cherry behind. Built for espresso. |
| Tiger Stripe → Fabricator | The same chocolate as {from} with a different accent: hazelnut, a little citrus and spice, in a lighter body. |
| Fabricator → Tiger Stripe | More body than {from}, with cherry where the citrus was. Built for espresso. |

## Data 2: the new choice rows

| kind | code | label | order |
|---|---|---|---|
| step_support | family_lean | An answer for the family the coffee leans toward | after `family` |
| step_support | own_family | One of the customer's own-family answers, when nothing else supports the card | last |
| spot_relation | same_family | The coffee is in the spot's family | 1 |
| spot_relation | leans_together | The coffee leans toward the spot's family, or the spot leans toward its family | 2 |
| spot_relation | other_direction | Anything else | 3 |

## Data 3: the copy rows

| code | text |
|---|---|
| tag_same_family | Same family as your spot |
| tag_leans_together | Close to your spot |
| tag_other_direction | A different direction: {family} |
| tag_your_spot | Your spot |
| steps_title_from | One step from {coffee} |

## The page this should give Dana

Looking at Fabricator (tag, her sentence, the line). The exact answer on each card follows the rows; these show the shape.

- **Looking at · Fabricator** · Same family as your spot · one of her Chocolate & Nutty answers, then the Tiger Stripe → Fabricator line.
- **Brazil** · Close to your spot · one of her Chocolate & Nutty answers, then "Simpler than Fabricator: chocolate, almond, honey."
- **Benchmark** · Close to your spot · one of her Chocolate & Nutty answers, then "Rounder than Fabricator: pure chocolate, softer, no citrus."
- **Tiger Stripe** · Your spot · never the lead.
- A Floral coffee, looked at: "A different direction: Floral", one of her own-family answers, then the coffee's own line. No claim that it suits her.

## Acceptance (local, signed in as admin, test DB)

- No card on any page says "Your answers point elsewhere."
- Dana's spot page shows five steps from Tiger Stripe, with The Daily and Fabricator among them.
- Every step card and the "Looking at" card carry a tag. The spot's own top card carries none.
- Looking at Fabricator, the Brazil and Benchmark cards each open with one of her answers.
- Looking at a Floral coffee shows "A different direction: Floral" and no sentence saying it fits or does not fit.
- Switching `own_family` off on `/admin/map` leaves those cards with the tag and the line only, on the next read.
- A customer whose quiz was taken by someone else sees tags and lines, and no sentence about them.
- The heading while looking names the coffee.
- The old Bloom page is unchanged; every `dial_surface` row says `lane`.
- Laptop and phone. Click every new control in a browser. Screenshots: Dana's spot page, looking at Fabricator, looking at a Floral coffee, the admin rows.

## Docs and closing (G6)

`README.md` here; `WHAT_WE_BUILT.md`; `REGRESSION.md` (with a usable quiz every card says something about the customer; no card rules a coffee out; every card carries a tag relative to the spot; the lean counts as support); `OPEN_TASKS.md` (`no_support` unread); `CLOSING_REPORT_15.md`; `comments.sql` and `catalog:md` only if the schema changed.

## Do not

- Do not call a model to write or rewrite a customer sentence.
- Do not write a sentence that tells a customer a coffee is not for them, or that predicts how it will taste to them.
- Do not let `own_family` decide a lead.
- Do not add a step between Tiger Stripe and Benchmark.
- Do not change any existing step's coffees, word, direction, line or basis.
- Do not measure closeness by counting steps.
- Do not add a reader, writer, view or table Dana did not approve at the Task 0 STOP.
- Do not build any part of the household map.
- Do not change the customer Bloom page, the lane dial or any `dial_surface` row.
- Do not write production before the STOP in Part E.
