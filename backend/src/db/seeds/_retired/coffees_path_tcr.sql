-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: coffees — Path Coffee Roasters (new) + Temecula Coffee Roasters (all)
-- Source: backend/src/db/roasteries notes and conceptual mapping/roasteries notes and conceptual matrix.xlsx
--
-- Do NOT add to schema.sql — not idempotent.
-- Run once via Cloud SQL Studio after Task 1 is confirmed.
--
-- Skips already-seeded coffees from Session 001:
--   Crosshatch (Path), Ethiopia (Path), Feather In Cap (Path)
-- Skips header rows (PATH COFFEE ROASTERS, TEMECULA COFFEE ROASTERS).
--
-- blend_or_single → lowercase: 'blend' or 'single origin'
-- flavor_descriptors_roaster, ai_summary, surprise_note, three_voice_story → all NULL
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PATH COFFEE ROASTERS — 10 new coffees ────────────────────────────────────
INSERT INTO coffees (name, roaster, origin, blend_or_single, process, roast_level, roast_shade)
VALUES
  ('Colombia',              'Path Coffee Roasters', 'Colombia',                             'single origin', 'Washed',           'Medium',      'medium'),
  ('Noam Blend',            'Path Coffee Roasters', 'Central Blend',                        'blend',         'Washed',           'Medium-Dark', 'medium-dark'),
  ('Nocturnal Dark Roast',  'Path Coffee Roasters', 'Central/South America',                'single origin', 'Washed',           'Dark',        'dark'),
  ('Vantablack Ultra-Dark', 'Path Coffee Roasters', 'Central/South America',                'single origin', 'Washed',           'Dark',        'ultra-dark'),
  ('Honduras',              'Path Coffee Roasters', 'Honduras',                             'single origin', 'Washed',           'Medium-Dark', 'medium-dark'),
  ('Sleepwalker Half-Caf',  'Path Coffee Roasters', 'Decaf & Central/South America Blend',  'blend',         'Washed',           'Medium-Dark', 'medium-dark'),
  ('Decaf',                 'Path Coffee Roasters', 'Colombia',                             'single origin', 'Decaf',            'Medium-Dark', 'medium-dark'),
  ('Vanilla',               'Path Coffee Roasters', 'Multi-Origin Blend',                   'blend',         'Flavored (Ground)', 'Medium',     NULL),
  ('Hazelnut',              'Path Coffee Roasters', 'Multi-Origin Blend',                   'blend',         'Flavored (Ground)', 'Medium',     NULL),
  ('Chocolate',             'Path Coffee Roasters', 'Multi-Origin Blend',                   'blend',         'Flavored (Ground)', 'Medium',     NULL)
ON CONFLICT DO NOTHING;

-- ── TEMECULA COFFEE ROASTERS — 16 coffees ────────────────────────────────────
INSERT INTO coffees (name, roaster, origin, blend_or_single, process, roast_level, roast_shade)
VALUES
  ('Breakfast Blend',       'Temecula Coffee Roasters', 'Multi-Origin Blend',                         'blend',         NULL,                            'Medium',       'medium'),
  ('Blonde Blend',          'Temecula Coffee Roasters', 'Central America & Africa Blend',              'blend',         NULL,                            'Light',        'light'),
  ('Guatemala',             'Temecula Coffee Roasters', 'Huehuetenango, Guatemala',                    'single origin', 'Fully Washed',                  'Medium',       'medium'),
  ('Colombia',              'Temecula Coffee Roasters', 'Tolima, Colombia',                            'single origin', 'Washed and Sun Dried',          'Medium',       'medium'),
  ('Brazil Santos',         'Temecula Coffee Roasters', 'Sul de Minas, Brazil',                        'single origin', 'Natural',                       'Medium',       'medium'),
  ('African Espresso Blend','Temecula Coffee Roasters', 'Uganda & Ethiopia Blend',                     'blend',         NULL,                            'Medium-Dark',  'medium-dark'),
  ('6-Bean Espresso Blend', 'Temecula Coffee Roasters', 'Multi-Origin Blend',                         'blend',         NULL,                            'Dark',         'dark'),
  ('Sumatra',               'Temecula Coffee Roasters', 'Sumatra, Indonesia',                          'single origin', 'Wet-Hulled',                    'Medium-Dark',  'medium-dark'),
  ('Bali Blue',             'Temecula Coffee Roasters', 'Kintamani Highlands, Bali, Indonesia',        'single origin', 'Wet-Hulled, Two-Step Sun Dried','Medium-Dark',  'medium-dark'),
  ('Uganda',                'Temecula Coffee Roasters', 'Rwenzori Mountains, Uganda',                  'single origin', 'Washed',                        'Medium',       'medium'),
  ('Papua New Guinea',      'Temecula Coffee Roasters', 'Morobe and Madang, Papua New Guinea',         'single origin', 'Washed',                        'Medium',       'medium'),
  ('Ethiopia Natural',      'Temecula Coffee Roasters', 'Sidama, Ethiopia',                            'single origin', 'Natural, Sun Dried',            'Medium-Light', 'light-medium'),
  ('Costa Rica',            'Temecula Coffee Roasters', 'San Marcos de Tarrazú, Costa Rica',           'single origin', 'Fully Washed',                  'Medium-Light', 'light-medium'),
  ('Tanzania',              'Temecula Coffee Roasters', 'Mount Kilimanjaro, Tanzania',                 'single origin', 'Fully Washed',                  'Medium-Light', 'light-medium'),
  ('Kenya',                 'Temecula Coffee Roasters', 'Othaya, Nyeri County, Kenya',                 'single origin', 'Fully Washed, Raised Beds',     'Medium-Light', 'light-medium'),
  ('Kopi Safari',           'Temecula Coffee Roasters', 'Multi-Origin Blend',                         'blend',         'Post-Roast Blend',              'Medium-Dark',  'medium-dark')
ON CONFLICT DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT roaster, COUNT(*) FROM coffees GROUP BY roaster ORDER BY roaster;
-- Expected: Path Coffee Roasters = 13, Temecula Coffee Roasters = 16
