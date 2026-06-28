import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/client.js';
import { firestoreDb } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getSommelierConfig } from './sommelierConfig.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const FEATURE_SCHEMA = [
  'quizStability',
  'behavioralValidation',
  'dataDepth',
  'feedbackAlignment',
  'normalizedOrderCount',
  'normalizedDaysSinceQuiz',
  'normalizedQuizCount',
  'archetypeChangeFraction',
  'experimentalFlag',
  'quizTieFlag',
  'negativeFeedbackFlag',
  'foodMatchesPrimary',
  'foodMatchesSecondary',
] as const;

export type FeatureSchema = typeof FEATURE_SCHEMA;

export interface EvaluatorFlags {
  quizTie?: boolean;
  tiedArchetypes?: string[];
  userInitiated?: boolean;
  browsingSignal?: boolean;
}

interface UserStateSnapshot {
  archetype: string | null;
  secondaryArchetype: string | null;
  experimental: boolean;
  foodSignalAlignment: string;
  recommendationMode: string;
  quizCount: number;
  archetypeChangeCount: number;
  totalOrders: number;
  daysSinceLastQuiz: number | null;
  behavioralScore: number;
  behavioralLevel: string;
  hasRecentNegativeFeedback: boolean;
  capturedAt: string;
}

export interface EvaluatorResult {
  needsSommelier: boolean;
  intent: string | null;
  triggersFired: string[];
  openingContext: string | null;
  evaluationId: string | null;
  featureVector: number[];
  featureSchema: string[];
  userStateSnapshot: UserStateSnapshot;
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, v));
}

export async function evaluateSommelier(
  uid: string,
  flags: EvaluatorFlags
): Promise<EvaluatorResult> {
  const config = getSommelierConfig();
  const lookbackDays = config?.timeWindows?.negativeFeedbackLookback ?? 30;

  // ── Stage 1: Collect data ────────────────────────────────────────────────

  // Last 2 quiz sessions
  let quizSessions: any[] = [];
  try {
    const quizResult = await db.query(
      `SELECT qs.id, qs.context_data, qs.completed_at, ar.name AS archetype_name
       FROM quiz_session qs
       JOIN user_profile up ON up.id = qs.user_id
       LEFT JOIN archetype ar ON ar.id = qs.resulting_archetype_id
       WHERE up.firebase_uid = $1
       ORDER BY qs.completed_at DESC
       LIMIT 2`,
      [uid]
    );
    quizSessions = quizResult.rows;
  } catch (err) {
    console.error('[sommelierEvaluator] quiz sessions query failed:', err);
  }
  const latestQuiz = quizSessions[0] ?? null;
  const prevQuiz = quizSessions[1] ?? null;

  // All quiz sessions count + archetype change count
  let quizCount = quizSessions.length;
  let archetypeChangeCount = 0;
  try {
    const quizCountResult = await db.query(
      `SELECT COUNT(*) AS quiz_count
       FROM quiz_session qs
       JOIN user_profile up ON up.id = qs.user_id
       WHERE up.firebase_uid = $1`,
      [uid]
    );
    quizCount = Number(quizCountResult.rows[0]?.quiz_count ?? 0);

    const allQuizzesResult = await db.query(
      `SELECT ar.name AS archetype_name
       FROM quiz_session qs
       JOIN user_profile up ON up.id = qs.user_id
       LEFT JOIN archetype ar ON ar.id = qs.resulting_archetype_id
       WHERE up.firebase_uid = $1
       ORDER BY qs.completed_at ASC`,
      [uid]
    );
    for (let i = 1; i < allQuizzesResult.rows.length; i++) {
      if (allQuizzesResult.rows[i].archetype_name !== allQuizzesResult.rows[i - 1].archetype_name) {
        archetypeChangeCount++;
      }
    }
  } catch (err) {
    console.error('[sommelierEvaluator] quiz count/changes query failed:', err);
  }

  // Order count
  let totalOrders = 0;
  try {
    const orderResult = await db.query(
      `SELECT COUNT(DISTINCT o.id) AS order_count
       FROM "order" o
       JOIN user_profile up ON up.id = o.user_id
       WHERE up.firebase_uid = $1`,
      [uid]
    );
    totalOrders = Number(orderResult.rows[0]?.order_count ?? 0);
  } catch (err) {
    console.error('[sommelierEvaluator] order count query failed:', err);
  }

  // Behavioral confidence from Firestore (written by computeBehavioralConfidence)
  let behavioralScore = 0.5;
  let behavioralLevel = 'medium';
  let bcComponents = { quizStability: 0.5, behavioralValidation: 0.5, dataDepth: 0.5, feedbackAlignment: 0.5 };
  try {
    const confSnap = await firestoreDb.doc(`users/${uid}/confidence_profile`).get();
    if (confSnap.exists) {
      const data = confSnap.data()!;
      behavioralScore = data.score ?? 0.5;
      behavioralLevel = data.level ?? 'medium';
      bcComponents = {
        quizStability: data.components?.quizStability ?? 0.5,
        behavioralValidation: data.components?.behavioralValidation ?? 0.5,
        dataDepth: data.components?.dataDepth ?? 0.5,
        feedbackAlignment: data.components?.feedbackAlignment ?? 0.5,
      };
    }
  } catch { /* use defaults */ }

  // Negative feedback in lookback window
  let hasRecentNegativeFeedback = false;
  try {
    const lookbackDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const feedbackSnap = await firestoreDb
      .collection(`users/${uid}/feedback_events`)
      .where('createdAt', '>=', lookbackDate)
      .where('sentiment', '==', 'negative')
      .limit(1)
      .get();
    hasRecentNegativeFeedback = !feedbackSnap.empty;
  } catch { /* no feedback_events yet */ }

  // Extract context from latest quiz
  const latestCtx = latestQuiz?.context_data ?? {};
  const archetype = latestQuiz?.archetype_name ?? null;
  const secondaryArchetype = latestCtx.secondaryArchetype ?? null;
  const experimental = latestCtx.experimental ?? false;
  const foodSignalAlignment = latestCtx.foodSignalAlignment ?? 'high';
  const recommendationMode = latestCtx.recommendationMode ?? 'primary_only';
  const foodSignal = latestCtx.foodSignal ?? null;

  // Days since last quiz
  let daysSinceLastQuiz: number | null = null;
  if (latestQuiz?.completed_at) {
    daysSinceLastQuiz = Math.floor(
      (Date.now() - new Date(latestQuiz.completed_at).getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  // ── Build feature vector (13 dims) ──────────────────────────────────────
  const featureVector: number[] = [
    bcComponents.quizStability,
    bcComponents.behavioralValidation,
    bcComponents.dataDepth,
    bcComponents.feedbackAlignment,
    clamp(totalOrders / 10),
    clamp((daysSinceLastQuiz ?? 30) / 30),
    clamp(quizCount / 5),
    quizCount > 0 ? clamp(archetypeChangeCount / quizCount) : 0,
    experimental ? 1 : 0,
    flags.quizTie ? 1 : 0,
    hasRecentNegativeFeedback ? 1 : 0,
    foodSignal && archetype && foodSignal === archetype ? 1 : 0,
    foodSignal && secondaryArchetype && foodSignal === secondaryArchetype ? 1 : 0,
  ];

  const userStateSnapshot: UserStateSnapshot = {
    archetype,
    secondaryArchetype,
    experimental,
    foodSignalAlignment,
    recommendationMode,
    quizCount,
    archetypeChangeCount,
    totalOrders,
    daysSinceLastQuiz,
    behavioralScore,
    behavioralLevel,
    hasRecentNegativeFeedback,
    capturedAt: new Date().toISOString(),
  };

  // ── Rule evaluation ──────────────────────────────────────────────────────
  const priority: string[] = config?.evaluatorRulePriority ?? [
    'DISCOVERY_SEEKER',
    'PROFILE_AMBIGUOUS',
    'TASTE_EVOLUTION',
    'RECOMMENDATION_MISS',
    'CONVERSION',
    'EXPLORATION',
  ];

  const triggersFired: string[] = [];
  let matchedIntent: string | null = null;

  const ruleChecks: Record<string, () => boolean> = {
    DISCOVERY_SEEKER: () => experimental === true,
    PROFILE_AMBIGUOUS: () =>
      flags.quizTie === true ||
      recommendationMode === 'ai_agent' ||
      foodSignalAlignment === 'low',
    TASTE_EVOLUTION: () =>
      quizSessions.length >= 2 &&
      !!prevQuiz &&
      latestQuiz?.archetype_name !== prevQuiz?.archetype_name,
    RECOMMENDATION_MISS: () => hasRecentNegativeFeedback,
    CONVERSION: () => behavioralLevel !== 'low' && totalOrders === 0,
    EXPLORATION: () => flags.userInitiated === true || flags.browsingSignal === true,
  };

  for (const intentName of priority) {
    const intentConfig = config?.intents?.[intentName];
    if (intentConfig && !intentConfig.active) continue;
    const check = ruleChecks[intentName];
    if (check && check()) {
      triggersFired.push(intentName);
      if (!matchedIntent) matchedIntent = intentName;
    }
  }

  if (!matchedIntent) {
    return {
      needsSommelier: false,
      intent: null,
      triggersFired,
      openingContext: null,
      evaluationId: null,
      featureVector,
      featureSchema: [...FEATURE_SCHEMA],
      userStateSnapshot,
    };
  }

  // ── Stage 2: Haiku enrichment ────────────────────────────────────────────
  const intentCfg = config?.intents?.[matchedIntent];
  const userPrompt = `Initialize a coffee sommelier session. Write 1-2 sentences briefing Liam (the sommelier) about this specific user before their first exchange. Be factual and specific.

Intent: ${matchedIntent}
Goal: ${intentCfg?.conversationGoal ?? 'Guide the user to a coffee they will love'}
Archetype: ${archetype ?? 'Unknown'}, Secondary: ${secondaryArchetype ?? 'none'}
Behavioral confidence: ${behavioralLevel} (score: ${behavioralScore.toFixed(2)})
Experimental: ${experimental}
Quiz count: ${quizCount}, Archetype changes: ${archetypeChangeCount}
Order count: ${totalOrders}
Recent negative feedback: ${hasRecentNegativeFeedback ? 'yes' : 'no'}
Days since last quiz: ${daysSinceLastQuiz !== null ? daysSinceLastQuiz : 'first quiz'}

Write only the briefing.`;

  let openingContext = `${archetype ?? 'Unknown archetype'} user — ${matchedIntent} intent.`;
  try {
    const haikuResp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: 'You generate concise briefings. Respond with only the briefing text, no preamble.',
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = haikuResp.content[0];
    if (block.type === 'text') openingContext = block.text;
  } catch (err) {
    console.error('[sommelierEvaluator] Haiku Stage 2 error:', err);
  }

  // ── Stage 3: Write evaluation to Firestore ───────────────────────────────
  let evaluationId: string | null = null;
  try {
    const evalDoc = await firestoreDb
      .collection(`users/${uid}/sommelier_evaluations`)
      .add({
        intent: matchedIntent,
        triggersFired,
        needsSommelier: true,
        sessionStarted: false,
        startedAt: null,
        featureVector,
        featureSchema: [...FEATURE_SCHEMA],
        userStateSnapshot,
        openingContext,
        outcome: {
          sessionCompleted: null,
          turnsUsed: null,
          tokensSpent: null,
          orderedWithin7Days: null,
          orderedWithin30Days: null,
          feedbackAfterSession: null,
          returnedToSommelier: null,
          outcomeUpdatedAt: null,
        },
        createdAt: FieldValue.serverTimestamp(),
      });
    evaluationId = evalDoc.id;
  } catch (err) {
    console.error('[sommelierEvaluator] Firestore write error:', err);
  }

  return {
    needsSommelier: true,
    intent: matchedIntent,
    triggersFired,
    openingContext,
    evaluationId,
    featureVector,
    featureSchema: [...FEATURE_SCHEMA],
    userStateSnapshot,
  };
}
