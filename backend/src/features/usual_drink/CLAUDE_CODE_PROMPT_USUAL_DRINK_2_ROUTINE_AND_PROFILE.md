# Claude Code brief — Usual Drink 2: the coffee routine (most-days drink, what goes in it, roast on the bag), the kitchen save fix, and the three-block Flavor Memory tab (Rev 2)

Workstream: usual_drink (brief 1 shipped 2026-11-14, `CLOSING_REPORT_1.md`) · Written 2026-11-24 by the CTO session; Rev 2 the same day folds in `HANDOFF_USUAL_DRINK_2_BRIEF_CORRECTIONS.md` (review at `06ae2cd`) · Model: **Opus for the whole run** (Dana 2026-11-24, G1.13: Part C writes production rows in an insert-only table) · Dana runs it; push = deploy · **Test mode.** No money, no email. Capture and layout only: nothing in matching, the map, the dial or Liam's recommendation changes.

Mockup (three boards: the tab, the edit screen, the tab on a phone): https://claude.ai/artifact/StaGpoaPKHn2C9ddD17fc9 . The mockup shows layout and behaviour. Its sample answers and any word not listed in this brief are placeholders.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (fields, values, groups, dependencies, card membership and every new word are rows; numbers in `brew_parameter`) · G2.2 surrogate id PK · G2.3 prefix `brew_` · G2.4 CATALOG.md checked (why nothing fits: `brew_profile_field` has no grouping, no "values come from another field" link and no card flag; `brew_profile_field_value` has no "excludes the others" flag; no table says which active values a retired value stands for; `lookup_value` rejected as in brief 1 D10) · G2.5 one writer (`customerFacts.record.brewProfileChange` for every fact row; boot seed for `brew_*` lookups), reads via `v_brew_profile_field_current` (one reader, `brewProfile.loadBrewProfileFields`) and `customerReads` · G2.7 lookups are tables · G2.8 idempotent, additive schema; seeds insert if missing; a one-time move of a seeded value is guarded "only while the row still has the seeded value" (the `coffee_feeling` picker move in brief 1 is the pattern) · G2.11 values retired, never deleted · G2.12 facts insert-only · G2.17 comments.sql → catalog:md · G2.20 we never touch data we received (old `takes_it` rows stay as written) · G3.1 routes call services · G3.3 idempotent on (source, source_id) · G3.9 reuse, do not fork; Task 0 lists every new reader, writer and view and STOPS · G4.1 reuse shared components · G4.2 nothing typed in · G4.4 positive copy · G5.1 vitest · G1.6 push is deploy, one closing report.
Mode: test. STOP points: after Task 0; before the `takes_it` conversion script writes on production (Part C).

**Goal.** (1) Three additions to what a customer tells us about their coffee: which drink they make most days, what goes in it as several choices, and the roast written on the bag they have now. (2) The kitchen-coffee box becomes a real autocomplete that can always be saved. (3) The Flavor Memory tab becomes three blocks (palate, coffee routine, history) and works on a phone.

**Why (context, not instructions).** Today the routine sits eighth of nine stacked blocks under "What Liam knows about your setup", eight rows each with its own Edit and Remove. The kitchen box is a filter over chips: typing a name and pressing Save without tapping a chip closes the editor, sends nothing and shows no error (`BrewProfileMirror.saveEdit`, `valueFromDraft` returns undefined), and a brand that is not on the list leaves nothing to tap.

**Decisions already made (Dana 2026-11-24; do not re-open):**

- D1. "Which one most days?" is asked under the drinks question, only when more than one drink is picked. This revises brief 1 D2 ("no daily one marker", 2026-11-12). Time of day is not captured.
- D2. Brew methods stays on the profile, as its own question. The grinder question stays.
- D3. `takes_it` becomes several choices ("What goes in it"). Answers already given stay as written (G2.20).
- D4. Roast level on the bag they have now is added (light, medium, medium dark, dark, not sure), asked under the kitchen coffee.
- D5. The Flavor Memory tab is three blocks: palate, coffee routine, history. The routine stays in this tab (no new tab).
- D6. Everything works on a phone.
- D7. Brief 1's decisions stand except D2 as revised above. In particular D5 (capture only) and D16 (a declined card question is a fact).
- D8. The retake-the-quiz link lives in the palate block, always visible beside its heading (Dana 2026-11-24). `ActivityTimeline` no longer shows it.
- D9. Opus runs the whole brief (Dana 2026-11-24).

CTO calls inside those decisions (rows, so each is changed with a row, not a deploy): the post-result card shows `usual_drink`, `main_drink`, `cupboard_coffee`, `cupboard_roast`, `coffee_feeling`; the other questions are profile-only. Liam does not ask the two new questions when empty.

## Task 0 — Survey and confirm (write into `CLOSING_REPORT_2.md`; STOP after it)

Report file:line for each.

1. Repo on `main`, level with `origin/main`, hash. Report every modified or untracked code file in the working tree (`git status --short`, docs and the genova `.ttf` deletions listed separately). If any file this brief edits carries someone else's uncommitted change, STOP: this brief runs after that work is pushed (G1.9, G1.6). Known on 2026-11-24 and unrelated: `commerce/CLOSING_REPORT_6.md`, this folder's `README.md`, eight deleted `misc/design_documents/genova/*.ttf`, untracked `backend/src/scripts/ellaMapTigerStart_2026_11_24.ts`. They stay unstaged.
2. `brew_profile_field`, `brew_profile_field_value`, `brew_profile_picker`, `brew_parameter` and `v_brew_profile_field_current` as they are on prod (columns, rows, pickers, current labels, prompts and sort orders), so the guarded one-time moves in Part A match what is there.
3. `customer_brew_profile_change` on prod (read-only): `SELECT field, op, source, COUNT(*) … GROUP BY 1,2,3`; every customer's current `takes_it` (from `v_customer_brew_profile`) with its `captured_at`. Confirm the fold and `source` both order by `occurred_at` only (`schema.sql` ~6426, ~6430); Part C is written for that, so this is a check, not a STOP.
4. Every reader of `takes_it`: `brewCard.ts` (`TAKES_IT_PHRASE`, ~73 and ~135), `customerIntegrity.ts` check 31 and the seed lists (~722, ~730), `brewProfile.formatBrewProfileSummary`, Liam's prompt examples in `claude.ts` (~99 to ~110), `resolveRemember` in `routes/sommelier.ts`. Report any other.
5. What brief 1 built for `declined` on the Profile (the op's label mentions the profile): does the Profile write declined rows today? This brief writes none from the Profile.
6. `Profile.tsx` memory tab (~447 to ~700): the nine blocks in order, `openBlock`, the feedback nudge and `expandedJournalOrderId`, `MapTrail`'s own hairline, `CompareOverlay`. Confirm for D4: `ActivityTimeline` always renders and owns the retake link (~135); `TastingJournal` never returns null (its own empty state with a heading, ~21); `BrewCards` returns null on no cards (~22); `bloom/map/MapTrail.tsx` fetches its own data (~18), returns null on no trail (~32) and takes its heading from the API (`me.copy.trail_title`, ~36).
7. `BrewProfileMirror.tsx`, `quiz/BrewFieldControl.tsx`, `quiz/BrewTypeahead.tsx`, `quiz/PostResultCard.tsx` and their tests, as built.
8. G3.9 list. This brief adds: one table (`brew_profile_group`), one table (`brew_profile_field_value_successor`), four columns (A2, A3), one view (`v_customer_brew_profile_words`), one service function (`brewProfileCard.saveRoutine`), one route (`PUT /api/users/brew-profile`), one dated script (Part C), four component props (D4). For each, name the existing objects you considered and why they do not fit, or propose the existing one instead. **STOP here for Dana's yes.**

## Task 0.5 — Dana's manual steps
None.

## Part A — Schema (`schema.sql`, inside the USUAL DRINK block; idempotent; `comments.sql` for every object and column)

A1. `brew_profile_group`: `id SERIAL PK, code UNIQUE, label, sort_order, is_active, created_at, updated_at` (timestamps default `now()`, G2.9). Seed: `make` "What you make" 1 · `gear` "What you brew with" 2 · `adds` "What goes in it" 3 · `kitchen` "In your kitchen now" 4 · `more` "Good to know" 5.

A2. `brew_profile_field` gains:
- `group_id INT REFERENCES brew_profile_group(id)`.
- `values_from_field_id INT REFERENCES brew_profile_field(id)`: this field's answer is one of the customer's own answers to that field. It is offered only when that field holds two or more answers.
- `is_on_card BOOLEAN NOT NULL DEFAULT false`: shown on the post-result card. One-time: true for `usual_drink`, `cupboard_coffee`, `coffee_feeling` (what the card shows today).

A3. `brew_profile_field_value` gains `is_exclusive BOOLEAN NOT NULL DEFAULT false`: picking this value clears the others, and picking another clears it.

A4. `brew_profile_field_value_successor`: `id SERIAL PK, field_value_id INT NOT NULL REFERENCES brew_profile_field_value(id), successor_value_id INT NOT NULL REFERENCES brew_profile_field_value(id), created_at, UNIQUE (field_value_id, successor_value_id)`. A retired value and the active values that say the same thing. Seed: `takes_it.milk_and_sugar` → `takes_it.milk`, `takes_it.sugar`.

A5. Field rows (new rows by seed; changes to existing rows by guarded one-time UPDATE):

| code | label | prompt | kind / picker | group | sort | card | notes |
|---|---|---|---|---|---|---|---|
| usual_drink | (as is) | (as is) | (as is) | make | 1 | yes | |
| main_drink (new) | Most days | Which one most days? | enum / chips | make | 2 | yes | `values_from_field_id` = usual_drink; `liam_topic` my_coffee; `ask_when_empty` false |
| brew_methods | What you brew with | What do you brew with? Pick all that apply. | (as is) | gear | 3 | no | |
| grinder | (as is) | Do you grind at home? | enum / chips (from select) | gear | 4 | no | |
| takes_it | What goes in it | What goes in it? Pick all that apply. | array / multi_select (from enum / select) | adds | 5 | no | `max_items` 4 |
| cupboard_coffee | (as is) | (as is) | (as is) | kitchen | 6 | yes | |
| cupboard_roast (new) | What the bag says | What roast does the bag say? | enum / chips | kitchen | 7 | yes | `liam_topic` my_coffee; `ask_when_empty` false |
| coffee_feeling | (as is) | (as is) | (as is) | kitchen | 8 | yes | |
| decaf_constraint | (as is) | Do you need decaf? | (as is) | more | 9 | no | |
| aversions | (as is) | Anything you never want to taste? | (as is) | more | 10 | no | |

A6. Value rows:
- `takes_it`: `black` relabelled "Nothing, black" and `is_exclusive` true; `milk` "Milk"; new `plant_milk` "Oat or other plant milk"; `sugar` "Sugar"; new `syrup_creamer` "Syrup or flavored creamer"; `milk_and_sugar` set `is_active = false` (retired, never deleted; its label still displays old rows).
- `cupboard_roast`: `light` "Light", `medium` "Medium", `medium_dark` "Medium dark", `dark` "Dark", `not_sure` "Not sure". No decomposition table: nothing reads it yet (brief 1 D4).
- `main_drink` has no value rows of its own.

A7. `v_brew_profile_field_current` (same one reader): value rows join on `COALESCE(f.values_from_field_id, f.id)`; add `group_code`, `group_label`, `group_sort_order`, `values_from_field_code`, `is_on_card`, `is_exclusive`.

A8. New view `v_customer_brew_profile_words` (USUAL DRINK block, not the Customer Blueprint C3 block): per canonical customer and field, the `customer_words` of the latest `set` or `add` row, only while the current value includes a value that accepts words. Reader: `customerReads.getBrewProfileCurrent` (extended, not copied), which returns `words` beside `value`.

A9. `brew_parameter` (insert if missing; every note states the format):
- text: `routine_title` "Your coffee routine" · `routine_sub` "The more we know, the closer your next bag." · `routine_progress` "{answered} of {total} answered" · `routine_missing` "Still to tell us" · `routine_edit` "Edit your routine" · `routine_save` "Save" · `routine_cancel` "Cancel" · `routine_empty` "Tell us how you make your coffee." · `typeahead_use_typed` "Use \"{typed}\" as I typed it" · `brew_card_takes_it` "You take it with {list}."
- text, added in Rev 2: `routine_saving` "Saving" · `routine_save_error` "Please try saving again." · `typeahead_clear` "Clear" (the clear button's accessible label).
- numeric: `typeahead_max_rows` 6 (Range: integer 3 <= value <= 12).

## Part B — Backend

B1. **One rule set, one place** (`brewProfile.ts`, used by the Profile save, the card and `resolveRemember`): the existing `validateFullValue` plus (a) an exclusive value stands alone: an array holding an exclusive value and any other is rejected; (b) a `values_from` field's value must be one of the customer's answers to its source field, taken from the same request when the request carries the source field, else from the stored answer.

B2. `brewProfileCard.saveRoutine({ uid, answers, cleared }, apiEventId)`: the Profile's one save. One transaction. Writes a `set` row per answer whose value or words differ from the stored ones and a `clear` row per cleared field, each through `record.brewProfileChange` (source `onsite`). An unchanged field writes nothing. When a source field changes so that a dependent field's stored answer is no longer among its answers, the dependent gets a `clear` row in the same transaction. No `declined` rows from the Profile. Idempotency (`UNIQUE (source, source_id)`): each row's `source_id` is `<apiEventId>:<field>:<op>`; when `res.locals.apiEventId` is absent, the existing `brewProfileFallbackSourceId(uid, field, op, value)` (`users.ts` ~32) is reused per row, not copied (G3.9; move it beside `saveRoutine` if the route can no longer own it, one copy only).

B3. `PUT /api/users/brew-profile` (`requireAuth, blockAnonymousAuth`, zod, calls B2). The existing PATCH and DELETE routes stay; the frontend stops calling them.

B4. Options payload (`brewProfileOptions`): each field gains `group { code, label, sortOrder }` and `valuesFrom` (source field code or null); each value gains `exclusive`. `cardFields()` becomes active with `is_on_card`. The card's `shown` list carries a dependent field only when it was offered. The payload gains `limits: { typeaheadMaxRows }`, read with the existing `brewParam('typeahead_max_rows')` (`copy` stays text rows only); the component's typed 12 (`BrewTypeahead.tsx` ~46) goes. The server's validation message is logged and never shown to the customer: the frontend shows `routine_save_error`.

B5. `resolveRemember` (Liam): an exclusive value arriving on an array field is written as `set [value]`; a non-exclusive value arriving while an exclusive one is stored is written as `set [value]`. A `main_drink` marker is checked by B1(b); a failed check is dropped and counted as today.

B6. Readers of `takes_it` (Task 0 item 4): each reads an array, and a single stored value as a one-item list (the state between deploy and Part C). `resolveRemember`'s `add` on `takes_it` starts from that one-item list too, so a Liam add in the window keeps the old answer. `brewCard.ts`: the sentence is `brew_card_takes_it` with `{list}` = the labels of the picked non-exclusive values, lower-cased, joined with "and"; `TAKES_IT_PHRASE` goes. `formatBrewProfileSummary` skips nothing new: the field code is unchanged. Integrity check 31 reads the array. `USUAL_DRINK_SEED_CODES` and `USUAL_DRINK_SEED_VALUE_COUNTS` updated for the new rows. One new informational check: an array field whose current value is not an array (expected 0 after Part C).

## Part C — `takes_it` conversion (production data write: STOP for Dana's go)

`backend/src/scripts/usualDrink2TakesIt_2026_11_24.ts`, pattern `ellaMapReasons_2026_11_20.ts`: dry run by default, `--apply` writes, `--expect-db` guard. Selection: each customer whose latest `takes_it` `set` row holds a single value (the raw row, not the folded current value, so a customer Liam added to during the window is still converted; their later `add` rows fold on top). For each: write one new row through `record.brewProfileChange.backfill` (source `backfill`, `source_id` `ud2:takes_it:<user_id>`, `op` set) whose value is the array of that value's successors (A4), or `[value]` when it has none. `occurred_at` = that `set` row's `occurred_at` plus one microsecond, so the new row sorts directly after it with no tie and the date the customer told us does not move; `recorded_at` = now. No view changes. The customer's `source` for the field then reads `backfill`, which `customerReads.factSourceToBrewProfileSource` maps to `profile_page` (~151); say so in the closing report. Old rows are not updated or deleted (G2.20). Run twice, one effect. Run on the test DB in acceptance; on production only after Dana's go, asked for in the same sitting as the deploy, with the row count before and after in the closing report.

## Part D — Frontend

D1. **Autocomplete** (`quiz/BrewTypeahead.tsx`, rewritten in place; used by the card and the Profile):
- A text box with a list under it (combobox semantics, `role="listbox"`, arrow keys, Enter, Escape). Before typing: the pinned values. While typing: matches on label and aliases as today, at most `typeahead_max_rows`.
- The last row is always the `typeahead_use_typed` row once something is typed. Choosing it stores the field's active value that accepts words, with the typed text as the customer's words (trimmed, capped at `max_item_len`).
- The first row is highlighted; Enter or a tap picks. A picked value shows as its label in the box (the customer's words when it carries words), with a clear button.
- Save with text typed and nothing picked takes the highlighted row. Save never closes the editor without either writing or showing the error.
- A stored value that carries words displays the words, not "Something else".

D2. **Field control** (`quiz/BrewFieldControl.tsx`): an exclusive chip clears the others and is cleared by them. A `valuesFrom` field renders its source field's picked values as single-choice chips, only when two or more are picked; when one is picked or the stored answer is no longer among them, it reads as unanswered. One exported helper decides whether a field applies, used by the card and the Profile. No field code in any component.

D3. **Routine card** (`profile/BrewProfileMirror.tsx`, reworked in place):
- Read view: heading `routine_title`, line `routine_sub`, `routine_progress` (fields that apply and have an answer over fields that apply), then one group per `group` in sort order, each with its label and its fields' answers as chips. The most-days drink is marked on its chip in "What you make" (filled chip, the field's label after the drink name). The kitchen group reads as text: brand (or the customer's words), the roast, the feeling.
- A `routine_missing` row lists each unanswered field that applies as a dashed chip with the field's label; tapping one opens the edit view at that question. One `routine_edit` button.
- Edit view: every active field as a question (its prompt) in sort order, one `routine_save` and one `routine_cancel` for the whole form, calling `PUT /api/users/brew-profile` once. Unpicking every chip of a field clears it. The per-row Edit and Remove links go.
- Every word comes from the options payload (`copy`, labels, prompts). This closes the Profile-mirror half of OT-133.

D4. **Three blocks** (`Profile.tsx` memory tab; nothing removed, same components, G4.1):
1. Palate: the existing "Your archetype" heading; the retake link beside the heading, always visible, with the existing `retakeCopy` (D8); the first feature line always, the other feature lines when the primary archetype block is open; the stage note; `DialArchetypeSection` folded as today; `WorthExploring` and the adjacent block directly under it, as today.
2. Routine: D3, directly under the palate block.
3. History: one switcher over `ActivityTimeline`, `TastingJournal`, `BrewCards`, `MapTrail`, one visible at a time. All four stay mounted (a hidden one is hidden, not unmounted), so `MapTrail`'s own fetch runs.
   - Which segments show: Activity always; Tasting journal always (it has its own empty state); Brew cards when `flavorMemory.brewCards` has at least one card; Your trail when `MapTrail` reports content. The default is Activity.
   - `MapTrail` gains a prop `onContent(hasContent, title)` (G4.1, add a prop), called when its fetch settles; `Profile.tsx` learns from it whether the segment exists and its label (`trail_title` from the API). The fetch is not lifted.
   - Labels: the trail's comes from that callback. The other three headings are typed strings today ("Flavor activity", "Tasting journal", "Brew cards"); each component exports its heading as a constant and the switcher reads it, so the string exists once. No new typed words; moving those three to data stays with OT-133.
   - Each of the four gains a `hideHeading` prop, set inside the switcher. `MapTrail`'s own hairline is dropped inside the switcher the same way.
   - `ActivityTimeline` no longer renders the retake link (D8); `Profile.tsx`'s fallback retake link (~675 to ~684) goes, since the palate link is always there.
- The feedback nudge moves to the top of the tab, above block 1; "Leave feedback" selects the journal segment and expands that order.
- The Liam link, the fallback retake link and `CompareOverlay` stay, after block 3.
- The empty state (`NEW_NO_QUIZ`) is unchanged.

D5. **Phone** (check at 390 px wide):
- One column: the routine groups and every block stack; no two-up row anywhere in the tab.
- The tab row and the history switcher scroll sideways on one line; they never wrap.
- Every chip, button and list row is at least 44 px tall.
- Text inputs use a 16 px font or larger (no zoom on focus on iOS).
- In the edit view the Save and Cancel bar stays reachable at the bottom of the screen; the autocomplete list opens under its box and stays visible above the keyboard.

D6. **Post-result card** (`PostResultCard.tsx`): renders the card fields from the payload as today, with D1 and D2. Nothing else changes.

## Part E — Tests (vitest, test DB; G5.1)

Backend: B1 (a) and (b) accept and reject cases; `saveRoutine` unchanged field writes nothing, changed field writes one row, run twice with the same `apiEventId` writes once, the same with no `apiEventId` inside the fallback's minute, source change clears the dependent in the same transaction; `resolveRemember` exclusive cases; the conversion script (single value → array, the new row sorts after the original with no tie, a customer with a Liam `add` after their single `set` is still converted and keeps both, `milk_and_sugar` → `[milk, sugar]`, run twice one effect, old rows untouched); `brewCard` sentence for one and two additions and none for black; seed lists.
Frontend: typeahead (row count follows `limits.typeaheadMaxRows`; typed text with no match can be saved as words; Enter picks the highlighted row; Save with unpicked text saves; stored words display); exclusive chip; dependent field appears at two drinks and disappears at one; routine card progress count; history switcher hides Brew cards and Your trail when empty and keeps Activity and Tasting journal; the retake link shows in the palate block whichever segment is selected.

## Acceptance (one closing report, `CLOSING_REPORT_2.md`)

Local backend, test DB, one signed-in test customer, at desktop width and at 390 px. Screenshots into this folder (`ud2_*.png`).
1. Kitchen coffee: type a listed brand and press Save without tapping → saved. Type a brand that is not listed → saved as typed, shown as typed after reload. Row ids in the report.
2. Pick two drinks → "Which one most days?" appears; pick one; remove that drink → the most-days answer is cleared in the same save.
3. "What goes in it": milk and sugar together save; "Nothing, black" clears the others.
4. Roast saves and shows in the kitchen group.
5. A customer with an old single `takes_it`: before the script it still displays; after the script it is an array; the old row is unchanged.
6. The tab shows three blocks; the history switcher hides empty segments; the feedback nudge opens the journal; the retake link is in the palate block. A forced save failure shows `routine_save_error`, never the server's message.
7. A new quiz: the card shows its five questions, most-days only after a second drink is picked; Save and Skip write the rows brief 1 defined.
8. Lints, `tsc --noEmit` (both sides), `vitest run src` green apart from the known set (OT-140). Then push, deploy green, boot log clean, production smoke of 1, 3 and 6 signed in. Then, in the same sitting, STOP for Dana's go on Part C.

## Docs (G6)

`WHAT_WE_BUILT.md` (next number, naming this file) · `WHAT_WE_BUILT_DB.md` one "As of" line · `comments.sql` → `npm run catalog:md -- --expect-db axisandbloom` → `CATALOG.md` committed · `REGRESSION.md` (acceptance 1 to 3 and 6) · `OPEN_TASKS.md`: OT-133 mirror half closed; new lines for (a) the unused PATCH and DELETE brew-profile routes, (b) drinks that carry milk in their name (`drip_milk`, `americano_milk`) overlap "What goes in it", Dana's call, (c) nothing reads `main_drink` or `cupboard_roast` yet (a later map brief), (d) the mockup's "so we send whole bean" line was left out: no rule links the grinder answer to what ships · this folder's `README.md` · `CLOSING_REPORT_2.md`.

## Do not

- Do not change matching, the map, the start rules, the dial or Liam's recommendation.
- Do not update or delete any `customer_brew_profile_change` row, and do not delete a value row.
- Do not add a field code, a value code or a customer-facing word to a component, a service or a view body.
- Do not copy `getBrewProfileCurrent`, `validateFullValue` or the field-list reader; extend them.
- Do not re-implement the dial, the archetype section, the timeline, the journal, the brew cards or the trail; the tab only arranges them.
- Do not run Part C on production without Dana's go.
- Do not stage anything but this brief's files: commits add files by path; the unrelated working-tree changes in Task 0 item 1 stay unstaged.
- Do not open a PR or leave a commit unpushed.
