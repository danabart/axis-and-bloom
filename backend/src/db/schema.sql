-- Axis & Bloom PostgreSQL Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users (Firebase UID as primary key)
CREATE TABLE IF NOT EXISTS users (
  uid           TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Coffee profiles / archetypes catalog
CREATE TABLE IF NOT EXISTS coffee_profiles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  archetype     TEXT NOT NULL,
  price_cents   INTEGER NOT NULL,
  currency      TEXT DEFAULT 'USD',
  description   TEXT,
  tasting_notes TEXT[],
  roast_level   TEXT,
  brew_methods  TEXT[],
  shopify_variant_id TEXT,
  decaf         BOOLEAN DEFAULT FALSE,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Quiz answers + resulting archetype per user
CREATE TABLE IF NOT EXISTS quiz_results (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  uid           TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  archetype     TEXT NOT NULL,
  scores        JSONB NOT NULL,
  answers       JSONB NOT NULL,
  decaf         BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quiz_results_uid_idx ON quiz_results(uid);
CREATE INDEX IF NOT EXISTS quiz_results_created_idx ON quiz_results(created_at DESC);

-- Orders (local record; fulfillment goes to Shopify)
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  uid               TEXT REFERENCES users(uid) ON DELETE SET NULL,
  shopify_order_id  TEXT,
  status            TEXT DEFAULT 'pending',
  items             JSONB NOT NULL,
  shipping_address  JSONB,
  total_cents       INTEGER,
  currency          TEXT DEFAULT 'USD',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_uid_idx ON orders(uid);

-- Newsletter subscribers
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  email       TEXT PRIMARY KEY,
  subscribed  BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages for AI agent conversation history
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  uid         TEXT REFERENCES users(uid) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  context     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_uid_idx ON chat_messages(uid);
