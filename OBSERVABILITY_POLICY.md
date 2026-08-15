# Observability Policy

Model: Google SRE. Every event is captured and classified. Severity determines
routing — never whether we record it.

## The three questions

Every catch block must answer: (1) Was this expected? (2) Where is it
recorded? (3) What does the user experience? A catch that answers none is a
defect, even if the code "works."

## Only catch what you expect

A local try/catch is allowed only for a condition you can NAME in a comment
(e.g. `// user cancelled the native share sheet — not an error`). Everything
unexpected propagates to the boundary handlers (backend: Express error
middleware; frontend: ErrorBoundary + global reporter), which record it with
full context. Intentional silence without a naming comment is forbidden.

## Severity and routing

| Level | Meaning | Routing |
|---|---|---|
| CRITICAL | Human must act NOW; delay makes it worse. Our list: payments/checkout failing, systemic data loss (write-failure or never-finished clusters in api_event), site or quiz fully down, Cloud SQL unreachable, security anomalies (auth-failure bursts, /api/admin anomalies). | Immediate email (dedicated alert policy) |
| ERROR | An operation someone expected to succeed failed: failed save, failed sync, unhandled exception. | Email alert, 1 hr batching |
| WARNING | Degraded but functioning: fallback used, retry succeeded, expected-absence query failed, client-side errors. | Log only; weekly review (System Health card) |
| INFO | Normal notable events: cron ran, purge completed. | Log only |
| DEBUG | Developer detail. | Never in production |

Alerting is symptom-based (what users experience), not cause-based.
Rate-based promotion: an ERROR type becomes a CRITICAL incident when it
clusters (e.g. one failed quiz save = ERROR; a burst = incident). If a
CRITICAL page turns out to need no action, it gets demoted — alert fatigue
is a bug we fix.

## One pipe

Backend events flow to Cloud Logging via the structured logger
(`backend/src/lib/logger.ts`) — severity is metadata, destination is one.
`api_event` (Postgres) is payload capture for recovery, not the event
stream. Client errors reach the server via `POST /api/client-errors`
(throttled + deduped per session) and are recorded at WARNING.

## Noise discipline

Client reporter: max 3 reports per error signature per session, max 20
total. WARNINGs are reviewed as weekly counts by tag, not read
individually. Retention: api_event 90 days.

## Express version note (backend boundary)

We run Express 4 (`backend/package.json`). Async route rejections do **not**
reach the error-handling middleware automatically on Express 4 — every route
handler's own try/catch remains mandatory (our routes already comply). The
middleware is the net for synchronous throws and body-parse (malformed JSON)
errors. If this repo ever upgrades to Express 5, async errors propagate to
the middleware natively and this caveat can be dropped.
