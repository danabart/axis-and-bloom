// Family Household 1, B1 (2026-11-07) — the one TypeScript writer of
// household_parameter (besides the seed in schema.sql), and its only reader.
// Same discipline as commerceParameters.ts: a change is a new row that
// supersedes the current one, in one transaction; nothing else is updated or
// deleted. A key's sane range lives in its seed note ("Range: integer 1 <=
// value <= 20."), so no household number is typed anywhere in code.
// backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_1_FOUNDATION_AND_JOIN_LINKS.md
import { db, withTransaction, type Tx } from '../db/client.js';
import { parseSaneRange, inSaneRange, describeNote } from './evidenceParameterService.js';

export class HouseholdParameterError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'HouseholdParameterError';
  }
}
const invalid = (message: string) => new HouseholdParameterError(400, 'HOUSEHOLD_PARAMETER_INVALID', message);

// ── reads (60 s in-memory cache, dropped on every write) ─────────────────────

interface CurrentRow { key: string; value_numeric: string | null; value_text: string | null }
const CACHE_MS = 60_000;
let cache: { at: number; rows: Map<string, CurrentRow> } | null = null;

async function currentRows(): Promise<Map<string, CurrentRow>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const r = await db.query<CurrentRow>(
    `SELECT key, value_numeric, value_text FROM household_parameter WHERE superseded_at IS NULL`
  );
  cache = { at: Date.now(), rows: new Map(r.rows.map(row => [row.key, row])) };
  return cache.rows;
}

export function invalidateHouseholdParameterCache(): void { cache = null; }

/** A numeric household parameter's current value. Throws when the key has none (a seed is missing). */
export async function householdParam(key: string): Promise<number> {
  const row = (await currentRows()).get(key);
  if (!row || row.value_numeric === null) throw new Error(`household_parameter '${key}' has no current numeric value`);
  return Number(row.value_numeric);
}

export interface HouseholdParameterRow {
  key: string;
  value: number | string;
  kind: 'numeric' | 'text';
  since: string;
  note: string | null;
  previous_value: number | string | null;
  previous_since: string | null;
}

/** Current value of every key with the one before it (the admin card). */
export async function getParameters(): Promise<HouseholdParameterRow[]> {
  const r = await db.query(
    `SELECT c.key, c.value_numeric, c.value_text, c.since, c.note,
            p.value_numeric AS prev_numeric, p.value_text AS prev_text, p.since AS previous_since
     FROM household_parameter c
     LEFT JOIN LATERAL (
       SELECT value_numeric, value_text, since FROM household_parameter o
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

export interface SetParameterResult { key: string; value: number | string; previousValue: number | string; unchanged: boolean }

/** Inside a caller's transaction: supersede the key's current row and insert the new value. */
export async function setParameterInTx(tx: Tx, key: string, value: number | string, note: string | null, adminId: string | null): Promise<SetParameterResult> {
  const k = String(key ?? '').trim();
  const cur = await tx.query<{ id: number; value_numeric: string | null; value_text: string | null; note: string | null }>(
    `SELECT id, value_numeric, value_text, note FROM household_parameter WHERE key = $1 AND superseded_at IS NULL FOR UPDATE`, [k]
  );
  const row = cur.rows[0];
  if (!row) throw new HouseholdParameterError(404, 'HOUSEHOLD_PARAMETER_UNKNOWN', `unknown household parameter '${k}'`);
  // Every household key is numeric today; a text key would need a declared format first.
  if (row.value_numeric === null) throw invalid(`'${k}' is a text parameter; it is not editable here`);

  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim() || NaN);
  if (!Number.isFinite(numeric)) throw invalid('value must be a number');
  const range = parseSaneRange(row.note);
  if (!range) throw invalid(`'${k}' declares no sane range in its note; it is not editable here`);
  if (!inSaneRange(numeric, range)) throw invalid(`${numeric} is outside the sane range of '${k}' (${/Range:[^.]*/.exec(row.note ?? '')?.[0]})`);
  const previousValue = Number(row.value_numeric);
  if (previousValue === numeric) return { key: k, value: numeric, previousValue, unchanged: true };

  const stamp = new Date().toISOString().slice(0, 10);
  const change = [`changed ${stamp}`, adminId ? `by ${adminId}` : null].filter(Boolean).join(' ')
    + (note?.trim() ? `: ${note.trim()}` : '');
  await tx.query(`UPDATE household_parameter SET superseded_at = clock_timestamp() WHERE id = $1`, [row.id]);
  await tx.query(
    `INSERT INTO household_parameter (key, value_numeric, since, note) VALUES ($1, $2, clock_timestamp(), $3)`,
    [k, numeric, `${describeNote(row.note)} | ${change}`]
  );
  return { key: k, value: numeric, previousValue, unchanged: false };
}

/** The admin door (PUT /api/admin/household/parameters/:key). */
export async function setParameter(key: string, value: number | string, note: string | null, adminId: string | null): Promise<SetParameterResult> {
  const result = await withTransaction(tx => setParameterInTx(tx, key, value, note, adminId));
  invalidateHouseholdParameterCache();
  return result;
}
