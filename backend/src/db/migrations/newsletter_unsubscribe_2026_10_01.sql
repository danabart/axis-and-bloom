-- Newsletter unsubscribe sync — 2026-10-01
-- (backend/src/features/newsletter_unsubscribe/CLAUDE_CODE_PROMPT_UNSUBSCRIBE_SYNC.md)
--
-- STATUS: written 2026-10-05, NOT yet applied to production by hand. Step 1
-- is also in schema.sql (idempotent), so the first deploy that carries this
-- code runs it on boot anyway; steps 2 and 3 are manual, in order, below.
--
-- newsletter_subscriber.subscribed becomes the single source of truth for
-- marketing consent. Every unsubscribe (link in our email, the mail client's
-- one-click button, the Mailchimp footer via webhook, an admin acting on a
-- hello@ request) lands here and is mirrored outward. Three new columns:
--   unsubscribe_token   capability token in the hosted unsubscribe URL —
--                       32 random bytes, hex, from crypto.randomBytes in app
--                       code (not SQL), exactly like beat_event.respond_token
--                       (beat_event_respond_token_2026_08_09.sql). Minted by
--                       handleSubscribe on insert, never rotated by a
--                       re-subscribe.
--   unsubscribed_at     first time the row went subscribed -> false (cleared
--                       by a fresh form re-subscribe).
--   unsubscribe_source  'link' | 'one_click' | 'mailchimp' | 'admin'
--                       (cleared by a fresh form re-subscribe).
-- Rows are flipped, never deleted.
--
-- Deploy order (same three-step discipline as the beat_event token):
--   STEP 1 — before or with the deploy (schema.sql runs it on boot too).
--   deploy the code — new subscribers get a token on insert; an existing
--     row without one gets one the next time it re-subscribes (COALESCE on
--     conflict), and the quiz email reads the token after that upsert, so a
--     NULL token never reaches a rendered email.
--   STEP 2 — backfill every remaining NULL token (Node script).
--   STEP 3 — SET NOT NULL, only after step 2 reports zero NULLs.
--
-- ── STEP 1 — Cloud SQL Studio, or via the Auth Proxy ────────────────────────
-- Nullable for now; a plain UNIQUE index permits multiple NULLs in Postgres,
-- so this is safe to add before the backfill.

ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS unsubscribe_token   TEXT;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS unsubscribed_at     TIMESTAMPTZ;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS unsubscribe_source  TEXT;  -- 'link' | 'one_click' | 'mailchimp' | 'admin'
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscriber_unsubscribe_token_idx ON newsletter_subscriber (unsubscribe_token);

-- ── STEP 2 — from a machine with DATABASE_URL pointed at this database (see
-- the axis_and_bloom_local_cloudsql_testing playbook for the Auth Proxy) ─────
--   cd backend
--   npx tsx src/scripts/backfillUnsubscribeTokens.ts            (dry run, reports only)
--   npx tsx src/scripts/backfillUnsubscribeTokens.ts --apply    (writes real tokens)
-- crypto.randomBytes(32).toString('hex') per row. Idempotent: only touches
-- rows where unsubscribe_token IS NULL, so re-running (e.g. after new
-- subscribers land between steps) is always safe. Its last line says
-- whether step 3 is safe yet.

-- ── STEP 3 — ONLY after step 2 reports "Rows still NULL after this run: 0" ──
-- If any NULL remains this fails outright, which is the correct, safe
-- failure mode. Not in schema.sql: a boot-time SET NOT NULL against a table
-- that still has a NULL would crash every Cloud Run start.

-- ALTER TABLE newsletter_subscriber ALTER COLUMN unsubscribe_token SET NOT NULL;
-- (left commented out deliberately — uncomment and run only once step 2 is confirmed complete)

-- ── Verify (after all three steps) ──────────────────────────────────────────
-- SELECT
--   COUNT(*) AS total_rows,
--   COUNT(unsubscribe_token) AS rows_with_token,
--   COUNT(DISTINCT unsubscribe_token) AS distinct_tokens,
--   COUNT(*) FILTER (WHERE unsubscribe_token IS NULL) AS still_null,
--   COUNT(*) FILTER (WHERE subscribed = false) AS unsubscribed
-- FROM newsletter_subscriber;
-- Expect: total_rows = rows_with_token = distinct_tokens, still_null = 0.
