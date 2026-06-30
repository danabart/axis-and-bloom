-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: coffee_alias — Path Coffee Roasters + Temecula Coffee Roasters
-- Source: archetype_matrix sheet — platform slot names mapped to coffees
-- Seed only — do NOT add to schema.sql.
-- Depends on: coffees_path_tcr.sql (Task 1) must be run first.
-- Also depends on coffee_alias table existing in schema (Task 6A).
--
-- dial_sort_order: Left col = 1, Default col = 2, Right col = 3
-- priority: Path coffees = 1 (preferred), Temecula coffees = 2 (fallback)
--
-- Skipped: "Whiskey Barrel (Rotating)" — no matching row in coffees table.
-- NULL archetype rows (Half-Caf, Decaf) inserted without ON CONFLICT clause
--   because NULL != NULL in PG unique constraints.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── BALANCED & SWEET (balanced_sweet) ────────────────────────────────────────

-- Left (sort_order=1) → "Soft & Smooth" — Temecula only: Breakfast Blend, Blonde Blend
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Soft & Smooth', 'balanced_sweet', 1,
  (SELECT id FROM coffees WHERE name = 'Breakfast Blend' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Soft & Smooth', 'balanced_sweet', 1,
  (SELECT id FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- Default (sort_order=2) → "Classic Balanced" — Path: Feather In Cap, TCR: Guatemala
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Classic Balanced', 'balanced_sweet', 2,
  (SELECT id FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
  1, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Classic Balanced', 'balanced_sweet', 2,
  (SELECT id FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- Right (sort_order=3) → "Bright & Balanced" — Path: Crosshatch, TCR: Colombia
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Bright & Balanced', 'balanced_sweet', 3,
  (SELECT id FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
  1, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Bright & Balanced', 'balanced_sweet', 3,
  (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- ── CHOCOLATE & NUTTY (chocolate_nutty) ──────────────────────────────────────

-- Default (sort_order=2) → "Classic Chocolate" — Path: Noam Blend, TCR: Brazil Santos
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Classic Chocolate', 'chocolate_nutty', 2,
  (SELECT id FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
  1, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Classic Chocolate', 'chocolate_nutty', 2,
  (SELECT id FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- Right (sort_order=3) → "Deep Cocoa" — TCR: 6-Bean Espresso Blend, African Espresso Blend (shared slot)
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Deep Cocoa', 'chocolate_nutty', 3,
  (SELECT id FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Deep Cocoa', 'chocolate_nutty', 3,
  (SELECT id FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- ── SPICY & EARTHY (earthy) ───────────────────────────────────────────────────

-- Default (sort_order=2) → "Grounded & Earthy" — Path: Nocturnal Dark Roast, TCR: Sumatra
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Grounded & Earthy', 'earthy', 2,
  (SELECT id FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'),
  1, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Grounded & Earthy', 'earthy', 2,
  (SELECT id FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- Right (sort_order=3) → "Dark Grounded" — Path: Vantablack Ultra-Dark, TCR: Bali Blue + Uganda (shared slot)
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Dark Grounded', 'earthy', 3,
  (SELECT id FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters'),
  1, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Dark Grounded', 'earthy', 3,
  (SELECT id FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Dark Grounded', 'earthy', 3,
  (SELECT id FROM coffees WHERE name = 'Uganda' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- ── EXPERIMENTAL (experimental) ───────────────────────────────────────────────

-- Default (sort_order=2) → "The Unexpected" — TCR: Kopi Safari
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'The Unexpected', 'experimental', 2,
  (SELECT id FROM coffees WHERE name = 'Kopi Safari' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- Right (sort_order=3) → "The Wild Card" — WARNING: "Whiskey Barrel (Rotating)" not in coffees table.
-- Insert this row manually when the coffee is added to the catalogue.

-- ── FLORAL (floral) ───────────────────────────────────────────────────────────

-- Left/Gentle (sort_order=1) → "Light Floral Edge" — TCR: Papua New Guinea
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Light Floral Edge', 'floral', 1,
  (SELECT id FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- Default (sort_order=2) → "Perfumed & Expressive" — Path: Honduras, TCR: Ethiopia Natural
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Perfumed & Expressive', 'floral', 2,
  (SELECT id FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters'),
  1, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Perfumed & Expressive', 'floral', 2,
  (SELECT id FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- ── FRUITY (fruity) ───────────────────────────────────────────────────────────

-- Left/Gentle (sort_order=1) → "Clean Fruit" — TCR: Costa Rica
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Clean Fruit', 'fruity', 1,
  (SELECT id FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- Default (sort_order=2) → "Bright & Tart" — TCR: Tanzania
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Bright & Tart', 'fruity', 2,
  (SELECT id FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- Right/Complex (sort_order=3) → "Jammy & Aromatic" — Path: Ethiopia, TCR: Kenya
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Jammy & Aromatic', 'fruity', 3,
  (SELECT id FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
  1, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
VALUES (
  'Jammy & Aromatic', 'fruity', 3,
  (SELECT id FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters'),
  2, true
) ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING;

-- ── HALF-CAF (NULL archetype) — no unique constraint match, insert directly ───

-- Left (sort_order=1) → "Smooth Half-Caf" — Path: Sleepwalker Half-Caf
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
SELECT 'Smooth Half-Caf', NULL, 1,
  (SELECT id FROM coffees WHERE name = 'Sleepwalker Half-Caf' AND roaster = 'Path Coffee Roasters'),
  1, true
WHERE NOT EXISTS (
  SELECT 1 FROM coffee_alias
  WHERE platform_name = 'Smooth Half-Caf'
    AND archetype IS NULL
    AND dial_sort_order = 1
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Sleepwalker Half-Caf' AND roaster = 'Path Coffee Roasters')
);

-- ── DECAF (NULL archetype) — no unique constraint match, insert directly ──────

-- Default (sort_order=2) → "Classic Decaf" — Path: Decaf
INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)
SELECT 'Classic Decaf', NULL, 2,
  (SELECT id FROM coffees WHERE name = 'Decaf' AND roaster = 'Path Coffee Roasters'),
  1, true
WHERE NOT EXISTS (
  SELECT 1 FROM coffee_alias
  WHERE platform_name = 'Classic Decaf'
    AND archetype IS NULL
    AND dial_sort_order = 2
    AND coffee_id = (SELECT id FROM coffees WHERE name = 'Decaf' AND roaster = 'Path Coffee Roasters')
);

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT platform_name, archetype, dial_sort_order,
--        c.name AS coffee, c.roaster, ca.priority
-- FROM coffee_alias ca
-- JOIN coffees c ON c.id = ca.coffee_id
-- ORDER BY archetype NULLS LAST, dial_sort_order, priority;
