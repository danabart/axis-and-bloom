-- ─────────────────────────────────────────────
-- grant_tokens: manual/admin token grant
-- Mirrors backend/src/services/tokenService.ts grantTokens()
-- Deploy via Cloud SQL Studio or psql; safe to re-run (CREATE OR REPLACE).
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION grant_tokens(
  p_uid          TEXT,
  p_amount       INT,
  p_reason       TEXT DEFAULT 'admin_grant',
  p_reference_id TEXT DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  v_new_balance INT;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be positive, got %', p_amount;
  END IF;

  -- ensure a row exists for this uid (in case signup bonus never ran)
  INSERT INTO user_tokens (uid, balance, lifetime_earned, lifetime_spent)
  VALUES (p_uid, 0, 0, 0)
  ON CONFLICT (uid) DO NOTHING;

  UPDATE user_tokens
  SET balance         = balance + p_amount,
      lifetime_earned = lifetime_earned + p_amount,
      updated_at      = NOW()
  WHERE uid = p_uid
  RETURNING balance INTO v_new_balance;

  INSERT INTO token_events (uid, delta, reason, reference_id, balance_after)
  VALUES (p_uid, p_amount, p_reason, p_reference_id, v_new_balance);

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- Usage:
-- SELECT grant_tokens('<firebase_uid>', 100);
-- SELECT grant_tokens('<firebase_uid>', 100, 'admin_grant', 'manual-2026-07-05');
