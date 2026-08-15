import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { lookupCompanyGiftCode, redeemCompanyGiftCode } from '../lib/api';
import { reportError } from '../lib/errorReporter';

const ERROR_COPY: Record<string, string> = {
  'not found': "That code doesn't match anything — double check it and try again.",
  'already redeemed': 'This code has already been redeemed.',
  'payment not yet confirmed': "This code isn't active yet — check with your company.",
  'redemption window closed': 'The redemption window for this code has closed.',
  'already has an active sponsored subscription': "You already have an active sponsored subscription — this one can't be combined with it.",
};

interface Props {
  onRedeemed?: () => void;
}

export default function CompanyGiftRedemption({ onRedeemed }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [success, setSuccess] = useState<{ sponsorshipMonths?: number } | null>(null);

  useEffect(() => {
    const pending = searchParams.get('giftCode');
    if (pending) setCode(pending.toUpperCase());
  }, [searchParams]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    if (!user) {
      setNeedsSignIn(true);
      return;
    }

    setSubmitting(true);
    setError('');
    setNeedsSignIn(false);
    try {
      const lookup = await lookupCompanyGiftCode(trimmed);
      if (!lookup.valid) {
        setError(ERROR_COPY[lookup.error] ?? 'Something went wrong — try again.');
        return;
      }
      const redeemed = await redeemCompanyGiftCode(trimmed);
      if ('error' in redeemed) {
        setError(ERROR_COPY[redeemed.error] ?? 'Something went wrong — try again.');
        return;
      }
      setSuccess({ sponsorshipMonths: lookup.sponsorshipMonths });
      onRedeemed?.();
    } catch (err) {
      reportError('[CompanyGiftRedemption/redeem]', err);
      setError('Something went wrong — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function goSignIn() {
    const redirectTo = `/?giftCode=${encodeURIComponent(code.trim().toUpperCase())}`;
    navigate(`/sign-in?redirect=${encodeURIComponent(redirectTo)}`);
  }

  if (success) {
    return (
      <p className="text-sm text-[#a33726]/80 font-light">
        You're all set — {success.sponsorshipMonths ?? 3} months of coffee, on us. Take the quiz to get started.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
      <span className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 whitespace-nowrap">Have a code?</span>
      <input
        type="text"
        value={code}
        onChange={e => { setCode(e.target.value); setError(''); setNeedsSignIn(false); }}
        placeholder="AXBL-XXXXXX"
        maxLength={16}
        className="bg-transparent border-b border-[#a33726]/25 text-sm text-[#a33726] placeholder-[#a33726]/35 focus:outline-none focus:border-[#ee5974] px-1 py-1 w-40"
      />
      <button
        type="submit"
        disabled={submitting || !code.trim()}
        className="text-[10px] uppercase tracking-[0.3em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors disabled:opacity-30"
      >
        {submitting ? 'Checking…' : 'Redeem'}
      </button>
      {needsSignIn && (
        <span className="text-xs text-[#a33726]/70">
          <button type="button" onClick={goSignIn} className="underline hover:text-[#ee5974]">Sign in or create an account</button> to redeem this.
        </span>
      )}
      {error && <span className="text-xs text-red-700/80">{error}</span>}
    </form>
  );
}
