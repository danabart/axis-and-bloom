// Bloom Dial config — data-driven per archetype (brief 33 §2), built on the Bloom
// page from live catalogue data. Coffee names/prices come from the API where a real
// coffee is resolved for a slot; empty slots fall back to the approved placeholder
// names below (Camila's call: fill every dial position for now, no DB writes — the
// dial always shows four coffees). No names are invented in code beyond these
// approved placeholders from mockup 32 v8 / brief 33.

import type { ArchetypeData, DoorTarget } from '../types';
import { ARCHETYPE_VISUALS } from '../bloomVisuals';

export interface DialCoffee {
  dialSortOrder: number;      // 1..4
  name: string;
  price12Cents: number;
  price5Cents: number;
  coffeeId: number | null;    // real coffee id when resolved, else null
  /** Part 16 §B — which position is the archetype's default slot (Slot.isDefault),
   * used to compute the dial's stop layout (default anchors at visual center). */
  isDefault: boolean;
  /** Part 18 §A — the position's own generic label (dial_position_vocabulary.label,
   * e.g. "Lighter"/"Classic"/"Richer"/"Full"), always present regardless of whether
   * a real coffee is resolved for this slot — used as the destination name in the
   * dial's step chips ("Less {dimension} → {positionLabel}"), same convention the
   * Part 16/17 hop chips used for their own target label. */
  positionLabel: string;
}

export interface DialConfig {
  archetype: string;          // API enum, e.g. 'chocolate_nutty'
  archetypeLabel: string;
  no: string;                 // '01'..'06'
  nameLines: string[];        // fills column width per line
  color: string;              // archetype hex
  ftext: string;              // field text colour (ink on mustard, beige elsewhere)
  bag: string;                // asset-helper URL (archetypeAssets[slug].bag)
  coffees: DialCoffee[];      // exactly 4, ordered by dialSortOrder
  /** Part 14 — dial dimension's scale end labels, for the ruler ends. Null when the
   * archetype has no dial dimension configured; BloomDial falls back to
   * Delicate/Pronounced in that case. */
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
  /** Part 18 §A — the dial dimension's own display name (e.g. "Brightness",
   * "Body"), for the step chips' "Less/More {dimension} → ..." sentence.
   * dimensionPlatformName preferred (the consumer-facing word), falling back to
   * the raw dimensionName — same preference order the old hop-chip copy used
   * (Part 16's own `dimensionName uses COALESCE(platform_name, name)` note).
   * Null only if the archetype has no dial dimension configured at all (Part 14's
   * audit found zero such gaps across all 6 archetypes, but the type stays
   * honest about it being possible). */
  dimensionName: string | null;
  /** Part 19 §A — this archetype's two edge-door targets, resolved server-side.
   * Null only if the API's door map failed to resolve (shouldn't happen). */
  doors: { left: DoorTarget; right: DoorTarget } | null;
}

// Title stack line breaks (brief 33 §2).
const NAME_LINES: Record<string, string[]> = {
  floral:          ['FLORAL'],
  fruity:          ['FRUITY'],
  balanced_sweet:  ['BALANCED', '& SWEET'],
  chocolate_nutty: ['CHOCOLATE', '& NUTTY'],
  earthy:          ['EARTHY'],
  experimental:    ['EXPERIMENTAL'],
};

// Approved placeholder coffee names (mockup 32 v8), used only where the live
// catalogue has no resolved coffee for a slot. Chocolate & Nutty's four are the
// brief's confirmed set. Indexed by dialSortOrder − 1.
const PLACEHOLDER_COFFEES: Record<string, [string, string, string, string]> = {
  floral:          ['Quiet Garden', 'Jasmim', 'Love Letter', 'Midnight Bloom'],
  fruity:          ['Domingo', 'Bright & Tart', 'Golden Hour', 'Carnival'],
  balanced_sweet:  ['Caseiro', 'Everyday Poem', 'Honeymoon', 'Deep Amber'],
  chocolate_nutty: ['Quieta Non Movere', 'Coado', 'There’s No Place Like Home', 'Working Late Hours'],
  earthy:          ['First Rain', 'Terra', 'Bonfire Stories', 'Night Walk'],
  experimental:    ['Postcard from Nowhere', 'Wild Card', 'Plot Twist', 'Uncharted'],
};

// Standard bag pricing (matches the DB defaults, pricing_update_2026_07_24).
const DEFAULT_PRICE_12 = 3200;
const DEFAULT_PRICE_5LB = 18500;

function priceForWeight(prices: { weightOz: number; retailPriceCents: number }[], weightOz: number, fallback: number): number {
  return prices.find(p => p.weightOz === weightOz)?.retailPriceCents ?? fallback;
}

/** Build a dial config from one archetype's live catalogue data. */
export function buildDialConfig(data: ArchetypeData): DialConfig | null {
  const visual = ARCHETYPE_VISUALS[data.archetype];
  if (!visual) return null;

  const placeholders = PLACEHOLDER_COFFEES[data.archetype] ?? ['Coffee One', 'Coffee Two', 'Coffee Three', 'Coffee Four'];

  const coffees: DialCoffee[] = [1, 2, 3, 4].map((sortOrder, idx) => {
    const slot = data.slots.find(s => s.dialSortOrder === sortOrder);
    const name = slot?.platformName ?? placeholders[idx];
    return {
      dialSortOrder: sortOrder,
      name,
      price12Cents: slot ? priceForWeight(slot.prices, 12, DEFAULT_PRICE_12) : DEFAULT_PRICE_12,
      price5Cents:  slot ? priceForWeight(slot.prices, 80, DEFAULT_PRICE_5LB) : DEFAULT_PRICE_5LB,
      coffeeId: slot?.coffeeId ?? null,
      isDefault: slot?.isDefault ?? false,
      positionLabel: slot?.positionLabel ?? '',
    };
  });

  return {
    archetype: data.archetype,
    archetypeLabel: data.archetypeLabel,
    no: visual.num,
    nameLines: NAME_LINES[data.archetype] ?? [data.archetypeLabel.toUpperCase()],
    color: visual.color,
    // Palette-only field text: terracotta on the mustard Balanced & Sweet field
    // (beige fails contrast on mustard), beige on the five deep fields.
    ftext: data.archetype === 'balanced_sweet' ? '#9a2918' : '#f2f1ea',
    bag: visual.bag,
    coffees,
    scaleMinLabel: data.dimensionScaleMinLabel,
    scaleMaxLabel: data.dimensionScaleMaxLabel,
    dimensionName: data.dimensionPlatformName ?? data.dimensionName,
    doors: data.doors,
  };
}
