# Claude Code brief. Ella's Bloom Map 7: the match rule and the customer page

Workstream: ella_bloom_map (`README.md` here; `CLOSING_REPORT_5.md` and `CLOSING_REPORT_6.md` for the decided map as built) · Written 2026-11-17 by the CTO session · Model: Sonnet · Dana runs it; push = deploy · **Test mode.** Admin only. No customer surface switches. No price, SKU, slot, Stripe or subscription file.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (the match rule is rows; the family codes and thresholds leave `matchService.ts`) · G2.2 surrogate `id` PK · G2.3 prefix `dial_` · G2.4 CATALOG.md checked (below) · G2.5 one writer per table, declared; reads through one view · G2.7 vocabularies are lookup tables · G2.8 additive, idempotent · G2.11 retire, never delete · G2.17 `comments.sql` then `catalog:md` · G2.19 and G2.20 nobody's quiz result or answer is edited; the match only reads it differently · G3.1 routes call services · G3.9 reuse, do not fork · G4.1 reuse `EllaMapFace` · G4.2 nothing typed in · G4.4 positive register · G4.5 customers never see a roaster name · G4.6 the page sits behind the pre-launch gate and the admin route · G5.1 vitest · G1.6 push is deploy, one closing report · G1.9 one execution at a time: **the Commerce 4 changes sitting uncommitted in the tree (`stripe.ts`, the subscription files, `comments.sql`, `MANUAL_SETUP_IDS.md`, `commerce/README.md`) are not yours. Add files by path only and leave them out, as briefs 5 and 6 did. If you need to edit `comments.sql`, stage only your own hunks.**
Mode: test. STOP points: after Task 0; before any production data write.

**Goal.** The decided map is live in the backend with 18 coffees and 18 steps. Two things are missing. (1) The match still places a quiz result with a rule written in code (`DELICATE_FAMILY`, `SIDE_A_FAMILIES`) that reads one field, and the admin table of starts does not say what the match does. (2) The admin-only customer page `/map` is the version Dana did not like. This brief makes the match rule a table Dana can read on `/admin/map`, and rebuilds `/map` and the trail as the mockup: `map5_mockup_customer.png` in this folder, and Dana's PDF described in Part C.

**Decisions already made (Dana, 2026-11-15 to 2026-11-17; do not re-open).**

1. The first bag comes from the quiz's raw points, not from the stored secondary archetype. The food (treat) answer is kept and does not count.
2. The rule is the table in Data 1. Dana agreed it against nine real quiz takers.
3. A Floral result that came from the Balanced branch counts as Balanced.
4. An Earthy result recorded before the Earthy branch answer was reworded (2026-10-09) is read from the six answers. New Earthy results (the "dark, strong, a bit smoky" answer) start on Amsterdam.
5. The espresso tie-break is in: Chocolate & Nutty leaning Fruity, and makes espresso at home, starts on Tiger Stripe.
6. **Earthy and Floral do not touch. That side is a dead end.** There is no Earthy leaning Floral and no Floral leaning Earthy: no start row, no lean button, nothing on the page.
7. The customer page is Dana's PDF: the map with only the customer's part lit, the first bag with one plain reason, then one card per step. No "Same again" before a first bag. No ring, lane, grade, version or basis is ever shown to a customer. A guessed step looks like any other.
8. The trail is in: the log of the coffees the customer chose, as on page 4 of the PDF.
9. The customer Bloom page and every `dial_surface` row stay exactly as they are. Dana switches later (brief 4).
10. Prices and making all 18 coffees buyable are brief 8, after Commerce 4. This page shows a price where one exists and nothing where none does.

CTO calls, reversible, flag if the code disagrees:

- **Steps on the customer page come from `v_dial_step`** (the published, shown steps leaving the coffee the customer stands on), in basis order then word. The calculated moves (`v_dial_hop`, `rankMoves`, bolder / gentler / different) are no longer read by `/map`. They stay in code and in the advanced admin page.
- **A step whose destination is not sellable still shows**, without a price, and its choose button is live. Choosing records the position only, as `decide` does today. (Admin-only page; brief 8 makes them buyable.)
- **The reason sentence under the first bag is a column on the rule row**, so Dana can edit it on the admin page.
- **Decaf:** today a decaf customer gets no first match (OT-126). Leave that behaviour as it is and say so in the report. Half Moon and Nightcap Decaf stay reachable as steps.

**CATALOG.md check (G2.4).** `dial_first_match` is keyed by family and lane only, so it cannot say "Fruity points higher than Balanced points" or "makes espresso". `quiz_session_interpretation` holds the quiz's own verdict, which the rule deliberately does not follow for the lean. `dial_customer_copy` holds fixed sentences by code, not a condition. Nothing stores "given these quiz facts, start here, and say this". New: `dial_start_rule` and its lookup `dial_start_condition`. `dial_first_match` stays as the founder pick per cell; it is no longer what the admin page shows as "where a quiz result starts".

---

## Task 0: Verify (write into `CLOSING_REPORT_7.md`; STOP after)

Read-only, test DB and production.

1. **The quiz facts the rule needs, per quiz session:** the three raw scores (Balanced, Chocolate & Nutty, Fruity) without the food answer; the primary family; which branch quiz was taken and which answer was chosen; the date. Say exactly where each lives (`quiz_session`, `quiz_session_interpretation`, `quiz_answer_archetype_score`, `v_quiz_scoring_matrix`) and whether the stored scores already exclude the food question (its weight was 0 in content v7). List the branch answer codes, including the Earthy branch's "stay" and "dark, smoky" answers and the Balanced branch's answers, and how the old-wording Earthy results can be told from the new ones.
2. **Espresso at home:** in `v_customer_usual_drink` / `brew_drink_base_method`, which value means espresso, and how many real customers have any answer (expect very few).
3. `matchService.firstMatchCell`, `firstMatchFor`, `decide`, `moves`, `me`: what `/map`, the quiz route and the profile trail read today, and the smallest change that replaces the cell rule with the rule table and the calculated moves with `v_dial_step`.
4. `dial_wedge` and `dial_seam`: how the Earthy and Floral sides toward each other are stored today (the seam is already unlabelled), which `dial_first_match` rows exist for those two lanes, and whether any coffee has a lean decision on them (expect none).
5. The customer pieces as built: `MapPage`, `MapQuizStart`, `MapTrail`, `EllaMapFace` props, `lib/mapCustomer.ts`, the `/api/map` routes, and where "Same again" and the compatibility sentence come from.
6. Run the rule in Data 1 **read-only** over every real (non-test, non-staff) current quiz result on production and report the count per start coffee, plus the result for persons 92, 95, 88, 96, 42, 86, 87, 85 and 33 of the 2026-11-15 pull (`misc/palate_model/pulls/2026-11-15/`). Expected: 92 Benchmark, 95 Benchmark, 42 Benchmark, 85 La Familia, 88 The Daily, 96 The Daily, 33 The Daily, 86 Fabricator, 87 Fabricator (Tiger Stripe if an espresso drinker). Use the person numbers only; no names in the report. If any differs, STOP and say why.

## Task 0.5: Dana's manual steps
None.

---

## Part A: Schema (additive, idempotent; `comments.sql` for every object and column)

A1 **A closed side.** One place says that a wedge's side is closed (Earthy's side toward Floral, Floral's side toward Earthy): a boolean on `dial_seam` (`is_open`, default true; false for the Earthy and Floral seam) is the simplest if Task 0 item 4 agrees. Everything that offers a lane reads it: the lean buttons, the start table, the preview flags. No family code in code.

A2 **Retire the two dead-end rows.** Supersede the current `dial_first_match` rows for Earthy toward Floral and Floral toward Earthy (through `setFirstMatch`'s supersede path; no delete). `setLeanInTx` refuses a lean on a closed side.

A3 **`dial_start_condition`** (lookup, G2.7): `id`, `code UNIQUE`, `label` (admin words), `sort_order`. Seed the codes Data 1 uses: `always`, `fruity_gt_cn`, `fruity_gt_balanced`, `cn_gt_zero`, `branch_dark_smoky`, `espresso_at_home`. The meaning of each code is one SQL expression in **one** view (A5), documented in the code's comment.

A4 **`dial_start_rule`**: `id`, `family_code` (the family after the reading in A5), `condition_id` (FK), `also_condition_id` (FK, nullable: a second condition that must also hold, used by the espresso row), `priority` (smallint; lowest wins among rows whose conditions hold), `coffee_id` (FK `coffees.id`, RESTRICT), `admin_label` (the row's words on the admin page: "Fruity points higher than Balanced points"), `customer_reason` (the sentence under the first bag), `notes`, `decided_by`, `created_at`, `superseded_at`. One current row per `(family_code, priority)`. Supersede and insert, like `dial_first_match`.

A5 **`v_dial_start_input`**: one row per quiz session with the facts the rule needs, and nothing decided in code:
- `family_read`: the primary family, except Floral from the Balanced branch reads as Balanced, and an Earthy result from before the reworded branch answer reads as the family with the highest raw score. The cut-over date is a `dial_` parameter (`dial_earthy_branch_reworded_on`, 2026-10-09), not a literal in the view.
- the three raw scores, food excluded;
- one boolean per `dial_start_condition` code.
The stored quiz result is not changed (G2.19, G2.20).

A6 **`v_dial_start`**: per quiz session, the winning current `dial_start_rule` row (family matches `family_read`, conditions hold, lowest priority), with the coffee and the reason. This is the one read for the first bag (G2.5).

## Part B: Backend

B1 `dialPlacementService.setStartRule` (supersede and insert; refuses a coffee that is not placed in the active version). Declared in `comments.sql`.

B2 `matchService`: the first bag comes from `v_dial_start`. Remove `DELICATE_FAMILY`, `DELICATE_TOWARD`, `SIDE_A_FAMILIES` and `firstMatchCell`. When no rule row wins (no quiz, a family with no row), fall back to the `always` row of Balanced. `decide` keeps writing `customer_match_decision` and its candidates; record the rule row id and the facts used in the decision's inputs.

B3 `matchService.me` / `moves` for the map surface: return the position, the first-bag reason when the customer has no bag yet, and the steps leaving the position from `v_dial_step` (word, destination coffee, customer line or the destination's signature notes when the line is NULL, price where one exists). Decaf filter as today.

B4 Trail read: the customer's chosen coffees in order with the word of the step taken when one of the published steps connects two consecutive choices, and the customer's own feedback line when they left one. Reuse what `MapTrail` reads today (`v_customer_match_trail`).

B5 Admin routes beside the map routes: `GET /api/admin/map/start-rules`, `PUT /api/admin/map/start-rules`. zod, admin gate, one service call each.

B6 **Seed script** `backend/src/scripts/ellaMapStartRules_2026_11_17.ts`: enters Data 1 through `setStartRule`, idempotent, `--dry-run`, `--expect-db`. It does not publish; start rules take effect when written (they are not versioned), so the production write is behind the STOP.

## Part C: Frontend

C1 **`/map` (`MapPage`) rebuilt**, still `PrelaunchGate` > `AdminRoute`. Top to bottom, as `map5_mockup_customer.png`:
- A small heading and one line: the same map for everyone, the dot and the steps are the customer's.
- **The map:** `EllaMapFace` with the customer's coffee highlighted and named, an arrow to each step's destination with its name, and every other placed coffee as a quiet unnamed dot. Family names at the four corners. No seam labels, no grades, no lines other than the customer's steps. Add what the face needs as optional props; the admin face and its defaults do not change.
- **Your first bag** (before any bag) or **You are here** (after one): the coffee's name, its signature notes, and the reason sentence from the rule row (before any bag only). A price chip where a price exists.
- **One step away:** one card per step: the word, the coffee, the customer line, a button that opens the coffee (name, notes, the same line, and "Make it my next bag", which calls the existing decide and re-reads the page).
- One closing line: nothing moves until you choose.
- No "Same again" button before a first bag. No compatibility sentence, no comfort-zone label.

C2 **Trail** (`MapTrail`, on the profile where it is today, still behind `profile_trail`): the list as on page 4 of the PDF: each chosen coffee in order, the word of the step that led to it, the date, and the customer's own line when there is one. Beside it the face with the dots joined, as built.

C3 **`MapQuizStart`** (inside the quiz result, behind `quiz_result`): reads the same first bag and reason. No other change.

C4 **`/admin/map`, table 1** becomes the rule: one row per current `dial_start_rule` in family then priority order, showing `admin_label`, the coffee and the reason, each editable (coffee from the placed coffees, the two sentences as text). The old family-by-lane table moves to `/admin/map/advanced`.

C5 **`/admin/map`, small fixes:** the lean buttons leave out a closed side; the publish button reads "Publish N changes" and is disabled with "Nothing to publish" when N is 0. The words come from the API or are chrome.

C6 Every customer word comes from the API: the reason, the step words and lines, and the fixed sentences as new `dial_customer_copy` codes (heading, the two section titles, the closing line, the button verbs). Seed them with the mockup's words.

## Part D: Tests

Vitest: each row of Data 1 from a fixture session (including the three readings in A5 and the espresso row both ways); the fallback; `setStartRule` supersede; a lean on a closed side is refused; `me` returns the published steps leaving the position and none of the calculated moves; the trail read. `tsc --noEmit` adds no error. All lints green.

## Part E: Data

1. Test DB: run the seed, run Acceptance.
2. **STOP.** Show Dana the production dry-run and Task 0 item 6's counts. After her yes: commit and push (files by path), check the startup log, apply the seed on production, read the result back.

### Data 1: the start rules (`dial_start_rule`)

`family_code` is `family_read` from A5. Lowest priority wins.

| Family | Priority | Condition | Also | First bag | Admin label | Customer reason |
|---|---|---|---|---|---|---|
| Balanced | 1 | `fruity_gt_cn` | | La Familia | Fruity points higher than Chocolate & Nutty points | You like it gentle, and you are curious about something brighter. This one is sweet first, with a touch of fruit. |
| Balanced | 9 | `always` | | Benchmark | Otherwise | Your answers were gentle all the way through. This is the cup where nothing sticks out, and it works however you make it. |
| Chocolate & Nutty | 1 | `branch_dark_smoky` | | Amsterdam | Picked the dark, smoky answer | You asked for dark and strong. This one is deep and smooth, with dark chocolate and walnut. |
| Chocolate & Nutty | 2 | `fruity_gt_balanced` | `espresso_at_home` | Tiger Stripe | Fruity points higher than Balanced points, and makes espresso at home | You like a stronger cup with a little lift, and you make espresso. This one was built for it. |
| Chocolate & Nutty | 3 | `fruity_gt_balanced` | | Fabricator | Fruity points higher than Balanced points | You asked for a stronger cup and picked one bright answer. This is chocolate and nut first, with a little lift. |
| Chocolate & Nutty | 9 | `always` | | The Daily | Otherwise | You like chocolate with some strength. This is the everyday cup, a step bolder than the gentlest one. |
| Earthy | 9 | `always` | | Amsterdam | Always | You asked for dark and strong. This one is deep and smooth, with dark chocolate and walnut. |
| Fruity | 1 | `cn_gt_zero` | | Geometric | Any Chocolate & Nutty points | You want fruit, with something underneath it. This one is bright fruit over caramel. |
| Fruity | 9 | `always` | | Cafè Feminista | Otherwise | You went for fruit all the way. This one is soft and tropical, with papaya and candied coconut. |
| Floral | 9 | `always` | | The Village | Always | You like it delicate and bright. This one is floral, with apple blossom and grapefruit. |

Condition meanings (each is one expression in `v_dial_start_input`):
- `fruity_gt_cn`: raw Fruity score greater than raw Chocolate & Nutty score.
- `fruity_gt_balanced`: raw Fruity score greater than raw Balanced score.
- `cn_gt_zero`: raw Chocolate & Nutty score above 0.
- `branch_dark_smoky`: the session's Earthy-branch answer is the reworded "dark, strong, a bit smoky" answer. (Such a session's primary is Earthy; whether it reads here or on the Earthy row depends on how the quiz stores it. Task 0 item 1 settles it; both rows give Amsterdam.)
- `espresso_at_home`: the customer's usual drink has the espresso base method.
- `always`: true.

## Acceptance (local, signed in as admin, test DB)

- `/admin/map` table 1 shows the ten rows of Data 1 in Dana's words. Changing the Balanced "Otherwise" coffee and reason saves, shows at once, and the earlier row is in the history.
- No Earthy coffee offers "toward Floral" and no Floral coffee offers "toward Earthy". The two retired first-match rows are gone from every list and present in history.
- `/map` for a test customer with a Balanced quiz and no bag: Benchmark lit and named, three arrows (The Daily, La Familia, Fabricator), the first-bag card with the reason, three step cards with the words of brief 5's Data 2. Every other coffee is an unnamed dot. No "Same again".
- The same for a customer on La Familia (The Village, Benchmark, Geometric) and on Fabricator (Geometric, Brazil, Benchmark).
- "Make it my next bag" on The Daily moves the dot, the steps become The Daily's (Amsterdam, Benchmark), and the first-bag reason is gone.
- A customer whose usual drink is espresso and whose quiz is Chocolate & Nutty with Fruity above Balanced starts on Tiger Stripe; without the espresso answer, on Fabricator.
- The trail lists the two choices above in order with the word "Bolder" on the second.
- No roaster name, ring, lane, grade, version or basis appears on `/map`, the trail or the quiz piece.
- The customer Bloom page renders exactly as before; every `dial_surface` row still says `lane`.
- Screenshots of `/map` (before and after a choice), the trail and table 1 in the closing report.

## Docs and closing (G6)

`README.md` here (brief 7; next is brief 8, prices and coffee-grain sellability, after Commerce 4; then brief 4, the switch); `WHAT_WE_BUILT.md`; `WHAT_WE_BUILT_DB.md`; `comments.sql` then `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md`; `REGRESSION.md` (the first bag comes only from `v_dial_start`; no family code or threshold lives in `matchService`; `/map` shows only published steps; a closed side is never offered); `OPEN_TASKS.md` (close OT-134; decaf first match stays OT-126; anything left); `CLOSING_REPORT_7.md`.

## Do not

- Do not switch, restyle or edit the customer Bloom page, the lane dial or any `dial_surface` row.
- Do not touch prices, SKUs, slots, sizes, Stripe, subscriptions or any uncommitted Commerce 4 file.
- Do not edit a quiz session, a quiz answer, an interpretation or a usual-drink answer.
- Do not delete `dial_first_match`, the calculated moves, or anything on `/admin/map/advanced`.
- Do not put a family code, a score threshold, a date or a sentence in code or in a view body, except the one expression per condition code in `v_dial_start_input`.
- Do not show a roaster name to a customer.
- Do not write production before the STOP in Part E.
