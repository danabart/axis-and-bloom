// Liam answer evals (2026-10-25), Part C2 — the fixture customers. Invented
// people, no real customer; the shape is a compact form of
// liamProfile.ProfileReads (sommelierEval.fixtureReads builds the real
// ProfileReads from it). Coffees are named by alias and resolved against the
// live catalog block at run time; an alias that no longer exists fails the
// fixture's cases with the reason named. Imported (not read from disk) so tsc
// emits them into dist, as fixtures/quiz_calibration's JSON is.
// backend/src/features/ai_agent_liam/answer_evals/CLAUDE_CODE_PROMPT_LIAM_ANSWER_EVALS.md
import fruityHighConf from './fruity_high_conf.json' with { type: 'json' };
import noQuiz from './no_quiz.json' with { type: 'json' };
import decafOnly from './decaf_only.json' with { type: 'json' };
import twoOrdersPending from './two_orders_pending.json' with { type: 'json' };

export interface LiamEvalFixture {
  key: string;
  note: string;
  intent: string;
  identity: { firstName: string | null; memberSince: string | null; householdMembers: number } | null;
  quiz: { archetypeName: string; secondaryArchetype: string | null; completedAt: string } | null;
  brewProfile: Record<string, { value: unknown; source: 'conversation' | 'profile_page' | null; capturedAt: string | null }>;
  orders: Array<{ createdAt: string; fulfillmentStatus?: string; lines: Array<{ coffeeAlias: string; weightOz: number | null; quantity: number }> }>;
  feedback: Array<{ coffeeAlias: string; sentiment: 'positive' | 'negative' | 'neutral'; rating: number | null; rawText: string | null; occurredAt: string }>;
  subscription: { status: string; sponsored: boolean } | null;
  shipsTo: { city: string | null; state: string | null } | null;
}

export const FIXTURES: Record<string, LiamEvalFixture> = {
  fruity_high_conf: fruityHighConf as LiamEvalFixture,
  no_quiz: noQuiz as LiamEvalFixture,
  decaf_only: decafOnly as LiamEvalFixture,
  two_orders_pending: twoOrdersPending as LiamEvalFixture,
};

export const FIXTURE_KEYS = Object.keys(FIXTURES);

/** The fixture's problems (empty = parses and matches its key): integrity check 13. */
export function fixtureProblems(key: string): string[] {
  const f = FIXTURES[key];
  if (!f) return [`no fixture '${key}' in fixtures/liam_eval`];
  const out: string[] = [];
  if (f.key !== key) out.push(`fixture '${key}' says key '${f.key}'`);
  if (typeof f.intent !== 'string' || !f.intent) out.push(`fixture '${key}' has no intent`);
  if (!Array.isArray(f.orders) || !Array.isArray(f.feedback)) out.push(`fixture '${key}' orders/feedback must be lists`);
  return out;
}
