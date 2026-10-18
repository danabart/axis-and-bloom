// Cupping evidence, brief 1 (2026-10-18), B7 — the one writer of
// roastery_remark: what a roaster says outside the portal form (at the
// cupping table, by email, on a call or visit, on their website), one
// statement per row, verbatim. Insert-only: a transcription correction is a
// new row whose supersedes_id points at the old one; the old row is never
// touched (DESIGN_CUPPING_EVIDENCE.md §4.7, §6.5, §10). A classification
// remark carries proposed_archetype, which is a proposal, never an
// assignment. The roastery_remark_guard trigger is the ownership backstop
// (portal coffee, respondent, superseded row, session coffee all belong to
// the same roaster); this service checks what it can read through the
// catalog door first so the common mistakes get a clear 400.
import { withTransaction, type Tx } from '../db/client.js';
import { archetypeCode, getCoffee } from './catalogReads.js';

export const REMARK_CHANNELS = ['cupping_table', 'email', 'call', 'visit', 'website', 'other'] as const;
export const REMARK_TOPICS = ['classification', 'descriptor', 'dimension', 'brewing', 'availability', 'process', 'origin', 'roast', 'general'] as const;
export type RemarkChannel = (typeof REMARK_CHANNELS)[number];
export type RemarkTopic = (typeof REMARK_TOPICS)[number];

export class RemarkError extends Error {
  constructor(public status: number, public code: string, message: string, public index?: number) {
    super(message);
    this.name = 'RemarkError';
  }
}

export interface RemarkInput {
  roasterId: string;
  coffeeId?: number | null;
  portalCoffeeId?: string | null;
  cuppingSessionCoffeeId?: number | null;
  saidBy: string;
  saidByRespondentId?: string | null;
  saidOn: string;
  channel: RemarkChannel;
  topic: RemarkTopic;
  remark: string;
  cuppingNoteId?: string | null;
  proposedArchetype?: string | null;
  recordedBy: string;
  recordSource: string;
  supersedesId?: string | null;
}

export interface RemarkContext {
  actor?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function validate(tx: Tx, r: RemarkInput, i: number): Promise<{ proposedArchetype: string | null }> {
  const bad = (m: string) => new RemarkError(400, 'REMARK_INVALID', `remark ${i + 1}: ${m}`, i);
  if (!text(r.roasterId)) throw bad('roasterId is required');
  if (!text(r.saidBy)) throw bad('saidBy is required');
  if (!text(r.remark)) throw bad('remark (their words, verbatim) is required');
  if (!text(r.recordedBy)) throw bad('recordedBy is required');
  if (!text(r.recordSource)) throw bad('recordSource is required');
  if (typeof r.saidOn !== 'string' || !DATE_RE.test(r.saidOn) || Number.isNaN(Date.parse(r.saidOn))) throw bad('saidOn must be a date (YYYY-MM-DD)');
  if (!REMARK_CHANNELS.includes(r.channel)) throw bad(`channel must be one of ${REMARK_CHANNELS.join(', ')}`);
  if (!REMARK_TOPICS.includes(r.topic)) throw bad(`topic must be one of ${REMARK_TOPICS.join(', ')}`);
  if (r.cuppingNoteId && r.topic !== 'descriptor') throw bad('a flavor wheel pick belongs to a descriptor remark');
  if (r.proposedArchetype && r.topic !== 'classification') throw bad('a proposed archetype belongs to a classification remark');

  let proposedArchetype: string | null = null;
  if (r.proposedArchetype) {
    proposedArchetype = await archetypeCode(r.proposedArchetype, tx);
    if (!proposedArchetype) throw bad(`'${r.proposedArchetype}' is not an archetype`);
  }
  if (r.cuppingNoteId) {
    const node = await tx.query(`SELECT 1 FROM cupping_note WHERE id = $1 AND is_active`, [r.cuppingNoteId]);
    if (!node.rowCount) throw bad('unknown or inactive flavor wheel term');
  }
  if (r.coffeeId !== null && r.coffeeId !== undefined) {
    const coffee = await getCoffee(Number(r.coffeeId), tx);
    if (!coffee) throw bad(`coffee ${r.coffeeId} not found`);
    if (coffee.roaster_id !== r.roasterId) throw bad(`coffee ${r.coffeeId} does not belong to this roaster`);
  }
  return { proposedArchetype };
}

/** Record one or more remarks in one transaction; all or nothing. Returns the inserted rows. */
export async function recordRemarks(inputs: RemarkInput[], ctx: RemarkContext = {}): Promise<Array<{ id: string; index: number }>> {
  if (!Array.isArray(inputs) || !inputs.length) throw new RemarkError(400, 'REMARK_INVALID', 'send at least one remark');
  try {
    const ids = await withTransaction(async tx => {
      const out: Array<{ id: string; index: number }> = [];
      for (const [i, r] of inputs.entries()) {
        const { proposedArchetype } = await validate(tx, r, i);
        const ins = await tx.query<{ id: string }>(
          `INSERT INTO roastery_remark (roaster_id, coffee_id, portal_coffee_id, cupping_session_coffee_id, said_by,
                                        said_by_respondent_id, said_on, channel, topic, remark, cupping_note_id,
                                        proposed_archetype, recorded_by, record_source, supersedes_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
          [r.roasterId, r.coffeeId ?? null, r.portalCoffeeId ?? null, r.cuppingSessionCoffeeId ?? null, text(r.saidBy),
           r.saidByRespondentId ?? null, r.saidOn, r.channel, r.topic, r.remark.trim(), r.cuppingNoteId ?? null,
           proposedArchetype, text(r.recordedBy), text(r.recordSource), r.supersedesId ?? null]
        );
        out.push({ id: ins.rows[0].id, index: i });
      }
      return out;
    });
    if (ctx.actor) console.info('[roastery-remark] recorded', { actor: ctx.actor, n: ids.length });
    return ids;
  } catch (err) {
    // The guard trigger (ownership), a CHECK or a foreign key: the caller's input, not a server fault.
    const code = (err as { code?: string })?.code;
    if (code === '23000' || code === '23503' || code === '23514' || code === '22P02') {
      throw new RemarkError(400, 'REMARK_INVALID', (err as Error).message);
    }
    throw err;
  }
}
