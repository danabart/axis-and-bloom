// Liam answer layer (2026-10-25), Part B — the gate in front of Sonnet.
// backend/src/features/ai_agent_liam/answer_layer/CLAUDE_CODE_PROMPT_LIAM_ANSWER_LAYER.md
//
// Inside POST /:sessionId/message, after the guards and routeTopic and before
// the profile/story/current-coffee reads, tryGate() decides whether a simple
// question is answered from one row instead of by Sonnet:
//   1. eligibility: gate.enabled, not the opening turn, not the closing turns;
//   2. candidate: the lowest-priority active rule whose keyword is in the
//      message (lower(message).includes(keyword), as topicRouter matches);
//      only a keyword matched in this message counts — the topic router's
//      sticky carry-forward never makes a message a candidate;
//   3. confirmation: one Haiku call returns { label, alias, confidence };
//      the label must be the candidate's and confidence >= the threshold;
//   4. coffee resolution (catalog_price): the alias against the session's
//      candidates, else the session's last recommendation; one coffee only;
//   5. resolve: a brand answer verbatim, or one catalog/customer row;
//   6. phrase: data rows become at most two Haiku sentences, sanitized;
//   7. the route records the turn (Firestore, ledger, write-back skipped).
// Anything unconfirmed, compound, ambiguous, unparsed or guard-blocked returns
// { gated: false } and the turn goes to Sonnet exactly as before: every tie
// goes to Sonnet. Resolvers only read; no roaster name reaches any output.
//
// runGateOffline() is Part C, the nightly labeller (routes/cron.ts).
import Anthropic from '@anthropic-ai/sdk';
import { db, type Tx } from '../db/client.js';
import { getSommelierConfig, type SommelierConfig } from './sommelierConfig.js';
import { guardClaudeCallMetered, type ClaudeUsage } from './anthropicGuard.js';
import {
  getActiveRules, getCurrentAnswers, getExamples, getUnlabelledModelTurns, getReplayedExampleIds,
  type GateRuleRow, type GateExampleRow, type SommelierAnswerRow,
} from './sommelierReads.js';
import { recordLabel, recordReplay } from './sommelierTurnService.js';
import { resolveAlias, type AliasCandidate } from './liamWriteBack.js';
import { getCatalogBlock, getAliases, catalogBlockConfig, type CatalogCoffee } from './sommelierRag.js';
import { getLastRecommendation, getSubscriptionCurrent, getCustomerIdentity } from './customerReads.js';
import { answerContentViolations } from './sommelierIntegrity.js';
import { parseAndStripMarkers } from './claude.js';
import { firestoreDb } from './firebase-admin.js';

type Runner = Tx | typeof db;
type GateConfig = NonNullable<SommelierConfig['gate']>;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** The resolver registry: the code half of lookup category sommelier_gate_resolver. `phrased` resolvers go through Haiku. */
export const RESOLVERS: Record<string, { phrased: boolean }> = {
  answer: { phrased: false },
  catalog_price: { phrased: true },
  catalog_category: { phrased: true },
  customer_subscription: { phrased: true },
};
export const JUDGMENT = 'judgment';
const UNPARSED = 'unparsed';

/** A rule's label: its answer key for resolver answer, else the resolver name. */
export function ruleLabel(rule: Pick<GateRuleRow, 'resolver' | 'answer_key'>): string {
  return rule.resolver === 'answer' ? (rule.answer_key ?? '') : rule.resolver;
}

/** Every label the confirmation may return for these rules, plus judgment. */
export function gateLabels(rules: Array<Pick<GateRuleRow, 'resolver' | 'answer_key'>>): string[] {
  return [...new Set(rules.map(ruleLabel).filter(Boolean)), JUDGMENT];
}

// ── Step 2: candidate ────────────────────────────────────────────────────────

export function matchCandidate(message: string, rules: GateRuleRow[]): { rule: GateRuleRow; keyword: string } | null {
  const lower = message.toLowerCase();
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  for (const rule of ordered) {
    const keyword = rule.keywords.find(k => k.trim() && lower.includes(k.toLowerCase()));
    if (keyword) return { rule, keyword };
  }
  return null;
}

/** Steps 2 and 3 with the confirmation's label given: the rule key that would answer, or null (Sonnet). Pure. */
export function gatedRuleFor(message: string, rules: GateRuleRow[], label: string, defaultMaxChars: number): string | null {
  const candidate = matchCandidate(message, rules);
  if (!candidate) return null;
  if (message.length > (candidate.rule.max_message_chars ?? defaultMaxChars)) return null;
  return label === ruleLabel(candidate.rule) ? candidate.rule.key : null;
}

/**
 * The rule tests: every example through steps 2 and 3 with the confirmation
 * stubbed to its expected_label. must_match passes when its own rule answers;
 * must_not_match when its rule does not (another rule, or the model, may).
 * Returns one line per failing example (empty = all pass). Pure.
 */
export function exampleFailures(
  rules: GateRuleRow[],
  examples: Array<Pick<GateExampleRow, 'rule_key' | 'message' | 'expectation' | 'expected_label'>>,
  defaultMaxChars: number
): string[] {
  const out: string[] = [];
  for (const ex of examples) {
    const gated = gatedRuleFor(ex.message, rules, ex.expected_label ?? JUDGMENT, defaultMaxChars);
    if (ex.expectation === 'must_match' && gated !== ex.rule_key) {
      const candidate = matchCandidate(ex.message, rules);
      const why = !candidate ? 'no rule keyword matches it'
        : candidate.rule.key !== ex.rule_key ? `rule ${candidate.rule.key} (priority ${candidate.rule.priority}) matches it first`
        : ex.message.length > (candidate.rule.max_message_chars ?? defaultMaxChars) ? 'it is longer than the rule allows'
        : `expected_label '${ex.expected_label}' is not the rule's label '${ruleLabel(candidate.rule)}'`;
      out.push(`"${ex.message}" (${ex.rule_key}, must_match): goes to the model, ${why}`);
    }
    if (ex.expectation === 'must_not_match' && gated === ex.rule_key) {
      out.push(`"${ex.message}" (${ex.rule_key}, must_not_match): the rule answers it`);
    }
  }
  return out;
}

// ── Step 3: confirmation ─────────────────────────────────────────────────────

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m));

function substituteSupport(text: string, cfg: SommelierConfig | null): string {
  const contact = cfg?.brandFacts?.supportContact;
  return contact ? text.replace(/\{supportContact\}/g, contact) : text;
}

/** The label lines of the confirmation prompt: an answer label is described by its own text, a resolver by config. */
export function renderLabelLines(rules: GateRuleRow[], answers: SommelierAnswerRow[], cfg: SommelierConfig | null): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    const label = ruleLabel(rule);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    if (rule.resolver === 'answer') {
      const answer = answers.find(a => a.key === rule.answer_key);
      if (!answer) continue;
      lines.push(`- ${label}: the customer asks something this reply fully answers: "${substituteSupport(answer.answer_text, cfg).replace(/\{firstName\},?\s*/g, '')}"`);
    } else {
      lines.push(`- ${label}: the customer ${cfg?.gate?.resolverDescriptions?.[label] ?? label.replace(/_/g, ' ')}`);
    }
  }
  return lines.join('\n');
}

export interface ConfirmParsed { label: string; alias: string | null; confidence: number }

/** The first JSON object in the model's output, or null. A missing or non-numeric confidence counts as 0. */
export function parseConfirm(text: string): ConfirmParsed | null {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { label?: unknown; alias?: unknown; confidence?: unknown };
    if (typeof o.label !== 'string' || !o.label.trim()) return null;
    const alias = typeof o.alias === 'string' && o.alias.trim() && o.alias.trim().toLowerCase() !== 'null' ? o.alias.trim() : null;
    const confidence = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : 0;
    return { label: o.label.trim(), alias, confidence };
  } catch {
    return null;
  }
}

export interface HaikuCall { text: string; usage: ClaudeUsage | null; usdMicros: number; model: string }
export type HaikuCaller = (args: { model: string; maxTokens: number; prompt: string; purpose: 'confirm' | 'phrase' | 'label' }) => Promise<HaikuCall>;

/** One Haiku call through the spend guard (feature liam_chat). Throws ClaudeGuardBlockedError when blocked. */
export const callHaiku: HaikuCaller = async ({ model, maxTokens, prompt }) => {
  const { response, usage, usdMicros } = await guardClaudeCallMetered('liam_chat', model, () =>
    client.messages.create({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  );
  const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  return { text, usage, usdMicros, model };
};

export function buildConfirmPrompt(args: {
  cfg: SommelierConfig | null; rules: GateRuleRow[]; answers: SommelierAnswerRow[];
  aliases: string[]; previous: string; message: string;
}): string {
  return fill(args.cfg?.gate?.confirmPrompt ?? '', {
    labels: renderLabelLines(args.rules, args.answers, args.cfg),
    aliases: args.aliases.length ? args.aliases.join('; ') : '(none)',
    previous: args.previous.trim() || '(none: the conversation just started)',
    message: args.message,
  });
}

// ── Steps 4 to 6 ─────────────────────────────────────────────────────────────

export interface GateDeps {
  runner?: Runner;
  haiku?: HaikuCaller;
  /** The catalog coffees the resolvers read (default: the shared catalog block's). */
  catalogCoffees?: () => Promise<CatalogCoffee[]>;
  roasterNames?: () => Promise<string[]>;
  config?: SommelierConfig | null;
}

async function loadRoasterNames(runner: Runner): Promise<string[]> {
  const r = await runner.query<{ name: string }>(`SELECT name FROM roaster WHERE name IS NOT NULL`);
  return r.rows.map(x => x.name);
}

/** True when the text names a roaster (the same whole-phrase rule as answer content rule 2). */
export function namesRoaster(text: string, roasterNames: string[]): boolean {
  return answerContentViolations(text, { roasterNames, aliases: [] }).some(v => v.rule === 2);
}

function sumUsage(calls: HaikuCall[]): ClaudeUsage {
  return calls.reduce<ClaudeUsage>((acc, c) => ({
    input_tokens: acc.input_tokens + (c.usage?.input_tokens ?? 0),
    output_tokens: acc.output_tokens + (c.usage?.output_tokens ?? 0),
    cache_creation_input_tokens: (acc.cache_creation_input_tokens ?? 0) + (c.usage?.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (acc.cache_read_input_tokens ?? 0) + (c.usage?.cache_read_input_tokens ?? 0),
  }), { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
}

/** At most `n` sentences of `text`. */
export function firstSentences(text: string, n: number): string {
  const parts = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, n).join(' ').trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface ResolvedRow {
  /** Verbatim reply (resolver answer) or the facts Haiku phrases. */
  text: string;
  phrased: boolean;
  coffeeId: number | null;
  answerId: number | null;
}

/** Step 5 for one resolver. null = the resolver has nothing true to say: Sonnet. */
export async function resolveRule(args: {
  rule: GateRuleRow; uid: string; message: string; coffeeId: number | null;
  answers: SommelierAnswerRow[]; coffees: () => Promise<CatalogCoffee[]>; cfg: SommelierConfig | null; runner: Runner;
}): Promise<ResolvedRow | null> {
  const { rule, cfg } = args;
  if (rule.resolver === 'answer') {
    const answer = args.answers.find(a => a.key === rule.answer_key);
    if (!answer) return null;
    let text = substituteSupport(answer.answer_text, cfg);
    if (text.includes('{firstName}')) {
      const name = (await getCustomerIdentity(args.uid, args.runner))?.firstName?.trim();
      text = name ? text.replace(/\{firstName\}/g, name) : text.replace(/,?\s*\{firstName\}/g, '');
    }
    if (text.includes('{supportContact}')) return null; // no contact configured: never say a placeholder
    return { text, phrased: false, coffeeId: null, answerId: answer.id };
  }
  if (rule.resolver === 'catalog_price') {
    if (args.coffeeId === null) return null;
    const coffee = (await args.coffees()).find(c => c.id === args.coffeeId);
    if (!coffee || !coffee.sizes.length) return null;
    const form = catalogBlockConfig().sizesForm;
    const sizes = coffee.sizes.map(s => `${s.label} $${(s.cents / 100).toFixed(2)}`).join('; ');
    return { text: `Coffee: ${coffee.alias}\nSizes and prices${form ? ` (${form})` : ''}: ${sizes}`, phrased: true, coffeeId: coffee.id, answerId: null };
  }
  if (rule.resolver === 'catalog_category') {
    const coffees = await args.coffees();
    const categories = new Map<string, string>();
    for (const c of coffees) for (const cat of c.categories) categories.set(cat.code, cat.label);
    const msg = norm(args.message);
    const asked = [...categories].filter(([code, label]) => msg.includes(norm(code)) || msg.includes(norm(label)));
    if (!asked.length) return null;
    const lines = asked.map(([code, label]) => {
      const names = coffees.filter(c => c.categories.some(x => x.code === code)).map(c => c.alias);
      return `${label} coffees we sell: ${names.join('; ')}`;
    });
    return { text: lines.join('\n'), phrased: true, coffeeId: null, answerId: null };
  }
  if (rule.resolver === 'customer_subscription') {
    const sub = await getSubscriptionCurrent(args.uid, args.runner);
    if (!sub) return null;
    return { text: `The customer's subscription status: ${sub.status}${sub.sponsored ? ' (a sponsored subscription)' : ''}`, phrased: true, coffeeId: null, answerId: null };
  }
  return null;
}

function sessionCandidates(ctx: Record<string, unknown>): AliasCandidate[] {
  const raw = Array.isArray(ctx.storyCandidates) ? ctx.storyCandidates as Array<{ coffeeId: number; alias: string }> : [];
  return raw.filter(c => c && typeof c.alias === 'string').map(c => ({ coffeeId: c.coffeeId, alias: c.alias }));
}

/**
 * The session's candidate aliases: context_data.storyCandidates (since Liam
 * sees everything brief Rev 2, the whole catalog, set at /start and kept
 * current by refreshCatalogSnapshotIfStale); a session older than that with
 * no candidates falls back to getAliases(ctx.coffeeIds).
 */
export async function candidateAliases(ctx: Record<string, unknown>, runner: Runner = db): Promise<AliasCandidate[]> {
  const fromCtx = sessionCandidates(ctx);
  if (fromCtx.length) return fromCtx;
  const ids = Array.isArray(ctx.coffeeIds) ? (ctx.coffeeIds as number[]) : [];
  if (!ids.length) return [];
  const map = await getAliases(ids, runner);
  return [...map].map(([coffeeId, alias]) => ({ coffeeId, alias }));
}

/** Step 4: the alias against the candidates (an alias two coffees share is ambiguous), else the session's last recommendation. */
export async function resolveCoffee(alias: string | null, candidates: AliasCandidate[], sessionId: number, runner: Runner): Promise<number | null> {
  if (alias) {
    const n = alias.trim().toLowerCase();
    const ids = new Set(candidates.filter(c => c.alias.trim().toLowerCase() === n).map(c => c.coffeeId));
    if (ids.size !== 1) return null;
    return resolveAlias(alias, candidates);
  }
  const last = await getLastRecommendation(sessionId, runner);
  return last.length === 1 ? last[0] : null;
}

export type GateOutcome =
  | {
      gated: true;
      reply: string;
      route: 'gate' | 'gate_haiku';
      modelUsed: 'gate' | 'gate:haiku';
      model: string;
      ruleId: number;
      ruleKey: string;
      confirmLabel: string;
      confirmConfidence: number;
      coffeeId: number | null;
      answerId: number | null;
      usage: ClaudeUsage;
      usdMicros: number;
      latencyMs: number;
      answersVersion: number | null;
    }
  | {
      gated: false;
      reason: string;
      /** Set when a candidate reached the confirmation: recorded on the model row. */
      ruleId: number | null;
      confirmLabel: string | null;
      confirmConfidence: number | null;
      /** What the gate already spent this turn (added to the model row's cost). */
      usdMicros: number;
    };

export interface TryGateInput {
  uid: string;
  sessionId: number;
  message: string;
  turnCount: number;
  maxTurns: number;
  ctx: Record<string, unknown>;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Steps 1 to 6. Never throws: an unexpected error is logged and the turn goes to Sonnet. */
export async function tryGate(input: TryGateInput, deps: GateDeps = {}): Promise<GateOutcome> {
  const notGated = (reason: string, extra: Partial<Extract<GateOutcome, { gated: false }>> = {}): GateOutcome =>
    ({ gated: false, reason, ruleId: null, confirmLabel: null, confirmConfidence: null, usdMicros: 0, ...extra });
  const cfg = deps.config !== undefined ? deps.config : getSommelierConfig();
  const gate = cfg?.gate as GateConfig | undefined;
  const runner = deps.runner ?? db;
  const haiku = deps.haiku ?? callHaiku;

  // Step 1 — eligibility.
  if (!gate?.enabled) return notGated('disabled');
  if (input.turnCount < 1) return notGated('opening_turn');
  const closingTurns = cfg?.sessionLimits?.closingTurns ?? 2;
  if (input.maxTurns - input.turnCount <= closingTurns) return notGated('closing_turns');

  const calls: HaikuCall[] = [];
  const spent = () => calls.reduce((s, c) => s + c.usdMicros, 0);
  let candidateRule: GateRuleRow | null = null;
  let parsed: ConfirmParsed | null = null;
  try {
    // Step 2 — candidate.
    const rules = await getActiveRules(deps.runner);
    const candidate = matchCandidate(input.message, rules);
    if (!candidate) return notGated('no_candidate');
    candidateRule = candidate.rule;
    if (input.message.length > (candidate.rule.max_message_chars ?? gate.maxMessageChars ?? 160)) return notGated('too_long', { ruleId: candidate.rule.id });
    if (!RESOLVERS[candidate.rule.resolver]) return notGated('unknown_resolver', { ruleId: candidate.rule.id });

    // Step 3 — confirmation.
    const answers = await getCurrentAnswers(deps.runner);
    const candidates = await candidateAliases(input.ctx, runner);
    const previous = [...input.history].reverse().find(h => h.role === 'assistant')?.content ?? '';
    const startedAt = Date.now();
    const confirm = await haiku({
      model: gate.confirmModel, maxTokens: gate.confirmMaxTokens ?? 40, purpose: 'confirm',
      prompt: buildConfirmPrompt({ cfg, rules, answers, aliases: candidates.map(c => c.alias), previous, message: input.message }),
    });
    calls.push(confirm);
    parsed = parseConfirm(confirm.text);
    const label = ruleLabel(candidate.rule);
    const base = { ruleId: candidate.rule.id, confirmLabel: parsed?.label ?? null, confirmConfidence: parsed?.confidence ?? null };
    if (!parsed) return notGated('unparsed', { ...base, usdMicros: spent() });
    if (parsed.label !== label) return notGated(parsed.label === JUDGMENT ? 'judgment' : 'label_mismatch', { ...base, usdMicros: spent() });
    if (parsed.confidence < (gate.confirmThreshold ?? 0.8)) return notGated('low_confidence', { ...base, usdMicros: spent() });

    // Step 4 — coffee resolution (catalog_price only).
    let coffeeId: number | null = null;
    if (candidate.rule.resolver === 'catalog_price') {
      coffeeId = await resolveCoffee(parsed.alias, candidates, input.sessionId, runner);
      if (coffeeId === null) return notGated('no_coffee', { ...base, usdMicros: spent() });
    }

    // Step 5 — resolve.
    const coffees = deps.catalogCoffees ?? (async () => (await getCatalogBlock()).coffees);
    const row = await resolveRule({ rule: candidate.rule, uid: input.uid, message: input.message, coffeeId, answers, coffees, cfg, runner });
    if (!row) return notGated('nothing_to_say', { ...base, usdMicros: spent() });
    const roasterNames = await (deps.roasterNames ?? (() => loadRoasterNames(runner)))();
    if (namesRoaster(row.text, roasterNames)) {
      console.error(`[liam:GATE] resolver ${candidate.rule.resolver} output named a roaster; sent to the model instead`);
      return notGated('roaster_in_row', { ...base, usdMicros: spent() });
    }

    // Step 6 — phrase (data rows only).
    let reply = row.text;
    if (row.phrased) {
      const recent = input.history.slice(-2).map(h => `${h.role === 'user' ? 'Customer' : 'Liam'}: ${h.content}`).join('\n');
      const phrase = await haiku({
        model: gate.phraseModel ?? gate.confirmModel, maxTokens: gate.phraseMaxTokens ?? 120, purpose: 'phrase',
        prompt: fill(gate.phrasePrompt ?? '', { facts: row.text, history: recent || '(none)', message: input.message }),
      });
      calls.push(phrase);
      reply = firstSentences(parseAndStripMarkers(phrase.text, 0).reply, 2);
      if (!reply || namesRoaster(reply, roasterNames)) return notGated(reply ? 'roaster_in_reply' : 'empty_phrase', { ...base, usdMicros: spent() });
    }

    const answersVersion = answers.length ? Math.max(...answers.map(a => a.id)) : null;
    return {
      gated: true,
      reply,
      route: row.phrased ? 'gate_haiku' : 'gate',
      modelUsed: row.phrased ? 'gate:haiku' : 'gate',
      model: gate.confirmModel,
      ruleId: candidate.rule.id,
      ruleKey: candidate.rule.key,
      confirmLabel: parsed.label,
      confirmConfidence: parsed.confidence,
      coffeeId: row.coffeeId,
      answerId: row.answerId,
      usage: sumUsage(calls),
      usdMicros: spent(),
      latencyMs: Date.now() - startedAt,
      answersVersion,
    };
  } catch (err) {
    // A guard block or any unexpected error: Sonnet answers, as before the gate.
    console.error('[liam:GATE] fell through to the model', err instanceof Error ? err.message : err);
    return notGated('error', {
      ruleId: candidateRule?.id ?? null, confirmLabel: parsed?.label ?? null, confirmConfidence: parsed?.confidence ?? null, usdMicros: spent(),
    });
  }
}

// ── Part C — the nightly labeller ────────────────────────────────────────────

export interface OfflineDeps {
  runner?: Runner;
  haiku?: HaikuCaller;
  config?: SommelierConfig | null;
  /** The customer message and the assistant reply before it, from the Firestore transcript. */
  readTranscript?: (t: { uid: string; sessionId: number; userMessageId: string }) => Promise<{ message: string; previous: string } | null>;
  /** The coffee names the labeller shows Haiku (default: the shared catalog block's aliases). */
  catalogAliases?: () => Promise<string[]>;
  /** Default: yesterday, UTC. */
  window?: { from: Date; to: Date };
  /** Replays already written since this instant are not repeated. Default: today 00:00 UTC. */
  replaySince?: Date;
  now?: Date;
}

export interface OfflineResult { skipped?: string; turns: number; labelled: number; misses: number; replayed: number; replayAgreed: number; replayTotal: number }

async function readTranscriptFromFirestore(t: { uid: string; sessionId: number; userMessageId: string }): Promise<{ message: string; previous: string } | null> {
  const col = firestoreDb.collection(`users/${t.uid}/sommelier_sessions/${t.sessionId}/messages`);
  const doc = await col.doc(t.userMessageId).get();
  if (!doc.exists) return null;
  const data = doc.data() as { content?: string; seq?: number };
  let previous = '';
  if (typeof data.seq === 'number') {
    const prev = await col.where('seq', '==', data.seq - 1).limit(1).get();
    previous = (prev.docs[0]?.data() as { content?: string } | undefined)?.content ?? '';
  }
  return { message: data.content ?? '', previous };
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * 1. Labels yesterday's model turns that have no label from this labeler
 *    model (one Haiku call each, the confirmation prompt with every active
 *    rule's label); a gate label on a model turn is a miss.
 * 2. Replays every current example once per UTC day through the real
 *    confirmation, agreed = (label === expected_label).
 * 3. Logs [liam:OFFLINE] turns=… labelled=… misses=… replay_agreement=….
 * A guard block stops the run where it is (logged); what was written stays.
 */
export async function runGateOffline(deps: OfflineDeps = {}): Promise<OfflineResult> {
  const cfg = deps.config !== undefined ? deps.config : getSommelierConfig();
  const offline = cfg?.gate?.offline;
  const result: OfflineResult = { turns: 0, labelled: 0, misses: 0, replayed: 0, replayAgreed: 0, replayTotal: 0 };
  if (!offline?.enabled) {
    console.log('[liam:OFFLINE] skipped: gate.offline.enabled is false');
    return { ...result, skipped: 'disabled' };
  }
  const runner = deps.runner ?? db;
  const haiku = deps.haiku ?? callHaiku;
  const readTranscript = deps.readTranscript ?? readTranscriptFromFirestore;
  const model = offline.model;
  const now = deps.now ?? new Date();
  const today = startOfUtcDay(now);
  const window = deps.window ?? { from: new Date(today.getTime() - 86_400_000), to: today };

  const rules = await getActiveRules(deps.runner);
  const answers = await getCurrentAnswers(deps.runner);
  const labels = new Set(gateLabels(rules));
  const aliases = deps.catalogAliases
    ? await deps.catalogAliases()
    : (await getCatalogBlock().catch(() => ({ coffees: [] as CatalogCoffee[] }))).coffees.map(c => c.alias);
  const label = async (message: string, previous: string): Promise<string> => {
    const call = await haiku({
      model, maxTokens: cfg?.gate?.confirmMaxTokens ?? 40, purpose: 'label',
      prompt: buildConfirmPrompt({ cfg, rules, answers, aliases, previous, message }),
    });
    const parsed = parseConfirm(call.text);
    return parsed && labels.has(parsed.label) ? parsed.label : UNPARSED;
  };

  try {
    const turns = await getUnlabelledModelTurns({ from: window.from, to: window.to, labelerModel: model }, runner);
    result.turns = turns.length;
    for (const t of turns) {
      const transcript = await readTranscript({ uid: t.uid, sessionId: t.session_id, userMessageId: t.user_message_id }).catch(() => null);
      if (!transcript?.message) continue;
      const l = await label(transcript.message, transcript.previous);
      if (await recordLabel({ turnId: t.id, label: l, labelerModel: model }, runner)) {
        result.labelled++;
        if (l !== JUDGMENT && l !== UNPARSED) result.misses++;
      }
    }

    const examples = await getExamples(null, runner);
    const done = await getReplayedExampleIds({ since: deps.replaySince ?? today, labelerModel: model }, runner);
    for (const ex of examples) {
      if (done.has(ex.id)) continue;
      const l = await label(ex.message, '');
      const agreed = l === (ex.expected_label ?? JUDGMENT);
      if (await recordReplay({ exampleId: ex.id, label: l, agreed, labelerModel: model }, runner)) {
        result.replayed++;
        result.replayTotal++;
        if (agreed) result.replayAgreed++;
      }
    }
  } catch (err) {
    console.error('[liam:OFFLINE] stopped early', err instanceof Error ? err.message : err);
  }
  console.log(`[liam:OFFLINE] turns=${result.turns} labelled=${result.labelled} misses=${result.misses} replay_agreement=${result.replayAgreed}/${result.replayTotal}`);
  return result;
}
