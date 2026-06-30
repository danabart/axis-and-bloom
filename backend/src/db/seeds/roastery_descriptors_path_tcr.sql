-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: roastery_coffee_descriptors — Path Coffee Roasters + Temecula Coffee Roasters
-- Source: roasteries notes and conceptual matrix.xlsx → roastery_coffee_descriptors sheet
--
-- Do NOT add to schema.sql — not idempotent.
-- Depends on: coffees_path_tcr.sql (Task 1) must be run first.
--
-- Mapping: roaster bag note language → closest SCA leaf descriptor.
-- The roaster's original language is stored in the notes column.
-- Rows for Crosshatch, Ethiopia (Path), Feather In Cap are included but will be
-- skipped by ON CONFLICT for any descriptors already seeded from Session 001.
--
-- Safe to re-run: ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PATH COFFEE ROASTERS ─────────────────────────────────────────────────────

-- Colombia (Path) — Apple, Sweet, Milk Chocolate
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Apple'),
    'Apple'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Overall Sweet'),
    'Sweet'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Chocolate'),
    'Milk Chocolate'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Ethiopia (Path) — Apricot→Peach, Cocoa→Chocolate, Floral→Jasmine
-- Note: Jasmine was seeded in Session 001; Peach and Chocolate are new.
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Peach'),
    'Apricot — mapped to Peach'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Chocolate'),
    'Cocoa'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Jasmine'),
    'Floral'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Honduras (Path) — Caramel→Caramelized, Citrus→Lemon, Floral→Jasmine
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Caramel'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Lemon'),
    'Citrus'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Honduras' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Jasmine'),
    'Floral'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Vantablack Ultra-Dark (Path) — Dark Chocolate, Smoke→Smoky
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Dark Chocolate'),
    'Dark Chocolate'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Vantablack Ultra-Dark' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Smoky'),
    'Balanced Smoke'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Nocturnal Dark Roast (Path) — Dark Chocolate, Smoke→Smoky
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Dark Chocolate'),
    'Dark Chocolate'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Nocturnal Dark Roast' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Smoky'),
    'Smoke'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Decaf (Path) — Dark Raisin→Raisin, Cocoa→Chocolate
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Decaf' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Raisin'),
    'Dark Raisin'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Decaf' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Chocolate'),
    'Cocoa'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Feather In Cap (Path) — Brown Sugar→Caramelized, Cocoa→Chocolate, Dried Fruit→Prune
-- All 3 already in DB from Session 001; ON CONFLICT will skip.
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Brown Sugar'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Chocolate'),
    'Cocoa'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Feather In Cap' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Prune'),
    'Dried Fruit'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Noam Blend (Path) — Milk Chocolate→Chocolate, Dried Fruit→Raisin, Light Smoke→Smoky
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Chocolate'),
    'Milk Chocolate'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Raisin'),
    'Dried Fruit'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Noam Blend' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Smoky'),
    'Light Smoke'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Crosshatch (Path) — Caramel→Caramelized, Dried Fruit→Raisin, Citrus→Lemon
-- All 3 already in DB from Session 001; ON CONFLICT will skip.
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Caramel'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Raisin'),
    'Dried Fruit'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Crosshatch' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Lemon'),
    'Citrus'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Sleepwalker Half-Caf (Path) — Caramel→Caramelized, Chocolate, Fruit→Apple
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Sleepwalker Half-Caf' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Caramel'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Sleepwalker Half-Caf' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Chocolate'),
    'Chocolate'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Sleepwalker Half-Caf' AND roaster = 'Path Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Apple'),
    'Fruit — mapped to Apple'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- ── TEMECULA COFFEE ROASTERS ─────────────────────────────────────────────────

-- Guatemala (TCR) — Lemon/Lime→Lemon, Nougat→Honey, Brown Sugar→Caramelized
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Lemon'),
    'Lemon/Lime'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Honey'),
    'Nougat — mapped to Honey'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Guatemala' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Brown Sugar'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Brazil Santos (TCR) — Mandarin Orange→Orange, Chocolate
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Orange'),
    'Mandarin Orange'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Brazil Santos' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Chocolate'),
    'Chocolate'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Bali Blue (TCR) — Bakers Chocolate→Dark Chocolate, Orange Peel→Orange, Juniper→Herb-like, Molasses
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Dark Chocolate'),
    'Bakers Chocolate'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Orange'),
    'Orange Peel'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Herb-like'),
    'Juniper — mapped to Herb-like'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Bali Blue' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Molasses'),
    'Molasses'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Colombia (TCR) — Dark Chocolate, Mango→Peach, Peach
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Dark Chocolate'),
    'Dark Chocolate'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Colombia' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Peach'),
    'Mango — mapped to Peach'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Papua New Guinea (TCR) — Citrus→Lemon, Jasmine, Caramel→Caramelized
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Lemon'),
    'Citrus'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Jasmine'),
    'Floral, Jasmine'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Papua New Guinea' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Caramel'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Sumatra (TCR) — Black Tea, Brown Spice→Cinnamon, Citrus→Lemon
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Black Tea'),
    'Black Tea'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Cinnamon'),
    'Brown Spice'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Sumatra' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Lemon'),
    'Citrus'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Uganda (TCR) — Brown Sugar→Caramelized
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Uganda' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Brown Sugar, Caramel'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Ethiopia Natural (TCR) — Caramel→Caramelized, Vanilla, Floral→Jasmine, Berry→Blueberry
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Caramelized'),
    'Caramel'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Vanilla'),
    'Vanilla'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Jasmine'),
    'Floral'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Ethiopia Natural' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Blueberry'),
    'Berry'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Tanzania (TCR) — Cranberry→Raspberry, Lemon/Lime→Lemon
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Raspberry'),
    'Cranberry — mapped to Raspberry'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Tanzania' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Lemon'),
    'Lemon/Lime'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Kenya (TCR) — Orange, Lemon, Floral→Jasmine
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Orange'),
    'Orange'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Lemon'),
    'Lemon'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Kenya' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Jasmine'),
    'Floral'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- Costa Rica (TCR) — Pineapple, Blackberry, Almond, Bright Sweet→Sweet Aromatics
INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id, notes)
VALUES
  (
    (SELECT id FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Pineapple'),
    'Pineapple Juice'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Blackberry'),
    'Blackberry'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Almond'),
    'Almond'
  ),
  (
    (SELECT id FROM coffees WHERE name = 'Costa Rica' AND roaster = 'Temecula Coffee Roasters'),
    (SELECT id FROM cupping_note WHERE descriptor = 'Sweet Aromatics'),
    'Bright Sweet'
  )
ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT c.roaster, COUNT(*)
-- FROM roastery_coffee_descriptors rcd
-- JOIN coffees c ON c.id = rcd.coffee_id
-- GROUP BY c.roaster;
