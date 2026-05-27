-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Roastery descriptors — Session 001 coffees (Path Coffee Roasters)
-- Populates coffee_roastery_descriptors from bag note language.
-- Roastery terms are subcategory-level (e.g. "Dried Fruit", "Citrus") not SCA
-- leaf descriptors, so each is mapped to the closest SCA leaf; the roaster's
-- exact language is stored in the `notes` column.
--
-- Mapping decisions:
--   Caramel      → Caramelized      (Sweet / Brown Sugar)
--   Dried Fruit  → Raisin           (Fruity / Dried Fruit — most common in coffee)
--   Citrus       → Lemon            (Fruity / Citrus Fruit — most common in light roasts)
--   Stone Fruit  → Cherry           (Fruity / Other Fruit — stone fruit = cherry/peach)
--   Floral       → Jasmine          (Floral / Floral — Ethiopian florals are typically jasmine-forward)
--   Brown Sugar  → Caramelized      (Sweet / Brown Sugar — closest SCA leaf)
--   Cocoa        → Chocolate        (Nutty / Cocoa)
--
-- Safe to re-run: ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING
-- ─────────────────────────────────────────────────────────────────────────────

-- Also re-creates the view in case it hasn't updated from the last deploy.
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
  JOIN session_coffees sc ON sc.id = cs.session_coffee_id
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
  FROM coffee_roastery_descriptors crd
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
  FROM client_flavor_feedback cff
  JOIN coffees      c  ON c.id  = cff.coffee_id
  JOIN cupping_note cn ON cn.id = cff.cupping_note_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Roastery descriptors
-- ─────────────────────────────────────────────────────────────────────────────

-- Crosshatch (Nicaragua & Ethiopia blend) — bag notes: Caramel, Dried Fruit, Citrus
INSERT INTO coffee_roastery_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Caramel'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Raisin'),
    'Dried Fruit'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Lemon'),
    'Citrus'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Ethiopia (Ethiopia single) — bag notes: Stone Fruit, Floral, Citrus
INSERT INTO coffee_roastery_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Cherry'),
    'Stone Fruit'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Jasmine'),
    'Floral'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Lemon'),
    'Citrus'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Feather In Cap (Colombia & Ethiopia blend) — bag notes: Brown Sugar, Cocoa, Dried Fruit
INSERT INTO coffee_roastery_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Brown Sugar'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Chocolate'),
    'Cocoa'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Prune'),
    'Dried Fruit'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT coffee_name, descriptor, wheel_category, source
-- FROM v_collaborative_flavor_wheel
-- ORDER BY coffee_name, descriptor;
