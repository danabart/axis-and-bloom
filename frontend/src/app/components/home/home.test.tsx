import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Website 3 Part D — the homepage keeps the lifecycle CTA, the feedback nudge,
// the gift widget and the name hand-off; numbers, words, quotes and the
// featured coffee render from the payload; gated mode hides cart and Liam.

const auth = { user: null as null | { isAnonymous: boolean }, isGuest: false, hasLiamAccess: false };
const addToCart = vi.fn();
let gated = false;
let homepageState: unknown = null;

const CONTENT = {
  facts: { questions: 6, dimensions: 8, families: 5, scaleMin: 0, scaleMax: 15 },
  quotes: ['First quote from the survey.', 'Second quote from the survey.'],
  featured: {
    card: {
      dialSortOrder: 2, positionLabel: 'Classic', description: null, isActive: true, platformName: 'Coado', isDefault: true,
      prices: [{ weightOz: 12, retailPriceCents: 3200, label: '12 oz', isAnchor: true }],
      coffeeId: 2914, archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty',
      signatureNotes: ['Almond', 'Chocolate', 'Peanuts'], alsoGood: [], hasAward: true,
    },
    price: { weightOz: 12, retailPriceCents: 3200, label: '12 oz' },
  },
};
const fam = (archetype: string, archetypeLabel: string, sortOrder: number, words: string[], slots: Array<{ dialSortOrder: number; platformName: string | null }> = []) => ({
  archetype, archetypeLabel, sortOrder, customerWords: words,
  dimensionName: null, dimensionPlatformName: null, dimensionScaleMinLabel: null, dimensionScaleMaxLabel: null,
  slots: slots.map(s => ({ ...s, positionLabel: 'x', description: null, isActive: true, isDefault: false, prices: [], coffeeId: null })),
  doors: null, collectionOffer: null,
});
const ARCHETYPES = [
  fam('floral', 'Floral', 1, ['Bright', 'Fragrant', 'Delicate']),
  fam('fruity', 'Fruity', 2, ['Lively', 'Vibrant', 'Expressive'], [{ dialSortOrder: 2, platformName: 'Later Fruit' }, { dialSortOrder: 1, platformName: 'Clean Fruit' }]),
  fam('balanced_sweet', 'Balanced', 3, ['Easy', 'Smooth', 'Harmonious']),
  fam('chocolate_nutty', 'Chocolate & Nutty', 4, ['Full', 'Grounded', 'Comforting']),
  fam('earthy', 'Earthy', 5, ['Deep', 'Bold', 'Lasting']),
];

const setDialPosition = vi.fn(async () => ({ ok: true }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../context/CartContext', () => ({ useCart: () => ({ addToCart }) }));
vi.mock('../../lib/prelaunch', () => ({ usePrelaunchGated: () => gated }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('motion/react', () => ({ useReducedMotion: () => true }));
vi.mock('../../lib/api', () => ({
  getHomeContent: vi.fn(async () => CONTENT),
  getArchetypes: vi.fn(async () => ARCHETYPES),
  getHomepageState: vi.fn(async () => homepageState),
  setDialPosition: (...a: unknown[]) => setDialPosition(...(a as [])),
}));
vi.mock('../OrderFeedbackForm', () => ({ default: (p: { orderId: string }) => <div data-testid="order-feedback-form">feedback {p.orderId}</div> }));
vi.mock('../CompanyGiftRedemption', () => ({ default: (p: { onRedeemed: () => void }) => <div data-testid="company-gift" data-has-callback={typeof p.onRedeemed === 'function'} /> }));

import Home, { QUIZ_NAME_SESSION_KEY } from '../Home';

function renderHome() {
  return render(<MemoryRouter initialEntries={['/']}><Home /></MemoryRouter>);
}
const section03 = () => screen.getByTestId('home-section-03');

beforeEach(() => {
  auth.user = null; auth.isGuest = false; auth.hasLiamAccess = false;
  gated = false; homepageState = null;
  addToCart.mockClear(); setDialPosition.mockClear();
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => cleanup());

const state = (stageCode: string, extra: Record<string, unknown> = {}) => ({
  stageCode, archetype: { name: 'Fruity', id: 'fruity', color: '#ca445f', features: [] }, daysSinceQuiz: 3,
  pendingFeedback: null, usualBlend: { id: '1', name: 'Coado' }, nextDeliveryDate: '2026-11-20', ...extra,
});

describe('03 lifecycle CTA (same texts and links as the previous Home)', () => {
  const cases: Array<[string, RegExp, string, string | null]> = [
    ['QUIZ_TAKEN_FRESH_NO_ORDER', /You're a Fruity — shop your matches\./, '/shop', null],
    ['QUIZ_TAKEN_SETTLED_NO_ORDER', /You're a Fruity — shop your matches\./, '/shop', 'Retake the quiz'],
    ['QUIZ_STALE_NO_ORDER', /You're a Fruity — shop your matches\./, '/shop', 'Palates change — retake anytime'],
    ['SUBSCRIBER', /Your subscription is on track\./, '/profile', null],
    ['REORDER_DUE', /Ready for more Coado\?/, '/shop', null],
    ['LAPSED_SINGLE_ORDER', /New arrivals since your last order\./, '/shop', null],
    ['ACTIVE_REPEAT_USER', /Welcome back\./, '/shop', null],
  ];
  for (const [stage, headline, href, secondary] of cases) {
    it(`${stage}: headline and primary link`, async () => {
      auth.user = { isAnonymous: false };
      homepageState = state(stage);
      renderHome();
      await waitFor(() => expect(within(section03()).getByRole('heading', { level: 2 }).textContent).toMatch(headline));
      const links = within(section03()).getAllByRole('link');
      expect(links[0].getAttribute('href')).toBe(href);
      if (secondary) expect(within(section03()).getByText(secondary).getAttribute('href')).toBe('/find-my-flavor');
      expect(within(section03()).queryByLabelText('Your first name')).toBeNull();
    });
  }

  it('SUBSCRIBER shows the next shipment date', async () => {
    auth.user = { isAnonymous: false };
    homepageState = state('SUBSCRIBER');
    renderHome();
    await waitFor(() => expect(within(section03()).getByText(/Next shipment: November 20/)).toBeTruthy());
  });

  it('NEW_NO_QUIZ keeps the quiz invite, without the Sign in line for a signed-in customer', async () => {
    auth.user = { isAnonymous: false };
    homepageState = state('NEW_NO_QUIZ');
    renderHome();
    await waitFor(() => expect(within(section03()).getByText('Ready to see your shape?')).toBeTruthy());
    expect(within(section03()).queryByText('Have a profile?', { exact: false })).toBeNull();
  });

  it('signed out: the invite with the name field and Sign in', async () => {
    renderHome();
    expect(within(section03()).getByLabelText('Your first name')).toBeTruthy();
    expect(within(section03()).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in');
  });
});

describe('feedback nudge', () => {
  const pf = { orderId: 'ord-1', blendName: 'Coado', coffeeId: 2914 };

  it('appears above the headline when there is pending feedback', async () => {
    auth.user = { isAnonymous: false };
    homepageState = state('ACTIVE_REPEAT_USER', { pendingFeedback: pf });
    renderHome();
    const nudge = await screen.findByTestId('home-feedback-nudge');
    expect(within(nudge).getByTestId('order-feedback-form').textContent).toContain('ord-1');
    const heading = within(section03()).getByRole('heading', { level: 2 });
    expect(nudge.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('"Not now" hides it and stores the dismissal for 14 days', async () => {
    auth.user = { isAnonymous: false };
    homepageState = state('ACTIVE_REPEAT_USER', { pendingFeedback: pf });
    renderHome();
    fireEvent.click(await screen.findByText('Not now'));
    expect(screen.queryByTestId('home-feedback-nudge')).toBeNull();
    expect(Number(localStorage.getItem('axisBloomFeedbackDismiss_ord-1'))).toBeGreaterThan(0);
  });

  it('stays hidden while a dismissal is under 14 days old', async () => {
    localStorage.setItem('axisBloomFeedbackDismiss_ord-1', String(Date.now() - 2 * 86400000));
    auth.user = { isAnonymous: false };
    homepageState = state('ACTIVE_REPEAT_USER', { pendingFeedback: pf });
    renderHome();
    await waitFor(() => expect(within(section03()).getByText('Welcome back.')).toBeTruthy());
    expect(screen.queryByTestId('home-feedback-nudge')).toBeNull();
  });
});

describe('gift widget, name hand-off', () => {
  it('mounts CompanyGiftRedemption with the refresh callback', () => {
    renderHome();
    expect(screen.getByTestId('company-gift').getAttribute('data-has-callback')).toBe('true');
  });

  it('writes the typed name to the key the quiz reads', () => {
    renderHome();
    fireEvent.change(screen.getByLabelText('Your first name'), { target: { value: 'Camila ' } });
    expect(sessionStorage.getItem(QUIZ_NAME_SESSION_KEY)).toBe('Camila');
    expect(localStorage.getItem('axisbloom.name')).toBe('Camila ');
  });
});

describe('data from the payload', () => {
  it('facts, quiz count and dimension line render from /api/home/content', async () => {
    renderHome();
    const facts = await screen.findByTestId('home-facts');
    expect(Array.from(facts.querySelectorAll('.hm-fact-n')).map(e => e.textContent)).toEqual(['06', '08', '05', '01']);
    expect(screen.getByRole('link', { name: /Take the 6-question quiz/ }).getAttribute('href')).toBe('/find-my-flavor');
    expect(screen.getByText('Answer 6 questions')).toBeTruthy();
    expect(screen.getByText('8 dimensions · 0–15')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/seven|7-question/i);
  });

  it('family panels: number from sort_order, words, Explore link', async () => {
    renderHome();
    await waitFor(() => expect(screen.getAllByTestId('home-family')).toHaveLength(5));
    const first = screen.getAllByTestId('home-family')[0];
    expect(first.getAttribute('href')).toBe('/shop#floral');
    expect(first.textContent).toContain('01 —');
    expect(first.textContent).toContain('Fragrant');
  });

  it('Liam example uses Fruity’s gentle-end slot', async () => {
    renderHome();
    await waitFor(() => expect(document.querySelector('.hm-thread')?.textContent).toContain('next to Clean Fruit.'));
  });

  it('quotes come from the payload', async () => {
    renderHome();
    expect((await screen.findByTestId('home-quote')).textContent).toContain('First quote from the');
  });

  it('featured add-to-cart sends the dial item shape and syncs the dial for a signed-in user', async () => {
    auth.user = { isAnonymous: false };
    homepageState = state('ACTIVE_REPEAT_USER');
    renderHome();
    const fig = await screen.findByTestId('home-featured');
    expect(fig.textContent).toContain('Coado');
    expect(fig.textContent).toContain('04 — Chocolate & Nutty');
    expect(fig.textContent).toContain('12 oz whole bean · $32.00');
    fireEvent.click(within(fig).getByText('Add to cart ↗'));
    expect(addToCart).toHaveBeenCalledWith({
      kind: 'dial', archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty', dialSortOrder: 2,
      weightOz: 12, platformName: 'Coado', retailPriceCents: 3200, qty: 1,
    });
    expect(setDialPosition).toHaveBeenCalledWith('chocolate_nutty', 2, { trigger: 'add_to_cart', source: 'home', coffeeId: 2914 });
  });
});

describe('Liam button and prelaunch', () => {
  it('signed out: Talk to Liam goes through sign-in', async () => {
    renderHome();
    expect(screen.getByRole('link', { name: /Talk to Liam/ }).getAttribute('href')).toBe('/sign-in?redirect=/sommelier');
  });

  it('signed in with access: /sommelier; without access: hidden', async () => {
    auth.user = { isAnonymous: false }; auth.hasLiamAccess = true;
    renderHome();
    expect(screen.getByRole('link', { name: /Talk to Liam/ }).getAttribute('href')).toBe('/sommelier');
    cleanup();
    auth.hasLiamAccess = false;
    renderHome();
    expect(screen.queryByRole('link', { name: /Talk to Liam/ })).toBeNull();
  });

  it('gated: no featured cart, no Liam, no Shop link; family panels lead to the quiz', async () => {
    gated = true;
    renderHome();
    await waitFor(() => expect(screen.getAllByTestId('home-family')).toHaveLength(5));
    expect(screen.queryByTestId('home-featured')).toBeNull();
    expect(screen.queryByText('Add to cart ↗')).toBeNull();
    expect(screen.queryByRole('link', { name: /Talk to Liam/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Shop all coffees/ })).toBeNull();
    expect(screen.getAllByTestId('home-family')[0].getAttribute('href')).toBe('/find-my-flavor');
  });
});
