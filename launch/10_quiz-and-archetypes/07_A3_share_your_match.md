# Step 07 (A3) — Share-your-match card

> Global step 07 of 11 · Workstream: quiz-and-archetypes · Model: Sonnet · Depends on: Steps 01 + 04 · Target: early September.

CONTEXT: Axis & Bloom quiz results screen (post soft-gate). Marketing wants every result shareable: archetype results are identity content. 5-archetype canon; each archetype has a color/wallpaper/bag visual.

TASK:

1. Per-archetype share page (e.g. /match/<archetype-slug>) — public, no personal data — rendering the archetype visual + one-line description + "Find your flavor" CTA into the quiz. Full OG/Twitter meta tags with a pre-rendered per-archetype OG image (1200x630) so shared links unfurl beautifully. Static per-archetype images are fine (5 of them) — no dynamic image generation service needed.
2. On the results screen: a one-tap share row (native share API on mobile, copy-link fallback) sharing the archetype page URL. Fire a 'share_match' analytics event.
3. SPA caveat: ensure OG tags for these 5 routes are served to crawlers (prerender the 5 static pages at build time, or host them as static files — simplest correct approach wins).

CONSTRAINTS: share page + share row components follow the existing frontend structure (frontend/src/app/components); no personal data in shared URLs; reuse archetype assets; match brand visuals exactly.

ACCEPTANCE: pasting a share link into WhatsApp/iMessage/Slack previews the archetype card; share button works on mobile + desktop.
