// Cupping evidence brief 6, E1 (2026-10-21) — the one TypeScript writer of
// evidence_parameter (besides the seed in schema.sql). A change is a new row
// that supersedes the current one for the key, in one transaction; nothing is
// ever updated otherwise or deleted. Keys are the seeded ones. The sane range
// of a key lives in its seed note ("Range: 0 < value <= 1.", "Range: integer
// 1 <= value <= 3."), so no number from the brief is typed here; a key whose
// note declares no range is shown on the admin card but not editable.
// backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_6_POOLED_RANGE_CUSTOMER_VOICE.md
import { withTransaction, type Tx } from '../db/client.js';

export class EvidenceParameterError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'EvidenceParameterError';
  }
}
const invalid = (message: string) => new EvidenceParameterError(400, 'EVIDENCE_PARAMETER_INVALID', message);

export interface SaneRange {
  integer: boolean;
  min: number | null; minInclusive: boolean;
  max: number | null; maxInclusive: boolean;
}

const RANGE = /Range:\s*(integer\s+)?(?:(-?\d+(?:\.\d+)?)\s*(<=|<)\s*)?value(?:\s*(<=|<)\s*(-?\d+(?:\.\d+)?))?/i;
const CHANGE_SUFFIX = / \| changed .*$/s;

/** The range a parameter's note declares, or null when it declares none. */
export function parseSaneRange(note: string | null | undefined): SaneRange | null {
  const m = note ? RANGE.exec(note) : null;
  if (!m || (m[2] === undefined && m[5] === undefined)) return null;
  return {
    integer: Boolean(m[1]),
    min: m[2] === undefined ? null : Number(m[2]), minInclusive: m[3] === '<=',
    max: m[5] === undefined ? null : Number(m[5]), maxInclusive: m[4] === '<=',
  };
}

export function inSaneRange(value: number, r: SaneRange): boolean {
  if (r.integer && !Number.isInteger(value)) return false;
  if (r.min !== null && (r.minInclusive ? value < r.min : value <= r.min)) return false;
  if (r.max !== null && (r.maxInclusive ? value > r.max : value >= r.max)) return false;
  return true;
}

/** The note without an earlier change suffix: the key's description and its range. */
export function describeNote(note: string | null | undefined): string {
  return (note ?? '').replace(CHANGE_SUFFIX, '');
}

export interface SetParameterInput { key: string; value: number | string; note?: string | null; adminId?: string | null }
export interface SetParameterResult { key: string; value: number; previousValue: number; unchanged: boolean }

/** Inside a caller's transaction: supersede the key's current row and insert the new value. */
export async function setParameterInTx(tx: Tx, input: SetParameterInput): Promise<SetParameterResult> {
  const key = String(input.key ?? '').trim();
  const value = typeof input.value === 'number' ? input.value : Number(String(input.value ?? '').trim() || NaN);
  if (!Number.isFinite(value)) throw invalid('value must be a number');
  const cur = await tx.query<{ id: number; value: string; note: string | null }>(
    `SELECT id, value, note FROM evidence_parameter WHERE key = $1 AND superseded_at IS NULL FOR UPDATE`, [key]
  );
  const row = cur.rows[0];
  if (!row) throw new EvidenceParameterError(404, 'EVIDENCE_PARAMETER_UNKNOWN', `unknown evidence parameter '${key}'`);
  const range = parseSaneRange(row.note);
  if (!range) throw invalid(`'${key}' declares no sane range in its note; it is not editable here`);
  if (!inSaneRange(value, range)) throw invalid(`${value} is outside the sane range of '${key}' (${RANGE.exec(row.note ?? '')?.[0]})`);
  const previousValue = Number(row.value);
  if (previousValue === value) return { key, value, previousValue, unchanged: true };
  const stamp = new Date().toISOString().slice(0, 10);
  const change = [`changed ${stamp}`, input.adminId ? `by ${input.adminId}` : null].filter(Boolean).join(' ')
    + (input.note?.trim() ? `: ${input.note.trim()}` : '');
  await tx.query(`UPDATE evidence_parameter SET superseded_at = clock_timestamp() WHERE id = $1`, [row.id]);
  await tx.query(
    `INSERT INTO evidence_parameter (key, value, since, note) VALUES ($1, $2, clock_timestamp(), $3)`,
    [key, value, `${describeNote(row.note)} | ${change}`]
  );
  return { key, value, previousValue, unchanged: false };
}

/** The admin door (PUT /api/admin/evidence/parameters/:key). */
export async function setParameter(key: string, value: number | string, note: string | null, adminId: string | null): Promise<SetParameterResult> {
  return withTransaction(tx => setParameterInTx(tx, { key, value, note, adminId }));
}
