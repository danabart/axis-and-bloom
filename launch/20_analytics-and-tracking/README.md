# Analytics & Tracking (workstream: analytics-and-tracking)

Everything that measures the funnel: GA4 + Meta Pixel wiring, first-party funnel events,
SQL reporting views, and the Looker Studio dashboard. Rule of the workstream: **the
dashboard must be live before the first real ad dollar (Aug 3–9).**

## Tasks

| Global step | File | What | Model | Depends on | Status |
|---|---|---|---|---|---|
| 02 | `02_B1_analytics_funnel_events.md` | Oct 1 date, GA4 + Pixel site-wide (env-driven), quiz funnel events table + endpoint | Sonnet | manual setup ✅ (IDs ready) | ✅ deployed 2026-07-20 + gtag hotfix applied same day; GA4 Realtime receiving (verified), Meta Pixel verified live |

**Verification history (2026-07-20):** first deploy shipped a silent GA4 bug — the gtag stub
in `frontend/src/app/lib/analytics.ts` pushed rest-param ARRAYS, which gtag.js ignores, so
zero hits were sent; hotfixed same day (`window.gtag = function gtag(){ window.dataLayer!.push(arguments); }`)
and Realtime confirmed receiving. Standing reminders: check GA4 signed in as
**danabar.mail@gmail.com** (Dana's Chrome defaults to another account), and Meta Pixel events
live under Events Manager → Data sources → "Axis and Bloom Pixel" (945138695260153) — the
ad-account screen shows nothing. Remaining step-02 checks: QuizStart/QuizComplete visible in
Realtime after a quiz run · quiz_funnel_event rows in DB · regression trio.
| 06 | `06_B3_reporting_views_admin_links.md` | 4 reporting views + `reporting_ro` role + admin Marketing links row | Opus/Fable | Step 02 | ✅ code done + verified against production Cloud SQL 2026-07-21 (run on Sonnet 5, not Opus/Fable as spec'd — Dana's explicit call); manual GCP steps below still open |
| M3 | manual | Ad Spend Google Sheet + assemble Looker Studio report (views + GA4 + sheet) + share with Camila + paste URL into admin config | Dana | Step 06 | ⬜ |

IDs (from `../00_manual-setup/MANUAL_SETUP_IDS.md`): GA4 `G-GYC50VYRYN` · Pixel `945138695260153`.

## Run commands

**Step 02** — model: Sonnet
```
Read launch/README.md for context and rules, then execute the prompt in launch/20_analytics-and-tracking/02_B1_analytics_funnel_events.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met. My GA4 id is G-GYC50VYRYN and my Meta Pixel id is 945138695260153 — wire them into the deployment env config.
```

**Step 06** — model: Opus or Fable
```
Read launch/README.md for context and rules, then execute the prompt in launch/20_analytics-and-tracking/06_B3_reporting_views_admin_links.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met, and print the manual GCP steps I must do to connect Looker Studio.
```

## Post-deploy verification

**Step 02 — analytics + funnel events**
- [ ] Site shows "COMING OCTOBER 1"
- [ ] Take the quiz → GA4 Realtime/DebugView shows page_view, QuizStart, QuizComplete
- [ ] Meta Pixel Helper shows PageView + custom events on the same run
- [ ] `SELECT event, archetype, created_at FROM quiz_funnel_event ORDER BY created_at DESC LIMIT 10;` → your run's rows
- [ ] `VITE_GA4_ID` / `VITE_META_PIXEL_ID` are in the production build config (nothing fires without them)
- [ ] Local dev with env vars unset → clean console, zero google/facebook network calls
- [ ] Standing trio (`../REGRESSION.md`)

**Step 06 — reporting views + admin links**
- [x] `psql` as reporting_ro: SELECT on all 4 views works; `SELECT * FROM newsletter_subscriber` **denied** — verified 2026-07-21 via a temporary throwaway password against production Cloud SQL (reverted to NOLOGIN immediately after)
- [ ] View numbers sanity-match reality (subscriber count ≈ Mailchimp audience size)
- [ ] /admin shows the Marketing row; cupping cards still present below and correct — code-reviewed only, no admin test credentials this session
- [ ] Standing trio

**Manual GCP steps for Dana (Step 06 — not yet done):**
1. Generate a strong password for `reporting_ro` and store it in Secret Manager (e.g. as `REPORTING_RO_PASSWORD` — it isn't consumed by the app, just kept alongside the other secrets for reference).
2. Enable login and set the password on the role — via Cloud SQL Studio (link in `[[project_axis_and_bloom]]` memory / `WHAT_WE_BUILT.md`) or `psql` as the `postgres` superuser:
   `ALTER ROLE reporting_ro WITH LOGIN PASSWORD '<value from Secret Manager>';`
3. Looker Studio's PostgreSQL connector needs network access to the Cloud SQL instance's Public IP — Google doesn't publish stable egress IPs for it, so the standard approach is: keep "Require SSL" enabled on the instance (already the case) and add `0.0.0.0/0` as an authorized network scoped to SSL-only connections. This is a real tradeoff (any IP can attempt a TLS connection) offset by `reporting_ro` only ever being able to read 4 views, never a base table — flagging it explicitly rather than deciding it for you. If that's not acceptable, the alternative is a scheduled export (e.g. Cloud Scheduler + Cloud Function dumping the 4 views to BigQuery or Sheets) instead of a live connector — bigger lift, not built here.
4. In Looker Studio: Add data source → PostgreSQL → host = the Cloud SQL instance's public IP, port 5432, database `axisandbloom`, user `reporting_ro`, password from step 1, SSL mode = require.

**M3 — Looker dashboard (manual)**
- [x] Five cards + archetype distribution + growth line render real numbers — built 2026-07-23: Completion Rate %, Opt-in Rate %, Cost per Subscriber (blended Ad Spend ÷ v_subscribers_weekly), subscriber count, orders (blank pre-launch, correct); archetype donut weighted by subscriber_count; cumulative subscriber growth line (Looker Studio "Running sum" on a `Cumulative Subscribers` field)
- [x] admin config holds the report URL — all 3 Marketing links (`looker_studio_url`, `adspend_sheet_url`, `mailchimp_audience_url`) set directly via DB 2026-07-23. Mailchimp: `https://us11.admin.mailchimp.com/audience/contacts?id=111655` (audience ID `a5940f849b`, all-contacts view — not scoped to a specific tag/segment)
- [ ] Camila can open it from her own account — report not shared yet

**Open tasks (as of 2026-07-23):**
- [ ] Replace the placeholder Ad Spend row (`2026-07-20, meta, $0` — added only to unstick Looker Studio's empty-sheet schema detection bug) with real weekly spend once ads start
- [ ] Share the "Axis & Bloom Report" in Looker Studio with Camila (Share button, top right) — intentionally left for Dana, not done by the assistant
