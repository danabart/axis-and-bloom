# Closing report: Liam answer layer (the gate in front of Sonnet)

**2026-10-25. Done on prod, shipped off (`gate.enabled` = false; Dana flips it on the Sommelier config page, "Liam Gate").** Brief commit `9eb14bb`, fix `ff1c4e9` (found by the live smoke), docs and `CATALOG.md` in the closing commit. Deploys green: `40192516304` (rev `00785-ts9`), `40193776172` (rev `00786-8t9`). Full record: `WHAT_WE_BUILT.md` #238, `SOMMELIER_BUILT.md` S118, `WHAT_WE_BUILT_DB.md`, `OPEN_TASKS.md` OT-42 to OT-46.

## Prerequisites (checked before any code)
| Check | Result |
| --- | --- |
| Brief 1 Rev 3 live: `sommelier_answer` has rows, rendered into the shared prefix | yes: 6 current rows (ids 1–6); `renderBrandAnswersBlock` in the shared tier |
| Brief 2 Rev 2 live: `sommelier_turn` gets a row per reply, route `model` | yes: 45 rows, all `model`; sessions 50–59 have rows = `turn_count` in every one |
| `sommelierReads`, `sommelierAnswerService`, `sommelierTurnService`, `sommelierIntegrity` | all exist |
| `customerReads.getRecentOrders`, `getSubscriptionCurrent` | both exist |
| `lint:customer` covers both tables | yes, rules 8 and 9 |

**Where the session's candidate aliases live now.** Brief 2 made the catalog block shared, but `context_data` still carries both `storyCandidates` (`{coffeeId, alias, story}`) and `coffeeIds`; since Brief 2 they hold the **whole catalog** (9 coffees in session 59), set at `/start` and kept current by `refreshCatalogSnapshotIfStale`. Step 4 (`sommelierGate.candidateAliases`) resolves Haiku's alias against `ctx.storyCandidates` with `liamWriteBack.resolveAlias` (an alias two coffees share counts as ambiguous), falling back to `getAliases(ctx.coffeeIds)` for a session older than Brief 2; `null` → `customerReads.getLastRecommendation(sessionId)`.

## Seeded rules and examples, as applied on prod
Boot of rev `00785-ts9`: `[sommelier-gate] seeded 7 rule(s), 46 example(s), answer order_status_unavailable`, all through `sommelierGateRuleService.setRuleInTx` (the rule tests ran on the seed). The new answer row: `order_status_unavailable` (deflection, both): "I can't see shipping details from here. A person can check for you: {supportContact}."

| Priority | Key | Resolver | Answer key | Topic | Keywords |
| --- | --- | --- | --- | --- | --- |
| 10 | `which_roastery` | answer | `partner_privacy` | other | which roaster, which roastery, who roasts, roasted by, is it joe, is it path, is it utopian, joe bean roasters, joe coffee company, path coffee roasters, temecula coffee roasters, utopian |
| 20 | `do_you_roast` | answer | `sourcing` | other | do you roast, roast it yourself, roast yourselves, your roastery |
| 30 | `what_you_get` | answer | `what_you_get` | other | whole bean or ground, is it ground, what size, how big is the bag, how many ounces |
| 40 | `order_status` | answer | `order_status_unavailable` | other | where is my order, where's my order, has it shipped, tracking, when will it arrive, delivery date |
| 50 | `price` | catalog_price | — | matching | how much, price, cost, what does it cost, how much is |
| 60 | `decaf` | catalog_category | — | caffeine_decaf | any decaf, decaf options, which decaf, do you have decaf, decaf coffees, half caf, half-caf, caffeine free |
| 70 | `subscription_status` | customer_subscription | — | other | am i subscribed, my subscription, is my subscription active |

Examples (46), as applied:

- **which_roastery**: answers "Which roaster is it from?", "Is it Joe Coffee?", "Is this roasted by Path?", "Who roasts the Coado?", "is it utopian?"; leaves to Sonnet "Which roastery style suits a French press best?", "Which roaster would you pick for espresso, and why?".
- **do_you_roast**: answers "Do you roast the coffee?", "Do you roast it yourself?", "Do you guys roast yourselves?", "Where is your roastery?"; leaves to Sonnet "Do you roast darker for espresso, and would that suit me?", "Do you roast anything that tastes like blueberries?".
- **what_you_get**: answers "Is it whole bean or ground?", "Is it ground already?", "What size are the bags?", "How big is the bag?", "How many ounces in a bag?"; leaves to Sonnet "What size grind should I use for a V60?", "Is it ground fine enough for espresso, or should I grind it myself?".
- **order_status**: answers "Where is my order?", "Has it shipped yet?", "Do you have a tracking number for me?", "When will it arrive?", "What's my delivery date?"; leaves to Sonnet "When will it arrive, and should I rest it before brewing?", "Where's my order? Also, which coffee should I try next?".
- **price**: answers "How much is the Coado?", "How much is it?", "What's the price of Clean Fruit?", "What does it cost?"; leaves to Sonnet "how much is it, and would it suit me for espresso?", "How much coffee should I use per cup?", "Tell me about the Costa Rica".
- **decaf**: answers "Do you have any decaf?", "What are my decaf options?", "Which decaf coffees do you sell?", "Do you have half caf?"; leaves to Sonnet "Is decaf safe during pregnancy? Do you have any decaf?", "Which decaf would you recommend for me?", "How much is the decaf?" (expects catalog_price).
- **subscription_status**: answers "Am I subscribed?", "Is my subscription active?", "What's the status of my subscription?"; leaves to Sonnet "Can I pause my subscription and switch coffees?", "Which coffee should go in my subscription next?".

Deviation from the brief's table: the decaf rule uses phrases, because `decaf` and `decaffeinated` are keywords of the live `caffeine_decaf` expertise topic and the brief's own integrity check (no rule keyword equal to an expertise topic keyword, here check 9) would fail on the seed. `which_roastery` got the five roaster names from the `roaster` table at seed time (the "Zzz" test roastery skipped).

## Cost: a gated turn against the 7-day median model turn
Measured from the ledger on prod (marked test admin, gate on for sessions 61–63 only):

| Route | Turns | Median cost | Mean | Latency |
| --- | --- | --- | --- | --- |
| `gate` (verbatim answer, one Haiku confirmation) | 14 | **$0.000652** | $0.000663 | ~0.6 s |
| `gate_haiku` (confirmation + phrasing) | 6 | **$0.000952** | $0.000957 | ~1.2 s |
| `model`, 7-day median before the smoke | 45 | **$0.003318** | | ~2.1 s |

A gated turn costs 80% (verbatim) / 71% (phrased) less than the median Sonnet turn. A Sonnet turn whose candidate the confirmation turned down also pays the confirmation (~$0.0006; included in its `usd_micros`), so misroutes the keywords catch but Haiku rejects cost a little more than before.

## Asks the gate deliberately does not answer
- **Shipping and returns:** no rule, no answer row (Sonnet already says so from the rules block).
- **Order status beyond the deflection:** nothing writes `fulfillment_status` (OT-39), so `order_status` says "a person can check" verbatim; a customer resolver waits for a writer (OT-44, integrity check 10 watches `lineage.json`).
- **Anything compound, a judgment, a recommendation, an opinion:** the confirmation returns `judgment`.
- **The opening reply and the last `closingTurns` (2) replies:** always Sonnet, so the close-in-voice happens.
- **A coffee it cannot pin down:** no alias, no single last recommendation, an ambiguous alias → Sonnet ("how much is the Ethiopia?" on prod: no Ethiopia in the catalog).
- **Subscription status without a subscription row**, and **half-caf / "caffeine free"** while no catalog coffee carries that category (OT-46): confirmed, then Sonnet.

## Keys `applyMissingKeys` added on prod
- **Rev `00785-ts9`, 16 keys:** `gate.enabled` (false), `gate.confirmModel`, `gate.confirmThreshold`, `gate.confirmMaxTokens`, `gate.confirmPrompt`, `gate.resolverDescriptions.catalog_price`, `gate.resolverDescriptions.catalog_category`, `gate.resolverDescriptions.customer_subscription`, `gate.phraseModel`, `gate.phraseMaxTokens`, `gate.phrasePrompt`, `gate.maxMessageChars`, `gate.prefixRebuildMinTokens`, `gate.offline.enabled`, `gate.offline.model`, `gate.offline.missShareThreshold`.
- **Rev `00786-8t9`, 2 keys:** `gate.answerDescriptions.default`, `gate.answerDescriptions.deflection`.

## `CATALOG.md` entries (regenerated from prod)
`npm run catalog:md -- --expect-db axisandbloom`: 130 tables, 74 views, 1,195 columns, catalog-hash `413a6526…`.
- **`sommelier_gate_rule`** (master). Purpose: the gate's rules, one current row per key (keywords, resolver, priority); not in `config/sommelier` because config-apply and config-drift work on the code seed and a rule points at a `sommelier_answer` row; no existing table maps messages to reads. Writer: `sommelierGateRuleService.setRuleInTx`, `.retireRuleInTx`. Readers: `sommelierReads` (`getActiveRules`, `getGateRulesVersion`, `hasAnyGateRule`, `getExamples`, `getRuleStats`, `getGateStats`); `sommelierIntegrity` checks 6–10.
- **`sommelier_gate_rule_example`** (master). Purpose: the rules' tests and the future matcher's training set; every rule or example write runs them all. Writer: `setRuleInTx`, `setExampleInTx`, `retireRuleInTx`. Readers: `sommelierReads` (`getExamples`, `getRuleStats`).
- **`sommelier_turn_label`** (fact). Purpose: the nightly labeller's verdict on a model turn (a gate label = a miss); its own table because `sommelier_turn` is insert-only. Writer: `sommelierTurnService.recordLabel`. Readers: `sommelierReads` (`getRuleStats`, `getGateStats`, `getUnlabelledModelTurns`).
- **`sommelier_gate_rule_replay`** (fact). Purpose: one row per example per night, whether Haiku still agrees with the expected label; a different grain from a turn label. Writer: `sommelierTurnService.recordReplay`. Readers: `sommelierReads` (`getRuleStats`, `getReplayedExampleIds`).

Every column of the four is commented; `sommelier_turn`'s gate columns, `route`, `model`, `usd_micros` and `input_tokens` comments were updated for what the gate writes.

## `OPEN_TASKS.md` entries
- **OT-42** move `topics[].keywords` from config to tables (the brief's "later decision").
- **OT-43** gate rule editing in admin (until then: seed or `npm run gate:rules:apply`).
- **OT-44** the `order_status` rule becomes a customer resolver once something writes `fulfillment_status`.
- **OT-45** (found) the first nightly replay labels the compound "When will it arrive, and should I rest it before brewing?" as order status: with the gate on, it would get the deflection verbatim. Worth watching before turning the gate on.
- **OT-46** (found) half-caf and "caffeine free" asks are confirmed and then fall through to Sonnet.

## Testing (the brief's list)
| # | Result |
| --- | --- |
| 1 | Backend `tsc` and build, frontend build, all six lints (`catalog`, `retention`, `customer` with new rule 10, `roastery-portal`, `cupping`, `lineage`) and both `npm audit` green. Byte-identity tests unchanged. The prefix gains one line: the new `order_status_unavailable` answer is delivery `both`, so it is also a brand fact (one shared-cache rewarm on deploy, seen as session 60's opening write) |
| 2 | `sommelierGate.test.ts`: the seed loads into the test database and every one of the 46 examples passes steps 2–3 with the confirmation stubbed; a must_match example a higher-priority rule catches is refused by `setRuleInTx` naming its message ("Do you roast the coffee?" … rule `do_you_roast` matches it first); unknown answer key, resolver and topic refused; an edit carries the examples over, a retire leaves the rest passing. `refresh-test-db.mjs` runs the gate seed after an import |
| 3 | Haiku stubbed: "do you roast?" → `sourcing` verbatim, `modelUsed` `gate`, one Haiku call, one `gate` ledger row, no `customer_liam_recommendation` row; "how much is the Ethiopia?" (fixture coffee) → `gate_haiku`, the phrasing prompt carries every size and price, no recommendation row; "how much is it?" after a recorded pick → that coffee; the compound → Sonnet (`judgment`, rule and cost on the row); a closing turn, the opening, `gate.enabled = false`, low confidence and unparsed output → Sonnet with no or one Haiku call; "is it Joe Coffee?" → `partner_privacy` verbatim; "Where is my order?" → the deflection with the support contact |
| 4 | Three roasteries, one coffee named after its roaster: no resolver output (8) names a roaster; a phrased reply naming one is refused (Sonnet) |
| 5 | Checks 6–10 each fail on their fixture and pass on a clean one; the seed rules pass check 9 against the seed topics; check 5 fails a gated row whose reply is not tagged `gate` |
| 6 | Four `model` turns → four labels (two misses), one replay per example; a second run the same day writes nothing |
| 7 | Below |

Full backend suite: 966 passed, 9 failed, none from this brief: 6 `quizScoring` (OT-19), `schema.catalog_blueprint` `suggested_slot_id` (fails the same way on a clean checkout of `0617b55`), `coffees.test` hops (passes on rerun). One of my own broke and was fixed before the commit (`sommelierAnswer.test.ts` expected checks 1–5 only).

## Testing 7: live, on prod
**Gate off** (as shipped): deploy, the card and System Health answered (7 rules, 46 examples, gate off, labeller on; "Liam context" shows the gate block). Session 60: "do you roast?" and "How much is the Clean Fruit?" → `model`, `rule_id` NULL.

**Gate on** (`gate.enabled` true through the same dot-path write + audit as the admin page, uid `claude-session`; marked test admin `zzz-test-admin-liamgate-…@example.test`):

| Session / turn | Message | Route | modelUsed | Rule → label (conf.) | Cost |
| --- | --- | --- | --- | --- | --- |
| 61 / 1 | do you roast? | gate | gate | do_you_roast → sourcing (1.0) | $0.000627 |
| 61 / 2 | is it Joe Coffee? | **model** | sonnet | which_roastery → judgment (0.95) | $0.003369 |
| 61 / 3 | Where is my order? | gate | gate | order_status → order_status_unavailable (0.95) | $0.000656 |
| 61 / 4 | How much is the Clean Fruit? | gate_haiku | gate:haiku | price → catalog_price (0.99), coffee 2902 | $0.000951 |
| 61 / 5 | how much is the Ethiopia? | model | sonnet | price → catalog_price (0.85), no coffee | $0.003665 |
| 61 / 6 | Something chocolatey. Just pick one for me. | model | sonnet | — (Coado picked) | $0.003445 |
| 61 / 7 | How much is it? | gate_haiku | gate:haiku | price → catalog_price (0.95), coffee 2914 (the pick) | $0.000942 |
| 61 / 8 | how much is it, and would it suit me for espresso? | model | sonnet | price → judgment (0.95) | $0.004325 |
| 61 / 9 | Do you have any decaf? | gate_haiku | gate:haiku | decaf → catalog_category (0.95) | $0.000967 |
| 61 / 10 | Am I subscribed? | model | sonnet | subscription_status → customer_subscription (0.95), no row | $0.004593 |
| 62 / 1–13 | 13 gated-type asks (roast, whole bean, sizes, shipped, roastery, two prices, decaf, half caf, bag size, ground, arrive) | 9 gate, 3 gate_haiku, 1 model ("Do you have half caf?": no half-caf coffee) | | | $0.00063–0.00098 gated |
| 62 / 14, 15 | do you roast? / Where is my order? (the two closing turns, `closingTurns` 2) | model | sonnet | — (never a candidate) | $0.004151 / $0.004520 |
| 63 / 1–3 | is it Joe Coffee? / is it utopian? / Which roaster is it from? (after `ff1c4e9`) | gate | gate | which_roastery → partner_privacy (0.95) | $0.000710–0.000719 |
| 63 / 4 | Which roaster would you pick for espresso, and why? | model | sonnet | which_roastery → judgment (0.95) | $0.004073 |

**One miss, fixed.** 61/2: the confirmation introduced every answer label as "the customer asks something this reply fully answers", and Haiku (which never sees a roaster name, by the guardrail) read a guess at a roaster as not answered by the privacy deflection. `ff1c4e9` takes the intro from config `gate.answerDescriptions[kind]`; the deflection wording counts a guessed name that is not a listed coffee as asking. Probed against Haiku with the live rules before deploying (5 roaster asks confirm, both compounds stay `judgment`, order status unchanged); session 63 confirms it live.

**The nightly job:** Cloud Scheduler `liam-gate-offline` (daily 08:00 UTC, `CRON_SECRET` header sha-matched to Secret Manager) run once by hand: HTTP 200 in 27 s, `[liam:OFFLINE] turns=0 labelled=0 misses=0 replay_agreement=43/46` (no model turns yesterday: the ledger started today). The three disagreements are in OT-45.

**Gate flipped back off** after session 63 (audited). Integrity at boot of `00786-8t9`: checks 5–10 pass over sessions 60–62 (the gated rows' replies are tagged `gate`).

## Cleanup
The marked test admin is demoted to customer and disabled in Firebase Auth. Sessions 60–63, their ledger rows, one recommendation fact (Coado, session 61) and the 46 replay rows stay as test data, as in earlier smokes. No order, subscription or real customer touched; nothing written to customer data by the gate. The TTL comparison was not run.

## Process note
Verifying the pre-existing test failures on a clean checkout, `git worktree remove --force` followed a `node_modules` junction and emptied `backend/node_modules` in the main checkout; restored at once with `npm ci` from the lockfile (378 packages), and every check above was rerun after.
