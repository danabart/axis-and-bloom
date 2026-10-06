// Static brand assets keyed by archetype_enum — same files Shop.tsx uses, unmodified,
// per The Bloom Part 2 spec ("reuse Camila's exact files ... only fix how they're loaded").
// Sourced from the shared bucket registry (image_pipeline migration) instead of raw
// file imports — see ../../../design/assets.ts.
import { archetypeAssets, bloomDialAssets } from '../../../design/assets';

export interface ArchetypeVisual {
  num: string;
  color: string;
  hero: string; sm1: string; sm2: string;
  bag: string;
  /** Roastery portal (2026-10-05) — text tint on a selected family card
   * (Camila's mockup 47 v8), the three-word line under the family name, and
   * the small dial image (bloomDialAssets in design/assets.ts, extracted
   * from the same mockup). None of these existed anywhere else. */
  tint: string;
  tagline: string;
  dial: string;
}

// `num` on each entry below matches Shop.tsx's ARCHETYPES array (01–06) — kept
// identical so customers see the same "which archetype is which number/color"
// mapping across /shop and /bloom. Display ORDER on The Bloom itself is no
// longer read from a hard-coded array here (Bloom Dial Base Data Part 4, §B3) —
// it's computed server-side, personalized per customer; see GET
// /api/coffees/archetype-order.
export const ARCHETYPE_VISUALS: Record<string, ArchetypeVisual> = {
  floral:          { num: '01', color: '#a34b78', hero: archetypeAssets.floral.hero.src,           sm1: archetypeAssets.floral.sm1.src,           sm2: archetypeAssets.floral.sm2.src,           bag: archetypeAssets.floral.bag.src, tint: '#d3acb7', tagline: 'Bright · Fragrant · Delicate', dial: bloomDialAssets.floral },
  fruity:          { num: '02', color: '#ca445f', hero: archetypeAssets.fruity.hero.src,           sm1: archetypeAssets.fruity.sm1.src,           sm2: archetypeAssets.fruity.sm2.src,           bag: archetypeAssets.fruity.bag.src, tint: '#e5b0b4', tagline: 'Lively · Vibrant · Expressive', dial: bloomDialAssets.fruity },
  balanced_sweet:  { num: '03', color: '#d1ac11', hero: archetypeAssets['balanced-sweet'].hero.src, sm1: archetypeAssets['balanced-sweet'].sm1.src, sm2: archetypeAssets['balanced-sweet'].sm2.src, bag: archetypeAssets['balanced-sweet'].bag.src, tint: '#e7d79d', tagline: 'Easy · Smooth · Harmonious', dial: bloomDialAssets.balanced_sweet },
  chocolate_nutty: { num: '04', color: '#a54c2d', hero: archetypeAssets['chocolate-nutty'].hero.src, sm1: archetypeAssets['chocolate-nutty'].sm1.src, sm2: archetypeAssets['chocolate-nutty'].sm2.src, bag: archetypeAssets['chocolate-nutty'].bag.src, tint: '#e1a99c', tagline: 'Full · Grounded · Comforting', dial: bloomDialAssets.chocolate_nutty },
  earthy:          { num: '05', color: '#912f2f', hero: archetypeAssets['spicy-earthy'].hero.src,  sm1: archetypeAssets['spicy-earthy'].sm1.src,  sm2: archetypeAssets['spicy-earthy'].sm2.src,  bag: archetypeAssets['spicy-earthy'].bag.src, tint: '#caa19e', tagline: 'Deep · Bold · Lasting', dial: bloomDialAssets.earthy },
  experimental:    { num: '06', color: '#056c7a', hero: archetypeAssets.experimental.hero.src,      sm1: archetypeAssets.experimental.sm1.src,     sm2: archetypeAssets.experimental.sm2.src,     bag: archetypeAssets.experimental.bag.src, tint: '#88bab9', tagline: 'Wild · Unique · Surprising', dial: bloomDialAssets.experimental },
};
