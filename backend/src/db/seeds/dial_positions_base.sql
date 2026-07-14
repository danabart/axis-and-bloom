-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: dial_archetype_positions — Bloom Dial Base Data v2, "spread for
-- connectivity" (Part 1, Phase A.2)
-- Source: Bloom_Dial_Base_Data.xlsx, "Dial Positions" tab.
-- Do NOT add to schema.sql — not idempotent for repeated position history.
--
-- Unlike dial_positions_path_tcr.sql (which only ever inserted), these rows
-- already exist from that seed and must be UPDATED to their new spread-rule
-- slot — hence ON CONFLICT (archetype, coffee_id) DO UPDATE, not DO NOTHING.
--
-- Verified against prod (2026-07-14): all 5 moved coffees confirmed sitting at
-- their pre-move slot before this seed runs (6-Bean/Blonde/Colombia-TCR/
-- Vantablack/Uganda). Every other placed coffee already sits at its target
-- slot — those rows are included for completeness/idempotency, not because
-- they need to move; they're no-ops.
--
-- The 3 cupped Session-001 coffees (Crosshatch, Ethiopia, Feather In Cap) are
-- NOT touched — cupping data overrides the spread rule, per the workbook.
-- The 6 off-dial coffees (Kopi Safari, Sleepwalker, Decaf, Vanilla, Hazelnut,
-- Chocolate) get no position row — they stay unplaced until cupped.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── BALANCED_SWEET (dial axis: Acidity) ──────────────────────────────────────

-- Colombia (Path) — Smooth(1), unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'balanced_sweet',
  (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 1),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Breakfast Blend (TCR) — Smooth(1), unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'balanced_sweet',
  (SELECT MIN(id) FROM coffees WHERE name = 'Breakfast Blend' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 1),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Breakfast Blend' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Guatemala (TCR) — Balanced(2) [default], unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'balanced_sweet',
  (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 2),
  true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Blonde Blend (TCR) — SPREAD: Smooth(1) -> Bright(3)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'balanced_sweet',
  (SELECT MIN(id) FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 3),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Colombia (TCR) — SPREAD: Bright(3) -> Lively(4), reaches fruity seam
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'balanced_sweet',
  (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'balanced_sweet' AND sort_order = 4),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- ── FRUITY (dial axis: Acidity) ───────────────────────────────────────────────

-- Costa Rica (TCR) — Mellow(1), unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'fruity',
  (SELECT MIN(id) FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'fruity' AND sort_order = 1),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Tanzania (TCR) — Balanced(2) [default], unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'fruity',
  (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'fruity' AND sort_order = 2),
  true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Ethiopia (Path) — Vibrant(4) [default, only Path fruity coffee], unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'fruity',
  (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'fruity' AND sort_order = 4),
  true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Kenya (TCR) — Vibrant(4), unchanged (already spread; Bright(3) gap filled by a seam guest — Part 2)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'fruity',
  (SELECT MIN(id) FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'fruity' AND sort_order = 4),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- ── CHOCOLATE_NUTTY (dial axis: Body) ────────────────────────────────────────

-- Noam Blend (Path) — Classic(2) [default], unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'chocolate_nutty',
  (SELECT MIN(id) FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'chocolate_nutty' AND sort_order = 2),
  true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Brazil Santos (TCR) — Classic(2) [default], unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'chocolate_nutty',
  (SELECT MIN(id) FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'chocolate_nutty' AND sort_order = 2),
  true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- African Espresso Blend (TCR) — Richer(3), unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'chocolate_nutty',
  (SELECT MIN(id) FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'chocolate_nutty' AND sort_order = 3),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- 6-Bean Espresso Blend (TCR) — SPREAD: Richer(3) -> Full(4), darkest CN, reaches earthy seam
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'chocolate_nutty',
  (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'chocolate_nutty' AND sort_order = 4),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- ── EARTHY (dial axis: Bitterness) ───────────────────────────────────────────

-- Nocturnal Dark Roast (Path) — Earthy(2) [default], unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'earthy',
  (SELECT MIN(id) FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 2),
  true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Sumatra (TCR) — Earthy(2) [default], unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'earthy',
  (SELECT MIN(id) FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 2),
  true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Bali Blue (TCR) — Bold(3), unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'earthy',
  (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 3),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Vantablack Ultra-Dark (Path) — SPREAD: Bold(3) -> Intense(4)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'earthy',
  (SELECT MIN(id) FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 4),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Uganda (TCR) — SPREAD: Bold(3) -> Intense(4), gives TCR earthy a full 2-3-4 chain
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'earthy',
  (SELECT MIN(id) FROM coffees WHERE name = 'Uganda' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'earthy' AND sort_order = 4),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Uganda' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- ── FLORAL (dial axis: Savory/Depth) — inventory-thin, no spread moves ───────

-- Papua New Guinea (TCR) — Delicate(1), unchanged (this IS the fruity seam edge)
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'floral',
  (SELECT MIN(id) FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'floral' AND sort_order = 1),
  false
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Honduras (Path) — Balanced(2) [default], unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'floral',
  (SELECT MIN(id) FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'floral' AND sort_order = 2),
  true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Ethiopia Natural (TCR) — Balanced(2) [default], unchanged
INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
SELECT 'floral',
  (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
  (SELECT id FROM dial_position_vocabulary WHERE archetype = 'floral' AND sort_order = 2),
  true
WHERE (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters') IS NOT NULL
ON CONFLICT (archetype, coffee_id) DO UPDATE SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default;

-- Complex(3)/Layered(4) stay empty — no floral coffee reaches that edge yet.

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT * FROM v_dial_positions WHERE coffee IN
--   ('6-Bean Espresso Blend','Blonde Blend','Colombia','Vantablack Ultra-Dark','Uganda')
-- ORDER BY archetype, position_sort;
-- Expect: 6-Bean at Full(4); Blonde Blend at Bright(3); Colombia(TCR) at Lively(4);
-- Vantablack + Uganda at Intense(4).
