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
  };
  modelRouting: {
    sonnetKeywords: string[];
    sonnetMinMessageWords: number;
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
