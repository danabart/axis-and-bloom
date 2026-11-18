-- Commerce 5, Part C (2026-11-18): set "order".stripe_mode on every order
-- written before the column existed, mark the Commerce 4 $1 gate order, then
-- make the column NOT NULL.
-- backend/src/features/commerce/CLAUDE_CODE_PROMPT_COMMERCE_5_REPORTING_AND_BOOKKEEPING.md
--
-- Evidence (CLOSING_REPORT_5.md, Task 0.6, read 2026-11-18):
--   - Under the live key, the Stripe ids (pi / cs / in) of exactly one order
--     resolve: 0b6ac7e9-3e0a-45f8-9de5-4ceb51ade2b4 (the $1 gate, livemode
--     true). The other five return resource_missing: sandbox ids, all
--     carrying the sandbox account suffix 0QYxZQN6jD.
--   - Same split as the date: the first live revision (00869) booted
--     2026-11-17 17:35 UTC; every other order is older.
-- So: the one live id -> live; a NULL row older than the cutover -> test. A
-- NULL row newer than the cutover that is not the known live order is not
-- guessed: it stays NULL and the NOT NULL step fails, rolling everything back.
--
-- Runs once per database after the Commerce 5 schema has booted (the script
-- creates no table). Idempotent: every UPDATE touches only NULL rows, the
-- event insert is guarded, and SET NOT NULL is a no-op when already set.
-- Deletes nothing. "order" stays immutable for the app: this runs under the
-- owner role (ab_app has no UPDATE on "order").
--
-- Production: run only after Dana's go at the Part C STOP. Run record:
--   test DB:    see CLOSING_REPORT_5.md (commerceBackfill.test.ts, inside a rolled-back transaction, twice)
--   production: (not yet run)

BEGIN;

-- 1. The live order: its ids resolve under the live key.
UPDATE "order" SET stripe_mode = 'live'
WHERE stripe_mode IS NULL AND id = '0b6ac7e9-3e0a-45f8-9de5-4ceb51ade2b4';

-- 2. Everything else from before the live cutover was paid in the sandbox.
UPDATE "order" SET stripe_mode = 'test'
WHERE stripe_mode IS NULL AND created_at < '2026-11-17 17:35:00+00';

-- 3. The $1 gate purchase (Commerce 4 Part D), one event, admin.
INSERT INTO order_event (order_id, event_kind, note, source)
SELECT o.id, 'live_gate', 'Commerce 4 $1 gate purchase', 'admin'
FROM "order" o
WHERE o.id = '0b6ac7e9-3e0a-45f8-9de5-4ceb51ade2b4'
  AND NOT EXISTS (SELECT 1 FROM order_event e WHERE e.order_id = o.id AND e.event_kind = 'live_gate');

-- 4. No order without a mode from here on (fails, and rolls back 1-3, if one is left).
ALTER TABLE "order" ALTER COLUMN stripe_mode SET NOT NULL;

COMMIT;

-- Check (read-only):
--   SELECT stripe_mode, COUNT(*) FROM "order" GROUP BY 1;
--   SELECT order_id, payment_status, is_reportable FROM v_order_reportable ORDER BY paid_at;
