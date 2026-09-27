import { db } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';
import { archetypeCode } from './catalogReads.js';
import { getFeedbackCurrent } from './customerReads.js';

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
       LEFT JOIN coffee_archetype ar ON ar.id = qs.resulting_archetype_id
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
  // Catalog Blueprint brief 3: archetype match now via v_coffee.match_archetype
  // (D1) reached through roaster_blend.coffee_id, instead of the never-written
  // roaster_blend.archetype_id column. match_archetype is a code, so
  // currentArchetype (a display label from the quiz's `archetype` table) is
  // resolved to a code once via archetypeCode() before the comparison.
  let totalOrders = 0;
  let matchedOrders = 0;
  try {
    const currentArchetypeCode = currentArchetype ? await archetypeCode(currentArchetype) : null;
    const orderRows = await db.query(
      `SELECT COUNT(DISTINCT o.id) AS total,
              COUNT(DISTINCT CASE WHEN vc.match_archetype = $2 THEN o.id END) AS matched
       FROM "order" o
       JOIN user_profile up ON up.id = o.user_id
       LEFT JOIN order_line_item oli ON oli.order_id = o.id
       LEFT JOIN coffee_sku rb ON rb.id = oli.blend_id
       LEFT JOIN v_coffee vc ON vc.id = rb.coffee_id
       WHERE up.firebase_uid = $1`,
      [uid, currentArchetypeCode]
    );
    totalOrders   = parseInt(orderRows.rows[0]?.total ?? '0', 10);
    matchedOrders = parseInt(orderRows.rows[0]?.matched ?? '0', 10);
  } catch (err) {
    console.error('[behavioralConfidence] order query failed:', err);
  }

  // ── 3. v_customer_feedback_current (last 180 days) ───────────────────────────
  // Customer Blueprint C3, Part C — reads the fact through the view now;
  // supersede resolution (Profile Part 5's "a revised event's prior version
  // must not double-count") is v_customer_feedback_current's own job
  // (customer_feedback_event rows pointed at by a newer row's supersedes_id
  // are excluded there), not repeated here.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 180);

  let feedbackRows: Awaited<ReturnType<typeof getFeedbackCurrent>> = [];
  try {
    feedbackRows = (await getFeedbackCurrent(uid)).filter(f => f.occurredAt >= cutoff);
  } catch (err) {
    console.error('[behavioralConfidence] feedback read failed:', err);
  }

  const feedbackEventCount = feedbackRows.length;

  // negativeFeedbackFlag: any event with sentiment = 'negative' in the last N days
  const negativeFeedbackCutoff = new Date();
  negativeFeedbackCutoff.setDate(negativeFeedbackCutoff.getDate() - negativeFeedbackWindow);
  const negativeFeedbackFlag = feedbackRows.some(f => f.sentiment === 'negative' && f.occurredAt >= negativeFeedbackCutoff);

  // sValue (Firestore-era) was (rating - 1) / 4 with a >= 0.6 positive cutoff,
  // i.e. rating >= 4 — the same threshold v_customer_feedback_current already
  // derives sentiment='positive' from (rating >= 4).
  const positiveFeedbackCount = feedbackRows.filter(f => f.sentiment === 'positive').length;

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

  // Customer Blueprint C3, Part C — computeBehavioralConfidence is pure now:
  // reads facts through views, returns the result, writes nothing. The old
  // Firestore users/{uid}/metadata/confidence_profile write is retired; every
  // call site (routes/sommelier.ts POST /evaluate, routes/quiz.ts, this
  // module's own callers) already only ever used the returned value.
  return result;
}
