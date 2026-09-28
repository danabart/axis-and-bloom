import { db } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';
import { getUserSignals } from './userSignals.js';

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

// PROFILE_AMBIGUOUS (interpretation v2.1, brief 2; quizTie scoping — L2, Part
// A). On a v2.1+ interpretation the customer's own signals decide: pair
// confidence 'low', or a loose thread for Liam to explore — quizTie is
// ignored here, since an unresolved near-tie is already surfaced as
// `exploreArchetype = 'A / B'` (quizScoring.ts) and checking it again would
// be redundant, not additive. Older sessions (context_data fallback, no
// v2.1+ interpretation row) have no exploreArchetype hint at all, so quizTie
// stays load-bearing there — the only way that path learns about a tie.
export function isProfileAmbiguous(s: {
  quizTie?: boolean;
  interpretationVersion: string | null;
  pairConfidence: string | null;
  exploreArchetype: string | null;
  recommendationMode: string;
  foodSignalAlignment: string;
}): boolean {
  if (interpretationMajorMinor(s.interpretationVersion) >= 2.1) {
    return s.pairConfidence === 'low' || s.exploreArchetype !== null;
  }
  return s.quizTie === true || s.recommendationMode === 'ai_agent' || s.foodSignalAlignment === 'low';
}

// Liam L2, Part A — the router's default priority (seed and fallback are the
// same list; live config can override). PROFILE_AMBIGUOUS now outranks
// DISCOVERY_SEEKER; MATCHED is the new default for any quiz taker, sitting
// after CONVERSION; EXPLORATION drops to last.
export const DEFAULT_EVALUATOR_RULE_PRIORITY = [
  'PROFILE_AMBIGUOUS',
  'DISCOVERY_SEEKER',
  'TASTE_EVOLUTION',
  'RECOMMENDATION_MISS',
  'CONVERSION',
  'MATCHED',
  'EXPLORATION',
];

export interface RuleInputs {
  quizTie?: boolean;
  interpretationVersion: string | null;
  pairConfidence: string | null;
  exploreArchetype: string | null;
  recommendationMode: string;
  foodSignalAlignment: string;
  experimental: boolean;
  archetypeChangedLastTwoQuizzes: boolean;
  hasRecentNegativeFeedback: boolean;
  behavioralLevel: string;
  totalOrders: number;
  quizCount: number;
  userInitiated?: boolean;
  browsingSignal?: boolean;
}

export interface MatchIntentResult {
  matchedIntent: string | null;
  triggersFired: string[];
}

// Liam L2, Part A — extracted out of evaluateSommelier() so both the unit
// tests and Part E's calibration script can exercise the router's actual
// priority/rule logic directly, over plain inputs, with no DB or Firestore
// involved — evaluateSommelier() itself just gathers the inputs and calls
// this. `isActive` is config-dependent (an admin can deactivate an intent
// without a deploy) so it's the one thing left as an injected predicate
// rather than baked into RuleInputs.
export function matchIntent(
  inputs: RuleInputs,
  priority: string[] = DEFAULT_EVALUATOR_RULE_PRIORITY,
  isActive: (intentName: string) => boolean = () => true
): MatchIntentResult {
  // Computed once, shared by both PROFILE_AMBIGUOUS and DISCOVERY_SEEKER —
  // DISCOVERY_SEEKER only fires on a clean (non-ambiguous) profile, so
  // triggersFired never lists DISCOVERY for an ambiguous one.
  const ambiguous = isProfileAmbiguous(inputs);

  const ruleChecks: Record<string, () => boolean> = {
    PROFILE_AMBIGUOUS: () => ambiguous,
    DISCOVERY_SEEKER: () => inputs.experimental === true && !ambiguous,
    TASTE_EVOLUTION: () => inputs.archetypeChangedLastTwoQuizzes,
    RECOMMENDATION_MISS: () => inputs.hasRecentNegativeFeedback,
    CONVERSION: () => inputs.behavioralLevel !== 'low' && inputs.totalOrders === 0,
    // Liam L2, Part A — the new default for any quiz taker (D5): a current
    // quiz exists. Sits after CONVERSION in priority so it only catches
    // everyone CONVERSION doesn't.
    MATCHED: () => inputs.quizCount > 0,
    EXPLORATION: () => inputs.userInitiated === true || inputs.browsingSignal === true,
  };

  const triggersFired: string[] = [];
  let matchedIntent: string | null = null;
  for (const intentName of priority) {
    if (!isActive(intentName)) continue;
    const check = ruleChecks[intentName];
    if (check && check()) {
      triggersFired.push(intentName);
      if (!matchedIntent) matchedIntent = intentName;
    }
  }
  return { matchedIntent, triggersFired };
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
  // Liam L2, Part A — the actual priority/rule logic lives in matchIntent()
  // above (pure, shared with the unit tests and Part E's calibration
  // script); this call just gathers the live inputs and applies the
  // config-dependent active-intent filter, which matchIntent() takes as an
  // injected predicate rather than baking config into its own signature.
  const priority: string[] = config?.evaluatorRulePriority ?? DEFAULT_EVALUATOR_RULE_PRIORITY;
  const { matchedIntent, triggersFired } = matchIntent(
    {
      quizTie: flags.quizTie, interpretationVersion, pairConfidence, exploreArchetype,
      recommendationMode, foodSignalAlignment, experimental, archetypeChangedLastTwoQuizzes,
      hasRecentNegativeFeedback, behavioralLevel, totalOrders, quizCount,
      userInitiated: flags.userInitiated, browsingSignal: flags.browsingSignal,
    },
    priority,
    (intentName) => {
      const intentConfig = config?.intents?.[intentName];
      return !intentConfig || intentConfig.active;
    }
  );

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

  // ── Stage 2: tone calibration (a lookup, not a model call) ───────────────
  // Liam L2, Part D (2026-09-28) — Stage 2 used to spend one Haiku call per
  // session start to produce a tone sentence from generation and household
  // type alone (L1, Part C.5, already stripped it down to just those two
  // inputs). Since neither input needs a model to interpret — they're a
  // closed, small set — this is now a plain config lookup: one Anthropic
  // call removed from every session start, this feature's own Haiku
  // dependency gone entirely (see OPEN_TASKS.md OT-26, closed by this brief).
  const register = config?.register;
  const generationSentence = register?.generation?.[generation ?? 'unknown'] ?? '';
  const householdSentence = register?.household?.[householdType === 'family' ? 'family' : 'solo'] ?? '';
  const openingContext = [generationSentence, householdSentence].filter(Boolean).join(' ')
    || `${archetype ?? 'Unknown archetype'} user — ${matchedIntent} intent.`;

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
