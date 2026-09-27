-- Customer Blueprint · brief C1 — roles, naming, the door — 2026-09-27
-- MIRROR, not a standalone migration to run: this is a redundant paper-trail
-- copy of the block schema.sql applies automatically on every backend boot
-- (backend/src/index.ts, `await db.query(schema)` through ownerPool() as of
-- Part B). Same convention as reporting_views_2026_07_23.sql in this
-- directory. Running this file by hand against a database that already
-- booted with the updated schema.sql is a safe no-op (every statement is
-- idempotent: CREATE TABLE IF NOT EXISTS / CREATE ROLE ... IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING / re-runnable grants).
-- See backend/src/features/customer_blueprint/CLAUDE_CODE_PROMPT_CUSTOMER_1_ROLES_NAMING_DOOR.md.

--
-- Task 0 (2026-09-27) found this file's actual end is here, ~440 lines past
-- the reporting_ro block the brief assumed was last (marketing_config,
-- qr_scan_event, qr_universal_token, claude_daily_spend, api_event, and 7
-- v_coffee_* views all follow reporting_ro). Placed here instead, per Dana's
-- go-ahead, so the grant loops below actually see every table/view that
-- exists by boot time.
--
-- Internal ordering deviates from the brief's own A1/A2/A3 numbering for the
-- same reason: the brief writes the grant loops (A2) before the new fact
-- table DDL (A3), but this whole file runs as one sequential batch
-- (`await db.query(schema)`, backend/src/index.ts) — a grant loop that reads
-- pg_tables before these CREATE TABLEs run would leave every new customer_*
-- table completely ungranted on the very first boot (not just delayed a
-- boot — ab_app couldn't INSERT into any of them until schema.sql happened
-- to be re-applied for an unrelated reason). So this block is A1 (role) ->
-- A3 (fact DDL + order_kind) -> A2 (grants), not the brief's literal order.
-- ═══════════════════════════════════════════════════════════════════════════

-- A1. The application role. Created NOLOGIN here; LOGIN + password set only
-- in the Part G cutover, never in a committed file (same pattern as
-- reporting_ro above). `ab_owner` is not created: it is this series' name
-- for today's login role, whatever DATABASE_URL connects as — see
-- WHAT_WE_BUILT_DB.md's Roles table for the actual name, read via whoAmI().
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ab_app') THEN CREATE ROLE ab_app NOLOGIN; END IF;
END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO ab_app', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO ab_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ab_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ab_app;

-- A3. Common columns for facts, and the new (empty) fact tables. No writers
-- in this brief except catalog_change (Part D, catalogService.ts). Every
-- customer_* table below carries these seven columns first, in this order:
--   id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
--   user_id         UUID NOT NULL REFERENCES user_profile(id)           -- D15: never firebase_uid or email
--   occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()) -- database clock; app code never sets it except backfill
--   recorded_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()) -- differs from occurred_at only when learned of later
--   source          TEXT NOT NULL                                       -- onsite | liam | sms | shopify | qr | backfill | backfill_detected
--   source_id       TEXT NOT NULL                                       -- idempotency key with source (D17)
--   catalog_version TEXT                                                -- getCatalogVersion() at occurred_at (D16); NULL only on backfilled rows
--   UNIQUE (source, source_id)
-- catalog_change is the one customer_-less fact (about the catalog, not a
-- customer): no user_id, plus changed_by TEXT. Named explicitly in both
-- grant loops below, alongside quiz_session/quiz_session_interpretation/
-- "order"/order_line_item.
--
-- Task 0 (2026-09-27) found three FK type mismatches against the brief's
-- literal column list, fixed here (each also called out in the closing
-- report): customer_dial_event.slot_id and
-- customer_liam_recommendation.slot_id were specified UUID but
-- coffee_dial_slot.id is SERIAL; customer_bag_claim.qr_scan_event_id was
-- specified UUID but qr_scan_event.id is SERIAL. All three are INT here.
--
-- customer_liam_question: the brief's own table row lists `reply`/
-- `reply_message_id` columns, but the sentence immediately after it resolves
-- the open question ("C1 creates the table; L3 decides...") with "Default
-- for this brief: separate table customer_liam_reply ... so no fact is ever
-- updated" — the two are contradictory as written. Built per the resolving
-- sentence: customer_liam_question has no reply columns; customer_liam_reply
-- is a separate table below.

CREATE TABLE IF NOT EXISTS customer_identity_link (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profile(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  catalog_version TEXT,
  from_user_id    UUID NOT NULL REFERENCES user_profile(id),
  to_user_id      UUID NOT NULL REFERENCES user_profile(id),
  how             TEXT NOT NULL CHECK (how IN ('email_match','household_claim','admin')),
  CHECK (from_user_id <> to_user_id),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_identity_link_user_occurred ON customer_identity_link (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS customer_feedback_event (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES user_profile(id),
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source             TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  catalog_version    TEXT,
  order_line_item_id UUID REFERENCES order_line_item(id),
  coffee_id          INT NOT NULL REFERENCES coffees(id),
  rating             SMALLINT CHECK (rating BETWEEN 1 AND 5),
  expectation        TEXT,
  raw_text           TEXT,
  supersedes_id      UUID REFERENCES customer_feedback_event(id),
  channel            TEXT NOT NULL CHECK (channel IN ('onsite','sms','liam')),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_feedback_event_user_occurred ON customer_feedback_event (user_id, occurred_at);

-- Common columns minus catalog_version (per the brief); source_id is
-- `feedback_event_id || ':' || cupping_note_id`.
CREATE TABLE IF NOT EXISTS customer_feedback_descriptor (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES user_profile(id),
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source            TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  feedback_event_id UUID NOT NULL REFERENCES customer_feedback_event(id),
  cupping_note_id   UUID NOT NULL REFERENCES cupping_note(id),
  UNIQUE (feedback_event_id, cupping_note_id),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_feedback_descriptor_user_occurred ON customer_feedback_descriptor (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS customer_brew_profile_change (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profile(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  catalog_version TEXT,
  field           TEXT NOT NULL CHECK (field IN ('brew_methods','grinder','takes_it','decaf_constraint','aversions')),
  value           TEXT,
  op              TEXT NOT NULL CHECK (op IN ('set','add','remove','clear')),
  session_id      INT REFERENCES sommelier_sessions(id),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_brew_profile_change_user_occurred ON customer_brew_profile_change (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS customer_dial_event (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profile(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  catalog_version TEXT,
  event_type      TEXT NOT NULL CHECK (event_type IN ('explicit_save','add_to_cart')),
  slot_id         INT REFERENCES coffee_dial_slot(id),
  coffee_id       INT REFERENCES coffees(id),
  archetype_code  archetype_enum,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_dial_event_user_occurred ON customer_dial_event (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS customer_liam_recommendation (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES user_profile(id),
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source               TEXT NOT NULL,
  source_id            TEXT NOT NULL,
  catalog_version      TEXT,
  session_id           INT NOT NULL REFERENCES sommelier_sessions(id),
  turn                 SMALLINT NOT NULL,
  message_id           TEXT NOT NULL,
  coffee_id            INT REFERENCES coffees(id),
  slot_id              INT REFERENCES coffee_dial_slot(id),
  candidate_coffee_ids INT[] NOT NULL,
  palate_read_version  TEXT,
  detected             BOOLEAN NOT NULL DEFAULT false,
  CHECK (coffee_id IS NOT NULL OR slot_id IS NOT NULL),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_liam_recommendation_user_occurred ON customer_liam_recommendation (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS customer_liam_question (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profile(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  catalog_version TEXT,
  session_id      INT NOT NULL REFERENCES sommelier_sessions(id),
  turn            SMALLINT NOT NULL,
  message_id      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('thread','palate','brew')),
  archetype_code  archetype_enum,
  question        TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_liam_question_user_occurred ON customer_liam_question (user_id, occurred_at);

-- The reply side of customer_liam_question, kept as its own row (see the
-- brief-contradiction note above) so no fact row is ever updated: a
-- question's reply is a new insert, never an UPDATE on the question row.
CREATE TABLE IF NOT EXISTS customer_liam_reply (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profile(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  catalog_version TEXT,
  question_id     UUID NOT NULL REFERENCES customer_liam_question(id) UNIQUE,
  reply           TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_liam_reply_user_occurred ON customer_liam_reply (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS customer_liam_action (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profile(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  catalog_version TEXT,
  session_id      INT NOT NULL REFERENCES sommelier_sessions(id),
  message_id      TEXT NOT NULL,
  action_type     TEXT NOT NULL CHECK (action_type IN ('open_dial','retake_quiz','save_recipe')),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_liam_action_user_occurred ON customer_liam_action (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS customer_bag_claim (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES user_profile(id),
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source             TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  catalog_version    TEXT,
  qr_scan_event_id   INT REFERENCES qr_scan_event(id),
  order_line_item_id UUID REFERENCES order_line_item(id),
  coffee_id          INT NOT NULL REFERENCES coffees(id),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_bag_claim_user_occurred ON customer_bag_claim (user_id, occurred_at);

-- catalog_change: the one customer_-less fact (D16). No user_id.
CREATE TABLE IF NOT EXISTS catalog_change (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  catalog_version TEXT,
  entity          TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  action          TEXT NOT NULL,
  before          JSONB,
  after           JSONB,
  changed_by      TEXT,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_change_entity ON catalog_change (entity, entity_id, occurred_at);

-- order_kind (D18): a dimension, not a fact — excluded from the fact grant
-- loop below by name. orders.ts does not change in this brief; the DEFAULT
-- covers new rows and C2 sets the other three kinds.
CREATE TABLE IF NOT EXISTS customer_order_kind (
  code  TEXT PRIMARY KEY,
  label TEXT NOT NULL
);
INSERT INTO customer_order_kind (code, label) VALUES
  ('manual',                'Manual'),
  ('subscription_renewal',  'Subscription renewal'),
  ('gift_redemption',       'Gift redemption'),
  ('liam_followed',         'Liam-followed')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE order_line_item ADD COLUMN IF NOT EXISTS order_kind TEXT REFERENCES customer_order_kind(code);
UPDATE order_line_item SET order_kind = 'manual' WHERE order_kind IS NULL;
ALTER TABLE order_line_item ALTER COLUMN order_kind SET DEFAULT 'manual';

-- A2. Prefix-driven grants, re-run every boot. A table's name decides its
-- privileges, so a customer_* table added later (C2) is immutable from the
-- boot that creates it, with no grant to remember.
--
-- Facts: every customer_% table (customer_order_kind excluded — a
-- dimension, not a fact, D18) plus the four named ones. INSERT + SELECT,
-- never UPDATE/DELETE (D11, D12).
DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND (tablename LIKE 'customer\_%' ESCAPE '\'
           OR tablename IN ('quiz_session', 'quiz_session_interpretation', 'order', 'order_line_item'))
      AND tablename <> 'customer_order_kind'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON %I TO ab_app', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM ab_app', t);
  END LOOP;
END $$;

-- The one sanctioned fact UPDATE, granted per D11's explicit column list.
-- Task 0 (2026-09-27) confirmed this covers NO live call site today: both
-- the live path (quizSession.recordScoredInterpretation ->
-- saveQuizInterpretation) and the backfill (quizInterpretationBackfill.ts)
-- are INSERT-only — every row is written with its final is_current/valid_to
-- already decided in application code before the INSERT, never flipped
-- afterward. No trigger touches this table either. The partial unique index
-- quiz_session_interpretation_current (quiz_session_id) WHERE is_current
-- (this file, "quiz interpretation v2.1, brief 2") is satisfied structurally
-- — no code path ever inserts a second is_current=true row for a session
-- that already has one — not by an UPDATE flipping an old row. So this
-- grant is forward-looking (matching D11's column list as stated), not a
-- reaction to an observed write; if a real SCD2 flip via UPDATE is ever
-- added, it must use exactly this column list or this grant needs to change
-- with it, and lint rule 2's allow-list needs the new call site added.
GRANT UPDATE (valid_to, is_current) ON quiz_session_interpretation TO ab_app;

-- Operating tables and master data: everything else in public that is not a
-- fact and not a view. Full DML. customer_order_kind (dimension, not a
-- fact) gets full DML here instead of the fact grant above.
--
-- api_event is a fact by nature (capture-first, never deleted) but is
-- deliberately NOT in the fact list above: its writer
-- (middleware/apiEventLog.ts) does UPDATE api_event ... to record the
-- response status after the request completes (confirmed in Task 0,
-- 2026-09-27) — the fact grant's blanket UPDATE/DELETE revoke would break
-- it. Left under this operating grant so that UPDATE keeps working; C2
-- decides whether api_event moves behind the door.
DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND (
        NOT (tablename LIKE 'customer\_%' ESCAPE '\'
             OR tablename IN ('quiz_session', 'quiz_session_interpretation', 'order', 'order_line_item'))
        OR tablename = 'customer_order_kind'
      )
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ab_app', t);
  END LOOP;
END $$;

-- Views: SELECT. Re-granted every boot for the same reason reporting_ro's
-- view grants above are: a DROP VIEW/CREATE VIEW earlier in this file
-- revokes any privileges the old view object held.
DO $$ DECLARE v text; BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public'
  LOOP EXECUTE format('GRANT SELECT ON %I TO ab_app', v); END LOOP;
END $$;

-- Task 0 (2026-09-27): grepped `UPDATE quiz_session\b` across backend/src —
-- zero hits. The brief's own note ("quiz_session has a context_data JSONB
-- that older code paths may UPDATE... if a live UPDATE exists, add a
-- temporary GRANT") does not apply; no TEMP grant added, nothing to list in
-- OPEN_TASKS.md for this table.
--
-- CUSTOMER BLUEPRINT grant block: keep this LAST. Tables/views created below
-- this point are not covered until the next boot — see customerIntegrity.ts
-- check 1 (Part F), which fails at boot for exactly this condition (any
-- customer_*/fact table where ab_app has UPDATE or DELETE, or any view
-- where ab_app lacks SELECT) so a future append below this block is caught,
-- not just discouraged by this comment.
