# Review spec — Usual Drink 1 (capture the daily cup)

You are reviewing, not building. You have no prior context on this repo; everything you need is listed under "Read first". Do not edit any file. Your output is one report, in the format at the end.

Two review modes; Dana tells you which:

- **Mode A, design review**: the brief `CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md` has not been executed. You check the brief against the repo and the rules.
- **Mode B, result review**: Claude Code executed the brief and wrote `CLOSING_REPORT_1.md`. You check the code, the schema and the report against the brief and the rules.

## Read first (in this order)

1. `backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md` (the brief).
2. `CLAUDE.md` at the repo root (repo rules), `OBSERVABILITY_POLICY.md`, `GAPS.md`.
3. `backend/src/features/customer_blueprint/README.md` and the C1–C3 briefs there: the fact-table discipline this brief must obey (insert-only door `customerFacts.record.*`, reads only through `customerReads.ts` and views, `lint-customer.mjs` rules 1–7, integrity checks in `customerIntegrity.ts`).
4. `backend/src/db/schema.sql`: the brew-profile fact table (`customer_brew_profile_change`), `v_customer_brew_profile` and `customer_brew_profile_fold()`, the prefix-driven grant blocks near the end, `quiz_funnel_event`, `evidence_parameter`, `coffee_dial_slot`, `coffee_archetype`.
5. `backend/src/services/brewProfile.ts`, `customerFacts.ts`, `customerReads.ts`, `customerIntegrity.ts`; `backend/src/routes/users.ts` (`/brew-profile`), `routes/sommelier.ts` (`resolveRemember`, `getBrewProfile`), `routes/quiz.ts`; `backend/src/db/seeds/sommelier_config_seed.ts` (`brewProfile.fields`).
6. `frontend/src/app/components/FlavorQuiz.tsx`, `frontend/src/app/components/profile/BrewProfileMirror.tsx`.
7. `backend/scripts/lint-customer.mjs`, `backend/scripts/lint-catalog.mjs`.
8. Mode B only: `CLOSING_REPORT_1.md`, `git log` since the commit the report names, `git diff <base>..HEAD --stat`, `WHAT_WE_BUILT_DB.md` and `CATALOG.md` entries the report claims.

## Fixed decisions (do not re-open; flag only if the brief or code contradicts them)

- Preparation never enters the quiz questions or changes the quiz result. Capture is post-result, optional.
- One field, `usual_drink`, the drink made at home most days, single value, from a lookup (`brew_drink`) that includes `buy_out` and `other`.
- Offset hypothesis is drink × archetype in `brew_drink_archetype_offset`, seeded as `basis='hypothesis'`, and **nothing reads it** in this brief. Matching, the dial, Liam's recommendation and the profile line are unchanged.
- Field definitions move from Firestore config, a CHECK constraint and a TS union into tables (`brew_profile_field`, `brew_profile_field_value`, `brew_profile_value_kind`).
- Naming: `customer_*` only for insert-only facts; `user_*` per-user operating state; `coffee_*` catalog; operational brew-preparation reference data is `brew_*`. Per-customer derived reads stay `v_customer_*`.
- Repo rules: nothing hard coded (names, lists, thresholds, mappings live in tables); every table has a surrogate `id` PK, natural keys are UNIQUE; facts insert-only; no strict mode anywhere (checks report, never fail boot); `COMMENT ON` everything, `CATALOG.md` regenerated; no PR, Dana merges to main; push deploys.

## What to check

Work through every item. For each, answer pass / fail / cannot tell, with file:line evidence. "Cannot tell" is a valid answer and must say what would settle it.

### 1. Writers and readers (the rules that matter most here)
- Every write of `usual_drink` (quiz card route, Profile PATCH/DELETE, Liam `resolveRemember`) goes through `customerFacts.record.brewProfileChange`. No other INSERT into `customer_brew_profile_change`. No UPDATE/DELETE on any fact table.
- `v_brew_profile_field_current` has exactly one reader function; the validator, mirror field list, quiz options endpoint and prompt builder all call it. No route SELECTs `brew_drink` or `brew_profile_field` directly.
- `customer_*` tables and `v_customer_*` views are read only from `customerReads.ts` (lint rule 4). The admin stats distribution goes through a `customerReads` function.
- The new lookup tables have no app writer: grants give `ab_app` SELECT only (explicit list; `brew_card_view_event` keeps its INSERT). Seeds are `ON CONFLICT DO NOTHING`.
- `reporting_ro` has SELECT on the two new views and the `brew_*` lookups (named grants, like the other reporting views).
- Firestore: no new write to any `users/` path (lint rule 3); the `brewProfile.fields` key is retired from the seed and from the read path, and the brief/report removes it from the prod config doc with read-back.

### 2. Data integrity
- `customer_brew_profile_change.field` and `quiz_funnel_event.event`: CHECK replaced by FK to a lookup, DDL idempotent, pre-checks violators and never fails boot; backups of both tables with before/after row count + md5 (Mode B: the numbers are in the report and match).
- `value` encoding for `usual_drink` matches the existing writers (JSON string) so `customer_brew_profile_fold()` and the `brew_drink` join resolve. Mode B: a test proves it for all three writers.
- `source_id` for the quiz writer includes the value, so a changed answer on the same card is a new row and a resubmit is a no-op.
- Lookup rows are never deleted, only deactivated; views join regardless of `is_active`; only pickers filter to active.
- `brew_drink_archetype_offset`: partial unique index on current rows; a change is a new row that supersedes; seeds match D4 exactly (+1 only for water/ice-diluted drinks on the intensity-line archetypes, 0 elsewhere, no rows for `buy_out`/`other`). `slot_offset` comment states the `sort_order` direction found in Task 0.
- The new integrity checks (fields resolve, values resolve, offset rows well-formed, seed coverage, Firestore key absent, FK state, grants, `takes_it` vs `usual_drink` disagreements) exist, are informational, and appear on the admin panel.
- The offset seed is an explicit row list, not a rule computed in the seed script (no "intensity line" mapping in code).
- The quiz card has a data kill switch: it renders only when the field is active and `brew_profile_field.prompt` is non-null.
- No inference: nothing derives `usual_drink` from `takes_it`/`brew_methods` (no backfill, no view, no prompt rule). Liam saves only a named drink or a full preparation.

### 3. Security and identity
- `POST /api/quiz/post-result` verifies the caller owns `quiz_session.user_id` (403 otherwise) and is rate-limited. Anonymous guests can use it; the Profile `/brew-profile` routes keep `blockAnonymousAuth`.
- Guest answers then signs up: `v_customer_brew_profile` folds across `v_customer_identity`. Mode B: the test-DB case exists and passes.
- Unknown field or value: dropped, counted in `brew_profile.failures`, never a 500.

### 4. Nothing hard coded
- Drink names, labels, the question text (`brew_profile_field.prompt`), allowed values, the Liam topic map, the funnel event names, cache TTL: all from tables or config, none as literals in code or components. List any literal you find with file:line.

### 5. Naming and catalog
- Every new table/column/view follows the prefix rule above and has `id` PK + UNIQUE natural key.
- `COMMENT ON` for each, in the Purpose | Class | Writer | Readers | Since format; Writer says `boot seed (owner role)` for lookups; Readers name the exact functions. `CATALOG.md` regenerated and consistent.
- New views sit outside the Customer Blueprint C3 block (lint rule 7).

### 6. Scope
- Anything in the brief (Mode A) or the diff (Mode B) that is **not** needed for capture: a matching change, a dial change, a Liam recommendation change, a new fact table, a backfill of `usual_drink`. Any of these is a finding.
- Anything missing that capture needs and the brief does not say. Say what and why.

### 7. Mode B only: the closing report
- Every Task 0 item answered with file:line; every deviation from the brief stated with a reason.
- Definition-of-done items each have evidence (command output, row counts, grep output for the unread offset table, test names).
- Prod smoke rows exist for the test user and are excluded from analysis.
- `npm run lint:catalog && npm run lint:customer && npm test` output included; pre-existing failure count unchanged and stated.

## Output format

One markdown report, `REVIEW_<A|B>_<yyyy-mm-dd>.md` content printed in your reply (do not write files). Sections:

1. **Verdict**: one of `ready to run` / `run after fixes` / `do not run` (Mode A), or `done` / `done with follow-ups` / `not done` (Mode B). One sentence why.
2. **Findings**, ranked by severity, each as: `[S1|S2|S3] <one-line claim>` then evidence (file:line or report section), what breaks if ignored, and the smallest fix. S1 = data loss, drift, security, or a rule violation; S2 = will cause a bug or a boot problem; S3 = naming, docs, clarity.
3. **Checklist**: the numbered items above, each `pass` / `fail (→ finding n)` / `cannot tell (needs X)`.
4. **Not findings**: anything you considered and judged fine where a reader might worry. Keep it short.

Do not propose new features, new workstreams or process. Do not restate the brief. If the brief and the repo disagree, the repo is the fact and the brief is wrong.
