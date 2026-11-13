// Usual Drink 1 (2026-11-12), B2 / B3 — one brew-profile field's control, by
// the picker its row names (D18): select, multi_select (chips, capped at
// max_items), typeahead, toggle (the field's two values), freeform_list
// (comma-separated). A picked value that takes the customer's own words
// reveals a short text box capped at max_item_len. Shared by the post-result
// card and the Profile mirror; no field code appears here.
import type { BrewOptionField } from '../../lib/api';
import BrewTypeahead from './BrewTypeahead';

/** A field's draft: codes for a list field, one code (or null) otherwise, text for a freeform list. */
export type BrewDraft = string[] | string | null;

export function emptyDraft(field: BrewOptionField): BrewDraft {
  if (field.type === 'array') return [];
  if (field.type === 'array_freeform') return '';
  return null;
}

/** A stored value as a draft. */
export function draftFromValue(field: BrewOptionField, value: unknown): BrewDraft {
  if (field.type === 'array') return Array.isArray(value) ? value.map(String) : [];
  if (field.type === 'array_freeform') return Array.isArray(value) ? value.join(', ') : '';
  if (value === undefined || value === null) return null;
  return String(value);
}

/** The draft as the API value, or undefined when nothing is picked. */
export function valueFromDraft(field: BrewOptionField, draft: BrewDraft): unknown {
  if (field.type === 'array') return Array.isArray(draft) && draft.length ? draft : undefined;
  if (field.type === 'array_freeform') {
    const items = String(draft ?? '').split(',').map(s => s.trim()).filter(Boolean);
    return items.length ? items : undefined;
  }
  if (draft === null || draft === '') return undefined;
  if (field.type === 'bool') return draft === 'true';
  return draft;
}

export function draftTakesWords(field: BrewOptionField, draft: BrewDraft): boolean {
  const codes = Array.isArray(draft) ? draft : draft ? [draft] : [];
  return codes.some(c => field.values.find(v => v.code === c)?.acceptsWords);
}

const chip = (on: boolean) =>
  `text-xs px-3 py-1 rounded-full border transition-colors ${on ? 'border-[#a33726] text-[#a33726]' : 'border-[#a33726]/20 text-[#6b5c54]/70'}`;

export default function BrewFieldControl({ field, draft, words, onChange, onWords, copy }: {
  field: BrewOptionField;
  draft: BrewDraft;
  words: string;
  onChange: (draft: BrewDraft) => void;
  onWords: (words: string) => void;
  copy: Record<string, string>;
}) {
  const tid = `brew-field-${field.code}`;
  let control: JSX.Element;
  if (field.picker === 'multi_select') {
    const picked = Array.isArray(draft) ? draft : [];
    const full = field.maxItems !== null && picked.length >= field.maxItems;
    control = (
      <div className="flex flex-wrap gap-2" data-testid={tid}>
        {field.values.map(v => {
          const on = picked.includes(v.code);
          return (
            <button key={v.code} type="button" aria-pressed={on} disabled={!on && full}
              onClick={() => onChange(on ? picked.filter(x => x !== v.code) : [...picked, v.code])}
              className={`${chip(on)} disabled:opacity-40`} data-testid={`${tid}-option-${v.code}`}>
              {v.label}
            </button>
          );
        })}
      </div>
    );
  } else if (field.picker === 'typeahead') {
    control = <BrewTypeahead values={field.values} value={typeof draft === 'string' ? draft : null} onChange={onChange}
      placeholder={copy.search_placeholder} testId={tid} />;
  } else if (field.picker === 'toggle') {
    control = (
      <div className="flex gap-2" data-testid={tid}>
        {field.values.map(v => (
          <button key={v.code} type="button" aria-pressed={draft === v.code} onClick={() => onChange(draft === v.code ? null : v.code)}
            className={chip(draft === v.code)} data-testid={`${tid}-option-${v.code}`}>{v.label}</button>
        ))}
      </div>
    );
  } else if (field.picker === 'freeform_list') {
    control = (
      <input type="text" value={typeof draft === 'string' ? draft : ''} onChange={e => onChange(e.target.value)}
        aria-label={field.label} className="text-sm border border-[#a33726]/20 rounded px-3 py-1.5 bg-white" data-testid={tid} />
    );
  } else {
    // select, as the Profile mirror has always rendered an enum; the empty
    // first option means "not answered"
    control = (
      <select value={typeof draft === 'string' ? draft : ''} onChange={e => onChange(e.target.value || null)}
        aria-label={field.prompt ?? field.label} data-testid={tid}
        className="text-sm border border-[#a33726]/20 rounded px-3 py-1.5 bg-white">
        <option value="" />
        {field.values.map(v => <option key={v.code} value={v.code}>{v.label}</option>)}
      </select>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {control}
      {draftTakesWords(field, draft) && (
        <input type="text" value={words} onChange={e => onWords(e.target.value)} maxLength={field.maxItemLen ?? undefined}
          placeholder={copy.words_placeholder} aria-label={copy.words_placeholder}
          className="text-sm border border-[#a33726]/20 rounded px-3 py-1.5 bg-white" data-testid={`${tid}-words`} />
      )}
    </div>
  );
}
