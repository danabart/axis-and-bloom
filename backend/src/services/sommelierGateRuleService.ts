// Liam answer layer (2026-10-25), Part A5 — the one writer of
// sommelier_gate_rule and sommelier_gate_rule_example (the seed and the
// gate:rules:apply script come through here too). Cloned from
// sommelierAnswerService: an edit is a new row that supersedes the key's
// current row in one transaction; a retire sets superseded_at with no
// successor; nothing is updated in place or deleted.
//
// The rule tests run inside the write: before the caller commits, every
// current example of every active rule (the one being written included) goes
// through steps 2 and 3 of the gate with the confirmation stubbed to its
// expected_label (sommelierGate.exampleFailures). One mismatch throws, so the
// caller's transaction rolls back, and the error names the message. A rule
// whose answer_key has no current answer row, whose resolver is not in the
// code registry, or whose topic_key is not a config topic is refused.
// backend/src/features/ai_agent_liam/answer_layer/CLAUDE_CODE_PROMPT_LIAM_ANSWER_LAYER.md
import { withTransaction, type Tx } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';
import { DEFAULT_SOMMELIER_CONFIG } from '../db/seeds/sommelier_config_seed.js';
import { clearGateRulesCache, getActiveRules, getAnswer, getExamples } from './sommelierReads.js';
import { RESOLVERS, exampleFailures, gateLabels } from './sommelierGate.js';

export class SommelierGateRuleError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'SommelierGateRuleError';
  }
}
const invalid = (message: string) => new SommelierGateRuleError(400, 'SOMMELIER_GATE_RULE_INVALID', message);

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

export interface GateExampleInput {
  message: string;
  /** lookup_value.value in sommelier_gate_expectation. */
  expectation: 'must_match' | 'must_not_match';
  /** The label the confirmation should return; NULL is read as judgment. */
  expectedLabel: string | null;
  note?: string | null;
}

export interface SetRuleInput {
  key: string;
  priority: number;
  /** lookup_value.value in sommelier_gate_resolver, and a key of sommelierGate.RESOLVERS. */
  resolver: string;
  answerKey?: string | null;
  topicKey: string;
  keywords: string[];
  maxMessageChars?: number | null;
  note?: string | null;
  createdBy: string;
  /** Given: they replace the rule's current examples. Omitted on an edit: the current examples carry over to the new row. */
  examples?: GateExampleInput[];
  /** 'new' refuses a key that has a current row; 'edit' refuses one that has none. Omitted: either. */
  expect?: 'new' | 'edit';
}

export interface SetRuleResult { key: string; id: number; supersededId: number | null; examples: number }

/** The config topics a rule may name (the live config, else the seed's before the listener has loaded). */
export function knownTopicKeys(): string[] {
  return Object.keys(getSommelierConfig()?.topics ?? DEFAULT_SOMMELIER_CONFIG.topics ?? {});
}

function defaultMaxChars(): number {
  return getSommelierConfig()?.gate?.maxMessageChars ?? DEFAULT_SOMMELIER_CONFIG.gate.maxMessageChars;
}

async function lookupId(tx: Tx, category: string, value: string): Promise<number> {
  const r = await tx.query<{ id: number }>(`SELECT id FROM lookup_value WHERE category = $1 AND value = $2`, [category, value]);
  if (!r.rows[0]) {
    const known = await tx.query<{ value: string }>(`SELECT value FROM lookup_value WHERE category = $1 ORDER BY sort_order`, [category]);
    throw invalid(`unknown ${category} '${value}' (known: ${known.rows.map(k => k.value).join(', ')})`);
  }
  return r.rows[0].id;
}

/** Runs the rule tests on the transaction's current state; throws naming the first failing message. */
export async function assertRuleTests(tx: Tx): Promise<void> {
  const rules = await getActiveRules(tx);
  const examples = await getExamples(null, tx);
  const labels = new Set(gateLabels(rules));
  const unknown = examples.filter(e => e.expected_label !== null && !labels.has(e.expected_label));
  if (unknown.length) {
    throw invalid(`rule tests failed: "${unknown[0].message}" (${unknown[0].rule_key}) expects label '${unknown[0].expected_label}', which no active rule has (labels: ${[...labels].join(', ')})`);
  }
  const failures = exampleFailures(rules, examples, defaultMaxChars());
  if (failures.length) {
    throw invalid(`rule tests failed (${failures.length}): ${failures[0]}${failures.length > 1 ? ` (and ${failures.length - 1} more)` : ''}`);
  }
}

async function insertExamples(tx: Tx, ruleId: number, examples: GateExampleInput[]): Promise<number> {
  let n = 0;
  for (const ex of examples) {
    const message = String(ex.message ?? '').trim();
    if (!message) throw invalid('an example message must not be empty');
    const expectationId = await lookupId(tx, 'sommelier_gate_expectation', ex.expectation);
    await tx.query(
      `INSERT INTO sommelier_gate_rule_example (rule_id, message, expectation_id, expected_label, since, note)
       VALUES ($1, $2, $3, $4, clock_timestamp(), $5)`,
      [ruleId, message, expectationId, ex.expectedLabel?.trim() || null, ex.note?.trim() || null]
    );
    n++;
  }
  return n;
}

/**
 * Inside a caller's transaction. With a current row for the key: closes it
 * and inserts the successor; without one: inserts a new key. Then the rule
 * tests run; a failure throws and the caller's transaction rolls back.
 * `deferTests`: a caller writing several rules in one transaction (whose
 * examples may name each other's labels) runs assertRuleTests once at the end.
 */
export async function setRuleInTx(tx: Tx, input: SetRuleInput, opts: { deferTests?: boolean } = {}): Promise<SetRuleResult> {
  const key = String(input.key ?? '').trim();
  if (!KEY_RE.test(key)) throw invalid('key must be snake_case: lowercase letters, digits and underscores, starting with a letter');
  if (!Number.isInteger(input.priority)) throw invalid('priority must be a whole number');
  const createdBy = String(input.createdBy ?? '').trim();
  if (!createdBy) throw invalid('createdBy is required');
  const resolver = String(input.resolver ?? '').trim();
  if (!RESOLVERS[resolver]) throw invalid(`resolver '${resolver}' is not in the code registry (${Object.keys(RESOLVERS).join(', ')})`);
  const resolverId = await lookupId(tx, 'sommelier_gate_resolver', resolver);
  const answerKey = input.answerKey?.trim() || null;
  if (RESOLVERS[resolver].takesAnswer) {
    if (!answerKey) throw invalid(`a rule with resolver ${resolver} needs an answerKey`);
    if (!(await getAnswer(answerKey, tx))) throw invalid(`answerKey '${answerKey}' has no current sommelier_answer row`);
  } else if (answerKey) {
    throw invalid(`only resolvers ${Object.keys(RESOLVERS).filter(k => RESOLVERS[k].takesAnswer).join(' and ')} take an answerKey (got '${answerKey}' with '${resolver}')`);
  }
  const topicKey = String(input.topicKey ?? '').trim();
  const topics = knownTopicKeys();
  if (!topics.includes(topicKey)) throw invalid(`topicKey '${topicKey}' is not a config topic (${topics.join(', ')})`);
  const keywords = [...new Set((input.keywords ?? []).map(k => String(k).trim().toLowerCase()).filter(Boolean))];
  if (!keywords.length) throw invalid('a rule needs at least one keyword');
  const maxChars = input.maxMessageChars ?? null;
  if (maxChars !== null && !(Number.isInteger(maxChars) && maxChars > 0)) throw invalid('maxMessageChars must be a positive whole number or empty');

  const closed = await tx.query<{ id: number }>(
    `UPDATE sommelier_gate_rule SET superseded_at = clock_timestamp()
      WHERE key = $1 AND superseded_at IS NULL RETURNING id`,
    [key]
  );
  const prev = closed.rows[0] ?? null;
  if (prev && input.expect === 'new') throw new SommelierGateRuleError(409, 'SOMMELIER_GATE_RULE_EXISTS', `'${key}' already has a current rule; edit it instead`);
  if (!prev && input.expect === 'edit') throw new SommelierGateRuleError(404, 'SOMMELIER_GATE_RULE_UNKNOWN', `'${key}' has no current rule`);

  const inserted = await tx.query<{ id: number }>(
    `INSERT INTO sommelier_gate_rule (key, priority, resolver_id, answer_key, topic_key, keywords, max_message_chars, since, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp(), $8, $9) RETURNING id`,
    [key, input.priority, resolverId, answerKey, topicKey, keywords, maxChars, input.note?.trim() || null, createdBy]
  );
  const id = inserted.rows[0].id;

  // Examples: the given list replaces the old row's; otherwise they carry over.
  let carried: GateExampleInput[] = [];
  if (prev) {
    const old = await tx.query<{ message: string; expectation: 'must_match' | 'must_not_match'; expected_label: string | null; note: string | null }>(
      `UPDATE sommelier_gate_rule_example e SET superseded_at = clock_timestamp()
         FROM lookup_value ev
        WHERE ev.id = e.expectation_id AND e.rule_id = $1 AND e.superseded_at IS NULL
        RETURNING e.message, ev.value AS expectation, e.expected_label, e.note`,
      [prev.id]
    );
    carried = old.rows.map(r => ({ message: r.message, expectation: r.expectation, expectedLabel: r.expected_label, note: r.note }));
  }
  const examples = await insertExamples(tx, id, input.examples ?? carried);

  if (!opts.deferTests) await assertRuleTests(tx);
  return { key, id, supersededId: prev?.id ?? null, examples };
}

export interface SetExampleInput extends GateExampleInput { ruleKey: string }

/** Inside a caller's transaction: adds (or replaces, by message) one example of a current rule, then runs the rule tests. */
export async function setExampleInTx(tx: Tx, input: SetExampleInput): Promise<{ id: number; supersededId: number | null }> {
  const rule = (await getActiveRules(tx)).find(r => r.key === input.ruleKey);
  if (!rule) throw new SommelierGateRuleError(404, 'SOMMELIER_GATE_RULE_UNKNOWN', `'${input.ruleKey}' has no current rule`);
  const message = String(input.message ?? '').trim();
  if (!message) throw invalid('an example message must not be empty');
  const closed = await tx.query<{ id: number }>(
    `UPDATE sommelier_gate_rule_example SET superseded_at = clock_timestamp()
      WHERE rule_id = $1 AND message = $2 AND superseded_at IS NULL RETURNING id`,
    [rule.id, message]
  );
  const expectationId = await lookupId(tx, 'sommelier_gate_expectation', input.expectation);
  const r = await tx.query<{ id: number }>(
    `INSERT INTO sommelier_gate_rule_example (rule_id, message, expectation_id, expected_label, since, note)
     VALUES ($1, $2, $3, $4, clock_timestamp(), $5) RETURNING id`,
    [rule.id, message, expectationId, input.expectedLabel?.trim() || null, input.note?.trim() || null]
  );
  await assertRuleTests(tx);
  return { id: r.rows[0].id, supersededId: closed.rows[0]?.id ?? null };
}

/** Inside a caller's transaction: the key's current row and its examples get superseded_at and no successor; the remaining rules' tests must still pass. */
export async function retireRuleInTx(tx: Tx, input: { key: string; createdBy: string }): Promise<{ key: string; retiredId: number }> {
  const key = String(input.key ?? '').trim();
  if (!String(input.createdBy ?? '').trim()) throw invalid('createdBy is required');
  const r = await tx.query<{ id: number }>(
    `UPDATE sommelier_gate_rule SET superseded_at = clock_timestamp()
      WHERE key = $1 AND superseded_at IS NULL RETURNING id`,
    [key]
  );
  if (!r.rows[0]) throw new SommelierGateRuleError(404, 'SOMMELIER_GATE_RULE_UNKNOWN', `'${key}' has no current rule`);
  await tx.query(
    `UPDATE sommelier_gate_rule_example SET superseded_at = clock_timestamp() WHERE rule_id = $1 AND superseded_at IS NULL`,
    [r.rows[0].id]
  );
  await assertRuleTests(tx);
  return { key, retiredId: r.rows[0].id };
}

/** One transaction for a list of rules (gate:rules:apply), then this process's cache is cleared. */
export async function setRules(inputs: SetRuleInput[]): Promise<SetRuleResult[]> {
  try {
    return await withTransaction(async tx => {
      const out: SetRuleResult[] = [];
      for (const input of inputs) out.push(await setRuleInTx(tx, input, { deferTests: true }));
      await assertRuleTests(tx);
      return out;
    });
  } finally {
    clearGateRulesCache();
  }
}
