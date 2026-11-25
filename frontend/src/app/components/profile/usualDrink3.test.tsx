// Usual Drink 3 (2026-11-25), Part E (frontend) — the autocomplete (D3: browse,
// replace, several answers), the follow-up by the customer's words (D4), cards
// and chips (D1, D2). Fixture values only; the real ones come from the API.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { useState } from 'react';
import type { BrewOptionField, BrewOptionValue, BrewProfileOptions, BrewProfileData } from '../../lib/api';

const api = vi.hoisted(() => ({ getBrewProfile: vi.fn(), getBrewProfileOptions: vi.fn(), saveBrewRoutine: vi.fn() }));
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), ...api }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));

import BrewTypeahead, { replacingText, addToList } from '../quiz/BrewTypeahead';
import BrewFieldControl, { type BrewDraft } from '../quiz/BrewFieldControl';
import BrewProfileMirror from './BrewProfileMirror';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const v = (code: string, label: string, extra: Partial<BrewOptionValue> = {}): BrewOptionValue =>
  ({ code, label, aliases: [], pinned: false, acceptsWords: false, ...extra });
const brands = [
  v('nothing', 'Nothing right now', { pinned: true, exclusive: true }), v('other', 'Something else', { pinned: true, acceptsWords: true }),
  v('starbucks', 'Starbucks'), v('wawa', 'Wawa'), v('illy', 'Illy'), v('lavazza', 'Lavazza'), v('stumptown', 'Stumptown'),
];
const labels = Object.fromEntries(brands.map(b => [b.code, b.label]));
const kitchenGroup = { code: 'kitchen', label: 'In your kitchen now', sortOrder: 4 };
const kitchen: BrewOptionField = {
  code: 'cupboard_coffee', label: "What's in your kitchen", prompt: 'Which coffees are in your kitchen right now? Up to three.',
  type: 'array', picker: 'typeahead', maxItems: 3, maxItemLen: 80, values: brands, displayLabels: labels, group: kitchenGroup,
};
const drinkMost: BrewOptionField = { ...kitchen, code: 'main_cupboard', label: 'Drink most', prompt: 'Which one do you drink most?', type: 'enum', picker: 'chips', maxItems: null, valuesFrom: 'cupboard_coffee' };
const copy = {
  search_placeholder: 'Start typing a name', typeahead_use_typed: 'Use "{typed}" as I typed it', typeahead_clear: 'Clear', typeahead_remove: 'Remove {name}',
  routine_title: 'Your coffee routine', routine_progress: '{answered} of {total} answered', routine_missing: 'Still to tell us',
  routine_edit: 'Edit your routine', routine_save: 'Save', routine_cancel: 'Cancel', routine_saving: 'Saving', routine_save_error: 'Please try saving again.',
};

describe('the autocomplete (D3)', () => {
  it('browse: on focus with an empty box every value shows, pinned first, the cap only while typing', () => {
    render(<BrewTypeahead values={brands} value={null} onChange={() => {}} maxRows={2} testId="t" />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(brands.map(b => b.label));
    expect(screen.getByTestId('t-list').className).toMatch(/overflow-y-auto/);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 's' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
  it('replace: typing into a box that shows an answer replaces it', () => {
    expect(replacingText('Starbucks', 'Starbucksw')).toBe('w');
    expect(replacingText('Starbucks', 'w')).toBe('w');
    const onChange = vi.fn();
    render(<BrewTypeahead values={brands} value="starbucks" onChange={onChange} maxRows={6} testId="t" />);
    const box = screen.getByRole('combobox') as HTMLInputElement;
    expect(box.value).toBe('Starbucks');
    fireEvent.focus(box);
    expect(screen.getAllByRole('option').map(o => o.textContent)).not.toContain('Starbucks'); // the picked one is not offered again
    fireEvent.change(box, { target: { value: 'Starbucksw' } });
    expect(box.value).toBe('w');
    expect(onChange).toHaveBeenLastCalledWith('wawa', null);
  });

  function Kitchen({ start = [] as string[], startWords = '' }) {
    const [draft, setDraft] = useState<BrewDraft>(start);
    const [words, setWords] = useState(startWords);
    return (
      <>
        <BrewFieldControl field={kitchen} draft={draft} words={words} onChange={setDraft} onWords={setWords} copy={copy} maxRows={6} />
        <output data-testid="state">{JSON.stringify({ draft, words })}</output>
      </>
    );
  }
  const state = () => JSON.parse(screen.getByTestId('state').textContent!);
  const pickByTyping = (text: string, option: string) => {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: text } });
    fireEvent.mouseDown(screen.getByTestId(`brew-field-cupboard_coffee-option-${option}`));
  };

  it('several answers: three picks, the box empties after each and stops offering at three', () => {
    render(<Kitchen />);
    pickByTyping('star', 'starbucks');
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
    pickByTyping('wa', 'wawa');
    pickByTyping('il', 'illy');
    expect(state().draft).toEqual(['starbucks', 'wawa', 'illy']);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(within(screen.getByTestId('brew-field-cupboard_coffee-picked')).getAllByRole('button').map(b => b.getAttribute('aria-label')))
      .toEqual(['Remove Starbucks', 'Remove Wawa', 'Remove Illy']);
  });
  it('remove a chip: the box comes back; picked values are not offered again', () => {
    render(<Kitchen start={['starbucks', 'wawa', 'illy']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Wawa' }));
    expect(state().draft).toEqual(['starbucks', 'illy']);
    fireEvent.focus(screen.getByRole('combobox'));
    const offered = screen.getAllByRole('option').map(o => o.textContent);
    expect(offered).not.toContain('Starbucks');
    expect(offered).toContain('Wawa');
  });
  it('the use-as-typed row disappears once a typed name is in the list', () => {
    render(<Kitchen />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Zzz Corner' } });
    fireEvent.mouseDown(screen.getByTestId('brew-field-cupboard_coffee-option-typed'));
    expect(state()).toEqual({ draft: ['other'], words: 'Zzz Corner' });
    expect(screen.getByTestId('brew-field-cupboard_coffee-chip-other').textContent).toContain('Zzz Corner');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Zzz Other' } });
    expect(screen.queryByTestId('brew-field-cupboard_coffee-option-typed')).toBeNull();
    pickByTyping('wa', 'wawa');
    expect(state()).toEqual({ draft: ['other', 'wawa'], words: 'Zzz Corner' });
  });
  it('an exclusive answer replaces the others and is replaced by them', () => {
    expect(addToList(brands, ['starbucks', 'wawa'], 'nothing')).toEqual(['nothing']);
    expect(addToList(brands, ['nothing'], 'wawa')).toEqual(['wawa']);
    render(<Kitchen start={['starbucks']} />);
    pickByTyping('noth', 'nothing');
    expect(state().draft).toEqual(['nothing']);
  });
});

describe('the follow-up (D4)', () => {
  it('appears at two coffees and offers a typed-in coffee by the customer\'s words', () => {
    const { rerender } = render(<BrewFieldControl field={drinkMost} draft={null} words="" onChange={() => {}} onWords={() => {}} copy={copy}
      sourceDraft={['starbucks']} sourceWords="" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    rerender(<BrewFieldControl field={drinkMost} draft={null} words="" onChange={() => {}} onWords={() => {}} copy={copy}
      sourceDraft={['starbucks', 'other']} sourceWords="Zzz Corner Roasters" />);
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Starbucks', 'Zzz Corner Roasters']);
  });
});

describe('cards and chips (D1, D2)', () => {
  const roast: BrewOptionField = { code: 'cupboard_roast', label: 'What the bag says', prompt: 'What roast?', type: 'enum', picker: 'chips', maxItems: null, maxItemLen: null,
    values: [v('dark', 'Dark')], displayLabels: { dark: 'Dark' }, group: kitchenGroup };
  const options: BrewProfileOptions = { fields: [kitchen, drinkMost, roast], copy, limits: { typeaheadMaxRows: 6 } };
  beforeEach(() => { api.getBrewProfileOptions.mockResolvedValue(options); });
  const profile: BrewProfileData = {
    cupboard_coffee: { value: ['starbucks', 'other'], words: 'Zzz Corner Roasters', source: 'profile_page', capturedAt: null },
    main_cupboard: { value: 'other', source: 'profile_page', capturedAt: null },
    cupboard_roast: { value: 'dark', source: 'profile_page', capturedAt: null },
  } as BrewProfileData;

  it('every read-view answer is a chip, the kitchen too; the drink-most coffee is the filled chip; the block is a white card', async () => {
    api.getBrewProfile.mockResolvedValue(profile);
    render(<BrewProfileMirror />);
    const typed = await screen.findByTestId('routine-chip-cupboard_coffee-other');
    expect(typed.textContent).toBe('Zzz Corner Roasters · Drink most');
    expect(typed.getAttribute('data-marked')).toBe('main_cupboard');
    expect(screen.getByTestId('routine-chip-cupboard_coffee-starbucks').textContent).toBe('Starbucks');
    expect(screen.getByTestId('routine-chip-cupboard_roast-dark').textContent).toBe('Dark');
    expect(screen.queryByTestId('routine-group-kitchen-text')).toBeNull();
    const block = screen.getByTestId('brew-profile-mirror');
    expect(block.getAttribute('data-card')).toBe('routine');
    expect(block.className).toMatch(/bg-\[var\(--ab-page/);
  });
  it('the edit view puts each question in its own white card', async () => {
    api.getBrewProfile.mockResolvedValue(profile);
    render(<BrewProfileMirror />);
    fireEvent.click(await screen.findByTestId('routine-edit'));
    const questions = ['cupboard_coffee', 'main_cupboard', 'cupboard_roast'].map(f => screen.getByTestId(`routine-question-${f}`));
    expect(questions.every(q => q.getAttribute('data-card') === 'question' && /bg-\[var\(--ab-page/.test(q.className))).toBe(true);
    expect(screen.getByTestId('brew-profile-mirror').getAttribute('data-card')).toBeNull();
    // the follow-up offers the typed-in coffee by its words
    expect(within(screen.getByTestId('routine-question-main_cupboard')).getAllByRole('button').map(b => b.textContent)).toEqual(['Starbucks', 'Zzz Corner Roasters']);
  });
});
