// Usual Drink 2 (2026-11-24), Part E (frontend) — the autocomplete (D1), the
// exclusive chip and the dependent field (D2), the routine card (D3) and the
// three blocks of the Flavor Memory tab (D4). Fixture values only; the real
// ones come from the API.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { BrewOptionField, BrewOptionValue, BrewProfileOptions, BrewProfileData } from '../../lib/api';

// ── mocks for the routine card and the Profile page ──────────────────────────
const api = vi.hoisted(() => ({
  getBrewProfile: vi.fn(), getBrewProfileOptions: vi.fn(), saveBrewRoutine: vi.fn(),
  getUserProfile: vi.fn(), getHomepageState: vi.fn(), getDialPosition: vi.fn(), setDialPosition: vi.fn(), getFlavorMemory: vi.fn(),
}));
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), ...api }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' }, logout: vi.fn(), loading: false, hasLiamAccess: false }) }));
vi.mock('../../context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('../../lib/prelaunch', () => ({ usePrelaunchGated: () => false }));
vi.mock('../bloom/DialArchetypeSection', () => ({ DialArchetypeSection: () => <div data-testid="dial-section" /> }));
vi.mock('../bloom/CompareOverlay', () => ({ CompareOverlay: () => null }));
vi.mock('../coffee-info/archetypeAdjacency', () => ({ useArchetypeAdjacency: () => ({}) }));
vi.mock('../bloom/useAdjacentArchetype', () => ({
  useAdjacentArchetype: () => ({ adjacentArchetypeId: null, adjacentData: null, adjacentSortOrder: null, adjacentRevealedKeys: new Set(),
    handleAdjacentChipClick: vi.fn(), handleAdjacentDialSelect: vi.fn(), toggleAdjacentReveal: vi.fn(), registerAdjacentDialRef: vi.fn(), adjacentSectionRef: { current: null } }),
}));
vi.mock('./WorthExploring', () => ({ default: () => null }));
const trail = vi.hoisted(() => ({ has: false }));
vi.mock('../bloom/map/MapTrail', () => ({
  default: ({ onContent }: { onContent?: (has: boolean, title: string | null) => void }) => {
    // the real component reports once its own fetch settles
    setTimeout(() => onContent?.(trail.has, trail.has ? 'Your trail' : null), 0);
    return trail.has ? <div data-testid="map-trail-stub" /> : null;
  },
}));

import BrewTypeahead, { typeaheadRows } from '../quiz/BrewTypeahead';
import BrewFieldControl, { toggleMulti, fieldApplies } from '../quiz/BrewFieldControl';
import BrewProfileMirror from './BrewProfileMirror';
import Profile from '../Profile';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const v = (code: string, label: string, extra: Partial<BrewOptionValue> = {}): BrewOptionValue =>
  ({ code, label, aliases: [], pinned: false, acceptsWords: false, ...extra });
const brands = [
  v('dont_know', "I don't know", { pinned: true }), v('other', 'Something else', { pinned: true, acceptsWords: true }),
  ...['Counter Culture', 'Costa', 'Coffee Bean', 'Community', 'Copper', 'Corvus', 'Cosmic', 'Courier'].map((l, i) => v(`b${i}`, l)),
];

describe('the autocomplete (D1)', () => {
  it('the row count follows typeaheadMaxRows, then the use-as-typed row', () => {
    const rows = typeaheadRows(brands, 'co', { maxRows: 3, useTyped: 'Use "{typed}" as I typed it', maxItemLen: 80 });
    expect(rows).toHaveLength(4);
    expect(rows[rows.length - 1]).toMatchObject({ code: 'other', words: 'co', text: 'Use "co" as I typed it' });
    expect(typeaheadRows(brands, 'co', { maxRows: 6, useTyped: 'x' })).toHaveLength(7);
    expect(typeaheadRows(brands, '', { maxRows: 3, useTyped: 'x' }).map(r => r.code)).toEqual(['dont_know', 'other']);
  });

  function draw(value: string | null = null, words: string | null = null) {
    const onChange = vi.fn();
    render(<BrewTypeahead values={brands} value={value} words={words} onChange={onChange} placeholder="Start typing"
      useTypedText={'Use "{typed}" as I typed it'} clearLabel="Clear" maxRows={3} maxItemLen={80} testId="t" />);
    return { onChange, box: screen.getByRole('combobox') as HTMLInputElement };
  }
  it('typed text with no match can be saved as the customer\'s words', () => {
    const { onChange, box } = draw();
    fireEvent.change(box, { target: { value: 'Café du Monde' } });
    expect(onChange).toHaveBeenLastCalledWith('other', 'Café du Monde');
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Use "Café du Monde" as I typed it']);
  });
  it('while typing the highlighted row is the answer (Save with unpicked text saves it); arrows move it; Enter picks', () => {
    const { onChange, box } = draw();
    fireEvent.change(box, { target: { value: 'co' } });
    expect(onChange).toHaveBeenLastCalledWith('b0', null);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('b1', null);
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('b1', null);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('a stored value with words shows the words, with a clear button', () => {
    const { onChange, box } = draw('other', 'Lavazza Oro');
    expect(box.value).toBe('Lavazza Oro');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(null, null);
  });
});

const takesIt: BrewOptionField = {
  code: 'takes_it', label: 'What goes in it', prompt: 'What goes in it?', type: 'array', picker: 'multi_select', maxItems: 4, maxItemLen: null,
  values: [v('black', 'Nothing, black', { exclusive: true }), v('milk', 'Milk'), v('sugar', 'Sugar')], displayLabels: {},
};
const drinks: BrewOptionField = {
  code: 'usual_drink', label: 'How you make your coffee', prompt: 'How?', type: 'array', picker: 'multi_select', maxItems: 4, maxItemLen: 80,
  values: [v('latte', 'Latte'), v('espresso', 'Espresso'), v('pod', 'Pod')], displayLabels: { latte: 'Latte', espresso: 'Espresso', pod: 'Pod' },
  group: { code: 'make', label: 'What you make', sortOrder: 1 },
};
const mostDays: BrewOptionField = { ...drinks, code: 'main_drink', label: 'Most days', prompt: 'Which one most days?', type: 'enum', picker: 'chips', maxItems: null, valuesFrom: 'usual_drink' };

describe('chips (D2)', () => {
  it('an exclusive chip clears the others and is cleared by them', () => {
    expect(toggleMulti(takesIt, ['milk', 'sugar'], 'black')).toEqual(['black']);
    expect(toggleMulti(takesIt, ['black'], 'milk')).toEqual(['milk']);
    expect(toggleMulti(takesIt, ['milk'], 'sugar')).toEqual(['milk', 'sugar']);
    const onChange = vi.fn();
    render(<BrewFieldControl field={takesIt} draft={['milk', 'sugar']} words="" onChange={onChange} onWords={() => {}} copy={{}} />);
    fireEvent.click(screen.getByTestId('brew-field-takes_it-option-black'));
    expect(onChange).toHaveBeenCalledWith(['black']);
  });
  it('the most-days question appears at two drinks and disappears at one', () => {
    expect(fieldApplies(mostDays, ['latte'])).toBe(false);
    const { rerender } = render(<BrewFieldControl field={mostDays} draft={null} words="" onChange={() => {}} onWords={() => {}} copy={{}} sourceDraft={['latte', 'espresso']} />);
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Latte', 'Espresso']);
    rerender(<BrewFieldControl field={mostDays} draft="latte" words="" onChange={() => {}} onWords={() => {}} copy={{}} sourceDraft={['latte']} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

const copy = {
  routine_title: 'Your coffee routine', routine_sub: 'Sub', routine_progress: '{answered} of {total} answered', routine_missing: 'Still to tell us',
  routine_edit: 'Edit your routine', routine_save: 'Save', routine_cancel: 'Cancel', routine_saving: 'Saving', routine_save_error: 'Please try saving again.',
  routine_empty: 'Tell us how you make your coffee.',
};
const roast: BrewOptionField = { code: 'cupboard_roast', label: 'What the bag says', prompt: 'What roast?', type: 'enum', picker: 'chips', maxItems: null, maxItemLen: null,
  values: [v('medium', 'Medium')], displayLabels: { medium: 'Medium' }, group: { code: 'kitchen', label: 'In your kitchen now', sortOrder: 4 } };
const options: BrewProfileOptions = { fields: [drinks, mostDays, { ...takesIt, group: { code: 'adds', label: 'What goes in it', sortOrder: 3 }, displayLabels: { milk: 'Milk' } }, roast], copy, limits: { typeaheadMaxRows: 6 } };

describe('the routine card (D3)', () => {
  beforeEach(() => { api.getBrewProfileOptions.mockResolvedValue(options); });
  it('progress counts the fields that apply; the most-days drink is marked on its chip; the rest are dashed', async () => {
    const profile: BrewProfileData = {
      usual_drink: { value: ['latte', 'espresso'], source: 'profile_page', capturedAt: null },
      main_drink: { value: 'latte', source: 'profile_page', capturedAt: null },
    };
    api.getBrewProfile.mockResolvedValue(profile);
    render(<BrewProfileMirror />);
    expect(await screen.findByTestId('routine-progress')).toHaveProperty('textContent', '2 of 4 answered');
    expect(screen.getByTestId('routine-chip-usual_drink-latte').textContent).toBe('Latte · Most days');
    expect(screen.getByTestId('routine-chip-usual_drink-espresso').textContent).toBe('Espresso');
    expect(within(screen.getByTestId('routine-missing')).getAllByRole('button').map(b => b.textContent)).toEqual(['What goes in it', 'What the bag says']);
  });
  it('one drink: most days does not apply and is not counted', async () => {
    api.getBrewProfile.mockResolvedValue({ usual_drink: { value: ['latte'], source: 'profile_page', capturedAt: null } });
    render(<BrewProfileMirror />);
    expect((await screen.findByTestId('routine-progress')).textContent).toBe('1 of 3 answered');
  });
  it('a failed save shows routine_save_error, never the server\'s message', async () => {
    api.getBrewProfile.mockResolvedValue({ cupboard_roast: { value: 'medium', source: 'profile_page', capturedAt: null } });
    api.saveBrewRoutine.mockRejectedValue(new Error('cupboard_roast must be a string'));
    render(<BrewProfileMirror />);
    fireEvent.click(await screen.findByTestId('routine-edit'));
    fireEvent.click(screen.getByTestId('brew-field-takes_it-option-milk'));
    fireEvent.click(screen.getByTestId('routine-save'));
    expect((await screen.findByTestId('routine-save-error')).textContent).toBe('Please try saving again.');
    expect(screen.queryByText(/must be a string/)).toBeNull();
    expect(api.saveBrewRoutine).toHaveBeenCalledWith({ answers: [{ field: 'takes_it', value: ['milk'] }, { field: 'cupboard_roast', value: 'medium' }], cleared: [] });
  });
});

describe('the Flavor Memory tab (D4)', () => {
  const memory = (cards: number) => ({
    activity: [], journal: [{ orderId: 'o1', blendName: 'Bag one', date: null, rating: null, notes: [], feedbackDue: true }],
    contributionCount: 0,
    brewCards: Array.from({ length: cards }, (_, i) => ({ id: i, coffeeId: 1, coffeeName: 'X', method: 'v60', params: { ratio: '1:16', grindLabel: 'medium', tempC: 94, notes: '' }, lastAdjustmentReason: null })),
  });
  beforeEach(() => {
    api.getUserProfile.mockResolvedValue({ firstName: 'Zzz', addresses: [] });
    api.getHomepageState.mockResolvedValue({
      stageCode: 'QUIZ_TAKEN_FRESH_NO_ORDER', archetype: { id: 'balanced', name: 'Balanced', features: ['First line', 'Second line'] },
      pendingFeedback: { orderId: 'o1', blendName: 'Bag one', coffeeId: 1 }, usualBlend: null, nextDeliveryDate: null,
    });
    api.getDialPosition.mockResolvedValue(null);
    api.getBrewProfile.mockResolvedValue({});
    api.getBrewProfileOptions.mockResolvedValue(options);
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => [] })));
  });
  const draw = () => render(<MemoryRouter><Profile /></MemoryRouter>);

  it('three blocks; the switcher keeps Activity and Tasting journal and hides empty Brew cards and Your trail', async () => {
    trail.has = false;
    api.getFlavorMemory.mockResolvedValue(memory(0));
    draw();
    await screen.findByTestId('memory-history');
    await waitFor(() => expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Flavor activity', 'Tasting journal']));
    expect(screen.getByTestId('memory-palate')).toBeTruthy();
    expect(screen.getByTestId('brew-profile-mirror')).toBeTruthy();
    // first feature line only while the primary block is folded
    expect(screen.queryByText('Second line')).toBeNull();
    expect(screen.getByText('First line')).toBeTruthy();
  });
  it('with a brew card and a trail both segments show; the trail label comes from MapTrail', async () => {
    trail.has = true;
    api.getFlavorMemory.mockResolvedValue(memory(1));
    draw();
    await waitFor(() => expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Flavor activity', 'Tasting journal', 'Brew cards', 'Your trail']));
    trail.has = false;
  });
  it('the retake link is in the palate block whichever segment is selected; Leave feedback opens the journal', async () => {
    api.getFlavorMemory.mockResolvedValue(memory(0));
    draw();
    await screen.findByTestId('memory-history');
    const palate = screen.getByTestId('memory-palate');
    expect(within(palate).getByTestId('memory-retake').getAttribute('href')).toBe('/find-my-flavor?retake=1');
    expect(screen.getByTestId('history-journal').hidden).toBe(true);
    fireEvent.click(screen.getByText('Leave feedback'));
    expect(screen.getByTestId('history-journal').hidden).toBe(false);
    expect(screen.getByTestId('history-activity').hidden).toBe(true);
    expect(within(screen.getByTestId('memory-palate')).getByTestId('memory-retake')).toBeTruthy();
    expect(screen.getAllByTestId('memory-retake')).toHaveLength(1);
  });
});
