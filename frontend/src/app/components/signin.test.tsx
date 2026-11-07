import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';

// Website 8 Part D — /sign-in in the handoff layout keeps every behaviour:
// the tabs and ?mode=signin, redirect preserved after email / Google / Apple,
// the reset "sent" state, the error mapping, the quiz back link, and the side
// panel's count from facts.questions (D15).

const signIn = vi.fn(async () => {});
const signUp = vi.fn(async () => {});
const signInWithGoogle = vi.fn(async () => {});
const signInWithApple = vi.fn(async () => {});
let gated = false;

const authState: { user: null | { isAnonymous: boolean }; loading: boolean } = { user: null, loading: false };
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ ...authState, signIn, signUp, signInWithGoogle, signInWithApple }) }));
vi.mock('../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../lib/prelaunch', () => ({ usePrelaunchGated: () => gated }));
vi.mock('../lib/api', () => ({
  getHomeContent: vi.fn(async () => ({ facts: { questions: 6, dimensions: 8, families: 5, scaleMin: 0, scaleMax: 15 }, quotes: [], featured: null })),
}));

import SignIn, { friendlyError } from './SignIn';

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }
function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}
const tab = (name: string) => screen.getByRole('tab', { name });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  gated = false; authState.user = null; authState.loading = false;
  [signIn, signUp, signInWithGoogle, signInWithApple].forEach(f => { f.mockReset(); f.mockImplementation(async () => {}); });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('/sign-in', () => {
  it('defaults to Create profile with names, and ?mode=signin selects Sign in', () => {
    renderAt('/sign-in');
    expect(tab('Create profile').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Begin your profile.');
    expect(screen.getByLabelText('First name')).toBeTruthy();
    expect(screen.queryByText('Forgot your password?')).toBeNull();
    cleanup();
    renderAt('/sign-in?mode=signin');
    expect(tab('Sign in').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome back.');
    expect(screen.queryByLabelText('First name')).toBeNull();
    fireEvent.click(tab('Create profile'));
    expect(screen.getByLabelText('First name')).toBeTruthy();
  });

  it('signs in by email and keeps ?redirect=', async () => {
    renderAt('/sign-in?mode=signin&redirect=/checkout');
    type('Email', 'a@b.co'); type('Password', 'secret1');
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/checkout'));
    expect(signIn).toHaveBeenCalledWith('a@b.co', 'secret1');
  });

  it('creates a profile with first and last name, default redirect /profile', async () => {
    renderAt('/sign-in');
    type('First name', ' Ana '); type('Last name', 'Ruiz'); type('Email', 'a@b.co'); type('Password', 'secret1');
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/profile'));
    expect(signUp).toHaveBeenCalledWith('a@b.co', 'secret1', 'Ana', 'Ruiz');
  });

  it('keeps the redirect through Google and Apple', async () => {
    renderAt('/sign-in?redirect=%2Fb%2Ftok123');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/b/tok123'));
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    cleanup();
    renderAt('/sign-in?redirect=/sommelier');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/sommelier'));
    expect(signInWithApple).toHaveBeenCalledTimes(1);
  });

  it('sends the reset email and shows the sent state; asks for the email first', async () => {
    renderAt('/sign-in?mode=signin');
    fireEvent.click(screen.getByText('Forgot your password?'));
    expect(screen.getByTestId('sign-in-error').textContent).toBe('Enter your email address above first.');
    type('Email', 'a@b.co');
    fireEvent.click(screen.getByText('Forgot your password?'));
    await waitFor(() => expect(screen.getByTestId('reset-sent')).toBeTruthy());
    expect(screen.queryByTestId('sign-in-error')).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/auth/reset-password', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@b.co' }) }));
  });

  it('maps the Firebase error to the page words and stays on the page', async () => {
    signIn.mockImplementation(async () => { throw new Error('Firebase: Error (auth/invalid-credential).'); });
    renderAt('/sign-in?mode=signin&redirect=/checkout');
    type('Email', 'a@b.co'); type('Password', 'nope123');
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(screen.getByTestId('sign-in-error').textContent).toMatch(/^Wrong password\./));
    expect(screen.queryByTestId('where')).toBeNull();
    expect(friendlyError('auth/user-not-found')).toMatch(/Create profile/);
    expect(friendlyError('auth/email-already-in-use')).toMatch(/Sign in/);
    expect(friendlyError('auth/weak-password')).toBe('Password must be at least 6 characters.');
    expect(friendlyError('something else')).toBe('something else');
  });

  it('disables the button until email and password are in', () => {
    renderAt('/sign-in?mode=signin');
    expect((screen.getByTestId('sign-in-submit') as HTMLButtonElement).disabled).toBe(true);
    type('Email', 'a@b.co'); type('Password', 'x');
    expect((screen.getByTestId('sign-in-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows Back to results only with ?quiz_id', () => {
    renderAt('/sign-in');
    expect(screen.queryByTestId('back-to-results')).toBeNull();
    cleanup();
    renderAt('/sign-in?quiz_id=abc');
    expect(screen.getByTestId('back-to-results').getAttribute('href')).toBe('/find-my-flavor');
  });

  it('counts the questions from facts.questions in the side panel, and links the quiz and The Bloom', async () => {
    renderAt('/sign-in');
    await waitFor(() => expect(screen.getByTestId('sign-in-side-line').textContent).toMatch(/^Six questions/));
    expect(screen.getByRole('link', { name: /Begin my profile/ }).getAttribute('href')).toBe('/find-my-flavor');
    expect(screen.getByRole('link', { name: /Or turn the dial first/ }).getAttribute('href')).toBe('/bloom');
    expect(document.body.textContent).not.toMatch(/Seven|not flavor names/);
  });

  it('leaves The Bloom link out while gated', () => {
    gated = true;
    renderAt('/sign-in');
    expect(screen.queryByRole('link', { name: /Or turn the dial first/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Begin my profile/ })).toBeTruthy();
  });
});

describe('Website 9 AU12: already signed in', () => {
  it('a signed-in visitor goes straight to the redirect; a guest (anonymous) stays on the form', async () => {
    authState.user = { isAnonymous: false };
    renderAt('/sign-in?redirect=/checkout');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/checkout'));
    cleanup();
    renderAt('/sign-in');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/profile'));
    cleanup();
    authState.user = { isAnonymous: true };
    renderAt('/sign-in?redirect=/checkout');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Begin your profile.');
  });
});

