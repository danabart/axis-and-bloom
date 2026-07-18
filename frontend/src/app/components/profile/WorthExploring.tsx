import { Link } from 'react-router';
import { ARCHETYPE_COLOR } from '../coffee-info/archetypeConstants';
import { computeDefaultSortOrder } from '../bloom/ArchetypeSection';
import type { ArchetypeData } from '../bloom/types';

interface Props {
  matchArchetypeId: string;
  adjacency: Record<string, string[]>;
  archetypesList: ArchetypeData[];
}

/** "Worth exploring" — Horizon layer (Profile Part 3 §1), directly under
 * ArchetypeSection. Adjacency currently has authored data for only some pairs
 * (v_archetype_adjacency), so an archetype with none simply renders nothing —
 * no placeholder row. No compatibility badges here; the chip itself already
 * means "worth exploring." */
export default function WorthExploring({ matchArchetypeId, adjacency, archetypesList }: Props) {
  const chips = (adjacency[matchArchetypeId] ?? [])
    .map(id => archetypesList.find(a => a.archetype === id))
    .filter((a): a is ArchetypeData => !!a)
    .slice(0, 2);

  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40">Worth exploring</p>
      {chips.map(a => {
        const slot = a.slots.length ? computeDefaultSortOrder(a) : null;
        const href = slot != null
          ? `/flavor-intelligence?archetype=${a.archetype}&slot=${slot}`
          : `/flavor-intelligence?archetype=${a.archetype}`;
        return (
          <Link
            key={a.archetype}
            to={href}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border transition-colors hover:border-[#a33726]/40"
            style={{ borderColor: 'rgba(163,55,38,0.2)', color: '#a33726' }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ARCHETYPE_COLOR[a.archetype] ?? '#a33726' }} />
            {a.archetypeLabel}
          </Link>
        );
      })}
    </div>
  );
}
