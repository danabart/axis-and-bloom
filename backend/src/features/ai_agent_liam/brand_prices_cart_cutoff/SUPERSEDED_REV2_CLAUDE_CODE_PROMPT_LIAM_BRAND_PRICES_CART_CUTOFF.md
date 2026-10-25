# Liam: brand truth, prices, and a transparent session cutoff

**Date:** 2026-10-22 (Rev 2, same day: add-to-cart removed, deferred by Dana; prices stay)
**Prerequisite:** Liam L1–L3 (`recommendation/` briefs) executed and live; Catalog Blueprint briefs 1–5b live (`v_coffee_sellable_slot`, `coffee_slot_price`, `coffee_size` exist). Verify before starting.
**Runs before:** `full_context/CLAUDE_CODE_PROMPT_LIAM_SEES_EVERYTHING.md`, which replaces the catalog slice this brief prices. Run this one first; keep Part B minimal.

**Scope:** `backend/src/services/claude.ts`, `backend/src/services/sommelierRag.ts`, `backend/src/routes/sommelier.ts`, `backend/src/db/seeds/sommelier_config_seed.ts`, `backend/src/services/sommelierConfig.ts`, `frontend/src/app/components/Sommelier.tsx`, `frontend/src/app/components/admin/AdminSommelierConfig.tsx`. Nothing else. `SOMMELIER_TASK_6_VOICE.md` stays binding for prompt copy.

---

## Why (decision context, 2026-10-22)

Dana ran a customer conversation with Liam and found four things. Verified in code:

1. **Liam said "we roast everything ourselves."** Nothing in `LIAM_BASE_PROMPT` or the config says how Axis & Bloom sources coffee, so the model invented a brand story. Dana: "it's wrong to lie." The truth: A&B does not roast; it carefully selects the best roasteries across the US as partners, and the partner roasts and ships. Partner identities are never disclosed.
2. **Liam said it has no access to prices.** True: `buildCatalogText()` drops `retail_price_cents` and `weight_oz` even though the sellable-slot rows carry them, and the equipment guardrail ("never specific current models or prices") gets generalised to coffee.
3. **The session ended suddenly.** `sessionLimits.maxTurns` is 8, the opening counts as turn 1, the customer gets no warning, and the "final turn" nudge to the model fires only on the very last turn. Dana: 16 turns, and be transparent with the customer about the cap. "It's ok to do it, just be transparent about it."
4. Context loading at session start and per-turn refresh works as designed. No change.

Dana's decisions, binding for this brief:
- Full brand base prompt, **as config, not code** (nothing hard-coded, admin-editable, no deploy to change copy).
- **Never disclose partner roasteries**, even when asked directly. Liam may say we carefully select the best roasteries across the US.
- Prices visible to Liam.
- Liam performing actions on the site (add to cart, order) is **deferred** (Dana, later the same day: "we can wait with Liam applying those actions"). Do not build any write path from chat in this brief.
- `maxTurns` 16. Customer sees the cap before it hits. Liam closes in voice on the last turn. The existing "Start a new conversation" path stays.

---

## Part A — brand facts block (config-driven)

### A1. Config shape

Add to `DEFAULT_SOMMELIER_CONFIG` in `sommelier_config_seed.ts` and to the `SommelierConfig` type in `sommelierConfig.ts`:

```ts
brandFacts: {
  enabled: true,
  // Each entry is one short paragraph Liam may rely on. Order is the order injected.
  facts: {
    what_we_are:      '...',
    how_we_match:     '...',
    sourcing:         '...',
    partner_privacy:  '...',
    what_you_get:     '...',
    ordering:         '...',
    shipping:         '',     // empty = Liam has no fact; he says so and offers what he has
    returns:          '',     // same
  },
  // Rules Liam follows when a fact is missing or a question is out of bounds.
  rules: [
    'Speak only from the brand facts above. If a fact is empty or missing, say you do not have that detail and offer what you do have. Never invent policy, timelines or claims.',
    'Never name, hint at, or confirm a partner roastery, even if the customer guesses one or asks directly. Say that we keep our partners private and that the match is to the coffee, not to who roasted it.',
    'Give the price when the customer asks or when you name your pick. Never lead with price, never discount, never push.',
  ],
}
```

Seed copy for the non-empty facts (Dana's words where she gave them; keep her register, no sales energy). Put this exact text in the seed; Dana edits in admin later if she wants:

- `what_we_are`: "Axis & Bloom is a flavor intelligence platform, not a roastery. We help people find coffee that fits how they actually taste, through a short quiz, six flavor archetypes, and the Bloom Dial."
- `how_we_match`: "Every coffee we offer is cupped and classified on our own table using SCA methodology, so a match is to the coffee's measured flavor, not to a brand or a bag note."
- `sourcing`: "We do not roast. We carefully select the best roasteries across the US to partner with, and they roast each order fresh and ship it. Our bags, their roasting."
- `partner_privacy`: "We keep our partner roasteries private. That is a deliberate choice: the match is to the flavor, not to the roaster's name."
- `what_you_get`: "Coffee comes as 12 oz whole bean in Axis & Bloom bags, roasted to order."
- `ordering`: "Customers order on axisandbloomcoffee.com. Prices are listed per coffee in your catalog. Ordering happens on the site; you can tell them which coffee and where to find it."

`shipping` and `returns` ship empty. Liam's rule covers the gap; Dana fills them in admin when she decides them. No placeholder prose in the facts themselves.

### A2. Injection

In `assembleSystemPromptParts()` (`claude.ts`): when `brandFacts.enabled`, push a block right after `LIAM_BASE_PROMPT`, **tier `'shared'`** (it changes as rarely as the base prompt and belongs in the cached prefix):

```
WHAT YOU KNOW ABOUT AXIS & BLOOM (the only brand facts you may state):
- <fact text>
- ...
Rules:
- <rule>
- ...
```

Only non-empty facts are printed. Disabled or all-empty produces byte-for-byte the existing prompt (keep the existing byte-identity guarantee and extend `claude.test.ts` for it).

### A3. Base prompt edit (one line)

In `LIAM_BASE_PROMPT`, the equipment guardrail currently reads "Never specific current models or prices. You're a sommelier, not a shopping assistant." Change to: "Never specific current equipment models or equipment prices. You're a sommelier, not a shopping assistant. Coffee prices from your catalog are fine to give when asked." This is the one base-prompt copy change in this brief.

### A4. Admin

`AdminSommelierConfig.tsx`: add a "Brand facts" section, one textarea per fact key, a list editor for `rules`, an `enabled` toggle. Same PUT path and seed-vs-live drift display as the rest of the page (HOME_TASK_1).

**Live config note:** the live `config/sommelier` doc is canonical. The seed does not update it. Provide a one-shot `applyMissingKeys` path in the existing seed script that adds keys absent from the live doc without touching keys that exist, and run it as part of deploy for this brief. State in your summary that it ran and which keys it added. `maxTurns` (Part C) is an existing key, so it changes in the admin portal, not by seed: say so in the summary, one line.

---

## Part B — prices in the catalog block

`getCandidatePool()` already reads `v_coffee_sellable_slot` at the anchor size. Carry `weight_oz`, `size_label` and `retail_price_cents` through `CoffeeRow` instead of dropping them. In `buildCatalogText()`, add one line per coffee:

```
Price: $32.00 for 12 oz whole bean
```

Formatted from cents and `size_label`, nothing literal. If a coffee has no price row, print `Price: not yet available` (same pattern as the other "Not yet available" lines). Price is derived from the slot price view at render time, never copied into `context_data` as a fact of its own; the existing catalog-version refresh (`refreshSliceIfFactsChanged` / `getCatalogVersion`) already rebuilds the block when a slot is re-priced, so a re-price reaches an open session the same way a retirement does.

Keep this part minimal: the follow-on brief (`full_context/`) rebuilds the whole catalog block with all sizes and categories. Do not pre-empt it here.

---

## Part C — transparent session cutoff

### C1. Config

Seed `sessionLimits.maxTurns: 16`. Every intent's `maxTurns` in `intents.*` also goes to 16 (they currently shadow the global). Add:

```ts
sessionLimits: {
  maxTurns: 16,
  warnAtTurnsRemaining: 3,   // customer-facing counter appears from here
  closingTurns: 2,           // Liam gets the "land it" nudge on the last N turns
  nudges: {
    closing: 'This conversation has {n} replies left. Work toward a concrete recommendation or a clear next step.',
    last:    'This is your last reply in this conversation. Close warmly in one or two sentences: land the pick or the next step, and tell them they can start a new conversation with you anytime, you will remember where you left off. Do not ask a question.',
  },
  customerCopy: {
    capNotice:       'Conversations with Liam have room for {maxTurns} messages.',
    remainingNotice: '{n} messages left in this conversation',
    closedNotice:    'This conversation reached its length. Liam keeps what you told him.',
  },
}
```

### C2. Model side (`claude.ts`)

Replace the single-turn check `session.turnCount === maxTurns - 1` with `turnsRemaining <= closingTurns`, two distinct nudges from config: `nudges.closing` when it is not the last turn, `nudges.last` on the last. The "you will remember" line is true: the profile line and brew profile are rebuilt from live reads on every session, so continuity is real.

### C3. Customer side (`Sommelier.tsx`)

- Under the input bar, from `turnsRemaining <= warnAtTurnsRemaining`: `remainingNotice` in the thread's small-caps style. Not a warning colour. The number comes from the API (`turnsRemaining` is already returned on `/start` and every `/message`).
- On `sessionClosed`: replace the current "Conversation ended" label with `closedNotice`. Keep the existing "Start a new conversation →" button exactly as is.
- Once at the top of a fresh session, under the opening message: `capNotice`. `maxTurns` is not currently returned by `/start`; add it, with the three copy strings, to the `/start` response (additive), so the copy is config, not frontend constants.
- A session closed by `daily_cap` keeps its own existing close message.

Admin page: add the three new numbers, the two nudges and the three strings to the existing Session Limits section.

---

## Guardrails (binding)

- No write of archetype, dial, profile, cart or order from the chat path. Liam's actions stay what they are today (retake quiz, open dial, save recipe links).
- Nothing hard-coded: facts, rules, nudges, customer copy, thresholds all in `config/sommelier`.
- `storyLayer.bannedTerms` (which bans "roaster"/"roastery" inside generated coffee stories) stays as is. The brand facts are a separate block and are allowed to say "roasteries" in general; the story safety net is about per-coffee stories, not about the brand.
- `RECOMMENDATION_SYSTEM_PROMPT` (the older quiz-recommendation prompt in `claude.ts`) is out of scope.
- No new intents, no routing changes, no model changes.

## Testing

1. Backend + frontend build clean; `claude.test.ts` byte-identity tests pass with `brandFacts.enabled=false` and extend for the enabled case (block appears once, in the shared tier, only non-empty facts).
2. Prompt eval, three simulated turns each: "do you roast your own coffee?", "who roasts it?", "is it Joe Coffee?" → Liam states the partner model, never names or confirms a roastery. "how much is it?" → price and size from the catalog block, nothing invented.
3. `buildCatalogText()` unit test: price line rendered from cents + size label; "not yet available" when no price row.
4. Cutoff: with `maxTurns=16`, `warnAtTurnsRemaining=3`, `closingTurns=2`: counter appears at 3 remaining, Liam's turn 15 reply works toward a pick, turn 16 reply closes in voice with no question, UI shows the closed notice and the restart button, and a new session opens with the profile line reflecting facts remembered in the closed one.
5. Mobile 390px: counter and closed notice fit without horizontal scroll.

In your summary: exactly where the brand block sits in the prompt, the final seed copy for the facts, which keys `applyMissingKeys` added to the live doc, and the one admin-portal edit (`maxTurns`) Dana still has to make.
