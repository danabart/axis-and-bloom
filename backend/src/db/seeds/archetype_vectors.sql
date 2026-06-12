-- Archetype dimension vectors
-- Source: backend/src/dimensions/dimensions-vector.JPG
--
-- dimension_id uses md5(dimension_name)::uuid — stable, deterministic, no FK needed
-- (FK to the old UUID-based dimension table was removed in schema cleanup)
-- ideal_score = midpoint of the min–max range
--
-- Run in Cloud SQL Studio. Fully idempotent — safe to re-run.

INSERT INTO archetype_vector (archetype_id, dimension_id, ideal_score, min_score, max_score)
SELECT a.id, v.dim_uuid, v.ideal, v.lo, v.hi
FROM archetype a
JOIN (VALUES
  -- Chocolate & Nutty
  ('Chocolate & Nutty', md5('Sweetness')::uuid,      8.0,  7.0,  9.0),
  ('Chocolate & Nutty', md5('Acidity')::uuid,         4.0,  3.0,  5.0),
  ('Chocolate & Nutty', md5('Bitterness')::uuid,     10.0,  9.0, 11.0),
  ('Chocolate & Nutty', md5('Body')::uuid,           11.5, 10.0, 13.0),
  ('Chocolate & Nutty', md5('Texture')::uuid,         4.0,  3.0,  5.0),
  ('Chocolate & Nutty', md5('Savory / Depth')::uuid,  8.0,  7.0,  9.0),
  ('Chocolate & Nutty', md5('Finish Length')::uuid,  10.0,  9.0, 11.0),

  -- Balanced & Sweet
  ('Balanced & Sweet',  md5('Sweetness')::uuid,      10.0,  9.0, 11.0),
  ('Balanced & Sweet',  md5('Acidity')::uuid,         7.0,  6.0,  8.0),
  ('Balanced & Sweet',  md5('Bitterness')::uuid,      7.0,  6.0,  8.0),
  ('Balanced & Sweet',  md5('Body')::uuid,            8.0,  7.0,  9.0),
  ('Balanced & Sweet',  md5('Texture')::uuid,         3.0,  2.0,  4.0),
  ('Balanced & Sweet',  md5('Savory / Depth')::uuid,  5.0,  4.0,  6.0),
  ('Balanced & Sweet',  md5('Finish Length')::uuid,   7.0,  6.0,  8.0),

  -- Earthy
  ('Earthy',            md5('Sweetness')::uuid,       6.0,  5.0,  7.0),
  ('Earthy',            md5('Acidity')::uuid,         4.0,  3.0,  5.0),
  ('Earthy',            md5('Bitterness')::uuid,      9.0,  8.0, 10.0),
  ('Earthy',            md5('Body')::uuid,           13.0, 12.0, 14.0),
  ('Earthy',            md5('Texture')::uuid,        10.0,  9.0, 11.0),
  ('Earthy',            md5('Savory / Depth')::uuid, 13.0, 12.0, 14.0),
  ('Earthy',            md5('Finish Length')::uuid,  13.0, 12.0, 14.0),

  -- Floral
  ('Floral',            md5('Sweetness')::uuid,       8.0,  7.0,  9.0),
  ('Floral',            md5('Acidity')::uuid,        11.0, 10.0, 12.0),
  ('Floral',            md5('Bitterness')::uuid,      4.0,  3.0,  5.0),
  ('Floral',            md5('Body')::uuid,            6.0,  5.0,  7.0),
  ('Floral',            md5('Texture')::uuid,         3.0,  2.0,  4.0),
  ('Floral',            md5('Savory / Depth')::uuid,  4.0,  3.0,  5.0),
  ('Floral',            md5('Finish Length')::uuid,   4.0,  3.0,  5.0),

  -- Fruity
  ('Fruity',            md5('Sweetness')::uuid,       8.0,  7.0,  9.0),
  ('Fruity',            md5('Acidity')::uuid,        13.0, 12.0, 14.0),
  ('Fruity',            md5('Bitterness')::uuid,      6.0,  5.0,  7.0),
  ('Fruity',            md5('Body')::uuid,            6.0,  5.0,  7.0),
  ('Fruity',            md5('Texture')::uuid,         4.0,  3.0,  5.0),
  ('Fruity',            md5('Savory / Depth')::uuid,  4.0,  3.0,  5.0),
  ('Fruity',            md5('Finish Length')::uuid,   8.0,  7.0,  9.0)

) AS v(archetype_name, dim_uuid, ideal, lo, hi)
ON a.name = v.archetype_name
ON CONFLICT (archetype_id, dimension_id) DO UPDATE
  SET ideal_score = EXCLUDED.ideal_score,
      min_score   = EXCLUDED.min_score,
      max_score   = EXCLUDED.max_score,
      updated_at  = NOW();
