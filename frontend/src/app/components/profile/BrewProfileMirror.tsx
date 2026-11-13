import { useEffect, useState } from 'react';
import {
  getBrewProfile, getBrewProfileOptions, setBrewProfileField, deleteBrewProfileField,
  type BrewProfileData, type BrewProfileOptions, type BrewOptionField,
} from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import BrewFieldControl, { draftFromValue, emptyDraft, valueFromDraft, draftTakesWords, type BrewDraft } from '../quiz/BrewFieldControl';

// HOME_TASK_4 (§4.5 write rule 2) — "What Liam knows about your setup." Every
// field visible, editable and deletable.
//
// Usual Drink 1 (2026-11-12), B3: the fields, their order, labels, pickers,
// values and caps come from GET /api/users/brew-profile/options (the field
// rows), not from lists in this file; a new field is a row, not a deploy. The
// control is the same BrewFieldControl the quiz post-result card uses. Every
// active field shows: a stored value displays through the labels of every
// value (a retired option still reads right, A4); a field with a prompt and no
// value shows the prompt as its empty state, the same question the card asks.
// The page's own chrome words (heading, Edit/Remove/Save/Cancel) are unchanged.

function displayValue(field: BrewOptionField, value: unknown): string {
  const label = (code: unknown) => field.displayLabels[String(code)] ?? String(code);
  return Array.isArray(value) ? value.map(label).join(', ') : label(value);
}

export default function BrewProfileMirror() {
  const [profile, setProfile] = useState<BrewProfileData | null>(null);
  const [options, setOptions] = useState<BrewProfileOptions | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState<BrewDraft>(null);
  const [words, setWords] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    getBrewProfile().then(setProfile).catch(err => { reportError('[BrewProfileMirror/load]', err); setProfile({}); });
  }
  useEffect(() => {
    load();
    getBrewProfileOptions().then(setOptions).catch(err => { reportError('[BrewProfileMirror/options]', err); setOptions({ fields: [], copy: {} }); });
  }, []);

  if (!profile || !options) return null;
  const has = (f: BrewOptionField) => {
    const v = profile[f.code]?.value;
    return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
  };
  const visible = options.fields.filter(f => has(f) || f.prompt);

  function startEdit(field: BrewOptionField) {
    setError('');
    setDraft(has(field) ? draftFromValue(field, profile![field.code].value) : emptyDraft(field));
    setWords('');
    setEditingField(field.code);
  }

  async function saveEdit(field: BrewOptionField) {
    const value = valueFromDraft(field, draft);
    if (value === undefined) { setEditingField(null); return; }
    setSaving(true);
    setError('');
    try {
      const w = draftTakesWords(field, draft) ? words.trim() : '';
      await setBrewProfileField(field.code, value as string | boolean | string[], w || null);
      setEditingField(null);
      load();
    } catch (e: unknown) {
      reportError('[BrewProfileMirror/save-field]', e);
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function removeField(field: string) {
    setSaving(true);
    setError('');
    try {
      await deleteBrewProfileField(field);
      load();
    } catch (err) {
      reportError('[BrewProfileMirror/delete-field]', err);
      setError('Failed to remove field');
    } finally {
      setSaving(false);
    }
  }

  return (
    // Part 22 — full column width (was max-w-2xl), per PROMPT_one_column_pages.md
    // §3 item 6: "full column width." Only consumer is Profile.tsx's ~760px
    // column, so widening here can't affect anything else.
    <div className="flex flex-col gap-4 w-full" data-testid="brew-profile-mirror">
      <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40">What Liam knows about your setup</p>

      {visible.length === 0 && (
        <p className="text-sm text-[#6b5c54]/70">
          Nothing yet — mention your gear or how you take it next time you chat with Liam, and it'll show up here.
        </p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex flex-col divide-y divide-[#a33726]/10 border-y border-[#a33726]/10">
        {visible.map((field) => {
          const isEditing = editingField === field.code;
          const captured = has(field);
          return (
            <div key={field.code} className="py-3" data-testid={`mirror-${field.code}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-[#a33726]/40">{field.label}</p>
                  {!isEditing && (captured
                    ? <p className="text-sm text-[#3a2e28] mt-0.5" data-testid={`mirror-${field.code}-value`}>{displayValue(field, profile[field.code].value)}</p>
                    : <p className="text-sm text-[#6b5c54]/70 mt-0.5">{field.prompt}</p>)}
                </div>
                {!isEditing && (
                  <div className="flex gap-3 shrink-0 text-[10px] uppercase tracking-[0.15em]">
                    <button onClick={() => startEdit(field)} className="text-[#a33726]/50 hover:text-[#a33726] transition-colors" data-testid={`mirror-${field.code}-edit`}>Edit</button>
                    {captured && <button onClick={() => removeField(field.code)} disabled={saving} className="text-[#a33726]/50 hover:text-[#a33726] transition-colors">Remove</button>}
                  </div>
                )}
              </div>

              {isEditing && (
                <div className="mt-3 flex flex-col gap-3">
                  <BrewFieldControl field={field} draft={draft} words={words} copy={options.copy} onChange={setDraft} onWords={setWords} />
                  <div className="flex gap-3 text-[10px] uppercase tracking-[0.15em]">
                    <button onClick={() => saveEdit(field)} disabled={saving} className="text-[#a33726] border-b border-[#a33726] pb-0.5" data-testid={`mirror-${field.code}-save`}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingField(null)} className="text-[#a33726]/50 hover:text-[#a33726] transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
