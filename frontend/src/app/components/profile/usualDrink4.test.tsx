// Usual Drink 4 (2026-11-26), Part D (frontend) — the archetype words on one
// line (D1), no number on the Profile (D2, the number still on the Bloom page),
// the history tabs without a vertical scroller (D3), the brew cards' sentence
// from the payload (D4), and the kitchen autocomplete with products (B2): a
// brand first, then its products; a product word finds the product. Fixture
// values only; the real ones come from the API.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { BrewOptionValue } from '../../lib/api';

const api = vi.hoisted(() => ({
  getBrewProfile: vi.fn(), getBrewProfileOptions: vi.fn(), saveBrewRoutine: vi.fn(),
  getUserProfile: vi.fn(), getHomepageState: vi.fn(), getDialPosition: vi.fn(), setDialPosition: vi.fn(), getFlavorMemory: vi.fn(),
}));
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), ...api }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' }, logout: vi.fn(), loading: false, hasLiamAccess: false }) }));
vi.mock('../../context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('../../lib/prelaunch', () => ({ usePrelaunchGated: () => false }));
const sectionProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('../bloom/DialArchetypeSection', () => ({
  DialArchetypeSection: (p: Record<string, unknown>) => { sectionProps.push(p); return <div data-testid="dial-section" />; },
}));
vi.mock('../bloom/CompareOverlay', () => ({ CompareOverlay: () => null }));
vi.mock('../coffee-info/archetypeAdjacency', () => ({ useArchetypeAdjacency: () => ({}) }));
vi.mock('../bloom/useAdjacentArchetype', () => ({
  useAdjacentArchetype: () => ({ adjacentArchetypeId: null, adjacentData: null, adjacentSortOrder: null, adjacentRevealedKeys: new Set(),
    handleAdjacentChipClick: vi.fn(), handleAdjacentDialSelect: vi.fn(), toggleAdjacentReveal: vi.fn(), registerAdjacentDialRef: vi.fn(), adjacentSectionRef: { current: null } }),
}));
vi.mock('./WorthExploring', () => ({ default: () => null }));
vi.mock('../bloom/map/MapTrail', () => ({ default: () => null }));

import Profile from '../Profile';
import BrewCards from './BrewCards';
import { typeaheadRows } from '../quiz/BrewTypeahead';

afterEach(() => { cleanup(); vi.clearAllMocks(); sectionProps.length = 0; });

const about = 'Each card starts from a standard recipe for the way you brew. We adjust it for that coffee and add how you take it.';
const memory = (cards: number) => ({
  activity: [], journal: [], contributionCount: 0, brewCardsAbout: cards ? about : null,
  brewCards: Array.from({ length: cards }, (_, i) => ({ id: i, coffeeId: 1, coffeeName: 'X', method: 'v60', ratio: '1:16', grindLabel: 'medium', tempC: 94, notes: '', revision: 1, lastAdjustmentReason: null, updatedAt: '' })),
});

describe('the Profile page (D1 to D4)', () => {
  beforeEach(() => {
    api.getUserProfile.mockResolvedValue({ firstName: 'Zzz', addresses: [] });
    api.getHomepageState.mockResolvedValue({
      stageCode: 'QUIZ_TAKEN_FRESH_NO_ORDER', archetype: { id: 'chocolate_nutty', name: 'Chocolate & Nutty', features: ['Full', 'Grounded', 'Comforting'] },
      pendingFeedback: null, usualBlend: null, nextDeliveryDate: null,
    });
    api.getDialPosition.mockResolvedValue(null);
    api.getBrewProfile.mockResolvedValue({});
    api.getBrewProfileOptions.mockResolvedValue({ fields: [], groups: [], copy: {}, limits: {} });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  });
  const draw = () => render(<MemoryRouter><Profile /></MemoryRouter>);

  it('all three archetype words on one line, with the block closed', async () => {
    api.getFlavorMemory.mockResolvedValue(memory(0));
    draw();
    const line = await screen.findByTestId('memory-archetype-words');
    expect(line.textContent).toBe('Full · Grounded · Comforting');
    expect(screen.getAllByTestId('memory-archetype-words')).toHaveLength(1);
  });

  it('the history tab row cannot scroll up and down, and still scrolls sideways', async () => {
    api.getFlavorMemory.mockResolvedValue(memory(1));
    draw();
    const row = await screen.findByTestId('history-tabs');
    expect(row.className).toContain('overflow-x-auto');
    expect(row.className).toContain('overflow-y-hidden');
    for (const tab of screen.getAllByRole('tab')) expect(tab.className).not.toContain('-mb-px');
  });

  it('the Brew cards segment shows the sentence from the payload, above the first card', async () => {
    api.getFlavorMemory.mockResolvedValue(memory(2));
    draw();
    fireEvent.click(await screen.findByTestId('history-tab-cards'));
    const sentence = await screen.findByTestId('brew-cards-about');
    expect(sentence.textContent).toBe(about);
    expect(screen.getAllByTestId('brew-cards-about')).toHaveLength(1);
  });

  it('every archetype section on the Profile hides its number', async () => {
    api.getFlavorMemory.mockResolvedValue(memory(0));
    // the archetype list the Profile fetches, so the primary section renders
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty', slots: [] }] })));
    draw();
    await waitFor(() => expect(sectionProps.length).toBeGreaterThan(0));
    for (const p of sectionProps) expect(p.hideNumber).toBe(true);
  });
});

describe('BrewCards', () => {
  it('no sentence without one in the payload; nothing at all without cards', () => {
    const { container, rerender } = render(<BrewCards cards={memory(1).brewCards} hideHeading />);
    expect(screen.queryByTestId('brew-cards-about')).toBeNull();
    rerender(<BrewCards cards={[]} about={about} />);
    expect(container.textContent).toBe('');
  });
});

describe('the kitchen autocomplete with products (B2)', () => {
  // the payload's order: each brand, then its products (the backend's orderValues)
  const v = (code: string, label: string, extra: Partial<BrewOptionValue> = {}): BrewOptionValue =>
    ({ code, label, aliases: [], pinned: false, acceptsWords: false, ...extra });
  const values = [
    v('other', 'Something else', { pinned: true, acceptsWords: true }),
    v('starbucks', 'Starbucks', { aliases: ['sbux'] }),
    v('starbucks_pike_place_roast', 'Starbucks Pike Place Roast'), v('starbucks_veranda_blend', 'Starbucks Veranda Blend'),
    v('starbucks_decaf_pike_place_roast', 'Starbucks Decaf Pike Place Roast'),
    v('peets', "Peet's Coffee"), v('seattles_best', "Seattle's Best"),
    v('tatte_bakery_and_cafe', 'Tatte Bakery & Café', { aliases: ['tatte'] }),
  ];
  const rows = (q: string) => typeaheadRows(values, q, { maxRows: 6 }).map(r => r.code);

  it('typing a brand lists the brand first, then its products', () => {
    expect(rows('starbucks')).toEqual(['starbucks', 'starbucks_pike_place_roast', 'starbucks_veranda_blend', 'starbucks_decaf_pike_place_roast']);
  });
  it('a product word finds the product; a new brand is found by its name and its alias', () => {
    expect(rows('pike')).toEqual(['starbucks_pike_place_roast', 'starbucks_decaf_pike_place_roast']);
    expect(rows('tatte')).toEqual(['tatte_bakery_and_cafe']);
    expect(rows('cafe')).toEqual(['tatte_bakery_and_cafe']);
  });
});
