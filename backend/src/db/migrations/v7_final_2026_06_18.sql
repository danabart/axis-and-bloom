-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Quiz V7 — final normalised schema
-- Run once in Cloud SQL Studio against the axisandbloom database.
-- Fully idempotent — safe to re-run.
-- Supersedes v7_normalize_2026_06_18.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. quiz_type lookup table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_type (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE
);

INSERT INTO quiz_type (name) VALUES ('main'), ('branch')
ON CONFLICT (name) DO NOTHING;

-- ─── 2. Add columns to quiz ───────────────────────────────────────────────────
ALTER TABLE quiz ADD COLUMN IF NOT EXISTS quiz_type_id         UUID REFERENCES quiz_type(id);
ALTER TABLE quiz ADD COLUMN IF NOT EXISTS trigger_archetype_id UUID REFERENCES archetype(id);
ALTER TABLE quiz ADD COLUMN IF NOT EXISTS parent_quiz_id       UUID REFERENCES quiz(id);

-- Backfill existing quizzes as type 'main'
UPDATE quiz
SET    quiz_type_id = (SELECT id FROM quiz_type WHERE name = 'main')
WHERE  quiz_type_id IS NULL;

-- ─── 3. Rename answer → quiz_answer ──────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'answer' AND schemaname = 'public') THEN
    ALTER TABLE answer RENAME TO quiz_answer;
  END IF;
END $$;

ALTER TABLE quiz_answer ADD COLUMN IF NOT EXISTS weight               NUMERIC DEFAULT 1;
ALTER TABLE quiz_answer ADD COLUMN IF NOT EXISTS is_experimental_gate BOOLEAN DEFAULT FALSE;

-- ─── 4. Drop quiz_branch entirely ────────────────────────────────────────────
-- Branch quizzes are now quiz rows with trigger_archetype_id + parent_quiz_id.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'quiz_branch' AND schemaname = 'public') THEN
    DROP TABLE quiz_branch;
  END IF;
END $$;

-- ─── 5. Fix Q2 answer texts ───────────────────────────────────────────────────
UPDATE quiz_answer
SET answer_text = 'It was strong and satisfying — I felt it.'
WHERE answer_text = 'It was strong and satisfying. I felt it.';

UPDATE quiz_answer
SET answer_text = 'It was smooth and easy the whole way through — nothing got in the way.'
WHERE answer_text = 'It was smooth and easy the whole way through. Nothing got in the way.';

-- ─── 6. Re-seed V7 with final design ─────────────────────────────────────────
DO $v7$
DECLARE
  v_main_type_id   UUID;
  v_branch_type_id UUID;
  v_quiz_id        UUID;
  v_choc_id        UUID;
  v_bal_id         UUID;
  v_fruit_id       UUID;
  v_floral_id      UUID;
  v_earthy_id      UUID;
  v_q1_id UUID; v_q2_id UUID; v_q3_id UUID;
  v_q4_id UUID; v_q5_id UUID; v_q6_id UUID;
  v_floral_bq_id UUID;
  v_earthy_bq_id UUID;
  v_fbq1_id      UUID;
  v_ebq1_id      UUID;
BEGIN
  -- Skip if branch quizzes already have trigger_archetype_id set (final design in place)
  IF EXISTS (SELECT 1 FROM quiz WHERE version = 'v7-branch-floral' AND trigger_archetype_id IS NOT NULL) THEN RETURN; END IF;

  DELETE FROM quiz WHERE version IN ('v7', 'v7-branch-floral', 'v7-branch-earthy');

  SELECT id INTO v_main_type_id   FROM quiz_type WHERE name = 'main';
  SELECT id INTO v_branch_type_id FROM quiz_type WHERE name = 'branch';

  SELECT id INTO v_choc_id   FROM archetype WHERE name = 'Chocolate & Nutty';
  SELECT id INTO v_bal_id    FROM archetype WHERE name = 'Balanced & Sweet';
  SELECT id INTO v_fruit_id  FROM archetype WHERE name = 'Fruity';
  SELECT id INTO v_floral_id FROM archetype WHERE name = 'Floral';
  SELECT id INTO v_earthy_id FROM archetype WHERE name = 'Earthy';

  UPDATE quiz SET is_active = FALSE WHERE quiz_type_id = v_main_type_id OR quiz_type_id IS NULL;

  -- ── Main quiz ─────────────────────────────────────────────────────────────────
  INSERT INTO quiz (version, description, is_active, quiz_type_id)
    VALUES ('v7', 'Axis & Bloom Flavor Finder — V7', true, v_main_type_id)
    RETURNING id INTO v_quiz_id;

  INSERT INTO question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 1, 'How would you describe your relationship with coffee?', 1)
    RETURNING id INTO v_q1_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q1_id, 'It''s a daily ritual. I''m particular about it.',                v_choc_id),
    (v_q1_id, 'It''s a reliable habit. I just like having it.',                 v_bal_id),
    (v_q1_id, 'It''s something I''m still discovering. I''m curious about it.', v_fruit_id);

  INSERT INTO question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 2, 'When you finish a really good cup of coffee, what made it good?', 2)
    RETURNING id INTO v_q2_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q2_id, 'It was strong and satisfying — I felt it.',                              v_choc_id),
    (v_q2_id, 'It was smooth and easy the whole way through — nothing got in the way.', v_bal_id),
    (v_q2_id, 'It felt alive — bright and changing. Every sip was a little different.', v_fruit_id);

  INSERT INTO question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 3, 'You try a new coffee black. What''s your first reaction?', 1)
    RETURNING id INTO v_q3_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q3_id, 'It feels complete. I''d drink it as is, or add milk to make it even richer.', v_choc_id),
    (v_q3_id, 'It''s fine, easy to drink. I might add something to smooth it out.',           v_bal_id);
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id, is_experimental_gate) VALUES
    (v_q3_id, 'Interesting… what flavors am I getting here?', v_fruit_id, TRUE);

  INSERT INTO question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 4, 'Which of these would bother you most about a cup of coffee?', 2)
    RETURNING id INTO v_q4_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q4_id, 'It has no bitterness or intensity.', v_choc_id),
    (v_q4_id, 'It''s too bitter or too intense.',   v_bal_id),
    (v_q4_id, 'Every sip tastes exactly the same.', v_fruit_id);

  INSERT INTO question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 5, 'Someone hands you a coffee that''s a little more bitter than expected. What''s your honest reaction?', 3)
    RETURNING id INTO v_q5_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q5_id, 'I don''t mind. Actually I kind of like it. It tastes serious.',           v_choc_id),
    (v_q5_id, 'I''d rather have something gentler and smoother.',                        v_bal_id),
    (v_q5_id, 'It feels burnt to me. I''d rather have something fresher or more alive.', v_fruit_id);

  INSERT INTO question (quiz_id, q_number, q_text, weight)
    VALUES (v_quiz_id, 6, 'Someone places a small treat next to your coffee. Without thinking, which do you grab?', 0)
    RETURNING id INTO v_q6_id;
  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_q6_id, 'Something rich and comforting. Dark chocolate, roasted nuts, a warm brownie.', v_choc_id),
    (v_q6_id, 'Something soft and sweet. A ripe peach, a vanilla biscuit, caramel.',          v_bal_id),
    (v_q6_id, 'Something fresh and lively. A green apple, fresh berries, citrus.',            v_fruit_id);

  INSERT INTO answer_archetype_score (answer_id, question_id, archetype_id, score)
  SELECT a.id, q.id, ar.id, data.score
  FROM (VALUES
    (1, 'It''s a daily ritual. I''m particular about it.',                              'Chocolate & Nutty', 1::numeric),
    (1, 'It''s a reliable habit. I just like having it.',                               'Balanced & Sweet',  1::numeric),
    (1, 'It''s something I''m still discovering. I''m curious about it.',               'Fruity',            1::numeric),
    (2, 'It was strong and satisfying — I felt it.',                                    'Chocolate & Nutty', 2::numeric),
    (2, 'It was smooth and easy the whole way through — nothing got in the way.',       'Balanced & Sweet',  2::numeric),
    (2, 'It felt alive — bright and changing. Every sip was a little different.',       'Fruity',            2::numeric),
    (3, 'It feels complete. I''d drink it as is, or add milk to make it even richer.',  'Chocolate & Nutty', 1::numeric),
    (3, 'It''s fine, easy to drink. I might add something to smooth it out.',           'Balanced & Sweet',  1::numeric),
    (3, 'Interesting… what flavors am I getting here?',                                 'Fruity',            1::numeric),
    (4, 'It has no bitterness or intensity.',                                            'Chocolate & Nutty', 2::numeric),
    (4, 'It''s too bitter or too intense.',                                              'Balanced & Sweet',  2::numeric),
    (4, 'Every sip tastes exactly the same.',                                            'Fruity',            2::numeric),
    (5, 'I don''t mind. Actually I kind of like it. It tastes serious.',                'Chocolate & Nutty', 3::numeric),
    (5, 'I''d rather have something gentler and smoother.',                              'Balanced & Sweet',  3::numeric),
    (5, 'It feels burnt to me. I''d rather have something fresher or more alive.',      'Fruity',            3::numeric)
  ) AS data(q_number, answer_text, archetype_name, score)
  JOIN question    q  ON q.quiz_id = v_quiz_id AND q.q_number = data.q_number::int
  JOIN quiz_answer a  ON a.question_id = q.id  AND a.answer_text = data.answer_text
  JOIN archetype   ar ON ar.name = data.archetype_name
  ON CONFLICT (answer_id, archetype_id) DO NOTHING;

  -- ── Branch quiz: Fruity → Floral ──────────────────────────────────────────────
  INSERT INTO quiz (version, description, is_active, quiz_type_id, trigger_archetype_id, parent_quiz_id)
    VALUES ('v7-branch-floral', 'V7 branch — Fruity → Floral', false, v_branch_type_id, v_fruit_id, v_quiz_id)
    RETURNING id INTO v_floral_bq_id;

  INSERT INTO question (quiz_id, q_number, q_text, weight)
    VALUES (v_floral_bq_id, 1,
      'One last thing. When coffee is really at its best for you, which is closer?', 1)
    RETURNING id INTO v_fbq1_id;

  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_fbq1_id,
     'It''s complex and alive. A lot happening — I want to explore every sip.',
     v_fruit_id),
    (v_fbq1_id,
     'It''s so light and delicate it barely feels like coffee. Almost like drinking tea.',
     v_floral_id);

  -- ── Branch quiz: Chocolate & Nutty → Earthy ───────────────────────────────────
  INSERT INTO quiz (version, description, is_active, quiz_type_id, trigger_archetype_id, parent_quiz_id)
    VALUES ('v7-branch-earthy', 'V7 branch — Chocolate & Nutty → Earthy', false, v_branch_type_id, v_choc_id, v_quiz_id)
    RETURNING id INTO v_earthy_bq_id;

  INSERT INTO question (quiz_id, q_number, q_text, weight)
    VALUES (v_earthy_bq_id, 1,
      'Your profile is rich and bold. How do you like to take it?', 1)
    RETURNING id INTO v_ebq1_id;

  INSERT INTO quiz_answer (question_id, answer_text, resulting_archetype_id) VALUES
    (v_ebq1_id,
     'Rich and comforting. Coffee that feels like a reward at the end of the day.',
     v_choc_id),
    (v_ebq1_id,
     'Deep and intense. Complex, almost challenging. The more serious the better.',
     v_earthy_id);

END $v7$;
