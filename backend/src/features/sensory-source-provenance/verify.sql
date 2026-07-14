-- Sensory Source Provenance — verification queries
-- Run after applying schema.sql + seeds/sensory_lexicon_attributes_wcr.sql.
-- Note: corrected against the live schema vs. the original CLAUDE_CODE_PROMPT.md draft —
-- cupping_note.id is UUID (not INT), and cupping_note's wheel columns are
-- wheel_category/wheel_subcategory (not category/subcategory).

-- 1. Sources present (expect 4 rows, these codes)
SELECT code FROM sensory_source ORDER BY code;
--   expect: platform, sca_cva, sca_flavor_wheel, wcr_lexicon

-- 2. Lexicon seeded (expect 113 rows -- 109 unique names, 4 cross-listed
--    under both "Taste Basics" and their own section by design -- all WCR-sourced)
SELECT count(*) AS attrs,
       count(*) FILTER (WHERE source_id = (SELECT id FROM sensory_source WHERE code='wcr_lexicon')) AS wcr
FROM sensory_lexicon_attribute;                       -- attrs = 113, wcr = attrs

-- 3. Every cupping_note has a source and a lexicon link (expect 0 unmatched)
SELECT count(*) AS total,
       count(*) FILTER (WHERE descriptor_source_id IS NULL) AS missing_source,
       count(*) FILTER (WHERE id NOT IN (SELECT cupping_note_id FROM sensory_lexicon_attribute WHERE cupping_note_id IS NOT NULL)) AS unlinked
FROM cupping_note;                                     -- total=84, missing_source=0, unlinked=0

-- 3b. List any unlinked descriptors by name (should return no rows)
SELECT cn.descriptor
FROM cupping_note cn
LEFT JOIN sensory_lexicon_attribute la ON la.cupping_note_id = cn.id
WHERE la.id IS NULL;

-- 4. Every dimension has a source (expect 12 rows, 0 missing)
SELECT count(*) AS dims, count(*) FILTER (WHERE source_id IS NULL) AS missing_source
FROM coffee_dimensions;                                -- dims=12, missing_source=0

-- 4b. Numeric (0-15) axes link to a lexicon attribute where the mapping specifies one
SELECT cd.name, ss.code AS source, la.name AS lexicon_attr
FROM coffee_dimensions cd
LEFT JOIN sensory_source ss ON ss.id = cd.source_id
LEFT JOIN sensory_lexicon_attribute la ON la.id = cd.sensory_lexicon_attribute_id
WHERE cd.is_numeric
ORDER BY cd.display_order;
--   expect Sweetness->Overall Sweet, Acidity->(NULL, aggregate), Bitterness->Bitter,
--          Body->Body / Fullness, Texture->Mouth Drying, Savory / Depth->Overall Impact,
--          Finish Length->Longevity

-- **Idempotency test:** run schema.sql and the seed a second time; re-run queries 2-4 --
-- counts must be identical (no duplicate rows, no re-nulled columns).

-- **Non-destructive test** (prove no existing data changed): capture a checksum of the
-- active descriptor content *before* and *after* the migration -- must be identical:
SELECT md5(string_agg(descriptor || '|' || COALESCE(wheel_category,'') || '|' || COALESCE(wheel_subcategory,''), ',' ORDER BY id))
FROM cupping_note;

-- Also confirm coffee_dimensions scored values are untouched:
SELECT md5(string_agg(name||'|'||COALESCE(scale_min::text,'')||'|'||COALESCE(scale_max::text,''), ',' ORDER BY id))
FROM coffee_dimensions;
