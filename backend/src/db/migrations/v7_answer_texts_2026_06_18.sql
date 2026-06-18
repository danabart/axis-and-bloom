-- ─────────────────────────────────────────────────────────────────────────────
-- Fix V7 answer texts to match Excel wording
-- Run in Cloud SQL Studio — safe to re-run (UPDATE is idempotent on text match)
-- ─────────────────────────────────────────────────────────────────────────────

-- Q2: "period" variants → em-dash variants
UPDATE quiz_answer
SET answer_text = 'It was strong and satisfying — I felt it.'
WHERE answer_text = 'It was strong and satisfying. I felt it.';

UPDATE quiz_answer
SET answer_text = 'It was smooth and easy the whole way through — nothing got in the way.'
WHERE answer_text = 'It was smooth and easy the whole way through. Nothing got in the way.';

-- Sync quiz_answer_archetype_score text references if they denormalise answer text (none currently — kept as safety)
-- No action needed: quiz_answer_archetype_score links by UUID, not text.
