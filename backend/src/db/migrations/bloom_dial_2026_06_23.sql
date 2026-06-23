-- Bloom Dial migration — 2026-06-23
-- Safe to run multiple times (fully idempotent).
-- Run in Cloud SQL Studio: axis-and-bloom-prod → axisandbloom database.
-- NOTE: enums hop_direction_enum and hop_type_enum already created — skip that block if re-running.

-- ─── Enums (already applied — included for completeness) ─────────────────────

DO $$ BEGIN
  CREATE TYPE hop_direction_enum AS ENUM ('more', 'less');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE hop_type_enum AS ENUM ('within_archetype', 'bridge_archetype');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dial_archetype_config (
  archetype              archetype_enum PRIMARY KEY,
  dominant_dimension_id  INT REFERENCES coffee_dimensions(id),
  has_bloom_dial         BOOLEAN DEFAULT TRUE,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dial_position_vocabulary (
  id            SERIAL PRIMARY KEY,
  archetype     archetype_enum NOT NULL,
  dimension_id  INT REFERENCES coffee_dimensions(id) NOT NULL,
  sort_order    INT NOT NULL,
  label         TEXT NOT NULL,
  description   TEXT,
  UNIQUE(archetype, dimension_id, sort_order)
);

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

-- ─── Seed data ────────────────────────────────────────────────────────────────

INSERT INTO dial_archetype_config (archetype, dominant_dimension_id, has_bloom_dial) VALUES
  ('chocolate_nutty', 7, true),
  ('balanced_sweet',  5, true),
  ('fruity',          5, true),
  ('floral',          9, true),
  ('earthy',          6, true)
ON CONFLICT (archetype) DO NOTHING;

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

-- ─── Verify ───────────────────────────────────────────────────────────────────

SELECT 'hop_direction_enum' AS item, string_agg(enumlabel, ', ' ORDER BY enumsortorder) AS values
FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'hop_direction_enum'
UNION ALL
SELECT 'hop_type_enum', string_agg(enumlabel, ', ' ORDER BY enumsortorder)
FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'hop_type_enum'
UNION ALL
SELECT 'dial_archetype_config rows',      COUNT(*)::text FROM dial_archetype_config
UNION ALL
SELECT 'dial_position_vocabulary rows',   COUNT(*)::text FROM dial_position_vocabulary
UNION ALL
SELECT 'dial_archetype_positions exists', to_regclass('dial_archetype_positions')::text
UNION ALL
SELECT 'dial_coffee_relationships exists', to_regclass('dial_coffee_relationships')::text;
