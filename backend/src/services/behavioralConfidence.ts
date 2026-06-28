import { db } from '../db/client.js';
import { firestoreDb } from './firebase-admin.js';
import { getSommelierConfig } from './sommelierConfig.js';

export interface BehavioralConfidenceResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  components: {
    quizStability: number;
    behavioralValidation: number;
    dataDepth: number;
    feedbackAlignment: number;
  };
  rawInputs: {
    quizCount: number;
    archetypeChangeCount: number;
    totalOrders: number;
    matchedOrders: number;
    feedbackEventCount: number;
    negativeFeedbackFlag: boolean;
  };
}

export async function computeBehavioralConfidence(uid: string): Promise<BehavioralConfidenceResult> {
  const config = getSommelierConfig();
  const weights = config?.confidenceWeights ?? {
    quizStability: 0.30, behavioralValidation: 0.40, dataDepth: 0.20, feedbackAlignment: 0.10,
  };
  const thresholds = config?.confidenceThresholds ?? { medium: 0.40, high: 0.70 };
  const negativeFeedbackWindow = config?.timeWindows?.negativeFeedbackLookback ?? 60;

  // ── 1. SQL: quiz sessions ────────────────────────────────────────────────────
  let quizRows: { rows: Array<{ archetype_name: string | null; completed_at: string }> } = { rows: [] };
  try {
    quizRows = await db.query(
      `SELECT qs.id, ar.name AS archetype_name, qs.completed_at
       FROM quiz_session qs
       JOIN user_profile up ON up.id = qs.user_id
       LEFT JOIN archetype ar ON ar.id = qs.resulting_archetype_id
       WHERE up.firebase_uid = $1
       ORDER BY qs.completed_at DESC`,
      [uid]
    );
  } catch (err) {
    console.error('[behavioralConfidence] quiz query failed:', err);
  }
  const quizCount = quizRows.rows.length;

  let archetypeChangeCount = 0;
  if (quizCount > 1) {
    for (let i = 0; i < quizRows.rows.length - 1; i++) {
      if (quizRows.rows[i].archetype_name !== quizRows.rows[i + 1].archetype_name) {
        archetypeChangeCount++;
      }
    }
  }
  const currentArchetype: string | null = quizRows.rows[0]?.archetype_name ?? null;

  // ── 2. SQL: orders (check archetype match via blend assignment) ──────────────
  let totalOrders = 0;
  let matchedOrders = 0;
  try {
    const orderRows = await db.query(
      `SELECT COUNT(DISTINCT o.id) AS total,
              COUNT(DISTINCT CASE WHEN a.name = $2 THEN o.id END) AS matched
       FROM "order" o
       JOIN user_profile up ON up.id = o.user_id
       LEFT JOIN order_line_item oli ON oli.order_id = o.id
       LEFT JOIN roaster_blend rb ON rb.id = oli.blend_id
       LEFT JOIN archetype a ON a.id = rb.archetype_id
       WHERE up.firebase_uid = $1`,
      [uid, currentArchetype]
    );
    totalOrders   = parseInt(orderRows.rows[0]?.total ?? '0', 10);
    matchedOrders = parseInt(orderRows.rows[0]?.matched ?? '0', 10);
  } catch (err) {
    console.error('[behavioralConfidence] order query failed:', err);
  }

  // ── 3. Firestore: feedback_events (last 180 days) ────────────────────────────
  // Liam feedback is written to Firestore only — NOT read from SQL user_feedback_event.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 180);

  let feedbackDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const feedbackSnap = await firestoreDb
      .collection(`users/${uid}/feedback_events`)
      .where('createdAt', '>=', cutoff)
      .get();
    feedbackDocs = feedbackSnap.docs;
  } catch {
    // Subcollection may not exist yet — treat as zero events
  }

  const feedbackEventCount = feedbackDocs.length;

  // negativeFeedbackFlag: any event with sentiment = 'negative' in the last N days
  const negativeFeedbackCutoff = new Date();
  negativeFeedbackCutoff.setDate(negativeFeedbackCutoff.getDate() - negativeFeedbackWindow);
  const negativeFeedbackFlag = feedbackDocs.some(d => {
    const data = d.data();
    const createdAt = data.createdAt?.toDate?.() ?? new Date(0);
    return data.sentiment === 'negative' && createdAt >= negativeFeedbackCutoff;
  });

  const positiveFeedbackCount = feedbackDocs.filter(d => {
    const data = d.data();
    return typeof data.sValue === 'number' && data.sValue >= 0.6;
  }).length;

  // ── 4. Compute component scores ──────────────────────────────────────────────

  // quizStability: 1 quiz → 0.30; 2+ same archetype → 0.90; any change → 0.15
  const quizStability =
    quizCount === 0 ? 0.30
    : quizCount === 1 ? 0.30
    : archetypeChangeCount === 0 ? 0.90
    : 0.15;

  // behavioralValidation: 0 orders → 0.40 neutral; else archetype-matched / total
  const behavioralValidation =
    totalOrders === 0 ? 0.40
    : matchedOrders / totalOrders;

  // dataDepth: log scale over total interactions
  const totalInteractions = quizCount + totalOrders + feedbackEventCount;
  const dataDepth = Math.min(Math.log10(1 + totalInteractions) / Math.log10(20), 1.0);

  // feedbackAlignment: 0 events → 0.50 neutral; else positive-aligned / total
  const feedbackAlignment =
    feedbackEventCount === 0 ? 0.50
    : positiveFeedbackCount / feedbackEventCount;

  const components = { quizStability, behavioralValidation, dataDepth, feedbackAlignment };

  // ── 5. Weighted sum ──────────────────────────────────────────────────────────
  const score =
    quizStability       * weights.quizStability +
    behavioralValidation * weights.behavioralValidation +
    dataDepth           * weights.dataDepth +
    feedbackAlignment   * weights.feedbackAlignment;

  const level: 'low' | 'medium' | 'high' =
    score >= thresholds.high   ? 'high'
    : score >= thresholds.medium ? 'medium'
    : 'low';

  const result: BehavioralConfidenceResult = {
    score: Math.round(score * 1000) / 1000,
    level,
    components,
    rawInputs: { quizCount, archetypeChangeCount, totalOrders, matchedOrders, feedbackEventCount, negativeFeedbackFlag },
  };

  // ── 6. Write to Firestore (non-blocking from caller's perspective) ────────────
  try {
    firestoreDb.doc(`users/${uid}/metadata/confidence_profile`).set({
      score:                result.score,
      level,
      components,
      rawInputs:            result.rawInputs,
      hasPendingNegativeFeedback: negativeFeedbackFlag,
      computedAt:           new Date(),
    }, { merge: true }).catch(err => console.error('[behavioralConfidence/firestore]', err));
  } catch (err) {
    console.error('[behavioralConfidence] firestore doc path error:', err);
  }

  return result;
}
