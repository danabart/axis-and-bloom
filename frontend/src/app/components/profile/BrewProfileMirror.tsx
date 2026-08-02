import { useEffect, useState } from 'react';
import { getBrewProfile, setBrewProfileField, deleteBrewProfileField, type BrewProfileData } from '../../lib/api';

const BREW_METHOD_OPTIONS = [
  { value: 'v60', label: 'V60' },
  { value: 'french_press', label: 'French press' },
  { value: 'espresso', label: 'Espresso' },
  { value: 'moka', label: 'Moka pot' },
  { value: 'aeropress', label: 'Aeropress' },
  { value: 'cold_brew', label: 'Cold brew' },
  { value: 'drip', label: 'Drip' },
  { value: 'other', label: 'Other' },
];
const GRINDER_OPTIONS = [
  { value: 'none', label: 'No grinder' },
  { value: 'blade', label: 'Blade grinder' },
  { value: 'burr_hand', label: 'Hand burr grinder' },
  { value: 'burr_electric', label: 'Electric burr grinder' },
  { value: 'unknown_type', label: 'Not sure what type' },
];
const TAKES_IT_OPTIONS = [
  { value: 'black', label: 'Black' },
  { value: 'milk', label: 'With milk' },
  { value: 'sugar', label: 'With sugar' },
  { value: 'milk_and_sugar', label: 'With milk and sugar' },
];

const FIELD_META: Record<string, { label: string; type: 'array' | 'enum' | 'bool' | 'array_freeform'; options?: { value: string; label: string }[] }> = {
  brew_methods:      { label: 'Brew methods',      type: 'array',          options: BREW_METHOD_OPTIONS },
  grinder:           { label: 'Grinder',            type: 'enum',           options: GRINDER_OPTIONS },
  takes_it:          { label: 'Takes it',           type: 'enum',           options: TAKES_IT_OPTIONS },
  decaf_constraint:  { label: 'Decaf',              type: 'bool' },
  aversions:         { label: 'Never wants to taste', type: 'array_freeform' },
};
const FIELD_ORDER = ['brew_methods', 'grinder', 'takes_it', 'decaf_constraint', 'aversions'];

function optionLabel(options: { value: string; label: string }[] | undefined, value: string): string {
  return options?.find(o => o.value === value)?.label ?? value;
}

function displayValue(field: string, value: unknown): string {
  const meta = FIELD_META[field];
  if (field === 'decaf_constraint') return value === true ? 'Needed' : 'Not needed';
  if (Array.isArray(value)) {
    if (meta?.type === 'array') return value.map(v => optionLabel(meta.options, v)).join(', ');
    return value.join(', ');
  }
  if (meta?.type === 'enum') return optionLabel(meta.options, String(value));
  return String(value);
}

/** HOME_TASK_4 (§4.5 write rule 2) — "What Liam knows about your setup." The
 * day-one mirror: every captured field visible, editable, and deletable.
 * Shows captured fields only (the full self-serve add-a-new-field section is
 * Task 10) — Liam's own progressive capture in conversation is how a field
 * gets here in the first place. */
export default function BrewProfileMirror() {
  const [profile, setProfile] = useState<BrewProfileData | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<string[]>([]);
  const [draftText, setDraftText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    getBrewProfile().then(setProfile).catch(() => setProfile({}));
  }
  useEffect(() => { load(); }, []);

  if (!profile) return null;
  const capturedFields = FIELD_ORDER.filter(f => profile[f]?.value !== undefined);

  function startEdit(field: string) {
    const meta = FIELD_META[field];
    const current = profile![field]?.value;
    setError('');
    if (meta.type === 'array') {
      setDraftValue(Array.isArray(current) ? current as string[] : []);
    } else if (meta.type === 'array_freeform') {
      setDraftText(Array.isArray(current) ? (current as string[]).join(', ') : '');
    } else if (meta.type === 'bool') {
      setDraftValue([current === true ? 'true' : 'false']);
    } else {
      setDraftValue([String(current ?? '')]);
    }
    setEditingField(field);
  }

  async function saveEdit(field: string) {
    const meta = FIELD_META[field];
    setSaving(true);
    setError('');
    try {
      if (meta.type === 'array') {
        await setBrewProfileField(field, draftValue);
      } else if (meta.type === 'array_freeform') {
        const items = draftText.split(',').map(s => s.trim()).filter(Boolean);
        await setBrewProfileField(field, items);
      } else if (meta.type === 'bool') {
        await setBrewProfileField(field, draftValue[0] === 'true');
      } else {
        await setBrewProfileField(field, draftValue[0]);
      }
      setEditingField(null);
      load();
    } catch (e: unknown) {
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
    } catch {
      setError('Failed to remove field');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40">What Liam knows about your setup</p>

      {capturedFields.length === 0 && (
        <p className="text-sm text-[#6b5c54]/70">
          Nothing yet — mention your gear or how you take it next time you chat with Liam, and it'll show up here.
        </p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex flex-col divide-y divide-[#a33726]/10 border-y border-[#a33726]/10">
        {capturedFields.map((field) => {
          const meta = FIELD_META[field];
          const isEditing = editingField === field;
          return (
            <div key={field} className="py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-[#a33726]/40">{meta.label}</p>
                  {!isEditing && <p className="text-sm text-[#3a2e28] mt-0.5">{displayValue(field, profile[field].value)}</p>}
                </div>
                {!isEditing && (
                  <div className="flex gap-3 shrink-0 text-[10px] uppercase tracking-[0.15em]">
                    <button onClick={() => startEdit(field)} className="text-[#a33726]/50 hover:text-[#a33726] transition-colors">Edit</button>
                    <button onClick={() => removeField(field)} disabled={saving} className="text-[#a33726]/50 hover:text-[#a33726] transition-colors">Remove</button>
                  </div>
                )}
              </div>

              {isEditing && (
                <div className="mt-3 flex flex-col gap-3">
                  {meta.type === 'array' && (
                    <div className="flex flex-wrap gap-2">
                      {meta.options!.map((opt) => {
                        const checked = draftValue.includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setDraftValue(v => checked ? v.filter(x => x !== opt.value) : [...v, opt.value])}
                            className={`text-xs px-3 py-1 rounded-full border transition-colors ${checked ? 'border-[#a33726] text-[#a33726]' : 'border-[#a33726]/20 text-[#6b5c54]/70'}`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {meta.type === 'enum' && (
                    <select
                      value={draftValue[0] ?? ''}
                      onChange={(e) => setDraftValue([e.target.value])}
                      className="text-sm border border-[#a33726]/20 rounded px-3 py-1.5 bg-white"
                    >
                      {meta.options!.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  )}
                  {meta.type === 'bool' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDraftValue(['true'])}
                        className={`text-xs px-3 py-1 rounded-full border transition-colors ${draftValue[0] === 'true' ? 'border-[#a33726] text-[#a33726]' : 'border-[#a33726]/20 text-[#6b5c54]/70'}`}
                      >
                        Needed
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraftValue(['false'])}
                        className={`text-xs px-3 py-1 rounded-full border transition-colors ${draftValue[0] === 'false' ? 'border-[#a33726] text-[#a33726]' : 'border-[#a33726]/20 text-[#6b5c54]/70'}`}
                      >
                        Not needed
                      </button>
                    </div>
                  )}
                  {meta.type === 'array_freeform' && (
                    <input
                      type="text"
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      placeholder="Comma-separated"
                      className="text-sm border border-[#a33726]/20 rounded px-3 py-1.5 bg-white"
                    />
                  )}
                  <div className="flex gap-3 text-[10px] uppercase tracking-[0.15em]">
                    <button onClick={() => saveEdit(field)} disabled={saving} className="text-[#a33726] border-b border-[#a33726] pb-0.5">
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
