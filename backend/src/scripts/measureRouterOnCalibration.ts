// Liam L2, Part E (2026-09-28) — measures the router change (Part A) against
// the 37 Hoboken calibration cases. Pure: no DB, no Firestore, no owner role
// needed — every input comes from the calibration fixture's own
// `expected_v2_1` output plus `input.experimental`. Run directly for the
// human-readable table (`npx tsx src/scripts/measureRouterOnCalibration.ts`);
// `measureRouter()` is also imported by sommelierEvaluator.test.ts so the
// same comparison is a real, checked-in test, not just a one-off printout.
//
// Every other rule input this brief's router doesn't touch (behavioral
// level, total orders, quiz-tie, archetype-change-last-two-quizzes, recent
// negative feedback, user-initiated/browsing signal) has no equivalent field
// in this fixture — it's a quiz-scoring calibration set, not a full customer
// snapshot. Fixed at the "no signal" value for every case (behavioralLevel
// 'low' so CONVERSION structurally never fires in this measurement — real
// customers with real order/behavioral history would split some of the
// "MATCHED" cases below into CONVERSION instead; quizCount fixed at 1, since
// every case represents one completed, scored quiz).
import 'dotenv/config';
import { matchIntent, type RuleInputs } from '../services/sommelierEvaluator.js';
import calibration from '../fixtures/quiz_calibration/hoboken-crawl-2026.calibration.json' with { type: 'json' };

const OLD_PRIORITY = ['DISCOVERY_SEEKER', 'PROFILE_AMBIGUOUS', 'TASTE_EVOLUTION', 'RECOMMENDATION_MISS', 'CONVERSION', 'EXPLORATION'];
const NEW_PRIORITY = ['PROFILE_AMBIGUOUS', 'DISCOVERY_SEEKER', 'TASTE_EVOLUTION', 'RECOMMENDATION_MISS', 'CONVERSION', 'MATCHED', 'EXPLORATION'];

// The old isProfileAmbiguous — quizTie short-circuited before the version
// check. quizTie is always false in this measurement (no equivalent fixture
// field — see the file header), so this differs from the current
// isProfileAmbiguous only in principle, not in any of these 37 outcomes;
// kept faithful to the pre-L2 code for an honest "before" comparison anyway.
function oldIsProfileAmbiguous(s: RuleInputs): boolean {
  if (s.quizTie === true) return true;
  const m = /^v(\d+(?:\.\d+)?)$/.exec(s.interpretationVersion ?? '');
  const version = m ? Number(m[1]) : 0;
  if (version >= 2.1) return s.pairConfidence === 'low' || s.exploreArchetype !== null;
  return s.recommendationMode === 'ai_agent' || s.foodSignalAlignment === 'low';
}
function oldMatchIntent(inputs: RuleInputs): { matchedIntent: string | null; triggersFired: string[] } {
  const ambiguous = oldIsProfileAmbiguous(inputs);
  const ruleChecks: Record<string, () => boolean> = {
    DISCOVERY_SEEKER: () => inputs.experimental === true,
    PROFILE_AMBIGUOUS: () => ambiguous,
    TASTE_EVOLUTION: () => inputs.archetypeChangedLastTwoQuizzes,
    RECOMMENDATION_MISS: () => inputs.hasRecentNegativeFeedback,
    CONVERSION: () => inputs.behavioralLevel !== 'low' && inputs.totalOrders === 0,
    EXPLORATION: () => inputs.userInitiated === true || inputs.browsingSignal === true,
  };
  const triggersFired: string[] = [];
  let matchedIntent: string | null = null;
  for (const name of OLD_PRIORITY) {
    if (ruleChecks[name]?.()) {
      triggersFired.push(name);
      if (!matchedIntent) matchedIntent = name;
    }
  }
  return { matchedIntent, triggersFired };
}

export interface CalibrationRow {
  caseId: string;
  experimental: boolean;
  pairConfidence: string;
  exploreArchetype: string | null;
  before: string | null;
  after: string | null;
}

export function measureRouter(): CalibrationRow[] {
  return calibration.cases.map((c) => {
    const inputs: RuleInputs = {
      quizTie: false,
      interpretationVersion: 'v2.1',
      pairConfidence: c.expected_v2_1.pairConfidence,
      exploreArchetype: c.expected_v2_1.exploreArchetype,
      recommendationMode: c.expected_v2_1.recommendationMode,
      foodSignalAlignment: 'high', // superseded by pairConfidence/exploreArchetype at v2.1+ either way
      experimental: c.input.experimental,
      archetypeChangedLastTwoQuizzes: false,
      hasRecentNegativeFeedback: false,
      behavioralLevel: 'low',
      totalOrders: 0,
      quizCount: 1,
      userInitiated: false,
      browsingSignal: false,
    };
    return {
      caseId: c.case_id,
      experimental: c.input.experimental,
      pairConfidence: c.expected_v2_1.pairConfidence,
      exploreArchetype: c.expected_v2_1.exploreArchetype,
      before: oldMatchIntent(inputs).matchedIntent,
      after: matchIntent(inputs, NEW_PRIORITY).matchedIntent,
    };
  });
}

function main() {
  const rows = measureRouter();
  const noIntentBefore = rows.filter(r => r.before === null).length;
  const noIntentAfter = rows.filter(r => r.after === null).length;
  const moved = rows.filter(r => r.before !== r.after);

  console.log(`${'case_id'.padEnd(26)} ${'exp'.padEnd(5)} ${'before'.padEnd(20)} ${'after'.padEnd(18)}`);
  for (const r of rows) {
    console.log(`${r.caseId.padEnd(26)} ${String(r.experimental).padEnd(5)} ${(r.before ?? '(none)').padEnd(20)} ${(r.after ?? '(none)').padEnd(18)}`);
  }
  console.log(`\n${rows.length} cases; no-intent before: ${noIntentBefore}; no-intent after: ${noIntentAfter}; changed: ${moved.length}`);
}

// Only run main() when invoked directly (`npx tsx src/scripts/measureRouterOnCalibration.ts`),
// not when imported by the test file.
if (process.argv[1] && process.argv[1].endsWith('measureRouterOnCalibration.ts')) {
  main();
}
