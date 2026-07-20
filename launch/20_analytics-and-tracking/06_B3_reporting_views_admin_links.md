# Step 06 (B3) — Reporting views, read-only role, admin Marketing links

> Global step 06 of 11 · Workstream: analytics-and-tracking · Model: **Opus/Fable** (DB roles/permissions) · Depends on: Step 02 (quiz_funnel_event exists). After this step: assemble the Looker Studio report (manual) — dashboard must be live before the first real ad dollar.

CONTEXT: Axis & Bloom, Cloud SQL Postgres. Marketing dashboard will be built in Looker Studio (free) on top of: our DB, GA4, and a manual Ad Spend Google Sheet. The /admin landing (AdminLayout + Dashboard page) currently shows six cupping-count cards from GET /api/admin/stats. DECISION: Looker Studio only — no custom dashboard build; we provide data plumbing + links.

TASK:

1. SQL migration creating read-only reporting views:
   - v_subscribers_weekly (week, new_subscribers, by source)
   - v_quiz_funnel_weekly (week, starts, completes, emails_submitted, completion_rate, optin_rate) from quiz_funnel_event
   - v_archetype_distribution (archetype, subscriber_count, share) from newsletter_subscriber
   - v_orders_weekly (week, orders, new_customers, revenue_cents) from "order" tables — returns zero rows gracefully pre-launch
2. Create a dedicated Postgres role `reporting_ro` with CONNECT + SELECT on ONLY these views (no base tables). Document (README section or infra note): how to set its password via Secret Manager and how to allow Looker Studio's connector to reach the Cloud SQL instance (authorized networks / public IP with SSL), so Dana can complete the manual GCP steps.
3. /admin landing: add a top "Marketing" card row — links out to the Looker Studio report URL (env/config value), the Mailchimp audience, and the Ad Spend sheet URL. Demote the six cupping cards to a section below. Reuse existing admin card components; no new design system.

CONSTRAINTS: views only — no reporting queries against base tables from outside; do not break GET /api/admin/stats; requireAdmin stays on all admin routes; helper logic in backend/src/features/marketing/.

ACCEPTANCE: psql as reporting_ro can SELECT the four views and nothing else; /admin shows the Marketing row.
