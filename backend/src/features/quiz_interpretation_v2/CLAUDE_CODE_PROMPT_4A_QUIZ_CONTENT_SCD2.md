# Claude Code Prompt 4A: quiz questions and answers become SCD Type 2 (zero behaviour change)

> Written 2026-10-08 by the CTO session, decided by Dana the same day. Run this BEFORE Prompt 4B (the
> Balanced branch and interpretation v2.2). 4B makes the first real copy edits and adds answers; this brief
> only changes how quiz content is stored, so that those edits retire rows instead of overwriting them.
> Dana is the only developer and merges straight to main. No PR. Push to main is a production deploy.

## What this is

Today question and answer text inside v7 is overwritten in place by the re-asserting `DO $v7$` seed block in
`backend/src/db/schema.sql` on every boot. There is no history: a session stores answer ids, so after a copy
edit an old session appears to have picked the new wording. The seed also runs two `DELETE` statements on
`quiz_answer_archetype_score` at every boot.

After this brief:

- `quiz_question` and `quiz_answer` are SCD Type 2. A change to a question or an answer closes the current
  row and inserts a new row with a new id. Nothing is updated in place, nothing is deleted.
- Old rows keep their ids and their score rows, so every historical session still scores exactly as before.
- Answer display order is an explicit column, not `ORDER BY id`.
- The database refuses in-place edits and deletes on quiz content, for every role.

**The quiz a customer sees must be identical before and after this brief: same question ids, same answer
ids, same text, same order, same scores.** No copy changes here. If any id or text differs, stop.

## Decisions already made (Dana, 2026-10-08, do not reopen)

1. Full SCD Type 2 on the tables themselves (new row, new id per change), not a side history table.
2. A snapshot of the quiz content tables is taken before anything is altered.
3. Never delete, only retire. The seed's two DELETEs on score rows are removed and replaced by integrity
   checks that report strays instead of removing them.
4. Two runs: this brief first, 4B second, so a problem at the quiz front door can be attributed.

## Hard rules

1. No DELETE statement is written or executed, on any table. The two existing DELETEs in the `$v7$` block
   are removed, not extended.
2. No existing `quiz_question.id` or `quiz_answer.id` changes. No existing row's text, archetype, gate flag
   or score changes. The only writes to existing rows are filling the new columns.
3. `quiz_session`, `quiz_session_interpretation`, `newsletter_subscriber` and every `customer_*` table are
   not touched. Take count + md5 of `quiz_session` before and after as proof, as in earlier briefs.
4. Do not touch the retired v4/v5/v6 seed blocks or the files in `src/db/migrations/` (they are not run).
5. Commit by explicit file list. Never `git add -A` (the tree has CRLF churn and old uncommitted edits).

## Task 0: verify first, report findings in the closing report

- `migrate.ts` sends `schema.sql` as one multi-statement query. Confirm that a failure anywhere rolls the
  whole file back, and say what Cloud Run does when the new revision fails to boot (old revision keeps
  serving?). If a partial apply is possible, stop and report before going further.
- Confirm that no application code writes quiz content. Expected readers only: `routes/quiz.ts`,
  `services/quizScorer.ts`, `services/quizIntegrity.ts`, the backfill, tests. Expected writers: `schema.sql`
  only. If anything else writes, stop and report.
- Confirm the retired v4/v5/v6 seed blocks are no-ops against a database that already has those versions,
  so the new columns' defaults are all they ever need.
- Before any change, save the live production responses of `GET /api/quiz/questions` and
  `GET /api/quiz/branch?archetypeId=` for the Chocolate & Nutty, Fruity and Balanced archetype ids to
  `backend/tmp/quiz_content_before/` (gitignored). These are public endpoints: no database connection, no
  proxy. They are the reference for "identical".

## Part A: snapshot (in `schema.sql`, runs at boot under the owner role)

Immediately before the new SCD2 DDL of Part B (after the existing `answer_code` ALTER, before `DO $v7$`):

```sql
CREATE TABLE IF NOT EXISTS quiz_backup_20261008_quiz                        AS TABLE quiz;
CREATE TABLE IF NOT EXISTS quiz_backup_20261008_quiz_question               AS TABLE quiz_question;
CREATE TABLE IF NOT EXISTS quiz_backup_20261008_quiz_answer                 AS TABLE quiz_answer;
CREATE TABLE IF NOT EXISTS quiz_backup_20261008_quiz_answer_archetype_score AS TABLE quiz_answer_archetype_score;
```

`IF NOT EXISTS` means only the first boot's snapshot is ever kept: it is the pre-SCD2 state, including the
production-minted ids, which are the part `schema.sql` cannot rebuild. The snapshot tables are never written
again. `ab_app` gets SELECT only on them (Part E).

## Part B: SCD2 columns

`quiz_question` and `quiz_answer` each gain:

| column | type | meaning |
|---|---|---|
| `valid_from` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | when this version went into service |
| `valid_to` | `TIMESTAMPTZ NULL` | when it was retired; null while current |
| `is_current` | `BOOLEAN NOT NULL DEFAULT true` | exactly the latest version of its business key |

`quiz_answer` also gains `sort_order SMALLINT`: display position inside its question.

Use the file's existing idempotent style (`ADD COLUMN IF NOT EXISTS`). One-time fill for existing rows,
written so a second boot is a no-op:

- `valid_from` = the owning quiz's `created_at` (answers via their question). `valid_to` null, `is_current`
  true, for every existing row including retired v4/v5/v6 content (quiz-level retirement stays
  `quiz.is_active`).
- `sort_order` = the row's rank by `id` within its question. That is exactly today's display order
  (`ORDER BY a.id`), so nothing moves on screen.
- Known limit, to be written into the doc (Part G), not fixed: `v7_q3_a`, `v7_q3_b`, `v7_q6_b` and the Q3
  stem were edited in place on 2026-08-15. Sessions before that date saw the earlier wording; it survives
  only in the seed's adoption list. Do not fabricate historical rows for it.

Business keys and constraints:

- Question: `(quiz_id, q_number)`. `CREATE UNIQUE INDEX ... ON quiz_question (quiz_id, q_number) WHERE is_current`.
  If existing data violates it (duplicate q_number inside a retired quiz), stop and report, do not "fix".
- Answer: `answer_code` where present. Replace the existing index: `DROP INDEX IF EXISTS quiz_answer_code_unique`
  and create `quiz_answer_code_current_unique ON quiz_answer (answer_code) WHERE answer_code IS NOT NULL AND is_current`.
  Change the old `CREATE UNIQUE INDEX IF NOT EXISTS quiz_answer_code_unique` line in place so it is not
  recreated on the next boot.
- `CHECK ((is_current AND valid_to IS NULL) OR (NOT is_current AND valid_to IS NOT NULL))` on both tables.

## Part C: the seed asserts versions instead of overwriting (`DO $v7$` block)

Rewrite the write logic of the block. The content lists (question texts, the answer `VALUES` list, the score
list) stay exactly as they are today. Add each answer's `sort_order` to the content list, taken from its
current production order (Task 0 snapshot), so the list and the database agree.

Semantics, as two SQL functions or inline, your choice:

- **Assert a question** `(quiz_id, q_number, q_text, weight)`:
  no current row → INSERT. Current row identical → nothing. Current row differs → close it
  (`valid_to = now(), is_current = false`), INSERT the new version, and re-version every current answer of
  the old question row onto the new question id (same text, same code, same sort_order, score rows copied).
  An old answer id therefore always leads to the stem the person actually saw.
- **Assert an answer** `(answer_code, question_id, answer_text, resulting_archetype_id, is_experimental_gate, sort_order)`:
  no current row for the code → INSERT. Identical → nothing. Differs → close the current row, INSERT the new
  version, copy its score rows to the new id. `sort_order` alone changing also makes a new version.
- **Scores** stay keyed by `answer_code`, resolved to the CURRENT row. Insert when missing. A different
  score for a current answer is a new answer version (close, insert, new score row), never an UPDATE of the
  score row. Remove both DELETE statements. Old answer versions keep their score rows forever.
- A code that disappears from the list is NOT retired automatically. Retiring an answer is an explicit line
  in the seed (close the row, no successor). Nothing is retired in this brief.
- The "Change 2" adoption UPDATE (sets `answer_code` where null by matching text) stays as it is. It matches
  zero rows today.
- Quiz rows (`quiz`): unchanged in this brief, including the `is_active = true` re-assert.

Idempotency is the test: against production's current content this block must insert zero rows and close
zero rows.

## Part D: reads

- `GET /api/quiz/questions` and `GET /api/quiz/branch` (`routes/quiz.ts`): current questions and current
  answers only; answers `ORDER BY a.sort_order, a.id`. No other change to either response.
- `services/quizScorer.ts`: no change. It reads by answer id, which must keep working for retired versions.
  Add a test that proves it: re-version an answer in the test database, score the OLD id, same result.
- `services/quizIntegrity.ts`: checks 0, 3, 4 and 7 count current rows only. Check 4 keeps "Q1 to Q5 exactly
  one score row, Q6 none" on current answers; check 7 adds "branch answers have no score rows". These two
  replace the removed DELETEs: a stray row is reported, not removed. New checks:
  exactly one current row per `(quiz_id, q_number)` and per `answer_code`; no current answer points at a
  non-current question; every current answer on the active quiz and its branches has a `sort_order`, unique
  within its question.
- `v_quiz_scoring_matrix`: add `is_current`, `valid_from`, `valid_to` for the answer, and number answers by
  `sort_order`. Same rows otherwise.

## Part E: the database refuses in-place edits (constraints, not comments)

- Triggers on `quiz_question` and `quiz_answer`: `BEFORE DELETE` raises. `BEFORE UPDATE` raises unless the
  only columns changing are `valid_to` and `is_current`, with one exception: setting `answer_code` or
  `sort_order` on a row where it is currently NULL (the adoption UPDATE and the Part B fill).
  Order the file so the Part B fill of `valid_from` runs before the triggers exist, or exempt it the same way.
- Trigger on `quiz_answer_archetype_score`: `BEFORE UPDATE OR DELETE` raises.
- Grants: after the existing operating-table grant loop, `REVOKE INSERT, UPDATE, DELETE` on `quiz`,
  `quiz_type`, `quiz_question`, `quiz_answer`, `quiz_answer_archetype_score` and the four
  `quiz_backup_20261008_*` tables from `ab_app`. The request pool only ever reads quiz content; the seed runs
  as owner. Add an integrity check that `ab_app` has SELECT and nothing else on these.
- If any existing test or boot path breaks on these guards, stop and report rather than loosening them.

## Part F: tests

- Migrate twice on the test database: second run inserts nothing, closes nothing, changes no id.
- Calibration: `quizScoring.test.ts` and the 37-case fixture pass unchanged (the fixture's answer ids are
  production ids and stay valid; `v7AnswerMap.ts` is not edited).
- New tests, test database only: reword an answer through the seed functions → old row closed and intact,
  new row current, score copied, `/questions` serves the new id in the same position, old id still scores.
  Reword a question → its answers are re-versioned onto the new question row. An UPDATE of `answer_text`
  and a DELETE of an answer both raise.

## Part G: docs

- `QUIZ_INTERPRETATION_V2_DECISIONS.md`: new section "Quiz content is SCD Type 2 (2026-10-08)": the rule
  (change = new row, retire never delete), business keys, the question-to-answers re-versioning rule, the
  2026-08-15 known limit, the snapshot table names.
- `WHAT_WE_BUILT.md` next numbered entry; `WHAT_WE_BUILT_DB.md` ownership table: quiz content is master
  data, single writer `schema.sql` seed, app role read-only.
- Update the quiz copy-editing instructions wherever they live in the repo docs: a copy edit is now a new
  line value in the seed list and produces a new version; "UPDATE in place by answer_code" no longer applies.

## Definition of done

1. Test database: migrate twice clean, `npm test` green, all lints green
   (`lint:catalog`, `lint:customer`, `lint:retention`, `lint:roastery-portal`).
2. Test database serves `/questions` and `/branch` with the same shape as before, ordered by `sort_order`.
3. **STOP. Report to Dana: Task 0 findings, the test results, and the exact list of files to commit. Wait
   for "go". This is the only stop.**
4. Commit by explicit file list, push, deploy green, startup log clean (no trigger or constraint error).
5. Production, read-only, no database proxy: the three saved endpoint responses from Task 0 are
   byte-identical to the live ones after deploy (ids, text, order). `GET /api/admin/quiz/integrity` and
   `GET /api/admin/customer/integrity` green. The four snapshot tables exist with the same row counts the
   source tables had. `quiz_session` count + md5 unchanged.
6. One closing report covering every item above. If the identical-response check fails, say so first and
   do not attempt a fix without Dana.

## Out of scope (deliberate)

- Any copy change, the Balanced branch, `branch_answer_id`, interpretation v2.2: all in Prompt 4B.
- `quiz` rows becoming SCD2, and changing the `ON DELETE CASCADE` foreign keys (the delete triggers already
  make them unreachable).
- Dropping the snapshot tables. They stay.
