-- campaign_attribution — 2026-08-31 (Hoboken Coffee Crawl: /crawl landing page +
-- campaign attribution)
--
-- STATUS: also in schema.sql (idempotent CREATE TABLE IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS), which runs automatically on every backend startup (see
-- backend/src/index.ts), so the normal deploy already applies this. This file exists
-- only as the narrative record, same convention as transactional_email_log_2026_08_18.sql.
--
-- Purely additive: one new table (campaign_landing_event), three new nullable columns
-- (newsletter_subscriber.campaign / campaign_vid / campaign_attributed_at,
-- quiz_funnel_event.campaign / campaign_vid), two new views. No backfill. Safe before
-- or after the code deploy — existing rows just have campaign = NULL.

CREATE TABLE IF NOT EXISTS campaign_landing_event (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign     TEXT NOT NULL,
  vid          UUID NOT NULL,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  referrer     TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_campaign_landing_event_campaign ON campaign_landing_event(campaign, created_at);
CREATE INDEX IF NOT EXISTS idx_campaign_landing_event_vid      ON campaign_landing_event(vid);

ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS campaign               TEXT;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS campaign_vid           UUID;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS campaign_attributed_at TIMESTAMPTZ;
ALTER TABLE quiz_funnel_event     ADD COLUMN IF NOT EXISTS campaign               TEXT;
ALTER TABLE quiz_funnel_event     ADD COLUMN IF NOT EXISTS campaign_vid           UUID;
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriber_campaign ON newsletter_subscriber(campaign) WHERE campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_funnel_event_campaign     ON quiz_funnel_event(campaign)     WHERE campaign IS NOT NULL;

CREATE OR REPLACE VIEW campaign_funnel_v AS
WITH scans AS (
  SELECT campaign, COUNT(*) AS scans, COUNT(DISTINCT vid) AS unique_scanners,
         MIN(created_at) AS first_scan, MAX(created_at) AS last_scan
  FROM campaign_landing_event GROUP BY campaign
), quiz AS (
  SELECT campaign,
         COUNT(DISTINCT COALESCE(campaign_vid::text, session_key)) FILTER (WHERE event = 'quiz_start')      AS quiz_starts,
         COUNT(DISTINCT COALESCE(campaign_vid::text, session_key)) FILTER (WHERE event = 'quiz_complete')   AS quiz_completes,
         COUNT(DISTINCT COALESCE(campaign_vid::text, session_key)) FILTER (WHERE event = 'email_submitted') AS email_events
  FROM quiz_funnel_event WHERE campaign IS NOT NULL GROUP BY campaign
), subs AS (
  SELECT campaign, COUNT(*) AS subscribers FROM newsletter_subscriber WHERE campaign IS NOT NULL GROUP BY campaign
)
SELECT s.campaign, s.scans, s.unique_scanners, q.quiz_starts, q.quiz_completes, q.email_events,
       sb.subscribers, s.first_scan, s.last_scan
FROM scans s
LEFT JOIN quiz q  ON q.campaign  = s.campaign
LEFT JOIN subs sb ON sb.campaign = s.campaign;

CREATE OR REPLACE VIEW campaign_subscriber_archetype_v AS
SELECT campaign, archetype, COUNT(*) AS subscribers
FROM newsletter_subscriber WHERE campaign IS NOT NULL
GROUP BY campaign, archetype ORDER BY campaign, subscribers DESC;
