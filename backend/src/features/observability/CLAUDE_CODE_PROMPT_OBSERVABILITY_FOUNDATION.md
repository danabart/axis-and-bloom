# Claude Code Prompt — Observability Foundation (policy, boundaries, frontend sweep, health card)

**Written:** 2026-08-14
**Feature folder:** `backend/src/features/observability/`
**Status:** NOT executed
**Depends on:** the deployed API event log (`backend/src/features/api_event_log/`, WHAT_WE_BUILT.md #163)

---

## Why we're building this

A repo-wide audit (2026-08-14) found 471 catch sites: the backend is clean after the
api_event_log sweep, but the frontend has ~114 silent catches that were never swept —
including save handlers in `Profile.tsx` that show the user success while the server
returned 500 (the same fake-success class as the original quiz incident). More
fundamentally, we have no *policy*: every catch is an improvised decision, and
frontend errors are invisible by design (browser console only, never Cloud Logging).

Dana's chosen strategy (Google SRE model): **every event is captured and classified;
severity determines routing, not whether we record it.** Catches are classification
points, not suppression points. The unexpected propagates to central boundary
handlers instead of being swallowed locally.

**Hard rules for this execution:**
- No user-visible behavior changes except those explicitly specified (honest error
  feedback replacing fake success; the ErrorBoundary fallback).
- Smoke tests must NOT alter prod schema objects (no renames, no drops). Test
  failure paths with local means only.
- All user-facing copy follows the house style: positive register, warm, honest —
  "We couldn't save that just now — please try again." Never blame, never jargon.

---

## Part A — `OBSERVABILITY_POLICY.md` (repo root)

Create `OBSERVABILITY_POLICY.md` at the repo root with exactly this content (light
formatting adjustments allowed). This file is the standing reference: future Claude
Code prompts will say "follow OBSERVABILITY_POLICY.md."

> # Observability Policy
>
> Model: Google SRE. Every event is captured and classified. Severity determines
> routing — never whether we record it.
>
> ## The three questions
> Every catch block must answer: (1) Was this expected? (2) Where is it recorded?
> (3) What does the user experience? A catch that answers none is a defect, even if
> the code "works."
>
> ## Only catch what you expect
> A local try/catch is allowed only for a condition you can NAME in a comment
> (e.g. `// user cancelled the native share sheet — not an error`). Everything
> unexpected propagates to the boundary handlers (backend: Express error
> middleware; frontend: ErrorBoundary + global reporter), which record it with full
> context. Intentional silence without a naming comment is forbidden.
>
> ## Severity and routing
> | Level | Meaning | Routing |
> |---|---|---|
> | CRITICAL | Human must act NOW; delay makes it worse. Our list: payments/checkout failing, systemic data loss (write-failure or never-finished clusters in api_event), site or quiz fully down, Cloud SQL unreachable, security anomalies (auth-failure bursts, /api/admin anomalies). | Immediate email (dedicated alert policy) |
> | ERROR | An operation someone expected to succeed failed: failed save, failed sync, unhandled exception. | Email alert, 1 hr batching |
> | WARNING | Degraded but functioning: fallback used, retry succeeded, expected-absence query failed, client-side errors. | Log only; weekly review (System Health card) |
> | INFO | Normal notable events: cron ran, purge completed. | Log only |
> | DEBUG | Developer detail. | Never in production |
>
> Alerting is symptom-based (what users experience), not cause-based. Rate-based
> promotion: an ERROR type becomes a CRITICAL incident when it clusters (e.g. one
> failed quiz save = ERROR; a burst = incident). If a CRITICAL page turns out to
> need no action, it gets demoted — alert fatigue is a bug we fix.
>
> ## One pipe
> Backend events flow to Cloud Logging via the structured logger
> (`backend/src/lib/logger.ts`) — severity is metadata, destination is one.
> `api_event` (Postgres) is payload capture for recovery, not the event stream.
> Client errors reach the server via `POST /api/client-errors` (throttled +
> deduped per session) and are recorded at WARNING.
>
> ## Noise discipline
> Client reporter: max 3 reports per error signature per session, max 20 total.
> WARNINGs are reviewed as weekly counts by tag, not read individually. Retention:
> api_event 90 days.

## Part B — structured logger + backend boundary

1. **`backend/src/lib/logger.ts`** — a small structured logger: `log.critical()`,
   `log.error()`, `log.warn()`, `log.info()`, each taking `(tag: string, message:
   string, context?: object)` and emitting one JSON line to stdout/stderr:
   `{"severity":"CRITICAL"|"ERROR"|"WARNING"|"INFO","tag":"[quiz/results]","message":...,...context}`.
   Cloud Run parses JSON `severity` natively, which is what makes CRITICAL routable
   as its own alert. Keep it dependency-free (no winston/pino). Existing
   `console.error` call sites are NOT mass-migrated (diff noise) — the logger is
   mandatory for all code touched in this prompt and all future code; migrate
   opportunistically.
2. **Express error-handling middleware** in `index.ts`, mounted AFTER all routers:
   logs `log.error('[unhandled/' + req.path + ']', err.message, { uid, stack })`
   and responds `500 { error: 'Something went wrong' }` (or `400` for body-parse
   errors, which land here too). Check the installed Express major version in
   `backend/package.json`: if 4, async route rejections do NOT reach this
   middleware — note in the policy file that route-level try/catch remains
   mandatory (our routes already comply); if 5, note that async errors propagate
   natively. Either way the middleware is the net for sync throws and JSON parse
   errors.

## Part C — frontend boundary (this is what makes client errors visible at all)

1. **`POST /api/client-errors`** (new route, open to guests like quiz/newsletter —
   guests are most of our traffic): accepts `{ message, stack?, route, signature,
   count }`, truncates stack to 4 KB, validates shape, logs each report via
   `log.warn('[client-error]', message, { route, signature, uid })`, returns 204.
   No new table — the deployed apiEventLog middleware captures the payload into
   `api_event` automatically (this is the zero-per-route design paying off).
   WARNING severity is deliberate: browser noise (extensions, ad blockers) must
   not email Dana; signatures get reviewed weekly and promoted selectively.
2. **Global reporter** `frontend/src/app/lib/errorReporter.ts`: hooks
   `window.onerror` + `window.onunhandledrejection`; computes a signature
   (message + source + line); per-session dedupe/throttle: max 3 per signature,
   max 20 total; fire-and-forget POST (its own failure is swallowed silently — the
   reporter must never recurse or throw). Exports `reportError(tag, err,
   context?)` for use in catch blocks (Part D).
3. **React ErrorBoundary** wrapping the app in the root component: on catch,
   reports via the reporter and renders a warm, on-brand fallback (house style;
   a gentle "something went sideways — refresh usually fixes it" with a refresh
   button styled like existing buttons). Do not reimplement anything that exists —
   check for any existing boundary first.

## Part D — frontend catch sweep (~114 sites)

Re-scan `frontend/src` for: empty catches, comment-only catches,
`.catch(() => {})` / `.catch(() => null)`, and catches that set UI state without
recording. Classify every finding into exactly one tier and act:

- **Tier 1 — benign expected** (user cancelled share sheet, clipboard unavailable,
  localStorage in private browsing, AbortError from cancelled fetches): keep
  silent, ensure the naming comment exists (add where missing). No reporting.
- **Tier 2 — half-loud** (catch sets an error state the user sees, e.g.
  `setSaveError(...)`, but records nothing): add `reportError(tag, err)` alongside
  the existing user feedback. Do not change the user experience.
- **Tier 3 — fully silent with consequences** (empty catches and
  `.catch(() => {})` on data loads and writes): for read/prefetch failures, add
  `reportError` and leave UI behavior as-is; for WRITE handlers, see below.
- **Fake-success write handlers — the priority fix.** Known instances in
  `Profile.tsx`: `handleSaveSms`, `handleSetDefaultAddress`, `handleDeleteAddress`
  (state updates as if succeeded even on a 500, because `fetch` doesn't throw on
  HTTP errors, and the catch is silent). For EVERY mutating fetch in the frontend
  (POST/PUT/PATCH/DELETE): verify `res.ok` is checked before treating the call as
  successful; on failure, show honest feedback using the component's existing
  error-state pattern (house style copy) and `reportError`. Audit all mutating
  call sites for this, not just Profile.tsx.

Produce a classification table in the final report: file:line, tier, action taken.
Do not silently skip any of the ~114 — if you judge one differently than these
rules imply, list it with your reasoning.

## Part E — System Health admin card (read-only)

Reuse the existing AdminAIOps card pattern (per standing rule: never reimplement
an existing pattern). New card on the admin page + backend endpoint:

- **`GET /api/admin/system-health`** (same auth guards as other admin endpoints),
  aggregating, for the last 7 days: api_event counts by call_type with
  failure counts (`response_status >= 400`) and never-finished counts
  (`response_status IS NULL`); top client-error signatures with counts (rows where
  `call_type = 'POST /api/client-errors'`, grouped by `request_body->>'signature'`);
  total api_event rows + oldest row age (retention proxy). One endpoint, plain SQL,
  no new tables.
- **Card UI**: read-only tables/counters in the AdminAIOps visual style. No
  configuration controls of any kind — configuration lives in GCP by policy.

## Verification

- `npx tsc --noEmit` clean in `backend/`. Frontend has no tsconfig: run vite build
  AND standalone tsc on every changed frontend file (a clean vite build alone does
  not type-check — known trap).
- `npm test`: baseline is exactly 17 pre-existing failures; investigate anything new.
- Local smoke (no prod schema changes): throw inside a scratch local route → error
  middleware logs structured JSON + clean 500 (remove the scratch route after);
  malformed JSON body → 400 via middleware; trigger a client error in local dev →
  confirm the POST /api/client-errors row lands in api_event and the throttle caps
  repeats; break one Profile.tsx save locally (point fetch at a 500 stub) →
  confirm honest feedback appears and no fake success.
- Confirm the ErrorBoundary fallback renders by forcing a render error locally.

## Docs

- `WHAT_WE_BUILT.md`: next numbered entry (policy, boundaries, sweep, card).
- `WHAT_WE_BUILT_DB.md`: note that client errors ride `api_event` (no new tables).
- `OBSERVABILITY_POLICY.md` is itself a deliverable — keep it to roughly one page.

## Manual steps (for Dana, after deploy — cannot be done from code)

1. Second Cloud Logging alert policy: same flow as "Backend errors (Cloud Run)"
   but filter `resource.type="cloud_run_revision" AND severity>=CRITICAL`, named
   "CRITICAL (Cloud Run)", tightest available notification cadence, same "Dana
   email" channel. (The existing ERROR policy keeps its 1 hr batching.)
2. Still pending from the api_event work: the Cloud Scheduler job for
   `GET /api/cron/purge-api-events` (daily, `x-cron-secret` header).

## Out of scope (deliberately)

- No mass migration of existing console.error calls to the logger.
- No third-party error service (Sentry etc.) — revisit only if client-error
  volume outgrows the weekly review.
- No alert/config controls in the admin UI — configuration lives in GCP.
- No backend catch changes beyond code touched by Parts B/C/E (backend was swept
  2026-08-14; remaining silent catches there are documented expected-absence).
