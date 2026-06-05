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
// Tie resolution — veto cascade (Q6 → Q5 → Q3 → Q1, fallback: Balanced & Sweet).
//
// Food signal (Q2) is captured separately from resulting_archetype_id and used
// alongside the secondary archetype to determine confidence + recommendation mode.
//
// No auth required.
router.post('/score', async (req, res) => {
  const { answerIds } = req.body;
  if (!Array.isArray(answerIds) || !answerIds.length) {
    res.status(400).json({ error: 'answerIds (array of UUIDs) required' });
    return;
  }

  try {
    // 1. Sum weighted scores per archetype (Q2 excluded — no rows in answer_archetype_score).
    const scoreResult = await db.query(
      `SELECT ar.name AS archetype_name, SUM(aas.score)::numeric AS total
       FROM answer_archetype_score aas
       JOIN archetype ar ON ar.id = aas.archetype_id
       WHERE aas.answer_id = ANY($1::uuid[])
       GROUP BY ar.name`,
      [answerIds]
    );

    if (!scoreResult.rows.length) {
      res.status(400).json({ error: 'No scoreable answers found' });
      return;
    }

    const scores: Record<string, number> = {};
    for (const row of scoreResult.rows) {
      scores[row.archetype_name] = Number(row.total);
    }

    // Ranked list: [['Chocolate & Nutty', 7], ['Fruity', 4], ...]
    const ranked = Object.entries(scores).sort(([, a], [, b]) => b - a);
    const maxScore = ranked[0][1];
    const tied = ranked.filter(([, s]) => s === maxScore).map(([n]) => n);

    // 2. Fetch per-answer metadata in one query:
    //    score_archetype — from answer_archetype_score (cascade + secondary close check)
    //    result_archetype — from answer.resulting_archetype_id (food signal for Q2)
    const metaResult = await db.query(
      `SELECT
         q.q_number,
         ar_score.name  AS score_archetype,
         ar_result.name AS result_archetype
       FROM answer a
       JOIN question q ON q.id = a.question_id
       LEFT JOIN answer_archetype_score aas
             ON aas.answer_id = a.id AND aas.score > 0
       LEFT JOIN archetype ar_score  ON ar_score.id  = aas.archetype_id
       LEFT JOIN archetype ar_result ON ar_result.id = a.resulting_archetype_id
       WHERE a.id = ANY($1::uuid[])`,
      [answerIds]
    );

    // q_number → score archetype (first non-null wins; split answers only affect Q4 which is not in cascade)
    const byQ: Record<number, string | null> = {};
    let foodSignal: string | null = null;

    for (const row of metaResult.rows) {
      const qNum = Number(row.q_number);
      if (qNum === 2) {
        foodSignal = row.result_archetype ?? null;
      } else if (!byQ[qNum] && row.score_archetype) {
        byQ[qNum] = row.score_archetype;
      }
    }

    // 3. Winner — veto cascade on tie (Q6 → Q5 → Q3 → Q1, fallback: Balanced & Sweet).
    let winnerName: string;
    if (tied.length === 1) {
      winnerName = tied[0];
    } else {
      winnerName = 'Balanced & Sweet';
      for (const qNum of [6, 5, 3, 1]) {
        const pointsTo = byQ[qNum];
        if (pointsTo && tied.includes(pointsTo)) {
          winnerName = pointsTo;
          break;
        }
      }
    }

    // 4. Secondary archetype — 2nd highest scoring archetype.
    const secondaryArchetype = ranked.find(([n]) => n !== winnerName)?.[0] ?? null;

    // 5. Experimental gate.
    const expResult = await db.query(
      `SELECT 1 FROM answer WHERE id = ANY($1::uuid[]) AND is_experimental_gate = TRUE LIMIT 1`,
      [answerIds]
    );
    const experimental = expResult.rows.length > 0;

    // 6. Option B close threshold: secondary is meaningful if it scored on Q5 or Q6.
    const secondaryScoredHighWeight =
      secondaryArchetype !== null &&
      (byQ[6] === secondaryArchetype || byQ[5] === secondaryArchetype);

    // 7. Confidence + recommendation mode from food signal scenarios.
    type RecommendationMode =
      | 'primary_only'
      | 'primary_plus_introduce_secondary'
      | 'primary_plus_active_secondary'
      | 'primary_plus_note_secondary'
      | 'primary_as_starting_point'
      | 'ai_agent';

    let confidence: 'high' | 'medium' | 'low' = 'high';
    let recommendationMode: RecommendationMode = 'primary_only';

    if (foodSignal === winnerName) {
      if (experimental) {
        confidence = 'medium';
        recommendationMode = 'primary_as_starting_point';
      } else if (secondaryScoredHighWeight) {
        confidence = 'medium';
        recommendationMode = 'primary_plus_note_secondary';
      } else {
        confidence = 'high';
        recommendationMode = 'primary_only';
      }
    } else if (foodSignal === secondaryArchetype) {
      confidence = 'medium';
      recommendationMode = experimental
        ? 'primary_plus_active_secondary'
        : 'primary_plus_introduce_secondary';
    } else if (foodSignal !== null) {
      confidence = 'low';
      recommendationMode = 'ai_agent';
    }

    // 8. Archetype UUID for winner.
    const archetypeResult = await db.query(
      `SELECT id FROM archetype WHERE name = $1`,
      [winnerName]
    );

    res.json({
      archetype: winnerName,
      archetypeId: archetypeResult.rows[0]?.id ?? null,
      scores,
      experimental,
      secondaryArchetype,
      foodSignal,
      confidence,
      recommendationMode,
      tied: tied.length > 1 ? tied : undefined,
    });
  } catch (err) {
    console.error('[quiz/score]', err);
    res.status(500).json({ error: 'Failed to compute archetype score' });
  }
});

// ─── POST /api/quiz/results ──────────────────────────────────────────────────
// Saves a completed quiz session, linking the real archetype FK from the DB.
router.post('/results', requireAuth, async (req: AuthRequest, res) => {
  const { archetype, scores, answers, decaf, experimental, secondaryArchetype, foodSignal, confidence, recommendationMode } = req.body;
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
      [profileId, archetypeId, JSON.stringify({ archetype, scores, answers, decaf: decaf ?? false, experimental: experimental ?? false, secondaryArchetype: secondaryArchetype ?? null, foodSignal: foodSignal ?? null, confidence: confidence ?? 'high', recommendationMode: recommendationMode ?? 'primary_only' })]
    );

    // Get AI recommendation
    const recommendation = await getRecommendation(archetype, decaf ?? false, {
      secondaryArchetype: secondaryArchetype ?? null,
      confidence,
      recommendationMode,
      experimental: experimental ?? false,
    });

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
