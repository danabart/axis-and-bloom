# Claude Code brief. Ella's Bloom Map 9: the reasons on `/map` become personal

Workstream: ella_bloom_map (`README.md` here; `CLOSING_REPORT_7.md` and `_8.md` for the page as built) · Written 2026-11-20 by the CTO session · **Model: the cheaper/faster model (G1.13: no money, no irreversible data).** · Dana runs it; push = deploy · Acceptance in **test mode on the test DB**.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every sentence, frame, count and mapping is a row; no answer code, family code or coffee id in code) · G2.2 surrogate id PK · G2.3 prefix `dial_` (map copy and map decisions) · G2.4 CATALOG.md checked (see "Why a new table" below) · G2.5 one writer per table (`dialPlacementService`), reads through `v_dial_…` and the existing `v_customer_…` views · G2.11 supersede and insert, never delete · G2.14 a fact lives once (the text is composed at read; no composed copy is stored) · G2.17 `comments.sql` then `catalog:md` · G2.19 a quiz taken by someone else is never quoted as "you told us" · G2.20 quiz answers and setup answers are read, never changed · G3.1 routes call services · G3.9 reuse `matchService.steps`, `dialReads`, `customerReads`; do not fork · G4.1 reuse `useCart` · G4.2 nothing typed in · G4.4 positive register (an honest direction label is allowed; no apology after it) · G4.5 no roaster name, and never the words "explore" or "confidence" · G4.6 `/map` stays behind the pre-launch gate and admin-only · G5.1 vitest · G5.2 acceptance in test mode · G1.6 push is deploy, one closing report · G1.9 add files by path only.
Mode: test. STOP points: after Task 0 (Dana reads the proposed lines); before the production seed (Part E).

**Goal.** `/map` today says what a coffee is. It never says why it is this customer's, and a step card ("more fruit") leaves the customer to translate. After this brief every line on the page answers "why this one, for you", leaning on something the customer told us: their quiz answers, and their setup answers when they have them. One step is shown as the one we would take them to next. The card is the coffee's name and the reasoning, with no "See it".

**Decisions already made (Dana, 2026-11-20; do not re-open).**

1. **The text depends on what we know about the person**, not on a marketing stage. Levels in this brief: nothing known (the coffee's notes only), quiz, quiz and setup answers. Feedback and several bags come in the next brief.
2. **At the quiz and setup levels no model writes anything.** Every sentence the customer reads is a row Dana approved. Liam writes per person only from the feedback level up (next brief, not this one).
3. **One lead step** whenever the data supports one: "where we'd take you next". The other steps follow as alternatives.
4. **Voice: "we".** The first bag carries a "Founder's pick" label. No "I".
5. **No "See it" on a step card.** Coffee name and reasoning. The price chip is the action: it does what "Make it my next bag" does today (records the step, adds one bag).
6. **The treat question (v7 Q6) is never quoted as a reason** (2026-11-15: kept to learn from, used for nothing).
7. Dana read four worked examples on 2026-11-20 and approved the voice ("perfect"). They are in Data 4; the build must be able to produce text of that kind for those four people.
8. The customer Bloom page, the lane dial and every `dial_surface` row stay as they are. The switch is brief 4.

CTO calls, reversible, flag if the code disagrees:

- **Composed at read, nothing stored.** At these levels the text is a deterministic join of approved rows and the customer's own facts, so it is built inside `matchService.steps` on each read. A founder edit shows at once and there is no copy to drift (G2.14). Stored text arrives with the generated feedback level.
- **Three parts in every line:** what the customer told us, what this coffee is or what changes in the cup, and nothing else. The first part comes from "said back" rows; the second from the start rule or the step row.
- **Fallback chain for the first bag:** quoted answers plus the rule's `coffee_line` → the rule's existing `customer_reason` (no quotable answers: an old session with no stored answer ids, a quiz taken by someone else, or a rule with no `coffee_line` yet) → the coffee's notes (no quiz).
- **The lead step:** the customer's `coffee_feeling` wins when it names a direction and a shown step from the position carries that direction; otherwise the start rule's lead (first bag only); otherwise no lead.
- **Usual drink is not quoted in this brief.** No founder line exists yet about how each coffee behaves per drink. The espresso start rule keeps its own sentence.

**Why a new table (G2.4).** Considered and not fitting:
- `quiz_answer`: SCD2 quiz content, writer `seed`; what the map says back about an answer is map copy, edited on `/admin/map`, and must not version the quiz.
- `dial_customer_copy`: one sentence per code; using codes like `said_v7_q2_b` would hide the answer-to-sentence mapping in a naming convention (G2.1).
- `brew_profile_field_value` / `brew_coffee_feeling`: writer `seed`, owner-SQL edits; no app writer to add.
So: one new table, `dial_said_back`, for every "what we say back about a fact the customer gave us", with a source lookup. Everything else is columns on existing `dial_` tables and rows in `dial_customer_copy`.

---

## Task 0: Verify (write into `CLOSING_REPORT_9.md`; STOP after)

Read-only, test DB and production.

1. **Answers per session.** Where a completed session's answer ids live (`quiz_session.context_data` answerIds, `branch_answer_id`) and which view, if any, gives one row per session × answer with `answer_code`, question weight and the family each answer scored for. If none, propose `v_dial_quiz_answer` (one row per current quiz session of a customer × answer picked) reading the same sources `v_dial_start_input` reads. Count on production: current results with stored answers, without them, and taken by proxy.
2. **Is `answer_code` stable and unique among current answers** of the active main quiz and its three branches? List them beside Data 1 and name any code in Data 1 that does not exist, and any current code Data 1 misses (other than Q6).
3. **The nine current start rules and every current shown step** on production, beside Data 2 and Data 3: say where production differs from what those tables assume (a coffee, a step, a line Dana edited since 2026-11-17).
4. **`dial_move`:** is there a way to say bolder and gentler are opposites? If not, propose `dial_move.opposite_move_id` (nullable self-reference, seeded for the two).
5. **Setup facts:** confirm `v_customer_cupboard_coffee` and `v_customer_coffee_feeling` give, per canonical customer, a listed brand's label (not the free words on the "other" row) and the feeling's `move_code`; and which `customerReads` functions already read them.
6. **Where a non-versioned map number lives** (`dial_earthy_branch_reworded_on` is the precedent). The two counts in Part B go there.
7. **The page with nothing known:** what `/map` returns today for a signed-in customer with no quiz result, and for one whose position came from a pick and not a quiz.
8. **Propose, for Dana's yes:** the `move` tag and the `when_line` for every current shown step that Data 3 does not cover, in the same voice. Mark each as proposed.

**STOP.** Show Dana: Data 1 to 3 as they would be written (with item 2, 3 and 8 corrections), and the composed page text for the four people in Data 4 on the test DB.

## Task 0.5: Dana's manual steps
None.

---

## Part A: Schema (additive, idempotent; `comments.sql` for every change)

A1 **`dial_said_back_source`** (lookup: `id`, `code` UNIQUE, `label`, `sort_order`): `quiz_answer`, `coffee_feeling`.

A2 **`dial_said_back`**: `id` SERIAL PK, `source_id` FK, `fact_code` TEXT (the answer's `answer_code`, or the feeling's value code), `says_back` TEXT not blank (a phrase that completes "You told us …"), `decided_by`, `created_at`, `superseded_at`. One current row per (`source_id`, `fact_code`) by partial unique index. Supersede and insert. **A fact with no current row is never quoted**; that is how Q6 stays out. View `v_dial_said_back` (current rows with the source code) is the one read path.

A3 **`dial_start_rule`**, four nullable columns, carried through `v_dial_start_rule` and `v_dial_start`:
- `coffee_line`: what this coffee is for this person, the sentence that follows the quoted answers.
- `lead_to_coffee_id`: the step we would take them to next; when written it must be a current shown step from the rule's coffee.
- `lead_line`: the sentence for that lead.
- `lead_quote_family_code`: the family whose answer is quoted before the lead line, when the customer gave one; NULL quotes nothing.

A4 **`dial_step`**, two nullable columns, carried through `v_dial_step`:
- `move_id` FK `dial_move` (bolder, gentler, different): the direction this step answers. NULL = none.
- `when_line`: the opening clause of the card when the step is not the lead ("If you want more weight.").

A5 If Task 0 item 4 agrees: `dial_move.opposite_move_id`.

A6 If Task 0 item 1 finds no view: `v_dial_quiz_answer`.

A7 **`dial_customer_copy` rows** (seed, insert if missing): `founder_pick` "Founder's pick" · `lead_title` "Where we'd take you next" · `others_title` "Or one of these" · `told_us_two` "You told us {a}, and {b}." · `told_us_one` "You told us {a}." · `also_said` "You also said {c}." · `kitchen` "You have {brand} in your kitchen." · `asked_for` "You asked for {feeling}." · `step_away` "This moves away from the answers you gave." · `step_against` "This goes the other way from what you asked for." · `price_add` "{price} · Add". The rows `see_it`, `make_next_bag` and `steps_hint` stay in the table; the page stops reading them.

A8 **Integrity checks** (boot, report only, G2.18): a `dial_said_back` row whose `fact_code` matches no current answer or feeling value; a current quotable answer of the active quiz (weight above 0) with no row; a start rule whose lead is not a current shown step from its coffee.

## Part B: Backend

B1 **Writers, all in `dialPlacementService`** (declare in `comments.sql`): `setSaidBackInTx` (new); `setStartRuleInTx` and `setStepInTx` take the new fields (reuse, do not fork). Admin routes on the existing `/api/admin/map` router.

B2 **`matchService.steps` composes** (reuse; the response keeps its shape and gains fields). Two counts are parameters (Task 0 item 6): answers quoted for the family (2) and for another family (1).
- **Quotable answers** = the customer's current session's answers that have a `v_dial_said_back` row, only when the session was self-taken (G2.19). Order: the branch answer first, then question weight high to low, then question number.
- **First bag text**: `kitchen` when a listed brand exists · `told_us_two` / `told_us_one` from the answers that scored for the family as read · `also_said` from the top answer that scored for another family, when there is one · the rule's `coffee_line`. Fallbacks as in the CTO call.
- **Lead**: per the CTO call. Its text: `asked_for` (feeling lead) or `told_us_one` with the top answer of `lead_quote_family_code` (rule lead, when the customer gave one), then the rule's `lead_line` (rule lead) or the step's `customer_line` (feeling lead).
- **Every other step**: `when_line`, then `customer_line` (else the notes, as today), then `step_against` when the customer's feeling is the opposite of the step's move, else `step_away` when the customer has quotable answers, gave no points to the destination coffee's family, and that family is not their family as read.
- **Response:** `firstBag.text`, `firstBag.isFounderPick`, and per step `isLead`, `text`. For admins only, `basis`: the ids of the rows and the fact codes each text used.
- No family code, answer code, move code or coffee id appears in the service; comparisons are joins on rows.

B3 **Admin preview:** `GET /api/admin/map/reasons?profileId=` returns the same composed result with `basis` for any customer (admin-gated, read-only, reuses B2).

## Part C: Frontend

C1 **`/map`** (`MapPage.tsx`): the first-bag card shows the `founder_pick` label and `firstBag.text`. Steps: the lead card first under `lead_title`, the rest under `others_title`. A step card is the coffee's name, its text and the price chip; the chip (`price_add`) calls today's `choose`. Remove the "See it" toggle, the expanded panel and the steps hint. The first-bag button stays as it is.

C2 **`/admin/map`**: table 1 (start rules) edits the four new fields; the steps table edits `move` and `when_line`; a new small table "What we say back" lists every current quiz answer and feeling with its phrase (empty = never quoted) and edits it; a "Read it as" picker (search a customer) shows their composed page text with the rows it used.

## Part D: Tests (vitest, test DB)

Composition for: all answers in one family; a split result (the also-said sentence appears); no stored answers (falls back to `customer_reason`); a proxy-taken quiz (nothing quoted); Q6 never quoted even when it is the only answer left; a feeling that names a direction with a matching step (it leads, with `asked_for`); a feeling with no matching step (the rule's lead stays); `step_against` and `step_away`; no quiz (notes only, no lead, no founder label). The three writers supersede and insert, and a second identical write changes nothing. The three integrity checks.

## Part E: Seed, then production

`backend/src/scripts/ellaMapReasons_2026_11_20.ts`, same shape as `ellaMapPrices_2026_11_18.ts`: `--dry-run` default in a READ ONLY transaction, `--apply` in one transaction through the writers, `--expect-db`. It writes Data 1 to 3 as Dana approved them at the STOP. Test DB first. **STOP before production:** show the dry run; apply after Dana's yes.

---

## Data 1: what we say back (`dial_said_back`)

Each phrase completes "You told us …". Q6 has no rows.

| fact | phrase |
|---|---|
| v7_q1_a | coffee is a daily ritual and you're particular about it |
| v7_q1_b | coffee is a reliable habit for you |
| v7_q1_c | you're still discovering coffee |
| v7_q2_a | a good cup is strong and satisfying |
| v7_q2_b | a good cup is smooth and easy the whole way |
| v7_q2_c | a good cup feels alive and changes as you drink it |
| v7_q3_a | you taste a black coffee first, then make it richer |
| v7_q3_b | you smooth a black coffee before you try it |
| v7_q3_c | your first thought with a black coffee is what flavors are in it |
| v7_q4_a | a coffee with no bitterness would bother you |
| v7_q4_b | too bitter is what would bother you most |
| v7_q4_c | a cup where every sip tastes the same would bother you |
| v7_q5_a | a little bitterness tastes serious to you |
| v7_q5_b | you'd rather have something gentler and smoother |
| v7_q5_c | bitter coffee tastes burnt to you |
| v7_branch_cn_stay | coffee should feel like a reward: warm, rich, comforting |
| v7_branch_cn_earthy | you want coffee with a kick: dark, strong, a bit smoky |
| v7_branch_fruity_stay | coffee is at its best bright and lively |
| v7_branch_fruity_floral | coffee is at its best light and delicate, and the smell matters most |
| v7_branch_bal_cozy | you'd be sad to lose the cozy, dessert-like feeling |
| v7_branch_bal_fruit | you'd be sad to lose that little sweetness that reminds you of fruit |
| v7_branch_bal_floral | you'd be sad to lose the smell |
| coffee_feeling: bolder | something bolder than what you drink now |
| coffee_feeling: gentler | something gentler than what you drink now |
| coffee_feeling: different | something different from what you drink now |

(The feeling phrases complete "You asked for …". `happy` has no row.)

## Data 2: the nine start rules, new fields

Coffee = the rule's first bag as of 2026-11-17 (Task 0 item 3 confirms).

| rule | `coffee_line` | lead | `lead_line` | quote before lead |
|---|---|---|---|---|
| Balanced, fruity above C&N → La Familia | So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end. | The Village | This is more of that: just as light, with more flower and citrus in it. | fruity |
| Balanced, otherwise → Benchmark | This is the cup where nothing sticks out, and it works however you make it. | La Familia | The gentlest step from here: lighter in the cup, with caramel, honey and a little clementine. | fruity |
| C&N, fruity above Balanced, espresso → Tiger Stripe | This one is chocolate first with a little lift, and it was built for espresso. | The Waverly | More of the lift: fig and orange over dark chocolate. | fruity |
| C&N, fruity above Balanced → Fabricator | This is chocolate and nut first, with a little lift. | Geometric | The same family with more fruit, and sweeter. | fruity |
| C&N, otherwise → The Daily | This is chocolate with some strength: our everyday cup. | Amsterdam | The next size up in strength: darker and smoother. | none |
| Earthy → Amsterdam | This one is deep and smooth, with dark chocolate and walnut. | Great Heights | The same idea, roasted darker. | none |
| Fruity, any C&N points → Geometric | So: bright fruit, with caramel under it to make it an everyday cup. | La Familia | Lighter and sweeter: caramel, honey, a little clementine. | none |
| Fruity, otherwise → Cafè Feminista | This one is soft and tropical, with papaya and candied coconut. | The Village | More delicate: more floral, with grapefruit. | none |
| Floral → The Village | This one is floral, with apple blossom and grapefruit. | Cafè Feminista | Creamier and more tropical: papaya and candied coconut. | none |

## Data 3: steps from the nine start coffees (`move`, `when_line`)

`customer_line` stays as it is. Steps not listed here: Task 0 item 8 proposes them.

| from → to | move | `when_line` |
|---|---|---|
| Benchmark → The Daily | bolder | If you want more bite. |
| Benchmark → La Familia | gentler | If you want it lighter. |
| Benchmark → Fabricator | different | If you're curious. |
| La Familia → The Village | gentler | If you want it more delicate. |
| La Familia → Geometric | bolder | If you like the fruit and want more coffee under it. |
| La Familia → Benchmark | different | If the fruit turns out to be more than you wanted. |
| The Daily → Amsterdam | bolder | If you want it darker. |
| The Daily → Benchmark | gentler | If it has more bite than you wanted. |
| Fabricator → Geometric | different | If you want more fruit. |
| Fabricator → Brazil | gentler | If you want it simpler. |
| Fabricator → Benchmark | gentler | If you want it rounder. |
| Tiger Stripe → Geometric | different | If you want more fruit and less weight. |
| Tiger Stripe → The Waverly | different | If you want more fruit and keep the chocolate. |
| Tiger Stripe → Blossom | bolder | If you want a darker roast. |
| Amsterdam → Great Heights | bolder | If you want it darker still. |
| Amsterdam → The Daily | gentler | If you want it lighter and sweeter. |
| Geometric → La Familia | gentler | If you want it lighter. |
| Geometric → Tiger Stripe | bolder | If you want more weight. |
| Geometric → Fabricator | different | If you want less fruit. |
| Cafè Feminista → The Village | gentler | If you want it more delicate. |
| The Village → Cafè Feminista | different | If you want it creamier. |
| The Village → La Familia | different | If you want it sweeter and softer. |

## Data 4: the four people Dana approved the voice on (pull of 2026-11-15, `person_n`)

The composed text will not match these word for word; it must read like them and use the same facts.

- **85 (La Familia, quiz only).** Answers q1_c, q2_b, q3_b, q4_b, q5_b. First bag: "You told us a good cup is smooth the whole way, and that too bitter is what would bother you most. You also said you're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end." Lead The Village: "You said you're curious. This is more of that: just as light, with more flower and citrus in it." Geometric carries the away sentence.
- **33 (The Daily, quiz only).** Answers q1_b, q2_b, q3_c, q4_a, q5_a. First bag quotes the bitterness answers, then "This is chocolate with some strength: our everyday cup." Lead Amsterdam. Benchmark: "If it has more bite than you wanted."
- **23 (Geometric, quiz only).** Answers q1_a, q2_c, q3_c, q4_c, q5_c. First bag quotes the alive and burnt answers, also the daily ritual. Lead La Familia.
- **81 (Benchmark, quiz and setup; a test account).** Answers q1_b, q2_c, q3_b, q4_b, q5_a; kitchen Counter Culture Coffee; feeling gentler. First bag opens "You have Counter Culture Coffee in your kitchen." Lead La Familia with "You asked for something gentler than what you drink now." The Daily carries "This goes the other way from what you asked for."

## Acceptance (local, signed in as admin, test DB)

- "Read it as" for the four people in Data 4 shows text that uses the facts listed there, with the rows it used.
- `/map` for a quiz-only customer: the "Founder's pick" label, a first-bag paragraph that quotes their answers, one card under "Where we'd take you next", the others under "Or one of these". No "See it" anywhere. The price chip records the step and adds one bag, as "Make it my next bag" did.
- A customer with a kitchen brand and a feeling: the paragraph opens with the brand; the lead follows the feeling.
- A customer with no quiz: the coffee's notes only, no label, no lead.
- A quiz taken by someone else, and an old session with no stored answers: the existing `customer_reason`, nothing quoted.
- Editing a phrase on `/admin/map` changes the customer's text on the next read.
- No roaster name, no "explore", no "confidence" in any composed text.
- The old Bloom page is unchanged; every `dial_surface` row says `lane`.
- Screenshots: `/map` for two of the four people, the "What we say back" table, "Read it as".

## Docs and closing (G6)

`README.md` here (brief 9; next: the feedback level, where Liam writes per person and the text is stored; then brief 4, the switch); `WHAT_WE_BUILT.md`; `WHAT_WE_BUILT_DB.md`; `comments.sql` then `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md`; `REGRESSION.md` (the first bag quotes only self-taken answers that have a said-back row; Q6 is never quoted; one lead at most; a step card has no "See it"); `OPEN_TASKS.md` (usual drink is not quoted; steps left without a `when_line`; the page does not yet know a bag was delivered or tasted); `CLOSING_REPORT_9.md`.

## Do not

- Do not call a model, Liam or any AI service to write or rewrite a customer sentence.
- Do not store a composed text.
- Do not put a sentence, an answer code, a family code, a move code or a coffee id in code or in a view body.
- Do not quote the treat question, a quiz taken by someone else, or a fact with no said-back row.
- Do not change quiz content, quiz scoring, a start rule's coffee or condition, a step's coffee, word or `customer_line`, or any stored answer.
- Do not delete a row; supersede.
- Do not change the customer Bloom page, the lane dial or any `dial_surface` row.
- Do not write production before the STOP in Part E.
