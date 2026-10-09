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


-- Catalog Blueprint brief 5b — rename archetype -> coffee_archetype.
DO $$ BEGIN
  IF to_regclass('public.archetype') IS NOT NULL AND to_regclass('public.coffee_archetype') IS NULL THEN
    ALTER TABLE archetype RENAME TO coffee_archetype;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archetype_pkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_archetype_pkey') THEN
    ALTER TABLE coffee_archetype RENAME CONSTRAINT archetype_pkey TO coffee_archetype_pkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archetype_name_key') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_archetype_name_key') THEN
    ALTER TABLE coffee_archetype RENAME CONSTRAINT archetype_name_key TO coffee_archetype_name_key;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archetype_dominant_dimension_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_archetype_dominant_dimension_id_fkey') THEN
    ALTER TABLE coffee_archetype RENAME CONSTRAINT archetype_dominant_dimension_id_fkey TO coffee_archetype_dominant_dimension_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'archetype_code_key') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'coffee_archetype_code_key') THEN
    ALTER INDEX archetype_code_key RENAME TO coffee_archetype_code_key;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS coffee_archetype (
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
  trigger_archetype_id UUID REFERENCES coffee_archetype(id),  -- branch quizzes only: which primary archetype triggers this
  parent_quiz_id       UUID REFERENCES quiz(id)        -- branch quizzes only: the main quiz this belongs to
);

-- Idempotent column additions for existing DBs
ALTER TABLE quiz ADD COLUMN IF NOT EXISTS quiz_type_id         UUID REFERENCES quiz_type(id);
ALTER TABLE quiz ADD COLUMN IF NOT EXISTS trigger_archetype_id UUID REFERENCES coffee_archetype(id);
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
-- SENSORY SOURCE PROVENANCE (WCR Lexicon / SCA wheel / SCA CVA / platform)
-- Records where each sensory term comes from. Our cupping_note vocabulary is
-- the SCA Coffee Taster's Flavor Wheel, itself a derived regrouping of the
-- WCR Sensory Lexicon 2.0 (2017) — WCR supplies the words, the wheel supplies
-- the category/subcategory grouping. coffee_dimensions (Bloom Dial axes) are
-- 0-15 intensity scales, the same measurement model WCR uses per attribute
-- and the SCA CVA descriptive cupping form uses per dimension.
-- Non-destructive: only adds nullable columns/new tables; no existing
-- cupping_note or coffee_dimensions row is edited, renamed, or deleted.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sensory_source (
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  publisher  TEXT,
  edition    TEXT,
  year       INT,
  url        TEXT,
  notes      TEXT
);

INSERT INTO sensory_source (code, name, publisher, edition, year, url, notes) VALUES
  ('wcr_lexicon',      'WCR Sensory Lexicon',                      'World Coffee Research',        '2.0', 2017,
     'https://worldcoffeeresearch.org/resources/sensory-lexicon',
     'Descriptive lexicon; ~110 attributes each with a 0-15 intensity reference. Source of the flavor vocabulary.'),
  ('sca_flavor_wheel', 'SCA Coffee Taster''s Flavor Wheel',        'Specialty Coffee Association', '2016', 2016,
     'https://sca.coffee/research/coffee-tasters-flavor-wheel',
     'Visual regrouping of the WCR Lexicon into 9 categories. Source of our wheel_category/wheel_subcategory taxonomy, not the words.'),
  ('sca_cva',          'SCA Cupping Form — CVA Descriptive Assessment', 'Specialty Coffee Association', '2023', 2023,
     'https://sca.coffee/valueassessment',
     '0-15 intensity descriptive scoring per dimension. Basis for our 0-15 coffee_dimensions.'),
  ('platform',         'Axis & Bloom (internal)',                  'Axis & Bloom',                 NULL, NULL, NULL,
     'Platform-specific axes / consumer-facing aliases (e.g. Brightness, Boldness, Intensity, Complexity, Finish).')
ON CONFLICT (code) DO NOTHING;

-- Full WCR Sensory Lexicon reference set (~110 attributes), kept separate from
-- the active 84-descriptor cupping_note wheel so that vocabulary stays clean.
-- Bulk data (name/section/wheel_category/wheel_subcategory rows) is seeded via
-- seeds/sensory_lexicon_attributes_wcr.sql, which also backfills cupping_note_id.
CREATE TABLE IF NOT EXISTS sensory_lexicon_attribute (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  section           TEXT NOT NULL,          -- lexicon's own 17 sections
  wheel_category    TEXT,                   -- best-effort SCA-wheel category (NULL if the attribute has no wheel placement, e.g. Amplitude/Mouthfeel)
  wheel_subcategory TEXT,
  source_id         INT REFERENCES sensory_source(id),  -- default: wcr_lexicon
  edition           TEXT DEFAULT '2.0 (2017)',
  definition        TEXT,                   -- NULL; fill from the PDF if desired (copyright — not stored in repo)
  cupping_note_id   UUID REFERENCES cupping_note(id),   -- link to our active descriptor if one exists
  UNIQUE (name, section)
);

-- Provenance on cupping_note: every active descriptor traces to the WCR Lexicon;
-- wheel_category/wheel_subcategory (already on the table) trace to the SCA wheel.
ALTER TABLE cupping_note ADD COLUMN IF NOT EXISTS descriptor_source_id INT REFERENCES sensory_source(id);
ALTER TABLE cupping_note ADD COLUMN IF NOT EXISTS lexicon_section TEXT;

UPDATE cupping_note
   SET descriptor_source_id = (SELECT id FROM sensory_source WHERE code = 'wcr_lexicon')
 WHERE descriptor_source_id IS NULL;

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
  reason       TEXT NOT NULL,   -- 'signup_bonus' | 'order_bonus' | 'sommelier_turn' | 'usage_log' | 'purchase' | 'admin_grant'
  reference_id TEXT,            -- order ID, session ID, etc. — audit trail
  balance_after INT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
-- HOME_TASK_3 (§4.8) — nullable, additive. Which model handled a 'sommelier_turn'/
-- 'usage_log' row, for the monthly per-user spend *estimate* the guard layer computes
-- (turns × config/sommelier.guards.modelCostPerTurnUsd[model]). NULL for bonus rows
-- and for any row written before this column existed.
ALTER TABLE token_events ADD COLUMN IF NOT EXISTS model TEXT;

-- ─────────────────────────────────────────────
-- FLAVOR / ARCHETYPE SYSTEM
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS archetype_vector (
  archetype_id UUID NOT NULL REFERENCES coffee_archetype(id) ON DELETE CASCADE,
  dimension_id UUID NOT NULL,
  ideal_score  NUMERIC NOT NULL,
  min_score    NUMERIC,
  max_score    NUMERIC,
  updated_at   TIMESTAMPTZ DEFAULT timezone('utc', now()),
  PRIMARY KEY (archetype_id, dimension_id)
);

-- DEPRECATED, superseded by v_coffee_archetype_adjacency / Bloom Dial (2026-08-04);
-- last consumer (sommelierRag.ts's getAdjacentArchetypes()) migrated in S89.
-- 0 rows in production, confirmed dead (S88/HOME_TASK_9B) — never populated,
-- superseded by the real, actively-curated dial_coffee_relationships hop
-- graph before it ever needed to be. Left in place, not dropped (dormant
-- data discipline, same as the per-coffee QR tokens after HOME_TASK_7E) —
-- do not add a new consumer of this table; use v_coffee_archetype_adjacency instead.
CREATE TABLE IF NOT EXISTS archetype_relationship (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_archetype_id UUID REFERENCES coffee_archetype(id) ON DELETE CASCADE,
  to_archetype_id   UUID REFERENCES coffee_archetype(id) ON DELETE CASCADE,
  dimension_id      UUID,
  direction         TEXT,
  strength_delta    NUMERIC,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archetype_tunable_variable (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_id UUID REFERENCES coffee_archetype(id) ON DELETE CASCADE,
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
  archetype_id         UUID NOT NULL REFERENCES coffee_archetype(id) ON DELETE CASCADE,
  dimension_id         UUID NOT NULL,
  user_selected_offset NUMERIC,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, archetype_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS user_coffee_profile (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  archetype_id     UUID REFERENCES coffee_archetype(id),
  match_rank       INTEGER NOT NULL,
  match_confidence NUMERIC,
  is_active        BOOLEAN DEFAULT true,
  assigned_at      TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- ─────────────────────────────────────────────
-- BLENDS & ROASTERY
-- ─────────────────────────────────────────────

-- Catalog Blueprint brief 5b — rename roaster_blend -> coffee_sku.
DO $$ BEGIN
  IF to_regclass('public.roaster_blend') IS NOT NULL AND to_regclass('public.coffee_sku') IS NULL THEN
    ALTER TABLE roaster_blend RENAME TO coffee_sku;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roaster_blend_coffee_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_sku_coffee_id_fkey') THEN
    ALTER TABLE coffee_sku RENAME CONSTRAINT roaster_blend_coffee_id_fkey TO coffee_sku_coffee_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roaster_blend_deactivation_reason') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_coffee_sku_deactivation_reason') THEN
    ALTER TABLE coffee_sku RENAME CONSTRAINT chk_roaster_blend_deactivation_reason TO chk_coffee_sku_deactivation_reason;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'roaster_blend_one_active_per_weight') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'coffee_sku_one_active_per_weight') THEN
    ALTER INDEX roaster_blend_one_active_per_weight RENAME TO coffee_sku_one_active_per_weight;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS coffee_sku (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roaster_id            UUID REFERENCES roaster(id),
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

-- Link roaster_blend → coffees (idempotent)
ALTER TABLE coffee_sku ADD COLUMN IF NOT EXISTS coffee_id INTEGER REFERENCES coffees(id);
ALTER TABLE coffee_sku ADD COLUMN IF NOT EXISTS last_restocked_at TIMESTAMPTZ;

-- Roastery lifecycle (2026-08-25/26, CTO review round) — coffees.roaster_id is
-- added here, ahead of its own full ALTER/backfill block further down in this
-- file (search "ROASTERY LIFECYCLE"), purely so the name-match backfill
-- immediately below can reference it. The column existing is all this needs;
-- it doesn't need to be populated yet — on the very first boot that
-- introduces it, the AND below simply matches nothing new (self-heals within
-- one boot, once the later block's own two-pass backfill populates it), and
-- coffees already matched from a prior boot are untouched either way (the
-- WHERE rb.coffee_id IS NULL guard below is unaffected by this).
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS roaster_id UUID REFERENCES roaster(id);

-- Backfill coffee_id by name match (only touches rows still NULL — safe to re-run).
-- CTO review round (2026-08-26): tightened to also require the same
-- roaster_id — found live, not theorized: two coffees both named "Colombia"
-- (one per roaster) meant this join was ambiguous, and an unqualified
-- multi-match UPDATE...FROM just picks one arbitrary row. Real prod damage:
-- Temecula's two Colombia roaster_blend rows landed on Path's Colombia
-- coffee (id 7) instead of Temecula's own (id 20) — see the coffees_active_
-- natural_key section below and the pending data-fix SQL that repoints them.
UPDATE coffee_sku rb
SET coffee_id = c.id
FROM coffees c
WHERE rb.coffee_id IS NULL
  AND lower(trim(rb.blend_name)) = lower(trim(c.name))
  AND rb.roaster_id = c.roaster_id;

CREATE TABLE IF NOT EXISTS roastery_blend_vector (
  blend_id     UUID NOT NULL REFERENCES coffee_sku(id) ON DELETE CASCADE,
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

-- Rename user_bloom_dial_position → user_bloom_dial_current_position (idempotent).
-- Liam Dial Event Log Phase A0: now that users/{uid}/dial_events (Firestore) exists
-- as the intentional-movement history, the old name was ambiguous between "the log"
-- and "the setting." This table stays exactly what it always was — the current
-- setting, overwritten in place — just renamed so the split is legible from the
-- names alone. See the table comment below.
-- Guards on the target name too, not just the source — a deploy-ordering race
-- (confirmed in production 2026-07-18: an older build's schema.sql re-created an
-- empty `user_bloom_dial_position` via its own CREATE TABLE IF NOT EXISTS after
-- this rename had already run, since at that moment the old name legitimately
-- didn't exist) can otherwise make this ALTER fail with "already exists" and
-- abort the rest of this file's single-batch execution for that boot.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_bloom_dial_position' AND schemaname = 'public')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_bloom_dial_current_position' AND schemaname = 'public') THEN
    ALTER TABLE user_bloom_dial_position RENAME TO user_bloom_dial_current_position;
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
  resulting_archetype_id UUID REFERENCES coffee_archetype(id),
  vector_impact          JSONB
);

CREATE TABLE IF NOT EXISTS quiz_session (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  resulting_archetype_id UUID REFERENCES coffee_archetype(id),
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
  archetype_id UUID REFERENCES coffee_archetype(id) ON DELETE SET NULL,
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

-- Shipping address snapshot — copied onto the order at checkout time rather than
-- live-referencing `address`, so editing/deleting a saved address never rewrites
-- what a past order actually shipped to. shipping_address_id is kept purely as a
-- "which saved address was this copied from" convenience pointer.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS shipping_street      TEXT;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS shipping_city        TEXT;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS shipping_state       TEXT;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS shipping_postal_code TEXT;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS shipping_country     TEXT;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS shipping_address_id  UUID REFERENCES address(id);

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
  blend_id             UUID REFERENCES coffee_sku(id),
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
-- USER LIFECYCLE STATUS (business/marketing — decoupled from the Sommelier's
-- Firestore conversation-scoping state; see WHAT_WE_BUILT.md for the split)
-- ─────────────────────────────────────────────

-- Definition — reference/lookup table, same pattern as lookup_value / archetype.
-- No enforced sequence between stages: a user can land on any stage directly
-- from any other, so this is a flat classification, not a state-transition graph.
CREATE TABLE IF NOT EXISTS user_lifecycle_stage (
  id                SERIAL PRIMARY KEY,
  code              TEXT UNIQUE NOT NULL,       -- e.g. 'QUIZ_TAKEN_FRESH_NO_ORDER'
  label             TEXT NOT NULL,               -- admin-facing name
  description       TEXT,
  sort_order        INTEGER DEFAULT 0,
  homepage_enabled  BOOLEAN DEFAULT true,        -- does this stage drive a homepage CTA?
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT timezone('utc', now())
);

INSERT INTO user_lifecycle_stage (code, label, description, sort_order, homepage_enabled) VALUES
  ('NEW_NO_QUIZ',                  'New — no quiz',                'Signed in, never taken the quiz (UC2)',                                     10, true),
  ('QUIZ_TAKEN_FRESH_NO_ORDER',    'Quiz taken — fresh, no order',  'Quiz completed under 30 days ago, no order yet (UC1)',                      20, true),
  ('QUIZ_TAKEN_SETTLED_NO_ORDER',  'Quiz taken — settled, no order','Quiz completed 30-180 days ago, no order yet (UC1)',                        30, true),
  ('QUIZ_STALE_NO_ORDER',          'Quiz stale, no order',          'Quiz completed over 180 days ago, no order yet — eligible for retake nudge (UC1)', 40, true),
  ('FIRST_ORDER_FEEDBACK_PENDING', 'First order — feedback pending','Ordered, past the feedback window, no feedback captured yet (UC3)',        50, true),
  ('ACTIVE_REPEAT_USER',           'Active repeat user',            'Ordering normally, no nudge needed',                                        60, true),
  ('SUBSCRIBER',                   'Subscriber',                    'Active subscription row (UC4)',                                             70, true),
  ('REORDER_DUE',                  'Reorder due',                   'Gap since last order exceeds their own cadence (UC4)',                      80, true),
  ('LAPSED_SINGLE_ORDER',          'Lapsed — single order',         'One order, long silence since, never repeated (UC4)',                       90, true),
  ('SPONSORED_TRIAL_ENDING',       'Sponsored trial ending',        'Company-gifted subscription still active, within the expiry warning window', 100, true),
  ('SPONSORED_LAPSED_NO_PAYMENT',  'Sponsored trial lapsed',        'Company-gifted subscription has expired, no payment method on file',        110, true)
ON CONFLICT (code) DO NOTHING;

-- FIRST_ORDER_FEEDBACK_PENDING is no longer a valid stage — pending feedback is
-- now an independent flag (see getPendingFeedbackOrder() in userLifecycle.ts),
-- not a stage that shadows a user's standing lifecycle state. Deactivated rather
-- than deleted: user_lifecycle_event rows may already reference it via
-- from_stage_id/to_stage_id. Any user_lifecycle_state row still pointing at it
-- self-corrects on that user's next refreshLifecycleState() run.
UPDATE user_lifecycle_stage SET is_active = false, homepage_enabled = false
WHERE code = 'FIRST_ORDER_FEEDBACK_PENDING';

-- Current state — one row per user, cheap indexed read at pageview time.
CREATE TABLE IF NOT EXISTS user_lifecycle_state (
  user_id      UUID PRIMARY KEY REFERENCES user_profile(id) ON DELETE CASCADE,
  stage_id     INTEGER REFERENCES user_lifecycle_stage(id),
  computed_at  TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- History — append-only, for funnels and cohort analysis, never updated in place.
CREATE TABLE IF NOT EXISTS user_lifecycle_event (
  id              SERIAL PRIMARY KEY,
  user_id         UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  from_stage_id   INTEGER REFERENCES user_lifecycle_stage(id),
  to_stage_id     INTEGER REFERENCES user_lifecycle_stage(id),
  transitioned_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_user_lifecycle_event_user     ON user_lifecycle_event(user_id);
CREATE INDEX IF NOT EXISTS idx_user_lifecycle_event_to_stage ON user_lifecycle_event(to_stage_id);

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
  blend_id                  UUID REFERENCES coffee_sku(id),
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

-- user_feedback_event, user_recommendation_log and chat_message were dropped
-- by Customer Blueprint C3, Part C (2026-09-27) — dead tables, confirmed
-- empty in prod, superseded by customer_feedback_event/
-- customer_liam_recommendation and the Firestore sommelier transcript
-- respectively. See the DROP TABLE block further down (customerIntegrity.ts
-- check 7 proved them empty first) — removed here too so a fresh boot
-- doesn't keep recreating them just to drop them again.

-- ─────────────────────────────────────────────
-- AI CHAT & NEWSLETTER
-- ─────────────────────────────────────────────

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
  context_data   JSONB   -- { intent, archetype, tiedArchetypes, openingContext, ragFocus, coffeeIds, catalogText, evaluationId, currentTopic, currentTopicTurnsSinceMatch, topicLog }
);

CREATE TABLE IF NOT EXISTS sommelier_messages (
  id         SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES sommelier_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HOME_TASK_6 (§3.2, §3.1) — one row per customer × coffee × method. Created by
-- the arrival note or by conversation (`origin`); updated in place through the
-- <<card:adjust>> marker (revision bumped, never a new row — the whole point is
-- one durable card per method that sharpens over time, not a history of cards).
-- `method` matches Task 4's brew_profile.fields.brew_methods whitelist (a
-- Firestore-config-driven list, not a rigid Postgres enum — see brewCard.ts,
-- validated the same way resolveRemember() validates any other brew-profile
-- field). `params` is customer-language only (ratio/grind_label/temp_c/notes) —
-- never raw dimension jargon, same discipline as the story layer (S74).
CREATE TABLE IF NOT EXISTS user_brew_card (
  id                      SERIAL PRIMARY KEY,
  user_id                 UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  coffee_id               INT NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
  method                  TEXT NOT NULL,
  params                  JSONB NOT NULL,
  origin                  TEXT NOT NULL DEFAULT 'conversation' CHECK (origin IN ('arrival_note', 'conversation')),
  revision                INT NOT NULL DEFAULT 1,
  last_adjustment_reason  TEXT,
  -- Arrival-note delivery timing — the same approximation liamSmsFeedback.ts's
  -- schedulePostDeliveryMessage already uses (no real fulfillment/tracking
  -- webhook exists), just a shorter, config-driven delay since this is the
  -- *arrival* signal, not the +10-day post-delivery feedback ask. NULL for
  -- conversation-created cards, which have no note to send.
  arrival_email_scheduled_for TIMESTAMPTZ,
  arrival_email_sent_at       TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, coffee_id, method)
);

-- HOME_TASK_8 (§3.1) — one row per (user, order, beat type): the beat engine's
-- own dispatch/response ledger, separate from user_brew_card (the artifact a
-- beat may create/adjust) and from sommelier_sms_feedback (the legacy
-- pre-beats post-delivery ask, superseded per-order for beat-enabled users —
-- see beatEngine.ts's supersede check). UNIQUE(user_id, order_id, beat_type)
-- is the idempotency guarantee spec item 1 asks for: re-firing a signal for
-- the same order/beat type is a no-op (ON CONFLICT DO NOTHING at the
-- insert), never a duplicate send. `channel` is nullable/'inline' for the
-- order-placed line, which is injected into the order-confirmation response
-- rather than dispatched through a channel. `skip_reason` is set (never left
-- to imply itself) whenever a beat that would otherwise fire is deliberately
-- not scheduled — repeat-coffee dial-in skip, degrade-on-silence, inactive
-- config, etc. `responded_at` is what degrade-on-silence's trailing-window
-- responsiveness counter reads.
CREATE TABLE IF NOT EXISTS beat_event (
  id             SERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  order_id       UUID NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  coffee_id      INT REFERENCES coffees(id) ON DELETE CASCADE,
  beat_type      TEXT NOT NULL CHECK (beat_type IN ('order_placed', 'arrival_note', 'dial_in')),
  channel        TEXT CHECK (channel IN ('sms', 'email', 'inline')),
  scheduled_at   TIMESTAMPTZ,
  sent_at        TIMESTAMPTZ,
  responded_at   TIMESTAMPTZ,
  skip_reason    TEXT,
  -- H3/C4 security fix (2026-08-09) — a capability token identifying this
  -- beat for the public dial-in respond link, replacing the old bare `id`
  -- (a SERIAL, enumerable, unauthenticated IDOR). 32 random bytes, generated
  -- app-side via crypto.randomBytes at insert time (beatEngine.ts) for
  -- every new row, same pattern as household_invitation.token/coffees.
  -- qr_token. NOT NULL here only applies to a fresh CREATE TABLE (an empty
  -- table has no pre-existing rows to violate it) — an already-deployed
  -- table gets this column via the plain nullable ALTER below instead,
  -- promoted to NOT NULL only by the dedicated migration (see
  -- db/migrations/beat_event_respond_token_2026_08_09.sql) after its
  -- backfill script confirms zero remaining NULLs, never automatically here.
  respond_token  TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, order_id, beat_type)
);
-- Idempotent path for an already-deployed table (see the column comment
-- above for why this stays nullable here, unlike the CREATE TABLE default).
ALTER TABLE beat_event ADD COLUMN IF NOT EXISTS respond_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS beat_event_respond_token_key ON beat_event(respond_token);

-- HOME_TASK_9 (§7) — the lightweight brew-card view log Task 6 didn't add.
-- One row per (user, card) render of the Flavor Memory brew-cards section —
-- the §7 engagement definition's "brew card viewed or edited" leg needed a
-- data source, and none existed. Deliberately not deduped/throttled: a
-- coarse per-render count is what the per-bag engagement rate needs, not a
-- unique-viewer count; if that changes, aggregate at query time, not here.
CREATE TABLE IF NOT EXISTS brew_card_view_event (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  card_id    INT NOT NULL REFERENCES user_brew_card(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMPTZ DEFAULT NOW()
);

-- HOME_TASK_8 (§3.1, spec item 6) — the extended beat-SMS consent, distinct
-- from the legacy sms_opt_in (which only ever covered the post-delivery
-- feedback ask). Additive columns, default false — no UI toggle built here
-- per this task's own scope note (the consent copy itself is Dana's calendar
-- item, alongside A2P registration); the field exists so the code path that
-- will read it is real and ready, not a stub.
ALTER TABLE user_phone ADD COLUMN IF NOT EXISTS sms_beats_opt_in    BOOLEAN DEFAULT FALSE;
ALTER TABLE user_phone ADD COLUMN IF NOT EXISTS sms_beats_opt_in_at TIMESTAMPTZ;

-- HOME_TASK_8 (§3.1) — lets the SMS inbound webhook (cron.ts) tell a beat
-- reply apart from a legacy post-delivery reply without touching
-- parseInboundReply()'s own signature (reused, not duplicated, per the
-- task's context note). 'legacy_feedback' is the default so every existing
-- and future non-beat row needs no backfill. beat_event_id lets the webhook
-- mark responded_at directly instead of re-deriving which beat this was.
ALTER TABLE sommelier_sms_feedback ADD COLUMN IF NOT EXISTS message_kind TEXT NOT NULL DEFAULT 'legacy_feedback'
  CHECK (message_kind IN ('legacy_feedback', 'beat_dial_in'));
ALTER TABLE sommelier_sms_feedback ADD COLUMN IF NOT EXISTS beat_event_id INT REFERENCES beat_event(id);

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

-- Step 04 (A2): post-quiz email capture carries the quiz result along with it so the
-- Mailchimp journey (Step 05) can personalize Email #1 without a second lookup.
-- Nullable — only populated when the signup originated from a quiz completion.
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS archetype TEXT;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS experimental BOOLEAN;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS confidence TEXT;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS quiz_session_key TEXT;

-- Unsubscribe sync (2026-10-01, db/migrations/newsletter_unsubscribe_2026_10_01.sql
-- step 1). subscribed is the single source of truth for marketing consent;
-- unsubscribe_token is the capability token in the hosted unsubscribe URL
-- (crypto.randomBytes(32) hex, minted in app code like beat_event.respond_token).
-- Nullable here on purpose: SET NOT NULL is migration step 3, run by hand only
-- after the backfill script reports zero NULLs — never on boot.
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS unsubscribe_token   TEXT;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS unsubscribed_at     TIMESTAMPTZ;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS unsubscribe_source  TEXT;  -- 'link' | 'one_click' | 'mailchimp' | 'admin'
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscriber_unsubscribe_token_idx ON newsletter_subscriber (unsubscribe_token);

-- Step 07 (C3): at-most-once guard for transactional sends (Resend), keyed by
-- template so a future redesign can re-enable one send of a new version by
-- bumping the template key. Not used for Mailchimp — that stays tag/journey-driven.
CREATE TABLE IF NOT EXISTS transactional_email_log (
  email      TEXT NOT NULL,
  template   TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (email, template)
);

-- Quiz Resync Fix Part B2 (2026-09-25) — the archetype actually baked into
-- the sent email, and Resend's own message id (previously discarded), so a
-- send can be verified/looked-up after the fact without the Resend dashboard.
ALTER TABLE transactional_email_log ADD COLUMN IF NOT EXISTS archetype TEXT;
ALTER TABLE transactional_email_log ADD COLUMN IF NOT EXISTS resend_message_id TEXT;

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

-- hop_type_enum ('within_archetype' | 'bridge_archetype' | 'category_hop') and
-- dial_coffee_relationships.hop_type, the column it typed, were dropped by
-- Catalog Blueprint brief 5a (D3) — v_coffee_hop.hop_type_derived (computed
-- fresh from each endpoint's current home placement) is the only hop type
-- now. A category-endpoint hop (from_category_id/to_category_id set instead
-- of a coffee id — always derives NULL, same as a coffee-endpoint hop whose
-- coffee currently lacks a home) is still distinguishable by
-- from_category_id/to_category_id being non-null; nothing in this codebase
-- read the old 'category_hop' stored value itself (confirmed zero TS refs
-- during brief 5a's Task 0).

-- Coffee catalogue. roaster (free text) dropped by Catalog Blueprint brief
-- 5a (see the ALTER TABLE coffees DROP COLUMN further down) — never declared
-- here so a fresh database never creates it in the first place.
CREATE TABLE IF NOT EXISTS coffees (
  id                         SERIAL PRIMARY KEY,
  name                       TEXT NOT NULL,
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

-- HOME_TASK_5 (§4.4) — the story layer. `story` is the only field Liam or the
-- public story page ever reads; it is written ONLY from generated/edited text
-- that has passed the specificity check (never a null-write of unvalidated
-- content — "generate, scan, THEN mark live"). `story_draft` holds the most
-- recent generation attempt even when it failed validation, so a repeatedly-
-- failing coffee still has something for an admin to look at and fix, without
-- ever being reachable by a customer-facing read. `story_published` is the
-- explicit gate (redundant with "story IS NOT NULL" by construction, kept as
-- its own column for simple admin filtering). `story_admin_edited` rows are
-- skipped by bulk regenerate.
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS story TEXT;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS story_draft TEXT;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS story_published BOOLEAN DEFAULT false;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS story_admin_edited BOOLEAN DEFAULT false;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS story_generated_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────
-- ROASTERY LIFECYCLE — soft deactivation (2026-08-25)
-- Lets Dana deactivate a partner roastery from /admin/roasters in one cascade
-- that marks the roastery and every one of its coffees, blends and slot
-- aliases inactive, with a stamped reason so reactivation restores exactly
-- what the cascade touched and nothing that was manually retired earlier.
-- Nothing is ever deleted. See backend/src/features/roastery_lifecycle/
-- CLAUDE_CODE_PROMPT_ROASTERY_SOFT_DEACTIVATION.md for the full decisions log.
-- `roaster.is_active` already existed but had zero readers outside the admin
-- roaster routes — flipping it was cosmetic until this. `coffees` had no
-- active column at all; `roaster_blend`/`coffee_alias` had per-row is_active
-- but no roaster-level cascade and no reason stamp.
-- ─────────────────────────────────────────────

-- coffees.roaster_id itself is added earlier in this file (right before the
-- roaster_blend.coffee_id name-match backfill, ~L404) — not repeated here.
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;   -- 'roaster' | 'manual' | NULL

ALTER TABLE coffee_sku ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE coffee_sku ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;
-- coffee_alias's own deactivated_at/deactivation_reason columns and check
-- constraint were dropped along with the table (Catalog Blueprint brief 5a).

ALTER TABLE roaster ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE roaster ADD COLUMN IF NOT EXISTS deactivation_note TEXT;     -- free text Dana types in the confirm dialog

CREATE INDEX IF NOT EXISTS coffees_roaster_id_idx ON coffees(roaster_id);
CREATE INDEX IF NOT EXISTS coffees_is_active_idx  ON coffees(is_active);

DO $$ BEGIN
  ALTER TABLE coffees ADD CONSTRAINT chk_coffees_deactivation_reason
    CHECK (deactivation_reason IS NULL OR deactivation_reason IN ('roaster', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE coffee_sku ADD CONSTRAINT chk_coffee_sku_deactivation_reason
    CHECK (deactivation_reason IS NULL OR deactivation_reason IN ('roaster', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- coffee_alias's own chk_coffee_alias_deactivation_reason constraint was
-- dropped along with the table (Catalog Blueprint brief 5a).

-- coffees.roaster_id's two-pass backfill (from roaster_blend, then by
-- case/whitespace-insensitive name match against the free-text coffees.roaster
-- column) ran here through brief 4. Catalog Blueprint brief 5a confirmed zero
-- rows with roaster_id IS NULL in prod, dropped coffees.roaster (below), and
-- added the NOT NULL constraint on roaster_id (see the DO/EXCEPTION block
-- further down) — both passes are now permanently moot and removed rather
-- than left as dead code referencing a dropped column.

-- coffees_active_natural_key (CTO review round, 2026-08-26) — coffee identity
-- is (roastery, coffee), not name alone: two active coffees from the same
-- roastery must never share a (trimmed, case-insensitive) name. Found live,
-- not theorized, by the multi-roaster check in Task 0: coffee 7 "Colombia"
-- had roaster_blend rows from BOTH roasters landing on it (the untightened
-- backfill above was the root cause, now fixed) and coffees 19/33 "Guatemala"
-- (both Temecula) were a genuine duplicate row, 33 an empty stub. Neither of
-- those was blocked by anything — this index is what would have caught it.
--
-- DEPLOY ORDER — this will fail to create on the deploy that introduces it,
-- until the pending data-fix SQL (repoint Temecula's two Colombia
-- roaster_blend rows from coffee 7 to coffee 20; mark coffee 33
-- is_active=false, deactivation_reason='manual', deactivated_at=now() — see
-- the session writeup, awaiting Dana's approval, never auto-run) has been
-- applied to prod. Wrapped in DO/EXCEPTION rather than a bare CREATE UNIQUE
-- INDEX specifically so that a still-live conflict doesn't abort this whole
-- multi-statement script — schema.sql runs as one implicit transaction (no
-- explicit BEGIN/COMMIT in this file), so an uncaught failure here would roll
-- back everything else this same boot applied, including the roaster_id
-- backfill above. A PL/pgSQL EXCEPTION block is its own subtransaction
-- (SAVEPOINT), so catching unique_violation here only skips the index, never
-- the rest of the file. Self-healing: once the data-fix SQL has run, the very
-- next boot's schema.sql application creates the index cleanly with no
-- further action needed.
--
-- CTO review round (2026-08-26, second pass) — this block used to also RAISE
-- WARNING here on the exception path, matching the [roastery-lifecycle]
-- console.warn convention. Dropped: a PL/pgSQL RAISE WARNING is a Postgres
-- NOTICE-level protocol message, and db/client.ts's pg.Pool has no
-- `.on('notice', ...)` listener — with nothing attached, node-postgres just
-- drops it, so it never reached Node's console or Cloud Logging at all. The
-- DO/EXCEPTION wrapper itself stays (it's still what protects the rest of
-- this file from the unique_violation); the actual "was the index created"
-- check now lives in index.ts as a real JS query, next to the other two
-- roastery-lifecycle startup warnings.
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffees_active_natural_key
    ON coffees (roaster_id, lower(trim(name))) WHERE is_active = true;
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

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

-- Consumer-facing word per dimension (e.g. "Intensity" instead of the raw SCA term
-- "Body") — same public-alias pattern as coffee_alias.platform_name, applied to
-- dimensions. Falls back to the raw `name` via COALESCE at the query level where
-- unset. Direct-SQL-only for now — no dimension admin UI exists yet to edit this
-- from (see The Bloom Part 3, Phase B).
ALTER TABLE coffee_dimensions ADD COLUMN IF NOT EXISTS platform_name TEXT;

-- Sensory source provenance: which standard defines this dimension, and (where
-- one applies) which WCR Lexicon attribute it corresponds to. Fine-grained
-- attribute linking is backfilled by seeds/sensory_lexicon_attributes_wcr.sql
-- (depends on that table being seeded); source_id only depends on sensory_source
-- so it's safe to backfill here on every schema run.
ALTER TABLE coffee_dimensions ADD COLUMN IF NOT EXISTS source_id INT REFERENCES sensory_source(id);
ALTER TABLE coffee_dimensions ADD COLUMN IF NOT EXISTS sensory_lexicon_attribute_id INT REFERENCES sensory_lexicon_attribute(id);

UPDATE coffee_dimensions cd
   SET source_id = (SELECT id FROM sensory_source WHERE code = m.source_code)
  FROM (VALUES
    (1,  'sca_cva'),      -- Fragrance
    (2,  'sca_cva'),      -- Aroma
    (3,  'sca_cva'),      -- Flavor
    (4,  'sca_cva'),      -- Sweetness
    (5,  'sca_cva'),      -- Acidity / Brightness
    (6,  'wcr_lexicon'),  -- Bitterness / Boldness
    (7,  'wcr_lexicon'),  -- Body / Intensity
    (8,  'wcr_lexicon'),  -- Texture / Mouthfeel
    (9,  'platform'),     -- Savory / Depth / Complexity
    (10, 'wcr_lexicon'),  -- Finish Length / Finish
    (11, 'sca_cva'),      -- Finish Character
    (12, 'wcr_lexicon')   -- Mouthfeel
  ) AS m(dim_id, source_code)
 WHERE cd.id = m.dim_id
   AND cd.source_id IS NULL;

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

-- Roastery portal part 2 (2026-10-05): accepted portal notes are written here by
-- catalogService.setRoasterDescriptorsInTx only. Retire, never delete: a retired
-- row keeps its history (is_active = false, retired_at) and the wheel view below
-- ignores it. source_response_id points at the roastery_portal_response version
-- the row was accepted from (null = legacy seed row); its FK is added in the
-- roastery portal block, after that table exists. Existing rows stay active.
ALTER TABLE roastery_coffee_descriptors ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE roastery_coffee_descriptors ADD COLUMN IF NOT EXISTS source_response_id UUID;
ALTER TABLE roastery_coffee_descriptors ADD COLUMN IF NOT EXISTS accepted_by_admin_id UUID REFERENCES user_profile(id);
ALTER TABLE roastery_coffee_descriptors ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE roastery_coffee_descriptors ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

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
-- Catalog Blueprint brief 5b — rename archetype_assignments -> coffee_archetype_assignment.
DO $$ BEGIN
  IF to_regclass('public.archetype_assignments') IS NOT NULL AND to_regclass('public.coffee_archetype_assignment') IS NULL THEN
    ALTER TABLE archetype_assignments RENAME TO coffee_archetype_assignment;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archetype_assignments_pkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_archetype_assignment_pkey') THEN
    ALTER TABLE coffee_archetype_assignment RENAME CONSTRAINT archetype_assignments_pkey TO coffee_archetype_assignment_pkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archetype_assignments_assigned_from_session_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_archetype_assignment_assigned_from_session_id_fkey') THEN
    ALTER TABLE coffee_archetype_assignment RENAME CONSTRAINT archetype_assignments_assigned_from_session_id_fkey TO coffee_archetype_assignment_assigned_from_session_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archetype_assignments_coffee_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_archetype_assignment_coffee_id_fkey') THEN
    ALTER TABLE coffee_archetype_assignment RENAME CONSTRAINT archetype_assignments_coffee_id_fkey TO coffee_archetype_assignment_coffee_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'archetype_assignments_one_current') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'coffee_archetype_assignment_one_current') THEN
    ALTER INDEX archetype_assignments_one_current RENAME TO coffee_archetype_assignment_one_current;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_archetype_assign_coffee') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_coffee_archetype_assign_coffee') THEN
    ALTER INDEX idx_archetype_assign_coffee RENAME TO idx_coffee_archetype_assign_coffee;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_archetype_assign_session') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_coffee_archetype_assign_session') THEN
    ALTER INDEX idx_archetype_assign_session RENAME TO idx_coffee_archetype_assign_session;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS coffee_archetype_assignment (
  id                       SERIAL PRIMARY KEY,
  coffee_id                INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
  archetype                archetype_enum NOT NULL,
  confidence               confidence_enum NOT NULL,
  assigned_from_session_id INTEGER REFERENCES cupping_sessions(id) ON DELETE SET NULL,
  superseded_at            TIMESTAMPTZ,
  notes                    TEXT,
  created_at               TIMESTAMPTZ DEFAULT now()
);

-- dial_archetype_config, dial_position_vocabulary and dial_archetype_positions
-- (dominant dimension/Bloom Dial flag per archetype; archetype+dimension label
-- vocabulary; coffee-to-Bloom-Dial-position mapping, with its is_guest column
-- and dap_guest_not_default constraint) were dropped by Catalog Blueprint
-- brief 5a — superseded by archetype.{has_bloom_dial,is_archetype,
-- dominant_dimension_id} (brief 1) and coffee_dial_slot/coffee_slot_assignment
-- (brief 1/2) respectively. See A1/A2 in
-- features/catalog_blueprint/CLAUDE_CODE_PROMPT_CATALOG_5_DROP_LEGACY.md and
-- migrations/catalog_blueprint_5a_2026-09-15.sql for the exact drop statements.

-- Directional dimensional hop graph between coffees
-- Catalog Blueprint brief 5b — rename dial_coffee_relationships -> coffee_hop.
DO $$ BEGIN
  IF to_regclass('public.dial_coffee_relationships') IS NOT NULL AND to_regclass('public.coffee_hop') IS NULL THEN
    ALTER TABLE dial_coffee_relationships RENAME TO coffee_hop;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dial_coffee_relationships_pkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_hop_pkey') THEN
    ALTER TABLE coffee_hop RENAME CONSTRAINT dial_coffee_relationships_pkey TO coffee_hop_pkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dial_coffee_relationships_dimension_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_hop_dimension_id_fkey') THEN
    ALTER TABLE coffee_hop RENAME CONSTRAINT dial_coffee_relationships_dimension_id_fkey TO coffee_hop_dimension_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dial_coffee_relationships_from_category_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_hop_from_category_id_fkey') THEN
    ALTER TABLE coffee_hop RENAME CONSTRAINT dial_coffee_relationships_from_category_id_fkey TO coffee_hop_from_category_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dial_coffee_relationships_from_coffee_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_hop_from_coffee_id_fkey') THEN
    ALTER TABLE coffee_hop RENAME CONSTRAINT dial_coffee_relationships_from_coffee_id_fkey TO coffee_hop_from_coffee_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dial_coffee_relationships_from_coffee_id_to_coffee_id_dimen_key') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_hop_from_coffee_id_to_coffee_id_dimen_key') THEN
    ALTER TABLE coffee_hop RENAME CONSTRAINT dial_coffee_relationships_from_coffee_id_to_coffee_id_dimen_key TO coffee_hop_from_coffee_id_to_coffee_id_dimen_key;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dial_coffee_relationships_to_category_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_hop_to_category_id_fkey') THEN
    ALTER TABLE coffee_hop RENAME CONSTRAINT dial_coffee_relationships_to_category_id_fkey TO coffee_hop_to_category_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dial_coffee_relationships_to_coffee_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_hop_to_coffee_id_fkey') THEN
    ALTER TABLE coffee_hop RENAME CONSTRAINT dial_coffee_relationships_to_coffee_id_fkey TO coffee_hop_to_coffee_id_fkey;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS coffee_hop (
  id               SERIAL PRIMARY KEY,
  from_coffee_id   INT REFERENCES coffees(id) ON DELETE CASCADE,
  to_coffee_id     INT REFERENCES coffees(id) ON DELETE CASCADE,
  dimension_id     INT REFERENCES coffee_dimensions(id) NOT NULL,
  direction        hop_direction_enum NOT NULL,
  delta            NUMERIC,
  is_recommended   BOOLEAN DEFAULT FALSE,
  confidence       confidence_enum DEFAULT 'medium',
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_coffee_id, to_coffee_id, dimension_id, direction)
);

-- Cross-cutting categories, orthogonal to archetype (e.g. 'experimental' is a category,
-- not a sixth peer flavor family — see BLOOM_DIAL_ALLOCATION_SPEC.md §6). Admin-extensible
-- — seeded with the 4 known today, more can be added later without a schema change.
-- is_hoppable: whether a coffee tagged with this category can be a hop endpoint. Only
-- 'experimental' is hoppable today — Decaf/Half-Caf/Flavored are format constraints, not
-- flavor destinations, so "try this next" doesn't apply to them. Same pattern as
-- archetype.is_archetype — a flag on the data, not a hardcoded string check.
CREATE TABLE IF NOT EXISTS coffee_category (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  is_hoppable BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO coffee_category (code, label, sort_order, is_hoppable) VALUES
  ('experimental', 'Experimental', 1, true),
  ('decaf',        'Decaf',        2, false),
  ('half_caf',     'Half-Caf',     3, false),
  ('flavored',     'Flavored',     4, false)
ON CONFLICT (code) DO NOTHING;

-- A coffee can carry more than one category (e.g. a seasonal decaf); a category obviously
-- applies to many coffees. Independent of archetype_assignments/dial_archetype_positions —
-- no FK relationship between them, a coffee can have a category with no archetype yet, or
-- vice versa (both are normal states — see the existing "Unplaced" section on Coffees).
CREATE TABLE IF NOT EXISTS coffee_category_assignment (
  id          SERIAL PRIMARY KEY,
  coffee_id   INT REFERENCES coffees(id) ON DELETE CASCADE,
  category_id INT REFERENCES coffee_category(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (coffee_id, category_id)
);

-- Mechanical category-tag backfill for coffees we already know by name — not a cupping
-- judgment. Their actual archetype (a real tasting decision) is a separate, un-scripted
-- to-do; these rows only tag the category, they don't touch archetype_assignments.
-- Matched by roaster_id (via a join to roaster) rather than the free-text
-- coffees.roaster column, which Catalog Blueprint brief 5a drops.
INSERT INTO coffee_category_assignment (coffee_id, category_id)
SELECT (SELECT MIN(c.id) FROM coffees c JOIN roaster r ON r.id = c.roaster_id WHERE c.name = 'Kopi Safari' AND r.name = 'Temecula Coffee Roasters'),
       (SELECT id FROM coffee_category WHERE code = 'experimental')
WHERE (SELECT MIN(c.id) FROM coffees c JOIN roaster r ON r.id = c.roaster_id WHERE c.name = 'Kopi Safari' AND r.name = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (coffee_id, category_id) DO NOTHING;

INSERT INTO coffee_category_assignment (coffee_id, category_id)
SELECT (SELECT MIN(c.id) FROM coffees c JOIN roaster r ON r.id = c.roaster_id WHERE c.name = 'Decaf' AND r.name = 'Path Coffee Roasters'),
       (SELECT id FROM coffee_category WHERE code = 'decaf')
WHERE (SELECT MIN(c.id) FROM coffees c JOIN roaster r ON r.id = c.roaster_id WHERE c.name = 'Decaf' AND r.name = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (coffee_id, category_id) DO NOTHING;

INSERT INTO coffee_category_assignment (coffee_id, category_id)
SELECT (SELECT MIN(c.id) FROM coffees c JOIN roaster r ON r.id = c.roaster_id WHERE c.name = 'Sleepwalker Half-Caf' AND r.name = 'Path Coffee Roasters'),
       (SELECT id FROM coffee_category WHERE code = 'half_caf')
WHERE (SELECT MIN(c.id) FROM coffees c JOIN roaster r ON r.id = c.roaster_id WHERE c.name = 'Sleepwalker Half-Caf' AND r.name = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (coffee_id, category_id) DO NOTHING;

INSERT INTO coffee_category_assignment (coffee_id, category_id)
SELECT (SELECT MIN(c.id) FROM coffees c JOIN roaster r ON r.id = c.roaster_id WHERE c.name = v.coffee_name AND r.name = 'Path Coffee Roasters'),
       (SELECT id FROM coffee_category WHERE code = 'flavored')
FROM (VALUES ('Vanilla'), ('Hazelnut'), ('Chocolate')) AS v(coffee_name)
WHERE (SELECT MIN(c.id) FROM coffees c JOIN roaster r ON r.id = c.roaster_id WHERE c.name = v.coffee_name AND r.name = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (coffee_id, category_id) DO NOTHING;

-- Category-endpoint hops: from_category_id/to_category_id let either side of a
-- dial_coffee_relationships row be a coffee_category instead of a specific coffee.
-- Exactly one of {coffee_id, category_id} must be set per side. Category-hop creation
-- stays SQL-only for now (no admin UI/API) — see CLAUDE_CODE_PROMPT_BLOOM_DIAL_CATEGORIES_DB.md.
-- The dial_coffee_relationships UNIQUE constraint won't meaningfully dedupe
-- category-endpoint hops (NULL <> NULL in Postgres uniqueness — same caveat already
-- true of coffee_alias's NULL-archetype rows); acceptable for now.
ALTER TABLE coffee_hop ADD COLUMN IF NOT EXISTS from_category_id INT REFERENCES coffee_category(id);
ALTER TABLE coffee_hop ADD COLUMN IF NOT EXISTS to_category_id   INT REFERENCES coffee_category(id);

DO $$ BEGIN
  ALTER TABLE coffee_hop ADD CONSTRAINT chk_from_endpoint
    CHECK ((from_coffee_id IS NOT NULL) <> (from_category_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE coffee_hop ADD CONSTRAINT chk_to_endpoint
    CHECK ((to_coffee_id IS NOT NULL) <> (to_category_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- coffee_alias and dial_slot_alias (platform slot-name-to-coffee mapping and
-- its 24-row seed) were dropped by Catalog Blueprint brief 5a — superseded by
-- coffee_dial_slot.name (brief 1) and coffee_slot_assignment (brief 2).

-- A signed-in user's remembered dial position per archetype (The Bloom Part 3,
-- Phase D). Deliberately its own table, not a repurposing of user_archetype_tuning/
-- archetype_tunable_variable — those are reserved for a computed, feedback-derived
-- confidence/offset signal (a different kind of data, owned by a different future
-- feature), even though the (user, archetype, dimension) key shape coincidentally
-- matches. Uses archetype_enum directly to match the rest of the dial_* family.
-- Renamed from user_bloom_dial_position (Liam Dial Event Log Phase A0) — see the
-- table comment below for the current-setting/history split this name encodes.
-- dial_sort_order dropped (Catalog Blueprint brief 5a) — slot_id (added below)
-- is the only position reference now; PK stays (user_id, archetype).
CREATE TABLE IF NOT EXISTS user_bloom_dial_current_position (
  user_id          UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  archetype        archetype_enum NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, archetype)
);

COMMENT ON TABLE user_bloom_dial_current_position IS
  'Current dial setting per user+archetype, overwritten in place on every dial turn (silent, no history). Movement history — explicit saves and cart-anchored positions only — lives in Firestore users/{uid}/dial_events.';

-- Retail price for a Bloom Dial slot, per weight. Not on roaster_blend (would
-- let two roasters fulfilling the same slot show two different prices for the
-- same weight, breaking the "customer buys a slot, not a roaster's coffee"
-- abstraction) — see The Bloom Part 1 Phase 0. Named to group with the
-- existing dial_* table family. Defaults applied at the query level, not
-- here: $32.00/12oz, $185.00/5lb (80oz) when no row exists yet for that
-- (slot_id, weight_oz). slot_id (the only key since Catalog Blueprint brief
-- 5a dropped the composite archetype/dial_sort_order columns) is added below,
-- after coffee_dial_slot exists — this CREATE runs too early in the file to
-- reference it directly.
-- Catalog Blueprint brief 5b — rename dial_slot_price -> coffee_slot_price.
DO $$ BEGIN
  IF to_regclass('public.dial_slot_price') IS NOT NULL AND to_regclass('public.coffee_slot_price') IS NULL THEN
    ALTER TABLE dial_slot_price RENAME TO coffee_slot_price;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dial_slot_price_pkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_slot_price_pkey') THEN
    ALTER TABLE coffee_slot_price RENAME CONSTRAINT dial_slot_price_pkey TO coffee_slot_price_pkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dial_slot_price_slot_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_slot_price_slot_id_fkey') THEN
    ALTER TABLE coffee_slot_price RENAME CONSTRAINT dial_slot_price_slot_id_fkey TO coffee_slot_price_slot_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'dial_slot_price_slot_weight_key') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'coffee_slot_price_slot_weight_key') THEN
    ALTER INDEX dial_slot_price_slot_weight_key RENAME TO coffee_slot_price_slot_weight_key;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS coffee_slot_price (
  id                  SERIAL PRIMARY KEY,
  weight_oz           NUMERIC NOT NULL,
  retail_price_cents  INTEGER NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Retail price for a coffee with no Bloom Dial position — the coffee-keyed
-- counterpart to dial_slot_price above, for Decaf/Half-Caf/Flavored/Experimental
-- category coffees (Bloom Dial Base Data Part 3, Phase 6: "Other Categories" /
-- "The Unexpected"). These coffees are excluded from every flavor dial (see
-- blendResolver.ts's category exclusion) so they have no (archetype, dial_sort_order)
-- to key a price off of — coffee_id is the only stable identity they have. Same
-- "defaults applied at the query level, not here" pattern: $32.00/12oz, $185.00/5lb
-- when no row exists yet for that (coffee_id, weight_oz).
CREATE TABLE IF NOT EXISTS coffee_retail_price (
  id                  SERIAL PRIMARY KEY,
  coffee_id           INT NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
  weight_oz           NUMERIC NOT NULL,
  retail_price_cents  INTEGER NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (coffee_id, weight_oz)
);

-- ─────────────────────────────────────────────
-- DIAL POSITION SIGNAL INFRASTRUCTURE (Phase 5 — dormant by default)
-- Plumbing for future multi-source dial-position signals (cupping, flavor-wheel,
-- feedback). Only 'cupping' is populated (via recordCuppingSignal, called from
-- POST /api/admin/scores) — nothing here auto-writes to coffee_slot_assignment.
-- See BLOOM_DIAL_ALLOCATION_SPEC.md §3 Stage 2. suggested_vocabulary_id (this
-- table's only reference to the now-dropped dial_position_vocabulary) was
-- re-keyed to suggested_slot_id by Catalog Blueprint brief 5a — added once
-- coffee_dial_slot exists later in this file, since this CREATE runs too
-- early to reference it directly; see the backfill+drop block there.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dial_position_signal (
  id                     SERIAL PRIMARY KEY,
  coffee_id              INT REFERENCES coffees(id) ON DELETE CASCADE,
  archetype              archetype_enum NOT NULL,
  dimension_id           INT REFERENCES coffee_dimensions(id) NOT NULL,
  source                 TEXT NOT NULL CHECK (source IN ('cupping','roastery_wheel','client_wheel','sms_feedback','onsite_feedback')),
  direction              TEXT CHECK (direction IN ('more','less')),
  raw_value              NUMERIC,
  sample_size            INT NOT NULL DEFAULT 1,
  confidence             confidence_enum DEFAULT 'medium',
  computed_at            TIMESTAMPTZ DEFAULT now(),
  superseded_at          TIMESTAMPTZ,
  notes                  TEXT
);

-- Empty on purpose — do not seed rows. Table shape only; content requires
-- validating a descriptor's real correlation to a dimension, which needs
-- cupping data volume that doesn't exist yet. See BLOOM_DIAL_ALLOCATION_SPEC.md §3 Stage 2.
CREATE TABLE IF NOT EXISTS cupping_note_dimension_weight (
  id              SERIAL PRIMARY KEY,
  cupping_note_id UUID REFERENCES cupping_note(id) NOT NULL,
  dimension_id    INT REFERENCES coffee_dimensions(id) NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('more','less')),
  weight          NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (cupping_note_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS dial_source_weight (
  source             TEXT PRIMARY KEY CHECK (source IN ('cupping','roastery_wheel','client_wheel','sms_feedback','onsite_feedback')),
  reliability_weight NUMERIC NOT NULL
);
-- roastery_wheel/client_wheel start at 0 deliberately — cupping_note_dimension_weight
-- has no validated rows yet, so anything computed from it shouldn't count until
-- someone explicitly raises the weight after checking a mapping against real cupping data.
INSERT INTO dial_source_weight (source, reliability_weight) VALUES
  ('cupping', 3), ('sms_feedback', 1), ('onsite_feedback', 1),
  ('roastery_wheel', 0), ('client_wheel', 0)
ON CONFLICT (source) DO NOTHING;

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
--
-- Guarded with WHERE NOT EXISTS rather than ON CONFLICT (name) DO NOTHING:
-- Catalog Blueprint brief 5a made archetype.code NOT NULL, and Postgres
-- checks NOT NULL on a candidate row *before* it ever consults the unique
-- index for an ON CONFLICT match — so on every boot after the first,
-- ON CONFLICT DO NOTHING here would still construct a (name, description)
-- row with code implicitly NULL and fail 23502, even though the row was
-- always going to be skipped as a duplicate (caught live — see
-- WHAT_WE_BUILT.md #182's closing report). WHERE NOT EXISTS never
-- constructs a row for a name that's already present, so the NOT NULL
-- check never fires for it. Can't add code directly to this INSERT
-- instead: the column doesn't exist yet at this point in the file on a
-- fresh database (added by ALTER TABLE further down, then backfilled).
-- Rename 'Balanced & Sweet' → 'Balanced' in existing DBs (2026-09-19, idempotent).
-- Must run BEFORE the seed below: with code NOT NULL, a WHERE NOT EXISTS miss on the
-- old name would try to insert a code-less row and fail 23502 at boot.
UPDATE coffee_archetype SET name = 'Balanced', updated_at = NOW() WHERE name = 'Balanced & Sweet';
-- Legacy display-name data (pre-launch subscribers claimed their match by name).
UPDATE newsletter_subscriber SET archetype = 'Balanced'
 WHERE archetype IN ('Balanced & Sweet', 'Balanced and Sweet');

INSERT INTO coffee_archetype (name, description)
SELECT v.name, v.description FROM (VALUES
  ('Chocolate & Nutty', 'A rich, bold, and comforting profile. You know exactly what you like and you like it satisfying.'),
  ('Balanced',  'A smooth, round, and approachable profile. You want coffee that''s easy, pleasant, and never surprising.'),
  ('Fruity',            'A vibrant, curious, and layered profile. You''re here for the experience, not just the caffeine.'),
  ('Earthy',            'A deep, complex, and grounded profile. You''re drawn to coffees with weight, structure, and earthy depth.'),
  ('Floral',            'A delicate, aromatic, and tea-like profile. You''re drawn to brightness and floral complexity over body and bitterness.'),
  ('Experimental',      'A boundary-pushing, discovery-first profile. You seek the unexpected — unusual processing, exotic origins, unconventional flavors.')
) AS v(name, description)
WHERE NOT EXISTS (SELECT 1 FROM coffee_archetype a WHERE a.name = v.name);

-- Rename 'Fruity & Complex' → 'Fruity' in existing DBs (idempotent)
UPDATE coffee_archetype SET name = 'Fruity', updated_at = NOW() WHERE name = 'Fruity & Complex';

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

-- Seed coffee_dimensions.platform_name (idempotent — only fills unset rows, never
-- overwrites a value an admin may set directly later). Sweetness and Texture stay
-- null on purpose (already plain English) — falls back to the raw name for those.
-- Free-text dimensions (Fragrance, Aroma, Flavor, Finish Character, Mouthfeel)
-- aren't used for dial/bar axes, left unseeded. Treat every value below as
-- adjustable first-draft copy, not locked in (The Bloom Part 3, Phase B).
UPDATE coffee_dimensions SET platform_name = 'Brightness' WHERE name = 'Acidity'        AND platform_name IS NULL;
UPDATE coffee_dimensions SET platform_name = 'Boldness'    WHERE name = 'Bitterness'     AND platform_name IS NULL;
UPDATE coffee_dimensions SET platform_name = 'Intensity'   WHERE name = 'Body'           AND platform_name IS NULL;
UPDATE coffee_dimensions SET platform_name = 'Complexity'  WHERE name = 'Savory / Depth' AND platform_name IS NULL;
UPDATE coffee_dimensions SET platform_name = 'Finish'      WHERE name = 'Finish Length'  AND platform_name IS NULL;

-- dial_archetype_config and dial_position_vocabulary's own seed INSERTs were
-- removed by Catalog Blueprint brief 5a along with the tables — see the
-- archetype dial-config seed (above the coffee_archetype_code_key index, further
-- down this file) and coffee_dial_slot's static 24-row seed for their
-- replacements.

-- The boot-time Kopi Safari dial_archetype_positions seed that used to live
-- here was removed by Catalog Blueprint brief 2 (2026-09-14, Part D) — it
-- wrote a legacy table by free-text roaster/name match on every boot, and
-- catalog data now enters through catalogImport only (N7). The row it once
-- wrote is untouched (dormant-data discipline, same as the retired seed
-- files in db/seeds/_retired/) — this just stops re-asserting it forever.

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

    SELECT id INTO v_choc_id  FROM coffee_archetype WHERE name = 'Chocolate & Nutty';
    SELECT id INTO v_bal_id   FROM coffee_archetype WHERE name = 'Balanced';
    SELECT id INTO v_fruit_id FROM coffee_archetype WHERE name = 'Fruity';

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
    SELECT id INTO v_choc_id  FROM coffee_archetype WHERE name = 'Chocolate & Nutty';
    SELECT id INTO v_bal_id   FROM coffee_archetype WHERE name = 'Balanced';
    SELECT id INTO v_fruit_id FROM coffee_archetype WHERE name = 'Fruity';

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
      (1, 'It''s a reliable habit. I just like having it.',                                            'Balanced',  1),
      (1, 'It''s something I''m still discovering. I''m curious about it.',                           'Fruity',            1),
      -- Q2 (2 pts each)
      (2, 'Something rich and comforting — dark chocolate, roasted nuts, a warm brownie.',            'Chocolate & Nutty', 2),
      (2, 'Something soft and sweet — a ripe peach, a vanilla biscuit, caramel.',                    'Balanced',  2),
      (2, 'Something fresh and lively — a green apple, fresh berries, citrus.',                      'Fruity',            2),
      -- Q3 (1 pt each; option D → Chocolate & Nutty per scoring spec)
      (3, 'It feels complete. I''d drink it as is, or add milk to make it even richer.',             'Chocolate & Nutty', 1),
      (3, 'It''s fine, easy to drink. I might add something to smooth it out.',                      'Balanced',  1),
      (3, 'Interesting… what flavors am I getting here?',                                              'Fruity',            1),
      (3, 'I''m not sure. I don''t usually drink it black.',                                         'Chocolate & Nutty', 1),
      -- Q4 (2 pts each)
      (4, 'Feels too thin or watery.',                                                                'Chocolate & Nutty', 2),
      (4, 'Feels too heavy or strong.',                                                               'Balanced',  2),
      (4, 'Every sip tastes exactly the same.',                                                      'Fruity',            2),
      -- Q5 (3 pts each — highest weight, bitterness tolerance is the strongest signal)
      (5, 'I don''t mind. Actually I kind of like it. It tastes serious.',                           'Chocolate & Nutty', 3),
      (5, 'I''ll reach for milk or sugar. I don''t want that.',                                      'Balanced',  3),
      (5, 'It feels flat or burnt to me. I''d rather have something bright or light.',               'Fruity',            3)
    ) AS data(q_number, answer_text, archetype_name, score)
    JOIN quiz_question q ON q.quiz_id = v_quiz_id AND q.q_number = data.q_number::int
    JOIN quiz_answer  a ON a.question_id = q.id AND a.answer_text = data.answer_text
    JOIN coffee_archetype ar ON ar.name = data.archetype_name
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

  SELECT id INTO v_choc_id  FROM coffee_archetype WHERE name = 'Chocolate & Nutty';
  SELECT id INTO v_bal_id   FROM coffee_archetype WHERE name = 'Balanced';
  SELECT id INTO v_fruit_id FROM coffee_archetype WHERE name = 'Fruity';

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
-- Q3-D splits: 0.5 to Chocolate & Nutty + 0.5 to Balanced
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
    (1, 'It''s a reliable habit. I just like having it.',                               'Balanced',  1.0),
    (1, 'It''s something I''m still discovering. I''m curious about it.',               'Fruity',            1.0),
    -- Q2 (weight 2)
    (2, 'It was strong and satisfying — I felt it.',                                    'Chocolate & Nutty', 2.0),
    (2, 'It was smooth and easy the whole way through — nothing got in the way.',       'Balanced',  2.0),
    (2, 'It felt alive — bright and changing. Every sip was a little different.',       'Fruity',            2.0),
    -- Q3 (weight 1; D splits 0.5 CN + 0.5 BS — two rows for the same answer)
    (3, 'It feels complete. I''d drink it as is, or add milk to make it even richer.',  'Chocolate & Nutty', 1.0),
    (3, 'It''s fine, easy to drink. I might add something to smooth it out.',           'Balanced',  1.0),
    (3, 'Interesting… what flavors am I getting here?',                                  'Fruity',            1.0),
    (3, 'I''m not sure. I don''t usually drink it black.',                              'Chocolate & Nutty', 0.5),
    (3, 'I''m not sure. I don''t usually drink it black.',                              'Balanced',  0.5),
    -- Q4 (weight 2)
    (4, 'It has no bitterness or intensity.',                                            'Chocolate & Nutty', 2.0),
    (4, 'It''s too bitter or too intense.',                                              'Balanced',  2.0),
    (4, 'Every sip tastes exactly the same.',                                            'Fruity',            2.0),
    -- Q5 (weight 3)
    (5, 'I don''t mind. Actually I kind of like it. It tastes serious.',                'Chocolate & Nutty', 3.0),
    (5, 'I''d rather have something gentler and smoother.',                              'Balanced',  3.0),
    (5, 'It feels burnt to me. I''d rather have something fresher or more alive.',      'Fruity',            3.0)
  ) AS data(q_number, answer_text, archetype_name, score)
  JOIN quiz_question q ON q.quiz_id = v_quiz_id AND q.q_number = data.q_number::int
  JOIN quiz_answer    a  ON a.question_id = q.id  AND a.answer_text = data.answer_text
  JOIN coffee_archetype ar ON ar.name = data.archetype_name
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
-- idx_feedback_user (user_feedback_event) and idx_chat_message_user
-- (chat_message) removed by Customer Blueprint C3, Part C along with their
-- tables (both dead, confirmed empty in prod, dropped further down).
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
CREATE INDEX IF NOT EXISTS idx_coffee_archetype_assign_coffee      ON coffee_archetype_assignment(coffee_id);
CREATE INDEX IF NOT EXISTS idx_coffee_archetype_assign_session     ON coffee_archetype_assignment(assigned_from_session_id);

-- Sommelier SMS feedback indexes
CREATE INDEX IF NOT EXISTS idx_sommelier_sms_user      ON sommelier_sms_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_sommelier_sms_order     ON sommelier_sms_feedback(order_id);
CREATE INDEX IF NOT EXISTS idx_sommelier_sms_status    ON sommelier_sms_feedback(status);
CREATE INDEX IF NOT EXISTS idx_sommelier_sms_scheduled ON sommelier_sms_feedback(scheduled_for) WHERE status = 'scheduled';

-- Quiz scoring indexes
CREATE INDEX IF NOT EXISTS idx_answer_arch_score_answer     ON quiz_answer_archetype_score(answer_id);
CREATE INDEX IF NOT EXISTS idx_answer_arch_score_archetype  ON quiz_answer_archetype_score(archetype_id);

-- ─────────────────────────────────────────────
-- CATALOG BLUEPRINT · brief 1 (2026-09-13)
-- See backend/src/features/catalog_blueprint/CLAUDE_CODE_PROMPT_CATALOG_1_SCHEMA_VIEWS_INTEGRITY.md
-- Additive only — nothing existing is dropped, renamed, or re-pointed.
-- ─────────────────────────────────────────────

-- B1. One archetype identity (N2) — `archetype` gains `code`, the one
-- identity every new catalog FK uses; the UUID `id` stays only for the
-- existing quiz FKs. `code` stays nullable (not NOT NULL yet): a fresh
-- database seeds `archetype` by name first, and the backfill below runs
-- later in this same boot to fill it — see Part D's boot check for a NULL
-- warning instead.
ALTER TABLE coffee_archetype ADD COLUMN IF NOT EXISTS code archetype_enum;
ALTER TABLE coffee_archetype ADD COLUMN IF NOT EXISTS sort_order INT;
ALTER TABLE coffee_archetype ADD COLUMN IF NOT EXISTS has_bloom_dial BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE coffee_archetype ADD COLUMN IF NOT EXISTS is_archetype BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE coffee_archetype ADD COLUMN IF NOT EXISTS dominant_dimension_id INT REFERENCES coffee_dimensions(id);
-- wheel_category values from cupping_note that count as "on family" for D6; brief 2 reads it.
ALTER TABLE coffee_archetype ADD COLUMN IF NOT EXISTS descriptor_families TEXT[] NOT NULL DEFAULT '{}';
-- Catalog Blueprint brief 4 — guards the one-time seed below so a real admin
-- edit (catalogService.setArchetypeDescriptorFamilies) is never silently
-- reset back to the seed default on the next boot. Brief 1/2/3's own boots
-- all ran the unguarded `WHERE descriptor_families = '{}'` version — a
-- coffee could deliberately clear 'experimental's family back to '{}'
-- (it's the seed default) and the next boot would re-seed it as if nothing
-- had happened; this column makes that a one-time seed instead.
ALTER TABLE coffee_archetype ADD COLUMN IF NOT EXISTS descriptor_families_seeded_at TIMESTAMPTZ;

-- One-time backfill of code from name (the only place the name<->code map is ever written down again):
UPDATE coffee_archetype SET code = CASE name
  WHEN 'Chocolate & Nutty' THEN 'chocolate_nutty' WHEN 'Balanced' THEN 'balanced_sweet' WHEN 'Balanced & Sweet' THEN 'balanced_sweet'
  WHEN 'Fruity' THEN 'fruity' WHEN 'Earthy' THEN 'earthy' WHEN 'Floral' THEN 'floral'
  WHEN 'Experimental' THEN 'experimental' END::archetype_enum
WHERE code IS NULL;

-- Dial config seed (Catalog Blueprint brief 5a) — archetype is the sole owner
-- of has_bloom_dial/is_archetype/dominant_dimension_id now that
-- dial_archetype_config is dropped; this replaces the old "copy dial config
-- across" UPDATE...FROM. Static values match dial_archetype_config's own
-- seed (verified against prod before the drop). Applied only once: the WHERE
-- guard uses is_archetype's CURRENT (pre-update) value, which every row
-- starts at its column default of true — after the first boot,
-- 'experimental' is false and every other row has dominant_dimension_id set,
-- so the guard never matches again.
UPDATE coffee_archetype SET
  has_bloom_dial = true,
  is_archetype = (code <> 'experimental'),
  dominant_dimension_id = CASE code
    WHEN 'chocolate_nutty' THEN 7 WHEN 'balanced_sweet' THEN 5 WHEN 'fruity' THEN 5
    WHEN 'floral' THEN 9 WHEN 'earthy' THEN 6 WHEN 'experimental' THEN NULL END
WHERE dominant_dimension_id IS NULL AND is_archetype;

UPDATE coffee_archetype SET sort_order = CASE code
  WHEN 'floral' THEN 1 WHEN 'fruity' THEN 2 WHEN 'balanced_sweet' THEN 3
  WHEN 'chocolate_nutty' THEN 4 WHEN 'earthy' THEN 5 WHEN 'experimental' THEN 6 END
WHERE sort_order IS NULL;   -- CANONICAL_ARCHETYPE_ORDER from coffees.ts L617

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffee_archetype_code_key ON coffee_archetype(code);
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- descriptor_families seed — real DISTINCT wheel_category strings from cupping_note
-- (verified against backend/src/db/seeds/cupping_notes_sca_wheel.sql / this file's own
-- SCA wheel seed, ~L2257: Floral, Fruity, Sour / Fermented, Green / Vegetative, Other,
-- Roasted, Spices, Nutty / Cocoa, Sweet — note the spaces around "/", unlike a
-- naive guess). 'Other' deliberately excluded from every archetype's family (it
-- covers Papery/Musty/Chemical off-notes, not a flavor identity).
UPDATE coffee_archetype SET descriptor_families = CASE code
  WHEN 'chocolate_nutty' THEN ARRAY['Nutty / Cocoa','Sweet']
  WHEN 'balanced_sweet'  THEN ARRAY['Sweet','Nutty / Cocoa','Fruity']
  WHEN 'fruity'          THEN ARRAY['Fruity','Sour / Fermented']
  WHEN 'floral'          THEN ARRAY['Floral','Fruity']
  WHEN 'earthy'          THEN ARRAY['Green / Vegetative','Spices','Roasted']
  WHEN 'experimental'    THEN ARRAY[]::TEXT[]
  END,
  descriptor_families_seeded_at = now()
WHERE descriptor_families_seeded_at IS NULL;

-- B2. coffee_dial_slot — the promise (N4/D6): the slot's own name, position
-- label and (later, admin-set) spec band + descriptor families, independent
-- of which coffee currently fulfils it. Replaced dial_slot_alias +
-- dial_position_vocabulary as the read path (brief 3); both tables were
-- dropped in brief 5a, at which point this table's backfill (below) switched
-- from joining them to a static seed of their own last known values. The
-- coffee_archetype(code) FK needs coffee_archetype_code_key above to exist
-- first — this table is created after it in this same file for that reason.
CREATE TABLE IF NOT EXISTS coffee_dial_slot (
  id                       SERIAL PRIMARY KEY,
  archetype                archetype_enum NOT NULL REFERENCES coffee_archetype(code),
  sort_order               INT NOT NULL CHECK (sort_order BETWEEN 1 AND 4),
  name                     TEXT NOT NULL,          -- customer-facing, was dial_slot_alias.platform_name
  position_label           TEXT NOT NULL,          -- was dial_position_vocabulary.label
  position_description     TEXT,
  dimension_id             INT REFERENCES coffee_dimensions(id),
  is_landing_default       BOOLEAN NOT NULL DEFAULT false,
  spec_band_lo             NUMERIC,                -- D6: acceptable merged-cupping range on dimension_id
  spec_band_hi             NUMERIC,
  spec_descriptor_families TEXT[] NOT NULL DEFAULT '{}',   -- empty = inherit archetype.descriptor_families
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now(),
  UNIQUE (archetype, sort_order),
  UNIQUE (name),
  CHECK (spec_band_lo IS NULL OR spec_band_hi IS NULL OR spec_band_lo <= spec_band_hi)
);
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffee_dial_slot_one_landing_default
    ON coffee_dial_slot(archetype) WHERE is_landing_default = true;
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- Static seed of the 24 slots (5 archetypes x 4 + experimental x 4), values
-- frozen from prod's actual coffee_dial_slot rows just before Catalog
-- Blueprint brief 5a dropped dial_slot_alias/dial_position_vocabulary —
-- deliberately NOT the two tables' own original seed values, since 4 of the
-- chocolate_nutty slots had since been renamed live via the Slots & pricing
-- admin page (brief 4) and a fresh/dev database must bootstrap the real
-- current names, not stale defaults. ON CONFLICT DO NOTHING makes this a
-- no-op against prod's already-populated table; it only matters for a fresh
-- database. Spec columns are never seeded (Dana sets them from the admin
-- page). is_landing_default matches each archetype's actual current default.
INSERT INTO coffee_dial_slot (archetype, sort_order, name, position_label, position_description, dimension_id, is_landing_default) VALUES
  ('chocolate_nutty', 1, 'Quieta Non Movere',          'Lighter', '',   7, false),
  ('chocolate_nutty', 2, 'Coado',                       'Classic', NULL, 7, true),
  ('chocolate_nutty', 3, 'There''s No Place Like Home', 'Richer',  NULL, 7, false),
  ('chocolate_nutty', 4, 'Working Late Hours',          'Full',    NULL, 7, false),
  ('balanced_sweet',  1, 'Soft & Smooth',       'Smooth',  NULL, 5, false),
  ('balanced_sweet',  2, 'Classic Balanced',    'Balanced', NULL, 5, true),
  ('balanced_sweet',  3, 'Bright & Balanced',   'Bright',  NULL, 5, false),
  ('balanced_sweet',  4, 'Lively & Vivid',      'Lively',  NULL, 5, false),
  ('fruity',          1, 'Clean Fruit',         'Mellow',  NULL, 5, false),
  ('fruity',          2, 'Bright & Tart',       'Balanced', NULL, 5, true),
  ('fruity',          3, 'Vivid Fruit',         'Bright',  NULL, 5, false),
  ('fruity',          4, 'Jammy & Aromatic',    'Vibrant', NULL, 5, false),
  ('earthy',          1, 'Gentle Earth',        'Gentle',  NULL, 6, false),
  ('earthy',          2, 'Grounded & Earthy',   'Earthy',  NULL, 6, true),
  ('earthy',          3, 'Dark Grounded',       'Bold',    NULL, 6, false),
  ('earthy',          4, 'Intense & Dark',      'Intense', NULL, 6, false),
  ('floral',          1, 'Light Floral Edge',       'Delicate', NULL, 9, false),
  ('floral',          2, 'Perfumed & Expressive',   'Balanced', NULL, 9, true),
  ('floral',          3, 'Complex Bloom',           'Complex',  NULL, 9, false),
  ('floral',          4, 'Layered Bouquet',         'Layered',  NULL, 9, false),
  ('experimental',    1, 'Curious Start',   'Curious',     NULL, 9, false),
  ('experimental',    2, 'The Unexpected',  'Adventurous', NULL, 9, true),
  ('experimental',    3, 'Daring Edge',     'Daring',      NULL, 9, false),
  ('experimental',    4, 'The Wild Card',   'Untamed',     NULL, 9, false)
ON CONFLICT (archetype, sort_order) DO NOTHING;

-- Catalog Blueprint brief 5a, A1 — re-key dial_position_signal off the slot
-- instead of the about-to-be-dropped dial_position_vocabulary, before it's
-- dropped below. Must run here, after coffee_dial_slot exists and is seeded,
-- and before the DROP TABLE dial_position_vocabulary further down. Guarded on
-- dial_position_vocabulary still existing — on a fresh database it never
-- does (its CREATE TABLE is gone as of this brief), there's nothing to
-- backfill from, and the JOIN below would otherwise fail to even parse.
ALTER TABLE dial_position_signal ADD COLUMN IF NOT EXISTS suggested_slot_id INT REFERENCES coffee_dial_slot(id);
DO $$ BEGIN
  IF to_regclass('public.dial_position_vocabulary') IS NOT NULL THEN
    UPDATE dial_position_signal s SET suggested_slot_id = cds.id
    FROM dial_position_vocabulary v JOIN coffee_dial_slot cds ON cds.archetype = v.archetype AND cds.sort_order = v.sort_order
    WHERE s.suggested_slot_id IS NULL AND s.suggested_vocabulary_id = v.id;
  END IF;
END $$;
-- CASCADE: the old v_dial_position_consensus (dropped/redefined as
-- v_coffee_dial_position_consensus further down, in the VIEWS section) still
-- depends on this column at this point in the script — without CASCADE this
-- errors 2BP01 and rolls back the whole boot's schema apply. Safe: the view
-- is unconditionally recreated later in this same file regardless.
ALTER TABLE dial_position_signal DROP COLUMN IF EXISTS suggested_vocabulary_id CASCADE;

-- Catalog Blueprint brief 5a, A2 — drop the five legacy placement tables and
-- their two dependent views (v_dial_position_consensus, rebuilt below rather
-- than dropped, is the one dependent that survives). pg_depend was checked
-- against prod before writing this (Task 0 of the brief): the only real
-- dependents found were v_dial_positions (on dial_archetype_positions,
-- dial_position_vocabulary and dial_archetype_config) and the two FKs already
-- neutralised above (dial_archetype_positions.vocabulary_id, dropped with the
-- table itself; dial_position_signal.suggested_vocabulary_id, dropped just
-- above). v_dial_navigation and v_dial_position_consensus, despite being
-- named in the same breath in the brief's own narrative, turned out to have
-- no actual pg_depend dependency on any of these five tables — v_dial_navigation
-- is dropped anyway (zero readers, brief 3 Task 0); v_dial_position_consensus
-- is kept and rebuilt (below) since GET /dial/consensus/:coffeeId reads it.
DROP VIEW IF EXISTS v_dial_positions;
DROP VIEW IF EXISTS v_dial_navigation;
DROP TABLE IF EXISTS dial_archetype_positions CASCADE;
DROP TABLE IF EXISTS coffee_alias CASCADE;
DROP TABLE IF EXISTS dial_slot_alias CASCADE;
DROP TABLE IF EXISTS dial_position_vocabulary CASCADE;
DROP TABLE IF EXISTS dial_archetype_config CASCADE;

-- B3. coffee_slot_assignment — placement and fulfilment as one fact (D1/D5).
-- No backfill (N3) — the catalog is empty (both roasteries deactivated), so
-- this starts empty on purpose. Brief 2's service is its only writer.
DO $$ BEGIN
  CREATE TYPE coffee_slot_role_enum AS ENUM ('home', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS coffee_slot_assignment (
  id                  SERIAL PRIMARY KEY,
  slot_id             INT NOT NULL REFERENCES coffee_dial_slot(id),
  coffee_id           INT NOT NULL REFERENCES coffees(id),
  role                coffee_slot_role_enum NOT NULL,
  priority            INT NOT NULL DEFAULT 1 CHECK (priority >= 1),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  deactivated_at      TIMESTAMPTZ,
  deactivation_reason TEXT CHECK (deactivation_reason IS NULL OR deactivation_reason IN ('roaster','manual','moved')),
  placement_note      TEXT,        -- required by brief 2 when the D6 check warns
  certified_at        TIMESTAMPTZ,
  certified_by        TEXT,
  certification_note  TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (slot_id, coffee_id)
);
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffee_slot_assignment_one_active_home
    ON coffee_slot_assignment(coffee_id) WHERE role = 'home' AND is_active = true;
EXCEPTION WHEN unique_violation THEN NULL; END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffee_slot_assignment_one_active_per_priority
    ON coffee_slot_assignment(slot_id, priority) WHERE is_active = true;
EXCEPTION WHEN unique_violation THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS coffee_slot_assignment_slot_active_idx ON coffee_slot_assignment(slot_id) WHERE is_active = true;

-- B4. Tighten what stays. Every partial unique index below is wrapped in the
-- same self-healing DO/EXCEPTION pattern as coffees_active_natural_key
-- on purpose: if inactive history somehow violates one, boot must not roll
-- back — Part D's integrity check (#3) reports which index is missing instead.

-- archetype_assignments: one current row per coffee (Slot Truth Map F4)
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffee_archetype_assignment_one_current
    ON coffee_archetype_assignment(coffee_id) WHERE superseded_at IS NULL;
EXCEPTION WHEN unique_violation THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE assignment_source_enum AS ENUM ('cupping', 'manual', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE coffee_archetype_assignment ADD COLUMN IF NOT EXISTS source assignment_source_enum;
UPDATE coffee_archetype_assignment SET source = CASE WHEN assigned_from_session_id IS NOT NULL THEN 'cupping' ELSE 'manual' END::assignment_source_enum WHERE source IS NULL;

-- roaster_blend: one active SKU per (coffee, weight)
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS coffee_sku_one_active_per_weight
    ON coffee_sku(coffee_id, weight_oz) WHERE is_active = true AND coffee_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- dial_slot_price: re-key onto the slot. The archetype/dial_sort_order-based
-- backfill below only matters for an existing prod table that still has
-- those columns (guarded — a fresh database's CREATE TABLE never declares
-- them, Catalog Blueprint brief 5a). The old UNIQUE (archetype,
-- dial_sort_order, weight_oz) constraint was declared inline with no
-- explicit name, so it (and its backing index) drop for free as soon as
-- either of its columns is dropped, below — no separate DROP INDEX needed.
-- (An earlier version of this block DID add a stray
-- `DROP INDEX IF EXISTS coffee_slot_price_slot_weight_key` here — a no-op on
-- the first boot since nothing had that name yet, but a 2BP01 on every
-- boot after, once it collided with this block's own ADD CONSTRAINT of
-- that same name further down. Caught live — see WHAT_WE_BUILT.md #182's
-- closing report.)
ALTER TABLE coffee_slot_price ADD COLUMN IF NOT EXISTS slot_id INT REFERENCES coffee_dial_slot(id);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dial_slot_price' AND column_name = 'archetype') THEN
    UPDATE coffee_slot_price p SET slot_id = s.id FROM coffee_dial_slot s
     WHERE p.slot_id IS NULL AND s.archetype = p.archetype AND s.sort_order = p.dial_sort_order;
  END IF;
END $$;
ALTER TABLE coffee_slot_price DROP COLUMN IF EXISTS archetype;
ALTER TABLE coffee_slot_price DROP COLUMN IF EXISTS dial_sort_order;
DO $$ BEGIN
  ALTER TABLE coffee_slot_price ALTER COLUMN slot_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;
-- CREATE UNIQUE INDEX IF NOT EXISTS, not ALTER TABLE ADD CONSTRAINT ...
-- UNIQUE: a named UNIQUE constraint's backing index collides with itself
-- on a re-run and raises 42P07 (duplicate_table), not 42710
-- (duplicate_object) — the DO/EXCEPTION guard used for CHECK constraints
-- elsewhere in this file doesn't catch it. IF NOT EXISTS is idempotent
-- outright, and ON CONFLICT (slot_id, weight_oz) infers against any
-- unique index, named constraint or not (caught live — see
-- WHAT_WE_BUILT.md #182's closing report).
CREATE UNIQUE INDEX IF NOT EXISTS coffee_slot_price_slot_weight_key ON coffee_slot_price(slot_id, weight_oz);

-- user_bloom_dial_current_position: same re-key. dial_sort_order's backfill
-- below is likewise guarded for the same reason.
ALTER TABLE user_bloom_dial_current_position ADD COLUMN IF NOT EXISTS slot_id INT REFERENCES coffee_dial_slot(id);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_bloom_dial_current_position' AND column_name = 'dial_sort_order') THEN
    UPDATE user_bloom_dial_current_position u SET slot_id = s.id FROM coffee_dial_slot s
     WHERE u.slot_id IS NULL AND s.archetype = u.archetype AND s.sort_order = u.dial_sort_order;
  END IF;
END $$;
ALTER TABLE user_bloom_dial_current_position DROP COLUMN IF EXISTS dial_sort_order;

-- Catalog Blueprint brief 5a, A3 — dead columns dropped, NOT NULLs added.
-- Preconditions checked against prod before writing this (Task 0 of the
-- brief): zero rows with coffees.roaster_id IS NULL, roaster_blend.coffee_id
-- IS NULL, archetype.code IS NULL, or dial_slot_price.slot_id IS NULL.
-- pg_depend checked against prod for every column below (Task 0):
-- roaster_blend.archetype_id has zero dependents, safe as a plain drop.
-- dial_coffee_relationships.hop_type and coffees.roaster each have a still-
-- live view depending on them at this exact point in the script
-- (v_coffee_hop; v_coffee and v_cupping_scores_readable respectively) — each
-- is unconditionally redefined later in this file (VIEWS section) without
-- referencing the dropped column, so CASCADE there is safe; omitting it
-- fails the whole boot's schema apply with 2BP01 (caught live once, fixed
-- here — see WHAT_WE_BUILT.md #182's closing report).
ALTER TABLE coffee_sku DROP COLUMN IF EXISTS archetype_id;
ALTER TABLE coffee_hop DROP COLUMN IF EXISTS hop_type CASCADE;
DROP TYPE IF EXISTS hop_type_enum;
ALTER TABLE coffees DROP COLUMN IF EXISTS roaster CASCADE;

-- Each NOT NULL is wrapped in DO/EXCEPTION so an unmet precondition (a NULL
-- slipping in between this brief's Task 0 check and this boot) can't abort
-- the rest of the schema apply — index.ts checks whether each one actually
-- took and warns if not, same self-healing pattern as coffees_active_natural_key.
DO $$ BEGIN
  ALTER TABLE coffees ALTER COLUMN roaster_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE coffee_sku ALTER COLUMN coffee_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE coffee_archetype ALTER COLUMN code SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- VIEWS
-- ─────────────────────────────────────────────
-- Views are part of the schema, not a live-only artifact: a CREATE OR REPLACE
-- VIEW (or DROP+CREATE) run directly against prod without updating this file
-- is drift, the same class HOME_TASK_1/S70 closed for Firestore config —
-- update both or neither. (HOME_TASK_7B/S83 audited all views here against
-- live pg_get_viewdef output on 2026-08-03 and found zero drift — the one
-- real bug that prompted the audit turned out to live in a consumer query,
-- not a stale view definition; see S83 for the full finding.)

-- Readable cupping scores — one row per score × dimension, with session + coffee context.
-- brew_method comes from cupping_sessions (TEXT after migration). `roaster`
-- was c.roaster (free text) through brief 4; Catalog Blueprint brief 5a
-- dropped that column, so this now joins the real roaster table instead —
-- same output column name, no known TS consumer of this view either way.
DROP VIEW IF EXISTS v_cupping_scores_readable;
CREATE VIEW v_cupping_scores_readable AS
  SELECT
    cs_sess.session_date,
    cs_sess.brew_method,
    cs_sess.location,
    c.name               AS coffee,
    r.name               AS roaster,
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
  LEFT JOIN roaster r ON r.id = c.roaster_id
  LEFT JOIN coffee_archetype_assignment aa  ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
  ORDER BY cs_sess.session_date, sc.display_order, cs.taster_name, d.display_order;

-- Collaborative flavor wheel — all descriptor observations per coffee, with source label.
-- Sources: 'internal' (cupping sessions), 'roastery' (bag notes), 'client' (post-delivery feedback).
-- Includes coffee name and full descriptor details — no extra JOINs needed at query time.
-- One row per observation. GROUP BY coffee_id + descriptor to aggregate across sources.
-- Customer Blueprint C3 (2026-09-27) gave this view permanent dependents
-- (v_coffee_descriptor, chained on into v_palate_shared_traits and
-- v_palate_slot_candidates) — a plain DROP now fails every boot once those
-- exist ("cannot drop view ... because other objects depend on it"), so this
-- is CREATE OR REPLACE, not DROP+CREATE, same as every other view below with
-- a same-run dependent. Column list is unchanged; if a future column rename
-- is ever needed here, drop the whole dependent chain explicitly first.
CREATE OR REPLACE VIEW v_collaborative_flavor_wheel AS
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
  WHERE crd.is_active
-- Customer Blueprint C3, Part C — repointed from user_flavor_feedback (no
-- writer as of this brief; dropped once no view names it, OPEN_TASKS.md) to
-- customer_feedback_descriptor joined to its parent customer_feedback_event
-- for coffee_id. intensity was always NULL on the old table's own writer
-- (routes/orders.ts) — NULL here is behavior-identical, not a regression.
UNION ALL
  SELECT cfe.coffee_id,
         c.name            AS coffee_name,
         cfd.cupping_note_id,
         cn.wheel_category,
         cn.wheel_subcategory,
         cn.descriptor,
         'client'          AS source,
         NULL::numeric     AS intensity
  FROM customer_feedback_descriptor cfd
  JOIN customer_feedback_event cfe ON cfe.id = cfd.feedback_event_id
  JOIN coffees      c  ON c.id  = cfe.coffee_id
  JOIN cupping_note cn ON cn.id = cfd.cupping_note_id;

-- v_quiz_scoring_matrix lives below the V7 seed (Prompt 4A, 2026-10-08):
-- it reads the SCD2 columns that section adds.

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

  SELECT id INTO v_choc_id  FROM coffee_archetype WHERE name = 'Chocolate & Nutty';
  SELECT id INTO v_bal_id   FROM coffee_archetype WHERE name = 'Balanced';
  SELECT id INTO v_fruit_id FROM coffee_archetype WHERE name = 'Fruity';

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
  -- Q4-D is a split: 0.5 points to both Chocolate & Nutty and Balanced
  INSERT INTO quiz_answer_archetype_score (answer_id, question_id, archetype_id, score)
  SELECT a.id, q.id, ar.id, data.score
  FROM (VALUES
    (1, 'It''s a daily ritual. I''m particular about it.',                             'Chocolate & Nutty', 1::numeric),
    (1, 'It''s a reliable habit. I just like having it.',                              'Balanced',  1::numeric),
    (1, 'It''s something I''m still discovering. I''m curious about it.',              'Fruity',            1::numeric),
    (3, 'It was strong and satisfying. I felt it.',                                    'Chocolate & Nutty', 2::numeric),
    (3, 'It was smooth and easy the whole way through. Nothing got in the way.',       'Balanced',  2::numeric),
    (3, 'It felt alive — bright and changing. Every sip was a little different.',      'Fruity',            2::numeric),
    (4, 'It feels complete. I''d drink it as is, or add milk to make it even richer.', 'Chocolate & Nutty', 1::numeric),
    (4, 'It''s fine, easy to drink. I might add something to smooth it out.',          'Balanced',  1::numeric),
    (4, 'Interesting — what flavors am I getting here?',                               'Fruity',            1::numeric),
    (4, 'I''m not sure. I don''t usually drink it black.',                             'Chocolate & Nutty', 0.5::numeric),
    (4, 'I''m not sure. I don''t usually drink it black.',                             'Balanced',  0.5::numeric),
    (5, 'It has no bitterness or intensity.',                                          'Chocolate & Nutty', 2::numeric),
    (5, 'It''s too bitter or too intense.',                                            'Balanced',  2::numeric),
    (5, 'Every sip tastes exactly the same.',                                          'Fruity',            2::numeric),
    (6, 'I don''t mind. Actually I kind of like it. It tastes serious.',               'Chocolate & Nutty', 3::numeric),
    (6, 'I''d rather have something gentler and smoother.',                            'Balanced',  3::numeric),
    (6, 'It feels burnt to me. I''d rather have something fresher or more alive.',     'Fruity',            3::numeric)
  ) AS data(q_number, answer_text, archetype_name, score)
  JOIN quiz_question q ON q.quiz_id = v_quiz_id AND q.q_number = data.q_number::int
  JOIN quiz_answer a  ON a.question_id = q.id  AND a.answer_text = data.answer_text
  JOIN coffee_archetype   ar ON ar.name = data.archetype_name
  ON CONFLICT (answer_id, archetype_id) DO NOTHING;

END $v4$;

-- ─────────────────────────────────────────────
-- QUIZ V7 — Q order: Identity · Perfect cup · Black coffee · Disappointment ·
--           Bitterness · Food signal (moved to last, weight 0)
-- Branch questions: Floral (trigger: Fruity) and Earthy (trigger: Chocolate & Nutty)
-- Veto cascade: Q5 → Q4 → Q2 → Q1  |  Experimental gate: Q3-C
--
-- Drift prevention (Quiz Content Drift Prevention, 2026-08-11): quiz_answer
-- carries a stable, version-scoped answer_code (v7_q1_a, v7_branch_fruity_stay,
-- etc.) so scoring survives a copy edit. The block below is a re-asserting
-- seed, not a one-time seed — it runs on every application of this file
-- (every boot, see index.ts's start()) and converges DB content to this
-- file's content every time, keyed on answer_code. Since Prompt 4A
-- (2026-10-08) it converges by VERSIONS, not by UPDATE: a changed question or
-- answer is closed and a new row inserted (SCD Type 2, see the block just
-- below). Answer UUIDs are load-bearing (referenced by
-- quiz_answer_archetype_score and by persisted session answerIds), so a
-- row's content is never changed and no row is ever deleted.
--
-- HOW TO CHANGE QUIZ COPY: edit the value on the code's line in the lists
-- below and deploy. The next boot closes the old row and inserts a new
-- version (new id, same answer_code, score rows copied); /api/quiz serves
-- the new id, old sessions keep the id and the words they saw. Never UPDATE
-- quiz content in Cloud SQL (the triggers refuse it). Leave the adoption
-- list (Change 2) alone: it holds historical text on purpose.
-- Retired quiz versions (v2-v4) are untouched: every write below is scoped to
-- the v7 quiz tree, either by explicit quiz_id or by answer_code.
-- ─────────────────────────────────────────────

-- Change 1 — stable answer_code. Only the active v7 quiz and its two branch
-- quizzes ever get one; retired v5/v6 rows keep answer_code IS NULL, which
-- this partial unique index tolerates (many nulls, no conflict).
-- The original index, quiz_answer_code_unique (answer_code WHERE answer_code
-- IS NOT NULL), is replaced by quiz_answer_code_current_unique below (Prompt
-- 4A, 2026-10-08): once answers have versions, several rows share a code and
-- only the current one is unique. It is dropped there, not recreated here.
ALTER TABLE quiz_answer ADD COLUMN IF NOT EXISTS answer_code TEXT;

-- ═════════════════════════════════════════════════════════════════════════
-- QUIZ CONTENT IS SCD TYPE 2 (Prompt 4A, 2026-10-08, decided by Dana)
-- backend/src/features/quiz_interpretation_v2/CLAUDE_CODE_PROMPT_4A_QUIZ_CONTENT_SCD2.md
--
-- quiz_question and quiz_answer keep every version of their content. A change
-- closes the current row (valid_to = now(), is_current = false) and inserts a
-- new row with a new id. Nothing is updated in place, nothing is deleted:
-- sessions store answer ids, so an old id must keep pointing at the words the
-- person actually saw and keep its score rows forever. Business keys:
-- question = (quiz_id, q_number), answer = answer_code. The only writer is
-- the seed below, running as the owner; the request pool (ab_app) has SELECT
-- only (end of this file) and the triggers here refuse in-place edits and
-- deletes for every role.
-- ═════════════════════════════════════════════════════════════════════════

-- Part A — snapshot of the pre-SCD2 quiz content. IF NOT EXISTS: only the
-- first boot's copy is ever kept (the production-minted ids are the part this
-- file cannot rebuild). Never written again; ab_app gets SELECT only.
CREATE TABLE IF NOT EXISTS quiz_backup_20261008_quiz                        AS TABLE quiz;
CREATE TABLE IF NOT EXISTS quiz_backup_20261008_quiz_question               AS TABLE quiz_question;
CREATE TABLE IF NOT EXISTS quiz_backup_20261008_quiz_answer                 AS TABLE quiz_answer;
CREATE TABLE IF NOT EXISTS quiz_backup_20261008_quiz_answer_archetype_score AS TABLE quiz_answer_archetype_score;

-- Part B — SCD2 columns. valid_from is added nullable, filled once from the
-- owning quiz's created_at, then made NOT NULL DEFAULT now(): the fill only
-- ever matches rows on the boot that adds the column (a second boot is a
-- no-op). is_current defaults to true for every existing row, retired v2-v4
-- content included (quiz-level retirement stays quiz.is_active).
ALTER TABLE quiz_question ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;
ALTER TABLE quiz_question ADD COLUMN IF NOT EXISTS valid_to   TIMESTAMPTZ;
ALTER TABLE quiz_question ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE quiz_answer   ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;
ALTER TABLE quiz_answer   ADD COLUMN IF NOT EXISTS valid_to   TIMESTAMPTZ;
ALTER TABLE quiz_answer   ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT true;
-- Display position of an answer inside its question (replaces ORDER BY a.id).
ALTER TABLE quiz_answer   ADD COLUMN IF NOT EXISTS sort_order SMALLINT;

UPDATE quiz_question qq
SET valid_from = COALESCE((SELECT qz.created_at FROM quiz qz WHERE qz.id = qq.quiz_id), now())
WHERE qq.valid_from IS NULL;
UPDATE quiz_answer a
SET valid_from = COALESCE((SELECT qz.created_at FROM quiz_question qq JOIN quiz qz ON qz.id = qq.quiz_id
                           WHERE qq.id = a.question_id), now())
WHERE a.valid_from IS NULL;
ALTER TABLE quiz_question ALTER COLUMN valid_from SET DEFAULT now();
ALTER TABLE quiz_question ALTER COLUMN valid_from SET NOT NULL;
ALTER TABLE quiz_answer   ALTER COLUMN valid_from SET DEFAULT now();
ALTER TABLE quiz_answer   ALTER COLUMN valid_from SET NOT NULL;

-- One-time fill: rank by id inside the question, which is exactly the order
-- the quiz was served in before this change (ORDER BY a.id), so nothing moves
-- on screen. Matches nothing once every row has one (the seed below always
-- supplies sort_order for the v7 tree).
UPDATE quiz_answer a
SET sort_order = r.rn
FROM (SELECT id, row_number() OVER (PARTITION BY question_id ORDER BY id) AS rn FROM quiz_answer) r
WHERE r.id = a.id AND a.sort_order IS NULL;

-- Known limit (not fixed, on purpose): v7_q3_a, v7_q3_b, v7_q6_b and the Q3
-- stem were edited in place on 2026-08-15, before this existed. Sessions
-- before that date saw the earlier wording; it survives only in the seed's
-- adoption list below. No historical rows are fabricated for it.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_question_scd2_current_check') THEN
    ALTER TABLE quiz_question ADD CONSTRAINT quiz_question_scd2_current_check
      CHECK ((is_current AND valid_to IS NULL) OR (NOT is_current AND valid_to IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_answer_scd2_current_check') THEN
    ALTER TABLE quiz_answer ADD CONSTRAINT quiz_answer_scd2_current_check
      CHECK ((is_current AND valid_to IS NULL) OR (NOT is_current AND valid_to IS NOT NULL));
  END IF;
END $$;

-- Exactly one current version per business key.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_question_current_unique
  ON quiz_question (quiz_id, q_number) WHERE is_current;
DROP INDEX IF EXISTS quiz_answer_code_unique;
CREATE UNIQUE INDEX IF NOT EXISTS quiz_answer_code_current_unique
  ON quiz_answer (answer_code) WHERE answer_code IS NOT NULL AND is_current;

-- Part E — the database refuses in-place edits and deletes, for every role.
-- Created after the Part B fill above, so the fill never meets them; the seed
-- below runs under them from the first boot. UPDATE is allowed only to retire
-- a current row (valid_to, is_current), plus filling answer_code or
-- sort_order where it is still NULL (the adoption UPDATE and the Part B fill).
-- A retired row never changes again.
CREATE OR REPLACE FUNCTION quiz_content_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  o JSONB;
  n JSONB;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'quiz content is never deleted (% on %): retire the row instead (valid_to, is_current = false)', TG_OP, TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'quiz_answer_archetype_score' THEN
    RAISE EXCEPTION 'quiz_answer_archetype_score rows are never updated: a different score is a new answer version';
  END IF;
  IF NOT OLD.is_current THEN
    RAISE EXCEPTION '% % is a retired version and cannot change', TG_TABLE_NAME, OLD.id;
  END IF;
  o := to_jsonb(OLD) - 'valid_to' - 'is_current';
  n := to_jsonb(NEW) - 'valid_to' - 'is_current';
  IF TG_TABLE_NAME = 'quiz_answer' THEN
    IF o->>'answer_code' IS NULL THEN o := o - 'answer_code'; n := n - 'answer_code'; END IF;
    IF o->>'sort_order'  IS NULL THEN o := o - 'sort_order';  n := n - 'sort_order';  END IF;
  END IF;
  IF o IS DISTINCT FROM n THEN
    RAISE EXCEPTION '% % cannot be edited in place: quiz content is SCD Type 2, close the row and insert a new version', TG_TABLE_NAME, OLD.id;
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE TRIGGER quiz_question_scd2_guard
  BEFORE UPDATE OR DELETE ON quiz_question FOR EACH ROW EXECUTE FUNCTION quiz_content_guard();
CREATE OR REPLACE TRIGGER quiz_question_no_truncate
  BEFORE TRUNCATE ON quiz_question FOR EACH STATEMENT EXECUTE FUNCTION quiz_content_guard();
CREATE OR REPLACE TRIGGER quiz_answer_scd2_guard
  BEFORE UPDATE OR DELETE ON quiz_answer FOR EACH ROW EXECUTE FUNCTION quiz_content_guard();
CREATE OR REPLACE TRIGGER quiz_answer_no_truncate
  BEFORE TRUNCATE ON quiz_answer FOR EACH STATEMENT EXECUTE FUNCTION quiz_content_guard();
CREATE OR REPLACE TRIGGER quiz_answer_archetype_score_guard
  BEFORE UPDATE OR DELETE ON quiz_answer_archetype_score FOR EACH ROW EXECUTE FUNCTION quiz_content_guard();
CREATE OR REPLACE TRIGGER quiz_answer_archetype_score_no_truncate
  BEFORE TRUNCATE ON quiz_answer_archetype_score FOR EACH STATEMENT EXECUTE FUNCTION quiz_content_guard();

-- Part C — the seed asserts versions instead of overwriting. Each function
-- compares the wanted content with the current row of the business key:
-- none → INSERT; identical → nothing; different → close + INSERT a new
-- version. Against unchanged content they insert nothing and close nothing.

-- Close a current answer and insert its successor with the given content.
-- Score rows are copied to the new id (one archetype's score replaced when
-- p_score_archetype_id is given); the old row keeps its own score rows.
CREATE OR REPLACE FUNCTION quiz_answer_new_version(
  p_old_id UUID, p_question_id UUID, p_answer_text TEXT, p_resulting_archetype_id UUID,
  p_is_experimental_gate BOOLEAN, p_sort_order INT,
  p_score_archetype_id UUID DEFAULT NULL, p_score NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $fn$
DECLARE
  prev quiz_answer%ROWTYPE;
  v_new_id UUID;
BEGIN
  SELECT * INTO prev FROM quiz_answer WHERE id = p_old_id AND is_current;
  IF NOT FOUND THEN RAISE EXCEPTION 'quiz_answer % is not a current row', p_old_id; END IF;

  UPDATE quiz_answer SET valid_to = now(), is_current = false WHERE id = prev.id;
  INSERT INTO quiz_answer (question_id, answer_text, next_question_id, resulting_archetype_id, vector_impact,
                           weight, is_experimental_gate, answer_code, sort_order)
  VALUES (p_question_id, p_answer_text, prev.next_question_id, p_resulting_archetype_id, prev.vector_impact,
          prev.weight, p_is_experimental_gate, prev.answer_code, p_sort_order)
  RETURNING id INTO v_new_id;

  INSERT INTO quiz_answer_archetype_score (answer_id, question_id, archetype_id, score)
  SELECT v_new_id, p_question_id, s.archetype_id,
         CASE WHEN p_score IS NOT NULL AND s.archetype_id IS NOT DISTINCT FROM p_score_archetype_id
              THEN p_score ELSE s.score END
  FROM quiz_answer_archetype_score s WHERE s.answer_id = prev.id;
  IF p_score IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM quiz_answer_archetype_score
    WHERE answer_id = v_new_id AND archetype_id IS NOT DISTINCT FROM p_score_archetype_id
  ) THEN
    INSERT INTO quiz_answer_archetype_score (answer_id, question_id, archetype_id, score)
    VALUES (v_new_id, p_question_id, p_score_archetype_id, p_score);
  END IF;
  RETURN v_new_id;
END $fn$;

-- Assert a question. A changed question is re-versioned AND so is every
-- current answer of it (same content, same code, same sort_order, score rows
-- copied), so an old answer id always leads to the stem the person saw.
CREATE OR REPLACE FUNCTION quiz_assert_question(p_quiz_id UUID, p_q_number INT, p_q_text TEXT, p_weight NUMERIC)
RETURNS UUID
LANGUAGE plpgsql AS $fn$
DECLARE
  cur quiz_question%ROWTYPE;
  ans quiz_answer%ROWTYPE;
  v_new_id UUID;
BEGIN
  SELECT * INTO cur FROM quiz_question WHERE quiz_id = p_quiz_id AND q_number = p_q_number AND is_current;
  IF FOUND AND cur.q_text = p_q_text AND cur.weight IS NOT DISTINCT FROM p_weight THEN
    RETURN cur.id;
  END IF;
  IF FOUND THEN
    UPDATE quiz_question SET valid_to = now(), is_current = false WHERE id = cur.id;
  END IF;
  INSERT INTO quiz_question (quiz_id, q_number, q_text, weight)
  VALUES (p_quiz_id, p_q_number, p_q_text, p_weight)
  RETURNING id INTO v_new_id;
  IF cur.id IS NOT NULL THEN
    FOR ans IN SELECT * FROM quiz_answer WHERE question_id = cur.id AND is_current ORDER BY sort_order, id LOOP
      PERFORM quiz_answer_new_version(ans.id, v_new_id, ans.answer_text, ans.resulting_archetype_id,
                                      ans.is_experimental_gate, ans.sort_order);
    END LOOP;
  END IF;
  RETURN v_new_id;
END $fn$;

-- Assert an answer, keyed on answer_code. A sort_order change alone is also
-- a new version.
CREATE OR REPLACE FUNCTION quiz_assert_answer(
  p_answer_code TEXT, p_question_id UUID, p_answer_text TEXT, p_resulting_archetype_id UUID,
  p_is_experimental_gate BOOLEAN, p_sort_order INT
) RETURNS UUID
LANGUAGE plpgsql AS $fn$
DECLARE
  cur quiz_answer%ROWTYPE;
  v_new_id UUID;
BEGIN
  SELECT * INTO cur FROM quiz_answer WHERE answer_code = p_answer_code AND is_current;
  IF NOT FOUND THEN
    INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id, is_experimental_gate, answer_code, sort_order)
    VALUES (p_question_id, p_answer_text, p_resulting_archetype_id, p_is_experimental_gate, p_answer_code, p_sort_order)
    RETURNING id INTO v_new_id;
    RETURN v_new_id;
  END IF;
  IF cur.question_id IS NOT DISTINCT FROM p_question_id
     AND cur.answer_text = p_answer_text
     AND cur.resulting_archetype_id IS NOT DISTINCT FROM p_resulting_archetype_id
     AND cur.is_experimental_gate IS NOT DISTINCT FROM p_is_experimental_gate
     AND cur.sort_order IS NOT DISTINCT FROM p_sort_order THEN
    RETURN cur.id;
  END IF;
  RETURN quiz_answer_new_version(cur.id, p_question_id, p_answer_text, p_resulting_archetype_id,
                                 p_is_experimental_gate, p_sort_order);
END $fn$;

-- Assert one score row of the CURRENT answer for a code. Missing → INSERT.
-- Same score → nothing. A different score → a new answer version carrying
-- the new score (score rows are never updated). Score rows the list does not
-- name are left alone and reported by quizIntegrity.ts (checks 4 and 7).
CREATE OR REPLACE FUNCTION quiz_assert_answer_score(p_answer_code TEXT, p_archetype_id UUID, p_score NUMERIC)
RETURNS UUID
LANGUAGE plpgsql AS $fn$
DECLARE
  cur quiz_answer%ROWTYPE;
  v_score NUMERIC;
BEGIN
  SELECT * INTO cur FROM quiz_answer WHERE answer_code = p_answer_code AND is_current;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT score INTO v_score FROM quiz_answer_archetype_score
  WHERE answer_id = cur.id AND archetype_id IS NOT DISTINCT FROM p_archetype_id;
  IF NOT FOUND THEN
    INSERT INTO quiz_answer_archetype_score (answer_id, question_id, archetype_id, score)
    VALUES (cur.id, cur.question_id, p_archetype_id, p_score);
    RETURN cur.id;
  END IF;
  IF v_score = p_score THEN RETURN cur.id; END IF;
  RETURN quiz_answer_new_version(cur.id, cur.question_id, cur.answer_text, cur.resulting_archetype_id,
                                 cur.is_experimental_gate, cur.sort_order, p_archetype_id, p_score);
END $fn$;

-- Retiring an answer is an explicit seed line, never a side effect of a code
-- disappearing from the list: close the current row, no successor. Its score
-- rows stay. Nothing calls this as of Prompt 4A.
CREATE OR REPLACE FUNCTION quiz_retire_answer(p_answer_code TEXT) RETURNS UUID
LANGUAGE plpgsql AS $fn$
DECLARE
  v_id UUID;
BEGIN
  UPDATE quiz_answer SET valid_to = now(), is_current = false
  WHERE answer_code = p_answer_code AND is_current
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

REVOKE ALL ON FUNCTION quiz_answer_new_version(UUID, UUID, TEXT, UUID, BOOLEAN, INT, UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_assert_question(UUID, INT, TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_assert_answer(TEXT, UUID, TEXT, UUID, BOOLEAN, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_assert_answer_score(TEXT, UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_retire_answer(TEXT) FROM PUBLIC;

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
  v_balanced_bq_id UUID;   -- Balanced branch quiz id (Prompt 4B)
  v_bbq1_id        UUID;   -- Balanced branch question id (Prompt 4B)
  v_answer_id      UUID;   -- loop working var
  v_question_id    UUID;   -- loop working var
  v_archetype_id   UUID;   -- loop working var
  rec              RECORD; -- loop working var
BEGIN
  SELECT id INTO v_main_type_id   FROM quiz_type WHERE name = 'main';
  SELECT id INTO v_branch_type_id FROM quiz_type WHERE name = 'branch';

  SELECT id INTO v_choc_id   FROM coffee_archetype WHERE name = 'Chocolate & Nutty';
  SELECT id INTO v_bal_id    FROM coffee_archetype WHERE name = 'Balanced';
  SELECT id INTO v_fruit_id  FROM coffee_archetype WHERE name = 'Fruity';
  SELECT id INTO v_floral_id FROM coffee_archetype WHERE name = 'Floral';
  SELECT id INTO v_earthy_id FROM coffee_archetype WHERE name = 'Earthy';

  -- ── Quiz rows — create only if absent (as before); always re-assert
  -- content on every run, INCLUDING is_active. ─────────────────────────────
  SELECT id INTO v_quiz_id FROM quiz WHERE version = 'v7';
  IF v_quiz_id IS NULL THEN
    -- First-ever creation only — make sure no stale main quiz is left active.
    UPDATE quiz SET is_active = FALSE WHERE (quiz_type_id = v_main_type_id OR quiz_type_id IS NULL) AND parent_quiz_id IS NULL;
    INSERT INTO quiz (version, description, is_active, quiz_type_id)
      VALUES ('v7', 'Axis & Bloom Flavor Finder — V7', true, v_main_type_id)
      RETURNING id INTO v_quiz_id;
  ELSE
    UPDATE quiz SET description = 'Axis & Bloom Flavor Finder — V7', is_active = true, quiz_type_id = v_main_type_id
    WHERE id = v_quiz_id;
  END IF;

  -- Branch quizzes — corrected 2026-08-11 (Dana): is_active = TRUE is correct.
  -- The branches are in service; "not the main quiz" is already expressed by
  -- parent_quiz_id (the main-quiz selector filters parent_quiz_id IS NULL;
  -- GET /api/quiz/branch never reads is_active at all). Do not flip this back
  -- to false — production already has both rows active and that is correct.
  SELECT id INTO v_floral_bq_id FROM quiz WHERE version = 'v7-branch-floral';
  IF v_floral_bq_id IS NULL THEN
    INSERT INTO quiz (version, description, is_active, quiz_type_id, trigger_archetype_id, parent_quiz_id)
      VALUES ('v7-branch-floral', 'V7 branch — Fruity → Floral', true, v_branch_type_id, v_fruit_id, v_quiz_id)
      RETURNING id INTO v_floral_bq_id;
  ELSE
    UPDATE quiz SET description = 'V7 branch — Fruity → Floral', is_active = true, quiz_type_id = v_branch_type_id,
      trigger_archetype_id = v_fruit_id, parent_quiz_id = v_quiz_id
    WHERE id = v_floral_bq_id;
  END IF;

  SELECT id INTO v_earthy_bq_id FROM quiz WHERE version = 'v7-branch-earthy';
  IF v_earthy_bq_id IS NULL THEN
    INSERT INTO quiz (version, description, is_active, quiz_type_id, trigger_archetype_id, parent_quiz_id)
      VALUES ('v7-branch-earthy', 'V7 branch — Chocolate & Nutty → Earthy', true, v_branch_type_id, v_choc_id, v_quiz_id)
      RETURNING id INTO v_earthy_bq_id;
  ELSE
    UPDATE quiz SET description = 'V7 branch — Chocolate & Nutty → Earthy', is_active = true, quiz_type_id = v_branch_type_id,
      trigger_archetype_id = v_choc_id, parent_quiz_id = v_quiz_id
    WHERE id = v_earthy_bq_id;
  END IF;

  -- Balanced branch (Prompt 4B, 2026-10-09). Every answer resolves to Balanced: the person is SHOWN Balanced
  -- whatever they pick; the answer only sets where on the Bloom Dial they are matched (interpret() v2.2,
  -- quizScoring.ts BRANCH_ANSWER_EFFECTS). Same create-if-absent / re-assert pattern as the two branches above.
  SELECT id INTO v_balanced_bq_id FROM quiz WHERE version = 'v7-branch-balanced';
  IF v_balanced_bq_id IS NULL THEN
    INSERT INTO quiz (version, description, is_active, quiz_type_id, trigger_archetype_id, parent_quiz_id)
      VALUES ('v7-branch-balanced', 'V7 branch: Balanced lean', true, v_branch_type_id, v_bal_id, v_quiz_id)
      RETURNING id INTO v_balanced_bq_id;
  ELSE
    UPDATE quiz SET description = 'V7 branch: Balanced lean', is_active = true, quiz_type_id = v_branch_type_id,
      trigger_archetype_id = v_bal_id, parent_quiz_id = v_quiz_id
    WHERE id = v_balanced_bq_id;
  END IF;

  -- ── Question rows — asserted as versions, keyed on (quiz_id, q_number)
  -- (Prompt 4A): no current row → insert; same text and weight → nothing;
  -- different → the current row is closed, a new version is inserted and its
  -- current answers are re-versioned onto it (quiz_assert_question). The
  -- returned id is always the current question. ─────────────────────────────
  v_q1_id := quiz_assert_question(v_quiz_id, 1, 'How would you describe your relationship with coffee?', 1);
  v_q2_id := quiz_assert_question(v_quiz_id, 2, 'When you finish a really good cup of coffee, what made it good?', 2);
  v_q3_id := quiz_assert_question(v_quiz_id, 3, 'When someone gives you a cup of black coffee, what might be your first reaction?', 1);
  v_q4_id := quiz_assert_question(v_quiz_id, 4, 'Which of these would bother you most about a cup of coffee?', 2);
  v_q5_id := quiz_assert_question(v_quiz_id, 5, 'Someone hands you a coffee that''s a little more bitter than expected. What''s your honest reaction?', 3);
  v_q6_id := quiz_assert_question(v_quiz_id, 6, 'Someone places a small treat next to your coffee. Without thinking, which do you grab?', 0);

  v_fbq1_id := quiz_assert_question(v_floral_bq_id, 1, 'One last thing. When coffee is really at its best for you, which is closer?', 1);
  -- Earthy branch stem reworded by Prompt 4B (2026-10-09): a new version; the old stem's row is closed and its
  -- answers are re-versioned onto the new row by quiz_assert_question before the content list below runs.
  v_ebq1_id := quiz_assert_question(v_earthy_bq_id, 1, 'Your profile is rich and bold. Which one sounds more like you?', 1);
  v_bbq1_id := quiz_assert_question(v_balanced_bq_id, 1, 'One last thing. Your coffee is smooth and gentle, just how you like it best. Which of these would you be sad to lose?', 1);

  -- ── Change 2 — backfill: adopt the code onto an existing row that matches
  -- by exact (question_id, answer_text) and doesn't have one yet. Runs before
  -- the content-sync loop below, exactly once per row (no-op once coded). If
  -- an active-quiz answer's copy was hand-edited in prod and matches no known
  -- text here, it is NOT guessed by position (ORDER BY a.id on UUIDs is
  -- meaningless) — it is simply left uncoded, and integrity check #0 flags it
  -- by name for a human to resolve. Per the 2026-08-11 audit, every live v7
  -- answer's text already matches this file exactly, so this is expected to
  -- match all 22 rows on first run.
  UPDATE quiz_answer a
  SET answer_code = coded.answer_code
  FROM (VALUES
    ('v7_q1_a', v_q1_id, 'It''s a daily ritual. I''m particular about it.'),
    ('v7_q1_b', v_q1_id, 'It''s a reliable habit. I just like having it.'),
    ('v7_q1_c', v_q1_id, 'It''s something I''m still discovering. I''m curious about it.'),
    ('v7_q2_a', v_q2_id, 'It was strong and satisfying — I felt it.'),
    ('v7_q2_b', v_q2_id, 'It was smooth and easy the whole way through — nothing got in the way.'),
    ('v7_q2_c', v_q2_id, 'It felt alive — bright and changing. Every sip was a little different.'),
    -- NOTE: these three carry the pre-2026-08-15 copy on purpose. This list matches
    -- historical text to adopt a code onto an uncoded row; the current copy lives in
    -- the content-sync list below.
    ('v7_q3_a', v_q3_id, 'It feels complete. I''d drink it as is, or add milk to make it even richer.'),
    ('v7_q3_b', v_q3_id, 'It''s fine, easy to drink. I might add something to smooth it out.'),
    ('v7_q3_c', v_q3_id, 'Interesting… what flavors am I getting here?'),
    ('v7_q4_a', v_q4_id, 'It has no bitterness or intensity.'),
    ('v7_q4_b', v_q4_id, 'It''s too bitter or too intense.'),
    ('v7_q4_c', v_q4_id, 'Every sip tastes exactly the same.'),
    ('v7_q5_a', v_q5_id, 'I don''t mind. Actually I kind of like it. It tastes serious.'),
    ('v7_q5_b', v_q5_id, 'I''d rather have something gentler and smoother.'),
    ('v7_q5_c', v_q5_id, 'It feels burnt to me. I''d rather have something fresher or more alive.'),
    ('v7_q6_a', v_q6_id, 'Something rich and comforting. Dark chocolate, roasted nuts, a warm brownie.'),
    ('v7_q6_b', v_q6_id, 'Something soft and sweet. A ripe peach, a vanilla biscuit, caramel.'),
    ('v7_q6_c', v_q6_id, 'Something fresh and lively. A green apple, fresh berries, citrus.'),
    ('v7_branch_fruity_stay',   v_fbq1_id, 'It''s complex and alive. A lot happening — I want to explore every sip.'),
    ('v7_branch_fruity_floral', v_fbq1_id, 'It''s so light and delicate it barely feels like coffee. Almost like drinking tea.'),
    ('v7_branch_cn_stay',       v_ebq1_id, 'Rich and comforting. Coffee that feels like a reward at the end of the day.'),
    ('v7_branch_cn_earthy',     v_ebq1_id, 'Deep and intense. Complex, almost challenging. The more serious the better.')
  ) AS coded(answer_code, question_id, answer_text)
  WHERE a.question_id = coded.question_id
    AND a.answer_text = coded.answer_text
    AND a.answer_code IS NULL;

  -- ── Change 3 — content, asserted as versions keyed on answer_code (Prompt
  -- 4A, quiz_assert_answer): no current row for the code → insert; identical
  -- → nothing; any difference (text, archetype, gate, question, sort_order) →
  -- the current row is closed and a new version inserted with its score rows
  -- copied. Never updated in place, never deleted. A copy edit is a new value
  -- on its line here. A code removed from this list is NOT retired; retiring
  -- is an explicit quiz_retire_answer('<code>') line. The last column,
  -- sort_order, is the display position inside the question, taken from the
  -- production order on 2026-10-09 (which was ORDER BY id).
  FOR rec IN
    SELECT * FROM (VALUES
      ('v7_q1_a', v_q1_id, 'It''s a daily ritual. I''m particular about it.',                v_choc_id,  FALSE, 2),
      ('v7_q1_b', v_q1_id, 'It''s a reliable habit. I just like having it.',                 v_bal_id,   FALSE, 1),
      ('v7_q1_c', v_q1_id, 'It''s something I''m still discovering. I''m curious about it.', v_fruit_id, FALSE, 3),
      ('v7_q2_a', v_q2_id, 'It was strong and satisfying — I felt it.',                              v_choc_id,  FALSE, 2),
      ('v7_q2_b', v_q2_id, 'It was smooth and easy the whole way through — nothing got in the way.', v_bal_id,   FALSE, 3),
      ('v7_q2_c', v_q2_id, 'It felt alive — bright and changing. Every sip was a little different.', v_fruit_id, FALSE, 1),
      ('v7_q3_a', v_q3_id, 'I''d take a sip first, then decide if I want to add anything to make it even richer.', v_choc_id,  FALSE, 2),
      ('v7_q3_b', v_q3_id, 'I''d probably add milk or something to smooth it before trying it.',          v_bal_id,   FALSE, 1),
      ('v7_q3_c', v_q3_id, 'Interesting… what flavors am I getting here?',                                v_fruit_id, TRUE,  3),
      ('v7_q4_a', v_q4_id, 'It has no bitterness or intensity.', v_choc_id,  FALSE, 3),
      ('v7_q4_b', v_q4_id, 'It''s too bitter or too intense.',   v_bal_id,   FALSE, 1),
      ('v7_q4_c', v_q4_id, 'Every sip tastes exactly the same.', v_fruit_id, FALSE, 2),
      ('v7_q5_a', v_q5_id, 'I don''t mind. Actually I kind of like it. It tastes serious.',           v_choc_id,  FALSE, 1),
      ('v7_q5_b', v_q5_id, 'I''d rather have something gentler and smoother.',                         v_bal_id,   FALSE, 3),
      ('v7_q5_c', v_q5_id, 'It feels burnt to me. I''d rather have something fresher or more alive.', v_fruit_id, FALSE, 2),
      ('v7_q6_a', v_q6_id, 'Something rich and comforting. Dark chocolate, roasted nuts, a warm brownie.', v_choc_id,  FALSE, 1),
      ('v7_q6_b', v_q6_id, 'Something soft and sweet. A vanilla or a caramel biscuit.',          v_bal_id,   FALSE, 3),
      ('v7_q6_c', v_q6_id, 'Something fresh and lively. A green apple, fresh berries, citrus.',            v_fruit_id, FALSE, 2),
      -- Branch copy reworded by Prompt 4B (2026-10-09): new versions, archetypes and sort_order unchanged.
      -- Branch copy never names a flavor, never says "tea", no milk/dark chocolate wording (Dana, 2026-10-06/07).
      ('v7_branch_fruity_stay',   v_fbq1_id, 'Bright and lively. Every sip a little different.',                   v_fruit_id,  FALSE, 1),
      ('v7_branch_fruity_floral', v_fbq1_id, 'Light and delicate, and more about the smell than the taste.',       v_floral_id, FALSE, 2),
      ('v7_branch_cn_stay',       v_ebq1_id, 'Coffee that feels like a reward. Warm, rich, comforting.',           v_choc_id,   FALSE, 1),
      ('v7_branch_cn_earthy',     v_ebq1_id, 'Coffee with a kick. Dark, strong, a bit smoky.',                     v_earthy_id, FALSE, 2),
      -- Balanced branch (Prompt 4B): each answer separates on a different sense (a feeling, a taste, a smell).
      -- Do not "improve" the floral answer into a lightness description: that makes it a second fruity answer.
      ('v7_branch_bal_cozy',      v_bbq1_id, 'The cozy, dessert-like feeling. Soft and sweet.',                                 v_bal_id, FALSE, 1),
      ('v7_branch_bal_fruit',     v_bbq1_id, 'A little sweetness that reminds you of fruit. Like a bite of ripe peach.',        v_bal_id, FALSE, 2),
      ('v7_branch_bal_floral',    v_bbq1_id, 'The smell. You''d catch yourself breathing it in before you even take a sip.',    v_bal_id, FALSE, 3)
    ) AS t(answer_code, question_id, answer_text, resulting_archetype_id, is_experimental_gate, sort_order)
  LOOP
    PERFORM quiz_assert_answer(rec.answer_code, rec.question_id, rec.answer_text, rec.resulting_archetype_id,
                               rec.is_experimental_gate, rec.sort_order);
  END LOOP;

  -- ── Score rows — Q1–Q5 only, one per answer, keyed via answer_code and
  -- resolved to the CURRENT answer row (quiz_assert_answer_score): missing →
  -- insert; same → nothing; a different score → a new answer version with
  -- the new score row (score rows are never updated). Old answer versions
  -- keep their score rows forever. Prompt 4A removed the two DELETEs that
  -- used to run here: a stray score row (a row this list does not name, or
  -- any score row on a Q6 or branch answer) is now reported by
  -- quizIntegrity.ts checks 4 and 7, never removed.
  FOR rec IN
    SELECT * FROM (VALUES
      ('v7_q1_a', 'Chocolate & Nutty', 1::numeric),
      ('v7_q1_b', 'Balanced',  1::numeric),
      ('v7_q1_c', 'Fruity',            1::numeric),
      ('v7_q2_a', 'Chocolate & Nutty', 2::numeric),
      ('v7_q2_b', 'Balanced',  2::numeric),
      ('v7_q2_c', 'Fruity',            2::numeric),
      ('v7_q3_a', 'Chocolate & Nutty', 1::numeric),
      ('v7_q3_b', 'Balanced',  1::numeric),
      ('v7_q3_c', 'Fruity',            1::numeric),
      ('v7_q4_a', 'Chocolate & Nutty', 2::numeric),
      ('v7_q4_b', 'Balanced',  2::numeric),
      ('v7_q4_c', 'Fruity',            2::numeric),
      ('v7_q5_a', 'Chocolate & Nutty', 3::numeric),
      ('v7_q5_b', 'Balanced',  3::numeric),
      ('v7_q5_c', 'Fruity',            3::numeric)
    ) AS t(answer_code, archetype_name, score)
  LOOP
    SELECT id INTO v_archetype_id FROM coffee_archetype WHERE name = rec.archetype_name;
    -- NULL when the code has no current row (defensive; the content loop above always creates one).
    PERFORM quiz_assert_answer_score(rec.answer_code, v_archetype_id, rec.score);
  END LOOP;

  -- Q6 and branch answers are never scored (Q6 is weight 0, food signal only;
  -- branch answers only change the archetype). This list names no score row
  -- for them; integrity checks 4 and 7 report one if it ever appears.

END $v7$;

-- Full quiz scoring matrix — one row per (question, answer, archetype)
-- Shows all three scoring levels: question weight, answer weight, archetype-specific score.
-- Lambda formula: q_weight × ans_weight × ans_score = effective contribution per archetype.
-- Moved below the V7 seed by Prompt 4A (2026-10-08) because it reads the SCD2
-- columns added above. Every version is listed: a_number follows sort_order,
-- and the answer's is_current / valid_from / valid_to say which one is live.
DROP VIEW IF EXISTS v_quiz_scoring_matrix;
CREATE VIEW v_quiz_scoring_matrix AS
SELECT
  qz.version                                                        AS quiz_version,
  qt.name                                                           AS quiz_type,
  q.q_number,
  q.q_text,
  ROW_NUMBER() OVER (PARTITION BY q.id ORDER BY a.sort_order NULLS LAST, a.id) AS a_number,
  a.answer_text,
  q.weight                                                          AS q_weight,
  a.weight                                                          AS ans_weight,
  ar_ans.name                                                       AS resulting_archetype,
  ar_score.name                                                     AS scored_archetype,
  aas.score                                                         AS ans_score,
  a.is_current                                                      AS is_current,
  a.valid_from                                                      AS valid_from,
  a.valid_to                                                        AS valid_to
FROM quiz_answer a
JOIN quiz_question q    ON q.id  = a.question_id
JOIN quiz      qz      ON qz.id = q.quiz_id
LEFT JOIN quiz_type qt ON qt.id = qz.quiz_type_id
LEFT JOIN coffee_archetype ar_ans   ON ar_ans.id = a.resulting_archetype_id
LEFT JOIN quiz_answer_archetype_score aas ON aas.answer_id = a.id
LEFT JOIN coffee_archetype ar_score ON ar_score.id = aas.archetype_id
ORDER BY quiz_version, q_number, a_number, ans_score DESC NULLS LAST;

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
JOIN coffee_archetype  a ON a.id = av.archetype_id
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
  COUNT(DISTINCT c.id)                                            AS coffee_count
FROM archetype_vector av
JOIN coffee_archetype  a ON a.id = av.archetype_id
JOIN coffee_dimensions d ON md5(d.name)::uuid = av.dimension_id
LEFT JOIN coffee_archetype_assignment aa
  ON aa.superseded_at IS NULL
  AND CASE aa.archetype
        WHEN 'chocolate_nutty' THEN 'Chocolate & Nutty'
        WHEN 'balanced_sweet'  THEN 'Balanced'
        WHEN 'fruity'          THEN 'Fruity'
        WHEN 'earthy'          THEN 'Earthy'
        WHEN 'floral'          THEN 'Floral'
        WHEN 'experimental'    THEN 'Experimental'
      END = a.name
-- Roastery lifecycle (2026-08-25): this view feeds the public archetype-stats
-- browse surface (GET /api/coffees/archetype-stats) — an inactive coffee's
-- cupping data must not move avg_actual/coffee_count for a customer browsing
-- an archetype. LEFT JOIN kept (not INNER) so a NULL aa.coffee_id — no
-- archetype match at all yet — still passes the AND cleanly.
LEFT JOIN coffees c ON c.id = aa.coffee_id AND c.is_active = true
LEFT JOIN cupping_session_coffees      sc  ON sc.coffee_id = c.id
LEFT JOIN cupping_scores       cs  ON cs.session_coffee_id = sc.id
LEFT JOIN cupping_score_values csv ON csv.cupping_score_id = cs.id
                                   AND csv.dimension_id = d.id
GROUP BY a.name, d.name, d.display_order,
         av.min_score, av.ideal_score, av.max_score
ORDER BY a.name, d.display_order;

-- v_dial_positions (coffee positions on each archetype's dial, keyed on
-- dial_archetype_positions/dial_position_vocabulary/dial_archetype_config)
-- and v_dial_navigation (directional hop graph, exposing the stored
-- dcr.hop_type) were dropped by Catalog Blueprint brief 5a — zero TS readers
-- of either as of brief 3's Task 0, and all three dropped tables plus the
-- dropped hop_type column would have broken these definitions outright.
-- coffee_dial_slot/coffee_slot_assignment (positions) and v_coffee_hop
-- (hop graph, hop_type_derived) are the live replacements.

-- v_coffee_archetype_adjacency moved below, after v_coffee_hop's own definition
-- (Catalog Blueprint brief 3, 2026-09-14) — it's now derived from
-- v_coffee_hop, which is defined later in this file (the Catalog Blueprint
-- views block), so its CREATE VIEW has to run after v_coffee_hop's. Search
-- "v_coffee_archetype_adjacency redefined" near the end of this file.

-- Dial position consensus (Phase 5 — dormant): weighted rollup of current
-- (non-superseded) dial_position_signal rows per (coffee_id, archetype).
-- With only 'cupping' weighted above zero today, this mirrors Phase 3's live
-- suggestion — becomes meaningfully different once other sources gain weight.
-- No auto-write to coffee_slot_assignment from this — read-only advisory.
-- Renamed from v_dial_position_consensus and re-keyed onto
-- dial_position_signal.suggested_slot_id (Catalog Blueprint brief 5a, A1) —
-- it is catalog-side. Output column kept as consensus_vocabulary_id (same
-- output columns, per the brief) even though the value is now a slot id;
-- nothing outside this file reads the field name (Phase 5 is dormant).
DROP VIEW IF EXISTS v_dial_position_consensus;
DROP VIEW IF EXISTS v_coffee_dial_position_consensus;
CREATE VIEW v_coffee_dial_position_consensus AS
WITH current_signals AS (
  SELECT dps.*, dsw.reliability_weight
  FROM dial_position_signal dps
  JOIN dial_source_weight dsw ON dsw.source = dps.source
  WHERE dps.superseded_at IS NULL
),
vocab_weights AS (
  SELECT coffee_id, archetype, suggested_slot_id,
         SUM(reliability_weight) AS weight_sum,
         MAX(reliability_weight) AS max_single_weight
  FROM current_signals
  WHERE suggested_slot_id IS NOT NULL
  GROUP BY coffee_id, archetype, suggested_slot_id
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY coffee_id, archetype
    ORDER BY weight_sum DESC, max_single_weight DESC
  ) AS rn
  FROM vocab_weights
),
totals AS (
  SELECT coffee_id, archetype,
         SUM(sample_size)                     AS total_sample_size,
         SUM(sample_size * reliability_weight) AS weighted_sample_size
  FROM current_signals
  GROUP BY coffee_id, archetype
)
SELECT
  t.coffee_id,
  t.archetype,
  r.suggested_slot_id AS consensus_vocabulary_id,
  t.total_sample_size,
  t.weighted_sample_size
FROM totals t
LEFT JOIN ranked r ON r.coffee_id = t.coffee_id AND r.archetype = t.archetype AND r.rn = 1;

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

-- ─────────────────────────────────────────────
-- FLAVOR INTELLIGENCE PAGE — origin region bucketing (2026-07-12)
-- Broad geographic region shown publicly in place of the exact `coffees.origin`
-- string, which stays server-side only (white-label/drop-ship confidentiality —
-- see backend/src/features/Flavor Intelligence Page/..._PART1_BACKEND.md Decision #7).
-- Seven values: five covering the real 29-coffee catalogue today, two kept as
-- deliberate headroom (caribbean, south_asia) for likely near-term additions.
-- ─────────────────────────────────────────────

INSERT INTO lookup_value (category, value, label, sort_order) VALUES
  ('origin_region', 'east_africa',     'East Africa',                1),
  ('origin_region', 'central_america', 'Central America',            2),
  ('origin_region', 'south_america',   'South America',              3),
  ('origin_region', 'sea_pacific',     'Southeast Asia & Pacific',   4),
  ('origin_region', 'multi_origin',    'Multi-Origin / Blend',       5),
  ('origin_region', 'caribbean',       'Caribbean',                  6),
  ('origin_region', 'south_asia',      'South Asia',                 7),
  -- Added 2026-07-14: for single-origin coffees whose roastery-provided origin string
  -- itself spans two regions (e.g. "Central/South America") — distinct from
  -- 'multi_origin', which is for actual blends (blend_or_single = 'blend'). Reflects
  -- the roastery's own label directly rather than forcing an inaccurate bucket.
  ('origin_region', 'central_south_america', 'Central & South America', 8)
ON CONFLICT (category, value) DO NOTHING;

-- Nullable, admin-set via AdminCoffees.tsx — no auto-derivation from the raw
-- `origin` free-text column (ambiguous strings like "Uganda & Ethiopia Blend"
-- make that unsafe to automate; see Decision #7 for the manual-backfill rationale).
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS origin_region_id INTEGER REFERENCES lookup_value(id);

-- ─────────────────────────────────────────────
-- COMPANY GIFT SUBSCRIPTIONS (2026-07-12)
-- Sponsored 3-month coffee perk a company buys as a gift for employees.
-- Each row is one purchased gift batch (a specific purchase event), not a
-- persistent company profile — a repeat buyer gets a second, independent row.
-- See backend/src/features/b2b_company_subscriptions/CLAUDE_CODE_PROMPT_B2B_COMPANY_SUBSCRIPTIONS.md
-- for the full decisions log this schema is built against.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_gift (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name         TEXT NOT NULL,
  seat_count           INTEGER NOT NULL CHECK (seat_count > 0),
  sponsorship_months   INTEGER NOT NULL DEFAULT 3,
  admin_contact_name   TEXT,
  admin_contact_email  TEXT NOT NULL,
  code_redeem_by       DATE,              -- optional outer deadline to redeem a code at all; NULL = no deadline
  payment_notes        TEXT,              -- internal only: terms, invoice #, wire ref, etc. Never surfaced to employees.
  payment_confirmed_at TIMESTAMPTZ,       -- NULL = payment not yet confirmed. Codes exist and can be previewed/exported, but are inert (not redeemable) until this is set. Admin action ("Mark as Paid") sets this to now().
  total_amount_cents   INTEGER,           -- what was actually charged for this batch, for internal revenue reporting only (never surfaced to employees). Nullable — a deal negotiated a bespoke total, not necessarily seat_count × a per-seat rate, so store the agreed total directly rather than assuming linear per-seat pricing.
  created_by_admin_id  UUID REFERENCES user_profile(id),
  created_at           TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS company_gift_code (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_gift_id      UUID REFERENCES company_gift(id) ON DELETE CASCADE,
  code                 TEXT UNIQUE NOT NULL,   -- e.g. 8-char human-friendly token, uppercase, no ambiguous chars (0/O, 1/I)
  status               TEXT NOT NULL DEFAULT 'unredeemed',  -- 'unredeemed' | 'redeemed' | 'expired'
  redeemed_by_user_id  UUID REFERENCES user_profile(id),
  redeemed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_company_gift_code_gift   ON company_gift_code(company_gift_id);
CREATE INDEX IF NOT EXISTS idx_company_gift_code_status ON company_gift_code(company_gift_id, status);

-- Nullable additions to existing tables, same pattern as household_id on subscription/order today
ALTER TABLE subscription  ADD COLUMN IF NOT EXISTS company_gift_id UUID REFERENCES company_gift(id);
ALTER TABLE subscription  ADD COLUMN IF NOT EXISTS sponsored_expires_at TIMESTAMPTZ;  -- NULL for normal (non-sponsored) subscriptions
-- Quiet internal marker only, never surfaced to other employees or shown as a persistent badge —
-- drives the Phase 3 lifecycle nudge only. A user can hold both household_id and company_gift_id
-- at once (e.g. family household + separately redeemed work perk) — independent, not exclusive.
ALTER TABLE user_profile  ADD COLUMN IF NOT EXISTS company_gift_id UUID REFERENCES company_gift(id);

-- Round 2 follow-up: per-gift custom wording for the HR handoff email. NULL = use the
-- default brand-voice template (buildEmailTemplate() in companyGiftsAdmin.ts); non-null =
-- this specific gift's admin-edited override. Must always contain the literal {{CODE}}
-- placeholder — enforced at the API layer (PATCH .../email-template), not by a DB constraint,
-- since Postgres CHECK constraints can't easily assert substring presence cleanly here.
ALTER TABLE company_gift ADD COLUMN IF NOT EXISTS email_template_override TEXT;

-- Round 2 follow-up: a stable company identity, separate from company_gift purchase
-- batches — lets two company_gift rows (e.g. a repeat buyer months later) be recognized
-- as the same employer instead of only eyeballing free-text company_name. Not a
-- user_profile — a company doesn't authenticate, take the quiz, or have a household; this
-- codebase's one schema term for people who do is "user" (see
-- customer_life_cycle/1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md's terminology note).
CREATE TABLE IF NOT EXISTS company (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name          TEXT NOT NULL,
  primary_contact_name  TEXT,
  primary_contact_email TEXT,
  notes                 TEXT,   -- relationship notes spanning all purchases, separate from any single gift's payment_notes
  created_at            TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- company_gift already exists live, so this must be an explicit ALTER, not folded into
-- the CREATE TABLE above (a CREATE TABLE IF NOT EXISTS block would be a no-op here).
-- company_gift.company_name/admin_contact_name/admin_contact_email stay as-is — they're a
-- snapshot of what was true at purchase time (same pattern as "order"'s shipping-address
-- snapshot elsewhere in this schema), not a live reference to company. Pre-migration rows
-- get company_id = NULL — expected, not backfilled by fuzzy name-matching.
ALTER TABLE company_gift ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES company(id);

-- Step 02 (B1): first-party quiz funnel logging — source of truth for the funnel since
-- POST /api/quiz/score is public and guests dominate quiz traffic. session_key is a
-- per-quiz-session crypto.randomUUID() generated client-side (in-memory only).
CREATE TABLE IF NOT EXISTS quiz_funnel_event (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key TEXT NOT NULL,
  event       TEXT NOT NULL CHECK (event IN ('quiz_start', 'quiz_complete', 'email_submitted', 'quiz_final')),
  archetype   TEXT,
  created_at  TIMESTAMPTZ DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_quiz_funnel_event_session ON quiz_funnel_event(session_key);
CREATE INDEX IF NOT EXISTS idx_quiz_funnel_event_created ON quiz_funnel_event(created_at);

-- Quiz Resync Fix Part A4 (2026-09-25) — widen the event CHECK for an
-- existing table (CREATE TABLE IF NOT EXISTS above is a no-op once the table
-- exists, so the constraint must be widened explicitly). Idempotent: the
-- constraint name is Postgres's own default for this column, confirmed live
-- against prod before writing this; safe to re-run (DROP IF EXISTS + re-ADD
-- every boot is cheap on this table's row count).
ALTER TABLE quiz_funnel_event DROP CONSTRAINT IF EXISTS quiz_funnel_event_event_check;
ALTER TABLE quiz_funnel_event ADD CONSTRAINT quiz_funnel_event_event_check
  CHECK (event IN ('quiz_start', 'quiz_complete', 'email_submitted', 'quiz_final'));

-- Hoboken Coffee Crawl (2026-08-31): campaign attribution, orthogonal to source.
-- vid = anonymous per-phone visitor key minted on the landing page; joins scan → quiz → email.
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

-- One row per campaign: scans (distinct phones), quiz starts, completes, emails.
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

-- Per-archetype split of campaign subscribers (for Camila's follow-up and the draw).
CREATE OR REPLACE VIEW campaign_subscriber_archetype_v AS
SELECT campaign, archetype, COUNT(*) AS subscribers
FROM newsletter_subscriber WHERE campaign IS NOT NULL
GROUP BY campaign, archetype ORDER BY campaign, subscribers DESC;

-- ─────────────────────────────────────────────
-- Step 06 (B3): reporting views, read-only role, admin Marketing config.
-- Views feed the Looker Studio marketing dashboard (alongside GA4 + the manual
-- Ad Spend sheet). reporting_ro gets SELECT on these views ONLY, never on base
-- tables. See launch/20_analytics-and-tracking/README.md for the manual GCP steps.
-- ─────────────────────────────────────────────

-- Weekly newsletter signups, broken down by source. DROP first — CREATE OR
-- REPLACE cannot rename existing columns (PG restriction), and this file reruns
-- on every startup.
DROP VIEW IF EXISTS v_subscribers_weekly;
CREATE VIEW v_subscribers_weekly AS
  SELECT
    date_trunc('week', ns.created_at)::date AS week,
    COALESCE(ss.label, 'Unknown')           AS source,
    COUNT(*)                                AS new_subscribers
  FROM newsletter_subscriber ns
  LEFT JOIN subscriber_source ss ON ss.id = ns.source_id
  GROUP BY 1, 2
  ORDER BY 1 DESC, 2;

-- Weekly quiz funnel from the first-party quiz_funnel_event log (source of
-- truth — guests dominate quiz traffic and GA4 undercounts them).
DROP VIEW IF EXISTS v_quiz_funnel_weekly;
CREATE VIEW v_quiz_funnel_weekly AS
  SELECT
    date_trunc('week', created_at)::date                             AS week,
    COUNT(*) FILTER (WHERE event = 'quiz_start')                     AS starts,
    COUNT(*) FILTER (WHERE event = 'quiz_complete')                  AS completes,
    COUNT(*) FILTER (WHERE event = 'email_submitted')                AS emails_submitted,
    ROUND(
      COUNT(*) FILTER (WHERE event = 'quiz_complete')::numeric
      / NULLIF(COUNT(*) FILTER (WHERE event = 'quiz_start'), 0) * 100, 1
    )                                                                 AS completion_rate,
    ROUND(
      COUNT(*) FILTER (WHERE event = 'email_submitted')::numeric
      / NULLIF(COUNT(*) FILTER (WHERE event = 'quiz_complete'), 0) * 100, 1
    )                                                                 AS optin_rate
  FROM quiz_funnel_event
  GROUP BY 1
  ORDER BY 1 DESC;

-- Newsletter subscribers by archetype (only populated when signup originated
-- from a quiz completion — see the archetype column added in Step 04).
DROP VIEW IF EXISTS v_archetype_distribution;
CREATE VIEW v_archetype_distribution AS
  SELECT
    archetype,
    COUNT(*)                                                             AS subscriber_count,
    ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) AS share
  FROM newsletter_subscriber
  WHERE archetype IS NOT NULL
  GROUP BY archetype
  ORDER BY subscriber_count DESC;

-- Weekly orders/revenue. Empty "order" table pre-launch returns zero rows,
-- not an error — no special-casing needed.
DROP VIEW IF EXISTS v_orders_weekly;
CREATE VIEW v_orders_weekly AS
  WITH first_orders AS (
    SELECT user_id, MIN(created_at) AS first_order_at
    FROM "order"
    WHERE user_id IS NOT NULL
    GROUP BY user_id
  )
  SELECT
    date_trunc('week', o.created_at)::date                          AS week,
    COUNT(*)                                                        AS orders,
    COUNT(DISTINCT fo.user_id) FILTER (
      WHERE date_trunc('week', fo.first_order_at) = date_trunc('week', o.created_at)
    )                                                                AS new_customers,
    ROUND(SUM(o.total_amount_paid) * 100)::bigint                   AS revenue_cents
  FROM "order" o
  LEFT JOIN first_orders fo ON fo.user_id = o.user_id
  GROUP BY 1
  ORDER BY 1 DESC;

-- >>> quiz_session_interpretation (quiz interpretation v2.1, brief 2 — 2026-09-25)
-- SCD Type 2 over the immutable quiz_session fact: one row per session PER INTERPRETATION VERSION (never per
-- user), exactly one row per session flagged is_current = "produced by the latest deployed ruleset". Old rows
-- are history, kept forever. This is the ONLY table brief 2 writes; quiz_session / newsletter_subscriber are
-- never updated, deleted or altered. No ON DELETE CASCADE on the FK: we never delete.
-- Not here on purpose: primary archetype, branched_from, scores, answers, treat, gate (they live on the fact).
CREATE TABLE IF NOT EXISTS quiz_session_interpretation (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id         UUID NOT NULL REFERENCES quiz_session(id),
  interpretation_version  TEXT NOT NULL,
  secondary_archetype     TEXT,
  secondary_path          TEXT,
  recommendation_mode     TEXT NOT NULL,
  food_signal_alignment   TEXT NOT NULL,
  pair_confidence         TEXT,
  explore_archetype       TEXT,
  explore_reason          TEXT,
  primary_margin          SMALLINT,
  is_current              BOOLEAN NOT NULL DEFAULT false,
  valid_from              TIMESTAMPTZ NOT NULL,
  valid_to                TIMESTAMPTZ,
  computed_by             TEXT NOT NULL CHECK (computed_by IN ('scored', 'seed', 'backfill')),
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quiz_session_id, interpretation_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS quiz_session_interpretation_current
  ON quiz_session_interpretation (quiz_session_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_qsi_version ON quiz_session_interpretation (interpretation_version);

-- Interpretation v2.2 (Prompt 4B, 2026-10-09): three layers recorded separately. SHOWN stays where it was
-- (quiz_session.resulting_archetype_id; what the screen and email said). MATCH: where on the Bloom Dial we match
-- the person, on the interpretation row (match_archetype; intensity_lean 'delicate' or NULL = the archetype's
-- default position). WHY: the raw branch answer, on the session (branch_answer_id). Single writers:
-- quizSession.saveQuizInterpretation (match/lean; every v2.2 row has match_archetype, v1/v2.1 rows stay NULL) and
-- quizSession.saveQuizSession (branch_answer_id, set in the INSERT only, never updated, never backfilled).
ALTER TABLE quiz_session_interpretation ADD COLUMN IF NOT EXISTS match_archetype TEXT;
ALTER TABLE quiz_session_interpretation ADD COLUMN IF NOT EXISTS intensity_lean  TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_session_interpretation_intensity_lean_check') THEN
    ALTER TABLE quiz_session_interpretation ADD CONSTRAINT quiz_session_interpretation_intensity_lean_check
      CHECK (intensity_lean IN ('delicate'));
  END IF;
END $$;
ALTER TABLE quiz_session ADD COLUMN IF NOT EXISTS branch_answer_id UUID REFERENCES quiz_answer(id);
-- <<< quiz_session_interpretation

-- >>> quiz_interpretation_views (quiz interpretation v2.1, brief 3 — 2026-09-25)
-- Read-only: one IMMUTABLE function and two views. Nothing here inserts, updates, deletes or alters a table.

-- Canonical archetype names: values frozen as text before the September rename (context_data strings, the v1
-- seed rows, newsletter_subscriber.archetype) map to today's coffee_archetype.name; anything else is unchanged.
CREATE OR REPLACE FUNCTION quiz_archetype_canonical(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE t
    WHEN 'Balanced & Sweet'   THEN 'Balanced'
    WHEN 'Balanced and Sweet' THEN 'Balanced'
    WHEN 'Fruity & Complex'   THEN 'Fruity'
    WHEN 'Spicy & Earthy'     THEN 'Earthy'
    ELSE t
  END
$$;

-- Subscriber x quiz outcome (2026-09-20, CLAUDE_CODE_PROMPT_SUBSCRIBER_QUIZ_RESULTS_VIEW.md; reads the current
-- quiz_session_interpretation row since 2026-09-25, brief 3).
-- One row per subscriber; quiz columns from that subscriber's MOST RECENT quiz_session via
-- newsletter_subscriber.user_id. Unlinked subscribers / no session still appear with NULL quiz columns.
-- The interpretation columns (secondary_archetype, recommendation_mode, food_signal_alignment and the new
-- secondary_path, pair_confidence, explore_*, primary_margin, interpretation_*) come from the session's CURRENT
-- interpretation row; what the customer was told on the day stays available beside them as *_as_scored (frozen
-- in context_data). Scores are read from context_data->'scores' (keys = archetype display names as scored at the
-- time; COALESCE tolerates the pre-rename Balanced / Fruity keys). quiz_result_json keeps the full raw payload.
-- Existing columns keep their names and positions (only confidence_at_signup was renamed, in place); new
-- columns are appended after user_id.
DROP VIEW IF EXISTS v_subscriber_quiz_results;
CREATE VIEW v_subscriber_quiz_results AS
WITH latest_session AS (
  SELECT DISTINCT ON (qs.user_id)
         qs.user_id,
         qs.id            AS quiz_session_id,
         qs.completed_at,
         ca.name          AS primary_archetype,
         qs.context_data  AS ctx,
         i.interpretation_version,
         i.secondary_archetype    AS i_secondary_archetype,
         i.secondary_path,
         i.recommendation_mode    AS i_recommendation_mode,
         i.food_signal_alignment  AS i_food_signal_alignment,
         i.pair_confidence,
         i.explore_archetype,
         i.explore_reason,
         i.primary_margin,
         i.computed_by            AS interpretation_computed_by,
         i.valid_from             AS interpretation_valid_from,
         COALESCE(i.match_archetype, ca.name) AS match_archetype,
         i.intensity_lean,
         ba.answer_code           AS branch_answer_code
  FROM quiz_session qs
  LEFT JOIN coffee_archetype ca ON ca.id = qs.resulting_archetype_id
  LEFT JOIN quiz_session_interpretation i ON i.quiz_session_id = qs.id AND i.is_current
  LEFT JOIN quiz_answer ba ON ba.id = qs.branch_answer_id
  WHERE qs.user_id IS NOT NULL
  ORDER BY qs.user_id, qs.completed_at DESC
)
SELECT
  ns.email,
  ns.first_name,
  ns.created_at                                   AS subscribed_at,
  ss.label                                        AS source,
  ns.campaign,
  ns.campaign_attributed_at,
  ns.subscribed,
  quiz_archetype_canonical(ns.archetype)          AS archetype_at_signup,
  ns.confidence                                   AS food_signal_alignment_at_signup,
  ns.experimental                                 AS experimental_at_signup,
  ls.primary_archetype,
  quiz_archetype_canonical(ls.i_secondary_archetype)   AS secondary_archetype,
  ls.i_recommendation_mode                        AS recommendation_mode,
  quiz_archetype_canonical(ls.ctx ->> 'foodSignal')    AS food_signal,
  ls.i_food_signal_alignment                      AS food_signal_alignment,
  (ls.ctx ->> 'experimental')::boolean            AS experimental,
  (ls.ctx ->> 'decaf')::boolean                   AS decaf,
  (ls.ctx -> 'scores' ->> 'Chocolate & Nutty')::numeric                                                      AS score_chocolate_nutty,
  COALESCE(ls.ctx -> 'scores' ->> 'Balanced', ls.ctx -> 'scores' ->> 'Balanced & Sweet')::numeric            AS score_balanced,
  COALESCE(ls.ctx -> 'scores' ->> 'Fruity',   ls.ctx -> 'scores' ->> 'Fruity & Complex')::numeric            AS score_fruity,
  (ls.ctx -> 'scores' ->> 'Earthy')::numeric                                                                 AS score_earthy,
  (ls.ctx -> 'scores' ->> 'Floral')::numeric                                                                 AS score_floral,
  (ls.ctx -> 'scores' ->> 'Experimental')::numeric                                                           AS score_experimental,
  ls.ctx -> 'scores'                              AS scores_json,
  ls.ctx                                          AS quiz_result_json,   -- the full saved quiz result payload as the API received it
  ls.completed_at                                 AS quiz_completed_at,
  ls.quiz_session_id,
  ns.user_id,
  -- appended by brief 3 (2026-09-25)
  ls.secondary_path,
  ls.pair_confidence,
  ls.explore_archetype,
  ls.explore_reason,
  ls.primary_margin,
  ls.interpretation_version,
  ls.interpretation_computed_by,
  ls.interpretation_valid_from,
  quiz_archetype_canonical(ls.ctx ->> 'secondaryArchetype') AS secondary_archetype_as_scored,
  ls.ctx ->> 'recommendationMode'                 AS recommendation_mode_as_scored,
  ls.ctx ->> 'foodSignalAlignment'                AS food_signal_alignment_as_scored,
  quiz_archetype_canonical(ls.ctx ->> 'branchedFrom')   AS branched_from,
  ls.ctx ->> 'foodSignal'                         AS food_signal_raw,
  -- appended by Prompt 4B (interpretation v2.2, 2026-10-09): the match layer and the raw branch answer.
  -- match_archetype is never NULL for a session: rows before v2.2 match the shown archetype.
  ls.match_archetype,
  ls.intensity_lean,
  ls.branch_answer_code
FROM newsletter_subscriber ns
LEFT JOIN subscriber_source ss ON ss.id = ns.source_id
LEFT JOIN latest_session    ls ON ls.user_id = ns.user_id;

-- One row per session per interpretation version: the calibration surface. Pivot WHERE interpretation_version
-- IN ('v1','v2.1') by session for before/after on any set of sessions; the next event's export is
-- WHERE completed_at >= <event>.
DROP VIEW IF EXISTS v_quiz_session_interpretation_history;
CREATE VIEW v_quiz_session_interpretation_history AS
SELECT
  qs.id                                           AS quiz_session_id,
  qs.user_id,
  qs.completed_at,
  ca.name                                         AS final_archetype,
  quiz_archetype_canonical(qs.context_data ->> 'branchedFrom') AS branched_from,
  i.interpretation_version,
  i.is_current,
  i.valid_from,
  i.valid_to,
  i.computed_by,
  quiz_archetype_canonical(i.secondary_archetype) AS secondary_archetype,
  i.secondary_path,
  i.recommendation_mode,
  i.food_signal_alignment,
  i.pair_confidence,
  i.explore_archetype,
  i.explore_reason,
  i.primary_margin,
  -- appended by Prompt 4B (interpretation v2.2, 2026-10-09)
  COALESCE(i.match_archetype, ca.name)            AS match_archetype,
  i.intensity_lean,
  ba.answer_code                                  AS branch_answer_code
FROM quiz_session_interpretation i
JOIN quiz_session qs ON qs.id = i.quiz_session_id
LEFT JOIN coffee_archetype ca ON ca.id = qs.resulting_archetype_id
LEFT JOIN quiz_answer ba ON ba.id = qs.branch_answer_id;
-- <<< quiz_interpretation_views

-- Read-only reporting role for Looker Studio. Created NOLOGIN — no credential
-- ever lives in this file or git history. Dana enables LOGIN + sets a real
-- password manually (see README's "Manual GCP steps"), sourced from Secret Manager.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_ro') THEN
    CREATE ROLE reporting_ro NOLOGIN;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO reporting_ro', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO reporting_ro;
-- Views only — re-granted every startup since DROP VIEW above revokes any
-- privileges granted directly on the old view object.
GRANT SELECT ON
  v_subscribers_weekly,
  v_quiz_funnel_weekly,
  v_archetype_distribution,
  v_orders_weekly,
  v_subscriber_quiz_results,
  v_quiz_session_interpretation_history
TO reporting_ro;

-- Admin-editable marketing dashboard links. One settable row per link so Dana
-- can paste the Looker Studio report URL in once M3 assembles it, without a
-- redeploy (Mailchimp audience / Ad Spend sheet URLs are editable the same way).
CREATE TABLE IF NOT EXISTS marketing_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);
INSERT INTO marketing_config (key, value) VALUES
  ('looker_studio_url',      NULL),
  ('mailchimp_audience_url', NULL),
  ('adspend_sheet_url',      NULL)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────
-- HOME_TASK_7 (§3.1, QR indirection) — the QR door. One opaque token per
-- coffee, printed once into label artwork, resolved fresh by the server on
-- every scan: "never print a URL whose meaning is fixed — print a pointer
-- the server re-aims." A `coffees.qr_token` column, not a separate
-- `coffee_qr_token` table, per the spec's own decision point — the product
-- is explicitly one code per coffee ("Noam Blend gets its own QR"), never
-- per-bag/per-order, so there is no plural relationship to model. Nullable
-- until minted (POST /api/admin/qr/mint/:coffeeId); once set, never
-- regenerated for an active coffee (print immutability cuts both ways, same
-- rule as the token's own opacity).
-- ─────────────────────────────────────────────

ALTER TABLE coffees ADD COLUMN IF NOT EXISTS qr_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS coffees_qr_token_key ON coffees(qr_token) WHERE qr_token IS NOT NULL;

DO $$ BEGIN
  -- 'unresolved' is this schema's own addition beyond the task spec's literal
  -- three values (owner | signed_out | non_owner) — those three only make
  -- sense once a token has resolved to a coffee AND that coffee is live, i.e.
  -- the owner/signed-out/non-owner branches. An unknown token or a retired-
  -- coffee scan short-circuits before ownership is ever checked, so neither
  -- "owner" nor "non_owner" would be an honest label (a signed-in customer
  -- scanning a retired coffee they genuinely did buy is not a "non_owner" —
  -- ownership was simply never evaluated). Logged here rather than silently
  -- picking one of the three incorrectly.
  -- 'no_orders' added HOME_TASK_7C (universal QR, 2026-08-03) — a signed-in
  -- customer scanning the universal code with zero order history is a real,
  -- distinct case a universal-token scan can produce that a per-coffee token
  -- never could (there's no specific coffee to be a "non_owner" of). Same
  -- honesty rule as 'unresolved': don't force it into an inaccurate label.
  CREATE TYPE qr_auth_state_enum AS ENUM ('owner', 'signed_out', 'non_owner', 'unresolved', 'no_orders');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE qr_auth_state_enum ADD VALUE IF NOT EXISTS 'no_orders';

DO $$ BEGIN
  CREATE TYPE qr_destination_enum AS ENUM ('bag_view', 'sign_in', 'story_page', 'retired_story', 'unknown', 'bag_picker', 'brand_landing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- 'bag_picker'/'brand_landing' added HOME_TASK_7C — the two new destinations
-- a universal-token scan can produce that a per-coffee scan never could
-- (2+ plausible active bags; a signed-in customer with none at all).
ALTER TYPE qr_destination_enum ADD VALUE IF NOT EXISTS 'bag_picker';
ALTER TYPE qr_destination_enum ADD VALUE IF NOT EXISTS 'brand_landing';
-- 'door_choice' added bag_qr (2026-10-05) — a signed-out universal scan (bare
-- /b or the long form) now lands on the two-door page, not straight at sign-in.
ALTER TYPE qr_destination_enum ADD VALUE IF NOT EXISTS 'door_choice';

DO $$ BEGIN
  CREATE TYPE qr_token_type_enum AS ENUM ('coffee', 'universal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Scan analytics point (closing pass, §3.1) — every resolve of a token logs
-- one row here, this is the only data source for the per-bag engagement
-- metric in §7. No PII beyond user_id (nullable — populated only when the
-- scanner was signed in); no IP, no user-agent.
CREATE TABLE IF NOT EXISTS qr_scan_event (
  id          SERIAL PRIMARY KEY,
  token       TEXT NOT NULL,
  coffee_id   INT REFERENCES coffees(id) ON DELETE SET NULL,
  auth_state  qr_auth_state_enum NOT NULL,
  destination qr_destination_enum NOT NULL,
  user_id     UUID REFERENCES user_profile(id) ON DELETE SET NULL,
  scanned_at  TIMESTAMPTZ DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS qr_scan_event_coffee_id_idx ON qr_scan_event(coffee_id);
CREATE INDEX IF NOT EXISTS qr_scan_event_token_idx     ON qr_scan_event(token);
CREATE INDEX IF NOT EXISTS qr_scan_event_scanned_at_idx ON qr_scan_event(scanned_at);

-- ─────────────────────────────────────────────
-- HOME_TASK_7C — The universal printed QR (decision 2026-08-03, strategy §9).
-- "The printed QR is universal — one identical code on every bag, every
-- coffee, both roasteries." Per-coffee tokens (above) stay exactly as they
-- are for digital links (story pages, emails); this is a second, additive
-- token type, not a replacement — resolved through the same /b/{token}
-- endpoint, never a fork. One row per roastery/print run (source-labeled,
-- e.g. 'path', 'temecula') so scan analytics stay segmentable at zero
-- operational cost. Same immutability rule as coffee tokens: never
-- regenerate one that's been printed.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_universal_token (
  id         SERIAL PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  source     TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- token_type/source are additive on the existing scan-event table, per the
-- task's own instruction ("no schema change beyond what a source/type column
-- needs"). token_type defaults 'coffee' so every historical row (all
-- per-coffee scans, the only kind that existed before this task) backfills
-- correctly without a data migration. source is NULL for coffee-token scans
-- (coffee_id already identifies those uniquely) and populated only for
-- universal-token scans.
ALTER TABLE qr_scan_event ADD COLUMN IF NOT EXISTS token_type qr_token_type_enum NOT NULL DEFAULT 'coffee';

-- C2 -- Global Claude aggregate kill-switch (2026-08-08). One row per UTC
-- calendar date, atomically incremented after every successful Anthropic
-- call across every Claude call site in the app -- real usage-based cost
-- (input/output tokens x the per-model rate), never a flat call count -- by
-- guardClaudeCall() (backend/src/services/anthropicGuard.ts), the single
-- shared gate every call site passes through before hitting Anthropic.
-- Postgres, not in-memory, so the total is cross-instance by construction
-- (Cloud Run runs multiple instances). CLAUDE_GLOBAL_DAILY_USD (env,
-- default 20) is the ceiling checked against this table before each call;
-- CLAUDE_ENABLED (env, default true) is a separate manual kill-switch that
-- never even reads this table.
--
-- AI Operations admin page (2026-08-10) -- gained per-feature attribution
-- (PK date -> (date, feature)) so the admin page can show/cap spend per
-- feature group, not just the aggregate. Fresh environments get the new
-- shape directly below; an already-deployed table needs the composite PK
-- swap applied as an ordered manual migration first -- see
-- backend/src/db/migrations/claude_daily_spend_feature_2026_08_10.sql --
-- the PK change is deliberately NOT in this automatic startup batch (it
-- must land in lockstep with the code deploy, not before, or the
-- currently-deployed old code's `ON CONFLICT (date)` stops matching any
-- unique constraint). The idempotent ADD COLUMN below is safe standalone --
-- it's what lets a fresh environment's CREATE TABLE and an old deployed
-- table's ALTER converge on the same shape without either ever failing.
CREATE TABLE IF NOT EXISTS claude_daily_spend (
  date       DATE NOT NULL,
  feature    TEXT NOT NULL DEFAULT 'unattributed',
  cents      INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  PRIMARY KEY (date, feature)
);
ALTER TABLE claude_daily_spend ADD COLUMN IF NOT EXISTS feature TEXT NOT NULL DEFAULT 'unattributed';

-- Liam access & cost brief (2026-10-01) -- spend in micro-dollars (1 USD =
-- 1,000,000). Every call used to be rounded UP to a whole cent, so an 8-turn
-- Liam conversation always read as exactly $0.16. usd_micros is now the only
-- spend column written (anthropicGuard.ts recordSpendMicros, rounded up to
-- the next micro-dollar per call) and the only one read (the guard's cap
-- checks, GET /api/admin/ai-ops). No dual-write.
--
-- Backfill: rows from before this change carry their total in `cents` only.
-- Re-runs every boot but can only ever match those old rows -- a row written
-- by the new code has cents = 0, and an already-backfilled row has
-- usd_micros > 0.
ALTER TABLE claude_daily_spend ADD COLUMN IF NOT EXISTS usd_micros BIGINT NOT NULL DEFAULT 0;
UPDATE claude_daily_spend SET usd_micros = cents::BIGINT * 10000 WHERE usd_micros = 0 AND cents > 0;
COMMENT ON COLUMN claude_daily_spend.cents IS
  'FROZEN 2026-10-01: superseded by usd_micros (Liam access & cost brief). Not read or written by the app; kept for history. Removal tracked in OPEN_TASKS.md OT-30.';

ALTER TABLE qr_scan_event ADD COLUMN IF NOT EXISTS source TEXT;

-- C3 -- terminal generation-failure flags (2026-08-08). Distinguishes "never
-- attempted yet" (column NULL, flag NULL/false -- eligible for the cron
-- backfill to try) from "attempted with sufficient data and Claude
-- genuinely declined/refused" (flag true -- the cron backfill skips it
-- forever, so a permanently-refusing coffee doesn't burn Claude spend on
-- every run). Only set on a real, non-blocked attempt that came back
-- refusal-like (looksLikeRefusal) or, for story text, exhausted its retry
-- loop without passing the specificity check -- never set when generation
-- was skipped for insufficient data (that's not terminal, worth retrying
-- once real data arrives) or blocked by the C2 guard (not an attempt at
-- all). An admin's explicit force-regenerate (force=true) ignores these
-- flags and always retries, resetting the flag on success.
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS ai_summary_generation_failed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS surprise_note_generation_failed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS three_voice_story_generation_failed BOOLEAN NOT NULL DEFAULT false;

-- api_event -- capture-first API event log (2026-08-13). Every mutating
-- (POST/PUT/PATCH/DELETE) API request's raw payload is written here *before*
-- the handler runs, via a single app-level middleware
-- (backend/src/middleware/apiEventLog.ts) mounted once in index.ts -- no
-- route or router opts in individually. If a processing bug silently drops
-- data downstream, the raw request survives here and can be replayed
-- manually (see backend/src/features/api_event_log/REPLAY.md). A row with
-- response_status IS NULL means the request was captured but never
-- finished (crash/abort) -- that is itself a signal worth querying for.
-- Retention: purged by age via GET /api/cron/purge-api-events (see
-- routes/cron.ts), default 90 days -- payloads can contain emails/names, so
-- this is data hygiene, not just disk space.
CREATE TABLE IF NOT EXISTS api_event (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  call_type     TEXT NOT NULL,          -- e.g. 'POST /api/quiz/results'
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,          -- originalUrl without query string
  firebase_uid  TEXT,                   -- null until auth middleware ran; filled at finish
  is_anonymous  BOOLEAN,                -- req.isAnonymous at finish, null if unknown
  request_body  JSONB,                  -- redacted + truncated, see apiEventLog.ts
  body_truncated BOOLEAN NOT NULL DEFAULT false,
  response_status INTEGER,              -- null = request never finished (crash/abort)
  response_error JSONB,                 -- response body when status >= 400, truncated
  duration_ms   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_event_call_type_time ON api_event (call_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_event_time ON api_event (occurred_at);
CREATE INDEX IF NOT EXISTS idx_api_event_uid ON api_event (firebase_uid) WHERE firebase_uid IS NOT NULL;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS story_generation_failed BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────
-- CATALOG BLUEPRINT · brief 1 (2026-09-13) — views
-- See backend/src/features/catalog_blueprint/CLAUDE_CODE_PROMPT_CATALOG_1_SCHEMA_VIEWS_INTEGRITY.md
-- Do not filter inactive rows *inside* these views (expose is_active columns
-- instead, so admin "show inactive" can still read them) — the one exception
-- is v_coffee_sellable_slot, whose whole meaning is "active and buyable".
-- ─────────────────────────────────────────────

-- Drop in reverse dependency order first (v_coffee_slot/v_coffee_sellable_slot/
-- v_coffee_hop all read v_coffee; v_coffee_sellable_slot reads
-- v_coffee_sellable_candidate; v_coffee_archetype_adjacency reads v_coffee_hop —
-- all as of brief 3) — same fix as v_archetype_dimension_comparison/
-- v_archetype_vectors above: a bare DROP VIEW IF EXISTS v_coffee on a second
-- boot fails with "other objects depend on it" once the dependents exist.
-- v_coffee and v_coffee_sellable_slot dropped out of this preamble by
-- Customer Blueprint C3 (2026-09-27): they now have permanent dependents far
-- below in the C3 block (v_customer_timeline/v_palate_archetype_spread and
-- v_palate_slot_candidates respectively) that this preamble can't reach, so
-- a plain drop-then-recreate here would fail every second boot the same way
-- this comment already describes. Both are CREATE OR REPLACE at their own
-- definitions below instead — see those for why that's safe (no column
-- rename here, ever, without an explicit CASCADE plan).
-- v_coffee_sellable_candidate joined v_coffee/v_coffee_sellable_slot's
-- CREATE-OR-REPLACE-only list above for the same reason: it is now a
-- permanent dependency of the never-dropped v_coffee_sellable_slot.
DROP VIEW IF EXISTS v_archetype_adjacency;
DROP VIEW IF EXISTS v_coffee_archetype_adjacency;
DROP VIEW IF EXISTS v_coffee_hop;
DROP VIEW IF EXISTS v_coffee_slot;
DROP VIEW IF EXISTS v_coffee_archetype;

-- One row per archetype (all six, including 'experimental'). This is what
-- replaces every hand-typed archetype_enum -> name/label CASE map in brief 3
-- (e.g. v_archetype_dimension_comparison above, admin.ts L55/L1760) — code is
-- the one identity (N2); `uuid` is exposed only for the legacy quiz FKs that
-- still key off it.
CREATE VIEW v_coffee_archetype AS
SELECT
  a.code,
  a.name                    AS label,
  a.description,
  a.sort_order,
  a.has_bloom_dial,
  a.is_archetype,
  a.dominant_dimension_id,
  d.name                    AS dominant_dimension_name,
  a.descriptor_families,
  a.id                      AS uuid
FROM coffee_archetype a
LEFT JOIN coffee_dimensions d ON d.id = a.dominant_dimension_id
ORDER BY a.sort_order;

-- One row per coffee, active or not. `roaster_name` is always the real FK
-- (roaster_id, NOT NULL as of Catalog Blueprint brief 5a) — the legacy
-- free-text `coffees.roaster` fallback and its roaster_name_is_fallback flag
-- are gone with the column (integrity check #11 now just asserts roaster_id
-- IS NOT NULL, guaranteed by the constraint, kept as a cheap assertion).
-- `match_archetype`/`match_confidence` is the coffee's current
-- (non-superseded) archetype_assignments row — its flavor identity (D1) —
-- never to be confused with placement; see v_coffee_slot below for that.
CREATE OR REPLACE VIEW v_coffee AS
SELECT
  c.id, c.name, c.origin, c.blend_or_single, c.process, c.roast_level, c.roast_shade,
  c.flavor_descriptors_roaster, c.ai_summary, c.surprise_note, c.three_voice_story,
  c.story, c.story_draft, c.story_published, c.story_admin_edited, c.story_generated_at,
  c.roaster_id,
  r.name                          AS roaster_name,
  aa.archetype                    AS match_archetype,
  aa.confidence                   AS match_confidence,
  aa.source                       AS match_source,
  aa.assigned_from_session_id     AS match_session_id,
  COALESCE(cat.category_codes, ARRAY[]::TEXT[]) AS category_codes,
  c.story_published               AS has_story,
  c.is_active, c.deactivated_at, c.deactivation_reason
FROM coffees c
LEFT JOIN roaster r              ON r.id = c.roaster_id
LEFT JOIN coffee_archetype_assignment aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
LEFT JOIN (
  SELECT cca.coffee_id, ARRAY_AGG(cc.code ORDER BY cc.code) AS category_codes
  FROM coffee_category_assignment cca
  JOIN coffee_category cc ON cc.id = cca.category_id
  GROUP BY cca.coffee_id
) cat ON cat.coffee_id = c.id;

-- One row per coffee_slot_assignment, active or not. `placement_archetype`
-- (the slot this row fulfils) and `match_archetype` (the coffee's flavor
-- identity, from v_coffee) are deliberately separate, never-renamed columns
-- (D1) — divergence between them is legitimate, never a bug, see integrity
-- check #7.
CREATE VIEW v_coffee_slot AS
SELECT
  csa.id                       AS assignment_id,
  csa.coffee_id,
  vc.name                      AS coffee_name,
  vc.roaster_id,
  csa.slot_id,
  cds.archetype                AS placement_archetype,
  cds.sort_order,
  cds.name                     AS slot_name,
  cds.position_label,
  csa.role,
  csa.priority,
  csa.is_active                AS assignment_is_active,
  vc.is_active                 AS coffee_is_active,
  csa.certified_at,
  csa.placement_note,
  vc.match_archetype,
  (cds.archetype = vc.match_archetype) AS placement_matches_match
FROM coffee_slot_assignment csa
JOIN coffee_dial_slot cds ON cds.id = csa.slot_id
JOIN v_coffee         vc  ON vc.id  = csa.coffee_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOG SIZES + VISIBILITY brief (2026-09-28) — Part A: coffee_size
-- See backend/src/features/catalog_sizes_visibility/CLAUDE_CODE_PROMPT_CATALOG_SIZES_AND_VISIBILITY.md
--
-- The bag-size list (S1). Every reader and writer of a weight goes through
-- this table (catalogReads.getSizes / getAnchorSize); a 4th size later is one
-- INSERT here, no code change. Writer: this idempotent seed only (same as
-- coffee_archetype in brief 1) — catalogService.ts has no verb that edits
-- sizes, and lint-catalog.mjs has coffee_size in DML_TABLES so any other TS
-- write fails CI. is_anchor (S2) = the size a coffee must have a SKU for,
-- Liam recommends, and subscriptions use; exactly one row.
-- order_line_item.weight_oz deliberately gets no FK: it is a purchase-time
-- snapshot.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS coffee_size (
  weight_oz   NUMERIC PRIMARY KEY CHECK (weight_oz > 0),
  label       TEXT NOT NULL,
  sort_order  INT NOT NULL UNIQUE,
  is_anchor   BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS coffee_size_one_anchor ON coffee_size ((true)) WHERE is_anchor;
INSERT INTO coffee_size (weight_oz, label, sort_order, is_anchor) VALUES
  (12, '12 oz', 1, true),
  (32, '2 lb',  2, false),
  (80, '5 lb',  3, false)
ON CONFLICT (weight_oz) DO NOTHING;

-- Task 0 (2026-09-28) confirmed test + prod hold only 12 / 80 in these three
-- tables, so the FKs are safe to add (idempotent, by constraint name).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_sku_weight_oz_fkey') THEN
    ALTER TABLE coffee_sku ADD CONSTRAINT coffee_sku_weight_oz_fkey FOREIGN KEY (weight_oz) REFERENCES coffee_size(weight_oz);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_slot_price_weight_oz_fkey') THEN
    ALTER TABLE coffee_slot_price ADD CONSTRAINT coffee_slot_price_weight_oz_fkey FOREIGN KEY (weight_oz) REFERENCES coffee_size(weight_oz);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coffee_retail_price_weight_oz_fkey') THEN
    ALTER TABLE coffee_retail_price ADD CONSTRAINT coffee_retail_price_weight_oz_fkey FOREIGN KEY (weight_oz) REFERENCES coffee_size(weight_oz);
  END IF;
END $$;

-- Catalog write-door brief (2026-09-30): stock tracking retired. We don't hold
-- inventory (roasters drop-ship every order); a SKU's availability is its
-- is_active switch ("Available from roaster" / "Paused"). The columns stay
-- (no DROP, no UPDATE of existing values) but are marked deprecated, and
-- lint-catalog.mjs rule 6 fails any app reference to them.
COMMENT ON COLUMN coffee_sku.quantity_available IS 'DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.';
COMMENT ON COLUMN coffee_sku.safety_stock_buffer IS 'DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.';
COMMENT ON COLUMN coffee_sku.inventory_status IS 'DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.';
COMMENT ON COLUMN coffee_sku.last_restocked_at IS 'DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.';
COMMENT ON COLUMN coffee_sku.inventory_last_synced_at IS 'DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.';

-- Catalog Blueprint brief 3 (2026-09-14) — the pre-DISTINCT-ON candidate list
-- v_coffee_sellable_slot picks its winner from, exposed on its own so the
-- resolver (blendResolver.ts) can report *why* a losing candidate didn't
-- resolve (no blend at that weight vs. no price) and honour excludeCoffeeIds
-- by filtering this view's rows in application code, instead of re-deriving
-- the candidate list itself. One row per (active slot, active assignment,
-- active coffee, active size in coffee_size — was a hardcoded 12/80 VALUES
-- list until the 2026-09-28 sizes brief) — unlike the old
-- inline subquery, a weight with no active blend still gets a row (blend_id
-- NULL), so "skipped, no blend at that weight" is visible, not silently
-- absent. Category exclusions (decaf/half_caf/flavored never fill a flavor
-- slot; experimental-tagged coffees only fill the experimental dial) applied
-- here, same as before — the one place that rule lives.
CREATE OR REPLACE VIEW v_coffee_sellable_candidate AS
SELECT
  cds.id             AS slot_id,
  cds.archetype,
  cds.sort_order,
  cds.name           AS slot_name,
  cds.position_label,
  cds.is_landing_default,
  sz.weight_oz,
  vc.id              AS coffee_id,
  vc.name            AS coffee_name,
  vc.roaster_id,
  vc.roaster_name,
  csa.id             AS assignment_id,
  csa.role,
  csa.priority,
  rb.id              AS blend_id,
  rb.roaster_sku,
  rb.shopify_variant_id,
  dsp.retail_price_cents,
  (rb.id IS NOT NULL AND dsp.retail_price_cents IS NOT NULL) AS is_sellable,
  ROW_NUMBER() OVER (
    PARTITION BY cds.id, sz.weight_oz
    ORDER BY (csa.role = 'home') DESC, csa.priority
  ) AS rank,
  sz.label           AS size_label,
  sz.sort_order      AS size_sort_order
FROM coffee_dial_slot cds
JOIN coffee_slot_assignment csa       ON csa.slot_id = cds.id AND csa.is_active = true
JOIN v_coffee vc                      ON vc.id = csa.coffee_id AND vc.is_active = true
CROSS JOIN coffee_size sz
LEFT JOIN coffee_sku rb            ON rb.coffee_id = vc.id AND rb.is_active = true AND rb.weight_oz = sz.weight_oz
LEFT JOIN coffee_slot_price dsp         ON dsp.slot_id = cds.id AND dsp.weight_oz = sz.weight_oz
WHERE sz.is_active = true AND cds.is_active = true AND cds.name IS NOT NULL
  AND NOT (vc.category_codes && ARRAY['decaf','half_caf','flavored'])
  AND (cds.archetype = 'experimental' OR NOT (vc.category_codes && ARRAY['experimental']));

-- One row per (slot, weight_oz) a customer can actually buy right now — the
-- winning candidate (role='home' first, then priority, D5) among
-- v_coffee_sellable_candidate's is_sellable rows. Same output columns as
-- brief 1 (brief 1's own tests assert this unchanged).
CREATE OR REPLACE VIEW v_coffee_sellable_slot AS
SELECT DISTINCT ON (cand.slot_id, cand.weight_oz)
  cand.slot_id, cand.archetype, cand.sort_order, cand.slot_name, cand.position_label,
  cand.is_landing_default, cand.weight_oz, cand.coffee_id, cand.coffee_name, cand.roaster_id,
  cand.role, cand.priority, cand.blend_id, cand.roaster_sku, cand.shopify_variant_id,
  cand.retail_price_cents,
  cand.size_label, cand.size_sort_order
FROM v_coffee_sellable_candidate cand
WHERE cand.is_sellable
ORDER BY cand.slot_id, cand.weight_oz, cand.rank;

-- Catalog Sizes + Visibility brief (2026-09-28), Part B — "why is this coffee
-- (not) visible to customers", the one place that rule lives (S3). One row per
-- ACTIVE placement (home or guest) x ACTIVE size. is_winner = this coffee is
-- the v_coffee_sellable_slot row for that slot x size, i.e. exactly what the
-- public pages (routes/coffees.ts) show, so admin and customer pages cannot
-- disagree. The reason flags explain a false is_winner; outranked = sellable
-- here but another coffee wins (D5: home first, then priority). category_excluded
-- repeats v_coffee_sellable_candidate's category rule verbatim.
CREATE OR REPLACE VIEW v_coffee_visibility AS
SELECT
  csa.coffee_id,
  vc.name                     AS coffee_name,
  csa.id                      AS assignment_id,
  cds.id                      AS slot_id,
  cds.archetype,
  cds.sort_order,
  cds.name                    AS slot_name,
  csa.role,
  csa.priority,
  sz.weight_oz,
  sz.label                    AS size_label,
  sz.sort_order               AS size_sort_order,
  sz.is_anchor                AS is_anchor_size,
  COALESCE(win.coffee_id = csa.coffee_id, false) AS is_winner,
  win.coffee_id               AS winner_coffee_id,
  win.coffee_name             AS winner_coffee_name,
  (cds.is_active = false OR cds.name IS NULL)    AS slot_inactive_or_unnamed,
  (vc.is_active = false)                         AS coffee_inactive,
  ((vc.category_codes && ARRAY['decaf','half_caf','flavored'])
    OR (cds.archetype <> 'experimental' AND vc.category_codes && ARRAY['experimental'])) AS category_excluded,
  NOT EXISTS (
    SELECT 1 FROM coffee_sku sk WHERE sk.coffee_id = csa.coffee_id AND sk.is_active = true AND sk.weight_oz = sz.weight_oz
  )                                              AS no_active_sku,
  NOT EXISTS (
    SELECT 1 FROM coffee_slot_price sp WHERE sp.slot_id = cds.id AND sp.weight_oz = sz.weight_oz
  )                                              AS no_slot_price,
  (COALESCE(cand.is_sellable, false) AND COALESCE(win.coffee_id <> csa.coffee_id, false)) AS outranked
FROM coffee_slot_assignment csa
JOIN coffee_dial_slot cds ON cds.id = csa.slot_id
JOIN v_coffee vc          ON vc.id = csa.coffee_id
CROSS JOIN coffee_size sz
LEFT JOIN v_coffee_sellable_slot win
       ON win.slot_id = cds.id AND win.weight_oz = sz.weight_oz
LEFT JOIN v_coffee_sellable_candidate cand
       ON cand.assignment_id = csa.id AND cand.weight_oz = sz.weight_oz
WHERE csa.is_active = true AND sz.is_active = true;

-- One row per coffee (unplaced and inactive ones too): is it visible to
-- customers at any size, is it placed at all, in how many slots does it win.
CREATE OR REPLACE VIEW v_coffee_visibility_summary AS
SELECT
  vc.id                       AS coffee_id,
  vc.name                     AS coffee_name,
  vc.is_active                AS coffee_is_active,
  COALESCE(bool_or(v.is_winner), false)                       AS is_visible,
  EXISTS (SELECT 1 FROM coffee_slot_assignment a WHERE a.coffee_id = vc.id AND a.is_active = true) AS is_placed,
  COUNT(DISTINCT v.slot_id) FILTER (WHERE v.is_winner)        AS visible_slot_count
FROM v_coffee vc
LEFT JOIN v_coffee_visibility v ON v.coffee_id = vc.id
GROUP BY vc.id, vc.name, vc.is_active;

-- One row per dial_coffee_relationships row. hop_type_derived is computed
-- fresh from each endpoint's current active HOME assignment (D3 — hop_type
-- is never stored; Catalog Blueprint brief 5a dropped the stored column and
-- hop_type_enum entirely, so this is now the only hop type, plain TEXT).
CREATE VIEW v_coffee_hop AS
SELECT
  dcr.id, dcr.from_coffee_id, dcr.to_coffee_id, dcr.dimension_id, dcr.direction, dcr.delta,
  dcr.is_recommended, dcr.confidence, dcr.notes,
  fc.name              AS from_coffee_name,
  fc.is_active         AS from_coffee_is_active,
  tc.name              AS to_coffee_name,
  tc.is_active         AS to_coffee_is_active,
  fs.slot_id           AS from_slot_id,
  fs.archetype          AS from_archetype,
  ts.slot_id           AS to_slot_id,
  ts.archetype          AS to_archetype,
  CASE
    WHEN fs.archetype IS NULL OR ts.archetype IS NULL THEN NULL
    WHEN fs.archetype = ts.archetype THEN 'within_archetype'
    ELSE 'bridge_archetype'
  END                  AS hop_type_derived
FROM coffee_hop dcr
LEFT JOIN coffees fc ON fc.id = dcr.from_coffee_id
LEFT JOIN coffees tc ON tc.id = dcr.to_coffee_id
LEFT JOIN (
  SELECT csa.coffee_id, csa.slot_id, cds.archetype
  FROM coffee_slot_assignment csa
  JOIN coffee_dial_slot cds ON cds.id = csa.slot_id
  WHERE csa.role = 'home' AND csa.is_active = true
) fs ON fs.coffee_id = dcr.from_coffee_id
LEFT JOIN (
  SELECT csa.coffee_id, csa.slot_id, cds.archetype
  FROM coffee_slot_assignment csa
  JOIN coffee_dial_slot cds ON cds.id = csa.slot_id
  WHERE csa.role = 'home' AND csa.is_active = true
) ts ON ts.coffee_id = dcr.to_coffee_id;

-- v_archetype_adjacency redefined (Catalog Blueprint brief 3, 2026-09-14) on
-- v_coffee_hop instead of dial_coffee_relationships + archetype_assignments
-- directly — same output columns as before. Archetype here is each hop
-- endpoint's current PLACEMENT (home slot) archetype, not match archetype:
-- this view describes dial-physical adjacency (which slots are bridged),
-- the same thing hop_type_derived itself is about (D3), not flavor-identity
-- reasoning (D1). Renamed v_coffee_archetype_adjacency by brief 5b (naming
-- convention, README.md).
DROP VIEW IF EXISTS v_archetype_adjacency;
DROP VIEW IF EXISTS v_coffee_archetype_adjacency;
CREATE VIEW v_coffee_archetype_adjacency AS
SELECT
  LEAST(vch.from_archetype, vch.to_archetype)                                           AS archetype_a,
  GREATEST(vch.from_archetype, vch.to_archetype)                                        AS archetype_b,
  COUNT(*)                                                                               AS hop_count,
  COUNT(*) FILTER (WHERE vch.direction = 'more')                                         AS more_count,
  COUNT(*) FILTER (WHERE vch.direction = 'less')                                         AS less_count,
  ROUND(AVG(CASE vch.confidence WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 END), 2) AS avg_confidence
FROM v_coffee_hop vch
JOIN v_coffee_archetype vca_from ON vca_from.code = vch.from_archetype
JOIN v_coffee_archetype vca_to   ON vca_to.code   = vch.to_archetype
WHERE vch.hop_type_derived = 'bridge_archetype'
  AND vch.from_coffee_is_active = true AND vch.to_coffee_is_active = true
  AND vca_from.is_archetype = true AND vca_to.is_archetype = true
  AND vch.from_archetype <> vch.to_archetype
GROUP BY LEAST(vch.from_archetype, vch.to_archetype), GREATEST(vch.from_archetype, vch.to_archetype)
ORDER BY hop_count DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- CUSTOMER BLUEPRINT · brief C1 (2026-09-27) — roles, naming, the door
-- See backend/src/features/customer_blueprint/CLAUDE_CODE_PROMPT_CUSTOMER_1_ROLES_NAMING_DOOR.md
-- (also mirrored, unexecuted, at backend/src/db/migrations/customer_blueprint_1_2026_09_27.sql).
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

-- ═══════════════════════════════════════════════════════════════════════════
-- CUSTOMER BLUEPRINT · brief C3 (2026-09-27) — views + two new operating
-- tables (Parts A, B4, B6). See backend/src/features/customer_blueprint/
-- CLAUDE_CODE_PROMPT_CUSTOMER_3_VIEWS_AND_RETIREMENTS.md.
--
-- Placed here — inside the C1 block, before its "-- A2. Prefix-driven
-- grants" loops below — for the exact reason C1's own Task 0 learned the
-- hard way for fact tables (see that comment above): db.query(schema) runs
-- this whole file as one sequential batch, so anything created after the
-- grant loops isn't granted until the NEXT boot. user_saved_item and
-- sommelier_evaluation have no customer_ prefix, so they fall through to the
-- "everything else" operating-table loop (full DML) automatically; every
-- view below is swept by the view-grant loop the same way — no per-object
-- grant statement needed for any of this block.
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN CUSTOMER BLUEPRINT C3 views/tables block

-- Part B4 — saved items (operating table: the fact stays customer_dial_event
-- / the recipe was never a fact; this is current state, edited by tombstone).
CREATE TABLE IF NOT EXISTS user_saved_item (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES user_profile(id),
  kind       TEXT NOT NULL CHECK (kind IN ('dial_slot','recipe')),
  ref_id     TEXT NOT NULL,
  title      TEXT,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  removed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_saved_item_user ON user_saved_item (user_id, created_at);

-- Part B6 — sommelier evaluator log, replacing Firestore
-- users/{uid}/sommelier_evaluations. Operating/log table: UPDATE is allowed
-- for ab_app (outcomeTracker.ts updates `outcome` after the log row exists).
-- user_id is user_profile.id, not the Firebase uid the evaluator receives —
-- resolved once at insert time, same as every other write in this codebase.
CREATE TABLE IF NOT EXISTS sommelier_evaluation (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES user_profile(id),
  intent              TEXT NOT NULL,
  triggers_fired      TEXT[] NOT NULL DEFAULT '{}',
  needs_sommelier     BOOLEAN NOT NULL,
  feature_vector      NUMERIC[] NOT NULL DEFAULT '{}',
  feature_schema      TEXT[] NOT NULL DEFAULT '{}',
  user_state_snapshot JSONB NOT NULL,
  opening_context     TEXT,
  session_started     BOOLEAN NOT NULL DEFAULT false,
  started_at          TIMESTAMPTZ,
  outcome             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_sommelier_evaluation_user_created ON sommelier_evaluation (user_id, created_at);

-- Part C — dead tables, dropped once integrity check 7 (customerIntegrity.ts)
-- has proved them empty in prod. Confirmed empty 2026-09-27:
-- user_recommendation_log, user_feedback_event, chat_message. Self-healing
-- guard (same pattern as index.ts's NOT NULL preconditions): a live row found
-- at boot skips the drop rather than destroying data, so this is safe to run
-- unattended. sommelier_messages, the fourth dead-table candidate, is NOT
-- dropped here — it has 9 real rows in prod (confirmed 2026-09-27, legacy
-- pre-Firestore-migration session transcripts), still read as a fallback by
-- GET /api/sommelier/:sessionId/messages; its own drop needs those 9 rows
-- resolved first (OPEN_TASKS.md).
-- Nested IFs, not a single `to_regclass(...) IS NOT NULL AND (SELECT COUNT...)`
-- — Postgres does not guarantee AND short-circuits a subquery, so a combined
-- condition risks the exact "relation does not exist" error this guards
-- against once the table is actually gone.
DO $$ BEGIN
  IF to_regclass('user_recommendation_log') IS NOT NULL THEN
    IF (SELECT COUNT(*) FROM user_recommendation_log) = 0 THEN DROP TABLE user_recommendation_log; END IF;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('user_feedback_event') IS NOT NULL THEN
    IF (SELECT COUNT(*) FROM user_feedback_event) = 0 THEN DROP TABLE user_feedback_event; END IF;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('chat_message') IS NOT NULL THEN
    IF (SELECT COUNT(*) FROM chat_message) = 0 THEN DROP TABLE chat_message; END IF;
  END IF;
END $$;

-- ── Part A1 — Identity ────────────────────────────────────────────────────
-- customer_identity_link rows point from_user_id (the older/merged profile)
-- -> to_user_id (the surviving profile the new facts should read as), see
-- routes/auth.ts's sync-match-claim. canonical_user_id walks that edge
-- forward (from -> to) until a profile that is never a from_user_id is
-- reached (D15: rows are never re-keyed, so this walk is done at read time,
-- every time). depth <= 5, cycle-safe: if the walk is about to revisit an
-- id already on its own path, it stops there and the lowest-created_at
-- profile among the visited ids is canonical instead — see integrity check
-- 13, which independently verifies no such cycle actually exists in prod
-- data (this is a defensive bound, not an expected case).

-- Every view for the rest of this C3 block uses DROP VIEW IF EXISTS ...
-- CASCADE; CREATE VIEW, never CREATE OR REPLACE VIEW (Dana, 2026-09-27, after
-- CREATE OR REPLACE's column-reorder restriction broke v_palate_slot_candidates
-- live in production — see that view's own comment below). CASCADE is safe
-- because this file only ever defines a view after everything it references,
-- so a cascaded drop only ever removes views that this same file's later
-- statements recreate in the same pass — self-healing within one boot, same
-- as the customer_brew_profile_fold aggregate's own DROP ... CASCADE earlier
-- in this file. lint-customer.mjs Rule 5 fails the build on any
-- CREATE OR REPLACE VIEW reintroduced under this block.
DROP VIEW IF EXISTS v_customer_identity CASCADE;
CREATE VIEW v_customer_identity AS
WITH RECURSIVE walk AS (
  SELECT up.id AS user_id, up.id AS current_id, 0 AS depth, ARRAY[up.id] AS path, false AS cycle_detected
  FROM user_profile up
  UNION ALL
  SELECT w.user_id, cil.to_user_id, w.depth + 1, w.path || cil.to_user_id,
         (cil.to_user_id = ANY(w.path))
  FROM walk w
  JOIN customer_identity_link cil ON cil.from_user_id = w.current_id
  WHERE w.depth < 5 AND NOT w.cycle_detected
),
terminal AS (
  SELECT DISTINCT ON (user_id) user_id, current_id, path, cycle_detected
  FROM walk
  ORDER BY user_id, depth DESC
)
SELECT
  t.user_id,
  CASE WHEN t.cycle_detected THEN (
    SELECT p.id FROM unnest(t.path) AS p(id)
    JOIN user_profile up2 ON up2.id = p.id
    ORDER BY up2.created_at ASC LIMIT 1
  ) ELSE t.current_id END AS canonical_user_id
FROM terminal t;

-- ── Part A2 — Current state, replayed from facts ─────────────────────────

-- Per canonical customer, the latest quiz_session (by completed_at) across
-- every linked profile, joined to its current interpretation row —
-- resolveInterpretation()'s whole-row-precedence fallback to context_data
-- (services/quizSession.ts) reproduced here per column via COALESCE, since
-- interpretation rows only exist from brief 2 onward. branched_from/
-- food_signal/experimental always come from context_data (never part of
-- quiz_session_interpretation, unchanged from today's reads).

DROP VIEW IF EXISTS v_customer_quiz_current CASCADE;
CREATE VIEW v_customer_quiz_current AS
WITH sessions AS (
  SELECT
    vci.canonical_user_id,
    qs.id AS quiz_session_id,
    qs.completed_at,
    ca.name AS archetype_name,
    ca.code AS archetype_code,
    i.interpretation_version,
    CASE WHEN i.id IS NOT NULL THEN 'table' ELSE 'context_data' END AS interpretation_source,
    COALESCE(quiz_archetype_canonical(i.secondary_archetype), quiz_archetype_canonical(qs.context_data ->> 'secondaryArchetype')) AS secondary_archetype,
    COALESCE(i.recommendation_mode, qs.context_data ->> 'recommendationMode', 'primary_only') AS recommendation_mode,
    COALESCE(i.food_signal_alignment, qs.context_data ->> 'foodSignalAlignment', 'high') AS food_signal_alignment,
    COALESCE(i.pair_confidence, qs.context_data ->> 'pairConfidence') AS pair_confidence,
    COALESCE(quiz_archetype_canonical(i.explore_archetype), quiz_archetype_canonical(qs.context_data ->> 'exploreArchetype')) AS explore_archetype,
    COALESCE(i.explore_reason, qs.context_data ->> 'exploreReason') AS explore_reason,
    quiz_archetype_canonical(qs.context_data ->> 'branchedFrom') AS branched_from,
    quiz_archetype_canonical(qs.context_data ->> 'foodSignal') AS food_signal,
    COALESCE((qs.context_data ->> 'experimental')::boolean, false) AS experimental,
    -- Liam L3, Part D (2026-09-28) — when this interpretation became current.
    -- Distinct from qs.completed_at: a session can be re-interpreted later
    -- (recalibration), which bumps valid_from without changing completed_at.
    -- Needed to tell whether a thread question asked in the past was asked
    -- for THIS interpretation or a since-superseded one.
    i.valid_from AS interpretation_valid_from,
    -- Prompt 4B (interpretation v2.2, 2026-10-09): the match layer and the raw branch answer. A row before v2.2
    -- (or no row) matches the shown archetype; never NULL.
    COALESCE(i.match_archetype, ca.name) AS match_archetype,
    i.intensity_lean,
    ba.answer_code AS branch_answer_code
  FROM quiz_session qs
  JOIN v_customer_identity vci ON vci.user_id = qs.user_id
  LEFT JOIN coffee_archetype ca ON ca.id = qs.resulting_archetype_id
  LEFT JOIN quiz_session_interpretation i ON i.quiz_session_id = qs.id AND i.is_current
  LEFT JOIN quiz_answer ba ON ba.id = qs.branch_answer_id
),
with_secondary_code AS (
  SELECT s.*, ca2.code AS secondary_archetype_code, ca3.code AS match_archetype_code
  FROM sessions s
  LEFT JOIN coffee_archetype ca2 ON ca2.name = s.secondary_archetype
  LEFT JOIN coffee_archetype ca3 ON ca3.name = s.match_archetype
),
ranked AS (
  SELECT s.*,
    ROW_NUMBER() OVER (PARTITION BY canonical_user_id ORDER BY completed_at DESC) AS rn_desc,
    COUNT(*) OVER (PARTITION BY canonical_user_id) AS quiz_count,
    LAG(archetype_name) OVER (PARTITION BY canonical_user_id ORDER BY completed_at ASC) AS prev_archetype_name
  FROM with_secondary_code s
),
changes AS (
  SELECT canonical_user_id,
    COUNT(*) FILTER (WHERE prev_archetype_name IS NOT NULL AND prev_archetype_name IS DISTINCT FROM archetype_name) AS archetype_change_count
  FROM ranked
  GROUP BY canonical_user_id
),
last_two AS (
  SELECT r1.canonical_user_id,
    (r2.archetype_name IS NOT NULL AND r1.archetype_name IS DISTINCT FROM r2.archetype_name) AS archetype_changed_last_two_quizzes
  FROM ranked r1
  LEFT JOIN ranked r2 ON r2.canonical_user_id = r1.canonical_user_id AND r2.rn_desc = 2
  WHERE r1.rn_desc = 1
)
SELECT
  r.canonical_user_id, r.quiz_session_id, r.archetype_name, r.archetype_code,
  r.secondary_archetype, r.secondary_archetype_code, r.branched_from, r.food_signal, r.experimental,
  r.food_signal_alignment, r.recommendation_mode, r.pair_confidence, r.explore_archetype, r.explore_reason,
  r.interpretation_version, r.interpretation_source, r.completed_at, r.interpretation_valid_from,
  ch.archetype_change_count, r.quiz_count, lt.archetype_changed_last_two_quizzes,
  r.match_archetype, r.match_archetype_code, r.intensity_lean, r.branch_answer_code
FROM ranked r
JOIN changes ch ON ch.canonical_user_id = r.canonical_user_id
JOIN last_two lt ON lt.canonical_user_id = r.canonical_user_id
WHERE r.rn_desc = 1;

-- Brew profile replay: customer_brew_profile_change.value is always the JSON
-- encoding of a single scalar (customerFacts.ts callers JSON.stringify one
-- value per row, even a 'set' on an array field stores the whole array that
-- way — see routes/users.ts PATCH /brew-profile). _customer_brew_profile_fold
-- replays set/clear/add/remove in occurred_at order into the field's current
-- JSONB value (scalar or array); 'remove' has no live writer today but is a
-- valid op per the CHECK constraint, so it's handled defensively.
CREATE OR REPLACE FUNCTION _customer_brew_profile_fold_sfunc(state JSONB, op TEXT, raw_value TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  arr JSONB;
  item TEXT;
BEGIN
  IF op = 'clear' THEN
    RETURN NULL;
  ELSIF op = 'set' THEN
    RETURN raw_value::jsonb;
  ELSIF op = 'add' THEN
    item := raw_value::jsonb #>> '{}';
    arr := CASE WHEN jsonb_typeof(state) = 'array' THEN state ELSE '[]'::jsonb END;
    IF NOT (arr ? item) THEN
      arr := arr || to_jsonb(item);
    END IF;
    RETURN arr;
  ELSIF op = 'remove' THEN
    item := raw_value::jsonb #>> '{}';
    arr := CASE WHEN jsonb_typeof(state) = 'array' THEN state ELSE '[]'::jsonb END;
    RETURN (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(arr) x WHERE x <> to_jsonb(item));
  ELSE
    RETURN state;
  END IF;
END;
$$;

-- No CREATE OR REPLACE AGGREGATE exists in Postgres — CASCADE is required
-- once v_customer_brew_profile (and its own dependent v_palate_evidence)
-- exist, same reasoning as the CREATE-OR-REPLACE-view fixes above; both are
-- recreated later in this same file, in dependency order, so the cascade
-- self-heals within one boot.
DROP AGGREGATE IF EXISTS customer_brew_profile_fold(TEXT, TEXT) CASCADE;
CREATE AGGREGATE customer_brew_profile_fold(TEXT, TEXT) (
  SFUNC = _customer_brew_profile_fold_sfunc,
  STYPE = JSONB
);


DROP VIEW IF EXISTS v_customer_brew_profile CASCADE;
CREATE VIEW v_customer_brew_profile AS
SELECT canonical_user_id, field, value_jsonb, captured_at, source
FROM (
  SELECT
    vci.canonical_user_id,
    cbpc.field,
    customer_brew_profile_fold(cbpc.op, cbpc.value ORDER BY cbpc.occurred_at) AS value_jsonb,
    MAX(cbpc.occurred_at) AS captured_at,
    (ARRAY_AGG(cbpc.source ORDER BY cbpc.occurred_at DESC))[1] AS source
  FROM customer_brew_profile_change cbpc
  JOIN v_customer_identity vci ON vci.user_id = cbpc.user_id
  GROUP BY vci.canonical_user_id, cbpc.field
) folded
WHERE value_jsonb IS NOT NULL;

-- customer_feedback_event rows not pointed at by any other row's
-- supersedes_id, i.e. the current revision per (user, order line).

DROP VIEW IF EXISTS v_customer_feedback_current CASCADE;
CREATE VIEW v_customer_feedback_current AS
SELECT
  vci.canonical_user_id,
  cfe.id AS feedback_event_id,
  cfe.occurred_at,
  cfe.order_line_item_id,
  cfe.coffee_id,
  cfe.rating,
  cfe.expectation,
  cfe.raw_text,
  cfe.channel,
  cfe.source,
  CASE WHEN cfe.rating >= 4 THEN 'positive' WHEN cfe.rating <= 2 THEN 'negative' ELSE 'neutral' END AS sentiment,
  COALESCE(d.cupping_note_ids, ARRAY[]::UUID[]) AS descriptor_note_ids
FROM customer_feedback_event cfe
JOIN v_customer_identity vci ON vci.user_id = cfe.user_id
LEFT JOIN (
  SELECT feedback_event_id, ARRAY_AGG(cupping_note_id) AS cupping_note_ids
  FROM customer_feedback_descriptor
  GROUP BY feedback_event_id
) d ON d.feedback_event_id = cfe.id
WHERE NOT EXISTS (SELECT 1 FROM customer_feedback_event newer WHERE newer.supersedes_id = cfe.id);

-- D7 drinker-attribution rule. "Company-gift subscription context" (Part A2's
-- own wording) is read here as: the order's buyer has a company_gift_id on
-- their profile (b2b_company_subscriptions) — an individually-sponsored seat,
-- never a household. Untested in prod today: household_id is never set on
-- any live order (see WHAT_WE_BUILT.md), so every row currently resolves via
-- the buyer branch. Flagged in the C3 closing report as a judgment call, not
-- a verified behavior.

DROP VIEW IF EXISTS v_customer_bag_attribution CASCADE;
CREATE VIEW v_customer_bag_attribution AS
SELECT
  oli.id AS order_line_item_id,
  o.id AS order_id,
  rb.coffee_id,
  COALESCE(oli.order_kind, 'manual') AS order_kind,
  CASE
    WHEN oli.intended_for_user_id IS NOT NULL THEN oli.intended_for_user_id
    WHEN o.household_id IS NULL AND buyer.company_gift_id IS NULL THEN o.user_id
    ELSE claim.user_id
  END AS drinker_user_id,
  CASE
    WHEN oli.intended_for_user_id IS NOT NULL THEN 'intended'
    WHEN o.household_id IS NULL AND buyer.company_gift_id IS NULL THEN 'buyer'
    WHEN claim.user_id IS NOT NULL THEN 'claim'
    ELSE 'unattributed'
  END AS attribution
FROM order_line_item oli
JOIN "order" o ON o.id = oli.order_id
JOIN coffee_sku rb ON rb.id = oli.blend_id
LEFT JOIN user_profile buyer ON buyer.id = o.user_id
LEFT JOIN LATERAL (
  SELECT cbc.user_id
  FROM customer_bag_claim cbc
  JOIN user_profile claimant ON claimant.id = cbc.user_id
  WHERE cbc.coffee_id = rb.coffee_id
    AND o.household_id IS NOT NULL
    AND claimant.household_id = o.household_id
  ORDER BY cbc.occurred_at ASC
  LIMIT 1
) claim ON true;

-- ── Part A3 — The timeline ────────────────────────────────────────────────
-- identity_link events are attributed to to_user_id's canonical customer —
-- the surviving profile the link resolves toward (see v_customer_identity's
-- comment above); both sides resolve to the same canonical_user_id in the
-- common single-hop case.

DROP VIEW IF EXISTS v_customer_timeline CASCADE;
CREATE VIEW v_customer_timeline AS
SELECT vci1.canonical_user_id, qs.completed_at AS occurred_at, 'quiz'::text AS kind, qs.id::text AS ref_id,
       NULL::int AS coffee_id, NULL::int AS slot_id, ca.code AS archetype_code, NULL::int AS session_id,
       jsonb_build_object('archetype', ca.name, 'secondary_archetype', quiz_archetype_canonical(i.secondary_archetype),
                          'match_archetype', COALESCE(i.match_archetype, ca.name), 'intensity_lean', i.intensity_lean) AS detail
FROM quiz_session qs
JOIN v_customer_identity vci1 ON vci1.user_id = qs.user_id
LEFT JOIN coffee_archetype ca ON ca.id = qs.resulting_archetype_id
LEFT JOIN quiz_session_interpretation i ON i.quiz_session_id = qs.id AND i.is_current

UNION ALL
SELECT vci2.canonical_user_id, o.created_at AS occurred_at, 'order_line'::text AS kind, oli.id::text AS ref_id,
       rb.coffee_id, NULL::int AS slot_id, vc.match_archetype AS archetype_code, NULL::int AS session_id,
       jsonb_build_object('order_id', o.id, 'attribution', vba.attribution, 'order_kind', vba.order_kind, 'blend_name', rb.blend_name) AS detail
FROM order_line_item oli
JOIN "order" o ON o.id = oli.order_id
JOIN coffee_sku rb ON rb.id = oli.blend_id
LEFT JOIN v_coffee vc ON vc.id = rb.coffee_id
JOIN v_customer_bag_attribution vba ON vba.order_line_item_id = oli.id
JOIN v_customer_identity vci2 ON vci2.user_id = vba.drinker_user_id
WHERE vba.drinker_user_id IS NOT NULL

UNION ALL
SELECT vci3.canonical_user_id, cfe.occurred_at, 'feedback'::text, cfe.id::text,
       cfe.coffee_id, NULL::int, NULL::archetype_enum, NULL::int,
       jsonb_build_object('rating', cfe.rating,
         'sentiment', CASE WHEN cfe.rating >= 4 THEN 'positive' WHEN cfe.rating <= 2 THEN 'negative' ELSE 'neutral' END,
         'expectation', cfe.expectation, 'raw_text', cfe.raw_text, 'channel', cfe.channel,
         'supersedes_id', cfe.supersedes_id, 'order_line_item_id', cfe.order_line_item_id,
         'is_current', (NOT EXISTS (SELECT 1 FROM customer_feedback_event newer WHERE newer.supersedes_id = cfe.id)))
FROM customer_feedback_event cfe
JOIN v_customer_identity vci3 ON vci3.user_id = cfe.user_id

UNION ALL
SELECT vci4.canonical_user_id, cbpc.occurred_at, 'brew_profile_change'::text, cbpc.id::text,
       NULL::int, NULL::int, NULL::archetype_enum, cbpc.session_id,
       jsonb_build_object('field', cbpc.field, 'op', cbpc.op, 'value', cbpc.value)
FROM customer_brew_profile_change cbpc
JOIN v_customer_identity vci4 ON vci4.user_id = cbpc.user_id

UNION ALL
SELECT vci5.canonical_user_id, cde.occurred_at, 'dial_event'::text, cde.id::text,
       cde.coffee_id, cde.slot_id, cde.archetype_code, NULL::int,
       jsonb_build_object('event_type', cde.event_type)
FROM customer_dial_event cde
JOIN v_customer_identity vci5 ON vci5.user_id = cde.user_id

UNION ALL
SELECT vci6.canonical_user_id, cbc.occurred_at, 'bag_claim'::text, cbc.id::text,
       cbc.coffee_id, NULL::int, NULL::archetype_enum, NULL::int,
       jsonb_build_object('order_line_item_id', cbc.order_line_item_id, 'qr_scan_event_id', cbc.qr_scan_event_id)
FROM customer_bag_claim cbc
JOIN v_customer_identity vci6 ON vci6.user_id = cbc.user_id

UNION ALL
SELECT vci7.canonical_user_id, clr.occurred_at, 'liam_recommendation'::text, clr.id::text,
       clr.coffee_id, clr.slot_id, NULL::archetype_enum, clr.session_id,
       jsonb_build_object('turn', clr.turn, 'message_id', clr.message_id, 'candidate_coffee_ids', clr.candidate_coffee_ids, 'detected', clr.detected)
FROM customer_liam_recommendation clr
JOIN v_customer_identity vci7 ON vci7.user_id = clr.user_id

UNION ALL
SELECT vci8.canonical_user_id, clq.occurred_at, 'liam_question'::text, clq.id::text,
       NULL::int, NULL::int, clq.archetype_code, clq.session_id,
       jsonb_build_object('kind', clq.kind, 'question', clq.question, 'reply', clreply.reply, 'answered', (clreply.id IS NOT NULL))
FROM customer_liam_question clq
JOIN v_customer_identity vci8 ON vci8.user_id = clq.user_id
LEFT JOIN customer_liam_reply clreply ON clreply.question_id = clq.id

UNION ALL
SELECT vci9.canonical_user_id, cla.occurred_at, 'liam_action'::text, cla.id::text,
       NULL::int, NULL::int, NULL::archetype_enum, cla.session_id,
       jsonb_build_object('action_type', cla.action_type)
FROM customer_liam_action cla
JOIN v_customer_identity vci9 ON vci9.user_id = cla.user_id

UNION ALL
SELECT vci10.canonical_user_id, cil.occurred_at, 'identity_link'::text, cil.id::text,
       NULL::int, NULL::int, NULL::archetype_enum, NULL::int,
       jsonb_build_object('how', cil.how, 'from_user_id', cil.from_user_id, 'to_user_id', cil.to_user_id)
FROM customer_identity_link cil
JOIN v_customer_identity vci10 ON vci10.user_id = cil.to_user_id

ORDER BY occurred_at, kind;

-- ── Part A4 — Coffee facts for the reads ─────────────────────────────────
-- Per active coffee/dimension: min(value_min)/max(value_max) across merged
-- (is_merged) cupping_scores rows; falls back to all tasters' rows
-- (basis='unmerged') when no merged row exists; no rows at all when a
-- coffee has never been cupped (never a default range).

DROP VIEW IF EXISTS v_coffee_dimension_range CASCADE;
CREATE VIEW v_coffee_dimension_range AS
WITH merged AS (
  SELECT sc.coffee_id, csv.dimension_id, MIN(csv.value_min) AS value_min, MAX(csv.value_max) AS value_max, COUNT(*) AS n_scores
  FROM cupping_score_values csv
  JOIN cupping_scores cs ON cs.id = csv.cupping_score_id AND cs.is_merged = true
  JOIN cupping_session_coffees sc ON sc.id = cs.session_coffee_id
  GROUP BY sc.coffee_id, csv.dimension_id
),
unmerged AS (
  SELECT sc.coffee_id, csv.dimension_id, MIN(csv.value_min) AS value_min, MAX(csv.value_max) AS value_max, COUNT(*) AS n_scores
  FROM cupping_score_values csv
  JOIN cupping_scores cs ON cs.id = csv.cupping_score_id
  JOIN cupping_session_coffees sc ON sc.id = cs.session_coffee_id
  GROUP BY sc.coffee_id, csv.dimension_id
)
SELECT
  c.id AS coffee_id, d.id AS dimension_id, d.name AS dimension_name,
  COALESCE(m.value_min, u.value_min) AS value_min,
  COALESCE(m.value_max, u.value_max) AS value_max,
  COALESCE(m.n_scores, u.n_scores) AS n_scores,
  CASE WHEN m.coffee_id IS NOT NULL THEN 'merged' ELSE 'unmerged' END AS basis
FROM coffees c
CROSS JOIN coffee_dimensions d
LEFT JOIN merged   m ON m.coffee_id = c.id AND m.dimension_id = d.id
LEFT JOIN unmerged u ON u.coffee_id = c.id AND u.dimension_id = d.id
WHERE c.is_active = true AND (m.coffee_id IS NOT NULL OR u.coffee_id IS NOT NULL);

-- v_collaborative_flavor_wheel grouped; n_sources = number of distinct
-- source channels ('internal'/'roastery'/'client') this descriptor was
-- observed under for that coffee, not a total observation count.

DROP VIEW IF EXISTS v_coffee_descriptor CASCADE;
CREATE VIEW v_coffee_descriptor AS
SELECT coffee_id, descriptor, wheel_category, wheel_subcategory, COUNT(DISTINCT source) AS n_sources
FROM v_collaborative_flavor_wheel
GROUP BY coffee_id, descriptor, wheel_category, wheel_subcategory;

-- ── Part A5 — The reads (v_palate_*, read_version = 'v1') ────────────────


DROP VIEW IF EXISTS v_palate_evidence CASCADE;
CREATE VIEW v_palate_evidence AS
WITH base_customers AS (
  SELECT canonical_user_id FROM v_customer_quiz_current
  UNION SELECT vci_i.canonical_user_id FROM v_customer_bag_attribution vba
    JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id WHERE vba.attribution <> 'unattributed'
  UNION SELECT canonical_user_id FROM v_customer_feedback_current
  UNION SELECT vci_i.canonical_user_id FROM customer_liam_question clq JOIN v_customer_identity vci_i ON vci_i.user_id = clq.user_id
  UNION SELECT vci_i.canonical_user_id FROM customer_liam_recommendation clr JOIN v_customer_identity vci_i ON vci_i.user_id = clr.user_id
  UNION SELECT canonical_user_id FROM v_customer_brew_profile
)
SELECT
  bc.canonical_user_id,
  'v1'::text AS read_version,
  COALESCE(lines.n_lines, 0) AS n_attributed_lines,
  COALESCE(lines.n_coffees, 0) AS n_distinct_coffees,
  COALESCE(fb.n_positive, 0) AS n_feedback_positive,
  COALESCE(fb.n_negative, 0) AS n_feedback_negative,
  COALESCE(fb.n_total, 0) AS n_feedback_total,
  COALESCE(q.n_asked, 0) AS n_questions_asked,
  COALESCE(q.n_answered, 0) AS n_questions_answered,
  COALESCE(rec.n_recommendations, 0) AS n_recommendations,
  COALESCE(bp.n_fields, 0) AS n_brew_fields_known,
  lines.first_order_at,
  lines.last_order_at,
  (qc.canonical_user_id IS NOT NULL) AS has_quiz
FROM base_customers bc
LEFT JOIN (
  SELECT vba2.canonical_user_id, COUNT(*) AS n_lines, COUNT(DISTINCT vba2.coffee_id) AS n_coffees,
         MIN(vba2.occurred_at) AS first_order_at, MAX(vba2.occurred_at) AS last_order_at
  FROM (
    SELECT vci_i.canonical_user_id, vba.coffee_id, o.created_at AS occurred_at
    FROM v_customer_bag_attribution vba
    JOIN order_line_item oli ON oli.id = vba.order_line_item_id
    JOIN "order" o ON o.id = oli.order_id
    JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id
    WHERE vba.attribution <> 'unattributed'
  ) vba2
  GROUP BY vba2.canonical_user_id
) lines ON lines.canonical_user_id = bc.canonical_user_id
LEFT JOIN (
  SELECT canonical_user_id,
    COUNT(*) FILTER (WHERE sentiment = 'positive') AS n_positive,
    COUNT(*) FILTER (WHERE sentiment = 'negative') AS n_negative,
    COUNT(*) AS n_total
  FROM v_customer_feedback_current
  GROUP BY canonical_user_id
) fb ON fb.canonical_user_id = bc.canonical_user_id
LEFT JOIN (
  SELECT vci_q.canonical_user_id, COUNT(*) AS n_asked, COUNT(*) FILTER (WHERE r.id IS NOT NULL) AS n_answered
  FROM customer_liam_question clq
  JOIN v_customer_identity vci_q ON vci_q.user_id = clq.user_id
  LEFT JOIN customer_liam_reply r ON r.question_id = clq.id
  GROUP BY vci_q.canonical_user_id
) q ON q.canonical_user_id = bc.canonical_user_id
LEFT JOIN (
  SELECT vci_r.canonical_user_id, COUNT(*) AS n_recommendations
  FROM customer_liam_recommendation clr
  JOIN v_customer_identity vci_r ON vci_r.user_id = clr.user_id
  GROUP BY vci_r.canonical_user_id
) rec ON rec.canonical_user_id = bc.canonical_user_id
LEFT JOIN (
  SELECT canonical_user_id, COUNT(*) AS n_fields FROM v_customer_brew_profile GROUP BY canonical_user_id
) bp ON bp.canonical_user_id = bc.canonical_user_id
LEFT JOIN (
  SELECT DISTINCT canonical_user_id FROM v_customer_quiz_current
) qc ON qc.canonical_user_id = bc.canonical_user_id;


-- Customer Blueprint C3, Part D (Dana's fixture review, 2026-09-27, rule 1) —
-- only lines with no feedback or feedback rating >= 3 shape "this customer's
-- palate"; a disliked bag (rating <= 2) never contributes a range or
-- descriptor here. A customer whose only bag is disliked gets zero rows.
-- These are v1 rules (read_version stays 'v1' everywhere) — order_kind
-- filtering is the first named v2 item, not done here.
DROP VIEW IF EXISTS v_palate_shared_traits CASCADE;
CREATE VIEW v_palate_shared_traits AS
WITH attributed_coffees AS (
  SELECT DISTINCT vci_i.canonical_user_id, vba.coffee_id
  FROM v_customer_bag_attribution vba
  JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id
  LEFT JOIN v_customer_feedback_current vfc
    ON vfc.order_line_item_id = vba.order_line_item_id AND vfc.canonical_user_id = vci_i.canonical_user_id
  WHERE vba.attribution <> 'unattributed' AND (vfc.rating IS NULL OR vfc.rating >= 3)
),
dim AS (
  SELECT ac.canonical_user_id, 'dimension'::text AS kind, cdr.dimension_id::text AS trait_key, cdr.dimension_name AS trait_label,
    MAX(cdr.value_min) AS value_min, MIN(cdr.value_max) AS value_max, COUNT(*) AS n_coffees
  FROM attributed_coffees ac
  JOIN v_coffee_dimension_range cdr ON cdr.coffee_id = ac.coffee_id
  GROUP BY ac.canonical_user_id, cdr.dimension_id, cdr.dimension_name
),
total_coffees AS (
  SELECT canonical_user_id, COUNT(*) AS n_total FROM attributed_coffees GROUP BY canonical_user_id
),
desc_agg AS (
  SELECT ac.canonical_user_id, 'descriptor'::text AS kind, vcd.descriptor AS trait_key, vcd.descriptor AS trait_label,
    NULL::numeric AS value_min, NULL::numeric AS value_max, COUNT(DISTINCT ac.coffee_id) AS n_coffees
  FROM attributed_coffees ac
  JOIN v_coffee_descriptor vcd ON vcd.coffee_id = ac.coffee_id
  GROUP BY ac.canonical_user_id, vcd.descriptor
)
SELECT canonical_user_id, kind, trait_key, trait_label, value_min, value_max,
       (value_min IS NOT NULL AND value_max IS NOT NULL AND value_min <= value_max) AS overlaps, n_coffees
FROM dim
UNION ALL
SELECT d.canonical_user_id, d.kind, d.trait_key, d.trait_label, d.value_min, d.value_max, NULL::boolean AS overlaps, d.n_coffees
FROM desc_agg d
JOIN total_coffees t ON t.canonical_user_id = d.canonical_user_id AND d.n_coffees = t.n_total;


DROP VIEW IF EXISTS v_palate_dominant_dimensions CASCADE;
CREATE VIEW v_palate_dominant_dimensions AS
WITH attributed AS (
  SELECT DISTINCT vci_i.canonical_user_id, vba.coffee_id, vba.order_line_item_id
  FROM v_customer_bag_attribution vba
  JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id
  WHERE vba.attribution <> 'unattributed'
),
midpoints AS (
  SELECT a.canonical_user_id, a.coffee_id, a.order_line_item_id, cdr.dimension_id, cdr.dimension_name,
         (cdr.value_min + cdr.value_max) / 2.0 AS midpoint
  FROM attributed a
  JOIN v_coffee_dimension_range cdr ON cdr.coffee_id = a.coffee_id
),
with_sentiment AS (
  SELECT m.*, vfc.sentiment
  FROM midpoints m
  LEFT JOIN v_customer_feedback_current vfc ON vfc.order_line_item_id = m.order_line_item_id AND vfc.canonical_user_id = m.canonical_user_id
)
SELECT
  canonical_user_id, dimension_id, dimension_name,
  ROUND(AVG(midpoint)::numeric, 3) AS mean_midpoint,
  COUNT(*) AS n_coffees,
  ROUND(AVG(midpoint) FILTER (WHERE sentiment = 'positive')::numeric, 3) AS liked_mean_midpoint,
  COUNT(*) FILTER (WHERE sentiment = 'positive') AS n_liked,
  ROUND(AVG(midpoint) FILTER (WHERE sentiment = 'negative')::numeric, 3) AS disliked_mean_midpoint,
  COUNT(*) FILTER (WHERE sentiment = 'negative') AS n_disliked
FROM with_sentiment
GROUP BY canonical_user_id, dimension_id, dimension_name;


DROP VIEW IF EXISTS v_palate_archetype_spread CASCADE;
CREATE VIEW v_palate_archetype_spread AS
WITH attributed AS (
  SELECT DISTINCT vci_i.canonical_user_id, vba.coffee_id, vba.order_line_item_id, vc.match_archetype
  FROM v_customer_bag_attribution vba
  JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id
  JOIN v_coffee vc ON vc.id = vba.coffee_id
  WHERE vba.attribution <> 'unattributed' AND vc.match_archetype IS NOT NULL
),
with_sentiment AS (
  SELECT a.*, vfc.sentiment
  FROM attributed a
  LEFT JOIN v_customer_feedback_current vfc ON vfc.order_line_item_id = a.order_line_item_id AND vfc.canonical_user_id = a.canonical_user_id
)
SELECT canonical_user_id, match_archetype,
  COUNT(DISTINCT coffee_id) AS n_coffees,
  COUNT(*) FILTER (WHERE sentiment = 'positive') AS n_positive,
  COUNT(*) FILTER (WHERE sentiment = 'negative') AS n_negative
FROM with_sentiment
GROUP BY canonical_user_id, match_archetype;


DROP VIEW IF EXISTS v_palate_threads CASCADE;
CREATE VIEW v_palate_threads AS
SELECT
  vci_q.canonical_user_id,
  clq.id AS question_id, clq.occurred_at, clq.kind, clq.archetype_code, clq.question,
  -- Liam L3, Part D — session_id/turn so the profile line can render "asked
  -- on turn n (session s)" instead of a bare date.
  clq.session_id, clq.turn,
  clr.reply, clr.occurred_at AS replied_at,
  CASE WHEN clr.id IS NOT NULL THEN 'answered' ELSE 'asked' END AS status
FROM customer_liam_question clq
JOIN v_customer_identity vci_q ON vci_q.user_id = clq.user_id
LEFT JOIN customer_liam_reply clr ON clr.question_id = clq.id;

-- "same coffee or slot": a coffee-targeted recommendation matches lines of
-- that exact coffee; a slot-targeted one (no coffee_id) matches lines whose
-- coffee is the slot's current active assignment.

DROP VIEW IF EXISTS v_palate_recommendation_outcome CASCADE;
CREATE VIEW v_palate_recommendation_outcome AS
SELECT
  vci_r.canonical_user_id,
  clr.id AS recommendation_id, clr.occurred_at AS recommended_at, clr.coffee_id, clr.slot_id,
  -- Liam L3, Part B/E — passthrough so the outcomes page can report marked
  -- vs. detected picks separately (a detected pick is a lower-grade signal).
  clr.detected,
  fl.order_line_item_id AS followed_order_line_item_id,
  fl.occurred_at AS ordered_at,
  CASE WHEN fl.occurred_at IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (fl.occurred_at - clr.occurred_at)) / 86400.0, 2) END AS days_to_order,
  fl.rating AS feedback_rating
FROM customer_liam_recommendation clr
JOIN v_customer_identity vci_r ON vci_r.user_id = clr.user_id
LEFT JOIN LATERAL (
  SELECT vba.order_line_item_id, o.created_at AS occurred_at, vfc.rating
  FROM v_customer_bag_attribution vba
  JOIN order_line_item oli ON oli.id = vba.order_line_item_id
  JOIN "order" o ON o.id = oli.order_id
  JOIN v_customer_identity vci_x ON vci_x.user_id = vba.drinker_user_id
  LEFT JOIN v_customer_feedback_current vfc ON vfc.order_line_item_id = vba.order_line_item_id AND vfc.canonical_user_id = vci_x.canonical_user_id
  WHERE vci_x.canonical_user_id = vci_r.canonical_user_id
    AND vba.attribution <> 'unattributed'
    AND o.created_at > clr.occurred_at
    AND (
      (clr.coffee_id IS NOT NULL AND vba.coffee_id = clr.coffee_id)
      OR (clr.coffee_id IS NULL AND clr.slot_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM coffee_slot_assignment csa WHERE csa.slot_id = clr.slot_id AND csa.coffee_id = vba.coffee_id AND csa.is_active
          ))
    )
  ORDER BY o.created_at ASC
  LIMIT 1
) fl ON true;

-- Liam L3, Part E (2026-09-28) — the calibration export surface. Modeled on
-- v_customer_quiz_current's identity-resolved pattern (one row per canonical
-- customer's latest quiz session), NOT v_subscriber_quiz_results's own
-- subscriber-keyed pattern (LEFT JOIN by raw newsletter_subscriber.user_id) —
-- disclosed deviation from the brief's literal wording ("the
-- v_subscriber_quiz_results columns the fixture uses"): every quiz-taker gets
-- a row here whether or not they ever subscribed, and a household's linked
-- profiles all resolve to the one canonical row. Column NAMES quizRecalibrate.ts
-- actually looks up by (quiz_result_json, primary_archetype, required;
-- email, quiz_completed_at, optional) are kept identical so the CSV export
-- stays a drop-in replacement.
DROP VIEW IF EXISTS v_customer_calibration CASCADE;
CREATE VIEW v_customer_calibration AS
WITH first_rec AS (
  SELECT DISTINCT ON (vci.canonical_user_id)
    vci.canonical_user_id, clr.coffee_id, clr.occurred_at AS recommended_at, clr.detected
  FROM customer_liam_recommendation clr
  JOIN v_customer_identity vci ON vci.user_id = clr.user_id
  ORDER BY vci.canonical_user_id, clr.occurred_at ASC
),
first_order AS (
  SELECT DISTINCT ON (vci.canonical_user_id)
    vci.canonical_user_id, vba.coffee_id, o.created_at AS ordered_at, vfc.rating
  FROM v_customer_bag_attribution vba
  JOIN order_line_item oli ON oli.id = vba.order_line_item_id
  JOIN "order" o ON o.id = oli.order_id
  JOIN v_customer_identity vci ON vci.user_id = vba.drinker_user_id
  LEFT JOIN v_customer_feedback_current vfc ON vfc.order_line_item_id = vba.order_line_item_id AND vfc.canonical_user_id = vci.canonical_user_id
  WHERE vba.attribution <> 'unattributed'
  ORDER BY vci.canonical_user_id, o.created_at ASC
),
thread AS (
  SELECT DISTINCT ON (canonical_user_id) canonical_user_id, status, reply
  FROM v_palate_threads
  WHERE kind = 'thread'
  ORDER BY canonical_user_id, occurred_at DESC
)
SELECT
  qc.canonical_user_id,
  ns.email,
  qc.archetype_name AS primary_archetype,
  qc.secondary_archetype,
  qc.recommendation_mode,
  qc.food_signal_alignment,
  qc.experimental,
  qs.context_data AS quiz_result_json,
  qc.completed_at AS quiz_completed_at,
  qc.quiz_session_id,
  fr.coffee_id AS first_recommendation_coffee,
  fr.recommended_at AS first_recommendation_at,
  fr.detected AS first_recommendation_detected,
  fo.coffee_id AS first_attributed_order_coffee,
  fo.ordered_at AS first_attributed_order_at,
  CASE WHEN fr.recommended_at IS NOT NULL AND fo.ordered_at IS NOT NULL
       THEN ROUND(EXTRACT(EPOCH FROM (fo.ordered_at - fr.recommended_at)) / 86400.0, 2) END AS days_recommendation_to_order,
  fo.rating AS first_order_feedback_rating,
  COALESCE(th.status, 'none') AS thread_status,
  th.reply AS thread_reply,
  -- appended by Prompt 4B (interpretation v2.2, 2026-10-09)
  qc.match_archetype,
  qc.intensity_lean
FROM v_customer_quiz_current qc
JOIN quiz_session qs ON qs.id = qc.quiz_session_id
LEFT JOIN LATERAL (
  SELECT ns2.email
  FROM newsletter_subscriber ns2
  JOIN v_customer_identity vci_ns ON vci_ns.user_id = ns2.user_id
  WHERE vci_ns.canonical_user_id = qc.canonical_user_id
  LIMIT 1
) ns ON true
LEFT JOIN first_rec fr ON fr.canonical_user_id = qc.canonical_user_id
LEFT JOIN first_order fo ON fo.canonical_user_id = qc.canonical_user_id
LEFT JOIN thread th ON th.canonical_user_id = qc.canonical_user_id;

-- Customer Blueprint C3, Part D (Dana's fixture review, 2026-09-27) — rules
-- 1, 2, 3, 4, 6:
--  1. Comparable range excludes disliked bags (inherited from
--     v_palate_shared_traits, rule 1 above); a slot whose OWN coffee this
--     customer rated <= 2 is excluded outright, never just ranked low.
--  2. already_bought / last_rating are informational columns; they never
--     affect ordering.
--  3. Only dimensions where the customer's own shared-trait row has
--     overlaps = true are comparable at all (n_dims_compared excludes the
--     rest) — a crossover profile whose coffees never agree on a dimension
--     (e.g. two very different archetypes) excludes that dimension from
--     comparison entirely, rather than comparing against a range that can't
--     mean anything (min > max). With zero comparable dimensions for every
--     slot, ordering falls through to in_pair as the effective tiebreak.
--  4. Deterministic tiebreak: slot sort_order, then slot id.
--  6. Dislikes push, not just exclude: n_dims_disliked_overlap counts
--     dimensions where a slot's coffee range overlaps ANY range of a coffee
--     this customer rated <= 2 (checked per dimension, independent of
--     whether that dimension is "comparable" under rule 3). A customer with
--     disliked bags but no liked ones still gets ranked candidates — via
--     their quiz pair alone, all n_dims_compared/n_dims_overlapping = 0 for
--     every slot, n_dims_disliked_overlap populated and steering the order.
--     Requires a quiz (D14's "no behaviour yet" fallback still applies to a
--     customer with neither a liked bag nor a quiz: zero rows).
-- Plain DROP VIEW + CREATE, not CREATE OR REPLACE — the whole C3 block's
-- convention as of this fix (lint-customer.mjs Rule 5 enforces it): rule 6
-- inserted n_dims_disliked_overlap ahead of the existing in_pair/
-- already_bought/last_rating columns, and CREATE OR REPLACE VIEW cannot
-- reorder or rename an existing view's columns (error 42P16) — hit for real
-- in production (non-fatal per-statement, but the view was left on its old
-- pre-rule-6 definition until this fix). CASCADE is harmless here (nothing
-- references v_palate_slot_candidates today) and keeps every C3 view on one
-- uniform, future-proof pattern: if something later joins through this view,
-- the CASCADE self-heals within the same boot, same as every other view in
-- this block.
DROP VIEW IF EXISTS v_palate_slot_candidates CASCADE;
CREATE VIEW v_palate_slot_candidates AS
WITH traits AS (
  -- "overlaps" is a reserved word (the OVERLAPS predicate) - must be quoted
  -- as a column reference here or Postgres tries to parse it as that operator.
  SELECT canonical_user_id, trait_key::int AS dimension_id, value_min, value_max
  FROM v_palate_shared_traits WHERE kind = 'dimension' AND "overlaps" = true
),
customers_with_dimension_rows AS (
  SELECT DISTINCT canonical_user_id FROM v_palate_shared_traits WHERE kind = 'dimension'
),
disliked_coffees AS (
  SELECT DISTINCT vci_i.canonical_user_id, vba.coffee_id
  FROM v_customer_bag_attribution vba
  JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id
  JOIN v_customer_feedback_current vfc
    ON vfc.order_line_item_id = vba.order_line_item_id AND vfc.canonical_user_id = vci_i.canonical_user_id
  WHERE vba.attribution <> 'unattributed' AND vfc.rating <= 2
),
disliked_ranges AS (
  SELECT dc.canonical_user_id, cdr.dimension_id, cdr.value_min, cdr.value_max
  FROM disliked_coffees dc
  JOIN v_coffee_dimension_range cdr ON cdr.coffee_id = dc.coffee_id
),
customers_disliked_only AS (
  SELECT DISTINCT dc.canonical_user_id
  FROM disliked_coffees dc
  JOIN v_customer_quiz_current qc ON qc.canonical_user_id = dc.canonical_user_id
  WHERE dc.canonical_user_id NOT IN (SELECT canonical_user_id FROM customers_with_dimension_rows)
),
eligible_customers AS (
  SELECT canonical_user_id FROM customers_with_dimension_rows
  UNION
  SELECT canonical_user_id FROM customers_disliked_only
),
already_bought AS (
  SELECT DISTINCT vci_i.canonical_user_id, vba.coffee_id
  FROM v_customer_bag_attribution vba
  JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id
  WHERE vba.attribution <> 'unattributed'
),
last_feedback AS (
  SELECT DISTINCT ON (canonical_user_id, coffee_id) canonical_user_id, coffee_id, rating
  FROM v_customer_feedback_current
  ORDER BY canonical_user_id, coffee_id, occurred_at DESC
),
slots AS (SELECT * FROM v_coffee_sellable_slot WHERE weight_oz = (SELECT weight_oz FROM coffee_size WHERE is_anchor AND is_active)),
compare AS (
  SELECT c.canonical_user_id, s.slot_id, s.coffee_id, cdr.dimension_id,
    (t.dimension_id IS NOT NULL) AS is_comparable,
    (t.dimension_id IS NOT NULL AND cdr.value_min <= t.value_max AND cdr.value_max >= t.value_min) AS overlaps_dim,
    EXISTS (
      SELECT 1 FROM disliked_ranges dr
      WHERE dr.canonical_user_id = c.canonical_user_id AND dr.dimension_id = cdr.dimension_id
        AND cdr.value_min <= dr.value_max AND cdr.value_max >= dr.value_min
    ) AS is_disliked_overlap
  FROM eligible_customers c
  CROSS JOIN slots s
  JOIN v_coffee_dimension_range cdr ON cdr.coffee_id = s.coffee_id
  LEFT JOIN traits t ON t.canonical_user_id = c.canonical_user_id AND t.dimension_id = cdr.dimension_id
),
agg AS (
  SELECT canonical_user_id, slot_id, coffee_id,
    COUNT(*) FILTER (WHERE is_comparable) AS n_dims_compared,
    COUNT(*) FILTER (WHERE is_comparable AND overlaps_dim) AS n_dims_overlapping,
    COUNT(*) FILTER (WHERE is_disliked_overlap) AS n_dims_disliked_overlap
  FROM compare
  GROUP BY canonical_user_id, slot_id, coffee_id
)
SELECT
  a.canonical_user_id, s.slot_id, s.archetype, s.sort_order, s.slot_name, s.position_label,
  s.coffee_id, s.coffee_name, s.blend_id, s.roaster_sku, s.shopify_variant_id, s.retail_price_cents,
  a.n_dims_overlapping, a.n_dims_compared, a.n_dims_disliked_overlap,
  COALESCE(qc.archetype_code = s.archetype OR qc.secondary_archetype_code = s.archetype, false) AS in_pair,
  (ab.coffee_id IS NOT NULL) AS already_bought,
  lf.rating AS last_rating
FROM agg a
JOIN slots s ON s.slot_id = a.slot_id AND s.coffee_id = a.coffee_id
LEFT JOIN v_customer_quiz_current qc ON qc.canonical_user_id = a.canonical_user_id
LEFT JOIN already_bought ab ON ab.canonical_user_id = a.canonical_user_id AND ab.coffee_id = a.coffee_id
LEFT JOIN last_feedback lf ON lf.canonical_user_id = a.canonical_user_id AND lf.coffee_id = a.coffee_id
WHERE NOT EXISTS (
  SELECT 1 FROM disliked_coffees dc WHERE dc.canonical_user_id = a.canonical_user_id AND dc.coffee_id = a.coffee_id
)
ORDER BY in_pair DESC, a.n_dims_overlapping DESC, a.n_dims_disliked_overlap ASC, a.n_dims_compared DESC, s.sort_order, s.slot_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- END CUSTOMER BLUEPRINT C3 views/tables block
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN ROASTERY PORTAL block (2026-10-05)
-- backend/src/features/roastery_portal/CLAUDE_CODE_PROMPT_ROASTERY_PORTAL_1.md
--
-- Evidence tables for what partner roasteries say about their own coffees.
-- Nothing here writes to the catalog: accepting an answer into
-- roastery_coffee_descriptors / coffees / hops is part 2. One writer
-- (services/roasteryPortalService.ts), views as the read path, nothing is
-- ever deleted (deactivate, revoke, or version).
--
-- Deliberately placed BEFORE the A2 grant loops below: a table or view
-- created after them is not granted to ab_app until the next boot.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. One private, revocable link per roastery (a roastery can have several
-- over time; revoking one never touches the others).
CREATE TABLE IF NOT EXISTS roastery_portal_link (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roaster_id          UUID NOT NULL REFERENCES roaster(id),
  token               TEXT NOT NULL UNIQUE CHECK (length(token) >= 32),
  contact_name        TEXT,
  contact_email       TEXT,
  created_by_admin_id UUID REFERENCES user_profile(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at      TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS roastery_portal_link_roaster_idx ON roastery_portal_link (roaster_id);

-- 2. Who filled it in. One row per (roastery, email).
CREATE TABLE IF NOT EXISTS roastery_portal_respondent (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roaster_id UUID NOT NULL REFERENCES roaster(id),
  link_id    UUID NOT NULL REFERENCES roastery_portal_link(id),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL CHECK (email = lower(email)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (roaster_id, email)
);

-- 3. The roastery's lineup, managed in admin (or added by the roaster),
-- optionally linked to a catalog coffee. The catalog is never touched.
CREATE TABLE IF NOT EXISTS roastery_portal_coffee (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roaster_id              UUID NOT NULL REFERENCES roaster(id),
  name                    TEXT NOT NULL,
  coffee_id               INTEGER REFERENCES coffees(id),
  origin                  TEXT,
  process_values          TEXT[] NOT NULL DEFAULT '{}',
  roast_level             TEXT,
  blend_or_single         TEXT,
  is_decaf                BOOLEAN,
  prefill_source          TEXT CHECK (prefill_source IN ('roaster_site', 'catalog')),
  added_by                TEXT NOT NULL DEFAULT 'admin' CHECK (added_by IN ('admin', 'roaster')),
  added_by_respondent_id  UUID REFERENCES roastery_portal_respondent(id),
  sort_order              INTEGER NOT NULL DEFAULT 0,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roastery_portal_coffee_roaster_idx ON roastery_portal_coffee (roaster_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS roastery_portal_coffee_active_name
  ON roastery_portal_coffee (roaster_id, lower(name)) WHERE is_active;

-- 4. Which numeric dimensions the portal asks, and how it words them. Seeded
-- by dimension NAME (never by id) so a re-seeded coffee_dimensions can't
-- silently repoint a row. The 1 to 5 scale here is relative to the roaster's
-- own lineup, stored in roastery_portal_response_dimension, and is never
-- mixed with cupping values (0 to 15 absolute).
CREATE TABLE IF NOT EXISTS roastery_portal_dimension (
  dimension_id INTEGER PRIMARY KEY REFERENCES coffee_dimensions(id),
  label        TEXT NOT NULL,
  low_label    TEXT NOT NULL,
  high_label   TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO roastery_portal_dimension (dimension_id, label, low_label, high_label, sort_order)
SELECT d.id, v.label, v.low_label, v.high_label, v.sort_order
FROM (VALUES
  ('Acidity',        'Acidity',       'Soft',  'Bright',1),
  ('Sweetness',      'Sweetness',     'Low',   'High',  2),
  ('Bitterness',     'Bitterness',    'Low',   'High',  3),
  ('Body',           'Body',          'Light', 'Full',  4),
  ('Savory / Depth', 'Clarity',       'Clean', 'Layered',5),
  ('Texture',        'Mouthfeel',     'Silky', 'Grippy',6),
  ('Finish Length',  'Finish',        'Short', 'Lingering',7)
) AS v(dimension_name, label, low_label, high_label, sort_order)
JOIN coffee_dimensions d ON d.name = v.dimension_name AND d.is_numeric = true
ON CONFLICT (dimension_id) DO NOTHING;

-- 5. One row per coffee per version. At most one open draft per coffee; a
-- submitted row is never updated or deleted again (trigger below, children
-- included). Reopening a submitted coffee starts a new draft at version + 1.
CREATE TABLE IF NOT EXISTS roastery_portal_response (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_coffee_id                UUID NOT NULL REFERENCES roastery_portal_coffee(id),
  version                         INTEGER NOT NULL CHECK (version >= 1),
  status                          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  origin                          TEXT,
  process_values                  TEXT[] NOT NULL DEFAULT '{}',
  roast_level                     TEXT,
  blend_or_single                 TEXT,
  is_decaf                        BOOLEAN,
  proposed_archetype              archetype_enum,
  dominant_dimension_id           INTEGER REFERENCES coffee_dimensions(id),
  takes_it                        TEXT CHECK (takes_it IN ('black', 'milk', 'both')),
  brew_notes                      TEXT,
  availability                    TEXT,
  typical_notice                  TEXT,
  expected_availability           TEXT,
  similar_when_out                TEXT,
  closest_cousin_portal_coffee_id UUID REFERENCES roastery_portal_coffee(id),
  what_changes                    TEXT,
  anything_else                   TEXT,
  last_saved_by_respondent_id     UUID REFERENCES roastery_portal_respondent(id),
  submitted_by_respondent_id      UUID REFERENCES roastery_portal_respondent(id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at                    TIMESTAMPTZ,
  UNIQUE (portal_coffee_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS roastery_portal_response_one_draft
  ON roastery_portal_response (portal_coffee_id) WHERE status = 'draft';

-- 6. Tasting notes: the roaster's own words, then the closest flavor wheel
-- term. A note with no wheel pick is allowed (words only).
CREATE TABLE IF NOT EXISTS roastery_portal_response_note (
  response_id     UUID NOT NULL REFERENCES roastery_portal_response(id),
  rank            INTEGER NOT NULL CHECK (rank >= 1),
  roaster_words   TEXT NOT NULL,
  cupping_note_id UUID REFERENCES cupping_note(id),
  PRIMARY KEY (response_id, rank)
);

-- 7. The seven 1 to 5 dimension values, relative to the roaster's lineup.
CREATE TABLE IF NOT EXISTS roastery_portal_response_dimension (
  response_id  UUID NOT NULL REFERENCES roastery_portal_response(id),
  dimension_id INTEGER NOT NULL REFERENCES coffee_dimensions(id),
  value        INTEGER NOT NULL CHECK (value BETWEEN 1 AND 5),
  PRIMARY KEY (response_id, dimension_id)
);

-- 8. Brewing: one best method, any number of also-goods.
CREATE TABLE IF NOT EXISTS roastery_portal_response_brew (
  response_id UUID NOT NULL REFERENCES roastery_portal_response(id),
  brew_method TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('best', 'also_good')),
  PRIMARY KEY (response_id, brew_method)
);
CREATE UNIQUE INDEX IF NOT EXISTS roastery_portal_response_brew_one_best
  ON roastery_portal_response_brew (response_id) WHERE role = 'best';

-- 9. The two lineup-wide answers, asked once per roastery, versioned the same
-- way. A coffee's own typical_notice / similar_when_out are overrides; null
-- there means "same as the lineup answer".
CREATE TABLE IF NOT EXISTS roastery_portal_lineup_response (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roaster_id                  UUID NOT NULL REFERENCES roaster(id),
  version                     INTEGER NOT NULL CHECK (version >= 1),
  status                      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  typical_notice              TEXT,
  similar_when_out            TEXT,
  anything_else               TEXT,
  last_saved_by_respondent_id UUID REFERENCES roastery_portal_respondent(id),
  submitted_by_respondent_id  UUID REFERENCES roastery_portal_respondent(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at                TIMESTAMPTZ,
  UNIQUE (roaster_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS roastery_portal_lineup_response_one_draft
  ON roastery_portal_lineup_response (roaster_id) WHERE status = 'draft';

-- Immutability: a submitted response (and its children) is never changed or
-- removed again. CREATE OR REPLACE + DROP TRIGGER IF EXISTS keeps this
-- re-applicable on every boot.
CREATE OR REPLACE FUNCTION roastery_portal_reject_submitted_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'submitted' THEN
    RAISE EXCEPTION 'roastery_portal: a submitted % row is immutable (id %)', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION roastery_portal_reject_submitted_child_change() RETURNS trigger AS $$
DECLARE
  parent_status TEXT;
  parent_id UUID;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.response_id ELSE NEW.response_id END;
  SELECT status INTO parent_status FROM roastery_portal_response WHERE id = parent_id;
  IF parent_status = 'submitted' THEN
    RAISE EXCEPTION 'roastery_portal: % rows of a submitted response are immutable (response %)', TG_TABLE_NAME, parent_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roastery_portal_response_immutable ON roastery_portal_response;
CREATE TRIGGER roastery_portal_response_immutable
  BEFORE UPDATE OR DELETE ON roastery_portal_response
  FOR EACH ROW EXECUTE FUNCTION roastery_portal_reject_submitted_change();

DROP TRIGGER IF EXISTS roastery_portal_lineup_response_immutable ON roastery_portal_lineup_response;
CREATE TRIGGER roastery_portal_lineup_response_immutable
  BEFORE UPDATE OR DELETE ON roastery_portal_lineup_response
  FOR EACH ROW EXECUTE FUNCTION roastery_portal_reject_submitted_change();

DROP TRIGGER IF EXISTS roastery_portal_response_note_immutable ON roastery_portal_response_note;
CREATE TRIGGER roastery_portal_response_note_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON roastery_portal_response_note
  FOR EACH ROW EXECUTE FUNCTION roastery_portal_reject_submitted_child_change();

DROP TRIGGER IF EXISTS roastery_portal_response_dimension_immutable ON roastery_portal_response_dimension;
CREATE TRIGGER roastery_portal_response_dimension_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON roastery_portal_response_dimension
  FOR EACH ROW EXECUTE FUNCTION roastery_portal_reject_submitted_child_change();

DROP TRIGGER IF EXISTS roastery_portal_response_brew_immutable ON roastery_portal_response_brew;
CREATE TRIGGER roastery_portal_response_brew_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON roastery_portal_response_brew
  FOR EACH ROW EXECUTE FUNCTION roastery_portal_reject_submitted_child_change();

-- 10. Vocabulary. Every chip group the portal shows is read from here.
-- 'co-ferment' joins the shared process list (customer-neutral: the catalog
-- simply gains one more allowed process value).
INSERT INTO lookup_value (category, value, label, sort_order) VALUES
  ('process', 'co-ferment', 'Co-ferment', 7)
ON CONFLICT (category, value) DO NOTHING;

-- Values are EXACTLY the customer brew-profile vocabulary
-- (getBrewProfileFieldsConfig().brew_methods.allowedValues); the labels are
-- the roaster-friendly wording. A test fails if the two ever drift apart.
INSERT INTO lookup_value (category, value, label, sort_order) VALUES
  ('roastery_portal_brew_method', 'v60',          'Pour-over',    1),
  ('roastery_portal_brew_method', 'drip',         'Batch brew / drip', 2),
  ('roastery_portal_brew_method', 'espresso',     'Espresso',     3),
  ('roastery_portal_brew_method', 'french_press', 'French press', 4),
  ('roastery_portal_brew_method', 'aeropress',    'AeroPress',    5),
  ('roastery_portal_brew_method', 'moka',         'Moka pot',     6),
  ('roastery_portal_brew_method', 'cold_brew',    'Cold brew',    7),
  ('roastery_portal_brew_method', 'other',        'Other',        8),
  ('roastery_portal_availability', 'always_on',       'Year-round (core)', 1),
  ('roastery_portal_availability', 'rotating',        'Seasonal',        2),
  ('roastery_portal_availability', 'limited_release', 'Limited release', 3),
  ('roastery_portal_notice', 'under_2_weeks',  'Under 2 weeks',  1),
  ('roastery_portal_notice', '2_to_4_weeks',   '2 to 4 weeks',   2),
  ('roastery_portal_notice', '1_to_2_months',  '1 to 2 months',  3),
  ('roastery_portal_notice', '2_plus_months',  '2+ months',      4),
  ('roastery_portal_notice', 'unpredictable',  'Unpredictable',  5),
  ('roastery_portal_similar', 'yes',       'Yes',       1),
  ('roastery_portal_similar', 'usually',   'Usually',   2),
  ('roastery_portal_similar', 'sometimes', 'Sometimes', 3),
  ('roastery_portal_similar', 'no',        'No',        4),
  ('roastery_portal_similar', 'not_sure',  'Not sure',  5),
  ('roastery_portal_takes_it', 'black', 'Best black',      1),
  ('roastery_portal_takes_it', 'milk',  'Great with milk', 2),
  ('roastery_portal_takes_it', 'both',  'Works both ways', 3)
ON CONFLICT (category, value) DO NOTHING;

-- ── Roastery portal part 2 (2026-10-05): accept answers into the catalog ──────
-- Portal tables hold what the roaster said and are never edited after submit;
-- catalog tables hold what Dana decided. Accepting goes only through
-- catalogService, records which response version it came from, and nothing is
-- ever copied back from the catalog into the portal.

-- The FK from roastery_coffee_descriptors.source_response_id (column added next
-- to the table itself, early in this file) to the version a row was accepted from.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roastery_coffee_descriptors_source_response_fk') THEN
    ALTER TABLE roastery_coffee_descriptors
      ADD CONSTRAINT roastery_coffee_descriptors_source_response_fk
      FOREIGN KEY (source_response_id) REFERENCES roastery_portal_response(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_roastery_desc_active ON roastery_coffee_descriptors (coffee_id) WHERE is_active;

-- Insert-only log of every accept: what was applied, with the catalog value before and after.
CREATE TABLE IF NOT EXISTS roastery_portal_acceptance (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id           UUID NOT NULL REFERENCES roastery_portal_response(id),
  portal_coffee_id      UUID NOT NULL REFERENCES roastery_portal_coffee(id),
  coffee_id             INTEGER NOT NULL REFERENCES coffees(id),
  created_coffee        BOOLEAN NOT NULL DEFAULT false,
  applied               JSONB NOT NULL,
  accepted_by_admin_id  UUID REFERENCES user_profile(id),
  accepted_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roastery_portal_acceptance_coffee_idx ON roastery_portal_acceptance (portal_coffee_id, accepted_at DESC);

CREATE OR REPLACE FUNCTION roastery_portal_acceptance_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM roastery_portal_response WHERE id = NEW.response_id AND status = 'submitted' AND portal_coffee_id = NEW.portal_coffee_id) THEN
      RAISE EXCEPTION 'roastery_portal: an acceptance must point at a submitted version of its own coffee (response %)', NEW.response_id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'roastery_portal: roastery_portal_acceptance is insert-only'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roastery_portal_acceptance_insert_guard ON roastery_portal_acceptance;
CREATE TRIGGER roastery_portal_acceptance_insert_guard
  BEFORE INSERT ON roastery_portal_acceptance
  FOR EACH ROW EXECUTE FUNCTION roastery_portal_acceptance_guard();
DROP TRIGGER IF EXISTS roastery_portal_acceptance_immutable ON roastery_portal_acceptance;
CREATE TRIGGER roastery_portal_acceptance_immutable
  BEFORE UPDATE OR DELETE ON roastery_portal_acceptance
  FOR EACH ROW EXECUTE FUNCTION roastery_portal_acceptance_guard();

-- The remembered translations: a roaster's words -> a flavor wheel term. Offered as
-- the suggestion the next time the same words appear (any roastery); never auto-applied.
-- Changing one supersedes the old row and inserts a new one (history kept).
CREATE TABLE IF NOT EXISTS roastery_portal_note_mapping (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_words    TEXT NOT NULL,
  cupping_note_id     UUID NOT NULL REFERENCES cupping_note(id),
  created_by_admin_id UUID REFERENCES user_profile(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS roastery_portal_note_mapping_active
  ON roastery_portal_note_mapping (normalized_words) WHERE superseded_at IS NULL;

-- The one definition of "the roaster's dominant dimension matches ours" (display only,
-- never a gate): either side missing = unknown (null).
CREATE OR REPLACE FUNCTION roastery_portal_dimension_matches(roaster_dim INTEGER, our_dim INTEGER) RETURNS BOOLEAN AS $$
  SELECT CASE WHEN roaster_dim IS NULL OR our_dim IS NULL THEN NULL ELSE roaster_dim = our_dim END;
$$ LANGUAGE sql IMMUTABLE;

-- ── Roastery portal part 3 (2026-10-06): roaster wording + the questions we were missing ─────────
-- Labels change; stored values, the dimensions asked and the write/read paths do not.

-- New per-coffee answers (all optional). is_decaf is DEPRECATED: nothing writes it any more, the
-- column stays, submitted rows are never backfilled (they are immutable); caffeine_level below is
-- what readers use (v_roastery_portal_response derives it from is_decaf when it is not set).
ALTER TABLE roastery_portal_response ADD COLUMN IF NOT EXISTS additives_present BOOLEAN;
ALTER TABLE roastery_portal_response ADD COLUMN IF NOT EXISTS additives_detail  TEXT;
-- roast_intent ("Roasted for") is DEPRECATED in place (part 4, 2026-10-06; Camila: it duplicates the brewing questions):
-- the column stays, nothing reads or writes it, the view below no longer exposes it and progress no longer counts it.
-- The roastery_portal_roast_intent lookup rows stay, unused.
ALTER TABLE roastery_portal_response ADD COLUMN IF NOT EXISTS roast_intent      TEXT;
ALTER TABLE roastery_portal_response ADD COLUMN IF NOT EXISTS blend_components  TEXT;
ALTER TABLE roastery_portal_response ADD COLUMN IF NOT EXISTS blend_rotation    TEXT;
ALTER TABLE roastery_portal_response ADD COLUMN IF NOT EXISTS caffeine_level    TEXT;
ALTER TABLE roastery_portal_response ADD COLUMN IF NOT EXISTS decaf_process     TEXT;
ALTER TABLE roastery_portal_response ADD COLUMN IF NOT EXISTS certifications    TEXT[] NOT NULL DEFAULT '{}';

-- "Which of these do you sell most?": up to three of the roastery's own lineup coffees, in order,
-- asked once per lineup response (versioned and immutable after submit like every other child set).
CREATE TABLE IF NOT EXISTS roastery_portal_lineup_response_best_seller (
  lineup_response_id UUID    NOT NULL REFERENCES roastery_portal_lineup_response(id),
  portal_coffee_id   UUID    NOT NULL REFERENCES roastery_portal_coffee(id),
  rank               INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  PRIMARY KEY (lineup_response_id, rank),
  UNIQUE (lineup_response_id, portal_coffee_id)
);

CREATE OR REPLACE FUNCTION roastery_portal_reject_submitted_lineup_child_change() RETURNS trigger AS $$
DECLARE
  parent_status TEXT;
  parent_id UUID;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.lineup_response_id ELSE NEW.lineup_response_id END;
  SELECT status INTO parent_status FROM roastery_portal_lineup_response WHERE id = parent_id;
  IF parent_status = 'submitted' THEN
    RAISE EXCEPTION 'roastery_portal: % rows of a submitted lineup response are immutable (lineup response %)', TG_TABLE_NAME, parent_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roastery_portal_lineup_best_seller_immutable ON roastery_portal_lineup_response_best_seller;
CREATE TRIGGER roastery_portal_lineup_best_seller_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON roastery_portal_lineup_response_best_seller
  FOR EACH ROW EXECUTE FUNCTION roastery_portal_reject_submitted_lineup_child_change();

INSERT INTO lookup_value (category, value, label, sort_order) VALUES
  ('roastery_portal_roast_intent', 'filter',   'Filter',       1),
  ('roastery_portal_roast_intent', 'espresso', 'Espresso',     2),
  ('roastery_portal_roast_intent', 'omni',     'Both (omni)',  3),
  ('roastery_portal_blend_rotation', 'fixed',                'Fixed recipe',                        1),
  ('roastery_portal_blend_rotation', 'rotates_same_profile', 'Components rotate, profile stays',    2),
  ('roastery_portal_blend_rotation', 'seasonal',             'Changes with the season',             3),
  ('roastery_portal_caffeine', 'regular',   'Regular',   1),
  ('roastery_portal_caffeine', 'half_caff', 'Half-caff', 2),
  ('roastery_portal_caffeine', 'decaf',     'Decaf',     3),
  ('roastery_portal_decaf_process', 'swiss_water',    'Swiss Water',    1),
  ('roastery_portal_decaf_process', 'sugarcane_ea',   'Sugarcane (EA)', 2),
  ('roastery_portal_decaf_process', 'mountain_water', 'Mountain Water', 3),
  ('roastery_portal_decaf_process', 'co2',            'CO2',            4),
  ('roastery_portal_decaf_process', 'other',          'Other',          5),
  ('roastery_portal_certification', 'usda_organic',       'USDA Organic',       1),
  ('roastery_portal_certification', 'fair_trade',         'Fair Trade',         2),
  ('roastery_portal_certification', 'rainforest_alliance','Rainforest Alliance',3),
  ('roastery_portal_certification', 'other',              'Other',              4),
  ('roastery_portal_certification', 'none',               'None',               5)
ON CONFLICT (category, value) DO NOTHING;

-- Rewording for rows that already exist in a database. Each UPDATE is guarded on the OLD label, so a
-- label someone edited by hand is never overwritten (and re-applying is a no-op). The seed INSERTs
-- above carry the new wording, so a fresh database gets it directly.
UPDATE lookup_value SET label = 'Best black'          WHERE category = 'roastery_portal_takes_it' AND value = 'black' AND label = 'Black';
UPDATE lookup_value SET label = 'Great with milk'     WHERE category = 'roastery_portal_takes_it' AND value = 'milk'  AND label = 'With milk';
UPDATE lookup_value SET label = 'Works both ways'     WHERE category = 'roastery_portal_takes_it' AND value = 'both'  AND label = 'Both';
UPDATE lookup_value SET label = 'Batch brew / drip'   WHERE category = 'roastery_portal_brew_method' AND value = 'drip' AND label = 'Drip';
UPDATE lookup_value SET label = 'Year-round (core)'   WHERE category = 'roastery_portal_availability' AND value = 'always_on' AND label = 'Always on';
UPDATE lookup_value SET label = 'Seasonal'            WHERE category = 'roastery_portal_availability' AND value = 'rotating'  AND label = 'Rotating';
UPDATE roastery_portal_dimension p SET low_label  = 'Soft'      FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Acidity'        AND p.low_label  = 'Low';
UPDATE roastery_portal_dimension p SET high_label = 'Bright'    FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Acidity'        AND p.high_label = 'High';
UPDATE roastery_portal_dimension p SET label      = 'Clarity'   FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Savory / Depth' AND p.label      = 'Clean to deep';
UPDATE roastery_portal_dimension p SET high_label = 'Layered'   FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Savory / Depth' AND p.high_label = 'Deep';
UPDATE roastery_portal_dimension p SET label      = 'Mouthfeel' FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Texture'        AND p.label      = 'Texture';
UPDATE roastery_portal_dimension p SET high_label = 'Grippy'    FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Texture'        AND p.high_label = 'Drying';
UPDATE roastery_portal_dimension p SET label      = 'Finish'    FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Finish Length'  AND p.label      = 'Finish length';
UPDATE roastery_portal_dimension p SET high_label = 'Lingering' FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Finish Length'  AND p.high_label = 'Long';

-- 11. Views (DROP + CREATE, never CREATE OR REPLACE: a column added ahead of
-- existing ones is exactly what OR REPLACE silently refuses).
DROP VIEW IF EXISTS v_roastery_portal_dimension_match;
DROP VIEW IF EXISTS v_roastery_portal_cousin_hint;
DROP VIEW IF EXISTS v_roastery_portal_coffee_hint;
DROP VIEW IF EXISTS v_roastery_portal_lineup_current_response;
DROP VIEW IF EXISTS v_roastery_portal_progress;
DROP VIEW IF EXISTS v_roastery_portal_current_response;
DROP VIEW IF EXISTS v_roastery_portal_response;
DROP VIEW IF EXISTS v_roastery_portal_coffee;

-- Lineup row with its prefill values. When the lineup row is linked to a
-- catalog coffee, the catalog's values (v_coffee) are used, field by field,
-- wherever the catalog has one, EXCEPT for rows loaded from the roaster's own
-- site (prefill_source = 'roaster_site'): there the roaster's own words win
-- and the catalog only fills the gaps, so linking a coffee never hides what
-- the roaster published about it.
CREATE VIEW v_roastery_portal_coffee AS
SELECT
  pc.id AS portal_coffee_id,
  pc.roaster_id,
  pc.name,
  pc.coffee_id,
  CASE WHEN pc.prefill_source = 'roaster_site'
       THEN COALESCE(NULLIF(pc.origin, ''), vc.origin)
       ELSE COALESCE(vc.origin, NULLIF(pc.origin, '')) END AS origin,
  CASE WHEN pc.prefill_source = 'roaster_site'
       THEN COALESCE(NULLIF(pc.process_values, '{}'), CASE WHEN vc.process IS NULL THEN '{}'::text[] ELSE ARRAY[vc.process] END)
       ELSE COALESCE(CASE WHEN vc.process IS NULL THEN NULL ELSE ARRAY[vc.process] END, pc.process_values) END AS process_values,
  CASE WHEN pc.prefill_source = 'roaster_site'
       THEN COALESCE(pc.roast_level, vc.roast_level)
       ELSE COALESCE(vc.roast_level, pc.roast_level) END AS roast_level,
  CASE WHEN pc.prefill_source = 'roaster_site'
       THEN COALESCE(pc.blend_or_single, vc.blend_or_single)
       ELSE COALESCE(vc.blend_or_single, pc.blend_or_single) END AS blend_or_single,
  pc.is_decaf,
  CASE WHEN pc.coffee_id IS NOT NULL AND pc.prefill_source IS DISTINCT FROM 'roaster_site'
            AND (vc.origin IS NOT NULL OR vc.process IS NOT NULL OR vc.roast_level IS NOT NULL OR vc.blend_or_single IS NOT NULL)
       THEN 'catalog' ELSE pc.prefill_source END AS prefill_source,
  pc.added_by,
  pc.added_by_respondent_id,
  pc.sort_order,
  pc.is_active,
  pc.created_at
FROM roastery_portal_coffee pc
LEFT JOIN v_coffee vc ON vc.id = pc.coffee_id;

-- Per lineup coffee: the open draft if one exists, else the latest submitted
-- version. (A coffee nobody has touched has no row here.)
-- Part 3 (2026-10-06): every response row with ONE effective caffeine_level. The new column when
-- set, else 'decaf' / 'regular' derived from the deprecated is_decaf answer (a response saved
-- before part 3 keeps showing its caffeine; is_decaf null = not answered). This view is the only
-- definition: the current-response view and every read of a single version go through it.
CREATE VIEW v_roastery_portal_response AS
SELECT r.id, r.portal_coffee_id, r.version, r.status, r.origin, r.process_values, r.roast_level, r.blend_or_single,
       r.is_decaf, r.proposed_archetype, r.dominant_dimension_id, r.takes_it, r.brew_notes, r.availability,
       r.typical_notice, r.expected_availability, r.similar_when_out, r.closest_cousin_portal_coffee_id,
       r.what_changes, r.anything_else, r.last_saved_by_respondent_id, r.submitted_by_respondent_id,
       r.created_at, r.updated_at, r.submitted_at,
       r.additives_present, r.additives_detail, r.blend_components, r.blend_rotation,
       r.decaf_process, r.certifications,
       COALESCE(r.caffeine_level, CASE WHEN r.is_decaf IS TRUE THEN 'decaf' WHEN r.is_decaf IS FALSE THEN 'regular' END) AS caffeine_level
FROM roastery_portal_response r;

-- Per lineup coffee: the open draft if one exists, else the latest submitted
-- version. (A coffee nobody has touched has no row here.)
CREATE VIEW v_roastery_portal_current_response AS
SELECT DISTINCT ON (r.portal_coffee_id) r.*
FROM v_roastery_portal_response r
ORDER BY r.portal_coffee_id, (r.status = 'draft') DESC, r.version DESC;

-- Per lineup coffee: state, sections answered (0 to 6), who/when, versions,
-- and whether the notes still need mapping to the flavor wheel.
--   state: 'submitted' once any version was submitted (an open draft on top of
--          it is flagged by has_open_draft, not hidden), 'in_progress' for a
--          draft with no submission yet, else 'not_started'.
--   has_unmapped_notes looks at the latest submitted version when there is
--          one (that is the evidence), else at the draft.
CREATE VIEW v_roastery_portal_progress AS
WITH cur AS (
  SELECT * FROM v_roastery_portal_current_response
), evidence AS (
  SELECT DISTINCT ON (r.portal_coffee_id) r.portal_coffee_id, r.id AS response_id
  FROM roastery_portal_response r
  ORDER BY r.portal_coffee_id, (r.status = 'submitted') DESC, r.version DESC
), last_sub AS (
  SELECT DISTINCT ON (r.portal_coffee_id) r.portal_coffee_id, r.submitted_at, r.submitted_by_respondent_id, r.version
  FROM roastery_portal_response r
  WHERE r.status = 'submitted'
  ORDER BY r.portal_coffee_id, r.version DESC
), sub_count AS (
  SELECT portal_coffee_id, count(*)::int AS n FROM roastery_portal_response WHERE status = 'submitted' GROUP BY portal_coffee_id
), accepted AS (
  SELECT DISTINCT ON (a.portal_coffee_id) a.portal_coffee_id, a.accepted_at, r.version AS accepted_version
  FROM roastery_portal_acceptance a
  JOIN roastery_portal_response r ON r.id = a.response_id
  ORDER BY a.portal_coffee_id, a.accepted_at DESC
)
SELECT
  pc.id AS portal_coffee_id,
  pc.roaster_id,
  pc.name,
  pc.sort_order,
  pc.is_active,
  CASE WHEN ls.portal_coffee_id IS NOT NULL THEN 'submitted'
       WHEN cur.id IS NOT NULL THEN 'in_progress'
       ELSE 'not_started' END AS state,
  COALESCE(cur.status = 'draft', false) AS has_open_draft,
  CASE WHEN cur.id IS NULL THEN 0 ELSE
    ( (cur.origin IS NOT NULL OR cardinality(cur.process_values) > 0 OR cur.roast_level IS NOT NULL
       OR cur.blend_or_single IS NOT NULL OR cur.caffeine_level IS NOT NULL OR cur.additives_present IS NOT NULL
       OR cur.blend_components IS NOT NULL OR cur.blend_rotation IS NOT NULL
       OR cardinality(cur.certifications) > 0)::int
    + (EXISTS (SELECT 1 FROM roastery_portal_response_note n WHERE n.response_id = cur.id) OR cur.proposed_archetype IS NOT NULL)::int
    + (EXISTS (SELECT 1 FROM roastery_portal_response_dimension d WHERE d.response_id = cur.id) OR cur.dominant_dimension_id IS NOT NULL)::int
    + (EXISTS (SELECT 1 FROM roastery_portal_response_brew b WHERE b.response_id = cur.id) OR cur.takes_it IS NOT NULL OR cur.brew_notes IS NOT NULL)::int
    + (cur.availability IS NOT NULL OR cur.typical_notice IS NOT NULL OR cur.expected_availability IS NOT NULL
       OR cur.similar_when_out IS NOT NULL OR cur.closest_cousin_portal_coffee_id IS NOT NULL OR cur.what_changes IS NOT NULL)::int
    + (cur.anything_else IS NOT NULL)::int )
  END AS sections_answered,
  cur.id AS current_response_id,
  cur.version AS current_version,
  cur.updated_at AS last_saved_at,
  cur.last_saved_by_respondent_id,
  saver.name AS last_saved_by_name,
  ls.submitted_at,
  ls.submitted_by_respondent_id,
  submitter.name AS submitted_by_name,
  COALESCE(sc.n, 0) AS submitted_version_count,
  EXISTS (
    SELECT 1 FROM evidence ev
    JOIN roastery_portal_response_note n ON n.response_id = ev.response_id
    WHERE ev.portal_coffee_id = pc.id AND n.cupping_note_id IS NULL
  ) AS has_unmapped_notes,
  ac.accepted_version,
  ac.accepted_at,
  (ac.accepted_version IS NOT NULL AND ls.version > ac.accepted_version) AS changed_since_accept,
  ls.version AS latest_submitted_version,
  -- from the latest SUBMITTED version only (evidence for Dana; display only, never a label or ingredients text)
  COALESCE(lsr.additives_present, false) AS additives_present,
  CASE WHEN lsr.additives_present IS TRUE THEN lsr.additives_detail END AS additives_detail,
  (lsr.blend_or_single = 'blend' AND lsr.blend_rotation IN ('rotates_same_profile', 'seasonal')) AS blend_recipe_changes
FROM roastery_portal_coffee pc
LEFT JOIN cur ON cur.portal_coffee_id = pc.id
LEFT JOIN last_sub ls ON ls.portal_coffee_id = pc.id
LEFT JOIN sub_count sc ON sc.portal_coffee_id = pc.id
LEFT JOIN accepted ac ON ac.portal_coffee_id = pc.id
LEFT JOIN v_roastery_portal_response lsr ON lsr.portal_coffee_id = ls.portal_coffee_id AND lsr.version = ls.version
LEFT JOIN roastery_portal_respondent saver ON saver.id = cur.last_saved_by_respondent_id
LEFT JOIN roastery_portal_respondent submitter ON submitter.id = ls.submitted_by_respondent_id;

-- The lineup-wide answers have no per-coffee key, so "current" gets its own view
-- (open draft, else latest submitted), same rule as v_roastery_portal_current_response.
CREATE VIEW v_roastery_portal_lineup_current_response AS
SELECT DISTINCT ON (lr.roaster_id) lr.*
FROM roastery_portal_lineup_response lr
ORDER BY lr.roaster_id, (lr.status = 'draft') DESC, lr.version DESC;

-- Per catalog coffee: what the roaster said, from the latest submitted response of
-- the linked lineup coffee. Hints only: nothing here is ever written to the catalog.
CREATE VIEW v_roastery_portal_coffee_hint AS
WITH latest AS (
  SELECT DISTINCT ON (pc.coffee_id)
         pc.coffee_id, pc.id AS portal_coffee_id, pc.roaster_id, r.id AS response_id, r.version,
         r.submitted_at, r.submitted_by_respondent_id, r.proposed_archetype, r.dominant_dimension_id
  FROM roastery_portal_coffee pc
  JOIN roastery_portal_response r ON r.portal_coffee_id = pc.id AND r.status = 'submitted'
  WHERE pc.coffee_id IS NOT NULL
  ORDER BY pc.coffee_id, r.submitted_at DESC, r.version DESC
)
SELECT
  l.coffee_id,
  l.portal_coffee_id,
  l.response_id,
  l.version,
  l.submitted_at,
  resp.name AS respondent_name,
  l.proposed_archetype,
  l.dominant_dimension_id,
  pd.label AS dominant_dimension_label,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'dimension_id', rd.dimension_id, 'label', d.label, 'low_label', d.low_label,
             'high_label', d.high_label, 'value', rd.value) ORDER BY d.sort_order)
    FROM roastery_portal_response_dimension rd
    JOIN roastery_portal_dimension d ON d.dimension_id = rd.dimension_id
    WHERE rd.response_id = l.response_id
  ), '[]'::jsonb) AS dimensions
FROM latest l
LEFT JOIN roastery_portal_respondent resp ON resp.id = l.submitted_by_respondent_id
LEFT JOIN roastery_portal_dimension pd ON pd.dimension_id = l.dominant_dimension_id;

-- Per lineup coffee with a closest cousin (latest submitted response): both lineup
-- coffees, both catalog ids when linked, the "what changes" text, and each coffee's
-- roaster-stated dominant dimension (from its own latest submitted response).
CREATE VIEW v_roastery_portal_cousin_hint AS
WITH latest AS (
  SELECT DISTINCT ON (r.portal_coffee_id) r.*
  FROM roastery_portal_response r
  WHERE r.status = 'submitted'
  ORDER BY r.portal_coffee_id, r.version DESC
)
SELECT
  l.id AS response_id,
  l.version,
  pc.roaster_id,
  pc.id AS portal_coffee_id,
  pc.name AS coffee_name,
  pc.coffee_id,
  l.dominant_dimension_id,
  d1.label AS dominant_dimension_label,
  cz.id AS cousin_portal_coffee_id,
  cz.name AS cousin_name,
  cz.coffee_id AS cousin_coffee_id,
  lc.dominant_dimension_id AS cousin_dominant_dimension_id,
  d2.label AS cousin_dominant_dimension_label,
  l.what_changes,
  l.submitted_at
FROM latest l
JOIN roastery_portal_coffee pc ON pc.id = l.portal_coffee_id
JOIN roastery_portal_coffee cz ON cz.id = l.closest_cousin_portal_coffee_id
LEFT JOIN latest lc ON lc.portal_coffee_id = cz.id
LEFT JOIN roastery_portal_dimension d1 ON d1.dimension_id = l.dominant_dimension_id
LEFT JOIN roastery_portal_dimension d2 ON d2.dimension_id = lc.dominant_dimension_id
WHERE l.closest_cousin_portal_coffee_id IS NOT NULL;

-- Decision 11: the roaster's dominant dimension next to ours, plain Matches / Differs.
-- "Ours" is a decided fact, never a computed guess: the dimension of the slot the
-- coffee is placed in (its active home placement, else any active one), else the
-- dominant dimension of its match archetype, else null ("not placed yet"). The merged
-- cupping range on the roaster's dimension is context only (v_coffee_dimension_range).
-- Display and evidence: this never blocks, warns on, or changes a placement.
CREATE VIEW v_roastery_portal_dimension_match AS
WITH placed AS (
  SELECT DISTINCT ON (a.coffee_id) a.coffee_id, s.id AS slot_id, s.name AS slot_name, s.dimension_id AS slot_dimension_id
  FROM coffee_slot_assignment a
  JOIN coffee_dial_slot s ON s.id = a.slot_id AND s.is_active
  WHERE a.is_active
  ORDER BY a.coffee_id, (a.role = 'home') DESC, a.priority, a.id
), matched AS (
  SELECT ca.coffee_id, ar.dominant_dimension_id
  FROM coffee_archetype_assignment ca
  JOIN coffee_archetype ar ON ar.code = ca.archetype
  WHERE ca.superseded_at IS NULL
)
SELECT
  h.coffee_id,
  h.response_id,
  h.dominant_dimension_id AS roaster_dimension_id,
  rd.name AS roaster_dimension_name,
  CASE WHEN p.slot_dimension_id IS NOT NULL THEN p.slot_dimension_id ELSE m.dominant_dimension_id END AS our_dimension_id,
  od.name AS our_dimension_name,
  CASE WHEN p.slot_dimension_id IS NOT NULL THEN 'slot'
       WHEN m.dominant_dimension_id IS NOT NULL THEN 'match_archetype'
       ELSE NULL END AS our_source,
  CASE WHEN p.slot_dimension_id IS NOT NULL THEN p.slot_name ELSE NULL END AS our_slot_name,
  roastery_portal_dimension_matches(
    h.dominant_dimension_id,
    CASE WHEN p.slot_dimension_id IS NOT NULL THEN p.slot_dimension_id ELSE m.dominant_dimension_id END
  ) AS matches,
  rng.value_min AS range_min,
  rng.value_max AS range_max,
  rng.n_scores AS range_n_scores,
  rng.basis AS range_basis
FROM v_roastery_portal_coffee_hint h
LEFT JOIN placed p ON p.coffee_id = h.coffee_id
LEFT JOIN matched m ON m.coffee_id = h.coffee_id
LEFT JOIN coffee_dimensions rd ON rd.id = h.dominant_dimension_id
LEFT JOIN coffee_dimensions od ON od.id = CASE WHEN p.slot_dimension_id IS NOT NULL THEN p.slot_dimension_id ELSE m.dominant_dimension_id END
LEFT JOIN v_coffee_dimension_range rng ON rng.coffee_id = h.coffee_id AND rng.dimension_id = h.dominant_dimension_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- END ROASTERY PORTAL block
-- ═══════════════════════════════════════════════════════════════════════════


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
           OR tablename IN ('quiz_session', 'quiz_session_interpretation', 'order', 'order_line_item', 'catalog_change'))
      AND tablename <> 'customer_order_kind'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON %I TO ab_app', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM ab_app', t);
  END LOOP;
END $$;

-- The one sanctioned fact UPDATE, granted per D11's explicit column list.
-- UPDATE (Prompt 4B, 2026-10-09): the SCD2 flip now exists.
-- services/quizSession.ts closeCurrentInterpretation() sets exactly
-- (valid_to, is_current) on a session's superseded current row; its only
-- caller is the interpretation backfill (quizInterpretationBackfill.ts,
-- scripts/backfillQuizInterpretation.ts), which runs under the owner role and
-- refuses ab_app, in the same transaction that inserts the successor row. The
-- live path stays INSERT-only. Listed in lint-customer.mjs RULE2_ALLOWLIST.
-- History of this grant, for the record: Task 0 (2026-09-27) confirmed this covered NO live call site then: both
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
             OR tablename IN ('quiz_session', 'quiz_session_interpretation', 'order', 'order_line_item', 'catalog_change'))
        OR tablename = 'customer_order_kind'
      )
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ab_app', t);
  END LOOP;
END $$;

-- Quiz content is master data with one writer, the V7 seed in this file,
-- running as the owner (Prompt 4A, 2026-10-08). The request pool only ever
-- reads it: SELECT and nothing else on the quiz content tables and the
-- 2026-10-08 snapshot tables, overriding the operating grant just above.
-- quizIntegrity.ts check 16 fails if this ever drifts.
DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND (tablename IN ('quiz', 'quiz_type', 'quiz_question', 'quiz_answer', 'quiz_answer_archetype_score')
           OR tablename LIKE 'quiz\_backup\_20261008\_%' ESCAPE '\')
  LOOP
    EXECUTE format('REVOKE ALL ON %I FROM ab_app', t);
    EXECUTE format('GRANT SELECT ON %I TO ab_app', t);
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
