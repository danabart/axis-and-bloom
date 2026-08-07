import { db } from '../db/client.js';

// C2 Part 1 — the global Claude spend gate. Every Claude call site in the
// app (chatWithSommelier, getRecommendation, getCoffeeSummary/
// -SurpriseNote/-ThreeVoiceStory in claude.ts; the story generators in
// storyLayer.ts; sommelierEvaluator's Haiku enrichment; liamSmsFeedback's
// inbound-reply parser) calls guardClaudeCall() instead of
// client.messages.create() directly, so there is exactly one place that
// tracks spend and enforces the ceiling — no route/service copies this
// check.
//
// Two independent levers, both env-driven (no redeploy to flip — a Cloud
// Run env-var update is enough):
//   CLAUDE_ENABLED (default true) — a manual "stop all AI now" kill-switch.
//   CLAUDE_GLOBAL_DAILY_USD (default 20) — a real-usage-based daily dollar
//     ceiling, tracked in Postgres (claude_daily_spend, one row per UTC
//     date) so it's a true global total across every Cloud Run instance,
//     not an in-memory per-instance counter that resets on scale events.
//
// Fail closed: if the spend-so-far read itself errors, the call is treated
// as over-limit and skipped — an accounting outage must never silently
// remove the ceiling.

/** $ per million tokens, by exact model id. Keep in one place — this is the
 *  only spot a rate change needs to land. */
const MODEL_RATES_PER_MILLION: Record<string, { inputUsd: number; outputUsd: number }> = {
  'claude-haiku-4-5-20251001': { inputUsd: 1, outputUsd: 5 },
  'claude-sonnet-4-6':         { inputUsd: 3, outputUsd: 15 },
};

// An admin-configured model override (config/sommelier.modelRouting's
// expertiseModelOverride slot — see claude.ts) could name a model id not in
// the table above. Cost it at the pricier known tier rather than treat it
// as free — undercounting spend is the one failure mode this gate exists
// to prevent; overcounting an unusual model by a few cents is harmless.
const UNKNOWN_MODEL_FALLBACK_RATE = MODEL_RATES_PER_MILLION['claude-sonnet-4-6'];

function rateFor(model: string): { inputUsd: number; outputUsd: number } {
  const rate = MODEL_RATES_PER_MILLION[model];
  if (!rate) {
    console.warn(`[anthropicGuard] no rate entry for model "${model}" — costing at the Sonnet fallback rate`);
  }
  return rate ?? UNKNOWN_MODEL_FALLBACK_RATE;
}

/** Cost of one call, in integer cents, rounded UP — under-counting spend is
 *  the failure mode this gate exists to avoid, not over-counting by a cent. */
export function computeCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const rate = rateFor(model);
  const dollars = (inputTokens / 1_000_000) * rate.inputUsd + (outputTokens / 1_000_000) * rate.outputUsd;
  return Math.ceil(dollars * 100);
}

function todayUtcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function ceilingCents(): number {
  const usd = Number(process.env.CLAUDE_GLOBAL_DAILY_USD ?? '20');
  return Math.round((Number.isFinite(usd) ? usd : 20) * 100);
}

async function getTodaySpendCents(): Promise<number> {
  const result = await db.query<{ cents: number }>(
    `SELECT cents FROM claude_daily_spend WHERE date = $1`,
    [todayUtcDateKey()]
  );
  return result.rows[0]?.cents ?? 0;
}

// Atomic — a single UPSERT, so concurrent Cloud Run instances incrementing
// the same day's row never lose an update to a race (Postgres resolves
// ON CONFLICT DO UPDATE under a row-level lock; there is no read-modify-
// write gap here for two instances to stomp on each other).
async function recordSpendCents(costCents: number): Promise<number> {
  const result = await db.query<{ cents: number }>(
    `INSERT INTO claude_daily_spend (date, cents)
     VALUES ($1, $2)
     ON CONFLICT (date) DO UPDATE
       SET cents = claude_daily_spend.cents + EXCLUDED.cents,
           updated_at = timezone('utc', now())
     RETURNING cents`,
    [todayUtcDateKey(), costCents]
  );
  return result.rows[0]?.cents ?? costCents;
}

export type ClaudeGuardBlockReason = 'disabled' | 'over_ceiling' | 'store_error';

/** Thrown by guardClaudeCall() BEFORE Anthropic is ever called. Every call
 *  site catches this specifically (or lets an existing catch-all degrade
 *  gracefully) rather than surfacing a raw 500. */
export class ClaudeGuardBlockedError extends Error {
  reason: ClaudeGuardBlockReason;
  constructor(reason: ClaudeGuardBlockReason) {
    super(`Claude call blocked (${reason})`);
    this.name = 'ClaudeGuardBlockedError';
    this.reason = reason;
  }
}

export function isClaudeGuardBlocked(err: unknown): err is ClaudeGuardBlockedError {
  return err instanceof ClaudeGuardBlockedError;
}

/**
 * The shared gate every Claude call site passes through. `model` is the
 * exact model id being sent to Anthropic (used for cost-rate lookup — the
 * same value the caller sends, never duplicated/guessed). `makeCall` is the
 * actual `client.messages.create({...})` call; it only ever runs once the
 * gate has passed, so a blocked call never reaches Anthropic. Only a
 * successful call increments the daily total, using the real `usage`
 * Anthropic returns on the response — never an estimate, never a flat
 * per-call count. A failed/thrown call is never recorded (the increment
 * only happens after `makeCall()` resolves).
 */
export async function guardClaudeCall<T extends { usage?: { input_tokens: number; output_tokens: number } }>(
  model: string,
  makeCall: () => Promise<T>
): Promise<T> {
  if ((process.env.CLAUDE_ENABLED ?? 'true') === 'false') {
    throw new ClaudeGuardBlockedError('disabled');
  }

  let spentCents: number;
  try {
    spentCents = await getTodaySpendCents();
  } catch (err) {
    console.error('[anthropicGuard] spend read failed — failing closed, call skipped:', err);
    throw new ClaudeGuardBlockedError('store_error');
  }

  const ceiling = ceilingCents();
  if (spentCents >= ceiling) {
    console.warn(`[anthropicGuard] daily ceiling reached ($${(spentCents / 100).toFixed(2)} >= $${(ceiling / 100).toFixed(2)}) — call skipped`);
    throw new ClaudeGuardBlockedError('over_ceiling');
  }

  const response = await makeCall();

  // Only a successful call reaches here — an error thrown by makeCall()
  // propagates above this point and is never recorded, satisfying "blocked/
  // failed calls must not increment."
  try {
    const usage = response.usage;
    if (usage) {
      const costCents = computeCostCents(model, usage.input_tokens, usage.output_tokens);
      if (costCents > 0) await recordSpendCents(costCents);
    }
  } catch (err) {
    // The call already succeeded and Anthropic already billed it; a failure
    // to *record* that spend must not fail an otherwise-good response.
    console.error('[anthropicGuard] failed to record spend for a successful call (response still returned, not retried):', err);
  }

  return response;
}
