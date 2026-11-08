// Family Household 1, C2 (2026-11-07) — /join-household?token=…, outside the
// pre-launch curtain (D15; listed in PRELAUNCH_OPEN_ROUTES, not wrapped in
// <PrelaunchGate>). Works signed out (sign in or sign up through /sign-in,
// which returns here), signed in, and for a new account. Join claims the
// member the admin set up; Decline closes the link and the member stays in
// the household for the admin to order for (D34). Every state label comes
// from the API.
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { reportError } from '../lib/errorReporter';

interface Peek {
  householdName: string | null;
  memberFirstName: string | null;
  statusCode: string | null;
  statusLabel: string | null;
  open: boolean;
  viewer: { alreadyMember: boolean; leavesHousehold: string | null } | null;
}

const caps = 'text-[10px] uppercase tracking-[var(--ab-caps)] text-[var(--ab-ink)]';
const action = `${caps} border-b border-[var(--ab-ink-hairline)] pb-1 hover:border-[var(--ab-mark-b)] hover:text-[var(--ab-mark-b)] transition-colors disabled:opacity-30 w-fit`;

export default function JoinHousehold() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const signedIn = Boolean(user && !user.isAnonymous);

  const [loading, setLoading] = useState(true);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [declined, setDeclined] = useState(false);

  const authHeader = useCallback(async (): Promise<Record<string, string>> => (
    signedIn ? { Authorization: `Bearer ${await user!.getIdToken()}` } : {}
  ), [signedIn, user]);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }
    let live = true;
    (async () => {
      try {
        const r = await fetch(`/api/household/links/${encodeURIComponent(token)}`, { headers: await authHeader() });
        if (!live) return;
        if (r.status === 404) setNotFound(true);
        else if (r.ok) setPeek(await r.json());
        else setError('We could not load this join link. Please try again in a moment.');
      } catch (err) {
        reportError('[JoinHousehold/peek]', err);
        if (live) setError('We could not load this join link. Please try again in a moment.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [token, authHeader]);

  async function post(path: 'accept' | 'decline') {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/household/links/${encodeURIComponent(token)}/${path}`, { method: 'POST', headers: await authHeader() });
      const json = await r.json().catch(() => null);
      if (!r.ok) { setError(json?.message ?? 'That did not go through. Please try again in a moment.'); return; }
      if (path === 'accept') navigate('/profile?tab=family');
      else setDeclined(true);
    } catch (err) {
      reportError(`[JoinHousehold/${path}]`, err);
      setError('That did not go through. Please try again in a moment.');
    } finally { setBusy(false); }
  }

  const signInUrl = `/sign-in?redirect=${encodeURIComponent(`/join-household?token=${token}`)}`;

  return (
    <div className="w-full min-h-[70vh] bg-[var(--ab-paper)] flex justify-center items-center px-6 py-16">
      <div className="w-full max-w-[420px] flex flex-col items-start gap-8" data-testid="join-household">
        {loading ? (
          <p className={`${caps} opacity-50`}>Loading…</p>
        ) : notFound ? (
          <div className="flex flex-col gap-6">
            <h1 className="text-[2rem] text-[var(--ab-ink)] leading-tight font-normal">We could not find that join link.</h1>
            <p className="text-base text-[var(--ab-ink)]/70 font-light">Ask your household admin to send you a new one.</p>
            <Link to="/" className={action}>Return home</Link>
          </div>
        ) : declined ? (
          <div className="flex flex-col gap-6">
            <h1 className="text-[2rem] text-[var(--ab-ink)] leading-tight font-normal">Thank you for letting us know.</h1>
            <p className="text-base text-[var(--ab-ink)]/70 font-light">The link is closed. Your household admin can send a new one any time.</p>
            <Link to="/" className={action}>Return home</Link>
          </div>
        ) : peek ? (
          <div className="flex flex-col gap-8 w-full">
            <div>
              <p className={`${caps} opacity-60 mb-4`}>Family Household</p>
              <h1 className="text-[2rem] text-[var(--ab-ink)] leading-tight font-normal">
                {peek.open && peek.memberFirstName ? `${peek.memberFirstName}, join ${peek.householdName ?? 'the household'}.` : peek.householdName}
              </h1>
            </div>

            {!peek.open ? (
              <div className="flex flex-col gap-4">
                <p className="text-base text-[var(--ab-ink)]/70 font-light">
                  {peek.statusLabel ? `${peek.statusLabel}. ` : ''}Ask your household admin for a new link if you need one.
                </p>
                <Link to={signedIn ? '/profile?tab=family' : '/'} className={action}>{signedIn ? 'Go to my profile' : 'Return home'}</Link>
              </div>
            ) : peek.viewer?.alreadyMember ? (
              <div className="flex flex-col gap-4">
                <p className="text-base text-[var(--ab-ink)]/70 font-light">You are already in this household.</p>
                <Link to="/profile?tab=family" className={action}>Open the Family Household</Link>
              </div>
            ) : (
              <>
                <p className="text-lg text-[var(--ab-ink)]/80 font-light leading-relaxed">
                  Everyone in the household keeps their own taste profile; the bags arrive together. When you join, your profile, your notifications and your place in the household are yours to manage.
                </p>
                {peek.viewer?.leavesHousehold !== null && peek.viewer?.leavesHousehold !== undefined && (
                  <p className="text-sm text-[var(--ab-ink)]/70" data-testid="join-leaves-household">
                    Joining moves you out of {peek.viewer.leavesHousehold || 'your current household'}.
                  </p>
                )}
                {error && <p className="text-sm text-[var(--ab-mark-a)]" role="status">{error}</p>}
                <div className="flex flex-wrap items-center gap-8">
                  {signedIn ? (
                    <button type="button" onClick={() => post('accept')} disabled={busy} className={action}>
                      {busy ? 'Joining…' : 'Join'}
                    </button>
                  ) : (
                    <Link to={signInUrl} className={action}>Sign in or create your account to join</Link>
                  )}
                  <button type="button" onClick={() => post('decline')} disabled={busy}
                    className="text-[10px] uppercase tracking-[var(--ab-caps)] text-[var(--ab-ink)]/50 hover:text-[var(--ab-ink)] transition-colors disabled:opacity-30">
                    Decline
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--ab-mark-a)]" role="status">{error}</p>
        )}
      </div>
    </div>
  );
}
