// Cupping evidence, brief 1 (2026-10-18) — the only writer of the six cupping_*
// evidence tables (cupping_sessions, cupping_session_coffees,
// cupping_brew_params, cupping_scores, cupping_score_values,
// cupping_score_descriptors) and of the cupper reference table.
// backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_1_FOUNDATION.md, B1;
// design in DESIGN_CUPPING_EVIDENCE.md §4 to §6 (lint:cupping enforces the one door).
//
// Evidence is stored as observed: values on the scale the cupper used, the
// paper in raw_value. Conversion to 0 to 15 happens in SQL (cupping_to_ab(),
// from cupping_scale_step), never here. No cupper name, threshold or
// conversion is written in this file: cuppers are rows, the gap is
// param('cupper_gap').
//
// A score row is never edited. Saving a cupper's row again inserts a new row
// and gives the old one its single permitted transition (superseded_at,
// superseded_by_id, supersede_reason), then re-merges; a re-merge supersedes
// the previous merged row the same way. The guard trigger on cupping_scores
// refuses anything else, and RESTRICT foreign keys stop a DELETE cascading
// into evidence.
import { withTransaction, type Tx } from '../db/client.js';
import { recordCuppingSignal } from './dialSuggestion.js';
import { getMergedRanges, listCuppers as listCupperRows } from './cuppingReads.js';
import { getArchetypes } from './catalogReads.js';

export class CuppingError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'CuppingError';
  }
}
const invalid = (message: string, details?: unknown) => new CuppingError(400, 'CUPPING_INVALID', message, details);
const notFound = (what: string) => new CuppingError(404, 'CUPPING_NOT_FOUND', `${what} not found`);
const hasEvidence = (message: string) => new CuppingError(409, 'CUPPING_HAS_EVIDENCE', message);

// ── Inputs ─────────────────────────────────────────────────────────────────

export interface BrewParams {
  doseGrams?: number | null;
  waterGrams?: number | null;
  yieldGrams?: number | null;
  ratio?: number | null;
  waterTemperatureCelsius?: number | null;
  grindSize?: string | null;
  extractionTimeSeconds?: number | null;
  pressureBar?: number | null;
  steepTimeMinutes?: number | null;
  brewDevice?: string | null;
  notes?: string | null;
}

export interface SessionInput {
  sessionDate: string;
  sessionDatePrecision?: 'exact' | 'estimated';
  location?: string | null;
  sessionNotes?: string | null;
  recordSource: string;
  sheetFormat?: string | null;
  isBlind?: boolean | null;
  roasterPresent?: boolean | null;
  transcribedBy?: string | null;
  transcribedAt?: string | null;
  checkedBy?: string | null;
  brewDefaults?: BrewParams | null;
}

export interface SessionHeaderPatch {
  sessionDate?: string;
  recordSource?: string;
  sessionDatePrecision?: 'exact' | 'estimated';
  location?: string | null;
  sessionNotes?: string | null;
  sheetFormat?: string | null;
  isBlind?: boolean | null;
  roasterPresent?: boolean | null;
  transcribedBy?: string | null;
  transcribedAt?: string | null;
  checkedBy?: string | null;
  brewDefaults?: BrewParams | null;
}

export interface SessionCoffeeInput {
  displayOrder?: number | null;
  roastDate?: string | null;
  blindCode?: string | null;
  sampleNote?: string | null;
  isControl?: boolean;
  brew?: BrewParams | null;
}

export interface ScoreValueInput {
  dimensionId: number;
  valueMin?: number | null;
  valueMax?: number | null;
  rawValue?: string | null;
  notes?: string | null;
}

export interface DescriptorInput {
  cuppingNoteId: string;
  intensity?: number | null;
  customNotes?: string | null;
}

export interface CallInput {
  archetypeCall?: string | null;
  archetypeCallSecondary?: string | null;
  positionCall?: string | null;
  slotCallId?: number | null;
  callNote?: string | null;
}

export interface CupperScoreInput extends CallInput {
  sessionCoffeeId: number;
  cupperId: number;
  scaleCode?: string;
  overallNotes?: string | null;
  values?: ScoreValueInput[];
  descriptors?: DescriptorInput[];
  supersedeReason?: string;
}

export interface ManualMergeInput extends CallInput {
  overallNotes?: string | null;
  values?: ScoreValueInput[];
  descriptors?: DescriptorInput[];
}

// ── The merge rule (pure) ──────────────────────────────────────────────────

/** One cupper row as unionScores sees it: values already converted to 0 to 15 by SQL. */
export interface UnionRow {
  cupperName: string;
  scaleCode: string;
  archetypeCall?: string | null;
  archetypeCallSecondary?: string | null;
  positionCall?: string | null;
  slotCallId?: number | null;
  callNote?: string | null;
  overallNotes?: string | null;
  values: Array<{ dimensionId: number; dimensionName: string; isNumeric: boolean; abMin: number | null; abMax: number | null; notes?: string | null }>;
  descriptors: Array<{ cuppingNoteId: string; intensity?: number | null; customNotes?: string | null }>;
}

export interface UnionResult {
  values: Array<{ dimensionId: number; valueMin: number | null; valueMax: number | null; rawValue: string | null; notes: string | null }>;
  descriptors: Array<{ cuppingNoteId: string; intensity: number | null; customNotes: string | null }>;
  archetypeCall: string | null;
  archetypeCallSecondary: string | null;
  positionCall: string | null;
  slotCallId: number | null;
  callNote: string | null;
  overallNotes: string | null;
  mergeNote: string;
  disagreements: string[];
  oneCupper: string[];
  scaleCodes: string[];
  allAbScale: boolean;
}

const fmt = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}-${hi}`);

/** Gap between two closed ranges; 0 when they overlap or touch. */
export function rangeGap(a: [number, number], b: [number, number]): number {
  return Math.max(0, Math.max(a[0], b[0]) - Math.min(a[1], b[1]));
}

/**
 * union_v1 (DESIGN §6.3), pure. Numeric dimension: the union of the cuppers'
 * ranges; scored by one cupper only → her range, listed under "one cupper".
 * Two cuppers disagree on a dimension when the gap between their ranges is
 * greater than n (overlap, or a gap of exactly n, agree). Descriptors: the
 * union of nodes, each cupper's own words kept in custom_notes. A call is
 * kept only when every cupper who made one made the same one; otherwise null
 * and the calls go to call_note. allAbScale: every row is on ab_0_15 (the dial
 * signal fires only then).
 */
export function unionScores(rows: UnionRow[], n: number): UnionResult {
  if (!rows.length) throw new Error('unionScores needs at least one cupper row');
  const perCupper = (pick: (r: UnionRow) => string | null | undefined) =>
    rows.map(r => ({ who: r.cupperName, text: pick(r)?.trim() || null })).filter(x => x.text);
  const joinPerCupper = (items: Array<{ who: string; text: string | null }>) =>
    items.length ? items.map(x => `${x.who}: ${x.text}`).join('; ') : null;

  // Values, dimension by dimension, in first-seen order.
  const dims = new Map<number, { name: string; isNumeric: boolean }>();
  for (const r of rows) for (const v of r.values) if (!dims.has(v.dimensionId)) dims.set(v.dimensionId, { name: v.dimensionName, isNumeric: v.isNumeric });
  const values: UnionResult['values'] = [];
  const disagreements: string[] = [];
  const oneCupper: string[] = [];
  for (const [dimensionId, dim] of dims) {
    const entries = rows.map(r => ({ who: r.cupperName, v: r.values.find(x => x.dimensionId === dimensionId) })).filter(e => e.v);
    const notes = joinPerCupper(entries.map(e => ({ who: e.who, text: e.v!.notes?.trim() || null })).filter(x => x.text));
    const scored = dim.isNumeric
      ? entries.filter(e => e.v!.abMin !== null && e.v!.abMin !== undefined && e.v!.abMax !== null && e.v!.abMax !== undefined)
          .map(e => ({ who: e.who, lo: Number(e.v!.abMin), hi: Number(e.v!.abMax) }))
      : [];
    if (!scored.length) {
      values.push({ dimensionId, valueMin: null, valueMax: null, rawValue: null, notes });
      continue;
    }
    const lo = Math.min(...scored.map(s => s.lo));
    const hi = Math.max(...scored.map(s => s.hi));
    if (scored.length === 1) oneCupper.push(dim.name);
    let disagree = false;
    for (let i = 0; i < scored.length; i++) for (let j = i + 1; j < scored.length; j++) {
      if (rangeGap([scored[i].lo, scored[i].hi], [scored[j].lo, scored[j].hi]) > n) disagree = true;
    }
    if (disagree) disagreements.push(dim.name);
    values.push({
      dimensionId, valueMin: lo, valueMax: hi,
      rawValue: `union of: ${scored.map(s => `${s.who} ${fmt(s.lo, s.hi)}`).join(', ')}`,
      notes,
    });
  }

  // Descriptors: union of nodes, words per cupper.
  const descMap = new Map<string, { intensity: number | null; words: Array<{ who: string; text: string | null }> }>();
  for (const r of rows) for (const d of r.descriptors) {
    const cur = descMap.get(d.cuppingNoteId) ?? { intensity: null, words: [] };
    if (d.intensity !== null && d.intensity !== undefined) cur.intensity = Math.max(cur.intensity ?? -Infinity, Number(d.intensity));
    if (d.customNotes?.trim()) cur.words.push({ who: r.cupperName, text: d.customNotes.trim() });
    descMap.set(d.cuppingNoteId, cur);
  }
  const descriptors = [...descMap].map(([cuppingNoteId, d]) => ({ cuppingNoteId, intensity: d.intensity, customNotes: joinPerCupper(d.words) }));

  // Calls: kept only when unanimous among the cuppers who made one.
  const callNotes: string[] = [];
  function agreed<T extends string | number>(label: string, pick: (r: UnionRow) => T | null | undefined): T | null {
    const made = rows.map(r => ({ who: r.cupperName, c: pick(r) })).filter(x => x.c !== null && x.c !== undefined && x.c !== '');
    if (!made.length) return null;
    const distinct = [...new Set(made.map(x => String(x.c)))];
    if (distinct.length === 1) return made[0].c as T;
    callNotes.push(`${label} differ: ${made.map(x => `${x.who}=${x.c}`).join(', ')}`);
    return null;
  }
  const archetypeCall = agreed('archetype calls', r => r.archetypeCall);
  const archetypeCallSecondary = agreed('secondary calls', r => r.archetypeCallSecondary);
  const positionCall = agreed('position calls', r => r.positionCall);
  const slotCallId = agreed('slot calls', r => r.slotCallId);
  const cupperCallNotes = joinPerCupper(perCupper(r => r.callNote));
  if (cupperCallNotes) callNotes.push(cupperCallNotes);

  const scaleCodes = [...new Set(rows.map(r => r.scaleCode))].sort();
  const allAbScale = rows.every(r => r.scaleCode === 'ab_0_15');
  const parts = [`union_v1; scales: ${rows.map(r => `${r.cupperName} ${r.scaleCode}`).join(', ')}`];
  if (disagreements.length) parts.push(`cupper disagreement (gap > ${n}) on: ${disagreements.join(', ')}`);
  if (oneCupper.length) parts.push(`one cupper: ${oneCupper.join(', ')}`);
  if (!allAbScale) parts.push('no dial signal (converted scale)');

  return {
    values, descriptors, archetypeCall, archetypeCallSecondary, positionCall, slotCallId,
    callNote: callNotes.length ? callNotes.join('; ') : null,
    overallNotes: joinPerCupper(perCupper(r => r.overallNotes)),
    mergeNote: parts.join('; '),
    disagreements, oneCupper, scaleCodes, allAbScale,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(value: unknown, field: string, required = false): void {
  if (value === null || value === undefined || value === '') {
    if (required) throw invalid(`${field} is required`);
    return;
  }
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) throw invalid(`${field} must be a date (YYYY-MM-DD)`);
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function brewRow(b: BrewParams | null | undefined) {
  if (!b) return null;
  const row = {
    dose_grams: b.doseGrams ?? null, water_grams: b.waterGrams ?? null, yield_grams: b.yieldGrams ?? null,
    ratio: b.ratio ?? null, water_temperature_celsius: b.waterTemperatureCelsius ?? null,
    grind_size: cleanText(b.grindSize), extraction_time_seconds: b.extractionTimeSeconds ?? null,
    pressure_bar: b.pressureBar ?? null, steep_time_minutes: b.steepTimeMinutes ?? null,
    brew_device: cleanText(b.brewDevice), notes: cleanText(b.notes),
  };
  return Object.values(row).some(v => v !== null) ? row : null;
}

function brewFromJson(j: Record<string, unknown> | null): BrewParams | null {
  return j ? (j as BrewParams) : null;
}

async function assertSheetFormat(tx: Tx, code: string | null | undefined): Promise<void> {
  if (!code) return;
  const r = await tx.query(`SELECT 1 FROM cupping_sheet_format WHERE code = $1`, [code]);
  if (!r.rowCount) throw invalid(`unknown sheet format '${code}'`);
}

async function lockSessionCoffee(tx: Tx, sessionCoffeeId: number): Promise<{ id: number; session_id: number; coffee_id: number }> {
  const r = await tx.query<{ id: number; session_id: number; coffee_id: number }>(
    `SELECT id, session_id, coffee_id FROM cupping_session_coffees WHERE id = $1 FOR UPDATE`, [sessionCoffeeId]
  );
  if (!r.rows[0]) throw notFound(`session coffee ${sessionCoffeeId}`);
  return r.rows[0];
}

async function nextScoreId(tx: Tx): Promise<number> {
  const r = await tx.query<{ id: string }>(`SELECT nextval(pg_get_serial_sequence('cupping_scores', 'id')) AS id`);
  return Number(r.rows[0].id);
}

async function assertCalls(tx: Tx, input: CallInput): Promise<void> {
  const codes = new Set((await getArchetypes(tx)).map(a => a.code as string));
  for (const [field, v] of [['archetypeCall', input.archetypeCall], ['archetypeCallSecondary', input.archetypeCallSecondary]] as const) {
    if (v && !codes.has(v)) throw invalid(`${field} '${v}' is not an archetype code`);
  }
  if (input.slotCallId !== null && input.slotCallId !== undefined) {
    const r = await tx.query(`SELECT 1 FROM coffee_dial_slot WHERE id = $1 AND is_active`, [input.slotCallId]);
    if (!r.rowCount) throw invalid(`slotCallId ${input.slotCallId} is not an active dial slot`);
  }
}

interface ScaleRow { code: string; kind: 'numeric' | 'ordinal'; scale_min: string | null; scale_max: string | null }

/** Validation of a score's values and descriptors against the scale used (DESIGN §6.2, brief B1). */
async function assertValuesAndDescriptors(tx: Tx, scale: ScaleRow, values: ScoreValueInput[], descriptors: DescriptorInput[]): Promise<void> {
  const dimIds = values.map(v => Number(v.dimensionId));
  if (new Set(dimIds).size !== dimIds.length) throw invalid('a dimension appears twice');
  const dims = dimIds.length
    ? (await tx.query<{ id: number; name: string; is_numeric: boolean }>(`SELECT id, name, is_numeric FROM coffee_dimensions WHERE id = ANY($1::int[])`, [dimIds])).rows
    : [];
  const byId = new Map(dims.map(d => [d.id, d]));
  const lo = scale.scale_min === null ? null : Number(scale.scale_min);
  const hi = scale.scale_max === null ? null : Number(scale.scale_max);
  for (const v of values) {
    const dim = byId.get(Number(v.dimensionId));
    if (!dim) throw invalid(`unknown dimension ${v.dimensionId}`);
    const hasMin = v.valueMin !== null && v.valueMin !== undefined;
    const hasMax = v.valueMax !== null && v.valueMax !== undefined;
    const raw = cleanText(v.rawValue);
    if (!dim.is_numeric) {
      if (hasMin || hasMax) throw invalid(`${dim.name} takes words, not a value`);
      continue;
    }
    if (scale.kind === 'ordinal') {
      if (hasMin || hasMax) throw invalid(`${dim.name}: scale ${scale.code} stores the word in rawValue, valueMin/valueMax stay empty`);
      continue;
    }
    if (hasMin !== hasMax) throw invalid(`${dim.name}: give both valueMin and valueMax, or neither`);
    if (!hasMin) continue;
    const a = Number(v.valueMin), b = Number(v.valueMax);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw invalid(`${dim.name}: values must be numbers`);
    if (a > b) throw invalid(`${dim.name}: valueMin is greater than valueMax`);
    if ((lo !== null && a < lo) || (hi !== null && b > hi)) throw invalid(`${dim.name}: ${fmt(a, b)} is outside the ${scale.code} scale (${lo} to ${hi})`);
    if (!raw && (scale.code !== 'ab_0_15' || a !== b)) throw invalid(`${dim.name}: rawValue (what is on the paper) is required for a range or a scale other than ab_0_15`);
  }
  const noteIds = descriptors.map(d => d.cuppingNoteId);
  if (new Set(noteIds).size !== noteIds.length) throw invalid('a descriptor appears twice');
  if (noteIds.length) {
    const known = await tx.query<{ id: string }>(`SELECT id FROM cupping_note WHERE id = ANY($1::uuid[]) AND is_active`, [noteIds]);
    const missing = noteIds.filter(id => !known.rows.some(r => r.id === id));
    if (missing.length) throw invalid(`unknown or inactive flavor wheel term(s): ${missing.join(', ')}`);
  }
}

async function insertScoreChildren(tx: Tx, scoreId: number, values: Array<{ dimensionId: number; valueMin?: number | null; valueMax?: number | null; rawValue?: string | null; notes?: string | null }>, descriptors: Array<{ cuppingNoteId: string; intensity?: number | null; customNotes?: string | null }>): Promise<void> {
  for (const v of values) {
    await tx.query(
      `INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max, raw_value, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [scoreId, v.dimensionId, v.valueMin ?? null, v.valueMax ?? null, cleanText(v.rawValue), cleanText(v.notes)]
    );
  }
  for (const d of descriptors) {
    await tx.query(
      `INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id, intensity, custom_notes)
       VALUES ($1, $2, $3, $4)`,
      [scoreId, d.cuppingNoteId, d.intensity ?? null, cleanText(d.customNotes)]
    );
  }
}

/** The one permitted transition on a score row (the guard trigger allows nothing else). */
async function supersedeScore(tx: Tx, oldId: number, newId: number, reason: string): Promise<void> {
  await tx.query(
    `UPDATE cupping_scores SET superseded_at = now(), superseded_by_id = $2, supersede_reason = $3
     WHERE id = $1 AND superseded_at IS NULL`,
    [oldId, newId, reason]
  );
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function createSession(input: SessionInput): Promise<number> {
  assertDate(input.sessionDate, 'sessionDate', true);
  assertDate(input.transcribedAt, 'transcribedAt');
  const recordSource = cleanText(input.recordSource);
  if (!recordSource) throw invalid('recordSource is required');
  const precision = input.sessionDatePrecision ?? 'exact';
  if (precision !== 'exact' && precision !== 'estimated') throw invalid('sessionDatePrecision must be exact or estimated');
  return withTransaction(async tx => {
    await assertSheetFormat(tx, input.sheetFormat);
    const r = await tx.query<{ id: number }>(
      `INSERT INTO cupping_sessions (session_date, session_date_precision, location, session_notes, record_source, sheet_format,
                                     is_blind, roaster_present, transcribed_by, transcribed_at, checked_by, brew_defaults)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [input.sessionDate, precision, cleanText(input.location), cleanText(input.sessionNotes), recordSource,
       input.sheetFormat ?? null, input.isBlind ?? null, input.roasterPresent ?? null, cleanText(input.transcribedBy),
       input.transcribedAt ?? null, cleanText(input.checkedBy), input.brewDefaults ? JSON.stringify(input.brewDefaults) : null]
    );
    return r.rows[0].id;
  });
}

const HEADER_COLUMNS: Record<keyof SessionHeaderPatch, string> = {
  sessionDate: 'session_date', recordSource: 'record_source', sessionDatePrecision: 'session_date_precision', location: 'location',
  sessionNotes: 'session_notes', sheetFormat: 'sheet_format', isBlind: 'is_blind', roasterPresent: 'roaster_present',
  transcribedBy: 'transcribed_by', transcribedAt: 'transcribed_at', checkedBy: 'checked_by', brewDefaults: 'brew_defaults',
};

/** Header metadata only; the session's scores are never touched. */
export async function updateSessionHeader(sessionId: number, patch: SessionHeaderPatch): Promise<void> {
  if (patch.sessionDate !== undefined) assertDate(patch.sessionDate, 'sessionDate', true);
  if (patch.transcribedAt !== undefined) assertDate(patch.transcribedAt, 'transcribedAt');
  if (patch.sessionDatePrecision !== undefined && patch.sessionDatePrecision !== 'exact' && patch.sessionDatePrecision !== 'estimated') {
    throw invalid('sessionDatePrecision must be exact or estimated');
  }
  const sets: string[] = [];
  const params: unknown[] = [sessionId];
  for (const [key, col] of Object.entries(HEADER_COLUMNS) as Array<[keyof SessionHeaderPatch, string]>) {
    if (patch[key] === undefined) continue;
    let v: unknown = patch[key];
    if (key === 'brewDefaults') v = v ? JSON.stringify(v) : null;
    else if (typeof v === 'string') v = cleanText(v);
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  }
  await withTransaction(async tx => {
    await assertSheetFormat(tx, patch.sheetFormat);
    const exists = await tx.query(`SELECT 1 FROM cupping_sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
    if (!exists.rowCount) throw notFound(`session ${sessionId}`);
    if (sets.length) await tx.query(`UPDATE cupping_sessions SET ${sets.join(', ')} WHERE id = $1`, params);
  });
}

/** Removes a session with nothing underneath it (no session coffee). */
export async function removeEmptySession(sessionId: number): Promise<void> {
  await withTransaction(async tx => {
    const exists = await tx.query(`SELECT 1 FROM cupping_sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
    if (!exists.rowCount) throw notFound(`session ${sessionId}`);
    const children = await tx.query(`SELECT 1 FROM cupping_session_coffees WHERE session_id = $1 LIMIT 1`, [sessionId]);
    if (children.rowCount) throw hasEvidence('the session still has coffees; remove the unscored ones first (scored ones are evidence and stay)');
    await tx.query(`DELETE FROM cupping_sessions WHERE id = $1`, [sessionId]);
  });
}

// ── Session coffees and brew params ────────────────────────────────────────

export async function addSessionCoffee(sessionId: number, coffeeId: number, opts: SessionCoffeeInput = {}): Promise<number> {
  assertDate(opts.roastDate, 'roastDate');
  return withTransaction(async tx => {
    const s = await tx.query<{ brew_defaults: Record<string, unknown> | null }>(
      `SELECT brew_defaults FROM cupping_sessions WHERE id = $1 FOR UPDATE`, [sessionId]
    );
    if (!s.rows[0]) throw notFound(`session ${sessionId}`);
    const coffee = await tx.query(`SELECT 1 FROM coffees WHERE id = $1`, [coffeeId]);
    if (!coffee.rowCount) throw notFound(`coffee ${coffeeId}`);
    let order = opts.displayOrder ?? null;
    if (order === null) {
      const next = await tx.query<{ next: number }>(
        `SELECT COALESCE(MAX(display_order), 0) + 1 AS next FROM cupping_session_coffees WHERE session_id = $1`, [sessionId]
      );
      order = next.rows[0].next;
    }
    const r = await tx.query<{ id: number }>(
      `INSERT INTO cupping_session_coffees (session_id, coffee_id, display_order, roast_date, blind_code, sample_note, is_control)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [sessionId, coffeeId, order, opts.roastDate ?? null, cleanText(opts.blindCode), cleanText(opts.sampleNote), opts.isControl ?? false]
    );
    const scId = r.rows[0].id;
    const brew = brewRow(opts.brew ?? brewFromJson(s.rows[0].brew_defaults));
    if (brew) await writeBrewRow(tx, scId, brew);
    return scId;
  });
}

/** Sample metadata only (order, roast date, blind code, sample note, control flag). */
export async function updateSessionCoffee(sessionCoffeeId: number, patch: Omit<SessionCoffeeInput, 'brew'>): Promise<void> {
  assertDate(patch.roastDate, 'roastDate');
  const cols: Record<string, unknown> = {};
  if (patch.displayOrder !== undefined) cols.display_order = patch.displayOrder;
  if (patch.roastDate !== undefined) cols.roast_date = patch.roastDate || null;
  if (patch.blindCode !== undefined) cols.blind_code = cleanText(patch.blindCode);
  if (patch.sampleNote !== undefined) cols.sample_note = cleanText(patch.sampleNote);
  if (patch.isControl !== undefined) cols.is_control = Boolean(patch.isControl);
  await withTransaction(async tx => {
    await lockSessionCoffee(tx, sessionCoffeeId);
    const keys = Object.keys(cols);
    if (!keys.length) return;
    await tx.query(
      `UPDATE cupping_session_coffees SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [sessionCoffeeId, ...keys.map(k => cols[k])]
    );
  });
}

async function writeBrewRow(tx: Tx, sessionCoffeeId: number, row: NonNullable<ReturnType<typeof brewRow>>): Promise<void> {
  const cols = Object.keys(row);
  await tx.query(
    `INSERT INTO cupping_brew_params (session_coffee_id, ${cols.join(', ')})
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (session_coffee_id) DO UPDATE SET ${cols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`,
    [sessionCoffeeId, ...cols.map(c => (row as Record<string, unknown>)[c])]
  );
}

/**
 * The brew of one session coffee; editable until a score exists under it
 * (CUPPING_HAS_EVIDENCE after). A sample scored before it had any brew row
 * (a Score Entry session from before brief 1) may still get its first one:
 * recording the protocol is an insert, not a change (brief 2, flight C).
 */
export async function saveBrewParams(sessionCoffeeId: number, params: BrewParams): Promise<void> {
  await withTransaction(async tx => {
    await lockSessionCoffee(tx, sessionCoffeeId);
    const scored = await tx.query(`SELECT 1 FROM cupping_scores WHERE session_coffee_id = $1 LIMIT 1`, [sessionCoffeeId]);
    const existing = await tx.query(`SELECT 1 FROM cupping_brew_params WHERE session_coffee_id = $1`, [sessionCoffeeId]);
    if (scored.rowCount && existing.rowCount) throw hasEvidence('brew params are fixed once a score exists for this sample');
    const row = brewRow(params);
    if (row) await writeBrewRow(tx, sessionCoffeeId, row);
  });
}

/** Removes a sample nobody scored (its brew row with it). */
export async function removeEmptySessionCoffee(sessionCoffeeId: number): Promise<void> {
  await withTransaction(async tx => {
    await lockSessionCoffee(tx, sessionCoffeeId);
    const scored = await tx.query(`SELECT 1 FROM cupping_scores WHERE session_coffee_id = $1 LIMIT 1`, [sessionCoffeeId]);
    if (scored.rowCount) throw hasEvidence('this sample has scores; cupping evidence is never deleted');
    await tx.query(`DELETE FROM cupping_brew_params WHERE session_coffee_id = $1`, [sessionCoffeeId]);
    await tx.query(`DELETE FROM cupping_session_coffees WHERE id = $1`, [sessionCoffeeId]);
  });
}

// ── Cupper rows ────────────────────────────────────────────────────────────

/**
 * One cupper's row for one session coffee, as written. When the cupper already
 * has a current row there, the new row replaces it: the old row is superseded
 * (reason 'edited in Score Entry' unless given) and, if the session coffee has
 * a current merged row, it is merged again so the merge follows the
 * correction. Never fires the dial signal directly.
 */
export async function saveCupperScore(input: CupperScoreInput): Promise<number> {
  const scaleCode = input.scaleCode ?? 'ab_0_15';
  const values = input.values ?? [];
  const descriptors = input.descriptors ?? [];
  let remerge: number | null = null;
  const scoreId = await withTransaction(async tx => {
    await lockSessionCoffee(tx, input.sessionCoffeeId);
    const cupper = await tx.query(`SELECT 1 FROM cupper WHERE id = $1 AND is_active`, [input.cupperId]);
    if (!cupper.rowCount) throw invalid(`cupper ${input.cupperId} is not an active cupper`);
    const scale = (await tx.query<ScaleRow>(`SELECT code, kind, scale_min, scale_max FROM cupping_scale WHERE code = $1`, [scaleCode])).rows[0];
    if (!scale) throw invalid(`unknown scale '${scaleCode}'`);
    if (scale.code === 'legacy') throw invalid("the 'legacy' scale tags rows written before cupping evidence; new rows use the scale on the sheet");
    await assertCalls(tx, input);
    await assertValuesAndDescriptors(tx, scale, values, descriptors);

    const current = await tx.query<{ id: number }>(
      `SELECT id FROM cupping_scores WHERE session_coffee_id = $1 AND cupper_id = $2 AND NOT is_merged AND superseded_at IS NULL`,
      [input.sessionCoffeeId, input.cupperId]
    );
    const newId = await nextScoreId(tx);
    if (current.rows[0]) await supersedeScore(tx, current.rows[0].id, newId, cleanText(input.supersedeReason) ?? 'edited in Score Entry');
    await tx.query(
      `INSERT INTO cupping_scores (id, session_coffee_id, cupper_id, is_merged, scale_code, overall_notes,
                                   archetype_call, archetype_call_secondary, position_call, slot_call_id, call_note)
       VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8, $9, $10)`,
      [newId, input.sessionCoffeeId, input.cupperId, scaleCode, cleanText(input.overallNotes),
       input.archetypeCall || null, input.archetypeCallSecondary || null, cleanText(input.positionCall),
       input.slotCallId ?? null, cleanText(input.callNote)]
    );
    await insertScoreChildren(tx, newId, values, descriptors);

    const merged = await tx.query(
      `SELECT 1 FROM cupping_scores WHERE session_coffee_id = $1 AND is_merged AND superseded_at IS NULL`, [input.sessionCoffeeId]
    );
    if (current.rows[0] && merged.rowCount) {
      const m = await mergeInTx(tx, input.sessionCoffeeId);
      remerge = m.coffeeId;
    }
    return newId;
  });
  if (remerge !== null) await refreshDialSignalSafely(remerge);
  return scoreId;
}

// ── Merges ─────────────────────────────────────────────────────────────────

async function loadCupperRows(tx: Tx, sessionCoffeeId: number): Promise<UnionRow[]> {
  const heads = await tx.query<{
    id: number; cupper_name: string; scale_code: string; archetype_call: string | null; archetype_call_secondary: string | null;
    position_call: string | null; slot_call_id: number | null; call_note: string | null; overall_notes: string | null;
  }>(
    `SELECT cs.id, cu.name AS cupper_name, cs.scale_code, cs.archetype_call::text AS archetype_call,
            cs.archetype_call_secondary::text AS archetype_call_secondary, cs.position_call, cs.slot_call_id,
            cs.call_note, cs.overall_notes
     FROM cupping_scores cs JOIN cupper cu ON cu.id = cs.cupper_id
     WHERE cs.session_coffee_id = $1 AND NOT cs.is_merged AND cs.superseded_at IS NULL
     ORDER BY cu.name`,
    [sessionCoffeeId]
  );
  if (!heads.rows.length) return [];
  const ids = heads.rows.map(h => h.id);
  const vals = await tx.query<{ cupping_score_id: number; dimension_id: number; dimension_name: string; is_numeric: boolean; ab_min: string | null; ab_max: string | null; notes: string | null }>(
    `SELECT csv.cupping_score_id, csv.dimension_id, d.name AS dimension_name, d.is_numeric, ab.ab_min, ab.ab_max, csv.notes
     FROM cupping_score_values csv
     JOIN cupping_scores cs     ON cs.id = csv.cupping_score_id
     JOIN coffee_dimensions d   ON d.id = csv.dimension_id
     CROSS JOIN LATERAL cupping_to_ab(cs.scale_code, csv.value_min, csv.value_max, csv.raw_value) ab
     WHERE csv.cupping_score_id = ANY($1::int[])
     ORDER BY d.display_order`,
    [ids]
  );
  const descs = await tx.query<{ cupping_score_id: number; cupping_note_id: string; intensity: string | null; custom_notes: string | null }>(
    `SELECT cupping_score_id, cupping_note_id, intensity, custom_notes FROM cupping_score_descriptors WHERE cupping_score_id = ANY($1::int[])`,
    [ids]
  );
  return heads.rows.map(h => ({
    cupperName: h.cupper_name,
    scaleCode: h.scale_code,
    archetypeCall: h.archetype_call, archetypeCallSecondary: h.archetype_call_secondary,
    positionCall: h.position_call, slotCallId: h.slot_call_id, callNote: h.call_note, overallNotes: h.overall_notes,
    values: vals.rows.filter(v => v.cupping_score_id === h.id).map(v => ({
      dimensionId: v.dimension_id, dimensionName: v.dimension_name, isNumeric: v.is_numeric,
      abMin: v.ab_min === null ? null : Number(v.ab_min), abMax: v.ab_max === null ? null : Number(v.ab_max), notes: v.notes,
    })),
    descriptors: descs.rows.filter(d => d.cupping_score_id === h.id).map(d => ({
      cuppingNoteId: d.cupping_note_id, intensity: d.intensity === null ? null : Number(d.intensity), customNotes: d.custom_notes,
    })),
  }));
}

async function insertMergedRow(tx: Tx, sessionCoffeeId: number, row: {
  mergeRule: 'union_v1' | 'manual'; mergeNote: string | null; overallNotes: string | null;
  archetypeCall: string | null; archetypeCallSecondary: string | null; positionCall: string | null; slotCallId: number | null; callNote: string | null;
  values: Array<{ dimensionId: number; valueMin?: number | null; valueMax?: number | null; rawValue?: string | null; notes?: string | null }>;
  descriptors: DescriptorInput[];
}, supersedeReason: string): Promise<number> {
  const current = await tx.query<{ id: number }>(
    `SELECT id FROM cupping_scores WHERE session_coffee_id = $1 AND is_merged AND superseded_at IS NULL`, [sessionCoffeeId]
  );
  const newId = await nextScoreId(tx);
  if (current.rows[0]) await supersedeScore(tx, current.rows[0].id, newId, supersedeReason);
  await tx.query(
    `INSERT INTO cupping_scores (id, session_coffee_id, cupper_id, is_merged, scale_code, overall_notes, merge_rule, merge_note,
                                 archetype_call, archetype_call_secondary, position_call, slot_call_id, call_note)
     VALUES ($1, $2, NULL, true, 'ab_0_15', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [newId, sessionCoffeeId, row.overallNotes, row.mergeRule, row.mergeNote,
     row.archetypeCall, row.archetypeCallSecondary, row.positionCall, row.slotCallId, row.callNote]
  );
  await insertScoreChildren(tx, newId, row.values, row.descriptors);
  return newId;
}

async function mergeInTx(tx: Tx, sessionCoffeeId: number, opts: { n?: number } = {}): Promise<{ mergedScoreId: number; coffeeId: number; union: UnionResult }> {
  const sc = await lockSessionCoffee(tx, sessionCoffeeId);
  const rows = await loadCupperRows(tx, sessionCoffeeId);
  if (!rows.length) throw new CuppingError(409, 'CUPPING_NO_CUPPER_ROWS', `session coffee ${sessionCoffeeId} has no current cupper row to merge`);
  let n = opts.n;
  if (n === undefined) {
    const p = await tx.query<{ v: string | null }>(`SELECT param('cupper_gap') AS v`);
    if (p.rows[0]?.v === null || p.rows[0]?.v === undefined) throw new Error("evidence_parameter 'cupper_gap' has no current row");
    n = Number(p.rows[0].v);
  }
  const union = unionScores(rows, n);
  const mergedScoreId = await insertMergedRow(tx, sessionCoffeeId, {
    mergeRule: 'union_v1', mergeNote: union.mergeNote, overallNotes: union.overallNotes,
    archetypeCall: union.archetypeCall, archetypeCallSecondary: union.archetypeCallSecondary,
    positionCall: union.positionCall, slotCallId: union.slotCallId, callNote: union.callNote,
    values: union.values, descriptors: union.descriptors,
  }, 'merged by rule again');
  return { mergedScoreId, coffeeId: sc.coffee_id, union };
}

/**
 * The merged row of one session coffee, by rule (union_v1, DESIGN §6.3), also
 * for a single cupper. Supersedes the previous merged row, then refreshes the
 * coffee's dial signal (fires only when every cupper row is ab_0_15).
 */
export async function mergeByRule(sessionCoffeeId: number, opts: { n?: number } = {}): Promise<{ mergedScoreId: number; coffeeId: number; union: UnionResult }> {
  const result = await withTransaction(tx => mergeInTx(tx, sessionCoffeeId, opts));
  await refreshDialSignalSafely(result.coffeeId);
  return result;
}

/** Score Entry's hand merge: same supersede path as mergeByRule, merge_rule 'manual', the reason as merge_note. */
export async function saveManualMerge(sessionCoffeeId: number, input: ManualMergeInput, reason: string): Promise<number> {
  const note = cleanText(reason);
  if (!note) throw invalid('a manual merge needs a reason');
  const values = input.values ?? [];
  const descriptors = input.descriptors ?? [];
  const result = await withTransaction(async tx => {
    const sc = await lockSessionCoffee(tx, sessionCoffeeId);
    const scale = (await tx.query<ScaleRow>(`SELECT code, kind, scale_min, scale_max FROM cupping_scale WHERE code = 'ab_0_15'`)).rows[0];
    await assertCalls(tx, input);
    await assertValuesAndDescriptors(tx, scale, values, descriptors);
    const id = await insertMergedRow(tx, sessionCoffeeId, {
      mergeRule: 'manual', mergeNote: note, overallNotes: cleanText(input.overallNotes),
      archetypeCall: input.archetypeCall || null, archetypeCallSecondary: input.archetypeCallSecondary || null,
      positionCall: cleanText(input.positionCall), slotCallId: input.slotCallId ?? null, callNote: cleanText(input.callNote),
      values, descriptors,
    }, 'replaced by a manual merge');
    return { id, coffeeId: sc.coffee_id };
  });
  await refreshDialSignalSafely(result.coffeeId);
  return result.id;
}

// ── The dial signal ────────────────────────────────────────────────────────

/**
 * Recompute the coffee's cupping dial signal from its latest merged range:
 * record it when every cupper row behind that merge is native ab_0_15,
 * otherwise retract the current cupping signal (a converted or legacy scale
 * has no meaningful midpoint on the dial). Called after a merge, by the brief 2
 * loader after its manifest, and by catalogService.setMatchArchetype when the
 * archetype changes. The one caller of dialSuggestion.recordCuppingSignal.
 */
export async function refreshDialSignal(coffeeId: number): Promise<'recorded' | 'retracted'> {
  const ranges = await getMergedRanges(coffeeId);
  const merged = ranges.filter(r => r.basis === 'merged');
  if (merged.length && merged.every(r => r.all_ab_scale)) {
    await recordCuppingSignal(coffeeId);
    return 'recorded';
  }
  await recordCuppingSignal(coffeeId, { retract: true });
  return 'retracted';
}

async function refreshDialSignalSafely(coffeeId: number): Promise<void> {
  try {
    await refreshDialSignal(coffeeId);
  } catch (err) {
    // The signal is advisory (read only by the dormant consensus view); a
    // failure must not fail the evidence write that already committed.
    console.error(`[cuppingService] refreshDialSignal(${coffeeId}) failed (non-critical)`, err);
  }
}

// ── Cuppers (reference rows) ───────────────────────────────────────────────

export async function listCuppers(filter: { activeOnly?: boolean } = {}) {
  return listCupperRows(filter);
}

/** The admin door for the cupper table: a new cupper is a row, never code. */
export async function addCupper(name: string, opts: { since?: string | null; note?: string | null } = {}): Promise<{ id: number; name: string }> {
  const clean = cleanText(name);
  if (!clean) throw invalid('name is required');
  assertDate(opts.since, 'since');
  return withTransaction(async tx => {
    const dup = await tx.query(`SELECT 1 FROM cupper WHERE lower(name) = lower($1)`, [clean]);
    if (dup.rowCount) throw new CuppingError(409, 'CUPPING_CUPPER_EXISTS', `a cupper named '${clean}' already exists`);
    const r = await tx.query<{ id: number; name: string }>(
      `INSERT INTO cupper (name, since, note) VALUES ($1, $2, $3) RETURNING id, name`,
      [clean, opts.since ?? null, cleanText(opts.note)]
    );
    return r.rows[0];
  });
}
