# Claude Code Prompt 4B: Balanced branch, match fields, interpretation v2.2

> Written 2026-10-09 by the CTO session. Replaces `CLAUDE_CODE_PROMPT_4_V2_2_CONFIDENCE_AND_BALANCED_BRANCH.md`
> (kept in this folder with a `SUPERSEDED_` prefix as the record; do not execute it).
> **Precondition: Prompt 4A (quiz content SCD2) is deployed and its integrity checks are green. If the
> seed's assert functions, `sort_order` or the edit-blocking triggers are not in `schema.sql`, stop.**
> Status 2026-10-09: 4A is live (commit `f7eab33`, revision 00747). The seed functions are
> `quiz_assert_question`, `quiz_assert_answer`, `quiz_assert_answer_score`, `quiz_retire_answer`.
> Dana is the only developer and merges straight to main. No PR. Push to main is a production deploy.

## What this is

1. A third branch question, shown to Balanced winners, with three answers.
2. Three layers that used to be one are now recorded separately:
   - **Shown**: what the screen and the email told the person. Already stored (`quiz_session.resulting_archetype_id`,
     `transactional_email_log.archetype`). Not changed by this brief. A Balanced winner is shown Balanced
     whatever they answer on the new branch.
   - **Match**: where on the Bloom Dial we match them. New, on the interpretation row: `match_archetype` and
     `intensity_lean`.
   - **Why**: the raw branch answer, new on the session (`branch_answer_id`), so a later explanation can quote
     what the person actually chose.
3. Interpretation `v2.2`: pair confidence comes from scored answers and the branch answer only.
4. Copy changes on the Earthy and Fruity branches, stored as new versions through the 4A seed functions.
5. A backfill that gives existing sessions a `v2.2` row, dry run and report first.

This brief records the match. It does not change which coffee anyone is offered (Part G).

## Decisions already made (Dana, do not reopen)

- 2026-10-06: the Q6 treat and the experimental gate never lower confidence; they feed Liam's explore list
  only. Confidence = scored answers + branch answer. After a real branch switch the origin stays the forced
  secondary.
- 2026-10-06/07: branch copy never names a flavor, never says "tea", no milk/dark chocolate wording.
- 2026-10-08: there is no `bold` intensity value. `intensity_lean` is `delicate` or null (null = the
  archetype's default position).
- 2026-10-08: the three layers above. "A match is a match to the Bloom Dial." The shown archetype for every
  Balanced-branch answer is Balanced ("it is more true than fruity or floral"). This reverses the earlier
  same-day decision that the peach answer flips the primary to Fruity.
- 2026-10-09: for the two delicate answers the match is Fruity or Floral with `intensity_lean = delicate`,
  and **the secondary is Balanced**, not Fruity or Floral.
- 2026-10-08: no DELETE anywhere; the dead `handleBranchContinue` handler is removed.

## Hard rules

1. No DELETE statement anywhere, on any table. If a step seems to need one, stop and ask.
2. All writes to `quiz_session` and `quiz_session_interpretation` go through `services/quizSession.ts`. App
   reads go through the views and `services/customerReads.ts`. No new SQL in routes.
   Known, accepted exception that you leave as it is: `quizSession.getLatestQuizResult` reads the two tables
   directly for `GET /api/quiz/results/latest`. Do not refactor it.
3. The only UPDATE on a fact table is the backfill's two-column close (`valid_to`, `is_current`) on `v2.1`
   interpretation rows (Part E). `quiz_session` rows are never updated.
4. Quiz content changes only through the 4A seed assert functions. No in-place edit of question or answer text.
5. Commit by explicit file list. Never `git add -A`.

---

## Part A: `interpret()` v2.2 (`backend/src/services/quizScoring.ts`)

`INTERPRETATION_VERSION = 'v2.2'`. `InterpretInput` gains `branchAnswerCode: string | null`.
`Interpretation` gains `matchArchetype: string` (never null) and `intensityLean: 'delicate' | null`.
`SecondaryPath` gains `'branch-lean'` and `'branch-match'`.

### A.1 Effect of the branch answer

`shown` below is `finalArchetype` (what the session row stores). It is an input, never changed here.

| branch answer code | shown | matchArchetype | intensityLean | secondaryArchetype | path |
|---|---|---|---|---|---|
| `v7_branch_cn_earthy` | Earthy | Earthy | null | Chocolate & Nutty (branchedFrom, as today) | as today |
| `v7_branch_cn_stay` | Chocolate & Nutty | Chocolate & Nutty | null | rule secondary | as today |
| `v7_branch_fruity_floral` | Floral | Floral | `delicate` | Fruity (branchedFrom, as today) | as today |
| `v7_branch_fruity_stay` | Fruity | Fruity | null | rule secondary | as today |
| `v7_branch_bal_cozy` (new) | Balanced | Balanced | null | **Chocolate & Nutty** | `branch-lean` |
| `v7_branch_bal_fruit` (new) | Balanced | **Fruity** | `delicate` | **Balanced** | `branch-match` |
| `v7_branch_bal_floral` (new) | Balanced | **Floral** | `delicate` | **Balanced** | `branch-match` |
| null | winner | = shown | null | rule secondary | as today |

- The mapping is a constant keyed by answer code inside `quizScoring.ts`: it is part of the ruleset and
  versions with `INTERPRETATION_VERSION`. It is not stored on `quiz_answer`.
- `branch-lean` and `branch-match` override the rule secondary. Mode for both: `primary_plus_active_secondary`.
- **The pair** used by confidence and explore is `{matchArchetype, secondaryArchetype}`. When no branch-match
  applies this is the same pair as today.
- Nothing but the branch answer sets `intensityLean`.

### A.2 Pair confidence

```
strays         = archetypes outside the pair with scored points >= 3
pairConfidence = strays.length === 0 ? 'high' : 'medium'
low            = only when secondaryPath === 'near-tie' AND two archetypes tie for runner-up
```

`treatStray`, `treatDistance`, `gateStray` and the "treat 2+ steps" override leave confidence. Remove
`axisDistance` / `ARCHETYPE_AXIS` only if nothing else imports them (grep first); otherwise leave them with
a comment that they no longer feed confidence.

### A.3 Explore list

Same four sources (gate Fruity, treat, 3+ point third archetype, runner-up tie), evaluated against the pair
above. The treat reason is `treat points to ${foodSignal}` with no step count.

### A.4 Tests (`quizScoring.test.ts`)

Update expected values. Assert `matchArchetype` and `intensityLean` on every row of the A.1 table. Add: an
Earthy result with a Fruity treat (`high`); an experimental Earthy result with Fruity 3 (`medium`, counted
once); a 3/3/3 near-tie (`low`); Balanced 8 / Fruity 1 with `v7_branch_bal_fruit` (match Fruity, delicate,
secondary Balanced, `high`); Balanced 5 / Chocolate & Nutty 4 with `v7_branch_bal_floral` (Chocolate & Nutty
is a stray: `medium`, explore Chocolate & Nutty).

---

## Part B: storage, writer, reader, views

### B.1 Columns

- `quiz_session.branch_answer_id UUID NULL REFERENCES quiz_answer(id)`. Set in the INSERT by `saveQuizSession`
  (new optional parameter), never updated, never backfilled. It is a column only: do not also copy it into
  `context_data`.
- `quiz_session_interpretation.match_archetype TEXT NULL` and
  `quiz_session_interpretation.intensity_lean TEXT NULL CHECK (intensity_lean IN ('delicate'))`.
  Written only by `saveQuizInterpretation` (add both to its column list and to `InterpretationInput`).
  Every `v2.2` row has `match_archetype` filled. `v1` and `v2.1` rows stay null.

Use the existing `ADD COLUMN IF NOT EXISTS` style. Check the grant block and its integrity check still pass.

### B.2 Live path

`POST /api/quiz/results` (`routes/quiz.ts`) accepts `branchAnswerId` (nullable) and passes it to
`saveQuizSession` and `recordScoredInterpretation`. In `quizSession.ts`:

- Resolve the id to its `answer_code`. Accept it only if the answer belongs to a branch quiz whose
  `trigger_archetype_id` is the server-scored winner. Otherwise treat it as null and log a warning; never
  fail the save.
- Feed `branchAnswerCode` to `interpret()`. The server derives match, lean and secondary itself; the client's
  interpretation fields stay informational, as today.
- A cached older copy of the app will show the branch but not send `branchAnswerId`. It still shows Balanced
  (correct) and the session is stored as plain Balanced with no lean. Accepted; do not try to infer it.

### B.3 Views: add the fields to every view that reads the interpretation row

Grep `schema.sql` for every view that selects from `quiz_session_interpretation` or from
`v_customer_quiz_current`. These five are known; if you find more, add them and say so in the report.

| view | add |
|---|---|
| `v_customer_quiz_current` | `match_archetype`, `match_archetype_code`, `intensity_lean`, `branch_answer_code` |
| `v_customer_timeline` | `match_archetype` and `intensity_lean` inside the quiz entry's `detail` JSON |
| `v_subscriber_quiz_results` | `match_archetype`, `intensity_lean`, `branch_answer_code`, appended at the end |
| `v_quiz_session_interpretation_history` | `match_archetype`, `intensity_lean`, `branch_answer_code`, appended |
| `v_customer_calibration` | `match_archetype`, `intensity_lean`, appended; update `EXPECTED_PALATE_VIEW_COLUMNS` (integrity check 18) and the fixture/test that pins its columns |

- In every view `match_archetype` is `COALESCE(i.match_archetype, <shown archetype name>)`, so a reader never
  sees null for an older row.
- `branch_answer_code` is `quiz_answer.answer_code` joined from `quiz_session.branch_answer_id`.
- Existing columns keep their names and positions. Same meaning plus new columns is not a new `read_version`.
- Update the column lists pinned in `quizResultsView.test.ts`.

### B.4 Readers

- `customerReads.getQuizCurrent`: `QuizCurrentRow` gains `matchArchetype`, `matchArchetypeCode`,
  `intensityLean`, `branchAnswerCode`.
- `quizSession.ts`: `CURRENT_INTERPRETATION_COLUMNS`, `QuizInterpretationView` and `resolveInterpretation`
  carry `matchArchetype` and `intensityLean` (context_data fallback: match = the session archetype, lean null).
- `liamProfile.ts`, `userSignals.ts`, `routes/sommelier.ts`: carry the fields through their types only.
  **No change to what Liam says or recommends.** One guard: where a reader prints or pairs "primary +
  secondary" (for example the profile line `; second: X`), skip a secondary equal to the shown archetype, so
  a branch-match customer does not read "Balanced; second: Balanced".

### B.5 Frontend (`frontend/src/app/components/FlavorQuiz.tsx`, `frontend/src/app/lib/api.ts`)

- The live branch handler is `handleBranchAnswerSelect` (auto-advance). `buildQuizResultPayload` gains a
  `branchAnswerId` argument and that handler passes the selected answer id. Add the field to the
  `saveQuizResult` payload type.
- Delete `handleBranchContinue`: dead since the 2026-07-18 rebuild removed its Continue button. Grep to
  confirm zero callers first, and fix the two comments that mention it.
- All three Balanced answers resolve to Balanced, so the existing code shows Balanced with
  `branchedFrom = null`. No other UI change. No new component.
- `BRANCH_HIGHLIGHT = 'best'` matches the new Balanced question. The reworded Earthy question still has no
  "best": that highlight stays absent as it is today. Leave it.

---

## Part C: quiz content (the `DO $v7$` seed block, through the 4A assert functions)

### C.1 New branch quiz `v7-branch-balanced`

- `quiz`: version `v7-branch-balanced`, description `V7 branch: Balanced lean`, `is_active = true`,
  `quiz_type_id = v_branch_type_id`, `trigger_archetype_id = v_bal_id`, `parent_quiz_id = v_quiz_id`.
  Same create-if-absent pattern as the two existing branch quiz rows.
- Question (q_number 1, weight 1):

  `One last thing. Your coffee is smooth and gentle, just how you like it best. Which of these would you be sad to lose?`

- Answers, all `resulting_archetype_id = v_bal_id`, `is_experimental_gate = FALSE`:

  | sort_order | answer_code | answer_text |
  |---|---|---|
  | 1 | `v7_branch_bal_cozy` | `The cozy, dessert-like feeling. Soft and sweet.` |
  | 2 | `v7_branch_bal_fruit` | `A little sweetness that reminds you of fruit. Like a bite of ripe peach.` |
  | 3 | `v7_branch_bal_floral` | `The smell. You''d catch yourself breathing it in before you even take a sip.` |

  Each answer separates on a different sense: a feeling, a taste, a smell. Do not "improve" the floral answer
  into a lightness description; that makes it a second fruity answer. No score rows.

### C.2 Earthy branch copy (new versions; archetypes unchanged)

- Question: `Your profile is rich and bold. Which one sounds more like you?`
- `v7_branch_cn_stay`: `Coffee that feels like a reward. Warm, rich, comforting.`
- `v7_branch_cn_earthy`: `Coffee with a kick. Dark, strong, a bit smoky.`

### C.3 Fruity branch copy (new versions; archetypes and question unchanged)

- `v7_branch_fruity_stay`: `Bright and lively. Every sip a little different.`
- `v7_branch_fruity_floral`: `Light and delicate, and more about the smell than the taste.`

Existing answers keep their current `sort_order`. Straight apostrophes only, doubled inside SQL literals.
After this Part the four reworded answers and the Earthy question have new ids; their old rows are closed
and intact. That is the intended first use of 4A.

---

## Part D: integrity

`quizIntegrity.ts`:

- Three branch quizzes expected: floral, earthy, balanced. Seven current branch answers (2 + 2 + 3), every
  `resulting_archetype_id` non-null, none with score rows.
- `v7-branch-balanced`: exactly three current answers, codes as in C.1, all resolving to Balanced,
  `sort_order` 1 to 3.

`backend/src/features/quizes/quiz_v7_content_audit.sql` (manual audit, untracked): it counts every row
version. Add `AND is_current` to its question and answer counts so it stays correct after C.2 and C.3.

`customerIntegrity.ts` (keep or add):

- Exactly one `is_current` interpretation row per `quiz_session_id`; no row with `is_current` and `valid_to` set.
- Every `v2.2` row has `match_archetype`; `intensity_lean` is set only where `match_archetype` is Fruity or Floral.
- Every non-null `quiz_session.branch_answer_id` points at a branch-quiz answer.

---

## Part E: backfill with a before/after report

Files: `services/quizInterpretationBackfill.ts`, `scripts/backfillQuizInterpretation.ts`, `services/quizSession.ts`.

- **Selection changes.** Today the backfill only takes sessions with no interpretation row at all, which is
  now none. The v2.2 pass takes sessions whose CURRENT row is `v2.1`. Sessions whose current row is `v1`
  (no `answerIds`) and sessions already on `v2.2` are not touched. A second run finds nothing.
- **Per session, one transaction:** close the `v2.1` row, then insert the `v2.2` row as current
  (`computed_by = 'backfill'`, `valid_from` = run timestamp).
- **The close is one function in `quizSession.ts`**, for example `closeCurrentInterpretation(client,
  sessionId, version, at)`:
  `UPDATE quiz_session_interpretation SET valid_to = $at, is_current = false WHERE quiz_session_id = $1 AND interpretation_version = $2 AND is_current`.
  Exactly those two columns. Called only by the backfill, under the owner role; the script already refuses
  to run as `ab_app`. Add `services/quizSession.ts` / `quiz_session_interpretation` / `UPDATE` to
  `RULE2_ALLOWLIST` in `scripts/lint-customer.mjs` with a note naming this brief and the two columns, and
  update the comment above the column grant in `schema.sql` to say the flip now exists and where.
  The live path stays INSERT-only.
- **Historical branch answer:** old sessions have no `branch_answer_id`. Derive `branchAnswerCode` in memory
  from `branchedFrom` (Earthy → `v7_branch_cn_earthy`, Floral → `v7_branch_fruity_floral`, else null). Never
  write `branch_answer_id` for a historical session.
- **Data guard:** the backfill writes `quiz_session_interpretation` only. Keep the count + md5 assertion on
  `quiz_session` and `newsletter_subscriber` before and after, and add: the count of interpretation rows
  with version other than `v2.2` is unchanged. Abort on any difference.
- **`--report <path.csv>`** (dry run): one row per session with `quiz_session_id`, first name and email
  where linked, shown archetype, then for `v2.1` and for `v2.2`: secondary, path, mode, pair_confidence,
  explore; plus `match_archetype`, `intensity_lean` for `v2.2`, a `changed` column, and
  `explore_thread_already_asked` (true when Liam already asked this customer the explore question under the
  v2.1 row: the new `valid_from` makes Liam treat it as not yet asked). Print the count of those.
- **Fixture:** add `expected_v2_2` next to `expected_v2_1` for all 37 cases in the calibration fixture
  (both copies if the file exists in two places), generated by the new rules; `compareToFixture` checks
  `expected_v2_2`. Keep `expected_v2_1`.
- **What to expect, for the report's sanity check:** no session's shown archetype changes. No historical
  session gets a Fruity or Floral match from the Balanced branch (nobody has answered it yet). Historical
  Floral sessions get `delicate`. Confidence moves up for more than the Earthy rows: any row that was
  `medium` or `low` only because of the treat or the gate becomes `high` (this includes the gate-backed
  case Dana had accepted as medium on 2026-09-24). List every changed row; do not assert counts in advance.

---

## Part F: docs

- `QUIZ_INTERPRETATION_V2_DECISIONS.md`: append "v2.2 (2026-10-09)": the three layers (shown, match, why);
  the A.1 table; confidence from scored answers and the branch answer only; the Natalie case; the reversal
  of the 2026-10-08 "peach flips to Fruity" decision and why (shown stays true to what was scored, the match
  carries the direction); the 2026-09-24 gate-backed case moving to high. Link to
  `misc/palate_model/PALATE_MODEL_HYPOTHESIS.md`; do not copy it.
- `WHAT_WE_BUILT.md` next entry; `WHAT_WE_BUILT_DB.md`: the three new columns and their single writer.
- The deploy-verification paragraph for `WHAT_WE_BUILT.md` #218 (4A) is edited locally and not yet pushed.
  Include it in this brief's commit; do not push it on its own.

## Part G: handoff to the recommendation layer (record in the decisions doc, do not build)

> **Match rule.** The first match comes from `match_archetype`. When `intensity_lean = 'delicate'` it is the
> lane's first dial position (`coffee_dial_slot.sort_order = 1`: Fruity "Clean Fruit", Floral "Light Floral
> Edge"), not the landing default. When null, today's behaviour. Read the two fields; never re-derive them.
>
> **Explanation owed.** A customer shown Balanced who is then recommended a delicate Fruity or Floral coffee
> must be told why, in words built from their stored branch answer (`branch_answer_code`).
>
> **Until both exist**, a branch-match customer is treated as Balanced everywhere a customer can see.

---

## Definition of done

1. Test database: `npm run db:migrate` twice (second run changes nothing), `npm test` green, all four lints green.
2. Test database: the Balanced branch returns three answers in order cozy, peach, smell; the Earthy and
   Fruity branches return the new copy; the old answer rows are closed and still score.
3. Commit by explicit file list, push, deploy green, startup log clean.
4. Production: `GET /api/admin/quiz/integrity` and `GET /api/admin/customer/integrity` green.
5. Production smoke with the existing test user `quiz-scenario-test@axisandbloom.test` only: three quizzes
   to a Balanced result, one per branch answer. Through the views, confirm for each: shown Balanced;
   `branch_answer_code` set; current row `v2.2`; match / lean / secondary = Balanced / null / Chocolate &
   Nutty, Fruity / delicate / Balanced, Floral / delicate / Balanced. The result screen says Balanced all
   three times.
6. Production backfill as `--dry-run --report "Claude outputs/interpretation_v2_2_before_after.csv"
   --expect-db axisandbloom`. Dana's exception for this run: you may start the Cloud SQL Auth Proxy yourself
   for this step and for step 7, owner connection, and stop it when done. Say in the report when you
   started and stopped it. Nothing else writes to production through it.
7. **STOP. One report to Dana: everything above, where the CSV is, the changed rows, the count of
   re-askable explore threads. Do not run `--apply` until she says go.** After go: `--apply`, both integrity
   endpoints green, md5 proofs unchanged, short closing note.

## Out of scope (deliberate)

- Which coffee is recommended, Liam's wording, the reveal and email copy: Part G.
- The six main questions. A gentle-fruit answer in the main quiz is a v8 with Camila.
- The parked subscriber resync brief in this folder.
