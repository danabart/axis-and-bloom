# Claude Code brief — Usual Drink 3: routine fixes after Dana's first look (cards and chips, black with milk, several coffees in the kitchen, the autocomplete list)

Workstream: usual_drink (brief 2 finished 2026-11-25, `CLOSING_REPORT_2.md`) · Written 2026-11-25 by the CTO session · Model: **Opus for the whole run** (Part C writes production rows in an insert-only table, G1.13; same call as brief 2 D9) · Dana runs it; push = deploy · **Test mode.** Capture and layout only: nothing in matching, the map, the dial or Liam's recommendation changes.

Mockup, unchanged from brief 2: https://claude.ai/artifact/StaGpoaPKHn2C9ddD17fc9 (the white cards and the chips are the reference for Part D).

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every change below is a row or reads a row) · G2.4 CATALOG.md checked (no new table, column or view is planned; one view body changes) · G2.5 one writer (`customerFacts.record.brewProfileChange`), reads via `customerReads` and the existing views · G2.8 one-time moves guarded "only while the row still has the seeded value" · G2.11 nothing deleted · G2.12 facts insert-only · G2.17 comments.sql → catalog:md · G2.20 old rows stay as written · G3.3 idempotent · G3.9 reuse, do not fork; Task 0 lists anything new and STOPS · G4.1 reuse shared components · G4.2 nothing typed in · G4.4 positive copy · G5.1 vitest · G1.6 push is deploy, one closing report.
Mode: test. STOP points: after Task 0; before the `cupboard_coffee` conversion writes on production (Part C), asked for in the same sitting as the deploy.

**Goal.** Make the live routine match the mockup and Dana's first use of it: every answer sits in a chip and the blocks sit in white cards; black can be picked with milk; a customer can name up to three coffees in the kitchen and say which one they drink most; the autocomplete list can be browsed and typing replaces what the box holds.

**Decisions already made (Dana 2026-11-25, after using the live page; do not re-open):**

- D1. Cards and chips as in the mockup: the routine block in a white card, each question of the edit view in its own white card, every answer of the read view as a chip, the kitchen answers included (this replaces brief 2 D3's "the kitchen group reads as text").
- D2. "What goes in it": black can be picked together with the others (her case: black espresso, milk in the drip). The exclusive rule comes off `takes_it`, and the value is labelled "Black".
- D3. The grinder stays one answer; the question is reworded to "What do you grind with most?".
- D4. The kitchen takes up to three coffees. A follow-up asks which one they drink most, shown only when more than one is named (the same mechanism as "Which one most days?"). The roast and the feeling stay about the one they drink most.
- D5. The autocomplete: the full list can be browsed before typing, and typing into a box that holds an answer replaces it.
- D6. Brief 1 and brief 2 decisions stand except where D1 to D5 revise them (brief 1 D2: `cupboard_coffee` was single).

CTO calls inside those decisions: one typed-in name per kitchen answer for now (the fact row holds one `customer_words` text; a second unlisted coffee uses the list's "A local roaster not on this list"); no storage change in this brief. The follow-up question is on the post-result card.

## Task 0 — Survey and confirm (write into `CLOSING_REPORT_3.md`; STOP after it)

1. Repo on `main`, level with `origin/main`, hash; every modified or untracked code file (as brief 2 item 1). The unrelated `commerce/CLOSING_REPORT_6.md` and the genova `.ttf` deletions stay unstaged.
2. Production, read-only: the current rows of `brew_profile_field` and `brew_profile_field_value` for `takes_it`, `grinder`, `cupboard_coffee`, `cupboard_roast`, `coffee_feeling`, `decaf_constraint`, `aversions` (labels, prompts, pickers, kinds, sort orders, `is_exclusive`, `is_on_card`), so each guarded move in Part A matches. `SELECT op, source, COUNT(*)` for `cupboard_coffee`; every customer's current `cupboard_coffee` with `customer_words` and `captured_at`.
3. Every reader of `cupboard_coffee` as one value: `v_customer_cupboard_coffee` (`schema.sql`, `value_jsonb #>> '{}'`), `customerReads.getCupboardCoffee` (~869) and its callers (`matchService` ~667, the `/map` said-back), the admin counts (`customerReads` ~943), integrity check ~934, `v_customer_brew_profile_words`, `dial_said_back_source`, Liam's prompt line (`claude.ts` ~111) and `resolveRemember` (`sommelier.ts` ~470 to ~520). Report any other.
4. Confirm the pieces this brief reuses, as built: `values_from_field_id` and `fieldApplies` (main_drink), `is_exclusive` and `toggleMulti`, the single-value-reads-as-a-list handling in `draftFromValue`, `answerList` and `resolveRemember`'s `[old, new]` rule (is it generic to any array field, or tied to `takes_it`?), `customerReads.getLatestSingleValueSets(field)`, `usualDrink2TakesIt_2026_11_24.ts`, and whether `record.brewProfileChange.backfill` can carry `customer_words` (its insert lists no such column today).
5. `BrewTypeahead.tsx`, `BrewFieldControl.tsx`, `BrewProfileMirror.tsx`, `PostResultCard.tsx` as brief 2 left them. Confirm the two autocomplete findings: before typing only the pinned values show (`filterTypeahead`), and typing into a box that shows a picked value appends to that text (`value={typing ? query : pickedText}` with `onInput(e.target.value)`).
6. G3.9 list. Planned: no new table, column or view; one view body changed (`v_customer_cupboard_coffee`); one field row and its values-from link; one dated script (or the brief 2 script given a field argument, say which); `backfill` extended to carry `customer_words`. If the build needs anything else, name it here with what was considered. **STOP for Dana's yes.**

## Task 0.5 — Dana's manual steps
None.

## Part A — Rows (`schema.sql`, a marked USUAL DRINK 3 block; guarded one-time moves; `comments.sql` where a meaning changes)

A1. `takes_it`: value `black` gets `is_exclusive = false` and label "Black" (only while the label is still "Nothing, black").

A2. `grinder`: prompt "What do you grind with most?" (only while it is still "Do you grind at home?").

A3. `cupboard_coffee`: kind `array`, `max_items` 3, prompt "Which coffees are in your kitchen right now? Up to three." (each only while the row still has brief 1's value). The picker stays `typeahead`. Values `dont_know`, `nothing` and `pods_unknown` get `is_exclusive = true`.

A4. New field `main_cupboard`: label "Drink most", prompt "Which one do you drink most?", enum / chips, group `kitchen`, `values_from_field_id` = cupboard_coffee, `is_on_card` true, `liam_topic` my_coffee, `ask_when_empty` false. Sort order directly after `cupboard_coffee`; `cupboard_roast`, `coffee_feeling`, `decaf_constraint` and `aversions` each move down one (guarded on their brief 2 sort orders).

A5. `cupboard_roast`: prompt "What roast does the bag say? If you have several, the one you drink most." (only while it is still brief 2's).

A6. `v_customer_cupboard_coffee` keeps its grain and columns: one row per customer, the coffee they drink most. That is `main_cupboard` while it is still among the kitchen answers, else the only kitchen answer, else no row. It reads an array and a single stored value alike. Its readers (Task 0 item 3) keep working unchanged; the admin counts then count the main coffee only, and the comment says so.

A7. `brew_parameter` text, insert if missing: `typeahead_remove` "Remove {name}" (the accessible label of a picked coffee's remove button).

## Part B — Backend

B1. Validation (`brewProfile.ts`, the one rule set): an array answer may hold at most one value that accepts words, with one `customer_words` text. The existing exclusive and values-from rules cover the rest; a `main_cupboard` answer that is the words value means the typed-in coffee.

B2. `saveRoutine`, the card writer and the options payload need no new shape. Confirm with tests that `cupboard_coffee` as a list and `main_cupboard` flow through them, and that removing the main coffee from the list clears `main_cupboard` in the same save.

B3. Liam (`resolveRemember`, the prompt's field list): a `cupboard_coffee` marker now adds to the list under the array rules (cap, exclusive values, the single-stored-value rule). A marker with words while the list already holds a typed name replaces that typed name. The prompt line in `claude.ts` (~111) says several coffees may be remembered.

B4. Integrity: the seed lists and counts for the new field and flags; the informational check for an array field whose current value is not an array now covers `cupboard_coffee` (expected 0 after Part C).

## Part C — `cupboard_coffee` conversion (production data write: STOP for Dana's go)

Same rule as brief 2 Part C, for `cupboard_coffee`, reusing `customerReads.getLatestSingleValueSets(field)` and the brief 2 script (give it a `--field` argument or add a dated sibling; one pattern, not a fork): each customer whose latest `cupboard_coffee` `set` row holds a single value gets one new row (source `backfill`, `source_id` `ud3:cupboard_coffee:<user_id>`, `op` set) with `[value]`, `occurred_at` = that row's plus one microsecond computed in SQL, `recorded_at` = now, and the original row's `customer_words` carried onto the new row so a typed-in name still displays. Old rows are not updated or deleted. Dry run by default; twice is once. Test DB in acceptance; production only after Dana's go, with counts before and after and the checks re-run.

## Part D — Frontend

D1. **Cards** (`BrewProfileMirror.tsx`, `Profile.tsx` only where the block is placed): the routine block sits in a white card (the site's page white, hairline border, rounded corners, as the mockup). In the edit view each question sits in its own white card. On a phone the cards run the full column width.

D2. **Every answer is a chip** (read view): the "all single-choice group reads as text" branch goes. Each group shows its answers as chips: each kitchen coffee (the typed-in one by the customer's words), the roast, the feeling, decaf, each never-want-to-taste item. The coffee they drink most is the filled chip with the follow-up field's label after its name, as "most days" is on the drinks.

D3. **Autocomplete** (`BrewTypeahead.tsx`, in place; the Profile and the card):
- Several answers: a field of kind `array` with the `typeahead` picker shows its picked values as chips with a remove button (`typeahead_remove`) and keeps the box for the next one, until `max_items`. The box empties after each pick. An exclusive value replaces the others and is replaced by them. The "use as I typed it" row is offered only while the list holds no typed-in name.
- Browse: on focus with an empty box the list shows every value, pinned first then in sort order, scrolling inside the overlay. `typeaheadMaxRows` applies only while typing.
- Replace: for a single-answer field, focusing a box that shows an answer selects its text, and typing replaces it.
- Already-picked values are not offered again.

D4. **Follow-up question** (`BrewFieldControl.tsx`): the values-from control offers the source's picked values by their display text, so a typed-in coffee shows by the customer's words. No field code in any component.

D5. Phone (390 px): as brief 2 D5; the picked-coffee chips wrap, each remove button is at least 44 px.

## Part E — Tests (vitest, test DB)

Backend: `["black","milk"]` saves on `takes_it`; `cupboard_coffee` with three listed values saves, with four is refused, with `nothing` plus another is refused, with one typed name saves and displays; `main_cupboard` must be among the kitchen answers and is cleared when its coffee is removed; `v_customer_cupboard_coffee` returns the main coffee, the only coffee, and no row for several with no main; `getCupboardCoffee` and the `/map` said-back read unchanged for a one-coffee customer; Liam add cases; the conversion (single to list at plus one microsecond, words carried, twice is once, old row untouched).
Frontend: the browse list on focus; typing replaces a shown answer; three picks then the box stops offering; remove a chip; the typed row disappears once a typed name is in the list; every read-view answer is a chip; the drink-most chip is marked; the cards render.

## Acceptance (one closing report, `CLOSING_REPORT_3.md`; screenshots `ud3_*.png`)

Local backend, test DB, a marked test customer, at desktop width and at 390 px.
1. "What goes in it": black and milk together save and show as two chips.
2. Kitchen: focus the empty box and scroll the whole list; type "star" and pick Starbucks; type a name that is not listed and save it as typed; both show as chips after reload. "Which one do you drink most?" appears at two coffees; the picked one is the filled chip.
3. A customer with one stored coffee from before this brief still shows it; after the test-DB conversion it is a list; the old row is unchanged.
4. Grinder shows the reworded question and takes one answer.
5. The read view shows every answer as a chip inside the white card; the edit view shows each question in a white card.
6. A new quiz: the card's kitchen question takes several coffees and the follow-up appears at two.
7. `/map` for a customer with a kitchen answer reads as before.
8. Lints, `tsc --noEmit` (both sides), `vitest run src` green apart from the known set. Push, deploy green, boot log clean, production smoke of 1 and 2 through the API as the smoke test user. Then, in the same sitting, STOP for Dana's go on Part C.

## Docs (G6)

`WHAT_WE_BUILT.md` (next number, naming this file) · `comments.sql` → `npm run catalog:md -- --expect-db axisandbloom` → `CATALOG.md` committed · `REGRESSION.md` (acceptance 1, 2, 5) · `OPEN_TASKS.md`: one typed-in name per kitchen answer (a second needs per-item words on the fact row); the list of names grows from what customers type (OT-130) · this folder's `README.md` · `CLOSING_REPORT_3.md`.

## Do not

- Do not change matching, the map, the start rules, the dial or Liam's recommendation.
- Do not update or delete any `customer_brew_profile_change` row, and do not delete a value row.
- Do not add a table, a column or a view without naming it in Task 0 and getting Dana's yes.
- Do not add a field code, a value code or a customer-facing word to a component, a service or a view body.
- Do not fork the brief 2 conversion script, `getLatestSingleValueSets`, the validator or the typeahead; extend them.
- Do not make the grinder several answers.
- Do not stage anything but this brief's files; commits add files by path.
- Do not run Part C on production without Dana's go.
- Do not open a PR or leave a commit unpushed.
