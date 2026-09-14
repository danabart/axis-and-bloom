-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: roaster_blend — Path Coffee Roasters + Temecula Coffee Roasters
-- Source: coffees sheet — name, roaster, blend_or_single, archetype_estimate, sku_12oz, sku_5lb
-- Do NOT add to schema.sql — not idempotent.
-- Depends on: coffees_path_tcr.sql (Task 1) must be run first.
--
-- Two rows per coffee: one 12oz row and one 5lb row.
-- Skips Flavored coffees (Vanilla, Hazelnut, Chocolate) — ground-only, separate handling needed.
-- Includes Session 001 coffees (Crosshatch, Ethiopia, Feather In Cap) — not yet in roaster_blend.
--
-- inventory_status = 'pending' — neither roaster is live yet.
-- coffee_type: 'blend' or 'single_origin'
-- archetype_id: resolved via archetype.name ILIKE match; NULL for Half-Caf and Decaf.
-- Idempotency: WHERE NOT EXISTS on roaster_sku prevents duplicate rows on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PATH COFFEE ROASTERS ─────────────────────────────────────────────────────

-- Colombia (Path) — balanced_sweet, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Colombia', 'COL-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'COL-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Colombia', 'COL-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'COL-5');

-- Feather In Cap (Path) — balanced_sweet, blend
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Feather In Cap', 'FIC-12', 'blend', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'FIC-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Feather In Cap', 'FIC-5', 'blend', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'FIC-5');

-- Crosshatch (Path) — balanced_sweet, blend
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Crosshatch', 'CB-12', 'blend', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'CB-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Crosshatch', 'CB-5', 'blend', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'CB-5');

-- Noam Blend (Path) — chocolate_nutty, blend
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%chocolate%'),
  'Noam Blend', 'NB-12', 'blend', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'NB-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%chocolate%'),
  'Noam Blend', 'NB-5', 'blend', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'NB-5');

-- Nocturnal Dark Roast (Path) — earthy, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Nocturnal Dark Roast', 'DR-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'DR-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Nocturnal Dark Roast', 'DR-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'DR-5');

-- Vantablack Ultra-Dark (Path) — earthy, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Vantablack Ultra-Dark', 'VB-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'VB-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Vantablack Ultra-Dark', 'VB-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'VB-5');

-- Honduras (Path) — floral, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%floral%'),
  'Honduras', 'HON-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'HON-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%floral%'),
  'Honduras', 'HON-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'HON-5');

-- Ethiopia (Path) — fruity, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%fruit%'),
  'Ethiopia', 'ETH-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'ETH-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%fruit%'),
  'Ethiopia', 'ETH-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'ETH-5');

-- Sleepwalker Half-Caf (Path) — NULL archetype, blend
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  NULL,
  'Sleepwalker Half-Caf', 'SW-12', 'blend', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'SW-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  NULL,
  'Sleepwalker Half-Caf', 'SW-5', 'blend', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'SW-5');

-- Decaf (Path) — NULL archetype, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  NULL,
  'Decaf', 'DECAF-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'DECAF-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'),
  NULL,
  'Decaf', 'DECAF-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'DECAF-5');

-- ── TEMECULA COFFEE ROASTERS ─────────────────────────────────────────────────

-- Breakfast Blend (TCR) — balanced_sweet, blend
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Breakfast Blend', 'BBLEND-12', 'blend', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'BBLEND-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Breakfast Blend', 'BBLEND-5', 'blend', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'BBLEND-5');

-- Blonde Blend (TCR) — balanced_sweet, blend
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Blonde Blend', 'BLOND-12', 'blend', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'BLOND-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Blonde Blend', 'BLOND-5', 'blend', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'BLOND-5');

-- Guatemala (TCR) — balanced_sweet, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Guatemala', 'GUAT-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'GUAT-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Guatemala', 'GUAT-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'GUAT-5');

-- Colombia (TCR) — balanced_sweet, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Colombia', 'COLO-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'COLO-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%balanced%'),
  'Colombia', 'COLO-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'COLO-5');

-- Brazil Santos (TCR) — chocolate_nutty, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%chocolate%'),
  'Brazil Santos', 'BRAZ-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'BRAZ-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%chocolate%'),
  'Brazil Santos', 'BRAZ-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'BRAZ-5');

-- African Espresso Blend (TCR) — chocolate_nutty, blend
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%chocolate%'),
  'African Espresso Blend', 'AFRICA-12', 'blend', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'AFRICA-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%chocolate%'),
  'African Espresso Blend', 'AFRICA-5', 'blend', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'AFRICA-5');

-- 6-Bean Espresso Blend (TCR) — chocolate_nutty, blend
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%chocolate%'),
  '6-Bean Espresso Blend', '6BEAN-12', 'blend', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = '6BEAN-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%chocolate%'),
  '6-Bean Espresso Blend', '6BEAN-5', 'blend', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = '6BEAN-5');

-- Sumatra (TCR) — earthy, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Sumatra', 'SUM-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'SUM-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Sumatra', 'SUM-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'SUM-5');

-- Bali Blue (TCR) — earthy, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Bali Blue', 'BALI-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'BALI-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Bali Blue', 'BALI-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'BALI-5');

-- Uganda (TCR) — earthy, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Uganda', 'UGAN-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'UGAN-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%earth%'),
  'Uganda', 'UGAN-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'UGAN-5');

-- Papua New Guinea (TCR) — floral, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%floral%'),
  'Papua New Guinea', 'PNG-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'PNG-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%floral%'),
  'Papua New Guinea', 'PNG-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'PNG-5');

-- Ethiopia Natural (TCR) — floral, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%floral%'),
  'Ethiopia Natural', 'ETHN-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'ETHN-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%floral%'),
  'Ethiopia Natural', 'ETHN-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'ETHN-5');

-- Costa Rica (TCR) — fruity, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%fruit%'),
  'Costa Rica', 'COSTA-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'COSTA-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%fruit%'),
  'Costa Rica', 'COSTA-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'COSTA-5');

-- Tanzania (TCR) — fruity, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%fruit%'),
  'Tanzania', 'TANZ-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'TANZ-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%fruit%'),
  'Tanzania', 'TANZ-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'TANZ-5');

-- Kenya (TCR) — fruity, single_origin
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%fruit%'),
  'Kenya', 'KENYA-12', 'single_origin', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'KENYA-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%fruit%'),
  'Kenya', 'KENYA-5', 'single_origin', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'KENYA-5');

-- Kopi Safari (TCR) — experimental, blend
INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%experiment%'),
  'Kopi Safari', 'KOPI-12', 'blend', 12.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'KOPI-12');

INSERT INTO roaster_blend (roaster_id, archetype_id, blend_name, roaster_sku, coffee_type, weight_oz, is_active, inventory_status)
SELECT
  (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters'),
  (SELECT id FROM archetype WHERE name ILIKE '%experiment%'),
  'Kopi Safari', 'KOPI-5', 'blend', 80.0, true, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM roaster_blend WHERE roaster_sku = 'KOPI-5');

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT r.name AS roaster, COUNT(*) AS blend_rows
-- FROM roaster_blend rb
-- JOIN roaster r ON r.id = rb.roaster_id
-- GROUP BY r.name;
-- Expected: Path Coffee Roasters = 20 rows, Temecula Coffee Roasters = 32 rows
