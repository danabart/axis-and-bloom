# Refine: The Axis V2 page — round 6 (Dana's review, 2026-07-14)

Context: rounds 1–5 applied. One fix: final placement + vocabulary for the Capture words. File: `AxisMap.tsx`.

---

## Capture words: on the streams, at their beginnings, familiar coffee vocabulary

R5's spread slots detached the words too much — they flash at the bottom of the image, unrelated to anything. Final placement rule:

**Placement — early on the lines.**
- Words sit **on the dotted stream lines**, anchored to points along the **first ~40% of each stream's path length** (the off-canvas/entry end) — never near the convergence/merge zone, never in the bottom dead space.
- Offset each word slightly above or below its line (alternating) so the word reads as riding the line without covering it.
- Per stream at any moment: max 1–2 words visible; across the whole visual max 3. Words on the same stream must occupy clearly separated points (≥25% path-length apart). Keep the slow fade-in/out rhythm and current size/weight.
- Result should read as: data fragments entering along the streams, long before they merge into the node.

**Vocabulary — familiar, cross-archetype.**
Replace the fruit-heavy list with a rotation drawn from all five archetypes — words people recognize from coffee:

`chocolate · nutty · caramel · hazelnut · cocoa · honey · berry · citrus · jasmine · floral · stone fruit · earthy · spice · full body · washed · natural · honey process`

- Mix flavor words and process words in the rotation (roughly 2:1 flavor:process).
- Keep them lowercase, as now. No coffee names, no roastery names, no numbers.

---

## Checklist
- [x] Words anchored to the first ~40% of each stream path, alternating above/below the line
- [x] Nothing near the merge zone or bottom of the image; max 3 visible at once, no overlaps
- [x] New cross-archetype vocabulary in rotation (flavor + process words)
- [x] Streams, node, and all other states untouched

**2026-07-14 — implemented and build-verified** (`vite build` clean, competitive-safety grep clean, dev server re-checked serving `/the-axis` and `/api/axis/stats`). R5's fully-detached "ambient slots" approach is gone — words are back on the 3 field streams, each carrying 2 word-slots at t=0.10 and t=0.37 (27% apart along the curve, both inside the first 40%), alternating above/below offset. Concurrency is capped deterministically (same technique as R5, reused): the 6 word-slots are split into 2 waves — one word per stream per wave — inside a shared 8s cycle (3.2s visible window, 4.8s gap), so exactly 3 words are visible at once (never more, never fewer per active wave) and never more than 1 on a single stream. Vocabulary: full 17-word cross-archetype list now lives in `FIELD_FRAGMENTS` (the canonical pool spec'd in this prompt); a curated 6-word subset (chocolate, washed, jasmine, stone fruit, earthy, honey process — 4 flavor : 2 process, spanning 4 of the 5 archetypes) is wired to the live stream slots, referenced by index so the pool stays the single source of truth. Measurement stream (ticks only) and all other states untouched. Not yet opened in an actual browser — still no headless-browser tool in this environment. **Nothing has been committed or deployed.**
