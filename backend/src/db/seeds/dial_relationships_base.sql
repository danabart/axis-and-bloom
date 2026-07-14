-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: dial_coffee_relationships — Bloom Dial Base Data v2 (Part 1, Phase C)
-- Source: Bloom_Dial_Base_Data.xlsx, "Dial Turns" + "Bridge Hops" tabs.
-- Do NOT add to schema.sql — not idempotent for repeated hop history (add-only).
--
-- Dimensions: Acidity=5, Bitterness=6, Body=7, Savory/Depth=9 (verified against
-- coffee_dimensions in prod). Each workbook "more"/"less" pair = two rows.
-- ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING
-- — safe to re-run.
--
-- Verified against prod (2026-07-14): only 4 hop rows exist today (the
-- Session-001 Crosshatch<->Ethiopia bridge, ids 1-2, and the now-stale
-- Crosshatch<->Feather In Cap body bridge, ids 3-4). Everything below is new
-- except the Crosshatch<->Ethiopia pair, which is included again for
-- completeness and will simply no-op on the unique key.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════ DIAL TURNS (within_archetype) ══════════════════

-- balanced_sweet — Acidity (dim 5)

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
       5, 'more', 1, 'within_archetype', true, 'medium', 'Smooth -> Balanced'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters'),
       5, 'less', 1, 'within_archetype', true, 'medium', 'Balanced -> Smooth'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
       5, 'more', 1, 'within_archetype', true, 'medium', 'Balanced -> Bright'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
       5, 'less', 1, 'within_archetype', true, 'medium', 'Bright -> Balanced'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Breakfast Blend' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
       5, 'more', 1, 'within_archetype', true, 'medium', 'Smooth -> Balanced'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Breakfast Blend' AND roaster = 'Temecula Coffee Roasters'),
       5, 'less', 1, 'within_archetype', true, 'medium', 'Balanced -> Smooth'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters'),
       5, 'more', 1, 'within_archetype', true, 'medium', 'Balanced -> Bright'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
       5, 'less', 1, 'within_archetype', true, 'medium', 'Bright -> Balanced'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
       5, 'more', 1, 'within_archetype', true, 'medium', 'Bright -> Lively'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Blonde Blend' AND roaster = 'Temecula Coffee Roasters'),
       5, 'less', 1, 'within_archetype', true, 'medium', 'Lively -> Bright'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- chocolate_nutty — Body (dim 7)

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       7, 'more', 1, 'within_archetype', true, 'medium', 'Classic -> Richer'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'),
       7, 'less', 1, 'within_archetype', true, 'medium', 'Richer -> Classic'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       7, 'more', 1, 'within_archetype', true, 'medium', 'Richer -> Full'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'African Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       7, 'less', 1, 'within_archetype', true, 'medium', 'Full -> Richer'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- earthy — Bitterness (dim 6)

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters'),
       6, 'more', 2, 'within_archetype', true, 'medium', 'Earthy -> Intense (multi-step: a gap sits between them)'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'),
       6, 'less', 2, 'within_archetype', true, 'medium', 'Intense -> Earthy'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
       6, 'more', 1, 'within_archetype', true, 'medium', 'Earthy -> Bold'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
       6, 'less', 1, 'within_archetype', true, 'medium', 'Bold -> Earthy'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Uganda' AND roaster = 'Temecula Coffee Roasters'),
       6, 'more', 1, 'within_archetype', true, 'medium', 'Bold -> Intense'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Uganda' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
       6, 'less', 1, 'within_archetype', true, 'medium', 'Intense -> Bold'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- floral — Savory/Depth (dim 9)

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
       9, 'more', 1, 'within_archetype', true, 'medium', 'Delicate -> Balanced'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
       9, 'less', 1, 'within_archetype', true, 'medium', 'Balanced -> Delicate'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- fruity — Acidity (dim 5)

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
       5, 'more', 1, 'within_archetype', true, 'medium', 'Mellow -> Balanced'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
       5, 'less', 1, 'within_archetype', true, 'medium', 'Balanced -> Mellow'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters'),
       5, 'more', 2, 'within_archetype', true, 'medium', 'Balanced -> Vibrant (multi-step: a gap sits between them)'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
       5, 'less', 2, 'within_archetype', true, 'medium', 'Vibrant -> Balanced'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- ══════════════════════════ BRIDGE HOPS (bridge_archetype) ═════════════════

-- Crosshatch <-> Ethiopia: EXISTING seed row (Session 001) — included for
-- completeness, will no-op on the unique key.
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
       5, 'more', 'bridge_archetype', true, 'high', 'Brighter acidity -> Fruity'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
       5, 'less', 'bridge_archetype', true, 'high', 'Softer acidity -> Balanced & Sweet'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- Colombia (TCR, balanced_sweet) <-> Tanzania (TCR, fruity)
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
       5, 'more', 'bridge_archetype', true, 'medium', 'Bright/Lively balanced -> fruity family'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
       5, 'less', 'bridge_archetype', true, 'medium', 'Reverse of above'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- Feather In Cap (Path, balanced_sweet) <-> Noam Blend (Path, chocolate_nutty)
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
       7, 'more', 'bridge_archetype', true, 'medium', 'More body -> Chocolate & Nutty (Path default-to-default)'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
       7, 'less', 'bridge_archetype', true, 'medium', 'Reverse of above'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- Guatemala (TCR, balanced_sweet) <-> Brazil Santos (TCR, chocolate_nutty)
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'),
       7, 'more', 'bridge_archetype', true, 'medium', 'More body -> Chocolate & Nutty (TCR default-to-default)'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
       7, 'less', 'bridge_archetype', true, 'medium', 'Reverse of above'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- 6-Bean Espresso Blend (TCR, chocolate_nutty) <-> Sumatra (TCR, earthy) — PRIMARY (Bitterness)
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
       6, 'more', 'bridge_archetype', true, 'medium', 'Intensity spine, PRIMARY edge: more bitterness -> Earthy'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       6, 'less', 'bridge_archetype', true, 'medium', 'Reverse of above'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- 6-Bean Espresso Blend (TCR) <-> Sumatra (TCR) — SECONDARY (Savory/Depth); legal
-- extra row since dimension_id is part of the unique key.
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
       9, 'more', 'bridge_archetype', false, 'low', 'Same seam, SECONDARY edge: more depth/complexity (deep, serious)'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = '6-Bean Espresso Blend' AND roaster = 'Temecula Coffee Roasters'),
       9, 'less', 'bridge_archetype', false, 'low', 'Reverse of above'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- Noam Blend (Path, chocolate_nutty) <-> Nocturnal Dark Roast (Path, earthy)
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'),
       6, 'more', 'bridge_archetype', true, 'medium', 'Path intensity-spine bridge into Earthy'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
       6, 'less', 'bridge_archetype', true, 'medium', 'Reverse of above'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- Costa Rica (TCR, fruity) <-> Ethiopia Natural (TCR, floral) — PRIMARY (Savory/Depth)
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
       9, 'more', 'bridge_archetype', true, 'medium', 'Delicacy branch, PRIMARY edge: more aromatic depth -> Floral'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
       9, 'less', 'bridge_archetype', true, 'medium', 'Reverse of above'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- Tanzania (TCR, fruity) <-> Papua New Guinea (TCR, floral) — SECONDARY (Body)
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
       7, 'less', 'bridge_archetype', false, 'low', 'Same seam, SECONDARY edge: LESS body (barely feels like coffee, like tea) -> Floral'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
       7, 'more', 'bridge_archetype', false, 'low', 'Reverse of above'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- SKIPPED — Ethiopia (Path) <-> Ethiopia Natural (TCR): the workbook assumes
-- Ethiopia (Path) is fruity (matching its dial_archetype_positions row: fruity
-- Vibrant(4), is_default=true), but its live archetype_assignments row (id 8,
-- confidence='high', likely real Session-001 cupping data) actually says
-- floral — the same archetype as Ethiopia Natural. That makes this a
-- same-archetype pair, not a bridge, and the hard-validation rule in
-- POST /dial/relationships would reject it (mirrors the Crosshatch<->Feather
-- retirement above). This is a pre-existing conflict this session found but
-- did not resolve — flagged to Dana; NOT guessed at here. Once resolved
-- (either Ethiopia's archetype_assignments is corrected to fruity, or its
-- dial position is moved off the fruity dial), re-derive this hop from the
-- corrected data.

-- Guatemala (TCR, balanced_sweet) <-> Honduras (Path, floral) — WEAK link
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters'),
       9, 'more', 'bridge_archetype', false, 'low', 'Weak link via the mild center'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;
INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
       9, 'less', 'bridge_archetype', false, 'low', 'Reverse of above'
ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING;

-- ══════════════════ CATEGORY HOP (special: coffee <-> Experimental category) ═══════
-- Bali Blue (TCR, earthy) <-> Experimental category. SQL-seed only — the Part 1
-- endpoint deliberately rejects hop_type='category_hop'. Excluded from
-- v_dial_navigation (inner-joins coffees on both sides) until category
-- traversal is built for Liam — expected, not a bug.
INSERT INTO dial_coffee_relationships (from_coffee_id, to_category_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
       (SELECT id FROM coffee_category WHERE code = 'experimental'),
       9, 'more', 'category_hop', true, 'low', 'Discovery CATEGORY_HOP: bold earthy -> the Experimental category (currently holds Kopi Safari, whose real archetype is earthy)'
WHERE NOT EXISTS (
  SELECT 1 FROM dial_coffee_relationships
  WHERE from_coffee_id = (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters')
    AND to_category_id = (SELECT id FROM coffee_category WHERE code = 'experimental')
    AND dimension_id = 9 AND direction = 'more'
);
INSERT INTO dial_coffee_relationships (from_category_id, to_coffee_id, dimension_id, direction, hop_type, is_recommended, confidence, notes)
SELECT (SELECT id FROM coffee_category WHERE code = 'experimental'),
       (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
       9, 'less', 'category_hop', true, 'low', 'Reverse of above'
WHERE NOT EXISTS (
  SELECT 1 FROM dial_coffee_relationships
  WHERE from_category_id = (SELECT id FROM coffee_category WHERE code = 'experimental')
    AND to_coffee_id = (SELECT MIN(id) FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters')
    AND dimension_id = 9 AND direction = 'less'
);

-- ══════════════════ RETIRE: stale Crosshatch <-> Feather In Cap body bridge ═══════
-- Session-001 assumed Feather In Cap = chocolate_nutty. Phase A (archetype
-- assignments) confirms/keeps it balanced_sweet, same archetype as Crosshatch —
-- so a bridge_archetype hop between them is now a logical contradiction (the
-- POST /dial/relationships hard-reject would refuse to recreate this row today).
-- The replacement within_archetype Dial Turn is already seeded above
-- (Feather In Cap <-> Crosshatch, balanced_sweet, Acidity).
DELETE FROM dial_coffee_relationships
WHERE hop_type = 'bridge_archetype'
  AND dimension_id = 7
  AND ((from_coffee_id = (SELECT MIN(id) FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters')
        AND to_coffee_id = (SELECT MIN(id) FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'))
    OR (from_coffee_id = (SELECT MIN(id) FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters')
        AND to_coffee_id = (SELECT MIN(id) FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters')));

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT hop_type, COUNT(*) FROM dial_coffee_relationships GROUP BY 1;
-- SELECT * FROM v_dial_navigation WHERE from_coffee = 'Crosshatch' AND to_coffee = 'Feather In Cap';
--   -> should return 0 rows (bridge retired)
-- SELECT * FROM dial_coffee_relationships WHERE hop_type = 'category_hop';
--   -> 2 rows, Bali Blue <-> Experimental category
