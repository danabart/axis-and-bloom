-- WCR Sensory Lexicon 2.0 (2017) — full attribute reference set
-- Source: World Coffee Research, https://worldcoffeeresearch.org/resources/sensory-lexicon
-- Attribute names/sections only (facts) — definitions are copyrighted (personal-use
-- license) and are NOT reproduced here. Fill sensory_lexicon_attribute.definition
-- manually from the PDF if desired.
--
-- 113 rows total: 109 unique attribute names, 4 (Sweet/Sour/Bitter/Salty) are
-- intentionally cross-listed once under "Taste Basics" and once under their own
-- section, per WCR's own structure — UNIQUE(name, section) allows both listings.
--
-- wheel_category/wheel_subcategory is a best-effort mapping onto the existing
-- SCA-wheel taxonomy already used by cupping_note (see
-- backend/src/db/seeds/cupping_notes_sca_wheel.sql for the canonical wheel
-- category/subcategory strings this mirrors). Left NULL where an attribute has
-- no SCA-wheel placement (the 4 basic tastes in isolation, and the Amplitude /
-- Mouthfeel sections, which are WCR/CVA-only and instead feed coffee_dimensions
-- — see Part 4 backfill below).
--
-- Run in Cloud SQL Studio. Fully idempotent — safe to re-run.

INSERT INTO sensory_lexicon_attribute (name, section, wheel_category, wheel_subcategory, source_id)
SELECT v.name, v.section, v.wheel_category, v.wheel_subcategory, s.id
FROM (VALUES
  -- ── Taste Basics ──────────────────────────────────────────────────────────
  ('Sweet',  'Taste Basics', NULL, NULL),
  ('Sour',   'Taste Basics', NULL, NULL),
  ('Bitter', 'Taste Basics', NULL, NULL),
  ('Salty',  'Taste Basics', NULL, NULL),

  -- ── Fruity ────────────────────────────────────────────────────────────────
  ('Fruity',       'Fruity', 'Fruity', NULL),
  ('Berry',        'Fruity', 'Fruity', 'Berry'),
  ('Strawberry',   'Fruity', 'Fruity', 'Berry'),
  ('Raspberry',    'Fruity', 'Fruity', 'Berry'),
  ('Blueberry',    'Fruity', 'Fruity', 'Berry'),
  ('Blackberry',   'Fruity', 'Fruity', 'Berry'),
  ('Dried Fruit',  'Fruity', 'Fruity', 'Dried Fruit'),
  ('Raisin',       'Fruity', 'Fruity', 'Dried Fruit'),
  ('Prune',        'Fruity', 'Fruity', 'Dried Fruit'),
  ('Other Fruit',  'Fruity', 'Fruity', 'Other Fruit'),
  ('Apple',        'Fruity', 'Fruity', 'Other Fruit'),
  ('Pear',         'Fruity', 'Fruity', 'Other Fruit'),
  ('Peach',        'Fruity', 'Fruity', 'Other Fruit'),
  ('Grape',        'Fruity', 'Fruity', 'Other Fruit'),
  ('Cherry',       'Fruity', 'Fruity', 'Other Fruit'),
  ('Pomegranate',  'Fruity', 'Fruity', 'Other Fruit'),
  ('Coconut',      'Fruity', 'Fruity', 'Other Fruit'),
  ('Pineapple',    'Fruity', 'Fruity', 'Other Fruit'),
  ('Citrus Fruit', 'Fruity', 'Fruity', 'Citrus Fruit'),
  ('Lemon',        'Fruity', 'Fruity', 'Citrus Fruit'),
  ('Grapefruit',   'Fruity', 'Fruity', 'Citrus Fruit'),
  ('Orange',       'Fruity', 'Fruity', 'Citrus Fruit'),
  ('Lime',         'Fruity', 'Fruity', 'Citrus Fruit'),

  -- ── Sour / Acid ───────────────────────────────────────────────────────────
  ('Sour',            'Sour / Acid', 'Sour / Fermented', 'Sour'),
  ('Sour Aromatics',  'Sour / Acid', 'Sour / Fermented', 'Sour'),
  ('Acetic Acid',     'Sour / Acid', 'Sour / Fermented', 'Sour'),
  ('Butyric Acid',    'Sour / Acid', 'Sour / Fermented', 'Sour'),
  ('Isovaleric Acid', 'Sour / Acid', 'Sour / Fermented', 'Sour'),
  ('Citric Acid',     'Sour / Acid', 'Sour / Fermented', 'Sour'),
  ('Malic Acid',      'Sour / Acid', 'Sour / Fermented', 'Sour'),

  -- ── Alcohol / Fermented ───────────────────────────────────────────────────
  ('Alcohol',                   'Alcohol / Fermented', 'Sour / Fermented', 'Alcohol / Fermented'),
  ('Whiskey',                   'Alcohol / Fermented', 'Sour / Fermented', 'Alcohol / Fermented'),
  ('Winey',                     'Alcohol / Fermented', 'Sour / Fermented', 'Alcohol / Fermented'),
  ('Fermented',                 'Alcohol / Fermented', 'Sour / Fermented', 'Alcohol / Fermented'),
  ('Overripe / Near-fermented', 'Alcohol / Fermented', 'Sour / Fermented', 'Alcohol / Fermented'),

  -- ── Green / Vegetative ────────────────────────────────────────────────────
  ('Olive Oil',   'Green / Vegetative', 'Green / Vegetative', NULL),
  ('Raw',         'Green / Vegetative', 'Green / Vegetative', 'Raw'),
  ('Under-ripe',  'Green / Vegetative', 'Green / Vegetative', 'Raw'),
  ('Peapod',      'Green / Vegetative', 'Green / Vegetative', 'Raw'),
  ('Green',       'Green / Vegetative', 'Green / Vegetative', 'Raw'),
  ('Fresh',       'Green / Vegetative', 'Green / Vegetative', 'Raw'),
  ('Dark Green',  'Green / Vegetative', 'Green / Vegetative', 'Raw'),
  ('Vegetative',  'Green / Vegetative', 'Green / Vegetative', 'Raw'),
  ('Hay-like',    'Green / Vegetative', 'Green / Vegetative', 'Raw'),
  ('Herb-like',   'Green / Vegetative', 'Green / Vegetative', 'Raw'),
  ('Beany',       'Green / Vegetative', 'Green / Vegetative', NULL),

  -- ── Stale / Papery ────────────────────────────────────────────────────────
  ('Stale',     'Stale / Papery', 'Other', 'Papery / Musty'),
  ('Papery',    'Stale / Papery', 'Other', 'Papery / Musty'),
  ('Cardboard', 'Stale / Papery', 'Other', 'Papery / Musty'),

  -- ── Earthy ────────────────────────────────────────────────────────────────
  ('Musty/Earthy',  'Earthy', 'Other', 'Papery / Musty'),
  ('Musty/Dusty',   'Earthy', 'Other', 'Papery / Musty'),
  ('Moldy/Damp',    'Earthy', 'Other', 'Papery / Musty'),
  ('Phenolic',      'Earthy', 'Other', 'Papery / Musty'),
  ('Animalic',      'Earthy', 'Other', 'Papery / Musty'),
  ('Meaty/Brothy',  'Earthy', 'Other', 'Papery / Musty'),
  ('Woody',         'Earthy', 'Other', 'Papery / Musty'),

  -- ── Chemical ──────────────────────────────────────────────────────────────
  ('Bitter',     'Chemical', 'Other', 'Chemical'),
  ('Salty',      'Chemical', 'Other', 'Chemical'),
  ('Medicinal',  'Chemical', 'Other', 'Chemical'),
  ('Rubber',     'Chemical', 'Other', 'Chemical'),
  ('Petroleum',  'Chemical', 'Other', 'Chemical'),
  ('Skunky',     'Chemical', 'Other', 'Chemical'),

  -- ── Roasted ───────────────────────────────────────────────────────────────
  ('Tobacco',      'Roasted', 'Roasted', NULL),
  ('Pipe Tobacco', 'Roasted', 'Roasted', NULL),
  ('Acrid',        'Roasted', 'Roasted', 'Burnt'),
  ('Ashy',         'Roasted', 'Roasted', 'Burnt'),
  ('Burnt',        'Roasted', 'Roasted', 'Burnt'),
  ('Smoky',        'Roasted', 'Roasted', 'Burnt'),
  ('Roasted',      'Roasted', 'Roasted', 'Burnt'),
  ('Brown-Roast',  'Roasted', 'Roasted', 'Burnt'),

  -- ── Cereal ────────────────────────────────────────────────────────────────
  ('Grain', 'Cereal', 'Roasted', 'Cereal'),
  ('Malt',  'Cereal', 'Roasted', 'Cereal'),

  -- ── Spices ────────────────────────────────────────────────────────────────
  ('Pungent',     'Spices', 'Spices', NULL),
  ('Pepper',      'Spices', 'Spices', NULL),
  ('Anise',       'Spices', 'Spices', 'Pungent'),
  ('Nutmeg',      'Spices', 'Spices', 'Brown Spice'),
  ('Brown Spice', 'Spices', 'Spices', 'Brown Spice'),
  ('Cinnamon',    'Spices', 'Spices', 'Brown Spice'),
  ('Clove',       'Spices', 'Spices', 'Brown Spice'),

  -- ── Nutty ─────────────────────────────────────────────────────────────────
  ('Nutty',     'Nutty', 'Nutty / Cocoa', 'Nutty'),
  ('Almond',    'Nutty', 'Nutty / Cocoa', 'Nutty'),
  ('Hazelnut',  'Nutty', 'Nutty / Cocoa', 'Nutty'),
  ('Peanuts',   'Nutty', 'Nutty / Cocoa', 'Nutty'),

  -- ── Cocoa ─────────────────────────────────────────────────────────────────
  ('Chocolate',      'Cocoa', 'Nutty / Cocoa', 'Cocoa'),
  ('Cocoa',          'Cocoa', 'Nutty / Cocoa', 'Cocoa'),
  ('Dark Chocolate', 'Cocoa', 'Nutty / Cocoa', 'Cocoa'),

  -- ── Sweet ─────────────────────────────────────────────────────────────────
  ('Sweet',           'Sweet', NULL,    NULL),
  ('Molasses',        'Sweet', 'Sweet', 'Brown Sugar'),
  ('Maple Syrup',     'Sweet', 'Sweet', 'Brown Sugar'),
  ('Brown Sugar',     'Sweet', 'Sweet', 'Brown Sugar'),
  ('Caramelized',     'Sweet', 'Sweet', 'Brown Sugar'),
  ('Honey',           'Sweet', 'Sweet', 'Brown Sugar'),
  ('Vanilla',         'Sweet', 'Sweet', NULL),
  ('Vanillin',        'Sweet', 'Sweet', NULL),
  ('Sweet Aromatics', 'Sweet', 'Sweet', NULL),
  ('Overall Sweet',   'Sweet', 'Sweet', NULL),

  -- ── Floral ────────────────────────────────────────────────────────────────
  ('Floral',    'Floral', 'Floral', NULL),
  ('Rose',      'Floral', 'Floral', 'Floral'),
  ('Jasmine',   'Floral', 'Floral', 'Floral'),
  ('Chamomile', 'Floral', 'Floral', 'Floral'),
  ('Black Tea', 'Floral', 'Floral', NULL),

  -- ── Amplitude (WCR/CVA-only — no SCA wheel placement; feeds coffee_dimensions) ──
  ('Overall Impact',  'Amplitude', NULL, NULL),
  ('Blended',         'Amplitude', NULL, NULL),
  ('Longevity',        'Amplitude', NULL, NULL),
  ('Body / Fullness',  'Amplitude', NULL, NULL),

  -- ── Mouthfeel (WCR/CVA-only — no SCA wheel placement; feeds coffee_dimensions) ──
  ('Mouth Drying', 'Mouthfeel', NULL, NULL),
  ('Thickness',    'Mouthfeel', NULL, NULL),
  ('Metallic',     'Mouthfeel', NULL, NULL),
  ('Oily',         'Mouthfeel', NULL, NULL)
) AS v(name, section, wheel_category, wheel_subcategory)
CROSS JOIN sensory_source s
WHERE s.code = 'wcr_lexicon'
ON CONFLICT (name, section) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Link to active descriptors: all 84 current cupping_note rows trace to a WCR
-- attribute. Explicit mapping (not a bare name join) because a few WCR names
-- are ambiguous across sections (e.g. Bitter/Salty appear in both Taste Basics
-- and Chemical; Sweet/Sour appear in both Taste Basics and their own section)
-- and a few need an alias (Overripe -> "Overripe / Near-fermented",
-- Brown -> "Brown-Roast", Roast -> "Roasted").
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE sensory_lexicon_attribute la
   SET cupping_note_id = cn.id
  FROM (VALUES
    -- Floral
    ('Black Tea', 'Floral', 'Black Tea'),
    ('Chamomile', 'Floral', 'Chamomile'),
    ('Rose',      'Floral', 'Rose'),
    ('Jasmine',   'Floral', 'Jasmine'),
    -- Fruity
    ('Blackberry',  'Fruity', 'Blackberry'),
    ('Raspberry',   'Fruity', 'Raspberry'),
    ('Blueberry',   'Fruity', 'Blueberry'),
    ('Strawberry',  'Fruity', 'Strawberry'),
    ('Raisin',      'Fruity', 'Raisin'),
    ('Prune',       'Fruity', 'Prune'),
    ('Coconut',     'Fruity', 'Coconut'),
    ('Cherry',      'Fruity', 'Cherry'),
    ('Pomegranate', 'Fruity', 'Pomegranate'),
    ('Pineapple',   'Fruity', 'Pineapple'),
    ('Grape',       'Fruity', 'Grape'),
    ('Apple',       'Fruity', 'Apple'),
    ('Peach',       'Fruity', 'Peach'),
    ('Pear',        'Fruity', 'Pear'),
    ('Grapefruit',  'Fruity', 'Grapefruit'),
    ('Orange',      'Fruity', 'Orange'),
    ('Lemon',       'Fruity', 'Lemon'),
    ('Lime',        'Fruity', 'Lime'),
    -- Sour / Fermented
    ('Sour Aromatics',  'Sour / Acid', 'Sour Aromatics'),
    ('Acetic Acid',     'Sour / Acid', 'Acetic Acid'),
    ('Butyric Acid',    'Sour / Acid', 'Butyric Acid'),
    ('Isovaleric Acid', 'Sour / Acid', 'Isovaleric Acid'),
    ('Citric Acid',     'Sour / Acid', 'Citric Acid'),
    ('Malic Acid',      'Sour / Acid', 'Malic Acid'),
    ('Winey',                     'Alcohol / Fermented', 'Winey'),
    ('Whiskey',                   'Alcohol / Fermented', 'Whiskey'),
    ('Fermented',                 'Alcohol / Fermented', 'Fermented'),
    ('Overripe / Near-fermented', 'Alcohol / Fermented', 'Overripe'),  -- alias
    -- Green / Vegetative
    ('Olive Oil',  'Green / Vegetative', 'Olive Oil'),
    ('Beany',      'Green / Vegetative', 'Beany'),
    ('Under-ripe', 'Green / Vegetative', 'Under-ripe'),
    ('Peapod',     'Green / Vegetative', 'Peapod'),
    ('Fresh',      'Green / Vegetative', 'Fresh'),
    ('Dark Green', 'Green / Vegetative', 'Dark Green'),
    ('Vegetative', 'Green / Vegetative', 'Vegetative'),
    ('Hay-like',   'Green / Vegetative', 'Hay-like'),
    ('Herb-like',  'Green / Vegetative', 'Herb-like'),
    -- Stale/Papery + Earthy + Chemical (cupping wheel_category 'Other')
    ('Stale',     'Stale / Papery', 'Stale'),
    ('Cardboard', 'Stale / Papery', 'Cardboard'),
    ('Papery',    'Stale / Papery', 'Papery'),
    ('Woody',        'Earthy', 'Woody'),
    ('Moldy/Damp',   'Earthy', 'Moldy / Damp'),
    ('Musty/Dusty',  'Earthy', 'Musty / Dusty'),
    ('Musty/Earthy', 'Earthy', 'Musty / Earthy'),
    ('Animalic',     'Earthy', 'Animalic'),
    ('Meaty/Brothy', 'Earthy', 'Meaty / Brothy'),
    ('Phenolic',     'Earthy', 'Phenolic'),
    ('Bitter',    'Chemical', 'Bitter'),
    ('Salty',     'Chemical', 'Salty'),
    ('Medicinal', 'Chemical', 'Medicinal'),
    ('Petroleum', 'Chemical', 'Petroleum'),
    ('Skunky',    'Chemical', 'Skunky'),
    ('Rubber',    'Chemical', 'Rubber'),
    -- Roasted + Cereal
    ('Pipe Tobacco', 'Roasted', 'Pipe Tobacco'),
    ('Tobacco',      'Roasted', 'Tobacco'),
    ('Acrid',        'Roasted', 'Acrid'),
    ('Ashy',         'Roasted', 'Ashy'),
    ('Smoky',        'Roasted', 'Smoky'),
    ('Brown-Roast',  'Roasted', 'Brown'),   -- alias
    ('Roasted',      'Roasted', 'Roast'),   -- alias
    ('Malt',  'Cereal', 'Malt'),
    ('Grain', 'Cereal', 'Grain'),
    -- Spices
    ('Pepper',   'Spices', 'Pepper'),
    ('Anise',    'Spices', 'Anise'),
    ('Nutmeg',   'Spices', 'Nutmeg'),
    ('Cinnamon', 'Spices', 'Cinnamon'),
    ('Clove',    'Spices', 'Clove'),
    -- Nutty / Cocoa
    ('Peanuts',        'Nutty', 'Peanuts'),
    ('Hazelnut',       'Nutty', 'Hazelnut'),
    ('Almond',         'Nutty', 'Almond'),
    ('Chocolate',      'Cocoa', 'Chocolate'),
    ('Dark Chocolate', 'Cocoa', 'Dark Chocolate'),
    -- Sweet
    ('Molasses',        'Sweet', 'Molasses'),
    ('Maple Syrup',     'Sweet', 'Maple Syrup'),
    ('Caramelized',     'Sweet', 'Caramelized'),
    ('Honey',           'Sweet', 'Honey'),
    ('Vanilla',         'Sweet', 'Vanilla'),
    ('Vanillin',        'Sweet', 'Vanillin'),
    ('Overall Sweet',   'Sweet', 'Overall Sweet'),
    ('Sweet Aromatics', 'Sweet', 'Sweet Aromatics')
  ) AS m(lexicon_name, lexicon_section, cupping_descriptor)
  JOIN cupping_note cn ON cn.descriptor = m.cupping_descriptor
 WHERE la.name = m.lexicon_name
   AND la.section = m.lexicon_section;

-- Backfill cupping_note.lexicon_section from the link above.
UPDATE cupping_note cn
   SET lexicon_section = la.section
  FROM sensory_lexicon_attribute la
 WHERE la.cupping_note_id = cn.id
   AND cn.lexicon_section IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Part 4: coffee_dimensions.sensory_lexicon_attribute_id — numeric (0-15) axes
-- that correspond directly to a WCR attribute. Dimensions 1/2/3/5/11 (Fragrance,
-- Aroma, Flavor, Acidity, Finish Character) are left unlinked — either an aroma-
-- phase construct with no single WCR attribute, or (Acidity) an aggregate of
-- the whole Sour/Acid section rather than one attribute.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE coffee_dimensions cd
   SET sensory_lexicon_attribute_id = la.id
  FROM (VALUES
    (4,  'Overall Sweet',   'Sweet'),      -- Sweetness
    (6,  'Bitter',          'Chemical'),   -- Bitterness / Boldness
    (7,  'Body / Fullness', 'Amplitude'),  -- Body / Intensity
    (8,  'Mouth Drying',    'Mouthfeel'),  -- Texture / Mouthfeel (aggregate anchor)
    (9,  'Overall Impact',  'Amplitude'),  -- Savory / Depth / Complexity
    (10, 'Longevity',       'Amplitude'),  -- Finish Length / Finish
    (12, 'Thickness',       'Mouthfeel')   -- Mouthfeel
  ) AS m(dim_id, lexicon_name, lexicon_section)
  JOIN sensory_lexicon_attribute la ON la.name = m.lexicon_name AND la.section = m.lexicon_section
 WHERE cd.id = m.dim_id
   AND cd.sensory_lexicon_attribute_id IS NULL;
