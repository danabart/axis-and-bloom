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
    sonnetKeywords: string[];
    sonnetMinMessageWords: number;
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
