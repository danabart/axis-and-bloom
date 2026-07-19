import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { ARCHETYPE_COLOR } from '../coffee-info/archetypeConstants';
import type { FlavorMemoryJourneyEntry } from '../../lib/api';

interface Props {
  entries: FlavorMemoryJourneyEntry[];
  retakeCopy: string;
}

const COLLAPSED_COUNT = 3;

function shortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Memory layer, side column (Profile Part 3 §3) — compact archetype-over-time
 * timeline. One entry is expected for most users and still reads as the start
 * of a story, not an error (the backend guarantees >=1 for any matched user).
 * Owns the "Retake the quiz" link — relocated here from Part 1's page-bottom
 * placement, since it's the natural "next chapter" action under this timeline.
 *
 * Part 6 follow-up: entries can run long for a user who's retaken many times
 * (Dana's own account backfilled to 15) — collapsed to the most recent 3 by
 * default, with a toggle to reveal the full history rather than a numeric
 * picker (more control than this list needs). `entries` arrives oldest-first
 * from the API (unchanged, other consumers may rely on that order); this
 * component reverses purely for display so the most recent quiz reads first,
 * going backwards. */
export default function PalateTimeline({ entries, retakeCopy }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = entries.length > COLLAPSED_COUNT;
  const newestFirst = [...entries].reverse();
  const visibleEntries = expanded ? newestFirst : newestFirst.slice(0, COLLAPSED_COUNT);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40">Palate over time</p>
      <div className="flex flex-col gap-5">
        {visibleEntries.map((entry, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: ARCHETYPE_COLOR[entry.archetype] ?? '#a33726' }} />
            <div>
              <p className="text-sm text-[#a33726]">{entry.archetypeLabel}</p>
              <p className="text-[10px] uppercase tracking-[0.15em] text-[#a33726]/40 mt-0.5">
                {shortDate(entry.at)} · {entry.trigger === 'first_quiz' ? 'First quiz' : 'Retake'}
              </p>
            </div>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 hover:text-[#a33726] transition-colors w-fit"
        >
          {expanded ? 'Show recent only' : `Show full history (${entries.length})`}
        </button>
      )}
      <Link
        to="/find-my-flavor?retake=1"
        className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 border-b border-[#a33726]/20 pb-1 hover:text-[#a33726] hover:border-[#a33726]/40 transition-colors w-fit mt-2"
      >
        {retakeCopy} <ArrowRight size={12} />
      </Link>
    </div>
  );
}
