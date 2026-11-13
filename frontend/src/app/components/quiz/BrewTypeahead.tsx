// Usual Drink 1 (2026-11-12), B2 — the one small typeahead (Task 0 found no
// reusable combobox; cmdk is installed but unused). Filters the field's values
// client-side on label and aliases, case- and diacritic-insensitive, by prefix
// or word start; the pinned values show before typing. Every value, label,
// alias and the placeholder come from the options payload.
import { useMemo, useState } from 'react';
import type { BrewOptionValue } from '../../lib/api';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Prefix of the whole text or of any word in it. */
function matches(text: string, q: string): boolean {
  const t = fold(text);
  return t.startsWith(q) || t.split(/[^a-z0-9]+/).some(w => w.startsWith(q));
}

export function filterTypeahead(values: BrewOptionValue[], query: string): BrewOptionValue[] {
  const q = fold(query.trim());
  if (!q) return values.filter(v => v.pinned);
  return values.filter(v => matches(v.label, q) || v.aliases.some(a => matches(a, q)));
}

export default function BrewTypeahead({ values, value, onChange, placeholder, testId }: {
  values: BrewOptionValue[];
  value: string | null;
  onChange: (code: string | null) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterTypeahead(values, query), [values, query]);
  const picked = values.find(v => v.code === value) ?? null;

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="text-sm border border-[#a33726]/20 rounded px-3 py-1.5 bg-white"
        data-testid={testId ? `${testId}-search` : undefined}
      />
      <div className="flex flex-wrap gap-2" role="listbox">
        {(picked && !shown.some(v => v.code === picked.code) ? [picked, ...shown] : shown).slice(0, 12).map(v => {
          const on = v.code === value;
          return (
            <button
              key={v.code}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => onChange(on ? null : v.code)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${on ? 'border-[#a33726] text-[#a33726]' : 'border-[#a33726]/20 text-[#6b5c54]/70'}`}
              data-testid={testId ? `${testId}-option-${v.code}` : undefined}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
