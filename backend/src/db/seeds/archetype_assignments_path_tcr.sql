-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: archetype_assignments — Path Coffee Roasters (new) + Temecula Coffee Roasters (all)
-- Source: coffees sheet — archetype_estimate column
-- Do NOT add to schema.sql — not idempotent.
-- Depends on: coffees_path_tcr.sql (Task 1) must be run first.
--
-- Skips already-seeded assignments from Session 001:
--   Crosshatch, Ethiopia, Feather In Cap (Path Coffee Roasters)
-- Skips coffees with no archetype_enum value:
--   Half-Caf (Sleepwalker), Decaf, Flavored (Vanilla, Hazelnut, Chocolate), Experimental does have an enum
--
-- archetype_estimate → archetype_enum:
--   Balanced & Sweet  → balanced_sweet
--   Chocolate & Nutty → chocolate_nutty
--   Spicy & Earthy    → earthy
--   Floral            → floral
--   Fruity            → fruity
--   Experimental      → experimental
--   Half-Caf / Decaf / Flavored → SKIP
--
-- confidence = 'medium' (pre-cupping estimates, not session-derived)
-- assigned_from_session_id = NULL
-- superseded_at = NULL (current)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PATH COFFEE ROASTERS — 5 new coffees ─────────────────────────────────────

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'balanced_sweet', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'chocolate_nutty', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'earthy', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'earthy', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'floral', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

-- ── TEMECULA COFFEE ROASTERS — 16 coffees ────────────────────────────────────

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'balanced_sweet', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Breakfast Blend' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'balanced_sweet', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'balanced_sweet', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'balanced_sweet', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'chocolate_nutty', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'chocolate_nutty', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'chocolate_nutty', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'earthy', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'earthy', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'earthy', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Uganda' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'floral', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'floral', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'fruity', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'fruity', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'fruity', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, assigned_from_session_id, superseded_at, notes)
SELECT id, 'experimental', 'medium', NULL, NULL, 'Pre-cupping estimate based on roaster bag notes'
FROM coffees WHERE name = 'Kopi Safari' AND roaster = 'Temecula Coffee Roasters'
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa
  WHERE aa.coffee_id = coffees.id AND aa.superseded_at IS NULL
);

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT archetype, COUNT(*)
-- FROM archetype_assignments
-- WHERE superseded_at IS NULL
-- GROUP BY archetype ORDER BY archetype;
