# Liam: brand answers as data, prices, and a quiet session cutoff

**Date:** 2026-10-24 (Rev 3). Rev 2 of 2026-10-22 is kept beside this file with a `SUPERSEDED_` prefix. Rev 3 changes two things, both decided by Dana on 2026-10-24 in the CTO review of the answer-layer design: brand facts are rows in a Cloud SQL table, not a config block (Part A), and the customer never sees a turn counter, only one notice near the end (Part C). Everything else is Rev 2.
**Prerequisite:** Liam L1–L3 (`recommendation/` briefs) executed and live; Catalog Blueprint briefs 1–5b live (`v_coffee_sellable_slot`, `coffee_slot_price`, `coffee_size` exist); data catalog briefs 1–3 live (`comments.sql`, `lineage.json`, `npm run lint:lineage`). Verify before starting.
**Runs before:** `full_context/CLAUDE_CODE_PROMPT_LIAM_SEES_EVERYTHING.md` (Rev 2) and `answer_layer/CLAUDE_CODE_PROMPT_LIAM_ANSWER_LAYER.md`. Both read the table this brief creates.

**Scope:** `backend/src/db/schema.sql`, `backend/src/db/comments.sql`, `backend/src/db/seeds/` (one new seed), `backend/src/services/sommelierReads.ts` (new), `backend/src/services/sommelierAnswerService.ts` (new), `backend/src/services/sommelierIntegrity.ts` (new), `backend/src/services/claude.ts`, `backend/src/services/sommelierRag.ts`, `backend/src/routes/sommelier.ts`, `backend/src/routes/admin.ts`, `backend/scripts/lint-customer.mjs`, `backend/src/db/seeds/sommelier_config_seed.ts`, `backend/src/services/sommelierConfig.ts`, `frontend/src/app/components/Sommelier.tsx`, `frontend/src/app/components/admin/AdminSommelierConfig.tsx`, one new admin card. Nothing else. `SOMMELIER_TASK_6_VOICE.md` stays binding for prompt copy.

---

## Why (decision context)

2026-10-22, verified in code: Liam said "we roast everything ourselves" because nothing in the prompt says how A&B sources coffee; Liam said it has no access to prices because `buildCatalogText()` drops `retail_price_cents` and `weight_oz`; the session ended at 8 turns with no warning.

2026-10-24, CTO review of the answer-layer design (the review doc "Liam Answer Layer: CTO Review" has the reasoning):

- Brand truth is content, edited by Dana, with history, and read by two consumers: the cached prefix Sonnet reads, and (Brief 3) a gate that says it verbatim without a model. Content with history and integrity checks belongs in a table, not in `config/sommelier`. `config/sommelier` keeps knobs, prompts and the rules Liam follows.
- `CATALOG.md` was read: nothing holds customer-facing brand prose. `marketing_config` is URLs, `lookup_value` is dropdown vocabulary, `evidence_parameter` is numbers, `coffees.story` / `three_voice_story` are per coffee, Firestore `config/sommelier` is knobs. A new table is justified; say so in the `comments.sql` Purpose.
- Table name `sommelier_answer`: `sommelier_` is the domain prefix (`sommelier_sessions`, `sommelier_evaluation`, `sommelier_sms_feedback`); `liam_` is the retired table's prefix; "fact" is this catalog's class name for append-only event tables, so a hand-written answer is not a "fact".
- Supersede columns follow `evidence_parameter` (`since`, `superseded_at`, `note`), never `valid_from` / `superseded_by`. One supersede vocabulary in the database.
- Kinds and delivery values are `lookup_value` categories, not hard-coded enums.
- The customer sees no counter. One plain notice when the end is near; the closed notice; nothing at the top of a fresh session.

Dana's standing rules apply: nothing hard-coded; every table has a surrogate `id`; one writer per table, declared in `comments.sql` and enforced by `lint:lineage`; a view or read function is the only read path; nothing deleted; integrity checks report, never block.

---

## Part A — brand answers as rows

### A1. Table

In `schema.sql` (idempotent, owner role, beside the other sommelier tables):

```sql
CREATE TABLE IF NOT EXISTS sommelier_answer (
  id            SERIAL PRIMARY KEY,
  key           TEXT NOT NULL,                                   -- what_we_are, sourcing, partner_privacy, ...
  kind_id       INTEGER NOT NULL REFERENCES lookup_value(id),    -- category sommelier_answer_kind: brand | policy | deflection
  delivery_id   INTEGER NOT NULL REFERENCES lookup_value(id),    -- category sommelier_answer_delivery: prefix | lookup | both
  answer_text   TEXT NOT NULL,
  sort_order    INTEGER NOT NULL,                                -- render order in the prefix block; the block must be byte-stable
  since         TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,
  note          TEXT,
  created_by    TEXT NOT NULL                                    -- admin uid, or 'seed'
);
CREATE UNIQUE INDEX IF NOT EXISTS sommelier_answer_one_current ON sommelier_answer (key) WHERE superseded_at IS NULL;
```

`lookup_value` rows for the two categories go in the lookup seed the way the existing categories do. Class in `comments.sql`: `master`. Writer: `sommelierAnswerService.setAnswerInTx, sommelierAnswerService.retireAnswerInTx; seed`. Readers: `sommelierReads`. Column comments per the file's header format. End of brief: `npm run catalog:md -- --expect-db axisandbloom` and commit `CATALOG.md`.

### A2. Seed

One seed file (`db/seeds/sommelier_answer_seed.ts`), insert-only, runs only when the table is empty (same rule as `sommelier_config_seed.ts`). Dana's copy, verbatim; she edits in admin later. `created_by = 'seed'`, `sort_order` as listed:

| key | kind | delivery | answer_text |
| --- | --- | --- | --- |
| what_we_are | brand | prefix | Axis & Bloom is a flavor intelligence platform, not a roastery. We help people find coffee that fits how they actually taste, through a short quiz, six flavor archetypes, and the Bloom Dial. |
| how_we_match | brand | prefix | Every coffee we offer is cupped and classified on our own table using SCA methodology, so a match is to the coffee's measured flavor, not to a brand or a bag note. |
| sourcing | brand | both | We do not roast. We carefully select the best roasteries across the US to partner with, and they roast each order fresh and ship it. Our bags, their roasting. |
| partner_privacy | deflection | both | We keep our partner roasteries private. That is a deliberate choice: the match is to the flavor, not to the roaster's name. |
| what_you_get | brand | both | Coffee comes as 12 oz whole bean in Axis & Bloom bags, roasted to order. |
| ordering | brand | prefix | Customers order on axisandbloomcoffee.com. Prices are listed per coffee in your catalog. Ordering happens on the site; you can tell them which coffee and where to find it. |

No `shipping` and no `returns` row: a missing key means Liam has no fact, and the rule in A4 covers it. Never seed placeholder prose.

### A3. Doors

- `services/sommelierReads.ts` (new): `getCurrentAnswers()` → rows where `superseded_at IS NULL`, `ORDER BY sort_order, key`; `getAnswer(key)`; `getAnswersVersion()` → `MAX(id)`. The only file that SELECTs `sommelier_answer`. In-memory cache of the current rows, refreshed when `getAnswersVersion()` changes, checked at most once per `brandFacts.cacheSeconds` (config, seed 60), and cleared by the write door in the same process. Brief 2 adds the ledger readers to this file.
- `services/sommelierAnswerService.ts` (new): `setAnswerInTx(tx, { key, kind, delivery, answerText, sortOrder, note, createdBy })` cloned from `evidenceParameterService.setParameterInTx`: lock the current row `FOR UPDATE`, insert the new row, set `superseded_at = now()` on the old one. `retireAnswerInTx(tx, { key, note, createdBy })` sets `superseded_at` with no successor. `answer_text` is never updated in place. Validation in the service, not the route: non-empty text, known kind and delivery, and the three content rules from A6 (a write that violates one is refused with the rule named).
- `scripts/lint-customer.mjs`: add `sommelier_answer` to the rules so that a SELECT outside `sommelierReads.ts`, an INSERT outside `sommelierAnswerService.ts`, any UPDATE touching a column other than `superseded_at`, or any DELETE fails `lint:customer`. Declare the writers in `comments.sql` so `lint:lineage` passes.

### A4. Injection into the prefix

`chatWithSommelier` (async) loads `getCurrentAnswers()` and passes a rendered `brandAnswersBlock: string` into `SystemPromptParams`; `assembleSystemPromptParts` stays synchronous and pure. When `brandFacts.enabled` and the block is non-empty, push it right after `LIAM_BASE_PROMPT`, tier `'shared'`:

```
WHAT YOU KNOW ABOUT AXIS & BLOOM (the only brand facts you may state):
- <answer_text of each current row with delivery prefix or both, in sort_order>
Rules:
- <each brandFacts.rules entry>
```

`brandFacts.rules` stays in `config/sommelier` (they are instructions to the model, not customer-facing content). Seed, as Rev 2:

```ts
brandFacts: {
  enabled: true,
  cacheSeconds: 60,
  rules: [
    'Speak only from the brand facts above. If a fact is missing, say you do not have that detail and offer what you do have. Never invent policy, timelines or claims.',
    'Never name, hint at, or confirm a partner roastery, even if the customer guesses one or asks directly. Say that we keep our partners private and that the match is to the coffee, not to who roasted it.',
    'Give the price when the customer asks or when you name your pick. Never lead with price, never discount, never push.',
  ],
}
```

Disabled, or an empty table, produces byte-for-byte the existing prompt (keep the byte-identity guarantee; extend `claude.test.ts`: block appears once, shared tier, only prefix/both rows, in `sort_order`, identical across two renders of the same version).

The rendered block changes only when a row changes, so an answer edit rewarms the shared cache once for everyone. Acceptable for rare edits; never put a timestamp, a counter or the version number inside the block.

### A5. Base prompt edit (one line, as Rev 2)

In `LIAM_BASE_PROMPT`: "Never specific current models or prices. You're a sommelier, not a shopping assistant." becomes "Never specific current equipment models or equipment prices. You're a sommelier, not a shopping assistant. Coffee prices from your catalog are fine to give when asked."

### A6. Integrity (new `services/sommelierIntegrity.ts`, clone of `catalogIntegrity.ts`)

Read-only, non-fatal at boot, a System Health card, a vitest file. Checks in this brief (Brief 3 adds the gate's):

1. Exactly one current row per key (the partial unique index proves it; the check reports keys with zero current rows that config or a rule names, once Brief 3 exists).
2. No `answer_text` contains a roaster name, joined against `roaster` (the leak check).
3. No `answer_text` contains a price, a size or a count (`$`, `oz`, digits beside a unit): those live in views, and an answer that quotes one drifts from the catalog.
4. No `answer_text` contains a coffee alias (joined against the alias view `sommelierRag.getAliases` uses): aliases are catalog data and change.

The service refuses a write that fails 2, 3 or 4, so the checks mostly guard rows written by hand in SQL.

### A7. Admin

New card "Liam answers" (own component, own admin routes under `/api/admin/sommelier/answers`: `GET` current rows with history count, `PUT /:key` supersede, `POST` new key, `DELETE /:key` retire). Every write goes through `sommelierAnswerService` in one transaction with `created_by = req.uid` and the admin's note. Show: key, kind, delivery, text, since, who. Edit = new row; the old one stays, visible under "history". The `brandFacts.enabled` toggle and `rules` list editor stay on `AdminSommelierConfig.tsx` (same PUT path and seed-vs-live drift display as the rest of that page). Remove the Rev 2 per-fact textareas from that page; they never shipped.

**Live config note:** the live `config/sommelier` doc is canonical; the seed does not update it. Use the existing `applyMissingKeys` path (add it if Rev 2 never ran) to add `brandFacts.enabled`, `brandFacts.cacheSeconds`, `brandFacts.rules` and the Part C keys to the live doc without touching keys that exist; run it as part of deploy and state in the summary which keys it added. `maxTurns` is an existing key, so Dana changes it in the admin portal, not by seed: say so, one line.

---

## Part B — prices in the catalog block (unchanged from Rev 2)

`getCandidatePool()` already reads `v_coffee_sellable_slot` at the anchor size. Carry `weight_oz`, `size_label` and `retail_price_cents` through `CoffeeRow` instead of dropping them. In `buildCatalogText()`, add one line per coffee:

```
Price: $32.00 for 12 oz whole bean
```

Formatted from cents and `size_label`, nothing literal. No price row: `Price: not yet available`. Price is derived from the slot price view at render time, never copied into `context_data`; the existing catalog-version refresh (`refreshSliceIfFactsChanged` / `getCatalogVersion`) already rebuilds the block when a slot is re-priced.

Keep this part minimal: Brief 2 rebuilds the whole catalog block with all sizes and categories. Do not pre-empt it.

---

## Part C — quiet session cutoff

### C1. Config

Seed `sessionLimits.maxTurns: 16`; every intent's `maxTurns` in `intents.*` also goes to 16 (they shadow the global). Add:

```ts
sessionLimits: {
  maxTurns: 16,
  warnAtTurnsRemaining: 3,   // the one customer notice appears from here
  closingTurns: 2,           // Liam gets the "land it" nudge on the last N turns; Brief 3 never gates these
  nudges: {
    closing: 'This conversation has {n} replies left. Work toward a concrete recommendation or a clear next step.',
    last:    'This is your last reply in this conversation. Close warmly in one or two sentences: land the pick or the next step, and tell them they can start a new conversation with you anytime, you will remember where you left off. Do not ask a question.',
  },
  customerCopy: {
    limitNotice:  'This conversation is close to its limit.',
    closedNotice: 'This conversation reached its length. Liam keeps what you told him.',
  },
}
```

No `capNotice`, no `remainingNotice`, no number anywhere in customer copy (Dana, 2026-10-24: "I do not want the customer to see a counter").

### C2. Model side (`claude.ts`)

Replace the single-turn check `session.turnCount === maxTurns - 1` with `turnsRemaining <= closingTurns`, two distinct nudges from config: `nudges.closing` when it is not the last turn, `nudges.last` on the last. The "you will remember" line is true: the profile line and brew profile are rebuilt from live reads on every session.

### C3. Customer side (`Sommelier.tsx`)

- Under the input bar, once `turnsRemaining <= warnAtTurnsRemaining`: `limitNotice`, small-caps style, not a warning colour, no number. It stays until the session closes.
- On `sessionClosed`: replace the current "Conversation ended" label with `closedNotice`. Keep "Start a new conversation →" exactly as is.
- Nothing at the top of a fresh session. No `turnCount / maxTurns`, no "N remaining" anywhere (the access-and-cost brief removed those on 2026-10-01; do not bring them back). `turnsRemaining` keeps coming from the API; the client uses it only for the threshold.
- The two copy strings come from the API (`/start` response, additive), so the copy is config, not a frontend constant.
- A session closed by `daily_cap` keeps its own existing close message.

Admin page: the three numbers, the two nudges and the two strings in the existing Session Limits section.

---

## Guardrails (binding)

- No write of archetype, dial, profile, cart or order from the chat path. Liam's actions stay what they are today.
- Nothing hard-coded: answers in the table, kinds and deliveries in `lookup_value`, rules, nudges, copy and thresholds in `config/sommelier`.
- `sommelier_answer` has one writer (`sommelierAnswerService`), one reader (`sommelierReads`), supersede only; declared in `comments.sql`; `lint:lineage` and `lint:customer` enforce it.
- `storyLayer.bannedTerms` stays as is; the answers block may say "roasteries" in general.
- `RECOMMENDATION_SYSTEM_PROMPT` is out of scope. No new intents, no routing changes, no model changes.
- Nothing deleted: the Rev 2 brief is renamed, not removed.

## Testing

1. Backend + frontend build clean; `lint:customer`, `lint:lineage`, `lint:catalog` green; `claude.test.ts` byte-identity tests pass with `brandFacts.enabled=false` and with an empty table, and extend for the enabled case.
2. `sommelierAnswerService` tests: supersede keeps the old row with `superseded_at`; a second current row for a key is impossible; a text with a roaster name, a `$` amount or a coffee alias is refused with the rule named; retire leaves no current row.
3. `sommelierIntegrity` tests on fixtures for each check.
4. Prompt eval, three simulated turns each: "do you roast your own coffee?", "who roasts it?", "is it Joe Coffee?" → Liam states the partner model, never names or confirms a roastery. "how much is it?" → price and size from the catalog block, nothing invented.
5. `buildCatalogText()` unit test: price line rendered from cents + size label; "not yet available" when no price row.
6. Cutoff: with `maxTurns=16`, `warnAtTurnsRemaining=3`, `closingTurns=2`: the notice appears at 3 remaining with no number, Liam's turn 15 reply works toward a pick, turn 16 closes in voice with no question, the closed notice and the restart button show, and a new session opens with the profile line reflecting facts remembered in the closed one.
7. Mobile 390px: notice and closed notice fit without horizontal scroll.

In your summary: where the answers block sits in the prompt, the seeded rows, which keys `applyMissingKeys` added, the one admin-portal edit (`maxTurns`) Dana still has to make, and the regenerated `CATALOG.md` entry for `sommelier_answer`.
