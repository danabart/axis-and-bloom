-- Beat-event respond token — 2026-08-09 (security fix, finding H3/C4)
--
-- STATUS: applied to production (axis-and-bloom-prod) on 2026-08-09, all
-- three steps, via the Cloud SQL Auth Proxy, BEFORE the token-based code
-- deployed. beat_event had 0 rows at the time (pre-launch, no dial-in beats
-- have ever been sent) — the backfill script's own real --apply run
-- confirmed "Rows backfilled: 0, Rows still NULL after this run: 0" against
-- production directly, and step 3 applied cleanly on the first try. Kept
-- here, unmodified, as the record of exactly what ran and in what order —
-- re-run against any other environment (e.g. a fresh one, or one with real
-- rows) following the same three steps.
--
-- GET /api/beats/dial-in/:beatEventId/respond identified a beat by
-- beat_event.id — a plain SERIAL integer, unauthenticated, no ownership
-- check. Looping integers let an attacker mark any customer's beat
-- responded and shift *their* next brew-card grind in an attacker-chosen
-- direction. Fix: identify the beat by an unguessable capability token
-- instead, the same pattern already used for household_invitation.token
-- and coffees.qr_token — 32 random bytes (crypto.randomBytes in app code,
-- not SQL — see step 2), hex-encoded, unique.
--
-- Run this in three ordered steps, NOT all at once — step 2 needs the
-- application's Node runtime (crypto.randomBytes), not plain SQL, and step
-- 3 must not run until step 2 has fully completed, or it will fail (or
-- worse, silently succeed while leaving a real NULL respond_token behind if
-- run against a table that still has never-touched rows). This must
-- complete in full BEFORE the new token-based code is deployed — see
-- WHAT_WE_BUILT_SECURITY.md's C4 entry for the deploy-order writeup.
--
-- ── STEP 1 — run first, in Cloud SQL Studio (or via the Auth Proxy) ────────
-- Nullable for now (existing rows have none yet); a plain UNIQUE index
-- permits multiple NULLs in Postgres, so this is safe to add before backfill.

ALTER TABLE beat_event ADD COLUMN IF NOT EXISTS respond_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS beat_event_respond_token_key ON beat_event(respond_token);

-- ── STEP 2 — run second, from a machine with DATABASE_URL pointed at this
-- database (see axis_and_bloom_local_cloudsql_testing playbook for the Auth
-- Proxy setup against production) ──────────────────────────────────────────
--   npx tsx backend/scripts/backfill-beat-respond-tokens.ts            (dry run, reports only)
--   npx tsx backend/scripts/backfill-beat-respond-tokens.ts --apply    (writes real tokens)
-- Uses crypto.randomBytes(32).toString('hex') per row — real Node entropy,
-- not a SQL pseudo-random expression. Idempotent: only touches rows where
-- respond_token IS NULL, so re-running (e.g. after new beat_events land
-- between step 1 and step 3) is always safe.

-- ── STEP 3 — run third, ONLY after step 2 reports zero remaining NULLs ─────
-- (the backfill script's own summary line says so explicitly). Do not run
-- this speculatively — if any row still has a NULL respond_token, this
-- statement fails outright (Postgres rejects a NOT NULL constraint while a
-- NULL exists), which is the correct, safe failure mode here.

-- ALTER TABLE beat_event ALTER COLUMN respond_token SET NOT NULL;
-- (left commented out deliberately — uncomment and run only once step 2 is confirmed complete)

-- ── Verify (run after all three steps) ──────────────────────────────────────
-- SELECT
--   COUNT(*) AS total_rows,
--   COUNT(respond_token) AS rows_with_token,
--   COUNT(DISTINCT respond_token) AS distinct_tokens,
--   COUNT(*) FILTER (WHERE respond_token IS NULL) AS still_null
-- FROM beat_event;
-- Expect: total_rows = rows_with_token = distinct_tokens, still_null = 0.
