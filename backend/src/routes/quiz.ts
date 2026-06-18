import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { getRecommendation } from '../services/claude.js';
import { rankScores, findWinner, findSecondary, isSecondaryClose, computeConfidenceAndMode } from '../services/quizScoring.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';

const router = Router();

// ─── GET /api/quiz/questions ─────────────────────────────────────────────────
// Returns the active quiz with all questions and answers from the DB.
// No auth required — public endpoint.
router.get('/questions', async (_req, res) => {
  try {
    const quizResult = await db.query(
      `SELECT id FROM quiz WHERE is_active = true AND parent_quiz_id IS NULL ORDER BY created_at DESC LIMIT 1`
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
       FROM quiz_question q
       JOIN quiz_answer a ON a.question_id = q.id
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
// quiz_answer_archetype_score, and returns the winning archetype + full score map.
//
// Tie resolution — veto cascade (Q5 → Q4 → Q2 → Q1, fallback: Balanced & Sweet).
//
// Food signal (Q6) is captured separately from resulting_archetype_id and used
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
    // 1. Sum weighted scores per archetype (Q2 excluded — no rows in quiz_answer_archetype_score).
    const scoreResult = await db.query(
      `SELECT ar.name AS archetype_name, SUM(aas.score)::numeric AS total
       FROM quiz_answer_archetype_score aas
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

    const ranked = rankScores(scores);
    const maxScore = ranked[0][1];
    const tied = ranked.filter(([, s]) => s === maxScore).map(([n]) => n);

    // 2. Fetch per-answer metadata in one query:
    //    score_archetype — from quiz_answer_archetype_score (cascade + secondary close check)
    //    result_archetype — from answer.resulting_archetype_id (food signal for Q6)
    const metaResult = await db.query(
      `SELECT
         q.q_number,
         ar_score.name  AS score_archetype,
         ar_result.name AS result_archetype
       FROM quiz_answer a
       JOIN quiz_question q ON q.id = a.question_id
       LEFT JOIN quiz_answer_archetype_score aas
             ON aas.answer_id = a.id AND aas.score > 0
       LEFT JOIN archetype ar_score  ON ar_score.id  = aas.archetype_id
       LEFT JOIN archetype ar_result ON ar_result.id = a.resulting_archetype_id
       WHERE a.id = ANY($1::uuid[])`,
      [answerIds]
    );

    // q_number → score archetype (first non-null wins)
    const byQ: Record<number, string | null> = {};
    let foodSignal: string | null = null;

    for (const row of metaResult.rows) {
      const qNum = Number(row.q_number);
      if (qNum === 6) {
        foodSignal = row.result_archetype ?? null;
      } else if (!byQ[qNum] && row.score_archetype) {
        byQ[qNum] = row.score_archetype;
      }
    }

    // 3. Winner — veto cascade on tie (Q5 → Q4 → Q2 → Q1, fallback: Balanced & Sweet).
    const winnerName = findWinner(ranked, byQ);

    // 4. Secondary archetype — 2nd highest scoring archetype.
    const secondaryArchetype = findSecondary(ranked, winnerName);

    // 5. Experimental gate.
    const expResult = await db.query(
      `SELECT 1 FROM quiz_answer WHERE id = ANY($1::uuid[]) AND is_experimental_gate = TRUE LIMIT 1`,
      [answerIds]
    );
    const experimental = expResult.rows.length > 0;

    // 6. Option B close threshold: secondary is meaningful if it scored on Q4 or Q5.
    const secondaryScoredHighWeight = isSecondaryClose(byQ, secondaryArchetype);

    // 7. Confidence + recommendation mode from food signal scenarios.
    const { confidence, recommendationMode } = computeConfidenceAndMode(
      foodSignal, winnerName, secondaryArchetype, experimental, secondaryScoredHighWeight
    );

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

    const sessionId = sessionResult.rows[0].id;

    // Sync to Firestore — non-blocking, Cloud SQL is source of truth
    firestoreDb.doc(`users/${req.uid}`).set({
      archetype:      archetype.toLowerCase(),
      archetypeLabel: archetype,
      lastQuizDate:   FieldValue.serverTimestamp(),
      syncedAt:       FieldValue.serverTimestamp(),
    }, { merge: true }).catch((err: unknown) => console.error('[quiz/firestore-profile]', err));

    await firestoreDb.doc(`users/${req.uid}/quiz_sessions/${sessionId}`).set({
      archetype,
      secondaryArchetype:  secondaryArchetype ?? null,
      foodSignal:          foodSignal ?? null,
      confidence:          confidence ?? 'high',
      recommendationMode:  recommendationMode ?? 'primary_only',
      experimental:        experimental ?? false,
      scores,
      completedAt:         FieldValue.serverTimestamp(),
    }).catch((err: unknown) => console.error('[quiz/firestore-session]', err));

    // Get AI recommendation
    const recommendation = await getRecommendation(archetype, decaf ?? false, {
      secondaryArchetype: secondaryArchetype ?? null,
      confidence,
      recommendationMode,
      experimental: experimental ?? false,
    });

    res.json({ id: sessionId, recommendation });
  } catch (err) {
    console.error('[quiz/results]', err);
    res.status(500).json({ error: 'Failed to save quiz result' });
  }
});

// ─── GET /api/quiz/branch ────────────────────────────────────────────────────
// Returns the branch question + answers for the given archetypeId in the active quiz.
// Branch quizzes are quiz rows of type 'branch' with trigger_archetype_id + parent_quiz_id.
// Answers carry resulting_archetype_id — frontend derives final archetype from selection.
// Returns { branchQuestion: null } when no branch exists for that archetype.
// No auth required — called immediately after /score.
router.get('/branch', async (req, res) => {
  const { archetypeId } = req.query;
  if (!archetypeId || typeof archetypeId !== 'string') {
    res.status(400).json({ error: 'archetypeId query param required' });
    return;
  }

  try {
    const mainQuizResult = await db.query(
      `SELECT id FROM quiz WHERE is_active = true AND parent_quiz_id IS NULL ORDER BY created_at DESC LIMIT 1`
    );
    if (!mainQuizResult.rows.length) {
      res.json({ branchQuestion: null });
      return;
    }

    const result = await db.query(
      `SELECT
         q.id       AS question_id,
         q.q_text   AS question_text,
         json_agg(
           json_build_object(
             'id',          a.id,
             'text',        a.answer_text,
             'archetypeId', a.resulting_archetype_id,
             'archetypeName', ar.name
           )
           ORDER BY a.id
         ) AS answers
       FROM quiz         bq
       JOIN quiz_question  q  ON q.quiz_id = bq.id
       JOIN quiz_answer   a  ON a.question_id = q.id
       LEFT JOIN archetype ar ON ar.id = a.resulting_archetype_id
       WHERE bq.parent_quiz_id = $1
         AND bq.trigger_archetype_id = $2
       GROUP BY q.id, q.q_text`,
      [mainQuizResult.rows[0].id, archetypeId]
    );

    if (!result.rows.length) {
      res.json({ branchQuestion: null });
      return;
    }

    const row = result.rows[0];
    res.json({
      branchQuestion: {
        questionId:   row.question_id,
        questionText: row.question_text,
        answers:      row.answers,
      },
    });
  } catch (err) {
    console.error('[quiz/branch]', err);
    res.status(500).json({ error: 'Failed to fetch branch question' });
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
