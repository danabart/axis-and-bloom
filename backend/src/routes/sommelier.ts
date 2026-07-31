import { Router } from 'express';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { computeBehavioralConfidence } from '../services/behavioralConfidence.js';
import { evaluateSommelier } from '../services/sommelierEvaluator.js';
import { fetchSommelierCoffees } from '../services/sommelierRag.js';
import { getTokenBalance, spendToken } from '../services/tokenService.js';
import { writeOutcome, checkReturnedToSommelier } from '../services/outcomeTracker.js';
import { chatWithSommelier } from '../services/claude.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';
import { routeTopic } from '../services/topicRouter.js';

function getGeneration(dateOfBirth: string | Date | null | undefined): string {
  if (!dateOfBirth) return 'Millennial';
  const year = new Date(dateOfBirth).getFullYear();
  if (year >= 1997) return 'Gen Z';
  if (year >= 1981) return 'Millennial';
  if (year >= 1965) return 'Gen X';
  return 'Boomer';
}

// Matches users.ts's ARCHETYPE_NAME_TO_KEY — quiz/session data carries the display
// name (`archetype.name`), but action links and the dial-position table both key
// off archetype_enum. Duplicated locally per this codebase's existing per-route
// lookup-map convention (see users.ts's own ARCHETYPES/ARCHETYPE_NAME_TO_KEY).
const ARCHETYPE_NAME_TO_KEY: Record<string, string> = {
  'Chocolate & Nutty': 'chocolate_nutty',
  'Balanced & Sweet':  'balanced_sweet',
  'Fruity':            'fruity',
  'Earthy':            'earthy',
  'Floral':            'floral',
  'Experimental':      'experimental',
};

type SommelierAction = { type: 'retake_quiz' } | { type: 'open_dial'; archetype: string; slot?: number };

// Liam action links, Phase B — resolve <<action:...>> markers into real, server-
// verified payloads. Never trusts the LLM for ids: retake_quiz needs nothing, and
// open_dial's archetype comes from session context (already resolved from the
// user's own quiz record), with the slot looked up from their saved dial position
// if any — omitted (not guessed) when they have none.
async function resolveActions(
  actionTypes: string[],
  uid: string,
  archetypeKey: string | null
): Promise<SommelierAction[]> {
  const actions: SommelierAction[] = [];
  for (const type of actionTypes) {
    if (type === 'retake_quiz') {
      actions.push({ type: 'retake_quiz' });
    } else if (type === 'open_dial' && archetypeKey) {
      let slot: number | undefined;
      try {
        const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
        const profileId = profileResult.rows[0]?.id;
        if (profileId) {
          const posResult = await db.query(
            `SELECT dial_sort_order FROM user_bloom_dial_current_position WHERE user_id = $1 AND archetype = $2`,
            [profileId, archetypeKey]
          );
          slot = posResult.rows[0]?.dial_sort_order ?? undefined;
        }
      } catch { /* no saved position — link still works, just lands on the default slot */ }
      actions.push(slot != null ? { type: 'open_dial', archetype: archetypeKey, slot } : { type: 'open_dial', archetype: archetypeKey });
    }
    // open_dial with no known archetype: nothing sensible to link to — omitted.
  }
  return actions;
}

// Liam Dial Event Log, Phase B — a compact, server-side summary of the customer's
// last ~30 *intentional* dial events (explicit_save / add_to_cart only — plain dial
// turns are never logged, so every event here is already meaningful). Summarized
// into a few fields per archetype, never dumped raw into the prompt.
async function getRecentDialActivitySummary(uid: string): Promise<string> {
  try {
    const snap = await firestoreDb
      .collection(`users/${uid}/dial_events`)
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();
    if (snap.empty) return '';

    const byArchetype: Record<string, { saveCount: number; cartCount: number; latestSortOrder: number | null; latestTrigger: string }> = {};
    for (const doc of snap.docs) {
      const d = doc.data();
      const archetype = d.archetype as string;
      if (!archetype) continue;
      const entry = byArchetype[archetype] ??= { saveCount: 0, cartCount: 0, latestSortOrder: null, latestTrigger: '' };
      if (d.trigger === 'explicit_save') entry.saveCount++;
      if (d.trigger === 'add_to_cart') entry.cartCount++;
      if (entry.latestSortOrder === null) { entry.latestSortOrder = d.dialSortOrder; entry.latestTrigger = d.trigger; }
    }

    return Object.entries(byArchetype)
      .map(([archetype, e]) =>
        `${archetype}: latest position ${e.latestSortOrder} (${e.latestTrigger === 'add_to_cart' ? 'from a cart add' : 'explicitly saved'}), ${e.saveCount} save(s) and ${e.cartCount} cart add(s) recently`
      )
      .join('; ');
  } catch {
    return ''; // no dial events — normal for most users, not an error
  }
}

const router = Router();

// ─── POST /api/sommelier/evaluate ────────────────────────────────────────────
router.post('/evaluate', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
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
router.post('/start', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
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
      `SELECT qs.context_data, ar.name AS archetype_name, up.date_of_birth
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
    const archetypeKey = userArchetype ? (ARCHETYPE_NAME_TO_KEY[userArchetype] ?? null) : null;

    const generation = getGeneration(latestQuiz?.date_of_birth ?? null);
    let enrichedOpeningContext = (openingContext ?? '') +
      `\nCustomer generation: ${generation}. Adjust register accordingly (see tone guidelines in your instructions).`;

    // Liam Dial Event Log, Phase B — only for the intents where the addendum
    // actually invites Liam to reference it (PROFILE_AMBIGUOUS, EXPLORATION).
    if (intent === 'EXPLORATION' || intent === 'PROFILE_AMBIGUOUS') {
      const recentDialActivity = await getRecentDialActivitySummary(req.uid!);
      if (recentDialActivity) {
        enrichedOpeningContext += `\nRecent dial activity: ${recentDialActivity}.`;
      }
    }

    // Determine excludeCoffeeIds for RECOMMENDATION_MISS
    let excludeCoffeeIds: number[] = [];
    if (intent === 'RECOMMENDATION_MISS') {
      try {
        // No `.limit(10)` before filtering — a revised (now-superseded) negative
        // event must not keep excluding a coffee the customer no longer feels
        // negatively about (Profile Part 5).
        const feedbackSnap = await firestoreDb
          .collection(`users/${req.uid}/feedback_events`)
          .where('sentiment', '==', 'negative')
          .orderBy('createdAt', 'desc')
          .get();
        excludeCoffeeIds = feedbackSnap.docs
          .filter(d => !d.data().supersededAt)
          .slice(0, 10)
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
          archetypeKey,
          tiedArchetypes: tiedArchetypes ?? [],
          openingContext: enrichedOpeningContext,
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
    let openingActionTypes: string[] = [];
    try {
      const chatResult = await chatWithSommelier({
        message: null,
        session: { intent, turnCount: 0, openingContext: enrichedOpeningContext },
        catalogContext: ragResult.catalogText,
        history: [],
      });
      openingMessage = chatResult.reply;
      modelUsed = chatResult.modelUsed;
      openingActionTypes = chatResult.actionTypes;
    } catch (claudeErr) {
      console.error('[sommelier/start] chatWithSommelier failed, using fallback:', claudeErr);
    }
    // The prompt instructs Liam never to use a marker on the opening turn, but
    // resolve defensively anyway rather than assuming the instruction always holds.
    const openingActions = await resolveActions(openingActionTypes, req.uid!, archetypeKey);

    // Save opening message to Firestore
    await firestoreDb
      .collection(`users/${req.uid}/sommelier_sessions/${newSessionId}/messages`)
      .add({
        role: 'assistant',
        content: openingMessage,
        modelUsed,
        seq: 0,
        actions: openingActions,
        createdAt: FieldValue.serverTimestamp(),
      });

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
      openingActions,
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
router.post('/:sessionId/message', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
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

    // Save user message to Firestore (keep ref for rollback on token fail)
    const messagesCol = firestoreDb.collection(`users/${req.uid}/sommelier_sessions/${sessionId}/messages`);
    const userMsgRef = messagesCol.doc();
    await userMsgRef.set({
      role: 'user',
      content: message,
      seq: session.turn_count * 2 - 1,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Fetch conversation history from Firestore for Claude context
    const historySnap = await messagesCol.orderBy('seq').get();
    const history = historySnap.docs
      .slice(0, -1) // exclude the user message just inserted
      .map(d => ({
        role: d.data().role as 'user' | 'assistant',
        content: d.data().content as string,
      }));

    // Spend token
    const spendResult = await spendToken(req.uid!, 'sommelier_turn', String(sessionId));
    if (!spendResult.success) {
      await userMsgRef.delete();
      res.status(402).json({ error: 'insufficient_tokens', balance: spendResult.newBalance });
      return;
    }

    // Generate reply
    const ctx = session.context_data ?? {};

    // Turn-level topic routing (§4.1, HOME_TASK_2) — classifies this message,
    // carrying the previous turn's topic forward (stickiness) until it decays.
    const topicResult = routeTopic(message, {
      currentTopic: ctx.currentTopic ?? null,
      turnsSinceMatch: ctx.currentTopicTurnsSinceMatch ?? 0,
    });
    const topicLogEntry = {
      turn: session.turn_count,
      topic: topicResult.topic,
      confidence: topicResult.confidence,
      matchedKeyword: topicResult.matchedKeyword,
      sticky: topicResult.sticky,
    };
    const topicLog = Array.isArray(ctx.topicLog) ? [...ctx.topicLog, topicLogEntry] : [topicLogEntry];

    const { reply, modelUsed, actionTypes } = await chatWithSommelier({
      message,
      session: {
        intent: session.intent,
        turnCount: session.turn_count,
        openingContext: ctx.openingContext ?? '',
      },
      catalogContext: ctx.catalogText ?? '',
      history,
      mode: topicResult.mode,
    });
    const actions = await resolveActions(actionTypes, req.uid!, ctx.archetypeKey ?? null);

    const newTurnCount = session.turn_count + 1;
    const shouldClose = newTurnCount >= maxTurns;

    // Updated context_data — carries the topic router's state forward so the
    // next turn's stickiness/decay is correct, and keeps the topic log (the
    // §4.10 ML dataset / §7 topic-distribution metric) growing across turns.
    const updatedContextData = {
      ...ctx,
      currentTopic: topicResult.topic,
      currentTopicTurnsSinceMatch: topicResult.turnsSinceMatch,
      topicLog,
    };

    // Update session
    await db.query(
      `UPDATE sommelier_sessions
       SET turn_count = $2, last_active_at = NOW(),
           is_closed = $3, close_reason = $4, context_data = $5
       WHERE id = $1`,
      [sessionId, newTurnCount, shouldClose, shouldClose ? 'turn_limit' : null, JSON.stringify(updatedContextData)]
    );

    // Save assistant reply to Firestore
    await messagesCol.add({
      role: 'assistant',
      content: reply,
      modelUsed,
      seq: session.turn_count * 2,
      actions,
      createdAt: FieldValue.serverTimestamp(),
    });

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
      actions,
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
router.get('/sessions', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
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

// ─── GET /api/sommelier/:sessionId/messages ──────────────────────────────────
router.get('/:sessionId/messages', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  try {
    const sessionResult = await db.query(
      'SELECT context_data FROM sommelier_sessions WHERE id = $1 AND uid = $2',
      [sessionId, req.uid]
    );
    if (!sessionResult.rows.length) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const ctx = sessionResult.rows[0].context_data ?? {};

    // Read messages from Firestore; fall back to SQL for sessions predating this migration
    const [firestoreSnap, coffeeNamesResult] = await Promise.all([
      firestoreDb
        .collection(`users/${req.uid}/sommelier_sessions/${sessionId}/messages`)
        .orderBy('seq')
        .get(),
      ctx.coffeeIds?.length
        ? db.query('SELECT name FROM coffees WHERE id = ANY($1::int[]) ORDER BY name', [ctx.coffeeIds])
        : Promise.resolve({ rows: [] as { name: string }[] }),
    ]);

    let messages: { role: string; content: string; actions?: SommelierAction[] }[];
    if (!firestoreSnap.empty) {
      messages = firestoreSnap.docs.map(d => ({
        role: d.data().role as string,
        content: d.data().content as string,
        actions: d.data().actions ?? undefined,
      }));
    } else {
      const sql = await db.query(
        `SELECT role, content FROM sommelier_messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );
      messages = sql.rows;
    }

    res.json({
      messages,
      coffeeNames: coffeeNamesResult.rows.map((r: { name: string }) => r.name),
    });
  } catch (err) {
    console.error('[sommelier/messages]', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ─── POST /api/sommelier/:sessionId/close ────────────────────────────────────
router.post('/:sessionId/close', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
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
