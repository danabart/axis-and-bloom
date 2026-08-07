import type { DimensionRow } from './DimensionBars';
import { ARCHETYPE_LABEL, ARCHETYPE_COLOR } from './archetypeConstants';
import { useArchetypeAdjacency } from './archetypeAdjacency';
import { useArchetypeVectors } from './archetypeVectors';

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

export function getDimensionComparison(
  dimensions: DimensionRow[],
  userArchetype: string,
  typicalByArchetype: Record<string, Partial<Record<string, [number, number]>>>
): string {
  const typical = typicalByArchetype[userArchetype];
  if (!typical) return '';
  const archetypeLabel = ARCHETYPE_LABEL[userArchetype] ?? userArchetype;

  const divergences: { dim: string; delta: number; dir: string }[] = [];
  for (const row of dimensions) {
    const range = typical[row.dimension];
    if (!range) continue;
    const coffeeMid = (Number(row.avg_min) + Number(row.avg_max)) / 2;
    const typicalMid = (range[0] + range[1]) / 2;
    const delta = coffeeMid - typicalMid;
    if (Math.abs(delta) < 1.5) continue;
    const dir = delta > 4 ? 'significantly more' : delta > 1.5 ? 'slightly more'
              : delta < -4 ? 'significantly less' : 'slightly less';
    divergences.push({ dim: row.dimension.toLowerCase(), delta: Math.abs(delta), dir });
  }

  if (!divergences.length) {
    return `This coffee's profile sits close to your usual ${archetypeLabel} preference.`;
  }
  divergences.sort((a, b) => b.delta - a.delta);
  const top = divergences.slice(0, 2);
  if (top.length === 1) {
    return `This coffee has ${top[0].dir} ${top[0].dim} than your typical ${archetypeLabel} profile.`;
  }
  return `This coffee has ${top[0].dir} ${top[0].dim} and ${top[1].dir} ${top[1].dim} than your usual ${archetypeLabel} profile.`;
}

/**
 * Compatibility badge level + dimension-divergence copy for a coffee, given the
 * signed-in user's archetype. Both the adjacency ("Worth exploring" tier) and the
 * dimension target ranges are real, live data — see archetypeAdjacency.ts
 * (v_archetype_adjacency, the same hop-derived view the Bloom Dial admin page
 * shows) and archetypeVectors.ts (v_archetype_vectors, the calibrated targets
 * The Axis page already uses) — not hardcoded tables.
 */
export function useCompatibility(coffeeArchetype: string | null, userArchetype: string | null, dimensions: DimensionRow[]) {
  const adjacency = useArchetypeAdjacency();
  const vectors = useArchetypeVectors();
  const compat = getCompatibility(coffeeArchetype, userArchetype, adjacency);
  const dimCompText = (compat && userArchetype && dimensions.length)
    ? getDimensionComparison(dimensions, userArchetype, vectors) : null;
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
