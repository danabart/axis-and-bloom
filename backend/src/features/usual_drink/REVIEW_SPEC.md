# Review spec — Usual Drink 1 (capture the daily cups, the kitchen and the feeling) — Rev 4

You are reviewing, not building. You have no prior context on this repo; everything you need is listed under "Read first". Do not edit any file except the one report you write. Your output is one report, in the format at the end, written to `backend/src/features/usual_drink/REVIEW_<A|B>_<yyyy-mm-dd>.md`.

Two review modes; Dana tells you which:

- **Mode A, design review**: the brief `CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md` (Rev 4) has not been executed. You check the brief against the repo and the rules.
- **Mode B, result review**: Claude Code executed the brief and wrote `CLOSING_REPORT_1.md`. You check the code, the schema and the report against the brief and the rules.

Files prefixed `SUPERSEDED_` in this folder are history (Rev 1, Rev 3); read them only to confirm that a Rev 1 shape (`brew_drink_archetype_offset`, `brew_offset_basis`, a `lookup_table` text column, a single-field card) or a Rev 3 shape (single-valued `usual_drink`, the "milk shift" reading, a hypothesis entry about it) did not leak into the code or the docs.

## Read first (in this order)

1. `backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md` (the brief, Rev 4).
2. `DEVELOPMENT_GUARDRAILS.md` (G1 to G9), `CLAUDE.md`, `OBSERVABILITY_POLICY.md`, `GAPS.md`.
3. `backend/src/features/customer_blueprint/README.md` and the C1–C3 briefs there: the fact-table discipline (insert-only door `customerFacts.record.*`, reads only through `customerReads.ts` and views, `lint-customer.mjs` rules 1–7, integrity checks in `customerIntegrity.ts`).
4. `loop/design/customer-context/DESIGN.md`: the sibling design that shares the post-result card and the fact conventions (its D4 answered/declined rows, D29 purge guard, D44 as-of reads).
5. `backend/src/features/ella_bloom_map/README.md` and `CLOSING_REPORT_3.md`: brief 3 changed `routes/quiz.ts POST /results`, the quiz result screen and the profile page; this brief sits on top of it and must not touch `matchService`, `dial_*` objects or the map surfaces. `dial_move` (Ella map 1) is the FK target of the feeling.
6. `backend/src/db/schema.sql`: `customer_brew_profile_change`, `v_customer_brew_profile`, `customer_brew_profile_fold()`, `v_palate_evidence`, `lookup_value`, `roaster`, `dial_move`, the prefix-driven grant blocks, `quiz_funnel_event`, `quiz_session` (`taken_by_user_id`), `coffee_archetype`.
7. `backend/src/services/brewProfile.ts`, `customerFacts.ts`, `customerReads.ts`, `customerIntegrity.ts`, `staleGuestCleanup.ts`; `backend/src/routes/users.ts` (`/brew-profile`), `routes/sommelier.ts` (`resolveRemember`, `getBrewProfile`), `routes/quiz.ts`; `backend/src/db/seeds/sommelier_config_seed.ts` (`brewProfile.fields`).
8. `frontend/src/app/components/FlavorQuiz.tsx`, `frontend/src/app/components/profile/BrewProfileMirror.tsx`, `Profile.tsx`, and (Mode B) the card, chips and typeahead components the report names.
9. `backend/scripts/lint-customer.mjs`, `backend/scripts/lint-catalog.mjs`.
10. Mode B only: `CLOSING_REPORT_1.md`, `git log` since the commit the report names, `git diff <base>..HEAD --stat`, `WHAT_WE_BUILT_DB.md`, `CATALOG.md`, `SOMMELIER_BUILT.md`, `REGRESSION.md`, `OPEN_TASKS.md` entries the report claims.

## Fixed decisions (do not re-open; flag only if the brief or code contradicts them)

- Nothing enters the quiz questions or changes the quiz result, the first match, the map, the dial, Liam's recommendation or the profile line. Capture only.
- Three fields, in this order: `usual_drink` (**multiple choice**, several drinks per person, plain multiple choice, no "daily one" marker), `cupboard_coffee` (single), `coffee_feeling` (single, four answers: `happy`, `bolder`, `gentler`, `different`).
- Where they are asked: the optional post-result card AND the Profile page (the mirror renders the same fields), and Liam asks when a field is empty (`ask_when_empty` on the field row). Customers can change an answer anywhere; each change is a new insert-only row. The card is not shown after a proxy quiz (`forMemberId`, `quiz_session.taken_by_user_id`), and the card route refuses a proxy session.
- **No offset table.** Nothing named `brew_drink_archetype_offset` or `brew_offset_basis` is created; no roast level or archetype guess per brand; milk and `takes_it` do not move a start position; no "milk shift" reading and no hypothesis entry about one anywhere (Rev 3's planned `PALATE_MODEL_HYPOTHESIS.md` entry is withdrawn).
- The feeling maps to a move by FK: `brew_coffee_feeling.move_id → dial_move(id)` (`stay`, `bolder`, `gentler`, `different`). The mapping is a row, never a switch in code, and nothing reads it in this brief.
- Field definitions move from Firestore config, CHECK constraints and TS unions into tables (`brew_profile_field`, `brew_profile_field_value`, `brew_profile_value_kind`, `brew_profile_picker`, `brew_profile_op`).
- One value table: every allowed value of every field is a `brew_profile_field_value` row; `brew_drink`, `brew_cupboard_brand` and `brew_coffee_feeling` each decompose a value through `field_value_id` (FK, UNIQUE) and carry no code/label/sort_order/is_active of their own. No column holds a table name; no dynamic SQL; no view branch that names a table.
- Small lists are their own `brew_*` tables with `id`, `code UNIQUE`, `label`, `sort_order`, `is_active`; `lookup_value` was considered and rejected (no `is_active`; no FK target for a code column), and each table's comment says so.
- `customer_brew_profile_change` gains `quiz_session_id UUID REFERENCES quiz_session(id)` (nullable, quiz writer only) and `customer_words TEXT` (nullable, only when the picked value row has `accepts_words`, capped at the field's `max_item_len`).
- A declined question is a fact: `op = 'declined'`, `value NULL`, `quiz_session_id` set, one per shown-but-unanswered field; `op` is a lookup (`brew_profile_op`) with FK; the fold ignores `declined`; `v_palate_evidence` does not count it.
- Brands: `brew_cupboard_brand` (brand_kind FK, nullable `roaster_id → roaster(id)` never set by the seed) and `brew_cupboard_brand_alias`; the typeahead filters client-side on label and aliases; `pinned` values show before typing.
- Presentation is data: `brew_profile_field.picker_id` decides the control (select, multi_select, typeahead, toggle); no component logic keyed on a field code.
- The stale-guest purge never selects a guest who holds a `customer_brew_profile_change` row (any op); the guard is in the candidate queries, not in error handling.
- Naming: `customer_*` only for insert-only facts; `user_*` per-user operating state; `coffee_*` catalog; `dial_*` the map; operational brew-preparation, kitchen and feeling reference data is `brew_*`. Per-customer derived reads stay `v_customer_*`.
- Repo rules (DEVELOPMENT_GUARDRAILS.md): nothing hard coded; every table has a surrogate `id` PK, natural keys UNIQUE; facts insert-only; no strict mode anywhere; `COMMENT ON` everything, `CATALOG.md` regenerated; no PR, Dana merges to main; push deploys; commits add files by path.

## What to check

Work through every item. For each, answer pass / fail / cannot tell, with file:line evidence. "Cannot tell" is a valid answer and must say what would settle it.

### 1. Writers and readers (the rules that matter most here)
- Every write of any of the three fields (card route, Profile PATCH/DELETE, Liam `resolveRemember`) goes through `customerFacts.record.brewProfileChange`, including `declined` rows. No other INSERT into `customer_brew_profile_change`. No UPDATE/DELETE on any fact table. The card route writes one transaction per card.
- `v_brew_profile_field_current` has exactly one reader function (`getBrewProfileFieldsConfig()`); the validator, mirror field list, card options endpoint and prompt builder all call it. No route SELECTs `brew_profile_field`, `brew_profile_field_value`, `brew_drink`, `brew_cupboard_brand*` or `brew_coffee_feeling` directly.
- `getBrewProfileFieldsConfig()` stays synchronous for its callers, served from a boot-loaded, TTL-refreshed cache; the TTL comes from config, not a literal; a refresh failure keeps the last good list.
- `customer_*` tables and `v_customer_*` views are read only from `customerReads.ts` (lint rule 4). The admin stats go through one `customerReads` function.
- The new lookup tables have no app writer: grants give `ab_app` SELECT only (explicit list; `brew_card_view_event` keeps its INSERT). Seeds are `ON CONFLICT DO NOTHING`; the seed never sets `roaster_id`.
- `reporting_ro` has SELECT on the four new views and every `brew_*` lookup.
- Firestore: no new write to any `users/` path (lint rule 3); the `brewProfile.fields` key is retired from the seed and the read path, and removed from the prod config doc with read-back.
- Nothing in the diff touches `POST /api/quiz/results`, `matchService`, `dial_*` objects, the map surfaces or `MapQuizStart` / `MapTrail`.

### 2. Data integrity
- `customer_brew_profile_change.field`, `.op` and `quiz_funnel_event.event`: CHECK replaced by FK to a lookup; each CHECK dropped by its name as found in `pg_constraint`; DDL idempotent, pre-checks violators and never fails boot; backups of both tables with before/after row count + md5 (Mode B: the numbers are in the report and match).
- `quiz_session_id` and `customer_words` columns exist with the stated types and nullability; integrity check 11 covers the row-shape rules (quiz rows have a session that belongs to the user and is not a proxy session; `declined` rows have NULL value; words only where `accepts_words`; an array `set` value is a JSON array within `max_items` with no duplicates).
- `value` encoding matches the existing writers (JSON string for a code, JSON array for `usual_drink`) so `customer_brew_profile_fold()` and the value join resolve. Mode B: a test proves it for all three writers and all three fields.
- `source_id` for the quiz writer includes field and value (or `declined`), so a changed answer is a new row, a resubmit is a no-op, and a decline followed by an answer keeps both rows.
- The fold ignores `declined` and no `v_customer_*` view changes shape; `v_palate_evidence` excludes `declined` if it counts rows by op, and the report says which.
- Lookup rows are never deleted, only deactivated; views join regardless of `is_active`; only pickers filter to active.
- Decompositions are one-to-one (integrity check 4), including `brew_coffee_feeling` → `dial_move` with `is_customer_move` true.
- The drink seed matches the brief's table exactly (16 rows; `buy_out` the only `is_home_drink = false`; `other` the only `accepts_words`). The brand seed matches (codes, kinds, pinned flags, aliases; the four pinned rows). The feeling seed is exactly four rows mapped to `stay`, `bolder`, `gentler`, `different`.
- `v_customer_usual_drink` returns one row per customer × drink (the array unnested); `v_customer_coffee_feeling` carries `move_code`.
- The new integrity checks (1–11) exist, are informational, and appear on the admin panel.
- The card has a data kill switch: a field is on the card only when active with a non-null `prompt`; an empty field list renders no card.
- No inference: nothing derives any field from other fields, orders, or anything else (no backfill, no view, no prompt rule). Liam saves only a named drink or full preparation, a named brand, or a feeling stated in one of the four senses.
- Purge: both candidate queries exclude guests with a `customer_brew_profile_change` row. Mode B: the test-DB case exists and passes.

### 3. Security and identity
- `POST /api/quiz/post-result` verifies the caller owns `quiz_session.user_id` (403 otherwise), refuses a proxy session (409), validates `shown` against the card-eligible fields, and is rate-limited. Anonymous guests can use it; the Profile `/brew-profile` routes keep `blockAnonymousAuth`.
- `customer_words` is length-capped server-side from `max_item_len` and stored as plain text (escaped wherever rendered).
- Guest answers then signs up: `v_customer_brew_profile` folds across `v_customer_identity`. Mode B: the test-DB case exists and passes.
- Unknown field, op or value, an array over `max_items`, words on a non-`accepts_words` value, words over the cap: dropped, counted in `brew_profile.failures`, never a 500.

### 4. Nothing hard coded
- Drink, brand and feeling names, labels, aliases, question texts (`brew_profile_field.prompt`), allowed values, pickers, pinned flags, `ask_when_empty`, the Liam topic map, the feeling-to-move mapping, the funnel event names, cache TTL, the words cap, `max_items`: all from tables or config, none as literals in code or components. `grep -rn "usual_drink\|cupboard_coffee\|coffee_feeling" frontend/src` must show no logic keyed on any code. List any literal you find with file:line.

### 5. Naming and catalog
- Every new table/column/view follows the prefix rule and has `id` PK + UNIQUE natural key (`brew_drink`, `brew_cupboard_brand`, `brew_coffee_feeling`: `field_value_id`; `brew_cupboard_brand_alias`: `(brand_id, alias)`).
- `COMMENT ON` for each, Purpose | Class | Writer | Readers | Since; Writer says `boot seed (owner role)` for lookups; Readers name the exact functions; each small lookup's comment states why it is not `lookup_value`; the `declined` op row's comment states it is ignored by the fold. `CATALOG.md` regenerated and consistent.
- New views sit outside the Customer Blueprint C3 block (lint rule 7).

### 6. Scope
- Anything in the brief (Mode A) or the diff (Mode B) that is **not** needed for capture: a matching or map change, a dial change, a Liam recommendation change, a new fact table, a backfill, a roast or archetype attribute on brands, a "daily one" marker, an offset table, a hypothesis entry about milk or dilution. Any of these is a finding.
- Anything missing that capture needs and the brief does not say.
- Consistency with `loop/design/customer-context/DESIGN.md` where both touch the same thing (the shared card, answered/declined, purge guard, fact conventions), and with Ella's Bloom Map brief 3 where both touch the result screen and the profile page.

### 7. Mode B only: the closing report
- Every Task 0 item answered with file:line; every deviation stated with a reason.
- Acceptance items each have evidence (command output, row counts, the leak greps returning nothing, test names).
- Prod smoke rows exist for the test user (two drinks `set`, kitchen `declined`, feeling `set`, then a Profile write through the typeahead and a changed feeling) and are excluded from analysis.
- Lint and test output included; pre-existing failure count unchanged and stated.
- `SOMMELIER_BUILT.md`, `REGRESSION.md` and `OPEN_TASKS.md` carry the entries the brief's Docs section lists; `PALATE_MODEL_HYPOTHESIS.md` is untouched by this brief.

## Output format

One markdown report written to `backend/src/features/usual_drink/REVIEW_<A|B>_<yyyy-mm-dd>.md` (the only file you write). Sections:

1. **Verdict**: one of `ready to run` / `run after fixes` / `do not run` (Mode A), or `done` / `done with follow-ups` / `not done` (Mode B). One sentence why.
2. **Findings**, ranked by severity, each as: `[S1|S2|S3] <one-line claim>` then evidence (file:line or report section), what breaks if ignored, and the smallest fix. S1 = data loss, drift, security, or a rule violation; S2 = will cause a bug or a boot problem; S3 = naming, docs, clarity.
3. **Checklist**: the numbered items above, each `pass` / `fail (→ finding n)` / `cannot tell (needs X)`.
4. **Not findings**: anything you considered and judged fine where a reader might worry. Keep it short.

Do not propose new features, new workstreams or process. Do not restate the brief. If the brief and the repo disagree, the repo is the fact and the brief is wrong.
