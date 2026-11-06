import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Website 7A Part C: Find my flavor's entry and question scenes on the real
// state machine (FlavorQuiz.tsx). Questions render from a mocked payload (N
// answers, the real total), back restores the selection, the letter keys pick,
// the branch shows as "One more" after the main quiz, the funnel fires with the
// same names and payloads as the code before 7A (no FlavorQuiz test existed, so
// the expectations are read from that code: FlavorQuiz.tsx at 05bdec5, lines
// 1155-1157, 1059-1061, 1188), campaign fast-start skips entry, a returning user
// sees the saved archetype, gated mode reaches the sealed ending, and Exit asks
// in the design's dialog.

const auth = { user: null as null | Record<string, unknown>, hasLiamAccess: false };
let gated = false;
let campaign: null | { slug: string; vid: string; at: number } = null;
let profile: unknown = null;
const logQuizFunnelEvent = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const saveQuizResult = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const trackEvent = vi.fn();

vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn(), cart: [], cartOpen: false, toggleCartOpen: vi.fn(), removeFromCart: vi.fn(), checkout: vi.fn() }), toCheckoutItems: (x: unknown) => x }));
vi.mock('../../lib/prelaunch', () => ({ usePrelaunchGated: () => gated, usePrelaunchBypass: () => !gated, PRELAUNCH_MODE: false }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../lib/analytics', () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a), trackLead: vi.fn() }));
vi.mock('../../lib/campaign', () => ({ CAMPAIGNS: { instagram: { label: 'Instagram' }, facebook: { label: 'Facebook' } }, getActiveCampaign: () => campaign }));
vi.mock('../../lib/api', () => ({
  saveQuizResult: (...a: unknown[]) => saveQuizResult(...a),
  getUserProfile: vi.fn(async () => profile),
  getDialPosition: vi.fn(async () => ({ dialSortOrder: null })),
  setDialPosition: vi.fn(async () => ({ ok: true })),
  logQuizFunnelEvent: (...a: unknown[]) => logQuizFunnelEvent(...a),
  subscribeNewsletter: vi.fn(async () => ({ ok: true })),
  getCheckoutRules: vi.fn(async () => ({ shippingFeeCents: 595, freeShippingMinBags: 2, subscriptionFrequencyWeeks: [2, 4], subscriptionDiscountPct1Bag: 10, subscriptionDiscountPct2PlusBags: 15 })),
  quoteCheckout: vi.fn(async () => null),
}));
vi.mock('../PostQuizEmailGate', () => ({ PostQuizEmailGate: () => <div data-testid="email-gate">email gate</div> }));
vi.mock('../ShareMatchRow', () => ({ ShareMatchRow: () => null }));
vi.mock('../Navigation', () => ({ default: () => <header data-testid="site-header" /> }));

import FlavorQuiz from '../FlavorQuiz';

const q = (n: number, answers: number) => ({
  question_id: `q${n}`, q_number: n, q_text: `Question ${n}?`, image_asset_key: `quiz/scene-q${n}`,
  answers: Array.from({ length: answers }, (_, i) => ({ id: `q${n}a${i}`, text: `Answer ${n}.${i}`, archetype_id: null, archetype_name: null })),
});
let questions = [q(1, 4), q(2, 5), q(3, 4)];
let score: Record<string, unknown>;
let branch: unknown = null;
const baseScore = () => ({
  archetype: 'Fruity', archetypeId: 'arch-fruity', scores: { fruity: 5 }, experimental: false, secondaryArchetype: null,
  foodSignal: null, foodSignalAlignment: 'aligned', recommendationMode: 'standard', tieDetected: false, tiedArchetypes: [],
  secondaryPath: 'none', pairConfidence: 'high', exploreArchetype: null, exploreReason: null, primaryMargin: 2, interpretationVersion: 'v2.2',
});

beforeEach(() => {
  auth.user = null; auth.hasLiamAccess = false; gated = false; campaign = null; profile = null;
  questions = [q(1, 4), q(2, 5), q(3, 4)]; score = baseScore(); branch = null;
  logQuizFunnelEvent.mockClear(); saveQuizResult.mockClear(); trackEvent.mockClear();
  sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.startsWith('/api/quiz/questions') ? { questions }
      : url.startsWith('/api/quiz/score') ? score
      : url.startsWith('/api/quiz/branch') ? { branchQuestion: branch }
      : url.startsWith('/api/coffees/archetypes') ? []
      : url.startsWith('/api/axis/adjacency') ? { adjacency: {} }
      : {};
    return { ok: true, status: 200, json: async () => body };
  }));
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} }));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderQuiz = (url = '/find-my-flavor') => render(<MemoryRouter initialEntries={[url]}><FlavorQuiz /></MemoryRouter>);
const begin = async () => {
  await waitFor(() => screen.getByTestId('quiz-entry'));
  fireEvent.click(screen.getByRole('button', { name: /Begin my profile/ }));
  await waitFor(() => screen.getByTestId('quiz-question'));
};
const rows = () => within(screen.getByRole('radiogroup')).getAllByRole('radio');
const pick = async (i: number) => { fireEvent.click(rows()[i]); };

describe('Find my flavor — entry and questions (Website 7A)', () => {
  it('entry: the count comes from the payload, the name is optional, the sign-in link carries the redirect', async () => {
    renderQuiz();
    await waitFor(() => expect(screen.getByTestId('quiz-lead').textContent).toMatch(/^Three questions about moments/));
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in?mode=signin&redirect=/find-my-flavor');
    expect(screen.getByLabelText(/First name \(yours or whoever you’re profiling\)/)).toBeTruthy();
    const beginBtn = screen.getByRole('button', { name: /Begin my profile/ }) as HTMLButtonElement;
    expect(beginBtn.disabled).toBe(false);
    fireEvent.click(beginBtn);
    await waitFor(() => screen.getByTestId('quiz-question'));
    expect(screen.getByTestId('quiz-progress').textContent).toContain('Your profile');
  });

  it('a question renders N answers lettered A…, the real total, and one progress segment per question', async () => {
    sessionStorage.setItem('axisBloomCustomerName', 'Ana');
    renderQuiz();
    await waitFor(() => screen.getByTestId('quiz-question'));
    expect(screen.getByTestId('quiz-counter').textContent).toBe('01 / 03');
    expect(rows()).toHaveLength(4);
    expect(rows().map(r => r.textContent?.charAt(0))).toEqual(['A', 'B', 'C', 'D']);
    expect(screen.getByTestId('quiz-progress').textContent).toContain('Ana’s profile');
    expect(screen.getByRole('progressbar').querySelectorAll('i')).toHaveLength(3);
    expect(screen.queryByTestId('quiz-back')).toBeNull();
    await pick(0);
    await waitFor(() => expect(screen.getByTestId('quiz-counter').textContent).toBe('02 / 03'));
    expect(rows()).toHaveLength(5);
  });

  it('back returns to the previous question with its answer still selected', async () => {
    renderQuiz();
    await begin();
    await pick(2);
    await waitFor(() => expect(screen.getByTestId('quiz-counter').textContent).toBe('02 / 03'));
    fireEvent.click(screen.getByTestId('quiz-back'));
    await waitFor(() => expect(screen.getByTestId('quiz-counter').textContent).toBe('01 / 03'));
    expect(rows()[2].getAttribute('aria-checked')).toBe('true');
    expect(rows()[0].getAttribute('aria-checked')).toBe('false');
  });

  it('keyboard: the letter keys pick an answer; arrows move between rows', async () => {
    renderQuiz();
    await begin();
    rows()[0].focus();
    fireEvent.keyDown(rows()[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows()[1]);
    fireEvent.keyDown(document, { key: 'b' });
    expect(rows()[1].getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(screen.getByTestId('quiz-counter').textContent).toBe('02 / 03'));
  });

  it('funnel: quiz_start once on the first answer, quiz_complete with the score, then the branch as "One more" and quiz_final with its answer', async () => {
    campaign = { slug: 'instagram', vid: 'v-1', at: Date.now() };
    branch = { questionId: 'bq', questionText: 'Branch question?', imageAssetKey: 'quiz/scene-branch',
      answers: [{ id: 'b0', text: 'Stay', archetypeId: 'arch-fruity', archetypeName: 'Fruity' }, { id: 'b1', text: 'Move', archetypeId: 'arch-floral', archetypeName: 'Floral' }] };
    renderQuiz('/find-my-flavor?campaign=instagram');
    await waitFor(() => screen.getByTestId('quiz-question'));   // campaign fast-start: no entry scene
    await pick(0);
    await waitFor(() => expect(screen.getByTestId('quiz-counter').textContent).toBe('02 / 03'));
    await pick(1);
    await waitFor(() => expect(screen.getByTestId('quiz-counter').textContent).toBe('03 / 03'));
    await pick(0);
    await waitFor(() => screen.getByTestId('quiz-branch'));
    expect(screen.getByTestId('quiz-counter').textContent).toBe('One more');
    expect(screen.getByTestId('quiz-progress').textContent).toContain('One more');

    const calls = logQuizFunnelEvent.mock.calls;
    const key = calls[0][0];
    expect(typeof key).toBe('string');
    expect(calls.map(c => c[1])).toEqual(['quiz_start', 'quiz_complete']);
    expect(calls[0]).toEqual([key, 'quiz_start', undefined, { campaign: 'instagram', vid: 'v-1' }]);
    expect(calls[1]).toEqual([key, 'quiz_complete', 'Fruity', { campaign: 'instagram', vid: 'v-1' }]);
    expect(trackEvent.mock.calls).toEqual([['QuizStart'], ['QuizComplete', { archetype: 'Fruity' }]]);
    const scoreCall = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.find(c => c[0] === '/api/quiz/score')!;
    expect(JSON.parse(String(scoreCall[1]!.body))).toEqual({ answerIds: ['q1a0', 'q2a1', 'q3a0'] });

    fireEvent.click(within(screen.getByRole('radiogroup')).getAllByRole('radio')[1]);
    await waitFor(() => expect(logQuizFunnelEvent.mock.calls.map(c => c[1])).toEqual(['quiz_start', 'quiz_complete', 'quiz_final']));
    expect(logQuizFunnelEvent.mock.calls[2]).toEqual([key, 'quiz_final', 'Floral', { campaign: 'instagram', vid: 'v-1' }]);
  });

  it('?campaign= skips the entry scene straight to question 1', async () => {
    renderQuiz('/find-my-flavor?campaign=instagram');
    await waitFor(() => screen.getByTestId('quiz-question'));
    expect(screen.queryByTestId('quiz-entry')).toBeNull();
  });

  it('a returning user sees the saved archetype on the entry photo, with retake', async () => {
    auth.user = { uid: 'u1', isAnonymous: false, email: 'ana@example.com', displayName: 'Ana Silva' };
    profile = { firstName: 'Ana', archetype: { id: 'fruity', name: 'Fruity', description: 'Lively.' }, lastQuizDate: null };
    renderQuiz();
    await waitFor(() => expect(screen.getByTestId('quiz-returning-archetype').textContent).toBe('Fruity'));
    expect(screen.getByText('Welcome back, Ana')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Retake the quiz/ })[0]);
    await waitFor(() => screen.getByTestId('quiz-question'));
  });

  it('signed in without a match: the entry line replaces the sign-in link', async () => {
    auth.user = { uid: 'u1', isAnonymous: false, email: 'ana@example.com', displayName: null };
    profile = { firstName: null, archetype: null };
    renderQuiz();
    await waitFor(() => expect(screen.getByTestId('quiz-signed-in').textContent).toBe('Signed in as ana@example.com · profiling yourself or someone in your household'));
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('gated: a finished quiz reaches the sealed ending (the email card), never the reveal', async () => {
    gated = true;
    renderQuiz();
    await begin();
    for (let i = 0; i < 3; i++) {
      const before = screen.getByTestId('quiz-counter').textContent;
      await pick(0);
      if (i < 2) await waitFor(() => expect(screen.getByTestId('quiz-counter').textContent).not.toBe(before));
    }
    await waitFor(() => screen.getByTestId('email-gate'), { timeout: 3000 });
    expect(logQuizFunnelEvent.mock.calls.map(c => c[1])).toEqual(['quiz_start', 'quiz_complete', 'quiz_final']);
  });

  it('Exit × with answers asks in the design dialog; Keep going stays, Leave returns to the entry scene', async () => {
    renderQuiz();
    await begin();
    await pick(0);
    await waitFor(() => expect(screen.getByTestId('quiz-counter').textContent).toBe('02 / 03'));
    fireEvent.click(screen.getByRole('button', { name: 'Exit ×' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep going' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('quiz-counter').textContent).toBe('02 / 03');
    fireEvent.click(screen.getByRole('button', { name: 'Exit ×' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Leave' })); });
    await waitFor(() => screen.getByTestId('quiz-entry'));
  });

  it('Exit × before any answer goes straight back to the entry scene', async () => {
    renderQuiz();
    await begin();
    fireEvent.click(screen.getByRole('button', { name: 'Exit ×' }));
    await waitFor(() => screen.getByTestId('quiz-entry'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
