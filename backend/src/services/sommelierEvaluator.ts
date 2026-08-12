import Anthropic from '@anthropic-ai/sdk';
import { firestoreDb } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getSommelierConfig } from './sommelierConfig.js';
import { getUserSignals } from './userSignals.js';
import { guardClaudeCall } from './anthropicGuard.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const FEATURE_SCHEMA = [
  'quizStability',
  'behavioralValidation',
  'dataDepth',
  'feedbackAlignment',
  'normalizedOrderCount',
  'normalizedDaysSinceQuiz',
  'normalizedQuizCount',
  'archetypeChangeFraction',
  'experimentalFlag',
  'quizTieFlag',
  'negativeFeedbackFlag',
  'foodMatchesPrimary',
  'foodMatchesSecondary',
] as const;

export type FeatureSchema = typeof FEATURE_SCHEMA;

export interface EvaluatorFlags {
  quizTie?: boolean;
  tiedArchetypes?: string[];
  userInitiated?: boolean;
  browsingSignal?: boolean;
}

interface UserStateSnapshot {
  archetype: string | null;
  secondaryArchetype: string | null;
  branchedFrom: string | null;
  experimental: boolean;
  foodSignalAlignment: string;
  recommendationMode: string;
  quizCount: number;
  archetypeChangeCount: number;
  totalOrders: number;
  daysSinceLastQuiz: number | null;
  behavioralScore: number;
  behavioralLevel: string;
  hasRecentNegativeFeedback: boolean;
  capturedAt: string;
}

export interface EvaluatorResult {
  needsSommelier: boolean;
  intent: string | null;
  triggersFired: string[];
  openingContext: string | null;
  evaluationId: string | null;
  featureVector: number[];
  featureSchema: string[];
  userStateSnapshot: UserStateSnapshot;
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, v));
}

export async function evaluateSommelier(
  uid: string,
  flags: EvaluatorFlags
): Promise<EvaluatorResult> {
  const config = getSommelierConfig();

  // ── Stage 1: Collect data ────────────────────────────────────────────────
  const signals = await getUserSignals(uid);
  const {
    archetype, secondaryArchetype, branchedFrom, foodSignal, experimental, foodSignalAlignment, recommendationMode,
    quizCount, archetypeChangeCount, archetypeChangedLastTwoQuizzes, daysSinceLastQuiz,
    totalOrders, behavioralScore, behavioralLevel, behavioralComponents: bcComponents,
    hasRecentNegativeFeedback, age, generation, householdType,
  } = signals;

  // ── Build feature vector (13 dims) ──────────────────────────────────────
  const featureVector: number[] = [
    bcComponents.quizStability,
    bcComponents.behavioralValidation,
    bcComponents.dataDepth,
    bcComponents.feedbackAlignment,
    clamp(totalOrders / 10),
    clamp((daysSinceLastQuiz ?? 30) / 30),
    clamp(quizCount / 5),
    quizCount > 0 ? clamp(archetypeChangeCount / quizCount) : 0,
    experimental ? 1 : 0,
    flags.quizTie ? 1 : 0,
    hasRecentNegativeFeedback ? 1 : 0,
    foodSignal && archetype && foodSignal === archetype ? 1 : 0,
    // Quiz Branched From (2026-08-11, semantics versioned): on a branch-switched
    // session, `secondaryArchetype` is the branch parent (e.g. Fruity for a Floral
    // result), not the scored runner-up — see WHAT_WE_BUILT.md's Branched From
    // entry. Floral/Earthy can never be a food signal (Q6 only maps to the three
    // scored archetypes), so this dimension is structurally 0 for every
    // branch-switched user regardless; unchanged behavior, just documented here.
    foodSignal && secondaryArchetype && foodSignal === secondaryArchetype ? 1 : 0,
  ];

  const userStateSnapshot: UserStateSnapshot = {
    archetype,
    secondaryArchetype,
    branchedFrom,
    experimental,
    foodSignalAlignment,
    recommendationMode,
    quizCount,
    archetypeChangeCount,
    totalOrders,
    daysSinceLastQuiz,
    behavioralScore,
    behavioralLevel,
    hasRecentNegativeFeedback,
    capturedAt: new Date().toISOString(),
  };

  // ── Rule evaluation ──────────────────────────────────────────────────────
  const priority: string[] = config?.evaluatorRulePriority ?? [
    'DISCOVERY_SEEKER',
    'PROFILE_AMBIGUOUS',
    'TASTE_EVOLUTION',
    'RECOMMENDATION_MISS',
    'CONVERSION',
    'EXPLORATION',
  ];

  const triggersFired: string[] = [];
  let matchedIntent: string | null = null;

  const ruleChecks: Record<string, () => boolean> = {
    DISCOVERY_SEEKER: () => experimental === true,
    PROFILE_AMBIGUOUS: () =>
      flags.quizTie === true ||
      recommendationMode === 'ai_agent' ||
      foodSignalAlignment === 'low',
    TASTE_EVOLUTION: () => archetypeChangedLastTwoQuizzes,
    RECOMMENDATION_MISS: () => hasRecentNegativeFeedback,
    CONVERSION: () => behavioralLevel !== 'low' && totalOrders === 0,
    EXPLORATION: () => flags.userInitiated === true || flags.browsingSignal === true,
  };

  for (const intentName of priority) {
    const intentConfig = config?.intents?.[intentName];
    if (intentConfig && !intentConfig.active) continue;
    const check = ruleChecks[intentName];
    if (check && check()) {
      triggersFired.push(intentName);
      if (!matchedIntent) matchedIntent = intentName;
    }
  }

  if (!matchedIntent) {
    return {
      needsSommelier: false,
      intent: null,
      triggersFired,
      openingContext: null,
      evaluationId: null,
      featureVector,
      featureSchema: [...FEATURE_SCHEMA],
      userStateSnapshot,
    };
  }

  // ── Stage 2: Haiku enrichment ────────────────────────────────────────────
  const intentCfg = config?.intents?.[matchedIntent];
  const demographicLine = [
    age !== null ? `Age ${age}` : null,
    generation ?? null,
    householdType === 'family' ? 'family household' : 'solo',
  ].filter(Boolean).join(', ');

  const userPrompt = `Initialize a coffee sommelier session. Write 2-3 sentences briefing Liam (the sommelier) about this specific user before their first exchange. Be factual and specific. Include their demographic and tone calibration so Liam knows how to speak to them.

Intent: ${matchedIntent}
Goal: ${intentCfg?.conversationGoal ?? 'Guide the user to a coffee they will love'}
Archetype: ${archetype ?? 'Unknown'}, Secondary: ${secondaryArchetype ?? 'none'}
Behavioral confidence: ${behavioralLevel} (score: ${behavioralScore.toFixed(2)})
Experimental: ${experimental}
Quiz count: ${quizCount}, Archetype changes: ${archetypeChangeCount}
Order count: ${totalOrders}
Recent negative feedback: ${hasRecentNegativeFeedback ? 'yes' : 'no'}
Days since last quiz: ${daysSinceLastQuiz !== null ? daysSinceLastQuiz : 'first quiz'}
Demographic: ${demographicLine || 'unknown'}

Tone calibration guidance:
- Gen Z: casual and brief is fine, informal register
- Millennial: conversational but substantive, no hype
- Gen X: direct and no-nonsense, earned trust — don't try to charm them
- Boomer: formal and respectful, expertise matters, no slang
- Family household: may be buying for others, practical decisions
- Solo: individual taste focus

Write only the briefing, including a tone note for Liam at the end (e.g. "Tone: direct, no-nonsense — Gen X.")`;

  let openingContext = `${archetype ?? 'Unknown archetype'} user — ${matchedIntent} intent.`;
  try {
    const haikuResp = await guardClaudeCall('liam_chat', 'claude-haiku-4-5-20251001', () =>
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: 'You generate concise briefings. Respond with only the briefing text, no preamble.',
        messages: [{ role: 'user', content: userPrompt }],
      })
    );
    const block = haikuResp.content[0];
    if (block.type === 'text') openingContext = block.text;
  } catch (err) {
    console.error('[sommelierEvaluator] Haiku Stage 2 error:', err);
  }

  // ── Stage 3: Write evaluation to Firestore ───────────────────────────────
  let evaluationId: string | null = null;
  try {
    const evalDoc = await firestoreDb
      .collection(`users/${uid}/sommelier_evaluations`)
      .add({
        intent: matchedIntent,
        triggersFired,
        needsSommelier: true,
        sessionStarted: false,
        startedAt: null,
        featureVector,
        featureSchema: [...FEATURE_SCHEMA],
        userStateSnapshot,
        openingContext,
        outcome: {
          sessionCompleted: null,
          turnsUsed: null,
          tokensSpent: null,
          orderedWithin7Days: null,
          orderedWithin30Days: null,
          feedbackAfterSession: null,
          returnedToSommelier: null,
          outcomeUpdatedAt: null,
        },
        createdAt: FieldValue.serverTimestamp(),
      });
    evaluationId = evalDoc.id;
  } catch (err) {
    console.error('[sommelierEvaluator] Firestore write error:', err);
  }

  return {
    needsSommelier: true,
    intent: matchedIntent,
    triggersFired,
    openingContext,
    evaluationId,
    featureVector,
    featureSchema: [...FEATURE_SCHEMA],
    userStateSnapshot,
  };
}
