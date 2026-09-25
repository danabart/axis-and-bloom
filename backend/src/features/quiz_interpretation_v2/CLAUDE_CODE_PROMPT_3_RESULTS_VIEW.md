# Claude Code Prompt 3 of 3 — `v_subscriber_quiz_results` reads the interpretation table; history view

> Series: quiz interpretation v2.1. Requires brief 2 (the table) merged. Read-only SQL in
> `backend/src/db/schema.sql`, section "Subscriber x quiz outcome (2026-09-20)". No `UPDATE`, `DELETE`,
> `INSERT` or `ALTER TABLE` anywhere in this brief; views and one IMMUTABLE function only.

## Part A — canonical archetype names

`quiz_archetype_canonical(text) RETURNS text` (IMMUTABLE): `Balanced & Sweet`, `Balanced and Sweet` →
`Balanced`; `Fruity & Complex` → `Fruity`; `Spicy & Earthy` → `Earthy`; anything else unchanged. Used
wherever a value was frozen as text before the September rename (`context_data` strings, the `v1` seed
rows, `newsletter_subscriber.archetype`).

## Part B — `v_subscriber_quiz_results` (same shape, honest sources)

Keep the driving `newsletter_subscriber` → `latest_session` (`DISTINCT ON (user_id) ... ORDER BY
completed_at DESC`) structure and every existing column name and position, except:

1. Rename `confidence_at_signup` → `food_signal_alignment_at_signup`.
2. In `latest_session`, `LEFT JOIN quiz_session_interpretation i ON i.quiz_session_id = qs.id AND
   i.is_current`. The interpretation columns now come from `i`:
   `secondary_archetype` (canonicalized), `recommendation_mode`, `food_signal_alignment`, and new
   `secondary_path`, `pair_confidence`, `explore_archetype`, `explore_reason`, `primary_margin`,
   `interpretation_version`, `interpretation_computed_by`, `interpretation_valid_from`.
3. The values frozen in `context_data` stay available, suffixed `_as_scored`: `secondary_archetype_as_scored`
   (canonicalized), `recommendation_mode_as_scored`, `food_signal_alignment_as_scored`. So the one export
   Dana already uses shows what the customer was told on the day next to the current interpretation.
4. `food_signal`, `archetype_at_signup`, `branched_from` (new pass-through from `context_data`) are
   canonicalized; raw values as `food_signal_raw`.
5. Scores, `experimental`, `decaf`, `scores_json`, `quiz_result_json`, timestamps, ids: unchanged.

## Part C — `v_quiz_session_interpretation_history` (new, one row per session per version)

```
quiz_session_id, user_id, completed_at, final_archetype (via coffee_archetype), branched_from,
interpretation_version, is_current, valid_from, valid_to, computed_by,
secondary_archetype (canonicalized), secondary_path, recommendation_mode, food_signal_alignment,
pair_confidence, explore_archetype, explore_reason, primary_margin
```

This is the calibration surface: `WHERE interpretation_version IN ('v1','v2.1')` pivoted by session gives
the before/after for any set of sessions; the next event's export is `WHERE completed_at >= <event>`.

## Part D — verification (dev DB after brief 2's script; prod read-only via Cloud SQL Studio)

- Every subscriber with a linked session has a non-NULL `interpretation_version` in
  `v_subscriber_quiz_results`, and `SELECT COUNT(*) FROM v_subscriber_quiz_results WHERE recommendation_mode
  = 'ai_agent' AND interpretation_version = 'v2.1'` = 0.
- For the 37 `campaign = 'hoboken-crawl-2026'` rows (exclude `danabar.mail%`), the current-row columns equal
  `hoboken-crawl-2026.calibration.json` `expected_v2_1` (`case_id` order = `completed_at` order), and the
  `_as_scored` columns equal `stored_v1`. 37/37 both ways. Report any difference with both values; do not
  "fix" it in SQL.
- `SELECT interpretation_version, is_current, COUNT(*) FROM v_quiz_session_interpretation_history GROUP BY
  1,2` shows exactly one current row per session.
- The `quiz_session` count + md5 statement from brief 2, before and after, identical.

## Report back (`WHAT_WE_BUILT.md`, next number)
Column list of both views, the 37/37 results, the version/current counts, the md5 readings.
