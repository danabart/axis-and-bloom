# API Event Log

Capture-first API event log — every mutating (`POST`/`PUT`/`PATCH`/`DELETE`) request's
raw payload, written before the handler runs. Full design: `CLAUDE_CODE_PROMPT_API_EVENT_LOG.md`
(original spec). Recovery workflow: `REPLAY.md`.

## Retention: none — append-only

Retired 2026-09-25 (Quiz Resync Fix, Part D1). `api_event` is never purged; see `REPLAY.md`'s
Retention section for the full history and rationale.

## Storage (watch this number)

As of 2026-09-25: **1,837 rows, 1,264 kB** (`pg_total_relation_size('api_event')`). Small at
current traffic — no partitioning needed. Re-check this figure periodically since growth is now
unbounded by design; if it becomes a real storage concern, the fix is partitioning by
`occurred_at`, not reintroducing a purge.
