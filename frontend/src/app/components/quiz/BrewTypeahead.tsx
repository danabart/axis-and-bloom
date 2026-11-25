// Usual Drink 1 (2026-11-12), B2 — the one small typeahead (Task 0 found no
// reusable combobox; cmdk is installed but unused). Filters the field's values
// client-side on label and aliases, case- and diacritic-insensitive, by prefix
// or word start. Every value, label, alias and the placeholder come from the
// options payload.
//
// Usual Drink 2 (2026-11-24), D1 — rewritten in place as a real autocomplete
// (combobox + listbox, arrow keys, Enter, Escape) that can always be saved:
// - while typing: the matches, at most limits.typeaheadMaxRows, then the "use
//   as I typed it" row (copy.typeahead_use_typed), which stores the field's
//   active value that accepts words with the typed text (trimmed, capped at
//   max_item_len) as the customer's words;
// - the first row is highlighted, and the highlighted row is the field's
//   answer while the customer types (onChange fires as it moves), so Save
//   with text typed and nothing tapped saves the highlighted row;
// - an empty box is no answer.
//
// Usual Drink 3 (2026-11-25), D3 — in place again:
// - browse: on focus with an empty box the list shows every value, pinned
//   first then in sort order, scrolling inside the overlay; the row cap
//   applies only while typing;
// - replace (one answer): a box that shows an answer selects its text on
//   focus, and whatever is typed replaces it (the picked text is never kept
//   in front of the typing);
// - several answers (an array field, `multi`): the picked values are chips,
//   each with a remove button (copy.typeahead_remove), and the box stays for
//   the next one until max_items; it empties after each pick; an exclusive
//   value replaces the others and is replaced by them; the use-as-typed row
//   is offered only while the list holds no typed-in answer;
// - a value already picked is not offered again.
import { useId, useMemo, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { BrewOptionValue } from '../../lib/api';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Prefix of the whole text or of any word in it. */
function matches(text: string, q: string): boolean {
  const t = fold(text);
  return t.startsWith(q) || t.split(/[^a-z0-9]+/).some(w => w.startsWith(q));
}

/** Before typing, every value (pinned first, then in the payload's sort order); while typing, the matches. */
export function filterTypeahead(values: BrewOptionValue[], query: string): BrewOptionValue[] {
  const q = fold(query.trim());
  if (!q) return [...values.filter(v => v.pinned), ...values.filter(v => !v.pinned)];
  return values.filter(v => matches(v.label, q) || v.aliases.some(a => matches(a, q)));
}

/** One list row: a value, or the "use as I typed it" row (value = the field's words value). */
export interface TypeaheadRow { key: string; code: string; words: string | null; text: string }

/**
 * The rows for a query: before typing, every value; while typing, the matches
 * (at most maxRows) and then the use-as-typed row when the field has a value
 * that accepts words. Values in `exclude` (already picked) are not offered, and
 * the use-as-typed row is left out when `noTyped` (a typed-in answer is
 * already in the list).
 */
export function typeaheadRows(values: BrewOptionValue[], query: string, opts: {
  maxRows: number; useTyped?: string; maxItemLen?: number | null; exclude?: string[]; noTyped?: boolean;
}): TypeaheadRow[] {
  const typed = query.trim();
  const exclude = opts.exclude ?? [];
  const rows: TypeaheadRow[] = filterTypeahead(values, query)
    .filter(v => !exclude.includes(v.code))
    .slice(0, typed ? opts.maxRows : undefined)
    .map(v => ({ key: v.code, code: v.code, words: null, text: v.label }));
  const wordsValue = values.find(v => v.acceptsWords);
  if (typed && wordsValue && opts.useTyped && !opts.noTyped) {
    const words = opts.maxItemLen ? typed.slice(0, opts.maxItemLen) : typed;
    rows.push({ key: `typed:${wordsValue.code}`, code: wordsValue.code, words, text: opts.useTyped.replace('{typed}', words) });
  }
  return rows;
}

/**
 * The text typed into a box that was showing an answer: what the customer
 * typed, never the shown answer with it (D5). A browser that kept the shown
 * text and put the caret after it gives "<shown><typed>"; the shown part goes.
 */
export function replacingText(shown: string, text: string): string {
  return shown && text.startsWith(shown) ? text.slice(shown.length) : text;
}

/** A list with one more answer, under the exclusive rule (an exclusive value stands alone). */
export function addToList(values: BrewOptionValue[], list: string[], code: string): string[] {
  const isExclusive = (c: string) => values.find(v => v.code === c)?.exclusive === true;
  if (list.includes(code)) return list;
  if (isExclusive(code)) return [code];
  return [...list.filter(c => !isExclusive(c)), code];
}

export interface TypeaheadMulti {
  /** the picked codes */
  picked: string[];
  /** max_items of the field */
  maxItems: number | null;
  /** copy.typeahead_remove, with {name} */
  removeLabel?: string;
  onChangeList: (codes: string[], words: string | null) => void;
}

export default function BrewTypeahead({
  values, value, words, onChange, placeholder, useTypedText, clearLabel, maxRows, maxItemLen, testId, multi,
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
  /** several answers (an array field): chips plus a box for the next one */
  multi?: TypeaheadMulti;
}) {
  const listId = useId();
  const picked = multi ? null : values.find(v => v.code === value) ?? null;
  const textOf = (v: BrewOptionValue) => (v.acceptsWords && words ? words : v.label);
  const pickedText = picked ? textOf(picked) : '';
  // typing: the box holds the query; otherwise it shows the picked value (one answer) or is empty (several)
  const [typing, setTyping] = useState(!picked);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // several answers: the list as it was before this round of typing
  const [base, setBase] = useState<string[] | null>(null);
  const list = multi ? (base ?? multi.picked) : [];
  const listHasTyped = list.some(c => values.find(v => v.code === c)?.acceptsWords);
  // already picked: not offered again (one answer: the shown answer, until typing starts)
  const exclude = multi ? list : !typing && value ? [value] : [];
  const rowOpts = { maxRows, useTyped: useTypedText, maxItemLen, exclude, noTyped: multi ? listHasTyped : false };
  const rows = useMemo(
    () => typeaheadRows(values, query, rowOpts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values, query, maxRows, useTypedText, maxItemLen, exclude.join('|'), listHasTyped]
  );

  /** several answers: the list with this row added, and the words that go with it */
  function listWith(row: TypeaheadRow | undefined, from: string[]): { codes: string[]; words: string | null } {
    const keep = from.some(c => values.find(v => v.code === c)?.acceptsWords) ? words ?? null : null;
    if (!row) return { codes: from, words: keep };
    const codes = addToList(values, from, row.code);
    const stillTyped = codes.some(c => values.find(v => v.code === c)?.acceptsWords);
    return { codes, words: row.words !== null ? row.words : stillTyped ? keep : null };
  }

  function report(rowsNow: TypeaheadRow[], index: number, q: string, from: string[]) {
    // the highlighted row is the answer while typing; an empty box is none (one answer) or adds nothing (several)
    const row = q.trim() ? rowsNow[index] : undefined;
    if (multi) { const next = listWith(row, from); multi.onChangeList(next.codes, next.words); return; }
    onChange(row ? row.code : null, row ? row.words : null);
  }

  function onInput(raw: string) {
    const from = multi ? (base ?? multi.picked) : [];
    if (multi && base === null) setBase(multi.picked);
    const text = !multi && !typing ? replacingText(pickedText, raw) : raw;
    setTyping(true);
    setQuery(text);
    setOpen(true);
    setActive(0);
    report(typeaheadRows(values, text, { ...rowOpts, exclude: multi ? from : [] }), 0, text, from);
  }

  function pick(row: TypeaheadRow) {
    if (multi) {
      const next = listWith(row, base ?? multi.picked);
      multi.onChangeList(next.codes, next.words);
      setBase(null);
      setTyping(true);
      setActive(0);
      setOpen(false);
      setQuery('');
      return;
    }
    onChange(row.code, row.words);
    setTyping(false);
    setOpen(false);
    setQuery('');
  }

  function remove(code: string) {
    if (!multi) return;
    // a pending (highlighted, not yet picked) answer goes with the typing
    const codes = (base ?? multi.picked).filter(c => c !== code);
    const stillTyped = codes.some(c => values.find(v => v.code === c)?.acceptsWords);
    multi.onChangeList(codes, stillTyped ? words ?? null : null);
    setBase(null);
    setQuery('');
  }

  function clear() {
    onChange(null, null);
    setTyping(true);
    setQuery('');
    setActive(0);
    setOpen(true);
  }

  function onFocus(e: FocusEvent<HTMLInputElement>) {
    setOpen(true);
    // one answer shown: select it, so typing replaces it (D5)
    if (!multi && !typing && picked) e.target.select();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      setOpen(true);
      const next = e.key === 'ArrowDown' ? Math.min(active + 1, rows.length - 1) : Math.max(active - 1, 0);
      setActive(next);
      if (typing && query.trim()) report(rows, next, query, list);
    } else if (e.key === 'Enter') {
      if (open && rows[active]) { e.preventDefault(); pick(rows[active]); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const shownChips = multi ? (base ?? multi.picked) : [];
  // the box stays for the next answer until max_items (counted on the picked list, not a pending one)
  const full = !!multi && multi.maxItems !== null && shownChips.length >= multi.maxItems;
  const showList = open && rows.length > 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;
  return (
    <div className="relative flex flex-col gap-2" data-testid={testId}>
      {multi && shownChips.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid={testId ? `${testId}-picked` : undefined}>
          {shownChips.map(code => {
            const v = values.find(x => x.code === code);
            const text = v ? textOf(v) : code;
            return (
              <span key={code} className="inline-flex items-center min-h-[44px] rounded-full border border-[#a33726] text-[#a33726] text-sm pl-4"
                data-testid={testId ? `${testId}-chip-${code}` : undefined}>
                {text}
                <button type="button" onClick={() => remove(code)} aria-label={(multi.removeLabel ?? '{name}').replace('{name}', text)}
                  className="min-h-[44px] min-w-[44px] text-lg leading-none text-[#a33726]/70 hover:text-[#a33726]"
                  data-testid={testId ? `${testId}-remove-${code}` : undefined}>
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
      {!full && (
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
            onFocus={onFocus}
            onBlur={() => setOpen(false)}
            onKeyDown={onKey}
            placeholder={placeholder}
            aria-label={placeholder}
            className="flex-1 min-w-0 min-h-[44px] text-base border border-[#a33726]/20 rounded px-3 py-2 bg-white"
            data-testid={testId ? `${testId}-search` : undefined}
          />
          {!multi && !typing && picked && (
            <button type="button" onClick={clear} aria-label={clearLabel}
              className="min-h-[44px] min-w-[44px] text-lg leading-none text-[#a33726]/60 hover:text-[#a33726]"
              data-testid={testId ? `${testId}-clear` : undefined}>
              ×
            </button>
          )}
        </div>
      )}
      {!full && showList && (
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
