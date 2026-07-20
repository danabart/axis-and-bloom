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
| 2 | IMG | `backend/src/features/image_pipeline/CLAUDE_CODE_PROMPT_IMAGE_PIPELINE.md` (pre-existing, written 2026-07-12) | **The across-the-board image strategy**: GCS bucket + semantic asset registry + auto-optimization Cloud Function; migrates all 82 image import sites across 8 files (Shop.tsx excluded — retiring). Also Camila's workflow fix: she adds/swaps photos by uploading to the bucket — auto-optimized, no code change, no deploy | per that prompt | ⬜ written, not run |
| 3 | FIX-02 | `FIX-02_homepage_media_weight.md` | Video compression + posters + lazy-loading/dimensions in code (what the pipeline doesn't cover) — re-scoped 2026-07-18 | Sonnet | ⬜ runs after IMG |

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

**FIX-02**
- [ ] Homepage transfer size on first load < 10MB (from ~120MB); Lighthouse mobile performance meaningfully improved (record before/after)
- [ ] Hero video: compressed, `preload` sane, poster image shows instantly
- [ ] Below-the-fold images/videos lazy-load; nothing offscreen downloads at page open
- [ ] Visual appearance unchanged at normal viewing (no visibly degraded assets)
- [ ] **Lifecycle sections + Company Gift widget still present** (this fix touches Home.tsx — the exact file where they've been dropped twice)
- [ ] Standing trio (`../REGRESSION.md`)
