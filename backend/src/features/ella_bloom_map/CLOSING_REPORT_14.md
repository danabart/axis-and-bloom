# Closing report: Ella map 14, the spot and the walk

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_14_SPOT_AND_WALK.md` · Design: `DESIGN_MAP_POSITION_2026-11-26.md` · Run 2026-11-27.

**Status:**

- Task 0 done; Dana answered (2026-11-27).
- Parts A to D built on the test DB 2026-11-27.
- **Part E done on production 2026-11-27** (94db8c1, rev 00907) on Dana's "Yes, push". See "Part E" at the end.
- Task 0 below is as it was written before her answers.

- G1.9: one peer session (danab-0a) was listed. It confirmed it was idle: Usual Drink 4 had been pushed (3022a2a), and nothing was running in the repo, on the test DB or in a deploy.
- Every read ran inside `BEGIN READ ONLY … ROLLBACK`. The runners are under `backend/tmp/em14_*` (git-ignored): `em14_ro.mjs` and `em14_pages_prod.mts`.
- The guardrails and the brief do not conflict.

---

## Task 0

### Item 5. Production counts, and Dana's spot

| | Production | Test DB |
|---|---|---|
| Decisions by move | quiz_result 3 (3 customers) · stay 3 · step 2 | quiz_result 34 (32) · stay 1 · step 6 (5) |
| Positions today (`v_customer_match_current`) | quiz_result 2 · step 1 (Dana) | |
| Attributed real orders (`v_customer_bag_attribution`) | **0**. All 6 orders are test mode (not reportable), from 2 buyers. | 240 lines, all `manual` (lines / orders by attribution: buyer 120 / 105, intended 90 / 60, claim 30 / 15) |
| Customers with one or more real orders | 0 | 195 |
| Customers with a reorder (2+ separate orders, same coffee) | 0 | 15, all counting kinds |
| Two or more bags of one coffee in one order | 0 | 0 |
| Feedback, current revisions (`v_customer_feedback_current`) | **0**. `customer_feedback_event` is empty. | 0, table empty |

**Dana (canonical `5d005443`).** Her events, in order:

| When | Event | Coffee | Code under the new rule | Effect |
|---|---|---|---|---|
| 2026-11-12 22:33 | quiz result (no `rule_id`) | Tiger Stripe | founders_pick | sets the spot |
| 2026-11-12 22:48, 22:53, 22:54 | stay ×3 | Tiger Stripe | decision_other | nothing |
| 2026-11-26 20:53 | step | Blossom | decision_other | nothing |
| 2026-11-26 20:54 | step | Brazil | decision_other | nothing |
| 2026-11-08, 2026-11-18 | 2 orders: Benchmark + Cafè Feminista, then Fabricator | | not reportable (test mode), so not in `v_customer_bag_attribution` | none |

- Today's view puts her on **Brazil**, by move step.
- The new rule puts her on **Tiger Stripe, basis founders_pick, since 2026-11-12 22:33**. That is what the brief expected.

**The other two production spots stay where they are:** Benchmark (quiz-scenario test account) and Amsterdam (b40e6c85), both founders_pick.

### Item 6. The walk, and Dana's three pages

**Steps on the active map (L5), shown and current:**

| From | To | Word | Line (`{from}` filled with the map name) |
|---|---|---|---|
| Tiger Stripe | Blossom | Bolder | A darker roast than Tiger Stripe, with a fuller body. |
| Tiger Stripe | Geometric | More fruit | More fruit than Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it. |
| Tiger Stripe | The Waverly | More fruit | Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange. |
| **Blossom** | Tiger Stripe | Brighter | A lighter roast than Blossom, with more fruit. |
| **Blossom** | Brazil | Lighter | Lighter than Blossom: plain chocolate. |
| **Blossom** | Indonesia | Earthier | Earthier than Blossom: dark chocolate, apricot and caramel, with raisin and cedar. |
| Brazil | Blossom | Bolder | Darker than Brazil, with a fuller body. |
| Brazil | Fabricator | More going on | More going on than Brazil: citrus and spice added. |

**How the pages below were made.** The customer and coffee sentences come from today's `matchService.steps` on production, read only (`tmp/em14_pages_prod.mts`). The harness answers only the position row, with the coffee named. Labels, the compare line and "Back to your spot" are written by hand from the brief's rules, since they are not built yet.

**Page 1: on her spot.** Title "You start here". Dana has no real order, so `hasBag` is false.

- Map: Tiger Stripe ringed. No looked-at marker. No start marker (the spot is the pick).
- Top card:
  - **Founder's pick · Tiger Stripe** · $32.00 · [Add my first bag to the cart]
  - "Coffee should feel like a reward for you: warm, rich, comforting. A little bitterness tastes serious to you. Chocolate first, with a little lift. Built for espresso."
- Where we'd take you next:
  - **Blossom** (Bolder, $29.00 · Add): "For you, a good cup is strong and satisfying. A darker roast than Tiger Stripe, with a fuller body."
    - Lead from strongest_support, `v7_q2_a`. She has no `rule_id`, so the start_rule lead source is skipped, as in reports 12 and 13.
- Or one of these:
  - **Geometric** (More fruit, $29.00 · Add): "Next to your coffee, you'd reach for something fresh and lively. More fruit than Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it." (treat, `v7_q6_c`)
  - **The Waverly** (More fruit, $29.00 · Add): "Coffee is a daily ritual for you, and you're particular about it. Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange." (family, `v7_q1_a`)
- Closing line: "Look around as much as you like. Your spot moves when you order a coffee again or tell us you liked it."

**Page 2: looking at Blossom** (`/map?at=2916`)

- Map: Tiger Stripe still ringed. A lighter marker on Blossom. Arrows from Blossom.
- Top card:
  - **Looking at · Blossom** · $29.00 · Add
  - "A darker roast than Tiger Stripe, with a fuller body." This is the published step line from the spot, Tiger Stripe → Blossom.
  - Back to your spot: Tiger Stripe
- Where we'd take you next:
  - **Tiger Stripe** (Brighter, $32.00 · Add): "Coffee is a daily ritual for you, and you're particular about it. A lighter roast than Blossom, with more fruit." (strongest_support, `v7_q1_a`)
- Or one of these:
  - **Brazil** (Lighter, $29.00 · Add): "Your answers point elsewhere. Lighter than Blossom: plain chocolate."
  - **Indonesia** (Earthier, $29.00 · Add): "You taste a black coffee first, then make it richer. Earthier than Blossom: dark chocolate, apricot and caramel, with raisin and cedar." (family, `v7_q3_a`)

**Page 3: looking at Brazil, one step on from Blossom** (`/map?at=2939`)

- Map: Tiger Stripe ringed. A lighter marker on Brazil.
- Top card:
  - **Looking at · Brazil** · $29.00 · Add
  - "The base on its own: chocolate, almond and honey." There is no step from Tiger Stripe to Brazil, so this is Brazil's `map_line`.
  - Back to your spot: Tiger Stripe
- Where we'd take you next:
  - **Blossom** (Bolder, $29.00 · Add): "A little bitterness tastes serious to you. Darker than Brazil, with a fuller body." (strongest_support, `v7_q5_a`)
- Or one of these:
  - **Fabricator** (More going on, $29.00 · Add): "Coffee should feel like a reward for you: warm, rich, comforting. More going on than Brazil: citrus and spice added." (family, `v7_branch_cn_stay`)

**For Dana, from the walk:**

- **W1. Your own spot as the lead.** While you look at Blossom, the lead card is Tiger Stripe, your own spot ("A lighter roast than Blossom, with more fruit"). It also sits beside "Back to your spot: Tiger Stripe" on the top card.
  - My recommendation: leave it. It is a real published step, and hiding it would need a new rule row.
  - If you would rather it were never the lead, or never a card, while looking elsewhere, that becomes one parameter.
- **W2. The start-rule lead.** The `start_rule` lead source belongs to the spot (the rule's lead leaves the Founder's pick).
  - Proposal: it applies only on the spot page, never while looking at another coffee.
  - The lead then comes from setup_answer or strongest_support, as on page 2.
- **W3. Which coffees `at` accepts.** Proposal: a coffee placed on the active map, active, that passes the customer's tag filter (decaf as today), the same test as `firstMatchFor`. Sellability is not required.
  - A coffee with no price shows its card without a chip, as steps do today.
  - Anything else gets a 404 (`NOT_ON_MAP`).

### Item 3. How the spot is computed

**Recommendation:** an event view, and the fold inside `v_customer_match_current` itself, as a `WITH RECURSIVE` over that view.

- Every reader of the position keeps reading one view: `getMatchCurrent`, the `has_position` search, integrity check 11. That is one read path (G2.5).
- Brief call 6 is met: the view keeps its name and readers, with two more columns.
- **The alternative,** a fold in one TypeScript reader function, is easier to read, but the two SQL readers (`has_position`, check 11) would then read something other than the spot. That makes two read paths, so I advise against it.
- **Cost:** a recursive view folds every customer on each read. Production has 3 customers with a decision, test 32, so this is nothing today. If it grows, a SQL function `customer_spot(canonical)` would take over (OT note).

**`v_customer_spot_event`: one row per event per canonical customer** (`at`, `coffee_id`, `event_code`, `effect_code`, `is_active`, `rating`, `raw_text`, `source`, `source_id`, `ordinal`):

| Source | Code |
|---|---|
| quiz_result decisions (`customer_match_decision`, move quiz_result, through `v_customer_match_trail`) | founders_pick |
| other decisions | decision_other (effect nothing, not on the trail) |
| one row per (drinker, order, coffee) from `v_customer_bag_attribution`, at `order.created_at` (as `v_customer_timeline` and `v_customer_calibration` do) | `ordinal` = its place among the drinker's orders of that coffee whose kind has `counts_toward_reorder`. **reorder** when ordinal ≥ `dial_spot_reorder_count`; otherwise **first_order**, which also covers non-counting kinds |
| current feedback rows from `v_customer_feedback_current`, at `occurred_at` | feedback_positive / _neutral / _negative from its `sentiment` |

Each row takes its `effect_code` and `is_active` from `v_dial_spot_event`. A switched-off row has no effect and leaves the trail. Ties are broken by time, then the event row's `sort_order`, then id.

**The fold, per customer in time order.** State: spot coffee, basis code, since.

- **sets_spot** (founders_pick): applies while the basis is NULL or founders_pick. Spot = its coffee.
- **moves_spot, reorder:** spot = its coffee, basis reorder.
- **moves_spot, feedback_positive:**
  - Let *r* be the customer's latest current rating of the spot's coffee at or before this event.
  - If the event is on the spot's own coffee, the spot stays and the basis becomes feedback_positive. Pinned case 5 needs this.
  - Else, if *r* is not NULL and *r* > the event's rating, the spot stays.
  - Else the spot moves there, basis feedback_positive.
- **trail_only, nothing:** no change.
- Every change of basis sets `since` = that event's `at`.
- **The two new columns** are `spot_event_code` and `spot_since`.
- **Decision-only columns** (`decision_id`, `decided_version_id`, `move_code`, `actor_user_id`) are NULL when the basis is not founders_pick. For founders_pick they are the quiz decision's, as today.
- **No founders_pick event means no spot.** The design says the spot starts at the Founder's pick, so orders or feedback alone never create a position (and OT-124 keeps its meaning).

**The pinned cases on paper.** All 14 come out as the brief says.

| Then | Fold | Spot · basis |
|---|---|---|
| nothing | FP Tiger | Tiger · founders_pick ✓ |
| old step decisions | decision_other, no change | Tiger · founders_pick ✓ |
| Blossom in the cart | not an event | Tiger · founders_pick ✓ |
| orders Blossom once | ordinal 1 → first_order, trail | Tiger · founders_pick ✓ |
| Tiger 5, orders Blossom, Blossom 4 | Tiger 5 is positive on the spot: basis feedback_positive. Blossom 4: r=5 > 4, stays | Tiger · feedback_positive ✓ |
| orders Blossom, Blossom 4, Tiger unrated | r NULL, moves | Blossom · feedback_positive ✓ |
| Blossom in two orders | 2nd order, ordinal 2 ≥ 2: reorder | Blossom · reorder ✓ |
| two bags of Blossom in one order | one (order, coffee) row, ordinal 1: first_order | Tiger · founders_pick ✓ |
| orders Blossom, rates it 2 | negative, trail only; lead skip | Tiger · founders_pick ✓ |
| Tiger 2, nothing else | negative on the spot, no change | Tiger · founders_pick ✓ |
| reorder to Blossom, then a retake gives Benchmark | basis reorder, so sets_spot does not apply | Blossom · reorder ✓ |
| a retake gives Benchmark, no evidence | basis FP, sets_spot applies | Benchmark · founders_pick ✓ |
| a renewal ships Blossom twice | kind does not count: two first_order | Tiger · founders_pick ✓ |
| `reorder` row off, Blossom twice | 2nd row inactive, skipped | Tiger · founders_pick ✓ |

**Calls the fold makes that the brief leaves open. Your yes on each:**

- **F1. Equal ratings move the spot.** "Unless the spot's coffee has a *higher* rating": Tiger 4, then Blossom 4, moves to Blossom.
- **F2. Positive feedback on the spot's own coffee** keeps the coffee and makes the basis feedback_positive. The label becomes "Your spot", and a later quiz retake no longer moves it. Pinned case 5 implies this.
- **F3. The spot's rating is its latest current rating** at the time of the event. A coffee can carry several feedback rows, one per order line.
- **F4. Orders that do not count, and counting orders below the reorder count,** are first_order: trail only, the word "Ordered".
- **F5. An order's time is `order.created_at`,** as in the timeline views.

### Item 2. What this brief would add or change (G3.9 amended), beside what exists

**Tables**

| New or changed | Considered | Why it does not fit / decision |
|---|---|---|
| **New** `dial_spot_effect` (lookup: sets_spot, moves_spot, trail_only, nothing). Writer: seed | `dial_reason_kind` | It is a kind of choosing, not an effect |
| **New** `dial_spot_event` (code, label, effect_id, is_active, sort_order, trail_word, decided_by, superseded_at; one current row per code) | `dial_reason_choice`: no effect column, and its kinds are about choosing cards. `evidence_parameter`: one switch per event would lose label, effect and order. `dial_customer_copy`: words only | **Writer: `dialPlacementService.setSpotEventInTx` plus seed.** `dial_reason_choice`'s writer is `dialPlacementService.setReasonChoiceInTx`. That module writes every map configuration row (start rules, copy, steps, said-back, reason choices), so yes, the new writer belongs there |
| **Changed** `customer_order_kind`: `counts_toward_reorder BOOLEAN NOT NULL DEFAULT false` | none | Brief call. Set true for manual and liam_followed **once**, inside the `IF NOT EXISTS` guard that adds the column, so a boot never overrides an edit (G2.8). Writer stays seed |

On `trail_word`: I propose the trail word ("Ordered") sits on the event row, like `dial_step.button_word`, rather than in a `dial_customer_copy` row found by a code pattern. Say if you would rather it were a copy row.

**Views**

| New or changed | Considered | Why it does not fit / decision |
|---|---|---|
| **New** `v_dial_spot_event` | none | The table's one read path (G2.5) |
| **New** `v_customer_spot_event` (item 3) | `v_customer_timeline`, which has quiz, order and feedback arms. But it reads quiz sessions, not the Founder's pick coffee; it carries superseded feedback revisions; it is one row per line, not per order; and its sentiment is typed in | Built from the three read paths the brief names: `v_customer_match_trail`, `v_customer_bag_attribution`, `v_customer_feedback_current` |
| **Changed** `v_customer_feedback_current` | | Sentiment from the two rating parameters. Same columns, same results |
| **Changed** `v_customer_match_current` | | The fold. Two more columns; decision columns NULL off founders_pick |

**Parameters** (`evidence_parameter`, writer `evidenceParameterService`, edited at `/api/admin/evidence/parameters`):

| Key | Value | Range |
|---|---|---|
| `feedback_positive_min_rating` | 4 | integer 1..5 |
| `feedback_negative_max_rating` | 2 | integer 1..5 |
| `dial_spot_reorder_count` | 2 | integer 2..10 |
| `dial_spot_skip_disliked_lead` | 1 | 0..1 |

- The two rating keys are not `dial_`: the palate views read them too.
- The integrity check gains: the two keys are present, and negative max < positive min.

**Reader functions**

| New or changed | Considered | Why it does not fit / decision |
|---|---|---|
| **Changed** `customerReads.getMatchCurrent` | | Reused: `spotEventCode` and `spotSince` added, decision fields nullable |
| **New** `customerReads.getSpotTrail(profileId)` reads `v_customer_spot_event` | `getMatchTrail` reads decisions only, and stays for the workbench's Decisions card and the first-bag rule lookup. `getMatchTrailLines`: the feedback events now carry `raw_text` themselves | `getMatchTrailLines` would become unread: retire it, or keep it with an OT note? |
| **New** `dialReads.spotEvents()` reads `v_dial_spot_event` | `dialReads.reasonChoices` | Reads another table |
| **Reused** `customerReads.getFeedbackCurrent(uid, { sentiment: 'negative' })` for the lead skip | | It resolves through `resolveCanonicalUserId`. Part B checks it takes the profile id, and extends it if not (G3.9) |
| **Reused** `hasBag` = the spot trail has an order event | | No new reader |
| **Reused** compare line from `dialReads.stepsFrom(spot)`; the coffee check from `dialReads.placementActive` + `passesTagFilter` | | |

**Writer functions:** only `dialPlacementService.setSpotEventInTx` is new. Looking at a coffee writes nothing, so it has no writer.

**Services and routes (changed, not forked)**

- `matchService.steps(…, { at })`.
- `matchService.me`: the trail from `getSpotTrail`.
- `GET /api/map/steps?at=`.
- `mapAdmin`: GET and PUT for the spot events. "Read it as" adds the events, spot, basis and since.

**Integrity**

- A new check for unknown spot event or effect codes, like check 15. `KNOWN_SPOT_EVENTS` would sit beside `KNOWN_REASON_CHOICES`.
- Checks 9 and 10 gain the new copy codes and keys.
- Check 11's meaning changes (item 1).

**Frontend (props, not forks)**

- `EllaMapFace`: `lookingAtCoffeeId` and `startCoffeeId` beside `highlightCoffeeId`. `onTapCoffee` exists already.
- `MapPage`: the chip no longer calls `decideMove`.
- `MapTrail`: the new trail rows.
- `AdminEllaMapReasons`: the "What moves a spot" section.

### Item 1. Every reader of the position and the trail

| Reader | Uses | Under the new definition |
|---|---|---|
| `customerReads.getMatchCurrent`: called by `matchService.moves`, `decide` (hop, stay, step, liam from-coffee), `me`, `steps` | every column of `v_customer_match_current` | Coffee and placement columns as today. `decisionId`, `decidedVersionId`, `moveCode`, `source` and `actorUserId` become nullable (TS type change). New `spotEventCode` and `spotSince` |
| `matchService.steps` | `hasBag = moveCode !== 'quiz_result'`; `firstMatchDecision(trail)` for the Founder's pick and rule | `hasBag` = a real order. First match = basis founders_pick, rule read from `pos.decisionId`'s inputs (same `ruleForDecision`) |
| `matchService.me` | position, `getMatchTrail` (decisions), `getMatchTrailLines` | Trail = spot events. `firstBagReason` keys on basis founders_pick, not `moveCode` |
| `matchService.decide` | position as the from-coffee for stay, hop and step | Unchanged. `/map` stops calling it with step. The decision is still written, and no longer moves anything |
| `customerReads.searchCustomersForMap` (`has_position`) | EXISTS a row | Same result: a row exists iff there is a quiz-result decision. No orders or feedback anywhere today |
| `dataCatalogIntegrity` check 11 | `decided_version_id IS DISTINCT FROM active AND NOT is_in_active_version` | **Not as expected:** with `decided_version_id` NULL for an order or feedback spot, it counts every spot off the active map, whoever set it. Proposal: drop the version clause and reword the finding to "spot on a coffee not placed in the active version" |
| `getMatchTrail`, `getMatchDecisions`, `getMatchDecisionBySource` (decide's idempotency; the workbench Decisions card); `tmp`/seed scripts read `v_customer_match_trail` | decisions | Unchanged. `v_customer_match_trail` is not redefined |
| Views or functions depending on `v_customer_match_current` / `_trail` | | None, on production or test (`pg_depend`, `pg_proc`) |
| **dial_surface pieces** | | Every row says `lane` today, so all are dormant, and the brief leaves them as they are |
| — `quiz_result` (`MapQuizStart`, reads `/me`) | | After a retake that evidence overrides, the quiz page's dot shows the existing spot, not the new pick (CTO call 1). Surface is lane today |
| — `profile_trail` (`MapTrail`) | | Shows the new trail |
| — `reorder_email` (`cron.dialInMapButtons` → `moves`; `beats.ts` respond → `decide` hop) | | **Not as expected:** the email tap still writes a hop decision, and its response page says `moved_to` ("Your next coffee: {coffee}"), which is no longer true. Dormant (lane). Proposal: OT for the switch brief |
| — `liam_context`, `qr_door`, `axis_stats` | | No reader in code |
| **Liam** | | Reads no position view. `decide({ trigger: 'liam' })` is not wired anywhere (brief 4). No change |

### Item 4. `v_customer_feedback_current` and the rating limits

**Readers of its `sentiment`**

- Views: `v_palate_evidence`, `v_palate_dominant_dimensions`, `v_palate_archetype_spread`. Six more views depend on it without reading `sentiment`: `v_customer_calibration`, `v_evidence_coverage`, `v_evidence_descriptor`, `v_palate_recommendation_outcome`, `v_palate_shared_traits`, `v_palate_slot_candidates`.
- TypeScript (through `getFeedbackCurrent().sentiment`): `routes/sommelier.ts`, `liamProfile.ts`, `behavioralConfidence.ts`, `sommelierEval.ts`.

**Counts before and after:**

- Production: 0 = 0. Test: 0 = 0. `customer_feedback_event` is empty on both, so the data cannot prove the two definitions agree.
- The proof is structural instead. `rating` is CHECK 1..5 or NULL, and the old and new CASE give the same label for each of 1, 2, 3, 4, 5 and NULL (NULL is neutral in both).
- Part D will pin that enumeration, and Part E repeats the counts.

**Not as expected: three more copies of 4 and 2 (and 3) outside the view (G2.1).** I want your call on these.

1. `v_customer_timeline` (schema.sql line 6679) computes its own sentiment with literal 4 and 2. It cannot read the view, because it lists superseded revisions too.
2. `customerReads.getFeedbackCurrent` filters with `rating >= 4`, `rating <= 2` and `(rating IS NULL OR rating = 3)` in its SQL text.
3. `routes/orders.ts:137` computes sentiment in TypeScript (4 and 2) before writing `dial_position_signal`.

My recommendation: fix 1 and 2 in this brief, since they are the same numbers the spot relies on.
- The timeline reads the two parameters.
- `getFeedbackCurrent` filters on `vfc.sentiment = $n`.

Item 3 is a write path for the dormant dial loop, so it goes to OPEN_TASKS.

### Item 7. Copy rows (`dial_customer_copy`)

**Reused as they are:** founder_pick, map_title_first, map_title_after, price_add, add_first_bag, added_to_cart, lead_title, others_title, steps_title, no_support, more_about, trail_title, trail_start (the Founder's pick row on the trail and the start marker's label).

**Changed text: `closing_line`.**
- From "Nothing moves until you choose. Your dot moves when you pick a bag."
- To "Look around as much as you like. Your spot moves when you order a coffee again or tell us you liked it."
- The seed supersedes it through `setCustomerCopyInTx`, the one writer, and only while the text is still the old one.

**New rows** (checked in check 9 through `DIAL_COPY_CODES`):

- `spot_title` "Your spot".
  - `here_title` ("You are here") would then be unread and is kept (OT).
  - The other option is to edit `here_title`'s text instead.
- `looking_at_title` "Looking at".
- `back_to_spot` "Back to your spot: {coffee}".
- Trail words for feedback ("You said") and for a move ("Your spot moved"): on `dial_spot_event.trail_word` if you take that proposal, otherwise copy rows.

---

## What Dana needs to answer before Part A

1. **Item 2:** the list of new tables, views, readers and the writer. `setSpotEventInTx` goes in `dialPlacementService`, and `trail_word` sits on the event row.
2. **Item 3:** the fold in `v_customer_match_current` over `v_customer_spot_event`. Also F1 to F5, and "no Founder's pick means no spot".
3. **Item 4:** fix the timeline and `getFeedbackCurrent` copies of 4 and 2 here (recommended); `orders.ts` goes to OPEN_TASKS.
4. **Walk:**
   - W1: leave your own spot as a possible lead while looking elsewhere (recommended).
   - W2: the start-rule lead on the spot page only.
   - W3: which coffees `at` accepts.
5. **Item 1:** check 11 reworded; the email "moved_to" page goes to OPEN_TASKS.
6. **Item 7:** new `spot_title`, or edit `here_title`'s text.

**Noted for acceptance:** the test DB has no account under Dana's email, and no feedback. Acceptance builds its own fixtures through the existing doors (orders, then feedback), with the customer starting on Tiger Stripe, as the pinned cases need.

---

## Dana's answers (2026-11-27)

1. **Item 2:** yes to the full list. The writer is in `dialPlacementService`; `trail_word` is on the event row. Remove `getMatchTrailLines` once nothing calls it.
2. **Item 3:** yes to the fold in `v_customer_match_current` over `v_customer_spot_event`, and yes to F1 to F5. No Founder's pick means no spot.
3. **Item 4:** fix `v_customer_timeline` and `getFeedbackCurrent` in this brief; `orders.ts:137` goes to OPEN_TASKS.
4. **The walk:**
   - W1: no. While looking elsewhere, the customer's own spot is a normal card and never the lead; the lead goes to the next step by the same lead-source rows. This is a parameter (on), in the tests and in "What moves a spot".
   - W2: yes.
   - W3: yes.
5. **Item 1:** reword check 11; the email `moved_to` page goes to OPEN_TASKS for the switch brief.
6. **Item 7:** edit `here_title`'s text to "Your spot" through the one writer. No `spot_title`.

## Parts A to D, built on the test DB (2026-11-27). STOPPED before the push

G1.9: danab-0a confirmed it was idle, and stayed off the repo, the test DB and deploys for this run. Nothing is committed and nothing is pushed.

### What was built

**A. Schema** (`schema.sql`, block "ELLA'S BLOOM MAP 14" before the grants; the three views are in the Ella drop list near the top)

- **`dial_spot_effect`**: lookup, seeded.
- **`dial_spot_event`**: supersede-only, one current row per code, revoked from `ab_app` except `superseded_at`. Seeded in the schema (insert if missing), so a spot exists from the boot that creates it:

  | Code | Effect | Trail word |
  |---|---|---|
  | founders_pick | sets_spot | Founder's pick |
  | decision_other | nothing | (none) |
  | first_order | trail_only | Ordered |
  | reorder | moves_spot | Ordered again |
  | feedback_positive | moves_spot | You said |
  | feedback_neutral | trail_only | You said |
  | feedback_negative | trail_only | You said |

- **`v_dial_spot_event`**: the table's one read path.
- **`customer_order_kind.counts_toward_reorder`**: set once inside the guard that adds the column (manual and liam_followed true).
- **Parameters** (`evidence_parameter`):
  - `feedback_positive_min_rating` 4
  - `feedback_negative_max_rating` 2
  - `dial_spot_reorder_count` 2
  - `dial_spot_skip_disliked_lead` 1
  - `dial_spot_not_lead_when_looking` 1 (W1)
- **New copy rows:** `looking_at_title` "Looking at", `back_to_spot` "Back to your spot: {coffee}", `trail_moved` "Your spot moved here.".
- **`v_customer_feedback_current` and `v_customer_timeline`** read the two rating parameters through `param()`.
- **`v_customer_spot_event`** holds the events and the fold. `v_customer_match_current` is the fold's last row with a spot, plus `spot_event_code` and `spot_since`.
- **`comments.sql`** has every new object and the changed ones.
- **Seed** `backend/src/scripts/ellaMapSpot_2026_11_26.ts` (`--dry-run` by default, `--apply`, `--expect-db`) changes `here_title` and `closing_line` through `setCustomerCopyInTx`, only while each still has its old text, and reads back the rows, parameters and spots.

**B. Backend**

- `customerReads`:
  - `getMatchCurrent` has the new fields; its decision fields can be null.
  - New `getSpotTrail`.
  - `getFeedbackCurrent` takes `{ profileId }` too and filters on the view's `sentiment`.
  - `getMatchTrailLines` is removed (no caller left).
- `dialReads`: `spotEvents`, `spotEffects`, `spotEventConfig`.
- `dialPlacementService.setSpotEventInTx`.
- `matchService`:
  - `steps(…, { at })`: looking at a coffee checks it is placed on the active map, active and passes the tag filter, else 404 `NOT_ON_MAP`.
  - The compare line is the step line from the spot, else the coffee's `map_line`.
  - Lead rules: the disliked skip, the spot never the lead while looking, and the start-rule lead on the spot page only.
  - `hasBag` is a real order.
  - The response gains `spot`, `lookingAt`, `startCoffeeId`, and `events` for admins.
  - `me()` returns the trail through `trailOf`.
  - `KNOWN_SPOT_EVENTS` and `KNOWN_SPOT_EFFECTS` are exported.
- Routes: `GET /api/map/steps?at=`, and `GET`/`PUT /api/admin/map/spot-events`. The decide route is unchanged.
- Integrity:
  - New check 17 (codes known; limits set and apart).
  - Check 11 reworded ("spot(s) on a coffee not placed in the active version").
  - Checks 9 and 10 extended.

**C. Frontend**

- **`MapPage`:**
  - The chip only adds the bag.
  - A card's name and a dot look at the coffee (`?at=`); "Back to your spot" clears it.
  - While looking, the top card shows "Looking at", the compare line, the chip and the back link. The plain price pill is hidden there, so the price shows once.
- **`EllaMapFace`** (props only, no fork):
  - `lookingAtCoffeeId` gets a lighter dashed ring, and the arrows leave it.
  - `startCoffeeId` gets a small ring.
  - Quiet dots are tap targets when the page walks.
  - The admin face's markup is unchanged; its snapshot test passes.
- **`MapTrail`:** the path joins the coffees the spot sat on; `movedLine` shows where it moved.
- **`/admin/map` section 6, "What moves a spot":** an effect select and a switch per row, plus the two parameter cards (`dial_spot_`, `feedback_`). "Read it as" shows the spot, its basis, since when, and the events.

**D. Tests**

- **New `dialMap14.test.ts`** (31 tests, all pass):
  - The 14 pinned cases.
  - Test mode, F1, F2 and Liam-followed.
  - No quiz result means no spot.
  - A member's bag ordered by the admin counts for the member.
  - Switches and the reorder count.
  - The trail and `hasBag`.
  - Sentiment for ratings 1 to 5 and none, in both views, plus a moved limit.
  - Dana's three pages.
  - W1 at 1 and at 0.
  - The disliked lead at 1 and at 0.
  - Looking writes no row in any table (`pg_stat_xact_user_tables`).
  - A coffee off the map is refused.
  - Check 17, the seed's idempotence, and the writer.
- **New frontend `mapWalk.test.tsx`** (3 tests): the chip adds the bag and records nothing; the name and the dot look; Back; refresh at `?at=`.
- **Updated, because a step or Liam's pick no longer moves the spot:**
  - `dialMap7`: the page-reads test.
  - `dialMap9`: no quiz.
  - `dialMap10`: Dana's `hasBag`, and the top-card states (now through a reorder).
  - `dialMap12`: the step lines are read with `at`; timeout 900 s.
  - `matchService.test`: the decaf customer and position D4 (now through positive feedback).

### Evidence

**Backend tests (test DB):**

- `dialMap14` 31/31; `matchService` + `dialMap12` 15/15.
- The related run covered `dialMap`, `5`, `6`, `7`, `8`, `9`, `9Guard`, `10`, `12`, `13`, `customerIntegrity`, `householdOrder`, `liamProfile`, `comments.*` and `guard`.
- The only remaining failures are the known baseline (OT-190): `dialMap7`'s three start-rule tests (OT-169/176) and `dialMap9` "person 81" (brief 12's copy).
- `palateReads` timed out at 5 s in that batch. Alone with `--testTimeout=120000` it passes 86/86.

**Builds and lints:**

- Backend `tsc` clean. Frontend `tsc`: the 7 known errors, none in a touched file. Frontend vitest 22 files, 209/209.
- All six lints (`catalog`, `retention`, `customer`, `lineage`, `roastery-portal`, `cupping`) exit 0. `comments.format` and `comments.db` pass.

**Test DB:**

- The schema applies twice with no error.
- Spots: 32, all founders_pick. Before this brief, 5 customers had moved by step taps; their spots are back on their latest quiz result. 0 spots differ from the latest quiz coffee.
- The full fold over every customer takes 160 ms.

**Seed on the test DB:**

- The dry run planned 2 writes (`here_title`, `closing_line`) and 13 unchanged rows.
- `--apply` wrote 2 rows. A second `--apply` wrote 0.

**Local boot on the test DB:**

- `[data-catalog]` shows 2 of 17 checks with findings: #4 (CATALOG.md stale, expected until `catalog:md` after deploy) and #6 (dead-table candidates, as before).
- The new check 17 passes. No new ERROR. `customer-integrity` #31 is informational, from Usual Drink.

**Browser acceptance** (`backend/tmp/em14_ui.mjs`, `em14_ui_out.json`):

- Run as the marked Zzz test admin "dana" (Dana's answers, quiz result on Tiger Stripe, "same again"), against local Vite :5174 and the backend :4917 on the test DB.
- The admin was re-enabled for the run, then demoted and disabled again (`tmp/em14_admin_toggle.mts`).
- No page errors, none of the forbidden words, and **no `/api/map/decide` call**.

| Check | Result |
|---|---|
| Spot page | "Founder's pick · Tiger Stripe", ringed; lead Blossom, then Geometric and The Waverly, each "$29.00 · 12 oz · Add"; the new closing line |
| Blossom's name | `/map?at=2916`, "Looking at · Blossom", "A darker roast than Tiger Stripe, with a fuller body.", "Back to your spot: Tiger Stripe"; Tiger Stripe still ringed, Blossom with the lighter ring |
| W1 | Lead **Indonesia**; Tiger Stripe is a normal card ("… A lighter roast than Blossom, with more fruit.") |
| Refresh | Stays on `?at=2916` |
| One further (Brazil) | "The base on its own: chocolate, almond and honey."; lead Blossom "A little bitterness tastes serious to you. Darker than Brazil, with a fuller body.", then Fabricator |
| Back | Returns to Blossom |
| Top-card chip | Cart 0 → 1; the page is byte-for-byte the same; no page re-read |
| Step chip | Cart 1 → 2; same |
| "Back to your spot" | Founder's pick again |
| A quiet dot (Cafè Feminista) | `?at=2902`, "Looking at", its map_line |
| Phone (390) | The same spot and looking-at pages |
| Admin section 6 | 7 rows with effect and word, and both parameter cards. Reorder off, then on; feedback_neutral to "Nothing", then back to "Shows on the trail only"; "Saved. It applies on the next read of the page." |
| "Read it as" | "Spot: Tiger Stripe · set by founders_pick · since …", events founders_pick (moved the spot) and decision_other (no change) |

- **Screenshots** (in this folder): `map14_laptop_spot.png`, `map14_laptop_looking.png`, `map14_laptop_further.png`, `map14_laptop_dot.png`, `map14_phone_spot.png`, `map14_phone_looking.png`, `map14_admin_spot_events.png`, `map14_admin_read_it_as.png`.
- They were taken before one fix: the looking-at top card showed the price twice (the plain pill and the chip). The pill is now hidden while looking. The map tests pass after the fix; the screenshots still show both.

### Dana's three pages as built

These are the browser rows above. On the test fixture they match Task 0 item 6, except W1: while looking at Blossom, the lead is now Indonesia, not Tiger Stripe.

On production Dana's feeling is "happy"; the test admin's is "different". Her pages on production follow the same rows; I'll read them after deploy.

### Item 4 counts, for the Part E STOP

- Production before: 0 current feedback rows (`customer_feedback_event` is empty), so 0 = 0 for every sentiment.
- Test DB: also 0.
- The equality is pinned by the enumeration test (ratings 1 to 5 and none, both views).
- I'll repeat the counts on production after the push.

### Seed dry run on production

- Not possible before the push: `planSpot` reads `v_dial_spot_event`, which the push creates.
- Read-only today (Task 0): production's `here_title` is "You are here" and `closing_line` is "Nothing moves until you choose. Your dot moves when you pick a bag.". The dry run will plan exactly those 2 writes.
- The rows, parameters and three new copy rows come from the schema at boot.

### Deviations from the brief, and why

1. **The fold sits in `v_customer_spot_event`;** `v_customer_match_current` reads its last row.
   - Dana approved "the fold in `v_customer_match_current` over `v_customer_spot_event`".
   - The trail needs "when the spot moved" per event. With the fold only in `v_customer_match_current`, the trail would need a second copy of the rule in TypeScript.
   - Still two views and one fold; every reader of the position reads `v_customer_match_current`.
2. **The event rows, parameters and new copy rows are seeded in `schema.sql`,** not by the script. Otherwise `/map` would have no spot between the push and the seed. The script only changes the two existing texts.
3. **The trail's "moved" line is a new copy row `trail_moved`** ("Your spot moved here."). The event rows carry the event's own word.
4. **A step with no price has no chip** (there is nothing for it to do now). `choose_this` is unread (OT-195).
5. **Acceptance's "test orders and feedback entered through the existing doors":** the pinned cases are proven in vitest with fixture orders and feedback (live, paid; as the commerce tests insert them), not by checkouts in the browser.
6. **Test DB not refreshed from production:** production has no real orders or feedback; the test DB's 195 customers with orders are more useful.

### G2.4 / G3.9, as approved

- **Tables:** `dial_spot_effect`, `dial_spot_event` (`dial_reason_choice` considered: no effect column).
- **Views:** `v_dial_spot_event`; `v_customer_spot_event` (`v_customer_timeline` considered: quiz sessions not decisions, superseded revisions, per line, typed-in sentiment).
- **Changed:** `v_customer_match_current`, `v_customer_feedback_current`, `v_customer_timeline`.
- **Readers:** new `getSpotTrail`, `spotEvents`/`spotEffects`/`spotEventConfig`; extended `getMatchCurrent`, `getFeedbackCurrent`.
- **Writer:** new `setSpotEventInTx` in `dialPlacementService`, beside `setReasonChoiceInTx`.

### Open tasks added

- OT-191: the decide route's step move is no longer called from `/map`.
- OT-192: the email `moved_to` page.
- OT-193: `orders.ts:137`.
- OT-194: the fold's cost at scale.
- OT-195: copy rows and `activeStepWords` unread.

### Docs

`WHAT_WE_BUILT.md` #290, the `WHAT_WE_BUILT_DB.md` "As of" line, `REGRESSION.md`, `OPEN_TASKS.md`, and the README line for brief 14.

### On Dana's yes to push (Part E)

1. **Commit by path.** Not `commerce/CLOSING_REPORT_6.md`, not the genova fonts, not `misc/`. The screenshots are Dana's call.
2. **Push.** The deploy is green, and the startup log shows `[data-catalog]` with check 17 passing.
3. **Seed:** `--dry-run`, then `--apply`, on production. Read back the spots: Dana's should be Tiger Stripe, founders_pick.
4. **Repeat the item 4 counts.**
5. **Run `catalog:md` against prod** and commit CATALOG.md.
6. **Smoke `/map`** for Dana (API read-only; prod is behind the Cloudflare bot check for headless).

## Part E, on production (2026-11-27)

Dana said "Yes, push", and to include the eight screenshots.

1. G1.9: I messaged danab-0a before the push. It acknowledged and holds off until told it's done.
2. Commit 94db8c1, staged by path: 40 files, the eight `map14_*.png` included. Not included: `commerce/CLOSING_REPORT_6.md`, the genova fonts, `misc/`.
3. Push to main. Deploy run 46073612729 passed (backend and frontend), revision `axis-bloom-backend-00907-jk5`. Boot log:
   - `DB schema verified`
   - `[data-catalog] report only: 235 tables, 123 views, 2013 columns; 2 of 17 checks with findings`. The two are #4 (CATALOG.md stale, fixed by step 7) and #6 (26 dead-table candidates, already there before). Check 17 passes.
4. Seed `ellaMapSpot_2026_11_26.ts` on `axisandbloom`:
   - Dry run: 2 writes, here_title and closing_line. The 7 event rows, 5 parameters and 3 spots were already in place from the schema.
   - `--apply` wrote the 2 rows.
   - A second `--apply` wrote 0 (15 unchanged).
   - Copy now: here_title "Your spot"; closing_line "Look around as much as you like. Your spot moves when you order a coffee again or tell us you liked it."; looking_at_title "Looking at"; back_to_spot "Back to your spot: {coffee}"; trail_moved "Your spot moved here."
5. Spots read back from `v_customer_match_current`. Three customers, every spot set by `founders_pick` and placed in the active version:

   | customer | spot |
   |---|---|
   | Dana | **Tiger Stripe Espresso**, since 2026-11-12 |
   | 103cdf5f… | Benchmark |
   | b40e6c85… | Amsterdam |

   Spot events: 3 founders_pick (all set the spot) and 5 decision_other (none move it).
6. Item 4 counts repeated: production still has 0 feedback rows. The view, the parameter-limit recount and the timeline are all empty, the same as in Task 0. Nothing could change sentiment.
7. `npm run catalog:md -- --expect-db axisandbloom`: catalog-hash 29113b52…, which matches the live hash in the boot log. Committed.
8. Smoke:
   - Live API: `/api/map/steps` and `/api/map/steps?at=2916` answer 401 with no sign-in. The routes are up and the sign-in check holds.
   - Dana's pages through the deployed `steps()` code, read-only on production (`tmp/em14_smoke_prod.mts`):
     - On her spot: top card Tiger Stripe as founder_pick, back line "Back to your spot: Tiger Stripe". Steps: LEAD Blossom (Bolder), Geometric, The Waverly.
     - `at=2916` (Blossom): top card looking_at_title Blossom. Steps: LEAD Indonesia (Earthier), Tiger Stripe (Brighter, $32), Brazil. Her spot shows as a normal card and is not the lead (W1).
     - `at=2939` (Brazil): LEAD Blossom, Fabricator.
     - `at=999999`: 404 NOT_ON_MAP.
   - Not done: a signed-in browser check on the production site, because headless browsers can't get past the Cloudflare check.
