-- Bloom Dial — positions & navigation seed + views
-- Run in Cloud SQL Studio: axis-and-bloom-prod → axisandbloom database.
-- Safe to run multiple times (fully idempotent).
-- Prerequisite: bloom_dial_2026_06_23.sql must already have been run (tables + vocab seed).

-- ─── Views ────────────────────────────────────────────────────────────────────

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

-- ─── Seed: dial_archetype_positions ──────────────────────────────────────────
-- Session 001 coffees: Crosshatch (balanced_sweet), Ethiopia (fruity),
-- Feather In Cap (chocolate_nutty). Positions based on cupping scores.
-- Acidity (dim 5) scale: 1=Smooth 2=Balanced 3=Bright 4=Lively
-- Body (dim 7) scale:    1=Lighter 2=Classic  3=Richer 4=Full

DO $$
DECLARE
  v_crosshatch_id  INT;
  v_ethiopia_id    INT;
  v_feather_id     INT;
  v_vocab_balanced INT;   -- balanced_sweet, acidity dim 5, sort_order 2 → 'Balanced'
  v_vocab_bright   INT;   -- fruity, acidity dim 5, sort_order 3 → 'Bright'
  v_vocab_richer   INT;   -- chocolate_nutty, body dim 7, sort_order 3 → 'Richer'
BEGIN
  SELECT id INTO v_crosshatch_id FROM coffees WHERE name ILIKE '%crosshatch%' LIMIT 1;
  SELECT id INTO v_ethiopia_id   FROM coffees WHERE name ILIKE '%ethiopia%'   LIMIT 1;
  SELECT id INTO v_feather_id    FROM coffees WHERE name ILIKE '%feather%'    LIMIT 1;

  SELECT id INTO v_vocab_balanced FROM dial_position_vocabulary
    WHERE archetype = 'balanced_sweet'  AND dimension_id = 5 AND sort_order = 2;
  SELECT id INTO v_vocab_bright   FROM dial_position_vocabulary
    WHERE archetype = 'fruity'          AND dimension_id = 5 AND sort_order = 3;
  SELECT id INTO v_vocab_richer   FROM dial_position_vocabulary
    WHERE archetype = 'chocolate_nutty' AND dimension_id = 7 AND sort_order = 3;

  -- Crosshatch: acidity midpoint ~7 → 'Balanced' on balanced_sweet dial
  IF v_crosshatch_id IS NOT NULL AND v_vocab_balanced IS NOT NULL THEN
    INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
      VALUES ('balanced_sweet', v_crosshatch_id, v_vocab_balanced, true)
      ON CONFLICT (archetype, coffee_id) DO NOTHING;
  END IF;

  -- Ethiopia: acidity midpoint ~9 → 'Bright' on fruity dial
  IF v_ethiopia_id IS NOT NULL AND v_vocab_bright IS NOT NULL THEN
    INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
      VALUES ('fruity', v_ethiopia_id, v_vocab_bright, true)
      ON CONFLICT (archetype, coffee_id) DO NOTHING;
  END IF;

  -- Feather In Cap: heavier body → 'Richer' on chocolate_nutty dial
  IF v_feather_id IS NOT NULL AND v_vocab_richer IS NOT NULL THEN
    INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
      VALUES ('chocolate_nutty', v_feather_id, v_vocab_richer, true)
      ON CONFLICT (archetype, coffee_id) DO NOTHING;
  END IF;
END $$;

-- ─── Seed: dial_coffee_relationships ─────────────────────────────────────────
-- Bidirectional bridges between the three Session 001 coffees.
-- Crosshatch (balanced_sweet) ↔ Ethiopia (fruity):   acidity axis, dim 5, delta ~2
-- Crosshatch (balanced_sweet) ↔ Feather In Cap (chocolate_nutty): body axis, dim 7, delta ~2

DO $$
DECLARE
  v_crosshatch_id INT;
  v_ethiopia_id   INT;
  v_feather_id    INT;
BEGIN
  SELECT id INTO v_crosshatch_id FROM coffees WHERE name ILIKE '%crosshatch%' LIMIT 1;
  SELECT id INTO v_ethiopia_id   FROM coffees WHERE name ILIKE '%ethiopia%'   LIMIT 1;
  SELECT id INTO v_feather_id    FROM coffees WHERE name ILIKE '%feather%'    LIMIT 1;

  -- Crosshatch ↔ Ethiopia: acidity bridge (balanced_sweet ↔ fruity)
  IF v_crosshatch_id IS NOT NULL AND v_ethiopia_id IS NOT NULL THEN
    INSERT INTO dial_coffee_relationships
      (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
    VALUES
      (v_crosshatch_id, v_ethiopia_id, 5, 'more', 2, 'bridge_archetype', true,  'high',   'Brighter acidity → Fruity'),
      (v_ethiopia_id, v_crosshatch_id, 5, 'less', 2, 'bridge_archetype', true,  'high',   'Softer acidity → Balanced & Sweet')
    ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
  END IF;

  -- Crosshatch ↔ Feather In Cap: body bridge (balanced_sweet ↔ chocolate_nutty)
  IF v_crosshatch_id IS NOT NULL AND v_feather_id IS NOT NULL THEN
    INSERT INTO dial_coffee_relationships
      (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
    VALUES
      (v_crosshatch_id, v_feather_id, 7, 'more', 2, 'bridge_archetype', true,  'medium', 'Fuller body → Chocolate & Nutty'),
      (v_feather_id, v_crosshatch_id, 7, 'less', 2, 'bridge_archetype', true,  'medium', 'Lighter body → Balanced & Sweet')
    ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
  END IF;
END $$;

-- ─── Verify ───────────────────────────────────────────────────────────────────

SELECT 'v_dial_positions exists',   to_regclass('v_dial_positions')::text
UNION ALL
SELECT 'v_dial_navigation exists',  to_regclass('v_dial_navigation')::text
UNION ALL
SELECT 'dial_archetype_positions rows', COUNT(*)::text FROM dial_archetype_positions
UNION ALL
SELECT 'dial_coffee_relationships rows', COUNT(*)::text FROM dial_coffee_relationships;

-- Quick check — what's on the dial right now
SELECT * FROM v_dial_positions;
SELECT * FROM v_dial_navigation;
