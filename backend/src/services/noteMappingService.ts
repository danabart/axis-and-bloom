// Cupping evidence, brief 1 (2026-10-18), B8 — the one writer of
// roastery_portal_note_mapping: remembered translations from a roaster's or a
// cupper's words to an SCA node (cupping_note, any tier). source_kind keeps
// the two vocabularies apart: the same words may map differently. Changing a
// mapping supersedes the current row for the same (words, kind) and inserts
// the new one; a row is never edited or deleted otherwise.
// roasteryPortalService (roaster words) and the brief 2 loader (cupper words)
// call this; reads are noteMappingReads / roasteryPortalReads.
import { withTransaction, type Tx } from '../db/client.js';
import { normalizeWords } from './roasteryPortalReads.js';

export type NoteSourceKind = 'roaster' | 'cupper';
const SOURCE_KINDS: readonly NoteSourceKind[] = ['roaster', 'cupper'];

export class NoteMappingError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'NoteMappingError';
  }
}

export interface SetNoteMappingInput {
  normalizedWords: string;
  cuppingNoteId: string;
  sourceKind: NoteSourceKind;
  adminId?: string | null;
  note?: string | null;
}

export type SetNoteMappingResult = 'created' | 'superseded' | 'unchanged';

/** Inside a caller's transaction: create, supersede-and-replace, or leave alone the mapping for these words. */
export async function setNoteMappingInTx(tx: Tx, input: SetNoteMappingInput): Promise<SetNoteMappingResult> {
  if (!SOURCE_KINDS.includes(input.sourceKind)) throw new NoteMappingError(400, 'NOTE_MAPPING_INVALID', `sourceKind must be one of ${SOURCE_KINDS.join(', ')}`);
  const key = normalizeWords(input.normalizedWords ?? '');
  if (!key) return 'unchanged';
  const node = await tx.query(`SELECT 1 FROM cupping_note WHERE id = $1 AND is_active`, [input.cuppingNoteId]);
  if (!node.rowCount) throw new NoteMappingError(400, 'NOTE_MAPPING_INVALID', 'unknown or inactive flavor wheel term');
  const cur = await tx.query<{ id: string; cupping_note_id: string }>(
    `SELECT id, cupping_note_id FROM roastery_portal_note_mapping
     WHERE normalized_words = $1 AND source_kind = $2 AND superseded_at IS NULL FOR UPDATE`,
    [key, input.sourceKind]
  );
  if (cur.rows[0]?.cupping_note_id === input.cuppingNoteId) return 'unchanged';
  if (cur.rows[0]) await tx.query(`UPDATE roastery_portal_note_mapping SET superseded_at = now() WHERE id = $1`, [cur.rows[0].id]);
  await tx.query(
    `INSERT INTO roastery_portal_note_mapping (normalized_words, cupping_note_id, source_kind, created_by_admin_id, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [key, input.cuppingNoteId, input.sourceKind, input.adminId ?? null, input.note?.trim() || null]
  );
  return cur.rows[0] ? 'superseded' : 'created';
}

/** Create, supersede-and-replace, or leave alone the mapping for these words (own transaction). */
export async function setNoteMapping(input: SetNoteMappingInput): Promise<SetNoteMappingResult> {
  return withTransaction(tx => setNoteMappingInTx(tx, input));
}

/** Inside a caller's transaction: retire a current mapping without a replacement (history kept). */
export async function retireNoteMappingInTx(tx: Tx, mappingId: string): Promise<{ superseded: boolean }> {
  const r = await tx.query(
    `UPDATE roastery_portal_note_mapping SET superseded_at = now() WHERE id = $1 AND superseded_at IS NULL`, [mappingId]
  );
  return { superseded: (r.rowCount ?? 0) > 0 };
}

export async function retireNoteMapping(mappingId: string): Promise<{ superseded: boolean }> {
  return withTransaction(tx => retireNoteMappingInTx(tx, mappingId));
}
