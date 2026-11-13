import { db, type Tx } from '../db/client.js';
import { firestoreDb, FieldValue } from './firebase-admin.js';
import { getSommelierConfig } from './sommelierConfig.js';
import { brewParam } from './brewParameters.js';

// HOME_TASK_4 (§4.5, §3.5) — shared brew-profile logic used by the
// conversation path (sommelier.ts's resolveRemember()), the profile-page
// mirror (users.ts's /api/users/brew-profile) and, since Usual Drink 1, the
// quiz post-result card (brewProfileCard.ts), so the whitelist is checked in
// exactly one place regardless of who's writing.
//
// Usual Drink 1 (2026-11-12, B1): the field list is no longer the Firestore
// sommelier_config.brewProfile.fields whitelist nor a code fallback. It is
// v_brew_profile_field_current, read by loadBrewProfileFields() — the view's
// one reader — into a per-process cache at boot (before the server accepts
// requests) and refreshed every brew_parameter field_list_refresh_seconds; a
// failed refresh keeps the last good list and logs. getBrewProfileFieldsConfig()
// stays synchronous for its callers. Field names, values, labels, prompts,
// caps and the Liam topic map are all rows; nothing here names a field.
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md

type Runner = Tx | typeof db;

export type BrewValueKind = 'enum' | 'bool' | 'array' | 'array_freeform';

export interface BrewProfileValueDef {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
  pinned: boolean;
  acceptsWords: boolean;
  aliases: string[];
  isActive: boolean;
}

export interface BrewProfileFieldConfig {
  id: number;
  code: string;
  label: string;
  prompt: string | null;
  type: BrewValueKind;
  picker: string;
  /** max_items (arrays) */
  maxLength?: number;
  /** max_item_len (array_freeform items and customer_words) */
  maxItemLength?: number;
  liamTopic: string | null;
  askWhenEmpty: boolean;
  sortOrder: number;
  isActive: boolean;
  /** active value codes (enum, array, bool) */
  allowedValues?: string[];
  /** every value row, inactive included (display of stored values, A4) */
  values: BrewProfileValueDef[];
}

interface FieldRow {
  field_id: number; field_code: string; field_label: string; prompt: string | null; value_kind: BrewValueKind; picker: string;
  max_items: number | null; max_item_len: number | null; liam_topic: string | null; ask_when_empty: boolean;
  field_sort_order: number; field_is_active: boolean;
  value_id: number | null; value_code: string | null; value_label: string | null; value_sort_order: number | null;
  pinned: boolean | null; accepts_words: boolean | null; aliases: string[] | null; value_is_active: boolean | null;
}

/** Pure: view rows -> field definitions in sort order. */
export function buildBrewProfileFields(rows: FieldRow[]): BrewProfileFieldConfig[] {
  const byId = new Map<number, BrewProfileFieldConfig>();
  for (const r of rows) {
    let f = byId.get(r.field_id);
    if (!f) {
      f = {
        id: r.field_id, code: r.field_code, label: r.field_label, prompt: r.prompt, type: r.value_kind, picker: r.picker,
        maxLength: r.max_items ?? undefined, maxItemLength: r.max_item_len ?? undefined,
        liamTopic: r.liam_topic, askWhenEmpty: r.ask_when_empty, sortOrder: r.field_sort_order, isActive: r.field_is_active, values: [],
      };
      byId.set(r.field_id, f);
    }
    if (r.value_id !== null && r.value_code !== null) {
      f.values.push({
        id: r.value_id, code: r.value_code, label: r.value_label ?? r.value_code, sortOrder: r.value_sort_order ?? 0,
        pinned: r.pinned === true, acceptsWords: r.accepts_words === true, aliases: r.aliases ?? [], isActive: r.value_is_active !== false,
      });
    }
  }
  const fields = [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const f of fields) {
    f.values.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    if (f.type !== 'array_freeform') f.allowedValues = f.values.filter(v => v.isActive).map(v => v.code);
  }
  return fields;
}

let fieldCache: BrewProfileFieldConfig[] | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let loading: Promise<number> | null = null;

/** The one reader of v_brew_profile_field_current: loads the cache, returns the field count. */
export async function loadBrewProfileFields(runner: Runner = db): Promise<number> {
  const r = await runner.query<FieldRow>(
    `SELECT field_id, field_code, field_label, prompt, value_kind, picker, max_items, max_item_len, liam_topic, ask_when_empty,
            field_sort_order, field_is_active, value_id, value_code, value_label, value_sort_order, pinned, accepts_words,
            aliases, value_is_active
     FROM v_brew_profile_field_current`
  );
  fieldCache = buildBrewProfileFields(r.rows);
  return fieldCache.length;
}

/** Tests on a mocked database prime the cache with fixture rows. */
export function primeBrewProfileFields(rows: FieldRow[]): void {
  fieldCache = buildBrewProfileFields(rows);
}

async function scheduleRefresh(): Promise<void> {
  try {
    const seconds = await brewParam('field_list_refresh_seconds');
    refreshTimer = setTimeout(() => { void refreshNow(); }, seconds * 1000);
    refreshTimer.unref?.();
  } catch (err) {
    console.error('[brewProfile] field-list refresh not scheduled (brew_parameter field_list_refresh_seconds unreadable); keeping the current list', err);
  }
}

async function refreshNow(): Promise<void> {
  try {
    await loadBrewProfileFields();
  } catch (err) {
    console.error('[brewProfile] field-list refresh failed; keeping the last good list', err);
  }
  await scheduleRefresh();
}

/** Boot: load the field list before the server accepts requests, then refresh on the parameter's interval. */
export async function startBrewProfileFieldsCache(): Promise<number> {
  const n = await loadBrewProfileFields();
  if (refreshTimer) clearTimeout(refreshTimer);
  await scheduleRefresh();
  return n;
}

function fields(): BrewProfileFieldConfig[] {
  if (fieldCache === null && !loading) {
    // Boot load failed (logged in index.ts): retry in the background; until it
    // lands every write is refused and counted, never accepted unvalidated.
    loading = loadBrewProfileFields().catch(err => { console.error('[brewProfile] field-list load failed', err); return 0; })
      .finally(() => { loading = null; });
  }
  return fieldCache ?? [];
}

/** Every field, inactive included, in sort order (the mirror's display of stored values). */
export function getBrewProfileFieldDefs(): BrewProfileFieldConfig[] {
  return fields();
}

/** The active fields by code. Synchronous: served from the cache. */
export function getBrewProfileFieldsConfig(): Record<string, BrewProfileFieldConfig> {
  const out: Record<string, BrewProfileFieldConfig> = {};
  for (const f of fields()) if (f.isActive) out[f.code] = f;
  return out;
}

const FALLBACK_STALE_AFTER_DAYS = 120;
export function getStaleAfterDays(): number {
  return getSommelierConfig()?.brewProfile?.staleAfterDays ?? FALLBACK_STALE_AFTER_DAYS;
}

// Observed directly in HOME_TASK_4's own production verification: Haiku
// naturally emitted <<remember:brew_method=v60>> (singular) despite the
// prompt's plural example. Defense in depth: an unknown field whose plural is
// a known field resolves to it; a genuinely unknown field still gets dropped
// and counted. Usual Drink 1: generic, so no field name is typed here.
export function normalizeFieldName(field: string): string {
  const cfg = getBrewProfileFieldsConfig();
  if (cfg[field]) return field;
  if (cfg[`${field}s`]) return `${field}s`;
  return field;
}

// Validates one raw value against one field's active values. Returns the
// coerced value to store, or null if invalid — never throws, so a bad marker
// or a bad request body always has a clean "dropped" path rather than a crash.
export function validateSingleValue(fieldCfg: BrewProfileFieldConfig, rawValue: string): string | boolean | null {
  switch (fieldCfg.type) {
    case 'enum':
    case 'array':
      return fieldCfg.allowedValues?.includes(rawValue) ? rawValue : null;
    case 'bool': {
      const lower = rawValue.trim().toLowerCase();
      if (!fieldCfg.allowedValues?.includes(lower)) return null;
      if (lower === 'true') return true;
      if (lower === 'false') return false;
      return null;
    }
    case 'array_freeform': {
      const trimmed = fieldCfg.maxItemLength ? rawValue.trim().slice(0, fieldCfg.maxItemLength) : rawValue.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    default:
      return null;
  }
}

/** Does this field's value (code, array of codes) include a value that takes the customer's own words? */
export function valueAcceptsWords(fieldCfg: BrewProfileFieldConfig, value: unknown): boolean {
  const codes = Array.isArray(value) ? value : [value];
  return codes.some(c => fieldCfg.values.find(v => v.code === c)?.acceptsWords === true);
}

export type FullValueCheck =
  | { ok: true; value: unknown; words: string | null }
  | { ok: false; error: string };

/**
 * A full value for a field (the card's answer, the Profile PATCH body): an
 * array field takes an array of active codes, no duplicates, at most
 * max_items (over the cap is rejected, never truncated); a scalar takes one
 * active code (a bool its 'true'/'false' code, or a boolean); words only on a
 * value that accepts them, within max_item_len.
 */
export function validateFullValue(fieldCfg: BrewProfileFieldConfig, value: unknown, words?: unknown): FullValueCheck {
  let stored: unknown;
  if (fieldCfg.type === 'array' || fieldCfg.type === 'array_freeform') {
    if (!Array.isArray(value)) return { ok: false, error: `${fieldCfg.code} must be an array` };
    const seen = new Set<string>();
    const items: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string') return { ok: false, error: `One or more values for ${fieldCfg.code} are not allowed` };
      const v = validateSingleValue(fieldCfg, item);
      if (v === null) return { ok: false, error: `One or more values for ${fieldCfg.code} are not allowed` };
      if (seen.has(v as string)) continue;
      seen.add(v as string);
      items.push(v as string);
    }
    if (fieldCfg.maxLength !== undefined && items.length > fieldCfg.maxLength) {
      return { ok: false, error: `${fieldCfg.code} takes at most ${fieldCfg.maxLength} values` };
    }
    stored = items;
  } else {
    const raw = typeof value === 'boolean' ? String(value) : value;
    if (typeof raw !== 'string') return { ok: false, error: `${fieldCfg.code} must be a string` };
    const v = validateSingleValue(fieldCfg, raw);
    if (v === null) return { ok: false, error: `Invalid value for ${fieldCfg.code}: ${raw}` };
    stored = v;
  }
  const w = typeof words === 'string' ? words.trim() : '';
  if (w) {
    if (!valueAcceptsWords(fieldCfg, stored)) return { ok: false, error: `${fieldCfg.code} does not take words for this answer` };
    if (fieldCfg.maxItemLength === undefined || w.length > fieldCfg.maxItemLength) {
      return { ok: false, error: `Words for ${fieldCfg.code} are over ${fieldCfg.maxItemLength ?? 0} characters` };
    }
  }
  return { ok: true, value: stored, words: w || null };
}

// Write rule 3 (§4.5) — every write attempt, success or failure, increments
// an admin-visible counter. `admin_stats/brew_profile` is a 2-segment path
// (collection/doc) — even, valid. Never throws: a counter failing to
// increment must never be the reason a customer-facing request 500s.
// Liam L2, Part 0 — 'noop' counts a re-affirmed scalar value that resolveRemember
// deliberately skipped (not a failure — the fact was already known, just not
// re-written as a fresh row).
export async function incrementBrewProfileCounter(kind: 'writes' | 'failures' | 'noop'): Promise<void> {
  try {
    await firestoreDb.doc('admin_stats/brew_profile').set(
      { [kind]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error('[brewProfile] failed to increment counter', kind, err);
  }
}

export async function getBrewProfileCounters(): Promise<{ writes: number; failures: number; noop: number }> {
  try {
    const snap = await firestoreDb.doc('admin_stats/brew_profile').get();
    const data = snap.exists ? snap.data() : null;
    return { writes: Number(data?.writes ?? 0), failures: Number(data?.failures ?? 0), noop: Number(data?.noop ?? 0) };
  } catch {
    return { writes: 0, failures: 0, noop: 0 };
  }
}

interface BrewProfileFieldEntry {
  value: unknown;
  source: 'conversation' | 'profile_page';
  capturedAt: unknown; // Firestore Timestamp once read back
}
export type BrewProfileDoc = Record<string, BrewProfileFieldEntry | undefined>;

/** A stored value in the customer's words: the value rows' labels (inactive included), else the raw code. */
export function displayBrewValue(fieldCfg: BrewProfileFieldConfig | undefined, value: unknown): string {
  const label = (code: unknown) => fieldCfg?.values.find(v => v.code === String(code))?.label ?? String(code);
  return Array.isArray(value) ? value.map(label).join(', ') : label(value);
}

// One-line customer-context summary for Liam's system prompt (§3.5: "every
// profile field must change a sentence Liam can say"). Only ever describes
// what's actually stored — never invents, never infers. The five original
// fields keep their exact wording (SUMMARY_LABELS, pre-Usual Drink 1) so the
// line is byte-identical for every customer who has none of the new fields;
// any other field with a value is described by its own label and value labels
// (Usual Drink 1), so Liam does not ask for what it already knows (B4).
const SUMMARY_LABELS: Record<string, string> = {
  brew_methods: 'brews with',
  grinder: 'grinder',
  takes_it: 'takes it',
  aversions: 'avoids',
};
const SUMMARY_BOOL_TRUE: Record<string, string> = { decaf_constraint: 'needs decaf' };
export function formatBrewProfileSummary(profile: BrewProfileDoc | null): string {
  if (!profile) return '';
  const parts: string[] = [];
  for (const [field, label] of Object.entries(SUMMARY_LABELS)) {
    const entry = profile[field];
    if (entry?.value == null) continue;
    if (Array.isArray(entry.value)) {
      if (entry.value.length === 0) continue;
      parts.push(`${label} ${entry.value.join('/')}`);
    } else {
      parts.push(`${label} ${entry.value}`);
    }
  }
  for (const [field, phrase] of Object.entries(SUMMARY_BOOL_TRUE)) if (profile[field]?.value === true) parts.push(phrase);
  for (const f of getBrewProfileFieldDefs()) {
    if (f.code in SUMMARY_LABELS || f.code in SUMMARY_BOOL_TRUE) continue;
    const entry = profile[f.code];
    if (entry?.value == null || (Array.isArray(entry.value) && entry.value.length === 0)) continue;
    parts.push(`${f.label.toLowerCase()}: ${displayBrewValue(f, entry.value)}`);
  }
  return parts.join('; ');
}

function capturedMs(entry: BrewProfileFieldEntry | undefined): number | null {
  const capturedAt = entry?.capturedAt as { toDate?: () => Date } | string | undefined;
  if (!capturedAt) return null;
  const ms = typeof (capturedAt as { toDate?: () => Date }).toDate === 'function'
    ? (capturedAt as { toDate: () => Date }).toDate().getTime()
    : new Date(capturedAt as string).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Write rule 5 (§4.5) — "still on the V60?" casual re-confirm, at most once
// per session, only when the stale field is relevant to this turn's topic
// (HOME_TASK_2's router). Returns a context sentence for Liam, never a marker
// or an instruction the customer would see directly. Usual Drink 1: the topic
// map is brew_profile_field.liam_topic (the in-code TOPIC_TO_FIELD is gone);
// the first stale field of the topic in sort order.
export function getStaleFieldNudge(
  profile: BrewProfileDoc | null,
  topic: string | null,
  alreadyNudged: boolean
): string | null {
  if (alreadyNudged || !profile || !topic) return null;
  for (const f of Object.values(getBrewProfileFieldsConfig()).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (f.liamTopic !== topic) continue;
    const entry = profile[f.code];
    const ms = capturedMs(entry);
    if (ms === null) continue;
    if ((Date.now() - ms) / 86_400_000 < getStaleAfterDays()) continue;
    const value = Array.isArray(entry!.value) ? (entry!.value as string[]).join('/') : String(entry!.value);
    return `It's been a while since they confirmed ${f.code.replace(/_/g, ' ')} (${value}) — if it fits naturally this turn, a casual re-confirm ("still on that?") is welcome, not required.`;
  }
  return null;
}

// Usual Drink 1, B4 (D8) — ask when empty: a field with ask_when_empty, a
// prompt and no value, whose liam_topic is this turn's topic, may be asked
// once in a conversation (askedFields carries what was asked), never on the
// first turn: turn is sommelier_sessions.turn_count, which /start sets to 1,
// so the customer's first message (turn 1) is never asked. Returns the field
// and the context sentence, or null.
export function getAskWhenEmptyNudge(
  profile: BrewProfileDoc | null,
  topic: string | null,
  askedFields: string[],
  turn: number,
): { field: string; text: string } | null {
  if (!topic || turn <= 1) return null;
  for (const f of Object.values(getBrewProfileFieldsConfig()).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!f.askWhenEmpty || !f.prompt || f.liamTopic !== topic || askedFields.includes(f.code)) continue;
    const entry = profile?.[f.code];
    if (entry?.value != null && !(Array.isArray(entry.value) && entry.value.length === 0)) continue;
    return { field: f.code, text: `They haven't told you ${f.label.toLowerCase()} yet — if it fits naturally this turn, you may ask once, in your own voice: "${f.prompt}"` };
  }
  return null;
}

// Usual Drink 1, B4 — the "Remembering facts" field list for Liam's prompt,
// built from the field rows (codes, active value codes; for a typeahead field
// the labels and aliases too, so "the Costco one" maps to its code). Same for
// every customer until a row changes: it sits in the shared prompt tier.
export function formatBrewProfileFieldList(): string {
  const lines: string[] = [];
  for (const f of Object.values(getBrewProfileFieldsConfig()).sort((a, b) => a.sortOrder - b.sortOrder)) {
    const active = f.values.filter(v => v.isActive);
    let values: string;
    if (f.type === 'array_freeform') values = `free text, one item per marker${f.maxItemLength ? `, at most ${f.maxItemLength} characters` : ''}`;
    else if (f.picker === 'typeahead') values = active.map(v => `${v.code} (${[v.label, ...v.aliases].join(' / ')})`).join(', ');
    else values = active.map(v => v.code).join(', ');
    const kind = f.type === 'array' || f.type === 'array_freeform' ? 'several, one marker per item' : 'one';
    const words = active.some(v => v.acceptsWords) ? `; ${active.filter(v => v.acceptsWords).map(v => v.code).join(', ')} takes their own words as ${f.code}=${active.find(v => v.acceptsWords)!.code}|<their words>` : '';
    lines.push(`- ${f.code} (${kind}${f.askWhenEmpty ? '; may be asked when empty' : ''}): ${values}${words}`);
  }
  return lines.length ? `Brew-profile fields you may remember (field: allowed values):\n${lines.join('\n')}` : '';
}
