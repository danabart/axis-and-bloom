import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/client.js';
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

// 'v2.1' -> 2.1; anything unparseable (null = session still on the context_data fallback) -> 0.
function interpretationMajorMinor(version: string | null | undefined): number {
  const m = /^v(\d+(?:\.\d+)?)$/.exec(version ?? '');
  return m ? Number(m[1]) : 0;
}

// PROFILE_AMBIGUOUS (interpretation v2.1, brief 2). On a v2.1+ interpretation the customer's own signals decide:
// pair confidence 'low', or a loose thread for Liam to explore. Older sessions keep the v1 rule (ai_agent /
// low treat alignment). A quiz tie fires it either way.
export function isProfileAmbiguous(s: {
  quizTie?: boolean;
  interpretationVersion: string | null;
  pairConfidence: string | null;
  exploreArchetype: string | null;
  recommendationMode: string;
  foodSignalAlignment: string;
}): boolean {
  if (s.quizTie === true) return true;
  if (interpretationMajorMinor(s.interpretationVersion) >= 2.1) {
    return s.pairConfidence === 'low' || s.exploreArchetype !== null;
  }
  return s.recommendationMode === 'ai_agent' || s.foodSignalAlignment === 'low';
}

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
    interpretationVersion, pairConfidence, exploreArchetype,
    quizCount, archetypeChangeCount, archetypeChangedLastTwoQuizzes, daysSinceLastQuiz,
    totalOrders, behavioralScore, behavioralLevel, behavioralComponents: bcComponents,
    hasRecentNegativeFeedback, generation, householdType,
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
      isProfileAmbiguous({
        quizTie: flags.quizTie, interpretationVersion, pairConfidence, exploreArchetype,
        recommendationMode, foodSignalAlignment,
      }),
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
  // Liam L1, Part C.5 (2026-09-28) — every fact this prompt used to carry
  // (archetype, secondary, behavioral counts, feedback flag) now lives in the
  // structured profile line instead (services/liamProfile.ts), injected every
  // turn, not just this one turn-0 briefing. This call's only job left is
  // tone calibration: generation and household type only.
  const demographicLine = [
    generation ?? null,
    householdType === 'family' ? 'family household' : 'solo',
  ].filter(Boolean).join(', ');

  const userPrompt = `Write one tone-calibration sentence for Liam (a coffee sommelier) before his first exchange with this customer. No facts about the customer's taste or history — those are handled elsewhere. Just how to speak to them.

Demographic: ${demographicLine || 'unknown'}

Tone calibration guidance:
- Gen Z: casual and brief is fine, informal register
- Millennial: conversational but substantive, no hype
- Gen X: direct and no-nonsense, earned trust — don't try to charm them
- Boomer: formal and respectful, expertise matters, no slang
- Family household: may be buying for others, practical decisions
- Solo: individual taste focus

Write only the one sentence (e.g. "Tone: direct, no-nonsense — Gen X.")`;

  let openingContext = `${archetype ?? 'Unknown archetype'} user — ${matchedIntent} intent.`;
  try {
    const haikuResp = await guardClaudeCall('liam_chat', 'claude-haiku-4-5-20251001', () =>
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        system: 'You generate concise tone-calibration notes. Respond with only the one sentence, no preamble.',
        messages: [{ role: 'user', content: userPrompt }],
      })
    );
    const block = haikuResp.content[0];
    if (block.type === 'text') openingContext = block.text;
  } catch (err) {
    console.error('[sommelierEvaluator] Haiku Stage 2 error:', err);
  }

  // ── Stage 3: Write evaluation — Customer Blueprint C3, Part B6 ───────────
  // sommelier_evaluation (SQL, operating/log table) replaces Firestore
  // users/{uid}/sommelier_evaluations; user_id is user_profile.id, resolved
  // from the Firebase uid this function receives. Existing Firestore
  // evaluations are left in place as history under the old key, not migrated.
  let evaluationId: string | null = null;
  try {
    const profileResult = await db.query<{ id: string }>(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
    const profileId = profileResult.rows[0]?.id;
    if (profileId) {
      const insertResult = await db.query<{ id: string }>(
        `INSERT INTO sommelier_evaluation
           (user_id, intent, triggers_fired, needs_sommelier, feature_vector, feature_schema, user_state_snapshot, opening_context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [profileId, matchedIntent, triggersFired, true, featureVector, [...FEATURE_SCHEMA], JSON.stringify(userStateSnapshot), openingContext]
      );
      evaluationId = insertResult.rows[0]?.id ?? null;
    }
  } catch (err) {
    console.error('[sommelierEvaluator] evaluation insert error:', err);
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
