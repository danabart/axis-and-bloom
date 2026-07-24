# Session History — Analytics & Tracking (Step 06 + M3)

**Session date:** 2026-07-21 through 2026-07-23 (continuous session, model: Sonnet 5 throughout —
not Opus/Fable as this workstream's README specifies for Step 06's DB-permissions work; Dana's
explicit call when asked). Covers: Step 06 (reporting views + `reporting_ro` role + admin
Marketing links), the manual GCP setup that follows it, and M3 (assembling the actual Looker
Studio dashboard). Read this before touching reporting infrastructure again rather than
re-deriving it.

## What shipped

### Step 06 — code (commit `5d99e94`)
- 4 read-only SQL views in `backend/src/db/schema.sql`: `v_subscribers_weekly`,
  `v_quiz_funnel_weekly`, `v_archetype_distribution`, `v_orders_weekly` — idempotent
  (`DROP VIEW IF EXISTS` + recreate), run on every backend startup like every other view in
  this file.
- `reporting_ro` Postgres role, created `NOLOGIN` in `schema.sql` (no credential ever
  committed) with `SELECT` on exactly those 4 views — re-granted every startup since
  `DROP VIEW` revokes privileges on the old view object.
- `marketing_config` key/value table (3 rows: `looker_studio_url`, `mailchimp_audience_url`,
  `adspend_sheet_url`) + `GET`/`PATCH /api/admin/marketing/config` (logic in
  `backend/src/features/marketing/reportingConfig.ts`, thin routes in `admin.ts`).
- `AdminDashboard.tsx` gained a "Marketing" card row (click-to-edit links) above the existing
  6 cupping stat cards.
- Verified against production Cloud SQL via the Auth Proxy: all 4 views return real data,
  `reporting_ro`'s grants confirmed exact (views only, denied on base tables) via a temporary
  throwaway login immediately reverted to `NOLOGIN`.

### Manual GCP setup (done live in-session, with Dana's explicit go-ahead on the network step)
- Generated a password, stored in Secret Manager as `REPORTING_RO_PASSWORD`.
- `ALTER ROLE reporting_ro WITH LOGIN PASSWORD ...` via the Auth Proxy connection.
- Cloud SQL instance `axis-bloom-db`: `sslMode` set to `ENCRYPTED_ONLY`; authorized networks
  now `197.234.218.75/32` (Dana's laptop, pre-existing) + `0.0.0.0/0` (added so Looker
  Studio's connector — no published stable IPs — can reach it; SSL still required, and
  `reporting_ro` can only ever read the 4 views regardless of source IP).
- End-to-end verified: connected as `reporting_ro` over the public IP with SSL — the exact
  path Looker Studio uses — before handing off to the browser flow.

### M3 — the actual Looker Studio dashboard (built in-session via browser automation + Dana's OAuth clicks)
Report: **"Axis & Bloom Report"** (URL below). Data sources, all renamed from Looker Studio's
default "PostgreSQL - axisandbloom" ×4 to their real names for anyone editing this later:
`v_subscribers_weekly`, `v_quiz_funnel_weekly`, `v_archetype_distribution`, `v_orders_weekly`,
plus `Axis & Bloom Website` (GA4) and `Ad Spend - Sheet1` (Google Sheets).

- **5 scorecards**: Completion Rate % and Opt-in Rate % (weighted calculated fields —
  `SUM(completes)/SUM(starts)*100` etc., not an average of the pre-computed weekly rate
  columns, to avoid the unweighted-average error) on `v_quiz_funnel_weekly`; **Cost per
  Subscriber** — a genuine Looker Studio *blend* of `Ad Spend - Sheet1` (dimension
  `week_start`, metric `SUM(amount)`) full-outer-joined to `v_subscribers_weekly` (dimension
  `week`, metric `SUM(new_subscribers)`) on `week_start = week`, with a calculated field
  `SUM(amount) / NULLIF(SUM(new_subscribers), 0)` formatted as currency; subscriber count on
  `v_subscribers_weekly`; orders on `v_orders_weekly` (correctly reads "No data" pre-launch).
- **Archetype distribution**: donut chart on `v_archetype_distribution`, weighted by
  `subscriber_count` (not `Record Count`, which would have weighted every archetype equally).
- **Cumulative subscriber growth line**: a new `Cumulative Subscribers` field
  (`SUM(new_subscribers)`) added to `v_subscribers_weekly`, with Looker Studio's per-metric
  **"Running sum"** calculation applied in the chart's Y-axis metric config (found via the
  small pencil icon on the metric chip — not exposed on the plain data-source field editor,
  only on the chart-level metric editor) — the real mechanism for a true cumulative line,
  not just a per-week delta. X-axis dimension is `week`, sort corrected to ascending-by-`week`
  (Looker Studio defaults new charts to sort by metric value descending, which reads as
  random-looking dates until fixed).

**Real bug found and fixed along the way**: the Ad Spend Google Sheets connector cached an
empty schema (only a `Record Count` metric, no `week_start`/`platform`/`amount` columns)
because the sheet had zero data rows at the moment it was first connected — Looker Studio
apparently can't infer column types from an empty range, and "Refresh fields" didn't fix an
already-broken connection. Fix: added one placeholder data row
(`2026-07-20, meta, $0`) to the sheet, removed and re-added the data source fresh. **That
placeholder row is still in the sheet** — replace it with real spend once ads start, don't
just delete it (a truly empty sheet will break the connector again the same way).

## The concurrent-session doc collision (resolved)

While this session was live, a second Claude Code session was also working in this checkout.
Seeing that `WHAT_WE_BUILT_DB.md` had no entry for the Step 06 views/role (true — this
session's earlier pass updated `WHAT_WE_BUILT.md` #114 and `SOMMELIER_BUILT.md` S63 but missed
`WHAT_WE_BUILT_DB.md`), it concluded the underlying SQL itself had never been committed
(false) and created a redundant "paper-trail" migration file
(`backend/src/db/migrations/reporting_views_2026_07_23.sql`, commit `f27b436`) plus a
`WHAT_WE_BUILT_DB.md` entry repeating that claim (commit `8d2e613`). It also overwrote this
workstream's `README.md` status lines and checkmarks in the process.

Verified via `git merge-base --is-ancestor 5d99e94 f27b436` (exit 0) that the real Step 06
commit predates both of those — the SQL was committed all along, in `schema.sql`. Corrected
both docs (commit `41df447`): `schema.sql` is documented as the actual source of truth: the
redundant migration file is left in place (harmless, idempotent, not auto-run by anything) but
flagged as a duplicate — **if the two ever drift, `schema.sql` wins, since it's the one that
actually runs on every deploy.** Didn't delete the other session's committed file unilaterally;
that's Dana's call if she wants it gone.

## Open tasks (as of 2026-07-23)

- [ ] Replace the placeholder Ad Spend row with real weekly spend once paid ads start
- [ ] Share the "Axis & Bloom Report" with Camila (Looker Studio → Share, top right) —
      intentionally left for Dana, not done by the assistant
- [ ] View numbers sanity-match reality (subscriber count ≈ Mailchimp audience size) — not
      yet spot-checked
- [ ] Standing regression trio (`../REGRESSION.md`) for Step 06
- [ ] Decide whether to delete `backend/src/db/migrations/reporting_views_2026_07_23.sql`
      (redundant but harmless) or leave it as historical record

## References

**Looker Studio report**
`https://lookerstudio.google.com/reporting/e6fd09f1-d4c7-4779-abad-e63df0d4672f`
— also saved in `marketing_config.looker_studio_url`, surfaced on `/admin` → Marketing.

**Ad Spend Google Sheet**
`https://docs.google.com/spreadsheets/d/1CY-RDI_c3PZPFZCOva7Q6NUM5Xfd5IERUlOsOFjEpUc/edit`
— columns `week_start`, `platform`, `amount`; one placeholder row still in it (see above).
Also saved in `marketing_config.adspend_sheet_url`.

**Mailchimp audience**
`https://us11.admin.mailchimp.com/audience/contacts?id=111655`
— all-contacts view (trimmed from a segment/tag-scoped URL Dana originally supplied).
Audience/List ID `a5940f849b` (API identifier — not the same as the `id=111655` used in the
browsable admin URL; the two aren't derivable from each other). Also saved in
`marketing_config.mailchimp_audience_url`.

**GA4 / Meta Pixel** (from `../00_manual-setup/MANUAL_SETUP_IDS.md`)
GA4 property "Axis & Bloom Website": `G-GYC50VYRYN` · Meta Pixel: `945138695260153`.

**GCP / Cloud SQL**
Project `axis-and-bloom-prod` · instance `axis-bloom-db` · public IP `35.223.155.186` · port
`5432` · database `axisandbloom` · authorized networks now `197.234.218.75/32` (Dana's laptop)
+ `0.0.0.0/0` (Looker Studio, SSL required — `sslMode: ENCRYPTED_ONLY`).
`reporting_ro` password: `gcloud secrets versions access latest --secret=REPORTING_RO_PASSWORD --project=axis-and-bloom-prod`.
Server CA cert for SSL clients that need it (e.g. reconnecting a connector from scratch):
saved locally at `Desktop\axis-bloom-db-server-ca.pem` on Dana's machine — regenerate via
`gcloud sql instances describe axis-bloom-db --project axis-and-bloom-prod --format="value(serverCaCert.cert)"`
if it's ever lost.

**Code**
`backend/src/db/schema.sql` — the 4 views, `reporting_ro` role, `marketing_config` table
(source of truth). `backend/src/db/migrations/reporting_views_2026_07_23.sql` — redundant
paper-trail copy, see collision note above. `backend/src/features/marketing/reportingConfig.ts`
— marketing config read/write logic. `frontend/src/app/components/admin/AdminDashboard.tsx` —
the Marketing card row.

**Docs**
`WHAT_WE_BUILT.md` #114 · `SOMMELIER_BUILT.md` S63 · `WHAT_WE_BUILT_DB.md` (views + Roles
section, corrected paper-trail note) · this workstream's `README.md`.

**Commits** (chronological)
`5d99e94` Step 06 code · `df75c3f` M3 done + open tasks doc · `48821c5` all 3 Marketing links
set · `f27b436`/`8d2e613` the other session's paper-trail migration + doc (premise later
corrected, files kept) · `41df447` paper-trail correction across both docs.
