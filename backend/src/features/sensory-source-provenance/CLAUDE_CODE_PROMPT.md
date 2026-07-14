# Feature: Sensory Source Provenance (WCR Lexicon / SCA / platform)

**Goal:** Record *where each sensory term comes from* across the flavor-descriptor and cupping-dimension models, and store the full WCR Sensory Lexicon (110 attributes) as a reference table linked to our active descriptors.

**Why:** Our `cupping_note` vocabulary is the SCA Coffee Taster's Flavor Wheel, which is itself a *derived visualization* of the **WCR Sensory Lexicon 2.0 (2017)** — the wheel supplies the grouping, WCR supplies the words. Separately, our `coffee_dimensions` (the Bloom Dial axes) are 0–15 *intensity* scales — the same measurement model the WCR Lexicon uses per attribute and that the new SCA **CVA descriptive** cupping form (also 0–15) uses per dimension. We want that provenance explicit in the DB so the Flavor Intelligence page and Bloom Dial can cite/trust their sources.

> Reference index of all 110 attributes and sections: see the WCR Sensory Lexicon (official free PDF): https://worldcoffeeresearch.org/download/bf904452-fc8c-488f-b591-c0b20d9bcab2
> Do **not** paste the lexicon's definition text into the repo (copyright — free for personal use only). Store attribute *names/sections* (facts); leave `definition` NULL for the user to fill from the PDF if desired.

---

## Design decisions (confirmed with product owner)

0. **Table naming** follows the repo's first-name grouping convention (like the `cupping_*` flavor-wheel family and `dial_*`). New tables share the `sensory_*` prefix: `sensory_source`, `sensory_lexicon_attribute`. Do **not** name them `lexicon_attribute` / `flavor_source` etc. — the shared first token is what groups them.
1. **Shared source registry** (`sensory_source`), not per-table strings — because provenance now spans two tables (`cupping_note` and `coffee_dimensions`).
2. **Full lexicon lives in its own reference table** (`sensory_lexicon_attribute`), *not* by expanding `cupping_note`. This keeps the active flavor-wheel vocabulary (84 rows) clean and non-breaking, while still storing all 110 attributes with provenance and linking them to our active descriptors.
3. **Both taxonomies preserved**: keep the existing SCA-wheel `category`/`subcategory` on `cupping_note`; store the lexicon's own `section` on `sensory_lexicon_attribute`.
4. **Non-destructive:** no existing descriptor is overridden. This feature only *adds* nullable columns + new tables and backfills provenance metadata. Existing `cupping_note` rows (descriptor text, `category`, `subcategory`) and `coffee_dimensions` rows are never edited, renamed, or deleted. The full 110-attribute lexicon lands in a separate `sensory_lexicon_attribute` table, so the active 84-term flavor wheel is untouched.
5. Idempotent DDL goes in `schema.sql` (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `ON CONFLICT`). Non-idempotent bulk data goes in a new seed file. Follow existing repo conventions.

---

## Part 1 — `sensory_source` lookup table (schema.sql)

```sql
CREATE TABLE IF NOT EXISTS sensory_source (
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  publisher  TEXT,
  edition    TEXT,
  year       INT,
  url        TEXT,
  notes      TEXT
);

INSERT INTO sensory_source (code, name, publisher, edition, year, url, notes) VALUES
  ('wcr_lexicon',      'WCR Sensory Lexicon',                      'World Coffee Research',        '2.0', 2017,
     'https://worldcoffeeresearch.org/resources/sensory-lexicon',
     'Descriptive lexicon; 110 attributes each with a 0–15 intensity reference. Source of the flavor vocabulary.'),
  ('sca_flavor_wheel', 'SCA Coffee Taster''s Flavor Wheel',        'Specialty Coffee Association', '2016', 2016,
     'https://sca.coffee/research/coffee-tasters-flavor-wheel',
     'Visual regrouping of the WCR Lexicon into 9 categories. Source of our category/subcategory taxonomy, not the words.'),
  ('sca_cva',          'SCA Cupping Form — CVA Descriptive Assessment', 'Specialty Coffee Association', '2023', 2023,
     'https://sca.coffee/valueassessment',
     '0–15 intensity descriptive scoring per dimension. Basis for our 0–15 coffee_dimensions.'),
  ('platform',         'Axis & Bloom (internal)',                  'Axis & Bloom',                 NULL, NULL, NULL,
     'Platform-specific axes / consumer-facing aliases (e.g. Brightness, Boldness, Intensity, Complexity, Finish).')
ON CONFLICT (code) DO NOTHING;
```

---

## Part 2 — `sensory_lexicon_attribute` reference table (full WCR set) + seed

### 2a. Table (schema.sql)

```sql
CREATE TABLE IF NOT EXISTS sensory_lexicon_attribute (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  section           TEXT NOT NULL,          -- lexicon's own 17 sections
  wheel_category    TEXT,                   -- best-effort SCA-wheel category
  wheel_subcategory TEXT,
  source_id         INT REFERENCES sensory_source(id),  -- default: wcr_lexicon
  edition           TEXT DEFAULT '2.0 (2017)',
  definition        TEXT,                   -- NULL; user fills from PDF (copyright)
  cupping_note_id   INT REFERENCES cupping_note(id),    -- link to our active descriptor if one exists
  UNIQUE (name, section)
);
```

### 2b. Seed all 110 attribute names (new seed file `seeds/sensory_lexicon_attributes_wcr.sql`)

Insert every attribute below, `source_id` = the `wcr_lexicon` row, grouped by `section`. `wheel_category`/`wheel_subcategory` per the mapping notes. Use `ON CONFLICT (name, section) DO NOTHING`.

**Sections → attributes** (WCR Lexicon 2.0 TOC — 17 sections):

- **Taste Basics:** Sweet, Sour, Bitter, Salty
- **Fruity:** Fruity, Berry, Strawberry, Raspberry, Blueberry, Blackberry, Dried Fruit, Raisin, Prune, Other Fruit, Apple, Pear, Peach, Grape, Cherry, Pomegranate, Coconut, Pineapple, Citrus Fruit, Lemon, Grapefruit, Orange, Lime
- **Sour / Acid:** Sour, Sour Aromatics, Acetic Acid, Butyric Acid, Isovaleric Acid, Citric Acid, Malic Acid
- **Alcohol / Fermented:** Alcohol, Whiskey, Winey, Fermented, Overripe / Near-fermented
- **Green / Vegetative:** Olive Oil, Raw, Under-ripe, Peapod, Green, Fresh, Dark Green, Vegetative, Hay-like, Herb-like, Beany
- **Stale / Papery:** Stale, Papery, Cardboard
- **Earthy:** Musty/Earthy, Musty/Dusty, Moldy/Damp, Phenolic, Animalic, Meaty/Brothy, Woody
- **Chemical:** Bitter, Salty, Medicinal, Rubber, Petroleum, Skunky
- **Roasted:** Tobacco, Pipe Tobacco, Acrid, Ashy, Burnt, Smoky, Roasted, Brown-Roast
- **Cereal:** Grain, Malt
- **Spices:** Pungent, Pepper, Anise, Nutmeg, Brown Spice, Cinnamon, Clove
- **Nutty:** Nutty, Almond, Hazelnut, Peanuts
- **Cocoa:** Chocolate, Cocoa, Dark Chocolate
- **Sweet:** Sweet, Molasses, Maple Syrup, Brown Sugar, Caramelized, Honey, Vanilla, Vanillin, Sweet Aromatics, Overall Sweet
- **Floral:** Floral, Rose, Jasmine, Chamomile, Black Tea
- **Amplitude:** Overall Impact, Blended, Longevity, Body / Fullness
- **Mouthfeel:** Mouth Drying, Thickness, Metallic, Oily

> Note: the 4 basic tastes (Sweet, Sour, Bitter, Salty) are cross-listed in both *Taste Basics* and their aroma section — insert once per `(name, section)`; the UNIQUE constraint allows both listings intentionally. WCR's headline count is **110**.

### 2c. Link to active descriptors

After seeding, backfill `sensory_lexicon_attribute.cupping_note_id` by name match to `cupping_note.descriptor` (case-insensitive; our `Overripe`↔lexicon `Overripe / Near-fermented`, `Brown`/`Roast`↔`Brown-Roast`/`Roasted` — handle these aliases explicitly). All 84 current descriptors trace to a WCR attribute, so every `cupping_note` row should end up linked.

---

## Part 3 — Provenance on `cupping_note` (schema.sql)

```sql
ALTER TABLE cupping_note ADD COLUMN IF NOT EXISTS descriptor_source_id INT REFERENCES sensory_source(id);
ALTER TABLE cupping_note ADD COLUMN IF NOT EXISTS lexicon_section TEXT;

-- Every descriptor is a WCR Lexicon term; the wheel only supplies category/subcategory.
UPDATE cupping_note
   SET descriptor_source_id = (SELECT id FROM sensory_source WHERE code = 'wcr_lexicon')
 WHERE descriptor_source_id IS NULL;
```
Also backfill `lexicon_section` from the linked `sensory_lexicon_attribute.section` (via the 2c match). Add a table/column comment noting that `category`/`subcategory` originate from `sca_flavor_wheel`.

---

## Part 4 — Provenance on `coffee_dimensions` (schema.sql)

```sql
ALTER TABLE coffee_dimensions ADD COLUMN IF NOT EXISTS source_id INT REFERENCES sensory_source(id);
ALTER TABLE coffee_dimensions ADD COLUMN IF NOT EXISTS sensory_lexicon_attribute_id INT REFERENCES sensory_lexicon_attribute(id);
```

Backfill per this mapping (0–15 numeric dimensions are the Bloom Dial axes; `platform_name` is our consumer alias):

| id | name | platform alias | source `code` | sensory_lexicon_attribute link |
|----|------|----------------|---------------|------------------------|
| 4  | Sweetness       | —          | sca_cva      | Overall Sweet |
| 5  | Acidity         | Brightness | sca_cva      | (section Sour/Acid; leave attr NULL) |
| 6  | Bitterness      | Boldness   | wcr_lexicon  | Bitter |
| 7  | Body            | Intensity  | wcr_lexicon  | Body / Fullness |
| 8  | Texture         | Mouthfeel  | wcr_lexicon  | Mouth Drying |
| 9  | Savory / Depth  | Complexity | platform     | Overall Impact (closest; note it's platform-defined) |
| 10 | Finish Length   | Finish     | wcr_lexicon  | Longevity |
| 1  | Fragrance       | —          | sca_cva      | NULL (aroma phase) |
| 2  | Aroma           | —          | sca_cva      | NULL |
| 3  | Flavor          | —          | sca_cva      | NULL |
| 11 | Finish Character| —          | sca_cva      | NULL (aftertaste) |
| 12 | Mouthfeel       | —          | wcr_lexicon  | Thickness |

Use `UPDATE ... WHERE id = N` with subqueries resolving `source_id`/`sensory_lexicon_attribute_id` by code/name. Idempotent (safe to re-run).

---

## Part 5 — API / views (optional, wire if low-risk)

- Extend `v_collaborative_flavor_wheel` (or the Flavor Intelligence descriptor query) to expose `descriptor_source` (join `cupping_note.descriptor_source_id → sensory_source.name`), so the page can show a "Source: WCR Sensory Lexicon" citation.
- No consumer UI copy changes required in this pass — data layer only. Surface in Admin → (wherever descriptors/dimensions are inspected) if trivial.

---

## Acceptance criteria

1. `sensory_source` has the 4 rows; `sensory_lexicon_attribute` has the full WCR set (~110 rows, all sourced `wcr_lexicon`).
2. Every `cupping_note` row has `descriptor_source_id = wcr_lexicon`, `lexicon_section` populated, and a non-NULL `sensory_lexicon_attribute_id` match (report any unmatched).
3. Every `coffee_dimensions` row has `source_id` set per the table above; numeric axes link to their lexicon attribute where one applies.
4. All DDL idempotent; re-running `schema.sql` + seed is a no-op. No changes to the active flavor-wheel vocabulary (still 84 descriptors surfaced to the wheel UI).
5. Update `WHAT_WE_BUILT_DB.md` with the new tables/columns and this provenance model.

## Confirmations (resolved — proceed without pausing)
- ✅ Adding `sensory_lexicon_attribute` as a **new reference table** (not expanding `cupping_note`) is approved.
- ✅ No `SELECT *` concern on `cupping_note` / `coffee_dimensions` — new columns are nullable and appended; no `INSERT ... SELECT *` row-copies exist for these tables. Proceed.
- Conventions to match: idempotent-seed style of `backend/src/db/seeds/archetype_vectors.sql` ("Run in Cloud SQL Studio", `ON CONFLICT`); table naming of the `cupping_*` / `dial_*` families.

---

## Rollout order (strict — respect dependencies)

Run in this order; every step is idempotent and safe to re-run:

1. `sensory_source` table + 4-row seed.
2. `sensory_lexicon_attribute` table, then seed `seeds/sensory_lexicon_attributes_wcr.sql` (~110 rows).
3. `cupping_note`: add columns → backfill `descriptor_source_id = wcr_lexicon` → link `cupping_note_id` on `sensory_lexicon_attribute` by name (incl. aliases Overripe, Brown/Roast) → backfill `cupping_note.lexicon_section` from the link.
4. `coffee_dimensions`: add columns → backfill `source_id` + `lexicon_attribute_id` per the Part 4 table.
5. (Optional) Flavor Intelligence view/query exposing `descriptor_source`.

Schema-level DDL (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, backfill `UPDATE`s) belongs in `schema.sql` so it runs on startup. The ~110-row attribute list is bulk data → the separate seed file, guarded by `ON CONFLICT (name, section) DO NOTHING`.

---

## Testing & verification (run after applying; all must pass)

Add these as a runnable script `backend/src/features/sensory-source-provenance/verify.sql` and paste results into the PR.

```sql
-- 1. Sources present (expect 4 rows, these codes)
SELECT code FROM sensory_source ORDER BY code;
--   expect: platform, sca_cva, sca_flavor_wheel, wcr_lexicon

-- 2. Lexicon seeded (expect ~110; all attributed to WCR)
SELECT count(*) AS attrs,
       count(*) FILTER (WHERE source_id = (SELECT id FROM sensory_source WHERE code='wcr_lexicon')) AS wcr
FROM sensory_lexicon_attribute;                       -- attrs ≈ 110, wcr = attrs

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

-- 4b. Numeric (0–15) axes link to a lexicon attribute where the mapping specifies one
SELECT cd.name, ss.code AS source, la.name AS lexicon_attr
FROM coffee_dimensions cd
LEFT JOIN sensory_source ss ON ss.id = cd.source_id
LEFT JOIN sensory_lexicon_attribute la ON la.id = cd.lexicon_attribute_id
WHERE cd.is_numeric
ORDER BY cd.display_order;
--   expect Body→Body/Fullness, Finish Length→Longevity, Texture→Mouth Drying,
--          Bitterness→Bitter, Sweetness→Overall Sweet, etc. per Part 4
```

**Idempotency test:** run `schema.sql` and the seed a second time; re-run queries 2–4 — counts must be identical (no duplicate rows, no re-nulled columns).

**Non-destructive test (prove no existing data changed):** capture a checksum of the active descriptor content *before* and *after* the migration — must be identical:
```sql
SELECT md5(string_agg(descriptor || '|' || COALESCE(category,'') || '|' || COALESCE(subcategory,''), ',' ORDER BY id))
FROM cupping_note;
```
Also confirm `coffee_dimensions` scored values are untouched: `SELECT md5(string_agg(name||'|'||COALESCE(scale_min::text,'')||'|'||COALESCE(scale_max::text,''), ',' ORDER BY id)) FROM coffee_dimensions;` — unchanged before/after.

**Application-level checks:**
- If the backend has a test suite, add one integration test asserting queries 1–4 return the expected shapes against a migrated test DB.
- Boot the backend against a copy with the migration applied and hit the coffees / flavor-intelligence endpoints — confirm no runtime errors from the added columns (guards against any unexpected fixed-shape row mapping).

## Definition of done
All verification queries pass, both idempotency and non-destructive checksums match, app boots and serves existing endpoints cleanly, `WHAT_WE_BUILT_DB.md` updated, PR opened with `verify.sql` output pasted in.
