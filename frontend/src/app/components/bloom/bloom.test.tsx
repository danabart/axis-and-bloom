import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Website 5 Part D: The Bloom's feature inventory where it is unit-testable.
// The flower wheel (snapshots at t = 0 / .5 / 1, keyboard, reduced motion), the
// comfort-zone mapping, and the page: deep link selects the stop, a settled turn
// auto-saves, explicit save and add-to-cart send the same triggers as before,
// the pill follows the server's zone (or the family level), guest / Liam-less /
// gated variants, the lineup turns the wheel, Experimental's deep link, the
// doors stay off, the hint hides after the first turn.

const auth = { user: null as null | { isAnonymous: boolean }, isGuest: false, hasLiamAccess: false };
const addToCart = vi.fn();
let gated = false;
let profile: unknown = null;
let saved: Record<string, number | null> = {};
let compat: { sentence: string | null; zone: string | null } = { sentence: null, zone: null };
const setDialPosition = vi.fn(async (..._a: unknown[]) => ({ ok: true }));

const price = (cents: number, oz = 12) => ({ weightOz: oz, retailPriceCents: cents, label: `${oz} oz`, isAnchor: oz === 12 });
const slot = (n: number, extra: Record<string, unknown> = {}) => ({
  dialSortOrder: n, positionLabel: ['', 'Lighter', 'Classic', 'Richer', 'Full'][n], description: null,
  isActive: false, platformName: `Slot ${n}`, isDefault: n === 2, prices: [] as unknown[], coffeeId: null as number | null, ...extra,
});
const arch = (archetype: string, archetypeLabel: string, sortOrder: number, slots: unknown[], extra: Record<string, unknown> = {}) => ({
  archetype, archetypeLabel, sortOrder, customerWords: ['Full', 'Grounded', 'Comforting'],
  dimensionName: 'Body', dimensionPlatformName: 'Intensity', dimensionScaleMinLabel: 'watery / light', dimensionScaleMaxLabel: 'very heavy',
  slots, doors: { left: { archetype: 'earthy', archetypeLabel: 'Earthy', rule: 'graph' }, right: { archetype: 'floral', archetypeLabel: 'Floral', rule: 'graph' } },
  collectionOffer: null, ...extra,
});
const chocSlots = [
  slot(1, { isActive: true, coffeeId: 11, platformName: 'Quieta', prices: [price(2900)] }),
  slot(2, { isActive: true, coffeeId: 12, platformName: 'Coado', prices: [price(3200)] }),
  slot(3, { isActive: true, coffeeId: 13, platformName: 'Home', prices: [price(3100), price(9000, 80)] }),
  slot(4),
];
const ARCHETYPES = [
  arch('chocolate_nutty', 'Chocolate & Nutty', 4, chocSlots, { collectionOffer: { memberCount: 3, sumCents: 9200, discountedCents: 8280 } }),
  arch('floral', 'Floral', 1, [slot(1, { isActive: true, coffeeId: 21, platformName: 'Light Floral Edge', prices: [price(2900)] }), slot(2), slot(3), slot(4)]),
  arch('fruity', 'Fruity', 2, [slot(1), slot(2)]),
  arch('balanced_sweet', 'Balanced', 3, [slot(1), slot(2)]),
  arch('earthy', 'Earthy', 5, [slot(1), slot(2)]),
];
const EXPERIMENTAL = arch('experimental', 'Experimental', 6, [slot(1, { platformName: 'Curious Start' }), slot(2, { platformName: 'The Unexpected' })], { customerWords: null });
const CARDS = {
  families: [{
    archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty', sortOrder: 4, customerWords: ['Full', 'Grounded', 'Comforting'], collectionOffer: null,
    cards: chocSlots.map(s => ({ ...s, archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty',
      ...(s.coffeeId ? { signatureNotes: ['Almond', 'Cocoa'], alsoGood: [], bestBrew: 'Espresso', hasAward: s.dialSortOrder === 2 } : {}) })),
  }],
  other: { cards: [
    { coffeeId: 31, platformName: null, archetype: 'fruity', archetypeLabel: 'Fruity', categories: [{ code: 'decaf', label: 'Decaf', sortOrder: 2 }], prices: [], effectivelyActive: false, isUnpriced: true, signatureNotes: [], alsoGood: [], hasAward: false },
    { coffeeId: 32, platformName: 'Night Owl', archetype: 'balanced_sweet', archetypeLabel: 'Balanced', categories: [{ code: 'decaf', label: 'Decaf', sortOrder: 2 }], prices: [{ ...price(2600), isActive: true }], effectivelyActive: true, isUnpriced: false, signatureNotes: [], alsoGood: [], hasAward: false },
  ] },
};
const ORDER = ['chocolate_nutty', 'earthy', 'balanced_sweet', 'floral', 'fruity'];

vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../context/CartContext', () => ({ useCart: () => ({ addToCart }), toCheckoutItems: (x: unknown) => x }));
vi.mock('../../lib/prelaunch', () => ({ usePrelaunchGated: () => gated }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../lib/api', () => ({
  getCoffeeCards: vi.fn(async () => CARDS),
  getUserProfile: vi.fn(async () => profile),
  getDialPosition: vi.fn(async (a: string) => ({ dialSortOrder: saved[a] ?? null })),
  setDialPosition: (...a: unknown[]) => setDialPosition(...a),
  getCheckoutRules: vi.fn(async () => ({ shippingFeeCents: 595, freeShippingMinBags: 2, subscriptionFrequencyWeeks: [2, 4], subscriptionDiscountPct1Bag: 10, subscriptionDiscountPct2PlusBags: 15 })),
  quoteCheckout: vi.fn(),
}));

import BloomPage from '../BloomPage';
import { FlowerWheel, stopOf, tOf } from './wheel/FlowerWheel';
import { PETALS } from './wheel/wheelGeometry';
import { comfortZoneOf } from '../coffee-info/useCompatibility';
import { openingSortOrder } from './useDialSlot';

function route(url: string): unknown {
  if (url.startsWith('/api/coffees/archetypes')) return ARCHETYPES;
  if (url.startsWith('/api/coffees/experimental')) return EXPERIMENTAL;
  if (url.startsWith('/api/coffees/archetype-order')) return { order: ORDER };
  if (url.startsWith('/api/axis/adjacency')) return { adjacency: { chocolate_nutty: ['earthy'] } };
  if (url.startsWith('/api/shop/slot-availability')) return { available: true };
  if (/\/api\/coffees\/\d+\/compatibility/.test(url)) return { ...compat, reason: compat.sentence ? 'ok' : 'below_min_coffees', coffee_count: 0, divergences: [] };
  if (/\/api\/coffees\/\d+\/content/.test(url)) return { threeVoiceStory: 'The roaster built this as an everyday coffee.', tags: [] };
  if (/\/api\/coffees\/\d+\/flavor-wheel/.test(url)) return [];
  if (/\/api\/coffees\/\d+\/hops/.test(url)) return [];
  if (/\/api\/coffees\/\d+\/dimensions/.test(url)) return { dimensions: [{ dimension: 'Sweetness', scale_min_label: 'no sweetness', scale_max_label: 'very sweet', avg_min: '7.0', avg_max: '10.0' }] };
  return {};
}

let reduced = false;
beforeEach(() => {
  auth.user = null; auth.isGuest = false; auth.hasLiamAccess = false;
  gated = false; profile = null; saved = {}; compat = { sentence: null, zone: null }; reduced = false;
  addToCart.mockClear(); setDialPosition.mockClear();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => route(url) })));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} }));
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderBloom = (url = '/bloom') => render(<MemoryRouter initialEntries={[url]}><BloomPage /></MemoryRouter>);
const field = () => screen.getByTestId('bloom-field');
const slider = () => within(field()).getByRole('slider');
const coffeeName = () => within(field()).getByTestId('coffee-name').textContent;

// ── the wheel ────────────────────────────────────────────────────────────────

describe('FlowerWheel', () => {
  const draw = (t: number) => render(
    <FlowerWheel t={t} stops={4} color="#a54c2d" stopLabels={['1 · Lighter', '2 · Classic', '3 · Richer', '4 · Full']} ariaLabel="Chocolate & Nutty: Intensity" onChange={() => {}} onCommit={() => {}} />,
  );
  const pattern = () => Array.from(document.querySelectorAll('[data-testid="flower-wheel"] path')).map(p => p.getAttribute('data-on')).join('');

  it('snapshots: petals bloom from the centre outward at t = 0, .5, 1 (the handoff paint())', () => {
    const states = [0, 0.5, 1].map(t => { draw(t); const s = pattern(); cleanup(); return s; });
    expect(states).toMatchInlineSnapshot(`
      [
        "000000000000000000000000000",
        "000100110010001000110100011",
        "111111111111111111111111111",
      ]
    `);
    expect(PETALS).toHaveLength(27);
  });

  it('stops map t by k / (N - 1); one stop holds the wheel still', () => {
    expect([0, 1, 2, 3].map(k => tOf(k, 4))).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(stopOf(0.6, 4)).toBe(2);
    expect(tOf(0, 1)).toBe(0);
  });

  it('keyboard: ArrowRight / ArrowLeft / End commit the next stop; aria-valuenow and aria-valuetext name it', () => {
    const onCommit = vi.fn();
    render(<FlowerWheel t={1 / 3} stops={4} color="#a54c2d" stopLabels={['1 · Lighter', '2 · Classic', '3 · Richer', '4 · Full']} ariaLabel="x" onChange={() => {}} onCommit={onCommit} />);
    const s = screen.getByRole('slider');
    expect(s.getAttribute('aria-valuenow')).toBe('2');
    expect(s.getAttribute('aria-valuetext')).toBe('2 · Classic');
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    fireEvent.keyDown(s, { key: 'ArrowLeft' });
    fireEvent.keyDown(s, { key: 'End' });
    expect(onCommit.mock.calls.map(c => c[0])).toEqual([2 / 3, 0, 1]);
  });

  it('reduced motion: the rotation is painted at once (no spin animation)', () => {
    reduced = true;
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const r = draw(0);
    r.rerender(<FlowerWheel t={0.5} stops={4} color="#a54c2d" stopLabels={['a', 'b', 'c', 'd']} ariaLabel="x" onChange={() => {}} onCommit={() => {}} />);
    expect(document.querySelector('[data-testid="flower-wheel"] svg > g')!.getAttribute('transform')).toBe('rotate(-135.00 85.34 85.95)');
    expect(raf).not.toHaveBeenCalled();
  });

  it('without reduced motion the turn is animated (frames requested)', () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    const r = draw(0);
    r.rerender(<FlowerWheel t={0.5} stops={4} color="#a54c2d" stopLabels={['a', 'b', 'c', 'd']} ariaLabel="x" onChange={() => {}} onCommit={() => {}} />);
    expect(raf).toHaveBeenCalled();
  });
});

describe('comfortZoneOf', () => {
  it('the server zone wins; without one the family level maps in / edge / outside; no family, no pill', () => {
    expect(comfortZoneOf('wheelhouse', 'outside')).toBe('outside');
    expect(comfortZoneOf('wheelhouse', null)).toBe('in');
    expect(comfortZoneOf('exploring', null)).toBe('edge');
    expect(comfortZoneOf('stretch', null)).toBe('outside');
    expect(comfortZoneOf(null, null)).toBeNull();
  });
});

// ── the page ─────────────────────────────────────────────────────────────────

describe('The Bloom page', () => {
  it('five tabs in the personalized order; experimental is not a tab', async () => {
    renderBloom();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(5));
    expect(screen.getAllByRole('tab').map(t => t.id)).toEqual(ORDER.map(a => `bf-tab-${a}`));
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('?archetype=&slot= deep link selects the family and the stop', async () => {
    renderBloom('/bloom?archetype=chocolate_nutty&slot=3');
    await waitFor(() => expect(coffeeName()).toBe('Home'));
    expect(within(field()).getByTestId('stop-label').textContent).toBe('3 · Richer');
    expect(slider().getAttribute('aria-valuenow')).toBe('3');
  });

  it('a deep-linked slot wins over the saved position; without a link the saved position pre-sets the wheel', async () => {
    auth.user = { isAnonymous: false };
    saved = { chocolate_nutty: 1 };
    const r = renderBloom('/bloom?archetype=chocolate_nutty&slot=3');
    await waitFor(() => expect(coffeeName()).toBe('Home'));
    await new Promise(res => setTimeout(res, 20));
    expect(coffeeName()).toBe('Home');
    r.unmount();
    renderBloom('/bloom');
    await waitFor(() => expect(coffeeName()).toBe('Quieta'));
  });

  it('a settled turn auto-saves silently (no trigger) when signed in; a guest writes nothing; the hint hides after the first turn', async () => {
    auth.user = { isAnonymous: false };
    renderBloom('/bloom?archetype=chocolate_nutty');
    await waitFor(() => expect(coffeeName()).toBe('Coado'));
    expect(screen.getByTestId('wheel-hints')).toBeTruthy();
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    await waitFor(() => expect(coffeeName()).toBe('Home'));
    expect(setDialPosition).toHaveBeenCalledWith('chocolate_nutty', 3);
    expect(setDialPosition.mock.calls[0]).toHaveLength(2);
    expect(screen.queryByTestId('wheel-hints')).toBeNull();
    expect(localStorage.getItem('axisbloom.hasTurnedDial')).toBe('1');
    cleanup(); setDialPosition.mockClear(); auth.user = null; localStorage.clear();
    renderBloom('/bloom?archetype=chocolate_nutty');
    await waitFor(() => expect(coffeeName()).toBe('Coado'));
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    await waitFor(() => expect(coffeeName()).toBe('Home'));
    expect(setDialPosition).not.toHaveBeenCalled();
  });

  it('explicit save sends explicit_save with source bloom; "View in flavor memory" appears', async () => {
    auth.user = { isAnonymous: false };
    renderBloom('/bloom?archetype=chocolate_nutty&slot=2');
    await waitFor(() => expect(coffeeName()).toBe('Coado'));
    fireEvent.click(within(field()).getByTestId('save'));
    await waitFor(() => expect(within(field()).getByText('View in flavor memory ↗')).toBeTruthy());
    expect(setDialPosition).toHaveBeenCalledWith('chocolate_nutty', 2, { trigger: 'explicit_save', source: 'bloom', coffeeId: 12, platformName: 'Coado' });
  });

  it('add to cart: the payload price, the cart item, and the add_to_cart dial event (source bloom)', async () => {
    auth.user = { isAnonymous: false };
    renderBloom('/bloom?archetype=chocolate_nutty&slot=2');
    const btn = await waitFor(() => within(field()).getByTestId('add-to-cart'));
    expect(btn.textContent).toBe('Add to cart · $32.00');
    fireEvent.click(btn);
    expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dial', archetype: 'chocolate_nutty', dialSortOrder: 2, retailPriceCents: 3200, platformName: 'Coado' }));
    expect(setDialPosition).toHaveBeenCalledWith('chocolate_nutty', 2, { trigger: 'add_to_cart', source: 'bloom', coffeeId: 12 });
  });

  it('weight chips when more than one price; coming soon for a slot with no coffee', async () => {
    renderBloom('/bloom?archetype=chocolate_nutty&slot=3');
    await waitFor(() => expect(within(field()).getByRole('group', { name: 'Bag size' })).toBeTruthy());
    expect(within(field()).getAllByRole('button', { pressed: false }).length + within(field()).getAllByRole('button', { pressed: true }).length).toBeGreaterThanOrEqual(2);
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    await waitFor(() => expect(within(field()).getByTestId('state').textContent).toBe('Coming soon'));
    expect(within(field()).queryByTestId('add-to-cart')).toBeNull();
  });

  it('the pill follows the server zone; without one, the family level ("In" for your own family)', async () => {
    auth.user = { isAnonymous: false };
    profile = { archetype: { id: 'chocolate_nutty', name: 'Chocolate & Nutty' } };
    compat = { sentence: 'This coffee has slightly more body than your typical Chocolate & Nutty profile.', zone: 'edge' };
    renderBloom('/bloom?archetype=chocolate_nutty&slot=2');
    await waitFor(() => expect(screen.getByTestId('comfort-zone').textContent).toContain('At the edge of your comfort zone'));
    expect(screen.getByTestId('comfort-zone').textContent).toContain('slightly more body');
    cleanup();
    compat = { sentence: null, zone: null };
    renderBloom('/bloom?archetype=chocolate_nutty&slot=2');
    await waitFor(() => expect(screen.getByTestId('comfort-zone').textContent).toContain('In your comfort zone'));
    expect(screen.getByText('Your', { selector: '.bf-tab-kicker' })).toBeTruthy();
  });

  it('guest: "Find your flavor to see your match", no pill, no Liam; Liam with access; never while gated (and no add to cart)', async () => {
    renderBloom('/bloom?archetype=chocolate_nutty&slot=2');
    await waitFor(() => expect(screen.getByTestId('find-your-flavor')).toBeTruthy());
    expect(screen.queryByTestId('talk-to-liam')).toBeNull();
    cleanup();
    auth.hasLiamAccess = true;
    renderBloom('/bloom?archetype=chocolate_nutty&slot=2');
    await waitFor(() => expect(screen.getByTestId('talk-to-liam').getAttribute('href')).toBe('/sommelier'));
    cleanup();
    gated = true;
    renderBloom('/bloom?archetype=chocolate_nutty&slot=2');
    await waitFor(() => expect(coffeeName()).toBe('Coado'));
    expect(screen.queryByTestId('talk-to-liam')).toBeNull();
    expect(within(field()).queryByTestId('add-to-cart')).toBeNull();
    expect(screen.queryByTestId('quick-picks')).toBeNull();
  });

  it('the reveal opens two columns with the roaster words and the bars; Compare opens from it', async () => {
    renderBloom('/bloom?archetype=chocolate_nutty&slot=2');
    const reveal = await waitFor(() => within(field()).getByTestId('reveal'));
    expect(reveal.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(reveal);
    const panel = await waitFor(() => screen.getByTestId('field-reveal'));
    await waitFor(() => expect(panel.textContent).toContain('The roaster built this as an everyday coffee.'));
    await waitFor(() => expect(within(panel).getByTestId('field-bars').textContent).toContain('Sweetness'));
    expect(within(panel).getByText('Full breakdown ↗').getAttribute('href')).toBe('/flavor-intelligence?archetype=chocolate_nutty&slot=2');
    expect(within(field()).getByTestId('reveal').getAttribute('aria-expanded')).toBe('true');
  });

  it('lineup: the real count, end words, cards that turn the wheel; quick picks with the offer\'s own discount', async () => {
    auth.user = { isAnonymous: false };
    renderBloom('/bloom?archetype=chocolate_nutty&slot=1');
    await waitFor(() => expect(screen.getByTestId('lineup-label').textContent).toBe('The four Chocolate & Nutty coffees'));
    expect(screen.getByText('From watery / light to very heavy.')).toBeTruthy();
    const homeCard = screen.getByRole('button', { name: 'Turn the dial to Home' });
    fireEvent.click(homeCard);
    await waitFor(() => expect(coffeeName()).toBe('Home'));
    expect(setDialPosition).toHaveBeenCalledWith('chocolate_nutty', 3);
    expect(screen.getByTestId('quick-picks').textContent).toContain('The Chocolate & Nutty Collection · 3 coffees · 10% off · $82.80');
    expect(screen.getByTestId('quick-picks').textContent).toContain('The Chocolate & Nutty classic · Coado');
  });

  it('Other block: Experimental as cards (deep link marks the card), named category coffees only (OT-70); no doors while switched off', async () => {
    renderBloom('/bloom?archetype=experimental&slot=2');
    const exp = await waitFor(() => screen.getByTestId('experimental-group'));
    expect(within(exp).getAllByTestId('shop-card')).toHaveLength(2);
    expect(within(exp).getAllByTestId('shop-card')[1].className).toContain(' on');
    expect(within(exp).getAllByTestId('shop-card').every(c => c.getAttribute('data-state') === 'soon')).toBe(true);
    const others = screen.getByTestId('other-categories');
    expect(others.textContent).toContain('Night Owl');
    expect(within(others).getAllByTestId('shop-card')).toHaveLength(1);
    expect(screen.queryByTestId('doors')).toBeNull();
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('a tab click switches the field; ←/→ on the tabs move between families', async () => {
    renderBloom('/bloom');
    await waitFor(() => expect(field().getAttribute('data-archetype')).toBe('chocolate_nutty'));
    fireEvent.click(screen.getByRole('tab', { name: /Floral/ }));
    await waitFor(() => expect(field().getAttribute('data-archetype')).toBe('floral'));
    await act(async () => { fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' }); });
    await waitFor(() => expect(field().getAttribute('data-archetype')).toBe('fruity'));
  });
});

// Website 6 B2 (decided 2026-11-05): the stop a family opens on.
describe('opening stop (Website 6 B2)', () => {
  const live = (n: number, extra: Record<string, unknown> = {}) => slot(n, { isActive: true, coffeeId: 100 + n, platformName: `Live ${n}`, prices: [price(2900)], ...extra });
  const fam = (slots: unknown[]) => arch('floral', 'Floral', 1, slots) as unknown as Parameters<typeof openingSortOrder>[0];

  it('the classic when it is sellable', () => {
    expect(openingSortOrder(fam([live(1), live(2), live(3), slot(4)]))).toBe(2);
  });
  it('else the nearest sellable stop', () => {
    expect(openingSortOrder(fam([slot(1), slot(2), slot(3), live(4)]))).toBe(4);
    expect(openingSortOrder(fam([slot(1), slot(2), live(3), slot(4)]))).toBe(3);
  });
  it('on a tie, the lower stop', () => {
    expect(openingSortOrder(fam([live(1), slot(2), live(3), slot(4)]))).toBe(1);
  });
  it('a priced-less or coffee-less classic is not sellable; nothing sellable keeps the classic', () => {
    expect(openingSortOrder(fam([live(1), live(2, { prices: [] }), slot(3), slot(4)]))).toBe(1);
    expect(openingSortOrder(fam([slot(1), slot(2), slot(3), slot(4)]))).toBe(2);
  });
  it('on the page: Floral (classic has no coffee) opens on its live stop; a deep link still wins', async () => {
    renderBloom('/bloom?archetype=floral');
    await waitFor(() => expect(coffeeName()).toBe('Light Floral Edge'));
    cleanup();
    renderBloom('/bloom?archetype=floral&slot=3');
    await waitFor(() => expect(within(field()).getByTestId('stop-label').textContent).toBe('3 · Richer'));
  });
  it('a saved position still wins', async () => {
    auth.user = { isAnonymous: false };
    saved = { floral: 4 };
    renderBloom('/bloom?archetype=floral');
    await waitFor(() => expect(within(field()).getByTestId('stop-label').textContent).toBe('4 · Full'));
  });
});
