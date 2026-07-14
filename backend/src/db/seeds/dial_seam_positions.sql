-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: dial_archetype_positions (guest rows) — Bloom Dial Base Data Part 2,
-- Phase 5.
-- Source: Bloom_Dial_Base_Data.xlsx, "Seam Positions" tab.
-- Do NOT add to schema.sql — not idempotent for repeated position history.
-- Depends on: schema.sql's is_guest column + dap_guest_not_default CHECK
-- (Part 2, Phase 1) must be applied first, and dial_positions_base.sql
-- (Part 1) must have already run — these guest rows weld onto the home
-- positions that seed establishes.
--
-- Three seams close the remaining edge gaps in the spread-for-connectivity
-- placement (see Bloom_Dial_Base_Data_Reasoning.md, "Seam positions"):
-- ─────────────────────────────────────────────────────────────────────────────

-- 6-Bean Espresso Blend (TCR) — home chocolate_nutty Full(4), guest earthy Gentle(1)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default, is_guest)
SELECT 'earthy',
  (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 1),
  false, true
WHERE (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO NOTHING;

-- Colombia (TCR) — home balanced_sweet Lively(4), guest fruity Bright(3)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default, is_guest)
SELECT 'fruity',
  (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'fruity' AND sort_order = 3),
  false, true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO NOTHING;

-- Guatemala (TCR) — home balanced_sweet Balanced(2), guest chocolate_nutty Lighter(1)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default, is_guest)
SELECT 'chocolate_nutty',
  (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'chocolate_nutty' AND sort_order = 1),
  false, true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT c.name, c.roaster, dap.archetype, dap.is_guest, dap.is_default, dpv.label
-- FROM dial_archetype_positions dap
-- JOIN coffees c ON c.id = dap.coffee_id
-- JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
-- WHERE c.name IN ('6-Bean Espresso Blend','Colombia','Guatemala') AND c.roaster = 'Temecula Coffee Roasters'
-- ORDER BY c.name, dap.is_guest;
-- Expect: each of the 3 coffees shows exactly 2 rows (one is_guest=false home,
-- one is_guest=true guest), guest rows never is_default.
