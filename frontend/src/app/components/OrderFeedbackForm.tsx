import { useEffect, useState, type FormEvent } from 'react';
import { submitOrderFeedback } from '../lib/api';

interface Props {
  orderId: string;
  blendName?: string | null;
  /** Profile Part 3 §5 — when known, fetches this coffee's own note vocabulary
   * for the tasted-notes chips. Additive/optional: existing call sites that
   * don't pass it still work, just without chips (degrade, not break). */
  coffeeId?: number | null;
  /** Profile Part 5 — prefills an edit of existing feedback. All optional and
   * additive; omitting them is today's fresh-submission behavior. */
  initialRating?: number | null;
  initialExpectation?: 'lighter' | 'as_expected' | 'bolder' | null;
  initialTastedNoteIds?: string[];
  initialNote?: string | null;
  onSubmitted?: () => void;
}

type Expectation = 'lighter' | 'as_expected' | 'bolder';

interface ChipNote {
  id: string;
  descriptor: string;
}

const VISIBLE_CHIPS = 8;

/** Shared feedback form (v2, Profile Part 3 §5) — one component, upgraded once,
 * so every surface that renders it (Profile's journal + Past Orders tab, FI's
 * UC3 nudge, the homepage nudge) gets v2 simultaneously. Stars stay the only
 * required field; everything added here is optional and degrades gracefully. */
export default function OrderFeedbackForm({
  orderId, blendName, coffeeId, onSubmitted,
  initialRating, initialExpectation, initialTastedNoteIds, initialNote,
}: Props) {
  const isEdit = initialRating != null;
  const [rating, setRating] = useState(initialRating ?? 0);
  const [hoverRating, setHoverRating] = useState(0);
  const [note, setNote] = useState(initialNote ?? '');
  const [expectation, setExpectation] = useState<Expectation | null>(initialExpectation ?? null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set(initialTastedNoteIds ?? []));
  const [chipNotes, setChipNotes] = useState<ChipNote[]>([]);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  // Chip vocabulary = this coffee's own distinct wheel notes (Part 2 §C —
  // /flavor-wheel now carries cupping_note_id). No coffeeId (e.g. a legacy
  // blend with no coffee mapping) simply means no chips section, per spec.
  useEffect(() => {
    if (!coffeeId) { setChipNotes([]); return; }
    fetch(`/api/coffees/${coffeeId}/flavor-wheel`)
      .then(r => r.json())
      .then((rows: Array<{ cupping_note_id?: string; descriptor: string }>) => {
        const seen = new Map<string, string>();
        for (const row of rows) {
          if (row.cupping_note_id && !seen.has(row.cupping_note_id)) seen.set(row.cupping_note_id, row.descriptor);
        }
        setChipNotes([...seen].map(([id, descriptor]) => ({ id, descriptor })));
      })
      .catch(() => setChipNotes([]));
  }, [coffeeId]);

  function toggleNote(id: string) {
    setSelectedNoteIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!rating) { setError('Pick a rating first'); return; }
    setSubmitting(true);
    setError('');
    try {
      await submitOrderFeedback(orderId, rating, note.trim() || undefined, {
        expectation: expectation ?? undefined,
        tastedNoteIds: selectedNoteIds.size ? [...selectedNoteIds] : undefined,
      });
      setSubmitted(true);
      onSubmitted?.();
    } catch {
      setError('Something went wrong — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <p className="text-sm text-[#a33726]/80 py-2">
        {isEdit ? 'Updated — thanks for the correction.' : 'Thanks — that helps Liam get to know your taste.'}
      </p>
    );
  }

  const visibleChips = chipsExpanded ? chipNotes : chipNotes.slice(0, VISIBLE_CHIPS);
  const expectationOptions: { value: Expectation; label: string }[] = [
    { value: 'lighter', label: 'Lighter' },
    { value: 'as_expected', label: 'As expected' },
    { value: 'bolder', label: 'Bolder' },
  ];

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 border border-[#a33726]/15 bg-white/40 p-4">
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

      {/* Closed dial question — feeds dial_position_signal (Part 2 §B.1). */}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/50">Compared to what you expected, was it —</p>
        <div className="flex gap-2 flex-wrap">
          {expectationOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setExpectation(prev => (prev === opt.value ? null : opt.value))}
              className="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: expectation === opt.value ? '#ee5974' : 'rgba(163,55,38,0.2)',
                color: expectation === opt.value ? '#ee5974' : '#a33726',
                backgroundColor: expectation === opt.value ? 'rgba(238,89,116,0.08)' : 'transparent',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tasted-notes chips — degrades to nothing when the coffee can't be resolved. */}
      {chipNotes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/50">What did you taste?</p>
          <div className="flex gap-2 flex-wrap">
            {visibleChips.map(chip => {
              const isSelected = selectedNoteIds.has(chip.id);
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => toggleNote(chip.id)}
                  className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                  style={{
                    borderColor: isSelected ? '#ee5974' : 'rgba(163,55,38,0.2)',
                    color: isSelected ? '#ee5974' : '#a33726',
                    backgroundColor: isSelected ? 'rgba(238,89,116,0.08)' : 'transparent',
                  }}
                >
                  {chip.descriptor}
                </button>
              );
            })}
          </div>
          {chipNotes.length > VISIBLE_CHIPS && (
            <button
              type="button"
              onClick={() => setChipsExpanded(v => !v)}
              className="text-[10px] uppercase tracking-[0.15em] text-[#a33726]/40 hover:text-[#a33726] transition-colors w-fit"
            >
              {chipsExpanded ? 'Show fewer' : `+${chipNotes.length - VISIBLE_CHIPS} more`}
            </button>
          )}
        </div>
      )}

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
        {submitting ? 'Sending…' : isEdit ? 'Update Feedback' : 'Send Feedback'}
      </button>
    </form>
  );
}
