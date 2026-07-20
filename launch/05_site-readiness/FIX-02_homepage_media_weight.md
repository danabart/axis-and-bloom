# FIX-02 — Homepage video & loading behavior (runs AFTER the image pipeline migration)

> Workstream: site-readiness · Model: Sonnet · Depends on: the image pipeline migration (row IMG) having run · One session, read the diff before deploy.
> Re-scoped 2026-07-18: image file compression removed — the pipeline migration's bucket + optimization Cloud Function now owns image optimization. This fix covers what the pipeline does NOT: video and in-code loading behavior.

CONTEXT: `frontend/src/app/components/Home.tsx` historically referenced ~120MB of media —
dominated by a 43MB hero video plus other section videos (some still placeholder
`<source src>` values, OT-10) — with no lazy loading, no posters, no explicit dimensions.
The image pipeline migration (`backend/src/features/image_pipeline/`) has since moved
images to the `axis-bloom-assets` bucket with auto-optimization, but videos and the
code's loading attributes were out of its scope. Paid mobile traffic starts ~Aug 3.

TASK:

1. **Audit first:** list every media asset Home.tsx AND PreLaunch.tsx reference —
   videos and images — with transfer size and above/below the fold. Include the list in
   your output. (Images should now be bucket URLs; flag any stragglers still imported
   from `frontend/src/design/IMAGES/` as pipeline follow-ups — do NOT migrate them
   yourself, just list them.)
2. **Video compression:**
   - Hero video → target ≤ 5–6MB: 1080p max, H.264/H.265, sane bitrate, strip audio if
     silent. Generate a lightweight poster image (first meaningful frame, ≤150KB —
     upload it through the pipeline's bucket flow like any other image).
   - Other real (non-placeholder) videos → same treatment.
3. **Loading behavior in code:**
   - Hero video: `poster`, `preload="metadata"` (or `none`); keep current
     `autoplay muted playsinline loop` behavior.
   - All below-the-fold images: `loading="lazy"` + explicit `width`/`height` (or CSS
     aspect-ratio) to kill layout shift — this applies to bucket-hosted images too.
   - Below-the-fold videos: `preload="none"` + poster; load-on-approach only if an
     IntersectionObserver pattern already exists in the codebase — no new dependency.
4. Placeholder `<source src>` values (OT-10): keep them wired but confirm they download
   nothing heavy on page open; list them for the future real-brand-video swap.

HARD BOUNDARIES:
- Do NOT change the homepage's visual design, section order, or copy.
- Do NOT touch the lifecycle personalization or Company Gift redemption widgets in
  Home.tsx (standing warning in CAMILAS_UPDATES.md — this exact file has silently lost
  them twice). Media attributes on their elements are fine; JSX structure/logic is not.
- Do NOT do image file compression or migration — that's the pipeline's job; only
  loading attributes for images here.
- No new dependencies.

ACCEPTANCE — demonstrate each before finishing:
1. Before/after table: per-asset transfer sizes + total first-load page weight
   (target < 10MB) and after full scroll.
2. Poster shows instantly; hero video still plays; no visible quality collapse
   (screenshots).
3. DevTools network log on a fresh load: nothing below the fold downloads at page open.
4. Lifecycle sections + Company Gift widget verifiably still present and functional.
5. The Task 1 audit list, with each asset marked compressed / lazy-loaded / placeholder /
   pipeline-follow-up.
