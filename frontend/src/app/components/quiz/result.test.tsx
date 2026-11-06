import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Website 7B Part B: the Find my flavor result scene on the real FlavorQuiz state
// machine. The hero composes from a mocked /api/coffees payload (customer words,
// the opening or saved stop, the coffee there), no percentage anywhere, the share
// row hidden for Experimental, the gate for guests, the signed-in consent note,
// the field dial section pre-set to the match, the end action row, and the
// ?result= preview for each of the six families.

const auth = { user: null as null | Record<string, unknown>, hasLiamAccess: false };
let profile: unknown = null;
let savedDial: number | null = null;
const subscribeNewsletter = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const fieldProps: Record<string, unknown>[] = [];

vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn(), cart: [], cartOpen: false, toggleCartOpen: vi.fn(), removeFromCart: vi.fn(), checkout: vi.fn() }), toCheckoutItems: (x: unknown) => x }));
vi.mock('../../lib/prelaunch', () => ({ usePrelaunchGated: () => false, usePrelaunchBypass: () => true, PRELAUNCH_MODE: false }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../lib/analytics', () => ({ trackEvent: vi.fn(), trackLead: vi.fn() }));
vi.mock('../../lib/campaign', () => ({ CAMPAIGNS: {}, getActiveCampaign: () => null }));
vi.mock('../../lib/api', () => ({
  saveQuizResult: vi.fn(async () => ({ id: 's1' })),
  getUserProfile: vi.fn(async () => profile),
  getDialPosition: vi.fn(async () => ({ dialSortOrder: savedDial })),
  setDialPosition: vi.fn(async () => ({ ok: true })),
  logQuizFunnelEvent: vi.fn(async () => ({ ok: true })),
  subscribeNewsletter: (...a: unknown[]) => subscribeNewsletter(...a),
  getCheckoutRules: vi.fn(async () => null),
  quoteCheckout: vi.fn(async () => null),
  getCoffeeCards: vi.fn(async () => ({ families: [], other: { cards: [] } })),
}));
vi.mock('../PostQuizEmailGate', () => ({ PostQuizEmailGate: ({ archetypeName }: { archetypeName: string }) => <div data-testid="email-gate">{archetypeName}</div> }));
vi.mock('../Navigation', () => ({ default: () => <header data-testid="site-header" /> }));
vi.mock('../profile/WorthExploring', () => ({ default: () => <div data-testid="worth-exploring" /> }));
// The dial section is brief 5's (tested there); here only what the result passes it.
vi.mock('../bloom/DialArchetypeSection', () => ({
  DialArchetypeSection: (p: Record<string, unknown> & { data: { archetype: string } }) => {
    fieldProps.push(p);
    return <section id={p.data.archetype} data-testid={`dial-${p.layout ?? 'dial'}`} />;
  },
}));

import FlavorQuiz from '../FlavorQuiz';

const price = [{ weightOz: 12, retailPriceCents: 2900, label: '12 oz', isAnchor: true }];
const slot = (n: number, label: string, name: string, coffeeId: number | null, isDefault = false) => ({
  dialSortOrder: n, positionLabel: label, description: null, isActive: coffeeId != null, platformName: name,
  isDefault, prices: coffeeId != null ? price : [], coffeeId,
});
const fam = (archetype: string, archetypeLabel: string, customerWords: string[] | null, slots: ReturnType<typeof slot>[]) => ({
  archetype, archetypeLabel, customerWords, sortOrder: 1, dimensionName: 'Body', dimensionPlatformName: 'Intensity',
  dimensionScaleMinLabel: 'light', dimensionScaleMaxLabel: 'heavy', slots,
});
const ARCHETYPES = [
  fam('floral', 'Floral', ['Bright', 'Fragrant', 'Delicate'], [slot(1, 'Delicate', 'Light Floral Edge', 2903), slot(2, 'Balanced', 'Perfumed & Expressive', null, true)]),
  fam('fruity', 'Fruity', ['Lively', 'Vibrant', 'Expressive'], [slot(1, 'Mellow', 'Clean Fruit', 2902), slot(2, 'Balanced', 'Bright & Tart', null, true)]),
  fam('balanced_sweet', 'Balanced', ['Easy', 'Smooth', 'Harmonious'], [slot(1, 'Smooth', 'Soft & Smooth', null), slot(2, 'Balanced', 'Classic Balanced', 2905, true)]),
  fam('chocolate_nutty', 'Chocolate & Nutty', ['Full', 'Grounded', 'Comforting'], [
    slot(1, 'Lighter', 'Quieta Non Movere', 2917), slot(2, 'Classic', 'Coado', 2914, true),
    slot(3, 'Richer', 'There’s No Place Like Home', 2916), slot(4, 'Full', 'Working Late Hours', null)]),
  fam('earthy', 'Earthy', ['Deep', 'Bold', 'Lasting'], [slot(1, 'Gentle', 'Gentle Earth', null), slot(2, 'Earthy', 'Grounded & Earthy', null, true)]),
];
const EXPERIMENTAL = fam('experimental', 'Experimental', null, [slot(1, 'Curious', 'Curious Start', null), slot(2, 'Adventurous', 'The Unexpected', null, true)]);

const oneQuestion = [{ question_id: 'q1', q_number: 1, q_text: 'Question 1?', image_asset_key: null,
  answers: [{ id: 'a0', text: 'Answer', archetype_id: null, archetype_name: null }] }];
const score = {
  archetype: 'Chocolate & Nutty', archetypeId: null, scores: { chocolate: 5 }, experimental: false, secondaryArchetype: null,
  foodSignal: null, foodSignalAlignment: 'aligned', recommendationMode: 'standard', tieDetected: false, tiedArchetypes: [],
  secondaryPath: 'none', pairConfidence: 'high', exploreArchetype: null, exploreReason: null, primaryMargin: 2, interpretationVersion: 'v2.2',
};

beforeEach(() => {
  auth.user = null; auth.hasLiamAccess = false; profile = null; savedDial = null;
  subscribeNewsletter.mockClear(); fieldProps.length = 0;
  sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.startsWith('/api/quiz/questions') ? { questions: oneQuestion }
      : url.startsWith('/api/quiz/score') ? score
      : url.startsWith('/api/coffees/archetypes') ? ARCHETYPES
      : url.startsWith('/api/coffees/experimental') ? EXPERIMENTAL
      : url.startsWith('/api/axis/adjacency') ? { adjacency: {} }
      : {};
    return { ok: true, status: 200, json: async () => body };
  }));
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} }));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderQuiz = (url: string) => render(<MemoryRouter initialEntries={[url]}><FlavorQuiz /></MemoryRouter>);
const hero = () => screen.getByTestId('quiz-result-hero');
const lastField = () => [...fieldProps].reverse().find(p => p.layout === 'field');

describe('Find my flavor — the result scene (Website 7B)', () => {
  it('the hero composes from the payload: family, words, the opening stop and the coffee there; the actions link out', async () => {
    renderQuiz('/find-my-flavor?result=chocolate');
    await waitFor(() => expect(screen.getByTestId('quiz-result-line').textContent)
      .toBe('Full · Grounded · Comforting. Your place on the dial: stop 2 — Classic — next to Coado.'));
    expect(screen.getByTestId('quiz-result-owner').textContent).toBe('Your family of taste');
    expect(screen.getByTestId('quiz-result-family').textContent).toBe('Chocolate & Nutty.');
    const turn = screen.getByTestId('quiz-turn-dial');
    expect(turn.textContent).toContain('Turn the Chocolate & Nutty dial');
    expect(turn.getAttribute('href')).toBe('/bloom?archetype=chocolate_nutty&slot=2');
    fireEvent.click(turn);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();   // scrolls (to the gate, for a guest) instead of leaving
    expect(screen.getByTestId('quiz-ask-liam').getAttribute('href')).toBe('/sign-in?redirect=/sommelier');
  });

  it('no percentage anywhere on the result, and no typed description or why line', async () => {
    renderQuiz('/find-my-flavor?result=floral');
    await waitFor(() => screen.getByTestId('quiz-result-line'));
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/You are drawn to|Light, elegant, and aromatic|Ethiopia Yirgacheffe/);
    // Floral's classic is not sellable: the dial opens on stop 1 (Website 6 B2) and the hero says so
    expect(screen.getByTestId('quiz-result-line').textContent).toBe('Bright · Fragrant · Delicate. Your place on the dial: stop 1 — Delicate — next to Light Floral Edge.');
  });

  it('a stop with no coffee is named without a coffee; a family without words shows the stop only', async () => {
    renderQuiz('/find-my-flavor?result=earthy');
    await waitFor(() => expect(screen.getByTestId('quiz-result-line').textContent).toBe('Deep · Bold · Lasting. Your place on the dial: stop 2 — Earthy.'));
    cleanup();
    renderQuiz('/find-my-flavor?result=experimental');
    await waitFor(() => expect(screen.getByTestId('quiz-result-line').textContent).toBe('Your place on the dial: stop 2 — Adventurous.'));
  });

  it('the share row shows for a family and is hidden for Experimental', async () => {
    renderQuiz('/find-my-flavor?result=fruity');
    await waitFor(() => screen.getByTestId('share-match'));
    cleanup();
    renderQuiz('/find-my-flavor?result=experimental');
    await waitFor(() => screen.getByTestId('quiz-result-line'));
    expect(screen.queryByTestId('share-match')).toBeNull();
  });

  it('a guest sees the gate (with the family name) and no dial section until it unlocks', async () => {
    renderQuiz('/find-my-flavor?result=balanced');
    await waitFor(() => expect(screen.getByTestId('email-gate').textContent).toBe('Balanced'));
    expect(screen.queryByTestId('dial-field')).toBeNull();
    expect(screen.queryByTestId('quiz-end-row')).toBeNull();
  });

  it('a recognized guest: the masked-email note, the field, and only "Back to home" in the end row', async () => {
    localStorage.setItem('axisbloom.postQuizEmail', 'ana@example.com');
    renderQuiz('/find-my-flavor?result=chocolate');
    await waitFor(() => screen.getByTestId('dial-field'));
    expect(screen.getByTestId('gate-status-note').textContent).toContain('on its way to a••@e••••.com');
    const links = within(screen.getByTestId('quiz-end-row')).getAllByRole('link');
    expect(links.map(l => [l.textContent, l.getAttribute('href')])).toEqual([['Back to home →', '/']]);
  });

  it('signed in: the quiz runs to the result, the consent note shows, the field is pre-set to the match, both end links', async () => {
    auth.user = { uid: 'u1', isAnonymous: false, email: 'ana@example.com', displayName: 'Ana' };
    auth.hasLiamAccess = true;
    profile = { firstName: 'Ana', archetype: null, isNewsletterSubscriber: false, email: 'ana@example.com' };
    renderQuiz('/find-my-flavor');
    await waitFor(() => screen.getByTestId('quiz-question'));
    fireEvent.click(within(screen.getByRole('radiogroup')).getAllByRole('radio')[0]);
    await waitFor(() => screen.getByTestId('quiz-result-hero'), { timeout: 4000 });
    expect(within(hero()).getByTestId('quiz-result-owner').textContent).toBe('Ana’s family of taste');
    expect(screen.queryByTestId('email-gate')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('gate-status-note').textContent).toMatch(/You're on the list/));
    expect(subscribeNewsletter).toHaveBeenCalledWith(expect.objectContaining({ archetype: 'Chocolate & Nutty', source: 'post_quiz' }));
    const f = lastField()!;
    expect(f.source).toBe('find_my_flavor_results');
    expect((f.data as { archetype: string }).archetype).toBe('chocolate_nutty');
    expect(f.selectedSortOrder).toBe(2);
    expect(f.hideQuizLink).toBe(true);
    expect(f.userArchetype).toBe('chocolate_nutty');   // the comfort zone reads against the family just scored
    expect(screen.getByTestId('quiz-ask-liam').getAttribute('href')).toBe('/sommelier');
    const links = within(screen.getByTestId('quiz-end-row')).getAllByRole('link');
    expect(links.map(l => [l.textContent, l.getAttribute('href')])).toEqual([['Your flavor profile →', '/profile'], ['Back to home →', '/']]);
  });

  it('signed in with a saved position: the hero and the dial both open on it; no Liam link without access', async () => {
    auth.user = { uid: 'u1', isAnonymous: false, email: 'ana@example.com', displayName: 'Ana' };
    savedDial = 3;
    renderQuiz('/find-my-flavor?result=chocolate');
    await waitFor(() => expect(screen.getByTestId('quiz-result-line').textContent)
      .toBe('Full · Grounded · Comforting. Your place on the dial: stop 3 — Richer — next to There’s No Place Like Home.'));
    await waitFor(() => expect(lastField()?.selectedSortOrder).toBe(3));
    expect(screen.getByTestId('quiz-turn-dial').getAttribute('href')).toBe('/bloom?archetype=chocolate_nutty&slot=3');
    expect(screen.queryByTestId('quiz-ask-liam')).toBeNull();
  });

  it('?result= preview works for each of the six families', async () => {
    const cases: Array<[string, string]> = [['floral', 'Floral'], ['fruity', 'Fruity'], ['balanced', 'Balanced'],
      ['chocolate', 'Chocolate & Nutty'], ['earthy', 'Earthy'], ['experimental', 'Experimental']];
    for (const [key, label] of cases) {
      renderQuiz(`/find-my-flavor?result=${key}`);
      await waitFor(() => expect(screen.getByTestId('quiz-result-family').textContent).toBe(`${label}.`));
      expect(screen.getByTestId('quiz-turn-dial').textContent).toContain(`Turn the ${label} dial`);
      cleanup();
    }
  });
});
