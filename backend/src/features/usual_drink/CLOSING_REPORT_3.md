# Usual Drink 3: routine fixes, closing report

Brief: `CLAUDE_CODE_PROMPT_USUAL_DRINK_3_ROUTINE_FIXES.md` (2026-11-25). Guardrails read first.

## Task 0 (2026-11-25, read-only; STOP for Dana's yes)

### 1. Repo

- **Branch:** `main` at `0de79d6`, level with `origin/main`. That is the brief 2 Part C docs commit; its deploy, run 45675284245, is green.
- **Modified:** `backend/src/features/usual_drink/README.md`, which carries the CTO session's line 3 for this brief. It will be committed with this brief's docs. `commerce/CLOSING_REPORT_6.md` and the genova `.ttf` deletions stay unstaged.
- **Untracked:** this brief, plus `.sql`/`.mjs` files outside this brief (`data_catalog/drift_audit_2026-10-18.sql`, `quizes/quiz_v7_content_audit.sql`, `loop/`). No untracked `.ts`/`.tsx` code.

### 2. Production rows (read-only)

**Fields** (sort, group, kind/picker, max, on card):

| field | sort | group | kind / picker | max | card | prompt now |
|---|---|---|---|---|---|---|
| usual_drink | 1 | make | array / multi_select | 4 | yes | How do you make your coffee at home? Pick all that apply. |
| main_drink | 2 | make | enum / chips, values_from usual_drink | | yes | Which one most days? |
| brew_methods | 3 | gear | array / multi_select | 8 | no | |
| grinder | 4 | gear | enum / chips | | no | **Do you grind at home?** (A2 guard matches) |
| takes_it | 5 | adds | array / multi_select | 4 | no | What goes in it? Pick all that apply. |
| cupboard_coffee | **6** | kitchen | **enum / typeahead** | none | yes | **Which coffee is in your kitchen right now?** (A3 guards match) |
| cupboard_roast | **7** | kitchen | enum / chips | | yes | **What roast does the bag say?** (A5 guard matches) |
| coffee_feeling | **8** | kitchen | enum / chips | | yes | |
| decaf_constraint | **9** | more | bool / toggle | | no | |
| aversions | **10** | more | array_freeform / freeform_list | 10 | no | |

- **A4 sort move:** the sort orders match the brief 2 values A4 guards on (6 to 10). `main_cupboard` would go to 7, and the fields after it move to 8 through 11.
- **`main_cupboard`:** does not exist.
- **`typeahead_remove`:** absent. The current `typeahead_*` words are `typeahead_use_typed`, `typeahead_clear` and `typeahead_max_rows` 6.

**Values:**
- **`takes_it` black:** label "Nothing, black", `is_exclusive` true. The A1 guard matches. The other values are milk, plant_milk, sugar and syrup_creamer; `milk_and_sugar` is inactive.
- **`grinder`:** 5 values.
- **`cupboard_coffee`:** 59 values.
  - Pinned: `dont_know`, `nothing`, `pods_unknown`, and `other` (the one that accepts words). None is exclusive today.
  - Then 55 brands. `local_roaster` "A local roaster not on this list" sorts last.
  - Every value has its `brew_cupboard_brand` row, so every answer reaches `v_customer_cupboard_coffee`.
- **Others:** `cupboard_roast` 5, `coffee_feeling` 4, `decaf_constraint` 2, `aversions` none (freeform).

**`cupboard_coffee` facts:** 5 rows: `set`/`onsite` × 4, all single strings, and `declined`/`quiz` × 1. Every row:

| customer | op | value | words | occurred_at |
|---|---|---|---|---|
| 103cdf5f (smoke test user) | declined | | | 2026-11-14 20:47:29.576884 |
| 103cdf5f | set | "counter_culture" | | 2026-11-14 20:47:29.892949 |
| 103cdf5f | set | "other" | Zzz smoke roaster | 2026-11-25 15:39:39.525064 |
| 103cdf5f | set | "counter_culture" | | 2026-11-25 15:39:39.852089 |
| 5d005443 | set | "joe_bean" | | 2026-11-25 18:49:30.587685 |

- **Current per customer:** 103cdf5f has `counter_culture` (no words); 5d005443 has `joe_bean` (no words, written from the live page today at 18:49). Both are in `v_customer_cupboard_coffee`.
- **Part C on production today** would convert those 2 customers: 5 rows become 7, and nobody holds words.

### 3. Readers of `cupboard_coffee` as one value

| reader | how it reads | after this brief |
|---|---|---|
| `v_customer_cupboard_coffee` (`schema.sql` 12618) | `fv.code = (b.value_jsonb #>> '{}')`. On an array this matches nothing, so the customer would drop out of the view. Words come from a LATERAL on the latest non-declined row. | A6 rewrites the body: the main coffee, else the only one. Its columns and grain stay. |
| `customerReads.getCupboardCoffee` (868) | one row from the view | unchanged |
| ↳ `matchService` 666 to 667 | `said.get('cupboard_coffee:' + code)`: the `/map` kitchen line (737) | unchanged; it reads the main coffee |
| `customerReads` 943 to 944, admin brew stats | counts per code and per `brand_kind` from the view | counts the main coffee only (A6; the comment says so) |
| `customerIntegrity` check 31 (934) | `nothing` in the kitchen and no buy_out drink, from the view | still works: `nothing` becomes exclusive, so it is always the only coffee |
| `v_customer_brew_profile_words` | handles arrays already (`?` on an array) | unchanged |
| `dial_said_back_source` / `v_dial_said_back_fact` | quote text per value code (`brew_field_code`), not per customer | unchanged |
| `claude.ts` 111 | one-brand prompt line | B3 rewords it |
| `resolveRemember` (sommelier.ts 434 to 560) | treats the field as a scalar today | B3: the array branch |
| `AdminEllaMapReasons.tsx` 63/96, `AdminBrewProfileStats.tsx` | the source code and the brand-kind counts | unchanged |

**No other reader.** The brew card (`brewCard.ts`), Liam's summary (`formatBrewProfileSummary`, through `displayBrewValue`, which joins arrays) and `getBrewProfileCurrent` are generic.

One thing outside this brief: check 31's "takes it black but every drink has milk" still runs. With D2, `['black','milk']` is a normal answer, so that line now flags a list that holds black when every drink has milk. It is informational and harmless; I'll leave it unless you want it changed.

### 4. The pieces this brief reuses, as built

- **`values_from_field_id`, `fieldApplies` and the card:**
  - Generic: backend `brewProfile.fieldApplies` and `checkValuesFrom` (two or more answers), frontend `fieldApplies` and `effectiveDraft`, `dependentFieldCodes`, and the card's FIELD_NOT_OFFERED check.
  - `saveRoutine` clears dependents generically. `main_cupboard` needs only its field row.
  - `v_brew_profile_field_current` serves the source's values (59 rows) under `main_cupboard`.
- **`is_exclusive`:** `checkExclusive` runs in `validateFullValue` and at the door (`checkBrewProfileChange`). `toggleMulti` lets an exclusive value replace the others and be replaced by them. Both are generic, so A3's flags work with no code.
- **Single value reads as a list:** generic everywhere: frontend `draftFromValue` and `answerCodes`, backend `answerList`.
- **`resolveRemember`'s `[old, new]` rule:** generic to any `array` field. Nothing names `takes_it`.
  - **Today it drops a second typed name.** A `cupboard_coffee=other|New words` marker while the list already holds `other` is skipped as "already known" (`existingArr.includes`). The B3 "replace the typed name" case needs a branch: `set` the same list with the new words.
  - **A Liam `set` drops the stored words.** The `[old, new]` set and the exclusive-switch set leave `customer_words` empty, so a stored typed-in name disappears (`v_customer_brew_profile_words` reads the latest `set` row). Before Part C runs, a Liam add over a single stored `other|words` would lose the words. I'll carry the stored words onto any Liam `set` whose list still holds the words value.
- **`getLatestSingleValueSets(field)`:** takes the field as a parameter, but **returns no `customer_words`**. It also picks the latest **`set`** row and ignores a later `clear`/`declined`. For a customer who set a coffee and later cleared it, Part C would bring the coffee back.
  - No such customer exists on production today. `takes_it` has only `set` rows, and `cupboard_coffee`'s one `declined` row comes before its sets.
  - The fix is to convert only when the customer's latest row of any op is that single-value set, and to return the row's `customer_words`. That is an extension of the same reader, not a new one.
- **`usualDrink2TakesIt_2026_11_24.ts`:** `FIELD = 'takes_it'` and `SOURCE_ID_PREFIX = 'ud2:takes_it:'` are constants. It already sets `recordedAt = now` and `occurredAt = next_at` (the text value).
- **`record.brewProfileChange.backfill`:** confirmed: its insert lists no `customer_words` column. It also skips the door's checks, as in brief 2 (owner-only). Extending it is one more column, the same as the request path's `customerWords`.

### 5. Frontend as brief 2 left it

- **`BrewTypeahead.tsx`:**
  - **Before typing, only pinned values show.** Confirmed: `filterTypeahead` returns `values.filter(v => v.pinned)` for an empty query, which is the four pinned values.
  - **Typing appends.** Confirmed: the input is `value={typing ? query : pickedText}`, `typing` starts false when a value is picked, and the first keystroke calls `onInput(e.target.value)`. That value is `pickedText` plus the new key, so the query becomes "Counter Culture Coffees". This is the appending Dana saw.
  - **One value only:** the component holds one `value` and one `words`.
- **`BrewFieldControl.tsx`:**
  - The `typeahead` branch passes `typeof draft === 'string' ? draft : null`, so an array draft shows as empty. Part D3 changes this.
  - The values-from control lists `field.values` that are among the source's answers, **by label**. A typed-in coffee (`other`) would show "Something else", not the customer's words. D4 needs the source's words passed in: a `sourceWords` prop, the same pattern as `sourceDraft`.
- **`BrewProfileMirror.tsx`:**
  - The `allSingle` branch (lines 137 to 145) renders the kitchen group as one line of text. D2 removes this branch.
  - The chip branch already marks a source chip with its dependent field's label (`markers`). That is generic, so the drink-most chip comes with no code.
  - No white card yet. The site token `--ab-page: #ffffff` exists in `theme.css` for D1.
- **`PostResultCard.tsx`:** shows the fields that apply and passes `sourceDraft`/`maxRows`. It will pass `sourceWords` too.

### 6. G3.9: everything new or changed

| what | kind | considered | why |
|---|---|---|---|
| `v_customer_cupboard_coffee` body (A6) | view body changes | — | brief item; same grain and columns. `DROP … CASCADE`: nothing depends on it, and the grant is reapplied at 12674. |
| `main_cupboard` field row + values-from link (A4); `typeahead_remove` (A7); A1 to A5 guarded moves | rows | — | brief items |
| `record.brewProfileChange.backfill` carries `customerWords` | writer extended | — | brief item |
| `customerReads.getLatestSingleValueSets` returns `customer_words`, and skips a customer whose latest row of any op is not that set | reader extended (not new) | a script-side filter would break lint rule 4 | item 4 above |
| Part C: the brief 2 script gets `--field <code>` and `--tag <ud3>` (source_id `<tag>:<field>:<user>`; defaults reproduce brief 2) | script extended | a dated sibling copies ~100 lines (a fork) | one pattern. Its existing tests stay; `cupboard_coffee` tests are added. |
| `resolveRemember`: replace a typed name (B3); carry stored words onto a Liam `set` | writer branch | — | item 4 above |
| `BrewFieldControl` `sourceWords` prop; `BrewTypeahead` multi mode in place | component props | a new chip-list component | G4.1, D3 "in place" |

**No new table, column, view, reader function or writer function.**

**STOP: waiting for Dana's yes on:**
- the brief's list;
- the four extensions: the reader, the script flags, the two Liam word rules, `sourceWords`.

## Dana's answer (2026-11-25)

Yes to the G3.9 list and to extensions 1 to 4, with two changes. Both are recorded as deviations from the brief:

1. **Deviation 1, the conversion rule (extension 1).** "Latest row of any kind" was not used. A customer is converted when their latest `set` row holds a single value and no later row cleared the field. Declined rows are ignored. Tests: a single set followed by a declined row is still converted; a single set followed by a clear is not.
2. **Deviation 2, check 31 is fixed in this brief.** "Takes it black but every drink has milk" is flagged only when black is the only `takes_it` answer.

## Built (2026-11-25)

**Part A, rows** (`schema.sql`, the USUAL DRINK 3 block; every move is guarded on its brief 1 or brief 2 value):
- A1: black `is_exclusive` false, label "Black".
- A2: the grinder prompt.
- A3: `cupboard_coffee` becomes an array with `max_items` 3 (kind and cap move once, only while it is `enum`). `dont_know`, `nothing` and `pods_unknown` are exclusive. New prompt.
- A4: `main_cupboard` ("Drink most", "Which one do you drink most?", enum/chips, kitchen group, values from `cupboard_coffee`, on the card, `my_coffee`, sort 7). Roast, feeling, decaf and aversions move to 8 to 11.
- A5: the roast prompt.
- A6: the new `v_customer_cupboard_coffee` body. It finds the main field by its values-from link, so no new field code appears in the view.
- A7: `typeahead_remove`.
- `comments.sql`: the view's meaning, and the reader note on `customer_brew_profile_change`.

**Part B, backend:**
- B1: `brewProfile.checkOneWordsValue` (at most one answer in the customer's own words per list), in `validateFullValue` and at the door.
- B2: `saveRoutine`, the card writer and the payload needed no code. Tests cover the kitchen list and clearing `main_cupboard`.
- B3: `resolveRemember`:
  - adds kitchen brands under the cap;
  - a marker with words sets the same list with the new words;
  - every Liam `set` that still holds the typed-in answer keeps the stored words;
  - the one-words rule applies to adds;
  - the `claude.ts` line says up to three.
- B4: `main_cupboard` in the seed list. Checks 32 and 33 were already generic.
- Extensions approved at Task 0:
  - `getLatestSingleValueSets` returns `customer_words` and skips a later `clear`;
  - `record.brewProfileChange.backfill` carries `customerWords`;
  - the conversion script takes `--field`/`--tag`, and its defaults are brief 2's run.

**Part D, frontend:**
- `BrewTypeahead.tsx`, in place: browse, replace, the several-answers mode (chips with remove buttons, pending highlight, exclusive, cap), and picked values not offered again.
- `BrewFieldControl.tsx`: an array typeahead uses that mode; the values-from control takes `sourceWords` and lists the customer's answers in their order.
- `PostResultCard.tsx`: passes `sourceWords`.
- `BrewProfileMirror.tsx`: the read view is one white card (`--ab-page`, hairline, 14 px corners) with every answer a chip, the kitchen included. In the edit view each question is its own white card.
- `Profile.tsx` unchanged.

## Deviations

1. **The conversion rule (Dana, 2026-11-25).** A customer is converted when their latest `set` row holds a single value and no later `clear` emptied the field. Declined rows are ignored. This differs from Task 0's "latest row of any kind".
2. **Check 31 is fixed in this brief (Dana).** "Takes it black but every drink has milk" is flagged only when black is the only answer.
3. **`brew_card_takes_it_skip` (new parameter row, `black`).** The brew-card sentence left black out because black was exclusive. With D2 it would have read "You take it with black and milk". The answers the sentence leaves out are now a row that `takesItSentence` reads, so nothing is hard-coded (G2.1). It is a row, not a table, column or view.
4. **The follow-up lists the coffees in the order the customer named them**, not value-sort order, so a typed-in name doesn't jump to the front.
5. **Brief 1 and brief 2 tests updated** where D2 and D4 revise them:
   - The exclusive cases now run on the kitchen's stand-alone answers.
   - Kitchen answers are lists, and Liam's first kitchen marker is an `add`.
   - The card is 6 fields (`main_cupboard` joins the way `main_drink` did).
   - The empty autocomplete shows every value.
6. **Replace (D3 third bullet) is covered by tests only.** No routine field is a one-answer autocomplete any more (OT-179).

## Tests

Backend:
- `usualDrink3.test.ts` (new, 17) plus `usualDrink2.test.ts` and `usualDrink.test.ts`: all green.
- Full `vitest run src`: 36 failed of 1365. 33 are the known set from brief 2's run (OT-140, OT-169, OT-174, OT-176, proxy timeouts). The other three were:
  - `comments.format`: my reader note pushed `customer_brew_profile_change` over the 1000-character stop. I shortened it, and it passes.
  - `householdService` and `coffeePresentation2`: 5 s proxy timeouts. Both pass on rerun.

Frontend:
- `usualDrink3.test.tsx` (new, 9), plus the brief 2 file and `BrewTypeahead.test.ts`: green.
- Full `vitest run`: 182 of 182 pass.

Lints and type-checks:
- `lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:cupping`, `lint:lineage` all pass.
- Backend `tsc` is clean.
- Frontend `tsc` shows 7 errors, all known and in files this brief didn't touch (ArchetypeSection, useAdjacentArchetype, Profile address_type).

## Acceptance (test DB, local :4917 + Vite :5173)

The test customer is "Zzz Test Customer UD3", uid `ktIy1WjLxHUg2fsTqNiJ4azwbWu1`, profile `1f1bd326…`. It is now disabled in Firebase; its test-DB rows stay. Screenshots are the `ud3_*.png` files in this folder.

3. **A stored single coffee, before and after the conversion.** I gave the test customer a single `"counter_culture"` row dated a week back. It showed as a chip. Two quiz-card skips then wrote declined rows after it (the quiz step ran twice by mistake; harmless on the test DB).
   - Dry run: 5 to convert, including brief 2's test customer `af250df4` with "Café du Monde" carried over.
   - Apply: 5 rows, 11 → 16. A second apply: 0.
   - The UD3 customer was converted despite its later declined rows. Its new row is `ud3:cupboard_coffee:1f1bd326…` at `20:50:32.927001`. The old row is unchanged.
1. **Black and milk together:** both chips are pressed, the save sends `["black","milk"]`, and after a reload the read view shows two chips, "Black" and "Milk".
2. **The kitchen:**
   - Focusing the empty box offers 58 values, every one except the picked Counter Culture, starting "I don't know, Nothing right now, Pods…, Something else, Dunkin'". The list scrolls (the last row is visible after scrolling).
   - "star" offers Starbucks and the as-typed row; picking Starbucks empties the box. "Drink most" appears at two coffees.
   - "Zzz Corner Roasters" offers only the as-typed row. After that pick the box is gone (three coffees).
   - The follow-up offers "Counter Culture Coffee, Starbucks, Zzz Corner Roasters". I picked the typed one, and the save answered 200 in one PUT.
   - After a reload: Counter Culture Coffee, Starbucks, and "Zzz Corner Roasters · Drink most" (filled, `data-marked=main_cupboard`).
4. **Grinder:** "What do you grind with most?"; picking Blade after Electric burr leaves only Blade.
5. **Cards and chips:** the read view is a white card (`rgb(255,255,255)`), and the only non-chip text is the group labels. The edit view has 10 question cards.
   - At 390 px: no sideways scroll, every card is 342 px (full column), the picked chips wrap one per row, every remove button is 44 × 44, and no button is under 44 px. The open list overlays the next card (`ud3_browse_390.png`).
6. **A new quiz:** the card asks the four questions with the new kitchen prompt. "Drink most" is absent at one coffee and shown at two. The save answered 200 with `cupboard_coffee ["wawa","illy"]` and `main_cupboard "illy"`.
7. **`/map`:** the route is gated for this test customer ("The map is not open yet"), so I called `matchService.steps` (what `/map` renders) read-only. Its first-bag text opens "You have Illy in your kitchen." (the main coffee). `getCupboardCoffee` for converted one-coffee customer `fa2f7d93` reads `counter_culture` / specialty as before.

## Production (2026-11-25)

- **Push and deploy.** Commit `d4c185e` was pushed to `main`. Deploy run 45700202258 is green (backend and frontend), serving revision `axis-bloom-backend-00898-bvj`.
- **Boot log.**
  - `DB schema verified`, `[db-roles] schema applied as axisbloom; request pool is ab_app`, `[brew-profile] field list loaded: 11 fields`, `running on port 8080`. No ERROR lines.
  - Check 31 reports nothing. Checks #32 and #33 report 2 findings each: the two single `cupboard_coffee` values, as expected until Part C.
  - `[data-catalog]` check #4 reported `CATALOG.md` stale. I regenerated it after the deploy with `npm run catalog:md -- --expect-db axisandbloom` (hash `c15042d1…`) and committed it with this report. The diff is the two comments this brief changed.
- **Smoke** as the dedicated test user `quiz-scenario-test@axisandbloom.test` (uid `0BeUD1zIdCTyO4v78kofJVkFtfo1`), through the run.app API. A headless production UI is impossible here (canonical-host redirect and Cloudflare).
  - **The payload:**
    - `cupboard_coffee` is an array, max 3, with the new prompt; `dont_know`, `nothing` and `pods_unknown` are exclusive.
    - `main_cupboard` reads "Which one do you drink most?", values from `cupboard_coffee`, in the kitchen group.
    - Black is labelled "Black" and is not exclusive. The grinder and roast prompts are new, and `typeahead_remove` is "Remove {name}".
    - The card asks usual_drink, main_drink, cupboard_coffee, main_cupboard, cupboard_roast and coffee_feeling.
  - **1:** `["black","milk"]` answered 200 and reads back as such (it was `["black"]`).
  - **2:** `["starbucks","other"]` with "Zzz smoke roaster" and `main_cupboard "other"` answered 200 and reads back as a list with the words, `main_cupboard` "other". Four coffees answered 400 ("takes at most 3 values"); `["nothing","wawa"]` answered 400 ("nothing stands alone"). The stored answer is unchanged after both.
- **Part C dry run on production** (read-only): `cupboard_coffee` has 6 rows; 1 customer to convert, 0 skipped: `5d005443` `"joe_bean"` at `2026-11-25 18:49:30.587685` → `.587686`, no words. The smoke test user (`103cdf5f`, single `counter_culture` at Task 0) now holds a list from the smoke, so it needs no conversion.

**Part C on production (Dana's go, 2026-11-25):**
- `npx tsx src/scripts/usualDrink2TakesIt_2026_11_24.ts --apply --expect-db axisandbloom --field cupboard_coffee --tag ud3` at 2026-11-26T03:41:55Z: 1 row written, `cupboard_coffee` rows 6 → 7. `5d005443` `"joe_bean"` → `["joe_bean"]` at `2026-11-25 18:49:30.587686`, source_id `ud3:cupboard_coffee:5d005443…`. No old row changed.
- A second `--apply` wrote 0 rows (7 → 7).
- Checks 31, 32 and 33, run read-only with the real functions on production: all pass with 0 findings ("all agree", "all rows fit", "all arrays").

Usual Drink 3 is done.
