// Liam L2, Part F — unit coverage for the router: isProfileAmbiguous's
// version-gated quizTie handling, matchIntent's priority/rule logic (pure,
// no DB or Firestore), and the 37-case Hoboken calibration table as a real,
// checked assertion (not just a printout) — see
// scripts/measureRouterOnCalibration.ts for the shared computation and the
// human-readable table this test's own numbers come from.
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { isProfileAmbiguous, matchIntent, DEFAULT_EVALUATOR_RULE_PRIORITY, type RuleInputs } from './sommelierEvaluator.js';
import { measureRouter } from '../scripts/measureRouterOnCalibration.js';

const BASE_INPUTS: RuleInputs = {
  interpretationVersion: 'v2.1',
  pairConfidence: 'high',
  exploreArchetype: null,
  recommendationMode: 'primary_only',
  foodSignalAlignment: 'high',
  experimental: false,
  archetypeChangedLastTwoQuizzes: false,
  hasRecentNegativeFeedback: false,
  behavioralLevel: 'low',
  totalOrders: 0,
  quizCount: 1,
};

describe('isProfileAmbiguous', () => {
  it('v2.1+: ignores quizTie — a near-tie is already exploreArchetype = "A / B"', () => {
    expect(isProfileAmbiguous({ ...BASE_INPUTS, quizTie: true, pairConfidence: 'high', exploreArchetype: null })).toBe(false);
  });

  it('v2.1+: fires on low pair confidence', () => {
    expect(isProfileAmbiguous({ ...BASE_INPUTS, pairConfidence: 'low' })).toBe(true);
  });

  it('v2.1+: fires on any open thread (exploreArchetype set)', () => {
    expect(isProfileAmbiguous({ ...BASE_INPUTS, exploreArchetype: 'Fruity' })).toBe(true);
  });

  // Liam L3, Part D — a thread already asked (for THIS interpretation) no
  // longer routes here on its own; pairConfidence:'low' still fires
  // regardless, since threadAsked only gates the exploreArchetype branch.
  it('v2.1+: an already-asked thread no longer fires PROFILE_AMBIGUOUS on its own', () => {
    expect(isProfileAmbiguous({ ...BASE_INPUTS, exploreArchetype: 'Fruity', threadAsked: true })).toBe(false);
  });

  it('v2.1+: an unasked thread still fires (threadAsked defaults to falsy)', () => {
    expect(isProfileAmbiguous({ ...BASE_INPUTS, exploreArchetype: 'Fruity', threadAsked: false })).toBe(true);
  });

  it('v2.1+: low pair confidence fires even with threadAsked true', () => {
    expect(isProfileAmbiguous({ ...BASE_INPUTS, pairConfidence: 'low', exploreArchetype: null, threadAsked: true })).toBe(true);
  });

  it('context_data fallback (no v2.1+ row): quizTie still fires it — the only way that path learns about a tie', () => {
    expect(isProfileAmbiguous({ ...BASE_INPUTS, interpretationVersion: null, quizTie: true, pairConfidence: 'high', recommendationMode: 'primary_only', foodSignalAlignment: 'high' })).toBe(true);
  });

  it('context_data fallback: falls back to ai_agent / low alignment, not the v2.1 fields', () => {
    expect(isProfileAmbiguous({ ...BASE_INPUTS, interpretationVersion: null, quizTie: false, recommendationMode: 'ai_agent', foodSignalAlignment: 'high' })).toBe(true);
    expect(isProfileAmbiguous({ ...BASE_INPUTS, interpretationVersion: null, quizTie: false, recommendationMode: 'primary_only', foodSignalAlignment: 'low' })).toBe(true);
    expect(isProfileAmbiguous({ ...BASE_INPUTS, interpretationVersion: null, quizTie: false, recommendationMode: 'primary_only', foodSignalAlignment: 'high' })).toBe(false);
  });
});

describe('matchIntent — priority and each rule', () => {
  it('PROFILE_AMBIGUOUS outranks DISCOVERY_SEEKER (Liam L2, Part A)', () => {
    const result = matchIntent({ ...BASE_INPUTS, experimental: true, pairConfidence: 'low' });
    expect(result.matchedIntent).toBe('PROFILE_AMBIGUOUS');
    expect(result.triggersFired).not.toContain('DISCOVERY_SEEKER'); // clean-profile gate only
  });

  it('DISCOVERY_SEEKER fires only on a clean (non-ambiguous) profile', () => {
    const result = matchIntent({ ...BASE_INPUTS, experimental: true, pairConfidence: 'high', exploreArchetype: null });
    expect(result.matchedIntent).toBe('DISCOVERY_SEEKER');
  });

  it('TASTE_EVOLUTION fires on an archetype change across the last two quizzes', () => {
    expect(matchIntent({ ...BASE_INPUTS, archetypeChangedLastTwoQuizzes: true }).matchedIntent).toBe('TASTE_EVOLUTION');
  });

  it('RECOMMENDATION_MISS fires on recent negative feedback', () => {
    expect(matchIntent({ ...BASE_INPUTS, hasRecentNegativeFeedback: true }).matchedIntent).toBe('RECOMMENDATION_MISS');
  });

  it('CONVERSION fires on behavioral confidence above low with zero orders', () => {
    expect(matchIntent({ ...BASE_INPUTS, behavioralLevel: 'medium', totalOrders: 0 }).matchedIntent).toBe('CONVERSION');
  });

  it('MATCHED is the default for any quiz taker CONVERSION doesn\'t catch (Liam L2, Part A, D5)', () => {
    expect(matchIntent(BASE_INPUTS).matchedIntent).toBe('MATCHED');
  });

  it('MATCHED never fires ahead of CONVERSION for a customer CONVERSION would also match', () => {
    expect(matchIntent({ ...BASE_INPUTS, behavioralLevel: 'high', totalOrders: 0 }).matchedIntent).toBe('CONVERSION');
  });

  it('Liam L3, Part D — an already-asked thread falls through to MATCHED instead of re-firing PROFILE_AMBIGUOUS', () => {
    const result = matchIntent({ ...BASE_INPUTS, exploreArchetype: 'Fruity', threadAsked: true });
    expect(result.matchedIntent).toBe('MATCHED');
    expect(result.triggersFired).not.toContain('PROFILE_AMBIGUOUS');
  });

  it('EXPLORATION is last — reached only by a customer with no quiz (quizCount 0) who clicked in or browsed', () => {
    const result = matchIntent({ ...BASE_INPUTS, quizCount: 0, userInitiated: true });
    expect(result.matchedIntent).toBe('EXPLORATION');
  });

  it('needsSommelier-false case: no quiz, not clicked in, no other rule fires', () => {
    expect(matchIntent({ ...BASE_INPUTS, quizCount: 0 }).matchedIntent).toBeNull();
  });

  it('an inactive intent is skipped even when its rule would otherwise match', () => {
    const result = matchIntent(
      { ...BASE_INPUTS, behavioralLevel: 'medium' }, // matches both CONVERSION and MATCHED
      DEFAULT_EVALUATOR_RULE_PRIORITY,
      (name) => name !== 'CONVERSION'
    );
    expect(result.matchedIntent).toBe('MATCHED');
  });
});

describe('router change measured on the 37-case Hoboken calibration table (Liam L2, Part E)', () => {
  const rows = measureRouter();

  it('has all 37 cases', () => {
    expect(rows).toHaveLength(37);
  });

  it('zero cases end with no intent after the change (was 22 before)', () => {
    expect(rows.filter(r => r.before === null)).toHaveLength(22);
    expect(rows.filter(r => r.after === null)).toHaveLength(0);
  });

  it('every previously-unmatched case becomes MATCHED (no real behavioral data in this fixture to split off CONVERSION)', () => {
    const previouslyUnmatched = rows.filter(r => r.before === null);
    expect(previouslyUnmatched.every(r => r.after === 'MATCHED')).toBe(true);
  });

  it('exactly 5 of the 9 experimental (gate-open) cases move from DISCOVERY_SEEKER to PROFILE_AMBIGUOUS', () => {
    const experimentalCases = rows.filter(r => r.experimental);
    expect(experimentalCases).toHaveLength(9);
    const movedToAmbiguous = experimentalCases.filter(r => r.before === 'DISCOVERY_SEEKER' && r.after === 'PROFILE_AMBIGUOUS');
    const stayedDiscovery = experimentalCases.filter(r => r.before === 'DISCOVERY_SEEKER' && r.after === 'DISCOVERY_SEEKER');
    expect(movedToAmbiguous).toHaveLength(5);
    expect(stayedDiscovery).toHaveLength(4);
  });

  it('every already-PROFILE_AMBIGUOUS case is unchanged', () => {
    const alreadyAmbiguous = rows.filter(r => r.before === 'PROFILE_AMBIGUOUS');
    expect(alreadyAmbiguous.every(r => r.after === 'PROFILE_AMBIGUOUS')).toBe(true);
  });
});
