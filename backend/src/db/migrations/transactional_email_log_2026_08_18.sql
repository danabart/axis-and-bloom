-- transactional_email_log — 2026-08-18 (Step 07 / C3, quiz-complete email moves to Resend)
--
-- STATUS: not yet applied to production as a standalone step — this table is also
-- in schema.sql (idempotent CREATE TABLE IF NOT EXISTS), which runs automatically
-- on every backend startup (see backend/src/index.ts), so the normal deploy already
-- creates it. This file exists only as the narrative record, same convention as
-- beat_event_respond_token_2026_08_09.sql and claude_daily_spend_feature_2026_08_10.sql.
--
-- Purely additive, single step, no backfill, no deploy-order dance needed: a new
-- table, not a column added to something with existing rows. Safe to run any time,
-- before or after the code deploy that starts reading/writing it
-- (backend/src/routes/newsletter.ts's handleSubscribe, backend/src/features/marketing/
-- resendEmail.ts + templates/quizCompleteEmail.ts).
--
-- Enforces "send at most once per (email, template)" in the DB rather than in
-- memory, so it survives across Cloud Run instances/restarts. Keyed by template
-- (not just email) so a future redesign of this email can re-enable exactly one
-- send of the new version by bumping the template key (`quiz_complete_v2` today)
-- — that bump is a manual decision, not automated by this schema.

CREATE TABLE IF NOT EXISTS transactional_email_log (
  email      TEXT NOT NULL,
  template   TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (email, template)
);

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT email, template, sent_at FROM transactional_email_log ORDER BY sent_at DESC NULLS LAST LIMIT 20;
