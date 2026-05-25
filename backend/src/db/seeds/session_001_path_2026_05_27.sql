-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Session 001 — Path Coffee Roasters, 2026-05-27
-- Run once in Cloud SQL Studio. Do NOT add to schema.sql (it is not idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

WITH

-- 1. Session header
ins_session AS (
  INSERT INTO cupping_sessions (session_date, brew_method, location, session_notes)
  VALUES (
    '2026-05-27',
    'filter'::brew_method_enum,
    'Path Coffee Roasters',
    'First cupping session. Two tasters: Dana and Camila. First time cupping — scores treated as directional. Merged into one result set.'
  )
  RETURNING id AS session_id
),

-- 2. Coffees
ins_crosshatch AS (
  INSERT INTO coffees (name, roaster, origin, blend_or_single, process, roast_level, flavor_descriptors_roaster)
  VALUES (
    'Crosshatch',
    'Path Coffee Roasters',
    'Nicaragua & Ethiopia',
    'blend',
    'washed',
    'light-medium',
    ARRAY['Caramel', 'Dried Fruit', 'Citrus']
  )
  RETURNING id AS coffee_id
),

ins_ethiopia AS (
  INSERT INTO coffees (name, roaster, origin, blend_or_single, process, roast_level, flavor_descriptors_roaster)
  VALUES (
    'Ethiopia',
    'Path Coffee Roasters',
    'Ethiopia',
    'single',
    'washed',
    'light-medium',
    ARRAY['Stone Fruit', 'Floral', 'Citrus']
  )
  RETURNING id AS coffee_id
),

ins_feather AS (
  INSERT INTO coffees (name, roaster, origin, blend_or_single, process, roast_level, flavor_descriptors_roaster)
  VALUES (
    'Feather In Cap',
    'Path Coffee Roasters',
    'Colombia & Ethiopia',
    'blend',
    'washed',
    'medium-dark',
    ARRAY['Brown Sugar', 'Cocoa', 'Dried Fruit']
  )
  RETURNING id AS coffee_id
),

-- 3. Session–coffee junctions (display_order = tasting order)
ins_sc_crosshatch AS (
  INSERT INTO session_coffees (session_id, coffee_id, display_order)
  SELECT session_id, coffee_id, 1 FROM ins_session, ins_crosshatch
  RETURNING id AS sc_id
),

ins_sc_ethiopia AS (
  INSERT INTO session_coffees (session_id, coffee_id, display_order)
  SELECT session_id, coffee_id, 2 FROM ins_session, ins_ethiopia
  RETURNING id AS sc_id
),

ins_sc_feather AS (
  INSERT INTO session_coffees (session_id, coffee_id, display_order)
  SELECT session_id, coffee_id, 3 FROM ins_session, ins_feather
  RETURNING id AS sc_id
),

-- 4. Merged cupping scores
ins_score_crosshatch AS (
  INSERT INTO cupping_scores (
    session_coffee_id, taster_name, is_merged,
    sweetness_min, sweetness_max, sweetness_notes,
    acidity_min,   acidity_max,   acidity_notes,
    bitterness_min, bitterness_max, bitterness_notes,
    fragrance_notes, aroma_notes, flavor_notes
  )
  SELECT
    sc_id, 'session_1_merged', true,
    9, 11, 'honey, sweet',
    6,  8, 'apple, banana, coconut — soft and round',
    3,  5, 'present but not a feature',
    'fruity, honey, sweet, cocoa',
    'cocoa, sweet',
    'dark chocolate, dried fruit, citrus, sweet'
  FROM ins_sc_crosshatch
  RETURNING id
),

ins_score_ethiopia AS (
  INSERT INTO cupping_scores (
    session_coffee_id, taster_name, is_merged,
    sweetness_min, sweetness_max, sweetness_notes,
    acidity_min,   acidity_max,   acidity_notes,
    bitterness_min, bitterness_max, bitterness_notes,
    body_notes,
    fragrance_notes, aroma_notes, flavor_notes, mouthfeel_notes
  )
  SELECT
    sc_id, 'session_1_merged', true,
    6,  8, 'fruit-driven brightness not sugar',
    8, 10, 'pineapple — brightest of the three',
    0,  2, 'trace only — Dana scored zero',
    'delicate, tea-like',
    'berries, dried fruits, citrus, black tea',
    'fruit, floral, citrus, lemon, black tea',
    'black tea, dry, floral',
    'tea-like, clean'
  FROM ins_sc_ethiopia
  RETURNING id
),

ins_score_feather AS (
  INSERT INTO cupping_scores (
    session_coffee_id, taster_name, is_merged,
    sweetness_min,  sweetness_max,  sweetness_notes,
    acidity_min,    acidity_max,    acidity_notes,
    bitterness_min, bitterness_max, bitterness_notes,
    texture_notes,
    fragrance_notes, aroma_notes, flavor_notes, mouthfeel_notes
  )
  SELECT
    sc_id, 'session_1_merged', true,
    7, 9, 'sweet on nose, tobacco took over in cup',
    2, 4, 'low — not noted by either taster',
    5, 7, 'tobacco and burnt character — adjusted down from raw scores, tobacco/smoke may have read as bitter',
    'drying',
    'cocoa, sweet, earthy, tobacco',
    'earthy, smoky, spices, tobacco, burnt',
    'tobacco, burnt',
    'drying'
  FROM ins_sc_feather
  RETURNING id
),

-- 5. Archetype assignments (superseded_at = NULL = current)
ins_arch_crosshatch AS (
  INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, notes)
  SELECT
    coffee_id,
    'balanced_sweet'::archetype_enum,
    'high'::confidence_enum,
    session_id,
    'Classic balanced profile. Both tasters independently ranked sweetest. Soft round acidity. No bitterness edge.'
  FROM ins_crosshatch, ins_session
  RETURNING id
),

ins_arch_ethiopia AS (
  INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, notes)
  SELECT
    coffee_id,
    'fruity'::archetype_enum,
    'high'::confidence_enum,
    session_id,
    'Black tea, dried fruit, pineapple acidity, zero bitterness, delicate body. Both tasters in strong agreement on character.'
  FROM ins_ethiopia, ins_session
  RETURNING id
),

ins_arch_feather AS (
  INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, notes)
  SELECT
    coffee_id,
    'chocolate_nutty'::archetype_enum,
    'medium'::confidence_enum,
    session_id,
    'Tobacco, smoke, cocoa, drying finish. Sits at lighter end of chocolate archetype. Bitterness score adjusted — tobacco character may have inflated initial read. Needs Nocturnal in next session to confirm position.'
  FROM ins_feather, ins_session
  RETURNING id
)

-- Final SELECT just to confirm everything ran
SELECT
  (SELECT session_id FROM ins_session)         AS session_id,
  (SELECT coffee_id  FROM ins_crosshatch)      AS crosshatch_id,
  (SELECT coffee_id  FROM ins_ethiopia)        AS ethiopia_id,
  (SELECT coffee_id  FROM ins_feather)         AS feather_id,
  (SELECT sc_id      FROM ins_sc_crosshatch)   AS sc_crosshatch_id,
  (SELECT sc_id      FROM ins_sc_ethiopia)     AS sc_ethiopia_id,
  (SELECT sc_id      FROM ins_sc_feather)      AS sc_feather_id,
  (SELECT id         FROM ins_score_crosshatch) AS score_crosshatch_id,
  (SELECT id         FROM ins_score_ethiopia)   AS score_ethiopia_id,
  (SELECT id         FROM ins_score_feather)    AS score_feather_id,
  (SELECT id         FROM ins_arch_crosshatch)  AS arch_crosshatch_id,
  (SELECT id         FROM ins_arch_ethiopia)    AS arch_ethiopia_id,
  (SELECT id         FROM ins_arch_feather)     AS arch_feather_id;
