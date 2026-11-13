# Usual Drink 1 — Capture the daily cup (no matching change)

**Goal:** Record how each customer makes their coffee at home, as one new brew-profile field `usual_drink`, captured from three places (an optional post-result quiz screen, the Profile mirror, Liam) through the existing brew-profile rails. Move the brew-profile field definitions out of Firestore config and out of code into Postgres tables, so the next field is a row, not a deploy. Seed a drink × archetype offset table as a stated hypothesis that **nothing reads yet**. Matching does not change in this brief.

**Why (context, not instructions):** The quiz measures the cup a person likes; the catalog measures bags cupped under one protocol. Preparation is the transform between them. Case (2026-10-24): a taker scored a clean Balanced, drinks a Chocolate & Nutty bag (Big Trouble) as espresso with added water and cold milk, i.e. she dilutes a C&N bag into a Balanced cup. The quiz was right about the cup; we had no data about the preparation, so we could not know which bag produces that cup in her kitchen. Today's brew profile records `brew_methods` (array) and `takes_it` (black/milk/sugar), which describe the setup, not the daily drink: it cannot say "americano with cold milk", and it cannot say which of several methods is the one used most days. Drink names are the vocabulary people can answer (quiz principle 2026-10-06: never ask people to judge dimensions).

**Decisions already made (Dana 2026-10-24), implement as stated, do not re-open:**

- D1. Preparation does NOT enter the quiz questions or change the quiz result. It is collected after the result, optional.
- D2. One field, `usual_drink`: the drink they make **at home, most days**. Single value. (A second "also" drink is a later field if Liam keeps hearing it.)
- D3. Answers are drink names from a lookup table, including "I mostly buy my coffee out" (`buy_out`) and `other`.
- D4. Offset hypothesis is keyed by **drink × archetype**, not drink alone. Hypothesis seed: water-diluted drinks = one step toward stronger on the intensity line (Balanced, Chocolate & Nutty, Earthy); milk-only = 0; Fruity and Floral = 0 for every drink (milk masks acidity and fruit; that is not a move along a line). `buy_out` and `other` carry no offset row. Basis column says `hypothesis`; it flips to `cupping` or `customer_data` only by a later decision.
- D5. Nothing in matching, the dial, Liam's recommendation or the profile line reads the offset table in this brief. Capture only.
- D6. Replace the hardcoded `CHECK (field IN (...))` on `customer_brew_profile_change`, the Firestore `sommelier_config.brewProfile.fields` whitelist and the TS `field` union with Postgres lookup tables. Rule: nothing hard coded; names, lists and mappings live in tables (2026-10-16).
- D7. Every new table has a surrogate `id` primary key; natural keys are UNIQUE constraints (2026-10-17).
- D8. The post-result screen is the single optional "a little about your coffee" screen. This brief puts the drink question on it. The customer-context work adds home ZIP to the **same** screen later; build the screen so a second field is an addition, not a redesign.
- D9a. Naming: `customer_*` is reserved for insert-only fact tables (integrity check enforces it); `user_*` is per-user operating state; `coffee_*` is the catalog. Everything this brief adds about how customers prepare coffee is operational reference data and takes the `brew_*` prefix (`brew_profile_*`, `brew_drink_*`, `brew_offset_basis`). The per-customer derived read stays `v_customer_usual_drink`, like the other `v_customer_*` views.
- D9. Fact discipline unchanged: facts are insert-only through `customerFacts.record.*`, reads go through `customerReads.ts` and views (`lint-customer.mjs` rules stay green), `COMMENT ON` every new table/view/column (data catalog rule), `CATALOG.md` regenerated.

## Task 0 — Survey and confirm (report before Part A; STOP if anything contradicts the decisions)

Report file:line for each:

1. `coffee_archetype`: the exact `code` values (schema L~48 shows `name`; `coffee_dial_slot.archetype` references `coffee_archetype(code)` as `archetype_enum`). List all codes. Confirm which three are the intensity line (expected `balanced_sweet`, `chocolate_nutty`, the earthy code) and the two directions (`floral`, `fruity`). Confirm whether `experimental` is an archetype code; if it is, it gets no offset rows.
2. `coffee_dial_slot.sort_order` direction: which end (1 or 4) is the stronger/bolder end of a lane, per the seeded `position_label`s. The offset table stores "steps toward stronger"; the comment on the column must state the translation to `sort_order` you found, so the future reader does not guess.
3. `customer_brew_profile_change` (schema + `customer_blueprint_1_2026_09_27.sql` L126): the `field` CHECK and the `customer_brew_profile_fold()` aggregate behind `v_customer_brew_profile` (schema L~5707). Confirm the fold treats an unknown field name generically (it folds by op, not by field), so a new field needs no view change.
4. `services/brewProfile.ts`: `getBrewProfileFieldsConfig()`, `validateSingleValue()`, `normalizeFieldName()`, `formatBrewProfileSummary()`, `getStaleFieldNudge()` and its topic→field map. Report which of these hold field names or allowed values in code or read them from `sommelierConfig`.
5. `services/customerFacts.ts` L141: `BrewProfileChangeInput.field` is a TS union; `FactSource` (L21) has no quiz source. Report every call site of `record.brewProfileChange` (expected: `routes/users.ts` PATCH/DELETE `/brew-profile`, `routes/sommelier.ts` `resolveRemember()`).
6. `routes/users.ts` L893–L1026: `/brew-profile` routes use `requireAuth, blockAnonymousAuth`. Quiz takers are anonymous-auth guests (features/guest_identity). Confirm: an anonymous guest has a `user_profile` row (the quiz_session.user_id it saves under), so a fact can be recorded for them, and confirm `blockAnonymousAuth` means the existing PATCH cannot serve the post-result screen. Part B uses a quiz-scoped route.
7. `frontend/src/app/components/FlavorQuiz.tsx`: where the result screen is shown (`resultHeroShown`, `saveQuizResult` call sites, L~552–560) and what the taker can do next (dial, naming, newsletter). Identify the one insertion point for an optional post-result screen that does not block the reveal and does not sit in the ceremony. `frontend/src/app/components/profile/BrewProfileMirror.tsx`: how fields are rendered (per-field type → control) so `usual_drink` renders as a select from the lookup with no per-field code.
8. `sommelier_config_seed.ts` L~170 `brewProfile.fields` and `LIAM_BASE_PROMPT`'s "Remembering facts" section: how field names and allowed values reach the prompt. Liam must be able to say "latte, noted" and emit `<<remember:usual_drink=latte>>`.
9. Counts (read-only): `SELECT field, COUNT(*) FROM customer_brew_profile_change GROUP BY field` in prod; number of quiz sessions in the last 30 days (sizing the screen's expected volume).
10. `quiz_funnel_event.event` (schema L~4237) is a hardcoded CHECK of four values; the three events Part B2 adds would be rejected. Confirm the CHECK's name and every writer of `quiz_funnel_event` (expected: `logQuizFunnelEvent` path in `routes/quiz.ts`). Part A5 replaces it.
11. `backend/scripts/lint-customer.mjs` Rule 7: no `CREATE OR REPLACE VIEW` inside the Customer Blueprint C3 block. Find the block markers; this brief's views go in their own marked block after it.
12. Prod Firestore `sommelier_config` doc: confirm the `brewProfile.fields` key is present (it is what Part B1 retires) and how `sommelierConfig.ts` caches config (TTL, per process), so the field-list cache in B1 follows the same pattern.
13. Grants (schema L~8639–8742): the prefix-driven blocks. Confirm which block a new `brew_*` table falls into today (expected: the operating catch-all with UPDATE/DELETE for `ab_app`) and that `brew_card_view_event` is an app-written table that must keep its grants (so Part A7 lists tables explicitly, no `brew\_%` pattern).
14. How existing brew-profile writers encode `value` (expected `JSON.stringify(validatedValue)`, so a code is stored as `"latte"` with quotes) and how `customer_brew_profile_fold()` returns it; Part B2/B3 must write `usual_drink` the same way or the `brew_drink` join misses.
15. `routes/quiz.ts`: `funnelEventLimiter` (L~141) and how `POST /results` resolves the caller's profile from an anonymous token; Part B2's ownership check uses the same resolution.
16. `v_palate_evidence` counts brew fields; check `palateReads.test.ts` and the Dana-reviewed fixture for an asserted brew-field count that a sixth field would change. Report; do not change the fixture without saying so in the closing report.
17. Repo on `main`, level with `origin/main`; report the hash. Dana merges to main directly, no PR.

## Part A — Tables (owner role applies `schema.sql` at boot; idempotent DDL as the rest of the file)

### A1. `brew_profile_field` (the field whitelist, replacing Firestore config + CHECK + TS union)

```
id            SERIAL PRIMARY KEY
code          TEXT NOT NULL UNIQUE            -- brew_methods, grinder, takes_it, decaf_constraint, aversions, usual_drink
label         TEXT NOT NULL                   -- customer-facing label on the Profile mirror
prompt        TEXT                            -- the question as asked on the quiz card / by Liam (usual_drink: "How do you usually drink your coffee at home?"); UI copy is a row, not a component string
value_kind    TEXT NOT NULL REFERENCES brew_profile_value_kind(code)   -- enum | array | bool | array_freeform (lookup table, A1a)
lookup_table  TEXT                            -- when set, allowed values are the active rows of this table's code column (usual_drink → brew_drink)
max_items     INT                             -- arrays
max_item_len  INT                             -- array_freeform
liam_topic    TEXT                            -- the HOME_TASK_2 router topic that makes a stale nudge relevant (brewing, equipment, caffeine_decaf, my_coffee); replaces the in-code map
sort_order    INT NOT NULL
is_active     BOOLEAN NOT NULL DEFAULT true
created_at / updated_at
```

A1a. `brew_profile_value_kind (id SERIAL PK, code TEXT UNIQUE, description)` with the four kinds. A1b. `brew_profile_field_value (id SERIAL PK, field_id INT REFERENCES brew_profile_field(id), code TEXT, label TEXT, sort_order INT, is_active BOOLEAN, UNIQUE (field_id, code))`: the allowed values for fields that have no `lookup_table` (brew_methods' 8, grinder's 5, takes_it's 4), seeded from today's config exactly. Seed with `ON CONFLICT (code) DO NOTHING` / `ON CONFLICT (field_id, code) DO NOTHING` so a boot never overwrites an edit made in the DB.

Replace the `CHECK (field IN (...))` on `customer_brew_profile_change` with `field TEXT NOT NULL REFERENCES brew_profile_field(code)` (idempotent: drop the named check if present, add the FK if absent; the two existing prod rows must satisfy it, confirm first). `op` CHECK stays.

### A2. `brew_drink` (the answer list)

```
id            SERIAL PRIMARY KEY
code          TEXT NOT NULL UNIQUE
label         TEXT NOT NULL                   -- what the customer sees
base_method   TEXT NOT NULL REFERENCES brew_drink_base_method(code)   -- espresso | filter | immersion | cold_brew | stovetop | pod | none
dilution      TEXT NOT NULL REFERENCES brew_drink_dilution(code)      -- none | water | ice
milk          TEXT NOT NULL REFERENCES brew_drink_milk(code)          -- none | cold | steamed
is_home_drink BOOLEAN NOT NULL DEFAULT true   -- false for buy_out
sort_order    INT NOT NULL
is_active     BOOLEAN NOT NULL DEFAULT true
created_at / updated_at
```

The three small lookups are tables (id PK, code UNIQUE, label), not CHECKs. Seed (Dana approved the list 2026-10-24; `is_active` is how she trims it):

| code | label | base_method | dilution | milk |
|---|---|---|---|---|
| espresso | Espresso, straight | espresso | none | none |
| americano | Americano (espresso + hot water) | espresso | water | none |
| americano_milk | Americano with milk | espresso | water | cold |
| latte | Latte, cappuccino or flat white | espresso | none | steamed |
| iced_latte | Iced latte | espresso | ice | cold |
| drip_black | Drip or pour-over, black | filter | none | none |
| drip_milk | Drip or pour-over with milk | filter | none | cold |
| french_press | French press or AeroPress | immersion | none | none |
| cold_brew | Cold brew | cold_brew | none | none |
| moka_turkish | Moka pot or Turkish | stovetop | none | none |
| pod | Pod machine | pod | none | none |
| buy_out | I mostly buy my coffee out | none | none | none  (is_home_drink=false) |
| other | Something else | none | none | none |

Insert `usual_drink` into `brew_profile_field` with `value_kind='enum'`, `lookup_table='brew_drink'`, `liam_topic='my_coffee'`, label "How you usually drink it".

### A3. `brew_drink_archetype_offset` (hypothesis, unread)

```
id            SERIAL PRIMARY KEY
drink_id      INT NOT NULL REFERENCES brew_drink(id)
archetype     archetype_enum NOT NULL REFERENCES coffee_archetype(code)
slot_offset   SMALLINT NOT NULL              -- steps toward STRONGER on the archetype's lane; 0 = no move. Column comment states the sort_order translation from Task 0.2
basis         TEXT NOT NULL REFERENCES brew_offset_basis(code)   -- hypothesis | cupping | customer_data (lookup table)
since         TIMESTAMPTZ NOT NULL DEFAULT now()
superseded_at TIMESTAMPTZ
note          TEXT
UNIQUE (drink_id, archetype, since)
```
plus `CREATE UNIQUE INDEX brew_drink_archetype_offset_current ON brew_drink_archetype_offset (drink_id, archetype) WHERE superseded_at IS NULL` (same pattern as `evidence_parameter`). A changed offset is a new row that supersedes, never an UPDATE of the value. Seed per D4 as an **explicit row list** (drink code, archetype code, offset, note), not a rule computed in the seed script: a rule would embed the mapping "which archetypes are the intensity line" in code, and that concept does not yet exist as data. Rows: for `balanced_sweet`, `chocolate_nutty` and the earthy code (Task 0.1), `+1` for `americano`, `americano_milk`, `iced_latte`, `0` for every other home drink; for `floral` and `fruity`, `0` for every home drink with note "milk masks acidity/fruit; direction unknown, not a lane move"; no rows for `buy_out`/`other`. Every seeded row `basis='hypothesis'`, note "Dana 2026-10-24, from one case (Shir); untested". Seed guard like `evidence_parameter` (insert only when no current row exists for the pair).

### A5. `quiz_funnel_event_type`

`id SERIAL PK, code TEXT UNIQUE, label TEXT, sort_order INT, is_active BOOLEAN`. Seed the four existing codes plus `post_result_shown`, `post_result_saved`, `post_result_skipped`. Replace the CHECK on `quiz_funnel_event.event` with `REFERENCES quiz_funnel_event_type(code)` (idempotent, existing rows satisfy it). `logQuizFunnelEvent` validates against the table, an unknown code is logged and dropped, never a 500.

### A6. Lookup-row lifecycle (applies to A1, A2, A3, A5)

Rows in these tables are never deleted, only deactivated (`is_active=false`). Facts reference them by `code` through the FK, so a delete would fail anyway; the rule is stated so nobody works around it. Views join lookups regardless of `is_active` (a stored value whose option was retired must still resolve and display); only the pickers (mirror editor, quiz card options, Liam's allowed list) filter to active rows. Seeds are initial load only (`ON CONFLICT DO NOTHING`): after boot the DB is the truth, and a label edit belongs in the DB, not in the seed.

### A7. Grants for the new lookups

Reference tables have one writer, the boot seed under the owner role. Add a boot block, same shape as the quiz-content block (schema L~8722): for `brew_profile_field`, `brew_profile_value_kind`, `brew_profile_field_value`, `brew_drink`, `brew_drink_base_method`, `brew_drink_dilution`, `brew_drink_milk`, `brew_offset_basis`, `brew_drink_archetype_offset`, `quiz_funnel_event_type`: `REVOKE ALL ... FROM ab_app; GRANT SELECT ... TO ab_app`. **Explicit list**, not `brew\_%`: `brew_card_view_event` is app-written and must keep its grants. Place it after the operating catch-all so it overrides it, as the quiz block does.

### A8. Safety of the two CHECK → FK changes

Both `customer_brew_profile_change` and `quiz_funnel_event` hold data collected from people. Dana's rule: back up before touching such tables. Before the migration runs in prod: `pg_dump --table` of both to the backup location the quiz v2.2 brief (4A) used, plus row count and `md5(string_agg(... ORDER BY id))` of each table recorded; the same two numbers after, unchanged. The DDL itself must never fail boot: in the same `DO $$` block, count rows whose `field` / `event` has no lookup row; if zero, add the FK; if not, skip the FK, `RAISE WARNING` with the count, and leave it to integrity check 7 (Part D) to show the violators. No strict mode (2026-10-16).

### A4. Views

- `v_brew_profile_field_current`: active fields with their allowed values resolved (from `brew_profile_field_value` or from `lookup_table`'s active rows), one row per field × value. **This is the only thing the validator, the Profile mirror and the prompt builder read.**
- `v_customer_brew_profile` unchanged (Task 0.3 confirms the fold is field-agnostic). Add `v_customer_usual_drink`: one row per canonical customer with `drink_id`, `code`, `base_method`, `dilution`, `milk`, `captured_at`, `source`, joined from `v_customer_brew_profile WHERE field='usual_drink'`. Reader: `customerReads.getUsualDrink()`; callers in this brief: the Profile mirror (via the generic read) and the admin stats row (Part D). Not Liam's recommendation, not the dial.
- All new views live in a new marked block in `schema.sql` after the Customer Blueprint C3 block (lint-customer Rule 7 forbids new views inside it).
- `GRANT SELECT ON v_brew_profile_field_current, v_customer_usual_drink TO reporting_ro` alongside the other named `reporting_ro` view grants (schema L~7688, L~8717), and SELECT on the `brew_*` lookups to `reporting_ro` so Dana can analyse `usual_drink` against orders from the reporting side.
- `v_customer_usual_drink` joins `brew_drink` on `value_jsonb #>> '{}' = code`, regardless of `is_active` (A6).
- `COMMENT ON` every table, column and view in the catalog's format (Purpose | Class | Writer | Readers | Since). For `brew_profile_field`, `brew_profile_field_value`, `brew_drink`, the three drink lookups, `brew_offset_basis` and `brew_drink_archetype_offset` the Writer is `boot seed (owner role); edits by owner SQL, no app writer` and the Readers are exactly the functions named in this brief. Regenerate `CATALOG.md`.

## Part B — Writers (all through `record.brewProfileChange`, one validator)

Reader rule for this brief: `v_brew_profile_field_current` has one reader, `getBrewProfileFieldsConfig()` in `services/brewProfile.ts`; the validator, the mirror's field list endpoint, the quiz options endpoint and the prompt builder all call it. `customer_*` tables and `v_customer_*` views are read only from `customerReads.ts`.

B1. `services/brewProfile.ts`: `getBrewProfileFieldsConfig()` reads `v_brew_profile_field_current` (cached per process, TTL taken from config, same pattern as `sommelierConfig.ts`, never a literal; never a per-request query inside the validator loop). Known window: after a DB edit, two Cloud Run instances can disagree for one TTL; state the TTL in the closing report. `validateSingleValue()` unchanged in behaviour, now driven by the view. Delete the in-code topic→field map in `getStaleFieldNudge()`; read `liam_topic`. `BrewProfileChangeInput.field` becomes `string`, validated against the view at the door (`customerFacts.ts` checks the field exists and is active; an unknown field is a rejected write counted in `brew_profile.failures`, never a 500). Remove `brewProfile.fields` from `sommelier_config_seed.ts` and from the Firestore config read path; `staleAfterDays` and `maxMarkersPerTurn` stay where they are. One-off, owner role: delete the `brewProfile.fields` key from the prod `sommelier_config` doc (dry-run shows the key, apply, read back and assert absent). Otherwise the dead key stays editable in Firestore and someone will edit it believing it matters.

**No inference rule.** `usual_drink` is never derived from `takes_it` + `brew_methods`, not by a backfill, not by a view, not by Liam. A value exists only when the customer picked or named it.

B2. **Quiz post-result screen.** New route `POST /api/quiz/post-result` (`requireAuth` only, anonymous allowed; body `{ quizSessionId, usual_drink }`). **Ownership check:** resolve the caller's profile exactly as `POST /results` does and require `quiz_session.user_id` to equal it, else 403 and no write; without this, anyone could attach a fact to any session. Behind the same rate limiter as `POST /event`. `value` encoded exactly as the existing writers do (Task 0.14). Validates via B1, records `record.brewProfileChange({ userId, source: 'quiz', sourceId: '<quiz_session_id>:usual_drink:<value>', field: 'usual_drink', op: 'set', value })`. Add `'quiz'` to `FactSource`. Idempotent by `UNIQUE (source, source_id)`: resubmitting the same answer is a no-op (`inserted: false`); changing the answer on the same card is a new row and the fold's latest `occurred_at` wins. (Without the value in `source_id`, a changed answer would be silently dropped.) Front end: after the result is saved and the reveal has finished, one optional card whose question text is `brew_profile_field.prompt` for `usual_drink` (served by the options endpoint alongside the values; no question string in the component). **Kill switch:** the card renders only when the field is active and `prompt` is non-null; setting `prompt` to NULL or `is_active` to false in the DB removes the card on the next config refresh, no deploy, a single select from `GET /api/quiz/post-result/options`, which returns the allowed values of the `usual_drink` field from `getBrewProfileFieldsConfig()` (the one reader of `v_brew_profile_field_current`); the route does not SELECT `brew_drink` itself; labels from the table, no strings in the component, buttons Save / Skip. Skip records nothing. The card is a component that takes a list of fields, so ZIP (D8) is a second entry later. Log the funnel event the way the other result-screen actions do (`logQuizFunnelEvent`): `post_result_shown`, `post_result_saved`, `post_result_skipped`.

B3. **Profile mirror.** `BrewProfileMirror.tsx` renders every active field from `v_brew_profile_field_current` by `value_kind`; `usual_drink` therefore appears as a select with the drink labels, editable and deletable like the others, no per-field code. PATCH/DELETE `/brew-profile` unchanged except the validator source.

B4. **Liam.** The prompt's "Remembering facts" field list is built from the view (field codes + allowed codes), not typed in the prompt. One addition to the base prompt text: when `usual_drink` is absent from the brew-profile line and the customer **names the drink or describes the full preparation** ("espresso with hot water and a splash of cold milk" → `americano_milk`), confirm in voice and emit `<<remember:usual_drink=<code>>>`; never from a partial cue ("I add milk" is `takes_it`, not a drink); when present, never re-ask except through the existing stale-nudge rule. No new topics in the router.

## Part C — Backfill: none

No historical data exists for `usual_drink`. The two existing `customer_brew_profile_change` rows must satisfy the new FK (Task 0.9 lists their `field` values; they are from today's whitelist, so they will). Nothing is deleted.

## Part D — Visibility

- Admin brew-profile stats row (`AdminSommelierFlow.tsx`, `brewProfileStats`): add counts per field (how many customers have each field) and for `usual_drink` the distribution by drink code, read through one new `customerReads.getBrewProfileFieldCounts()` over `v_customer_brew_profile` / `v_customer_usual_drink`. No other file SELECTs these views (lint-customer rule 4). This is where Dana watches the question get answered.
- `customerIntegrity.ts`, new boot checks, all informational (no strict mode, 2026-10-16 lint posture), each shown on the admin integrity panel with its detail rows:
  1. Every `customer_brew_profile_change.field` is a `brew_profile_field.code` (FK makes this structural; the check reports inactive fields that still carry facts, which is allowed and should be visible).
  2. Every active field with `value_kind` enum or array resolves at least one active allowed value through `v_brew_profile_field_current`, and has exactly one of (`lookup_table` set, rows in `brew_profile_field_value`).
  3. Every `customer_brew_profile_change.value` for an enum field resolves to a lookup row, active or not (for `usual_drink`: a `brew_drink.code`). A non-resolving value is a drift row; list it.
  4. Every current `brew_drink_archetype_offset` row (superseded_at IS NULL) points at a `brew_drink` with `is_home_drink = true` and an archetype present in `coffee_archetype`. Exactly one current row per (drink, archetype) is guaranteed by the partial unique index; the check reports the count of pairs with no row (expected: `buy_out`, `other`, and `experimental` if it is a code).
  5. Seed coverage: every code in the seed arrays for `brew_profile_field`, `brew_drink`, `quiz_funnel_event_type` and the small lookups exists in the DB (detects a seed that failed at boot; the reverse direction, rows in the DB not in the seed, is allowed).
  6. Firestore `sommelier_config` has no `brewProfile.fields` key (30-day check, same expiry pattern as check 15).
  7. FK state: both FKs from A8 exist; if either was skipped at boot, list the violating rows (field/event value and count).
  8b. `takes_it` vs `usual_drink` (informational, data about the customer, not an error): per customer with both fields, list those where `takes_it` implies milk and `brew_drink.milk = 'none'`, or `takes_it` is black and `brew_drink.milk <> 'none'`. Count shown on the admin row.
  8. `ab_app` holds no INSERT/UPDATE/DELETE on any table in the A7 list (reads `information_schema.role_table_grants`); `brew_card_view_event` is not in the list and keeps its INSERT.
- `lint-customer.mjs`: rule 3 (Firestore writes) gains nothing; confirm the removal of the Firestore whitelist read leaves no allow-list entry dangling.

## Part E — Definition of done (one closing report)

1. `npm run lint:catalog && npm run lint:customer && npm test` green locally (pre-existing failure count unchanged, state it).
2. Test DB: the three writers each produce exactly one `customer_brew_profile_change` row (`source` = `quiz` / `onsite` / `liam`), `v_customer_brew_profile` shows `usual_drink` for that user, `v_customer_usual_drink` resolves `base_method/dilution/milk`; resubmitting the quiz screen inserts nothing; an invalid code (`usual_drink=unicorn`) is dropped and counted; deactivating a `brew_drink` row removes it from the options endpoint and the mirror's editor without a deploy, while a customer who already stored that code still sees it displayed; an anonymous guest answers the card, then signs up (a `customer_identity_link` lands), and `v_customer_brew_profile` for the canonical user shows the guest's `usual_drink`; the three funnel events insert against `quiz_funnel_event_type`; a `POST /api/quiz/post-result` for a session the caller does not own returns 403 and inserts nothing; a stored `usual_drink` written by each of the three writers resolves in `v_customer_usual_drink` (proves the encoding matches); as `ab_app`, an INSERT into `brew_drink` is denied.
3. `brew_drink_archetype_offset` seeded; `grep -rn brew_drink_archetype_offset backend/src frontend/src` returns only the DDL, the seed, the comment and the catalog (proof that nothing reads it).
4. Prod, before deploy: the A8 backups taken and the before-numbers recorded in the closing report; after deploy, the after-numbers equal them.
5. Commit by explicit file list, `git diff --cached --stat` shown first. Message: `usual_drink: capture the daily cup; brew-profile fields as tables; drink x archetype offset seeded (unread)`. Push to main deploys; boot log shows the schema applied and the new integrity check green.
6. Prod smoke with the test user (`quiz-scenario-test@axisandbloom.test`, exclude from analysis): take the quiz, answer the post-result card, one row in prod; set the field from the Profile mirror, second row; admin stats row shows the distribution.
7. Closing report in this folder (`CLOSING_REPORT_1.md`): Task 0 findings, every deviation, the seeded offset rows as a table, and the one open item: "offset table is unread; reading it in matching is a separate decision after cupping or customer data".

## Docs

`WHAT_WE_BUILT.md` entry; `WHAT_WE_BUILT_DB.md` (new tables, both CHECK → FK changes (`customer_brew_profile_change.field`, `quiz_funnel_event.event`), the Firestore whitelist retired, the lookup-row lifecycle rule A6); `SOMMELIER_BUILT.md` (prompt field list now view-driven); `CATALOG.md` regenerated; `OPEN_TASKS.md`: "customer-context: add home ZIP to the post-result card (component takes a field list)" and "usual_drink: offset table unread until cupping (brew the Balanced flight as americano + cold milk) or customer data decides". Also: "usual_drink: pod drinkers (brew_drink.base_method = pod) are offered ground coffee as the closest fit (Dana 2026-10-24); commerce reads base_method later, nothing reads it in brief 1".
