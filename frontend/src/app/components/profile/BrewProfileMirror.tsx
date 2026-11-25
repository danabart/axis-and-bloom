import { useEffect, useRef, useState } from 'react';
import {
  getBrewProfile, getBrewProfileOptions, saveBrewRoutine,
  type BrewProfileData, type BrewProfileOptions, type BrewOptionField,
} from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import BrewFieldControl, {
  draftFromValue, emptyDraft, valueFromDraft, draftTakesWords, fieldApplies, effectiveDraft, answerCodes, type BrewDraft,
} from '../quiz/BrewFieldControl';

// HOME_TASK_4 (§4.5 write rule 2) — "What Liam knows about your setup." Every
// field visible, editable and deletable.
//
// Usual Drink 1 (2026-11-12), B3: the fields, their order, labels, pickers,
// values and caps come from GET /api/users/brew-profile/options (the field
// rows), not from lists in this file; a new field is a row, not a deploy. The
// control is the same BrewFieldControl the quiz post-result card uses.
//
// Usual Drink 2 (2026-11-24), D3: reworked in place into "Your coffee
// routine". Read view: the heading, the line and the progress (fields that
// apply and are answered over fields that apply), then one group per field
// group in its order with the answers as chips; a field whose values come from
// another (most days) is marked on its source's chip (filled, with the
// field's label after the drink); a group whose fields are all single-choice
// reads as one line of text (the kitchen: brand or the customer's words, the
// roast, the feeling). The unanswered fields that apply are dashed chips;
// tapping one opens the edit view at that question. Edit view: every field
// that applies as its question, one Save and one Cancel for the whole form,
// one PUT. Every word comes from the payload (copy, labels, prompts); the
// server's error text is logged, the page shows copy.routine_save_error.
//
// Usual Drink 3 (2026-11-25), D1/D2: cards and chips as in the mockup. The
// read view sits in one white card (the page white, a hairline border, rounded
// corners); in the edit view each question sits in its own white card. Every
// answer of the read view is a chip, the kitchen's included (brief 2's
// "single-choice group reads as text" branch is gone): each kitchen coffee
// (a typed-in one by the customer's words), the roast, the feeling, decaf,
// each never-want-to-taste item. The answer a dependent field points at (most
// days, drink most) is the filled chip with that field's label after it.

/** Every stored value as the customer reads it: their words on a value that takes them, else the value labels. */
function displayCodes(field: BrewOptionField, value: unknown, words: string | null | undefined): string[] {
  return answerCodes(value).map(code => {
    const takesWords = field.values.find(v => v.code === code)?.acceptsWords;
    return takesWords && words ? words : field.displayLabels[code] ?? code;
  });
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
}

const chipRead = 'min-h-[44px] inline-flex items-center text-sm px-4 py-2 rounded-full border border-[#a33726] text-[#a33726]';
const chipMarked = 'min-h-[44px] inline-flex items-center text-sm px-4 py-2 rounded-full border border-[#a33726] bg-[#a33726] text-white';
const chipMissing = 'min-h-[44px] inline-flex items-center text-sm px-4 py-2 rounded-full border border-dashed border-[#a33726]/40 text-[#a33726]/70 hover:text-[#a33726] hover:border-[#a33726]';
const button = 'min-h-[44px] px-5 text-[11px] uppercase tracking-[0.15em]';
// a white card on the page (D1): the site's page white, hairline border, rounded corners; full width on a phone
const card = 'w-full rounded-[14px] border border-[#a33726]/25 bg-[var(--ab-page,#ffffff)] p-5 sm:p-7';

export default function BrewProfileMirror() {
  const [profile, setProfile] = useState<BrewProfileData | null>(null);
  const [options, setOptions] = useState<BrewProfileOptions | null>(null);
  const [editing, setEditing] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, BrewDraft>>({});
  const [words, setWords] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  function load() {
    getBrewProfile().then(setProfile).catch(err => { reportError('[BrewProfileMirror/load]', err); setProfile({}); });
  }
  useEffect(() => {
    load();
    getBrewProfileOptions().then(setOptions).catch(err => {
      reportError('[BrewProfileMirror/options]', err);
      setOptions({ fields: [], copy: {} });
    });
  }, []);

  useEffect(() => {
    if (!editing || !focusField) return;
    formRef.current?.querySelector(`[data-question="${focusField}"]`)?.scrollIntoView({ block: 'center' });
  }, [editing, focusField]);

  if (!profile || !options) return null;
  const { fields, copy } = options;
  const stored = (code: string) => profile[code]?.value;
  const applies = (f: BrewOptionField, src: (code: string) => unknown) => fieldApplies(f, f.valuesFrom ? src(f.valuesFrom) : undefined);
  const applying = fields.filter(f => applies(f, stored));
  const answered = applying.filter(f => hasValue(stored(f.code)));
  const missing = applying.filter(f => !hasValue(stored(f.code)));

  function startEdit(at: string | null) {
    setFailed(false);
    setDrafts(Object.fromEntries(fields.map(f => [f.code, hasValue(stored(f.code)) ? draftFromValue(f, stored(f.code)) : emptyDraft(f)])));
    setWords(Object.fromEntries(fields.map(f => [f.code, profile![f.code]?.words ?? ''])));
    setFocusField(at);
    setEditing(true);
  }

  async function save() {
    const draftOf = (code: string) => drafts[code] ?? null;
    const answers: Array<{ field: string; value: unknown; words?: string | null }> = [];
    const cleared: string[] = [];
    for (const f of fields) {
      const draft = effectiveDraft(f, draftOf(f.code), f.valuesFrom ? draftOf(f.valuesFrom) : undefined);
      const value = applies(f, draftOf) ? valueFromDraft(f, draft) : undefined;
      if (value === undefined) {
        if (hasValue(stored(f.code))) cleared.push(f.code);
        continue;
      }
      const w = draftTakesWords(f, draft) ? (words[f.code] ?? '').trim() : '';
      answers.push(w ? { field: f.code, value, words: w } : { field: f.code, value });
    }
    setSaving(true);
    setFailed(false);
    try {
      await saveBrewRoutine({ answers, cleared });
      setEditing(false);
      load();
    } catch (e: unknown) {
      reportError('[BrewProfileMirror/save-routine]', e);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  // ── read view: groups in order; fields without a group last, each its own ──
  type Group = { key: string; label: string | null; sort: number; fields: BrewOptionField[] };
  const groups: Group[] = [];
  for (const f of applying) {
    const key = f.group?.code ?? `field:${f.code}`;
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, label: f.group?.label ?? f.label, sort: f.group?.sortOrder ?? Number.MAX_SAFE_INTEGER, fields: [] }; groups.push(g); }
    g.fields.push(f);
  }
  groups.sort((a, b) => a.sort - b.sort);
  // a dependent field is shown on its source's chip, not on its own
  const markers = (source: BrewOptionField) =>
    applying.filter(d => d.valuesFrom === source.code && hasValue(stored(d.code)));

  function renderGroup(g: Group) {
    const shown = g.fields.filter(f => !f.valuesFrom && hasValue(stored(f.code)));
    if (!shown.length) return null;
    return (
      <div key={g.key} className="flex flex-col gap-2" data-testid={`routine-group-${g.key}`}>
        <p className="text-[10px] uppercase tracking-[0.15em] text-[#a33726]/50">{g.label}</p>
        <div className="flex flex-wrap gap-2">
          {shown.flatMap(f => answerCodes(stored(f.code)).map((code, i) => {
            const text = displayCodes(f, [code], profile![f.code]?.words)[0];
            const mark = markers(f).find(d => stored(d.code) === code);
            return (
              <span key={`${f.code}:${code}:${i}`} className={mark ? chipMarked : chipRead}
                data-testid={`routine-chip-${f.code}-${code}`} data-marked={mark ? mark.code : undefined}>
                {mark ? `${text} · ${mark.label}` : text}
              </span>
            );
          }))}
        </div>
      </div>
    );
  }

  const progress = (copy.routine_progress ?? '').replace('{answered}', String(answered.length)).replace('{total}', String(applying.length));

  return (
    <div className={`flex flex-col gap-5 ${editing ? 'w-full' : card}`} data-testid="brew-profile-mirror" data-card={editing ? undefined : 'routine'}>
      <div className="flex flex-col gap-1">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/60">{copy.routine_title}</p>
        {copy.routine_sub && <p className="text-sm text-[#6b5c54]/80">{copy.routine_sub}</p>}
        {applying.length > 0 && <p className="text-xs text-[#6b5c54]/70" data-testid="routine-progress">{progress}</p>}
      </div>

      {!editing && (
        <>
          {answered.length === 0 && copy.routine_empty && <p className="text-base text-[#3a2e28]">{copy.routine_empty}</p>}
          {groups.map(renderGroup)}
          {missing.length > 0 && (
            <div className="flex flex-col gap-2" data-testid="routine-missing">
              <p className="text-[10px] uppercase tracking-[0.15em] text-[#a33726]/50">{copy.routine_missing}</p>
              <div className="flex flex-wrap gap-2">
                {missing.map(f => (
                  <button key={f.code} type="button" onClick={() => startEdit(f.code)} className={chipMissing}
                    data-testid={`routine-missing-${f.code}`}>{f.label}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <button type="button" onClick={() => startEdit(null)} data-testid="routine-edit"
              className={`${button} text-[#a33726] border border-[#a33726]/40 rounded-full hover:border-[#a33726]`}>
              {copy.routine_edit}
            </button>
          </div>
        </>
      )}

      {editing && (
        <div ref={formRef} className="flex flex-col gap-4" data-testid="routine-form">
          {fields.filter(f => applies(f, code => drafts[code] ?? null)).map(f => (
            <div key={f.code} className={`flex flex-col gap-3 ${card}`} data-question={f.code} data-testid={`routine-question-${f.code}`} data-card="question">
              <p className="text-base text-[#3a2e28]">{f.prompt ?? f.label}</p>
              <BrewFieldControl field={f} draft={drafts[f.code] ?? null} words={words[f.code] ?? ''} copy={copy}
                sourceDraft={f.valuesFrom ? drafts[f.valuesFrom] ?? null : undefined}
                sourceWords={f.valuesFrom ? words[f.valuesFrom] ?? '' : undefined}
                maxRows={options.limits?.typeaheadMaxRows}
                onChange={d => setDrafts(x => ({ ...x, [f.code]: d }))}
                onWords={w => setWords(x => ({ ...x, [f.code]: w }))} />
            </div>
          ))}
          {/* the Save / Cancel bar stays reachable at the bottom of the screen (D5) */}
          <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-[var(--ab-paper,#faf7f2)] border-t border-[#a33726]/10 flex items-center gap-3 flex-wrap">
            <button type="button" onClick={save} disabled={saving} data-testid="routine-save"
              className={`${button} bg-[#a33726] text-white rounded-full disabled:opacity-60`}>
              {saving ? copy.routine_saving : copy.routine_save}
            </button>
            <button type="button" onClick={() => { setEditing(false); setFailed(false); }} data-testid="routine-cancel"
              className={`${button} text-[#a33726]/70 hover:text-[#a33726]`}>
              {copy.routine_cancel}
            </button>
            {failed && <p role="alert" className="text-sm text-[#a33726]" data-testid="routine-save-error">{copy.routine_save_error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
