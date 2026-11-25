# Usual Drink 2 — closing report

Brief: `CLAUDE_CODE_PROMPT_USUAL_DRINK_2_ROUTINE_AND_PROFILE.md` (Rev 2). Run on Opus (D9).

## Task 0 — Survey (2026-11-24, read-only; STOP for Dana's yes)

Production was read through the Cloud SQL proxy, inside `BEGIN READ ONLY` transactions, as `axisbloom` (`current_database() = axisandbloom`). The helper scripts are in `backend/tmp/` (gitignored): `ud2_task0.mts`, `ud2_task0b.mts`, `ud2_task0c.mts`. Nothing was written, staged or committed.

### 1. Repo

- `main` at **3cc5c43**, level with `origin/main` (0 / 0).
- **HEAD moved while Task 0 ran.** At the start HEAD was `e5e4275`, and `backend/src/scripts/ellaMapReasons_2026_11_20.ts` had an uncommitted change (`lastRunAt`). Another session then committed and pushed it as `3cc5c43` ("Ella map 11 follow-up", 15:02). If that push is still deploying, or that session is still working in the repo, this brief waits for it to finish (G1.9).
- Modified, not code: `backend/src/features/commerce/CLOSING_REPORT_6.md` and `backend/src/features/usual_drink/README.md`. The README diff is the CTO session's line for this brief ("2. … **Not yet run.**"). The brief's Docs section edits this same file. Unless Dana says otherwise, I will commit that line together with this brief's own README update.
- Deleted: eight `misc/design_documents/genova/*.ttf` (unstaged, untouched).
- `ellaMapTigerStart_2026_11_24.ts` is no longer untracked: it went in with `4379750`.
- Untracked code files: none that this brief touches. Two loose `.sql` files are untracked (`data_catalog/drift_audit_2026-10-18.sql`, `quizes/quiz_v7_content_audit.sql`), plus the usual untracked brief, design and misc folders.
- None of the files this brief edits carries someone else's uncommitted change.

### 2. `brew_*` objects on production

- **`brew_profile_field`** (14 columns: id, code, label, prompt, value_kind_id, picker_id, max_items, max_item_len, liam_topic, ask_when_empty, sort_order, is_active, created_at, updated_at). The timestamps default to `timezone('utc', now())`, so under the G2.9 amendment they get replaced when this brief touches the table. Rows:

| id | code | label | prompt | kind | picker | max_items / len | liam_topic | ask_when_empty | sort |
|---|---|---|---|---|---|---|---|---|---|
| 4 | brew_methods | Brew methods | NULL | array | multi_select | 8 / – | brewing | f | 1 |
| 1 | grinder | Grinder | NULL | enum | select | – | equipment | f | 2 |
| 2 | takes_it | Takes it | NULL | enum | select | – | my_coffee | f | 3 |
| 7 | decaf_constraint | Decaf | NULL | bool | toggle | – | caffeine_decaf | f | 4 |
| 8 | aversions | Never wants to taste | NULL | array_freeform | freeform_list | 10 / 40 | NULL | f | 5 |
| 5 | usual_drink | How you make your coffee | How do you make your coffee at home? Pick all that apply. | array | multi_select | 4 / 80 | my_coffee | t | 6 |
| 6 | cupboard_coffee | What's in your kitchen | Which coffee is in your kitchen right now? | enum | typeahead | – / 80 | my_coffee | t | 7 |
| 3 | coffee_feeling | How you feel about it | How do you feel about the coffee you drink now? | enum | chips | – | my_coffee | t | 8 |

  Every row still has its seeded value (`schema.sql:12071`). The only one-time move so far is `coffee_feeling` from select to chips (`updated_at` 20:52). The guarded updates in A5 can therefore match "still the seeded value" on every row. Four existing prompts are NULL today (brew_methods, grinder, takes_it, decaf_constraint). A5 gives them prompts. `cardFields()` currently means "active with a prompt" (`brewProfileCard.ts:37`). B4 changes that to `is_on_card`, so those four do not reach the card.
- **`brew_profile_field_value`** (id, field_id, code, label, sort_order, pinned, accepts_words, is_active, timestamps): 98 rows, all active. brew_methods 8 · grinder 5 · takes_it 4 (`black` "Black" 1, `milk` "With milk" 2, `sugar` "With sugar" 3, `milk_and_sugar` "With milk and sugar" 4) · decaf 2 · usual_drink 16 (`other` accepts words) · cupboard_coffee 59 (`other` accepts words) · coffee_feeling 4. Only `usual_drink.other` and `cupboard_coffee.other` accept words.
- **`brew_profile_picker`**: select 1, multi_select 2, typeahead 3, toggle 4, freeform_list 5, chips 26.
- **`brew_profile_value_kind`**: enum 1, array 2, bool 3, array_freeform 4.
- **`brew_parameter`** (id, key, value_numeric, value_text, since, superseded_at, note): six current rows. `field_list_refresh_seconds` 300; `post_result_title`, `post_result_save`, `post_result_skip`, `words_placeholder`, `search_placeholder`. None of the A9 keys exist yet.
- **`v_brew_profile_field_current`** (`schema.sql:12434`), 20 columns: field_id … field_is_active, value_id, value_code, value_label, value_sort_order, pinned, accepts_words, aliases, value_is_active. It joins value rows on `fv.field_id = f.id`. Its one reader is `brewProfile.loadBrewProfileFields` (`brewProfile.ts:99`), as the brief says.

### 3. `customer_brew_profile_change` on production

`field, op, source, count`: brew_methods add/liam 5, set/backfill 1, set/onsite 1 · coffee_feeling set/onsite 2, set/quiz 1 · cupboard_coffee declined/quiz 1, set/onsite 1 · decaf_constraint set/liam 1 · grinder set/onsite 2 · **takes_it set/backfill 1, set/liam 4, set/onsite 2** · usual_drink set/onsite 1, set/quiz 1.

Current `takes_it` (`v_customer_brew_profile`): **four customers, all single scalar values, none `milk_and_sugar`**:

| canonical user | value | captured_at | source |
|---|---|---|---|
| 103cdf5f… | "milk" | 2026-09-28 15:24:02.581 | liam |
| 5d005443… | "milk" | 2026-10-06 19:34:42.557 | onsite |
| 20c656a6… | "black" | 2026-10-25 00:19:07.050 | liam |
| 4982be38… | "black" | 2026-10-25 01:19:56.831 | liam |

There are seven raw `takes_it` rows, all `set`, and no `add`, `clear` or `declined`. No two rows of one user and field share an `occurred_at`.

The fold and `source` order by `occurred_at` only: `schema.sql:6426` (fold `ORDER BY cbpc.occurred_at`), `:6429` (`captured_at`) and `:6430` (`source … ORDER BY occurred_at DESC`). Confirmed.

**Two findings that change how Part C has to be written** (neither re-opens a decision):

- **(a) Microsecond precision.** Prod `occurred_at` carries microseconds, for example `2026-09-28 15:24:02.581498+00`. A JS `Date` holds milliseconds, and `record.brewProfileChange.backfill` takes `occurredAt: Date` (`customerFacts.ts:36-39, 246-251`). Read into JS, that value becomes `.581`. Adding 1 µs is impossible, and the new row would sort *before* the original, so the old scalar would still fold last and the conversion would do nothing. **Proposal:** compute the timestamp in SQL (`occurred_at + interval '1 microsecond'`, read back as text), and widen `BackfillFields.occurredAt` to `Date | string` so the text reaches Postgres unchanged. That extends the existing backfill and does not fork it (G3.9). A test pins it: the new row sorts right after a row with sub-millisecond digits.
- **(b) `add` on a scalar drops the scalar.** The fold (`schema.sql:6390`) starts an `add` from `[]` when the state is not an array. Checked read-only on prod: `set "milk"` followed by `add "sugar"` folds to `["sugar"]`. So between the deploy and Part C, a Liam `add` on `takes_it` shows only the new item. B6 fixes resolveRemember's cap and duplicate check (`sommelier.ts:489-497` reads `existingArr = []` for a scalar today), but not what the view shows. Part C heals the history after the fact: the converted `set [milk]` sorts right after the original, and the later `add` folds on top of it. So the gap is cosmetic and lasts only until Part C. **Proposal, no view change:** while the stored value is a scalar, resolveRemember writes `set [old, new]` instead of `add new`. Alternatively, accept the gap, since Part C runs in the same sitting as the deploy. My recommendation is the `set [old, new]`: it is one branch in code.

Also noted: `customer_brew_profile_change` has no `updated_at`. `backfill` does not write `customer_words` (that does not matter for `takes_it`). The script runs as `axisbloom`, which passes `assertOwner` (`customerFacts.ts:47`). Part C's selection ("latest `set` per user") is safe even where a later `clear` exists: the new row sorts before the clear, and the clear still wins.

### 4. Readers of `takes_it`

- `brewCard.ts:73` `TAKES_IT_PHRASE` (milk / sugar / milk_and_sugar; black gets no sentence) and `:135-136`. Reads a string only, so an array gives no sentence today.
- `customerIntegrity.ts:722` (`USUAL_DRINK_SEED_CODES.brew_profile_field`), `:730` (`USUAL_DRINK_SEED_VALUE_COUNTS.takes_it: 4`), and check 31 at `:910-926` (`value_jsonb #>> '{}'`, scalar only).
- `brewProfile.ts:308` `SUMMARY_LABELS.takes_it` in `formatBrewProfileSummary` (`:312`). This already handles an array (`join('/')`), so the field code stays.
- `claude.ts:99-110`, Liam's examples (`<<remember:takes_it=black|milk|sugar>>`). They are still valid as one marker per item.
- `routes/sommelier.ts:432` `resolveRemember` (array branch `:489-497`, scalar no-op `:498-511`). `:503` is only a comment.
- Also found:
  - `brewProfile.formatBrewProfileFieldList` (`:394`) prints Liam's field list. Once A7 ships, `takes_it` prints as "several, one marker per item". `main_drink` would print the 16 `usual_drink` codes, and `cupboard_roast` its five values. That changes Liam's system prompt once (a one-time cache miss), not his recommendation.
  - `v_customer_timeline` (`schema.sql:~6686`) carries every brew row raw, so the Part C row will appear there at the original date. No frontend renders `brew_profile_change` entries.
  - Tests that name `takes_it`: `usualDrink.test.ts`, `routes/sommelier.test.ts`, `claude.test.ts`.
- Not this field: `contentGuard.ts`, `storyLayer.ts`, `roasteryPortal*.ts`, `coffee_milk_recommendation` and `roastery_portal_response.takes_it` all mean the roaster's portal answer (black / milk / both), a different column.

### 5. `declined` on the Profile

The Profile writes none. The PATCH route only writes `set` (`users.ts:945`) and the DELETE route only writes `clear` (`users.ts:973`). The only `declined` writer is `recordPostResultCard` (`brewProfileCard.ts:112`). Prod has one declined row (cupboard_coffee, source quiz). The door still allows `declined` from `onsite` (`customerFacts.ts:202`), and the op's label says "on the card or the profile" (`schema.sql:12049`, `comments.sql:2544`). This brief writes none from the Profile, so both stay as they are.

### 6. `Profile.tsx` memory tab

Order inside `showFullLayout` (`:476`):

1. "Your archetype" heading and every feature line, plus the stage note (`:480`).
2. The feedback nudge (`:499`). Its Leave feedback button calls `setExpandedJournalOrderId` (`:504`).
3. `DialArchetypeSection`, primary (`:530`).
4. A hairline, then `WorthExploring` (`:559`).
5. The adjacent `DialArchetypeSection` (`:594`). `openBlock` (`:119`) folds one block when the other opens.
6. A hairline, then the two-up grid of `ActivityTimeline` and `TastingJournal` (`:626`).
7. A hairline, then `BrewCards`.
8. `MapTrail` (`:650`).
9. A hairline, then `BrewProfileMirror` (`:656`).
10. A hairline, then the Liam link and the fallback retake link (`:677`, shown only while `!flavorMemory`).
11. `CompareOverlay` (`:687`).

`retakeCopy` is at `:408`.

Confirmed for D4:

- `ActivityTimeline` always renders (it has no `return null`) and owns the retake link (`ActivityTimeline.tsx:134-137`).
- `TastingJournal` never returns null; its empty state has a heading (`TastingJournal.tsx:21-27`).
- `BrewCards` returns null when there are no cards (`BrewCards.tsx:22`).
- `MapTrail` fetches its own data (`MapTrail.tsx:18`), returns null when there is no trail (`:32`), takes its heading from `me.copy.trail_title` (`:36`), and draws its own hairline (`:35`).

Notes for D4:

- **The brief contradicts itself on the fallback retake link.** D4.3's last bullet says it goes; the bullet after that says "The Liam link, the fallback retake link and `CompareOverlay` stay, after block 3". I will remove it: D8 puts the link permanently in the palate block, so a fallback is redundant.
- `MapTrail` returns early without setting state when `profile_trail !== 'map'` (`:24`), and swallows errors (`:27`). `onContent(false)` has to be called on those paths too, or the segment never learns that it is empty.
- D4.1, "the other feature lines when the primary archetype block is open", is a change: every feature line shows today.
- `retakeCopy`, the tab labels and the nudge words are pre-existing typed strings in `Profile.tsx`. The brief keeps them (OT-133).

### 7. Components as built

- **`BrewTypeahead.tsx`** (65 lines). The text box filters chips; nothing is picked unless a chip is tapped. A typed `slice(0, 12)` sits at `:46`. There is no free-text row.
- **`BrewFieldControl.tsx`** (115 lines). Pickers multi_select, typeahead, toggle/chips, freeform_list and select. A words box opens under a value that accepts words. Exports `emptyDraft`, `draftFromValue`, `valueFromDraft` and `draftTakesWords`. There is no exclusive handling and no dependent fields.
- **`BrewProfileMirror.tsx`** (144 lines). One row per field, each with its own Edit and Remove. The bug the brief names is confirmed at `saveEdit` `:57-59`: when `valueFromDraft` returns `undefined`, the editor closes and nothing is sent. The component shows the server's error text (`:69`). Its chrome words are typed ("What Liam knows about your setup", Edit, Remove, Save, Cancel, the empty line). GET `/api/users/brew-profile` returns no `customer_words`, so stored words cannot be displayed today. A8 is what fixes that.
- **`PostResultCard.tsx`** (87 lines). It renders the card fields with `BrewFieldControl` and sends every shown field. It also shows the server's error text (`:60`). D6 says "nothing else changes", so I will leave it as is unless Dana wants `routine_save_error` used there too.
- Tests: `BrewFieldControl.test.tsx` and `BrewTypeahead.test.ts`. There are none for the mirror or the card. Backend tests are in `usualDrink.test.ts`.

### 8. G3.9 — every new object, beside what exists (STOP for Dana's yes)

| New | Existing objects considered | Why they do not fit / proposal |
|---|---|---|
| table `brew_profile_group` | `brew_profile_field` (no grouping column); `lookup_value` (rejected in brief 1 D10: no `is_active`, no FK to its `(category, value)`); the other `brew_*` lookups (each is a different vocabulary) | A group has a label and an order of its own, shared by several fields, so it needs its own lookup (G2.7). **Fits as written.** |
| table `brew_profile_field_value_successor` | `brew_profile_field_value` (one row per value; no link to other values); the `brew_drink_*` decomposition tables (they decompose drinks, they do not link values) | Nothing links a retired value to the values that replace it. **But on prod no customer holds `milk_and_sugar`**, so today the table's only seeded row matters to the test DB and to any future retirement, not to the production conversion. It fits as written, and it keeps the mapping out of the script (G2.1). Dana could drop it instead and have the script map only identity (`[value]`). My recommendation is to keep it: it is small, and it is the rule-compliant place for the mapping. |
| 4 columns: `group_id`, `values_from_field_id`, `is_on_card` (field); `is_exclusive` (value) | `prompt IS NOT NULL` as the card flag today (`cardFields`, `brewProfileCard.ts:37`). A5 gives four more fields prompts, so it can no longer double as the card flag. | **Fit as written.** |
| view `v_customer_brew_profile_words` | `v_customer_usual_drink.customer_words` and `v_customer_cupboard_coffee.customer_words` (`schema.sql:12451`, `:12477`): each is one field with its code in the view body, and a generic reader would have to pick a view per field code. `v_customer_brew_profile` (the fold): a `customer_words` column could go there (lint-customer rule 7 bans only `CREATE OR REPLACE`), but its `DROP … CASCADE` takes `v_palate_evidence` and the other dependents with it, in the C3 block. | A field-generic words view beside the fold leaves the fold untouched. **Fits as written.** The reader is `customerReads.getBrewProfileCurrent` (`customerReads.ts:155`), extended to return `words`, not copied. |
| service `brewProfileCard.saveRoutine` | PATCH and DELETE handlers in `users.ts:920-985` (SQL and the writer call inside the route, one field per call); `recordPostResultCard` (the card's quiz-session ownership, `declined` rows, source `quiz`) | A whole-form save in one transaction, with the dependent clear, has no existing home. It reuses `validateFullValue` (plus B1), `record.brewProfileChange`, `brewProfileFallbackSourceId` and `getBrewProfileCurrent`. **Fits.** `brewProfileFallbackSourceId` moves from `users.ts:32` to `brewProfileCard.ts` as the one copy, and the PATCH and DELETE routes import it from there. |
| route `PUT /api/users/brew-profile` | PATCH and DELETE on the same path (one field each) | The Profile's single save needs a whole-form body. **Fits.** The old routes stay and go to OPEN_TASKS. |
| script `usualDrink2TakesIt_2026_11_24.ts` | `ellaMapReasons_2026_11_20.ts` (pattern: dry run, `--apply`, `--expect-db`) | One dated, one-time move. **Fits**, with finding 3(a): the timestamp is computed in SQL, and `BackfillFields.occurredAt` is widened to `Date \| string`. That widening is the one change outside the list above. |
| props: `MapTrail.onContent`, `hideHeading` on the four components; exported heading constants | The components as they are | G4.1 says add a prop. **Fits.** |

No other reader, writer or view is added. The rule set for B1 goes into `brewProfile.ts` beside `validateFullValue`, as a helper it calls (no second validator). The "field applies" helper (D2) goes into `BrewFieldControl.tsx`.

**Questions for Dana before Part A:**

1. Part C timestamp: compute it in SQL and widen `backfill`'s `occurredAt` to `Date | string`. Yes?
2. Between the deploy and Part C: should resolveRemember write `set [old, new]` while the stored `takes_it` is a scalar (recommended), or do we accept that the window shows only the added item?
3. `brew_profile_field_value_successor`: keep it, even though no prod row holds `milk_and_sugar` (recommended)?
4. The fallback retake link: remove it, per D4.3 and D8 (the brief also says it stays)?
5. The README line the CTO session left uncommitted: commit it together with this brief's docs?

**STOP. Task 0 ends here.**

### Dana's answers (2026-11-24) and the deviations they make from the brief

1. **Part C timestamp.** The new row's `occurred_at` is computed in SQL as the original row's `occurred_at + interval '1 microsecond'`. `customerFacts` `BackfillFields.occurredAt` is widened to `Date | string`, so the text reaches Postgres with its microseconds.
2. **Liam between the deploy and Part C (B5/B6).** When the stored `takes_it` is a single value, resolveRemember writes `set [old, new]` instead of `add new`. The exclusive rule (B5) is applied first: an exclusive value arriving is still `set [value]`, and a non-exclusive value arriving while the stored single value is exclusive is still `set [value]`.
3. **A4 dropped.** No `brew_profile_field_value_successor` table and no seed for it. Part C converts each single value to `[value]`. When the script meets a retired value (today only `takes_it.milk_and_sugar`, which no production row holds), it reports that customer and skips them. There is no mapping in the script. The Part E test "`milk_and_sugar` → `[milk, sugar]`" becomes "a retired single value is reported and skipped, no row written".
4. **Fallback retake link removed** from `Profile.tsx` (D8). The brief's line "the fallback retake link … stay[s]" is an error in the brief.
5. **README.** The CTO session's uncommitted line for brief 2 in this folder's `README.md` is committed together with this brief's docs.

The other seven new objects are approved as listed in item 8. Part A starts only once the Ella map 11 follow-up deploy is green (run 45476564911 on 3cc5c43: **success**) and no other session is in the repo.


---

## What was built (Parts A–E)

**Schema** (`schema.sql`, inside the Usual Drink block, before its views; `comments.sql` for every object and column):
- A1 `brew_profile_group`, seeded with five groups. `ab_app` gets SELECT only (added to the reference-table loop; check 29 lists it).
- A2/A3 columns, plus the one-time moves of existing rows. These run once, inside a `DO` block that is skipped once `brew_profile_field.group_id` exists, and each move also requires that the row still has its seeded value.
  - Card flag on: `usual_drink`, `cupboard_coffee`, `coffee_feeling`.
  - Groups and sort orders.
  - Two labels and five prompts.
  - `grinder` from select to chips; `takes_it` from enum/select to array/multi_select, at most 4.
  - Values: `black` relabelled "Nothing, black" and made exclusive; `milk` "Milk"; `sugar` "Sugar" and moved to sort 4; `milk_and_sugar` inactive at sort 6.
  - The `brew_profile_field` and `brew_profile_field_value` timestamp defaults move to `now()` (G2.9 amendment).
- A5/A6: `main_drink` and `cupboard_roast`, both chips and on the card; `plant_milk`, `syrup_creamer` and the five roasts. All insert-if-missing.
- A7: `v_brew_profile_field_current` joins values on `COALESCE(values_from_field_id, id)` and carries `group_code`, `group_label`, `group_sort_order`, `values_from_field_code`, `is_on_card` and `is_exclusive`.
- A8: `v_customer_brew_profile_words` (granted to `reporting_ro`). It returns the words of the latest row that set the field or carried words: a `set` without words drops them, an `add` without words keeps them. This is how I read "the latest set or add row" so that a Liam add does not erase the customer's words.
- A9: 14 `brew_parameter` rows (the brief's 13 text rows plus `typeahead_max_rows` 6).

**Backend:**
- B1 in `brewProfile.ts`: `checkExclusive` (called inside `validateFullValue` and by the door `customerFacts.checkBrewProfileChange`), `answerList`, `fieldApplies`, `checkValuesFrom` and `dependentFieldCodes`.
- B2 `brewProfileCard.saveRoutine`.
- B3 `PUT /api/users/brew-profile` (zod).
- B4 options payload; the card refuses a `shown` dependent field that was not offered (`FIELD_NOT_OFFERED`).
- B5/B6 resolveRemember (Dana's answer 2), `brewCard.takesItSentence`, checks 31/32/33.
- `customerReads.getBrewProfileCurrent` returns `words`.
- `customerFacts` `BackfillFields.occurredAt` is now `Date | string`.

**Frontend:**
- D1 `BrewTypeahead` rewritten (`typeaheadRows` exported).
- D2 `BrewFieldControl` (`fieldApplies`, `effectiveDraft`, `toggleMulti`, `answerCodes` exported).
- D3 `BrewProfileMirror` reworked; a group whose fields are all single-choice reads as one line of text, so the kitchen rule is data-driven, not a group code.
- D4 `Profile.tsx`, plus `ACTIVITY_HEADING`, `JOURNAL_HEADING` and `BREW_CARDS_HEADING`, `hideHeading` on the four history components, `MapTrail.onContent` (also called when the surface says lane or the fetch fails), and the retake link out of `ActivityTimeline`.
- D5: 44 px targets, 16 px inputs, a sticky Save/Cancel bar, a tab row that scrolls sideways.
- D6 `PostResultCard`.
- `api.ts`: `saveBrewRoutine` and `BrewRoutineSaveError`. `setBrewProfileField` and `deleteBrewProfileField` are removed from the frontend; the routes stay (OT-170).

**Part C script:** `backend/src/scripts/usualDrink2TakesIt_2026_11_24.ts` (dry run by default, `--apply`, `--expect-db`, default `axisandbloom_test`). It reads through `customerReads.getLatestSingleValueSets` and writes through `record.brewProfileChange.backfill`.

## Deviations from the brief and why

1. **Dana's five answers** (recorded above): the timestamp is computed in SQL; Liam writes `set [old, new]`; no successor table (A4 dropped, a retired value is skipped and reported); the fallback retake link is removed; the README line was committed with the docs.
2. **New reader `customerReads.getLatestSingleValueSets`.** It was not on the Task 0 list. The Part C script's own read of `customer_brew_profile_change` failed `lint:customer` rule 4 (every `customer_*` read lives in `customerReads.ts`), so the read moved there. It is read-only, takes the field as a parameter, and is used only by the script. G3.9 asks for Dana's yes on any new reader: **approved by Dana 2026-11-25**, and listed in the `Readers:` field of `customer_brew_profile_change` in `comments.sql` as used only by the Part C script. The alternative is an allow-list entry in `lint-customer.mjs`, which I judged worse.
3. **Check 32:** a single value on an array field counts as a finding only until a later `set` supersedes it, because the old rows stay as written (G2.20).
4. **Checks 23, 24 and 32** read value rows through `values_from` (`main_drink` has none of its own). The first test-DB boot showed check 23 flagging `main_drink`; fixed and confirmed on the next boot.
5. **The card's chrome stays as built:** D6 says "nothing else changes", so it still shows the server's error text, as before.
6. **The autocomplete list is an overlay.** The in-flow list moved the page when the box lost focus, so a click on Save landed elsewhere and nothing was sent. Acceptance caught this (the brief's "Save never closes without writing" case).
7. **`typeahead_max_rows`** counts matching rows; the "use as I typed it" row comes on top of them.

## Tests (Part E)

- **Backend:** `src/services/usualDrink2.test.ts` has 17 tests, all passing:
  - B1 (a) and (b);
  - payload;
  - card refusal;
  - `saveRoutine`: unchanged writes nothing, a change writes one row, a retry with the same `apiEventId` writes nothing more, the fallback inside the minute is one row, clear and empty array, the dependent cleared in the same save, words;
  - Liam: exclusive cases, `[old, new]` over a single value, the most-days marker in the same batch;
  - Part C: single value to array at +1 µs from a `.581498` original, old row untouched, twice is once; an earlier Liam `add` keeps both; a retired value is skipped;
  - brew-card sentence;
  - seed check 26 and check 33.

  `usualDrink.test.ts` was updated to the five card fields (`CARD_SHOWN` without the dependent field; counts from the list) and the array `takes_it`. `customerIntegrity.test.ts` now expects 30 checks.
- **Frontend:** `src/app/components/profile/usualDrink2.test.tsx` has 13 tests, all passing:
  - autocomplete rows follow `typeaheadMaxRows`; an unmatched entry saves as words; the highlighted row is the answer while typing; Enter picks; stored words display;
  - the exclusive chip; most days at two drinks and not at one;
  - routine progress and the marked chip; a failed save shows `routine_save_error`;
  - the Profile switcher hides Brew cards and Your trail when empty and shows them with content; the retake link stays in the palate block whichever segment is open; Leave feedback opens the journal.

  Full frontend run: 173 of 173.
- **Full backend run** (`vitest run src`): the first pass had 91 failures, 28 of them `ECONNRESET` from a proxy drop during a disconnect. Re-running the 29 failing files left 35 failures, all in the known set:
  - OT-140: `evidenceViews`, `evidenceAdmin`, `quizScoring`, `sommelierRag`, `sommelierEval`, `sommelierAnswer`, `catalogService`, `schema.catalog_blueprint`, `qrDoor`;
  - OT-169: `dialMap7`;
  - timeouts at 5 s or 10 s: `coffeePresentation2`, `staleGuestCleanup` (two cases, also when run alone; the purge scans the whole test DB through the proxy; `staleGuestCleanup.ts` is unchanged), `lintCustomer.test` (the lint itself passes).

  None of them imports a module this brief changed, except `staleGuestCleanup`, which times out rather than asserting. Logged as OT-174 (G1.12).
- **Lints:** all six clean. Backend `tsc` clean. Frontend `tsc`: the 7 known errors, none in this brief's files.

## Acceptance (local backend :4917 on the test DB, Vite :5173)

The browser was signed in as the marked test customer `Zzz Test Customer (Usual Drink 2)`: uid `PlOvVb9Og3gjM7DKihdgFItaJNo1`, profile `af250df4-a456-4ca3-a166-92b13ac2ab5c`, test DB only, never Dana's account. Screenshots are in this folder (`ud2_*.png`).

7. **New quiz, at 390 px.**
   - The card asked four questions; "Which one most days?" appeared only after a second drink (`brew-field-main_drink` count 0 after one drink, 1 after two).
   - Save sent `shown` with the five fields and answered `inserted 5`: rows `44420d72` (usual_drink `["latte","drip_black"]`), `cb35f73b` (main_drink "latte"), `186247ae` (cupboard_coffee declined), `de837cb0` (cupboard_roast "medium"), `02eed0e9` (coffee_feeling declined), each with its quiz session.
   - An earlier run while the token had expired took the quiz as an anonymous guest, so its rows sit on that guest.
1. **Kitchen coffee.**
   - Typed "count"; the rows were "Counter Culture Coffee" and "Use "count" as I typed it". Pressed Save without tapping: `9aa25cae` set "counter_culture".
   - Cleared, typed "Café du Monde"; the only row was the use-as-typed row. Save wrote `f0481853` set "other" with words "Café du Monde". After a reload the kitchen reads "Café du Monde · Medium".
2. **Most days.** Unpicking latte hid the question (count 0); picking espresso brought it back (count 1). One PUT wrote `c8e5a2dc` usual_drink `["drip_black","espresso"]` and `91d5b31c` main_drink `clear`, with the same source id prefix (same request).
3. **What goes in it.** `e4c0ea06` set `["milk","sugar"]` ("Milk", "Sugar" shown). Picking "Nothing, black" left only it pressed: `6084470d` set `["black"]`.
4. **Roast.** `5860b785` cupboard_roast "dark"; the kitchen line reads "Café du Monde · Dark".
5. **An old single value.**
   - `76da2a7d` set "milk" (scalar, written through the backfill door on the test DB) displayed as "Milk".
   - Dry run on the test DB: 5 to convert. These are the four production-copy customers (103cdf5f "milk" at `.581498` → `.581499`, 5d005443 "milk", 20c656a6 "black", 4982be38 "black") and the test customer. 0 skipped.
   - `--apply`: 5 rows written, `takes_it` rows 10 → 15. The second `--apply` wrote 0.
   - The test customer's new row is `93a2432f` `["milk"]` at `14:49:56.791001` (the original is at `.791`); `76da2a7d` is unchanged. The current value reads `["milk"]` with source `backfill`, which the reader shows as `profile_page`.
6. **The tab.**
   - Three blocks present (palate, routine, history); history tabs "Flavor activity" and "Tasting journal" only (no card, no trail); one retake link, inside the palate block.
   - Forced PUT 400 (server text "… (server text)"): the page shows "Please try saving again." and the server text appears nowhere.
   - At 390 px: no sideways scroll; the history tab row does not wrap; no routine button or tab under 44 px; inputs at 16 px; the Save bar is in view while the autocomplete is open. The cookie banner covers it on a fresh browser until answered (OT-175).
   - The feedback nudge needs a pending-feedback order, which the test customer has none of, so it was checked in the frontend test instead.
8. **Boot log** (test DB, after the check fix): `[brew-profile] field list loaded: 10 fields`. Customer checks 22–33 clean except check 31: one informational finding, the test customer's own "takes it with milk" against two non-milk drinks.


## Production (2026-11-25)

- **Push and deploy.** Commit `913be04` was pushed to `main`. Deploy run 45646794107 is green (backend and frontend), serving revision `axis-bloom-backend-00894-szv`.
- **Boot log.**
  - `DB schema verified`, `[db-roles] schema applied as axisbloom; request pool is ab_app`, `[brew-profile] field list loaded: 10 fields`, `running on port 8080`. No ERROR lines.
  - Customer checks #32 and #33 report 4 findings each: the four single `takes_it` values, which is expected until Part C.
  - `[data-catalog]` check #4 reported `CATALOG.md` stale; it was regenerated after the deploy with `npm run catalog:md -- --expect-db axisandbloom` (hash `2e8f1c4e…`) and committed with this report. Check #6 lists the same 27 dead-table candidates as before; that is not this brief.
- **Smoke**, as the dedicated test user `quiz-scenario-test@axisandbloom.test` (uid `0BeUD1zIdCTyO4v78kofJVkFtfo1`, profile `103cdf5f…`) through the run.app API. A headless production UI is impossible here because of the canonical-host redirect and Cloudflare.
  - **6, the payload the tab renders.** `/users/brew-profile/options` returns 10 fields in their groups: make (usual_drink, main_drink < usual_drink), gear, adds, kitchen (3), more. `black` is exclusive. The `takes_it` pickers are black, milk, plant_milk, sugar and syrup_creamer. `limits.typeaheadMaxRows` is 6, and all twelve routine/typeahead words are present. The card asks usual_drink, main_drink, cupboard_coffee, cupboard_roast and coffee_feeling.
  - **1, the kitchen.** `PUT` with `other` and words "Zzz smoke roaster" answered 200 with one set row and reads back `{ value: "other", words: "Zzz smoke roaster" }`. Then `counter_culture` reads back with `words: null`.
  - **3, what goes in it.** `["milk","sugar"]` answered 200 and reads back as such. `["black"]` answered 200. `["black","milk"]` answered 400 `{ code: "INVALID_ANSWER" }`, and the stored value stays `["black"]`.
- **Part C dry run on production** (read-only): `takes_it` has 9 rows and 3 customers to convert, 0 skipped:
  - `5d005443` "milk" at `2026-10-06 19:34:42.557082` → `.557083`;
  - `20c656a6` "black" at `2026-10-25 00:19:07.050044` → `.050045`;
  - `4982be38` "black" at `2026-10-25 01:19:56.831831` → `.831832`.

  The fourth customer from Task 0, `103cdf5f`, is the smoke test user. The smoke's own `set` rows replaced its single value with an array, so it needs no conversion.

**STOP before Part C on production: waiting for Dana's go.** Expected effect: `takes_it` rows go from 9 to 12; checks #32 and #33 go to 0 on the next boot; no old row changes.
