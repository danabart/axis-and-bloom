// Liam brand answers (brief Rev 3, Part A3, 2026-10-24) — the one TypeScript
// writer of sommelier_answer (besides the insert-only seed). Cloned from
// evidenceParameterService.setParameterInTx: an edit is a new row that
// supersedes the key's current row in one transaction; a retire sets
// superseded_at with no successor. answer_text is never updated in place and
// nothing is deleted. Validation lives here, not in the route: non-empty text,
// a known kind and delivery (lookup_value), and the content rules of
// sommelierIntegrity checks 2-4; a write that breaks one is refused with the
// rule named.
// backend/src/features/ai_agent_liam/brand_prices_cart_cutoff/CLAUDE_CODE_PROMPT_LIAM_BRAND_PRICES_CART_CUTOFF.md
import { withTransaction, type Tx } from '../db/client.js';
import { clearAnswersCache } from './sommelierReads.js';
import { answerContentViolations, loadAnswerVocabulary } from './sommelierIntegrity.js';

export class SommelierAnswerError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'SommelierAnswerError';
  }
}
const invalid = (message: string) => new SommelierAnswerError(400, 'SOMMELIER_ANSWER_INVALID', message);

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

export interface SetAnswerInput {
  key: string;
  /** lookup_value.value in sommelier_answer_kind; omitted on an edit = keep the current row's. */
  kind?: string;
  /** lookup_value.value in sommelier_answer_delivery; omitted on an edit = keep the current row's. */
  delivery?: string;
  answerText: string;
  /** Omitted on an edit = keep the current row's. Required for a new key. */
  sortOrder?: number;
  note?: string | null;
  createdBy: string;
  /** 'new' refuses a key that has a current row; 'edit' refuses one that has none. Omitted: either. */
  expect?: 'new' | 'edit';
}

export interface SetAnswerResult { key: string; id: number; supersededId: number | null }

async function lookupId(tx: Tx, category: string, value: string): Promise<number> {
  const r = await tx.query<{ id: number }>(`SELECT id FROM lookup_value WHERE category = $1 AND value = $2`, [category, value]);
  if (!r.rows[0]) {
    const known = await tx.query<{ value: string }>(`SELECT value FROM lookup_value WHERE category = $1 ORDER BY sort_order`, [category]);
    throw invalid(`unknown ${category} '${value}' (known: ${known.rows.map(k => k.value).join(', ')})`);
  }
  return r.rows[0].id;
}

async function assertContent(tx: Tx, text: string): Promise<void> {
  const violations = answerContentViolations(text, await loadAnswerVocabulary(tx));
  if (violations.length) {
    const v = violations[0];
    throw invalid(`answer refused by rule ${v.rule} (${v.ruleName}): ${v.match}`);
  }
}

/**
 * Inside a caller's transaction. With a current row for the key: closes it
 * (the UPDATE locks the row, so two concurrent edits serialize) and inserts
 * the successor, inheriting kind, delivery and sort order unless given.
 * Without one: inserts a new key, which then needs kind, delivery and
 * sortOrder.
 */
export async function setAnswerInTx(tx: Tx, input: SetAnswerInput): Promise<SetAnswerResult> {
  const key = String(input.key ?? '').trim();
  if (!KEY_RE.test(key)) throw invalid('key must be snake_case: lowercase letters, digits and underscores, starting with a letter');
  const answerText = String(input.answerText ?? '').trim();
  if (!answerText) throw invalid('answer text must not be empty');
  const createdBy = String(input.createdBy ?? '').trim();
  if (!createdBy) throw invalid('createdBy is required');
  if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) throw invalid('sortOrder must be an integer');
  await assertContent(tx, answerText);

  const closed = await tx.query<{ id: number; kind_id: number; delivery_id: number; sort_order: number }>(
    `UPDATE sommelier_answer SET superseded_at = clock_timestamp()
      WHERE key = $1 AND superseded_at IS NULL
      RETURNING id, kind_id, delivery_id, sort_order`,
    [key]
  );
  const prev = closed.rows[0] ?? null;
  if (prev && input.expect === 'new') throw new SommelierAnswerError(409, 'SOMMELIER_ANSWER_EXISTS', `'${key}' already has a current answer; edit it instead`);
  if (!prev && input.expect === 'edit') throw new SommelierAnswerError(404, 'SOMMELIER_ANSWER_UNKNOWN', `'${key}' has no current answer`);
  if (!prev && (input.kind === undefined || input.delivery === undefined || input.sortOrder === undefined)) {
    throw invalid(`'${key}' has no current answer; a new key needs kind, delivery and sortOrder`);
  }
  const kindId = input.kind !== undefined ? await lookupId(tx, 'sommelier_answer_kind', input.kind) : prev!.kind_id;
  const deliveryId = input.delivery !== undefined ? await lookupId(tx, 'sommelier_answer_delivery', input.delivery) : prev!.delivery_id;
  const sortOrder = input.sortOrder ?? prev!.sort_order;

  const inserted = await tx.query<{ id: number }>(
    `INSERT INTO sommelier_answer (key, kind_id, delivery_id, answer_text, sort_order, since, note, created_by)
     VALUES ($1, $2, $3, $4, $5, clock_timestamp(), $6, $7) RETURNING id`,
    [key, kindId, deliveryId, answerText, sortOrder, input.note?.trim() || null, createdBy]
  );
  return { key, id: inserted.rows[0].id, supersededId: prev?.id ?? null };
}

export interface RetireAnswerInput { key: string; note?: string | null; createdBy: string }

/** Inside a caller's transaction: the key's current row gets superseded_at and no successor. */
export async function retireAnswerInTx(tx: Tx, input: RetireAnswerInput): Promise<{ key: string; retiredId: number }> {
  const key = String(input.key ?? '').trim();
  if (!String(input.createdBy ?? '').trim()) throw invalid('createdBy is required');
  // The closing row keeps its own note and created_by (the supersede-only
  // grant allows superseded_at alone); the retire's who and why go to the
  // caller's log line.
  const r = await tx.query<{ id: number }>(
    `UPDATE sommelier_answer SET superseded_at = clock_timestamp()
      WHERE key = $1 AND superseded_at IS NULL RETURNING id`,
    [key]
  );
  if (!r.rows[0]) throw new SommelierAnswerError(404, 'SOMMELIER_ANSWER_UNKNOWN', `'${key}' has no current answer`);
  return { key, retiredId: r.rows[0].id };
}

/** Admin door: one transaction, then this process's cache is cleared. */
export async function setAnswer(input: SetAnswerInput): Promise<SetAnswerResult> {
  try {
    return await withTransaction(tx => setAnswerInTx(tx, input));
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      throw new SommelierAnswerError(409, 'SOMMELIER_ANSWER_CONFLICT', `'${input.key}' was changed by someone else at the same time; reload and try again`);
    }
    throw err;
  } finally {
    clearAnswersCache();
  }
}

export async function retireAnswer(input: RetireAnswerInput): Promise<{ key: string; retiredId: number }> {
  try {
    return await withTransaction(tx => retireAnswerInTx(tx, input));
  } finally {
    clearAnswersCache();
  }
}
