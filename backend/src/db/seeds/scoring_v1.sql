-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: scoring_v1 — answer_archetype_score + Q5 + weight columns
-- Run once in Cloud SQL Studio (or wait for next Cloud Run deploy).
-- Safe to re-run: all inserts use ON CONFLICT DO NOTHING / IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Weight columns (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'question' AND column_name = 'weight'
  ) THEN
    ALTER TABLE question ADD COLUMN weight NUMERIC DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'answer' AND column_name = 'weight'
  ) THEN
    ALTER TABLE answer ADD COLUMN weight NUMERIC DEFAULT 1;
  END IF;
END $$;

-- 2. answer_archetype_score table (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS answer_archetype_score (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id    UUID NOT NULL REFERENCES answer(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  archetype_id UUID REFERENCES archetype(id) ON DELETE SET NULL,
  score        NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (answer_id, archetype_id)
);

CREATE INDEX IF NOT EXISTS idx_answer_arch_score_answer    ON answer_archetype_score(answer_id);
CREATE INDEX IF NOT EXISTS idx_answer_arch_score_archetype ON answer_archetype_score(archetype_id);

-- 3. Q5 — add bitterness question if not present (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
DO $q5$
DECLARE
  v_quiz_id  UUID;
  v_q5_id    UUID;
  v_choc_id  UUID;
  v_bal_id   UUID;
  v_fruit_id UUID;
BEGIN
  SELECT id INTO v_quiz_id FROM quiz WHERE version = 'v2';
  IF v_quiz_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM question WHERE quiz_id = v_quiz_id AND q_number = 5
  ) THEN
    SELECT id INTO v_choc_id  FROM archetype WHERE name = 'Chocolate & Nutty';
    SELECT id INTO v_bal_id   FROM archetype WHERE name = 'Balanced & Sweet';
    SELECT id INTO v_fruit_id FROM archetype WHERE name = 'Fruity';

    INSERT INTO question (quiz_id, q_number, q_text)
      VALUES (v_quiz_id, 5, 'You''re handed an espresso — straight, no milk, no sugar. How does it land?')
      RETURNING id INTO v_q5_id;

    UPDATE quiz SET description = 'Axis & Bloom Flavor Finder — 5 questions' WHERE id = v_quiz_id;

    INSERT INTO answer (question_id, answer_text, resulting_archetype_id) VALUES
      (v_q5_id, 'I don''t mind. Actually I kind of like it. It tastes serious.',             v_choc_id),
      (v_q5_id, 'I''ll reach for milk or sugar. I don''t want that.',                        v_bal_id),
      (v_q5_id, 'It feels flat or burnt to me. I''d rather have something bright or light.', v_fruit_id);

    RAISE NOTICE 'Q5 inserted (quiz_id=%)', v_quiz_id;
  ELSE
    RAISE NOTICE 'Q5 already exists — skipped';
  END IF;
END $q5$;

-- 4. answer_archetype_score rows for Q1–Q5 (idempotent — ON CONFLICT DO NOTHING)
-- Matches by q_number + answer_text so insert order in the DB never causes drift.
-- ─────────────────────────────────────────────────────────────────────────────
DO $scoring$
DECLARE
  v_quiz_id UUID;
  v_rows    INT;
BEGIN
  SELECT id INTO v_quiz_id FROM quiz WHERE version = 'v2';
  IF v_quiz_id IS NULL THEN
    RAISE EXCEPTION 'Quiz v2 not found — cannot seed scoring';
  END IF;

  INSERT INTO answer_archetype_score (answer_id, question_id, archetype_id, score)
  SELECT a.id, q.id, ar.id, data.score
  FROM (VALUES
    -- Q1: relationship with coffee (1 pt each)
    (1, 'It''s a daily ritual. I''m particular about it.',                                          'Chocolate & Nutty', 1),
    (1, 'It''s a reliable habit. I just like having it.',                                            'Balanced & Sweet',  1),
    (1, 'It''s something I''m still discovering. I''m curious about it.',                           'Fruity',            1),
    -- Q2: treat pick (2 pts each)
    (2, 'Something rich and comforting — dark chocolate, roasted nuts, a warm brownie.',            'Chocolate & Nutty', 2),
    (2, 'Something soft and sweet — a ripe peach, a vanilla biscuit, caramel.',                    'Balanced & Sweet',  2),
    (2, 'Something fresh and lively — a green apple, fresh berries, citrus.',                      'Fruity',            2),
    -- Q3: first sip black (1 pt each; option D neutral → no row)
    (3, 'It feels complete. I''d drink it as is, or add milk to make it even richer.',             'Chocolate & Nutty', 1),
    (3, 'It''s fine, easy to drink. I might add something to smooth it out.',                      'Balanced & Sweet',  1),
    (3, 'Interesting… what flavors am I getting here?',                                              'Fruity',            1),
    -- Q4: biggest disappointment (2 pts each)
    (4, 'Feels too thin or watery.',                                                                'Chocolate & Nutty', 2),
    (4, 'Feels too heavy or strong.',                                                               'Balanced & Sweet',  2),
    (4, 'Every sip tastes exactly the same.',                                                      'Fruity',            2),
    -- Q5: straight espresso (3 pts each — bitterness tolerance is the strongest signal)
    (5, 'I don''t mind. Actually I kind of like it. It tastes serious.',                           'Chocolate & Nutty', 3),
    (5, 'I''ll reach for milk or sugar. I don''t want that.',                                      'Balanced & Sweet',  3),
    (5, 'It feels flat or burnt to me. I''d rather have something bright or light.',               'Fruity',            3)
  ) AS data(q_number, answer_text, archetype_name, score)
  JOIN question q  ON q.quiz_id = v_quiz_id AND q.q_number = data.q_number::int
  JOIN answer   a  ON a.question_id = q.id   AND a.answer_text = data.answer_text
  JOIN archetype ar ON ar.name = data.archetype_name
  ON CONFLICT (answer_id, archetype_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'answer_archetype_score: % rows inserted', v_rows;
END $scoring$;

-- 5. Verification queries — paste these separately to confirm
-- ─────────────────────────────────────────────────────────────────────────────
-- Check Q5 exists:
--   SELECT q_number, q_text FROM question WHERE q_number = 5;
--
-- Check scoring rows (should be 14 rows — Q3 option D is neutral, no row):
--   SELECT q.q_number, a.answer_text, ar.name AS archetype, aas.score
--   FROM answer_archetype_score aas
--   JOIN answer   a  ON a.id  = aas.answer_id
--   JOIN question q  ON q.id  = aas.question_id
--   JOIN archetype ar ON ar.id = aas.archetype_id
--   ORDER BY q.q_number, aas.score DESC;
