import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { getRecommendation } from '../services/claude.js';

const router = Router();

// ─── GET /api/quiz/questions ─────────────────────────────────────────────────
// Returns the active quiz with all questions and answers from the DB.
// No auth required — public endpoint.
router.get('/questions', async (_req, res) => {
  try {
    const quizResult = await db.query(
      `SELECT id FROM quiz WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
    );

    if (!quizResult.rows.length) {
      res.status(404).json({ error: 'No active quiz found' });
      return;
    }

    const quizId = quizResult.rows[0].id;

    const result = await db.query(
      `SELECT
         q.id          AS question_id,
         q.q_number,
         q.q_text,
         json_agg(
           json_build_object(
             'id',             a.id,
             'text',           a.answer_text,
             'archetype_id',   a.resulting_archetype_id,
             'archetype_name', ar.name
           )
           ORDER BY a.id
         ) AS answers
       FROM question q
       JOIN answer a ON a.question_id = q.id
       LEFT JOIN archetype ar ON ar.id = a.resulting_archetype_id
       WHERE q.quiz_id = $1
       GROUP BY q.id, q.q_number, q.q_text
       ORDER BY q.q_number`,
      [quizId]
    );

    res.json({ quizId, questions: result.rows });
  } catch (err) {
    console.error('[quiz/questions]', err);
    res.status(500).json({ error: 'Failed to fetch quiz questions' });
  }
});

// ─── POST /api/quiz/score ────────────────────────────────────────────────────
// Takes an array of selected answer UUIDs, counts archetype votes in the DB,
// and returns the winning archetype name + scores. No auth required.
router.post('/score', async (req, res) => {
  const { answerIds } = req.body;
  if (!Array.isArray(answerIds) || !answerIds.length) {
    res.status(400).json({ error: 'answerIds (array of UUIDs) required' });
    return;
  }

  try {
    // Fetch archetype vote for each selected answer
    const result = await db.query(
      `SELECT a.resulting_archetype_id, ar.name AS archetype_name
       FROM answer a
       LEFT JOIN archetype ar ON ar.id = a.resulting_archetype_id
       WHERE a.id = ANY($1::uuid[])`,
      [answerIds]
    );

    // Count votes per archetype (null archetype_name = neutral answer, skip)
    const scores: Record<string, number> = {};
    for (const row of result.rows) {
      if (row.archetype_name) {
        scores[row.archetype_name] = (scores[row.archetype_name] ?? 0) + 1;
      }
    }

    if (!Object.keys(scores).length) {
      res.status(400).json({ error: 'No scoreable answers found' });
      return;
    }

    // Most votes wins. Tie-break: Balanced & Sweet > Chocolate & Nutty > Fruity
    const TIE_BREAK = ['Balanced & Sweet', 'Chocolate & Nutty', 'Fruity'];
    const [winnerName] = Object.entries(scores).sort(
      (a, b) =>
        b[1] - a[1] ||
        (TIE_BREAK.indexOf(a[0]) === -1 ? 99 : TIE_BREAK.indexOf(a[0])) -
        (TIE_BREAK.indexOf(b[0]) === -1 ? 99 : TIE_BREAK.indexOf(b[0]))
    )[0];

    // Fetch the archetype UUID for the winner
    const archetypeResult = await db.query(
      `SELECT id FROM archetype WHERE name = $1`,
      [winnerName]
    );

    res.json({
      archetype: winnerName,
      archetypeId: archetypeResult.rows[0]?.id ?? null,
      scores,
    });
  } catch (err) {
    console.error('[quiz/score]', err);
    res.status(500).json({ error: 'Failed to compute archetype score' });
  }
});

// ─── POST /api/quiz/results ──────────────────────────────────────────────────
// Saves a completed quiz session, linking the real archetype FK from the DB.
router.post('/results', requireAuth, async (req: AuthRequest, res) => {
  const { archetype, scores, answers, decaf } = req.body;
  if (!archetype || !scores || !answers) {
    res.status(400).json({ error: 'archetype, scores, and answers required' });
    return;
  }

  try {
    // Upsert user_profile
    const profileResult = await db.query(
      `INSERT INTO user_profile (firebase_uid)
       VALUES ($1)
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [req.uid]
    );
    const profileId = profileResult.rows[0].id;

    // Resolve archetype UUID from name (set by frontend after quiz)
    const archetypeResult = await db.query(
      `SELECT id FROM archetype WHERE name = $1`,
      [archetype]
    );
    const archetypeId = archetypeResult.rows[0]?.id ?? null;

    // Save session with real FK
    const sessionResult = await db.query(
      `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [profileId, archetypeId, JSON.stringify({ archetype, scores, answers, decaf: decaf ?? false })]
    );

    // Get AI recommendation
    const recommendation = await getRecommendation(archetype, decaf ?? false);

    res.json({ id: sessionResult.rows[0].id, recommendation });
  } catch (err) {
    console.error('[quiz/results]', err);
    res.status(500).json({ error: 'Failed to save quiz result' });
  }
});

// ─── GET /api/quiz/results/latest ────────────────────────────────────────────
router.get('/results/latest', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      `SELECT qs.*, ar.name AS archetype_name
       FROM quiz_session qs
       JOIN user_profile up ON up.id = qs.user_id
       LEFT JOIN archetype ar ON ar.id = qs.resulting_archetype_id
       WHERE up.firebase_uid = $1
       ORDER BY qs.completed_at DESC
       LIMIT 1`,
      [req.uid]
    );
    res.json(result.rows[0] ?? null);
  } catch (err) {
    console.error('[quiz/results/latest]', err);
    res.status(500).json({ error: 'Failed to fetch quiz result' });
  }
});

export default router;
