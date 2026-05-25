-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: SCA Coffee Taster's Flavor Wheel — cupping_note table
-- Source: Specialty Coffee Association / World Coffee Research Sensory Lexicon
-- Structure: wheel_category → wheel_subcategory → descriptor (3 levels)
-- Descriptors with no subcategory have wheel_subcategory = NULL.
-- intensity_score left NULL — assigned per cupping session, not at descriptor level.
-- Safe to re-run: skips entirely if any rows already exist.
-- ─────────────────────────────────────────────────────────────────────────────

DO $sca$
BEGIN
  IF EXISTS (SELECT 1 FROM cupping_note LIMIT 1) THEN
    RAISE NOTICE 'cupping_note already populated — skipping SCA wheel seed';
    RETURN;
  END IF;

  INSERT INTO cupping_note (wheel_category, wheel_subcategory, descriptor) VALUES

  -- ── FLORAL ────────────────────────────────────────────────────────────────
  ('Floral', NULL,     'Black Tea'),
  ('Floral', 'Floral', 'Chamomile'),
  ('Floral', 'Floral', 'Rose'),
  ('Floral', 'Floral', 'Jasmine'),

  -- ── FRUITY ────────────────────────────────────────────────────────────────
  ('Fruity', 'Berry',        'Blackberry'),
  ('Fruity', 'Berry',        'Raspberry'),
  ('Fruity', 'Berry',        'Blueberry'),
  ('Fruity', 'Berry',        'Strawberry'),
  ('Fruity', 'Dried Fruit',  'Raisin'),
  ('Fruity', 'Dried Fruit',  'Prune'),
  ('Fruity', 'Other Fruit',  'Coconut'),
  ('Fruity', 'Other Fruit',  'Cherry'),
  ('Fruity', 'Other Fruit',  'Pomegranate'),
  ('Fruity', 'Other Fruit',  'Pineapple'),
  ('Fruity', 'Other Fruit',  'Grape'),
  ('Fruity', 'Other Fruit',  'Apple'),
  ('Fruity', 'Other Fruit',  'Peach'),
  ('Fruity', 'Other Fruit',  'Pear'),
  ('Fruity', 'Citrus Fruit', 'Grapefruit'),
  ('Fruity', 'Citrus Fruit', 'Orange'),
  ('Fruity', 'Citrus Fruit', 'Lemon'),
  ('Fruity', 'Citrus Fruit', 'Lime'),

  -- ── SOUR / FERMENTED ──────────────────────────────────────────────────────
  ('Sour / Fermented', 'Sour',                'Sour Aromatics'),
  ('Sour / Fermented', 'Sour',                'Acetic Acid'),
  ('Sour / Fermented', 'Sour',                'Butyric Acid'),
  ('Sour / Fermented', 'Sour',                'Isovaleric Acid'),
  ('Sour / Fermented', 'Sour',                'Citric Acid'),
  ('Sour / Fermented', 'Sour',                'Malic Acid'),
  ('Sour / Fermented', 'Alcohol / Fermented', 'Winey'),
  ('Sour / Fermented', 'Alcohol / Fermented', 'Whiskey'),
  ('Sour / Fermented', 'Alcohol / Fermented', 'Fermented'),
  ('Sour / Fermented', 'Alcohol / Fermented', 'Overripe'),

  -- ── GREEN / VEGETATIVE ────────────────────────────────────────────────────
  ('Green / Vegetative', NULL,  'Olive Oil'),
  ('Green / Vegetative', NULL,  'Beany'),
  ('Green / Vegetative', 'Raw', 'Under-ripe'),
  ('Green / Vegetative', 'Raw', 'Peapod'),
  ('Green / Vegetative', 'Raw', 'Fresh'),
  ('Green / Vegetative', 'Raw', 'Dark Green'),
  ('Green / Vegetative', 'Raw', 'Vegetative'),
  ('Green / Vegetative', 'Raw', 'Hay-like'),
  ('Green / Vegetative', 'Raw', 'Herb-like'),

  -- ── OTHER ─────────────────────────────────────────────────────────────────
  ('Other', 'Papery / Musty', 'Stale'),
  ('Other', 'Papery / Musty', 'Cardboard'),
  ('Other', 'Papery / Musty', 'Papery'),
  ('Other', 'Papery / Musty', 'Woody'),
  ('Other', 'Papery / Musty', 'Moldy / Damp'),
  ('Other', 'Papery / Musty', 'Musty / Dusty'),
  ('Other', 'Papery / Musty', 'Musty / Earthy'),
  ('Other', 'Papery / Musty', 'Animalic'),
  ('Other', 'Papery / Musty', 'Meaty / Brothy'),
  ('Other', 'Papery / Musty', 'Phenolic'),
  ('Other', 'Chemical',       'Bitter'),
  ('Other', 'Chemical',       'Salty'),
  ('Other', 'Chemical',       'Medicinal'),
  ('Other', 'Chemical',       'Petroleum'),
  ('Other', 'Chemical',       'Skunky'),
  ('Other', 'Chemical',       'Rubber'),

  -- ── ROASTED ───────────────────────────────────────────────────────────────
  ('Roasted', NULL,     'Pipe Tobacco'),
  ('Roasted', NULL,     'Tobacco'),
  ('Roasted', 'Burnt',  'Acrid'),
  ('Roasted', 'Burnt',  'Ashy'),
  ('Roasted', 'Burnt',  'Smoky'),
  ('Roasted', 'Burnt',  'Brown'),
  ('Roasted', 'Burnt',  'Roast'),
  ('Roasted', 'Cereal', 'Malt'),
  ('Roasted', 'Cereal', 'Grain'),

  -- ── SPICES ────────────────────────────────────────────────────────────────
  ('Spices', NULL,          'Pepper'),
  ('Spices', 'Pungent',     'Anise'),
  ('Spices', 'Brown Spice', 'Nutmeg'),
  ('Spices', 'Brown Spice', 'Cinnamon'),
  ('Spices', 'Brown Spice', 'Clove'),

  -- ── NUTTY / COCOA ─────────────────────────────────────────────────────────
  ('Nutty / Cocoa', 'Nutty', 'Peanuts'),
  ('Nutty / Cocoa', 'Nutty', 'Hazelnut'),
  ('Nutty / Cocoa', 'Nutty', 'Almond'),
  ('Nutty / Cocoa', 'Cocoa', 'Chocolate'),
  ('Nutty / Cocoa', 'Cocoa', 'Dark Chocolate'),

  -- ── SWEET ─────────────────────────────────────────────────────────────────
  ('Sweet', 'Brown Sugar', 'Molasses'),
  ('Sweet', 'Brown Sugar', 'Maple Syrup'),
  ('Sweet', 'Brown Sugar', 'Caramelized'),
  ('Sweet', 'Brown Sugar', 'Honey'),
  ('Sweet', NULL,          'Vanilla'),
  ('Sweet', NULL,          'Vanillin'),
  ('Sweet', NULL,          'Overall Sweet'),
  ('Sweet', NULL,          'Sweet Aromatics');

  RAISE NOTICE 'SCA flavor wheel seeded into cupping_note — 84 rows';
END $sca$;

-- Verification
-- SELECT wheel_category, COUNT(*) FROM cupping_note GROUP BY wheel_category ORDER BY wheel_category;
