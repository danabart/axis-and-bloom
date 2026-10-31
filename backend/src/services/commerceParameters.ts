// Commerce 1, B1 (2026-10-31) — the one TypeScript writer of
// commerce_parameter (besides the seed in schema.sql), and its only reader.
// Same discipline as evidenceParameterService: a change is a new row that
// supersedes the current one, in one transaction; nothing is updated otherwise
// or deleted. The sane range of a numeric key lives in its seed note
// ("Range: integer 0 <= value <= 2000."), the format of a text key likewise
// ("Format: email."), so no business number is typed here or anywhere else:
// every one is read through commerceParam / commerceParamText.
// backend/src/features/commerce/CLAUDE_CODE_PROMPT_COMMERCE_1_CHECKOUT.md
import { db, withTransaction, type Tx } from '../db/client.js';
import { parseSaneRange, inSaneRange, describeNote } from './evidenceParameterService.js';

export class CommerceParameterError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'CommerceParameterError';
  }
}
const invalid = (message: string) => new CommerceParameterError(400, 'COMMERCE_PARAMETER_INVALID', message);

const FORMAT = /Format:\s*(email|integer list|stripe tax code)\b/i;
const FORMAT_CHECKS: Record<string, (v: string) => boolean> = {
  'email': v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  'integer list': v => /^\d+(\s*,\s*\d+)*$/.test(v),
  'stripe tax code': v => /^txcd_\d{8}$/.test(v),
};

/** The text format a parameter's note declares, or null when it declares none. */
export function parseFormat(note: string | null | undefined): string | null {
  const m = note ? FORMAT.exec(note) : null;
  return m ? m[1].toLowerCase() : null;
}

// ── reads (60 s in-memory cache, dropped on every write) ─────────────────────

interface CurrentRow { key: string; value_numeric: string | null; value_text: string | null }
const CACHE_MS = 60_000;
let cache: { at: number; rows: Map<string, CurrentRow> } | null = null;

async function currentRows(): Promise<Map<string, CurrentRow>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const r = await db.query<CurrentRow>(
    `SELECT key, value_numeric, value_text FROM commerce_parameter WHERE superseded_at IS NULL`
  );
  cache = { at: Date.now(), rows: new Map(r.rows.map(row => [row.key, row])) };
  return cache.rows;
}

export function invalidateCommerceParameterCache(): void { cache = null; }

/** A numeric commerce parameter's current value. Throws when the key has none (a seed is missing). */
export async function commerceParam(key: string): Promise<number> {
  const row = (await currentRows()).get(key);
  if (!row || row.value_numeric === null) throw new Error(`commerce_parameter '${key}' has no current numeric value`);
  return Number(row.value_numeric);
}

/** A text commerce parameter's current value. Throws when the key has none. */
export async function commerceParamText(key: string): Promise<string> {
  const row = (await currentRows()).get(key);
  if (!row || row.value_text === null) throw new Error(`commerce_parameter '${key}' has no current text value`);
  return row.value_text;
}

export interface CommerceParameterRow {
  key: string;
  value: number | string;
  kind: 'numeric' | 'text';
  since: string;
  note: string | null;
  previous_value: number | string | null;
  previous_since: string | null;
}

/** Current value of every key with the one before it (the admin card). */
export async function getParameters(): Promise<CommerceParameterRow[]> {
  const r = await db.query(
    `SELECT c.key, c.value_numeric, c.value_text, c.since, c.note,
            p.value_numeric AS prev_numeric, p.value_text AS prev_text, p.since AS previous_since
     FROM commerce_parameter c
     LEFT JOIN LATERAL (
       SELECT value_numeric, value_text, since FROM commerce_parameter o
       WHERE o.key = c.key AND o.superseded_at IS NOT NULL
       ORDER BY o.since DESC LIMIT 1
     ) p ON true
     WHERE c.superseded_at IS NULL
     ORDER BY c.key`
  );
  return r.rows.map(row => ({
    key: row.key,
    value: row.value_numeric !== null ? Number(row.value_numeric) : row.value_text,
    kind: row.value_numeric !== null ? 'numeric' : 'text',
    since: row.since,
    note: row.note,
    previous_value: row.prev_numeric !== null ? Number(row.prev_numeric) : row.prev_text ?? null,
    previous_since: row.previous_since ?? null,
  }));
}

// ── the writer ───────────────────────────────────────────────────────────────

export interface SetParameterInput { key: string; value: number | string; note?: string | null; adminId?: string | null }
export interface SetParameterResult { key: string; value: number | string; previousValue: number | string; unchanged: boolean }

/** Inside a caller's transaction: supersede the key's current row and insert the new value. */
export async function setParameterInTx(tx: Tx, input: SetParameterInput): Promise<SetParameterResult> {
  const key = String(input.key ?? '').trim();
  const cur = await tx.query<{ id: number; value_numeric: string | null; value_text: string | null; note: string | null }>(
    `SELECT id, value_numeric, value_text, note FROM commerce_parameter WHERE key = $1 AND superseded_at IS NULL FOR UPDATE`, [key]
  );
  const row = cur.rows[0];
  if (!row) throw new CommerceParameterError(404, 'COMMERCE_PARAMETER_UNKNOWN', `unknown commerce parameter '${key}'`);

  let numeric: number | null = null;
  let text: string | null = null;
  let previousValue: number | string;
  if (row.value_numeric !== null) {
    numeric = typeof input.value === 'number' ? input.value : Number(String(input.value ?? '').trim() || NaN);
    if (!Number.isFinite(numeric)) throw invalid('value must be a number');
    const range = parseSaneRange(row.note);
    if (!range) throw invalid(`'${key}' declares no sane range in its note; it is not editable here`);
    if (!inSaneRange(numeric, range)) throw invalid(`${numeric} is outside the sane range of '${key}' (${/Range:[^.]*/.exec(row.note ?? '')?.[0]})`);
    previousValue = Number(row.value_numeric);
    if (previousValue === numeric) return { key, value: numeric, previousValue, unchanged: true };
  } else {
    text = String(input.value ?? '').trim();
    const format = parseFormat(row.note);
    if (!format) throw invalid(`'${key}' declares no format in its note; it is not editable here`);
    if (!FORMAT_CHECKS[format](text)) throw invalid(`'${text}' is not a valid ${format} for '${key}'`);
    previousValue = row.value_text as string;
    if (previousValue === text) return { key, value: text, previousValue, unchanged: true };
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const change = [`changed ${stamp}`, input.adminId ? `by ${input.adminId}` : null].filter(Boolean).join(' ')
    + (input.note?.trim() ? `: ${input.note.trim()}` : '');
  await tx.query(`UPDATE commerce_parameter SET superseded_at = clock_timestamp() WHERE id = $1`, [row.id]);
  await tx.query(
    `INSERT INTO commerce_parameter (key, value_numeric, value_text, since, note) VALUES ($1, $2, $3, clock_timestamp(), $4)`,
    [key, numeric, text, `${describeNote(row.note)} | ${change}`]
  );
  return { key, value: (numeric ?? text) as number | string, previousValue, unchanged: false };
}

/** The admin door (PUT /api/admin/commerce/parameters/:key). */
export async function setParameter(key: string, value: number | string, note: string | null, adminId: string | null): Promise<SetParameterResult> {
  const result = await withTransaction(tx => setParameterInTx(tx, { key, value, note, adminId }));
  invalidateCommerceParameterCache();
  return result;
}
