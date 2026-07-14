-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: archetype_assignments — Bloom Dial Base Data v2 (Part 1, Phase A.1)
-- Source: Bloom_Dial_Base_Data.xlsx, "Archetype Map" tab.
-- Do NOT add to schema.sql — not idempotent for repeated archetype history.
--
-- Verified against prod (2026-07-14) before writing this file:
--   - Feather In Cap: already balanced_sweet (non-superseded since 2026-07-05) —
--     the seed-vs-position conflict flagged in the workbook is already resolved.
--     Not touched here.
--   - Vanilla: already balanced_sweet (non-superseded, confidence='medium') —
--     same archetype as the proposal, so per the spec's "skip a coffee only if
--     it already has the exact same non-superseded archetype" rule, skipped.
--   - Kopi Safari: current non-superseded archetype is 'experimental' (id 48,
--     from a prior session that reverted an earlier 'fruity' try). 'experimental'
--     is a category, not a true archetype (dial_archetype_config.is_archetype =
--     false) — superseded here in favor of the proposed real archetype 'earthy'.
--     The Experimental *category* tag (coffee_category_assignment) is untouched
--     and already correct — this only changes the underlying flavor archetype.
--   - Sleepwalker Half-Caf / Decaf / Hazelnut / Chocolate: no archetype_assignments
--     row exists yet — fresh inserts.
--
-- confidence='low' per the workbook — pre-cupping proposals, not session-derived.
-- ─────────────────────────────────────────────────────────────────────────────

-- Kopi Safari (TCR): experimental → earthy (proposed underlying archetype;
-- Experimental category tag stays as-is via coffee_category_assignment)
UPDATE archetype_assignments SET superseded_at = now()
WHERE coffee_id = (SELECT MIN(id) FROM coffees WHERE name = 'Kopi Safari' AND roaster = 'Temecula Coffee Roasters')
  AND superseded_at IS NULL;

INSERT INTO archetype_assignments (coffee_id, archetype, confidence, notes)
SELECT c.min_id, 'earthy', 'low', 'Pre-cupping proposal — tune after cupping'
FROM (SELECT MIN(id) AS min_id FROM coffees WHERE name = 'Kopi Safari' AND roaster = 'Temecula Coffee Roasters') c
WHERE c.min_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa WHERE aa.coffee_id = c.min_id AND aa.superseded_at IS NULL
);

-- Sleepwalker Half-Caf (Path): chocolate_nutty proposal
INSERT INTO archetype_assignments (coffee_id, archetype, confidence, notes)
SELECT c.min_id, 'chocolate_nutty', 'low', 'Pre-cupping proposal — tune after cupping'
FROM (SELECT MIN(id) AS min_id FROM coffees WHERE name = 'Sleepwalker Half-Caf' AND roaster = 'Path Coffee Roasters') c
WHERE c.min_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa WHERE aa.coffee_id = c.min_id AND aa.superseded_at IS NULL
);

-- Decaf (Path): chocolate_nutty proposal
INSERT INTO archetype_assignments (coffee_id, archetype, confidence, notes)
SELECT c.min_id, 'chocolate_nutty', 'low', 'Pre-cupping proposal — tune after cupping'
FROM (SELECT MIN(id) AS min_id FROM coffees WHERE name = 'Decaf' AND roaster = 'Path Coffee Roasters') c
WHERE c.min_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa WHERE aa.coffee_id = c.min_id AND aa.superseded_at IS NULL
);

-- Hazelnut (Path): chocolate_nutty proposal
INSERT INTO archetype_assignments (coffee_id, archetype, confidence, notes)
SELECT c.min_id, 'chocolate_nutty', 'low', 'Pre-cupping proposal — tune after cupping'
FROM (SELECT MIN(id) AS min_id FROM coffees WHERE name = 'Hazelnut' AND roaster = 'Path Coffee Roasters') c
WHERE c.min_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa WHERE aa.coffee_id = c.min_id AND aa.superseded_at IS NULL
);

-- Chocolate (Path): chocolate_nutty proposal
INSERT INTO archetype_assignments (coffee_id, archetype, confidence, notes)
SELECT c.min_id, 'chocolate_nutty', 'low', 'Pre-cupping proposal — tune after cupping'
FROM (SELECT MIN(id) AS min_id FROM coffees WHERE name = 'Chocolate' AND roaster = 'Path Coffee Roasters') c
WHERE c.min_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM archetype_assignments aa WHERE aa.coffee_id = c.min_id AND aa.superseded_at IS NULL
);

-- Vanilla (Path): NOT re-seeded — already balanced_sweet, non-superseded (verified
-- against prod before writing this file). Left alone per "skip if already correct".

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT archetype, COUNT(*) FROM archetype_assignments
-- WHERE superseded_at IS NULL GROUP BY 1 ORDER BY 1;
-- Expect: chocolate_nutty grows by 4 (Sleepwalker, Decaf, Hazelnut, Chocolate),
-- earthy grows by 1 (Kopi Safari), Feather In Cap/Vanilla unchanged (already balanced_sweet).
