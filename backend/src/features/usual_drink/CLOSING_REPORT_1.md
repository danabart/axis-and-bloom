# Usual Drink 1 (Rev 4) — closing report

Brief: `CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md` (Rev 4, 2026-11-12). Test mode.

## Status (2026-11-12): Parts A–E built and accepted on the test DB; STOPPED before the A3d production backup and the push

Everything below the production line is done: schema, writers, card, Profile mirror, Liam, purge guard, integrity checks, admin row, tests, the test-DB acceptance and the docs, committed by path. **Not done, by the brief's own STOP point:** the A3d backup of `customer_brew_profile_change` and `quiz_funnel_event` on production (pg_dump plus row count and md5 before and after), the push (= deploy, which runs the FK migration on production), the boot log, the Firestore `brewProfile.fields` key removal, `CATALOG.md` from production and the production smoke. These wait for Dana's go; the section **What happens on your go** lists them in order.

Task 0 (read-only, below) found fourteen differences from the brief; Dana answered the four questions and approved the ten code-following deviations on 2026-11-12 (**Answers** below).

---

## Task 0 findings

Paths: `S` = `backend/src/db/schema.sql`, `FQ` = `frontend/src/app/components/FlavorQuiz.tsx`.

### 1. `customer_brew_profile_change`, the fold, the key types

**The CHECKs.** They are inline at S:5651 and S:5653. Their names, read from prod `pg_constraint`, are:
- `customer_brew_profile_change_field_check`: `CHECK (field = ANY (ARRAY['brew_methods','grinder','takes_it','decaf_constraint','aversions']))`
- `customer_brew_profile_change_op_check`: `CHECK (op = ANY (ARRAY['set','add','remove','clear']))`

The other constraints are the pkey, `UNIQUE (source, source_id)`, the `user_id` FK to `user_profile` (no ON DELETE) and the `session_id` FK to `sommelier_sessions`. The test DB has the same CHECK names.

**The fold.** `_customer_brew_profile_fold_sfunc(state, op, raw_value)` is at S:6347-6372, and the aggregate at S:6379-6383. It branches on **op only** and never reads the field.
- `set`: becomes `raw_value::jsonb`. An array `set` replaces the whole array.
- `add`: appends `raw_value::jsonb #>> '{}'` if it is absent.
- `remove`: filters that value out.
- `clear`: becomes NULL.
- Any other op returns the state unchanged (`ELSE RETURN state`, S:6368). So `declined` does not change the value.

**`v_customer_brew_profile`** is at S:6386-6399. It groups by `vci.canonical_user_id, field` through `v_customer_identity`. It keeps only rows where `value_jsonb IS NOT NULL` (S:6400).

**One gap: `declined` rows are not fully invisible.** `captured_at = MAX(occurred_at)` and `source = latest source` are taken over **all** rows (S:6394-6395).
- A `declined` row after a `set` would move `captured_at` forward. That resets Liam's stale nudge, and `source` would become `quiz`.
- `v_customer_timeline` (S:6650-6654) lists every row, so declines would show there too.
- See question 2.

**Key types.**
- `quiz_session.id` is UUID (S:808, prod confirmed).
- `roaster.id` is UUID (S:58). `roaster.name` is not UNIQUE: prod has only `roaster_pkey`.

### 2. `services/brewProfile.ts`

**`getBrewProfileFieldsConfig()`** (:22-24) is synchronous and returns `Record<string, BrewProfileFieldConfig>`. It reads `getSommelierConfig()?.brewProfile?.fields ?? FALLBACK_FIELDS`.

**Field names and allowed values held in code** (not read from config):
- `FALLBACK_FIELDS` (:9-19), a full copy of the five fields.
- `normalizeFieldName` aliases (:37-43): `brew_method→brew_methods`, `aversion→aversions`.
- `formatBrewProfileSummary` `SUMMARY_LABELS` (:106-127), plus a `decaf_constraint` special case at :125.
- `TOPIC_TO_FIELD` (:133-158):

  | Topic | Field |
  |---|---|
  | `brewing` | `brew_methods` |
  | `equipment` | `grinder` |
  | `caffeine_decaf` | `decaf_constraint` |
  | `my_coffee` | `takes_it` |

`validateSingleValue()` (:48-66) is driven by config: `allowedValues.includes`, bool as 'true'/'false', and `array_freeform` trimmed and sliced to `maxItemLength`.

**Synchronous call sites.**
- `routes/sommelier.ts:438` (resolveRemember)
- `routes/users.ts:905` (PATCH)
- `routes/users.ts:974` (DELETE, `if (!getBrewProfileFieldsConfig()[field])`)
- `services/roasteryPortal.test.ts:403`

Keeping the function synchronous over a boot-loaded cache (B1) keeps every one of them as it is.

**How `brew_methods` is validated today.**
- PATCH (`users.ts:917-932`) validates each item and dedups. It then **silently truncates** to `maxLength`; it does not reject.
- The Liam `add` path (`sommelier.ts:468-471`) has **no max-items check**.
- Part B makes both reject an array over `max_items` and count it, as Part E expects.

**The five fields today.** Live Firestore config, `sommelier_config_seed.ts:382-410` and `FALLBACK_FIELDS` all agree. The config keys are `maxLength` / `maxItemLength`.

| Field | Kind | Allowed codes | Caps |
|---|---|---|---|
| `brew_methods` | array | v60, french_press, espresso, moka, aeropress, cold_brew, drip, other | maxLength 8 |
| `grinder` | enum | none, blade, burr_hand, burr_electric, unknown_type | — |
| `takes_it` | enum | black, milk, sugar, milk_and_sugar | — |
| `decaf_constraint` | bool | — | — |
| `aversions` | array_freeform | — | maxLength 10, maxItemLength 40 |

The display labels exist only in the frontend: `BrewProfileMirror.tsx:5-27`, e.g. "V60", "Moka pot", "Hand burr grinder". The A1c seed takes its labels from there.

### 3. `services/customerFacts.ts`

- `BrewProfileChangeInput` (:167-173) types `field` as a union of the five fields and `op` as `'set'|'add'|'remove'|'clear'`.
- `FactSource` (:21) has no `'quiz'`. `MatchSource` (:381, Ella map 3) has one, but it is a separate type.
- `record.brewProfileChange` is called from:
  - `routes/users.ts:956` (PATCH, `onsite`, `set`)
  - `routes/users.ts:983` (DELETE, `onsite`, `clear`)
  - `routes/sommelier.ts:497` (resolveRemember, `liam`)
  - `.backfill` from `backend/scripts/backfillCustomerFacts.ts:254`
  - the test mock at `routes/sommelier.test.ts:43`

  These are the call sites the brief expects.

### 4. Anonymous guests

The GET, PATCH and DELETE `/brew-profile` routes (`users.ts:884, 901, 972`) all use `requireAuth, blockAnonymousAuth`. `blockAnonymousAuth` (`middleware/auth.ts:34-40`) answers 403 `anonymous_not_allowed` to an anonymous token, so the existing PATCH cannot serve the card. Confirmed.

A guest does have a `user_profile` row. `POST /quiz/results` is `requireAuth` only (`quiz.ts:159`), and it upserts `user_profile (firebase_uid)` at :191-197 before `saveQuizSession(profileId, …)` at :212. A fact can therefore be recorded for a guest.

### 5. Quiz result screen and Profile, as brief 3 left them

**Result screen.**
- The result renders under `{isComplete && …}` at FQ:1517.
- The proxy prelaunch branch is at FQ:1519-1530, and the sealed prelaunch gate (`PostQuizEmailGate sealed`) at FQ:1531-1563.
- The normal path runs `ResultScene` (FQ:1566-1579), then `div.qz-after#qz-next` (FQ:1581).
- The ceremony is `WrapOverlay` (FQ:1710-1717).

**`saveQuizResult`** has **3** call sites, not the 4 the comment at FQ:381 claims: FQ:984, FQ:1100 and FQ:1399. All three are behind `if (user)` and are fire-and-forget. The `{ id }` the API returns, which is the `quiz_session.id` (`quiz.ts:257`), is thrown away. **There is no "saved" state and no session id on the client today.** B2 captures `res.id` at the three sites.

**`PostQuizEmailGate`** appears twice:
- FQ:1549, the sealed prelaunch gate.
- FQ:1690, the guest email gate. It is shown until `emailGateUnlocked` (FQ:718).

**`MapQuizStart`** is at FQ:1605, inside the `emailGateUnlocked` branch. Its surface check is inside the component (`MapQuizStart.tsx:22`). It is not proxy-gated. It is not touched.

**Proxy detection.** `isProxy = !!searchParams.get('for')` (FQ:500-501). The `proxy` state comes from `/api/household/mine` (FQ:502-526), and `forMemberId` is sent at FQ:916.

**The one insertion point** is inside `div.qz-after`, after the share-row ternary (FQ:1583-1584) and before `{emailGateUnlocked ? …}` (FQ:1586).
- It is outside the ceremony and does not block the reveal.
- It is outside the guest email gate. Anywhere inside it would hide the card from guests until they give an email.
- It shows only when `!isProxy && savedSessionId && !isWrapping`.
- The sealed prelaunch branch has no `.qz-after`, so no card shows there.

**`BrewProfileMirror.tsx`** is rendered at Profile.tsx:656, under `MapTrail` at :650.
- Its fields, options and labels are **hardcoded**: the option lists at :5-27, `FIELD_META` at :29-35 and `FIELD_ORDER` at :36.
- One branch is keyed on a field code: `decaf_constraint` at :44.
- It shows **captured fields only** (:72). An empty field has no way to be added.
- Its only data call is `GET /users/brew-profile`. There is no options endpoint.
- Controls by type:

  | Type | Control | Line | Note |
  |---|---|---|---|
  | `array` | toggle chips | :165-181 | the multi-select for `brew_methods`, no cap |
  | `enum` | `<select>` | :182-190 | |
  | `bool` | two buttons | :191-208 | |
  | `array_freeform` | comma text input | :209-217 | |

B3 rewrites the mirror to render from the options payload. It reuses these four controls and adds a typeahead.

**Combobox.** There is no reusable typeahead or combobox. `cmdk@1.1.1` is in `frontend/package.json:52`, but nothing imports it. The only combobox is an inline one wired to a server search in `admin/AdminCompanyGifts.tsx:68-160`. So B2 writes one small component under `components/quiz/`, which the mirror reuses.

### 6. Liam: prompt, marker, nudge

**The prompt is not in the seed.** `LIAM_BASE_PROMPT` is in `services/claude.ts:26`, and "Remembering facts" is at :94-110. The five field names are typed into the prompt at :96. Allowed values never reach it; there are only examples (`v60`, `black`, `french_press` …). Nothing reads `brewProfile.fields` into the prompt. B4 builds that list from `getBrewProfileFieldsConfig()`. Today Liam cannot know `latte`, `counter_culture` or `bolder` at all.

**Parser.** `parseAndStripMarkers` uses the regex `/<<remember:([a-zA-Z_]+)=([^>]*)>>/g` (`claude.ts:464`), capped at `maxMarkersPerTurn` (:467).
- `|words` already falls inside `[^>]*`, so the split happens in `resolveRemember()`.
- `resolveRemember()` is at `sommelier.ts:431-508`. On an array field it becomes `add` unless the value is already present (:468-471), and on a scalar it becomes `set` (:478-483).
- `sourceId` is `${sessionId}:${turn}:${field}:${value}` (:496).

**The stale nudge never asks about an empty field.** `getStaleFieldNudge` (`brewProfile.ts:139-158`) fires only when the field **has** a value that is at least `staleAfterDays` old. It is wired at `services/liamProfile.ts:587-588`. "Ask when empty" (B4) is a new rule in the prompt text, driven by `ask_when_empty`. It is not a change to the nudge.

### 7. Prod counts (read-only, 2026-11-12)

`customer_brew_profile_change`: 17 rows, all with a whitelisted field and op, so the FKs in A3a apply cleanly.

| field | op | n |
|---|---|---|
| brew_methods | add | 5 |
| brew_methods | set | 2 |
| decaf_constraint | set | 1 |
| grinder | set | 2 |
| takes_it | set | 7 |

By source:

| source | rows | users |
|---|---|---|
| backfill | 2 | 1 |
| liam | 10 | 5 |
| onsite | 5 | 2 |

Quiz sessions:
- 149 in all, all completed.
- 9 completed in the last 30 days.
- 1 proxy quiz (`taken_by_user_id` set), also in the last 30 days.

### 8. `quiz_funnel_event`

**The CHECK** is `quiz_funnel_event_event_check` (prod `pg_constraint`): `event = ANY ('quiz_start','quiz_complete','email_submitted','quiz_final')`. It is inline at S:4558.

**It is also dropped and re-added on every boot** (S:4571-4573, Quiz Resync Fix A4). A3b must replace those lines, or the next boot puts the CHECK back.

**Prod rows:**

| event | n |
|---|---|
| quiz_start | 168 |
| quiz_complete | 159 |
| email_submitted | 114 |
| quiz_final | 23 |

**The only writer** is `logFunnelEvent` in `features/marketing/funnelEvents.ts:15-37`; it holds the only INSERT, at :33. Its only caller is `POST /api/quiz/event` (`quiz.ts:146-155`, behind `funnelEventLimiter`, :145). `logFunnelEvent` has its own hardcoded `VALID_EVENTS` (:10), and it **throws** on an unknown event, which surfaces as a 400. The brief's "logged and dropped, never a 500" means replacing that set with the lookup and the throw with a drop.

`logQuizFunnelEvent` is the **frontend** wrapper (`frontend/src/app/lib/api.ts:338-343`). It has a TypeScript union of the same four events, which is widened. The readers are `routes/newsletter.ts:80` and `services/quizIntegrity.ts:380`.

### 9. lint-customer Rule 7

`backend/scripts/lint-customer.mjs:328-374` forbids only `CREATE OR REPLACE VIEW` between `-- BEGIN CUSTOMER BLUEPRINT C3 views/tables block` (S:5813) and `-- END …` (S:7638).

**Placement.** The new block cannot sit right after S:7638. `dial_move` is created and seeded at S:10512-10527, inside the Ella Map 1 block (S:10480-11653), and `brew_coffee_feeling` FKs to it. The new marked block goes after `END ELLA'S BLOOM MAP 1 block` (S:11653) and before the grant blocks (S:11656). It is still after C3, so Rule 7 is satisfied. Nothing in the Ella block changes.

### 10. Firestore `sommelier_config` and caching

**The live doc** (prod, read-only) has `brewProfile = { staleAfterDays: 120, fields: {5 fields}, maxMarkersPerTurn: 2 }`. The `fields` key is present, and B1 retires it.

**Caching** (`services/sommelierConfig.ts:317-371`):
- A module-level `_config` per process.
- `initSommelierConfig()` seeds, runs `applyMissingKeys`, does one `get()`, then attaches a **Firestore `onSnapshot` listener** (:355-370).
- A listener error is logged and the last `_config` is kept.
- An init failure is non-fatal (`index.ts:306-310`); the code then uses `FALLBACK_FIELDS`.

**There is no TTL to copy.** The only TTL in that config is `promptCache.sharedTtl` (Anthropic's cache, :107-110). The brief's "same pattern and TTL source as `sommelierConfig.ts`" does not exist. See question 1.

### 11. Grants

- **Facts block** (S:11663-11674): `customer\_%` plus named tables get `SELECT, INSERT`, with UPDATE and DELETE revoked.
- **Operating catch-all** (S:11711-11721): everything else gets full DML. **A new `brew_*` table falls here today.**
- `brew_card_view_event` (S:1156-1161) is app-written: an INSERT at `routes/users.ts:665`, read by `services/engagementMetrics.ts:24,50`. On prod, `ab_app` holds SELECT/INSERT/UPDATE/DELETE on it. So A6 is right to use an explicit list.
- **Template:** the quiz-content block (S:11788-11797), a DO loop of `REVOKE ALL … FROM ab_app; GRANT SELECT … TO ab_app` after the catch-all. The A6 block sits beside it, before the "keep this LAST" block (S:11809-11818).
- **`reporting_ro`** is views only. S:4629-4630 says "reporting_ro gets SELECT on these views ONLY, never on base tables". Every existing `reporting_ro` grant is on a view (S:4907-4917, 5520-5524, 8565, 8629, 8652, 11781). A5's "SELECT on every `brew_*` table to `reporting_ro`" breaks that. See question 3.

### 12. How `value` is encoded

Every writer stores `JSON.stringify(validated)` in a TEXT column (S:5652).
- PATCH (`users.ts:956`) stores an array as `'["v60","drip"]'`, a code as `'"black"'` and a bool as `'true'`.
- resolveRemember (`sommelier.ts:498`) stores one code per `add`, as `'"espresso"'`.
- DELETE stores NULL.

Prod agrees: `brew_methods` rows are arrays (`set`) or single strings (`add`), `takes_it` and `grinder` are strings, and `decaf_constraint` is a boolean. The fold casts with `::jsonb`, and the view exposes `value_jsonb JSONB`; `customerReads.getBrewProfileCurrent` is at :155-171. Part B writes the new fields the same way.

### 13. `routes/quiz.ts` as brief 3 left it

**`POST /results`** (:159):
- `forMemberId` with an anonymous token answers 403 (:175-179).
- On the proxy path, `actorId = profileIdForUid(req.uid)` (:181), and `assertMayQuizFor(actorId, forMemberId)` (:183) gives the target.
- Otherwise `profileId` is the `user_profile` upsert by `req.uid` (:191-197).
- `matchDecide(…)` follows in a try/catch (:240-247), then `recordProxyQuiz` (:249).

**The card route's ownership check** uses the same `req.uid` → profile resolution, and must not upsert a profile. `quiz_session.user_id` must equal it, and `taken_by_user_id` must be NULL. On a proxy session `user_id` is the member, so the actor fails the ownership test anyway. The 409 is checked first, so a proxy session reads as a proxy session.

`funnelEventLimiter` is `rateLimit({ windowMs: 60_000, max: 30 })` (:145). Nothing is added to `POST /results`.

### 14. `v_palate_evidence`

`n_brew_fields_known` is `COUNT(*)` over `v_customer_brew_profile` per canonical user (S:7276-7278). That counts folded fields with a non-null value, not raw rows by op. A field with only `declined` rows folds to NULL and is filtered out (S:6400), so it is not counted. **No `op <> 'declined'` is needed in `v_palate_evidence`.**

The Dana-reviewed fixture `fixtures/palate/expected.json` asserts `"n_brew_fields_known": 0` on its 11 rows. `timelines.json` has no brew events, so three more fields change nothing; the fixture stays as it is. `customerIntegrity.ts:524-526` pins the column list, and that is also unchanged.

### 15. `staleGuestCleanup.ts`

**The two candidate queries.**
- **Empty guest** (:48-58): created more than 7 days ago, no `quiz_session`, no order, no verified email.
- **Stale-quiz guest** (:63-77): last quiz more than 90 days ago, no order, no verified email. These are identity-only.

**The sequence** (:112-150):
1. The Firebase Auth `deleteUser` runs **first**.
2. Identity-only candidates stop there, and every Postgres row stays.
3. For empty guests only: Firestore `recursiveDelete`, then `DELETE FROM user_profile`. An FK failure there is caught and counted as `skipped`.

**What that means for this brief.**
- A card answerer always has a `quiz_session`. They can only be a stale-quiz candidate, which deletes the Auth record and keeps every row. **They cannot be half-purged.**
- The half-purge exists today only for a guest with a brew row and **no** quiz. In that case Auth and Firestore are deleted, then the FK (`user_id … REFERENCES user_profile`, no ON DELETE, S:5645) blocks the Postgres delete, and the run retries daily.
- Adding A8's `NOT EXISTS` to the **stale-quiz** query changes behaviour: guests who answered or declined the card would keep their Firebase Auth record forever. That contradicts the 2026-09-24 rule (G2.10: quiz completers lose the Auth record only). See question 4.

### 16. `lookup_value`

S:1982-1989; prod has the same shape. Its columns are `id, category, value, label, sort_order`, with **no `is_active`**. Its only unique is `UNIQUE (category, value)`. Both D10 reasons hold.

### 17. `dial_move`

S:10512-10527, seeded with `ON CONFLICT (code) DO NOTHING`. Its columns include `is_customer_move`. Prod ids:

| id | code | is_customer_move |
|---|---|---|
| 1 | quiz_result | false |
| 2 | stay | true |
| 3 | bolder | true |
| 4 | gentler | true |
| 5 | different | true |
| 6 | liam | false |
| 7 | sibling | false |

It is seeded at boot before S:11653, so a block after that line can FK to it and seed by `code`. Ids are SERIAL, so the seed looks them up by code, never by number. Nothing in `dial_*` changes.

### 18. `roastery_portal_response_brew` (for the OPEN_TASKS line only)

S:7785-7791. Its columns are `response_id` (FK), `brew_method TEXT` (no FK) and `role` (CHECK `best | also_good`), with a partial unique index allowing one `best` (:7792).

The vocabulary is `lookup_value` category `roastery_portal_brew_method` (S:7878-7886): the same 8 codes as `brew_methods`. `roasteryPortal.test.ts:401-407` checks that against `getBrewProfileFieldsConfig().brew_methods.allowedValues`, and that test is adapted to the new shape.

Prod has 75 rows; by `best`: drip 14, v60 6, espresso 3, french_press 3, cold_brew 1. The `drink → base_method` link a later map brief would use runs through these codes.

Two notes:
- The table's PK is composite `(response_id, brew_method)`, a pre-existing G2.2 case, for the OPEN_TASKS line.
- `brew_drink_base_method` (espresso, filter, immersion …) is a coarser vocabulary than the roaster's (v60, drip, french_press …). Mapping one to the other is the later brief's job.

### 19. Repo

- On `main` at `9511209`, level with `origin/main` (fetched).
- The working tree has the genova `.ttf` deletions and `commerce/README.md`, which stay unstaged.
- `backend/src/features/ella_bloom_map/README.md` has an **uncommitted edit that is not mine**: a "Decisions 2026-11-12" section. I left it untouched and unstaged ("nothing under ella_bloom_map changes").

**Other checks.**
- `brew_drink_archetype_offset`, `brew_offset_basis` and `lookup_table` appear only in this folder's brief and spec files. There is no code hit.
- Neither table exists on prod or on the test DB.
- The only `brew_*` table in either database is `brew_card_view_event`.

---

## Questions for Dana (asked at Task 0)

1. **Where does the field-list cache TTL come from?** `sommelierConfig` has no TTL: it uses a live Firestore listener, so the brief's "same TTL source" does not exist. I recommend **(a)**, because the TTL is runtime config, which G2.15 allows in Firestore, and the other brew-profile settings already live there.
   - **(a)** A new key `brewProfile.fieldsCacheTtlSeconds` in `sommelier_config`, beside `staleAfterDays`, added by `applyMissingKeys`. The cache reloads from `v_brew_profile_field_current` every N seconds and keeps the last good list on failure.
   - **(b)** A Postgres parameter row. The only `param()` table is `evidence_parameter`, which belongs to the cupping domain.
2. **Should `declined` rows stay out of `captured_at` and `source`?** In `v_customer_brew_profile` they would move both. I recommend adding `FILTER (WHERE op <> 'declined')` to those two aggregates. The view keeps its shape and values, and the stale nudge and the source are unaffected. `v_customer_timeline` keeps listing them, with `op: declined` in the detail, as facts. Yes or no?
3. **Should `reporting_ro` get the base tables?** It is views-only by convention (S:4629). I recommend granting SELECT on the four new views only, with the drink, brand and feeling labels and kinds carried in those views. A5 as written also grants the `brew_*` base tables.
4. **Should the purge guard apply to both queries?** I recommend applying it to the **empty-guest query only**. That fixes the real half-purge (a brew row with no quiz), and card answerers still lose only their Auth record after 90 days, as G2.10 has it. Every Postgres row is kept either way. Applying the guard to both queries, as A8 says, means card answerers keep their Auth record forever.

## Deviations proposed at Task 0 (the brief disagrees with the repo; following the repo)

1. **A3b funnel event.**
   - Replace the boot-time drop and re-add of `quiz_funnel_event_event_check` (S:4571-4573) with the FK swap; otherwise the CHECK comes back at every boot.
   - The writer is `logFunnelEvent` (`funnelEvents.ts`), not `logQuizFunnelEvent`. Its `VALID_EVENTS` set becomes the lookup, and its throw becomes log and drop.
   - The frontend union in `api.ts:338` widens.
2. **Customer integrity check 17** (`customerIntegrity.ts:476-490`, fail severity) fails on the first `declined` row. It is rewritten to compare against `brew_profile_op`. The brief's eleven new checks take ids **22–32**, since ids 1–9 and 13–21 are taken.
3. **The new schema block** goes after the Ella Map 1 block (S:11653) and before the grants, because `brew_coffee_feeling` FKs to `dial_move`. This is not a position straight after C3.
4. **The Liam prompt** lives in `services/claude.ts`, not the seed. The typed field list at :96 is replaced by the list built from the view. "Ask when empty" is a prompt rule, not a change to the stale nudge (which only re-confirms old values).
5. **Max items is rejected, not truncated.** PATCH truncates today, and the Liam `add` has no cap. Both reject and count it, as Part E expects.
6. **Mirror labels.** The existing fields' labels, seeded into `brew_profile_field_value`, come from `BrewProfileMirror.tsx:5-27`. The mirror's hardcoded lists, `FIELD_META` and the `decaf_constraint` branch go. The bool's display words ("Needed" / "Not needed") need a home. I will put them as two rows of `brew_profile_field_value` under `decaf_constraint` (codes `true` / `false`), and check 2 ("bool fields have no value rows") becomes "bool fields have exactly the two". If you would rather keep check 2 as written, the words would need another table. I will take the two-row form unless you say otherwise.
7. **The client session id.** `saveQuizResult`'s returned `id` is captured at its 3 call sites. The comment at FQ:381 says 4.
8. **Admin stats.** `brewProfileStats` today is two Firestore counters (`admin.ts:2064`, `brewProfile.ts:86-94`). Part D keeps them and adds the per-field section from `customerReads.getBrewProfileFieldCounts()`.
9. **The roastery drift test** (`roasteryPortal.test.ts:403`) is adapted to the new config shape and still compares the same eight codes.
10. **`usual_drink/README.md`** does not exist (G1.2). I will add it in Part A with the brief plan, one line.

---

## Answers (Dana, 2026-11-12)

1. **Refresh interval:** a Postgres parameter row, not Firestore (G2.15). Built as `brew_parameter`, in the `household_parameter` shape, with the key `field_list_refresh_seconds` = 300 (Range: integer 30 <= value <= 3600). The writer is `brewParameters.setParameter`, the same admin edit pattern household has, on a card on the Liam flow page. **Cache TTL: 300 s**, read on every refresh; a failed refresh keeps the last good list.
2. **Declined rows** are left out of "last updated" (`captured_at`) and `source` in `v_customer_brew_profile`. The view keeps its shape, and the timeline still lists them.
3. **`reporting_ro`** gets the four new views only, with no table grants.
4. **Purge guard** on the "no quiz result" query only.

Code differences: all ten followed as proposed (Task 0 deviations 1–10 above).

## What was built

**Schema** (`backend/src/db/schema.sql`; the `USUAL DRINK 1 block` sits after `END ELLA'S BLOOM MAP 1 block` and before the grants):
- **Lookups (A1, A2, A3b):** `brew_parameter`, `brew_profile_value_kind`, `brew_profile_picker`, `brew_profile_op`, `brew_profile_field`, `brew_profile_field_value`, `brew_drink_base_method`, `brew_drink_dilution`, `brew_drink_milk`, `brew_drink`, `brew_cupboard_brand_kind`, `brew_cupboard_brand`, `brew_cupboard_brand_alias`, `brew_coffee_feeling`, `quiz_funnel_event_type`.
  - Every table has a surrogate `id`, with its natural key UNIQUE.
  - Every seed is `ON CONFLICT DO NOTHING` (or insert-if-missing), and lookup rows are seeded by code, never by id.
- **CHECK → FK (A3a, A3b):**
  - `customer_brew_profile_change_field_check` and `_op_check` are dropped by name, with FKs added to `brew_profile_field(code)` and `brew_profile_op(code)`.
  - `quiz_funnel_event_event_check` is dropped, with an FK added to `quiz_funnel_event_type(code)`. The boot-time drop and re-add at the old S:4571-4573 is gone.
  - Each FK is added only when zero rows violate it, otherwise a `RAISE WARNING` and check 27. On the test DB (a copy of production) all three were added.
  - The inline CHECK text is also gone from the two `CREATE TABLE` statements, so a fresh database matches an upgraded one.
- **New columns (A3c):** `customer_brew_profile_change.quiz_session_id` (UUID, FK to `quiz_session`) and `customer_words` (TEXT), both nullable.
- **Views (A5):** `v_brew_profile_field_current`, `v_customer_usual_drink` (one row per customer × drink), `v_customer_cupboard_coffee` and `v_customer_coffee_feeling` (with `move_code`). `v_customer_brew_profile` gets the `FILTER (WHERE op <> 'declined')` on `captured_at` and `source`. `reporting_ro` has SELECT on the four new views.
- **Grants (A6):** the explicit list of 14 reference tables gets `REVOKE ALL` then `GRANT SELECT` for `ab_app`, after the catch-all. `brew_card_view_event` keeps its grants. `brew_parameter` is superseded-only, like `household_parameter`.
- **`comments.sql`:** 131 new lines, every table, column and view. Each small lookup's comment states the D10 reason, and the `declined` op row says it is ignored by the fold. The existing comments on `customer_brew_profile_change`, `v_customer_brew_profile` and `quiz_funnel_event` are updated.

**Backend:**
- **`services/brewProfile.ts`** (B1):
  - **Field list:** `loadBrewProfileFields()` is the one reader of `v_brew_profile_field_current`. `startBrewProfileFieldsCache()` runs at boot before `listen` and logs `[brew-profile] field list loaded: 8 fields`; it then refreshes every `field_list_refresh_seconds`. `getBrewProfileFieldsConfig()` is still synchronous.
  - **Validation:** new `validateFullValue` rejects over-cap arrays and words outside their rules, and `validateSingleValue` is driven by the rows.
  - **Liam helpers:** `formatBrewProfileFieldList` (Liam's list) and `getAskWhenEmptyNudge`; the stale nudge reads `liam_topic`.
  - **Removed:** `FALLBACK_FIELDS`, `FIELD_ALIASES` (now a generic plural check) and `TOPIC_TO_FIELD`.
- **`services/brewParameters.ts`** (new): `brewParam`, `brewTextParams`, `getParameters`, `setParameterInTx`/`setParameter`.
- **`services/brewProfileCard.ts`** (new): `brewProfileOptions('card'|'mirror')` and `recordPostResultCard`.
  - It checks ownership by `firebase_uid` → `user_profile` without creating one, and must equal `quiz_session.user_id` (403). A proxy session is refused first (409).
  - `shown` must be card-eligible fields, every shown field without an answer gets a `declined` row, and the whole card is one transaction.
  - `source_id` is `<session>:<field>:<value|declined>`, plus `|words` when words are sent.
- **`services/customerFacts.ts`:**
  - `FactSource` gains `quiz`, and `BrewProfileChangeInput.field`/`.op` are now strings.
  - The new `checkBrewProfileChange` checks every write at the door: field, op against kind, value, caps, words, and the declined and quiz-session rules. A refused write raises `BrewProfileChangeRejected` and is counted in `brew_profile.failures`; routes answer 400, never 500.
- **Routes:**
  - `GET /api/quiz/post-result/options` and `POST /api/quiz/post-result` (behind `funnelEventLimiter`, `requireAuth` only). `POST /results` is untouched.
  - `GET /api/users/brew-profile/options`. PATCH takes the optional `words` and rejects over-cap instead of truncating. DELETE is unchanged apart from the validator source.
  - `/api/admin/brew-profile/stats` and `/parameters` (new `routes/brewProfileAdmin.ts`).
- **`features/marketing/funnelEvents.ts`:** the `VALID_EVENTS` set is gone. The INSERT selects from `quiz_funnel_event_type`, and an unknown or retired event is logged and dropped (`{ ok: true, dropped: true }`).
- **Liam (B4):**
  - The "Remembering facts" rules no longer name five fields, and rules for the three new fields were added. The field list goes in the shared prompt tier from `formatBrewProfileFieldList()`.
  - `resolveRemember` parses `code|words`, refuses an `add` past `max_items`, and passes words.
  - Ask-when-empty runs once per conversation through `context_data.brewAskedFields`, never on `turn_count` ≤ 1.
- **`services/staleGuestCleanup.ts`:**
  - The candidate queries moved into the exported `staleGuestCandidates()`. The empty-guest query has the guard, read through `customerReads.hasBrewProfileFactsSql` so lint rule 4 holds.
  - The log line ends with `keptForFacts=<n>`.
- **`services/customerReads.ts`:** `getUsualDrinks`, `getCupboardCoffee`, `getCoffeeFeeling`, `getBrewProfileFieldCounts` and `hasBrewProfileFactsSql`.
- **`services/customerIntegrity.ts`:** check 17 reads `brew_profile_op`. Checks 22–32 are new, all informational:

  | Id | Brief item | Checks |
  |---|---|---|
  | 22 | 1 | facts resolve to field and op lookups |
  | 23 | 2 | value rows fit each field |
  | 24 | 3 | stored values resolve |
  | 25 | 4 | decompositions are one-to-one |
  | 26 | 5 | seed coverage |
  | 27 | 6 | the three FKs exist |
  | 28 | 7 | the Firestore key is gone |
  | 29 | 8 | `ab_app` grants |
  | 30 | 9 | guests kept by the purge guard |
  | 31 | 10 | `takes_it` against the drinks |
  | 32 | 11 | row shape |
- **Config:** `brewProfile.fields` is removed from `sommelier_config_seed.ts` and from the `SommelierConfig` type. `staleAfterDays` and `maxMarkersPerTurn` stay.

**Frontend:**
- **`components/quiz/PostResultCard.tsx`:** fields and words come from the options payload. It logs the three funnel events, and an empty list renders nothing.
- **`components/quiz/BrewFieldControl.tsx`:** one control per picker, plus the words box. Shared by the card and the mirror.
- **`components/quiz/BrewTypeahead.tsx`:** the one small typeahead, matching case- and diacritic-insensitive on label or alias, by prefix or word start, with pinned values first.
- **`FlavorQuiz.tsx`:**
  - `savedQuizSessionId` is kept at the three `saveQuizResult` calls and reset on retake.
  - The card sits in `qz-after` after the share row, outside the ceremony and the email gate. It renders when `!isProxy && !proxy && savedQuizSessionId && !isWrapping`.
  - `MapQuizStart` is untouched.
- **`profile/BrewProfileMirror.tsx`** is rebuilt from `GET /users/brew-profile/options`.
  - Every active field shows, either with its value or with its prompt as the empty state. Stored values display through `displayLabels`, inactive included.
  - It has no lists of its own and no field branch. It keeps the "Needed / Not needed" decaf words as value rows.
- **`admin/AdminBrewProfileStats.tsx`** is on the Liam flow page (`/admin/sommelier/flow`), with the brew parameters card below it.
- **`lib/api.ts`:** the funnel union widened, `saveQuizResult` returns `{ id }`, and there are three new calls.

**Docs:**
- `WHAT_WE_BUILT.md` #271 and the `WHAT_WE_BUILT_DB.md` "As of" line.
- `SOMMELIER_BUILT.md` S128 and the `REGRESSION.md` section.
- `OPEN_TASKS.md` OT-127 to OT-133, and `usual_drink/README.md`.
- `CATALOG.md` waits for the deploy, because it is generated from production.

## Deviations made during Part A (beyond the ten approved at Task 0)

- **Card words are parameters.** The brief has "no strings in the component except what the payload carries", so the card's heading, Save, Skip and the two placeholders are text rows of `brew_parameter`. They are editable on the same card; each note says `Format: short customer-facing text.` so the card offers a text box. All five wordings are mine, Dana's to edit.
- **A fifth picker, `freeform_list`.** The brief names four pickers, but `aversions` (array_freeform) needs a control and none of the four fits. It is the old mirror's comma-separated box.
- **The time defaults on `customer_brew_profile_change` moved to `clock_timestamp()`.** The card writes several rows in one transaction, and with `now()` two changes in one transaction tie in the fold's `ORDER BY occurred_at`. Production writes are one request each, so nothing changes there; Ella map 3 did the same on its new facts.
- **Liam's setup line.** `formatBrewProfileSummary` keeps its exact wording for the five original fields, so the line is byte-identical for every customer today. A new field with a value is appended by its label ("how you make your coffee: Latte, cappuccino or flat white") so Liam knows it is there and does not ask again (B4). It still has the five original labels in code; OT-133 covers that, along with the mirror's chrome words (heading, empty sentence, Edit/Remove/Save/Cancel), which I left as they were.
- **"Never in the first turn"** reads `sommelier_sessions.turn_count`. `/start` sets it to 1, so the customer's first message is never asked.
- **Test seams.** `resolveRemember(…, runner?)` and `logFunnelEvent(…, runner?)` take an optional transaction so the tests can roll back. Requests pass nothing and use the pool.

## Seeded rows

**Drinks** (`usual_drink` values and `brew_drink`, test DB):

| code | label | base_method | dilution | milk | home | words |
|---|---|---|---|---|---|---|
| espresso | Espresso, straight | espresso | none | none | yes |  |
| cortado | Cortado or macchiato (espresso, a little milk) | espresso | none | steamed | yes |  |
| americano | Americano (espresso + hot water) | espresso | water | none | yes |  |
| americano_milk | Americano with milk | espresso | water | cold | yes |  |
| iced_americano | Iced americano | espresso | ice | none | yes |  |
| latte | Latte, cappuccino or flat white | espresso | none | steamed | yes |  |
| iced_latte | Iced latte | espresso | ice | cold | yes |  |
| drip_black | Drip or pour-over, black | filter | none | none | yes |  |
| drip_milk | Drip or pour-over with milk | filter | none | cold | yes |  |
| iced_coffee | Iced coffee (brewed, over ice) | filter | ice | none | yes |  |
| french_press | French press or AeroPress | immersion | none | none | yes |  |
| cold_brew | Cold brew | cold_brew | none | none | yes |  |
| moka_turkish | Moka pot or Turkish | stovetop | none | none | yes |  |
| pod | Pod machine | pod | none | none | yes |  |
| buy_out | I mostly buy my coffee out | none | none | none | no |  |
| other | Something else | none | none | none | yes | yes |

**Brands** (`cupboard_coffee` values, `brew_cupboard_brand`, aliases; `roaster_id` NULL on every row):

| code | label | kind | pinned | words | aliases |
|---|---|---|---|---|---|
| dont_know | I don't know | unknown | yes |  |  |
| nothing | Nothing right now | none | yes |  |  |
| pods_unknown | Pods, not sure of the brand | unknown | yes |  | k-cup, keurig, nespresso |
| other | Something else | unknown | yes | yes |  |
| dunkin | Dunkin' | chain |  |  | dd, dunkin donuts |
| starbucks | Starbucks | chain |  |  | sbux |
| peets | Peet's Coffee | chain |  |  | peets |
| mcdonalds | McCafé | chain |  |  | mccafe, mcdonalds |
| tim_hortons | Tim Hortons | chain |  |  |  |
| caribou | Caribou Coffee | chain |  |  |  |
| wawa | Wawa | chain |  |  |  |
| folgers | Folgers | mass_market |  |  |  |
| maxwell_house | Maxwell House | mass_market |  |  |  |
| bustelo | Café Bustelo | mass_market |  |  | bustelo, cafe bustelo |
| pilon | Café Pilón | mass_market |  |  | pilon |
| lavazza | Lavazza | mass_market |  |  |  |
| illy | Illy | mass_market |  |  |  |
| eight_oclock | Eight O'Clock | mass_market |  |  | 8 oclock |
| chock_full | Chock full o'Nuts | mass_market |  |  | chock full of nuts |
| green_mountain | Green Mountain Coffee | mass_market |  |  |  |
| donut_shop | The Original Donut Shop | mass_market |  |  | donut shop |
| seattles_best | Seattle's Best | mass_market |  |  |  |
| gevalia | Gevalia | mass_market |  |  |  |
| community | Community Coffee | mass_market |  |  |  |
| death_wish | Death Wish Coffee | mass_market |  |  |  |
| black_rifle | Black Rifle Coffee | mass_market |  |  | brcc |
| kirkland | Kirkland Signature (Costco) | mass_market |  |  | costco |
| trader_joes | Trader Joe's | mass_market |  |  |  |
| aldi | Aldi (Barissimo) | mass_market |  |  | barissimo |
| store_brand | Another supermarket's own brand | mass_market |  |  | shoprite, stop and shop, wegmans, whole foods 365 |
| counter_culture | Counter Culture Coffee | specialty |  |  | ccc |
| intelligentsia | Intelligentsia | specialty |  |  |  |
| stumptown | Stumptown | specialty |  |  |  |
| blue_bottle | Blue Bottle Coffee | specialty |  |  |  |
| la_colombe | La Colombe | specialty |  |  |  |
| verve | Verve Coffee | specialty |  |  |  |
| onyx | Onyx Coffee Lab | specialty |  |  |  |
| equator | Equator Coffees | specialty |  |  |  |
| ritual | Ritual Coffee | specialty |  |  |  |
| joe_coffee | Joe Coffee | specialty |  |  | joe, joe coffee company |
| utopian | Utopian Coffee | specialty |  |  |  |
| joe_bean | Joe Bean Coffee Roasters | specialty |  |  | joe bean |
| path | Path Coffee Roasters | specialty |  |  |  |
| temecula | Temecula Coffee Roasters | specialty |  |  |  |
| devocion | Devoción | specialty |  |  | devocion |
| partners | Partners Coffee | specialty |  |  |  |
| irving_farm | Irving Farm | specialty |  |  |  |
| cafe_grumpy | Café Grumpy | specialty |  |  | cafe grumpy |
| brooklyn_roasting | Brooklyn Roasting Company | specialty |  |  |  |
| birch | Birch Coffee | specialty |  |  |  |
| stone_street | Stone Street Coffee | specialty |  |  |  |
| orens | Oren's Coffee | specialty |  |  | orens |
| porto_rico | Porto Rico Importing | specialty |  |  |  |
| variety | Variety Coffee Roasters | specialty |  |  |  |
| rook | Rook Coffee | specialty |  |  |  |
| small_world | Small World Coffee | specialty |  |  |  |
| modcup | Modcup | specialty |  |  |  |
| hidden_grounds | Hidden Grounds | specialty |  |  |  |
| local_roaster | A local roaster not on this list | specialty |  |  | local, roastery |

**Feelings** (`coffee_feeling` values and `brew_coffee_feeling`):

| code | label | dial_move | is_customer_move |
|---|---|---|---|
| happy | I'm happy with it | stay | true |
| bolder | I'd like something bolder | bolder | true |
| gentler | I'd like something gentler | gentler | true |
| different | I'd like something different | different | true |

The existing fields were seeded from the live config exactly:
- `brew_methods`: 8 values, `max_items` 8.
- `grinder`: 5 values.
- `takes_it`: 4 values.
- `decaf_constraint`: `true` "Needed" and `false` "Not needed".
- `aversions`: `max_items` 10, `max_item_len` 40.

Labels come from the mirror, and topics from the old `TOPIC_TO_FIELD`. `prompt` is NULL and `ask_when_empty` false on all five.

## Evidence (test DB)

**Tests.** `src/services/usualDrink.test.ts` passes 17 of 17. Every write runs in a rolled-back transaction.
- **The field list (B1):** the eight seeded fields are served synchronously, and the card gets the three with a prompt, in order.
- **Three writers, all three fields, the views (Part E 1):** quiz, onsite and liam rows resolve through the views, and only quiz rows carry `quiz_session_id`. Latte resolves to espresso / none / steamed, and `americano_milk` to espresso / water / cold. The brand kinds are specialty, mass_market and chain. Each `move_code` equals the `dial_move` read from the FK.
- **The post-result card (B2):**
  - One answer out of three shown gives one `set` and two `declined` rows.
  - Skip declines all three, and resubmitting inserts nothing.
  - A changed answer is a new row and the fold shows the new value. A decline followed by an answer keeps both rows.
  - Declined rows change no view: value, `captured_at` and `source` stay the same.
  - Two drinks are stored as a two-element array. `max_items + 1` is rejected and counted, and the door refuses it too.
  - Words are kept on `other`, rejected on any other value, and rejected over `max_item_len`.
  - A proxy-quiz session answers 409 and writes nothing; a session the caller does not own answers 403.
  - A guest answers the card, then signs up: the canonical profile shows the guest's values.
- **The field rows are the switch (A4, the kill switch):** a deactivated value leaves the options while a customer who stored it still sees it, and `prompt` NULL removes a question.
- **Liam markers (B4):**
  - `other|words` lands as `other` plus the words, `usual_drink=latte` adds to the array, `coffee_feeling=bolder` lands with its move, and `unicorn` is dropped and counted.
  - Liam's field list carries the codes, the kitchen labels and aliases, and the words form.
  - Ask-when-empty asks once, never on the first message, only on its topic, and never when the field has a value.
- **The purge guard (A8, D13; empty-guest rule only):** a guest with a brew-profile row and no quiz is kept; one without the row is a candidate; a stale-quiz guest stays identity-only.
- **Funnel events and grants (A3b, A6):**
  - The three card events insert against `quiz_funnel_event_type`; an unknown event is dropped, never an error.
  - As `ab_app`, INSERT into `brew_drink`, `brew_cupboard_brand`, `brew_coffee_feeling` and `brew_profile_field_value` is denied, and `brew_card_view_event` keeps its INSERT.

Frontend `src/app/components/quiz/BrewTypeahead.test.ts` passes 7 of 7. It covers pinned values before typing, "count" finding Counter Culture, the alias and the word inside a label, diacritics both ways, and the draft conversions.

**The browser run** (local Vite :5173 → backend :4917 on the test DB, as the marked test admin `Zzz Test Admin (Usual Drink 1)`, uid `9G4jmbMJttMZ8t9t9E9EEtH4V132`; the brief's production smoke sequence run here first):
1. **Quiz at 390 px.** The card appeared under the result with three questions. Two drinks picked, kitchen skipped, feeling "I'd like something bolder", then Save: `POST /api/quiz/post-result` answered 200 with `inserted 3` and the card closed.
2. **Profile.** The mirror showed the two drinks and the feeling, with the kitchen's prompt as its empty state. Typing "count" offered only Counter Culture Coffee; I picked it and saved. The feeling changed to gentler.
3. **The rows** (test DB):

| field | op | value | source | quiz session | at |
|---|---|---|---|---|---|
| usual_drink | set | ["latte","drip_black"] | quiz | yes | 00:22:19 |
| cupboard_coffee | declined | | quiz | yes | 00:22:19 |
| coffee_feeling | set | "bolder" | quiz | yes | 00:22:19 |
| cupboard_coffee | set | "counter_culture" | onsite | no | 00:22:33 |
| coffee_feeling | set | "gentler" | onsite | no | 00:22:34 |

4. **Admin row.**
   - Per field: `usual_drink` 1 customer, coverage 100% (1 of 1); `cupboard_coffee` 1 declined, coverage 0% (0 of 1); `coffee_feeling` 100%.
   - Distributions: drinks (latte 1, drip_black 1), base methods (espresso 1, filter 1), brand (Counter Culture 1, specialty 1), feeling (gentler 1), and card events (shown 1, saved 1).
   - The parameter card lists the refresh interval (300, editable in range) and the five card words.
5. **Boot log** (test DB): `[brew-profile] field list loaded: 8 fields`. Customer integrity checks 22–32 pass except check 28, which is expected: the Firestore key comes out after deploy, on Dana's go.

Screenshots in this folder: `ud1_card_empty.png`, `ud1_card_answered.png`, `ud1_mirror_before.png`, `ud1_mirror_typeahead.png`, `ud1_mirror_after.png`, `ud1_admin_row.png`. The test admin is demoted and disabled, and both local servers are stopped.

**Leak greps** (acceptance 3):
- `grep -rn "brew_drink_archetype_offset\|brew_offset_basis\|lookup_table" backend/src frontend/src` matches only this folder's brief, spec and report text, with no code hit.
- `grep -rn "usual_drink\|cupboard_coffee\|coffee_feeling" frontend/src` matches nothing.

**Lints and types:**
- All six lints are clean: `lint:catalog`, `lint:customer`, `lint:lineage`, `lint:retention`, `lint:roastery-portal`, `lint:cupping`.
- Backend `tsc` is clean. Frontend `tsc` shows the 7 known errors, none in this brief's files.

**Full suites:**
- **Backend:** `npx vitest run src` (OT-122) gives 26 failed / 1217 passed / 6 skipped. 25 of the failures are the brief 3 baseline: evidenceViews 7, quizScoring 6, evidenceAdmin 3, sommelierEval 2, catalogImport 2, sommelierRag 1, sommelierAnswer 1, catalogService 1, schema.catalog_blueprint 1, guard 1 (catalog integrity check 6, The Waverly). That is one fewer than brief 3's 26 (sommelierRag 2 → 1). The 26th is a `blendResolver` case that timed out at 5 s under the parallel load; run alone it passes 7 of 7.
- **Caught on the first run:**
  - `sommelier.test` and `roasteryPortal.test` read the old code fallback; they now prime or load the field list.
  - Two `householdService` deadlocks came from my purge test mass-updating `user_profile` while that suite ran in parallel. The test now touches only its own rows: the test DB has 16 empty and 20 stale-quiz candidates, far under the batch of 500.
- **Frontend:** 158 passed (151 plus 7).

## What happens on your go (production; nothing done yet)

1. **A3d backup (STOP point).**
   - `pg_dump --table customer_brew_profile_change --table quiz_funnel_event` from production to the quiz v2.2 backup location.
   - Before the deploy, record each table's row count and `md5(string_agg(row::text, '|' ORDER BY id))`. Production today: 17 and 464 rows (Task 0.7, 0.8).
2. **Commit and push.** The commit is in place, by path. The push is the deploy, and the boot applies the schema: seeds, the three FKs (all 17 brew rows and every funnel row already resolve, so no WARNING is expected) and the grants. Then the deploy run must be green.
3. **Boot log:**
   - `[brew-profile] field list loaded: 8 fields`, no ERROR, `[data-catalog]` with the expected stale `CATALOG.md`.
   - Customer integrity 22–32, where 28 stays a finding until step 4.
4. **After the deploy:**
   - The same two numbers, which must equal the before-numbers. The FK swap and the new columns rewrite no row.
   - Then the Firestore one-off on `config/sommelier`: dry-run showing `brewProfile.fields`, delete the key, read back and assert it is absent.
5. **`npm run catalog:md -- --expect-db axisandbloom`**, then commit `CATALOG.md` by path and push.
6. **Production smoke** with `quiz-scenario-test@axisandbloom.test`, the same sequence as the browser run above, then the admin row read.

## Open items

- OT-127 to OT-133 (in `OPEN_TASKS.md`):
  - the feeling in the first match;
  - drinks against the roaster's brew method, plus that table's composite PK;
  - home ZIP on the card;
  - brand-to-roaster links;
  - pod drinkers;
  - buy-out drinkers;
  - the mirror's chrome words and Liam's original summary labels.
- **The five card wordings** in `brew_parameter` are mine ("A little about your coffee at home", "Save", "Skip", "Tell us which one", "Start typing a name"). Dana edits them on the card.
- **The ask-when-empty rule is untested against the live model.** The unit tests cover when the question is offered; how Liam phrases it shows in the first real conversations.

## Run on production (2026-11-14)

- **Go steps 1–6 done 2026-11-14 (648fb24 rev 00859, CATALOG.md 878b5a3):** the backup was a read-only COPY-format dump of both tables (`backend/tmp/backups/`, gitignored; `pg_dump` is not installed here). Counts were 17 / 464 before and after, and the md5 over the pre-deploy columns matched for both tables (`0443758959c5ad4cec448d7e483e22e8`, `91e5547ef00a78da3d538b4cdb2f546a`); the brew table's whole-row md5 changed only because the two new columns are NULL on every row. The deploy was green, the three FKs were added with no WARNING, and the boot log showed `field list loaded: 8 fields`. Firestore `brewProfile.fields` was deleted and read back absent, with a copy kept in `tmp/backups`. The smoke ran through the deployed API as the test user, because the canonical-host redirect and Cloudflare stop a headless browser: card 200 with 3 rows (two `set`, one `declined`, all carrying quiz session `7d16ffe8`), Counter Culture and gentler from the Profile route, an unknown funnel event dropped, and the admin numbers read read-only. One thing to know: the client brew-profile API reports a `quiz` source as `profile_page` (its existing two-label mapping); the fact row keeps `quiz`.
- **Follow-up, coffee_feeling as single-choice chips (8acced2, rev 00861, CATALOG.md in the docs commit):** a new `brew_profile_picker` row `chips` ("Chips, one"). A guarded one-time update moves the `coffee_feeling` field row from `select` to it, and only while the row still has the seed's `select`. `BrewFieldControl` renders it as chips on the card and the mirror, and picking the picked chip again clears it. Tests: `BrewFieldControl.test.tsx` (3, frontend, 161 total), `usualDrink.test.ts` asserts the picker. Production `/api/quiz/post-result/options` serves `coffee_feeling:chips`.
