# Refine: The Axis V2 page — round 3 (Dana's review, 2026-07-14)

Context: rounds 1–2 applied. Three refinements: real world map in the geography states, bolder Capture streams, bigger bag with the current-design asset. Competitive-safety rules from the V2 prompt still apply. Files: `AxisMap.tsx` (+ possibly a small `worldOutline.ts` path-data module).

---

## 1. States 0–1: real world map instead of circles

The geographic clusters currently render as circles (reads like archetype regions — wrong association) and one label per continent.

- Replace the circles with a **simplified flat world-map silhouette**: minimal, low-detail continent outlines (Americas, Africa+Europe outline optional, Asia/Oceania) as a single muted SVG path layer — fill `#e3ddcf`-ish at low opacity, no borders, no country lines. Style: abstract and calm, like a pattern, NOT a detailed atlas. Inline the path data (a hand-simplified low-poly outline is fine; no map libraries, no external fetches).
- Place the coffee dots **on the growing belt** of each continent (equatorial band): East/West Africa, Central America & Mexico, South America (Brazil/Colombia area), Southeast Asia/Pacific. Same neutral dot color as now.
- Update region labels to cover the whole coffee belt (answering coverage): `AFRICA & ARABIA` · `CENTRAL AMERICA & MEXICO` · `SOUTH AMERICA` · `ASIA & PACIFIC`. Same muted uppercase style, positioned near their dot groups.
- Distribute dots across the four groups with the seeded RNG as now.
- State 2 transformation updates accordingly: the world silhouette fades out as the archetype regions fade in and the dots migrate. The geography→flavor-space moment must still read clearly.
- Dot placement is decorative/approximate — do NOT tie dots to real farm or country coordinates (no real sourcing data in the DOM).

## 2. State 1 (Capture): make the streams and words unmissable

The dotted lines and flashing origin words are the point of this state and are currently too faint.

- Origin fragment words (cherry, jasmine, honey process, washed…): raise to ~0.85–0.95rem, weight 500–600, opacity peak ~0.9 (currently they peak too low). Keep the fade-in/out rhythm Dana likes — just louder.
- Dotted stream lines: increase stroke-width ~2× (to ~1.5–2px), raise opacity to ~0.6, and slightly slow the dash animation so the eye can follow the path into the converging gray node.
- Optional: a very subtle moving dot traveling along each stream toward the convergence point (calm, slow) to make direction obvious.
- Everything still converges visibly into the new gray node.

## 3. State 6 (Handoff): bigger bag, current design

- Replace `TransparentBag02.png` (older design) with the **new flat asset**: `frontend/src/design/IMAGES/bags/GENERIC_bag_front_v3_your_archetype.png` (transparent PNG, 593×1273, current generic-bag design from Camila's Embalagens_v1, with "Your Archetype" pre-rendered in the label box in the original Genova type).
- Scale up: ~240–280px tall (tall narrow bag; keep aspect ratio). Add a very subtle drop shadow so the flat art sits on the page.
- **The label moment:** the traveling dot lands inside the dashed label box and settles as a small round **archetype-colored swatch** just left of the "Your Archetype" text (position as % of the bag's rendered size so it scales). A soft brief glow on landing is fine; nothing else added — the text is already on the bag.
- If `?archetype=` is present, the swatch uses that archetype's color; otherwise the seeded default.
- Keep: map dims to background, plays once, calm ~2s, `prefers-reduced-motion` renders the final frame.

---

## Checklist
- [x] World silhouette in states 0–1; circles gone from geography states
- [x] Four coffee-belt labels: AFRICA & ARABIA / CENTRAL AMERICA & MEXICO / SOUTH AMERICA / ASIA & PACIFIC
- [x] Dots sit on growing-belt areas; no real coordinates
- [x] State 2: world fades out ↔ archetype regions fade in; migration intact
- [x] Capture streams ~2× bolder, words bigger/stronger, both clearly converging into the gray node
- [x] Handoff uses `GENERIC_bag_front_v3_your_archetype.png`, ~240–280px tall; dot lands in the dashed box as an archetype-colored swatch beside the pre-rendered "Your Archetype" text
- [x] Motion calm; `prefers-reduced-motion` respected; no new libraries

**2026-07-14 — implemented and build-verified** (`vite build` clean, new bag asset confirmed bundled, old `TransparentBag02.png` reference fully removed, competitive-safety grep clean). World silhouette is a new `frontend/src/app/components/axis/worldOutline.ts` module — 7 seeded, smooth (Catmull-Rom → Bezier) blob shapes, not real coastline data, per the prompt's explicit "pattern, not an atlas" allowance. Swatch position inside the dashed label box (35.5%/40.5% of the bag's rendered box, left of "Your Archetype") was read directly off the actual asset (visually inspected), not guessed. Reserved handoff band grown from 160→300px to fit the taller (260px) bag with clearance on both sides. Not yet opened in an actual browser — still no headless-browser tool in this environment; the swatch position in particular is worth Dana's visual double-check since it was set from a still-image inspection, not a live render. **Nothing has been committed or deployed.**
