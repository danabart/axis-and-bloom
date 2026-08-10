import { firestoreDb } from './firebase-admin.js';
import { seedSommelierConfig, seedSommelierCentroids } from '../db/seeds/sommelier_config_seed.js';

export interface IntentConfig {
  active: boolean;
  label: string;
  conversationGoal: string;
  systemPromptAddendum: string;
  ragFocus: string;
  maxTurns: number;
}

export interface TopicConfig {
  keywords: string[];
  mode: 'expertise' | 'matching';
}

// AI Operations admin page — the 4 feature groups an admin reasons about (one
// toggle per surface), not the 9 raw Claude call sites. A union type so an
// unmapped guardClaudeCall() site is a compile error, not a silent gap.
export type AiFeature = 'liam_chat' | 'quiz_recommendation' | 'coffee_content' | 'lifecycle';

export const AI_FEATURES: AiFeature[] = ['liam_chat', 'quiz_recommendation', 'coffee_content', 'lifecycle'];

export interface AiFeatureControls {
  enabled: boolean;
  /** null = no per-feature cap (the global cap still applies). */
  dailyUsd: number | null;
}

export interface AiControls {
  enabled: boolean;
  /** The admin-portal working cap — never allowed above CLAUDE_GLOBAL_DAILY_USD
   *  (the env ceiling); see anthropicGuard.ts's effective-cap min(). */
  globalDailyUsd: number;
  features: Record<AiFeature, AiFeatureControls>;
}

// HOME_TASK_4 (§4.5) — the brew-profile field whitelist. `enum`/`array` values
// are checked against `allowedValues`; `bool` accepts 'true'/'false' strings
// (marker values arrive as text); `array_freeform` (aversions) accepts any
// trimmed string up to `maxItemLength`, capped at `maxLength` items total.
export interface BrewProfileFieldConfig {
  type: 'enum' | 'bool' | 'array' | 'array_freeform';
  allowedValues?: string[];
  maxLength?: number;
  maxItemLength?: number;
}

export interface SommelierConfig {
  confidenceWeights: {
    quizStability: number;
    behavioralValidation: number;
    dataDepth: number;
    feedbackAlignment: number;
  };
  confidenceThresholds: {
    medium: number;
    high: number;
  };
  sessionLimits: {
    maxTurns: number;
  };
  tokenEconomy: {
    signupBonus: number;
    orderBonus: number;
    costPerTurn: number;
    purchaseEnabled: boolean;
    // HOME_TASK_3 (§5) — Liam is inside the subscription; the meter is retired.
    // false (default after this task): /start doesn't block on balance, /message
    // doesn't gate on spendToken — turns are logged (usage_log) not charged.
    // true: today's pre-HOME_TASK_3 gating behavior, kept as a rollback lever.
    gatingEnabled: boolean;
  };
  modelRouting: {
    // HOME_TASK_2 — Fable/other blind-A/B override for expertise-mode turns.
    // null = use the Sonnet default (§4.7's "Sonnet default where a topic is detected").
    expertiseModelOverride?: string | null;
  };
  ragLimits: {
    maxCoffees: number;
  };
  evaluatorRulePriority: string[];
  timeWindows: {
    negativeFeedbackLookback: number;
    orderOutcome7Day: number;
    orderOutcome30Day: number;
    returnVisitWindow: number;
    sessionResumeWindowHours: number;
  };
  intents: Record<string, IntentConfig>;
  confidenceComponents: Record<string, { active: boolean; label: string; description: string }>;
  // HOME_TASK_2 (§4.1) — turn-level topic router, keyword rules + stickiness.
  topics?: Record<string, TopicConfig>;
  topicRouter?: {
    priority: string[];
    stickyDecayTurns: number;
  };
  // HOME_TASK_2 (§4.2) — the two response contracts, as config so tuning doesn't
  // need a deploy (the S33 no-deploy lever, extended). Matching mode's own length
  // instruction stays in LIAM_BASE_PROMPT (unchanged, core voice) — only its
  // max_tokens is config-driven here, same as expertise mode's full contract.
  responseContracts?: {
    matching?: { maxTokens: number };
    expertise?: { maxTokens: number; lengthInstruction: string; numbersCarveout: string };
  };
  // HOME_TASK_2 (§4.6) — mode-aware context assembly.
  contextAssembly?: {
    omitCatalogInExpertiseMode: boolean;
  };
  // HOME_TASK_3 (§4.8) — the invisible guard layer, operator-facing only.
  // Nothing here is ever shown to a customer; this is what replaces the meter.
  guards?: {
    dailyTurnCap: number;
    monthlySpendCeilingUsd: number;
    // $/turn estimate by model id — a planning estimate, not real Anthropic
    // billing data. Used only to flag accounts worth an admin's attention.
    modelCostPerTurnUsd: Record<string, number>;
    anomalyMultiplier: number;
    rateLimits: {
      perIpPerMinute: number;
      perAccountPerMinute: number;
    };
  };
  // HOME_TASK_4 (§4.5, §3.5) — the Phase 1 brew-profile field whitelist and
  // the stale-re-confirm window (write rule 5). Full self-serve field set
  // (culture/background/timing) arrives in Task 10; this is captured-fields-only.
  brewProfile?: {
    fields: Record<string, BrewProfileFieldConfig>;
    staleAfterDays: number;
    // HOME_TASK_5b — Defect 2 fix: how many <<remember:...>> markers a single
    // reply may carry. Was an unconfigured "at most one" prompt rule only;
    // raised to 2 so a customer who states two distinct facts in one message
    // doesn't hear both confirmed but only one actually saved.
    maxMarkersPerTurn: number;
  };
  // HOME_TASK_5 (§4.4) — the story-layer specificity line's second enforcement.
  // The generation prompt bans these concepts explicitly; this is the
  // post-generation reject-and-retry's config-driven half — S38 proved a
  // prompt-only rule alone leaks, so this list stays independent of the prompt.
  storyLayer?: {
    bannedTerms: string[];
  };
  // HOME_TASK_6 (§3.2, §3.1) — the brew-card recipe generator's base recipes,
  // dimension-driven adjustment rules, and the whitelisted <<card:adjust=...>>
  // vocabulary. Code + config, never an LLM call — see brewCard.ts. Every
  // method key here must also be a valid brewProfile.fields.brew_methods value
  // (checked by brewCard.ts at read time, not duplicated as a second whitelist).
  brewDefaults?: {
    grindScale: string[];
    methods: Record<string, { ratio: string; grindLabel: string; grindIndex: number; tempC: number | null }>;
    // Applied in array order — see brewCard.ts's computeRecipe() for exactly
    // how a dimension's cupping average maps to a grind/temp shift.
    dimensionDeltas: Array<{
      dimensionName: string;
      highThreshold: number | null;
      lowThreshold: number | null;
      highGrindShift?: number;
      lowGrindShift?: number;
      highTempShiftC?: number;
      lowTempShiftC?: number;
      highNote?: string;
      lowNote?: string;
    }>;
    // <<card:adjust=KEY>> — server-side whitelist; an unknown key is dropped
    // and logged, never trusted from the model (S51 discipline).
    adjustments: Record<string, { grindShift?: number; tempShiftC?: number; note: string }>;
    // First-draft, adjustable mapping — no per-archetype "ideal method" data
    // exists yet, this is a reasonable starting default only (see build log).
    archetypeDefaultMethod: Record<string, string>;
    arrivalNote: {
      // Days after order placement before the arrival email sends — the same
      // no-real-fulfillment-signal approximation liamSmsFeedback.ts already
      // uses for its own +10-day post-delivery ask, just shorter since this
      // is the earlier "arrival" beat, not the later feedback one.
      deliveryDelayDays: number;
      // Bag-number-aware length rule (§3.1) — first-ever bag of any coffee
      // gets the fullest note; at or above this bag number, later notes render
      // in the shorter form.
      shortNoteFromBagNumber: number;
    };
  };
  // HOME_TASK_8 (§3.1) — the beat engine's own rules. No hard-coded cases in
  // beatEngine.ts — every lifecycle/timing/channel decision reads from here.
  beats?: {
    // Master SMS gate — false until Dana flips it (A2P approval + the
    // extended opt-in consent copy both live). Email-only while false,
    // regardless of what an individual beat's channel priority says.
    smsEnabled: boolean;
    types: {
      order_placed: { active: boolean };
      arrival_note: { active: boolean };
      dial_in: {
        active: boolean;
        // Days after order placement — independently anchored to order time,
        // same approximation-from-order-date precedent as the legacy 10-day
        // SMS and brewDefaults.arrivalNote.deliveryDelayDays, not chained
        // after the arrival note. Deliberately distinct value from both.
        timingOffsetDays: number;
        // "Repeat coffee → skip dial-in" (§3.1) — config-driven, not a
        // hard-coded engine branch.
        skipIfRepeatCoffee: boolean;
      };
    };
    // Degrade-on-silence (§3.1) — a per-user responded/sent ratio over the
    // last windowSize *sent* beats (any type). Below minResponseRate, the
    // engine drops every beat but arrival_note (the minimal set — arrival
    // notes are useful even to someone who never responds to anything,
    // per §3.1's "never a nag, never a re-send" framing).
    degradeOnSilence: {
      windowSize: number;
      minResponseRate: number;
    };
  };
  // HOME_TASK_7C (strategy §9, 2026-08-03) — the universal printed QR's one
  // config lever: how many days back a customer's order counts as a
  // "plausible active bag" for the multi-bag picker decision.
  qr?: {
    activeBagWindowDays: number;
  };
  // AI Operations admin page (2026-08-10) — the admin-editable half of the
  // Claude spend gate. Lives in this same doc/subscription rather than a
  // separate read path: anthropicGuard.ts's getEffectiveAiControls() reads it
  // off getSommelierConfig(), which is always the in-memory last-known-good
  // value from the onSnapshot listener below — a Firestore blip never blocks
  // a call, it just serves the last value this instance actually received
  // (or, before the first snapshot ever lands, the hardcoded defaults in
  // anthropicGuard.ts). See anthropicGuard.ts for the full fail-open story.
  aiControls?: AiControls;
  updatedAt?: unknown;
}

let _config: SommelierConfig | null = null;

export function getSommelierConfig(): SommelierConfig | null {
  return _config;
}

export async function initSommelierConfig(): Promise<void> {
  // Seed if not present
  await seedSommelierConfig();
  await seedSommelierCentroids();

  const configRef = firestoreDb.doc('config/sommelier');

  // Load once to ensure config is available before the server starts accepting requests
  const snap = await configRef.get();
  if (snap.exists) {
    _config = snap.data() as SommelierConfig;
    console.log('[sommelierConfig] Config loaded');
  }

  // Subscribe to live updates
  configRef.onSnapshot(
    (doc) => {
      if (!doc.exists) return;
      const prev = _config ? Object.keys(_config) : [];
      _config = doc.data() as SommelierConfig;
      const curr = Object.keys(_config);
      const changed = curr.filter(k => !prev.includes(k)).concat(prev.filter(k => !curr.includes(k)));
      if (changed.length > 0 || prev.length === 0) {
        console.log(`[sommelierConfig] Config updated — keys changed: [${changed.join(', ')}]`);
      } else {
        console.log('[sommelierConfig] Config refreshed');
      }
    },
    (err) => console.error('[sommelierConfig] Snapshot error:', err)
  );
}
