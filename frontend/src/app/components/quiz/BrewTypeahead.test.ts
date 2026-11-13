// Usual Drink 1 (2026-11-12), B2 — the typeahead filter: pinned values before
// typing; case- and diacritic-insensitive prefix or word match on the label
// and the aliases. Fixture values only; the real ones come from the API.
import { describe, it, expect } from 'vitest';
import { filterTypeahead } from './BrewTypeahead';
import { valueFromDraft, draftTakesWords, draftFromValue } from './BrewFieldControl';
import type { BrewOptionField, BrewOptionValue } from '../../lib/api';

const v = (code: string, label: string, aliases: string[] = [], pinned = false, acceptsWords = false): BrewOptionValue =>
  ({ code, label, aliases, pinned, acceptsWords });
const values = [
  v('dont_know', 'I don\'t know', [], true),
  v('other', 'Something else', [], true, true),
  v('counter_culture', 'Counter Culture Coffee', ['ccc']),
  v('kirkland', 'Kirkland Signature (Costco)', ['costco']),
  v('devocion', 'Devoción', ['devocion']),
  v('bustelo', 'Café Bustelo', ['bustelo', 'cafe bustelo']),
];

describe('filterTypeahead', () => {
  it('shows the pinned values before typing', () => {
    expect(filterTypeahead(values, '').map(x => x.code)).toEqual(['dont_know', 'other']);
  });
  it('matches a label prefix, case-insensitive ("count" → Counter Culture)', () => {
    expect(filterTypeahead(values, 'count').map(x => x.code)).toEqual(['counter_culture']);
  });
  it('matches an alias and a word inside the label', () => {
    expect(filterTypeahead(values, 'costco').map(x => x.code)).toEqual(['kirkland']);
    expect(filterTypeahead(values, 'culture').map(x => x.code)).toEqual(['counter_culture']);
  });
  it('ignores diacritics both ways', () => {
    expect(filterTypeahead(values, 'devocio').map(x => x.code)).toEqual(['devocion']);
    expect(filterTypeahead(values, 'café').map(x => x.code)).toEqual(['bustelo']);
  });
});

describe('BrewFieldControl drafts', () => {
  const field = (type: BrewOptionField['type'], picker: string, vals: BrewOptionValue[]): BrewOptionField =>
    ({ code: 'f', label: 'F', prompt: 'Q?', type, picker, maxItems: 4, maxItemLen: 80, values: vals, displayLabels: {} });
  it('an array draft becomes the array, an empty one nothing', () => {
    const f = field('array', 'multi_select', [v('a', 'A'), v('b', 'B')]);
    expect(valueFromDraft(f, ['a', 'b'])).toEqual(['a', 'b']);
    expect(valueFromDraft(f, [])).toBeUndefined();
    expect(draftFromValue(f, ['b'])).toEqual(['b']);
  });
  it('a bool draft becomes a boolean', () => {
    const f = field('bool', 'toggle', [v('true', 'Needed'), v('false', 'Not needed')]);
    expect(valueFromDraft(f, 'true')).toBe(true);
    expect(valueFromDraft(f, 'false')).toBe(false);
  });
  it('words only when a picked value accepts them', () => {
    const f = field('enum', 'typeahead', values);
    expect(draftTakesWords(f, 'other')).toBe(true);
    expect(draftTakesWords(f, 'kirkland')).toBe(false);
  });
});
