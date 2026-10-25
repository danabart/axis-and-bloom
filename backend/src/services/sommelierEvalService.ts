// Liam answer evals (2026-10-25), Part A7 — the one writer of
// sommelier_eval_case, sommelier_eval_phrasing, sommelier_reply_check,
// sommelier_eval_run and sommelier_eval_result (lint:customer rule 11; the
// seed and the admin card come through here). Cases, phrasings and checks are
// superseded, never updated in place; nothing is deleted. A run row gets one
// UPDATE, from finishRun, on its own counted columns.
// backend/src/features/ai_agent_liam/answer_evals/CLAUDE_CODE_PROMPT_LIAM_ANSWER_EVALS.md
import { db, withTransaction, type Tx } from '../db/client.js';
import { clearReplyChecksCache, getAnswer, getChecks, getCurrentCases, getPhrasings } from './sommelierReads.js';
import { FIXTURE_KEYS } from '../fixtures/liam_eval/index.js';

type Runner = Tx | typeof db;

export class SommelierEvalError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'SommelierEvalError';
  }
}
const invalid = (message: string) => new SommelierEvalError(400, 'SOMMELIER_EVAL_INVALID', message);
const unknown = (message: string) => new SommelierEvalError(404, 'SOMMELIER_EVAL_UNKNOWN', message);

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
/** Check kinds that take no value. */
const NO_VALUE = new Set(['must_name_catalog_coffee', 'must_not_name_roaster', 'price_in_catalog_only']);
/** The global check that must never be retired (integrity check 15). */
export const KEEP_GLOBAL_KIND = 'must_not_name_roaster';

async function lookupId(tx: Runner, category: string, value: string): Promise<number> {
  const r = await tx.query<{ id: number }>(`SELECT id FROM lookup_value WHERE category = $1 AND value = $2`, [category, value]);
  if (!r.rows[0]) {
    const known = await tx.query<{ value: string }>(`SELECT value FROM lookup_value WHERE category = $1 ORDER BY sort_order`, [category]);
    throw invalid(`unknown ${category} '${value}' (known: ${known.rows.map(k => k.value).join(', ')})`);
  }
  return r.rows[0].id;
}

export interface PhrasingInput { message: string; source?: 'hand' | 'customer_turn'; sourceTurnId?: number | null; note?: string | null }
export interface CheckInput { kind: string; value?: string | null; flagCode?: string | null; note?: string | null }

export interface SetCaseInput {
  key: string;
  kind: string;                 // lookup_value.value in sommelier_eval_kind
  fixtureKey: string;
  coffeeAlias?: string | null;
  turnContext?: string | null;
  ruleKey?: string | null;
  note?: string | null;
  createdBy: string;
  /** Given: they replace the case's current phrasings / checks. Omitted on an edit: the current ones carry over. */
  phrasings?: PhrasingInput[];
  checks?: CheckInput[];
  expect?: 'new' | 'edit';
}

async function insertPhrasing(tx: Tx, caseId: number, p: PhrasingInput): Promise<number> {
  const message = String(p.message ?? '').trim();
  if (!message) throw invalid('a phrasing must not be empty');
  const sourceId = await lookupId(tx, 'sommelier_eval_source', p.source ?? 'hand');
  const r = await tx.query<{ id: number }>(
    `INSERT INTO sommelier_eval_phrasing (case_id, message, source_id, source_turn_id, since, note)
     VALUES ($1, $2, $3, $4, clock_timestamp(), $5) RETURNING id`,
    [caseId, message, sourceId, p.sourceTurnId ?? null, p.note?.trim() || null]
  );
  return r.rows[0].id;
}

async function validateCheck(tx: Tx, c: CheckInput, global: boolean): Promise<{ checkId: number; value: string | null; flagCode: string | null }> {
  const checkId = await lookupId(tx, 'sommelier_reply_check_kind', c.kind);
  const value = c.value?.trim() || null;
  if (!NO_VALUE.has(c.kind) && !value) throw invalid(`a ${c.kind} check needs a value`);
  if (c.kind === 'must_contain_answer' && value) {
    for (const key of value.split('|').map(k => k.trim())) {
      if (!key || !(await getAnswer(key, tx))) throw invalid(`answer key '${key}' has no current sommelier_answer row`);
    }
  }
  const flagCode = c.flagCode?.trim() || null;
  if (global) {
    if (c.kind === 'judge') throw invalid('a global check runs on every production reply; a judge question cannot be global');
    if (!flagCode) throw invalid('a global check needs a flag code (sommelier_reply_flag)');
    await lookupId(tx, 'sommelier_reply_flag', flagCode);
  } else if (flagCode) {
    throw invalid('only a global check (no case) carries a flag code');
  }
  return { checkId, value, flagCode };
}

async function insertCheck(tx: Tx, caseId: number | null, c: CheckInput, createdBy: string): Promise<number> {
  const v = await validateCheck(tx, c, caseId === null);
  const r = await tx.query<{ id: number }>(
    `INSERT INTO sommelier_reply_check (case_id, check_id, value, flag_code, since, note, created_by)
     VALUES ($1, $2, $3, $4, clock_timestamp(), $5, $6) RETURNING id`,
    [caseId, v.checkId, v.value, v.flagCode, c.note?.trim() || null, createdBy]
  );
  return r.rows[0].id;
}

/**
 * Inside a caller's transaction. A current row for the key is closed and the
 * successor inserted; the case's phrasings and checks move to the new row
 * (copied, the old ones superseded) unless the input gives new lists.
 */
export async function setCaseInTx(tx: Tx, input: SetCaseInput): Promise<{ key: string; id: number; supersededId: number | null; phrasings: number; checks: number }> {
  const key = String(input.key ?? '').trim();
  if (!KEY_RE.test(key)) throw invalid('key must be snake_case: lowercase letters, digits and underscores, starting with a letter');
  const createdBy = String(input.createdBy ?? '').trim();
  if (!createdBy) throw invalid('createdBy is required');
  const kindId = await lookupId(tx, 'sommelier_eval_kind', input.kind);
  const fixtureKey = String(input.fixtureKey ?? '').trim();
  if (!FIXTURE_KEYS.includes(fixtureKey)) throw invalid(`fixture '${fixtureKey}' is not in fixtures/liam_eval (${FIXTURE_KEYS.join(', ')})`);

  const closed = await tx.query<{ id: number }>(
    `UPDATE sommelier_eval_case SET superseded_at = clock_timestamp() WHERE key = $1 AND superseded_at IS NULL RETURNING id`,
    [key]
  );
  const prev = closed.rows[0] ?? null;
  if (prev && input.expect === 'new') throw new SommelierEvalError(409, 'SOMMELIER_EVAL_EXISTS', `'${key}' already has a current case; edit it instead`);
  if (!prev && input.expect === 'edit') throw unknown(`'${key}' has no current case`);

  const inserted = await tx.query<{ id: number }>(
    `INSERT INTO sommelier_eval_case (key, kind_id, fixture_key, catalog_alias, turn_context, rule_key, since, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp(), $7, $8) RETURNING id`,
    [key, kindId, fixtureKey, input.coffeeAlias?.trim() || null, input.turnContext?.trim() || null, input.ruleKey?.trim() || null, input.note?.trim() || null, createdBy]
  );
  const id = inserted.rows[0].id;

  let phrasings = input.phrasings;
  let checks = input.checks;
  if (prev) {
    const oldPhrasings = await tx.query<{ message: string; source: 'hand' | 'customer_turn'; source_turn_id: number | null; note: string | null }>(
      `UPDATE sommelier_eval_phrasing p SET superseded_at = clock_timestamp()
         FROM lookup_value s
        WHERE s.id = p.source_id AND p.case_id = $1 AND p.superseded_at IS NULL
        RETURNING p.message, s.value AS source, p.source_turn_id, p.note`,
      [prev.id]
    );
    const oldChecks = await tx.query<{ kind: string; value: string | null; note: string | null }>(
      `UPDATE sommelier_reply_check ch SET superseded_at = clock_timestamp()
         FROM lookup_value k
        WHERE k.id = ch.check_id AND ch.case_id = $1 AND ch.superseded_at IS NULL
        RETURNING k.value AS kind, ch.value, ch.note`,
      [prev.id]
    );
    phrasings ??= oldPhrasings.rows.map(r => ({ message: r.message, source: r.source, sourceTurnId: r.source_turn_id, note: r.note }));
    checks ??= oldChecks.rows.map(r => ({ kind: r.kind, value: r.value, note: r.note }));
  }
  const seen = new Set<string>();
  let nP = 0;
  for (const p of phrasings ?? []) {
    const k = String(p.message ?? '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    await insertPhrasing(tx, id, p);
    nP++;
  }
  for (const c of checks ?? []) await insertCheck(tx, id, c, createdBy);
  return { key, id, supersededId: prev?.id ?? null, phrasings: nP, checks: checks?.length ?? 0 };
}

/** Inside a caller's transaction: the case and its phrasings and checks get superseded_at, no successor. */
export async function retireCaseInTx(tx: Tx, input: { key: string; createdBy: string }): Promise<{ key: string; retiredId: number }> {
  if (!String(input.createdBy ?? '').trim()) throw invalid('createdBy is required');
  const r = await tx.query<{ id: number }>(
    `UPDATE sommelier_eval_case SET superseded_at = clock_timestamp() WHERE key = $1 AND superseded_at IS NULL RETURNING id`,
    [input.key]
  );
  if (!r.rows[0]) throw unknown(`'${input.key}' has no current case`);
  await tx.query(`UPDATE sommelier_eval_phrasing SET superseded_at = clock_timestamp() WHERE case_id = $1 AND superseded_at IS NULL`, [r.rows[0].id]);
  await tx.query(`UPDATE sommelier_reply_check SET superseded_at = clock_timestamp() WHERE case_id = $1 AND superseded_at IS NULL`, [r.rows[0].id]);
  return { key: input.key, retiredId: r.rows[0].id };
}

/**
 * Inside a caller's transaction: adds one phrasing to a current case. A
 * message the case already has (case-insensitive) is not added again
 * ({ id: null, duplicate: true }); neither is one equal to a retired phrasing
 * of the same case row (UNIQUE (case_id, message)).
 */
export async function setPhrasingInTx(tx: Tx, input: PhrasingInput & { caseKey: string }): Promise<{ id: number | null; duplicate: boolean }> {
  const c = (await getCurrentCases(tx)).find(x => x.key === input.caseKey);
  if (!c) throw unknown(`'${input.caseKey}' has no current case`);
  const message = String(input.message ?? '').trim();
  if (!message) throw invalid('a phrasing must not be empty');
  const current = await getPhrasings(c.id, tx);
  if (current.some(p => p.message.trim().toLowerCase() === message.toLowerCase())) return { id: null, duplicate: true };
  const r = await tx.query<{ id: number }>(
    `INSERT INTO sommelier_eval_phrasing (case_id, message, source_id, source_turn_id, since, note)
     VALUES ($1, $2, (SELECT id FROM lookup_value WHERE category = 'sommelier_eval_source' AND value = $3), $4, clock_timestamp(), $5)
     ON CONFLICT (case_id, message) DO NOTHING RETURNING id`,
    [c.id, message, input.source ?? 'hand', input.sourceTurnId ?? null, input.note?.trim() || null]
  );
  return r.rows[0] ? { id: r.rows[0].id, duplicate: false } : { id: null, duplicate: true };
}

export async function retirePhrasingInTx(tx: Tx, input: { id: number }): Promise<{ retiredId: number }> {
  const r = await tx.query<{ id: number }>(
    `UPDATE sommelier_eval_phrasing SET superseded_at = clock_timestamp() WHERE id = $1 AND superseded_at IS NULL RETURNING id`,
    [input.id]
  );
  if (!r.rows[0]) throw unknown(`phrasing ${input.id} is not current`);
  return { retiredId: r.rows[0].id };
}

/** Inside a caller's transaction: adds one check to a current case, or a global check when caseKey is null. */
export async function setCheckInTx(tx: Tx, input: CheckInput & { caseKey: string | null; createdBy: string }): Promise<{ id: number }> {
  if (!String(input.createdBy ?? '').trim()) throw invalid('createdBy is required');
  let caseId: number | null = null;
  if (input.caseKey !== null) {
    const c = (await getCurrentCases(tx)).find(x => x.key === input.caseKey);
    if (!c) throw unknown(`'${input.caseKey}' has no current case`);
    caseId = c.id;
  }
  return { id: await insertCheck(tx, caseId, input, input.createdBy) };
}

/** Inside a caller's transaction. The last current global must_not_name_roaster check is refused. */
export async function retireCheckInTx(tx: Tx, input: { id: number }): Promise<{ retiredId: number }> {
  const globals = await getChecks(null, tx);
  const target = globals.find(g => g.id === input.id);
  if (target?.kind === KEEP_GLOBAL_KIND && globals.filter(g => g.kind === KEEP_GLOBAL_KIND).length === 1) {
    throw invalid('the global must_not_name_roaster check is the one check that is never retired');
  }
  const r = await tx.query<{ id: number }>(
    `UPDATE sommelier_reply_check SET superseded_at = clock_timestamp() WHERE id = $1 AND superseded_at IS NULL RETURNING id`,
    [input.id]
  );
  if (!r.rows[0]) throw unknown(`check ${input.id} is not current`);
  return { retiredId: r.rows[0].id };
}

/** Admin door: one transaction, then this process's global-check cache is cleared. */
export async function inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await withTransaction(fn);
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') throw new SommelierEvalError(409, 'SOMMELIER_EVAL_CONFLICT', 'changed by someone else at the same time; reload and try again');
    throw err;
  } finally {
    clearReplyChecksCache();
  }
}

// ── Runs and results (facts) ─────────────────────────────────────────────────

export interface StartRunInput {
  trigger: 'nightly' | 'manual';
  model: string;
  judgeModel: string;
  promptHash: string;
  answersVersion: number;
  catalogVersion: string;
  gateEnabled: boolean;
  createdBy: string;
}

export async function startRun(input: StartRunInput, runner: Runner = db): Promise<number> {
  const triggerId = await lookupId(runner, 'sommelier_eval_trigger', input.trigger);
  const r = await runner.query<{ id: number }>(
    `INSERT INTO sommelier_eval_run (trigger_id, model, judge_model, prompt_hash, answers_version, catalog_version, gate_enabled, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [triggerId, input.model, input.judgeModel, input.promptHash, input.answersVersion, input.catalogVersion, input.gateEnabled, input.createdBy]
  );
  return r.rows[0].id;
}

/** The run's one allowed UPDATE: its own row, once, when it ends. */
export async function finishRun(
  runId: number, input: { phrasings: number; passed: number; failed: number; usdMicros: number; note: string | null }, runner: Runner = db
): Promise<void> {
  await runner.query(
    `UPDATE sommelier_eval_run SET finished_at = clock_timestamp(), phrasings = $2, passed = $3, failed = $4, usd_micros = $5, note = $6
      WHERE id = $1 AND finished_at IS NULL`,
    [runId, input.phrasings, input.passed, input.failed, Math.max(0, Math.round(input.usdMicros)), input.note]
  );
}

export interface ResultInput {
  runId: number;
  phrasingId: number;
  route: string;
  reply: string;
  passed: boolean;
  failedCheckIds: number[];
  judgeNotes: string | null;
  usdMicros: number;
}

export async function recordResult(input: ResultInput, runner: Runner = db): Promise<number> {
  const r = await runner.query<{ id: number }>(
    `INSERT INTO sommelier_eval_result (run_id, phrasing_id, route, reply, passed, failed_check_ids, judge_notes, usd_micros)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.runId, input.phrasingId, input.route, input.reply, input.passed, input.failedCheckIds, input.judgeNotes, Math.max(0, Math.round(input.usdMicros))]
  );
  return r.rows[0].id;
}
