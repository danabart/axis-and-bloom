import type { DimensionRow } from './DimensionBars';

export const ARCHETYPE_LABEL: Record<string, string> = {
  chocolate_nutty: 'Chocolate & Nutty',
  balanced_sweet:  'Balanced & Sweet',
  fruity:          'Fruity',
  earthy:          'Earthy',
  floral:          'Floral',
  experimental:    'Experimental',
};

export const ARCHETYPE_COLOR: Record<string, string> = {
  chocolate_nutty: '#a54c2d',
  balanced_sweet:  '#c9a830',
  fruity:          '#ca445f',
  earthy:          '#7a6a4f',
  floral:          '#8a7cbe',
  experimental:    '#4a8a6e',
};

// Adjacent archetypes — used for "Worth exploring" compatibility tier
const ARCHETYPE_ADJACENT: Record<string, string[]> = {
  chocolate_nutty: ['balanced_sweet', 'earthy'],
  balanced_sweet:  ['chocolate_nutty', 'fruity'],
  fruity:          ['balanced_sweet', 'floral', 'experimental'],
  earthy:          ['chocolate_nutty'],
  floral:          ['fruity', 'experimental'],
  experimental:    ['fruity', 'floral'],
};

// Typical cupping score mid-points per archetype (0–15 scale) for dim comparison
const ARCHETYPE_TYPICAL: Record<string, Partial<Record<string, [number, number]>>> = {
  chocolate_nutty: { Sweetness: [5, 8],  Acidity: [2, 5],  Bitterness: [7, 11], Body: [8, 12] },
  balanced_sweet:  { Sweetness: [7, 10], Acidity: [4, 7],  Bitterness: [3, 6],  Body: [5, 8]  },
  fruity:          { Sweetness: [6, 9],  Acidity: [8, 12], Bitterness: [0, 3],  Body: [2, 5]  },
  earthy:          { Sweetness: [3, 6],  Acidity: [2, 5],  Bitterness: [6, 10], Body: [9, 13] },
  floral:          { Sweetness: [6, 9],  Acidity: [7, 11], Bitterness: [0, 3],  Body: [2, 5]  },
  experimental:    { Sweetness: [5, 9],  Acidity: [7, 12], Bitterness: [2, 6],  Body: [4, 8]  },
};

export type CompatLevel = 'wheelhouse' | 'exploring' | 'stretch';

export function getCompatibility(coffeeArchetype: string | null, userArchetype: string | null): CompatLevel | null {
  if (!coffeeArchetype || !userArchetype) return null;
  if (coffeeArchetype === userArchetype) return 'wheelhouse';
  if (ARCHETYPE_ADJACENT[userArchetype]?.includes(coffeeArchetype)) return 'exploring';
  return 'stretch';
}

export function getDimensionComparison(dimensions: DimensionRow[], userArchetype: string): string {
  const typical = ARCHETYPE_TYPICAL[userArchetype];
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

/** Compatibility badge level + dimension-divergence copy for a coffee, given the signed-in user's archetype. */
export function useCompatibility(coffeeArchetype: string | null, userArchetype: string | null, dimensions: DimensionRow[]) {
  const compat = getCompatibility(coffeeArchetype, userArchetype);
  const dimCompText = (compat && userArchetype && dimensions.length)
    ? getDimensionComparison(dimensions, userArchetype) : null;
  return { compat, dimCompText };
}

export function CompatibilityBadge({ level, userArchetype }: { level: CompatLevel; userArchetype: string }) {
  const configs = {
    wheelhouse: {
      label: 'In your wheelhouse',
      bg: '#a33726', text: '#fff', border: 'transparent',
    },
    exploring: {
      label: 'Worth exploring',
      bg: 'transparent', text: '#b07d1a', border: '#b07d1a',
    },
    stretch: {
      label: 'Outside your comfort zone',
      bg: 'transparent', text: '#8a8070', border: '#c8c0b4',
    },
  };
  const c = configs[level];
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="self-start text-xs px-3 py-1 rounded-full border font-normal tracking-wide"
        style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
      >
        {c.label}
      </span>
      {level === 'stretch' && (
        <p className="text-xs font-light" style={{ color: '#a09880' }}>
          This is a stretch from your usual {ARCHETYPE_LABEL[userArchetype]} profile — but that's not a bad thing.
        </p>
      )}
    </div>
  );
}
