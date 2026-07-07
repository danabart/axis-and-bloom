import { db } from '../db/client.js';
import { getUserSignals, type UserSignals } from './userSignals.js';

// ── Homepage-specific thresholds ──────────────────────────────────────────────
// Named constants, separate from the Sommelier's Firestore config/sommelier —
// this is a different consumer with different tuning needs. See WHAT_WE_BUILT.md.
export const QUIZ_FRESH_DAYS = 30;
export const QUIZ_DRIFTED_DAYS = 180;
export const FEEDBACK_WINDOW_START_DAYS = 10;
export const FEEDBACK_NAG_SUPPRESS_DAYS = 14;
export const REORDER_GAP_MULTIPLIER = 1.5;
export const SINGLE_ORDER_LAPSE_DAYS = 45;

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// No enforced sequence between stages — a flat classification re-evaluated from
// current facts each time, not a state-transition graph. See schema.sql comment
// on user_lifecycle_stage.
export function classifyStage(signals: UserSignals): string {
  if (signals.quizCount === 0) return 'NEW_NO_QUIZ';

  if (signals.totalOrders === 0) {
    const days = signals.daysSinceLastQuiz ?? 0;
    if (days < QUIZ_FRESH_DAYS) return 'QUIZ_TAKEN_FRESH_NO_ORDER';
    if (days <= QUIZ_DRIFTED_DAYS) return 'QUIZ_TAKEN_SETTLED_NO_ORDER';
    return 'QUIZ_STALE_NO_ORDER';
  }

  // Feedback-pending check is scoped to the first two orders — the same window
  // Liam's SMS loop targets (schedulePostDeliveryMessage fires for orders 1 and 2
  // only). A feedback gap on order #7 shouldn't perpetually flag a long-time
  // customer as "first order pending" — this stage is about onboarding, not
  // an all-time feedback audit.
  const earlyOrders = signals.orders.slice(0, 2);
  const pendingEarlyOrder = earlyOrders.find(
    o => !o.hasFeedback && daysSince(o.createdAt) >= FEEDBACK_WINDOW_START_DAYS
  );
  if (pendingEarlyOrder) return 'FIRST_ORDER_FEEDBACK_PENDING';

  if (signals.hasActiveSubscription) return 'SUBSCRIBER';

  if (signals.totalOrders === 1) {
    const days = signals.lastOrderAt ? daysSince(signals.lastOrderAt) : 0;
    return days > SINGLE_ORDER_LAPSE_DAYS ? 'LAPSED_SINGLE_ORDER' : 'ACTIVE_REPEAT_USER';
  }

  // 2+ orders, no subscription
  const daysSinceLastOrder = signals.lastOrderAt ? daysSince(signals.lastOrderAt) : 0;
  const avgGap = signals.averageOrderGapDays ?? 0;
  if (avgGap > 0 && daysSinceLastOrder > REORDER_GAP_MULTIPLIER * avgGap) return 'REORDER_DUE';
  return 'ACTIVE_REPEAT_USER';
}

// ── refreshLifecycleState() ───────────────────────────────────────────────────
// Computes the current stage from getUserSignals() and upserts user_lifecycle_state.
// Inserts a user_lifecycle_event row only when the stage actually changed — never
// on every recompute. Fire-and-forget from the same trigger points
// computeBehavioralConfidence() already runs from (quiz results, order placed,
// SMS feedback parsed) plus the new on-site feedback endpoint.
export async function refreshLifecycleState(uid: string): Promise<void> {
  const signals = await getUserSignals(uid);
  if (!signals.userId) return; // no user_profile row yet — nothing to classify

  const stageCode = classifyStage(signals);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const stageResult = await client.query(
      `SELECT id FROM user_lifecycle_stage WHERE code = $1`,
      [stageCode]
    );
    const newStageId = stageResult.rows[0]?.id;
    if (!newStageId) {
      console.error('[userLifecycle] unknown stage code:', stageCode);
      await client.query('ROLLBACK');
      return;
    }

    const currentResult = await client.query(
      `SELECT stage_id FROM user_lifecycle_state WHERE user_id = $1`,
      [signals.userId]
    );
    const currentStageId = currentResult.rows[0]?.stage_id ?? null;

    if (currentResult.rows.length === 0) {
      await client.query(
        `INSERT INTO user_lifecycle_state (user_id, stage_id, computed_at) VALUES ($1, $2, NOW())`,
        [signals.userId, newStageId]
      );
      await client.query(
        `INSERT INTO user_lifecycle_event (user_id, from_stage_id, to_stage_id) VALUES ($1, NULL, $2)`,
        [signals.userId, newStageId]
      );
    } else if (currentStageId !== newStageId) {
      await client.query(
        `UPDATE user_lifecycle_state SET stage_id = $2, computed_at = NOW() WHERE user_id = $1`,
        [signals.userId, newStageId]
      );
      await client.query(
        `INSERT INTO user_lifecycle_event (user_id, from_stage_id, to_stage_id) VALUES ($1, $2, $3)`,
        [signals.userId, currentStageId, newStageId]
      );
    } else {
      await client.query(
        `UPDATE user_lifecycle_state SET computed_at = NOW() WHERE user_id = $1`,
        [signals.userId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[userLifecycle] refreshLifecycleState error:', err);
  } finally {
    client.release();
  }
}
