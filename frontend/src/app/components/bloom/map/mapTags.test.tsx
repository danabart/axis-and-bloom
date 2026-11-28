// Ella's Bloom Map 15 (2026-11-27), Part D (frontend): every card carries its
// tag above the coffee's name, as the API gives it; the spot's own top card has
// none and the "Looking at" card has one. While looking, "One step from
// {coffee}" heads the steps: above the lead's title when there is a lead, in
// place of steps_title when there is none (Dana Q6a). On the spot page the
// headings stay as they are. Fixture values only; the real ones come from the API.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_15_CARDS_ABOUT_YOU.md
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const map = vi.hoisted(() => ({ getMapFace: vi.fn(), getMapSteps: vi.fn() }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/mapCustomer', async (orig) => ({
  ...(await orig<typeof import('../../../lib/mapCustomer')>()), ...map, useMapFetch: () => apiFetch,
}));
vi.mock('../../../context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasLiamAccess: true, user: null }) }));
vi.mock('../../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('./EllaMapFace', () => ({ default: () => <div data-testid="face" /> }));
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: { div: ({ children, initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => <div {...rest}>{children}</div> },
}));

import MapPage from './MapPage';

const copy = {
  price_add: '{price} · Add', lead_title: 'Where we would take you next', others_title: 'Or one of these', steps_title: 'One step away',
  steps_title_from: 'One step from {coffee}', founder_pick: "Founder's pick", looking_at_title: 'Looking at', closing_line: 'x',
};
const price = { cents: 2900, sizeLabel: '12 oz', weightOz: 12 };
const card = (stepId: number, name: string, tag: string, isLead = false) =>
  ({ stepId, word: 'w', coffeeId: stepId, name, line: null, notes: [], price, familyLabel: null, isLead, text: `${name} text.`, tag });
const spotPage = {
  position: { coffeeId: 1, name: 'Tiger Stripe', notes: [], price, familyLabel: 'Chocolate & Nutty', hasBag: false },
  firstBag: { coffeeId: 1, reason: '', text: 'Top text.', labelCode: 'founder_pick', isFounderPick: true },
  steps: [card(94, 'Blossom', 'Same family as your spot', true), card(95, 'Geometric', 'Close to your spot')],
  copy, spot: { coffeeId: 1, name: 'Tiger Stripe', basis: 'founders_pick', since: null, backLine: 'Back to your spot: Tiger Stripe' },
  lookingAt: false, startCoffeeId: null,
};
const lookNoLead = {
  ...spotPage,
  position: { coffeeId: 7, name: 'Fabricator', notes: [], price, familyLabel: 'Chocolate & Nutty', hasBag: false },
  firstBag: { coffeeId: 7, reason: '', text: 'Her answer. The line.', labelCode: 'looking_at_title', isFounderPick: false, tag: 'Same family as your spot' },
  steps: [card(89, 'Brazil', 'Close to your spot'), card(96, 'Tiger Stripe', 'Your spot')],
  lookingAt: true,
};
const lookWithLead = { ...lookNoLead, steps: [card(73, 'The Daily', 'Same family as your spot', true), card(81, 'La Familia', 'A different direction: Fruity')] };

async function renderWith(page: unknown, path = '/map') {
  map.getMapFace.mockResolvedValue({ versionLabel: null, placements: [], wedges: [], seams: [] });
  map.getMapSteps.mockResolvedValue(page);
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/map" element={<MapPage />} /></Routes></MemoryRouter>);
  await screen.findByTestId('map-page');
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('/map: a tag on every card', () => {
  it('each step card shows its tag above the name; the spot page top card has none; headings as before', async () => {
    await renderWith(spotPage);
    const tags = screen.getAllByTestId('step-tag').map(t => t.textContent);
    expect(tags).toEqual(['Same family as your spot', 'Close to your spot']);
    const lead = screen.getByTestId('lead-step');
    const first = within(lead).getByTestId('step-card').firstElementChild!;
    expect(first.getAttribute('data-testid')).toBe('step-tag');
    expect(screen.queryByTestId('position-tag')).toBeNull();
    expect(screen.queryByTestId('steps-from-title')).toBeNull();
    expect(screen.getByTestId('lead-title').textContent).toBe('Where we would take you next');
    expect(screen.getByTestId('others-title').textContent).toBe('Or one of these');
  });

  it('the "Looking at" card has its tag, then the name and the sentence; the spot as a card says "Your spot"', async () => {
    await renderWith(lookNoLead, '/map?at=7');
    expect(screen.getByTestId('position-title').textContent).toBe('Looking at');
    expect(screen.getByTestId('position-tag').textContent).toBe('Same family as your spot');
    expect(screen.getByTestId('first-bag-reason').textContent).toBe('Her answer. The line.');
    expect(screen.getAllByTestId('step-tag').map(t => t.textContent)).toContain('Your spot');
  });
});

describe('/map: the heading while looking names the coffee', () => {
  it('with no lead, "One step from Fabricator" takes the place of "One step away"', async () => {
    await renderWith(lookNoLead, '/map?at=7');
    expect(screen.getByTestId('steps-from-title').textContent).toBe('One step from Fabricator');
    expect(screen.queryByTestId('others-title')).toBeNull();
    expect(screen.queryByText('One step away')).toBeNull();
  });

  it('with a lead, it heads the section above the lead and the others keep their titles', async () => {
    await renderWith(lookWithLead, '/map?at=7');
    expect(screen.getAllByTestId('steps-from-title').map(t => t.textContent)).toEqual(['One step from Fabricator']);
    expect(screen.getByTestId('lead-title').textContent).toBe('Where we would take you next');
    expect(screen.getByTestId('others-title').textContent).toBe('Or one of these');
  });
});
