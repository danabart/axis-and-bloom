import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Website 4 Part C — Shop all renders from the /cards payload: sections in
// sort_order (your family first when the toggle is on), cards that omit absent
// rows, the unpriced / coming-soon states, Premium ★ from a boolean only, the
// shared cart functions, and the prelaunch gate.

const auth = { user: null as null | { isAnonymous: boolean }, isGuest: false };
const addToCart = vi.fn();
let gated = false;
let profile: unknown = null;
const setDialPosition = vi.fn(async () => ({ ok: true }));
// Website 9 (D16): the order and each family's relationship word come from GET /api/coffees/archetype-order.
const REL_ORDER = ['chocolate_nutty', 'earthy', 'balanced_sweet', 'floral', 'fruity'];
const REL_CODE: Record<string, string | null> = { chocolate_nutty: 'own', earthy: 'adjacent', balanced_sweet: 'adjacent', floral: 'distant', fruity: null };
const REL_LABEL: Record<string, string> = { own: 'Your family', adjacent: 'Worth exploring', distant: 'Outside your comfort zone' };
const orderCalls: string[] = [];
function archetypeOrder(url: string) {
  orderCalls.push(url);
  return {
    order: REL_ORDER, kinds: [],
    relationships: REL_ORDER.map(a => ({ archetype: a, code: REL_CODE[a], customerLabel: REL_CODE[a] ? REL_LABEL[REL_CODE[a]!] : null })),
  };
}

const price = (cents: number, oz = 12) => ({ weightOz: oz, retailPriceCents: cents, label: `${oz} oz`, isAnchor: oz === 12 });
const slot = (n: number, extra: Record<string, unknown> = {}) => ({
  dialSortOrder: n, positionLabel: ['', 'Lighter', 'Classic', 'Richer', 'Full'][n], description: null,
  isActive: false, platformName: `Slot ${n}`, isDefault: n === 2, prices: [] as unknown[], coffeeId: null as number | null,
  ...extra,
});
const fam = (archetype: string, archetypeLabel: string, sortOrder: number, cards: unknown[], collectionOffer: unknown = null) => ({
  archetype, archetypeLabel, sortOrder, customerWords: [`${archetypeLabel}A`, `${archetypeLabel}B`, `${archetypeLabel}C`], collectionOffer,
  cards: (cards as Record<string, unknown>[]).map(c => ({ ...c, archetype, archetypeLabel })),
});

function payload() {
  return {
    families: [
      // deliberately out of order: the page sorts by sortOrder
      fam('chocolate_nutty', 'Chocolate & Nutty', 4, [
        slot(1, { isActive: true, coffeeId: 11, platformName: 'Quieta', prices: [price(3000)], signatureNotes: ['Almond', 'Cocoa'], alsoGood: ['Cold brew'], bestBrew: 'Espresso', milk: 'Works both ways', leadsInCup: 'Sweetness', hasAward: false }),
        slot(2, { isActive: true, coffeeId: 12, platformName: 'Coado', prices: [price(3200), price(4800, 16)], signatureNotes: ['Chocolate'], alsoGood: [], hasAward: true }),
        slot(3, { isActive: true, coffeeId: 13, platformName: 'Unpriced One', prices: [], signatureNotes: [], alsoGood: [], hasAward: false }),
        slot(4),
      ], { memberCount: 3, sumCents: 9000, discountedCents: 8100 }),
      fam('floral', 'Floral', 1, [slot(1), slot(2)]),
      fam('earthy', 'Earthy', 5, [slot(1)]),
      fam('fruity', 'Fruity', 2, [slot(1)]),
      fam('balanced_sweet', 'Balanced', 3, [slot(1)]),
    ],
    other: {
      cards: [
        { coffeeId: 21, platformName: null, archetype: 'fruity', archetypeLabel: 'Fruity', categories: [{ code: 'decaf', label: 'Decaf', sortOrder: 2 }], prices: [], effectivelyActive: false, isUnpriced: true, signatureNotes: [], alsoGood: [], hasAward: false },
        { coffeeId: 22, platformName: 'Night Owl', archetype: 'balanced_sweet', archetypeLabel: 'Balanced', categories: [{ code: 'decaf', label: 'Decaf', sortOrder: 2 }], prices: [{ ...price(2600), isActive: true }], effectivelyActive: true, isUnpriced: false, signatureNotes: ['Apple'], alsoGood: [], hasAward: false },
      ],
    },
  };
}

vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../context/CartContext', () => ({ useCart: () => ({ addToCart }) }));
vi.mock('../../lib/prelaunch', () => ({ usePrelaunchGated: () => gated }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../lib/api', () => ({
  getCoffeeCards: vi.fn(async () => payload()),
  getUserProfile: vi.fn(async () => profile),
  getHomeContent: vi.fn(async () => ({ facts: { questions: 6, dimensions: 8, families: 5, scaleMin: 0, scaleMax: 15 }, quotes: [], featured: null })),
  setDialPosition: (...a: unknown[]) => setDialPosition(...(a as [])),
}));

import ShopAll, { FAMILY_FIRST_KEY } from './ShopAll';

let available = true;
beforeEach(() => {
  auth.user = null; auth.isGuest = false; gated = false; profile = null; available = true;
  addToCart.mockClear(); setDialPosition.mockClear(); orderCalls.length = 0;
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ json: async () => (String(url).startsWith('/api/coffees/archetype-order') ? archetypeOrder(String(url)) : { available }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderShop = () => render(<MemoryRouter initialEntries={['/shop']}><ShopAll /></MemoryRouter>);
const sectionIds = () => screen.getAllByTestId('shop-family').map(s => s.id);
const choc = () => screen.getAllByTestId('shop-family').find(s => s.id === 'chocolate_nutty')!;
const cardNamed = (name: string) => screen.getAllByTestId('shop-card').find(c => within(c).queryByRole('heading', { name }))!;

describe('sections', () => {
  it('render in sort_order, each with its code as id (the /shop#code anchors)', async () => {
    renderShop();
    await waitFor(() => expect(sectionIds()).toEqual(['floral', 'fruity', 'balanced_sweet', 'chocolate_nutty', 'earthy']));
    expect(choc().textContent).toContain('04 — Family of taste');
    expect(screen.getByText(/5 families, a handful of coffees in each\. Every one cupped on 8 dimensions, from partner roasteries\./)).toBeTruthy();
  });

  it('signed in with a family: the order and a relationship word on every family from the payload; the toggle restores sort_order and is remembered', async () => {
    auth.user = { isAnonymous: false };
    profile = { archetype: { id: 'chocolate_nutty', name: 'Chocolate & Nutty' } };
    renderShop();
    await waitFor(() => expect(sectionIds()[0]).toBe('chocolate_nutty'));
    expect(orderCalls).toContain('/api/coffees/archetype-order?archetype=chocolate_nutty');
    expect(sectionIds()).toEqual(REL_ORDER);
    const kicker = (id: string) => screen.getAllByTestId('shop-family').find(s => s.id === id)!.querySelector('[data-testid=shop-family-kicker]')!.textContent;
    expect(kicker('chocolate_nutty')).toBe('04 — Your family');
    expect(kicker('earthy')).toBe('05 — Worth exploring');
    expect(kicker('floral')).toBe('01 — Outside your comfort zone');
    expect(kicker('fruity')).toBe('02 — Family of taste'); // no evidence: no relationship word
    expect(screen.getByTestId('shop-foryou').textContent).toContain('Your family is Chocolate & Nutty · from your quiz');
    fireEvent.click(screen.getByRole('button', { name: 'Your family first' }));
    await waitFor(() => expect(sectionIds()[0]).toBe('floral'));
    expect(localStorage.getItem(FAMILY_FIRST_KEY)).toBe('off');
    expect(kicker('earthy')).toBe('05 — Worth exploring'); // the words stay with the toggle off
  });

  it('anonymous: the line leads to the quiz', async () => {
    renderShop();
    const link = await screen.findByRole('link', { name: /Find your family first/ });
    expect(link.getAttribute('href')).toBe('/find-my-flavor');
    expect(screen.queryByRole('button', { name: 'Your family first' })).toBeNull();
  });
});

describe('the card', () => {
  it('omits rows with no value and shows the ones present', async () => {
    renderShop();
    await waitFor(() => expect(cardNamed('Quieta')).toBeTruthy());
    const quieta = cardNamed('Quieta');
    const labels = Array.from(quieta.querySelectorAll('dt')).map(d => d.textContent);
    expect(labels).toEqual(['Best brew', 'Also good', 'Milk', 'Leads in cup']);
    expect(quieta.textContent).toContain('1 · Lighter');
    expect(quieta.textContent).toContain('Almond, Cocoa');
    const coado = cardNamed('Coado');
    expect(coado.querySelector('dl')).toBeNull();
    expect(coado.querySelector('.sh-hint')).toBeNull();
    expect(quieta.querySelector('a[href="/flavor-intelligence?archetype=chocolate_nutty&slot=1"]')).toBeTruthy();
  });

  it('Premium ★ only with hasAward, and no award text anywhere', async () => {
    renderShop();
    await waitFor(() => expect(cardNamed('Coado')).toBeTruthy());
    expect(within(cardNamed('Coado')).getByTestId('premium')).toBeTruthy();
    expect(within(cardNamed('Quieta')).queryByTestId('premium')).toBeNull();
    expect(screen.getAllByTestId('premium')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/award/i);
  });

  it('states: unpriced = "Price coming", no slot coffee = "Coming soon", neither can be added', async () => {
    renderShop();
    await waitFor(() => expect(cardNamed('Unpriced One')).toBeTruthy());
    const unpriced = cardNamed('Unpriced One');
    expect(unpriced.getAttribute('data-state')).toBe('unpriced');
    expect(unpriced.textContent).toContain('Price coming');
    expect(within(unpriced).queryByText('Add to cart ↗')).toBeNull();
    const soon = cardNamed('Slot 4');
    expect(soon.getAttribute('data-state')).toBe('soon');
    expect(soon.textContent).toContain('Coming soon');
    expect(within(soon).queryByText('Add to cart ↗')).toBeNull();
    expect(within(soon).queryByText('Full profile ↗')).toBeNull();
  });

  it('a priced coffee no roaster can fill now is "Coming soon"', async () => {
    available = false;
    renderShop();
    await waitFor(() => expect(cardNamed('Quieta').getAttribute('data-state')).toBe('soon'));
  });

  it('add to cart: the dial item shape, then the dial sync', async () => {
    auth.user = { isAnonymous: false };
    renderShop();
    await waitFor(() => expect(within(cardNamed('Quieta')).getByText('$30.00 · 12 oz whole bean')).toBeTruthy());
    fireEvent.click(within(cardNamed('Quieta')).getByText('Add to cart ↗'));
    expect(addToCart).toHaveBeenCalledWith({
      kind: 'dial', archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty', dialSortOrder: 1,
      weightOz: 12, platformName: 'Quieta', retailPriceCents: 3000, qty: 1,
    });
    expect(setDialPosition).toHaveBeenCalledWith('chocolate_nutty', 1, { trigger: 'add_to_cart', source: 'shop', coffeeId: 11 });
  });

  it('weight chips when a coffee has more than one price', async () => {
    renderShop();
    await waitFor(() => expect(within(cardNamed('Coado')).getByRole('button', { name: '16 oz' })).toBeTruthy());
    fireEvent.click(within(cardNamed('Coado')).getByRole('button', { name: '16 oz' }));
    expect(within(cardNamed('Coado')).getByText('$48.00 · 16 oz whole bean')).toBeTruthy();
  });

  it('the collection row adds the collection item from the payload', async () => {
    renderShop();
    const row = await screen.findByTestId('shop-collection');
    expect(row.textContent).toContain('The collection · 3 coffees · $81.00');
    fireEvent.click(within(row).getByText('Add the collection ↗'));
    expect(addToCart).toHaveBeenCalledWith({
      kind: 'collection', archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty',
      memberCount: 3, retailPriceCents: 8100, undiscountedPriceCents: 9000, qty: 1,
    });
  });
});

describe('Other', () => {
  it('lists only named category coffees; add is the direct item', async () => {
    renderShop();
    const other = await screen.findByTestId('shop-other');
    expect(within(other).getAllByTestId('shop-card')).toHaveLength(1);
    expect(other.textContent).toContain('Night Owl');
    expect(other.querySelector('a[href="/flavor-intelligence?directCoffee=22"]')).toBeTruthy();
    fireEvent.click(within(other).getByText('Add to cart ↗'));
    expect(addToCart).toHaveBeenCalledWith({
      kind: 'direct', coffeeId: 22, categoryLabel: 'Decaf', matchedArchetypeLabel: 'Balanced',
      weightOz: 12, platformName: 'Night Owl', retailPriceCents: 2600, qty: 1,
    });
  });
});

describe('prelaunch', () => {
  it('gated: no prices, no cart links, no collection row', async () => {
    gated = true;
    renderShop();
    await waitFor(() => expect(cardNamed('Quieta')).toBeTruthy());
    expect(screen.queryByText('Add to cart ↗')).toBeNull();
    expect(screen.queryByText(/\$\d/)).toBeNull();
    expect(screen.queryByTestId('shop-collection')).toBeNull();
  });
});
