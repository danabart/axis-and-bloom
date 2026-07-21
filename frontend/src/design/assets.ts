// Single source of truth for bucket-hosted design assets (gs://axis-bloom-assets).
// Every component should import from here instead of raw file imports —
// replacing a bucket object (Camila's workflow) needs no code change or deploy.
// See backend/src/features/image_pipeline/ for the migration this came from.

const BUCKET_BASE = 'https://storage.googleapis.com/axis-bloom-assets';

function optimized(path: string) {
  return {
    src: `${BUCKET_BASE}/optimized/${path}.webp`,
    mobileSrc: `${BUCKET_BASE}/optimized/${path}-mobile.webp`,
  };
}

function raw(path: string) {
  return `${BUCKET_BASE}/raw/${path}`;
}

type OptimizedAsset = ReturnType<typeof optimized>;

export const ARCHETYPE_SLUGS = [
  'floral', 'fruity', 'balanced-sweet', 'chocolate-nutty', 'spicy-earthy', 'experimental',
] as const;
export type ArchetypeSlug = typeof ARCHETYPE_SLUGS[number];

export const archetypeAssets: Record<ArchetypeSlug, {
  hero: OptimizedAsset;
  sm1: OptimizedAsset;
  sm2: OptimizedAsset;
  bag: OptimizedAsset;
  wallpaper: OptimizedAsset;
}> = {
  floral: {
    hero: optimized('archetypes/floral/hero'),
    sm1: optimized('archetypes/floral/sm1'),
    sm2: optimized('archetypes/floral/sm2'),
    bag: optimized('archetypes/floral/bag'),
    wallpaper: optimized('archetypes/floral/wallpaper'),
  },
  fruity: {
    hero: optimized('archetypes/fruity/hero'),
    sm1: optimized('archetypes/fruity/sm1'),
    sm2: optimized('archetypes/fruity/sm2'),
    bag: optimized('archetypes/fruity/bag'),
    wallpaper: optimized('archetypes/fruity/wallpaper'),
  },
  'balanced-sweet': {
    hero: optimized('archetypes/balanced-sweet/hero'),
    sm1: optimized('archetypes/balanced-sweet/sm1'),
    sm2: optimized('archetypes/balanced-sweet/sm2'),
    bag: optimized('archetypes/balanced-sweet/bag'),
    wallpaper: optimized('archetypes/balanced-sweet/wallpaper'),
  },
  'chocolate-nutty': {
    hero: optimized('archetypes/chocolate-nutty/hero'),
    sm1: optimized('archetypes/chocolate-nutty/sm1'),
    sm2: optimized('archetypes/chocolate-nutty/sm2'),
    bag: optimized('archetypes/chocolate-nutty/bag'),
    wallpaper: optimized('archetypes/chocolate-nutty/wallpaper'),
  },
  'spicy-earthy': {
    hero: optimized('archetypes/spicy-earthy/hero'),
    sm1: optimized('archetypes/spicy-earthy/sm1'),
    sm2: optimized('archetypes/spicy-earthy/sm2'),
    bag: optimized('archetypes/spicy-earthy/bag'),
    wallpaper: optimized('archetypes/spicy-earthy/wallpaper'),
  },
  experimental: {
    hero: optimized('archetypes/experimental/hero'),
    sm1: optimized('archetypes/experimental/sm1'),
    sm2: optimized('archetypes/experimental/sm2'),
    bag: optimized('archetypes/experimental/bag'),
    wallpaper: optimized('archetypes/experimental/wallpaper'),
  },
};

// Home's own per-archetype photo (2026-07 "scan" shoot) — deliberately distinct from
// archetypeAssets[x].hero, which The Bloom/Shop use. Not a consolidation candidate:
// this is current, actively-chosen homepage photography, not a leftover duplicate.
export const homeAssets = {
  scan: {
    floral: optimized('home/scan-floral'),
    fruity: optimized('home/scan-fruity'),
    'balanced-sweet': optimized('home/scan-balanced-sweet'),
    'chocolate-nutty': optimized('home/scan-chocolate-nutty'),
    'spicy-earthy': optimized('home/scan-spicy-earthy'),
    experimental: optimized('home/scan-experimental'),
  } as Record<ArchetypeSlug, OptimizedAsset>,
  photoEssay1: optimized('home/photo-essay-1'),
  photoEssay2: optimized('home/photo-essay-2'),
  photoEssay3: optimized('home/photo-essay-3'),
};

// FlavorQuiz's question photography + its one large lifestyle shot.
export const quizAssets = {
  pic1: optimized('quiz/pic-1'),
  pic2: optimized('quiz/pic-2'),
  pic3: optimized('quiz/pic-3'),
  pic4: optimized('quiz/pic-4'),
  pic5: optimized('quiz/pic-5'),
  pic6: optimized('quiz/pic-6'),
  coffeeLarge: optimized('quiz/coffee-large'),
};

// Per-archetype card images (WEB* set) — used in the quiz wrap reveal.
// Upload paths: raw/archetypes/web-{slug}.png for each (e.g. raw/archetypes/web-floral.png).
export const cardAssets: Record<ArchetypeSlug, OptimizedAsset> = {
  floral:           optimized('archetypes/web-floral'),
  fruity:           optimized('archetypes/web-fruity'),
  'balanced-sweet': optimized('archetypes/web-balanced-sweet'),
  'chocolate-nutty':optimized('archetypes/web-chocolate-nutty'),
  'spicy-earthy':   optimized('archetypes/web-spicy-earthy'),
  experimental:     optimized('archetypes/web-experimental'),
};

// Small per-archetype background patterns — shared by FlavorQuiz and TasteFinderSection.
export const patternAssets: Record<ArchetypeSlug, OptimizedAsset> = {
  floral: optimized('patterns/floral'),
  fruity: optimized('patterns/fruity'),
  'balanced-sweet': optimized('patterns/balanced-sweet'),
  'chocolate-nutty': optimized('patterns/chocolate-nutty'),
  'spicy-earthy': optimized('patterns/spicy-earthy'),
  experimental: optimized('patterns/experimental'),
};

export const lifestyleAssets = {
  family: optimized('lifestyle/family'),
  coffee15: optimized('lifestyle/coffee-15'),
  coffee15Vertical: optimized('lifestyle/coffee-15-vertical'),
};

// Only the 2 logo files actually referenced anywhere in the app today
// (LogoCircle/LogoQuarter2-4 have no current import — left unmigrated, same as
// any other unused design asset).
export const brandAssets = {
  logoQuarter1: raw('brand/logo-quarter-1.svg'),
  logoLines: raw('brand/logo-lines.svg'),
};

export const videoAssets = {
  aboutHero: raw('video/about-hero.mp4'),
  aboutSecondary: raw('video/about-secondary.mp4'),
  homePlaceholder: raw('video/home-placeholder.mp4'),
  homePlaceholderPoster: optimized('video/home-placeholder-poster'),
  homeHero: raw('video/home-hero.mp4'),
  homeHeroPoster: optimized('video/home-hero-poster'),
};
