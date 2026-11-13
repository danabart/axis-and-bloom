# Claude Code brief — Usual Drink 1: Capture the daily cups, the kitchen and how they feel about it (no matching change) — Rev 4

Workstream: usual_drink (`REVIEW_SPEC.md` here; Rev 3 is kept as `SUPERSEDED_..._REV3.md`, never run; Rev 1 as `SUPERSEDED_..._REV1.md`) · Written 2026-11-12 by the CTO session, after Ella's Bloom Map brief 3 shipped (`backend/src/features/ella_bloom_map/CLOSING_REPORT_3.md`) · Model: Sonnet · Dana runs it; push = deploy · **Test mode.** No money, no email. Capture only: nothing in matching, the map, the dial, Liam's recommendation or the profile line changes.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (field definitions, values, pickers, prompts, the feeling-to-move mapping and the funnel event names all become rows; cache TTL from config) · G2.2 surrogate id PK, natural keys UNIQUE · G2.3 prefixes `brew_` (operational brew-preparation and kitchen reference data), `customer_` (insert-only facts), `quiz_` · G2.4 CATALOG.md checked (why nothing fits: brew-profile fields live in Firestore config, CHECK constraints and a TS union, and no table decomposes a drink, a brand or a feeling; `lookup_value` rejected per D10; `dial_move` is reused as the FK target for the feeling) · G2.5 one writer (`customerFacts.record.brewProfileChange` for every fact row; boot seed for every `brew_*` lookup, no app writer), reads via `v_brew_profile_field_current` (one reader, `getBrewProfileFieldsConfig()`) and `customerReads` · G2.7 vocabularies are lookup tables · G2.8 idempotent schema, seeds insert if missing · G2.10 raw data never deleted, A3d backups · G2.11 lookup rows retired, never deleted · G2.12 facts insert-only, a declined question is a fact · G2.17 comments.sql → catalog:md · G2.19 proxy until self-service (no card after a proxy quiz) · G3.1 routes call services · G3.3 idempotent on (source, source_id) · G3.6 ownership on the card route · G3.9 reuse (the brew-profile rails, `logQuizFunnelEvent`, `resolveRemember`, `BrewProfileMirror`, the existing combobox if one exists) · G4.1 reuse shared components · G4.2 nothing typed in · G4.4 positive copy · G5.1 vitest · G1.6 push is deploy, one closing report.
STOP points: after Task 0; before the A3d production backup and the FK migration run on production.

**Goal.** Record, for each customer, (1) how they make their coffee at home, `usual_drink`, now several drinks per person; (2) which coffee is in their kitchen right now, `cupboard_coffee`; and (3) how they feel about the coffee they drink now, `coffee_feeling`, whose four answers mirror the map's moves (stay, bolder, gentler, different). Three new brew-profile fields captured from three places (one optional post-result quiz card, the Profile page, and Liam when a field is empty) through the existing brew-profile rails, each change a new insert-only row. Move the brew-profile field definitions out of Firestore config and out of code into Postgres tables, so the next field is a row, not a deploy. Matching does not change in this brief.

**Why (context, not instructions).** The quiz measures the cup a person likes; the catalog measures bags cupped under one protocol. The roaster's best brew method per coffee is already in the portal answers (`roastery_portal_response_brew`), so once we know which drinks a person makes, coffees can later be filtered for an espresso drinker or a drip drinker. The kitchen brand's kind (chain, mass market, specialty) shows how far out a person already drinks. The feeling answer says, before the first bag, whether the person wants to stay in their zone or move out, in the same four words the map uses after a bag. Drink names, brand names and the four feelings are vocabularies people can answer (quiz principle 2026-10-06: never ask people to judge dimensions). Quantity (how much water, milk or sugar) is accepted as unknown, never asked. Milk and `takes_it` do not move the start position (Dana 2026-11-12: the quiz and the kitchen agree where we have looked).

**Decisions already made (Dana 2026-10-24, revised 2026-11-12; do not re-open):**

- D1. Preparation, the kitchen and the feeling do NOT enter the quiz questions or change the quiz result. Collected after the result, optional.
- D2. Three fields: `usual_drink`, the drinks they make **at home** (multiple choice, several per person, plain multiple choice with no "daily one" marker, revised 2026-11-12); `cupboard_coffee`, the coffee **in their kitchen right now** (the one they drink most, if several; single); `coffee_feeling`, **how they feel about the coffee they drink now** (single; new 2026-11-12). The three questions appear in that order.
- D3. Answers are codes from value lists: drinks include "I mostly buy my coffee out" (`buy_out`) and `other`; brands include `dont_know`, `nothing` and `other`; feelings are exactly four: `happy` (stay), `bolder`, `gentler`, `different`.
- D4. **No offset table in this brief.** Rev 1's `brew_drink_archetype_offset` is dropped. Nothing here is a stored number without a defined axis, and no roast level or archetype guess is attached to a brand. Milk and dilution are facts about the drink, not a shift of the start position. A table that changes a match is created only when something reads it, shaped by the data by then.
- D5. Nothing in matching, the map, the dial, Liam's recommendation or the profile line changes in this brief. Capture only. Using `coffee_feeling` in the first match is a later map change (OPEN_TASKS).
- D6. Replace the hardcoded `CHECK (field IN (...))` and `CHECK (op IN (...))` on `customer_brew_profile_change`, the Firestore `sommelier_config.brewProfile.fields` whitelist and the TS `field` union with Postgres lookup tables (G2.1).
- D7. Every new table has a surrogate `id` primary key; natural keys are UNIQUE constraints (G2.2).
- D8. **Where the questions live (revised 2026-11-12):** the optional post-result card AND the Profile page (the mirror renders the same fields), and Liam asks when a field is empty. Same fields, same one writer. Customers can change an answer anywhere; each change is a new insert-only row. The card is a component that renders a list of fields in `sort_order`; home ZIP joins later as a further entry (customer-context design), not a redesign. The card is not shown after a proxy quiz (`forMemberId`, Household 2, G2.19).
- D9. Naming: `customer_*` is reserved for insert-only fact tables (integrity check enforces it); `user_*` is per-user operating state; `coffee_*` is the catalog; `dial_*` is the map. Everything this brief adds about how customers prepare coffee, what they keep at home and how they feel about it is operational reference data and takes the `brew_*` prefix. Per-customer derived reads stay `v_customer_*`. Fact discipline unchanged: facts insert-only through `customerFacts.record.*`, reads through `customerReads.ts` and views (`lint-customer.mjs` rules stay green), `COMMENT ON` every new object, `CATALOG.md` regenerated.
- D10. **Small-list convention.** The repo has a generic `lookup_value (category, value, label, sort_order)`, used by the catalog and the roastery portal. It is rejected here for two reasons the comments on the new tables must state: no `is_active` (the retire-never-delete lifecycle cannot be expressed) and a code column cannot FK to `UNIQUE (category, value)` without a constant-category composite FK. Each small list here is its own `brew_*` table with `id`, `code UNIQUE`, `label`, `sort_order`, `is_active`.
- D11. **One value table, no table name as data.** `brew_profile_field_value` holds every allowed value of every enum/array field, including the drinks, the brands and the feelings. `brew_drink`, `brew_cupboard_brand` and `brew_coffee_feeling` are decompositions of a value row, each keyed by `field_value_id` (FK, UNIQUE). No `lookup_table` text column, no dynamic SQL, no view branch naming a table.
- D12. `customer_brew_profile_change` gains a nullable `quiz_session_id UUID REFERENCES quiz_session(id)`, set only by the quiz writer. The customer-context design (D44) reads brewing fields "as of the current quiz"; that read must be a join, not a parse of `source_id`.
- D13. The stale-guest purge never removes a guest who holds a `customer_brew_profile_change` row (any op, including `declined`). Same rule the customer-context design made for home location (its D29).
- D14. Archetype codes: `chocolate_nutty`, `balanced_sweet`, `fruity`, `earthy`, `floral`, `experimental`. Nothing in this brief reads them.
- D15. **Brands are a reference table with search terms.** `brew_cupboard_brand` decomposes a `cupboard_coffee` value into `brand_kind` (from `brew_cupboard_brand_kind`) and an optional `roaster_id → roaster(id)`. `brew_cupboard_brand_alias` holds the typeahead strings. The seed never sets `roaster_id`; owner SQL does when Dana decides the link.
- D16. **A declined question is a fact.** On Save or Skip, every card field not answered gets a `customer_brew_profile_change` row with `op = 'declined'`, `value NULL`, `quiz_session_id` set. The fold ignores it; per-field coverage is `set` over `set + declined` per session. `op` moves to `brew_profile_op`. Funnel events stay card-level.
- D17. **The customer's own words.** A value row may carry `accepts_words = true` (the `other` rows of drink and brand). The fact row then stores the typed text in `customer_words TEXT`; on any other value the column is NULL and a write with words is rejected.
- D18. **Presentation is data.** `brew_profile_field.picker_id → brew_profile_picker` (select | multi_select | typeahead | toggle) tells the card and the mirror which control to render; `brew_profile_field_value.pinned` marks typeahead quick picks. No per-field code in any component.
- D19. **The feeling maps to a move by FK (new 2026-11-12).** `brew_coffee_feeling` decomposes each `coffee_feeling` value to a `dial_move` row (`stay`, `bolder`, `gentler`, `different`; `dial_move` exists since Ella map 3). The mapping is a row, never a switch in code. Nothing reads it in this brief. The question is worded about "the coffee you drink now", so it has no dependency on the kitchen answer and is always answerable.

## Task 0 — Survey and confirm (write into `CLOSING_REPORT_1.md`; STOP if anything contradicts the decisions)

Report file:line for each. Items 5, 13 and 18 survey the files as Ella's Bloom Map brief 3 left them; this brief runs on top of brief 3, never beside it (G1.9, G1.6).

1. `customer_brew_profile_change`: the inline CHECKs on `field` and `op` and their auto-generated constraint names, read from `pg_constraint` (do not assume names). The `customer_brew_profile_fold()` aggregate behind `v_customer_brew_profile`: confirm it folds by op, not by field, that an unknown op returns the state unchanged (so `declined` rows are invisible to every view), and how it folds an array field (`brew_methods`) on `set`, `add`, `remove`. Confirm `quiz_session.id` is UUID and `roaster.id` is UUID with `name` not UNIQUE.
2. `services/brewProfile.ts`: `getBrewProfileFieldsConfig()` (sync, returns a Record), `validateSingleValue()`, `normalizeFieldName()`, `formatBrewProfileSummary()`, `getStaleFieldNudge()` and its `TOPIC_TO_FIELD` map. Report which hold field names or allowed values in code or read them from `sommelierConfig`, and every call site that relies on `getBrewProfileFieldsConfig()` being synchronous. How an array field is validated today (`brew_methods`: max items, allowed codes).
3. `services/customerFacts.ts`: `BrewProfileChangeInput.field` (TS union), `op` (union of four); `FactSource` has no quiz source. Every call site of `record.brewProfileChange` (expected: `routes/users.ts` PATCH/DELETE `/brew-profile`, `routes/sommelier.ts` `resolveRemember()`).
4. `routes/users.ts` `/brew-profile` routes use `requireAuth, blockAnonymousAuth`. Quiz takers are anonymous-auth guests. Confirm an anonymous guest has a `user_profile` row (the `quiz_session.user_id` it saves under), so a fact can be recorded for them, and that `blockAnonymousAuth` means the existing PATCH cannot serve the post-result card. Part B uses a quiz-scoped route.
5. `frontend/src/app/components/FlavorQuiz.tsx` **as brief 3 left it**: where the result screen is shown, `saveQuizResult` call sites, `PostQuizEmailGate` (~1549, ~1690), `MapQuizStart` (~1605, rendered only when the `quiz_result` surface is `map`), and the proxy path (`forMemberId`, Household 2). Identify the one insertion point for an optional post-result card that does not block the reveal, does not sit in the ceremony, and is skipped on a proxy quiz. `frontend/src/app/components/profile/BrewProfileMirror.tsx` (Profile.tsx ~656, under `MapTrail` ~650): how fields render (per-field type → control) so the three new fields render from the options payload with no per-field code; whether a multi-select control exists for `brew_methods`. Report whether the frontend has a typeahead/combobox component (search `combobox|typeahead|autocomplete|Command`); if one exists it is reused.
6. `sommelier_config_seed.ts` `brewProfile.fields` and `LIAM_BASE_PROMPT`'s "Remembering facts" section: how field names and allowed values reach the prompt, and how the stale nudge asks about an empty field. Liam must be able to say "latte, noted" and emit `<<remember:usual_drink=latte>>` (array add), "Counter Culture, noted" with `<<remember:cupboard_coffee=counter_culture>>`, and, when the customer says they want something bolder than what they drink, `<<remember:coffee_feeling=bolder>>`.
7. Counts (read-only, prod): `SELECT field, op, COUNT(*) FROM customer_brew_profile_change GROUP BY 1,2`; quiz sessions in the last 30 days; proxy quizzes (`quiz_session.taken_by_user_id IS NOT NULL`).
8. `quiz_funnel_event.event` is a hardcoded CHECK of four values; the three events Part B2 adds would be rejected. Confirm the constraint name (from `pg_constraint`) and every writer of `quiz_funnel_event`. Part A3 replaces it.
9. `backend/scripts/lint-customer.mjs` Rule 7: no `CREATE OR REPLACE VIEW` inside the Customer Blueprint C3 block. Find the markers; this brief's views go in their own marked block after it.
10. Prod Firestore `sommelier_config` doc: confirm the `brewProfile.fields` key is present (Part B1 retires it) and how `sommelierConfig.ts` caches config (TTL, per process), so the field-list cache follows the same pattern.
11. Grants: the prefix-driven blocks near the end of `schema.sql`. Confirm which block a new `brew_*` table falls into today and that `brew_card_view_event` is app-written and must keep its grants (so Part A6 lists tables explicitly).
12. How existing brew-profile writers encode `value` (expected `JSON.stringify(validatedValue)`: a code stored as `"latte"`, an array as `["latte","drip_black"]`) and how `customer_brew_profile_fold()` returns it; Part B writes the new fields the same way or the `brew_profile_field_value` join misses.
13. `routes/quiz.ts` **as brief 3 left it**: `POST /results` (~158) now ends with `matchDecide(...)` (Ella map 3); `funnelEventLimiter`; how `POST /results` resolves the caller's profile from an anonymous token and `forMemberId`. Part B2's ownership check uses the same resolution. This brief adds nothing to `POST /results`.
14. `v_palate_evidence` counts brew fields; check `palateReads.test.ts` and the Dana-reviewed fixture for an asserted brew-field count that three more fields would change, and whether it counts rows by op (a `declined` row must not count as evidence; if the view counts all rows, Part A5 adds `op <> 'declined'` and the closing report says so). Do not change the fixture without saying so.
15. `services/staleGuestCleanup.ts`: the two candidate queries and the delete sequence (Firestore `recursiveDelete` first, then `DELETE FROM user_profile`, FK failure caught). Confirm a guest with a `customer_brew_profile_change` row and no order/verified email is today a purge candidate and that an FK failure would leave a half-purged guest. Part A8 fixes the candidate queries.
16. `lookup_value`: confirm it has no `is_active` column and that its only unique is `(category, value)` (the D10 reasons).
17. `dial_move` (schema ~10512, Ella map 1): codes and ids of `stay`, `bolder`, `gentler`, `different`; confirm it is seeded at boot before this brief's seeds run (ordering in `schema.sql`), so `brew_coffee_feeling` can FK and seed by code lookup.
18. `roastery_portal_response_brew`: the roaster's best brew method per coffee (columns, vocabulary), for the OPEN_TASKS line only; nothing reads it here.
19. Repo on `main`, level with `origin/main`; report the hash. Working tree: the genova `.ttf` deletions and `commerce/README.md` are unrelated and stay unstaged; commits add files by path.

## Task 0.5 — Dana's manual steps
None.

## Part A — Tables (owner role applies `schema.sql` at boot; idempotent DDL as the rest of the file; sections in execution order)

Every small lookup below is `(id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL, sort_order INT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, created_at, updated_at)` unless more columns are listed. Seeds use `ON CONFLICT DO NOTHING` on the natural key so a boot never overwrites an edit made in the DB.

### A1. Field definitions

A1a. Lookups: `brew_profile_value_kind` (enum, array, bool, array_freeform); `brew_profile_picker` (select, multi_select, typeahead, toggle); `brew_profile_op` (set, add, remove, clear, declined; the comment on `declined` says "asked on the card or the profile and not answered; value NULL; ignored by the fold").

A1b. `brew_profile_field`:

```
id            SERIAL PRIMARY KEY
code          TEXT NOT NULL UNIQUE            -- brew_methods, grinder, takes_it, decaf_constraint, aversions, usual_drink, cupboard_coffee, coffee_feeling
label         TEXT NOT NULL                   -- customer-facing label on the Profile mirror
prompt        TEXT                            -- the question as asked on the card / by Liam; NULL = never on the card (kill switch, B2)
value_kind_id INT NOT NULL REFERENCES brew_profile_value_kind(id)
picker_id     INT NOT NULL REFERENCES brew_profile_picker(id)
max_items     INT                             -- arrays
max_item_len  INT                             -- array_freeform, and the length cap for customer_words (D17)
liam_topic    TEXT                            -- the router topic that makes a nudge relevant; replaces the in-code TOPIC_TO_FIELD map
ask_when_empty BOOLEAN NOT NULL DEFAULT false -- Liam may ask this question when the customer has no value (D8)
sort_order    INT NOT NULL                    -- also the order on the card and the mirror
is_active     BOOLEAN NOT NULL DEFAULT true
created_at / updated_at
```

Seed the five existing fields from today's config exactly (codes, kinds, max_items 8 for brew_methods, max_item_len 40 / max_items 10 for aversions, topics from `TOPIC_TO_FIELD`, picker select for enums, multi_select for arrays, toggle for the bool), `prompt` NULL and `ask_when_empty` false for all five. Insert, in this sort order after them:
- `usual_drink`: array, multi_select, max_items 4, `liam_topic = 'my_coffee'`, `ask_when_empty = true`, label "How you make your coffee", prompt "How do you make your coffee at home? Pick all that apply.", max_item_len 80;
- `cupboard_coffee`: enum, typeahead, `liam_topic = 'my_coffee'`, `ask_when_empty = true`, label "What's in your kitchen", prompt "Which coffee is in your kitchen right now?", max_item_len 80;
- `coffee_feeling`: enum, select, `liam_topic = 'my_coffee'`, `ask_when_empty = true`, label "How you feel about it", prompt "How do you feel about the coffee you drink now?".

A1c. `brew_profile_field_value`: the allowed values of every enum/array field, one table (D11).

```
id             SERIAL PRIMARY KEY
field_id       INT NOT NULL REFERENCES brew_profile_field(id)
code           TEXT NOT NULL
label          TEXT NOT NULL
sort_order     INT NOT NULL
pinned         BOOLEAN NOT NULL DEFAULT false   -- shown before typing in a typeahead (D18)
accepts_words  BOOLEAN NOT NULL DEFAULT false   -- the fact may carry customer_words (D17)
is_active      BOOLEAN NOT NULL DEFAULT true
created_at / updated_at
UNIQUE (field_id, code)
```

Seed brew_methods' 8, grinder's 5, takes_it's 4 from today's config exactly (labels: today's display strings where one exists, else the code), the drinks from A2a, the brands from A2b and the feelings from A2c. `accepts_words = true` only on the two `other` rows (drink, brand).

### A2. Decompositions

A2a. **Drinks.** Lookups `brew_drink_base_method` (espresso, filter, immersion, cold_brew, stovetop, pod, none), `brew_drink_dilution` (none, water, ice; the comment on `ice` says it counts as water dilution), `brew_drink_milk` (none, cold, steamed).

```
brew_drink
id              SERIAL PRIMARY KEY
field_value_id  INT NOT NULL UNIQUE REFERENCES brew_profile_field_value(id)   -- the usual_drink value this row decomposes; the natural key
base_method_id  INT NOT NULL REFERENCES brew_drink_base_method(id)
dilution_id     INT NOT NULL REFERENCES brew_drink_dilution(id)
milk_id         INT NOT NULL REFERENCES brew_drink_milk(id)
is_home_drink   BOOLEAN NOT NULL DEFAULT true   -- false for buy_out
created_at / updated_at
```

Seed (Dana approved 2026-10-24; `is_active` on the value row is how she trims). The seed inserts the value rows under `usual_drink` first, then the `brew_drink` rows by looking up `field_value_id` from `(field, code)`; guard `ON CONFLICT (field_value_id) DO NOTHING`.

| value code | label | base_method | dilution | milk | home |
|---|---|---|---|---|---|
| espresso | Espresso, straight | espresso | none | none | yes |
| cortado | Cortado or macchiato (espresso, a little milk) | espresso | none | steamed | yes |
| americano | Americano (espresso + hot water) | espresso | water | none | yes |
| americano_milk | Americano with milk | espresso | water | cold | yes |
| iced_americano | Iced americano | espresso | ice | none | yes |
| latte | Latte, cappuccino or flat white | espresso | none | steamed | yes |
| iced_latte | Iced latte | espresso | ice | cold | yes |
| drip_black | Drip or pour-over, black | filter | none | none | yes |
| drip_milk | Drip or pour-over with milk | filter | none | cold | yes |
| iced_coffee | Iced coffee (brewed, over ice) | filter | ice | none | yes |
| french_press | French press or AeroPress | immersion | none | none | yes |
| cold_brew | Cold brew | cold_brew | none | none | yes |
| moka_turkish | Moka pot or Turkish | stovetop | none | none | yes |
| pod | Pod machine | pod | none | none | yes |
| buy_out | I mostly buy my coffee out | none | none | none | no |
| other | Something else | none | none | none | yes (accepts_words) |

Column comment on `brew_drink.milk_id`: `latte` groups cappuccino and flat white, whose milk ratios differ widely; `steamed` is a kind, not a quantity. `buy_out` may be picked together with home drinks (a person who buys most days and makes drip on weekends); nothing excludes it.

A2b. **Brands.** Lookup `brew_cupboard_brand_kind` (chain, mass_market, specialty, unknown, none): the channel the brand sells through, a fact about the brand, not about its coffee (D4).

```
brew_cupboard_brand
id              SERIAL PRIMARY KEY
field_value_id  INT NOT NULL UNIQUE REFERENCES brew_profile_field_value(id)   -- the cupboard_coffee value; the natural key
brand_kind_id   INT NOT NULL REFERENCES brew_cupboard_brand_kind(id)
roaster_id      UUID REFERENCES roaster(id)     -- a partner roaster, when Dana links it by owner SQL; NULL at seed (D15)
created_at / updated_at

brew_cupboard_brand_alias
id              SERIAL PRIMARY KEY
brand_id        INT NOT NULL REFERENCES brew_cupboard_brand(id)
alias           TEXT NOT NULL                   -- lower-cased, trimmed at seed; the typeahead matches label and aliases
UNIQUE (brand_id, alias)
```

Seed: value rows under `cupboard_coffee`, then `brew_cupboard_brand` by `(field, code)`, then aliases. Label is the brand's own spelling. Pinned rows sort first. Dana trims with `is_active`; new brands are rows added by owner SQL from the `other` + words list (Part D).

| code | label | kind | pinned | aliases |
|---|---|---|---|---|
| dont_know | I don't know | unknown | yes | |
| nothing | Nothing right now | none | yes | |
| pods_unknown | Pods, not sure of the brand | unknown | yes | k-cup, keurig, nespresso |
| other | Something else | unknown | yes (accepts_words) | |
| dunkin | Dunkin' | chain | | dunkin donuts, dd |
| starbucks | Starbucks | chain | | sbux |
| peets | Peet's Coffee | chain | | peets |
| mcdonalds | McCafé | chain | | mcdonalds, mccafe |
| tim_hortons | Tim Hortons | chain | | |
| caribou | Caribou Coffee | chain | | |
| wawa | Wawa | chain | | |
| folgers | Folgers | mass_market | | |
| maxwell_house | Maxwell House | mass_market | | |
| bustelo | Café Bustelo | mass_market | | bustelo, cafe bustelo |
| pilon | Café Pilón | mass_market | | pilon |
| lavazza | Lavazza | mass_market | | |
| illy | Illy | mass_market | | |
| eight_oclock | Eight O'Clock | mass_market | | 8 oclock |
| chock_full | Chock full o'Nuts | mass_market | | chock full of nuts |
| green_mountain | Green Mountain Coffee | mass_market | | |
| donut_shop | The Original Donut Shop | mass_market | | donut shop |
| seattles_best | Seattle's Best | mass_market | | |
| gevalia | Gevalia | mass_market | | |
| community | Community Coffee | mass_market | | |
| death_wish | Death Wish Coffee | mass_market | | |
| black_rifle | Black Rifle Coffee | mass_market | | brcc |
| kirkland | Kirkland Signature (Costco) | mass_market | | costco |
| trader_joes | Trader Joe's | mass_market | | |
| aldi | Aldi (Barissimo) | mass_market | | barissimo |
| store_brand | Another supermarket's own brand | mass_market | | shoprite, wegmans, whole foods 365, stop and shop |
| counter_culture | Counter Culture Coffee | specialty | | ccc |
| intelligentsia | Intelligentsia | specialty | | |
| stumptown | Stumptown | specialty | | |
| blue_bottle | Blue Bottle Coffee | specialty | | |
| la_colombe | La Colombe | specialty | | |
| verve | Verve Coffee | specialty | | |
| onyx | Onyx Coffee Lab | specialty | | |
| equator | Equator Coffees | specialty | | |
| ritual | Ritual Coffee | specialty | | |
| joe_coffee | Joe Coffee | specialty | | joe, joe coffee company |
| utopian | Utopian Coffee | specialty | | |
| joe_bean | Joe Bean Coffee Roasters | specialty | | joe bean |
| path | Path Coffee Roasters | specialty | | |
| temecula | Temecula Coffee Roasters | specialty | | |
| devocion | Devoción | specialty | | devocion |
| partners | Partners Coffee | specialty | | |
| irving_farm | Irving Farm | specialty | | |
| cafe_grumpy | Café Grumpy | specialty | | cafe grumpy |
| brooklyn_roasting | Brooklyn Roasting Company | specialty | | |
| birch | Birch Coffee | specialty | | |
| stone_street | Stone Street Coffee | specialty | | |
| orens | Oren's Coffee | specialty | | orens |
| porto_rico | Porto Rico Importing | specialty | | |
| variety | Variety Coffee Roasters | specialty | | |
| rook | Rook Coffee | specialty | | |
| small_world | Small World Coffee | specialty | | |
| modcup | Modcup | specialty | | |
| hidden_grounds | Hidden Grounds | specialty | | |
| local_roaster | A local roaster not on this list | specialty | | local, roastery |

A2c. **Feelings (new, D19).**

```
brew_coffee_feeling
id              SERIAL PRIMARY KEY
field_value_id  INT NOT NULL UNIQUE REFERENCES brew_profile_field_value(id)   -- the coffee_feeling value; the natural key
move_id         INT NOT NULL REFERENCES dial_move(id)                          -- the map move this feeling mirrors
created_at / updated_at
```

Seed: value rows under `coffee_feeling`, then the decomposition by `(field, code)` and `dial_move.code`; guard `ON CONFLICT (field_value_id) DO NOTHING`. Labels are the customer-facing answers; wording is a label edit, never code.

| value code | label | dial_move |
|---|---|---|
| happy | I'm happy with it | stay |
| bolder | I'd like something bolder | bolder |
| gentler | I'd like something gentler | gentler |
| different | I'd like something different | different |

### A3. The CHECK → FK changes, the two new columns, and safety

A3a. `customer_brew_profile_change.field`: drop the CHECK found in Task 0.1 (by its real name, if present), add `FOREIGN KEY (field) REFERENCES brew_profile_field(code)` if absent. `customer_brew_profile_change.op`: same, FK to `brew_profile_op(code)`.

A3b. `quiz_funnel_event_type` (small lookup). Seed the four existing codes plus `post_result_shown`, `post_result_saved`, `post_result_skipped`. Drop the CHECK on `quiz_funnel_event.event` (name from Task 0.8), add `REFERENCES quiz_funnel_event_type(code)`. `logQuizFunnelEvent` validates against the table; an unknown code is logged and dropped, never a 500.

A3c. New columns on `customer_brew_profile_change`, both `ADD COLUMN IF NOT EXISTS`, nullable, existing rows NULL: `quiz_session_id UUID REFERENCES quiz_session(id)` (D12; comment: "set only by the quiz post-result writer; NULL for onsite and Liam writes") and `customer_words TEXT` (D17; comment: "the customer's typed text when the picked value has accepts_words; NULL otherwise; capped at the field's max_item_len").

A3d. Safety (G2.10). Both tables hold data collected from people. Before the migration runs in production: `pg_dump --table` of both to the backup location the quiz v2.2 brief used, plus row count and `md5(string_agg(... ORDER BY id))` of each table recorded; the same two numbers after, unchanged. **STOP before this step on production.** The DDL itself never fails boot: in the same `DO $$` block, count rows whose `field` / `op` / `event` has no lookup row; if zero, add the FK; if not, skip that FK, `RAISE WARNING` with the count, and leave it to integrity check 6 (Part D). No strict mode (G2.18).

### A4. Lookup-row lifecycle (every table in A1, A2, A3b)

Rows are never deleted, only deactivated (`is_active = false`, G2.11). Facts reference them by `code` through the FK. Views join lookups regardless of `is_active` (a stored value whose option was retired must still resolve and display); only the pickers (mirror editor, card options, Liam's allowed list) filter to active rows. Seeds are initial load only (`ON CONFLICT DO NOTHING`): after boot the DB is the truth; a label or alias edit belongs in the DB, not in the seed.

### A5. Views (new marked block in `schema.sql` after the Customer Blueprint C3 block; lint-customer Rule 7 forbids new views inside it)

- `v_brew_profile_field_current`: one row per field × allowed value, from `brew_profile_field` JOIN `brew_profile_value_kind` JOIN `brew_profile_picker` LEFT JOIN `brew_profile_field_value` LEFT JOIN `brew_cupboard_brand_alias` aggregated to `aliases TEXT[]` per value (bool and array_freeform fields appear once with NULL value columns). Columns: field id/code/label/prompt/value_kind/picker/max_items/max_item_len/liam_topic/ask_when_empty/sort_order/field_is_active, value id/code/label/sort_order/pinned/accepts_words/aliases/value_is_active. **The only thing the validator, the Profile mirror, the card options endpoint and the prompt builder read**, through one reader function (B1). Includes inactive rows; the reader filters.
- `v_customer_brew_profile` unchanged in shape (Task 0.1 confirms the fold is field-agnostic and ignores `declined`). If `v_palate_evidence` counts rows by op (Task 0.14), add `op <> 'declined'` there and say so.
- `v_customer_usual_drink`: **one row per canonical customer × drink** (the array unnested): `field_value_id`, `code`, `label`, `base_method`, `dilution`, `milk`, `is_home_drink`, `customer_words`, `captured_at`, `source`, `quiz_session_id`; from `v_customer_brew_profile WHERE field = 'usual_drink'` with the JSON array unnested and joined to `brew_profile_field_value` on code and field, then `brew_drink` and its lookups by id, regardless of `is_active` (A4). `customer_words` comes from the latest `set`/`add` row of that field for the customer that carries words.
- `v_customer_cupboard_coffee`: one row per canonical customer, same shape, with `brand_kind`, `roaster_id`, `customer_words`.
- `v_customer_coffee_feeling`: one row per canonical customer: `field_value_id`, `code`, `label`, `move_code` (from `brew_coffee_feeling` → `dial_move`), `captured_at`, `source`, `quiz_session_id`.
- Readers: `customerReads.getUsualDrinks()`, `customerReads.getCupboardCoffee()`, `customerReads.getCoffeeFeeling()`; callers in this brief: the Profile mirror (via the generic read) and the admin stats row (Part D). Not Liam's recommendation, not the map, not the dial.
- `GRANT SELECT ON` the four new views `TO reporting_ro` alongside the other named `reporting_ro` view grants, and SELECT on every `brew_*` table in A6 to `reporting_ro`.
- `COMMENT ON` every table, column and view in the catalog's format (Purpose | Class | Writer | Readers | Since). For every table in A1, A2 and A3b the Writer is `boot seed (owner role); edits by owner SQL, no app writer` and the Readers are exactly the functions named in this brief. The comment on each small lookup states the D10 reason it is not `lookup_value`. Regenerate `CATALOG.md` (G2.17).

### A6. Grants for the new lookups

Reference tables have one writer, the boot seed under the owner role. Add a boot block, same shape as the quiz-content block, for: `brew_profile_value_kind`, `brew_profile_picker`, `brew_profile_op`, `brew_profile_field`, `brew_profile_field_value`, `brew_drink`, `brew_drink_base_method`, `brew_drink_dilution`, `brew_drink_milk`, `brew_cupboard_brand`, `brew_cupboard_brand_kind`, `brew_cupboard_brand_alias`, `brew_coffee_feeling`, `quiz_funnel_event_type`: `REVOKE ALL ... FROM ab_app; GRANT SELECT ... TO ab_app`. **Explicit list**, not `brew\_%`: `brew_card_view_event` is app-written and keeps its grants. Place it after the operating catch-all so it overrides it.

### A7. Removed in Rev 2

`brew_drink_archetype_offset` and `brew_offset_basis` (D4). If either exists in any environment from a Rev 1 run, report it and leave it; nothing is dropped.

### A8. Stale-guest purge (D13)

`services/staleGuestCleanup.ts`: both candidate queries (Task 0.15) gain `AND NOT EXISTS (SELECT 1 FROM customer_brew_profile_change c WHERE c.user_id = up.id)`. The fix is in the candidate selection, not in error handling. Log line gains `keptForFacts=<n>`. Integrity check 9 (Part D) counts guests kept for facts.

## Part B — Writers (all through `record.brewProfileChange`, one validator)

Reader rule: `v_brew_profile_field_current` has one reader, `getBrewProfileFieldsConfig()` in `services/brewProfile.ts`; the validator, the mirror's field list endpoint, the card options endpoint and the prompt builder all call it. No route SELECTs `brew_profile_field`, `brew_profile_field_value`, `brew_drink`, `brew_cupboard_brand*` or `brew_coffee_feeling` directly. `customer_*` tables and `v_customer_*` views are read only from `customerReads.ts`.

B1. `services/brewProfile.ts`: `getBrewProfileFieldsConfig()` stays **synchronous** for its callers (Task 0.2). It serves a per-process cache loaded at boot (before the server accepts requests) and refreshed on a TTL taken from config, same pattern and TTL source as `sommelierConfig.ts`, never a literal. A refresh failure keeps the last good list and logs. `validateSingleValue()` unchanged in behaviour, now driven by the view rows (enum: value must be an active value code of the field; array: every item an active value code, at most `max_items`, no duplicates; bool/array_freeform as today). Delete `TOPIC_TO_FIELD`; read `liam_topic` and `ask_when_empty`. `BrewProfileChangeInput.field` and `.op` become `string`, validated at the door (`customerFacts.ts` checks the field exists and is active, the op exists and fits the field's kind, `declined` carries `value NULL` and a `quizSessionId` or a profile source, `customerWords` is present only when the value row has `accepts_words` and is within `max_item_len`; any violation is a rejected write counted in `brew_profile.failures`, never a 500). Remove `brewProfile.fields` from `sommelier_config_seed.ts` and from the Firestore config read path; `staleAfterDays` and `maxMarkersPerTurn` stay where they are. One-off, owner role: delete the `brewProfile.fields` key from the prod `sommelier_config` doc (dry-run shows the key, apply, read back and assert absent).

**No inference rule.** None of the three fields is ever derived from other fields, orders or anything else, not by a backfill, not by a view, not by Liam. A value exists only when the customer picked or named it.

B2. **Quiz post-result card.** New route `POST /api/quiz/post-result` (`requireAuth` only, anonymous allowed; body `{ quizSessionId, answers: [{ field, value, words? }], shown: [field] }`; `shown` is the list of fields the card rendered, validated against the card-eligible fields, so every shown field without an answer gets a `declined` row). **Ownership check:** resolve the caller's profile exactly as `POST /results` does and require `quiz_session.user_id` to equal it, else 403 and no write. A session with `taken_by_user_id` set (a proxy quiz) is refused with 409 and no write (D8). Behind the same rate limiter as `POST /event`. `value` encoded exactly as the existing writers do (Task 0.12): a code as a JSON string, the drinks as a JSON array of codes. Per field, validates via B1 and records `record.brewProfileChange({ userId, source: 'quiz', sourceId: '<quiz_session_id>:<field>:<value|declined>', quizSessionId, field, op: 'set' | 'declined', value, customerWords })`; one transaction for the whole card. Add `'quiz'` to `FactSource`. Idempotent by `UNIQUE (source, source_id)`: resubmitting the same card is a no-op; changing an answer is a new row and the fold's latest `occurred_at` wins; a decline followed by an answer leaves both rows. Skip submits the same body with no answers, so every shown field gets `declined`.

Front end: after the result is saved and the reveal has finished, one optional card, at the insertion point Task 0.5 names; **not rendered on a proxy quiz** (`forMemberId`). `GET /api/quiz/post-result/options` returns, from `getBrewProfileFieldsConfig()`, the fields that are card-eligible (`is_active` and `prompt` non-null) in `sort_order`, each with its prompt, picker, `max_items`, `max_item_len`, and its active values (code, label, pinned, accepts_words, aliases). The component renders one control per field by `picker`: `select` as today's mirror select; `multi_select` as a set of toggle chips with the `max_items` cap from the payload; `typeahead` as a text input that filters the field's values client-side on label and aliases (case- and diacritic-insensitive, prefix or word match), showing the `pinned` values before typing; `toggle` for bools. Picking a value with `accepts_words` reveals a short text input capped at `max_item_len`. Buttons Save / Skip, no strings in the component except what the payload carries. If Task 0.5 found a combobox component, reuse it; otherwise write one small one under `components/quiz/`. **Kill switch:** a field's `prompt` set to NULL or `is_active` false removes that question on the next cache refresh, no deploy; an empty field list renders no card. Funnel events as the other result-screen actions do: `post_result_shown`, `post_result_saved`, `post_result_skipped`, card-level.

B3. **Profile page (D8).** `BrewProfileMirror.tsx` renders every active field from the options served by `getBrewProfileFieldsConfig()` by `picker`, with the same multi-select chips for `usual_drink`, the same typeahead for `cupboard_coffee` and a select for `coffee_feeling`; all three editable and clearable like the others, no per-field code. A field with a `prompt` and no value shows the prompt as its empty state (the same question the card asks). PATCH/DELETE `/brew-profile` unchanged except the validator source, array `set` with a full array for `usual_drink`, and the optional `words` on PATCH. Signed-in customers only, as today.

B4. **Liam (D8).** The prompt's "Remembering facts" field list is built from `getBrewProfileFieldsConfig()` (field codes + active value codes; for `cupboard_coffee` the label and aliases too, so Liam can map "I buy the Costco one" to `kirkland`), not typed in the prompt. Rules in the base prompt text, data-driven by `ask_when_empty`: when a field with `ask_when_empty` is absent from the brew-profile line, Liam may ask its `prompt` once in a conversation where the topic fits (`liam_topic`), never twice, never in the first turn. Saving: when the customer **names a drink or describes the full preparation** ("espresso with hot water and a splash of cold milk" → `americano_milk`), confirm in voice and emit `<<remember:usual_drink=<code>>>` (an `add` for the array; never from a partial cue, "I add milk" is `takes_it`); when the customer **names a brand they have at home**, `<<remember:cupboard_coffee=<code>>>`, a brand not on the list is `other` with the words (`<<remember:cupboard_coffee=other|Café du Monde>>`, the marker grammar extended by one optional `|words` part, parsed in `resolveRemember()`); when the customer says how they feel about their current coffee in one of the four senses ("I'm bored of it, I want something with more punch" → `bolder`), `<<remember:coffee_feeling=bolder>>`. When present, never re-ask except through the existing stale-nudge rule. No new topics in the router. Liam's recommendation does not read any of the three (D5).

## Part C — Backfill: none

No historical data exists for any of the three fields. Existing `customer_brew_profile_change` rows must satisfy the new FKs (Task 0.7 lists their `field` and `op` values; they come from today's whitelists). Nothing is deleted.

## Part D — Visibility

- Admin brew-profile stats row (`AdminSommelierFlow.tsx`, `brewProfileStats`): counts per field (customers with a value; declined per field; coverage = set / (set + declined) over quiz-sourced rows), the `usual_drink` distribution by drink (a customer counts once per drink) and by base method, the `cupboard_coffee` distribution by brand and by brand kind, the `coffee_feeling` distribution by answer, and the list of `other` picks with `customer_words` (newest first). All through one new `customerReads.getBrewProfileFieldCounts()` over the views and `customer_brew_profile_change` (for declines and words). No other file SELECTs these (lint-customer rule 4).
- `customerIntegrity.ts`, new boot checks, all informational (G2.18), each on the admin integrity panel with detail rows:
  1. Every `customer_brew_profile_change.field` is a `brew_profile_field.code` and every `op` a `brew_profile_op.code`; inactive fields that still carry facts are listed (allowed, visible).
  2. Every active enum/array field has at least one active value row; every bool/array_freeform field has none; every typeahead field has at least one pinned value.
  3. Every `set`/`add`/`remove` value for an enum or array field resolves to a value row of that field, active or not (array: every element). A non-resolving value is a drift row; list it.
  4. Decompositions are one-to-one: every `usual_drink` value has exactly one `brew_drink` row, every `cupboard_coffee` value exactly one `brew_cupboard_brand` row, every `coffee_feeling` value exactly one `brew_coffee_feeling` row, each pointing back at a value of the right field; every `brew_cupboard_brand.roaster_id`, when set, exists; every `brew_coffee_feeling.move_id` is a customer move (`dial_move.is_customer_move`).
  5. Seed coverage: every code in the seed arrays exists in the DB (detects a seed that failed at boot); rows in the DB not in the seed are allowed.
  6. FK state: the three FKs from A3a/A3b exist; if any was skipped at boot, list the violating rows.
  7. Firestore `sommelier_config` has no `brewProfile.fields` key (30-day check).
  8. `ab_app` holds no INSERT/UPDATE/DELETE on any table in the A6 list; `brew_card_view_event` keeps its INSERT.
  9. Purge guard: count of guests kept for facts (D13).
  10. `takes_it` vs `usual_drink` (informational): per customer with both, those where `takes_it` implies milk and no drink has milk, or `takes_it` is black and every drink has milk; `cupboard_coffee = nothing` with `usual_drink` not containing `buy_out`.
  11. Row shape: every `source = 'quiz'` row has a non-null `quiz_session_id` whose session belongs to the row's `user_id` (or an identity linked to it) and has `taken_by_user_id` NULL; every non-quiz row has NULL `quiz_session_id`; every `declined` row has `value NULL`; `customer_words` is non-null only where the resolved value row has `accepts_words`; an array field's `set` value is a JSON array with no duplicates and at most `max_items`.
- `lint-customer.mjs`: confirm the removal of the Firestore whitelist read leaves no allow-list entry dangling.

## Part E — Tests (vitest, test DB; G5.1)

The three writers each produce rows for all three fields (`source` = `quiz` / `onsite` / `liam`), only quiz rows carry `quiz_session_id`; `v_customer_usual_drink` returns one row per drink and resolves base_method/dilution/milk, `v_customer_cupboard_coffee` resolves brand_kind, `v_customer_coffee_feeling` resolves `move_code`, for all three sources (proves the encoding); a card with `shown = [usual_drink, cupboard_coffee, coffee_feeling]` and one answer inserts one `set` and two `declined` rows; Skip inserts three `declined`; resubmitting inserts nothing; changing an answer inserts a new row and the fold shows the new value; `declined` rows change no view; two drinks picked store a two-element array and `max_items + 1` is rejected and counted; an `other` pick with words stores them and a non-`other` pick with words is rejected; words over `max_item_len` are rejected; `coffee_feeling=unicorn` is dropped and counted; deactivating a value row removes it from the options and the mirror's editor while a customer who stored it still sees it displayed; `prompt` NULL removes a question; a proxy-quiz session returns 409 and inserts nothing; a session the caller does not own returns 403; `<<remember:cupboard_coffee=other|Café du Monde>>` lands as `other` + words; `<<remember:usual_drink=latte>>` adds to the array; `<<remember:coffee_feeling=bolder>>` lands with `move_code = bolder`; a guest answers the card then signs up and `v_customer_brew_profile` for the canonical user shows the guest's values; a guest with a brew-profile row, last quiz 91 days ago, no order, no verified email is NOT a purge candidate (and one without the row still is); the three funnel events insert against `quiz_funnel_event_type`; as `ab_app`, an INSERT into `brew_drink`, `brew_cupboard_brand`, `brew_coffee_feeling` and `brew_profile_field_value` is denied.

## Acceptance (one closing report, `CLOSING_REPORT_1.md`)

1. `npm run lint:catalog && npm run lint:customer && npm run lint:lineage && npm test` green locally (pre-existing failure count unchanged, stated; run `npx vitest run src` per OT-122 until it is closed).
2. Test DB: every case in Part E, with test names.
3. `grep -rn "brew_drink_archetype_offset\|brew_offset_basis\|lookup_table" backend/src frontend/src` returns nothing. `grep -rn "usual_drink\|cupboard_coffee\|coffee_feeling" frontend/src` returns no component logic keyed on any code.
4. Prod, before deploy: the A3d backups taken and the before-numbers recorded (STOP first); after deploy, the after-numbers equal them.
5. Commit by explicit file list, `git diff --cached --stat` shown first; the genova `.ttf` deletions and `commerce/README.md` stay unstaged. Push to main deploys; boot log shows the schema applied and the new integrity checks green.
6. Prod smoke with the test user (`quiz-scenario-test@axisandbloom.test`, excluded from analysis): take the quiz, pick two drinks, skip the kitchen, answer the feeling (two `set`, one `declined`, all with `quiz_session_id`); set the kitchen from the Profile page through the typeahead (type "count", pick Counter Culture); change the feeling on the Profile page (a new row, the fold shows it); admin stats row shows the four distributions and the coverage.
7. Closing report: Task 0 findings, every deviation, the seeded drink, brand and feeling rows as tables, the cache TTL, open items.

## Docs (G6)

- `WHAT_WE_BUILT.md` entry; `REGRESSION.md`: facts insert-only, declined is a fact, no card after a proxy quiz, pickers from data, purge keeps guests with facts.
- `WHAT_WE_BUILT_DB.md`: new tables, the three CHECK → FK changes, the `quiz_session_id` and `customer_words` columns, the `declined` op, the Firestore whitelist retired, the lookup-row lifecycle rule (A4), the small-list convention (D10), the one-value-table rule (D11), the purge guard (D13), the brand table and how it grows (D15, D17), the feeling-to-move FK (D19).
- `SOMMELIER_BUILT.md`: prompt field list now view-driven; `ask_when_empty`; the `|words` marker part.
- `CATALOG.md` regenerated.
- `OPEN_TASKS.md`:
  - "coffee_feeling in the first match: a later map brief may read `v_customer_coffee_feeling.move_code` when placing a quiz result (Dana 2026-11-12, capture first); nothing reads it today".
  - "usual_drink × roaster brew method: `roastery_portal_response_brew` holds the roaster's best method per coffee; a later map brief may filter or order candidates by the customer's drinks (base_method); nothing reads it today".
  - "post-result card, next field: home ZIP (customer-context design); the component takes a field list".
  - "cupboard_coffee: link partner brands to `roaster` rows by owner SQL; add brands from the `other` + words list on the admin row".
  - "usual_drink: pod drinkers (`base_method = pod`) are offered ground coffee as the closest fit (Dana 2026-10-24); nothing reads it yet".
  - "usual_drink: buy_out drinkers, later field 'what do you order' on the same card".

## Do not
- Do not add any of the three fields to the quiz questions or let them change the quiz result, the first match, the map, the dial, Liam's recommendation or the profile line.
- Do not create an offset, shift or redirect table, a roast or archetype attribute on a brand, or a "daily one" marker on the drinks.
- Do not derive any field from another field, an order or a conversation cue; Liam saves only what the customer named.
- Do not type a field name, value, label, prompt, alias, cap or mapping into code or a component; the FK in `brew_coffee_feeling` is the mapping.
- Do not show the card after a proxy quiz; do not write a fact for a proxy session.
- Do not touch `POST /api/quiz/results`, `matchService`, or anything under `ella_bloom_map`.
- Do not open a PR or hand Dana manual steps.
