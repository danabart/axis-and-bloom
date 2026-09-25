import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getRealClientIp } from '../middleware/clientIp.js';
import { db, withTransaction } from '../db/client.js';
import { rankScores, findWinner, interpret } from '../services/quizScoring.js';
import { scoreAnswerIds } from '../services/quizScorer.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { Timestamp } from 'firebase-admin/firestore';
import { computeBehavioralConfidence } from '../services/behavioralConfidence.js';
import { refreshLifecycleState } from '../services/userLifecycle.js';
import { logFunnelEvent } from '../features/marketing/funnelEvents.js';
import { saveQuizSession, recordScoredInterpretation, getLatestQuizResult } from '../services/quizSession.js';
import { archetypeCode, archetypeUuid } from '../services/catalogReads.js';
import { isSameArchetype } from '../services/tasteJourney.js';

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
       LEFT JOIN coffee_archetype ar ON ar.id = a.resulting_archetype_id
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
// Tie resolution — veto cascade (Q5 → Q4 → Q2 → Q1, fallback: Balanced).
//
// Food signal (Q6) is captured separately from resulting_archetype_id. Secondary, mode, pair confidence and
// explore hint come from interpret() (interpretation v2.1, services/quizScoring.ts). Read-only: writes nothing.
//
// No auth required.
router.post('/score', async (req, res) => {
  const { answerIds } = req.body;
  if (!Array.isArray(answerIds) || !answerIds.length) {
    res.status(400).json({ error: 'answerIds (array of UUIDs) required' });
    return;
  }

  try {
    // 1. Weighted scores per archetype, per-answer byQ, treat and experimental gate (shared scorer).
    const { scores, byQ, foodSignal, experimental } = await scoreAnswerIds(answerIds);

    if (!Object.keys(scores).length) {
      res.status(400).json({ error: 'No scoreable answers found' });
      return;
    }

    const ranked = rankScores(scores);
    const maxScore = ranked[0][1];
    const tied = ranked.filter(([, s]) => s === maxScore).map(([n]) => n);

    // 2. Winner — veto cascade on tie (Q5 → Q4 → Q2 → Q1, fallback: Balanced).
    const winnerName = findWinner(ranked, byQ);

    // 3. Interpretation v2.1 (secondary, mode, pair confidence, explore hint). The branch happens in the
    //    frontend afterwards, so finalArchetype is the pre-branch winner and branchedFrom is null here.
    const interpretation = interpret({
      scores, byQ, foodSignal, experimental, finalArchetype: winnerName, branchedFrom: null,
    });

    // 4. Tie detection — cascade exhausted when there was a score tie and no cascade
    //    question (Q5→Q4→Q2→Q1) resolved it. Provides the ML feature for PROFILE_AMBIGUOUS.
    const tieDetected = tied.length > 1 && ![5, 4, 2, 1].some(q => byQ[q] != null && tied.includes(byQ[q]!));
    const tiedArchetypes = tieDetected ? tied : [];

    // 5. Archetype UUID for winner.
    const archetypeId = await archetypeUuid(winnerName);

    res.json({
      archetype: winnerName,
      archetypeId,
      scores,
      experimental,
      secondaryArchetype: interpretation.secondaryArchetype,
      foodSignal,
      foodSignalAlignment: interpretation.foodSignalAlignment,
      recommendationMode: interpretation.recommendationMode,
      tieDetected,
      tiedArchetypes,
      secondaryPath: interpretation.secondaryPath,
      pairConfidence: interpretation.pairConfidence,
      exploreArchetype: interpretation.exploreArchetype,
      exploreReason: interpretation.exploreReason,
      primaryMargin: interpretation.primaryMargin,
      interpretationVersion: interpretation.interpretationVersion,
    });
  } catch (err) {
    console.error('[quiz/score]', err);
    res.status(500).json({ error: 'Failed to compute archetype score' });
  }
});

// ─── POST /api/quiz/event ─────────────────────────────────────────────────────
// First-party funnel logging (launch/20_analytics-and-tracking/02_B1) — public,
// guest-reachable, source of truth since /api/quiz/score has no auth requirement.
// Handler logic lives in features/marketing/ (home for all new backend marketing
// code); this route stays a thin wrapper. Tighter than the app-wide limiter since
// it's unauthenticated and write-only.
// C17 — keyed on the real visitor IP (see middleware/clientIp.ts); req.ip
// alone collapses behind Cloudflare -> Firebase Hosting -> Cloud Run.
const funnelEventLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: getRealClientIp });
router.post('/event', funnelEventLimiter, async (req, res) => {
  const { sessionKey, event, archetype, campaign, campaignVid } = req.body ?? {};
  try {
    await logFunnelEvent(sessionKey, event, archetype, campaign, campaignVid);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[quiz/event]', err);
    res.status(400).json({ error: err.message ?? 'Invalid funnel event' });
  }
});

// ─── POST /api/quiz/results ──────────────────────────────────────────────────
// Saves a completed quiz session, linking the real archetype FK from the DB.
router.post('/results', requireAuth, async (req: AuthRequest, res) => {
  const { archetype, scores, answers, decaf, experimental, secondaryArchetype, foodSignal, foodSignalAlignment, recommendationMode, answerIds, branchedFrom,
    secondaryPath, pairConfidence, exploreArchetype, exploreReason, primaryMargin, interpretationVersion } = req.body;
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

    // Resolve archetype UUID + save session with real FK — shared with the
    // Pre-Launch Reveal-in-Inbox match-claim path, see services/quizSession.ts.
    const { sessionId } = await saveQuizSession(profileId, archetype, {
      archetype, scores, answers, decaf: decaf ?? false, experimental: experimental ?? false,
      secondaryArchetype: secondaryArchetype ?? null, foodSignal: foodSignal ?? null,
      foodSignalAlignment: foodSignalAlignment ?? 'high', recommendationMode: recommendationMode ?? 'primary_only',
      answerIds: answerIds ?? null, branchedFrom: branchedFrom ?? null,
      // As-scored snapshot from the client (informational: the interpretation table below is recomputed
      // server-side), kept so a session stays self-describing. Interpretation v2.1, brief 2.
      secondaryPath: secondaryPath ?? null, pairConfidence: pairConfidence ?? null,
      exploreArchetype: exploreArchetype ?? null, exploreReason: exploreReason ?? null,
      primaryMargin: primaryMargin ?? null, interpretationVersion: interpretationVersion ?? null,
    });

    // Interpretation v2.1 (brief 2): recompute server-side from answerIds and store the current `scored` row in
    // quiz_session_interpretation (the only table this writes). saveQuizSession commits through the shared pool
    // and is deliberately unmodified, so this is a second, best-effort transaction right after it rather than
    // the same one: a failure is logged, never fails the save, and leaves the session on the context_data
    // fallback until the backfill script covers it.
    try {
      await withTransaction(tx => recordScoredInterpretation(tx, { sessionId, answerIds, archetype, branchedFrom }));
    } catch (err) {
      console.error('[quiz/interpretation]', err);
    }

    // Code for the display name, resolved once: keys users/{uid}.archetype and the
    // taste_journey same-archetype comparison below (retired names resolve too).
    const newCode = await archetypeCode(archetype);

    // Sync to Firestore — non-blocking, Cloud SQL is source of truth
    firestoreDb.doc(`users/${req.uid}`).set({
      archetype:      newCode ?? archetype.toLowerCase(),
      archetypeLabel: archetype,
      lastQuizDate:   FieldValue.serverTimestamp(),
      syncedAt:       FieldValue.serverTimestamp(),
    }, { merge: true }).catch((err: unknown) => console.error('[quiz/firestore-profile]', err));

    await firestoreDb.doc(`users/${req.uid}/quiz_sessions/${sessionId}`).set({
      archetype,
      secondaryArchetype:  secondaryArchetype ?? null,
      foodSignal:          foodSignal ?? null,
      foodSignalAlignment: foodSignalAlignment ?? 'high',
      recommendationMode:  recommendationMode ?? 'primary_only',
      experimental:        experimental ?? false,
      answerIds:           answerIds ?? null,
      branchedFrom:        branchedFrom ?? null,
      scores,
      completedAt:         FieldValue.serverTimestamp(),
    }).catch((err: unknown) => console.error('[quiz/firestore-session]', err));

    res.json({ id: sessionId });

    // Fire-and-forget: compute behavioral confidence, then write taste_journey.
    // Always after the quiz session is saved so the new quiz counts in the computation.
    ;(async () => {
      // Profile Part 6: the taste_journey write must not depend on behavioral
      // confidence succeeding — bc failure previously meant the journey write
      // (below) never ran at all, only console.error'd, silently dropping a
      // real quiz completion from the user's history. bc is now computed
      // best-effort in its own try/catch; the journey write always runs.
      let confidenceLevel: 'low' | 'medium' | 'high' | null = null;
      try {
        const bcResult = await computeBehavioralConfidence(req.uid!);
        confidenceLevel = bcResult.level;
        refreshLifecycleState(req.uid!).catch(err => console.error('[quiz/lifecycle]', err));
      } catch (err) {
        console.error('[quiz/behavioral-confidence]', err);
      }

      try {
        // Bug fix (Profile Part 2/3 verification): `users/{uid}/taste_journey` is a
        // 3-segment path — Firestore document references require an even segment
        // count (collection/doc/collection/doc/...), so `.doc()` on this threw
        // synchronously on every call, silently swallowed by this block's own
        // try/catch. taste_journey has therefore never actually persisted since
        // Sommelier Task 1 shipped it — confirmed by reproducing the throw
        // directly. Matches the working `confidence_profile` convention
        // (`users/{uid}/metadata/{name}`, 4 segments) instead.
        const journeyRef = firestoreDb.doc(`users/${req.uid}/metadata/taste_journey`);
        const journeySnap = await journeyRef.get();
        const journey = journeySnap.exists ? journeySnap.data()! : null;

        // Compare by code, not display string: a doc stored as "Balanced & Sweet"
        // must still count as the same archetype as a fresh "Balanced".
        const currentCode = journey?.currentArchetype ? await archetypeCode(journey.currentArchetype) : null;
        const isSame = isSameArchetype(newCode, currentCode);
        const isFirst = !journey?.currentArchetype;

        const newEntry = {
          archetype,
          archetypeCode: newCode,
          date: Timestamp.now(),
          quizSessionId: String(sessionId),
          confidenceLevel,
          trigger: isFirst ? 'first_quiz' : 'retake',
        };

        await journeyRef.set({
          currentArchetype:   archetype,
          currentArchetypeCode: newCode,
          currentStreakCount: isSame ? (journey?.currentStreakCount ?? 0) + 1 : 1,
          evolutionCount:     isSame ? (journey?.evolutionCount ?? 0) : (journey?.evolutionCount ?? 0) + 1,
          archetypeHistory:   [...(journey?.archetypeHistory ?? []), newEntry],
          lastUpdated:        FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.error('[quiz/taste-journey]', err);
      }
    })();
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
       LEFT JOIN coffee_archetype ar ON ar.id = a.resulting_archetype_id
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
    // Latest session as before, plus the current interpretation row as top-level keys (context_data still raw).
    res.json(await getLatestQuizResult(db, req.uid!));
  } catch (err) {
    console.error('[quiz/results/latest]', err);
    res.status(500).json({ error: 'Failed to fetch quiz result' });
  }
});

export default router;
