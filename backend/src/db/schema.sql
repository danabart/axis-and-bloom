-- Axis & Bloom — Full Schema
-- PostgreSQL 15+, no extensions required

-- ─────────────────────────────────────────────
-- LOOKUP / REFERENCE TABLES
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_type (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at  TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS quiz_type (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE   -- 'main' | 'branch'
);


CREATE TABLE IF NOT EXISTS archetype (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at  TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS roaster (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  api_endpoint          TEXT,
  is_active             BOOLEAN DEFAULT true,
  avg_fulfillment_hours NUMERIC,
  roaster_notes         TEXT,
  address               TEXT,
  email                 TEXT,
  phone                 TEXT,
  contact_person        TEXT,
  website               TEXT,
  created_at            TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at            TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- Add new roaster contact fields to existing DBs (idempotent)
ALTER TABLE roaster ADD COLUMN IF NOT EXISTS address        TEXT;
ALTER TABLE roaster ADD COLUMN IF NOT EXISTS email          TEXT;
ALTER TABLE roaster ADD COLUMN IF NOT EXISTS phone          TEXT;
ALTER TABLE roaster ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE roaster ADD COLUMN IF NOT EXISTS website        TEXT;

-- Seed quiz_type values (idempotent)
DO $$ BEGIN
  INSERT INTO quiz_type (name) VALUES ('main'), ('branch') ON CONFLICT (name) DO NOTHING;
END $$;

CREATE TABLE IF NOT EXISTS quiz (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version              TEXT NOT NULL,
  description          TEXT,
  is_active            BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT timezone('utc', now()),
  quiz_type_id         UUID REFERENCES quiz_type(id),
  trigger_archetype_id UUID REFERENCES archetype(id),  -- branch quizzes only: which primary archetype triggers this
  parent_quiz_id       UUID REFERENCES quiz(id)        -- branch quizzes only: the main quiz this belongs to
);

-- Idempotent column additions for existing DBs
ALTER TABLE quiz ADD COLUMN IF NOT EXISTS quiz_type_id         UUID REFERENCES quiz_type(id);
ALTER TABLE quiz ADD COLUMN IF NOT EXISTS trigger_archetype_id UUID REFERENCES archetype(id);
ALTER TABLE quiz ADD COLUMN IF NOT EXISTS parent_quiz_id       UUID REFERENCES quiz(id);

-- Backfill existing main quizzes (idempotent — WHERE quiz_type_id IS NULL)
UPDATE quiz SET quiz_type_id = (SELECT id FROM quiz_type WHERE name = 'main') WHERE quiz_type_id IS NULL;

CREATE TABLE IF NOT EXISTS cupping_note (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wheel_category   TEXT,
  wheel_subcategory TEXT,
  descriptor       TEXT NOT NULL,
  intensity_score  NUMERIC,
  ai_metadata      JSONB,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at       TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- ─────────────────────────────────────────────
-- USERS  (Firebase UID as PK; no auth.users dep)
-- ─────────────────────────────────────────────

-- household created before user_profile but the billing FK added after
CREATE TABLE IF NOT EXISTS household (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_name         TEXT,
  primary_billing_user_id UUID,            -- FK added after user_profile
  created_at             TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profile (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid     TEXT UNIQUE NOT NULL,   -- Firebase Auth UID
  first_name       TEXT,
  last_name        TEXT,
  household_id     UUID REFERENCES household(id),
  is_household_admin BOOLEAN DEFAULT false,
  user_type_id     UUID REFERENCES user_type(id),
  stripe_customer_id TEXT,
  accepts_marketing BOOLEAN DEFAULT false,
  date_of_birth    DATE,
  created_at       TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at       TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- Close the circular FK now that user_profile exists (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_primary_billing' AND table_name = 'household'
  ) THEN
    ALTER TABLE household ADD CONSTRAINT fk_primary_billing
      FOREIGN KEY (primary_billing_user_id) REFERENCES user_profile(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS household_invitation (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  invited_email  TEXT NOT NULL,
  invited_by_id  UUID NOT NULL REFERENCES user_profile(id),
  token          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ DEFAULT timezone('utc', now()),
  expires_at     TIMESTAMPTZ DEFAULT timezone('utc', now()) + INTERVAL '7 days'
);

CREATE TABLE IF NOT EXISTS user_email (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL UNIQUE,
  is_primary    BOOLEAN DEFAULT false,
  is_verified   BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS user_phone (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL UNIQUE,
  is_primary   BOOLEAN DEFAULT false,
  is_verified  BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at   TIMESTAMPTZ DEFAULT timezone('utc', now())
);

DO $$ BEGIN
  CREATE TYPE address_type_enum AS ENUM ('shipping', 'billing');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS address (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  address_type address_type_enum DEFAULT 'shipping',
  street       TEXT NOT NULL,
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  postal_code  TEXT NOT NULL,
  country      TEXT DEFAULT 'US',
  is_default   BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Migrate existing TEXT column to enum (idempotent — only runs if still TEXT)
-- Drop default first; PostgreSQL cannot cast a TEXT default implicitly during ALTER COLUMN TYPE.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'address' AND column_name = 'address_type' AND data_type = 'text'
  ) THEN
    ALTER TABLE address ALTER COLUMN address_type DROP DEFAULT;
    ALTER TABLE address ALTER COLUMN address_type TYPE address_type_enum
      USING address_type::address_type_enum;
    ALTER TABLE address ALTER COLUMN address_type SET DEFAULT 'shipping'::address_type_enum;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_payment_detail (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  account_type        TEXT NOT NULL,
  provider            TEXT NOT NULL,
  payment_terms       TEXT,
  external_provider_id TEXT,
  routing_info        JSONB,
  is_default          BOOLEAN DEFAULT false,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- ─────────────────────────────────────────────
-- TOKEN ECONOMY
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_tokens (
  uid             TEXT PRIMARY KEY REFERENCES user_profile(firebase_uid) ON DELETE CASCADE,
  balance         INT NOT NULL DEFAULT 0,
  lifetime_earned INT NOT NULL DEFAULT 0,
  lifetime_spent  INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_events (
  id           SERIAL PRIMARY KEY,
  uid          TEXT NOT NULL,
  delta        INT NOT NULL,
  reason       TEXT NOT NULL,   -- 'signup_bonus' | 'order_bonus' | 'sommelier_turn' | 'purchase' | 'admin_grant'
  reference_id TEXT,            -- order ID, session ID, etc. — audit trail
  balance_after INT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- FLAVOR / ARCHETYPE SYSTEM
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS archetype_vector (
  archetype_id UUID NOT NULL REFERENCES archetype(id) ON DELETE CASCADE,
  dimension_id UUID NOT NULL,
  ideal_score  NUMERIC NOT NULL,
  min_score    NUMERIC,
  max_score    NUMERIC,
  updated_at   TIMESTAMPTZ DEFAULT timezone('utc', now()),
  PRIMARY KEY (archetype_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS archetype_relationship (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_archetype_id UUID REFERENCES archetype(id) ON DELETE CASCADE,
  to_archetype_id   UUID REFERENCES archetype(id) ON DELETE CASCADE,
  dimension_id      UUID,
  direction         TEXT,
  strength_delta    NUMERIC,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archetype_tunable_variable (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_id UUID REFERENCES archetype(id) ON DELETE CASCADE,
  dimension_id UUID,
  display_name TEXT,
  min_offset   NUMERIC DEFAULT -2.0,
  max_offset   NUMERIC DEFAULT 2.0,
  created_at   TIMESTAMPTZ DEFAULT now()
);


-- Per-user flavor position and tuning
CREATE TABLE IF NOT EXISTS user_vector_state (
  user_id        UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  dimension_id   UUID NOT NULL,
  declared_score NUMERIC,
  behavior_score NUMERIC,
  updated_at     TIMESTAMPTZ DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS user_archetype_tuning (
  user_id              UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  archetype_id         UUID NOT NULL REFERENCES archetype(id) ON DELETE CASCADE,
  dimension_id         UUID NOT NULL,
  user_selected_offset NUMERIC,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, archetype_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS user_coffee_profile (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  archetype_id     UUID REFERENCES archetype(id),
  match_rank       INTEGER NOT NULL,
  match_confidence NUMERIC,
  is_active        BOOLEAN DEFAULT true,
  assigned_at      TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- ─────────────────────────────────────────────
-- BLENDS & ROASTERY
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roaster_blend (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roaster_id            UUID REFERENCES roaster(id),
  archetype_id          UUID REFERENCES archetype(id),
  blend_name            TEXT NOT NULL,
  shopify_variant_id    TEXT,
  roaster_sku           TEXT,
  cost_to_us            NUMERIC,
  is_active             BOOLEAN DEFAULT true,
  coffee_type           TEXT DEFAULT 'blend',
  weight_oz             NUMERIC DEFAULT 12.0,
  inventory_status      TEXT DEFAULT 'in_stock',
  quantity_available    INTEGER DEFAULT 0,
  safety_stock_buffer   INTEGER DEFAULT 2,
  inventory_last_synced_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at            TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS roastery_blend_vector (
  blend_id     UUID NOT NULL REFERENCES roaster_blend(id) ON DELETE CASCADE,
  dimension_id UUID NOT NULL,
  score        NUMERIC NOT NULL,
  PRIMARY KEY (blend_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS user_roaster_link (
  user_id          UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  roaster_id       UUID NOT NULL REFERENCES roaster(id) ON DELETE CASCADE,
  role_at_roastery TEXT,
  created_at       TIMESTAMPTZ DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, roaster_id)
);


-- ─────────────────────────────────────────────
-- QUIZ SYSTEM
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quiz_question (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id  UUID REFERENCES quiz(id) ON DELETE CASCADE,
  q_number INTEGER NOT NULL,
  q_text   TEXT NOT NULL
);

-- Rename question → quiz_question (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'question' AND schemaname = 'public') THEN
    ALTER TABLE question RENAME TO quiz_question;
  END IF;
END $$;

-- Rename answer → quiz_answer (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'answer' AND schemaname = 'public') THEN
    ALTER TABLE answer RENAME TO quiz_answer;
  END IF;
END $$;

-- Rename answer_archetype_score → quiz_answer_archetype_score (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'answer_archetype_score' AND schemaname = 'public') THEN
    ALTER TABLE answer_archetype_score RENAME TO quiz_answer_archetype_score;
  END IF;
END $$;

-- Rename blend → roaster_blend (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'blend' AND schemaname = 'public') THEN
    ALTER TABLE blend RENAME TO roaster_blend;
  END IF;
END $$;

-- Rename dimensions → coffee_dimensions (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'dimensions' AND schemaname = 'public') THEN
    ALTER TABLE dimensions RENAME TO coffee_dimensions;
  END IF;
END $$;

-- Rename brew_params → cupping_brew_params (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'brew_params' AND schemaname = 'public') THEN
    ALTER TABLE brew_params RENAME TO cupping_brew_params;
  END IF;
END $$;

-- Rename coffee_roastery_descriptors → roastery_coffee_descriptors (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'coffee_roastery_descriptors' AND schemaname = 'public') THEN
    ALTER TABLE coffee_roastery_descriptors RENAME TO roastery_coffee_descriptors;
  END IF;
END $$;

-- Rename session_coffees → cupping_session_coffees (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'session_coffees' AND schemaname = 'public') THEN
    ALTER TABLE session_coffees RENAME TO cupping_session_coffees;
  END IF;
END $$;

-- Rename blend_vector → roastery_blend_vector (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'blend_vector' AND schemaname = 'public') THEN
    ALTER TABLE blend_vector RENAME TO roastery_blend_vector;
  END IF;
END $$;

-- Rename client_flavor_feedback → user_flavor_feedback (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'client_flavor_feedback' AND schemaname = 'public') THEN
    ALTER TABLE client_flavor_feedback RENAME TO user_flavor_feedback;
  END IF;
END $$;

-- Rename feedback_event → user_feedback_event (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'feedback_event' AND schemaname = 'public') THEN
    ALTER TABLE feedback_event RENAME TO user_feedback_event;
  END IF;
END $$;

-- Rename payment_detail → user_payment_detail (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'payment_detail' AND schemaname = 'public') THEN
    ALTER TABLE payment_detail RENAME TO user_payment_detail;
  END IF;
END $$;

-- Rename recommendation_log → user_recommendation_log (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'recommendation_log' AND schemaname = 'public') THEN
    ALTER TABLE recommendation_log RENAME TO user_recommendation_log;
  END IF;
END $$;

-- Rename shipment → roastery_shipment_details (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'shipment' AND schemaname = 'public') THEN
    ALTER TABLE shipment RENAME TO roastery_shipment_details;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS quiz_answer (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id            UUID REFERENCES question(id) ON DELETE CASCADE,
  answer_text            TEXT NOT NULL,
  next_question_id       UUID REFERENCES question(id),
  resulting_archetype_id UUID REFERENCES archetype(id),
  vector_impact          JSONB
);

CREATE TABLE IF NOT EXISTS quiz_session (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  resulting_archetype_id UUID REFERENCES archetype(id),
  context_data         JSONB,
  completed_at         TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS quiz_vector (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  quiz_session_id UUID REFERENCES quiz_session(id) ON DELETE CASCADE,
  dimension_id    UUID,
  score           NUMERIC NOT NULL
);

-- Add weight to quiz_question (idempotent for existing DBs)
ALTER TABLE quiz_question ADD COLUMN IF NOT EXISTS weight NUMERIC DEFAULT 1;

-- Add weight to quiz_answer (idempotent for existing DBs)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quiz_answer' AND column_name = 'weight'
  ) THEN
    ALTER TABLE quiz_answer ADD COLUMN weight NUMERIC DEFAULT 1;
  END IF;
END $$;

-- Add experimental gate flag to quiz_answer (idempotent)
ALTER TABLE quiz_answer ADD COLUMN IF NOT EXISTS is_experimental_gate BOOLEAN DEFAULT FALSE;

-- Per-answer archetype scoring (normalised, multi-archetype support)
-- archetype_id = NULL means a neutral answer (no points awarded to any archetype)
-- UNIQUE (answer_id, archetype_id) prevents duplicate rows per deploy
CREATE TABLE IF NOT EXISTS quiz_answer_archetype_score (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id    UUID NOT NULL REFERENCES quiz_answer(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  archetype_id UUID REFERENCES archetype(id) ON DELETE SET NULL,
  score        NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (answer_id, archetype_id)
);

-- Drop quiz_branch entirely — branch quizzes are now quiz rows with trigger_archetype_id + parent_quiz_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'quiz_branch' AND schemaname = 'public') THEN
    DROP TABLE quiz_branch;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- ORDERS, FULFILLMENT & SUBSCRIPTIONS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  household_id       UUID REFERENCES household(id),
  status             TEXT DEFAULT 'active',
  frequency_days     INTEGER DEFAULT 30,
  next_delivery_date DATE,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "order" (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID REFERENCES user_profile(id),
  household_id             UUID REFERENCES household(id),
  external_shopify_order_id TEXT,
  fulfillment_status       TEXT DEFAULT 'pending',
  is_subscription          BOOLEAN DEFAULT false,
  subtotal                 NUMERIC DEFAULT 0.00,
  shipping_fee_charged     NUMERIC DEFAULT 0.00,
  taxes_collected          NUMERIC DEFAULT 0.00,
  transaction_fee          NUMERIC DEFAULT 0.00,
  total_amount_paid        NUMERIC DEFAULT 0.00,
  currency                 TEXT DEFAULT 'USD',
  promo_code               TEXT,
  created_at               TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at               TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS roastery_shipment_details (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID REFERENCES "order"(id),
  roaster_id        UUID REFERENCES roaster(id),
  tracking_number   TEXT,
  carrier           TEXT,
  status            TEXT DEFAULT 'label_created',
  postage_cost      NUMERIC,
  shipped_at        TIMESTAMPTZ,
  estimated_delivery TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_line_item (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID REFERENCES "order"(id) ON DELETE CASCADE,
  blend_id             UUID REFERENCES roaster_blend(id),
  intended_for_user_id UUID REFERENCES user_profile(id),
  shipment_id          UUID REFERENCES roastery_shipment_details(id),
  quantity             INTEGER NOT NULL DEFAULT 1,
  unit_price_charged   NUMERIC DEFAULT 0.00,
  wholesale_cost       NUMERIC,
  discount_amount      NUMERIC DEFAULT 0.00,
  tax_amount_charged   NUMERIC DEFAULT 0.00,
  vendor_payout_status TEXT DEFAULT 'pending_invoice',
  created_at           TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at           TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- ─────────────────────────────────────────────
-- NOTIFICATIONS, FEEDBACK & RECOMMENDATIONS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES user_profile(id),
  order_id            UUID REFERENCES "order"(id),
  channel             TEXT NOT NULL,
  message_type        TEXT NOT NULL,
  recipient_contact   TEXT,
  delivery_status     TEXT DEFAULT 'pending',
  external_provider_id TEXT,
  metadata            JSONB,
  sent_at             TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- SMS opt-in on user_phone
ALTER TABLE user_phone ADD COLUMN IF NOT EXISTS sms_opt_in    BOOLEAN DEFAULT FALSE;
ALTER TABLE user_phone ADD COLUMN IF NOT EXISTS sms_opt_in_at TIMESTAMPTZ;

-- Post-delivery SMS feedback loop
CREATE TABLE IF NOT EXISTS sommelier_sms_feedback (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  order_id                  UUID REFERENCES "order"(id),
  blend_id                  UUID REFERENCES roaster_blend(id),
  phone_number              TEXT NOT NULL,
  direction                 TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  body                      TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled','sent','delivered','failed','replied','opted_out')),
  scheduled_for             TIMESTAMPTZ,
  sent_at                   TIMESTAMPTZ,
  provider_message_id       TEXT,
  reply_to_id               UUID REFERENCES sommelier_sms_feedback(id),
  haiku_parsed              BOOLEAN DEFAULT FALSE,
  parsed_signal_type        TEXT,
  parsed_rating             INTEGER,
  parsed_sentiment          TEXT CHECK (parsed_sentiment IN ('positive','negative','neutral')),
  parsed_descriptors        JSONB,
  firestore_feedback_doc_id TEXT,
  created_at                TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS user_feedback_event (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES user_profile(id),
  order_id     UUID REFERENCES "order"(id),
  blend_id     UUID REFERENCES roaster_blend(id),
  signal_type  TEXT NOT NULL,
  rating       INTEGER,
  s_value      NUMERIC,
  confidence   NUMERIC,
  created_at   TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS user_recommendation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profile(id),
  candidates_shown JSONB NOT NULL,
  chosen_blend_id  UUID REFERENCES roaster_blend(id),
  created_at       TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- ─────────────────────────────────────────────
-- AI CHAT & NEWSLETTER
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_message (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  context    JSONB,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- ─────────────────────────────────────────────
-- SOMMELIER
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sommelier_sessions (
  id             SERIAL PRIMARY KEY,
  uid            TEXT NOT NULL,
  intent         TEXT NOT NULL,
  started_at     TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  turn_count     INT DEFAULT 0,
  is_closed      BOOLEAN DEFAULT FALSE,
  close_reason   TEXT,
  context_data   JSONB   -- { intent, archetype, tiedArchetypes, openingContext, ragFocus, coffeeIds, catalogText, evaluationId }
);

CREATE TABLE IF NOT EXISTS sommelier_messages (
  id         SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES sommelier_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Where did this subscriber come from?
CREATE TABLE IF NOT EXISTS subscriber_source (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,   -- machine key  e.g. 'pre_launch'
  label TEXT NOT NULL           -- human label  e.g. 'Pre-Launch Popup'
);

INSERT INTO subscriber_source (name, label) VALUES
  ('pre_launch', 'Pre-Launch Popup'),
  ('newsletter',  'Newsletter Modal'),
  ('post_quiz',   'Post-Quiz Signup'),
  ('footer',      'Footer Widget')
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;

CREATE TABLE IF NOT EXISTS newsletter_subscriber (
  email      TEXT PRIMARY KEY,
  first_name TEXT,
  user_id    UUID REFERENCES user_profile(id) ON DELETE SET NULL,
  source_id  INT  REFERENCES subscriber_source(id) ON DELETE SET NULL,
  subscribed BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- Add columns to existing DBs (idempotent)
ALTER TABLE newsletter_subscriber
  ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE newsletter_subscriber
  ADD COLUMN IF NOT EXISTS source_id INT REFERENCES subscriber_source(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────
-- CUPPING TOOL
-- Separate from the main schema's cupping_session (singular).
-- These tables power the standalone cupping / QC workflow.
-- ─────────────────────────────────────────────

-- Enums (idempotent: ignore if already exists)
DO $$ BEGIN
  CREATE TYPE brew_method_enum AS ENUM ('filter', 'espresso', 'cold_brew', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE archetype_enum AS ENUM ('chocolate_nutty', 'balanced_sweet', 'fruity', 'earthy', 'floral', 'experimental');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Rename old enum values in existing DBs (idempotent — checks pg_enum before altering)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'archetype_enum' AND e.enumlabel = 'fruity_floral'
  ) THEN
    ALTER TYPE archetype_enum RENAME VALUE 'fruity_floral' TO 'fruity';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'archetype_enum' AND e.enumlabel = 'spicy_earthy'
  ) THEN
    ALTER TYPE archetype_enum RENAME VALUE 'spicy_earthy' TO 'earthy';
  END IF;
END $$;

-- Add 'experimental' if not already present (ADD VALUE IF NOT EXISTS is idempotent)
ALTER TYPE archetype_enum ADD VALUE IF NOT EXISTS 'experimental';

DO $$ BEGIN
  CREATE TYPE confidence_enum AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE hop_direction_enum AS ENUM ('more', 'less');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE hop_type_enum AS ENUM ('within_archetype', 'bridge_archetype');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Coffee catalogue
CREATE TABLE IF NOT EXISTS coffees (
  id                         SERIAL PRIMARY KEY,
  name                       TEXT NOT NULL,
  roaster                    TEXT,
  origin                     TEXT,
  blend_or_single            TEXT,
  process                    TEXT,
  roast_level                TEXT,
  roast_shade                TEXT,
  flavor_descriptors_roaster TEXT[],
  created_at                 TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE coffees ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS surprise_note TEXT;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS three_voice_story TEXT;

ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Cupping sessions (plural — distinct from legacy cupping_session)
CREATE TABLE IF NOT EXISTS cupping_sessions (
  id            SERIAL PRIMARY KEY,
  session_date  DATE,
  brew_method   TEXT,
  location      TEXT,
  session_notes TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Migrate brew_method column from enum to TEXT on existing DBs (idempotent).
-- Must drop v_cupping_scores_readable first — it references brew_method and blocks ALTER TYPE.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cupping_sessions'
      AND column_name = 'brew_method'
      AND udt_name = 'brew_method_enum'
  ) THEN
    -- Drop the view that blocks the type change, then convert, then drop stranded column.
    DROP VIEW IF EXISTS v_cupping_scores_readable;
    ALTER TABLE cupping_sessions ALTER COLUMN brew_method TYPE TEXT USING brew_method::TEXT;
  END IF;

  -- Drop the stranded brew_method_new column from a previous failed migration attempt.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cupping_sessions'
      AND column_name = 'brew_method_new'
  ) THEN
    ALTER TABLE cupping_sessions DROP COLUMN brew_method_new;
  END IF;
END $$;

-- Junction: which coffees were in a given session, and in what order
CREATE TABLE IF NOT EXISTS cupping_session_coffees (
  id            SERIAL PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES cupping_sessions(id) ON DELETE CASCADE,
  coffee_id     INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
  display_order INTEGER
);

-- Cupping dimensions catalogue (replaces wide per-attribute columns in cupping_scores)
-- is_numeric = false → text notes only; is_numeric = true → value_min/value_max on scale
CREATE TABLE IF NOT EXISTS coffee_dimensions (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  description      TEXT,
  scale_min_label  TEXT,
  scale_max_label  TEXT,
  scale_min        NUMERIC DEFAULT 0,
  scale_max        NUMERIC DEFAULT 15,
  is_numeric       BOOLEAN DEFAULT true,
  display_order    INT
);

-- Drop old wide-column cupping_scores if it exists (detected by sweetness_min column)
-- and replace with the normalised design linked to dimensions via cupping_score_values.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cupping_scores' AND column_name = 'sweetness_min'
  ) THEN
    DROP TABLE cupping_scores CASCADE;
  END IF;
END $$;

-- Scores per (session_coffee, taster) — metadata only; actual values in cupping_score_values.
-- is_merged = true for the combined row produced after all tasters submit.
CREATE TABLE IF NOT EXISTS cupping_scores (
  id                SERIAL PRIMARY KEY,
  session_coffee_id INTEGER NOT NULL REFERENCES cupping_session_coffees(id) ON DELETE CASCADE,
  taster_name       TEXT NOT NULL,
  is_merged         BOOLEAN DEFAULT false,
  overall_notes     TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_coffee_id, taster_name)
);

-- One row per (cupping_score, dimension) — normalised score values.
-- value_min / value_max used for numeric dimensions; notes for free-text dimensions.
CREATE TABLE IF NOT EXISTS cupping_score_values (
  id               SERIAL PRIMARY KEY,
  cupping_score_id INTEGER NOT NULL REFERENCES cupping_scores(id) ON DELETE CASCADE,
  dimension_id     INTEGER NOT NULL REFERENCES coffee_dimensions(id) ON DELETE CASCADE,
  value_min        NUMERIC,
  value_max        NUMERIC,
  notes            TEXT,
  UNIQUE (cupping_score_id, dimension_id)
);

-- Flavor descriptors selected from the SCA wheel for a given score row.
-- Replaces free-text flavor notes with structured FK references to cupping_note.
-- custom_notes = escape hatch for descriptors not on the SCA wheel.
-- intensity = how prominent this descriptor was (0–15, same scale as dimensions).
CREATE TABLE IF NOT EXISTS cupping_score_descriptors (
  id               SERIAL PRIMARY KEY,
  cupping_score_id INTEGER NOT NULL REFERENCES cupping_scores(id) ON DELETE CASCADE,
  cupping_note_id  UUID    NOT NULL REFERENCES cupping_note(id)   ON DELETE CASCADE,
  intensity        NUMERIC,
  custom_notes     TEXT,
  UNIQUE (cupping_score_id, cupping_note_id)
);

-- Brew parameters for each coffee in a session (all method-specific fields nullable)
CREATE TABLE IF NOT EXISTS cupping_brew_params (
  id                        SERIAL PRIMARY KEY,
  session_coffee_id         INTEGER NOT NULL REFERENCES cupping_session_coffees(id) ON DELETE CASCADE,
  dose_grams                NUMERIC,
  water_grams               NUMERIC,
  yield_grams               NUMERIC,
  ratio                     NUMERIC,
  water_temperature_celsius NUMERIC,
  grind_size                TEXT,
  extraction_time_seconds   NUMERIC,
  pressure_bar              NUMERIC,
  steep_time_minutes        NUMERIC,
  brew_device               TEXT,
  notes                     TEXT
);

-- Roastery descriptor notes — structured FK version of coffees.flavor_descriptors_roaster TEXT[].
-- One row per (coffee, descriptor). notes = roaster's exact language if it differs from the descriptor name.
CREATE TABLE IF NOT EXISTS roastery_coffee_descriptors (
  id              SERIAL PRIMARY KEY,
  coffee_id       INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
  cupping_note_id UUID    NOT NULL REFERENCES cupping_note(id) ON DELETE CASCADE,
  notes           TEXT,
  UNIQUE (coffee_id, cupping_note_id)
);

-- Client flavor feedback — collected via post-delivery feedback requests.
-- Lightweight: no session, no brew params. User picks descriptors from the SCA wheel.
-- intensity = how strongly they perceived it (0–15, optional).
-- order_id links back to the specific delivery that triggered the feedback request.
CREATE TABLE IF NOT EXISTS user_flavor_feedback (
  id              SERIAL PRIMARY KEY,
  user_id         UUID    NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  coffee_id       INTEGER NOT NULL REFERENCES coffees(id)      ON DELETE CASCADE,
  order_id        UUID    REFERENCES "order"(id)               ON DELETE SET NULL,
  cupping_note_id UUID    NOT NULL REFERENCES cupping_note(id) ON DELETE CASCADE,
  intensity       NUMERIC,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Archetype assignments per coffee, with history.
-- superseded_at = NULL → current assignment; populated when a newer one replaces it.
CREATE TABLE IF NOT EXISTS archetype_assignments (
  id                       SERIAL PRIMARY KEY,
  coffee_id                INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
  archetype                archetype_enum NOT NULL,
  confidence               confidence_enum NOT NULL,
  assigned_from_session_id INTEGER REFERENCES cupping_sessions(id) ON DELETE SET NULL,
  superseded_at            TIMESTAMPTZ,
  notes                    TEXT,
  created_at               TIMESTAMPTZ DEFAULT now()
);

-- Dominant dimension and Bloom Dial flag per archetype
CREATE TABLE IF NOT EXISTS dial_archetype_config (
  archetype              archetype_enum PRIMARY KEY,
  dominant_dimension_id  INT REFERENCES coffee_dimensions(id),
  has_bloom_dial         BOOLEAN DEFAULT TRUE,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Archetype+dimension-specific label vocabulary for the Bloom Dial (seeded)
CREATE TABLE IF NOT EXISTS dial_position_vocabulary (
  id            SERIAL PRIMARY KEY,
  archetype     archetype_enum NOT NULL,
  dimension_id  INT REFERENCES coffee_dimensions(id) NOT NULL,
  sort_order    INT NOT NULL,
  label         TEXT NOT NULL,
  description   TEXT,
  UNIQUE(archetype, dimension_id, sort_order)
);

-- Maps coffees to their position on the Bloom Dial per archetype
CREATE TABLE IF NOT EXISTS dial_archetype_positions (
  id                  SERIAL PRIMARY KEY,
  archetype           archetype_enum NOT NULL,
  coffee_id           INT REFERENCES coffees(id) ON DELETE CASCADE,
  vocabulary_id       INT REFERENCES dial_position_vocabulary(id) NOT NULL,
  is_default          BOOLEAN DEFAULT FALSE,
  delta_from_default  NUMERIC,
  is_computed         BOOLEAN DEFAULT FALSE,
  last_computed_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(archetype, coffee_id)
);

-- Directional dimensional hop graph between coffees
CREATE TABLE IF NOT EXISTS dial_coffee_relationships (
  id               SERIAL PRIMARY KEY,
  from_coffee_id   INT REFERENCES coffees(id) ON DELETE CASCADE,
  to_coffee_id     INT REFERENCES coffees(id) ON DELETE CASCADE,
  dimension_id     INT REFERENCES coffee_dimensions(id) NOT NULL,
  direction        hop_direction_enum NOT NULL,
  delta            NUMERIC,
  hop_type         hop_type_enum NOT NULL,
  is_recommended   BOOLEAN DEFAULT FALSE,
  confidence       confidence_enum DEFAULT 'medium',
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_coffee_id, to_coffee_id, dimension_id, direction)
);

-- Maps Axis & Bloom platform slot names to the coffees that fill them.
-- Multiple coffees (from different roasters) can share a platform_name slot.
-- priority=1 is preferred; priority=2 is fallback if priority=1 is out of stock.
CREATE TABLE IF NOT EXISTS coffee_alias (
  id              SERIAL PRIMARY KEY,
  platform_name   TEXT NOT NULL,
  archetype       archetype_enum,   -- NULL for Half-Caf / Decaf (no enum value)
  dial_sort_order INT,              -- matches dial_position_vocabulary.sort_order
  coffee_id       INT REFERENCES coffees(id) ON DELETE CASCADE,
  is_active       BOOLEAN DEFAULT TRUE,
  priority        INT DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (archetype, dial_sort_order, coffee_id)
);

-- ─────────────────────────────────────────────
-- LOOKUP VALUES  (controlled vocabulary)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lookup_value (
  id         SERIAL PRIMARY KEY,
  category   TEXT NOT NULL,
  value      TEXT NOT NULL,
  label      TEXT NOT NULL,          -- display label (can differ from value)
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category, value)
);

-- ─────────────────────────────────────────────
-- ADMIN HELPER FUNCTIONS
-- ─────────────────────────────────────────────

-- grant_admin(email) → sets a user's type to 'admin'
-- Usage: SELECT grant_admin('user@example.com');
CREATE OR REPLACE FUNCTION grant_admin(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE user_profile up
  SET user_type_id = (SELECT id FROM user_type WHERE name = 'admin')
  FROM user_email ue
  WHERE up.id = ue.user_id
    AND ue.email_address = LOWER(TRIM(p_email));

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN 'No user found with email: ' || p_email ||
           '. Make sure they have logged in at least once.';
  END IF;

  RETURN p_email || ' is now an admin.';
END;
$$;

-- revoke_admin(email) → sets a user's type back to 'customer'
-- Usage: SELECT revoke_admin('user@example.com');
CREATE OR REPLACE FUNCTION revoke_admin(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE user_profile up
  SET user_type_id = (SELECT id FROM user_type WHERE name = 'customer')
  FROM user_email ue
  WHERE up.id = ue.user_id
    AND ue.email_address = LOWER(TRIM(p_email));

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN 'No user found with email: ' || p_email;
  END IF;

  RETURN p_email || ' has been set back to customer.';
END;
$$;

-- list_admins() → returns all users with admin role
-- Usage: SELECT * FROM list_admins();
CREATE OR REPLACE FUNCTION list_admins()
RETURNS TABLE(email TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
AS $$
  SELECT ue.email_address, up.created_at
  FROM user_profile up
  JOIN user_type    ut ON ut.id = up.user_type_id
  JOIN user_email   ue ON ue.user_id = up.id
  WHERE ut.name = 'admin'
    AND ue.is_primary = true
  ORDER BY up.created_at;
$$;

-- ─────────────────────────────────────────────
-- SEED DATA  (Quiz V2 — idempotent)
-- Runs on every startup; skipped if already seeded.
-- ─────────────────────────────────────────────

-- 0a. User types
INSERT INTO user_type (name, description) VALUES
  ('admin',    'Internal team — full access to admin portal'),
  ('customer', 'Regular subscriber')
ON CONFLICT (name) DO NOTHING;

-- 0b. Lookup values (controlled vocabulary for dropdowns)
INSERT INTO lookup_value (category, value, label, sort_order) VALUES
  -- roast level
  ('roast_level', 'light',        'Light',        1),
  ('roast_level', 'light-medium', 'Light-Medium',  2),
  ('roast_level', 'medium',       'Medium',        3),
  ('roast_level', 'medium-dark',  'Medium-Dark',   4),
  ('roast_level', 'dark',         'Dark',          5),
  -- process
  ('process', 'washed',     'Washed',     1),
  ('process', 'natural',    'Natural',    2),
  ('process', 'honey',      'Honey',      3),
  ('process', 'anaerobic',  'Anaerobic',  4),
  ('process', 'wet-hulled', 'Wet-Hulled', 5),
  ('process', 'other',      'Other',      6),
  -- blend type
  ('blend_or_single', 'single', 'Single Origin', 1),
  ('blend_or_single', 'blend',  'Blend',         2),
  -- brew method
  ('brew_method', 'cupping',      'Cupping',      1),
  ('brew_method', 'filter',       'Filter',       2),
  ('brew_method', 'pour-over',    'Pour-Over',    3),
  ('brew_method', 'espresso',     'Espresso',     4),
  ('brew_method', 'french-press', 'French Press', 5),
  ('brew_method', 'aeropress',    'AeroPress',    6),
  ('brew_method', 'other',        'Other',        7)
ON CONFLICT (category, value) DO UPDATE
  SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- 1. Archetypes (name is UNIQUE — safe to re-run)
INSERT INTO archetype (name, description) VALUES
  ('Chocolate & Nutty', 'A rich, bold, and comforting profile. You know exactly what you like and you like it satisfying.'),
  ('Balanced & Sweet',  'A smooth, round, and approachable profile. You want coffee that''s easy, pleasant, and never surprising.'),
  ('Fruity',            'A vibrant, curious, and layered profile. You''re here for the experience, not just the caffeine.'),
  ('Earthy',            'A deep, complex, and grounded profile. You''re drawn to coffees with weight, structure, and earthy depth.'),
  ('Floral',            'A delicate, aromatic, and tea-like profile. You''re drawn to brightness and floral complexity over body and bitterness.'),
  ('Experimental',      'A boundary-pushing, discovery-first profile. You seek the unexpected — unusual processing, exotic origins, unconventional flavors.')
ON CONFLICT (name) DO NOTHING;

-- Rename 'Fruity & Complex' → 'Fruity' in existing DBs (idempotent)
UPDATE archetype SET name = 'Fruity', updated_at = NOW() WHERE name = 'Fruity & Complex';

-- 2. Cupping dimensions (OVERRIDING SYSTEM VALUE lets us set explicit SERIAL IDs)
INSERT INTO coffee_dimensions (id, name, description, scale_min_label, scale_max_label, scale_min, scale_max, is_numeric, display_order)
OVERRIDING SYSTEM VALUE VALUES
  ( 1, 'Fragrance',       'Dry grounds smell before water',          NULL,                       NULL,                        NULL, NULL,   false,  1),
  ( 2, 'Aroma',           'Wet aroma after water added',             NULL,                       NULL,                        NULL, NULL,   false,  2),
  ( 3, 'Flavor',          'Taste in the cup',                        NULL,                       NULL,                        NULL, NULL,   false,  3),
  ( 4, 'Sweetness',       'Perceived sweetness',                     'no sweetness',             'very sweet',                0,    15,     true,   4),
  ( 5, 'Acidity',         'Brightness and acidity',                  'flat',                     'very bright / sharp',       0,    15,     true,   5),
  ( 6, 'Bitterness',      'Bitterness level',                        'none',                     'very bitter',               0,    15,     true,   6),
  ( 7, 'Body',            'Weight and fullness',                     'watery / light',           'very heavy',                0,    15,     true,   7),
  ( 8, 'Texture',         'Mouthfeel texture',                       'very smooth / silky',      'very drying / rough',       0,    15,     true,   8),
  ( 9, 'Savory / Depth',  'Complexity and depth',                    'transparent / clean',      'very deep / complex',       0,    15,     true,   9),
  (10, 'Finish Length',   'How long the finish lasts',               'disappears immediately',   'very long lingering',       0,    15,     true,  10),
  (11, 'Finish Character','Quality and character of the finish',     NULL,                       NULL,                        NULL, NULL,   false, 11),
  (12, 'Mouthfeel',       'Overall mouthfeel description',           NULL,                       NULL,                        NULL, NULL,   false, 12)
ON CONFLICT (id) DO NOTHING;

-- Reset the dimensions sequence if it exists (table may have been created without SERIAL)
DO $$ BEGIN
  PERFORM setval('coffee_dimensions_id_seq', (SELECT COALESCE(MAX(id), 12) FROM coffee_dimensions));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Seed dial_archetype_config (idempotent)
INSERT INTO dial_archetype_config (archetype, dominant_dimension_id, has_bloom_dial) VALUES
  ('chocolate_nutty', 7, true),
  ('balanced_sweet',  5, true),
  ('fruity',          5, true),
  ('floral',          9, true),
  ('earthy',          6, true)
ON CONFLICT (archetype) DO NOTHING;

-- Seed dial_position_vocabulary (idempotent)
INSERT INTO dial_position_vocabulary (archetype, dimension_id, sort_order, label) VALUES
  ('chocolate_nutty', 7, 1, 'Lighter'),
  ('chocolate_nutty', 7, 2, 'Classic'),
  ('chocolate_nutty', 7, 3, 'Richer'),
  ('chocolate_nutty', 7, 4, 'Full'),
  ('balanced_sweet',  5, 1, 'Smooth'),
  ('balanced_sweet',  5, 2, 'Balanced'),
  ('balanced_sweet',  5, 3, 'Bright'),
  ('balanced_sweet',  5, 4, 'Lively'),
  ('fruity',          5, 1, 'Mellow'),
  ('fruity',          5, 2, 'Balanced'),
  ('fruity',          5, 3, 'Bright'),
  ('fruity',          5, 4, 'Vibrant'),
  ('floral',          9, 1, 'Delicate'),
  ('floral',          9, 2, 'Balanced'),
  ('floral',          9, 3, 'Complex'),
  ('floral',          9, 4, 'Layered'),
  ('earthy',          6, 1, 'Gentle'),
  ('earthy',          6, 2, 'Earthy'),
  ('earthy',          6, 3, 'Bold'),
  ('earthy',          6, 4, 'Intense')
ON CONFLICT (archetype, dimension_id, sort_order) DO NOTHING;

-- 2. Quiz v2 + questions + answers (only inserts if v2 doesn't exist yet)
DO $seed$
DECLARE
  v_quiz_id  UUID;
  v_q1_id    UUID;
  v_q2_id    UUID;
  v_q3_id    UUID;
  v_q4_id    UUID;
  v_choc_id  UUID;
  v_bal_id   UUID;
  v_fruit_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM quiz LIMIT 1) THEN

    SELECT id INTO v_choc_id  FROM archetype WHERE name = 'Chocolate & Nutty';
    SELECT id INTO v_bal_id   FROM archetype WHERE name = 'Balanced & Sweet';
    SELECT id INTO v_fruit_id FROM archetype WHERE name = 'Fruity';

    INSERT INTO quiz (version, description, is_active)
      VALUES ('v2', 'Axis & Bloom Flavor Finder — 4 questions', true)
      RETURNING id INTO v_quiz_id;

    INSERT INTO quiz_question (quiz_id, q_number, q_text)
      VALUES (v_quiz_id, 1, 'How would you describe your relationship with coffee?')
      RETURNING id INTO v_q1_id;

    INSERT INTO quiz_question (quiz_id, q_number, q_text)
      VALUES (v_quiz_id, 2, 'Someone puts something in front of you as a treat. Which do you reach for?')
      RETURNING id INTO v_q2_id;

    INSERT INTO quiz_question (quiz_id, q_number, q_text)
      VALUES (v_quiz_id, 3, 'You try a new coffee black. What''s your first reaction?')
      RETURNING id INTO v_q3_id;

    INSERT INTO quiz_question (quiz_id, q_number, q_text)
      VALUES (v_quiz_id, 4, 'Which coffee would disappoint you the most?')
      RETURNING id INTO v_q4_id;

    INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
      (v_q1_id, 'It''s a daily ritual. I''m particular about it.',               v_choc_id),
      (v_q1_id, 'It''s a reliable habit. I just like having it.',                v_bal_id),
      (v_q1_id, 'It''s something I''m still discovering. I''m curious about it.', v_fruit_id);

    INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
      (v_q2_id, 'Something rich and comforting — dark chocolate, roasted nuts, a warm brownie.', v_choc_id),
      (v_q2_id, 'Something soft and sweet — a ripe peach, a vanilla biscuit, caramel.',         v_bal_id),
      (v_q2_id, 'Something fresh and lively — a green apple, fresh berries, citrus.',            v_fruit_id);

    -- Option D is neutral (no archetype vote)
    INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
      (v_q3_id, 'It feels complete. I''d drink it as is, or add milk to make it even richer.', v_choc_id),
      (v_q3_id, 'It''s fine, easy to drink. I might add something to smooth it out.',           v_bal_id),
      (v_q3_id, 'Interesting… what flavors am I getting here?',                                  v_fruit_id),
      (v_q3_id, 'I''m not sure. I don''t usually drink it black.',                               NULL);

    INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
      (v_q4_id, 'Feels too thin or watery.',         v_choc_id),
      (v_q4_id, 'Feels too heavy or strong.',        v_bal_id),
      (v_q4_id, 'Every sip tastes exactly the same.', v_fruit_id);

  END IF;
END $seed$;

-- Add Q5 (Bitterness) to quiz v2 if not already present
DO $q5$
DECLARE
  v_quiz_id  UUID;
  v_q5_id    UUID;
  v_choc_id  UUID;
  v_bal_id   UUID;
  v_fruit_id UUID;
BEGIN
  SELECT id INTO v_quiz_id FROM quiz WHERE version = 'v2';
  IF v_quiz_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM quiz_question WHERE quiz_id = v_quiz_id AND q_number = 5
  ) THEN
    SELECT id INTO v_choc_id  FROM archetype WHERE name = 'Chocolate & Nutty';
    SELECT id INTO v_bal_id   FROM archetype WHERE name = 'Balanced & Sweet';
    SELECT id INTO v_fruit_id FROM archetype WHERE name = 'Fruity';

    INSERT INTO quiz_question (quiz_id, q_number, q_text)
      VALUES (v_quiz_id, 5, 'You''re handed an espresso — straight, no milk, no sugar. How does it land?')
      RETURNING id INTO v_q5_id;

    UPDATE quiz SET description = 'Axis & Bloom Flavor Finder — 5 questions' WHERE id = v_quiz_id;

    INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
      (v_q5_id, 'I don''t mind. Actually I kind of like it. It tastes serious.',             v_choc_id),
      (v_q5_id, 'I''ll reach for milk or sugar. I don''t want that.',                        v_bal_id),
      (v_q5_id, 'It feels flat or burnt to me. I''d rather have something bright or light.', v_fruit_id);
  END IF;
END $q5$;

-- Seed quiz_answer_archetype_score for all 5 questions (idempotent — ON CONFLICT DO NOTHING)
-- Matches answers by q_number + answer_text so insert order in the DB never matters.
DO $scoring$
DECLARE
  v_quiz_id UUID;
BEGIN
  SELECT id INTO v_quiz_id FROM quiz WHERE version = 'v2';
  IF v_quiz_id IS NOT NULL THEN
    INSERT INTO quiz_answer_archetype_score (answer_id, question_id, archetype_id, score)
    SELECT a.id, q.id, ar.id, data.score
    FROM (VALUES
      -- Q1 (1 pt each)
      (1, 'It''s a daily ritual. I''m particular about it.',                                          'Chocolate & Nutty', 1),
      (1, 'It''s a reliable habit. I just like having it.',                                            'Balanced & Sweet',  1),
      (1, 'It''s something I''m still discovering. I''m curious about it.',                           'Fruity',            1),
      -- Q2 (2 pts each)
      (2, 'Something rich and comforting — dark chocolate, roasted nuts, a warm brownie.',            'Chocolate & Nutty', 2),
      (2, 'Something soft and sweet — a ripe peach, a vanilla biscuit, caramel.',                    'Balanced & Sweet',  2),
      (2, 'Something fresh and lively — a green apple, fresh berries, citrus.',                      'Fruity',            2),
      -- Q3 (1 pt each; option D → Chocolate & Nutty per scoring spec)
      (3, 'It feels complete. I''d drink it as is, or add milk to make it even richer.',             'Chocolate & Nutty', 1),
      (3, 'It''s fine, easy to drink. I might add something to smooth it out.',                      'Balanced & Sweet',  1),
      (3, 'Interesting… what flavors am I getting here?',                                              'Fruity',            1),
      (3, 'I''m not sure. I don''t usually drink it black.',                                         'Chocolate & Nutty', 1),
      -- Q4 (2 pts each)
      (4, 'Feels too thin or watery.',                                                                'Chocolate & Nutty', 2),
      (4, 'Feels too heavy or strong.',                                                               'Balanced & Sweet',  2),
      (4, 'Every sip tastes exactly the same.',                                                      'Fruity',            2),
      -- Q5 (3 pts each — highest weight, bitterness tolerance is the strongest signal)
      (5, 'I don''t mind. Actually I kind of like it. It tastes serious.',                           'Chocolate & Nutty', 3),
      (5, 'I''ll reach for milk or sugar. I don''t want that.',                                      'Balanced & Sweet',  3),
      (5, 'It feels flat or burnt to me. I''d rather have something bright or light.',               'Fruity',            3)
    ) AS data(q_number, answer_text, archetype_name, score)
    JOIN quiz_question q ON q.quiz_id = v_quiz_id AND q.q_number = data.q_number::int
    JOIN quiz_answer  a ON a.question_id = q.id AND a.answer_text = data.answer_text
    JOIN archetype ar ON ar.name = data.archetype_name
    ON CONFLICT (answer_id, archetype_id) DO NOTHING;
  END IF;
END $scoring$;

-- ─────────────────────────────────────────────
-- QUIZ V3 — "Perfect Cup" edition
-- Changes from V2:
--   Q2: new question + new answer texts (Perfect cup theme)
--   Q3-C: experimental gate flag → scoring returns experimental:true
--   Q3-D: splits 0.5 to CN + 0.5 to BS (was neutral)
--   Q4: new answer texts
--   Q5 B+C: new answer texts
--   V2 deactivated, V3 activated
-- ─────────────────────────────────────────────
DO $v3$
DECLARE
  v_quiz_id  UUID;
  v_q1_id    UUID;
  v_q2_id    UUID;
  v_q3_id    UUID;
  v_q4_id    UUID;
  v_q5_id    UUID;
  v_choc_id  UUID;
  v_bal_id   UUID;
  v_fruit_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM quiz LIMIT 1) THEN RETURN; END IF;

  SELECT id INTO v_choc_id  FROM archetype WHERE name = 'Chocolate & Nutty';
  SELECT id INTO v_bal_id   FROM archetype WHERE name = 'Balanced & Sweet';
  SELECT id INTO v_fruit_id FROM archetype WHERE name = 'Fruity';

  -- Deactivate V2 (and any other active quiz)
  UPDATE quiz SET is_active = FALSE;

  -- Create V3
  INSERT INTO quiz (version, description, is_active)
    VALUES ('v3', 'Axis & Bloom Flavor Finder — V3 with experimental gate', TRUE)
    RETURNING id INTO v_quiz_id;

  -- Q1 — Identity (same text as V2, same answers)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 1, 'How would you describe your relationship with coffee?', 1)
    RETURNING id INTO v_q1_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q1_id, 'It''s a daily ritual. I''m particular about it.',                     v_choc_id),
    (v_q1_id, 'It''s a reliable habit. I just like having it.',                      v_bal_id),
    (v_q1_id, 'It''s something I''m still discovering. I''m curious about it.',      v_fruit_id);

  -- Q2 — Perfect cup (NEW question + NEW answer texts)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 2, 'Think about a coffee that really worked for you. What made it perfect?', 2)
    RETURNING id INTO v_q2_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q2_id, 'It was strong and satisfying — I felt it.',                                          v_choc_id),
    (v_q2_id, 'It was smooth and easy the whole way through — nothing got in the way.',             v_bal_id),
    (v_q2_id, 'It felt alive — bright and changing. Every sip was a little different.',             v_fruit_id);

  -- Q3 — Black coffee (same A/B/C text; C gets experimental gate; D splits 0.5+0.5)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 3, 'You try a new coffee black. What''s your first reaction?', 1)
    RETURNING id INTO v_q3_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q3_id, 'It feels complete. I''d drink it as is, or add milk to make it even richer.',  v_choc_id),
    (v_q3_id, 'It''s fine, easy to drink. I might add something to smooth it out.',           v_bal_id),
    (v_q3_id, 'Interesting… what flavors am I getting here?',                                  v_fruit_id),
    (v_q3_id, 'I''m not sure. I don''t usually drink it black.',                               NULL);

  -- Mark Q3-C as the experimental gate
  UPDATE answer
    SET is_experimental_gate = TRUE
    WHERE question_id = v_q3_id
      AND answer_text = 'Interesting… what flavors am I getting here?';

  -- Q4 — Disappointment (NEW answer texts)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 4, 'Which coffee would disappoint you the most?', 2)
    RETURNING id INTO v_q4_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q4_id, 'It has no bitterness or intensity.',    v_choc_id),
    (v_q4_id, 'It''s too bitter or too intense.',      v_bal_id),
    (v_q4_id, 'Every sip tastes exactly the same.',    v_fruit_id);

  -- Q5 — Bitterness (A same, B + C new texts)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 5, 'You''re handed an espresso — straight, no milk, no sugar. How does it land?', 3)
    RETURNING id INTO v_q5_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q5_id, 'I don''t mind. Actually I kind of like it. It tastes serious.',           v_choc_id),
    (v_q5_id, 'I''d rather have something gentler and smoother.',                        v_bal_id),
    (v_q5_id, 'It feels burnt to me. I''d rather have something fresher or more alive.', v_fruit_id);

END $v3$;

-- Seed quiz_answer_archetype_score for V3 (idempotent — ON CONFLICT DO NOTHING)
-- Q3-D splits: 0.5 to Chocolate & Nutty + 0.5 to Balanced & Sweet
DO $v3_scoring$
DECLARE
  v_quiz_id UUID;
BEGIN
  SELECT id INTO v_quiz_id FROM quiz WHERE version = 'v3';
  IF v_quiz_id IS NULL THEN RETURN; END IF;

  INSERT INTO quiz_answer_archetype_score (answer_id, question_id, archetype_id, score)
  SELECT a.id, q.id, ar.id, data.score
  FROM (VALUES
    -- Q1 (weight 1)
    (1, 'It''s a daily ritual. I''m particular about it.',                              'Chocolate & Nutty', 1.0),
    (1, 'It''s a reliable habit. I just like having it.',                               'Balanced & Sweet',  1.0),
    (1, 'It''s something I''m still discovering. I''m curious about it.',               'Fruity',            1.0),
    -- Q2 (weight 2)
    (2, 'It was strong and satisfying — I felt it.',                                    'Chocolate & Nutty', 2.0),
    (2, 'It was smooth and easy the whole way through — nothing got in the way.',       'Balanced & Sweet',  2.0),
    (2, 'It felt alive — bright and changing. Every sip was a little different.',       'Fruity',            2.0),
    -- Q3 (weight 1; D splits 0.5 CN + 0.5 BS — two rows for the same answer)
    (3, 'It feels complete. I''d drink it as is, or add milk to make it even richer.',  'Chocolate & Nutty', 1.0),
    (3, 'It''s fine, easy to drink. I might add something to smooth it out.',           'Balanced & Sweet',  1.0),
    (3, 'Interesting… what flavors am I getting here?',                                  'Fruity',            1.0),
    (3, 'I''m not sure. I don''t usually drink it black.',                              'Chocolate & Nutty', 0.5),
    (3, 'I''m not sure. I don''t usually drink it black.',                              'Balanced & Sweet',  0.5),
    -- Q4 (weight 2)
    (4, 'It has no bitterness or intensity.',                                            'Chocolate & Nutty', 2.0),
    (4, 'It''s too bitter or too intense.',                                              'Balanced & Sweet',  2.0),
    (4, 'Every sip tastes exactly the same.',                                            'Fruity',            2.0),
    -- Q5 (weight 3)
    (5, 'I don''t mind. Actually I kind of like it. It tastes serious.',                'Chocolate & Nutty', 3.0),
    (5, 'I''d rather have something gentler and smoother.',                              'Balanced & Sweet',  3.0),
    (5, 'It feels burnt to me. I''d rather have something fresher or more alive.',      'Fruity',            3.0)
  ) AS data(q_number, answer_text, archetype_name, score)
  JOIN quiz_question q ON q.quiz_id = v_quiz_id AND q.q_number = data.q_number::int
  JOIN quiz_answer    a  ON a.question_id = q.id  AND a.answer_text = data.answer_text
  JOIN archetype ar ON ar.name = data.archetype_name
  ON CONFLICT (answer_id, archetype_id) DO NOTHING;
END $v3_scoring$;

-- SCA Coffee Taster's Flavor Wheel — seed cupping_note (skips if already populated)
DO $sca$
BEGIN
  IF EXISTS (SELECT 1 FROM cupping_note LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO cupping_note (wheel_category, wheel_subcategory, descriptor) VALUES
  ('Floral', NULL,     'Black Tea'),
  ('Floral', 'Floral', 'Chamomile'),
  ('Floral', 'Floral', 'Rose'),
  ('Floral', 'Floral', 'Jasmine'),
  ('Fruity', 'Berry',        'Blackberry'),
  ('Fruity', 'Berry',        'Raspberry'),
  ('Fruity', 'Berry',        'Blueberry'),
  ('Fruity', 'Berry',        'Strawberry'),
  ('Fruity', 'Dried Fruit',  'Raisin'),
  ('Fruity', 'Dried Fruit',  'Prune'),
  ('Fruity', 'Other Fruit',  'Coconut'),
  ('Fruity', 'Other Fruit',  'Cherry'),
  ('Fruity', 'Other Fruit',  'Pomegranate'),
  ('Fruity', 'Other Fruit',  'Pineapple'),
  ('Fruity', 'Other Fruit',  'Grape'),
  ('Fruity', 'Other Fruit',  'Apple'),
  ('Fruity', 'Other Fruit',  'Peach'),
  ('Fruity', 'Other Fruit',  'Pear'),
  ('Fruity', 'Citrus Fruit', 'Grapefruit'),
  ('Fruity', 'Citrus Fruit', 'Orange'),
  ('Fruity', 'Citrus Fruit', 'Lemon'),
  ('Fruity', 'Citrus Fruit', 'Lime'),
  ('Sour / Fermented', 'Sour',                'Sour Aromatics'),
  ('Sour / Fermented', 'Sour',                'Acetic Acid'),
  ('Sour / Fermented', 'Sour',                'Butyric Acid'),
  ('Sour / Fermented', 'Sour',                'Isovaleric Acid'),
  ('Sour / Fermented', 'Sour',                'Citric Acid'),
  ('Sour / Fermented', 'Sour',                'Malic Acid'),
  ('Sour / Fermented', 'Alcohol / Fermented', 'Winey'),
  ('Sour / Fermented', 'Alcohol / Fermented', 'Whiskey'),
  ('Sour / Fermented', 'Alcohol / Fermented', 'Fermented'),
  ('Sour / Fermented', 'Alcohol / Fermented', 'Overripe'),
  ('Green / Vegetative', NULL,  'Olive Oil'),
  ('Green / Vegetative', NULL,  'Beany'),
  ('Green / Vegetative', 'Raw', 'Under-ripe'),
  ('Green / Vegetative', 'Raw', 'Peapod'),
  ('Green / Vegetative', 'Raw', 'Fresh'),
  ('Green / Vegetative', 'Raw', 'Dark Green'),
  ('Green / Vegetative', 'Raw', 'Vegetative'),
  ('Green / Vegetative', 'Raw', 'Hay-like'),
  ('Green / Vegetative', 'Raw', 'Herb-like'),
  ('Other', 'Papery / Musty', 'Stale'),
  ('Other', 'Papery / Musty', 'Cardboard'),
  ('Other', 'Papery / Musty', 'Papery'),
  ('Other', 'Papery / Musty', 'Woody'),
  ('Other', 'Papery / Musty', 'Moldy / Damp'),
  ('Other', 'Papery / Musty', 'Musty / Dusty'),
  ('Other', 'Papery / Musty', 'Musty / Earthy'),
  ('Other', 'Papery / Musty', 'Animalic'),
  ('Other', 'Papery / Musty', 'Meaty / Brothy'),
  ('Other', 'Papery / Musty', 'Phenolic'),
  ('Other', 'Chemical',       'Bitter'),
  ('Other', 'Chemical',       'Salty'),
  ('Other', 'Chemical',       'Medicinal'),
  ('Other', 'Chemical',       'Petroleum'),
  ('Other', 'Chemical',       'Skunky'),
  ('Other', 'Chemical',       'Rubber'),
  ('Roasted', NULL,     'Pipe Tobacco'),
  ('Roasted', NULL,     'Tobacco'),
  ('Roasted', 'Burnt',  'Acrid'),
  ('Roasted', 'Burnt',  'Ashy'),
  ('Roasted', 'Burnt',  'Smoky'),
  ('Roasted', 'Burnt',  'Brown'),
  ('Roasted', 'Burnt',  'Roast'),
  ('Roasted', 'Cereal', 'Malt'),
  ('Roasted', 'Cereal', 'Grain'),
  ('Spices', NULL,          'Pepper'),
  ('Spices', 'Pungent',     'Anise'),
  ('Spices', 'Brown Spice', 'Nutmeg'),
  ('Spices', 'Brown Spice', 'Cinnamon'),
  ('Spices', 'Brown Spice', 'Clove'),
  ('Nutty / Cocoa', 'Nutty', 'Peanuts'),
  ('Nutty / Cocoa', 'Nutty', 'Hazelnut'),
  ('Nutty / Cocoa', 'Nutty', 'Almond'),
  ('Nutty / Cocoa', 'Cocoa', 'Chocolate'),
  ('Nutty / Cocoa', 'Cocoa', 'Dark Chocolate'),
  ('Sweet', 'Brown Sugar', 'Molasses'),
  ('Sweet', 'Brown Sugar', 'Maple Syrup'),
  ('Sweet', 'Brown Sugar', 'Caramelized'),
  ('Sweet', 'Brown Sugar', 'Honey'),
  ('Sweet', NULL,          'Vanilla'),
  ('Sweet', NULL,          'Vanillin'),
  ('Sweet', NULL,          'Overall Sweet'),
  ('Sweet', NULL,          'Sweet Aromatics');
END $sca$;

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_profile_firebase_uid ON user_profile(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_quiz_session_user       ON quiz_session(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_vector_user        ON quiz_vector(user_id);
CREATE INDEX IF NOT EXISTS idx_order_user              ON "order"(user_id);
CREATE INDEX IF NOT EXISTS idx_order_line_item_order   ON order_line_item(order_id);
CREATE INDEX IF NOT EXISTS idx_roastery_shipment_order  ON roastery_shipment_details(order_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user           ON user_feedback_event(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_user       ON chat_message(user_id);
CREATE INDEX IF NOT EXISTS idx_roaster_blend_archetype      ON roaster_blend(archetype_id);
CREATE INDEX IF NOT EXISTS idx_user_coffee_profile_user     ON user_coffee_profile(user_id);

-- Cupping tool indexes
CREATE INDEX IF NOT EXISTS idx_cupping_sessions_date        ON cupping_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_cupping_session_coffees_session      ON cupping_session_coffees(session_id);
CREATE INDEX IF NOT EXISTS idx_cupping_session_coffees_coffee       ON cupping_session_coffees(coffee_id);
CREATE INDEX IF NOT EXISTS idx_cupping_scores_session_cof   ON cupping_scores(session_coffee_id);
CREATE INDEX IF NOT EXISTS idx_cupping_score_values_score   ON cupping_score_values(cupping_score_id);
CREATE INDEX IF NOT EXISTS idx_cupping_score_values_dim     ON cupping_score_values(dimension_id);
CREATE INDEX IF NOT EXISTS idx_cupping_brew_params_sc        ON cupping_brew_params(session_coffee_id);
CREATE INDEX IF NOT EXISTS idx_score_descriptors_score      ON cupping_score_descriptors(cupping_score_id);
CREATE INDEX IF NOT EXISTS idx_score_descriptors_note       ON cupping_score_descriptors(cupping_note_id);
CREATE INDEX IF NOT EXISTS idx_roastery_desc_coffee         ON roastery_coffee_descriptors(coffee_id);
CREATE INDEX IF NOT EXISTS idx_roastery_desc_note           ON roastery_coffee_descriptors(cupping_note_id);
CREATE INDEX IF NOT EXISTS idx_client_feedback_user         ON user_flavor_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_client_feedback_coffee       ON user_flavor_feedback(coffee_id);
CREATE INDEX IF NOT EXISTS idx_client_feedback_order        ON user_flavor_feedback(order_id);
CREATE INDEX IF NOT EXISTS idx_archetype_assign_coffee      ON archetype_assignments(coffee_id);
CREATE INDEX IF NOT EXISTS idx_archetype_assign_session     ON archetype_assignments(assigned_from_session_id);

-- Sommelier SMS feedback indexes
CREATE INDEX IF NOT EXISTS idx_sommelier_sms_user      ON sommelier_sms_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_sommelier_sms_order     ON sommelier_sms_feedback(order_id);
CREATE INDEX IF NOT EXISTS idx_sommelier_sms_status    ON sommelier_sms_feedback(status);
CREATE INDEX IF NOT EXISTS idx_sommelier_sms_scheduled ON sommelier_sms_feedback(scheduled_for) WHERE status = 'scheduled';

-- Quiz scoring indexes
CREATE INDEX IF NOT EXISTS idx_answer_arch_score_answer     ON quiz_answer_archetype_score(answer_id);
CREATE INDEX IF NOT EXISTS idx_answer_arch_score_archetype  ON quiz_answer_archetype_score(archetype_id);

-- ─────────────────────────────────────────────
-- VIEWS
-- ─────────────────────────────────────────────

-- Readable cupping scores — one row per score × dimension, with session + coffee context.
-- brew_method comes from cupping_sessions (TEXT after migration).
DROP VIEW IF EXISTS v_cupping_scores_readable;
CREATE VIEW v_cupping_scores_readable AS
  SELECT
    cs_sess.session_date,
    cs_sess.brew_method,
    cs_sess.location,
    c.name               AS coffee,
    c.roaster,
    c.origin,
    c.blend_or_single,
    c.roast_level,
    cs.taster_name,
    cs.is_merged,
    d.name               AS dimension,
    d.is_numeric,
    d.display_order      AS dimension_order,
    csv.value_min,
    csv.value_max,
    CASE
      WHEN d.is_numeric AND csv.value_min IS NOT NULL AND csv.value_max IS NOT NULL
      THEN ROUND((csv.value_min + csv.value_max) / 2.0, 1)
      ELSE NULL
    END                  AS value_midpoint,
    csv.notes,
    sc.display_order     AS coffee_order,
    aa.archetype,
    aa.confidence        AS archetype_confidence
  FROM cupping_score_values csv
  JOIN cupping_scores        cs      ON cs.id      = csv.cupping_score_id
  JOIN cupping_session_coffees        sc      ON sc.id      = cs.session_coffee_id
  JOIN cupping_sessions       cs_sess ON cs_sess.id = sc.session_id
  JOIN coffees                c       ON c.id       = sc.coffee_id
  JOIN coffee_dimensions            d       ON d.id       = csv.dimension_id
  LEFT JOIN archetype_assignments aa  ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
  ORDER BY cs_sess.session_date, sc.display_order, cs.taster_name, d.display_order;

-- Collaborative flavor wheel — all descriptor observations per coffee, with source label.
-- Sources: 'internal' (cupping sessions), 'roastery' (bag notes), 'client' (post-delivery feedback).
-- Includes coffee name and full descriptor details — no extra JOINs needed at query time.
-- One row per observation. GROUP BY coffee_id + descriptor to aggregate across sources.
-- DROP first — CREATE OR REPLACE cannot rename existing columns (PG restriction).
DROP VIEW IF EXISTS v_collaborative_flavor_wheel;
CREATE VIEW v_collaborative_flavor_wheel AS
  SELECT sc.coffee_id,
         c.name            AS coffee_name,
         csd.cupping_note_id,
         cn.wheel_category,
         cn.wheel_subcategory,
         cn.descriptor,
         'internal'        AS source,
         csd.intensity
  FROM cupping_score_descriptors csd
  JOIN cupping_scores  cs ON cs.id = csd.cupping_score_id
  JOIN cupping_session_coffees sc ON sc.id = cs.session_coffee_id
  JOIN coffees          c ON c.id  = sc.coffee_id
  JOIN cupping_note    cn ON cn.id = csd.cupping_note_id
UNION ALL
  SELECT crd.coffee_id,
         c.name            AS coffee_name,
         crd.cupping_note_id,
         cn.wheel_category,
         cn.wheel_subcategory,
         cn.descriptor,
         'roastery'        AS source,
         NULL              AS intensity
  FROM roastery_coffee_descriptors crd
  JOIN coffees      c  ON c.id  = crd.coffee_id
  JOIN cupping_note cn ON cn.id = crd.cupping_note_id
UNION ALL
  SELECT cff.coffee_id,
         c.name            AS coffee_name,
         cff.cupping_note_id,
         cn.wheel_category,
         cn.wheel_subcategory,
         cn.descriptor,
         'client'          AS source,
         cff.intensity
  FROM user_flavor_feedback cff
  JOIN coffees      c  ON c.id  = cff.coffee_id
  JOIN cupping_note cn ON cn.id = cff.cupping_note_id;

-- Full quiz scoring matrix — one row per (question, answer, archetype)
-- Shows all three scoring levels: question weight, answer weight, archetype-specific score.
-- Lambda formula: q_weight × ans_weight × ans_score = effective contribution per archetype.
DROP VIEW IF EXISTS v_quiz_scoring_matrix;
CREATE VIEW v_quiz_scoring_matrix AS
SELECT
  qz.version                                                        AS quiz_version,
  qt.name                                                           AS quiz_type,
  q.q_number,
  q.q_text,
  ROW_NUMBER() OVER (PARTITION BY q.id ORDER BY a.id)              AS a_number,
  a.answer_text,
  q.weight                                                          AS q_weight,
  a.weight                                                          AS ans_weight,
  ar_ans.name                                                       AS resulting_archetype,
  ar_score.name                                                     AS scored_archetype,
  aas.score                                                         AS ans_score
FROM quiz_answer a
JOIN quiz_question q    ON q.id  = a.question_id
JOIN quiz      qz      ON qz.id = q.quiz_id
LEFT JOIN quiz_type qt ON qt.id = qz.quiz_type_id
LEFT JOIN archetype ar_ans   ON ar_ans.id = a.resulting_archetype_id
LEFT JOIN quiz_answer_archetype_score aas ON aas.answer_id = a.id
LEFT JOIN archetype ar_score ON ar_score.id = aas.archetype_id
ORDER BY quiz_version, q_number, a_number, ans_score DESC NULLS LAST;

-- QUIZ V4 — "Instinct" edition (6 questions, weighted scoring, veto cascade)
DO $v4$
DECLARE
  v_quiz_id  UUID;
  v_choc_id  UUID;
  v_bal_id   UUID;
  v_fruit_id UUID;
  v_q1_id UUID; v_q2_id UUID; v_q3_id UUID;
  v_q4_id UUID; v_q5_id UUID; v_q6_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM quiz LIMIT 1) THEN RETURN; END IF;

  UPDATE quiz SET is_active = FALSE;

  SELECT id INTO v_choc_id  FROM archetype WHERE name = 'Chocolate & Nutty';
  SELECT id INTO v_bal_id   FROM archetype WHERE name = 'Balanced & Sweet';
  SELECT id INTO v_fruit_id FROM archetype WHERE name = 'Fruity';

  INSERT INTO quiz (version, description, is_active)
    VALUES ('v4', 'Axis & Bloom Flavor Finder — 6 questions', true)
    RETURNING id INTO v_quiz_id;

  -- Q1 (weight 1 — identity question)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 1, 'How would you describe your relationship with coffee?', 1)
    RETURNING id INTO v_q1_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q1_id, 'It''s a daily ritual. I''m particular about it.',                 v_choc_id),
    (v_q1_id, 'It''s a reliable habit. I just like having it.',                  v_bal_id),
    (v_q1_id, 'It''s something I''m still discovering. I''m curious about it.', v_fruit_id);

  -- Q2 (weight 0 — food instinct, secondary signal only, not in primary scoring)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 2, 'Someone places a small treat next to your coffee. Without thinking, which do you grab?', 0)
    RETURNING id INTO v_q2_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q2_id, 'Something rich and comforting. Dark chocolate, roasted nuts, a warm brownie.', v_choc_id),
    (v_q2_id, 'Something soft and sweet. A ripe peach, a vanilla biscuit, caramel.',          v_bal_id),
    (v_q2_id, 'Something fresh and lively. A green apple, fresh berries, citrus.',            v_fruit_id);

  -- Q3 (weight 2 — perfect cup)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 3, 'When you finish a really good cup of coffee, what made it good?', 2)
    RETURNING id INTO v_q3_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q3_id, 'It was strong and satisfying. I felt it.',                               v_choc_id),
    (v_q3_id, 'It was smooth and easy the whole way through. Nothing got in the way.',  v_bal_id),
    (v_q3_id, 'It felt alive — bright and changing. Every sip was a little different.', v_fruit_id);

  -- Q4 (weight 1 — black coffee reaction, experimental gate lives here)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 4, 'You try a new coffee black. What''s your first reaction?', 1)
    RETURNING id INTO v_q4_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q4_id, 'It feels complete. I''d drink it as is, or add milk to make it even richer.', v_choc_id),
    (v_q4_id, 'It''s fine, easy to drink. I might add something to smooth it out.',           v_bal_id);
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id, is_experimental_gate) VALUES
    (v_q4_id, 'Interesting — what flavors am I getting here?', v_fruit_id, TRUE);
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q4_id, 'I''m not sure. I don''t usually drink it black.', NULL);

  -- Q5 (weight 2 — disappointment, strong negative framing)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 5, 'Which of these would bother you most about a cup of coffee?', 2)
    RETURNING id INTO v_q5_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q5_id, 'It has no bitterness or intensity.',  v_choc_id),
    (v_q5_id, 'It''s too bitter or too intense.',    v_bal_id),
    (v_q5_id, 'Every sip tastes exactly the same.', v_fruit_id);

  -- Q6 (weight 3 — bitterness tolerance, strongest signal)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 6, 'Someone hands you a coffee that''s a little more bitter than expected. What''s your honest reaction?', 3)
    RETURNING id INTO v_q6_id;
  INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q6_id, 'I don''t mind. Actually I kind of like it. It tastes serious.',           v_choc_id),
    (v_q6_id, 'I''d rather have something gentler and smoother.',                        v_bal_id),
    (v_q6_id, 'It feels burnt to me. I''d rather have something fresher or more alive.', v_fruit_id);

  -- quiz_answer_archetype_score — Q1, Q3, Q4, Q5, Q6 only (Q2 is secondary signal, excluded)
  -- Q4-D is a split: 0.5 points to both Chocolate & Nutty and Balanced & Sweet
  INSERT INTO quiz_answer_archetype_score (answer_id, question_id, archetype_id, score)
  SELECT a.id, q.id, ar.id, data.score
  FROM (VALUES
    (1, 'It''s a daily ritual. I''m particular about it.',                             'Chocolate & Nutty', 1::numeric),
    (1, 'It''s a reliable habit. I just like having it.',                              'Balanced & Sweet',  1::numeric),
    (1, 'It''s something I''m still discovering. I''m curious about it.',              'Fruity',            1::numeric),
    (3, 'It was strong and satisfying. I felt it.',                                    'Chocolate & Nutty', 2::numeric),
    (3, 'It was smooth and easy the whole way through. Nothing got in the way.',       'Balanced & Sweet',  2::numeric),
    (3, 'It felt alive — bright and changing. Every sip was a little different.',      'Fruity',            2::numeric),
    (4, 'It feels complete. I''d drink it as is, or add milk to make it even richer.', 'Chocolate & Nutty', 1::numeric),
    (4, 'It''s fine, easy to drink. I might add something to smooth it out.',          'Balanced & Sweet',  1::numeric),
    (4, 'Interesting — what flavors am I getting here?',                               'Fruity',            1::numeric),
    (4, 'I''m not sure. I don''t usually drink it black.',                             'Chocolate & Nutty', 0.5::numeric),
    (4, 'I''m not sure. I don''t usually drink it black.',                             'Balanced & Sweet',  0.5::numeric),
    (5, 'It has no bitterness or intensity.',                                          'Chocolate & Nutty', 2::numeric),
    (5, 'It''s too bitter or too intense.',                                            'Balanced & Sweet',  2::numeric),
    (5, 'Every sip tastes exactly the same.',                                          'Fruity',            2::numeric),
    (6, 'I don''t mind. Actually I kind of like it. It tastes serious.',               'Chocolate & Nutty', 3::numeric),
    (6, 'I''d rather have something gentler and smoother.',                            'Balanced & Sweet',  3::numeric),
    (6, 'It feels burnt to me. I''d rather have something fresher or more alive.',     'Fruity',            3::numeric)
  ) AS data(q_number, answer_text, archetype_name, score)
  JOIN quiz_question q ON q.quiz_id = v_quiz_id AND q.q_number = data.q_number::int
  JOIN quiz_answer a  ON a.question_id = q.id  AND a.answer_text = data.answer_text
  JOIN archetype   ar ON ar.name = data.archetype_name
  ON CONFLICT (answer_id, archetype_id) DO NOTHING;

END $v4$;

-- ─────────────────────────────────────────────
-- QUIZ V7 — Q order: Identity · Perfect cup · Black coffee · Disappointment ·
--           Bitterness · Food signal (moved to last, weight 0)
-- Branch questions: Floral (trigger: Fruity) and Earthy (trigger: Chocolate & Nutty)
-- Veto cascade: Q5 → Q4 → Q2 → Q1  |  Experimental gate: Q3-C
-- ─────────────────────────────────────────────
DO $v7$
DECLARE
  v_main_type_id   UUID;
  v_branch_type_id UUID;
  v_quiz_id        UUID;
  v_choc_id        UUID;
  v_bal_id         UUID;
  v_fruit_id       UUID;
  v_floral_id      UUID;
  v_earthy_id      UUID;
  v_q1_id UUID; v_q2_id UUID; v_q3_id UUID;
  v_q4_id UUID; v_q5_id UUID; v_q6_id UUID;
  v_floral_bq_id   UUID;   -- Floral branch quiz id
  v_earthy_bq_id   UUID;   -- Earthy branch quiz id
  v_fbq1_id        UUID;   -- Floral branch question id
  v_ebq1_id        UUID;   -- Earthy branch question id
BEGIN
  -- Skip if v7 main quiz already exists (seeded by migration or prior schema run)
  IF EXISTS (SELECT 1 FROM quiz WHERE version = 'v7') THEN RETURN; END IF;

  -- Delete old V7 if it exists (re-seed with normalised branch quiz structure)
  DELETE FROM quiz WHERE version IN ('v7', 'v7-branch-floral', 'v7-branch-earthy');

  SELECT id INTO v_main_type_id   FROM quiz_type WHERE name = 'main';
  SELECT id INTO v_branch_type_id FROM quiz_type WHERE name = 'branch';

  SELECT id INTO v_choc_id   FROM archetype WHERE name = 'Chocolate & Nutty';
  SELECT id INTO v_bal_id    FROM archetype WHERE name = 'Balanced & Sweet';
  SELECT id INTO v_fruit_id  FROM archetype WHERE name = 'Fruity';
  SELECT id INTO v_floral_id FROM archetype WHERE name = 'Floral';
  SELECT id INTO v_earthy_id FROM archetype WHERE name = 'Earthy';

  -- Deactivate all main quizzes
  UPDATE quiz SET is_active = FALSE WHERE quiz_type_id = v_main_type_id OR quiz_type_id IS NULL;

  -- ── Main quiz ─────────────────────────────────────────────────────────────────
  INSERT INTO quiz (version, description, is_active, quiz_type_id)
    VALUES ('v7', 'Axis & Bloom Flavor Finder — V7', true, v_main_type_id)
    RETURNING id INTO v_quiz_id;

  -- Q1 (weight 1 — identity)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 1, 'How would you describe your relationship with coffee?', 1)
    RETURNING id INTO v_q1_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q1_id, 'It''s a daily ritual. I''m particular about it.',                v_choc_id),
    (v_q1_id, 'It''s a reliable habit. I just like having it.',                 v_bal_id),
    (v_q1_id, 'It''s something I''m still discovering. I''m curious about it.', v_fruit_id);

  -- Q2 (weight 2 — perfect cup)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 2, 'When you finish a really good cup of coffee, what made it good?', 2)
    RETURNING id INTO v_q2_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q2_id, 'It was strong and satisfying — I felt it.',                              v_choc_id),
    (v_q2_id, 'It was smooth and easy the whole way through — nothing got in the way.', v_bal_id),
    (v_q2_id, 'It felt alive — bright and changing. Every sip was a little different.', v_fruit_id);

  -- Q3 (weight 1 — black coffee; C is experimental gate)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 3, 'You try a new coffee black. What''s your first reaction?', 1)
    RETURNING id INTO v_q3_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q3_id, 'It feels complete. I''d drink it as is, or add milk to make it even richer.', v_choc_id),
    (v_q3_id, 'It''s fine, easy to drink. I might add something to smooth it out.',           v_bal_id);
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id, is_experimental_gate) VALUES
    (v_q3_id, 'Interesting… what flavors am I getting here?', v_fruit_id, TRUE);

  -- Q4 (weight 2 — disappointment)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 4, 'Which of these would bother you most about a cup of coffee?', 2)
    RETURNING id INTO v_q4_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q4_id, 'It has no bitterness or intensity.', v_choc_id),
    (v_q4_id, 'It''s too bitter or too intense.',   v_bal_id),
    (v_q4_id, 'Every sip tastes exactly the same.', v_fruit_id);

  -- Q5 (weight 3 — bitterness; highest weight; veto cascade anchor)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 5, 'Someone hands you a coffee that''s a little more bitter than expected. What''s your honest reaction?', 3)
    RETURNING id INTO v_q5_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q5_id, 'I don''t mind. Actually I kind of like it. It tastes serious.',           v_choc_id),
    (v_q5_id, 'I''d rather have something gentler and smoother.',                        v_bal_id),
    (v_q5_id, 'It feels burnt to me. I''d rather have something fresher or more alive.', v_fruit_id);

  -- Q6 (weight 0 — food signal; secondary signal only; no scoring rows)
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 6, 'Someone places a small treat next to your coffee. Without thinking, which do you grab?', 0)
    RETURNING id INTO v_q6_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q6_id, 'Something rich and comforting. Dark chocolate, roasted nuts, a warm brownie.', v_choc_id),
    (v_q6_id, 'Something soft and sweet. A ripe peach, a vanilla biscuit, caramel.',          v_bal_id),
    (v_q6_id, 'Something fresh and lively. A green apple, fresh berries, citrus.',            v_fruit_id);

  -- quiz_answer_archetype_score — Q1–Q5 only (Q6 weight 0, excluded from scoring)
  INSERT INTO quiz_answer_archetype_score (answer_id, question_id, archetype_id, score)
  SELECT a.id, q.id, ar.id, data.score
  FROM (VALUES
    (1, 'It''s a daily ritual. I''m particular about it.',                              'Chocolate & Nutty', 1::numeric),
    (1, 'It''s a reliable habit. I just like having it.',                               'Balanced & Sweet',  1::numeric),
    (1, 'It''s something I''m still discovering. I''m curious about it.',               'Fruity',            1::numeric),
    (2, 'It was strong and satisfying — I felt it.',                                    'Chocolate & Nutty', 2::numeric),
    (2, 'It was smooth and easy the whole way through — nothing got in the way.',       'Balanced & Sweet',  2::numeric),
    (2, 'It felt alive — bright and changing. Every sip was a little different.',       'Fruity',            2::numeric),
    (3, 'It feels complete. I''d drink it as is, or add milk to make it even richer.',  'Chocolate & Nutty', 1::numeric),
    (3, 'It''s fine, easy to drink. I might add something to smooth it out.',           'Balanced & Sweet',  1::numeric),
    (3, 'Interesting… what flavors am I getting here?',                                 'Fruity',            1::numeric),
    (4, 'It has no bitterness or intensity.',                                            'Chocolate & Nutty', 2::numeric),
    (4, 'It''s too bitter or too intense.',                                              'Balanced & Sweet',  2::numeric),
    (4, 'Every sip tastes exactly the same.',                                            'Fruity',            2::numeric),
    (5, 'I don''t mind. Actually I kind of like it. It tastes serious.',                'Chocolate & Nutty', 3::numeric),
    (5, 'I''d rather have something gentler and smoother.',                              'Balanced & Sweet',  3::numeric),
    (5, 'It feels burnt to me. I''d rather have something fresher or more alive.',      'Fruity',            3::numeric)
  ) AS data(q_number, answer_text, archetype_name, score)
  JOIN quiz_question q ON q.quiz_id = v_quiz_id AND q.q_number = data.q_number::int
  JOIN quiz_answer a  ON a.question_id = q.id  AND a.answer_text = data.answer_text
  JOIN archetype   ar ON ar.name = data.archetype_name
  ON CONFLICT (answer_id, archetype_id) DO NOTHING;

  -- ── Branch quiz: Fruity → Floral ──────────────────────────────────────────────
  INSERT INTO quiz (version, description, is_active, quiz_type_id, trigger_archetype_id, parent_quiz_id)
    VALUES ('v7-branch-floral', 'V7 branch — Fruity → Floral', false, v_branch_type_id, v_fruit_id, v_quiz_id)
    RETURNING id INTO v_floral_bq_id;

  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_floral_bq_id, 1,
      'One last thing. When coffee is really at its best for you, which is closer?', 1)
    RETURNING id INTO v_fbq1_id;

  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_fbq1_id,
     'It''s complex and alive. A lot happening — I want to explore every sip.',
     v_fruit_id),
    (v_fbq1_id,
     'It''s so light and delicate it barely feels like coffee. Almost like drinking tea.',
     v_floral_id);

  -- ── Branch quiz: Chocolate & Nutty → Earthy ───────────────────────────────────
  INSERT INTO quiz (version, description, is_active, quiz_type_id, trigger_archetype_id, parent_quiz_id)
    VALUES ('v7-branch-earthy', 'V7 branch — Chocolate & Nutty → Earthy', false, v_branch_type_id, v_choc_id, v_quiz_id)
    RETURNING id INTO v_earthy_bq_id;

  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
    VALUES (v_earthy_bq_id, 1,
      'Your profile is rich and bold. How do you like to take it?', 1)
    RETURNING id INTO v_ebq1_id;

  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_ebq1_id,
     'Rich and comforting. Coffee that feels like a reward at the end of the day.',
     v_choc_id),
    (v_ebq1_id,
     'Deep and intense. Complex, almost challenging. The more serious the better.',
     v_earthy_id);


END $v7$;

-- Archetype dimension vectors — one row per archetype × dimension.
-- Joins archetype_vector to archetype (by FK) and dimensions (via md5(name)::uuid match).
-- Columns: archetype, dimension, min_score, ideal_score, max_score
DROP VIEW IF EXISTS v_archetype_dimension_comparison;
DROP VIEW IF EXISTS v_archetype_vectors;
CREATE VIEW v_archetype_vectors AS
SELECT
  a.name                        AS archetype,
  d.name                        AS dimension,
  d.display_order,
  av.min_score,
  av.ideal_score,
  av.max_score
FROM archetype_vector av
JOIN archetype  a ON a.id = av.archetype_id
JOIN coffee_dimensions d ON md5(d.name)::uuid = av.dimension_id
ORDER BY a.name, d.display_order;

-- Archetype vector vs actual cupping scores — one row per archetype × dimension.
-- Shows the target range (from archetype_vector) alongside the average actual score
-- from cupping data for coffees currently assigned to that archetype.
-- avg_actual is NULL when no cupping data exists for that archetype yet.
-- archetype_enum → archetype.name bridged via CASE so no schema change needed.
DROP VIEW IF EXISTS v_archetype_dimension_comparison;
CREATE VIEW v_archetype_dimension_comparison AS
SELECT
  a.name                                                          AS archetype,
  d.name                                                          AS dimension,
  d.display_order,
  av.min_score                                                    AS target_min,
  av.ideal_score                                                  AS target_ideal,
  av.max_score                                                    AS target_max,
  ROUND(AVG((csv.value_min + csv.value_max) / 2.0), 2)           AS avg_actual,
  COUNT(DISTINCT aa.coffee_id)                                    AS coffee_count
FROM archetype_vector av
JOIN archetype  a ON a.id = av.archetype_id
JOIN coffee_dimensions d ON md5(d.name)::uuid = av.dimension_id
LEFT JOIN archetype_assignments aa
  ON aa.superseded_at IS NULL
  AND CASE aa.archetype
        WHEN 'chocolate_nutty' THEN 'Chocolate & Nutty'
        WHEN 'balanced_sweet'  THEN 'Balanced & Sweet'
        WHEN 'fruity'          THEN 'Fruity'
        WHEN 'earthy'          THEN 'Earthy'
        WHEN 'floral'          THEN 'Floral'
        WHEN 'experimental'    THEN 'Experimental'
      END = a.name
LEFT JOIN cupping_session_coffees      sc  ON sc.coffee_id = aa.coffee_id
LEFT JOIN cupping_scores       cs  ON cs.session_coffee_id = sc.id
LEFT JOIN cupping_score_values csv ON csv.cupping_score_id = cs.id
                                   AND csv.dimension_id = d.id
GROUP BY a.name, d.name, d.display_order,
         av.min_score, av.ideal_score, av.max_score
ORDER BY a.name, d.display_order;

-- Bloom Dial: coffee positions on each archetype's dial.
DROP VIEW IF EXISTS v_dial_positions;
CREATE VIEW v_dial_positions AS
SELECT
  dap.archetype,
  c.name               AS coffee,
  c.roaster,
  c.origin,
  cd.name              AS dimension,
  dpv.sort_order       AS position_sort,
  dpv.label            AS dial_label,
  dac.has_bloom_dial,
  dap.is_default,
  dap.delta_from_default,
  dap.is_computed,
  dap.last_computed_at
FROM dial_archetype_positions dap
JOIN coffees                  c   ON c.id   = dap.coffee_id
JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
JOIN coffee_dimensions        cd  ON cd.id  = dpv.dimension_id
JOIN dial_archetype_config    dac ON dac.archetype = dap.archetype
ORDER BY dap.archetype, dpv.sort_order, c.name;

-- Bloom Dial: directional hop graph between coffees.
DROP VIEW IF EXISTS v_dial_navigation;
CREATE VIEW v_dial_navigation AS
SELECT
  fc.name              AS from_coffee,
  tc.name              AS to_coffee,
  cd.name              AS dimension,
  dcr.direction,
  dcr.hop_type,
  dcr.delta,
  dcr.is_recommended,
  dcr.confidence,
  dcr.notes
FROM dial_coffee_relationships dcr
JOIN coffees           fc ON fc.id  = dcr.from_coffee_id
JOIN coffees           tc ON tc.id  = dcr.to_coffee_id
JOIN coffee_dimensions cd ON cd.id  = dcr.dimension_id
ORDER BY fc.name, cd.name, dcr.direction;

-- Newsletter subscriber list — all signups with source label, ordered newest first.
-- Columns: email, first_name, source (human-readable label), subscribed, signed_up_at
DROP VIEW IF EXISTS v_newsletter_subscribers;
CREATE VIEW v_newsletter_subscribers AS
SELECT
  ns.email,
  ns.first_name,
  ss.label        AS source,
  ns.subscribed,
  ns.created_at   AS signed_up_at
FROM newsletter_subscriber ns
LEFT JOIN subscriber_source ss ON ss.id = ns.source_id
ORDER BY ns.created_at DESC;
