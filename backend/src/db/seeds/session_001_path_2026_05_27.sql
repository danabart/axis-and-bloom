-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Session 001 — Path Coffee Roasters (first cupping; Dana + Camila,
-- merged into one result set). Not part of schema.sql; run by hand.
--
-- Rewritten 2026-10-18 (cupping evidence brief 2, Part 0.1) for the current
-- schema: the original wrote the long-gone wide score columns, the
-- archetype_assignments table, brew_method_enum and coffees.roaster, and would
-- also have failed cupping_scores_row_shape. The values are the rows production
-- holds for session 1 (session_date 2026-05-22, as stored).
--
-- Idempotent: does nothing when a session with this record_source exists.
-- Needs the roaster 'Path Coffee Roasters' and its coffees Crosshatch,
-- Ethiopia and Feather In Cap to exist (they come from the catalog seed);
-- otherwise it raises a NOTICE and writes nothing. The merged rows are tagged
-- legacy (scale_code, merge_rule) exactly as brief 1's backfill tagged them.
-- An archetype assignment is added only for a coffee that has none.
-- ─────────────────────────────────────────────────────────────────────────────
DO $seed$
DECLARE
  v_roaster  UUID;
  v_session  INT;
  v_coffee   INT;
  v_sc       INT;
  v_score    INT;
  c          RECORD;
  v          RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM cupping_sessions WHERE record_source = 'seed:session_001_path_2026_05_27.sql') THEN
    RAISE NOTICE 'session_001 seed: already loaded';
    RETURN;
  END IF;
  SELECT id INTO v_roaster FROM roaster WHERE name = 'Path Coffee Roasters';
  IF v_roaster IS NULL OR (SELECT count(*) FROM coffees WHERE roaster_id = v_roaster
                            AND name IN ('Crosshatch', 'Ethiopia', 'Feather In Cap')) < 3 THEN
    RAISE NOTICE 'session_001 seed: Path Coffee Roasters or its three coffees missing; nothing written';
    RETURN;
  END IF;

  INSERT INTO cupping_sessions (session_date, session_date_precision, brew_method, location, session_notes, record_source, sheet_format)
  VALUES ('2026-05-22', 'exact', 'filter', 'Path Coffee Roasters',
          'First cupping session. Two tasters: Dana and Camila. First time cupping — scores treated as directional. Merged into one result set.',
          'seed:session_001_path_2026_05_27.sql', 'legacy_wide')
  RETURNING id INTO v_session;

  FOR c IN SELECT * FROM (VALUES
    (1, 'Crosshatch',
        'Sweetest of the three. Most universally accessible. Soft round acidity. No bitterness edge. Strong agreement between tasters on sweetness. Fragrance diverged between tasters — Camila read fruity/honey, Dana read dark choc/smoky. Camila''s read adopted as more consistent with the coffee''s profile.',
        'balanced_sweet', 'high',
        'Classic balanced profile. Both tasters independently ranked sweetest. Soft round acidity reads as coconut. No bitterness edge. Most universally accessible cup. Crosshatch is the clearest Balanced & Sweet match.'),
    (2, 'Ethiopia',
        'Most distinctive and delicate. Strongest taster agreement of the session — both independently said black tea and dried fruit. Zero bitterness scored by Dana. Light body. Pineapple acidity. Every signal points to fruity/floral archetype.',
        'floral', 'high',
        'Black tea, dried fruit, pineapple acidity, zero bitterness, delicate body. Both tasters in strong agreement — independently said black tea and dried fruit with no prompting. Every dimension points to fruity/floral. Most distinctive and readable character of the three.'),
    (3, 'Feather In Cap',
        'Most complex but most polarizing. Tobacco and burnt agreed by both tasters. Sweet on the nose but dark in the cup — gap between fragrance and flavor notable. Drying finish. Bitterness adjusted down from Dana raw score of 7–9 — tobacco/smoke character may have read as bitter. Needs Nocturnal in next session to confirm position on bold end of scale.',
        'chocolate_nutty', 'medium',
        'Tobacco, smoke, cocoa, drying finish. Sits at lighter end of chocolate archetype. Bitterness score adjusted down — tobacco character may have inflated initial read. Needs Nocturnal in next session to confirm position on bold end of scale. Could also sit at bold end of Balanced & Sweet pending further cupping.')
  ) AS t(display_order, name, overall_notes, archetype, confidence, assignment_notes)
  LOOP
    SELECT id INTO v_coffee FROM coffees WHERE roaster_id = v_roaster AND name = c.name ORDER BY id LIMIT 1;
    INSERT INTO cupping_session_coffees (session_id, coffee_id, display_order)
    VALUES (v_session, v_coffee, c.display_order) RETURNING id INTO v_sc;
    INSERT INTO cupping_scores (session_coffee_id, taster_name, is_merged, scale_code, merge_rule, overall_notes)
    VALUES (v_sc, 'session_1_merged', true, 'legacy', 'legacy', c.overall_notes) RETURNING id INTO v_score;

    FOR v IN SELECT * FROM (VALUES
      ('Crosshatch', 1, NULL::numeric, NULL::numeric, 'fruity, honey, sweet, cocoa'),
      ('Crosshatch', 2, NULL, NULL, 'cocoa, sweet'),
      ('Crosshatch', 3, NULL, NULL, 'dark chocolate, dried fruit, citrus, sweet'),
      ('Crosshatch', 4, 9, 10.5, 'honey, sweet'),
      ('Crosshatch', 5, 6, 8, 'apple, banana, coconut — soft and round'),
      ('Crosshatch', 6, 3, 5, 'present but not a feature'),
      ('Crosshatch', 7, NULL, NULL, NULL), ('Crosshatch', 8, NULL, NULL, NULL), ('Crosshatch', 9, NULL, NULL, NULL),
      ('Crosshatch', 10, NULL, NULL, NULL), ('Crosshatch', 11, NULL, NULL, NULL), ('Crosshatch', 12, NULL, NULL, NULL),
      ('Ethiopia', 1, NULL, NULL, 'berries, dried fruits, citrus, black tea'),
      ('Ethiopia', 2, NULL, NULL, 'fruit, floral, citrus, lemon, black tea'),
      ('Ethiopia', 3, NULL, NULL, 'black tea, dry, floral'),
      ('Ethiopia', 4, 6, 8, 'fruit-driven brightness, not sugar'),
      ('Ethiopia', 5, 8, 10, 'pineapple — brightest of the three'),
      ('Ethiopia', 6, 0, 2, 'trace only — Dana scored zero, lowest of the three'),
      ('Ethiopia', 7, 3, 5, 'delicate, tea-like'),
      ('Ethiopia', 8, 2, 4, NULL), ('Ethiopia', 9, 4, 6, NULL), ('Ethiopia', 10, 3, 5, NULL),
      ('Ethiopia', 11, NULL, NULL, NULL),
      ('Ethiopia', 12, NULL, NULL, 'tea-like, clean'),
      ('Feather In Cap', 1, NULL, NULL, 'cocoa, sweet, earthy, tobacco'),
      ('Feather In Cap', 2, NULL, NULL, 'earthy, smoky, spices, tobacco, burnt'),
      ('Feather In Cap', 3, NULL, NULL, 'tobacco, burnt'),
      ('Feather In Cap', 4, 7, 9, 'sweet on nose, tobacco took over in cup'),
      ('Feather In Cap', 5, 2, 4, 'low — not noted by either taster'),
      ('Feather In Cap', 6, 5, 7, 'tobacco and burnt — adjusted down from raw, smoke may have read as bitter'),
      ('Feather In Cap', 7, 8, 11, NULL),
      ('Feather In Cap', 8, 7, 9, 'drying'),
      ('Feather In Cap', 9, 8, 11, NULL),
      ('Feather In Cap', 10, 7, 10, NULL),
      ('Feather In Cap', 11, NULL, NULL, 'drying, lingers'),
      ('Feather In Cap', 12, NULL, NULL, 'drying')
    ) AS x(coffee, dimension_id, value_min, value_max, notes) WHERE x.coffee = c.name
    LOOP
      INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max, notes)
      VALUES (v_score, v.dimension_id, v.value_min, v.value_max, v.notes);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM coffee_archetype_assignment WHERE coffee_id = v_coffee) THEN
      INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence, source, assigned_from_session_id, notes)
      VALUES (v_coffee, c.archetype::archetype_enum, c.confidence::confidence_enum, 'cupping', v_session, c.assignment_notes);
    END IF;
  END LOOP;
  RAISE NOTICE 'session_001 seed: loaded session %', v_session;
END
$seed$;
