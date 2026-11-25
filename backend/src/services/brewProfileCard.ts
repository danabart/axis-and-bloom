// Usual Drink 1 (2026-11-12), B2 / B3 — the options payload the post-result
// card and the Profile mirror render from, and the card's one writer path.
// Every field, value, label, prompt, cap and word comes from the field rows
// (getBrewProfileFieldsConfig, the one reader of v_brew_profile_field_current)
// and brew_parameter; nothing is typed here. Every row goes through
// customerFacts.record.brewProfileChange, the one door (G2.6).
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md
// Usual Drink 2 (2026-11-24): groups, the values_from link, the card flag, the
// exclusive flag and limits in the payload; the Profile's one save
// (saveRoutine). backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_2_ROUTINE_AND_PROFILE.md
import { createHash } from 'crypto';
import { db, withTransaction, type Tx } from '../db/client.js';
import { record, type FactResult } from './customerFacts.js';
import {
  getBrewProfileFieldDefs, getBrewProfileFieldsConfig, validateFullValue, incrementBrewProfileCounter,
  checkValuesFrom, fieldApplies, answerList, type BrewProfileFieldConfig,
} from './brewProfile.js';
import { brewTextParams, brewParam } from './brewParameters.js';
import { getBrewProfileCurrent } from './customerReads.js';

type Runner = Tx | typeof db;

export class PostResultCardError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'PostResultCardError';
  }
}

export interface OptionValue { code: string; label: string; pinned: boolean; acceptsWords: boolean; aliases: string[]; exclusive: boolean }
export interface OptionField {
  code: string; label: string; prompt: string | null; type: string; picker: string;
  maxItems: number | null; maxItemLen: number | null;
  /** Usual Drink 2 (B4): the routine group, or null */
  group: { code: string; label: string; sortOrder: number } | null;
  /** Usual Drink 2 (B4): the field whose answers this field's value is one of, or null */
  valuesFrom: string | null;
  /** active values: what a picker offers */
  values: OptionValue[];
  /** every value (inactive included) by code: how a stored value is displayed (A4) */
  displayLabels: Record<string, string>;
}
export interface BrewProfileOptions { fields: OptionField[]; copy: Record<string, string>; limits: { typeaheadMaxRows: number } }

/** Card fields: active, is_on_card, with a prompt (Usual Drink 2 B4; prompt NULL stays a kill switch). */
export function cardFields(): BrewProfileFieldConfig[] {
  return getBrewProfileFieldDefs().filter(f => f.isActive && f.isOnCard && f.prompt);
}

function toOption(f: BrewProfileFieldConfig): OptionField {
  return {
    code: f.code, label: f.label, prompt: f.prompt, type: f.type, picker: f.picker,
    maxItems: f.maxLength ?? null, maxItemLen: f.maxItemLength ?? null,
    group: f.group ? { ...f.group } : null,
    valuesFrom: f.valuesFrom,
    values: f.values.filter(v => v.isActive).map(v => ({ code: v.code, label: v.label, pinned: v.pinned, acceptsWords: v.acceptsWords, aliases: v.aliases, exclusive: v.exclusive })),
    displayLabels: Object.fromEntries(f.values.map(v => [v.code, v.label])),
  };
}

/** The options payload: 'card' = card-eligible fields; 'mirror' = every active field. */
export async function brewProfileOptions(scope: 'card' | 'mirror', runner: Runner = db): Promise<BrewProfileOptions> {
  const list = scope === 'card' ? cardFields() : getBrewProfileFieldDefs().filter(f => f.isActive);
  return {
    fields: list.map(toOption), copy: await brewTextParams(runner),
    limits: { typeaheadMaxRows: await brewParam('typeahead_max_rows', runner) },
  };
}

export interface CardAnswer { field: string; value: unknown; words?: unknown }
export interface PostResultCardInput { uid: string; quizSessionId: string; answers: CardAnswer[]; shown: string[] }
export interface PostResultCardResult { inserted: number; rows: Array<{ field: string; op: 'set' | 'declined'; inserted: boolean }> }

function valueKey(value: unknown): string {
  return Array.isArray(value) ? value.join(',') : String(value);
}

/**
 * The card's one write (B2). Ownership: the caller's profile (by Firebase uid,
 * as POST /results resolves it, never created here) must be the session's
 * user_id (403); a proxy session (taken_by_user_id set) is refused first
 * (409). Every shown field without an answer gets a declined row (D16). One
 * transaction for the whole card; idempotent by (source, source_id).
 */
export async function recordPostResultCard(input: PostResultCardInput, runner?: Tx): Promise<PostResultCardResult> {
  const q = runner ?? db;
  const session = (await q.query<{ user_id: string; taken_by_user_id: string | null }>(
    `SELECT user_id, taken_by_user_id FROM quiz_session WHERE id = $1`, [input.quizSessionId]
  )).rows[0];
  if (!session) throw new PostResultCardError(404, 'QUIZ_SESSION_NOT_FOUND', 'quiz session not found');
  if (session.taken_by_user_id) throw new PostResultCardError(409, 'PROXY_QUIZ', 'the card is not shown after a quiz taken for someone else');
  const profileId = (await q.query<{ id: string }>(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [input.uid])).rows[0]?.id;
  if (!profileId || profileId !== session.user_id) throw new PostResultCardError(403, 'NOT_YOUR_QUIZ', 'this quiz session belongs to someone else');

  const eligible = new Map(cardFields().map(f => [f.code, f]));
  const shown = [...new Set(input.shown)];
  for (const code of shown) {
    if (!eligible.has(code)) throw new PostResultCardError(400, 'FIELD_NOT_ON_CARD', `${code} is not on the card`);
  }
  const answers = new Map<string, { value: unknown; words: string | null }>();
  for (const a of input.answers) {
    if (!shown.includes(a.field)) throw new PostResultCardError(400, 'ANSWER_NOT_SHOWN', `${a.field} was not shown`);
    const cfg = getBrewProfileFieldsConfig()[a.field];
    const check = validateFullValue(cfg, a.value, a.words);
    if (!check.ok) {
      await incrementBrewProfileCounter('failures');
      throw new PostResultCardError(400, 'INVALID_ANSWER', check.error);
    }
    answers.set(a.field, { value: check.value, words: check.words });
  }
  // Usual Drink 2 (B1 b, B4): a values_from field is shown only when it was
  // offered (its source holds two or more answers on this card, else stored),
  // and its answer is one of those answers.
  const stored = shown.some(code => eligible.get(code)!.valuesFrom) ? await getBrewProfileCurrent(input.uid, q) : {};
  for (const code of shown) {
    const cfg = eligible.get(code)!;
    if (!cfg.valuesFrom) continue;
    const source = answers.has(cfg.valuesFrom) ? answers.get(cfg.valuesFrom)!.value : stored[cfg.valuesFrom]?.value;
    if (!fieldApplies(cfg, source)) throw new PostResultCardError(400, 'FIELD_NOT_OFFERED', `${code} was not offered`);
    const answer = answers.get(code);
    const problem = answer ? checkValuesFrom(cfg, answer.value, source) : null;
    if (problem) {
      await incrementBrewProfileCounter('failures');
      throw new PostResultCardError(400, 'INVALID_ANSWER', problem);
    }
  }

  const write = async (tx: Tx): Promise<PostResultCardResult> => {
    const rows: PostResultCardResult['rows'] = [];
    for (const field of shown) {
      const answer = answers.get(field);
      let r: FactResult;
      if (answer) {
        const key = valueKey(answer.value) + (answer.words ? `|${answer.words}` : '');
        r = await record.brewProfileChange({
          userId: profileId, source: 'quiz', sourceId: `${input.quizSessionId}:${field}:${key}`, quizSessionId: input.quizSessionId,
          field, op: 'set', value: JSON.stringify(answer.value), customerWords: answer.words,
        }, tx);
        rows.push({ field, op: 'set', inserted: r.inserted });
      } else {
        r = await record.brewProfileChange({
          userId: profileId, source: 'quiz', sourceId: `${input.quizSessionId}:${field}:declined`, quizSessionId: input.quizSessionId,
          field, op: 'declined', value: null,
        }, tx);
        rows.push({ field, op: 'declined', inserted: r.inserted });
      }
    }
    return { inserted: rows.filter(r => r.inserted).length, rows };
  };
  const result = runner ? await write(runner) : await withTransaction(write);
  if (result.inserted) await incrementBrewProfileCounter('writes');
  return result;
}

// ── Usual Drink 2 (B2): the Profile's one save ──────────────────────────────

/**
 * source_id for an onsite brew-profile row when res.locals.apiEventId is
 * absent (Customer Blueprint C2, Part A2; moved here from routes/users.ts in
 * Usual Drink 2 so saveRoutine and the PATCH/DELETE routes share one copy).
 * One minute of idempotency for a double submit: a genuine second edit within
 * the same minute is rare for a profile field and, worst case, is a logged
 * duplicate no-op, never a wrong write.
 */
export function brewProfileFallbackSourceId(uid: string, field: string, op: string, value: unknown): string {
  const hash = createHash('sha1').update(JSON.stringify(value ?? null)).digest('hex');
  return `${uid}:${field}:${op}:${hash}:${Math.floor(Date.now() / 60000)}`;
}

export class RoutineSaveError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'RoutineSaveError';
  }
}

export interface RoutineInput { uid: string; answers: CardAnswer[]; cleared: string[] }
export interface RoutineResult { rows: Array<{ field: string; op: 'set' | 'clear'; inserted: boolean }> }

function sameAnswer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = answerList(a), y = answerList(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return a === b;
}

/**
 * The Profile's one save (B2). Every answer is checked by the one rule set
 * (validateFullValue + checkValuesFrom); one transaction writes a set row per
 * answer whose value or words differ from the stored ones and a clear row per
 * cleared field that holds a value, each through record.brewProfileChange
 * (source onsite). An unchanged field writes nothing; no declined rows. When a
 * source field changes so that a dependent field's stored answer is no longer
 * among its answers (or the dependent no longer applies), the dependent gets a
 * clear row in the same transaction. Idempotent by (source, source_id):
 * `<apiEventId>:<field>:<op>`, else brewProfileFallbackSourceId per row.
 */
export async function saveRoutine(input: RoutineInput, apiEventId: string | null | undefined, runner?: Tx): Promise<RoutineResult> {
  const q = runner ?? db;
  const fieldsCfg = getBrewProfileFieldsConfig();
  const answers = new Map<string, { value: unknown; words: string | null }>();
  for (const a of input.answers) {
    const cfg = fieldsCfg[a.field];
    if (!cfg || !cfg.isActive) throw new RoutineSaveError(400, 'UNKNOWN_FIELD', `unknown field ${a.field}`);
    if (answers.has(a.field)) throw new RoutineSaveError(400, 'DUPLICATE_FIELD', `${a.field} given twice`);
    const check = validateFullValue(cfg, a.value, a.words);
    if (!check.ok) {
      await incrementBrewProfileCounter('failures');
      throw new RoutineSaveError(400, 'INVALID_ANSWER', check.error);
    }
    // an empty array is a clear, not a set
    if (Array.isArray(check.value) && check.value.length === 0) continue;
    answers.set(a.field, { value: check.value, words: check.words });
  }
  const cleared = new Set<string>();
  for (const code of input.cleared) {
    if (!fieldsCfg[code]) throw new RoutineSaveError(400, 'UNKNOWN_FIELD', `unknown field ${code}`);
    if (answers.has(code)) throw new RoutineSaveError(400, 'SET_AND_CLEARED', `${code} is both answered and cleared`);
    cleared.add(code);
  }
  for (const a of input.answers) {
    const check = validateFullValue(fieldsCfg[a.field], a.value, a.words);
    if (check.ok && Array.isArray(check.value) && check.value.length === 0) cleared.add(a.field);
  }

  const profileId = (await q.query<{ id: string }>(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [input.uid])).rows[0]?.id;
  if (!profileId) throw new RoutineSaveError(404, 'PROFILE_NOT_FOUND', 'profile not found');
  const stored = await getBrewProfileCurrent(input.uid, q);

  // the answers as they will be after this save
  const after = (code: string): unknown => cleared.has(code) ? undefined : answers.has(code) ? answers.get(code)!.value : stored[code]?.value;

  // B1 (b): a values_from answer must be one of its source's answers after this save
  for (const [code, a] of answers) {
    const cfg = fieldsCfg[code];
    const problem = checkValuesFrom(cfg, a.value, after(cfg.valuesFrom ?? ''));
    if (problem) {
      await incrementBrewProfileCounter('failures');
      throw new RoutineSaveError(400, 'INVALID_ANSWER', problem);
    }
  }
  // a dependent whose stored answer no longer fits its source is cleared in the same save
  for (const cfg of Object.values(fieldsCfg)) {
    if (!cfg.valuesFrom || answers.has(cfg.code) || cleared.has(cfg.code)) continue;
    const current = stored[cfg.code]?.value;
    if (current === undefined || current === null) continue;
    if (checkValuesFrom(cfg, current, after(cfg.valuesFrom))) cleared.add(cfg.code);
  }

  const sourceId = (field: string, op: string, value: unknown) =>
    apiEventId ? `${apiEventId}:${field}:${op}` : brewProfileFallbackSourceId(input.uid, field, op, value);

  const write = async (tx: Tx): Promise<RoutineResult> => {
    const rows: RoutineResult['rows'] = [];
    for (const [field, a] of answers) {
      const s = stored[field];
      if (s && sameAnswer(s.value, a.value) && (s.words ?? null) === a.words) continue;
      const r = await record.brewProfileChange({
        userId: profileId, source: 'onsite', sourceId: sourceId(field, 'set', [a.value, a.words]),
        field, op: 'set', value: JSON.stringify(a.value), customerWords: a.words,
      }, tx);
      rows.push({ field, op: 'set', inserted: r.inserted });
    }
    for (const field of cleared) {
      const v = stored[field]?.value;
      if (v === undefined || v === null) continue; // nothing stored: nothing to clear
      const r = await record.brewProfileChange({
        userId: profileId, source: 'onsite', sourceId: sourceId(field, 'clear', null), field, op: 'clear', value: null,
      }, tx);
      rows.push({ field, op: 'clear', inserted: r.inserted });
    }
    return { rows };
  };
  const result = runner ? await write(runner) : await withTransaction(write);
  if (result.rows.some(r => r.inserted)) await incrementBrewProfileCounter('writes');
  return result;
}
