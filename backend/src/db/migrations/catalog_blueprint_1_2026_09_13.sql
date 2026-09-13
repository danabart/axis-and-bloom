-- Catalog Blueprint · brief 1 — schema, views, integrity (2026-09-13)
--
-- STATUS: not run as a standalone step — every statement below is also in
-- schema.sql (idempotent: CREATE TABLE/TYPE IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, self-healing DO/EXCEPTION blocks for constraints and partial unique
-- indexes), which runs automatically on every backend startup. This file
-- exists only as the narrative record, same convention as
-- transactional_email_log_2026_08_18.sql and
-- coffees_colombia_guatemala_datafix_2026_08_26.sql.
--
-- See backend/src/features/catalog_blueprint/README.md (series overview,
-- decisions D1-D6/N1-N7) and this brief's own
-- CLAUDE_CODE_PROMPT_CATALOG_1_SCHEMA_VIEWS_INTEGRITY.md for full context.
--
-- Additive only — nothing existing is dropped, renamed, or re-pointed:
--   * `archetype` gains `code` (the one identity going forward, N2),
--     `sort_order`, `has_bloom_dial`, `is_archetype`, `dominant_dimension_id`,
--     `descriptor_families` — all backfilled from `dial_archetype_config` /
--     name / the real SCA wheel_category strings.
--   * `coffee_dial_slot` (new) — the slot's own name/label/spec, backfilled
--     from `dial_slot_alias` + `dial_position_vocabulary` (expect 24 rows).
--   * `coffee_slot_assignment` (new) — placement/fulfilment as one fact
--     (D1/D5). No backfill (N3) — starts empty, the catalog is empty.
--   * `archetype_assignments`, `roaster_blend`, `dial_slot_price`,
--     `user_bloom_dial_current_position` each gain one tightening index or
--     column; nothing already there changes meaning.
--   * Five views: `v_coffee_archetype`, `v_coffee`, `v_coffee_slot`,
--     `v_coffee_sellable_slot`, `v_coffee_hop` — the only place a slot or an
--     archetype label is ever derived, going forward (brief 3 moves readers
--     onto them; nothing reads them yet).
--
-- Safe to run any time, before or after any code deploy — nothing in this
-- brief is read or written by application code yet (brief 2).

-- ── B1-B4: schema ────────────────────────────────────────────────────────────

ALTER TABLE archetype ADD COLUMN IF NOT EXISTS code archetype_enum;
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS sort_order INT;
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS has_bloom_dial BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS is_archetype BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS dominant_dimension_id INT REFERENCES coffee_dimensions(id);
ALTER TABLE archetype ADD COLUMN IF NOT EXISTS descriptor_families TEXT[] NOT NULL DEFAULT '{}';

UPDATE archetype SET code = CASE name
  WHEN 'Chocolate & Nutty' THEN 'chocolate_nutty' WHEN 'Balanced & Sweet' THEN 'balanced_sweet'
  WHEN 'Fruity' THEN 'fruity' WHEN 'Earthy' THEN 'earthy' WHEN 'Floral' THEN 'floral'
  WHEN 'Experimental' THEN 'experimental' END::archetype_enum
WHERE code IS NULL;

UPDATE archetype a SET
  has_bloom_dial = dac.has_bloom_dial, is_archetype = dac.is_archetype,
  dominant_dimension_id = dac.dominant_dimension_id
FROM dial_archetype_config dac WHERE dac.archetype = a.code;

UPDATE archetype SET sort_order = CASE code
  WHEN 'floral' THEN 1 WHEN 'fruity' THEN 2 WHEN 'balanced_sweet' THEN 3
  WHEN 'chocolate_nutty' THEN 4 WHEN 'earthy' THEN 5 WHEN 'experimental' THEN 6 END
WHERE sort_order IS NULL;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS archetype_code_key ON archetype(code);
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- Real DISTINCT wheel_category strings from cupping_note (verified against
-- backend/src/db/seeds/cupping_notes_sca_wheel.sql / schema.sql's own SCA
-- wheel seed) — note the spaces around "/". 'Other' deliberately excluded.
UPDATE archetype SET descriptor_families = CASE code
  WHEN 'chocolate_nutty' THEN ARRAY['Nutty / Cocoa','Sweet']
  WHEN 'balanced_sweet'  THEN ARRAY['Sweet','Nutty / Cocoa','Fruity']
  WHEN 'fruity'          THEN ARRAY['Fruity','Sour / Fermented']
  WHEN 'floral'          THEN ARRAY['Floral','Fruity']
  WHEN 'earthy'          THEN ARRAY['Green / Vegetative','Spices','Roasted']
  WHEN 'experimental'    THEN ARRAY[]::TEXT[]
  END
WHERE descriptor_families = '{}';

CREATE TABLE IF NOT EXISTS coffee_dial_slot (
  id                       SERIAL PRIMARY KEY,
  archetype                archetype_enum NOT NULL REFERENCES archetype(code),
  sort_order               INT NOT NULL CHECK (sort_order BETWEEN 1 AND 4),
  name                     TEXT NOT NULL,
  position_label           TEXT NOT NULL,
  position_description     TEXT,
  dimension_id             INT REFERENCES coffee_dimensions(id),
  is_landing_default       BOOLEAN NOT NULL DEFAULT false,
  spec_band_lo             NUMERIC,
  spec_band_hi             NUMERIC,
  spec_descriptor_families TEXT[] NOT NULL DEFAULT '{}',
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

INSERT INTO coffee_dial_slot (archetype, sort_order, name, position_label, position_description, dimension_id, is_landing_default)
SELECT dsa.archetype, dsa.dial_sort_order, dsa.platform_name, dpv.label, dpv.description, dpv.dimension_id,
       (dsa.dial_sort_order = 2)
FROM dial_slot_alias dsa
JOIN dial_position_vocabulary dpv ON dpv.archetype = dsa.archetype AND dpv.sort_order = dsa.dial_sort_order
ON CONFLICT (archetype, sort_order) DO NOTHING;

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
  placement_note      TEXT,
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

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS archetype_assignments_one_current
    ON archetype_assignments(coffee_id) WHERE superseded_at IS NULL;
EXCEPTION WHEN unique_violation THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE assignment_source_enum AS ENUM ('cupping', 'manual', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE archetype_assignments ADD COLUMN IF NOT EXISTS source assignment_source_enum;
UPDATE archetype_assignments SET source = CASE WHEN assigned_from_session_id IS NOT NULL THEN 'cupping' ELSE 'manual' END::assignment_source_enum WHERE source IS NULL;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS roaster_blend_one_active_per_weight
    ON roaster_blend(coffee_id, weight_oz) WHERE is_active = true AND coffee_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN NULL; END $$;

ALTER TABLE dial_slot_price ADD COLUMN IF NOT EXISTS slot_id INT REFERENCES coffee_dial_slot(id);
UPDATE dial_slot_price p SET slot_id = s.id FROM coffee_dial_slot s
 WHERE p.slot_id IS NULL AND s.archetype = p.archetype AND s.sort_order = p.dial_sort_order;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS dial_slot_price_slot_weight_key ON dial_slot_price(slot_id, weight_oz) WHERE slot_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN NULL; END $$;

ALTER TABLE user_bloom_dial_current_position ADD COLUMN IF NOT EXISTS slot_id INT REFERENCES coffee_dial_slot(id);
UPDATE user_bloom_dial_current_position u SET slot_id = s.id FROM coffee_dial_slot s
 WHERE u.slot_id IS NULL AND s.archetype = u.archetype AND s.sort_order = u.dial_sort_order;

-- ── Part C: views ────────────────────────────────────────────────────────────

-- Drop in reverse dependency order first (v_coffee_slot/v_coffee_sellable_slot/
-- v_coffee_hop all read v_coffee) — a bare DROP VIEW IF EXISTS v_coffee on a
-- second run otherwise fails with "other objects depend on it".
DROP VIEW IF EXISTS v_coffee_hop;
DROP VIEW IF EXISTS v_coffee_sellable_slot;
DROP VIEW IF EXISTS v_coffee_slot;
DROP VIEW IF EXISTS v_coffee;
DROP VIEW IF EXISTS v_coffee_archetype;

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
FROM archetype a
LEFT JOIN coffee_dimensions d ON d.id = a.dominant_dimension_id
ORDER BY a.sort_order;

CREATE VIEW v_coffee AS
SELECT
  c.id, c.name, c.origin, c.blend_or_single, c.process, c.roast_level, c.roast_shade,
  c.flavor_descriptors_roaster, c.ai_summary, c.surprise_note, c.three_voice_story,
  c.story, c.story_draft, c.story_published, c.story_admin_edited, c.story_generated_at,
  c.roaster_id,
  COALESCE(r.name, c.roaster)     AS roaster_name,
  (r.name IS NULL)                AS roaster_name_is_fallback,
  aa.archetype                    AS match_archetype,
  aa.confidence                   AS match_confidence,
  aa.source                       AS match_source,
  aa.assigned_from_session_id     AS match_session_id,
  COALESCE(cat.category_codes, ARRAY[]::TEXT[]) AS category_codes,
  c.story_published               AS has_story,
  c.is_active, c.deactivated_at, c.deactivation_reason
FROM coffees c
LEFT JOIN roaster r              ON r.id = c.roaster_id
LEFT JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
LEFT JOIN (
  SELECT cca.coffee_id, ARRAY_AGG(cc.code ORDER BY cc.code) AS category_codes
  FROM coffee_category_assignment cca
  JOIN coffee_category cc ON cc.id = cca.category_id
  GROUP BY cca.coffee_id
) cat ON cat.coffee_id = c.id;

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

CREATE VIEW v_coffee_sellable_slot AS
SELECT DISTINCT ON (cand.slot_id, cand.weight_oz)
  cand.slot_id, cand.archetype, cand.sort_order, cand.slot_name, cand.position_label,
  cand.is_landing_default, cand.weight_oz, cand.coffee_id, cand.coffee_name, cand.roaster_id,
  cand.role, cand.priority, cand.blend_id, cand.roaster_sku, cand.shopify_variant_id,
  dsp.retail_price_cents
FROM (
  SELECT
    cds.id             AS slot_id,
    cds.archetype,
    cds.sort_order,
    cds.name           AS slot_name,
    cds.position_label,
    cds.is_landing_default,
    rb.weight_oz,
    vc.id              AS coffee_id,
    vc.name            AS coffee_name,
    vc.roaster_id,
    csa.role,
    csa.priority,
    rb.id              AS blend_id,
    rb.roaster_sku,
    rb.shopify_variant_id
  FROM coffee_dial_slot cds
  JOIN coffee_slot_assignment csa ON csa.slot_id = cds.id AND csa.is_active = true
  JOIN v_coffee vc                ON vc.id = csa.coffee_id AND vc.is_active = true
  JOIN roaster_blend rb           ON rb.coffee_id = vc.id AND rb.is_active = true
  WHERE cds.is_active = true AND cds.name IS NOT NULL
    AND NOT (vc.category_codes && ARRAY['decaf','half_caf','flavored'])
    AND (cds.archetype = 'experimental' OR NOT (vc.category_codes && ARRAY['experimental']))
) cand
LEFT JOIN dial_slot_price dsp ON dsp.slot_id = cand.slot_id AND dsp.weight_oz = cand.weight_oz
WHERE dsp.retail_price_cents IS NOT NULL
ORDER BY cand.slot_id, cand.weight_oz, (cand.role = 'home') DESC, cand.priority;

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
  END::hop_type_enum   AS hop_type_derived,
  dcr.hop_type         AS hop_type_stored
FROM dial_coffee_relationships dcr
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

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT code, sort_order, descriptor_families FROM v_coffee_archetype ORDER BY sort_order;
-- SELECT COUNT(*) FROM coffee_dial_slot;  -- expect 24
-- SELECT * FROM coffee_slot_assignment;   -- expect 0 rows (N3, no backfill)
