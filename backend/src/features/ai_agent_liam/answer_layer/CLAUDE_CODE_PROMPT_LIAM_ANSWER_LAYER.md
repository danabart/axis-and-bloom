# Liam answer layer: the gate in front of Sonnet

**Date:** 2026-10-24. Brief 3 of the Liam context series. Specified by "Liam Answer Layer Design" (Oct 23) as amended by the CTO review of 2026-10-24 ("Liam Answer Layer: CTO Review", decisions 1 to 8, all taken by Dana). Where this brief and the design doc differ, this brief wins.
**Prerequisite:** `brand_prices_cart_cutoff/…` (Rev 3) and `full_context/…` (Rev 2) executed and live. Verify: `sommelier_answer` has rows and is rendered into the shared prefix; `sommelier_turn` gets a row per reply with route `model`; `sommelierReads`, `sommelierAnswerService`, `sommelierTurnService`, `sommelierIntegrity` exist; `customerReads.getRecentOrders` and `getSubscriptionCurrent` exist; `lint:customer` covers both tables.
**Scope:** `backend/src/db/schema.sql`, `comments.sql`, seeds (two new), `backend/src/services/sommelierGate.ts` (new: matcher, confirmation, resolvers, phrasing), `sommelierGateRuleService.ts` (new), `sommelierTurnService.ts`, `sommelierReads.ts`, `sommelierIntegrity.ts`, `liamWriteBack.ts`, `routes/sommelier.ts`, `routes/cron.ts`, `routes/admin.ts`, `sommelierConfig.ts`, `sommelier_config_seed.ts`, `scripts/lint-customer.mjs`, `scripts/refresh-test-db.mjs`, admin System Health and one read-only admin card. Three new tables, each with its reason in Part A. No writes to customer data.

---

## What this builds, in one paragraph

Inside `POST /:sessionId/message`, after the guards and `routeTopic` and before `chatWithSommelier`, a keyword match against active `sommelier_gate_rule` rows picks a candidate; one Haiku call confirms the label and resolves which coffee the customer means; a resolver reads one row through the existing read doors; brand and deflection answers go out verbatim, catalog and customer rows become two Haiku sentences; anything unconfirmed, compound, ambiguous or inside the closing turns goes to Sonnet exactly as today. Every turn, gated or not, lands in the Firestore transcript and in one `sommelier_turn` row. A nightly job labels the Sonnet turns so the keywords' misses are a number on System Health. A kill switch in config sends everything to Sonnet with no deploy.

What this design rejects, so no session reopens it: tool use (Liam pulling facts on demand) doubles latency on the simplest questions; a semantic answer cache keyed on past questions is unsafe for personalised answers; an embedding matcher is Brief 4, triggered by the miss number, not by a date.

---

## Part A — data (CATALOG.md read; why nothing existing fits)

Rules were in `config/sommelier` in the design doc. Decided against on 2026-10-24: `config-apply` applies the code seed to the live doc, not admin edits (those go through `PATCH /sommelier/config`), so "tests inside config-apply" would mean rules edited in code; `config-drift` diffs seed against live, so every admin-edited rule would show as drift forever; and a rule points at an answer row in Postgres. Rules are mappings with history (Dana, 2026-10-16: mappings and stop lists belong in tables). `topics[].keywords` stay in config in this brief; moving them is a later decision, noted in `OPEN_TASKS.md`.

### A1. `sommelier_gate_rule`

```sql
CREATE TABLE IF NOT EXISTS sommelier_gate_rule (
  id                SERIAL PRIMARY KEY,
  key               TEXT NOT NULL,                                 -- do_you_roast, which_roastery, price, decaf, order_status, ...
  priority          INTEGER NOT NULL,                              -- lower wins when several rules match
  resolver_id       INTEGER NOT NULL REFERENCES lookup_value(id),  -- category sommelier_gate_resolver: answer | catalog_price | catalog_category | customer_subscription
  answer_key        TEXT,                                          -- for resolver answer: the sommelier_answer key said verbatim (integrity: a current row exists)
  topic_key         TEXT,                                          -- the config topic this rule belongs to (integrity: exists in topics)
  keywords          TEXT[] NOT NULL,                               -- lower-cased substrings, matched like topicRouter
  max_message_chars INTEGER,                                       -- NULL = gate.maxMessageChars from config
  since             TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at     TIMESTAMPTZ,
  note              TEXT,
  created_by        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sommelier_gate_rule_one_current ON sommelier_gate_rule (key) WHERE superseded_at IS NULL;
```

`answer_key`, not an FK to `sommelier_answer.id`: a supersede inserts a new answer row, and an id FK would need re-pointing on every edit. Integrity check 1 proves a current answer row exists for every active rule.

### A2. `sommelier_gate_rule_example`

```sql
CREATE TABLE IF NOT EXISTS sommelier_gate_rule_example (
  id             SERIAL PRIMARY KEY,
  rule_id        INTEGER NOT NULL REFERENCES sommelier_gate_rule(id),
  message        TEXT NOT NULL,
  expectation_id INTEGER NOT NULL REFERENCES lookup_value(id),     -- category sommelier_gate_expectation: must_match | must_not_match
  expected_label TEXT,                                             -- what the confirmation should return for this message (judgment for must_not_match)
  since          TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at  TIMESTAMPTZ,
  note           TEXT
);
```

Examples are the rule's tests and, in Brief 4, the matcher's training set. Supersede, never update.

### A3. `sommelier_turn_label`

```sql
CREATE TABLE IF NOT EXISTS sommelier_turn_label (
  id            SERIAL PRIMARY KEY,
  turn_id       INTEGER NOT NULL REFERENCES sommelier_turn(id),
  label         TEXT NOT NULL,          -- a gate label (a resolver name or an answer key) or judgment
  labeler_model TEXT NOT NULL,
  labeled_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`sommelier_turn` is insert-only, so the nightly label is its own row, not an UPDATE. A relabel after a model change is a new row; agreement between labeler versions falls out of the history.

### A4. `sommelier_gate_rule_replay`

The design doc's "model vs rules" drift number: the nightly job replays every active rule's examples through the real Haiku confirmation and records agreement. That is a fact at the grain (rule example, night), not a turn, so it does not fit `sommelier_turn_label`:

```sql
CREATE TABLE IF NOT EXISTS sommelier_gate_rule_replay (
  id            SERIAL PRIMARY KEY,
  example_id    INTEGER NOT NULL REFERENCES sommelier_gate_rule_example(id),
  label         TEXT NOT NULL,
  agreed        BOOLEAN NOT NULL,
  labeler_model TEXT NOT NULL,
  replayed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

All four: surrogate `id`; class (`master` for rule and example, `fact` for label and replay); Writer and Readers in `comments.sql`; `lookup_value` rows for the three categories in the lookup seed; `npm run catalog:md` at the end.

### A5. Doors

- `sommelierGateRuleService.setRuleInTx` / `retireRuleInTx` / `setExampleInTx`, cloned from `sommelierAnswerService`. **The rule tests run inside the write**: before commit, every current example of every active rule (including the one being written) is run through steps 2 and 3 of Part B with the confirmation stubbed to `expected_label`; one mismatch rejects the whole write and names the message. A rule whose `answer_key` has no current answer row, whose `resolver` is not in the code registry, or whose `topic_key` is not in config is refused.
- `sommelierTurnService` gains `recordLabel` and `recordReplay`, the only INSERTs into A3 and A4.
- `sommelierReads` gains `getActiveRules()` (cached like the answers, refreshed on version change), `getExamples(ruleId)`, `getRuleStats(days)` (hits and misses per rule from `sommelier_turn` + `sommelier_turn_label`), `getGateStats(hours)`.
- `lint-customer.mjs`: the four tables join the rules (SELECT only in `sommelierReads`; INSERT only in the named service; UPDATE only `superseded_at` on the two master tables; no UPDATE or DELETE on the two fact tables).

### A6. Seed rules (data rows, Dana edits later)

`db/seeds/sommelier_gate_rule_seed.ts`, runs only when the table is empty, `created_by = 'seed'`. Each rule with 3 to 5 must_match and 2 to 3 must_not_match examples (the must_not_match examples include a compound message: "how much is it, and would it suit me for espresso?" expects `judgment`). Write real keywords; they are the first version, not the last.

| key | priority | resolver | answer_key | topic_key | keywords (first version) |
| --- | --- | --- | --- | --- | --- |
| which_roastery | 10 | answer | partner_privacy | other | which roaster, which roastery, who roasts, roasted by, is it joe, is it path, is it utopian (and the roaster names from the `roaster` table at seed time, lower-cased) |
| do_you_roast | 20 | answer | sourcing | other | do you roast, roast it yourself, roast yourselves, your roastery |
| what_you_get | 30 | answer | what_you_get | other | whole bean or ground, is it ground, what size, how big is the bag, how many ounces |
| order_status | 40 | answer | order_status_unavailable | other | where is my order, where's my order, has it shipped, tracking, when will it arrive, delivery date |
| price | 50 | catalog_price | | matching | how much, price, cost, what does it cost, how much is |
| decaf | 60 | catalog_category | | caffeine_decaf | decaf, decaffeinated, half caf, half-caf, caffeine free |
| subscription_status | 70 | customer_subscription | | other | am i subscribed, my subscription, is my subscription active |

Also seed one new `sommelier_answer` row through `sommelierAnswerService` (kind deflection, delivery both, key `order_status_unavailable`): "I can't see shipping details from here. A person can check for you: {supportContact}." The `{supportContact}` placeholder is substituted from config at resolve time and at prefix render, the same way Brief 2 does it. When a writer for `fulfillment_status` exists, this rule's resolver changes to a customer resolver in its own brief.

`shipping` and `returns` get no rule: there is no answer row for them yet, and Sonnet already says so from the rules block. Add them to the "asks the gate does not answer" list in the closing report.

---

## Part B — routing, inside `POST /:sessionId/message`

Position: after the daily-cap check, the user message write and the open-question reply recording; after `routeTopic`; before the profile, story and current-coffee reads and before `chatWithSommelier`. The gate needs none of those reads, so a gated turn skips them. All code in `services/sommelierGate.ts`; the route calls `tryGate(...)` and either returns its reply or continues as today.

1. **Eligibility.** `gate.enabled` is true; `session.turn_count >= 1` (the opening turn is never gated); `turnsRemaining > sessionLimits.closingTurns` (the closing turns always go to Sonnet so the close-in-voice happens); the message is at or under the rule's `max_message_chars` or the config default; a sticky carry-forward from `routeTopic` never gates, only a keyword matched this turn.
2. **Candidate.** The lowest-`priority` active rule whose keywords match, matched exactly as `topicRouter` matches (`lower.includes(keyword)`). No match: continue to Sonnet; the ledger row says route `model`, `rule_id` NULL.
3. **Confirmation.** One Haiku call through `guardClaudeCall('liam_chat', gate.confirmModel, …)` with the config prompt `gate.confirmPrompt`: the message, the previous assistant turn, the session's candidate aliases (`ctx.storyCandidates` / `getAliases(ctx.coffeeIds)`), and the list of gate labels plus `judgment`. Output: JSON `{ label, alias | null, confidence }`, output cap `gate.confirmMaxTokens` (seed 40). The label must equal the candidate rule's resolver (or answer key) and `confidence >= gate.confirmThreshold`; anything else, a parse failure or a guard block → Sonnet. A compound message comes back `judgment` here.
4. **Coffee resolution** (catalog resolvers only). The alias Haiku returned, resolved with `liamWriteBack.resolveAlias` against the session's candidates; `null` → `customerReads.getLastRecommendation(sessionId)` (new, the only reader of `customer_liam_recommendation` outside the views); still nothing, or more than one match → Sonnet.
5. **Resolve.** `answer`: `sommelierReads.getAnswer(answer_key)`, reply is `answer_text` verbatim with `{firstName}` and `{supportContact}` substituted. `catalog_price`: every active size and price for the coffee from `catalogReads.getSellableSlots` / `getSlotPrices` / `getCoffeeRetailPrices` (the same lookups Brief 2's block uses); no price → Sonnet. `catalog_category`: the coffees in the asked category via `catalogReads.getCategoryCoffees`, aliases only. `customer_subscription`: `customerReads.getSubscriptionCurrent(uid)`; no row → Sonnet. No resolver selects a roaster column; the Brief 2 redaction test is extended to every resolver's output.
6. **Phrase** (data-row resolvers only). One Haiku call, `gate.phrasePrompt`, with the row, the last two turns and Liam's voice rules; at most two sentences, no recommendation, output cap `gate.phraseMaxTokens` (seed 120); the existing reply sanitizers applied. The reply is tagged `modelUsed = 'gate:haiku'`; verbatim answers `'gate'`.
7. **Record.** Append the assistant message to Firestore with that `modelUsed`; `sommelierTurnService.recordTurn` with route `gate` or `gate_haiku`, `rule_id`, `confirm_label`, `confirm_confidence`, `coffee_id`, `answer_id`, the Haiku tokens and cost (both calls summed), `answers_version`; `liamWriteBack.recordTurn({ …, route: 'gate' })`, a new parameter that **skips recommendation detection and question extraction** (a price sentence that names the Ethiopia is not a recommendation of it; today's `detectAliases` path would write a `customer_liam_recommendation` row and pollute `v_palate_evidence`); `turn_count + 1`, `last_active_at`, `context_data` (topic state and topicLog as today). The response shape is unchanged (`reply`, `messageId`, `actions: []`, `turnCount`, `turnsRemaining`, `modelUsed`).

Misroute cost is asymmetric: a judgment question answered thinly costs a customer; a simple question answered by Sonnet costs cents. Every tie goes to Sonnet.

**Config** (`gate.*`, seeded false and added to the live doc with `applyMissingKeys`; editable on the admin Sommelier config page): `enabled` (seed **false**; Dana flips it after the live smoke), `confirmModel` (seed `claude-haiku-4-5-20251001`), `confirmThreshold` (seed 0.8), `confirmMaxTokens`, `confirmPrompt`, `phraseModel`, `phraseMaxTokens`, `phrasePrompt`, `maxMessageChars` (seed 160), `offline.enabled`, `offline.model`, `offline.missShareThreshold` (seed 0.15: the share of Sonnet spend labelled as a fact kind at which Brief 4 is justified). Knobs and prompts live in config; content and mappings live in the tables.

---

## Part C — the nightly labeller

A cron route in `routes/cron.ts` (same secret and pattern as the beat crons), scheduled once a day:

1. Take yesterday's `sommelier_turn` rows with route `model` that have no label from today's `labeler_model`; for each, the customer message (from the transcript by `user_message_id`) and the previous assistant turn; one Haiku call per turn through `guardClaudeCall('liam_chat', gate.offline.model, …)` with the same label list as step 3; `recordLabel`. A label that is a gate label is a miss the keywords did not catch.
2. Replay every current example of every active rule through the real confirmation; `recordReplay` with `agreed = (label === expected_label)`.
3. Log one summary line `[liam:OFFLINE] turns=… labelled=… misses=… replay_agreement=…`.

Capped by the existing daily guards; at today's traffic this is a few dozen Haiku calls.

---

## Part D — integrity and System Health

`sommelierIntegrity` gains, read-only and report-only:

1. Every active rule with resolver `answer` names a key with exactly one current `sommelier_answer` row.
2. Every active rule names a resolver in the code registry and a `topic_key` that exists in config `topics`.
3. Every active rule's examples pass today (the same test the write door runs), so a prompt, topic or code change that breaks a rule shows up the next boot.
4. No active rule keyword appears in the keyword list of a config topic with `mode = 'expertise'` (two routers on one message; the gate must not swallow a knowledge question).
5. Every active rule with key `order_status` resolves to an answer while `lineage.json` names no writer for `order.fulfillment_status` other than checkout; the day a writer appears, this check reports that the rule should become a customer resolver.
6. Ledger vs transcript, per session, as Brief 2, now covering routes `gate` and `gate_haiku`: every gated ledger row's `assistant_message_id` exists with `modelUsed` starting with `gate`.

System Health, on the "Liam context" card from Brief 2: share of turns gated (24 h, 7 d); cost avoided (gated turns × the 7-day median cost of a `model` turn, minus the gated turns' own cost); misses (labelled Sonnet turns whose label is a gate label, 7 d) and miss share of Sonnet spend against `offline.missShareThreshold`; per rule, 7-day hits and misses, 30-day hits (zero = dead rule), replay agreement; `answers_version` lag (ledger rows behind the current version in the last hour) and prefix rebuilds today.

Admin: a read-only "Liam gate rules" card listing active rules, their examples, the per-rule numbers above, and the kill switch state. Editing rules in admin is a later brief; until then rules change through the seed or SQL through the service (the write door's tests still run from a script: `npm run gate:rules:apply`, which reads a JSON file and calls `setRuleInTx`).

---

## Guardrails (binding)

- `gate.enabled = false` sends every turn to Sonnet with no deploy; it ships false.
- Resolvers are reads only; no new write path to customer data. Brief 2's "nothing written back" holds.
- The closing turns and the opening turn are never gated. Gated turns count toward `maxTurns`; the customer sees nothing different.
- No model touches a brand answer: `answer` resolvers reply verbatim. Haiku only turns a catalog or subscription row into sentences, output-capped, sanitized.
- Roaster identity never reaches any resolver, any prompt, any reply: tested.
- Every tie, parse failure, guard block, ambiguity and compound message goes to Sonnet.
- One writer and one reader per table, declared and linted. Nothing updated in place except `superseded_at`; nothing deleted.
- Nothing hard-coded: rules, examples and answers in tables; resolver, expectation and route vocabularies in `lookup_value`; models, thresholds and prompts in config.

## Testing

1. Builds clean; the three lints green; byte-identity tests unchanged (the gate adds nothing to the prompt).
2. Rule tests: a vitest file that loads the seed rules into the test database (`refresh-test-db.mjs` gains the gate seeds) and runs every example through steps 2 and 3 with the confirmation stubbed; a deliberately wrong example in a fixture is rejected by `setRuleInTx` with its message named.
3. Route tests, Haiku mocked: "do you roast?" → verbatim `sourcing`, `modelUsed = 'gate'`, no Sonnet call, a `gate` ledger row, no `customer_liam_recommendation` row; "how much is the Ethiopia?" → a `gate_haiku` reply naming every size and price, no recommendation row written; "how much is it?" after a pick → resolved from the last recommendation; "how much is it, and would it suit me for espresso?" → Sonnet; a 15th turn with `closingTurns = 2` → Sonnet; `gate.enabled = false` → Sonnet; "is it Joe Coffee?" → verbatim `partner_privacy`.
4. Redaction: every resolver's output on a fixture with three roasteries contains no roaster name.
5. Integrity: fixtures for checks 1 to 5.
6. Nightly: a fixture day with four `model` turns produces four labels and the replay rows; a second run the same day writes nothing new.
7. Live smoke, gate still off: deploy, confirm the ledger and the card; then flip `gate.enabled` in admin, run the step-3 conversations against prod with an admin account, report each turn's route, `modelUsed` and cost from the ledger, and flip it back off unless Dana says otherwise.

In your summary: the seeded rules and examples as applied, the measured cost of a gated turn vs the 7-day median `model` turn, the list of asks the gate deliberately does not answer, which config keys `applyMissingKeys` added, the regenerated `CATALOG.md` entries for the four tables, and the `OPEN_TASKS.md` entries (topics keywords to tables; rule editing in admin; order-status resolver when a writer exists).
