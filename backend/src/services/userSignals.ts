import { db } from '../db/client.js';
import { firestoreDb } from './firebase-admin.js';

// ── getUserSignals() ──────────────────────────────────────────────────────────
// Single shared collector of the raw, re-derivable facts about a user — quiz
// history, order history, behavioral confidence, feedback, demographics.
// Two independent consumers read this: sommelierEvaluator.ts (Firestore-scoped
// Intent classification) and userLifecycle.ts (Cloud-SQL-scoped lifecycle
// classification). Neither reads the other's output — this function is the only
// thing they share. See WHAT_WE_BUILT.md for why the two systems are kept apart.

export interface OrderSignal {
  id: string;
  createdAt: Date;
  hasFeedback: boolean;
  blendId: string | null;
}

export interface UserSignals {
  userId: string | null;         // user_profile.id (UUID) — null if profile row doesn't exist yet
  firebaseUid: string;

  // Quiz
  archetype: string | null;
  secondaryArchetype: string | null;
  foodSignal: string | null;
  experimental: boolean;
  foodSignalAlignment: string;
  recommendationMode: string;
  quizCount: number;
  archetypeChangeCount: number;              // changes across full quiz history
  archetypeChangedLastTwoQuizzes: boolean;    // Sommelier's TASTE_EVOLUTION trigger — last two sessions only
  daysSinceLastQuiz: number | null;
  lastQuizCompletedAt: Date | null;

  // Orders — ascending by createdAt
  orders: OrderSignal[];
  totalOrders: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  averageOrderGapDays: number | null;         // mean days between consecutive orders (needs 2+ orders)

  // Behavioral confidence (Firestore, written by computeBehavioralConfidence)
  behavioralScore: number;
  behavioralLevel: string;
  behavioralComponents: {
    quizStability: number;
    behavioralValidation: number;
    dataDepth: number;
    feedbackAlignment: number;
  };

  // Feedback
  hasRecentNegativeFeedback: boolean;         // any negative feedback within the Sommelier's lookback window
  oldestOrderMissingFeedback: OrderSignal | null;

  // Subscription
  hasActiveSubscription: boolean;

  // Company Gift sponsorship — see backend/src/features/b2b_company_subscriptions.
  // Matched on subscription.user_id directly, never household_id: a sponsored seat
  // is individual by design (decision #6/#9 in the task spec — no cross-household or
  // cross-employee visibility).
  hasActiveSponsoredSubscription: boolean;
  sponsoredExpiresAt: Date | null;          // expiry of the current active sponsored sub, if any
  hasLapsedSponsoredSubscription: boolean;  // a sponsored sub expired and flipped to 'lapsed'

  // Demographics
  age: number | null;
  generation: string | null;
  householdType: 'solo' | 'family';

  capturedAt: string;
}

export async function getUserSignals(uid: string): Promise<UserSignals> {
  // ── user_profile.id ──────────────────────────────────────────────────────
  let userId: string | null = null;
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
    userId = profileResult.rows[0]?.id ?? null;
  } catch (err) {
    console.error('[userSignals] profile lookup failed:', err);
  }

  // ── Quiz sessions (full history, oldest first) ───────────────────────────
  let quizRows: Array<{ archetype_name: string | null; completed_at: string; context_data: any }> = [];
  try {
    const result = await db.query(
      `SELECT ar.name AS archetype_name, qs.completed_at, qs.context_data
       FROM quiz_session qs
       JOIN user_profile up ON up.id = qs.user_id
       LEFT JOIN archetype ar ON ar.id = qs.resulting_archetype_id
       WHERE up.firebase_uid = $1
       ORDER BY qs.completed_at ASC`,
      [uid]
    );
    quizRows = result.rows;
  } catch (err) {
    console.error('[userSignals] quiz sessions query failed:', err);
  }

  const quizCount = quizRows.length;
  let archetypeChangeCount = 0;
  for (let i = 1; i < quizRows.length; i++) {
    if (quizRows[i].archetype_name !== quizRows[i - 1].archetype_name) archetypeChangeCount++;
  }

  const latestQuiz = quizRows[quizRows.length - 1] ?? null;
  const prevQuiz = quizRows[quizRows.length - 2] ?? null;
  const archetypeChangedLastTwoQuizzes =
    quizRows.length >= 2 && !!prevQuiz && latestQuiz?.archetype_name !== prevQuiz?.archetype_name;

  const latestCtx = latestQuiz?.context_data ?? {};
  const archetype = latestQuiz?.archetype_name ?? null;
  const secondaryArchetype = latestCtx.secondaryArchetype ?? null;
  const foodSignal = latestCtx.foodSignal ?? null;
  const experimental = latestCtx.experimental ?? false;
  const foodSignalAlignment = latestCtx.foodSignalAlignment ?? 'high';
  const recommendationMode = latestCtx.recommendationMode ?? 'primary_only';

  const lastQuizCompletedAt = latestQuiz?.completed_at ? new Date(latestQuiz.completed_at) : null;
  const daysSinceLastQuiz = lastQuizCompletedAt
    ? Math.floor((Date.now() - lastQuizCompletedAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // ── Orders (ascending by createdAt) ──────────────────────────────────────
  let orderRows: Array<{ id: string; created_at: string; blend_id: string | null }> = [];
  try {
    const result = await db.query(
      `SELECT o.id, o.created_at, (ARRAY_AGG(oli.blend_id))[1] AS blend_id
       FROM "order" o
       JOIN user_profile up ON up.id = o.user_id
       LEFT JOIN order_line_item oli ON oli.order_id = o.id
       WHERE up.firebase_uid = $1
       GROUP BY o.id, o.created_at
       ORDER BY o.created_at ASC`,
      [uid]
    );
    orderRows = result.rows;
  } catch (err) {
    console.error('[userSignals] order query failed:', err);
  }

  // Which of this user's orders already have a feedback_events doc (any source/channel).
  let orderIdsWithFeedback = new Set<string>();
  try {
    const feedbackSnap = await firestoreDb.collection(`users/${uid}/feedback_events`).get();
    for (const doc of feedbackSnap.docs) {
      const orderId = doc.data().orderId;
      if (orderId) orderIdsWithFeedback.add(orderId);
    }
  } catch {
    // Subcollection may not exist yet — treat as no feedback captured
  }

  const orders: OrderSignal[] = orderRows.map(o => ({
    id: o.id,
    createdAt: new Date(o.created_at),
    hasFeedback: orderIdsWithFeedback.has(o.id),
    blendId: o.blend_id ?? null,
  }));

  const totalOrders = orders.length;
  const firstOrderAt = orders[0]?.createdAt ?? null;
  const lastOrderAt = orders[orders.length - 1]?.createdAt ?? null;

  let averageOrderGapDays: number | null = null;
  if (orders.length >= 2) {
    const totalGapDays = (lastOrderAt!.getTime() - firstOrderAt!.getTime()) / (1000 * 60 * 60 * 24);
    averageOrderGapDays = totalGapDays / (orders.length - 1);
  }

  const oldestOrderMissingFeedback = orders.find(o => !o.hasFeedback) ?? null;

  // ── Behavioral confidence (Firestore, written by computeBehavioralConfidence) ──
  let behavioralScore = 0.5;
  let behavioralLevel = 'medium';
  let behavioralComponents = { quizStability: 0.5, behavioralValidation: 0.5, dataDepth: 0.5, feedbackAlignment: 0.5 };
  try {
    const confSnap = await firestoreDb.doc(`users/${uid}/metadata/confidence_profile`).get();
    if (confSnap.exists) {
      const data = confSnap.data()!;
      behavioralScore = data.score ?? 0.5;
      behavioralLevel = data.level ?? 'medium';
      behavioralComponents = {
        quizStability: data.components?.quizStability ?? 0.5,
        behavioralValidation: data.components?.behavioralValidation ?? 0.5,
        dataDepth: data.components?.dataDepth ?? 0.5,
        feedbackAlignment: data.components?.feedbackAlignment ?? 0.5,
      };
    }
  } catch { /* use defaults */ }

  // ── Negative feedback in lookback window ─────────────────────────────────
  let hasRecentNegativeFeedback = false;
  try {
    const { getSommelierConfig } = await import('./sommelierConfig.js');
    const lookbackDays = getSommelierConfig()?.timeWindows?.negativeFeedbackLookback ?? 30;
    const lookbackDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    // No `.limit(1)` — a revised (now-superseded) negative event must not count,
    // so we need enough rows to find a non-superseded one (Profile Part 5).
    const feedbackSnap = await firestoreDb
      .collection(`users/${uid}/feedback_events`)
      .where('createdAt', '>=', lookbackDate)
      .where('sentiment', '==', 'negative')
      .get();
    hasRecentNegativeFeedback = feedbackSnap.docs.some(d => !d.data().supersededAt);
  } catch { /* no feedback_events yet */ }

  // ── Active subscription ──────────────────────────────────────────────────
  let hasActiveSubscription = false;
  try {
    const subResult = await db.query(
      `SELECT 1
       FROM subscription s
       JOIN user_profile up ON (up.id = s.user_id OR up.household_id = s.household_id)
       WHERE up.firebase_uid = $1 AND s.status = 'active'
       LIMIT 1`,
      [uid]
    );
    hasActiveSubscription = subResult.rows.length > 0;
  } catch (err) {
    console.error('[userSignals] subscription query failed:', err);
  }

  // ── Company Gift sponsorship ──────────────────────────────────────────────
  let hasActiveSponsoredSubscription = false;
  let sponsoredExpiresAt: Date | null = null;
  let hasLapsedSponsoredSubscription = false;
  try {
    const sponsoredResult = await db.query(
      `SELECT s.status, s.sponsored_expires_at
       FROM subscription s
       JOIN user_profile up ON up.id = s.user_id
       WHERE up.firebase_uid = $1 AND s.company_gift_id IS NOT NULL`,
      [uid]
    );
    hasActiveSponsoredSubscription = sponsoredResult.rows.some((r: any) => r.status === 'active');
    const activeRow = sponsoredResult.rows.find((r: any) => r.status === 'active');
    sponsoredExpiresAt = activeRow?.sponsored_expires_at ? new Date(activeRow.sponsored_expires_at) : null;
    hasLapsedSponsoredSubscription = sponsoredResult.rows.some((r: any) => r.status === 'lapsed');
  } catch (err) {
    console.error('[userSignals] sponsored subscription query failed:', err);
  }

  // ── Demographics ──────────────────────────────────────────────────────────
  let age: number | null = null;
  let generation: string | null = null;
  let householdType: 'solo' | 'family' = 'solo';
  try {
    const profileResult = await db.query(
      `SELECT up.date_of_birth, up.household_id,
              (SELECT COUNT(*) FROM user_profile up2 WHERE up2.household_id = up.household_id) AS household_size
       FROM user_profile up WHERE up.firebase_uid = $1`,
      [uid]
    );
    const profile = profileResult.rows[0];
    if (profile?.date_of_birth) {
      const dob = new Date(profile.date_of_birth);
      const now = new Date();
      age = now.getFullYear() - dob.getFullYear() -
        (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
      if (age >= 62) generation = 'Boomer';
      else if (age >= 46) generation = 'Gen X';
      else if (age >= 30) generation = 'Millennial';
      else generation = 'Gen Z';
    }
    const householdSize = Number(profile?.household_size ?? 1);
    if (profile?.household_id && householdSize > 1) householdType = 'family';
  } catch (err) {
    console.error('[userSignals] demographic query failed:', err);
  }

  return {
    userId,
    firebaseUid: uid,
    archetype,
    secondaryArchetype,
    foodSignal,
    experimental,
    foodSignalAlignment,
    recommendationMode,
    quizCount,
    archetypeChangeCount,
    archetypeChangedLastTwoQuizzes,
    daysSinceLastQuiz,
    lastQuizCompletedAt,
    orders,
    totalOrders,
    firstOrderAt,
    lastOrderAt,
    averageOrderGapDays,
    behavioralScore,
    behavioralLevel,
    behavioralComponents,
    hasRecentNegativeFeedback,
    oldestOrderMissingFeedback,
    hasActiveSubscription,
    hasActiveSponsoredSubscription,
    sponsoredExpiresAt,
    hasLapsedSponsoredSubscription,
    age,
    generation,
    householdType,
    capturedAt: new Date().toISOString(),
  };
}
