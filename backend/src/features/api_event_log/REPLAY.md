# Replaying from the API Event Log

The `api_event` table is a capture-first log of every mutating
(`POST`/`PUT`/`PATCH`/`DELETE`) API request's raw payload, written *before*
the route handler runs (see `backend/src/middleware/apiEventLog.ts`, mounted
once in `index.ts`). It exists so that if a processing bug silently drops
data downstream, the original request survives and can be recovered.

**There is no automatic replay endpoint, by design.** Re-submitting a
payload against a live handler is a deliberate human action — the handler
may have side effects (tokens, emails, inventory, Firestore writes) that
should not fire twice, and the fix that prompted the replay needs to
actually be live first. Always read the handler's current code before
replaying anything against it, and prefer replaying into a scratch/staging
path or wrapping the replay in a dry run if the handler supports one.

## Querying the log after an incident

Connect to Cloud SQL (see `axis_and_bloom_local_cloudsql_testing` for the
Auth Proxy playbook) and query directly:

```sql
-- Every capture for a given call type in a time window, oldest first so a
-- replay script processes them in original order.
SELECT occurred_at, firebase_uid, request_body
FROM api_event
WHERE call_type = 'POST /api/quiz/results'
  AND occurred_at BETWEEN '2026-08-11 00:00:00+00' AND '2026-08-12 00:00:00+00'
ORDER BY occurred_at;
```

`call_type` is the parameterized route pattern (e.g.
`POST /api/orders/:id/cancel`), not the literal URL — filter on it directly
rather than `path`, which still carries real ids.

### Requests that never finished

A row with `response_status IS NULL` means the payload was captured but the
request crashed, was aborted, or the process died before responding — this
is itself the signal capture-first exists to catch:

```sql
SELECT occurred_at, call_type, firebase_uid, request_body
FROM api_event
WHERE response_status IS NULL
ORDER BY occurred_at DESC;
```

### Requests that failed

```sql
SELECT occurred_at, call_type, firebase_uid, response_status, response_error, request_body
FROM api_event
WHERE response_status >= 400
  AND call_type = 'POST /api/quiz/results'
ORDER BY occurred_at DESC;
```

## Reading the payload

- `request_body` is redacted (any key matching
  `/password|passwd|secret|token|authorization|apikey|api_key|card|cvv|cvc/i`
  is replaced with `'[REDACTED]'`) and capped at 64 KB — if
  `body_truncated = true`, the stored JSON is
  `{"_truncated": true, "_originalBytes": <n>, ...as many original
  first-level keys as fit}`, not the full original payload. For a
  truncated row, treat the log as evidence a request happened and check
  what shape it was, not as a byte-for-byte source to blindly resubmit.
- `response_error` (present only when `response_status >= 400`) is the
  same redaction/truncation, capped at 2 KB, and is `null` whenever the
  handler didn't respond with a JSON/text body the middleware could
  capture (e.g. a raw stream).
- No request headers are ever stored (no `Authorization`, no cookies) — the
  log can never be used to replay someone else's session, only their body.

## Replaying

There's no tooling for this beyond a one-off script, deliberately. A
typical replay:

1. Query the affected rows as above and confirm the fix is deployed.
2. For each row, decide by hand what re-submitting means for that handler
   (e.g. does it need the same `firebase_uid`'s auth context, or can it run
   as an admin backfill script hitting the DB/service functions directly —
   often cleaner than re-issuing an HTTP request with a synthetic token).
3. Run it against a small sample first, verify the result, then the rest.
4. Never write a script that loops over `api_event` and calls a live
   endpoint unattended — this is a human-in-the-loop recovery tool, not a
   retry queue.

## Retention

Rows are purged by `GET /api/cron/purge-api-events` (see `routes/cron.ts`),
daily via Cloud Scheduler, deleting anything older than
`API_EVENT_RETENTION_DAYS` (env var, default 90). Payloads can contain
emails/names, so this is real data hygiene — don't raise the retention
window without a reason, and don't rely on the log for anything older than
that.
