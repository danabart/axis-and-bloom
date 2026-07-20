# Site Readiness (workstream: site-readiness)

Two standalone fixes that make the site ready to receive paid mobile traffic. Not part of
the numbered 01–11 launch sequence — they have no dependencies on it and can run **any
time from today**; both should be live before the ad warm-up (~Aug 3). Instagram/Facebook
ad traffic is overwhelmingly mobile, and today the site has no mobile navigation and a
~120MB homepage.

**Execution order (decided 2026-07-18): FIX-01 → IMG → FIX-02.** The pipeline migration
owns all image optimization; FIX-02 was re-scoped to the remainder (video + in-code
loading behavior). All three before the ~Aug 3 ad warm-up.

| Order | Fix | File | What | Model | Status |
|---|---|---|---|---|---|
| 1 | FIX-01 | `FIX-01_mobile_nav_menu.md` | Mobile navigation menu (nav links are `hidden md:flex` with no fallback) | Sonnet | ✅ done 2026-07-19 (see note below) |
| 2 | IMG | `backend/src/features/image_pipeline/CLAUDE_CODE_PROMPT_IMAGE_PIPELINE.md` (pre-existing, written 2026-07-12) | **The across-the-board image strategy**: GCS bucket + semantic asset registry + auto-optimization Cloud Function; migrates all 82 image import sites across 8 files (Shop.tsx excluded — retiring). Also Camila's workflow fix: she adds/swaps photos by uploading to the bucket — auto-optimized, no code change, no deploy | per that prompt | ✅ done 2026-07-19/20 — see `backend/src/features/image_pipeline/GCS_BUCKET_AND_TECH_REFERENCE.md` |
| 3 | FIX-02 | `FIX-02_homepage_media_weight.md` | Video compression + posters + lazy-loading/dimensions in code (what the pipeline doesn't cover) — re-scoped 2026-07-18 | Sonnet | ✅ done 2026-07-20 (see note below) |

## Run commands

**FIX-01** — model: Sonnet — one session
```
Read launch/README.md for context and rules, then execute the prompt in launch/05_site-readiness/FIX-01_mobile_nav_menu.md exactly as written. Do only this fix. When done, show me how each ACCEPTANCE criterion is met.
```

**IMG (the pipeline)** — model: per its prompt — one session, after FIX-01
```
Read launch/README.md for context and rules, then execute the prompt in backend/src/features/image_pipeline/CLAUDE_CODE_PROMPT_IMAGE_PIPELINE.md exactly as written. Do only this task. When done, show me how each acceptance criterion is met, and give me the exact steps Camila follows to add or replace a photo going forward.
```

**FIX-02** — model: Sonnet — one session, after IMG
```
Read launch/README.md for context and rules, then execute the prompt in launch/05_site-readiness/FIX-02_homepage_media_weight.md exactly as written. Do only this fix. When done, show me how each ACCEPTANCE criterion is met, including before/after page-weight numbers.
```

## Post-deploy verification

**FIX-01** — done 2026-07-19, commit `ed68e65`, see `WHAT_WE_BUILT.md` #105 for full detail.
- [x] Quiz layout (which hides public nav) unaffected — confirmed structurally: `/find-my-flavor` and `/admin` render outside `PublicLayout` in `App.tsx`, `Navigation` never mounts there.
- [x] Escape/focus-trap/scroll-lock/focus-return added and functionally exercised via direct DOM/JS against the running dev server (open/close, `aria-expanded`, scroll lock, Escape-close, link-tap-close all confirmed).
- [ ] **Not yet done — needs a human pass**: on a real phone (or a real, OS-focused desktop browser at a narrow width) — this session's browser-automation sandbox had no real window focus (`document.hasFocus()` was `false`, window resize was a no-op), so the actual mobile-width rendering and the Tab focus-trap/focus-return were code-reviewed but never visually observed. Please spot-check before/instead of relying solely on this.
- [ ] Desktop nav unchanged pixel-for-pixel — diff is additive-only (refs, one effect, aria attributes; no className/style changes), but not screenshotted side-by-side.
- [ ] Standing trio (`../REGRESSION.md`) — not run this session.

**IMG (pipeline)** — per that prompt's own acceptance criteria, plus:
- [ ] Camila's add-a-photo workflow is written down (bucket upload → auto-optimize → live, no deploy)
- [ ] Spot-check: previously-heavy images now served optimized from the bucket
- [ ] Standing trio (`../REGRESSION.md`)

**FIX-02** — done 2026-07-20, see `WHAT_WE_BUILT.md` #107 for full detail.
- [x] Homepage transfer size on first load: measured ~2.4MB (down from ~120MB) via `performance.getEntriesByType('resource')` against a real `vite preview` (production build) load — target was <10MB. Full-scroll worst case (both videos fully played) still ≈8.5MB.
- [x] Hero video: compressed 42.45MB→5.41MB (1080p H.264, ~2.4Mbps), poster added (extracted via `ffmpeg`, shows instantly on load, confirmed by screenshot), `preload="metadata"` kept.
- [x] Below-the-fold images: `loading="lazy"` added to all (§4 archetype cards, §5 photo essay). Below-the-fold video (§6 Liam): compressed 4.43MB→0.76MB, poster added, `preload="none"` — but also had to **remove the native `autoPlay` attribute**, which was forcing an eager fetch regardless of `preload="none"`; the file's existing IntersectionObserver already calls `.play()` on scroll-into-view, so playback behavior is unchanged, only the eager-load bug is fixed. Confirmed via a clean network capture: the placeholder video no longer appears in the initial request list.
- [ ] **Partial**: Chrome's own lazy-load lookahead distance still prefetched the §4/§5 images somewhat ahead of actual scroll in this test (short page, compact sections) — `loading="lazy"` is correctly applied at the code level (verified via DOM `img.loading === 'lazy'`), but the literal "nothing below the fold downloads at page open" isn't observed in this specific viewport. Impact is much smaller now regardless — these are ~80–300KB mobile-optimized WebP images, not the original multi-MB files.
- [x] Visual appearance: poster frames screenshot-verified (real coffee/portafilter shots, not black frames); the §4/§5 images that switched to `mobileSrc`/`srcSet` are display-scale-appropriate (verified by comparing rendered card width against the 800px mobile-variant cap before making the change, not just assumed).
- [x] Lifecycle sections + Company Gift widget: confirmed untouched via `git diff` — every change is a media attribute/source swap, zero lines touched in `renderSignedInCTA`/`renderStageCTA` or the Company Gift section.
- [ ] Standing trio (`../REGRESSION.md`) — not run this session.
- **Not in scope, flagged as follow-ups**: `TasteFinderSection.tsx`'s pattern backgrounds (~400KB, embedded in Home via `<TasteFinderSection />` but not one of this fix's two named files) and `NewsletterModal.tsx`'s image (triggers on scroll/timer globally, same reason) both still load eagerly — neither was in FIX-02's stated file scope (`Home.tsx` and `PreLaunch.tsx` only).
- **PreLaunch.tsx**: audited, no changes needed — it's a fixed full-screen layout with one always-visible image and no scroll, so there's no "below the fold" to lazy-load.
