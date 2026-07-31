import { db } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';

// HOME_TASK_3 (§4.8) — the invisible guard layer. None of this is ever shown to
// a customer; it exists so usage stays bounded now that nothing is priced (§5).
// Every threshold reads live config with a fallback matching the seed default,
// same pattern as the rest of the Sommelier services.

const DAILY_CAP_FALLBACK = 60;
const MONTHLY_CEILING_FALLBACK_USD = 5;
const ANOMALY_MULTIPLIER_FALLBACK = 3;
const MODEL_COST_FALLBACK: Record<string, number> = {
  'claude-haiku-4-5-20251001': 0.002,
  'claude-sonnet-4-6': 0.02,
};

// Counted from `token_events` (reason IN ('sommelier_turn', 'usage_log')) rather
// than Firestore message docs — both the gated and ungated turn paths already
// write exactly one such row per turn, so this single SQL counter covers either
// state of `tokenEconomy.gatingEnabled` without a schema addition of its own.
export async function checkDailyCap(uid: string): Promise<{ hit: boolean; count: number; cap: number }> {
  const cap = getSommelierConfig()?.guards?.dailyTurnCap ?? DAILY_CAP_FALLBACK;
  const result = await db.query(
    `SELECT COUNT(*) AS count FROM token_events
     WHERE uid = $1 AND reason IN ('sommelier_turn', 'usage_log')
       AND created_at >= date_trunc('day', NOW())`,
    [uid]
  );
  const count = Number(result.rows[0]?.count ?? 0);
  return { hit: count >= cap, count, cap };
}

function costFor(model: string | null, costs: Record<string, number>): number {
  if (model && costs[model] != null) return costs[model];
  const fallback = Object.values(costs)[0];
  return fallback ?? 0.01;
}

// A planning estimate, not real Anthropic billing data — turns this calendar
// month × a configured $/turn guess per model. Rows written before the `model`
// column existed (or bonus rows, which are excluded by the reason filter) fall
// back to a representative cost rather than being dropped from the count.
export async function getMonthlySpendEstimate(uid: string): Promise<{ estimatedUsd: number; turnCount: number }> {
  const costs = getSommelierConfig()?.guards?.modelCostPerTurnUsd ?? MODEL_COST_FALLBACK;
  const result = await db.query(
    `SELECT model, COUNT(*) AS count FROM token_events
     WHERE uid = $1 AND reason IN ('sommelier_turn', 'usage_log')
       AND created_at >= date_trunc('month', NOW())
     GROUP BY model`,
    [uid]
  );
  let estimatedUsd = 0;
  let turnCount = 0;
  for (const row of result.rows) {
    const count = Number(row.count);
    estimatedUsd += count * costFor(row.model ?? null, costs);
    turnCount += count;
  }
  return { estimatedUsd, turnCount };
}

// In-memory, per-instance, one-alert-per-user-per-day throttle — Cloud Run
// multi-instance means this can reset on a scale event, the same tolerance
// already accepted for the rate limiter below. Good enough for an operator
// log line; not a source of truth for anything.
const alreadyAlertedToday = new Set<string>();

export async function checkMonthlySpendAndAlert(uid: string): Promise<void> {
  const ceiling = getSommelierConfig()?.guards?.monthlySpendCeilingUsd ?? MONTHLY_CEILING_FALLBACK_USD;
  const { estimatedUsd, turnCount } = await getMonthlySpendEstimate(uid);
  if (estimatedUsd < ceiling) return;

  const todayKey = `${uid}:${new Date().toISOString().slice(0, 10)}`;
  if (alreadyAlertedToday.has(todayKey)) return;
  alreadyAlertedToday.add(todayKey);

  console.warn(
    `[sommelierGuards] Monthly spend ceiling crossed — uid=${uid} estimate=$${estimatedUsd.toFixed(2)} turns=${turnCount} ceiling=$${ceiling}`
  );
}

// Aggregate, not per-user — computed on demand for the admin dashboard
// (GET /admin/sommelier/stats), not on every turn.
export async function checkAggregateAnomaly(): Promise<{
  isAnomalous: boolean;
  todayCount: number;
  sevenDayAvg: number;
  multiplier: number;
}> {
  const multiplier = getSommelierConfig()?.guards?.anomalyMultiplier ?? ANOMALY_MULTIPLIER_FALLBACK;

  const todayResult = await db.query(
    `SELECT COUNT(*) AS count FROM token_events
     WHERE reason IN ('sommelier_turn', 'usage_log') AND created_at >= date_trunc('day', NOW())`
  );
  const todayCount = Number(todayResult.rows[0]?.count ?? 0);

  const trendResult = await db.query(
    `SELECT COUNT(*) AS count FROM token_events
     WHERE reason IN ('sommelier_turn', 'usage_log')
       AND created_at >= NOW() - INTERVAL '8 days'
       AND created_at < date_trunc('day', NOW())`
  );
  const sevenDayAvg = Number(trendResult.rows[0]?.count ?? 0) / 7;

  return {
    isAnomalous: sevenDayAvg > 0 && todayCount > sevenDayAvg * multiplier,
    todayCount,
    sevenDayAvg,
    multiplier,
  };
}
