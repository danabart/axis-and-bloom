import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { firestoreDb } from '../services/firebase-admin.js';
import { computeBehavioralConfidence } from '../services/behavioralConfidence.js';
import { evaluateSommelier } from '../services/sommelierEvaluator.js';
import { fetchSommelierCoffees } from '../services/sommelierRag.js';
import { getTokenBalance, spendToken } from '../services/tokenService.js';
import { writeOutcome, checkReturnedToSommelier } from '../services/outcomeTracker.js';
import { chatWithSommelier } from '../services/claude.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';

const router = Router();

// ─── POST /api/sommelier/evaluate ────────────────────────────────────────────
router.post('/evaluate', requireAuth, async (req: AuthRequest, res) => {
  const { quizTie, tiedArchetypes, userInitiated } = req.body;
  try {
    await computeBehavioralConfidence(req.uid!);
    const result = await evaluateSommelier(req.uid!, {
      quizTie: quizTie ?? false,
      tiedArchetypes: tiedArchetypes ?? [],
      userInitiated: userInitiated ?? false,
    });
    res.json({
      needsSommelier: result.needsSommelier,
      intent: result.intent,
      openingContext: result.openingContext,
      evaluationId: result.evaluationId,
    });
  } catch (err) {
    console.error('[sommelier/evaluate]', err);
    res.status(500).json({ error: 'Evaluation failed' });
  }
});

// ─── POST /api/sommelier/start ────────────────────────────────────────────────
router.post('/start', requireAuth, async (req: AuthRequest, res) => {
  const { intent, openingContext, evaluationId, tiedArchetypes } = req.body;
  if (!intent) { res.status(400).json({ error: 'intent required' }); return; }

  const config = getSommelierConfig();
  const costPerTurn = config?.tokenEconomy?.costPerTurn ?? 1;
  const maxTurns = config?.intents?.[intent]?.maxTurns ?? config?.sessionLimits?.maxTurns ?? 8;
  const resumeWindowHours = config?.timeWindows?.sessionResumeWindowHours ?? 24;

  try {
    // Token check
    const balance = await getTokenBalance(req.uid!);
    if (balance < costPerTurn) {
      res.status(402).json({
        error: 'insufficient_tokens',
        balance,
        message: 'You need at least 1 token to start a conversation with Liam.',
      });
      return;
    }

    // Resumable session check
    const resumeResult = await db.query(
      `SELECT id, intent, turn_count FROM sommelier_sessions
       WHERE uid = $1
         AND is_closed = false
         AND last_active_at > NOW() - INTERVAL '${resumeWindowHours} hours'
       ORDER BY last_active_at DESC
       LIMIT 1`,
      [req.uid]
    );
    if (resumeResult.rows.length) {
      const s = resumeResult.rows[0];
      res.json({
        resumableSession: {
          sessionId: s.id,
          intent: s.intent,
          turnCount: s.turn_count,
          turnsRemaining: maxTurns - s.turn_count,
        },
      });
      return;
    }

    // Fetch user state from latest quiz for RAG context
    const quizResult = await db.query(
      `SELECT qs.context_data, ar.name AS archetype_name
       FROM quiz_session qs
       JOIN user_profile up ON up.id = qs.user_id
       LEFT JOIN archetype ar ON ar.id = qs.resulting_archetype_id
       WHERE up.firebase_uid = $1
       ORDER BY qs.completed_at DESC LIMIT 2`,
      [req.uid]
    );
    const latestQuiz = quizResult.rows[0];
    const prevQuiz = quizResult.rows[1];
    const userArchetype = latestQuiz?.archetype_name ?? null;
    const previousArchetype = prevQuiz?.archetype_name ?? null;

    // Determine excludeCoffeeIds for RECOMMENDATION_MISS
    let excludeCoffeeIds: number[] = [];
    if (intent === 'RECOMMENDATION_MISS') {
      try {
        const feedbackSnap = await firestoreDb
          .collection(`users/${req.uid}/feedback_events`)
          .where('sentiment', '==', 'negative')
          .orderBy('createdAt', 'desc')
          .limit(10)
          .get();
        excludeCoffeeIds = feedbackSnap.docs
          .map((d) => d.data().coffeeId)
          .filter((id): id is number => typeof id === 'number');
      } catch { /* no feedback events */ }
    }

    const ragFocus = config?.intents?.[intent]?.ragFocus ?? 'curated_mix';
    const ragResult = await fetchSommelierCoffees({
      ragFocus,
      userArchetype,
      previousArchetype: intent === 'TASTE_EVOLUTION' ? previousArchetype : null,
      excludeCoffeeIds,
    });

    // Insert session
    const sessionResult = await db.query(
      `INSERT INTO sommelier_sessions (uid, intent, context_data)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        req.uid,
        intent,
        JSON.stringify({
          intent,
          archetype: userArchetype,
          tiedArchetypes: tiedArchetypes ?? [],
          openingContext: openingContext ?? '',
          ragFocus,
          coffeeIds: ragResult.coffeeIds,
          catalogText: ragResult.catalogText,
          evaluationId: evaluationId ?? null,
        }),
      ]
    );
    const newSessionId: number = sessionResult.rows[0].id;

    // Update Firestore evaluation
    if (evaluationId) {
      firestoreDb
        .doc(`users/${req.uid}/sommelier_evaluations/${evaluationId}`)
        .update({ sessionStarted: true, sessionId: newSessionId, startedAt: new Date() })
        .catch((err: unknown) => console.error('[sommelier/start] eval update:', err));

      checkReturnedToSommelier(req.uid!, evaluationId).catch(() => {});
    }

    // Spend 1 token for the opening turn
    const spendResult = await spendToken(req.uid!, 'sommelier_turn', String(newSessionId));
    if (!spendResult.success) {
      // Delete the session since we can't pay for it
      await db.query('DELETE FROM sommelier_sessions WHERE id = $1', [newSessionId]);
      res.status(402).json({
        error: 'insufficient_tokens',
        balance: spendResult.newBalance,
        message: 'You need at least 1 token to start a conversation with Liam.',
      });
      return;
    }

    // Generate opening message (turn 0)
    let openingMessage = "Hi, I'm Liam — Axis & Bloom's coffee sommelier. What brings you here today?";
    let modelUsed = 'fallback';
    try {
      const chatResult = await chatWithSommelier({
        message: null,
        session: { intent, turnCount: 0, openingContext: openingContext ?? '' },
        catalogContext: ragResult.catalogText,
        history: [],
      });
      openingMessage = chatResult.reply;
      modelUsed = chatResult.modelUsed;
    } catch (claudeErr) {
      console.error('[sommelier/start] chatWithSommelier failed, using fallback:', claudeErr);
    }

    // Save opening message
    await db.query(
      `INSERT INTO sommelier_messages (session_id, role, content, model_used)
       VALUES ($1, 'assistant', $2, $3)`,
      [newSessionId, openingMessage, modelUsed]
    );

    // Update session turn_count + last_active_at
    await db.query(
      `UPDATE sommelier_sessions
       SET turn_count = 1, last_active_at = NOW()
       WHERE id = $1`,
      [newSessionId]
    );

    // Coffee names for the frontend display
    const coffeeNamesResult = await db.query(
      'SELECT name FROM coffees WHERE id = ANY($1::int[]) ORDER BY name',
      [ragResult.coffeeIds]
    );
    const coffeeNames = coffeeNamesResult.rows.map((r: { name: string }) => r.name);

    res.json({
      sessionId: newSessionId,
      openingMessage,
      coffeeNames,
      tokenBalance: spendResult.newBalance,
      turnsRemaining: maxTurns - 1,
    });
  } catch (err) {
    console.error('[sommelier/start]', err);
    res.status(500).json({ error: 'Failed to start sommelier session' });
  }
});

// ─── POST /api/sommelier/:sessionId/message ───────────────────────────────────
router.post('/:sessionId/message', requireAuth, async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message required' });
    return;
  }

  const config = getSommelierConfig();
  const costPerTurn = config?.tokenEconomy?.costPerTurn ?? 1;

  try {
    // Fetch session
    const sessionResult = await db.query(
      'SELECT * FROM sommelier_sessions WHERE id = $1 AND uid = $2',
      [sessionId, req.uid]
    );
    if (!sessionResult.rows.length) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = sessionResult.rows[0];

    if (session.is_closed) {
      res.status(409).json({ error: 'session_closed', message: 'This session has ended.' });
      return;
    }

    const maxTurns =
      config?.intents?.[session.intent]?.maxTurns ??
      config?.sessionLimits?.maxTurns ??
      8;

    if (session.turn_count >= maxTurns) {
      res.status(409).json({ error: 'turn_limit_reached' });
      return;
    }

    // Token check
    const balance = await getTokenBalance(req.uid!);
    if (balance < costPerTurn) {
      res.status(402).json({ error: 'insufficient_tokens', balance });
      return;
    }

    // Save user message
    await db.query(
      `INSERT INTO sommelier_messages (session_id, role, content)
       VALUES ($1, 'user', $2)`,
      [sessionId, message]
    );

    // Fetch history for context
    const historyResult = await db.query(
      `SELECT role, content FROM sommelier_messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );
    const history = historyResult.rows
      .slice(0, -1) // exclude the user message we just inserted
      .map((r: { role: 'user' | 'assistant'; content: string }) => ({
        role: r.role,
        content: r.content,
      }));

    // Spend token
    const spendResult = await spendToken(req.uid!, 'sommelier_turn', String(sessionId));
    if (!spendResult.success) {
      // Remove the user message we just inserted since we can't process it
      await db.query(
        `DELETE FROM sommelier_messages
         WHERE session_id = $1 AND role = 'user'
         ORDER BY created_at DESC LIMIT 1`,
        [sessionId]
      );
      res.status(402).json({ error: 'insufficient_tokens', balance: spendResult.newBalance });
      return;
    }

    // Generate reply
    const ctx = session.context_data ?? {};
    const { reply, modelUsed } = await chatWithSommelier({
      message,
      session: {
        intent: session.intent,
        turnCount: session.turn_count,
        openingContext: ctx.openingContext ?? '',
      },
      catalogContext: ctx.catalogText ?? '',
      history,
    });

    const newTurnCount = session.turn_count + 1;
    const shouldClose = newTurnCount >= maxTurns;

    // Update session
    await db.query(
      `UPDATE sommelier_sessions
       SET turn_count = $2, last_active_at = NOW(),
           is_closed = $3, close_reason = $4
       WHERE id = $1`,
      [sessionId, newTurnCount, shouldClose, shouldClose ? 'turn_limit' : null]
    );

    // Save assistant message
    await db.query(
      `INSERT INTO sommelier_messages (session_id, role, content, model_used)
       VALUES ($1, 'assistant', $2, $3)`,
      [sessionId, reply, modelUsed]
    );

    // Outcome on close
    if (shouldClose && ctx.evaluationId) {
      const tokensRow = await db.query(
        `SELECT COALESCE(SUM(ABS(delta)), 0) AS total
         FROM token_events
         WHERE uid = $1 AND reference_id = $2 AND delta < 0`,
        [req.uid, String(sessionId)]
      );
      const tokensSpent = Number(tokensRow.rows[0]?.total ?? 0);
      writeOutcome(req.uid!, ctx.evaluationId, {
        sessionCompleted: true,
        turnsUsed: newTurnCount,
        tokensSpent,
      }).catch(() => {});
    }

    res.json({
      reply,
      turnCount: newTurnCount,
      sessionClosed: shouldClose,
      turnsRemaining: maxTurns - newTurnCount,
      tokenBalance: spendResult.newBalance,
      modelUsed,
    });
  } catch (err) {
    console.error('[sommelier/message]', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// ─── GET /api/sommelier/sessions ─────────────────────────────────────────────
router.get('/sessions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      `SELECT id, intent, started_at, turn_count, is_closed, close_reason
       FROM sommelier_sessions
       WHERE uid = $1
       ORDER BY started_at DESC
       LIMIT 5`,
      [req.uid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[sommelier/sessions]', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ─── POST /api/sommelier/:sessionId/close ────────────────────────────────────
router.post('/:sessionId/close', requireAuth, async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  try {
    const sessionResult = await db.query(
      'SELECT * FROM sommelier_sessions WHERE id = $1 AND uid = $2',
      [sessionId, req.uid]
    );
    if (!sessionResult.rows.length) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = sessionResult.rows[0];

    if (session.is_closed) {
      res.json({ closed: true });
      return;
    }

    await db.query(
      `UPDATE sommelier_sessions
       SET is_closed = true, close_reason = 'user_closed'
       WHERE id = $1`,
      [sessionId]
    );

    const ctx = session.context_data ?? {};
    if (ctx.evaluationId) {
      writeOutcome(req.uid!, ctx.evaluationId, {
        sessionCompleted: false,
        turnsUsed: session.turn_count,
      }).catch(() => {});
    }

    res.json({ closed: true });
  } catch (err) {
    console.error('[sommelier/close]', err);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

export default router;
