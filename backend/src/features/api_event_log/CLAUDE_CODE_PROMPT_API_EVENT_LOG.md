# Claude Code Prompt — API Event Log (capture-first) + Loud Failures + Retention

**Written:** 2026-08-12
**Feature folder:** `backend/src/features/api_event_log/`
**Status:** NOT executed

---

## Why we're building this

On 2026-08-11 we discovered that quiz API calls had silently dropped data: saves
partially failed, nothing surfaced an error, and the original request payloads were
gone — there was no way to recover what the frontend had actually sent. This prompt
builds the two defenses against that class of incident:

1. **Capture-first API event log** — every mutating API request's raw payload is
   written to Postgres *before* the handler processes it, organized by call type.
   If a processing bug drops data again, the raw material survives and can be
   replayed after the fix.
2. **Loud failures** — no swallowed errors anywhere on the backend. Every failure is
   recorded at error level so a Cloud Logging log-based alert (manual step at the
   end) can notify us. "Loud" means loud to *us*, never to users: nothing in this
   prompt may change user-visible behavior or block/slow a request.

**Critical design requirement: zero per-route work.** The capture must be a single
app-level Express middleware mounted once in `backend/src/index.ts`, before all
routers. Any route that exists today and any route added in the future is captured
automatically. Under no circumstances implement this as something each route or
router has to opt into or call — no decorators, no wrapper applied per-route, no
per-router registration. New endpoints must appear in the log with no code changes
beyond the endpoint itself.

---

## Part A — `api_event` table

Append to `backend/src/db/schema.sql` following the existing pattern (the schema is
re-run on every startup, so use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
EXISTS`; table names are singular like `quiz_funnel_event`, `qr_scan_event`):

```sql
CREATE TABLE IF NOT EXISTS api_event (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  call_type     TEXT NOT NULL,          -- e.g. 'POST /api/quiz/results'
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,          -- originalUrl without query string
  firebase_uid  TEXT,                   -- null until auth middleware ran; filled at finish
  is_anonymous  BOOLEAN,                -- req.isAnonymous at finish, null if unknown
  request_body  JSONB,                  -- redacted + truncated, see rules below
  body_truncated BOOLEAN NOT NULL DEFAULT false,
  response_status INTEGER,              -- null = request never finished (crash/abort)
  response_error JSONB,                 -- response body when status >= 400, truncated
  duration_ms   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_event_call_type_time ON api_event (call_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_event_time ON api_event (occurred_at);
CREATE INDEX IF NOT EXISTS idx_api_event_uid ON api_event (firebase_uid) WHERE firebase_uid IS NOT NULL;
```

A row with `response_status IS NULL` is itself a signal: the payload was captured
but the request never completed — exactly the case capture-first exists for.

## Part B — capture middleware (`backend/src/middleware/apiEventLog.ts`)

New file exporting `apiEventLog` middleware. Mount it in `index.ts` **once**,
immediately after `app.use(appCheckGate)` and before the first router mount, so it
sees every current and future `/api` router.

**What it captures (two-phase, both writes fire-and-forget):**

1. **At request start:** if the request qualifies (see filters), generate the event
   `id` (`crypto.randomUUID()`), stash it on `res.locals`, and `INSERT` the row with
   `occurred_at`, `call_type` (provisional: method + path), `method`, `path`,
   `request_body`. Do **not** `await` this insert in the request path — fire it and
   attach `.catch(err => console.error('[apiEventLog/insert]', err))`. The request
   proceeds regardless of whether logging succeeded.
2. **On `res.on('finish')`:** `UPDATE` the row: final `call_type` (see below),
   `firebase_uid` = `(req as AuthRequest).uid ?? null` and `is_anonymous` — by
   finish time the route-level auth middleware (`requireAuth`/`optionalAuth`) has
   populated these on the same `req` object; `response_status = res.statusCode`;
   `duration_ms`; and `response_error` when status >= 400 (see below). Same
   fire-and-forget rule. Also listen on `res.on('close')` and, if the response never
   finished (`!res.writableEnded`), update `duration_ms` only, leaving
   `response_status` null.

**`call_type` derivation (automatic, stable across ids):** at finish time prefer
`` `${req.method} ${req.baseUrl}${req.route?.path ?? ''}` `` (Express sets
`req.route` once a route matched) — this yields parameterized types like
`POST /api/orders/:id/cancel` instead of one type per order id. Fallback when no
route matched (404s): method + `req.path` with query string stripped and path
segments that look like ids (UUIDs, long numbers, Firebase uids) replaced by `:id`.

**Which requests qualify — filters, in order:**

- Method must be `POST`, `PUT`, `PATCH`, or `DELETE`. Skip `GET`/`HEAD`/`OPTIONS`
  entirely (read traffic is volume without recovery value).
- Skip paths: `/health`, anything under `/api/cron` and `/api/webhooks` (machine
  traffic with its own secret header), and anything under `/api/admin` **only if**
  you find admin routes that carry secrets in bodies — otherwise capture admin too.
- Skip non-JSON bodies (multipart/uploads): if `req.body` is not a plain object or
  array, store `null` with `body_truncated = false`.

**Redaction + size rules (apply to both `request_body` and `response_error`):**

- Recursively replace the value of any key matching
  `/password|passwd|secret|token|authorization|apikey|api_key|card|cvv|cvc/i`
  with the string `'[REDACTED]'`.
- Never read or store any request headers in the row (no Authorization, no cookies).
- If the serialized body exceeds 64 KB, store
  `{"_truncated": true, "_originalBytes": <n>}` merged with the first-level keys
  that fit, and set `body_truncated = true`. `response_error` caps at 2 KB.

**Hard safety rules:** the middleware must be incapable of failing a request. Wrap
its entire body in try/catch; on any internal error, `console.error` and call
`next()`. No `await` before `next()`. DB unavailability, serialization errors,
oversized bodies — all degrade to "no log row," never to a user-facing error.

## Part C — silent-catch sweep (loud failures)

Sweep all of `backend/src` (routes, services, features) for catch blocks and
`.catch(...)` handlers that swallow errors without logging — empty blocks, blocks
that only return a default, or `.catch(() => {})`. For each, add
`console.error('[<area>/<operation>]', err)` following the existing bracket-tag
convention (`[quiz/firestore-session]`, `[cron/liam-sms-send]`). Do **not** change
control flow anywhere: a non-blocking side effect stays non-blocking, a fallback
still returns its fallback — the only change is that the failure is now recorded.
(On Cloud Run, `console.error` lands in Cloud Logging at ERROR severity, which is
what the log-based alert in the manual steps watches.)

Produce a short table in your final report: file, line, what the catch was
swallowing, what tag you gave it. If you find a catch that swallows a **primary
write** failure (the main purpose of its request — e.g. a quiz/order/profile save)
and then reports success to the user anyway, do not silently "fix" the semantics:
log it loudly as above, and flag it prominently in the report for a human decision —
changing user-visible behavior is out of scope for this prompt.

## Part D — retention cron

New route in `backend/src/routes/cron.ts` following the exact shape of the existing
`requireCronSecret` jobs (`purge-stale-anonymous-guests` is the closest model):

- `GET /api/cron/purge-api-events` + `requireCronSecret`.
- Deletes `api_event` rows older than `API_EVENT_RETENTION_DAYS` (env var, default
  `90`). Delete in batches (e.g. 5,000 per loop) to avoid long locks. Respond with
  `{ deleted: <count> }`.
- This is data hygiene, not just disk: payloads contain emails/names, so they must
  not accumulate forever.

## Part E — replay is manual by design

Do **not** build a replay endpoint. Add
`backend/src/features/api_event_log/REPLAY.md` documenting how to query the log
after an incident, e.g.:

```sql
SELECT occurred_at, firebase_uid, request_body
FROM api_event
WHERE call_type = 'POST /api/quiz/results'
  AND occurred_at BETWEEN '...' AND '...'
ORDER BY occurred_at;
```

…and noting that re-submitting payloads is a deliberate human action against a
fixed handler, never automatic. Also document the "never finished" query
(`response_status IS NULL`) and the "failed" query (`response_status >= 400`).

## Verification

- `npx tsc --noEmit` in `backend/` must be clean.
- `npm test` baseline as of 2026-08-11: **17 pre-existing failures** (6 quizScoring
  tie-break drift, 11 tests hitting live prod Cloud SQL). Expect exactly these;
  investigate any new failure. A/B against `git stash` if unsure.
- Local smoke test: boot the backend, make a `POST /api/newsletter/...` or
  `POST /api/quiz/...` call, confirm one `api_event` row appears with payload at
  start and gains `response_status`/`firebase_uid` on completion; confirm a `GET`
  produces no row; confirm the request succeeds even if the `api_event` insert is
  forced to fail (e.g. temporarily rename the table).

## Docs

- `WHAT_WE_BUILT.md`: append the next numbered entry describing the api_event log,
  the zero-per-route capture design, the sweep, and the retention cron.
- `WHAT_WE_BUILT_DB.md`: add the `api_event` table.

## Manual steps (cannot be done from code — for Dana, after deploy)

1. **Cloud Scheduler job** for retention: daily → `GET /api/cron/purge-api-events`
   with header `x-cron-secret` (same Secret Manager value as the existing jobs).
2. **Cloud Logging log-based alert:** GCP Console → Logging → Log-based alerts →
   create an alert on the Cloud Run backend service for `severity >= ERROR`,
   notification channel = Dana's email. This is what turns every `console.error`
   from Part C into a notification instead of a line nobody reads.

## Out of scope (deliberately)

- No admin UI card for browsing api_event (can reuse the AdminAIOps card pattern
  later if wanted).
- No capture of GET traffic, headers, or non-API routes.
- No behavior changes to any endpoint; no new user-facing errors.
- No automatic replay.
