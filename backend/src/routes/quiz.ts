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
// Takes an array of selected answer UUIDs, SUMs weighted scores from
// answer_archetype_score, and returns the winning archetype + full score map.
//
// Tie resolution — veto cascade (only triggered when two or more archetypes
// share the highest score):
//   Priority: Q5 → Q4 → Q2 → Q1
//   For each question in that order: if the user's answer pointed to one of
//   the tied archetypes, that archetype wins. Q3 is intentionally excluded
//   from the cascade (it contributes to the score but not tie-breaking).
//   Fallback (cascade exhausted without resolution): Balanced & Sweet.
//
// No auth required.
router.post('/score', async (req, res) => {
  const { answerIds } = req.body;
  if (!Array.isArray(answerIds) || !answerIds.length) {
    res.status(400).json({ error: 'answerIds (array of UUIDs) required' });
    return;
  }

  try {
    // 1. Sum weighted scores per archetype for the submitted answers.
    //    Answers with no archetype_score row are neutral — excluded by the JOIN.
    const result = await db.query(
      `SELECT ar.name AS archetype_name, SUM(aas.score)::numeric AS total
       FROM answer_archetype_score aas
       JOIN archetype ar ON ar.id = aas.archetype_id
       WHERE aas.answer_id = ANY($1::uuid[])
       GROUP BY ar.name`,
      [answerIds]
    );

    if (!result.rows.length) {
      res.status(400).json({ error: 'No scoreable answers found' });
      return;
    }

    // Build scores map { archetypeName: totalPoints }
    const scores: Record<string, number> = {};
    for (const row of result.rows) {
      scores[row.archetype_name] = Number(row.total);
    }

    // 2. Find winner — veto cascade on tie.
    const maxScore = Math.max(...Object.values(scores));
    const tied = Object.keys(scores).filter(n => scores[n] === maxScore);

    let winnerName: string;

    if (tied.length === 1) {
      // Clear winner — no cascade needed.
      winnerName = tied[0];
    } else {
      // Tie: run the veto cascade.
      // Fetch which archetype each submitted answer points to, keyed by q_number.
      // LEFT JOIN so neutral answers (score row missing) still appear with null archetype.
      const cascadeRows = await db.query(
        `SELECT q.q_number, ar.name AS archetype_name
         FROM answer a
         JOIN question q ON q.id = a.question_id
         LEFT JOIN answer_archetype_score aas
               ON aas.answer_id = a.id AND aas.score > 0
         LEFT JOIN archetype ar ON ar.id = aas.archetype_id
         WHERE a.id = ANY($1::uuid[])`,
        [answerIds]
      );

      // q_number → archetype the user's answer pointed to (null if neutral)
      const byQ: Record<number, string | null> = {};
      for (const row of cascadeRows.rows) {
        byQ[Number(row.q_number)] = row.archetype_name ?? null;
      }

      // Walk cascade: first tied archetype found wins; fallback = Balanced & Sweet.
      winnerName = 'Balanced & Sweet';
      for (const qNum of [5, 4, 2, 1]) {
        const pointsTo = byQ[qNum];
        if (pointsTo && tied.includes(pointsTo)) {
          winnerName = pointsTo;
          break;
        }
      }
    }

    // 3. Fetch the archetype UUID for the winner.
    const archetypeResult = await db.query(
      `SELECT id FROM archetype WHERE name = $1`,
      [winnerName]
    );

    res.json({
      archetype: winnerName,
      archetypeId: archetypeResult.rows[0]?.id ?? null,
      scores,
      tied: tied.length > 1 ? tied : undefined, // include for debugging if tie occurred
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
