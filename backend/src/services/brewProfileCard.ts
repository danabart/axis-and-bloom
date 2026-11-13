// Usual Drink 1 (2026-11-12), B2 / B3 — the options payload the post-result
// card and the Profile mirror render from, and the card's one writer path.
// Every field, value, label, prompt, cap and word comes from the field rows
// (getBrewProfileFieldsConfig, the one reader of v_brew_profile_field_current)
// and brew_parameter; nothing is typed here. Every row goes through
// customerFacts.record.brewProfileChange, the one door (G2.6).
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md
import { db, withTransaction, type Tx } from '../db/client.js';
import { record, type FactResult } from './customerFacts.js';
import {
  getBrewProfileFieldDefs, getBrewProfileFieldsConfig, validateFullValue, incrementBrewProfileCounter,
  type BrewProfileFieldConfig,
} from './brewProfile.js';
import { brewTextParams } from './brewParameters.js';

type Runner = Tx | typeof db;

export class PostResultCardError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'PostResultCardError';
  }
}

export interface OptionValue { code: string; label: string; pinned: boolean; acceptsWords: boolean; aliases: string[] }
export interface OptionField {
  code: string; label: string; prompt: string | null; type: string; picker: string;
  maxItems: number | null; maxItemLen: number | null;
  /** active values: what a picker offers */
  values: OptionValue[];
  /** every value (inactive included) by code: how a stored value is displayed (A4) */
  displayLabels: Record<string, string>;
}
export interface BrewProfileOptions { fields: OptionField[]; copy: Record<string, string> }

/** Card-eligible fields: active with a prompt (the kill switch, B2). */
export function cardFields(): BrewProfileFieldConfig[] {
  return getBrewProfileFieldDefs().filter(f => f.isActive && f.prompt);
}

function toOption(f: BrewProfileFieldConfig): OptionField {
  return {
    code: f.code, label: f.label, prompt: f.prompt, type: f.type, picker: f.picker,
    maxItems: f.maxLength ?? null, maxItemLen: f.maxItemLength ?? null,
    values: f.values.filter(v => v.isActive).map(v => ({ code: v.code, label: v.label, pinned: v.pinned, acceptsWords: v.acceptsWords, aliases: v.aliases })),
    displayLabels: Object.fromEntries(f.values.map(v => [v.code, v.label])),
  };
}

/** The options payload: 'card' = card-eligible fields; 'mirror' = every active field. */
export async function brewProfileOptions(scope: 'card' | 'mirror', runner: Runner = db): Promise<BrewProfileOptions> {
  const list = scope === 'card' ? cardFields() : getBrewProfileFieldDefs().filter(f => f.isActive);
  return { fields: list.map(toOption), copy: await brewTextParams(runner) };
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
