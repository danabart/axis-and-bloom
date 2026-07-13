import { db } from '../db/client.js';
import { getUserSignals, type UserSignals } from './userSignals.js';

// ── Homepage-specific thresholds ──────────────────────────────────────────────
// Named constants, separate from the Sommelier's Firestore config/sommelier —
// this is a different consumer with different tuning needs. See WHAT_WE_BUILT.md.
export const QUIZ_FRESH_DAYS = 30;
export const QUIZ_DRIFTED_DAYS = 180;
export const FEEDBACK_WINDOW_START_DAYS = 10;
export const FEEDBACK_ASK_EXPIRES_DAYS = 60; // stop asking on-site after this — SMS already tried at day 10 for orders 1-2; past this, further nudging just feels naggy
export const FEEDBACK_NAG_SUPPRESS_DAYS = 14;
export const REORDER_GAP_MULTIPLIER = 1.5;
export const SINGLE_ORDER_LAPSE_DAYS = 45;
export const SPONSORED_TRIAL_ENDING_WINDOW_DAYS = 14;

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// No enforced sequence between stages — a flat classification re-evaluated from
// current facts each time, not a state-transition graph. See schema.sql comment
// on user_lifecycle_stage.
export function classifyStage(signals: UserSignals): string {
  if (signals.quizCount === 0) return 'NEW_NO_QUIZ';

  // Company Gift sponsorship states take priority over the generic order-based
  // classification below — these drive a specific "add a payment method / continue
  // as a paid subscriber" nudge a generic quiz/order stage wouldn't surface. A
  // sponsorship that's active and not near expiry falls through untouched and
  // classifies exactly as it already would below (typically SUBSCRIBER).
  if (signals.hasLapsedSponsoredSubscription && !signals.hasActiveSubscription) {
    return 'SPONSORED_LAPSED_NO_PAYMENT';
  }
  if (signals.hasActiveSponsoredSubscription && signals.sponsoredExpiresAt) {
    const daysUntilExpiry = Math.ceil(
      (signals.sponsoredExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntilExpiry <= SPONSORED_TRIAL_ENDING_WINDOW_DAYS) return 'SPONSORED_TRIAL_ENDING';
  }

  if (signals.totalOrders === 0) {
    const days = signals.daysSinceLastQuiz ?? 0;
    if (days < QUIZ_FRESH_DAYS) return 'QUIZ_TAKEN_FRESH_NO_ORDER';
    if (days <= QUIZ_DRIFTED_DAYS) return 'QUIZ_TAKEN_SETTLED_NO_ORDER';
    return 'QUIZ_STALE_NO_ORDER';
  }

  // Pending feedback is an independent flag (see getPendingFeedbackOrder), not a
  // stage — a user's standing relationship (subscriber, reorder-due, etc.) and
  // "is there an unanswered feedback ask sitting out there" are two different,
  // simultaneously-true-able facts. One must not shadow the other.

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

// Scoped to the first two orders — the same window Liam's SMS loop targets
// (schedulePostDeliveryMessage fires for orders 1 and 2 only). Bounded on both
// ends: too soon (< FEEDBACK_WINDOW_START_DAYS) and SMS hasn't had its chance
// yet; too old (> FEEDBACK_ASK_EXPIRES_DAYS) and re-asking just feels naggy.
// Independent of classifyStage() — can be true alongside any stage.
export function getPendingFeedbackOrder(signals: UserSignals): { orderId: string; blendId: string | null } | null {
  const earlyOrders = signals.orders.slice(0, 2);
  const pending = earlyOrders.find(o => {
    if (o.hasFeedback) return false;
    const age = daysSince(o.createdAt);
    return age >= FEEDBACK_WINDOW_START_DAYS && age <= FEEDBACK_ASK_EXPIRES_DAYS;
  });
  return pending ? { orderId: pending.id, blendId: pending.blendId ?? null } : null;
}

// ── refreshLifecycleState() ───────────────────────────────────────────────────
// Computes the current stage from getUserSignals() and upserts user_lifecycle_state.
// Inserts a user_lifecycle_event row only when the stage actually changed — never
// on every recompute. Fire-and-forget from the same trigger points
// computeBehavioralConfidence() already runs from (quiz results, order placed,
// SMS feedback parsed) plus the new on-site feedback endpoint.
export interface LifecycleRefreshResult {
  stageCode: string;
  transitioned: boolean; // true only when the stage actually changed on this call
}

export async function refreshLifecycleState(uid: string): Promise<LifecycleRefreshResult | null> {
  const signals = await getUserSignals(uid);
  if (!signals.userId) return null; // no user_profile row yet — nothing to classify

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
      return null;
    }

    const currentResult = await client.query(
      `SELECT stage_id FROM user_lifecycle_state WHERE user_id = $1`,
      [signals.userId]
    );
    const currentStageId = currentResult.rows[0]?.stage_id ?? null;
    let transitioned = false;

    if (currentResult.rows.length === 0) {
      await client.query(
        `INSERT INTO user_lifecycle_state (user_id, stage_id, computed_at) VALUES ($1, $2, NOW())`,
        [signals.userId, newStageId]
      );
      await client.query(
        `INSERT INTO user_lifecycle_event (user_id, from_stage_id, to_stage_id) VALUES ($1, NULL, $2)`,
        [signals.userId, newStageId]
      );
      transitioned = true;
    } else if (currentStageId !== newStageId) {
      await client.query(
        `UPDATE user_lifecycle_state SET stage_id = $2, computed_at = NOW() WHERE user_id = $1`,
        [signals.userId, newStageId]
      );
      await client.query(
        `INSERT INTO user_lifecycle_event (user_id, from_stage_id, to_stage_id) VALUES ($1, $2, $3)`,
        [signals.userId, currentStageId, newStageId]
      );
      transitioned = true;
    } else {
      await client.query(
        `UPDATE user_lifecycle_state SET computed_at = NOW() WHERE user_id = $1`,
        [signals.userId]
      );
    }

    await client.query('COMMIT');
    return { stageCode, transitioned };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[userLifecycle] refreshLifecycleState error:', err);
    return null;
  } finally {
    client.release();
  }
}
