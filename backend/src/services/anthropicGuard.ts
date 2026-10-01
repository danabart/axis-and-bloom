import { db } from '../db/client.js';
import { getSommelierConfig, type AiFeature, type AiControls } from './sommelierConfig.js';

// C2 Part 1 — the global Claude spend gate. Every Claude call site in the
// app (chatWithSommelier, getRecommendation, getCoffeeSummary/
// -SurpriseNote/-ThreeVoiceStory in claude.ts; the story generators in
// storyLayer.ts; sommelierEvaluator's Haiku enrichment; liamSmsFeedback's
// inbound-reply parser) calls guardClaudeCall() instead of
// client.messages.create() directly, so there is exactly one place that
// tracks spend and enforces the ceiling — no route/service copies this
// check.
//
// AI Operations admin page (2026-08-10) — extended to a 5-layer check, each
// one able to block on its own (see guardClaudeCall below). Reasons are
// reported to callers/logs (ClaudeGuardBlockReason) but callers still only
// ever need to catch ClaudeGuardBlockedError as a type — none of the
// existing graceful-degradation call sites needed to change.
//
// Fail closed: if the spend-so-far read itself errors, the call is treated
// as over-limit and skipped — an accounting outage must never silently
// remove the ceiling. The admin-portal aiControls toggle/cap read is the
// opposite: it fails OPEN (see getEffectiveAiControls below) — a Firestore
// blip must never be able to take Liam down, only the env var and a real
// spend-read failure are allowed to do that.

/** $ per million tokens, by exact model id. Keep in one place — this is the
 *  only spot a rate change needs to land.
 *
 *  Liam access & cost brief (2026-10-01) — gained the two prompt-caching
 *  rates. Checked against Anthropic's pricing + prompt-caching docs that day:
 *  a 5-minute cache write is 1.25x base input, a cache read 0.1x (Sonnet 4.6:
 *  $3.75 / $0.30 per MTok; Haiku 4.5: $1.25 / $0.10). `cache_control:
 *  { type: 'ephemeral' }` with no ttl is the 5-minute cache, so that is the
 *  write rate used. */
interface ModelRate { inputUsd: number; outputUsd: number; cacheWriteUsd: number; cacheReadUsd: number }
const MODEL_RATES_PER_MILLION: Record<string, ModelRate> = {
  'claude-haiku-4-5-20251001': { inputUsd: 1, outputUsd: 5,  cacheWriteUsd: 1.25, cacheReadUsd: 0.10 },
  'claude-sonnet-4-6':         { inputUsd: 3, outputUsd: 15, cacheWriteUsd: 3.75, cacheReadUsd: 0.30 },
};

// An admin-configured model override (config/sommelier.modelRouting's
// expertiseModelOverride slot — see claude.ts) could name a model id not in
// the table above. Cost it at the pricier known tier rather than treat it
// as free — undercounting spend is the one failure mode this gate exists
// to prevent; overcounting an unusual model by a few cents is harmless.
const UNKNOWN_MODEL_FALLBACK_RATE = MODEL_RATES_PER_MILLION['claude-sonnet-4-6'];

function rateFor(model: string): ModelRate {
  const rate = MODEL_RATES_PER_MILLION[model];
  if (!rate) {
    console.warn(`[anthropicGuard] no rate entry for model "${model}" — costing at the Sonnet fallback rate`);
  }
  return rate ?? UNKNOWN_MODEL_FALLBACK_RATE;
}

/** The usage block Anthropic returns. The cache fields are absent on older
 *  responses and null when caching wasn't used — both count as zero. */
export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Cost of one call in integer micro-dollars (1 USD = 1,000,000), rounded UP
 * to the next whole micro-dollar. Was whole cents rounded up per call
 * (computeCostCents), which made every Liam turn cost at least a cent on the
 * books. With caching, `input_tokens` is only the uncached part (tokens after
 * the last cache breakpoint), so the two cache fields are costed separately
 * at their own rates — leaving them out would undercount.
 *
 * $/MTok × tokens is exactly micro-dollars, so no unit conversion is needed;
 * rates are scaled to integers (×100) first so the sum is exact and the
 * single Math.ceil only ever rounds a genuine fraction, never float noise.
 */
export function computeCostMicros(model: string, usage: ClaudeUsage): number {
  const rate = rateFor(model);
  const scaled = (usd: number) => Math.round(usd * 100);
  const sum =
    (usage.input_tokens ?? 0) * scaled(rate.inputUsd) +
    (usage.cache_creation_input_tokens ?? 0) * scaled(rate.cacheWriteUsd) +
    (usage.cache_read_input_tokens ?? 0) * scaled(rate.cacheReadUsd) +
    (usage.output_tokens ?? 0) * scaled(rate.outputUsd);
  return Math.ceil(sum / 100);
}

const MICROS_PER_USD = 1_000_000;

/** USD → integer micro-dollars, for comparing a dollar cap against spend. A
 *  cap is set in dollars (at most cents precision), so this is exact. */
export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

/** The one place a `claude_daily_spend.usd_micros` value is parsed — `pg`
 *  returns BIGINT as a string. Anything unparseable throws rather than
 *  silently reading as zero (the guard's caller treats a throw as a failed
 *  spend read and fails closed). */
export function parseUsdMicros(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`[anthropicGuard] unparseable usd_micros value: ${String(value)}`);
  }
  return n;
}

function todayUtcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** CLAUDE_GLOBAL_DAILY_USD — the infra-pinned ceiling (deploy.yml). This is
 *  now the outer ceiling the admin-portal working cap can never exceed, not
 *  the working cap itself — see getEffectiveGlobalCapMicros(). */
function envCeilingMicros(): number {
  const usd = Number(process.env.CLAUDE_GLOBAL_DAILY_USD ?? '20');
  return usdToMicros(Number.isFinite(usd) ? usd : 20);
}

/** The env ceiling in dollars — exposed for the admin GET endpoint (shown as
 *  the working-cap editor's max) and the PUT endpoint's server-side min()
 *  enforcement. Same underlying value as envCeilingMicros(), just not
 *  converted, so an admin typing "20" back doesn't get rejected by a rounding
 *  artifact. */
export function envCeilingUsd(): number {
  return Number(process.env.CLAUDE_GLOBAL_DAILY_USD ?? '20');
}

const DEFAULT_AI_CONTROLS: AiControls = {
  enabled: true,
  globalDailyUsd: 20,
  features: {
    liam_chat:           { enabled: true, dailyUsd: null },
    quiz_recommendation: { enabled: true, dailyUsd: null },
    coffee_content:      { enabled: true, dailyUsd: null },
    lifecycle:           { enabled: true, dailyUsd: null },
  },
};

/**
 * The admin-portal half of the gate — reads `config/sommelier.aiControls`.
 * Deliberately FAILS OPEN, the mirror image of the spend-read's fail-closed
 * discipline above: getSommelierConfig() is a synchronous read of the
 * in-memory value sommelierConfig.ts keeps live via a Firestore onSnapshot
 * listener (initSommelierConfig) — no network call happens here, so there is
 * no per-call read to fail. A live Firestore hiccup already degrades
 * gracefully at the source (sommelierConfig.ts logs the snapshot error and
 * simply keeps serving the last value it successfully received — real-time,
 * not a fixed TTL, so a toggle flip lands faster than the ~60s the UI states
 * as its conservative worst case). The only two ways this function actually
 * returns defaults: aiControls hasn't been set on the live doc yet, or this
 * instance hasn't received its first snapshot yet (cold start racing a
 * Firestore outage) — both logged here so it's visible in ops, not silent.
 * Shallow-merged against defaults per feature key so a partial/malformed
 * document degrades gracefully instead of leaving a feature unresolved.
 */
export function getEffectiveAiControls(): AiControls {
  const raw = getSommelierConfig()?.aiControls;
  if (!raw) {
    console.warn('[anthropicGuard] aiControls missing from config/sommelier (not yet set, or config not loaded) — using defaults (everything enabled, $20/day global)');
    return DEFAULT_AI_CONTROLS;
  }

  const features = {} as AiControls['features'];
  for (const key of Object.keys(DEFAULT_AI_CONTROLS.features) as AiFeature[]) {
    const f = raw.features?.[key];
    features[key] = {
      enabled: typeof f?.enabled === 'boolean' ? f.enabled : true,
      dailyUsd: typeof f?.dailyUsd === 'number' ? f.dailyUsd : null,
    };
  }

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    globalDailyUsd: typeof raw.globalDailyUsd === 'number' ? raw.globalDailyUsd : DEFAULT_AI_CONTROLS.globalDailyUsd,
    features,
  };
}

/** min(env ceiling, admin working cap) — the UI is only ever a brake, never
 *  an accelerator; raising above the env-pinned ceiling requires a deploy. */
export function getEffectiveGlobalCapMicros(controls: AiControls): number {
  return Math.min(envCeilingMicros(), usdToMicros(controls.globalDailyUsd));
}

/** Today's spend, in micro-dollars, both the running total and broken out per
 *  feature — one query, since the guard needs both on every call (the
 *  feature-cap check and the global-cap check). `usd_micros` is the only
 *  spend column read or written since 2026-10-01; `cents` is frozen. */
async function getTodaySpend(): Promise<{ totalMicros: number; byFeatureMicros: Partial<Record<AiFeature, number>> }> {
  const result = await db.query<{ feature: string; usd_micros: string }>(
    `SELECT feature, usd_micros FROM claude_daily_spend WHERE date = $1`,
    [todayUtcDateKey()]
  );
  const byFeatureMicros: Partial<Record<AiFeature, number>> = {};
  let totalMicros = 0;
  for (const row of result.rows) {
    const micros = parseUsdMicros(row.usd_micros);
    byFeatureMicros[row.feature as AiFeature] = micros;
    totalMicros += micros;
  }
  return { totalMicros, byFeatureMicros };
}

/** Layers 4–5 as a pure decision, exported so the cap boundary is testable
 *  without a database. Spend at or above a cap blocks (unchanged from the
 *  cents version: `>=`, so the gate is never looser than it was). */
export function capBlockReason(
  feature: AiFeature,
  controls: AiControls,
  spend: { totalMicros: number; byFeatureMicros: Partial<Record<AiFeature, number>> }
): 'feature_cap' | 'global_cap' | null {
  const featureCap = controls.features[feature].dailyUsd;
  if (featureCap !== null && (spend.byFeatureMicros[feature] ?? 0) >= usdToMicros(featureCap)) {
    return 'feature_cap';
  }
  if (spend.totalMicros >= getEffectiveGlobalCapMicros(controls)) {
    return 'global_cap';
  }
  return null;
}

function formatUsd(micros: number): string {
  return `$${(micros / MICROS_PER_USD).toFixed(2)}`;
}

// Atomic — a single UPSERT keyed on (date, feature), so concurrent Cloud Run
// instances incrementing the same day/feature row never lose an update to a
// race (Postgres resolves ON CONFLICT DO UPDATE under a row-level lock;
// there is no read-modify-write gap here for two instances to stomp on
// each other).
async function recordSpendMicros(feature: AiFeature, costMicros: number): Promise<void> {
  await db.query(
    `INSERT INTO claude_daily_spend (date, feature, usd_micros)
     VALUES ($1, $2, $3)
     ON CONFLICT (date, feature) DO UPDATE
       SET usd_micros = claude_daily_spend.usd_micros + EXCLUDED.usd_micros,
           updated_at = timezone('utc', now())`,
    [todayUtcDateKey(), feature, costMicros]
  );
}

export type ClaudeGuardBlockReason =
  | 'env_disabled'      // CLAUDE_ENABLED=false — the infra-level kill switch
  | 'global_toggle'     // aiControls.enabled=false
  | 'feature_toggle'    // aiControls.features[feature].enabled=false
  | 'feature_cap'       // today's spend for this feature >= its dailyUsd cap
  | 'global_cap'        // today's total spend >= min(env ceiling, admin cap)
  | 'store_error';      // the Postgres spend read itself failed — fail closed

/** Thrown by guardClaudeCall() BEFORE Anthropic is ever called. Every call
 *  site catches this specifically (or lets an existing catch-all degrade
 *  gracefully) rather than surfacing a raw 500. */
export class ClaudeGuardBlockedError extends Error {
  reason: ClaudeGuardBlockReason;
  feature: AiFeature;
  constructor(reason: ClaudeGuardBlockReason, feature: AiFeature) {
    super(`Claude call blocked (${reason}, feature=${feature})`);
    this.name = 'ClaudeGuardBlockedError';
    this.reason = reason;
    this.feature = feature;
  }
}

export function isClaudeGuardBlocked(err: unknown): err is ClaudeGuardBlockedError {
  return err instanceof ClaudeGuardBlockedError;
}

/**
 * The shared gate every Claude call site passes through. `feature` attributes
 * the call to one of the 4 admin-visible groups (AiFeature) — required, so an
 * unmapped call site is a compile error, never a silent "unattributed" spend.
 * `model` is the exact model id being sent to Anthropic (used for cost-rate
 * lookup — the same value the caller sends, never duplicated/guessed).
 * `makeCall` is the actual `client.messages.create({...})` call; it only ever
 * runs once every layer below has passed, so a blocked call never reaches
 * Anthropic. Only a successful call increments the daily total, using the
 * real `usage` Anthropic returns on the response — never an estimate, never
 * a flat per-call count. A failed/thrown call is never recorded (the
 * increment only happens after `makeCall()` resolves).
 *
 * Checked in this order — the layering model (AI Operations spec, "the core
 * design — preserve this intent exactly"). Any "off/over" answer blocks with
 * ClaudeGuardBlockedError, reason set to whichever layer tripped:
 *   1. CLAUDE_ENABLED env — no reads, works even with app/DB/Firestore down.
 *   2. aiControls.enabled (global admin toggle).
 *   3. aiControls.features[feature].enabled (per-feature admin toggle).
 *   4. Per-feature daily cap, if aiControls.features[feature].dailyUsd is set.
 *   5. Effective global daily cap = min(env ceiling, aiControls.globalDailyUsd).
 */
export async function guardClaudeCall<T extends { usage?: ClaudeUsage }>(
  feature: AiFeature,
  model: string,
  makeCall: () => Promise<T>
): Promise<T> {
  // Layer 1 — the infra-level kill switch. Checked first, no reads at all.
  if ((process.env.CLAUDE_ENABLED ?? 'true') === 'false') {
    throw new ClaudeGuardBlockedError('env_disabled', feature);
  }

  // Layers 2–3 — admin-portal toggles (fails open; see getEffectiveAiControls).
  const controls = getEffectiveAiControls();
  if (!controls.enabled) {
    console.warn(`[anthropicGuard] blocked (global_toggle) — feature=${feature}`);
    throw new ClaudeGuardBlockedError('global_toggle', feature);
  }
  if (!controls.features[feature].enabled) {
    console.warn(`[anthropicGuard] blocked (feature_toggle) — feature=${feature}`);
    throw new ClaudeGuardBlockedError('feature_toggle', feature);
  }

  // Layers 4–5 — the real-dollar caps (fails closed: a spend-read error
  // blocks the call rather than silently removing the ceiling).
  let spend: { totalMicros: number; byFeatureMicros: Partial<Record<AiFeature, number>> };
  try {
    spend = await getTodaySpend();
  } catch (err) {
    console.error('[anthropicGuard] spend read failed — failing closed, call skipped:', err);
    throw new ClaudeGuardBlockedError('store_error', feature);
  }

  const capReason = capBlockReason(feature, controls, spend);
  if (capReason === 'feature_cap') {
    const featureCapUsd = controls.features[feature].dailyUsd ?? 0;
    console.warn(`[anthropicGuard] blocked (feature_cap) — feature=${feature} ${formatUsd(spend.byFeatureMicros[feature] ?? 0)} >= $${featureCapUsd.toFixed(2)}`);
    throw new ClaudeGuardBlockedError('feature_cap', feature);
  }
  if (capReason === 'global_cap') {
    console.warn(`[anthropicGuard] blocked (global_cap) — feature=${feature} ${formatUsd(spend.totalMicros)} >= ${formatUsd(getEffectiveGlobalCapMicros(controls))}`);
    throw new ClaudeGuardBlockedError('global_cap', feature);
  }

  const response = await makeCall();

  // Only a successful call reaches here — an error thrown by makeCall()
  // propagates above this point and is never recorded, satisfying "blocked/
  // failed calls must not increment."
  try {
    const usage = response.usage;
    if (usage) {
      const costMicros = computeCostMicros(model, usage);
      // One line per successful call, token counts and cost only (no
      // content, no uid) — how per-turn cache behaviour is read from the logs.
      console.log(
        `[anthropicGuard] spend feature=${feature} model=${model} input=${usage.input_tokens} ` +
        `cache_write=${usage.cache_creation_input_tokens ?? 0} cache_read=${usage.cache_read_input_tokens ?? 0} ` +
        `output=${usage.output_tokens} usd_micros=${costMicros}`
      );
      if (costMicros > 0) await recordSpendMicros(feature, costMicros);
    }
  } catch (err) {
    // The call already succeeded and Anthropic already billed it; a failure
    // to *record* that spend must not fail an otherwise-good response.
    console.error('[anthropicGuard] failed to record spend for a successful call (response still returned, not retried):', err);
  }

  return response;
}
