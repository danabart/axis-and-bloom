// Usual Drink 1 (2026-11-12), B2 — the one small typeahead (Task 0 found no
// reusable combobox; cmdk is installed but unused). Filters the field's values
// client-side on label and aliases, case- and diacritic-insensitive, by prefix
// or word start; the pinned values show before typing. Every value, label,
// alias and the placeholder come from the options payload.
//
// Usual Drink 2 (2026-11-24), D1 — rewritten in place as a real autocomplete
// (combobox + listbox, arrow keys, Enter, Escape) that can always be saved:
// - before typing: the pinned values; while typing: the matches, at most
//   limits.typeaheadMaxRows, then always the "use as I typed it" row
//   (copy.typeahead_use_typed), which stores the field's active value that
//   accepts words with the typed text (trimmed, capped at max_item_len) as
//   the customer's words;
// - the first row is highlighted, and the highlighted row is the field's
//   answer while the customer types (onChange fires as it moves), so Save
//   with text typed and nothing tapped saves the highlighted row;
// - a picked value shows as its label in the box (the customer's words when it
//   carries them), with a clear button (copy.typeahead_clear);
// - an empty box is no answer.
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
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

/** One list row: a value, or the "use as I typed it" row (value = the field's words value). */
export interface TypeaheadRow { key: string; code: string; words: string | null; text: string }

/**
 * The rows for a query: before typing, the pinned values; while typing, the
 * matches (at most maxRows) and then the use-as-typed row when the field has a
 * value that accepts words.
 */
export function typeaheadRows(values: BrewOptionValue[], query: string, opts: { maxRows: number; useTyped?: string; maxItemLen?: number | null }): TypeaheadRow[] {
  const typed = query.trim();
  const rows: TypeaheadRow[] = filterTypeahead(values, query)
    .slice(0, typed ? opts.maxRows : undefined)
    .map(v => ({ key: v.code, code: v.code, words: null, text: v.label }));
  const wordsValue = values.find(v => v.acceptsWords);
  if (typed && wordsValue && opts.useTyped) {
    const words = opts.maxItemLen ? typed.slice(0, opts.maxItemLen) : typed;
    rows.push({ key: `typed:${wordsValue.code}`, code: wordsValue.code, words, text: opts.useTyped.replace('{typed}', words) });
  }
  return rows;
}

export default function BrewTypeahead({
  values, value, words, onChange, placeholder, useTypedText, clearLabel, maxRows, maxItemLen, testId,
}: {
  values: BrewOptionValue[];
  value: string | null;
  /** the customer's words stored with the value, when it accepts them */
  words?: string | null;
  onChange: (code: string | null, words: string | null) => void;
  placeholder?: string;
  useTypedText?: string;
  clearLabel?: string;
  maxRows: number;
  maxItemLen?: number | null;
  testId?: string;
}) {
  const listId = useId();
  const picked = values.find(v => v.code === value) ?? null;
  const pickedText = picked ? (picked.acceptsWords && words ? words : picked.label) : '';
  // typing: the box holds the query; otherwise it shows the picked value
  const [typing, setTyping] = useState(!picked);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rows = useMemo(
    () => typeaheadRows(values, query, { maxRows, useTyped: useTypedText, maxItemLen }),
    [values, query, maxRows, useTypedText, maxItemLen]
  );

  function report(rowsNow: TypeaheadRow[], index: number, q: string) {
    // the highlighted row is the answer while typing; an empty box is none
    if (!q.trim()) { onChange(null, null); return; }
    const row = rowsNow[index];
    onChange(row ? row.code : null, row ? row.words : null);
  }

  function onInput(text: string) {
    setTyping(true);
    setQuery(text);
    setOpen(true);
    setActive(0);
    report(typeaheadRows(values, text, { maxRows, useTyped: useTypedText, maxItemLen }), 0, text);
  }

  function pick(row: TypeaheadRow) {
    onChange(row.code, row.words);
    setTyping(false);
    setOpen(false);
    setQuery('');
  }

  function clear() {
    onChange(null, null);
    setTyping(true);
    setQuery('');
    setActive(0);
    setOpen(true);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      setOpen(true);
      const next = e.key === 'ArrowDown' ? Math.min(active + 1, rows.length - 1) : Math.max(active - 1, 0);
      setActive(next);
      if (typing && query.trim()) report(rows, next, query);
    } else if (e.key === 'Enter') {
      if (open && rows[active]) { e.preventDefault(); pick(rows[active]); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showList = open && rows.length > 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;
  return (
    <div className="relative flex flex-col" data-testid={testId}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? optionId(active) : undefined}
          value={typing ? query : pickedText}
          onChange={e => onInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label={placeholder}
          className="flex-1 min-w-0 min-h-[44px] text-base border border-[#a33726]/20 rounded px-3 py-2 bg-white"
          data-testid={testId ? `${testId}-search` : undefined}
        />
        {!typing && picked && (
          <button type="button" onClick={clear} aria-label={clearLabel}
            className="min-h-[44px] min-w-[44px] text-lg leading-none text-[#a33726]/60 hover:text-[#a33726]"
            data-testid={testId ? `${testId}-clear` : undefined}>
            ×
          </button>
        )}
      </div>
      {showList && (
        // an overlay under the box: opening or closing it never moves the page,
        // so a click on Save that blurs the box still lands on Save
        <ul id={listId} role="listbox" aria-label={placeholder}
          className="absolute left-0 right-0 top-full z-30 mt-1 flex flex-col rounded border border-[#a33726]/20 bg-white shadow-md max-h-[50vh] overflow-y-auto"
          data-testid={testId ? `${testId}-list` : undefined}>
          {rows.map((row, i) => (
            <li
              key={row.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: picks before the input's blur closes the list
              onMouseDown={e => { e.preventDefault(); pick(row); }}
              onMouseEnter={() => setActive(i)}
              className={`min-h-[44px] flex items-center px-3 text-base cursor-pointer ${i === active ? 'bg-[#a33726]/10 text-[#a33726]' : 'text-[#3a2e28]'}`}
              data-testid={testId ? `${testId}-option-${row.words !== null ? 'typed' : row.code}` : undefined}
            >
              {row.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
