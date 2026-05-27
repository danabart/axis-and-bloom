-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Internal cupping descriptors — Session 001 (Path Coffee Roasters)
-- Populates cupping_score_descriptors from the merged session notes.
--
-- Source notes (taster_name = 'session_1_merged'):
--   Crosshatch:     fragrance=fruity/honey/sweet/cocoa, aroma=cocoa/sweet,
--                   flavor=dark chocolate/dried fruit/citrus/sweet
--   Ethiopia:       fragrance=berries/dried fruits/citrus/black tea,
--                   aroma=fruit/floral/citrus/lemon/black tea,
--                   flavor=black tea/dry/floral, mouthfeel=tea-like/clean
--   Feather In Cap: fragrance=cocoa/sweet/earthy/tobacco,
--                   aroma=earthy/smoky/spices/tobacco/burnt,
--                   flavor=tobacco/burnt, mouthfeel=drying
--
-- Mapping decisions (free-text → SCA leaf descriptor):
--   dark chocolate  → Dark Chocolate   (Nutty/Cocoa)
--   cocoa           → Chocolate        (Nutty/Cocoa)
--   dried fruit     → Raisin           (Fruity/Dried Fruit)
--   citrus / lemon  → Lemon            (Fruity/Citrus Fruit)
--   honey           → Honey            (Sweet/Brown Sugar)
--   black tea       → Black Tea        (Floral)
--   floral          → Jasmine          (Floral/Floral — Ethiopian florals)
--   berries         → Blueberry        (Fruity/Berry)
--   earthy          → Musty / Earthy   (Other/Papery/Musty)
--   tobacco         → Tobacco          (Roasted)
--   smoky           → Smoky            (Roasted/Burnt)
--   burnt           → Roast            (Roasted/Burnt)
--   spices          → Pepper           (Spices — generic)
--
-- Safe to re-run: ON CONFLICT (cupping_score_id, cupping_note_id) DO NOTHING
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Crosshatch ───────────────────────────────────────────────────────────────
INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id, notes)
SELECT
  cs.id,
  cn.id,
  data.notes
FROM (VALUES
  ('Dark Chocolate', 'dark chocolate'),
  ('Chocolate',      'cocoa'),
  ('Raisin',         'dried fruit'),
  ('Lemon',          'citrus'),
  ('Honey',          'honey / sweet')
) AS data(descriptor, notes)
JOIN cupping_note cn ON cn.descriptor = data.descriptor
JOIN cupping_scores cs ON cs.taster_name = 'session_1_merged'
JOIN session_coffees sc ON sc.id = cs.session_coffee_id
JOIN coffees c ON c.id = sc.coffee_id
  AND c.name = 'Crosshatch'
  AND c.roaster = 'Path Coffee Roasters'
ON CONFLICT (cupping_score_id, cupping_note_id) DO NOTHING;

-- ── Ethiopia ─────────────────────────────────────────────────────────────────
INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id, notes)
SELECT
  cs.id,
  cn.id,
  data.notes
FROM (VALUES
  ('Black Tea',  'black tea'),
  ('Jasmine',    'floral'),
  ('Blueberry',  'berries'),
  ('Raisin',     'dried fruits'),
  ('Lemon',      'citrus / lemon')
) AS data(descriptor, notes)
JOIN cupping_note cn ON cn.descriptor = data.descriptor
JOIN cupping_scores cs ON cs.taster_name = 'session_1_merged'
JOIN session_coffees sc ON sc.id = cs.session_coffee_id
JOIN coffees c ON c.id = sc.coffee_id
  AND c.name = 'Ethiopia'
  AND c.roaster = 'Path Coffee Roasters'
ON CONFLICT (cupping_score_id, cupping_note_id) DO NOTHING;

-- ── Feather In Cap ───────────────────────────────────────────────────────────
INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id, notes)
SELECT
  cs.id,
  cn.id,
  data.notes
FROM (VALUES
  ('Chocolate',      'cocoa'),
  ('Musty / Earthy', 'earthy'),
  ('Tobacco',        'tobacco'),
  ('Smoky',          'smoky'),
  ('Roast',          'burnt'),
  ('Pepper',         'spices')
) AS data(descriptor, notes)
JOIN cupping_note cn ON cn.descriptor = data.descriptor
JOIN cupping_scores cs ON cs.taster_name = 'session_1_merged'
JOIN session_coffees sc ON sc.id = cs.session_coffee_id
JOIN coffees c ON c.id = sc.coffee_id
  AND c.name = 'Feather In Cap'
  AND c.roaster = 'Path Coffee Roasters'
ON CONFLICT (cupping_score_id, cupping_note_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification — should show all three sources for session 001 coffees
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT coffee_name, descriptor, wheel_category, source
-- FROM v_collaborative_flavor_wheel
-- ORDER BY coffee_name, source, descriptor;
