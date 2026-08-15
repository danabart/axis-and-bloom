import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { ARCHETYPE_COLOR } from '../coffee-info/archetypeConstants';
import { removeFlavorMemoryEntry, type FlavorMemoryActivityEntry } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import { deriveReadingLine } from '../../lib/deriveReadingLine';

interface Props {
  entries: FlavorMemoryActivityEntry[];
  retakeCopy: string;
  onRemoved: () => void;
}

const COLLAPSED_COUNT = 3;

const TYPE_BADGE: Record<FlavorMemoryActivityEntry['type'], string> = {
  quiz: 'Quiz',
  ordered: 'Ordered',
  saved: 'Saved',
  recipe: 'Recipe',
};

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function substance(entry: FlavorMemoryActivityEntry): string {
  switch (entry.type) {
    case 'quiz':
      return entry.trigger === 'first_quiz'
        ? `Your palate read as ${entry.archetypeLabel}`
        : (entry.archetypeLabel ?? '');
    case 'saved':
      return entry.coffeeName
        ? `${entry.coffeeName} · ${entry.archetypeLabel} dial`
        : `Position ${entry.dialSortOrder} on the ${entry.archetypeLabel} dial`;
    case 'ordered':
      return entry.coffeeName ?? '';
    case 'recipe':
      return entry.title ?? 'Recipe';
  }
}

/** Profile Part 7 Task 4 — activity log, supersedes PalateTimeline. Same side-
 * column position and quiet register, now covering every deliberate moment
 * (quiz, order, save, accepted Liam recipe) instead of quiz history alone.
 * `entries` already arrive newest-first from the API (Task 3 sorts server-side)
 * — unlike PalateTimeline's journey prop, no client-side reverse needed. */
export default function ActivityTimeline({ entries, retakeCopy, onRemoved }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedRecipeId, setExpandedRecipeId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const hasMore = entries.length > COLLAPSED_COUNT;
  const visibleEntries = expanded ? entries : entries.slice(0, COLLAPSED_COUNT);
  const readingLine = deriveReadingLine(entries);

  async function handleRemove(entry: FlavorMemoryActivityEntry) {
    setRemovingId(entry.id);
    try {
      await removeFlavorMemoryEntry(entry.type === 'recipe' ? 'recipe' : 'saved', entry.id);
      onRemoved();
    } catch (err) {
      // Not fake success — onRemoved() above is inside the try, so it never
      // fires unless removeFlavorMemoryEntry actually succeeded. Previously
      // just reset the spinner with no explanation of why nothing changed.
      reportError('[ActivityTimeline/remove]', err);
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {readingLine && (
        <p className="text-sm text-[#a33726]/70 italic leading-relaxed">{readingLine}</p>
      )}
      <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40">Flavor activity</p>
      <div className="flex flex-col gap-5">
        {visibleEntries.map(entry => (
          <div key={entry.id} className="group flex items-start gap-3">
            <span
              className="w-2 h-2 rounded-full mt-1.5 shrink-0"
              style={{
                backgroundColor: entry.archetype ? (ARCHETYPE_COLOR[entry.archetype] ?? '#a33726') : '#a33726',
                opacity: entry.archetype ? 1 : 0.25,
              }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.15em] text-[#a33726]/40 mb-0.5">
                {shortDate(entry.at)} · {TYPE_BADGE[entry.type]}
              </p>
              {entry.type === 'recipe' ? (
                <button
                  type="button"
                  onClick={() => setExpandedRecipeId(v => (v === entry.id ? null : entry.id))}
                  className="text-sm text-[#a33726] text-left hover:underline"
                >
                  {substance(entry)}
                </button>
              ) : (
                <p className="text-sm text-[#a33726]">{substance(entry)}</p>
              )}
              {entry.type === 'recipe' && expandedRecipeId === entry.id && entry.body && (
                <p className="text-xs text-[#a33726]/70 mt-1.5 leading-relaxed whitespace-pre-wrap">
                  {entry.body}
                </p>
              )}
            </div>
            {entry.removable && (
              <button
                type="button"
                onClick={() => handleRemove(entry)}
                disabled={removingId === entry.id}
                className="text-[9px] uppercase tracking-[0.15em] text-[#a33726]/30 hover:text-[#a33726] transition-opacity shrink-0 mt-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 disabled:opacity-50"
              >
                Remove
              </button>
            )}
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
