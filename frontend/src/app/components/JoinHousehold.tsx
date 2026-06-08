import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router';
import { useAuth } from '../context/AuthContext';

interface InviteInfo {
  invitedEmail: string;
  householdName: string | null;
  inviterName: string;
}

export default function JoinHousehold() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    if (!token) {
      setFetchError('No invitation token found in the URL.');
      setLoading(false);
      return;
    }
    fetch(`/api/household/invite/${token}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) setFetchError(data.error ?? 'Invitation not found or expired.');
        else setInvite(data);
      })
      .catch(() => setFetchError('Could not load invitation.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleJoin() {
    if (!user || !token) return;
    setJoining(true);
    setJoinError('');
    try {
      const t = await user.getIdToken();
      const r = await fetch(`/api/household/join/${token}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!r.ok) { setJoinError((await r.json()).error ?? 'Failed to join'); return; }
      navigate('/profile');
    } catch {
      setJoinError('Something went wrong.');
    } finally {
      setJoining(false);
    }
  }

  const signInUrl = `/sign-in?redirect=${encodeURIComponent(`/join-household?token=${token}`)}`;

  return (
    <div className="w-full h-screen bg-[#f2f1ea] flex overflow-hidden">
      <div className="hidden lg:flex w-1/2 bg-[#1a1a1a] relative flex-col justify-center items-center overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1080&q=80')` }}
        />
      </div>

      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-8 md:p-16 lg:p-24 relative z-10">
        <div className="w-full max-w-[400px] flex flex-col items-start gap-8">

          {loading ? (
            <p className="text-[#a33726]/50 text-sm uppercase tracking-widest">Loading…</p>

          ) : fetchError ? (
            <div className="flex flex-col gap-6">
              <h1 className="text-[2.5rem] text-[#a33726] leading-tight font-normal">
                This invitation is no longer valid.
              </h1>
              <p className="text-base text-[#a33726]/60 font-sans font-light">{fetchError}</p>
              <Link
                to="/"
                className="text-[10px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] hover:text-[#ee5974] transition-colors w-fit"
              >
                Return home
              </Link>
            </div>

          ) : invite ? (
            <div className="flex flex-col gap-8 w-full">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#a33726]/60 mb-4">
                  Family Bundle Invitation
                </p>
                <h1 className="text-[2.5rem] text-[#a33726] leading-tight font-normal">
                  {invite.inviterName} invited you.
                </h1>
              </div>

              <p className="text-lg text-[#a33726]/70 font-sans font-light leading-relaxed">
                You've been invited to join{' '}
                <strong className="text-[#a33726] font-normal">
                  {invite.householdName ?? 'a Family Bundle'}
                </strong>
                . Everyone gets coffee matched to their own palate, delivered together.
              </p>

              {joinError && <p className="text-sm text-red-600">{joinError}</p>}

              {user ? (
                user.email?.toLowerCase() === invite.invitedEmail.toLowerCase() ? (
                  <button
                    onClick={handleJoin}
                    disabled={joining}
                    className="text-[10px] uppercase tracking-[0.3em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors disabled:opacity-30 w-fit"
                  >
                    {joining ? 'Joining…' : 'Join Household'}
                  </button>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-[#a33726]/60 font-sans font-light">
                      This invitation was sent to{' '}
                      <strong className="font-normal">{invite.invitedEmail}</strong>.
                      You're signed in as {user.email}.
                    </p>
                    <Link
                      to={signInUrl}
                      className="text-[10px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] hover:text-[#ee5974] transition-colors w-fit"
                    >
                      Sign in with the right account
                    </Link>
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-[#a33726]/60 font-sans font-light">
                    Sign in to accept this invitation.
                  </p>
                  <Link
                    to={signInUrl}
                    className="text-[10px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] hover:text-[#ee5974] transition-colors w-fit"
                  >
                    Sign in or create account
                  </Link>
                </div>
              )}
            </div>
          ) : null}

        </div>
      </div>
    </div>
  );
}
