# Image performance — findings + recommended fix (deferred, not yet scheduled)

Found while investigating page-load performance for The Bloom, but this applies site-wide, not just to that page. Not being acted on now — Dana asked to defer this and just keep the context written down.

## The question that started this

Dana asked whether serving photography and other assets from the frontend (rather than a backend/CDN system) creates a performance problem for a site serving customers across the entire US.

## What's actually true

**Good news: you don't need to set up a separate CDN.** `firebase.json` shows this site deploys to Firebase Hosting, which is already backed by Google's global CDN. That's automatic — a visitor in Seattle and one in Miami both get static files from a nearby edge location, not from one origin server in `us-central1`. "Everything is in the frontend" does not mean everything is served from one slow, distant place. No GCP Cloud CDN / Cloud Storage work is needed to solve *that* problem, because it isn't actually a problem.

**Real problem found: the images themselves are enormous.** Checked actual file sizes in `frontend/src/design/IMAGES/`:

- Hero photography (`photos/june2026/*.png`): **5.1–5.7 MB per file**. A well-optimized web photo is typically 150–400 KB — these are roughly 15–20x larger than they need to be.
- Bag art (`bags/new bags mock up/*.png`): ~1.0–1.3 MB per file — also oversized for what are mostly flat-color product renders with transparency.
- The whole `design/IMAGES` folder is **~1 GB** across 106 PNGs, 11 JPGs, 8 SVGs, 5 MP4s.

The root cause is format, not hosting: these are raw PNG exports. PNG is a lossless format meant for graphics, logos, and screenshots — using it for photography is almost always why files end up this large. A photo saved as compressed JPEG or WebP at the same visual quality would be a fraction of the size.

**Secondary finding: caching is only configured for some file types.** `firebase.json`'s `headers` block sets long-term immutable caching (`max-age=31536000, immutable`) only for `**/*.@(js|css|woff2)`. Images aren't covered, so even repeat visitors may be re-downloading these large files instead of getting them from browser cache.

## Recommended fix, when this gets picked up

1. **Convert hero/bag photography to compressed JPEG or WebP.** Should take files from ~5 MB down to a few hundred KB with no visible quality loss at the size these are actually displayed on screen.
2. **Generate a smaller version for mobile viewports** (responsive images / `srcset`) so mobile users aren't downloading desktop-resolution files.
3. **Extend the Firebase Hosting cache-control headers to cover images** (`png|jpg|jpeg|webp|svg`), same immutable long-cache treatment already given to JS/CSS/fonts — safe to do since these are typically served with content-hashed filenames from a Vite build.

## Scope note

This touches images used across `Home.tsx`, `Shop.tsx`, `TasteFinderSection.tsx`, `FlavorQuiz.tsx`'s result screen, and likely others — not just The Bloom. When this is ready to build, it should be its own Claude Code prompt, not folded into a feature-specific one, since it's a cross-cutting asset-pipeline change rather than a single page's concern.
