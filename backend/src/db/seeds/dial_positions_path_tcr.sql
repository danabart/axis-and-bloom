-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: dial_archetype_positions — Path Coffee Roasters + Temecula Coffee Roasters
-- Source: coffees sheet — name, roaster, archetype_estimate, dial_position
-- Do NOT add to schema.sql — not idempotent.
-- Depends on: coffees_path_tcr.sql (Task 1) must be run first.
--
-- dial_position → sort_order:
--   Approachable / Gentle → 1
--   Default               → 2
--   Bold                  → 3
--   Complex               → 4
--
-- Skips: experimental (Kopi Safari), half_caf (Sleepwalker), decaf, flavored
--   — no dial_position_vocabulary rows exist for those archetypes.
-- Skips coffees with dial_position = '—' (no position assigned).
--
-- is_default per roaster per archetype:
--   balanced_sweet:  Feather In Cap (Path), Guatemala (TCR)
--   chocolate_nutty: Noam Blend (Path),     Brazil Santos (TCR)
--   earthy:          Nocturnal Dark Roast (Path), Sumatra (TCR)
--   floral:          Honduras (Path),        Ethiopia Natural (TCR)
--   fruity:          Ethiopia (Path),        Tanzania (TCR)
--
-- vocabulary_id resolved via: SELECT id FROM dial_position_vocabulary
--   WHERE archetype = '<archetype_enum>' AND sort_order = <n>
--
-- Safe to re-run: ON CONFLICT (archetype, coffee_id) DO NOTHING
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PATH COFFEE ROASTERS ─────────────────────────────────────────────────────

-- Colombia (Path) — balanced_sweet, sort_order=1 (Approachable → Smooth)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'balanced_sweet',
  (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 1),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'balanced_sweet'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters')
);

-- Feather In Cap (Path) — balanced_sweet, sort_order=2 (Default → Balanced) [IS DEFAULT]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'balanced_sweet',
  (SELECT id FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 2),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'balanced_sweet'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters')
);

-- Crosshatch (Path) — balanced_sweet, sort_order=3 (Bold → Bright)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'balanced_sweet',
  (SELECT id FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 3),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'balanced_sweet'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters')
);

-- Noam Blend (Path) — chocolate_nutty, sort_order=2 (Default → Classic) [IS DEFAULT]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'chocolate_nutty',
  (SELECT id FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'chocolate_nutty' AND sort_order = 2),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'chocolate_nutty'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters')
);

-- Nocturnal Dark Roast (Path) — earthy, sort_order=2 (Default → Earthy) [IS DEFAULT]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'earthy',
  (SELECT id FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 2),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'earthy'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters')
);

-- Vantablack Ultra-Dark (Path) — earthy, sort_order=3 (Bold → Bold)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'earthy',
  (SELECT id FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 3),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'earthy'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters')
);

-- Honduras (Path) — floral, sort_order=2 (Default → Balanced) [IS DEFAULT]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'floral',
  (SELECT id FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'floral' AND sort_order = 2),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'floral'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters')
);

-- Ethiopia (Path) — fruity, sort_order=4 (Complex → Vibrant) [IS DEFAULT — only fruity coffee for Path]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'fruity',
  (SELECT id FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'fruity' AND sort_order = 4),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'fruity'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters')
);

-- ── TEMECULA COFFEE ROASTERS ─────────────────────────────────────────────────

-- Breakfast Blend (TCR) — balanced_sweet, sort_order=1 (Approachable → Smooth)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'balanced_sweet',
  (SELECT id FROM coffees WHERE name = 'Breakfast Blend' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 1),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'balanced_sweet'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Breakfast Blend' AND roaster = 'Temecula Coffee Roasters')
);

-- Blonde Blend (TCR) — balanced_sweet, sort_order=1 (Approachable → Smooth)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'balanced_sweet',
  (SELECT id FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 1),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'balanced_sweet'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters')
);

-- Guatemala (TCR) — balanced_sweet, sort_order=2 (Default → Balanced) [IS DEFAULT]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'balanced_sweet',
  (SELECT id FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 2),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'balanced_sweet'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters')
);

-- Colombia (TCR) — balanced_sweet, sort_order=3 (Bold → Bright)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'balanced_sweet',
  (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 3),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'balanced_sweet'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters')
);

-- Brazil Santos (TCR) — chocolate_nutty, sort_order=2 (Default → Classic) [IS DEFAULT]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'chocolate_nutty',
  (SELECT id FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'chocolate_nutty' AND sort_order = 2),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'chocolate_nutty'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters')
);

-- African Espresso Blend (TCR) — chocolate_nutty, sort_order=3 (Bold → Richer)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'chocolate_nutty',
  (SELECT id FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'chocolate_nutty' AND sort_order = 3),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'chocolate_nutty'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters')
);

-- 6-Bean Espresso Blend (TCR) — chocolate_nutty, sort_order=3 (Bold → Richer)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'chocolate_nutty',
  (SELECT id FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'chocolate_nutty' AND sort_order = 3),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'chocolate_nutty'
    AND coffee_id = (SELECT id FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters')
);

-- Sumatra (TCR) — earthy, sort_order=2 (Default → Earthy) [IS DEFAULT]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'earthy',
  (SELECT id FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 2),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'earthy'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters')
);

-- Bali Blue (TCR) — earthy, sort_order=3 (Bold → Bold)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'earthy',
  (SELECT id FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 3),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'earthy'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters')
);

-- Uganda (TCR) — earthy, sort_order=3 (Bold → Bold)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'earthy',
  (SELECT id FROM coffees WHERE name = 'Uganda' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 3),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'earthy'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Uganda' AND roaster = 'Temecula Coffee Roasters')
);

-- Papua New Guinea (TCR) — floral, sort_order=1 (Gentle → Delicate)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'floral',
  (SELECT id FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'floral' AND sort_order = 1),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'floral'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters')
);

-- Ethiopia Natural (TCR) — floral, sort_order=2 (Default → Balanced) [IS DEFAULT]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'floral',
  (SELECT id FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'floral' AND sort_order = 2),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'floral'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters')
);

-- Costa Rica (TCR) — fruity, sort_order=1 (Gentle → Mellow)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'fruity',
  (SELECT id FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'fruity' AND sort_order = 1),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'fruity'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters')
);

-- Tanzania (TCR) — fruity, sort_order=2 (Default → Balanced) [IS DEFAULT]
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'fruity',
  (SELECT id FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'fruity' AND sort_order = 2),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'fruity'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters')
);

-- Kenya (TCR) — fruity, sort_order=4 (Complex → Vibrant)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT
  'fruity',
  (SELECT id FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'fruity' AND sort_order = 4),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM dial_archetype_positions
  WHERE archetype = 'fruity'
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters')
);

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT archetype, COUNT(*) AS coffees,
--        SUM(CASE WHEN is_default THEN 1 ELSE 0 END) AS defaults
-- FROM dial_archetype_positions
-- GROUP BY archetype ORDER BY archetype;
--
-- Expected:
--   balanced_sweet:  7 coffees, 2 defaults (Feather In Cap + Guatemala)
--   chocolate_nutty: 4 coffees, 2 defaults (Noam Blend + Brazil Santos)
--   earthy:          5 coffees, 2 defaults (Nocturnal Dark Roast + Sumatra)
--   floral:          3 coffees, 2 defaults (Honduras + Ethiopia Natural)
--   fruity:          4 coffees, 2 defaults (Ethiopia + Tanzania)
