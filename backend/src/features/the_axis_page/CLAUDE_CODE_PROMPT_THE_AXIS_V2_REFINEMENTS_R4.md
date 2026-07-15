# Refine: The Axis V2 page — round 4 (Dana's review, 2026-07-14)

Context: rounds 1–3 applied. Three targeted fixes, no structural changes. Files: `TheAxis.tsx`, `AxisMap.tsx`.

---

## 1. Hero: align the map with the text block

The hero's world-map visual currently sits higher than the text column (bleeds up toward the nav, labels clipped at the top). The Capture section's layout is the reference — its visual card aligns with its text.

- Wrap the hero map in the same contained card treatment used in the Capture section (rounded soft-background container) OR at minimum vertically center the SVG against the hero text block.
- The full map, including the topmost region label (CENTRAL AMERICA & MEXICO), must be visible with comfortable padding — nothing clipped by the nav or viewport edge.
- Check both hero and all scroll states after the change: the map container should keep one consistent vertical alignment with each section's text column across the whole page (the Capture card is the pattern to match).

## 2. Capture: spread the flashing words apart

The converging dotted lines are right. The drifting origin words overlap each other near the convergence point and become unreadable.

- Spread the word fragments out along and around the streams — distribute them along the full arc length (near the start and middle of each stream, not bunched at the end). They do NOT all need to reach or point at the convergence spot; the lines carry the convergence, the words just float near their stream.
- Enforce minimum spacing: no two words visible in overlapping positions at the same time — either separate their positions (different arc segments, alternating above/below the line) or stagger their timing so overlapping positions are never lit simultaneously.
- Keep the size/weight from R3 (they're readable now, just colliding).

## 3. Handoff: fix the blurry bag

The bag asset (`GENERIC_bag_front_v3_your_archetype.png`, 593×1273) is rendering blurry. Likely cause: it's being drawn inside the SVG (`<image>`) or scaled via transform. Fix:

- Render the bag as a plain HTML `<img>` overlay positioned over the map container (absolute positioning), NOT as an SVG `<image>` element, and NOT scaled via `transform: scale()`.
- Set an explicit rendered height (~260–280px, width auto) and ensure the layout size equals the visual size (no fractional pixel positions — round the computed position).
- The source is 593×1273 so at ~270px tall the browser is downscaling — that should look crisp with default `image-rendering`. If any blur remains, check for: CSS filters/opacity transitions ending at non-1 values, `backdrop-filter` on the container, or a parent `transform` — remove/adjust so the final settled state has no active transform on the image.
- The archetype swatch (the landed dot) must track the img position/scale correctly after this change.

---

## Checklist
- [x] Hero map contained/aligned with hero text (Capture card = reference); no clipped labels; consistent alignment across all sections
- [x] Capture words distributed along the streams, no overlaps (spacing or timing), lines still converge
- [x] Bag rendered as HTML `<img>`, explicit ~270px height, no transform scaling in settled state, crisp
- [x] Swatch still lands correctly on the label box

**2026-07-14 — implemented and build-verified** (`vite build` clean, competitive-safety grep clean, dev server re-checked serving `/the-axis` and `/api/axis/stats`).

**Root cause of item 1**: every `AxisMap` instance always rendered the tall `640×820` viewBox (map + the reserved handoff band added in R3), even the Hero/journey instances that never show state 6 — so they were disproportionately tall against their text columns. Fixed by making the viewBox height stage-dependent (`stage === 6 ? TOTAL_VIEW_H : VIEW_H`); Hero/journey are back to the original `640×520` aspect, only the CTA's stage-6 instance ever uses the taller box.

**Item 3 approach**: the bag image and its traveling swatch moved out of the SVG entirely into a plain HTML overlay (`position: relative` wrapper div around the `<svg>`, with `motion.img`/`motion.div` siblings positioned via percentages of the same `VIEW_W`×`svgHeight` box the SVG uses) — no `transform: scale()` anywhere in the settled state, only `opacity`. This is a structural change to `AxisMap.tsx`'s return value (now a wrapping `<div>`, not a bare `<svg>`); nothing in `TheAxis.tsx` needed to change since it was already just rendering `<AxisMap .../>` inside its own card `<div>`.

Not yet opened in an actual browser — still no headless-browser tool in this environment. Given items 1 and 3 are visual/rendering bugs Dana caught from looking at the actual page, she should specifically re-check the Hero alignment and bag crispness before the next round. **Nothing has been committed or deployed.**
