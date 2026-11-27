// Ella's Bloom Map 14 (2026-11-27), Part D (frontend): the walk. The price chip
// adds one bag and records nothing (no decide call; the page is not re-read).
// A step card's name and a coffee's dot look at that coffee: the page address
// gets ?at=<id> and the page is read with it. "Back to your spot" clears it.
// The top card's label is the copy row the API names (looking_at_title while
// looking). Fixture values only; the real ones come from the API.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_14_SPOT_AND_WALK.md
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';

const map = vi.hoisted(() => ({ getMapFace: vi.fn(), getMapSteps: vi.fn(), decideMove: vi.fn() }));
const apiFetch = vi.hoisted(() => vi.fn());
const cart = vi.hoisted(() => ({ addToCart: vi.fn() }));
const face = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('../../../lib/mapCustomer', async (orig) => ({
  ...(await orig<typeof import('../../../lib/mapCustomer')>()), ...map, useMapFetch: () => apiFetch,
}));
vi.mock('../../../context/CartContext', () => ({ useCart: () => cart }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasLiamAccess: true, user: null }) }));
vi.mock('../../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('./EllaMapFace', () => ({
  default: (p: Record<string, unknown>) => {
    face.props = p;
    const tap = p.onTapCoffee as ((id: number) => void) | undefined;
    return <button type="button" data-testid="dot-3" onClick={() => tap?.(3)}>dot 3</button>;
  },
}));
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: { div: ({ children, initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => <div {...rest}>{children}</div> },
}));

import MapPage from './MapPage';

const copy = {
  price_add: '{price} · Add', lead_title: 'Where we would take you next', others_title: 'Or one of these', founder_pick: "Founder's pick",
  here_title: 'Your spot', looking_at_title: 'Looking at', closing_line: 'Look around as much as you like.', added_to_cart: 'In your cart.',
};
const price = { cents: 2900, sizeLabel: '12 oz', weightOz: 12 };
const spotPage = {
  position: { coffeeId: 1, name: 'Tiger Stripe', notes: [], price: { ...price, cents: 3200 }, familyLabel: 'Chocolate & Nutty', hasBag: false },
  firstBag: { coffeeId: 1, reason: '', text: 'Top text.', labelCode: 'founder_pick', isFounderPick: true },
  steps: [
    { stepId: 94, word: 'Bolder', coffeeId: 2, name: 'Blossom', line: null, notes: [], price, familyLabel: 'Chocolate & Nutty', isLead: true, text: 'Lead text.' },
    { stepId: 95, word: 'More fruit', coffeeId: 3, name: 'Geometric', line: null, notes: [], price, familyLabel: 'Fruity', isLead: false, text: 'Other text.' },
  ],
  copy, spot: { coffeeId: 1, name: 'Tiger Stripe', basis: 'founders_pick', since: null, backLine: 'Back to your spot: Tiger Stripe' },
  lookingAt: false, startCoffeeId: null,
};
const lookPage = {
  ...spotPage,
  position: { coffeeId: 2, name: 'Blossom', notes: [], price, familyLabel: 'Chocolate & Nutty', hasBag: false },
  firstBag: { coffeeId: 2, reason: '', text: 'A darker roast than Tiger Stripe, with a fuller body.', labelCode: 'looking_at_title', isFounderPick: false },
  steps: [
    { stepId: 93, word: 'Brighter', coffeeId: 1, name: 'Tiger Stripe', line: null, notes: [], price: { ...price, cents: 3200 }, familyLabel: 'Chocolate & Nutty', isLead: false, text: 'Spot text.' },
    { stepId: 92, word: 'Lighter', coffeeId: 4, name: 'Brazil', line: null, notes: [], price, familyLabel: 'Balanced', isLead: true, text: 'Brazil text.' },
  ],
  lookingAt: true,
};

let where = '';
function Where() { where = `${useLocation().pathname}${useLocation().search}`; return null; }
async function renderAt(path: string) {
  map.getMapFace.mockResolvedValue({ versionLabel: null, placements: [], wedges: [], seams: [] });
  map.getMapSteps.mockImplementation(async (_f: unknown, at?: number | null) => (at ? lookPage : spotPage));
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/map" element={<><MapPage /><Where /></>} /></Routes></MemoryRouter>);
  await screen.findByTestId('map-page');
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); face.props = null; });

describe('/map: the chip only adds the bag', () => {
  it('a step card chip adds one bag; nothing is recorded and the page is not re-read', async () => {
    await renderAt('/map');
    const reads = map.getMapSteps.mock.calls.length;
    const lead = screen.getByTestId('lead-step');
    fireEvent.click(within(lead).getByTestId('price-add'));
    expect(cart.addToCart).toHaveBeenCalledTimes(1);
    expect(map.decideMove).not.toHaveBeenCalled();
    expect(map.getMapSteps.mock.calls.length).toBe(reads);
    expect(where).toBe('/map');
    expect(screen.getByTestId('position-title').textContent).toBe("Founder's pick");
  });
});

describe('/map: walking', () => {
  it("the card's name looks at the coffee (?at=), the spot stays ringed, Back returns", async () => {
    await renderAt('/map');
    expect(face.props!.highlightCoffeeId).toBe(1);
    expect(face.props!.lookingAtCoffeeId).toBeNull();
    fireEvent.click(within(screen.getByTestId('lead-step')).getByTestId('step-look'));
    await waitFor(() => expect(screen.getByTestId('position-title').textContent).toBe('Looking at'));
    expect(where).toBe('/map?at=2');
    expect(map.getMapSteps).toHaveBeenLastCalledWith(expect.anything(), 2);
    expect(face.props!.highlightCoffeeId).toBe(1);
    expect(face.props!.lookingAtCoffeeId).toBe(2);
    expect(screen.getByTestId('first-bag-reason').textContent).toBe('A darker roast than Tiger Stripe, with a fuller body.');
    // the top card's chip adds the coffee looked at
    fireEvent.click(within(screen.getByTestId('position-card')).getByTestId('price-add'));
    expect(cart.addToCart).toHaveBeenCalledTimes(1);
    expect(map.decideMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('back-to-spot'));
    await waitFor(() => expect(screen.getByTestId('position-title').textContent).toBe("Founder's pick"));
    expect(where).toBe('/map');
  });

  it('a dot looks at its coffee; opening /map?at= directly (a refresh) reads that coffee', async () => {
    await renderAt('/map');
    fireEvent.click(screen.getByTestId('dot-3'));
    await waitFor(() => expect(where).toBe('/map?at=3'));
    cleanup();
    await renderAt('/map?at=2');
    expect(map.getMapSteps).toHaveBeenCalledWith(expect.anything(), 2);
    await waitFor(() => expect(screen.getByTestId('position-title').textContent).toBe('Looking at'));
    expect(screen.getByTestId('back-to-spot').textContent).toBe('Back to your spot: Tiger Stripe');
  });
});
