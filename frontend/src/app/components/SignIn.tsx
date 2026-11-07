import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { reportError } from '../lib/errorReporter';
import { getHomeContent } from '../lib/api';
import { usePrelaunchGated } from '../lib/prelaunch';
import { Wrap, Caps, Titled, Btn } from './chrome';
import { numberWord } from './bloom/useDialSlot';
import './bloom/cartPage.css';

// Website 8 (2026-11-06) — the handoff's sign-in page (source/account/build.py,
// D8), with everything this page already did kept inside it: the Create
// profile / Sign in tabs (`?mode=signin`), first and last name on create,
// Google and Apple, the reset flow and its sent state, `?redirect=` on every
// path, the `?quiz_id` back link, the error line. The side panel's question
// count is GET /api/home/content `facts.questions` (D15).
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_8_SIGN_IN_AND_CART.md

type Tab = 'create' | 'signin';

const TABS: { id: Tab; label: string; title: string; lead: string; submit: string }[] = [
  {
    id: 'create', label: 'Create profile', title: 'Begin your profile.', submit: 'Save my taste profile',
    lead: 'Save your family of taste and your place on the dial, and every bag you add finds its way back to you.',
  },
  {
    id: 'signin', label: 'Sign in', title: 'Welcome back.', submit: 'Sign in',
    lead: 'Your family of taste, your place on the dial and every bag you’ve told us about are waiting.',
  },
];

/** Firebase error codes in the page's own words. */
export function friendlyError(msg: string): string {
  if (msg.includes('wrong-password') || msg.includes('invalid-credential'))
    return 'Wrong password. Try "Forgot your password?" below, or sign in with Google if you created your account that way.';
  if (msg.includes('user-not-found'))
    return 'No account found with that email. Use "Create profile" to sign up.';
  if (msg.includes('email-already-in-use'))
    return 'An account with this email already exists. Switch to "Sign in".';
  if (msg.includes('weak-password'))
    return 'Password must be at least 6 characters.';
  return msg;
}

export default function SignIn() {
  const [searchParams] = useSearchParams();
  // bag_qr (2026-10-05) — `?mode=signin` preselects the Sign In tab (the QR
  // two-door page's "I have a profile" door). Default stays 'create'.
  const [activeTab, setActiveTab] = useState<Tab>(
    searchParams.get('mode') === 'signin' ? 'signin' : 'create'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [questions, setQuestions] = useState<number | null>(null);
  const navigate = useNavigate();
  const { user, loading: authLoading, signIn, signUp, signInWithGoogle, signInWithApple } = useAuth();
  const fromQuiz = searchParams.get('quiz_id');
  // /sign-in is open while gated; The Bloom is not, so its link waits for launch (no door we won't open).
  const gated = usePrelaunchGated();

  const redirectTo = searchParams.get('redirect') ?? '/profile';

  useEffect(() => {
    getHomeContent().then(c => setQuestions(c.facts.questions)).catch(err => reportError('[SignIn/facts]', err));
  }, []);

  // AU12 (Website 9): a visitor who is already signed in (not an anonymous
  // guest) goes straight to where the link was taking them. Only on arrival:
  // a sign-in or sign-up on this page navigates itself.
  const arrivedSignedIn = useRef<boolean | null>(null);
  useEffect(() => {
    if (authLoading) return;
    if (arrivedSignedIn.current === null) arrivedSignedIn.current = !!user && !user.isAnonymous;
    if (arrivedSignedIn.current) navigate(redirectTo, { replace: true });
  }, [authLoading, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      if (activeTab === 'create') {
        await signUp(email, password, firstName.trim() || undefined, lastName.trim() || undefined);
      } else {
        await signIn(email, password);
      }
      navigate(redirectTo);
    } catch (err: any) {
      reportError('[SignIn/submit]', err);
      setError(friendlyError(err.message ?? 'Authentication failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) { setError('Enter your email address above first.'); return; }
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Could not send reset email.');
      setResetSent(true);
      setError('');
    } catch (err: any) {
      reportError('[SignIn/reset-password]', err);
      setError(err.message ?? 'Could not send reset email.');
    }
  };

  const handleGoogle = async () => {
    try {
      await signInWithGoogle();
      navigate(redirectTo);
    } catch (err: any) {
      reportError('[SignIn/google]', err);
      setError(err.message ?? 'Google sign-in failed');
    }
  };

  const handleApple = async () => {
    try {
      await signInWithApple();
      navigate(redirectTo);
    } catch (err: any) {
      reportError('[SignIn/apple]', err);
      setError(err.message ?? 'Apple sign-in failed');
    }
  };

  const tab = TABS.find(t => t.id === activeTab)!;
  const disabled = isLoading || !email || !password;

  return (
    <div className="cp-page" data-testid="sign-in-page">
      <Wrap className="cp-acct">
        <div className="cp-col">
          {fromQuiz && (
            <Link to="/find-my-flavor" className="ab-caps cp-ulink" style={{ fontWeight: 400, alignSelf: 'flex-start' }} data-testid="back-to-results">
              ← Back to results
            </Link>
          )}

          <div className="cp-tabs" role="tablist" aria-label="Sign in or create a profile">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={activeTab === t.id}
                aria-controls="sign-in-panel"
                className="ab-caps cp-tab"
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <h1 className="cp-ah">{tab.title}</h1>
          <p className="cp-ap">{tab.lead}</p>

          <form className="cp-form" id="sign-in-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`} onSubmit={handleSubmit}>
            {activeTab === 'create' && (
              <div className="cp-names">
                <div className="cp-fld">
                  <label htmlFor="si-first" className="ab-caps" style={{ fontWeight: 600 }}>First name</label>
                  <input id="si-first" type="text" value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" />
                </div>
                <div className="cp-fld">
                  <label htmlFor="si-last" className="ab-caps" style={{ fontWeight: 600 }}>Last name</label>
                  <input id="si-last" type="text" value={lastName} onChange={e => setLastName(e.target.value)} autoComplete="family-name" />
                </div>
              </div>
            )}
            <div className="cp-fld">
              <label htmlFor="si-email" className="ab-caps" style={{ fontWeight: 600 }}>Email</label>
              <input id="si-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" autoComplete="email" required />
            </div>
            <div className="cp-fld">
              <label htmlFor="si-password" className="ab-caps" style={{ fontWeight: 600 }}>Password</label>
              <input
                id="si-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                autoComplete={activeTab === 'create' ? 'new-password' : 'current-password'} required
              />
            </div>

            {error && <Caps as="p" weight={400} role="alert" className="cp-note" data-testid="sign-in-error">{error}</Caps>}
            {resetSent && <Caps as="p" weight={400} role="status" className="cp-note" data-testid="reset-sent">Password reset email sent. Check your inbox (and spam folder).</Caps>}

            <div className="cp-frow">
              <Btn type="submit" disabled={disabled} data-testid="sign-in-submit">
                {isLoading ? 'One moment…' : tab.submit}
              </Btn>
              {activeTab === 'signin' && (
                <button type="button" className="ab-caps cp-ulink" style={{ fontWeight: 400 }} onClick={handleForgotPassword}>
                  Forgot your password?
                </button>
              )}
            </div>
          </form>

          <div className="cp-providers">
            <Btn onClick={handleGoogle} icon={false}>Continue with Google</Btn>
            <Btn onClick={handleApple} icon={false}>Continue with Apple</Btn>
          </div>
        </div>

        <aside className="cp-side" aria-label="New here?">
          <Titled style={{ alignSelf: 'flex-start' }}>New here?</Titled>
          <span className="cp-big" data-testid="sign-in-side-line">
            {questions != null ? `${numberWord(questions)} questions` : 'A few questions'} about moments, reactions and familiar foods. About three minutes, and your coffee has a place.
          </span>
          <div className="cp-frow" style={{ marginTop: 6 }}>
            <Btn to="/find-my-flavor">Begin my profile</Btn>
            {!gated && <Link to="/bloom" className="ab-caps cp-ulink" style={{ fontWeight: 600 }}>Or turn the dial first ↗</Link>}
          </div>
        </aside>
      </Wrap>
    </div>
  );
}
