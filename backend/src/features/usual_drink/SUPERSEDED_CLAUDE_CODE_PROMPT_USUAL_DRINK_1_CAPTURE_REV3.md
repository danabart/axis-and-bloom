# Usual Drink 1 — Capture the daily cup and the kitchen (no matching change) — Rev 3

**Rev 3 (2026-10-24, CTO review with Dana; Rev 2 of the same evening is replaced in place, never run).** Changes from Rev 2: a second field on the same card, `cupboard_coffee` ("which coffee is in your kitchen right now"), with a brand reference table, aliases for a typeahead, and an optional link to the `roaster` table (D15); a declined question is a fact row, `op = 'declined'`, and `op` moves to a lookup (D16); the customer's own words on an `other` pick are kept on the fact row (D17); picker and pinned quick-picks are data (D18). Rev 1 is kept as `SUPERSEDED_..._REV1.md`; its offset table, `lookup_table` text column and single-field card are gone.

**Goal:** Record, for each customer, (1) how they make their coffee at home, `usual_drink`, and (2) which coffee is in their kitchen right now, `cupboard_coffee`, as two new brew-profile fields captured from three places (one optional post-result quiz card, the Profile mirror, Liam) through the existing brew-profile rails. Move the brew-profile field definitions out of Firestore config and out of code into Postgres tables, so the next field is a row, not a deploy. Matching does not change in this brief.

**Why (context, not instructions):** The quiz measures the cup a person likes; the catalog measures bags cupped under one protocol (8.5 g / 150 g). Preparation is the transform between them, and the bag they start from is the other half of it. Case (2026-10-24): a taker scored a clean Balanced, drinks a Chocolate & Nutty bag (Big Trouble) as espresso with added water and cold milk, i.e. she dilutes a C&N bag into a Balanced cup. Her Balanced-branch answer ("light and delicate", the one meant to lead to Floral) was in fact a description of a C&N bag turned into a thin coffee. The quiz was right about the cup; we had no data about the bag or the preparation, so we could not know which bag produces that cup in her kitchen. The case was diagnosed from bag + preparation together, which is why both fields ship in one brief. Today's brew profile records `brew_methods` (array) and `takes_it` (black/milk/sugar), which describe the setup, not the daily drink and not the coffee. Drink names and brand names are vocabularies people can answer (quiz principle 2026-10-06: never ask people to judge dimensions). What neither carries is quantity (how much water, milk or sugar); that is accepted, never asked on a card.

**Decisions already made (Dana 2026-10-24), implement as stated, do not re-open:**

- D1. Preparation and the kitchen do NOT enter the quiz questions or change the quiz result. Collected after the result, optional.
- D2. Two fields, each single-valued: `usual_drink`, the drink they make **at home, most days**; `cupboard_coffee`, the coffee **in their kitchen right now** (the one they drink most, if several).
- D3. Answers are codes from value lists: drinks include "I mostly buy my coffee out" (`buy_out`) and `other`; brands include `dont_know`, `nothing` and `other`.
- D4. **No offset table in this brief.** Rev 1's `brew_drink_archetype_offset` is dropped: the two observations we have (Shir: Balanced cup from a C&N bag; Q3: four of five Floral matches are milk-first takers) are both archetype redirects, not slot steps, so a `slot_offset` column could not hold them; and the Balanced lane's ruler is itself undecided (dial seed orders it on brightness, cupping 2026-10-21 says sweetness), so "+1 toward stronger" on Balanced has no defined axis. A stored number without an axis is drift from day one, and a table of assumed weights is what the 2026-09-26 rule forbids. The hypothesis is written in `misc/palate_model/PALATE_MODEL_HYPOTHESIS.md` (Docs section) and a table is created when something reads it, shaped by the data by then. The same applies to brands: no roast level or archetype guess per brand.
- D5. Nothing in matching, the dial, Liam's recommendation or the profile line changes in this brief. Capture only.
- D6. Replace the hardcoded `CHECK (field IN (...))` and `CHECK (op IN (...))` on `customer_brew_profile_change`, the Firestore `sommelier_config.brewProfile.fields` whitelist and the TS `field` union with Postgres lookup tables. Rule: nothing hard coded; names, lists and mappings live in tables (2026-10-16).
- D7. Every new table has a surrogate `id` primary key; natural keys are UNIQUE constraints (2026-10-17).
- D8. The post-result screen is the single optional "a little about your coffee" card. This brief puts both questions on it, in this order: drink, then kitchen. The card is a component that renders a list of fields; home ZIP joins later as a third entry, not a redesign.
- D9. Naming: `customer_*` is reserved for insert-only fact tables (integrity check enforces it); `user_*` is per-user operating state; `coffee_*` is the catalog. Everything this brief adds about how customers prepare coffee and what they keep at home is operational reference data and takes the `brew_*` prefix. Per-customer derived reads stay `v_customer_*`. Fact discipline unchanged: facts are insert-only through `customerFacts.record.*`, reads go through `customerReads.ts` and views (`lint-customer.mjs` rules stay green), `COMMENT ON` every new table/view/column (data catalog rule), `CATALOG.md` regenerated.
- D10. **Small-list convention.** The repo has a generic `lookup_value (category, value, label, sort_order)` (schema L~1795), used by the catalog and the roastery portal. It was considered for the small lists here and rejected for two reasons that the comments on the new tables must state: it has no `is_active`, so the retire-never-delete lifecycle (A4) cannot be expressed; and a code column cannot FK to `UNIQUE (category, value)` without a constant-category composite FK. So each small list here is its own `brew_*` table with `id`, `code UNIQUE`, `label`, `sort_order`, `is_active`. This is the convention going forward for lists that facts reference by code; `lookup_value` stays for the lists already in it.
- D11. **One value table, no table name as data.** `brew_profile_field_value` holds every allowed value of every enum/array field, including the drinks and the brands. `brew_drink` and `brew_cupboard_brand` are decompositions of a value row, each keyed by `field_value_id` (FK, UNIQUE). No `lookup_table` text column, no dynamic SQL, no view branch naming a table. Label, code, sort order and active flag live once, on the value row.
- D12. `customer_brew_profile_change` gains a nullable `quiz_session_id UUID REFERENCES quiz_session(id)`, set only by the quiz writer. The customer-context design (loop/design/customer-context/DESIGN.md, D44) reads brewing fields "as of the current quiz"; that read must be a join, not a parse of `source_id`. `source_id` keeps the value for idempotency (B2).
- D13. The stale-guest purge (`services/staleGuestCleanup.ts`) never removes a guest who holds a `customer_brew_profile_change` row (any op, including `declined`). Same rule the customer-context design made for home location (its D29). Facts are never deleted and never re-pointed to a generic guest.
- D14. Archetype codes confirmed by Dana 2026-10-24: `chocolate_nutty`, `balanced_sweet`, `fruity`, `earthy`, `floral`, `experimental`. Nothing in this brief reads them; listed so nobody re-derives them.
- D15. **Brands are a reference table with search terms.** `brew_cupboard_brand` decomposes a `cupboard_coffee` value into `brand_kind` (a fact about the brand's channel, from `brew_cupboard_brand_kind`) and an optional `roaster_id → roaster(id)` so a customer who already has a partner roaster's coffee at home is linked to the catalog. `brew_cupboard_brand_alias` holds the strings a typeahead matches on. `roaster.name` is not unique and roasters are created in the app, so the seed never sets `roaster_id`; it is set by owner SQL when Dana decides the link.
- D16. **A declined question is a fact.** When the customer presses Save or Skip on the card, every card field they did not answer gets a `customer_brew_profile_change` row with `op = 'declined'`, `value NULL`, `quiz_session_id` set. The fold ignores it (its ELSE branch returns state unchanged, schema L~5692), so no `v_customer_*` view changes; per-field coverage is `set` over `set + declined` per session. This is the customer-context design's D4 (answered | declined) applied to brew-profile fields. `op` therefore moves to a lookup, `brew_profile_op`, with the same CHECK → FK treatment as `field`. Funnel events stay card-level (shown / saved / skipped) as the UX signal.
- D17. **The customer's own words.** A value row may carry `accepts_words = true` (the `other` rows of both fields). When such a value is picked, the fact row stores the customer's typed text in a new nullable column `customer_words TEXT`; on any other value the column is NULL and a write with words is rejected. This is how the brand list grows from data: the admin stats row lists `other` picks with their words. No free text anywhere else.
- D18. **Presentation is data.** `brew_profile_field.picker_id → brew_profile_picker` (select | typeahead | toggle) tells the card and the mirror which control to render; `brew_profile_field_value.pinned` marks the quick picks a typeahead shows before the customer types. No per-field code in any component.

## Task 0 — Survey and confirm (report before Part A; STOP if anything contradicts the decisions)

Report file:line for each:

1. `customer_brew_profile_change` (schema L~5288): the inline CHECKs on `field` and `op` and their auto-generated constraint names, read from `pg_constraint` (do not assume names). The `customer_brew_profile_fold()` aggregate behind `v_customer_brew_profile` (L~5667, L~5700): confirm the fold treats an unknown field name generically (it folds by op, not by field) and that an unknown op returns the state unchanged (the ELSE branch), so `declined` rows are invisible to every view. Confirm `quiz_session.id` is UUID (L~621) and `roaster.id` is UUID with `name` not UNIQUE (L~57).
2. `services/brewProfile.ts`: `getBrewProfileFieldsConfig()` (sync, returns a Record), `validateSingleValue()`, `normalizeFieldName()`, `formatBrewProfileSummary()`, `getStaleFieldNudge()` and its `TOPIC_TO_FIELD` map (L~134). Report which of these hold field names or allowed values in code or read them from `sommelierConfig`, and every call site that relies on `getBrewProfileFieldsConfig()` being synchronous.
3. `services/customerFacts.ts` L~141: `BrewProfileChangeInput.field` is a TS union, `op` is a union of four; `FactSource` (L~21) has no quiz source. Report every call site of `record.brewProfileChange` (expected: `routes/users.ts` PATCH/DELETE `/brew-profile`, `routes/sommelier.ts` `resolveRemember()`).
4. `routes/users.ts` L~893–L1026: `/brew-profile` routes use `requireAuth, blockAnonymousAuth`. Quiz takers are anonymous-auth guests (features/guest_identity). Confirm: an anonymous guest has a `user_profile` row (the `quiz_session.user_id` it saves under), so a fact can be recorded for them, and confirm `blockAnonymousAuth` means the existing PATCH cannot serve the post-result card. Part B uses a quiz-scoped route.
5. `frontend/src/app/components/FlavorQuiz.tsx`: where the result screen is shown (`resultHeroShown`, `saveQuizResult` call sites, L~552–560) and what the taker can do next (dial, naming, newsletter). Identify the one insertion point for an optional post-result card that does not block the reveal and does not sit in the ceremony. `frontend/src/app/components/profile/BrewProfileMirror.tsx`: how fields are rendered (per-field type → control) so the two new fields render from the options payload with no per-field code. Report whether the frontend already has a typeahead/combobox component (search `combobox|typeahead|autocomplete|Command`); if one exists it is reused, if not Part B2 builds one small one.
6. `sommelier_config_seed.ts` L~170 `brewProfile.fields` and `LIAM_BASE_PROMPT`'s "Remembering facts" section: how field names and allowed values reach the prompt. Liam must be able to say "latte, noted" and emit `<<remember:usual_drink=latte>>`, and "Counter Culture, noted" with `<<remember:cupboard_coffee=counter_culture>>`.
7. Counts (read-only, prod): `SELECT field, op, COUNT(*) FROM customer_brew_profile_change GROUP BY 1,2`; number of quiz sessions in the last 30 days (sizing the card's expected volume).
8. `quiz_funnel_event.event` (schema L~4237) is a hardcoded CHECK of four values; the three events Part B2 adds would be rejected. Confirm the CHECK's constraint name (from `pg_constraint`) and every writer of `quiz_funnel_event` (expected: `logQuizFunnelEvent` path in `routes/quiz.ts`). Part A3 replaces it.
9. `backend/scripts/lint-customer.mjs` Rule 7: no `CREATE OR REPLACE VIEW` inside the Customer Blueprint C3 block. Find the block markers; this brief's views go in their own marked block after it.
10. Prod Firestore `sommelier_config` doc: confirm the `brewProfile.fields` key is present (it is what Part B1 retires) and how `sommelierConfig.ts` caches config (TTL, per process), so the field-list cache in B1 follows the same pattern.
11. Grants (schema L~8639–8742): the prefix-driven blocks. Confirm which block a new `brew_*` table falls into today (expected: the operating catch-all with UPDATE/DELETE for `ab_app`) and that `brew_card_view_event` (L~969) is an app-written table that must keep its grants (so Part A6 lists tables explicitly, no `brew\_%` pattern).
12. How existing brew-profile writers encode `value` (expected `JSON.stringify(validatedValue)`, so a code is stored as `"latte"` with quotes) and how `customer_brew_profile_fold()` returns it; Part B must write both new fields the same way or the `brew_profile_field_value` join misses.
13. `routes/quiz.ts`: `funnelEventLimiter` (L~141) and how `POST /results` resolves the caller's profile from an anonymous token; Part B2's ownership check uses the same resolution.
14. `v_palate_evidence` counts brew fields; check `palateReads.test.ts` and the Dana-reviewed fixture for an asserted brew-field count that two more fields would change, and whether it counts rows by op (a `declined` row must not count as evidence; if the view counts all rows, Part A5 adds `op <> 'declined'` to it and the closing report says so). Do not change the fixture without saying so.
15. `services/staleGuestCleanup.ts`: the two candidate queries (L~43 "no quiz result", L~62 "last quiz > 90 days") and the delete sequence at L~125–140 (Firestore `recursiveDelete` first, then `DELETE FROM user_profile`, FK failure caught and counted as skipped). Confirm that a guest with a `customer_brew_profile_change` row and no order/verified email is today a purge candidate, and that an FK failure would leave the Firestore doc deleted and the Postgres row kept (a half-purged guest). Part A8 fixes the candidate queries.
16. `lookup_value` (schema L~1795): confirm it has no `is_active` column and that its only unique is `(category, value)` (the D10 reasons).
17. Repo on `main`, level with `origin/main`; report the hash. Dana merges to main directly, no PR.

## Part A — Tables (owner role applies `schema.sql` at boot; idempotent DDL as the rest of the file). Sections are in execution order.

Every small lookup below is `(id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL, sort_order INT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, created_at, updated_at)` unless more columns are listed. Seeds use `ON CONFLICT DO NOTHING` on the natural key so a boot never overwrites an edit made in the DB.

### A1. Field definitions

A1a. Lookups: `brew_profile_value_kind` (enum, array, bool, array_freeform); `brew_profile_picker` (select, typeahead, toggle); `brew_profile_op` (set, add, remove, clear, declined; the comment on `declined` says "asked on the post-result card and not answered; value NULL; ignored by the fold").

A1b. `brew_profile_field`:

```
id            SERIAL PRIMARY KEY
code          TEXT NOT NULL UNIQUE            -- brew_methods, grinder, takes_it, decaf_constraint, aversions, usual_drink, cupboard_coffee
label         TEXT NOT NULL                   -- customer-facing label on the Profile mirror
prompt        TEXT                            -- the question as asked on the card / by Liam; NULL = never on the card (kill switch, B2)
value_kind_id INT NOT NULL REFERENCES brew_profile_value_kind(id)
picker_id     INT NOT NULL REFERENCES brew_profile_picker(id)
max_items     INT                             -- arrays
max_item_len  INT                             -- array_freeform, and the length cap for customer_words (D17)
liam_topic    TEXT                            -- the HOME_TASK_2 router topic that makes a stale nudge relevant; replaces the in-code TOPIC_TO_FIELD map
sort_order    INT NOT NULL                    -- also the order on the card
is_active     BOOLEAN NOT NULL DEFAULT true
created_at / updated_at
```

Seed the five existing fields from today's config exactly (codes, kinds, max_items 8 for brew_methods, max_item_len 40 / max_items 10 for aversions, topics from `TOPIC_TO_FIELD`, picker select for enums/arrays, toggle for the bool), `prompt` NULL for all five. Insert `usual_drink` (enum, select, `liam_topic = 'my_coffee'`, label "How you usually drink it", prompt "How do you usually drink your coffee at home?", max_item_len 80) and `cupboard_coffee` (enum, typeahead, `liam_topic = 'my_coffee'`, label "What's in your kitchen", prompt "Which coffee is in your kitchen right now?", max_item_len 80), in that sort order after the existing five.

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

Seed brew_methods' 8, grinder's 5, takes_it's 4 from today's config exactly (labels: today's display strings where one exists, else the code), the drinks from A2a and the brands from A2b. `accepts_words = true` only on the two `other` rows.

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

Column comment on `brew_drink.milk_id`: `latte` groups cappuccino and flat white, whose milk ratios differ widely; `steamed` is a kind, not a quantity.

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

Seed. Value rows under `cupboard_coffee`, then `brew_cupboard_brand` by `(field, code)`, then aliases. Label is the brand's own spelling. Pinned rows sort first. Dana trims with `is_active`; new brands are rows added by owner SQL from the `other` + words list (Part D).

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

### A3. The CHECK → FK changes, the two new columns, and safety

A3a. `customer_brew_profile_change.field`: drop the CHECK found in Task 0.1 (by its real name, if present), add `FOREIGN KEY (field) REFERENCES brew_profile_field(code)` if absent. `customer_brew_profile_change.op`: same, FK to `brew_profile_op(code)`.

A3b. `quiz_funnel_event_type` (small lookup). Seed the four existing codes plus `post_result_shown`, `post_result_saved`, `post_result_skipped`. Drop the CHECK on `quiz_funnel_event.event` (name from Task 0.8), add `REFERENCES quiz_funnel_event_type(code)`. `logQuizFunnelEvent` validates against the table; an unknown code is logged and dropped, never a 500.

A3c. New columns on `customer_brew_profile_change`, both `ADD COLUMN IF NOT EXISTS`, nullable, existing rows NULL: `quiz_session_id UUID REFERENCES quiz_session(id)` (D12; comment: "set only by the quiz post-result writer; NULL for onsite and Liam writes") and `customer_words TEXT` (D17; comment: "the customer's typed text when the picked value has accepts_words; NULL otherwise; capped at the field's max_item_len").

A3d. Safety. Both tables hold data collected from people. Dana's rule: back up before touching such tables. Before the migration runs in prod: `pg_dump --table` of both to the backup location the quiz v2.2 brief (4A) used, plus row count and `md5(string_agg(... ORDER BY id))` of each table recorded; the same two numbers after, unchanged. The DDL itself must never fail boot: in the same `DO $$` block, count rows whose `field` / `op` / `event` has no lookup row; if zero, add the FK; if not, skip that FK, `RAISE WARNING` with the count, and leave it to integrity check 6 (Part D) to show the violators. No strict mode (2026-10-16).

### A4. Lookup-row lifecycle (applies to every table in A1, A2, A3b)

Rows in these tables are never deleted, only deactivated (`is_active = false`). Facts reference them by `code` through the FK, so a delete would fail anyway; the rule is stated so nobody works around it. Views join lookups regardless of `is_active` (a stored value whose option was retired must still resolve and display); only the pickers (mirror editor, card options, Liam's allowed list) filter to active rows. Seeds are initial load only (`ON CONFLICT DO NOTHING`): after boot the DB is the truth, and a label or alias edit belongs in the DB, not in the seed.

### A5. Views (new marked block in `schema.sql` after the Customer Blueprint C3 block; lint-customer Rule 7 forbids new views inside it)

- `v_brew_profile_field_current`: one row per field × allowed value, from `brew_profile_field` JOIN `brew_profile_value_kind` JOIN `brew_profile_picker` LEFT JOIN `brew_profile_field_value` LEFT JOIN `brew_cupboard_brand_alias` aggregated to `aliases TEXT[]` per value (bool and array_freeform fields appear once with NULL value columns). Columns: field id/code/label/prompt/value_kind/picker/max_items/max_item_len/liam_topic/sort_order/field_is_active, value id/code/label/sort_order/pinned/accepts_words/aliases/value_is_active. **This is the only thing the validator, the Profile mirror, the card options endpoint and the prompt builder read**, through one reader function (B1). Includes inactive rows; the reader filters.
- `v_customer_brew_profile` unchanged in shape (Task 0.1 confirms the fold is field-agnostic and ignores `declined`). If `v_palate_evidence` counts rows by op (Task 0.14), add `op <> 'declined'` there and say so.
- `v_customer_usual_drink`: one row per canonical customer with `field_value_id`, `code`, `label`, `base_method`, `dilution`, `milk`, `is_home_drink`, `customer_words`, `captured_at`, `source`, `quiz_session_id`: from `v_customer_brew_profile WHERE field = 'usual_drink'` joined to `brew_profile_field_value` on `value_jsonb #>> '{}' = code AND field_id = (usual_drink's id)`, then `brew_drink` and its lookups by id, regardless of `is_active` (A4). `customer_words` comes from the latest `set` row of that field for the customer.
- `v_customer_cupboard_coffee`: same shape for `cupboard_coffee`, with `brand_kind`, `roaster_id`, `customer_words`.
- Readers: `customerReads.getUsualDrink()`, `customerReads.getCupboardCoffee()`; callers in this brief: the Profile mirror (via the generic read) and the admin stats row (Part D). Not Liam's recommendation, not the dial.
- `GRANT SELECT ON v_brew_profile_field_current, v_customer_usual_drink, v_customer_cupboard_coffee TO reporting_ro` alongside the other named `reporting_ro` view grants (schema L~7688, L~8717), and SELECT on every `brew_*` table in A6 to `reporting_ro`.
- `COMMENT ON` every table, column and view in the catalog's format (Purpose | Class | Writer | Readers | Since). For every table in A1, A2 and A3b the Writer is `boot seed (owner role); edits by owner SQL, no app writer` and the Readers are exactly the functions named in this brief. The comment on each small lookup states the D10 reason it is not `lookup_value`. Regenerate `CATALOG.md`.

### A6. Grants for the new lookups

Reference tables have one writer, the boot seed under the owner role. Add a boot block, same shape as the quiz-content block (schema L~8722), for: `brew_profile_value_kind`, `brew_profile_picker`, `brew_profile_op`, `brew_profile_field`, `brew_profile_field_value`, `brew_drink`, `brew_drink_base_method`, `brew_drink_dilution`, `brew_drink_milk`, `brew_cupboard_brand`, `brew_cupboard_brand_kind`, `brew_cupboard_brand_alias`, `quiz_funnel_event_type`: `REVOKE ALL ... FROM ab_app; GRANT SELECT ... TO ab_app`. **Explicit list**, not `brew\_%`: `brew_card_view_event` is app-written and must keep its grants. Place it after the operating catch-all so it overrides it, as the quiz block does.

### A7. Removed in Rev 2

`brew_drink_archetype_offset` and `brew_offset_basis` (D4). If either exists in any environment from a Rev 1 run, report it and leave it; nothing is dropped (2026-10-16 rule).

### A8. Stale-guest purge (D13)

`services/staleGuestCleanup.ts`: both candidate queries (Task 0.15) gain `AND NOT EXISTS (SELECT 1 FROM customer_brew_profile_change c WHERE c.user_id = up.id)`. The fix is in the candidate selection, not in error handling: the Firestore delete runs before the Postgres delete, so a guest that fails on the FK is already half-purged. Log line gains `keptForFacts=<n>`. Integrity check 9 (Part D) counts guests who would be purge candidates but for a fact.

## Part B — Writers (all through `record.brewProfileChange`, one validator)

Reader rule for this brief: `v_brew_profile_field_current` has one reader, `getBrewProfileFieldsConfig()` in `services/brewProfile.ts`; the validator, the mirror's field list endpoint, the card options endpoint and the prompt builder all call it. No route SELECTs `brew_profile_field`, `brew_profile_field_value`, `brew_drink` or `brew_cupboard_brand*` directly. `customer_*` tables and `v_customer_*` views are read only from `customerReads.ts`.

B1. `services/brewProfile.ts`: `getBrewProfileFieldsConfig()` stays **synchronous** for its callers (Task 0.2). It serves a per-process cache loaded at boot (before the server accepts requests) and refreshed on a TTL taken from config, same pattern and same TTL source as `sommelierConfig.ts`, never a literal. A refresh failure keeps the last good list and logs; the cache is never empty after boot. Known window: after a DB edit, two Cloud Run instances can disagree for one TTL; state the TTL in the closing report. `validateSingleValue()` unchanged in behaviour, now driven by the view rows (enum/array: value must be an active value code of the field; bool/array_freeform as today). Delete `TOPIC_TO_FIELD`; read `liam_topic`. `BrewProfileChangeInput.field` and `.op` become `string`, validated at the door (`customerFacts.ts` checks the field exists and is active, the op exists, `declined` carries `value NULL` and a `quizSessionId`, `customerWords` is present only when the value row has `accepts_words` and is within `max_item_len`; any violation is a rejected write counted in `brew_profile.failures`, never a 500). Remove `brewProfile.fields` from `sommelier_config_seed.ts` and from the Firestore config read path; `staleAfterDays` and `maxMarkersPerTurn` stay where they are. One-off, owner role: delete the `brewProfile.fields` key from the prod `sommelier_config` doc (dry-run shows the key, apply, read back and assert absent). Otherwise the dead key stays editable in Firestore and someone will edit it believing it matters.

**No inference rule.** Neither `usual_drink` nor `cupboard_coffee` is ever derived from other fields, orders or anything else, not by a backfill, not by a view, not by Liam. A value exists only when the customer picked or named it.

B2. **Quiz post-result card.** New route `POST /api/quiz/post-result` (`requireAuth` only, anonymous allowed; body `{ quizSessionId, answers: [{ field, value, words? }], shown: [field] }`; `shown` is the list of fields the card rendered, so every shown field without an answer gets a `declined` row). **Ownership check:** resolve the caller's profile exactly as `POST /results` does and require `quiz_session.user_id` to equal it, else 403 and no write; without this, anyone could attach a fact to any session. Behind the same rate limiter as `POST /event`. `value` encoded exactly as the existing writers do (Task 0.12). Per field, validates via B1 and records `record.brewProfileChange({ userId, source: 'quiz', sourceId: '<quiz_session_id>:<field>:<value|declined>', quizSessionId, field, op: 'set' | 'declined', value, customerWords })`; one transaction for the whole card. `quizSessionId` and `customerWords` are new optional inputs on `BrewProfileChangeInput`. Add `'quiz'` to `FactSource`. Idempotent by `UNIQUE (source, source_id)`: resubmitting the same card is a no-op (`inserted: false` per row); changing an answer is a new row and the fold's latest `occurred_at` wins; a decline followed by an answer leaves both rows (both true at their time). Skip submits the same body with no answers, so every shown field gets `declined`.

Front end: after the result is saved and the reveal has finished, one optional card. `GET /api/quiz/post-result/options` returns, from `getBrewProfileFieldsConfig()`, the fields that are card-eligible (`is_active` and `prompt` non-null) in `sort_order`, each with its prompt, picker, `max_item_len`, and its active values (code, label, pinned, accepts_words, aliases). The component renders one control per field by `picker`: `select` as today's mirror select; `typeahead` as a text input that filters the field's values client-side on label and aliases (case- and diacritic-insensitive, prefix or word match), showing the `pinned` values before any typing and the matches after, with no server round trip; `toggle` for bools. Picking a value with `accepts_words` reveals a short text input capped at `max_item_len`. Buttons Save / Skip, no strings in the component except what the payload carries. If Task 0.5 found a combobox component in the frontend, reuse it; otherwise write one small one under `components/quiz/`. **Kill switch:** setting a field's `prompt` to NULL or `is_active` to false removes that question on the next cache refresh, no deploy; an empty field list renders no card. Log funnel events the way the other result-screen actions do (`logQuizFunnelEvent`): `post_result_shown`, `post_result_saved`, `post_result_skipped`, card-level.

B3. **Profile mirror.** `BrewProfileMirror.tsx` renders every active field from the options served by `getBrewProfileFieldsConfig()` by `picker`, with the same typeahead component for `cupboard_coffee`; both new fields are editable and deletable like the others, no per-field code. PATCH/DELETE `/brew-profile` unchanged except the validator source and the optional `words` on PATCH.

B4. **Liam.** The prompt's "Remembering facts" field list is built from `getBrewProfileFieldsConfig()` (field codes + active value codes; for `cupboard_coffee` the label and aliases too, so Liam can map "I buy the Costco one" to `kirkland`), not typed in the prompt. One addition to the base prompt text: when `usual_drink` is absent from the brew-profile line and the customer **names the drink or describes the full preparation** ("espresso with hot water and a splash of cold milk" → `americano_milk`), confirm in voice and emit `<<remember:usual_drink=<code>>>`; never from a partial cue ("I add milk" is `takes_it`, not a drink). Likewise when `cupboard_coffee` is absent and the customer **names a brand they have at home** ("I've got Counter Culture in the cupboard" → `counter_culture`); a brand not on the list is `other` with the words (`<<remember:cupboard_coffee=other|Café du Monde>>`, the marker grammar extended by one optional `|words` part, parsed in `resolveRemember()`). When present, never re-ask except through the existing stale-nudge rule. No new topics in the router.

## Part C — Backfill: none

No historical data exists for either field. The existing `customer_brew_profile_change` rows must satisfy the new FKs (Task 0.7 lists their `field` and `op` values; they are from today's whitelists, so they will). Nothing is deleted.

## Part D — Visibility

- Admin brew-profile stats row (`AdminSommelierFlow.tsx`, `brewProfileStats`): counts per field (customers with a value; declined per field; coverage = set / (set + declined) over quiz-sourced rows), the `usual_drink` distribution by drink, the `cupboard_coffee` distribution by brand and by brand kind, and the list of `other` picks with `customer_words` (newest first; this is where new brands come from). All through one new `customerReads.getBrewProfileFieldCounts()` over `v_customer_brew_profile`, `v_customer_usual_drink`, `v_customer_cupboard_coffee` and `customer_brew_profile_change` (for declines and words). No other file SELECTs these (lint-customer rule 4).
- `customerIntegrity.ts`, new boot checks, all informational (no strict mode, 2026-10-16 lint posture), each shown on the admin integrity panel with its detail rows:
  1. Every `customer_brew_profile_change.field` is a `brew_profile_field.code` and every `op` a `brew_profile_op.code` (FKs make this structural; the check reports inactive fields that still carry facts, which is allowed and should be visible).
  2. Every active enum/array field has at least one active value row in `brew_profile_field_value`; every bool/array_freeform field has none; every typeahead field has at least one pinned value.
  3. Every `set`/`add`/`remove` value for an enum or array field resolves to a `brew_profile_field_value` row of that field, active or not. A non-resolving value is a drift row; list it.
  4. Every `usual_drink` value row has exactly one `brew_drink` row and every `brew_drink.field_value_id` points at a `usual_drink` value; same for `cupboard_coffee` and `brew_cupboard_brand`. Every `brew_cupboard_brand.roaster_id`, when set, exists in `roaster`.
  5. Seed coverage: every code in the seed arrays for `brew_profile_field`, `brew_profile_field_value`, the small lookups and `quiz_funnel_event_type` exists in the DB (detects a seed that failed at boot; the reverse direction, rows in the DB not in the seed, is allowed and expected as brands are added).
  6. FK state: the three FKs from A3a/A3b exist; if any was skipped at boot, list the violating rows (value and count).
  7. Firestore `sommelier_config` has no `brewProfile.fields` key (30-day check, same expiry pattern as check 15).
  8. `ab_app` holds no INSERT/UPDATE/DELETE on any table in the A6 list (reads `information_schema.role_table_grants`); `brew_card_view_event` is not in the list and keeps its INSERT.
  9. Purge guard: count of guests who match the purge candidate queries except for holding a `customer_brew_profile_change` row (kept for facts, D13). Informational.
  10. `takes_it` vs `usual_drink` (informational, data about the customer, not an error): per customer with both, list those where `takes_it` implies milk and the drink's milk is `none`, or `takes_it` is black and the drink's milk is not `none`. And `cupboard_coffee = nothing` with `usual_drink` not `buy_out`. Counts shown on the admin row.
  11. Row shape: every `source = 'quiz'` row has a non-null `quiz_session_id` whose session belongs to the row's `user_id` (or an identity linked to it); every non-quiz row has NULL; every `declined` row has `value NULL`, `source = 'quiz'` and a `quiz_session_id`; `customer_words` is non-null only where the resolved value row has `accepts_words`.
- `lint-customer.mjs`: rule 3 (Firestore writes) gains nothing; confirm the removal of the Firestore whitelist read leaves no allow-list entry dangling.

## Part E — Definition of done (one closing report)

1. `npm run lint:catalog && npm run lint:customer && npm test` green locally (pre-existing failure count unchanged, state it).
2. Test DB: the three writers each produce `customer_brew_profile_change` rows for both fields (`source` = `quiz` / `onsite` / `liam`), only quiz rows have `quiz_session_id`; `v_customer_brew_profile` shows both fields; `v_customer_usual_drink` resolves base_method/dilution/milk and `v_customer_cupboard_coffee` resolves brand_kind for all three sources (proves the encoding matches); a card with `shown = [usual_drink, cupboard_coffee]` and one answer inserts one `set` and one `declined` row; Skip inserts two `declined` rows; resubmitting the same card inserts nothing; changing an answer inserts a new row and the fold shows the new value; `declined` rows change no view; an `other` pick with words stores them and a non-`other` pick with words is rejected and counted; words over `max_item_len` are rejected; an invalid code (`usual_drink=unicorn`) is dropped and counted; deactivating a value row removes it from the options endpoint and the mirror's editor without a deploy, while a customer who already stored that code still sees it displayed; setting a field's `prompt` to NULL removes that question; the options payload for `cupboard_coffee` carries `picker = typeahead`, pinned rows and aliases; Liam's `<<remember:cupboard_coffee=other|Café du Monde>>` lands as `other` + words; an anonymous guest answers the card, then signs up (a `customer_identity_link` lands), and `v_customer_brew_profile` for the canonical user shows the guest's values; an anonymous guest with a brew-profile row, last quiz 91 days ago, no order, no verified email, is NOT selected by either purge query (and a guest without the row still is); the three funnel events insert against `quiz_funnel_event_type`; a `POST /api/quiz/post-result` for a session the caller does not own returns 403 and inserts nothing; as `ab_app`, an INSERT into `brew_drink`, `brew_cupboard_brand` and `brew_profile_field_value` is denied.
3. `grep -rn "brew_drink_archetype_offset\|brew_offset_basis\|lookup_table" backend/src frontend/src` returns nothing (Rev 1 shapes did not leak in). `grep -rn "usual_drink\|cupboard_coffee" frontend/src` returns no component logic keyed on either code (the component renders whatever the options endpoint returns).
4. Prod, before deploy: the A3d backups taken and the before-numbers recorded in the closing report; after deploy, the after-numbers equal them.
5. Commit by explicit file list, `git diff --cached --stat` shown first. Message: `usual_drink + cupboard_coffee: capture the daily cup and the kitchen; brew-profile fields as tables; declined is a fact; purge keeps guests with facts`. Push to main deploys; boot log shows the schema applied and the new integrity checks green.
6. Prod smoke with the test user (`quiz-scenario-test@axisandbloom.test`, exclude from analysis): take the quiz, answer the drink and skip the kitchen (one `set`, one `declined`, both with `quiz_session_id`); set the kitchen from the Profile mirror through the typeahead (type "count", pick Counter Culture); admin stats row shows both distributions and the coverage.
7. Closing report in this folder (`CLOSING_REPORT_1.md`): Task 0 findings, every deviation, the seeded drink and brand rows as tables, the cache TTL, and the open items listed under Docs.

## Docs

- `WHAT_WE_BUILT.md` entry.
- `WHAT_WE_BUILT_DB.md`: new tables, the three CHECK → FK changes (`customer_brew_profile_change.field`, `.op`, `quiz_funnel_event.event`), the `quiz_session_id` and `customer_words` columns, the `declined` op, the Firestore whitelist retired, the lookup-row lifecycle rule (A4), the small-list convention (D10), the one-value-table rule (D11), the purge guard (D13), the brand table and how it grows (D15, D17).
- `SOMMELIER_BUILT.md`: prompt field list now view-driven; the `|words` marker part.
- `CATALOG.md` regenerated.
- `misc/palate_model/PALATE_MODEL_HYPOTHESIS.md`: add a section "Preparation and the bag at home as the transform (hypothesis, 2026-10-24, untested)": the quiz measures the cup, the catalog measures bags under one protocol, the bag at home and its preparation sit between; the two observations (Shir, Q3 Floral milk-first) are both archetype redirects, not slot moves; water- and ice-diluted drinks are expected to point from the cup's archetype toward a stronger bag (Balanced → C&N), milk-first drinks on Fruity/Floral results are expected to point away from delicate coffees; brand kind is expected to interact with location (the C&N default may hold only in big cities); direction and size unknown, decided from `v_customer_usual_drink` × `v_customer_cupboard_coffee` × quiz result × orders/feedback once there are rows, or from cupping the Balanced flight as americano + cold milk. No table until something reads it.
- `OPEN_TASKS.md`:
  - "post-result card, next field: home ZIP (customer-context design); the component takes a field list, ZIP's own fact table records its own answered/declined".
  - "cupboard_coffee: link partner brands to `roaster` rows by owner SQL (`brew_cupboard_brand.roaster_id`); add brands from the `other` + words list on the admin row".
  - "usual_drink: pod drinkers (`brew_drink.base_method = pod`) are offered ground coffee as the closest fit (Dana 2026-10-24); commerce reads base_method later, nothing reads it in brief 1".
  - "usual_drink: buy_out drinkers, later field 'what do you order' on the same card".
  - "offset/redirect table only when matching reads it; hypothesis in PALATE_MODEL_HYPOTHESIS.md".
