# Refine: The Axis V2 page — round 2 (Dana's review, 2026-07-14)

Context: round 1 (`CLAUDE_CODE_PROMPT_THE_AXIS_V2_REFINEMENTS.md`) is applied. Round 2 restructures the map's opening states and fixes the handoff. Competitive-safety rules from the V2 prompt still apply. Files: `AxisMap.tsx`, `TheAxis.tsx`.

**The big change (item 1): the map now starts as GEOGRAPHY and becomes FLAVOR SPACE.** At the farm, archetypes don't exist yet — so the page opens with dots grouped by world sourcing region, and the archetype circles only appear at the Structure section. The reorganization from geography → flavor space is the page's signature moment.

---

## 1. States 0–1: geographic view (no circles, no archetypes)

**State 0 (Hero):**
- REMOVE the five archetype circles and archetype labels entirely from this state.
- Render the same dots grouped as **world sourcing regions** — loose clusters labeled with muted uppercase geography labels: `AFRICA`, `CENTRAL AMERICA`, `SOUTH AMERICA`, `ASIA` (3–4 clusters; distribute dots across them with the seeded RNG).
- All dots are **neutral/unclassified** in this state — one muted brown/gray tone (suggest `#8a7a6b` at ~0.7 opacity). Color does not exist before measurement.
- No continent shapes/world map drawing — just labeled dot clusters, same abstract style as today. Keep the slow breathing.
- Keep the "Map last tightened {date}" caption.

**State 1 (Capture):**
- Still geographic, still no archetype circles or labels (REMOVE them from this state — currently faded circles show).
- Keep what Dana likes: the **flashing/drifting origin words** (jasmine, honey process, washed…) and the **dotted stream lines** — but make the streams legible: both dotted arcs must visibly **converge into the new gray node** (the streams are the data paths: field story + measurement). Slightly larger fragment text (see item 3).
- The new node appears near the geographic clusters, gray, unclassified.

**State 2 (Structure) — the transformation:**
- THIS is where the archetype circles and labels appear: geography labels fade out, the five regions fade in, and **all dots migrate** from geographic clusters into their archetype clusters while taking on archetype colors (~1.5–2s, staggered, calm).
- The new gray node joins the migration and settles into its region (existing behavior).
- This moment must feel like the page's thesis: *origin is where the data starts; flavor is where it lives.*

**States 3–6:** unchanged (flavor-space view, as currently built).
**Entry-aware `?archetype=`:** applies only from state 2 onward (there's nothing to highlight in geography).

## 2. Fix the handoff (state 6) — currently broken

Screenshot shows a tiny blob overlapping the Balanced & Sweet region with colliding text. Fix the composition:

- When state 6 plays, **dim the whole map to ~0.25 opacity** — the handoff gets the stage.
- Use the **existing generic white bag mockup**: `frontend/src/design/IMAGES/bags/TransparentBag02.png` (transparent PNG, 1500×1500, "From: AXIS & BLOOM / To: YOU" already printed on it — no extra typography needed). Import it the same way `Home.tsx` imports its bag images.
- Render it in a **clear reserved area** (bottom-center or bottom-right, away from all labels), ~160–200px tall, subtle fade/scale-in as the traveling dot arrives. Nothing overlaps region labels or text.
- The traveling dot lands ON the bag and becomes a **small archetype-colored label chip** on the bag's front (small rounded rect in the archetype's color, roughly where the "Archetype" label sits on the real generic bag). This mirrors phase-1 packaging exactly: generic bag + pasted archetype-colored label.
- The travel animation: dot detaches, map dims as it travels, bag fades in, dot settles as the label. Once, ~2s, calm.
- Known artifact: the mockup has tiny "Spicy & Earthy" text at the bottom — invisible at this render size; Camila may supply a cleaned version later.

## 2b. Align archetype color tokens with Home.tsx (source of truth)

`Home.tsx` already defines Camila's working archetype colors, which differ from the provisional tokens shipped in V2. Update the `theme.css` tokens to match `Home.tsx` and make `AxisMap` consume them:

```
fruity: #ca445f · floral: #a34b78 · balanced_sweet: #d1ac11 · chocolate_nutty: #a54c2d · earthy: #912f2f · experimental: #056c7a
```

(Separately noted for Dana/Camila, not for this build: `Home.tsx` line ~48 still says "Spicy & Earthy" — rename to "Earthy" per the naming decision.)

## 3. Typography: increase sizes page-wide

Body text reads too small across the page:

- Section body text: raise to ~1.1–1.15rem with line-height ≥1.65.
- Depth expander text and captions: one step up from current.
- Map labels (geographic + archetype): raise from current size by ~20%, letter-spacing kept.
- Origin fragment words in state 1: raise ~20% so they're readable while drifting.
- Keep heading sizes as-is (they're fine); only body/label/microcopy scale up. Match h/body ratio to `About.tsx` if it already reads well there.

---

## Checklist
- [x] States 0–1: no archetype circles/labels; geographic clusters with AFRICA / CENTRAL AMERICA / SOUTH AMERICA / ASIA labels; neutral dot color
- [x] State 1: streams visibly converge into the gray node; fragments slightly larger
- [x] State 2: full migration animation — geography dissolves, archetype regions + colors emerge
- [x] `?archetype=` highlight only from state 2 on
- [x] State 6: map dims; `TransparentBag02.png` renders large in reserved space; traveling dot becomes an archetype-colored label chip on the bag; no overlaps
- [x] Archetype tokens updated to match `Home.tsx` colors; `AxisMap` uses the tokens
- [x] Body/label font sizes raised page-wide; headings unchanged
- [x] No real farm, coffee, or roastery names in geography labels or fragments (region names only)
- [x] Motion stays calm; `prefers-reduced-motion` renders final frames statically

**2026-07-14 — implemented and build-verified** (`vite build` clean, `TransparentBag02.png` confirmed bundled, competitive-safety grep clean, dev server re-checked serving `/the-axis` and `/api/axis/stats`). The reserved handoff band is a new fixed-height strip appended to the SVG's own viewBox (map content unchanged above it) — this is a structural fix for the reported overlap, not a tweak of the old coordinates. Geo-region assignment per node is independent of its eventual archetype (seeded RNG, not correlated) — deliberate, reinforces "no correlation between origin and flavor." Not yet opened in an actual browser — still no headless-browser tool in this environment. **Nothing has been committed or deployed** — this and all prior Axis V2 work remains local, uncommitted.
