# Claude Code Prompt 2 of 3 — `quiz_session_interpretation` (SCD Type 2): table, seed, backfill, read paths

> Series: quiz interpretation v2.1. Requires brief 1 (`interpret()`, `scoreAnswerIds()`) merged first.
> Read `QUIZ_INTERPRETATION_V2_DECISIONS.md`, section "Storage: SCD Type 2".
> This brief creates ONE new table and writes ONLY to it. It never updates, deletes or alters
> `quiz_session`, `newsletter_subscriber`, or any Firestore document.

## The model (decided by Dana, 2026-09-25)

`quiz_session` is the immutable fact: one row per completion, holding the customer's answers, scores,
treat, gate, branch and primary archetype. Interpretations are a Type 2 dimension over it: one row per
session **per interpretation version**, never per user, with exactly one row per session flagged
`is_current`. `is_current` always means "the row produced by the latest deployed ruleset". Old rows are
history and are kept forever.

## Part A — DDL (`backend/src/db/schema.sql`, new section, idempotent)

```sql
CREATE TABLE IF NOT EXISTS quiz_session_interpretation (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id         UUID NOT NULL REFERENCES quiz_session(id),   -- no ON DELETE CASCADE: we never delete
  interpretation_version  TEXT NOT NULL,                               -- 'v1', 'v2.1', ...
  secondary_archetype     TEXT,
  secondary_path          TEXT,                                        -- NULL on v1 rows
  recommendation_mode     TEXT NOT NULL,
  food_signal_alignment   TEXT NOT NULL,
  pair_confidence         TEXT,                                        -- NULL on v1 rows
  explore_archetype       TEXT,
  explore_reason          TEXT,
  primary_margin          SMALLINT,
  is_current              BOOLEAN NOT NULL DEFAULT false,
  valid_from              TIMESTAMPTZ NOT NULL,
  valid_to                TIMESTAMPTZ,                                 -- NULL while current
  computed_by             TEXT NOT NULL CHECK (computed_by IN ('scored', 'seed', 'backfill')),
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quiz_session_id, interpretation_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS quiz_session_interpretation_current
  ON quiz_session_interpretation (quiz_session_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_qsi_version ON quiz_session_interpretation (interpretation_version);
```

Not in this table, on purpose: primary archetype, `branched_from`, scores, answers, treat, gate. They live
on the fact. `secondary_archetype` values are `coffee_archetype.name` as of writing (v1 seed rows keep the
legacy spelling found in `context_data`; brief 3 normalizes on read).

## Part B — live path: `POST /api/quiz/results`

In the same transaction as the `quiz_session` insert (`saveQuizSession` returns the id):
1. Recompute server-side: `scoreAnswerIds(answerIds)` → `interpret({..., finalArchetype: archetype,
   branchedFrom})`. The client's interpretation fields are **not** trusted for the table; this keeps the
   table on the server's ruleset even for a stale browser bundle. (If `answerIds` is missing, an edge case
   from very old bundles, insert nothing into the table and log a warning; the read path falls back.)
2. `INSERT` one row: `interpretation_version = INTERPRETATION_VERSION`, `is_current = true`,
   `valid_from = now()`, `computed_by = 'scored'`.
3. Keep writing the as-scored snapshot into `context_data` exactly as today (plus the six new fields the
   client sends, `?? null`), so a session stays self-describing. Firestore mirror unchanged.

`saveQuizSession` itself is not modified; add a sibling `saveQuizInterpretation(client, sessionId, interp,
computedBy)` in `services/quizSession.ts` that both this route and the backfill use.

## Part C — seed + backfill script (`backend/scripts/backfillQuizInterpretation.ts`)

Insert-only against `quiz_session_interpretation`; read-only against everything else. Idempotent
(`ON CONFLICT (quiz_session_id, interpretation_version) DO NOTHING`). Batches of 200 sessions, one
transaction per batch. Dana runs it against prod herself after deploy (not part of the deploy).

For each `quiz_session` (ordered by `completed_at`):
1. **Seed `v1`** from `context_data` verbatim: `secondary_archetype = ctx->>'secondaryArchetype'`,
   `recommendation_mode = ctx->>'recommendationMode'` (default `'primary_only'` if absent, matching the
   old route default), `food_signal_alignment = ctx->>'foodSignalAlignment'` (default `'high'`),
   `secondary_path / pair_confidence / explore_* / primary_margin = NULL`, `is_current = false`,
   `valid_from = completed_at`, `valid_to = <backfill run timestamp>`, `computed_by = 'seed'`.
   Sessions with no `answerIds` in `context_data` (cross-device match claims written by the
   reveal-in-inbox path, and pre-August rows) get a `v1` row only; for them the `v1` row is
   `is_current = true`, `valid_to = NULL`.
2. **Backfill `v2.1`** for every session that has `answerIds`: `scoreAnswerIds(answerIds)` →
   `interpret({..., finalArchetype: <coffee_archetype.name via resulting_archetype_id>, branchedFrom:
   ctx->>'branchedFrom'})`. Insert with `is_current = true`, `valid_from = <backfill run timestamp>`,
   `computed_by = 'backfill'`.
3. Sessions completed after deploy already hold a `scored` `v2.1` row that is current. The script skips
   them entirely: no `v1` seed (they were never interpreted under v1) and no second `v2.1` row (the unique
   constraint would reject it anyway).

Flags: `--dry-run` (default) prints counts per version and the 37 crawl rows' v2.1 output next to the
fixture; `--apply` writes. `--limit N` for a first small run.

## Part D — read paths join the current row

Replace "parse `context_data` for the interpretation" with a `LEFT JOIN quiz_session_interpretation i ON
i.quiz_session_id = qs.id AND i.is_current` and `COALESCE(i.<col>, ctx->><field>)` as the fallback, at:

- `routes/quiz.ts` `GET /api/quiz/results/latest` (line ~388): add the current row's columns to the
  response as top-level keys with the existing camelCase names the frontend reads (`secondaryArchetype`,
  `recommendationMode`, `foodSignalAlignment`) plus the new ones. `context_data` is still returned raw.
- `routes/sommelier.ts` (line ~533, Liam context) and `services/userSignals.ts` (line ~90): same join;
  Liam's context gets `pairConfidence`, `exploreArchetype`, `exploreReason`.
- `services/sommelierEvaluator.ts`: read from the current row. `PROFILE_AMBIGUOUS` fires on
  `pairConfidence === 'low' || exploreArchetype !== null` when the current row's version is `v2.1`+;
  otherwise the old rule (`ai_agent` / `low`). Feature vector unchanged (13 dims).
- `routes/users.ts` (lines ~76 and ~757) read only the primary; no change.
- `services/behavioralConfidence.ts`: primary and dates only; no change.

The fallback means a session with no interpretation rows (script not yet run, or the edge case in B.1)
behaves exactly as today.

## Data safety and proof

- Before anything, on the dev DB and later on prod:
  `SELECT COUNT(*), md5(string_agg(id::text || context_data::text, ',' ORDER BY id)) FROM quiz_session;`
  Re-run after the migration, after the script, after the tests. All readings identical; put them in the
  report. Same statement for `newsletter_subscriber` (`id || archetype || COALESCE(confidence,'')`).
- Deploy order: (1) DDL + code with the fallback (safe with an empty table); (2) Dana runs the script
  `--dry-run`, checks the 37 crawl rows match the fixture, then `--apply`; (3) from then on every session
  has a current row.
- Rollback: revert the code; the table stays (harmless, ignored). Nothing to undo on the fact.
- No prod verification from Claude Code; dev DB only; do not touch the persistent Cloud SQL Auth Proxy.

## Tests
- Unit: `saveQuizInterpretation` + the partial unique index (two current rows for one session must fail).
- Script on the dev DB seeded with the 37 fixture sessions: after `--apply`, `SELECT COUNT(*) ... WHERE
  is_current` = session count, exactly one current per session, v2.1 output = fixture 37/37, `v1` rows =
  what `context_data` held.
- Integration: complete a quiz on dev → one `scored` v2.1 row, current; `results/latest` returns it.

## Report back (`WHAT_WE_BUILT.md`, next number)
DDL as applied; script dry-run and apply counts on dev; the md5 readings; the read paths changed; the
statement that no existing row outside `quiz_session_interpretation` was written.
