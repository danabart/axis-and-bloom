import { useEffect, useState } from 'react';
import { ARCHETYPE_LABEL, ARCHETYPE_COLOR } from './archetypeConstants';
import { useArchetypeAdjacency } from './archetypeAdjacency';
import { reportError } from '../../lib/errorReporter';

export { ARCHETYPE_LABEL, ARCHETYPE_COLOR };

export type CompatLevel = 'wheelhouse' | 'exploring' | 'stretch';

// Part 13/15 — the one pill styling for CompatibilityBadge, shared by both variants
// (Part 15 folded 'default' onto this exact palette so the badge never renders two
// different ways on the site).
const BADGE_CONFIG: Record<CompatLevel, { label: string; bg: string; text: string; border: string }> = {
  wheelhouse: { label: 'In your wheelhouse', bg: '#9a2918', text: '#fff', border: 'transparent' },
  exploring: { label: 'Worth exploring', bg: 'transparent', text: '#9a2918', border: '#9a2918' },
  stretch: { label: 'Outside your comfort zone', bg: 'transparent', text: '#45474a', border: '#7b7f80' },
};
const BADGE_PILL_CLASS = 'self-start text-[10.5px] uppercase tracking-[.16em] px-4 py-[7px] rounded-full border font-normal whitespace-nowrap';

export function getCompatibility(
  coffeeArchetype: string | null,
  userArchetype: string | null,
  adjacency: Record<string, string[]>
): CompatLevel | null {
  if (!coffeeArchetype || !userArchetype) return null;
  if (coffeeArchetype === userArchetype) return 'wheelhouse';
  if (adjacency[userArchetype]?.includes(coffeeArchetype)) return 'exploring';
  return 'stretch';
}

/**
 * Compatibility badge level + dimension-divergence copy for a coffee, given the
 * signed-in user's archetype. The badge level reads the real adjacency
 * (archetypeAdjacency.ts, v_coffee_archetype_adjacency). Coffee presentation
 * brief 2 (2026-10-24): the sentence comes from the backend
 * (GET /api/coffees/:id/compatibility), which compares the coffee to the
 * user's archetype's actual coffees and decides the reference itself; null
 * (too few reference coffees, or no coffee id) renders nothing, so the verdict
 * row shows the badge alone. Pass a null coffeeId to skip the sentence.
 */
export function useCompatibility(coffeeArchetype: string | null, userArchetype: string | null, coffeeId: number | null) {
  const adjacency = useArchetypeAdjacency();
  const compat = getCompatibility(coffeeArchetype, userArchetype, adjacency);
  const [dimCompText, setDimCompText] = useState<string | null>(null);
  const wanted = !!(compat && userArchetype && coffeeId);
  useEffect(() => {
    setDimCompText(null);
    if (!wanted) return;
    let alive = true;
    fetch(`/api/coffees/${coffeeId}/compatibility?userArchetype=${encodeURIComponent(userArchetype!)}`)
      .then(r => r.json())
      .then((data: { sentence?: string | null }) => { if (alive) setDimCompText(data.sentence ?? null); })
      .catch(err => reportError('[useCompatibility/compatibility]', err));
    return () => { alive = false; };
  }, [wanted, coffeeId, userArchetype]);
  return { compat, dimCompText };
}

/**
 * Part 13 (reveal-panel redesign) — `variant` is additive. `variant='reveal'` is
 * RevealedPanel's Row 1: just the pill, no apology paragraph on 'stretch' (Dana's
 * "transparent, not apologetic" call). `variant='default'` (Flavor Intelligence,
 * Part 15) is a reskin of the same pill — Part 15 folded its colors/shape onto the
 * 'reveal' styling so the badge never renders two different ways on the site — plus
 * the stretch-tier apology sentence, which is content, not styling, so it stays
 * (restyled, not deleted, unlike 'reveal').
 */
export function CompatibilityBadge({ level, userArchetype, variant = 'default' }: { level: CompatLevel; userArchetype: string; variant?: 'default' | 'reveal' }) {
  const c = BADGE_CONFIG[level];
  const pill = (
    <span className={BADGE_PILL_CLASS} style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}>
      {c.label}
    </span>
  );

  if (variant === 'reveal') return pill;

  return (
    <div className="flex flex-col gap-1.5">
      {pill}
      {level === 'stretch' && (
        <p className="text-xs font-light" style={{ color: '#7b7f80' }}>
          This is a stretch from your usual {ARCHETYPE_LABEL[userArchetype]} profile — but that's not a bad thing.
        </p>
      )}
    </div>
  );
}
