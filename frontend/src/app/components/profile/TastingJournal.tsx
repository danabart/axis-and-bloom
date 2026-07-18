import OrderFeedbackForm from '../OrderFeedbackForm';
import type { FlavorMemoryJournalEntry } from '../../lib/api';

interface Props {
  entries: FlavorMemoryJournalEntry[];
  contributionCount: number;
  expandedOrderId: string | null;
  onExpandOrder: (orderId: string | null) => void;
  onFeedbackSubmitted: () => void;
}

function monthYear(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Memory layer, main column (Profile Part 3 §2) — newest-first tasting journal.
 * Renders the seed line instead of an entry list when there's nothing to show
 * yet (no orders), rather than empty-list chrome. */
export default function TastingJournal({ entries, contributionCount, expandedOrderId, onExpandOrder, onFeedbackSubmitted }: Props) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40">Tasting journal</p>
        <p className="text-sm text-[#a33726]/50 tracking-wide">Your journal starts with your first bag.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40">Tasting journal</p>
      <div className="flex flex-col gap-6">
        {entries.map(entry => (
          <div key={entry.orderId} className="border-b border-[#a33726]/10 pb-6">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <p className="text-base text-[#a33726]">{entry.blendName ?? 'Your coffee'}</p>
              <p className="text-[10px] uppercase tracking-[0.15em] text-[#a33726]/40">{monthYear(entry.date)}</p>
            </div>

            {entry.hasFeedback ? (
              <>
                {entry.rating != null && (
                  <div className="flex gap-0.5 mt-2" aria-label={`${entry.rating} out of 5 stars`}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <span key={n} style={{ color: entry.rating! >= n ? '#ee5974' : 'rgba(163,55,38,0.2)' }}>★</span>
                    ))}
                  </div>
                )}
                {entry.note && <p className="text-sm text-[#a33726]/70 italic mt-2">&ldquo;{entry.note}&rdquo;</p>}
              </>
            ) : expandedOrderId === entry.orderId ? (
              <div className="mt-4">
                <OrderFeedbackForm
                  orderId={entry.orderId}
                  blendName={entry.blendName}
                  coffeeId={entry.coffeeId}
                  onSubmitted={() => { onExpandOrder(null); onFeedbackSubmitted(); }}
                />
              </div>
            ) : (
              <button
                onClick={() => onExpandOrder(entry.orderId)}
                className="mt-2 text-[10px] uppercase tracking-[0.2em] text-[#a33726]/50 hover:text-[#a33726] transition-colors border-b border-[#a33726]/20 pb-0.5"
              >
                No note yet — add one
              </button>
            )}
          </div>
        ))}
      </div>
      {contributionCount > 0 && (
        <p className="text-xs text-[#a33726]/40 tracking-wide">
          Your notes are part of these coffees&rsquo; community records — {contributionCount} contributed.
        </p>
      )}
    </div>
  );
}
