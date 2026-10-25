import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { getCoffees, getSlotsForCoffees } from './catalogReads.js';
import { getCurrentAnswers, getTurnsForSession, type SommelierAnswerRow } from './sommelierReads.js';
import { firestoreDb } from './firebase-admin.js';

// ── Liam brand answers (brief Rev 3, Part A6, 2026-10-24) — integrity ───────
// Clone of catalogIntegrity.ts's shape. Read-only, never writes or repairs;
// non-fatal at boot ([sommelier-integrity]), a System Health card, a vitest
// file. Checks 2-4 are also the content rules sommelierAnswerService enforces
// on every write (answerContentViolation, below), so a failing row here was
// written by hand in SQL or by the seed. Brief 3 adds the gate's checks.
// backend/src/features/ai_agent_liam/brand_prices_cart_cutoff/CLAUDE_CODE_PROMPT_LIAM_BRAND_PRICES_CART_CUTOFF.md

type Runner = Tx | typeof db;

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

// Keys a rule or config names and that must therefore have a current row.
// Empty until Brief 3 (the gate) names some; check 1 reports duplicates today.
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
  turnsBySession: Map<number, Array<{ turn: number; assistant_message_id: string }>>;
  transcriptIdsBySession: Map<number, Set<string>>;
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
  }
  return {
    id: 5,
    name: 'The turn ledger reconciles with the session and the transcript (last 24 hours)',
    pass: details.length === 0,
    expected: 'ledger rows = turn_count, every reply in the transcript',
    actual: details.length === 0 ? `${checked} session(s) reconciled` : `${details.length} problem(s)`,
    details: details.length ? details : undefined,
  };
}

async function loadLedgerReconcileInput(sinceHours: number, runner: Runner): Promise<LedgerReconcileInput> {
  const sessions = (await runner.query<{ id: number; uid: string; turn_count: number; started_at: Date; close_reason: string | null }>(
    `SELECT id, uid, turn_count, started_at, close_reason FROM sommelier_sessions WHERE last_active_at >= now() - make_interval(hours => $1)`,
    [sinceHours]
  )).rows.map(r => ({ sessionId: r.id, uid: r.uid, turnCount: r.turn_count, startedAt: r.started_at, closeReason: r.close_reason }));
  const turnsBySession = new Map<number, Array<{ turn: number; assistant_message_id: string }>>();
  const transcriptIdsBySession = new Map<number, Set<string>>();
  for (const s of sessions) {
    const rows = await getTurnsForSession(s.sessionId, runner);
    turnsBySession.set(s.sessionId, rows.map(r => ({ turn: r.turn, assistant_message_id: r.assistant_message_id })));
    if (!rows.length) continue;
    try {
      const snap = await firestoreDb.collection(`users/${s.uid}/sommelier_sessions/${s.sessionId}/messages`).select().get();
      transcriptIdsBySession.set(s.sessionId, new Set(snap.docs.map(d => d.id)));
    } catch (err) {
      console.error(`[sommelier-integrity] transcript read failed for session ${s.sessionId}`, err);
    }
  }
  return { sessions, turnsBySession, transcriptIdsBySession };
}

/** Runs on `rows`/`vocab` when given (fixtures), else on the live current rows. */
export async function runSommelierIntegrityChecks(
  input: { rows?: SommelierAnswerRow[]; vocab?: AnswerVocabulary; runner?: Runner; ledger?: LedgerReconcileInput } = {}
): Promise<SommelierIntegrityReport> {
  const rows = input.rows ?? await getCurrentAnswers(input.runner);
  const vocab = input.vocab ?? await loadAnswerVocabulary(input.runner);
  let ledgerCheck: SommelierIntegrityCheck;
  try {
    ledgerCheck = reconcileLedger(input.ledger ?? await loadLedgerReconcileInput(24, input.runner ?? db));
  } catch (err) {
    ledgerCheck = { id: 5, name: 'The turn ledger reconciles with the session and the transcript (last 24 hours)', pass: false, expected: 'a reconciliation', actual: `could not run: ${err instanceof Error ? err.message : String(err)}` };
  }
  const checks = [
    checkOneCurrentPerKey(rows),
    contentCheck(2, 'No answer names a roaster (the leak check)', rows, vocab),
    contentCheck(3, 'No answer quotes a price, a size or a count', rows, vocab),
    contentCheck(4, 'No answer names a coffee alias', rows, vocab),
    ledgerCheck,
  ];
  return { ranAt: new Date().toISOString(), allPass: checks.every(c => c.pass), currentAnswers: rows.length, checks };
}

export function formatSommelierIntegrityLog(report: SommelierIntegrityReport): string[] {
  return report.checks.filter(c => !c.pass).map(c =>
    `[sommelier-integrity] check #${c.id} failed — ${c.name}: expected ${c.expected}, got ${c.actual}${c.details ? ` (${c.details.join('; ')})` : ''}`
  );
}
