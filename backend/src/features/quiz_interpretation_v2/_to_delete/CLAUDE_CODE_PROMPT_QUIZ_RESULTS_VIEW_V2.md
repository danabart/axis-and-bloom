# Claude Code Prompt — `v_subscriber_quiz_results` v2: honest names, normalized labels, v2.1 columns computed read-only for every historical row

> Written 2026-09-24, revised 2026-09-25 (scope tightened; tie-break explore hint; read-only made explicit).
> Companion to `CLAUDE_CODE_PROMPT_QUIZ_INTERPRETATION_V2.md` (independent; run in either order). SQL only,
> in `backend/src/db/schema.sql`, section "Subscriber x quiz outcome (2026-09-20)". Rules being mirrored:
> `QUIZ_INTERPRETATION_V2_DECISIONS.md`.

## Data safety

- **Read-only, without exception.** This brief creates or replaces views and one IMMUTABLE SQL function.
  It contains no `UPDATE`, `DELETE`, `INSERT`, `ALTER TABLE`, or `ADD COLUMN`. If a step seems to need
  one, stop and report instead. The 2026-09-20 event sessions are live production data and the
  calibration record; they are only ever read here.
- The view is what Dana exports from Cloud SQL Studio and what Looker Studio's read-only role reads. Keep
  every existing column name and position except the one rename below, so saved queries keep working.
- The view ships through `schema.sql` and a deploy, per the 2026-08-11 rule; nothing is run by hand in
  Cloud SQL Studio.
- Prove it exactly as the interpretation brief does: record
  `SELECT COUNT(*), md5(string_agg(id::text || context_data::text, ',' ORDER BY id)) FROM quiz_session;`
  on the dev DB before and after, and put both readings in the report.

## Part A — `v_subscriber_quiz_results` changes

1. **Rename** `confidence_at_signup` → `food_signal_alignment_at_signup`. The word "confidence" must not
   sit on a column that holds the treat-agreement label. (`food_signal_alignment` for
   `ctx->>'foodSignalAlignment'` already exists.)
2. **Normalize labels.** `secondary_archetype` and `food_signal` are strings frozen in `context_data` at
   scoring time and still say `Balanced & Sweet` / `Fruity & Complex` on rows written before the rename,
   while `primary_archetype` comes from a live join and says `Balanced`. Add
   `quiz_archetype_canonical(text) RETURNS text` (IMMUTABLE; `Balanced & Sweet`, `Balanced and Sweet` →
   `Balanced`; `Fruity & Complex` → `Fruity`; `Spicy & Earthy` → `Earthy`; anything else unchanged) and
   apply it to `secondary_archetype`, `food_signal`, `archetype_at_signup` and `branched_from`. Keep the
   raw values as `secondary_archetype_raw`, `food_signal_raw`.
3. **Pass-through columns** from `context_data` (NULL on rows that predate the interpretation brief):
   `branched_from`, `secondary_path`, `pair_confidence`, `explore_archetype`, `explore_reason`,
   `primary_margin`, `interpretation_version`.
4. **Recomputed columns** from Part B, joined on the latest session and suffixed `_v2_1`:
   `secondary_v2_1, mode_v2_1, pair_confidence_v2_1, explore_archetype_v2_1`. Once the interpretation
   brief is live, a new row's pass-through and `_v2_1` columns must agree; a disagreement is a bug in one of
   the two implementations.

## Part B — `v_quiz_session_interpretation_v2_1` (new view, one row per `quiz_session`)

Recompute the v2.1 interpretation **in SQL** for every session that has `answerIds` in `context_data`,
so historical rows can be compared with what the code would produce today, without touching them.

Inputs per session: `ctx->'scores'` (keys normalized with the function from A.2), `ctx->'answerIds'`
(JSONB array of 6 UUIDs, positions 1–5 are Q1–Q5, position 6 is Q6), `ctx->>'foodSignal'` (normalized),
`(ctx->>'experimental')::boolean`, `ctx->>'branchedFrom'` (normalized), and `coffee_archetype.name` via
`resulting_archetype_id` as the final archetype.

Build `by_q` by joining each of the first five answer ids to `quiz_answer` → `quiz_question.q_number` →
`quiz_answer_archetype_score` (score > 0) → `coffee_archetype.name`, exactly as the metadata query in
`POST /api/quiz/score` does. Then implement, as a PL/pgSQL function
`quiz_interpret_v2_1(scores jsonb, by_q jsonb, food_signal text, experimental boolean, final_archetype
text, branched_from text) RETURNS TABLE(...)` (IMMUTABLE, no table access), the same precedence as the
TypeScript `interpret()`:

- winner = max score; ties resolved by `by_q` in order Q5, Q4, Q2, Q1, fallback `Balanced`
- `primary_margin`, `runners`, `pick()` (treat, then cascade)
- secondary paths in order: near-tie (margin ≤ 1), gate-backed (experimental and Fruity is a runner-up
  and winner ≠ Fruity), food-led (treat ≠ winner), runner-up (runner-up score ≥ 2), none
- stored secondary = `branched_from` when non-null, else the path's secondary
- mode table; pair confidence (strays: treat outside the pair with its axis distance; gate with Fruity ≥ 2
  outside the pair; third archetype ≥ 3; none → high, one → medium, two+ → low, treat at distance ≥ 2 →
  low); explore archetype in priority order gate (Fruity ≥ 1) → treat → third → runner-up tie (the other
  tied archetype when the secondary came from the tie, or `'A / B'` when the 2-point floor left no
  secondary; ties never affect confidence). Axis `Floral, Fruity, Balanced, Chocolate & Nutty, Earthy` as a
  `VALUES` list inside the function, with a comment marking it interim.

Columns: `quiz_session_id, user_id, completed_at, final_archetype, branched_from, winner_scored,
primary_margin, secondary_v2_1, secondary_path_v2_1, mode_v2_1, pair_confidence_v2_1,
explore_archetype_v2_1, explore_reason_v2_1, secondary_v1, mode_v1, food_signal_alignment_v1,
secondary_changed, mode_changed, confidence_changed`.

## Part C — verification (dev DB, or prod read-only via Cloud SQL Studio)

Run against the 37 sessions of `campaign = 'hoboken-crawl-2026'` (exclude `danabar.mail%`) and compare
with `hoboken-crawl-2026.calibration.json` next to this file (`case_id` order = `completed_at` order,
Dana's addresses excluded). All 37 must match on secondary, mode, pair confidence, explore archetype and
margin. If any row differs, report the row and both values; do not adjust the SQL to force agreement
without saying which side you believe is right and why.

Also report `SELECT COUNT(*) FROM v_quiz_session_interpretation_v2_1 WHERE mode_v2_1 = 'ai_agent'` (must
be 0) and the before/after distribution of modes and confidence over all sessions, not only the crawl.

## Report back (`WHAT_WE_BUILT.md`, next sequential number)

Column list of both views, the 37/37 result, the whole-population before/after distribution, the
`quiz_session` count + md5 readings, and a reminder that `quiz_interpret_v2_1` must be kept in step with
`interpret()` in `quizScoring.ts` (add a comment at both sites pointing at the other).
