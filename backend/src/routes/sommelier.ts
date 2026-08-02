import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { computeBehavioralConfidence } from '../services/behavioralConfidence.js';
import { evaluateSommelier } from '../services/sommelierEvaluator.js';
import { fetchSommelierCoffees } from '../services/sommelierRag.js';
import { getTokenBalance, spendToken, logUsage } from '../services/tokenService.js';
import { checkDailyCap, checkMonthlySpendAndAlert } from '../services/sommelierGuards.js';
import { writeOutcome, checkReturnedToSommelier } from '../services/outcomeTracker.js';
import { chatWithSommelier } from '../services/claude.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';
import { routeTopic } from '../services/topicRouter.js';
import {
  getBrewProfileFieldsConfig,
  validateSingleValue,
  incrementBrewProfileCounter,
  formatBrewProfileSummary,
  getStaleFieldNudge,
  normalizeFieldName,
  type BrewProfileDoc,
} from '../services/brewProfile.js';

// HOME_TASK_3 (§4.8) — per-IP and per-account rate limiting on the two turn-
// generating endpoints. Thresholds read live config per request (the `max`
// option accepts a function in express-rate-limit v7), same no-deploy-tuning
// pattern as the rest of config/sommelier; `windowMs` itself is fixed at 1
// minute. Cloud Run runs multiple instances, so this is a per-instance limit,
// not a global one — acceptable at this scale per the task spec; a shared
// store (e.g. Redis) would be the upgrade if that ever stops being true.
const sommelierIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (_req) => getSommelierConfig()?.guards?.rateLimits?.perIpPerMinute ?? 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — please slow down.' },
});
const sommelierAccountLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (_req) => getSommelierConfig()?.guards?.rateLimits?.perAccountPerMinute ?? 15,
  keyGenerator: (req: AuthRequest) => req.uid ?? req.ip ?? 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — please slow down.' },
});

// HOME_TASK_3 — a hard rule, not a model decision (S33: "hard rules belong in
// code, not the prompt"), so the daily-cap close is a fixed line in Liam's
// established voice rather than a live model call. Never mentions the words
// "cap"/"limit" — reads as a natural, warm pause, per S32-S34's voice rules.
const DAILY_CAP_CLOSE_MESSAGE = "That's a good amount of ground for today — let's pick this back up tomorrow.";

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

type SommelierAction =
  | { type: 'retake_quiz' }
  | { type: 'open_dial'; archetype: string; slot?: number }
  // Profile Part 7 Task 5 — no payload: this is user-initiated (the customer
  // taps the chip), the LLM only marks that an offer is appropriate. The
  // actual write is a separate, validated endpoint the LLM never touches.
  | { type: 'save_recipe' };

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
    } else if (type === 'save_recipe') {
      actions.push({ type: 'save_recipe' });
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

// HOME_TASK_4 (§4.5) — one Firestore read of the brew profile, shared by both
// the summary-for-the-prompt path and resolveRemember()'s existing-array read.
// Not cached in context_data (unlike catalogText) because a fact captured
// earlier in *this same* conversation must be reflected on the very next turn.
export async function getBrewProfile(uid: string): Promise<BrewProfileDoc | null> {
  try {
    const snap = await firestoreDb.doc(`users/${uid}/metadata/brew_profile`).get();
    return snap.exists ? (snap.data() as BrewProfileDoc) : null;
  } catch (err) {
    console.error('[brewProfile] read failed', err);
    return null;
  }
}

// Liam memory, Phase 1 (§4.5) — resolves <<remember:...>> markers into a
// validated, whitelisted Firestore write. Never trusts the model's field or
// value text directly (same discipline as resolveActions()): an unknown
// field or a value outside the whitelist is dropped and logged, not written.
// Write rule 3: every attempt — success or failure — increments an
// admin-visible counter, never a silent fire-and-forget.
export async function resolveRemember(uid: string, rememberOps: Array<{ field: string; rawValue: string }>): Promise<void> {
  if (!rememberOps.length) return;
  const fieldsCfg = getBrewProfileFieldsConfig();
  const docRef = firestoreDb.doc(`users/${uid}/metadata/brew_profile`);

  let current: BrewProfileDoc = {};
  try {
    const snap = await docRef.get();
    current = snap.exists ? (snap.data() as BrewProfileDoc) : {};
  } catch (err) {
    console.error('[resolveRemember] read failed', err);
  }

  const updates: Record<string, unknown> = {};
  let anyValid = false;

  for (const rawOp of rememberOps) {
    // Defense-in-depth: a plausible singular/plural near-miss (e.g. the model
    // saying "brew_method" for "brew_methods") is normalized before whitelist
    // lookup — see normalizeFieldName()'s own comment for why this exists.
    const field = normalizeFieldName(rawOp.field);
    const fieldCfg = fieldsCfg[field];
    if (!fieldCfg) {
      console.warn(`[resolveRemember] unknown field "${rawOp.field}" dropped for uid=${uid}`);
      await incrementBrewProfileCounter('failures');
      continue;
    }
    const validated = validateSingleValue(fieldCfg, rawOp.rawValue);
    if (validated === null) {
      console.warn(`[resolveRemember] invalid value for "${field}": "${rawOp.rawValue}" dropped for uid=${uid}`);
      await incrementBrewProfileCounter('failures');
      continue;
    }

    if (fieldCfg.type === 'array' || fieldCfg.type === 'array_freeform') {
      const existingArr = Array.isArray(current[field]?.value) ? (current[field]!.value as string[]) : [];
      if (existingArr.includes(validated as string)) continue; // already known — nothing new to write
      const maxLen = fieldCfg.maxLength ?? 10;
      const nextArr = [...existingArr, validated as string].slice(-maxLen);
      updates[field] = { value: nextArr, source: 'conversation', capturedAt: FieldValue.serverTimestamp() };
    } else {
      updates[field] = { value: validated, source: 'conversation', capturedAt: FieldValue.serverTimestamp() };
    }
    anyValid = true;
  }

  if (!anyValid) return;

  try {
    await docRef.set({ ...updates, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await incrementBrewProfileCounter('writes');
  } catch (err) {
    console.error('[resolveRemember] write failed', err);
    await incrementBrewProfileCounter('failures');
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
router.post('/start', sommelierIpLimiter, requireAuth, blockAnonymousAuth, sommelierAccountLimiter, async (req: AuthRequest, res) => {
  const { intent, openingContext, evaluationId, tiedArchetypes } = req.body;
  if (!intent) { res.status(400).json({ error: 'intent required' }); return; }

  const config = getSommelierConfig();
  const gatingEnabled = config?.tokenEconomy?.gatingEnabled ?? false;
  const costPerTurn = config?.tokenEconomy?.costPerTurn ?? 1;
  const maxTurns = config?.intents?.[intent]?.maxTurns ?? config?.sessionLimits?.maxTurns ?? 8;
  const resumeWindowHours = config?.timeWindows?.sessionResumeWindowHours ?? 24;

  try {
    // Token check — only when the meter is gating (§5: off by default; the
    // schema/rollback lever stays, nothing customer-facing depends on it).
    if (gatingEnabled) {
      const balance = await getTokenBalance(req.uid!);
      if (balance < costPerTurn) {
        res.status(402).json({
          error: 'insufficient_tokens',
          balance,
          message: 'You need at least 1 token to start a conversation with Liam.',
        });
        return;
      }
    }

    // Daily turn cap (§4.8) — checked before starting a new session so a
    // capped-out customer doesn't spend a real model call just to be told no.
    const capCheck = await checkDailyCap(req.uid!);
    if (capCheck.hit) {
      res.status(429).json({
        error: 'daily_cap_reached',
        message: DAILY_CAP_CLOSE_MESSAGE,
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

    // HOME_TASK_5 (§4.4) — cache published stories for this session's RAG-
    // selected coffees at session start, same "assembly-time only, no
    // re-query" principle Task 2 established for catalogText. Only entries
    // that actually have a published story are kept — a coffee lacking one
    // (no data yet, or generation never passed the specificity check) simply
    // isn't a candidate, no error.
    let storyCandidates: Array<{ coffeeId: number; story: string }> = [];
    if (ragResult.coffeeIds.length) {
      try {
        const storyResult = await db.query(
          `SELECT id, story FROM coffees WHERE id = ANY($1::int[]) AND story_published = true ORDER BY id`,
          [ragResult.coffeeIds]
        );
        storyCandidates = storyResult.rows.map((r: { id: number; story: string }) => ({ coffeeId: r.id, story: r.story }));
      } catch { /* no published stories yet for this catalog — fine */ }
    }

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
          storyCandidates,
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

    // Spend 1 token for the opening turn — only when gating is on. Ungated,
    // this is a real turn that still needs to count toward the guard layer's
    // accounting, just without a balance gate or a rollback path (nothing was
    // spent, so there's nothing to roll back if something downstream fails).
    let newBalance: number | null = null;
    if (gatingEnabled) {
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
      newBalance = spendResult.newBalance;
    }

    // Brew profile (§4.5, §3.5) — a compact customer-context line, injected
    // every turn including the opening one (not cached in context_data; see
    // getBrewProfile()'s own comment on why this stays a live read).
    const brewProfile = await getBrewProfile(req.uid!);
    const brewProfileContext = formatBrewProfileSummary(brewProfile);

    // Generate opening message (turn 0)
    let openingMessage = "Hi, I'm Liam — Axis & Bloom's coffee sommelier. What brings you here today?";
    let modelUsed = 'fallback';
    let openingActionTypes: string[] = [];
    let openingRememberOps: Array<{ field: string; rawValue: string }> = [];
    try {
      const chatResult = await chatWithSommelier({
        message: null,
        session: { intent, turnCount: 0, openingContext: enrichedOpeningContext },
        catalogContext: ragResult.catalogText,
        history: [],
        brewProfileContext,
      });
      openingMessage = chatResult.reply;
      modelUsed = chatResult.modelUsed;
      openingActionTypes = chatResult.actionTypes;
      openingRememberOps = chatResult.rememberOps;
    } catch (claudeErr) {
      console.error('[sommelier/start] chatWithSommelier failed, using fallback:', claudeErr);
    }

    if (!gatingEnabled) {
      logUsage(req.uid!, String(newSessionId), modelUsed).catch(() => {});
      checkMonthlySpendAndAlert(req.uid!).catch(() => {});
    }
    // The prompt instructs Liam never to use a marker on the opening turn, but
    // resolve defensively anyway rather than assuming the instruction always holds.
    const openingActions = await resolveActions(openingActionTypes, req.uid!, archetypeKey);
    await resolveRemember(req.uid!, openingRememberOps);

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
      // Kept for API back-compat (nothing customer-facing reads this — see
      // Sommelier.tsx, which no longer requests or renders a balance); null
      // when ungated rather than a real number that suggests spend happened.
      tokenBalance: newBalance,
      turnsRemaining: maxTurns - 1,
    });
  } catch (err) {
    console.error('[sommelier/start]', err);
    res.status(500).json({ error: 'Failed to start sommelier session' });
  }
});

// ─── POST /api/sommelier/:sessionId/message ───────────────────────────────────
router.post('/:sessionId/message', sommelierIpLimiter, requireAuth, blockAnonymousAuth, sommelierAccountLimiter, async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message required' });
    return;
  }

  const config = getSommelierConfig();
  const gatingEnabled = config?.tokenEconomy?.gatingEnabled ?? false;
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

    // Token check — only when the meter is gating (§5).
    if (gatingEnabled) {
      const balance = await getTokenBalance(req.uid!);
      if (balance < costPerTurn) {
        res.status(402).json({ error: 'insufficient_tokens', balance });
        return;
      }
    }

    // Daily turn cap (§4.8). Checked before generating a reply so a capped-out
    // turn never reaches the model — this is the "Liam-voiced session close"
    // the spec asks for, not a bare error: the user's message is still saved
    // (they did send it), Liam's fixed closing line is saved as the reply, and
    // the session ends the same way a normal turn-limit close would.
    const capCheck = await checkDailyCap(req.uid!);
    if (capCheck.hit) {
      const messagesColForClose = firestoreDb.collection(`users/${req.uid}/sommelier_sessions/${sessionId}/messages`);
      await messagesColForClose.doc().set({
        role: 'user',
        content: message,
        seq: session.turn_count * 2 - 1,
        createdAt: FieldValue.serverTimestamp(),
      });
      await messagesColForClose.add({
        role: 'assistant',
        content: DAILY_CAP_CLOSE_MESSAGE,
        modelUsed: 'guard',
        seq: session.turn_count * 2,
        actions: [],
        createdAt: FieldValue.serverTimestamp(),
      });
      await db.query(
        `UPDATE sommelier_sessions SET is_closed = true, close_reason = 'daily_cap', last_active_at = NOW() WHERE id = $1`,
        [sessionId]
      );
      res.json({
        reply: DAILY_CAP_CLOSE_MESSAGE,
        actions: [],
        turnCount: session.turn_count,
        sessionClosed: true,
        turnsRemaining: 0,
        tokenBalance: null,
        modelUsed: 'guard',
      });
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

    // Spend token — only when gating is on. Ungated, there's no balance to
    // check and therefore no rollback path: the user message just saved stays,
    // same as a normal turn.
    let newBalance: number | null = null;
    if (gatingEnabled) {
      const spendResult = await spendToken(req.uid!, 'sommelier_turn', String(sessionId));
      if (!spendResult.success) {
        await userMsgRef.delete();
        res.status(402).json({ error: 'insufficient_tokens', balance: spendResult.newBalance });
        return;
      }
      newBalance = spendResult.newBalance;
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

    // Brew profile (§4.5, §3.5) — live read every turn (see getBrewProfile()'s
    // comment), plus the stale-re-confirm nudge (write rule 5): at most once
    // per session (ctx.staleNudgeSent), only when relevant to this turn's topic.
    const brewProfile = await getBrewProfile(req.uid!);
    const staleNudge = getStaleFieldNudge(brewProfile, topicResult.topic, ctx.staleNudgeSent === true);
    const brewProfileContext = [formatBrewProfileSummary(brewProfile), staleNudge].filter(Boolean).join(' ');

    // Story layer (§4.4, HOME_TASK_5) — only on the two topics that ask about
    // the customer's own coffee. Uses whatever was cached in context_data at
    // session start (see the /start handler's own comment); no re-query, no
    // "current coffee" concept invented here (that's HOME_TASK_6's job).
    const isMyCoffeeTopic = topicResult.topic === 'my_coffee' || topicResult.topic === 'origins_process';
    const storyCandidates: Array<{ coffeeId: number; story: string }> = Array.isArray(ctx.storyCandidates) ? ctx.storyCandidates : [];
    const storyContext = isMyCoffeeTopic && storyCandidates.length > 0 ? storyCandidates[0].story : undefined;

    const { reply, modelUsed, actionTypes, rememberOps } = await chatWithSommelier({
      message,
      session: {
        intent: session.intent,
        turnCount: session.turn_count,
        openingContext: ctx.openingContext ?? '',
      },
      catalogContext: ctx.catalogText ?? '',
      history,
      mode: topicResult.mode,
      brewProfileContext,
      storyContext,
    });
    const actions = await resolveActions(actionTypes, req.uid!, ctx.archetypeKey ?? null);
    await resolveRemember(req.uid!, rememberOps);

    if (!gatingEnabled) {
      logUsage(req.uid!, String(sessionId), modelUsed).catch(() => {});
      checkMonthlySpendAndAlert(req.uid!).catch(() => {});
    }

    const newTurnCount = session.turn_count + 1;
    const shouldClose = newTurnCount >= maxTurns;

    // Updated context_data — carries the topic router's state forward so the
    // next turn's stickiness/decay is correct, and keeps the topic log (the
    // §4.10 ML dataset / §7 topic-distribution metric) growing across turns.
    // staleNudgeSent (write rule 5) latches true the first time a nudge is
    // used and never resets within the session — at most one per session.
    const updatedContextData = {
      ...ctx,
      currentTopic: topicResult.topic,
      currentTopicTurnsSinceMatch: topicResult.turnsSinceMatch,
      topicLog,
      staleNudgeSent: ctx.staleNudgeSent === true || !!staleNudge,
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
      // Kept for API back-compat — see the matching note in /start. null when
      // ungated; nothing customer-facing reads this anymore (Sommelier.tsx).
      tokenBalance: newBalance,
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
