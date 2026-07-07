import { useState, type FormEvent } from 'react';
import { submitOrderFeedback } from '../lib/api';

interface Props {
  orderId: string;
  blendName?: string | null;
  onSubmitted?: () => void;
}

export default function OrderFeedbackForm({ orderId, blendName, onSubmitted }: Props) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!rating) { setError('Pick a rating first'); return; }
    setSubmitting(true);
    setError('');
    try {
      await submitOrderFeedback(orderId, rating, note.trim() || undefined);
      setSubmitted(true);
      onSubmitted?.();
    } catch {
      setError('Something went wrong — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return <p className="text-sm text-[#a33726]/80 font-light py-2">Thanks — that helps Liam get to know your taste.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 border border-[#a33726]/15 bg-white/40 p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60">
        How was {blendName ?? 'your coffee'}?
      </p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHoverRating(n)}
            onMouseLeave={() => setHoverRating(0)}
            className="text-2xl leading-none"
            style={{ color: (hoverRating || rating) >= n ? '#ee5974' : 'rgba(163,55,38,0.25)' }}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Anything you want to add? (optional)"
        rows={2}
        className="w-full text-sm bg-transparent border border-[#a33726]/20 rounded-none p-2 text-[#a33726] placeholder-[#a33726]/40 focus:outline-none focus:border-[#ee5974]"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="self-start text-[10px] uppercase tracking-[0.3em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors disabled:opacity-30"
      >
        {submitting ? 'Sending…' : 'Send Feedback'}
      </button>
    </form>
  );
}
