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

CREATE TABLE IF NOT EXISTS dimension (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  data_type  TEXT DEFAULT 'numerical',
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now())
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
  created_at            TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at            TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS quiz (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version     TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT timezone('utc', now())
);

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

-- Close the circular FK now that user_profile exists
ALTER TABLE household
  ADD CONSTRAINT IF NOT EXISTS fk_primary_billing
  FOREIGN KEY (primary_billing_user_id) REFERENCES user_profile(id);

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

CREATE TABLE IF NOT EXISTS address (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  address_type TEXT DEFAULT 'shipping',
  street       TEXT NOT NULL,
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  postal_code  TEXT NOT NULL,
  country      TEXT DEFAULT 'US',
  is_default   BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_detail (
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
-- FLAVOR / ARCHETYPE SYSTEM
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS archetype_vector (
  archetype_id UUID NOT NULL REFERENCES archetype(id) ON DELETE CASCADE,
  dimension_id UUID NOT NULL REFERENCES dimension(id) ON DELETE CASCADE,
  ideal_score  NUMERIC NOT NULL,
  min_score    NUMERIC,
  max_score    NUMERIC,
  updated_at   TIMESTAMPTZ DEFAULT timezone('utc', now()),
  PRIMARY KEY (archetype_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS archetype_relationship (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_archetype_id UUID REFERENCES archetype(id) ON DELETE CASCADE,
  to_archetype_id   UUID REFERENCES archetype(id) ON DELETE CASCADE,
  dimension_id      UUID REFERENCES dimension(id),
  direction         TEXT,
  strength_delta    NUMERIC,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archetype_tunable_variable (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_id UUID REFERENCES archetype(id) ON DELETE CASCADE,
  dimension_id UUID REFERENCES dimension(id) ON DELETE CASCADE,
  display_name TEXT,
  min_offset   NUMERIC DEFAULT -2.0,
  max_offset   NUMERIC DEFAULT 2.0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dimension_scoring_rule (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension_id     UUID REFERENCES dimension(id) ON DELETE CASCADE,
  min_value        NUMERIC,
  max_value        NUMERIC,
  allowed_categories JSONB,
  created_at       TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at       TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- Per-user flavor position and tuning
CREATE TABLE IF NOT EXISTS user_vector_state (
  user_id         UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  dimension_id    UUID NOT NULL REFERENCES dimension(id) ON DELETE CASCADE,
  declared_score  NUMERIC,
  behavior_score  NUMERIC,
  updated_at      TIMESTAMPTZ DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS user_archetype_tuning (
  user_id              UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  archetype_id         UUID NOT NULL REFERENCES archetype(id) ON DELETE CASCADE,
  dimension_id         UUID NOT NULL REFERENCES dimension(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS blend (
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

CREATE TABLE IF NOT EXISTS blend_vector (
  blend_id     UUID NOT NULL REFERENCES blend(id) ON DELETE CASCADE,
  dimension_id UUID NOT NULL REFERENCES dimension(id) ON DELETE CASCADE,
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

-- Cupping / QC sessions
CREATE TABLE IF NOT EXISTS cupping_session (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blend_id              UUID REFERENCES blend(id),
  cupped_by_user_id     UUID REFERENCES user_profile(id),
  sample_roast_date     DATE,
  cupping_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  overall_quality_score NUMERIC,
  internal_notes        TEXT,
  created_at            TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS cupping_session_note (
  cupping_session_id UUID NOT NULL REFERENCES cupping_session(id) ON DELETE CASCADE,
  cupping_note_id    UUID NOT NULL REFERENCES cupping_note(id) ON DELETE CASCADE,
  PRIMARY KEY (cupping_session_id, cupping_note_id)
);

CREATE TABLE IF NOT EXISTS cupping_session_vector (
  cupping_session_id UUID NOT NULL REFERENCES cupping_session(id) ON DELETE CASCADE,
  dimension_id       UUID NOT NULL REFERENCES dimension(id) ON DELETE CASCADE,
  score              NUMERIC NOT NULL,
  PRIMARY KEY (cupping_session_id, dimension_id)
);

-- ─────────────────────────────────────────────
-- QUIZ SYSTEM
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS question (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID REFERENCES quiz(id) ON DELETE CASCADE,
  q_number INTEGER NOT NULL,
  q_text  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS answer (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id           UUID REFERENCES question(id) ON DELETE CASCADE,
  answer_text           TEXT NOT NULL,
  next_question_id      UUID REFERENCES question(id),
  resulting_archetype_id UUID REFERENCES archetype(id),
  vector_impact         JSONB
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
  dimension_id    UUID REFERENCES dimension(id) ON DELETE CASCADE,
  score           NUMERIC NOT NULL
);

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

CREATE TABLE IF NOT EXISTS shipment (
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
  blend_id             UUID REFERENCES blend(id),
  intended_for_user_id UUID REFERENCES user_profile(id),
  shipment_id          UUID REFERENCES shipment(id),
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

CREATE TABLE IF NOT EXISTS feedback_event (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES user_profile(id),
  order_id     UUID REFERENCES "order"(id),
  blend_id     UUID REFERENCES blend(id),
  signal_type  TEXT NOT NULL,
  rating       INTEGER,
  s_value      NUMERIC,
  confidence   NUMERIC,
  created_at   TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS recommendation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profile(id),
  candidates_shown JSONB NOT NULL,
  chosen_blend_id  UUID REFERENCES blend(id),
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

CREATE TABLE IF NOT EXISTS newsletter_subscriber (
  email      TEXT PRIMARY KEY,
  user_id    UUID REFERENCES user_profile(id) ON DELETE SET NULL,
  subscribed BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_profile_firebase_uid ON user_profile(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_quiz_session_user       ON quiz_session(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_vector_user        ON quiz_vector(user_id);
CREATE INDEX IF NOT EXISTS idx_order_user              ON "order"(user_id);
CREATE INDEX IF NOT EXISTS idx_order_line_item_order   ON order_line_item(order_id);
CREATE INDEX IF NOT EXISTS idx_shipment_order          ON shipment(order_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user           ON feedback_event(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_user       ON chat_message(user_id);
CREATE INDEX IF NOT EXISTS idx_blend_archetype         ON blend(archetype_id);
CREATE INDEX IF NOT EXISTS idx_user_coffee_profile_user ON user_coffee_profile(user_id);
