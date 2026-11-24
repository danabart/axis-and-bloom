# Claude Code brief. Ella's Bloom Map 10: the reasons on `/map`, Rev 2

Workstream: ella_bloom_map · Written 2026-11-23 by the CTO session · **Design: `DESIGN_MAP_REASONS_REV2_2026-11-21.md` in this folder. Read it in full; it is the spec, and its Data 1 and Data 2 are this brief's data.** · Model: the cheaper/faster model (G1.13: no money, no irreversible data) · Dana runs it; push = deploy · Acceptance in **test mode on the test DB**.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every sentence, order, switch, count and mapping is a row; no answer code, family code, move code or coffee id in code or in a view body) · G2.2 surrogate id PK · G2.3 prefix `dial_` · G2.4 CATALOG.md checked before any new table or view · G2.5 one writer per table, reads through the table's view · G2.11 supersede or switch off, never delete · G2.14 a fact lives once (text is composed at read; nothing composed is stored) · G2.17 `comments.sql` then `catalog:md` · G2.19 a quiz taken by someone else is never used · G2.20 answers are read, never changed · G3.1 routes call services · **G3.9 as amended 2026-11-23: Task 0 lists every reader function, writer function and view this brief would add, beside the existing ones considered, and STOPS for Dana's yes; a lookup that exists under one key is extended, never copied** · G4.1 reuse `useCart` · G4.2 nothing typed in · G4.4 positive register · G4.5 no roaster name, never "explore" or "confidence" · G4.6 `/map` stays behind the pre-launch gate and admin-only · G5.1 vitest · G5.2 acceptance in test mode · G1.6 push is deploy, one closing report · G1.9 one execution at a time; add files by path only.
Mode: test. STOP points: after Task 0; before the production seed (Part E).

**Goal.** Brief 9 made the first-bag card personal, but only that card, and it built sentences from glued fragments. Dana looked at her own page on 2026-11-21: no "Founder's pick", no reasoning on the top card, nothing about her on the step cards, and lines like "If you want a darker roast. A darker roast with a fuller body." After this brief every card on `/map` is one sentence about the customer, from something they answered, and one sentence about the coffee.

**Decisions already made (Dana, 2026-11-21 and 2026-11-23; do not re-open).** They are the "Final decisions" block of the design, restated:

1. **Words are rows**, edited on `/admin/map`. No model writes or rewrites a customer sentence.
2. **Sentences are per quiz answer**, not per customer and not per combination. The page is assembled at read. Nothing is stored per customer.
3. **The choosing is configuration on `/admin/map`:** ordered, switchable rows for the kinds of support a step card may use and for what decides the lead. Counts stay in the parameters table.
4. **The layout is fixed:** a sentence about the customer, then a sentence about the coffee. No lead-ins ("You told us", "You asked for"), no opening clause, no third piece.
5. **The top card always carries the pick:** "Founder's pick" with reasoning on any first match, including one recorded before the start rules; "You are here" with reasoning after a step; the notes only when there is no quiz.
6. When no answer supports a step: "Your answers point elsewhere." An answer is used once per page.
7. Answers are restated in our words (Data 1), not quoted exactly.
8. The customer Bloom page, the lane dial and every `dial_surface` row stay as they are.

CTO calls, reversible, flag if the code disagrees:

- **The direction an answer argues for** is `dial_said_back.move_id` (nullable, references `dial_move`), written by the existing `setSaidBackInTx`.
- **The coffee's plain sentence** is `coffees.map_line` (nullable), written by the existing `catalogService.updateCoffee` like `short_name`, read through `v_dial_coffee_availability`.
- **The ordered, switchable rows** are one small lookup. Proposed `dial_reason_choice`: `id`, `kind_id` (lookup: `step_support`, `lead_source`), `code`, `label`, `sort_order`, `is_active`. Seeded: step support = `family_and_direction`, `family`, `direction`; lead source = `setup_answer`, `start_rule`, `strongest_support`. Task 0 checks CATALOG.md first and says why nothing existing holds an ordered, switchable list of this kind. The service reads the rows and dispatches on them; a code it does not know is skipped and reported by an integrity check, never guessed.
- **"The destination's family" includes the family it branches from in the quiz** (Earthy counts Chocolate & Nutty answers, Floral counts Fruity answers). Read it from the quiz's own branch setup; Task 0 names where. Prefer adding it to an existing view over a new one.
- **The third sentence on a first-match top card** is the answer that triggered the rule's condition. The family a condition is about is data on `dial_start_condition` (a nullable family column), not a name parsed in code.

---

## Task 0: Verify (write into `CLOSING_REPORT_10.md`; STOP after)

Read-only, test DB and production.

1. **Reader, writer and view list (G3.9 amended).** Every reader function, writer function and view this brief would add or change, each beside the existing ones considered and why they do not fit. Include: where a destination coffee's family comes from (`v_dial_placement`); where the branch-parent family comes from; how the top card learns a position is a first match when no current start rule names its coffee (`v_customer_match_current`, `v_customer_match_trail`); the proposed `dial_reason_choice`.
2. **Dana's own account on production** (the admin profile whose `/map` shows Tiger Stripe): how its position was recorded (move, date, map version, inputs), which start rule its answers win today, and why the page showed "You are here". Say whether "first match" can be read from the decision's move alone.
3. **The duplicates from brief 9:** `customerReads.getCupboardCoffee` / `getCupboardCoffeeByProfile` and `getCoffeeFeeling` / `getCoffeeFeelingByProfile`. List every caller and propose one function per lookup that takes either key.
4. **Direct table reads in seed scripts:** `ellaMapReasons_2026_11_20.ts` reads `dial_said_back`, `dial_start_rule` and `dial_step`; `ellaMapDecided_2026_11_16.ts` reads `dial_step`. Propose the view each should read.
5. **Data 1 and Data 2 of the design** beside production: any answer code or coffee that does not match; the roaster's notes for Indonesia, with a proposed `map_line` written only from them.
6. **What stops being read** after this brief (design section "What goes away"): confirm the list, and name any other reader of those rows or columns.
7. **Write out by hand, from the rules,** the page for Dana's account and for persons 85, 33, 23 and 81, beside the design's "Worked pages". Flag any card where the rules give something the design does not show.

**STOP.** Show Dana items 1, 2 and 7, and anything in 3 to 6 that needs her call.

## Task 0.5: Dana's manual steps
None.

---

## Part A: Schema (additive, idempotent; `comments.sql` for every change)

A1 `dial_said_back.move_id`, carried through `v_dial_said_back` (and `v_dial_said_back_fact` for the admin table).
A2 `coffees.map_line` (not blank when set), carried through `v_coffee` and `v_dial_coffee_availability`.
A3 The ordered, switchable rows, as Dana approved at the STOP, with their one view.
A4 `dial_start_condition`: the family a condition is about (nullable).
A5 `dial_customer_copy` row `no_support`: "Your answers point elsewhere."
A6 The branch-parent family, where Task 0 item 1 placed it.
A7 Integrity checks (boot, report only): a current quoted `dial_said_back` row for a quiz answer whose `move_id` was never decided is fine (NULL = argues for none); report a map coffee with no `map_line`; report a `dial_reason_choice` code the service does not know.

## Part B: Backend

B1 **Writers (reuse; declare any change in `comments.sql`):** `setSaidBackInTx` takes the direction; `catalogService.updateCoffee` takes `mapLine`; one writer in `dialPlacementService` for the ordered rows (set order, switch on or off; never delete).

B2 **`matchService.steps` composes by the design** (reuse; replace brief 9's composition, do not add a second one). The response keeps its shape: `firstBag` becomes the top card (`label` code, `text`), each step keeps `isLead` and `text`, admins get `basis`.
- **Top card:** per the design's table. Counts from the parameters table (`dial_quote_family_answers`; the rule-condition sentence replaces `dial_quote_other_answers`).
- **Step cards:** the first active kind of support, in row order, that finds an unused answer; within the family kind an answer with no direction is preferred; else `no_support`. Then the step's `customer_line` (else the destination's `map_line`, else its notes).
- **The lead:** the first active lead source, in row order, that yields one. No source yields one means no lead.
- The kitchen sentence and the setup feeling work as in the design. Usual drink is not used.
- Used-once: the top card takes its answers first, then the lead, then the other steps in their shown order.

B3 **One function per lookup** (Task 0 item 3) and the seed scripts reading through views (item 4).

B4 **Admin:** the existing `/api/admin/map` router serves and edits the ordered rows; `reasons?profileId=` keeps working on the new composition.

## Part C: Frontend

C1 **`/map`:** the top card shows its label (`founder_pick` or `here_title`) and its text in every state. A step card is the name, the text and the price chip. Nothing else changes.
C2 **`/admin/map`:** "What we say back" gains a direction picker per row (bolder, gentler, different, none). The coffee card edits `map_line`. A new small card "How a card is chosen" lists the two ordered sets with drag or up/down and a switch per row. "Read it as" unchanged.

## Part D: Tests (vitest, test DB)

The top card in each state of the design's table, including a first match that no current rule explains. Each kind of support, in order; a kind switched off is skipped; reordering changes the pick. Each lead source, in order and switched off. An answer is never used twice on a page. `no_support` when nothing fits. A never-quoted row and a proxy-taken quiz are not used. No brief 9 frame or `when_line` appears in any composed text. The folded lookups return the same rows by either key.

## Part E: Seed, then production

`backend/src/scripts/ellaMapReasonsRev2_2026_11_23.ts`, same shape as the brief 9 seed, reading through views: the 25 sentences and directions of Data 1 (supersede the brief 9 phrases; `v7_q1_b` stays never quoted), the 18 `map_line` of Data 2 with Indonesia as approved, the ordered rows, the copy row. Test DB first. **STOP before production:** show the dry run and the composed pages for Dana's account and persons 85, 33, 23 and 81 as built; apply after Dana's yes. Publish only if a step row changes.

## Acceptance (local, signed in as admin, test DB)

- Dana's account (or a test account with its answers and position): "Founder's pick" on Tiger Stripe with a reason; a lead; every step card opens with a sentence about her or "Your answers point elsewhere."
- Persons 85, 33, 23 and 81 read like the design's worked pages.
- No card contains "You told us", "You also said", "You asked for" or an "If you want" opener.
- Switching off a kind of support, or reordering the lead sources, changes "Read it as" on the next read.
- A customer with no quiz: notes only.
- No roaster name, "explore" or "confidence" anywhere.
- The old Bloom page is unchanged; every `dial_surface` row says `lane`.
- Click every new admin control in a browser, including the "never quote" switch from the brief 9 correction.
- Screenshots: `/map` for two people, "How a card is chosen", "What we say back" with directions.

## Docs and closing (G6)

`README.md` here (brief 10; the design file; next: the feedback level, then brief 4); `WHAT_WE_BUILT.md`; `WHAT_WE_BUILT_DB.md`; `comments.sql` then `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md`; `REGRESSION.md` (every card is a customer sentence then a coffee sentence; the top card always has a label and a reason when there is a quiz; an answer is used once per page); `OPEN_TASKS.md` (the rows and columns no longer read, listed for a later decision; usual drink; delivered and tasted); `CLOSING_REPORT_10.md`.

## Do not

- Do not call a model, Liam or any AI service to write or rewrite a customer sentence.
- Do not store a composed text.
- Do not add a lead-in, an opening clause or a third piece to a card.
- Do not put a sentence, an answer code, a family code, a move code or a coffee id in code or in a view body.
- Do not add a reader function, a writer function or a view that Dana did not approve at the Task 0 STOP.
- Do not delete or drop anything brief 9 created; what is no longer read stays, and is listed.
- Do not change quiz content, quiz scoring, a start rule's coffee or condition, a step's coffees or `customer_line`, or any stored answer.
- Do not change the customer Bloom page, the lane dial or any `dial_surface` row.
- Do not write production before the STOP in Part E.
