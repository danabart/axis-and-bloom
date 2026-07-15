# Refine: The Axis V2 page — round 5 (Dana's review, 2026-07-14)

Context: rounds 1–4 applied. Two fixes. Files: `AxisMap.tsx`.

---

## 1. Capture: REALLY spread the note words across the whole visual

Words are still bunched at the convergence point (screenshot shows "jasmine" directly on top of "honey process"). Stop attaching them to the streams.

- Define **6–8 fixed word slots spread across the entire visual** — top-left, top-right, mid-left, mid-right, lower-left, lower-right, etc. — with generous distance between slots (no slot within ~120px of another in viewBox units, and none on top of the convergence point or region labels).
- Cycle the origin words (cherry, jasmine, honey process, washed, floral, stone fruit…) through these slots: at most **2–3 words visible at any moment**, each fading in/out slowly in its own slot; a word never appears in a slot adjacent in time to an occupied neighboring slot.
- The dotted streams stay exactly as they are (they carry the convergence story alone). Words are ambient — scattered impressions in the air, not passengers on the lines.
- Keep current word size/weight.

## 2. Handoff: replace the landed dot with a printed-looking underline

The persistent round swatch next to "Your Archetype" reads as a stray dot on the bag (screenshot: it overlaps the "Y").

- Remove the persistent circle swatch entirely.
- New landing: the traveling dot reaches the label box and **dissolves into a thin archetype-colored underline** appearing beneath the "Your Archetype" text — width matching the text, height ~3–4px at bag scale, subtle rounded ends, gentle ~0.5s draw-in from left to right as the dot fades out.
- The underline must sit inside the dashed box, clearly under the text baseline, not touching the dashes or "WHOLE BEAN COFFEE".
- `?archetype=` colors the underline; seeded default otherwise. `prefers-reduced-motion`: show the final frame (underline present, no travel).

---

## Checklist
- [x] Words in 6–8 spread slots across the whole visual, 2–3 visible max, no overlaps ever, streams untouched
- [x] No persistent dot on the bag; traveling dot dissolves into an archetype-colored underline under "Your Archetype"
- [x] Underline positioned cleanly inside the dashed box; scales with the bag image

**2026-07-14 — implemented and build-verified** (`vite build` clean, competitive-safety grep clean, dev server re-checked serving `/the-axis` and `/api/axis/stats`).

**Item 1**: 8 fixed slots (`AMBIENT_WORD_SLOTS`), each checked ≥120 viewBox units from every other slot, the convergence point, and the 4 geo labels. Concurrency is capped *deterministically*, not just tuned: slots are grouped into 4 non-overlapping 3s "waves" of 2 slots each within a shared 12s cycle (each word's own visible window is 2.6s, leaving a 0.4s gap before the next wave) — at most 2 words are ever visible at once, by construction, not by approximation. Words cycle through slots via `FIELD_FRAGMENTS[i % FIELD_FRAGMENTS.length]` (6 words, 8 slots, so 2 words repeat once each). The streams themselves (paths + flowing dash + traveling dot) are untouched.

**Item 2**: swatch/glow removed entirely. Traveling dot now fades out (not persists) as an underline draws in via `scaleX` (0→1, `transformOrigin: left`) at the same moment. Underline position (19%–81% width, 41.5% height fraction of the bag box) is another estimate from the visually-inspected asset, same caveat as the R3 swatch position — worth Dana's direct check, particularly whether it sits cleanly between "Your Archetype" and "WHOLE BEAN COFFEE" without touching either.

Not yet opened in an actual browser — still no headless-browser tool in this environment. **Nothing has been committed or deployed.**
