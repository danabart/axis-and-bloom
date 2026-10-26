// Liam answer evals (2026-10-25), Part C — the eval runner and graders.
// backend/src/features/ai_agent_liam/answer_evals/CLAUDE_CODE_PROMPT_LIAM_ANSWER_EVALS.md
//
// runEvals() asks every current phrasing of every current case as the case's
// fixture customer would, through the functions production calls: the
// session context from sessionRagFromReads / fetchSommelierCoffees /
// buildProfileLine (as /start), the turn context from routeTopic /
// messageTurnContext (as /message), the gate's tryGate first (with the
// fixture's customer reads), then chatWithSommelier on a Sonnet route. The
// reply is graded by the global checks and the case's checks (code first;
// Haiku as judge for judge rows and the must_contain_answer fallback) and
// recorded. It writes the eval tables only, through sommelierEvalService:
// no session, no transcript, no ledger row, no customer fact (the Claude spend
// guard still books the cost in claude_daily_spend, as for every call).
//
// addCustomerPhrasings() is C5: gated customer messages become phrasings of
// the case whose rule_key names the gate rule, de-duplicated and capped.
import { createHash } from 'node:crypto';
import { db, withTransaction, type Tx } from '../db/client.js';
import { getSommelierConfig, type SommelierConfig } from './sommelierConfig.js';
import { DEFAULT_SOMMELIER_CONFIG } from '../db/seeds/sommelier_config_seed.js';
import { chatWithSommelier, loadBrandAnswersBlock, sharedTierText } from './claude.js';
import { isClaudeGuardBlocked } from './anthropicGuard.js';
import { getCatalogBlock, fetchSommelierCoffees, type CatalogBlock, type CatalogCoffee, type RagParams, type RagResult } from './sommelierRag.js';
import { routeTopic } from './topicRouter.js';
import { tryGate, callHaiku, type HaikuCaller, type CustomerReadsForGate } from './sommelierGate.js';
import {
  buildProfileLine, sessionRagFromReads, messageTurnContext, storyCandidatesFromBlock, shippingStatusLine, type ProfileReads,
} from './liamProfile.js';
import type { BrewProfileDoc } from './brewProfile.js';
import type { FeedbackCurrentRow, QuizCurrentRow, RecentOrders, TimelineEntry } from './customerReads.js';
import {
  getAnswersMaxId, getChecks, getCurrentAnswers, getCurrentCases, getPhrasings, getGatedTurnsForPhrasings,
  type EvalCaseRow, type EvalPhrasingRow, type ReplyCheckRow,
} from './sommelierReads.js';
import { finishRun, recordResult, setPhrasingInTx, startRun } from './sommelierEvalService.js';
import { runCheck, type CheckContext } from './sommelierReplyCheck.js';
import { FIXTURES, type LiamEvalFixture } from '../fixtures/liam_eval/index.js';
import { firestoreDb } from './firebase-admin.js';

type Runner = Tx | typeof db;
type EvalConfig = NonNullable<SommelierConfig['evals']>;

export function evalConfig(cfg: SommelierConfig | null): EvalConfig {
  return { ...DEFAULT_SOMMELIER_CONFIG.evals, ...(cfg?.evals ?? {}), nightly: { ...DEFAULT_SOMMELIER_CONFIG.evals.nightly, ...(cfg?.evals?.nightly ?? {}) } };
}

// ── Fixtures → ProfileReads ──────────────────────────────────────────────────

export interface FixtureContext {
  fixture: LiamEvalFixture;
  reads: ProfileReads;
  brewProfile: BrewProfileDoc | null;
  /** Fixture aliases the live catalog no longer has: every case of the fixture fails with this named. */
  missingAliases: string[];
}

/**
 * The fixture as the ProfileReads loadProfileReads() would return for such a
 * customer: coffees resolved by alias against the live catalog, orders as the
 * timeline's attributed order lines and the recent-orders read, the counts
 * from config as in production.
 */
export function fixtureReads(fixture: LiamEvalFixture, catalog: CatalogCoffee[], cfg: SommelierConfig | null): FixtureContext {
  const byAlias = new Map(catalog.map(c => [c.alias.trim().toLowerCase(), c.id] as const));
  const missing = new Set<string>();
  const idOf = (alias: string): number | null => {
    const id = byAlias.get(alias.trim().toLowerCase());
    if (id === undefined) { missing.add(alias); return null; }
    return id;
  };
  const aliasByCoffee = new Map<number, string>();
  for (const c of catalog) aliasByCoffee.set(c.id, c.alias);

  const quizCurrent: QuizCurrentRow | null = fixture.quiz ? {
    archetypeName: fixture.quiz.archetypeName, archetypeCode: null,
    secondaryArchetype: fixture.quiz.secondaryArchetype, secondaryArchetypeCode: null,
    branchedFrom: null, foodSignal: null, experimental: false, foodSignalAlignment: 'none', recommendationMode: 'primary_only',
    pairConfidence: null, exploreArchetype: null, exploreReason: null, interpretationVersion: null, interpretationSource: 'context_data',
    completedAt: new Date(fixture.quiz.completedAt), interpretationValidFrom: null,
    archetypeChangeCount: 0, quizCount: 1, archetypeChangedLastTwoQuizzes: false,
    matchArchetype: fixture.quiz.archetypeName, matchArchetypeCode: null, intensityLean: null, branchAnswerCode: null,
  } : null;
  const feedbackCurrent: FeedbackCurrentRow[] = fixture.feedback.flatMap((f, i) => {
    const coffeeId = idOf(f.coffeeAlias);
    return coffeeId === null ? [] : [{
      feedbackEventId: `fixture-${fixture.key}-${i}`, occurredAt: new Date(f.occurredAt), orderLineItemId: null, orderId: null,
      coffeeId, rating: f.rating, expectation: null, rawText: f.rawText, channel: 'fixture', source: 'fixture',
      sentiment: f.sentiment, descriptorNoteIds: [],
    }];
  });
  const orders = [...fixture.orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const timeline: TimelineEntry[] = orders.flatMap((o, i) => o.lines.map((l, j) => ({
    occurredAt: new Date(o.createdAt), kind: 'order_line', refId: `fixture-${fixture.key}-${i}-${j}`, coffeeId: idOf(l.coffeeAlias),
    slotId: null, archetypeCode: null, sessionId: null, detail: { attribution: 'self' },
  })));
  const lineCount = orders.reduce((n, o) => n + o.lines.length, 0);
  const reads: ProfileReads = {
    quizCurrent,
    brewProfile: fixture.brewProfile as ProfileReads['brewProfile'],
    feedbackCurrent,
    evidence: quizCurrent || lineCount ? { n_attributed_lines: String(lineCount), has_quiz: !!quizCurrent } : null,
    sharedTraits: [], dominantDimensions: [], archetypeSpread: [], threads: [], slotCandidates: [],
    timeline,
    aliasByCoffee,
    exploreArchetypeCode: null,
    identity: fixture.identity ? {
      firstName: fixture.identity.firstName,
      memberSince: fixture.identity.memberSince ? new Date(fixture.identity.memberSince) : null,
      householdMembers: fixture.identity.householdMembers,
    } : null,
    quizHistory: fixture.quiz ? [{ archetypeName: fixture.quiz.archetypeName, completedAt: new Date(fixture.quiz.completedAt) }] : [],
    orders: {
      recent: orders.map(o => ({ createdAt: new Date(o.createdAt), lines: o.lines.map(l => ({ coffeeId: idOf(l.coffeeAlias), weightOz: l.weightOz, quantity: l.quantity })) })),
      olderCount: 0, olderArchetypeCounts: {},
    },
    subscription: fixture.subscription,
    shipsTo: fixture.shipsTo,
    saved: [], savedSlotAlias: new Map(), brewCards: [], liamHistory: [], archetypeLabels: new Map(),
    counts: { feedbackCount: cfg?.customerBlock?.feedbackCount ?? 8 },
    shippingStatusLine: shippingStatusLine(cfg),
  };
  const brewProfile = Object.keys(fixture.brewProfile).length ? (fixture.brewProfile as unknown as BrewProfileDoc) : null;
  return { fixture, reads, brewProfile, missingAliases: [...missing] };
}

/** The gate's three customer reads, answered from the fixture (no database). */
export function fixtureCustomerReads(fixture: LiamEvalFixture, orders: RecentOrders = { recent: [], olderCount: 0, olderArchetypeCounts: {} }): CustomerReadsForGate {
  return {
    getRecentOrders: async (_uid, limit) => ({ ...orders, recent: orders.recent.slice(0, limit) }),
    getLastRecommendation: async () => [],
    getSubscriptionCurrent: async () => fixture.subscription,
    getCustomerIdentity: async () => (fixture.identity ? { firstName: fixture.identity.firstName } : null),
  };
}

// ── The judge ────────────────────────────────────────────────────────────────

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m));

/** One compact line per catalog coffee, for the judge's reference. */
export function compactCatalog(coffees: CatalogCoffee[]): string {
  return coffees.map(c => {
    const labels = c.categories.map(x => x.label).join(', ');
    const prices = c.sizes.length ? c.sizes.map(s => `${s.label} $${(s.cents / 100).toFixed(2)}`).join(', ') : 'not yet available';
    return `- ${c.alias}: ${c.archetypeLabel ?? 'no archetype'}${labels ? `; ${labels}` : ''}; ${prices}`;
  }).join('\n');
}

/** { pass, reason } from the judge's output, or null when it cannot be read (a fail, never a silent pass). */
export function parseJudge(text: string): { pass: boolean; reason: string } | null {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { pass?: unknown; reason?: unknown };
    if (typeof o.pass !== 'boolean') return null;
    return { pass: o.pass, reason: typeof o.reason === 'string' ? o.reason.trim() : '' };
  } catch {
    return null;
  }
}

// ── Grading ──────────────────────────────────────────────────────────────────

export interface Graded { passed: boolean; failedCheckIds: number[]; notes: string | null; judgeUsdMicros: number }

export async function gradeReply(args: {
  reply: string; message: string; checks: ReplyCheckRow[]; ctx: CheckContext; customerBlock: string;
  evals: EvalConfig; haiku: HaikuCaller;
}): Promise<Graded> {
  const failed: number[] = [];
  const notes: string[] = [];
  let usd = 0;
  for (const check of args.checks) {
    const r = runCheck(check, args.reply, args.ctx);
    if ('pass' in r) {
      if (!r.pass) { failed.push(check.id); notes.push(`#${check.id} ${check.kind}: ${r.detail}`); }
      continue;
    }
    const call = await args.haiku({
      model: args.evals.judgeModel, maxTokens: args.evals.judgeMaxTokens, purpose: 'judge',
      prompt: fill(args.evals.judgePrompt, {
        question: r.judge, message: args.message, reply: args.reply,
        catalog: compactCatalog(args.ctx.catalog), customer: args.customerBlock || '(nothing on file)',
      }),
    });
    usd += call.usdMicros;
    const verdict = parseJudge(call.text);
    if (!verdict) { failed.push(check.id); notes.push(`#${check.id} ${check.kind}: unparseable`); continue; }
    if (!verdict.pass) { failed.push(check.id); notes.push(`#${check.id} ${check.kind}: ${verdict.reason || 'no reason given'}`); }
  }
  return { passed: failed.length === 0, failedCheckIds: failed, notes: notes.length ? notes.join(' | ') : null, judgeUsdMicros: usd };
}

// ── The runner ───────────────────────────────────────────────────────────────

export interface EvalDeps {
  /** Reads of rules, answers, cases and the writes of runs and results (a test passes its transaction). */
  runner?: Runner;
  haiku?: HaikuCaller;
  chat?: typeof chatWithSommelier;
  config?: SommelierConfig | null;
  catalog?: () => Promise<CatalogBlock>;
  fit?: (params: RagParams) => Promise<RagResult>;
  roasterNames?: () => Promise<string[]>;
}

export interface RunSummary {
  runId: number;
  phrasings: number;
  passed: number;
  failed: number;
  skipped: number;
  usdMicros: number;
  note: string | null;
}

interface CaseWork {
  c: EvalCaseRow;
  checks: ReplyCheckRow[];
  phrasings: EvalPhrasingRow[];
  fx: FixtureContext | null;
  fixtureProblem: string | null;
  profileLine: string;
  fitText: string;
}

async function loadRoasterNames(runner: Runner): Promise<string[]> {
  const r = await runner.query<{ name: string }>(`SELECT name FROM roaster WHERE name IS NOT NULL`);
  return r.rows.map(x => x.name);
}

/** C3. Never throws for a single phrasing; a guard block stops the run (noted). */
/**
 * `only` (a manual rerun): just these phrasings, matched by case key and
 * message (ids change when a case edit supersedes its phrasings); the run
 * note says it was partial.
 */
export async function runEvals(opts: { trigger: 'nightly' | 'manual'; createdBy: string; only?: Array<{ caseKey: string; message: string }> }, deps: EvalDeps = {}): Promise<RunSummary> {
  const cfg = deps.config !== undefined ? deps.config : getSommelierConfig();
  const evals = evalConfig(cfg);
  const runner = deps.runner ?? db;
  const haiku = deps.haiku ?? callHaiku;
  const chat = deps.chat ?? chatWithSommelier;
  const block = await (deps.catalog ?? (() => getCatalogBlock()))();
  const fit = deps.fit ?? fetchSommelierCoffees;

  const { brandAnswersBlock, answersVersion } = await loadBrandAnswersBlock(cfg);
  const promptHash = createHash('sha256').update(sharedTierText({
    session: { intent: 'MATCHED', turnCount: 1, openingContext: '' }, catalogContext: block.text, mode: 'matching', config: cfg, brandAnswersBlock,
  })).digest('hex');
  const model = cfg?.modelRouting?.expertiseModelOverride ?? 'claude-sonnet-4-6';
  const runId = await startRun({
    trigger: opts.trigger, model, judgeModel: evals.judgeModel, promptHash,
    answersVersion: answersVersion ?? (await getAnswersMaxId(runner)) ?? 0,
    catalogVersion: block.version, gateEnabled: cfg?.gate?.enabled === true, createdBy: opts.createdBy,
  }, runner);

  const answers = await getCurrentAnswers(runner);
  const ctx: CheckContext = {
    roasterNames: await (deps.roasterNames ?? (() => loadRoasterNames(runner)))(),
    catalog: block.coffees, answers, supportContact: cfg?.brandFacts?.supportContact ?? null,
  };
  const globals = await getChecks(null, runner);
  const storyCandidates = storyCandidatesFromBlock(block);
  const gateConfig: SommelierConfig | null = cfg && evals.forceGate && cfg.gate ? { ...cfg, gate: { ...cfg.gate, enabled: true } } : cfg;

  // Per case: its checks, phrasings and the fixture's session context (built once, as /start would).
  const work: CaseWork[] = [];
  const notes: string[] = [];
  for (const c of await getCurrentCases(runner)) {
    const fixture = FIXTURES[c.fixture_key];
    let fx: FixtureContext | null = null;
    let fixtureProblem: string | null = null;
    let profileLine = '';
    let fitText = '';
    if (!fixture) fixtureProblem = `fixture '${c.fixture_key}' does not exist`;
    else {
      fx = fixtureReads(fixture, block.coffees, cfg);
      if (fx.missingAliases.length) fixtureProblem = `fixture '${c.fixture_key}': ${fx.missingAliases.map(a => `"${a}"`).join(', ')} not in the catalog`;
      profileLine = buildProfileLine(fx.reads);
      fitText = (await fit(sessionRagFromReads(fx.reads, fixture.intent, cfg, null).ragParams)).fitText;
    }
    if (fixtureProblem && !notes.includes(fixtureProblem)) notes.push(fixtureProblem);
    work.push({ c, checks: await getChecks(c.id, runner), phrasings: await getPhrasings(c.id, runner), fx, fixtureProblem, profileLine, fitText });
  }

  const onlyKey = (caseKey: string, message: string) => `${caseKey}|${message.trim().toLowerCase()}`;
  const wanted = opts.only ? new Set(opts.only.map(o => onlyKey(o.caseKey, o.message))) : null;
  const allItems = work.flatMap(w => w.phrasings.map(p => ({ w, p })));
  const items = wanted ? allItems.filter(({ w, p }) => wanted.has(onlyKey(w.c.key, p.message))) : allItems;
  if (wanted) notes.unshift(`partial rerun: ${items.length} of ${allItems.length} phrasings`);
  const capMicros = Math.round(evals.maxUsdPerRun * 1_000_000);
  let spent = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let stoppedBy: string | null = null;

  const runOne = async ({ w, p }: { w: CaseWork; p: EvalPhrasingRow }) => {
    if (stoppedBy || spent >= capMicros) { skipped++; return; }
    if (w.fixtureProblem || !w.fx) {
      await recordResult({ runId, phrasingId: p.id, route: 'model', reply: '', passed: false, failedCheckIds: [], judgeNotes: w.fixtureProblem, usdMicros: 0 }, runner);
      failed++;
      return;
    }
    const { fixture, brewProfile } = w.fx;
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = w.c.turn_context
      ? [{ role: 'user', content: evals.turnContextMessage }, { role: 'assistant', content: w.c.turn_context }]
      : [];
    const turnCount = history.length ? 2 : 1;
    const maxTurns = cfg?.intents?.[fixture.intent]?.maxTurns ?? cfg?.sessionLimits?.maxTurns ?? 8;
    let usd = 0;
    try {
      const topic = routeTopic(p.message, { currentTopic: null, turnsSinceMatch: 0 });
      const gate = await tryGate(
        { uid: `eval:${fixture.key}`, sessionId: 0, message: p.message, turnCount, maxTurns, ctx: { storyCandidates }, history },
        { runner: deps.runner, haiku, config: gateConfig, customer: fixtureCustomerReads(fixture, w.fx.reads.orders), catalogCoffees: async () => block.coffees, roasterNames: async () => ctx.roasterNames },
      );
      let reply: string;
      let route: string;
      if (gate.gated) {
        reply = gate.reply; route = gate.route; usd += gate.usdMicros;
      } else {
        usd += gate.usdMicros;
        const turn = messageTurnContext({ message: p.message, topic: topic.topic, brewProfile, storyCandidates, staleNudgeSent: false });
        const r = await chat({
          message: p.message,
          session: { intent: fixture.intent, turnCount, openingContext: '' },
          catalogContext: block.text, history, mode: topic.mode,
          brewProfileContext: turn.brewProfileContext, storyContext: turn.storyContext, currentCoffeeContext: undefined,
          profileLine: w.profileLine, fitContext: w.fitText,
        });
        reply = r.reply; route = 'model'; usd += r.usdMicros;
      }
      const graded = await gradeReply({ reply, message: p.message, checks: [...globals, ...w.checks], ctx, customerBlock: w.profileLine, evals, haiku });
      usd += graded.judgeUsdMicros;
      spent += usd;
      await recordResult({ runId, phrasingId: p.id, route, reply, passed: graded.passed, failedCheckIds: graded.failedCheckIds, judgeNotes: graded.notes, usdMicros: usd }, runner);
      if (graded.passed) passed++; else failed++;
    } catch (err) {
      spent += usd;
      if (isClaudeGuardBlocked(err)) { stoppedBy = `stopped by the Claude spend guard (${(err as Error).message})`; skipped++; return; }
      await recordResult({ runId, phrasingId: p.id, route: 'model', reply: '', passed: false, failedCheckIds: [], judgeNotes: `error: ${err instanceof Error ? err.message : String(err)}`, usdMicros: usd }, runner);
      failed++;
    }
  };

  // Up to evals.concurrency phrasings at a time; the cost cap is checked before each starts.
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(evals.concurrency, queue.length || 1)) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await runOne(item);
  });
  await Promise.all(workers);

  if (skipped && !stoppedBy) notes.push(`stopped at the cost cap $${evals.maxUsdPerRun.toFixed(2)}: ${skipped} phrasing(s) not graded`);
  if (stoppedBy) notes.push(`${stoppedBy}: ${skipped} phrasing(s) not graded`);
  const note = notes.length ? notes.join('; ') : null;
  await finishRun(runId, { phrasings: passed + failed, passed, failed, usdMicros: spent, note }, runner);
  console.log(`[liam:EVAL] run=${runId} phrasings=${passed + failed} passed=${passed} failed=${failed} usd=${(spent / 1_000_000).toFixed(4)}${note ? ` note="${note}"` : ''}`);
  return { runId, phrasings: passed + failed, passed, failed, skipped, usdMicros: spent, note };
}

// ── C5: phrasings grow from customers ────────────────────────────────────────

async function readUserMessage(t: { uid: string; sessionId: number; userMessageId: string }): Promise<string | null> {
  const doc = await firestoreDb.collection(`users/${t.uid}/sommelier_sessions/${t.sessionId}/messages`).doc(t.userMessageId).get();
  const content = doc.exists ? (doc.data() as { content?: string }).content : null;
  return typeof content === 'string' && content.trim() ? content.trim() : null;
}

/**
 * Gated customer turns in the window become phrasings (source customer_turn)
 * of the case whose rule_key is the turn's rule, de-duplicated per case
 * (case-insensitive) and capped at evals.maxCustomerPhrasingsPerCase current
 * customer phrasings per case.
 */
export async function addCustomerPhrasings(
  window: { from: Date; to: Date },
  deps: { runner?: Tx; config?: SommelierConfig | null; readMessage?: typeof readUserMessage } = {}
): Promise<{ candidates: number; added: number; duplicates: number; capped: number }> {
  const evals = evalConfig(deps.config !== undefined ? deps.config : getSommelierConfig());
  const read = deps.readMessage ?? readUserMessage;
  const rows = await getGatedTurnsForPhrasings(window, deps.runner ?? db);
  const out = { candidates: rows.length, added: 0, duplicates: 0, capped: 0 };
  const apply = async (tx: Tx) => {
    for (const row of rows) {
      const message = await read({ uid: row.uid, sessionId: row.session_id, userMessageId: row.user_message_id }).catch(() => null);
      if (!message) continue;
      const customerCount = (await getPhrasings(row.case_id, tx)).filter(p => p.source === 'customer_turn').length;
      if (customerCount >= evals.maxCustomerPhrasingsPerCase) { out.capped++; continue; }
      const r = await setPhrasingInTx(tx, { caseKey: row.case_key, message, source: 'customer_turn', sourceTurnId: row.turn_id, note: 'copied from a gated customer turn' });
      if (r.id) out.added++; else out.duplicates++;
    }
  };
  if (deps.runner) await apply(deps.runner); else await withTransaction(apply);
  console.log(`[liam:EVAL] customer phrasings: candidates=${out.candidates} added=${out.added} duplicates=${out.duplicates} capped=${out.capped}`);
  return out;
}
