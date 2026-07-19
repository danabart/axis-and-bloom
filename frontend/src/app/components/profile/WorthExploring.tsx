import { X } from 'lucide-react';
import { ARCHETYPE_COLOR } from '../coffee-info/archetypeConstants';
import type { ArchetypeData } from '../bloom/types';

interface Props {
  matchArchetypeId: string;
  adjacency: Record<string, string[]>;
  archetypesList: ArchetypeData[];
  /** Currently-expanded adjacent archetype, or null if none. */
  activeArchetype: string | null;
  onSelect: (archetype: string) => void;
}

/** "Worth exploring" — Horizon layer (Profile Part 3 §1), directly under
 * ArchetypeSection. Adjacency currently has authored data for only some pairs
 * (v_archetype_adjacency), so an archetype with none simply renders nothing —
 * no placeholder row. No compatibility badges here; the chip itself already
 * means "worth exploring." */
export default function WorthExploring({ matchArchetypeId, adjacency, archetypesList, activeArchetype, onSelect }: Props) {
  const chips = (adjacency[matchArchetypeId] ?? [])
    .map(id => archetypesList.find(a => a.archetype === id))
    .filter((a): a is ArchetypeData => !!a)
    .slice(0, 2);

  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40">Worth exploring</p>
      {chips.map(a => {
        const isActive = activeArchetype === a.archetype;
        return (
          <button
            key={a.archetype}
            type="button"
            onClick={() => onSelect(a.archetype)}
            aria-pressed={isActive}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border transition-colors hover:border-[#a33726]/40"
            style={{
              borderColor: isActive ? '#ee5974' : 'rgba(163,55,38,0.2)',
              color: isActive ? '#ee5974' : '#a33726',
              backgroundColor: isActive ? 'rgba(238,89,116,0.08)' : 'transparent',
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ARCHETYPE_COLOR[a.archetype] ?? '#a33726' }} />
            {a.archetypeLabel}
            {isActive && <X size={12} />}
          </button>
        );
      })}
    </div>
  );
}
