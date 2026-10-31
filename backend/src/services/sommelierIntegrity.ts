import { readFileSync } from 'node:fs';
import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { getCoffees, getSlotsForCoffees } from './catalogReads.js';
import {
  getCurrentAnswers, getTurnsForSession, getActiveRules, getExamples,
  getCurrentCases, getPhrasings, getAllCurrentChecks, getStaleRuns,
  type SommelierAnswerRow, type GateRuleRow, type GateExampleRow,
  type EvalCaseRow, type EvalPhrasingRow, type ReplyCheckRow,
} from './sommelierReads.js';
import { getCatalogBlock } from './sommelierRag.js';
import { fixtureProblems } from '../fixtures/liam_eval/index.js';
import { getSommelierConfig } from './sommelierConfig.js';
import { RESOLVERS, exampleFailures } from './sommelierGate.js';
import { firestoreDb } from './firebase-admin.js';

// ── Liam brand answers (brief Rev 3, Part A6, 2026-10-24) — integrity ───────
// Clone of catalogIntegrity.ts's shape. Read-only, never writes or repairs;
// non-fatal at boot ([sommelier-integrity]), a System Health card, a vitest
// file. Checks 2-4 are also the content rules sommelierAnswerService enforces
// on every write (answerContentViolation, below), so a failing row here was
// written by hand in SQL or by the seed. Checks 6-10 are the gate's (Liam
// answer layer, Part D, 2026-10-25; the brief's gate checks 1-5), and check 5
// covers the gated ledger rows (the brief's gate check 6). Checks 11-15 are
// the evals' (Liam answer evals, Part E, 2026-10-25; the brief's 1-5).
// backend/src/features/ai_agent_liam/brand_prices_cart_cutoff/CLAUDE_CODE_PROMPT_LIAM_BRAND_PRICES_CART_CUTOFF.md

type Runner = Tx | typeof db;

// The module that writes "order" at checkout (lineage.json module name).
export const CHECKOUT_ORDER_WRITER = 'checkoutService';

export interface SommelierIntegrityCheck {
  id: number;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  details?: string[];
}

export interface SommelierIntegrityReport {
  ranAt: string;
  allPass: boolean;
  currentAnswers: number;
  checks: SommelierIntegrityCheck[];
}

/** The words an answer must never contain: roaster names and coffee aliases (the alias source getAliases uses). */
export interface AnswerVocabulary {
  roasterNames: string[];
  aliases: string[];
}

export async function loadAnswerVocabulary(runner: Runner = db): Promise<AnswerVocabulary> {
  const roasters = await runner.query<{ name: string }>(`SELECT name FROM roaster WHERE name IS NOT NULL`);
  const coffees = await getCoffees({}, runner);
  const slots = await getSlotsForCoffees(coffees.map(c => c.id), runner);
  const aliases = new Set<string>();
  for (const s of slots) if (s.slot_name) aliases.add(s.slot_name);
  for (const c of coffees) if (c.name) aliases.add(c.name); // getAliases' fallback, and the raw name
  return { roasterNames: roasters.rows.map(r => r.name), aliases: [...aliases] };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function containsPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

// Check 3: a price, a size or a count. `$` anywhere, "oz" anywhere, or a
// number beside a unit. Those live in views (v_coffee_sellable_slot,
// coffee_size); an answer that quotes one drifts from the catalog.
const UNIT = '(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|kilos?|bags?|cups?|dollars?|usd|cents?|%|percent|days?|hours?|weeks?|months?|years?|roasteries|roasters|coffees|origins|farms)';
const PRICE_SIZE_COUNT = [
  { re: /\$/, why: 'a $ amount' },
  { re: /\boz\b/i, why: 'a size in oz' },
  { re: new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*${UNIT}(?![\\p{L}])`, 'iu'), why: 'a number beside a unit' },
];

export interface ContentViolation { rule: 2 | 3 | 4; ruleName: string; match: string }

export const CONTENT_RULE_NAMES: Record<2 | 3 | 4, string> = {
  2: 'no roaster name',
  3: 'no price, size or count',
  4: 'no coffee alias',
};

/** Every content rule the text breaks (empty when clean). Pure: the vocabulary is passed in. */
export function answerContentViolations(text: string, vocab: AnswerVocabulary): ContentViolation[] {
  const out: ContentViolation[] = [];
  for (const name of vocab.roasterNames) {
    if (containsPhrase(text, name)) out.push({ rule: 2, ruleName: CONTENT_RULE_NAMES[2], match: name });
  }
  for (const p of PRICE_SIZE_COUNT) {
    const m = p.re.exec(text);
    if (m) { out.push({ rule: 3, ruleName: CONTENT_RULE_NAMES[3], match: `${p.why}: "${m[0]}"` }); break; }
  }
  for (const alias of vocab.aliases) {
    if (containsPhrase(text, alias)) out.push({ rule: 4, ruleName: CONTENT_RULE_NAMES[4], match: alias });
  }
  return out;
}

// Keys config names and that must therefore have a current row. The gate
// rules' answer keys are checked by check 6 against the live rules.
export const REQUIRED_ANSWER_KEYS: string[] = [];

function checkOneCurrentPerKey(rows: SommelierAnswerRow[]): SommelierIntegrityCheck {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  const details = [
    ...[...counts].filter(([, n]) => n > 1).map(([k, n]) => `${k}: ${n} current rows`),
    ...REQUIRED_ANSWER_KEYS.filter(k => !counts.has(k)).map(k => `${k}: no current row (named by a rule)`),
  ];
  return {
    id: 1,
    name: 'Exactly one current row per key, and every key a rule names has one',
    pass: details.length === 0,
    expected: 'one current row per key',
    actual: details.length === 0 ? `${counts.size} key(s), one current row each` : `${details.length} problem(s)`,
    details: details.length ? details : undefined,
  };
}

function contentCheck(id: 2 | 3 | 4, name: string, rows: SommelierAnswerRow[], vocab: AnswerVocabulary): SommelierIntegrityCheck {
  const details = rows.flatMap(r =>
    answerContentViolations(r.answer_text, vocab).filter(v => v.rule === id).map(v => `${r.key}: ${v.match}`)
  );
  return {
    id,
    name,
    pass: details.length === 0,
    expected: `no current answer breaks "${CONTENT_RULE_NAMES[id]}"`,
    actual: details.length === 0 ? 'none' : `${details.length} finding(s)`,
    details: details.length ? details : undefined,
  };
}

// ── Check 5 (Liam sees everything brief Rev 2, C5, 2026-10-24) — the turn
// ledger reconciles with the session and the transcript. For every session
// active in the window: one ledger row per reply, i.e. rows = turn_count
// (the opening reply is turn 0 and sets turn_count to 1, so the opening is
// already counted; the brief's "plus one for the opening" double-counts it),
// turns 0..turn_count-1 with no gap, and every row's assistant_message_id is
// a message in the Firestore transcript. Sessions started before the ledger
// shipped (no rows at all) are skipped, not failed.
export interface LedgerSession { sessionId: number; uid: string; turnCount: number; startedAt: Date; closeReason?: string | null }
export interface LedgerReconcileInput {
  sessions: LedgerSession[];
  turnsBySession: Map<number, Array<{ turn: number; assistant_message_id: string; route?: string }>>;
  transcriptIdsBySession: Map<number, Set<string>>;
  /** modelUsed of each transcript message, by session (the gate check: a gated row's reply says gate). */
  transcriptModelBySession?: Map<number, Map<string, string | null>>;
}

export function reconcileLedger(input: LedgerReconcileInput): SommelierIntegrityCheck {
  const details: string[] = [];
  let checked = 0;
  for (const s of input.sessions) {
    const rows = input.turnsBySession.get(s.sessionId) ?? [];
    if (!rows.length) continue; // pre-ledger session
    checked++;
    // A daily-cap close is a guard reply that does not advance turn_count.
    const expected = s.turnCount + (s.closeReason === 'daily_cap' ? 1 : 0);
    if (rows.length !== expected) details.push(`session ${s.sessionId}: ${rows.length} ledger row(s), expected ${expected} (turn_count ${s.turnCount})`);
    const turns = new Set(rows.map(r => r.turn));
    for (let t = 0; t < s.turnCount; t++) if (!turns.has(t)) { details.push(`session ${s.sessionId}: no ledger row for turn ${t}`); break; }
    const ids = input.transcriptIdsBySession.get(s.sessionId);
    if (ids) {
      const missing = rows.filter(r => !ids.has(r.assistant_message_id));
      if (missing.length) details.push(`session ${s.sessionId}: ${missing.length} ledger row(s) whose reply is not in the transcript (turn ${missing.map(m => m.turn).join(', ')})`);
    }
    // Liam answer layer: a gate / gate_haiku row's reply is tagged modelUsed gate*.
    const models = input.transcriptModelBySession?.get(s.sessionId);
    if (models) {
      const untagged = rows.filter(r => (r.route === 'gate' || r.route === 'gate_haiku')
        && models.has(r.assistant_message_id) && !String(models.get(r.assistant_message_id) ?? '').startsWith('gate'));
      if (untagged.length) details.push(`session ${s.sessionId}: ${untagged.length} gated ledger row(s) whose reply is not tagged modelUsed gate (turn ${untagged.map(m => m.turn).join(', ')})`);
    }
  }
  return {
    id: 5,
    name: 'The turn ledger reconciles with the session and the transcript (last 24 hours)',
    pass: details.length === 0,
    expected: 'ledger rows = turn_count, every reply in the transcript, gated replies tagged gate',
    actual: details.length === 0 ? `${checked} session(s) reconciled` : `${details.length} problem(s)`,
    details: details.length ? details : undefined,
  };
}

async function loadLedgerReconcileInput(sinceHours: number, runner: Runner): Promise<LedgerReconcileInput> {
  const sessions = (await runner.query<{ id: number; uid: string; turn_count: number; started_at: Date; close_reason: string | null }>(
    `SELECT id, uid, turn_count, started_at, close_reason FROM sommelier_sessions WHERE last_active_at >= now() - make_interval(hours => $1)`,
    [sinceHours]
  )).rows.map(r => ({ sessionId: r.id, uid: r.uid, turnCount: r.turn_count, startedAt: r.started_at, closeReason: r.close_reason }));
  const turnsBySession = new Map<number, Array<{ turn: number; assistant_message_id: string; route?: string }>>();
  const transcriptIdsBySession = new Map<number, Set<string>>();
  const transcriptModelBySession = new Map<number, Map<string, string | null>>();
  for (const s of sessions) {
    const rows = await getTurnsForSession(s.sessionId, runner);
    turnsBySession.set(s.sessionId, rows.map(r => ({ turn: r.turn, assistant_message_id: r.assistant_message_id, route: r.route })));
    if (!rows.length) continue;
    try {
      const snap = await firestoreDb.collection(`users/${s.uid}/sommelier_sessions/${s.sessionId}/messages`).select('modelUsed').get();
      transcriptIdsBySession.set(s.sessionId, new Set(snap.docs.map(d => d.id)));
      transcriptModelBySession.set(s.sessionId, new Map(snap.docs.map(d => [d.id, (d.get('modelUsed') as string | undefined) ?? null])));
    } catch (err) {
      console.error(`[sommelier-integrity] transcript read failed for session ${s.sessionId}`, err);
    }
  }
  return { sessions, turnsBySession, transcriptIdsBySession, transcriptModelBySession };
}

// ── Checks 6-10 (Liam answer layer, Part D, 2026-10-25) — the gate rules.
// Report only. Pure over the given input; runSommelierIntegrityChecks loads
// the live rules, examples, config topics and lineage.json.
export interface GateCheckInput {
  rules: GateRuleRow[];
  examples: GateExampleRow[];
  answers: SommelierAnswerRow[];
  /** config/sommelier topics: key -> { mode, keywords }. null = config not loaded. */
  topics: Record<string, { mode?: string; keywords?: string[] }> | null;
  defaultMaxChars: number;
  /** lineage.json's writers of table order (null = lineage.json not readable). */
  orderWriters: Array<{ module: string; verbs: string[] }> | null;
}

function check(id: number, name: string, expected: string, details: string[], okActual: string): SommelierIntegrityCheck {
  return { id, name, pass: details.length === 0, expected, actual: details.length === 0 ? okActual : `${details.length} problem(s)`, details: details.length ? details : undefined };
}

export function runGateChecks(input: GateCheckInput): SommelierIntegrityCheck[] {
  const { rules, examples, answers, topics } = input;

  // 6 — a rule whose resolver takes an answer (answer, customer_orders) names a key with exactly one current answer row.
  const answerCounts = new Map<string, number>();
  for (const a of answers) answerCounts.set(a.key, (answerCounts.get(a.key) ?? 0) + 1);
  const c6 = rules.filter(r => RESOLVERS[r.resolver]?.takesAnswer).flatMap(r => {
    const n = answerCounts.get(r.answer_key ?? '') ?? 0;
    return n === 1 ? [] : [`${r.key}: answer key '${r.answer_key}' has ${n} current row(s)`];
  });

  // 7 — a resolver the code registry knows, and a topic config has.
  const c7 = rules.flatMap(r => [
    ...(RESOLVERS[r.resolver] ? [] : [`${r.key}: resolver '${r.resolver}' is not in the code registry`]),
    ...(topics === null ? [] : r.topic_key && topics[r.topic_key] ? [] : [`${r.key}: topic '${r.topic_key}' is not a config topic`]),
  ]);

  // 8 — every current example passes today (the write door's test).
  const c8 = exampleFailures(rules, examples, input.defaultMaxChars);

  // 9 — no rule keyword is also a keyword of an expertise topic.
  const expertise = new Map<string, string>();
  for (const [key, t] of Object.entries(topics ?? {})) {
    if (t?.mode !== 'expertise') continue;
    for (const k of t.keywords ?? []) expertise.set(k.trim().toLowerCase(), key);
  }
  const c9 = rules.flatMap(r => r.keywords
    .filter(k => expertise.has(k.trim().toLowerCase()))
    .map(k => `${r.key}: keyword '${k}' is also a keyword of expertise topic ${expertise.get(k.trim().toLowerCase())}`));

  // 10 — order_status says no status (an answer verbatim, or customer_orders:
  // what and when plus that answer) only while nothing but checkout writes
  // orders. lineage.json is table-level: a writer of order other than the
  // checkout INSERT is reported as a possible fulfillment_status writer, for a
  // person to look at. Commerce 1 (2026-10-31): the checkout insert is
  // services/checkoutService.ts (the Stripe webhook's completeCheckoutSession);
  // "order" stays insert-only (D11) and later order states are order_event rows,
  // which Liam does not read yet (OPEN_TASKS).
  const c10: string[] = [];
  const orderRule = rules.find(r => r.key === 'order_status');
  if (orderRule?.resolver === 'answer' || orderRule?.resolver === 'customer_orders') {
    if (input.orderWriters === null) c10.push('lineage.json not readable; the order writers are unknown');
    else {
      const others = input.orderWriters.filter(w => !(w.module === CHECKOUT_ORDER_WRITER && w.verbs.every(v => v === 'INSERT')));
      for (const w of others) c10.push(`order has a writer besides the checkout insert (${w.module}: ${w.verbs.join(', ')}); if it writes fulfillment_status, order_status could say it`);
    }
  }

  return [
    check(6, 'Every answer rule names a key with exactly one current answer', 'one current answer per rule', c6, `${rules.filter(r => RESOLVERS[r.resolver]?.takesAnswer).length} answer rule(s) resolve`),
    check(7, 'Every rule names a known resolver and a config topic', 'resolver in the registry, topic in config', c7, `${rules.length} rule(s) checked${topics === null ? ' (topics not checked: config/sommelier not loaded)' : ''}`),
    check(8, "Every active rule's examples pass", 'every example routes as expected', c8, `${examples.length} example(s) pass`),
    check(9, 'No rule keyword is an expertise topic keyword', 'no shared keywords', c9, 'none shared'),
    check(10, 'order_status says no status only while checkout is the only order writer', 'no order writer besides checkout', c10, orderRule ? `rule ${orderRule.resolver}; checkout is the only order writer` : 'no order_status rule'),
  ];
}

// ── Checks 11-15 (Liam answer evals, Part E, 2026-10-25) — the eval set.
// Report only. Pure over the given input; runSommelierIntegrityChecks loads it.
export interface EvalCheckInput {
  cases: EvalCaseRow[];
  phrasings: EvalPhrasingRow[];
  /** Every current check: the cases' and the global ones (case_id NULL). */
  checks: ReplyCheckRow[];
  answers: SommelierAnswerRow[];
  /** The aliases in the current catalog block (null = the block could not be read). */
  catalogAliases: string[] | null;
  /** Runs older than 2 hours with finished_at NULL. */
  staleRunIds: number[];
}

/** The check kinds whose value must be non-empty text. */
const TEXT_VALUE_KINDS = new Set(['must_contain', 'must_not_contain', 'must_not_claim', 'judge']);

export function runEvalChecks(input: EvalCheckInput): SommelierIntegrityCheck[] {
  const { cases, phrasings, checks, answers } = input;
  const current = new Set(answers.map(a => a.key));
  const aliases = input.catalogAliases ? new Set(input.catalogAliases.map(a => a.trim().toLowerCase())) : null;
  const caseKey = new Map(cases.map(c => [c.id, c.key] as const));

  // 11 — every case has at least one phrasing and one check.
  const c11 = cases.flatMap(c => [
    ...(phrasings.some(p => p.case_id === c.id) ? [] : [`${c.key}: no current phrasing`]),
    ...(checks.some(ch => ch.case_id === c.id) ? [] : [`${c.key}: no current check`]),
  ]);

  // 12 — every check's value (and every case's coffee alias) resolves.
  const where = (ch: ReplyCheckRow) => (ch.case_id === null ? 'global' : caseKey.get(ch.case_id) ?? `case ${ch.case_id}`);
  const c12: string[] = [];
  for (const ch of checks) {
    if (ch.kind === 'must_contain_answer') {
      for (const key of (ch.value ?? '').split('|').map(k => k.trim())) {
        if (!current.has(key)) c12.push(`${where(ch)} #${ch.id}: answer key '${key}' has no current row`);
      }
    }
    if (ch.kind === 'must_contain_price_of' && aliases && !aliases.has((ch.value ?? '').trim().toLowerCase())) c12.push(`${where(ch)} #${ch.id}: "${ch.value}" is not in the catalog block`);
    if (TEXT_VALUE_KINDS.has(ch.kind) && !(ch.value ?? '').trim()) c12.push(`${where(ch)} #${ch.id}: ${ch.kind} has no value`);
  }
  for (const c of cases) {
    if (c.catalog_alias && aliases && !aliases.has(c.catalog_alias.trim().toLowerCase())) c12.push(`${c.key}: coffee "${c.catalog_alias}" is not in the catalog block`);
  }
  if (!aliases) c12.push('the catalog block could not be read; aliases not checked');

  // 13 — every fixture a case names exists and parses.
  const c13 = [...new Set(cases.map(c => c.fixture_key))].flatMap(k => fixtureProblems(k));

  // 14 — no run older than 2 hours left unfinished.
  const c14 = input.staleRunIds.map(id => `run ${id} started more than 2 hours ago and never finished`);

  // 15 — the one global check that must never be retired is there.
  const c15 = checks.some(ch => ch.case_id === null && ch.kind === 'must_not_name_roaster') ? [] : ['no current global must_not_name_roaster check'];

  return [
    check(11, 'Every eval case has a phrasing and a check', 'at least one of each per case', c11, `${cases.length} case(s), ${phrasings.length} phrasing(s)`),
    check(12, 'Every eval check value resolves', 'answer keys current, aliases in the catalog, phrases non-empty', c12, `${checks.length} check(s) resolve`),
    check(13, 'Every eval fixture exists and parses', 'each named fixture in fixtures/liam_eval', c13, `${new Set(cases.map(c => c.fixture_key)).size} fixture(s) load`),
    check(14, 'No eval run left unfinished for more than 2 hours', 'finished_at set', c14, 'none'),
    check(15, 'The global roaster-name check is present', 'a current global must_not_name_roaster', c15, 'present'),
  ];
}

async function loadEvalCheckInput(runner: Runner | undefined, answers: SommelierAnswerRow[]): Promise<EvalCheckInput> {
  const r = runner ?? db;
  let catalogAliases: string[] | null = null;
  try { catalogAliases = (await getCatalogBlock()).coffees.map(c => c.alias); } catch { catalogAliases = null; }
  return {
    cases: await getCurrentCases(r),
    phrasings: await getPhrasings(null, r),
    checks: await getAllCurrentChecks(r),
    answers,
    catalogAliases,
    staleRunIds: (await getStaleRuns(2, r)).map(x => x.id),
  };
}

/** lineage.json's writers of table order, or null. */
export function loadOrderWriters(): Array<{ module: string; verbs: string[] }> | null {
  try {
    const lineage = JSON.parse(readFileSync(new URL('../../lineage.json', import.meta.url), 'utf8')) as {
      tables?: Record<string, { writers?: Array<{ module: string; verbs: string[] }> }>;
    };
    return lineage.tables?.order?.writers ?? [];
  } catch {
    return null;
  }
}

async function loadGateCheckInput(runner: Runner | undefined, answers: SommelierAnswerRow[]): Promise<GateCheckInput> {
  const cfg = getSommelierConfig();
  return {
    rules: await getActiveRules(runner),
    examples: await getExamples(null, runner ?? db),
    answers,
    topics: (cfg?.topics as GateCheckInput['topics']) ?? null,
    defaultMaxChars: cfg?.gate?.maxMessageChars ?? 160,
    orderWriters: loadOrderWriters(),
  };
}

/** Runs on `rows`/`vocab` when given (fixtures), else on the live current rows. */
export async function runSommelierIntegrityChecks(
  input: { rows?: SommelierAnswerRow[]; vocab?: AnswerVocabulary; runner?: Runner; ledger?: LedgerReconcileInput; gate?: GateCheckInput; evals?: EvalCheckInput } = {}
): Promise<SommelierIntegrityReport> {
  const rows = input.rows ?? await getCurrentAnswers(input.runner);
  const vocab = input.vocab ?? await loadAnswerVocabulary(input.runner);
  let ledgerCheck: SommelierIntegrityCheck;
  try {
    ledgerCheck = reconcileLedger(input.ledger ?? await loadLedgerReconcileInput(24, input.runner ?? db));
  } catch (err) {
    ledgerCheck = { id: 5, name: 'The turn ledger reconciles with the session and the transcript (last 24 hours)', pass: false, expected: 'a reconciliation', actual: `could not run: ${err instanceof Error ? err.message : String(err)}` };
  }
  let gateChecks: SommelierIntegrityCheck[];
  try {
    gateChecks = runGateChecks(input.gate ?? await loadGateCheckInput(input.runner, rows));
  } catch (err) {
    gateChecks = [{ id: 6, name: 'The gate rules could be checked', pass: false, expected: 'the gate checks', actual: `could not run: ${err instanceof Error ? err.message : String(err)}` }];
  }
  let evalChecks: SommelierIntegrityCheck[];
  try {
    evalChecks = runEvalChecks(input.evals ?? await loadEvalCheckInput(input.runner, rows));
  } catch (err) {
    evalChecks = [{ id: 11, name: 'The eval set could be checked', pass: false, expected: 'the eval checks', actual: `could not run: ${err instanceof Error ? err.message : String(err)}` }];
  }
  const checks = [
    checkOneCurrentPerKey(rows),
    contentCheck(2, 'No answer names a roaster (the leak check)', rows, vocab),
    contentCheck(3, 'No answer quotes a price, a size or a count', rows, vocab),
    contentCheck(4, 'No answer names a coffee alias', rows, vocab),
    ledgerCheck,
    ...gateChecks,
    ...evalChecks,
  ];
  return { ranAt: new Date().toISOString(), allPass: checks.every(c => c.pass), currentAnswers: rows.length, checks };
}

export function formatSommelierIntegrityLog(report: SommelierIntegrityReport): string[] {
  return report.checks.filter(c => !c.pass).map(c =>
    `[sommelier-integrity] check #${c.id} failed — ${c.name}: expected ${c.expected}, got ${c.actual}${c.details ? ` (${c.details.join('; ')})` : ''}`
  );
}
