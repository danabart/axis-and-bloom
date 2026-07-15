# Build: "The Axis" page V2 — The Data Journey

## Goal
Rebuild the existing public page **The Axis** (`frontend/src/app/components/TheAxis.tsx`, route `/the-axis` — both already exist) according to the new strategy: the page is a **window into a living data system**, told as a scroll journey through five lifecycle stages (Capture → Structure → Connect → Consume → Refine).

**All copy comes verbatim from** `backend/src/features/the_axis_page/THE_AXIS_PAGE_COPY_V2.md`. Do not rewrite, shorten, or "improve" the copy. Section structure, headlines, body, callouts, and depth expanders are all specified there.

**Strategy context (read before building):** `backend/src/features/the_axis_page/THE_AXIS_REDESIGN_STRATEGY.md` — especially §2 (competitive-safety tiers) and §5 (visual direction).

Camila (designer) will refine visuals after this build. Your job: get structure, motion, data flow, and brand guidance right; don't over-polish decorative details.

---

## ⚠️ Competitive-safety rules (hard requirements, stricter than V1)

This is a public page. It must prove the system is real without becoming a spec for competitors.

**Never render, in any form (UI, DOM, API response, code comments in shipped bundles):**
- Numeric scales, dimension scores, ranges, or tick marks (no 0–15, no min/max)
- Dimension names attached to specific coffees or positions
- Formulas, distance math, placement logic
- Database table/view/column names
- Real coffee names or roastery names on the map — all map nodes are **anonymous**
- Quiz logic or archetype-adjacency reasoning

**Allowed:** archetype names + colors, aggregate counts, timestamps, anonymous graph topology (dots and lines), the five-stage narrative.

**API litmus test:** every endpoint response for this page must contain only aggregates and timestamps — if a response could help someone reconstruct coordinates or scoring, it's wrong.

---

## Files to create / modify

| Action | File |
|---|---|
| Rewrite | `frontend/src/app/components/TheAxis.tsx` |
| Create | `frontend/src/app/components/axis/AxisMap.tsx` — the single transforming map visual |
| Create | `backend/src/routes/axisStats.ts` — Tier-B aggregate endpoint |
| Edit | `backend/src/index.ts` — mount at `/api/axis` |
| Edit | `frontend/src/styles/theme.css` — add archetype color tokens (see below) |
| Keep | Route `/the-axis` in `App.tsx` and the Navigation link — already exist, don't duplicate |

---

## Design system

Follow the same conventions as the retired V1 prompt (`THE_AXIS_PAGE_PROMPT.md`) and existing pages (`About.tsx`, `CoffeesPage.tsx`): cream backgrounds (`#f2f1ea` / `#e5e5da`), Genova font, inline styles (no Tailwind layout classes), muted uppercase labels, thin dividers, `motion/react` fadeUp pattern with `ease: [0.16, 1, 0.3, 1]`.

**Motion principle — "calm is a feature":** slow, composed transitions (≥0.8s durations, gentle easing). Nothing bounces, pulses fast, or auto-plays aggressively. The map may "breathe" (very slow, subtle node drift). No parallax gimmicks.

### Archetype color tokens (add to `theme.css`)

Provisional values sampled from Camila's bag designs (`misc/design_documents/Embalagens_v1.pdf`) — **flag in a code comment that Camila must confirm exact hexes:**

```css
--color-archetype-fruity: #ee5974;        /* coral pink (= --color-pink) */
--color-archetype-floral: #a4487d;        /* plum/magenta — CONFIRM */
--color-archetype-balanced-sweet: #d99a1e;/* mustard — CONFIRM */
--color-archetype-chocolate-nutty: #a8462c;/* terracotta (= --color-terracotta-fill) */
--color-archetype-earthy: #ab3a2e;        /* deep red — CONFIRM */
--color-experimental: #0f6f6c;            /* teal badge — CONFIRM */
```

Archetype name is **"Earthy"** everywhere (not "Spicy & Earthy"). Use these tokens for ALL archetype coloring — do not reuse V1's old archetype hex map.

---

## The map — one visual, five states (`AxisMap.tsx`)

The page's protagonist is a single abstract network visualization that transforms as the user scrolls through the five sections. Implement as one SVG React component receiving a `stage` prop (0–5) and animating between states.

- **Topology:** five colored regions (loose clusters, NOT hard-bordered zones), anonymous dots (coffees), thin connecting lines (relationships). Node/edge counts come from the stats API so density is real; positions are **generated layout** (e.g., force-ish or hand-tuned cluster centers + jitter with a fixed seed) — never real coordinates.
- **State 0 (Hero):** full map, all regions visible, slow breathing. Timestamp caption below: "Map last tightened {date}".
- **State 1 (Capture):** map dims; two abstract streams converge; one new dim/gray node appears at the edge.
- **State 2 (Structure):** the new node's descriptor cloud resolves; it drifts into its region and takes the region's color. Five regions clearly readable with archetype names as labels.
- **State 3 (Connect):** edges light up progressively; one highlighted walk animates: node → neighbor → bridge into adjacent region → a teal-ringed Experimental node. Experimental nodes = normal dots with a teal ring/badge, sitting *inside* archetype regions (a badge, not a sixth region).
- **State 4 (Consume):** three small "reader" chips (Quiz / Profile / Liam) connect to the map with thin lines — one source, many readers.
- **State 5 (Refine):** a subtle cycle animation around the map; live counters render beside it from the stats API: "{bloomNotes} Bloom Notes this month · {positionsRefined} positions refined this quarter · Map last tightened {date}".

**Scroll wiring:** IntersectionObserver (or motion/react `useInView`) per section sets the stage; transitions animate over ~1s. On mobile, states may switch with simple crossfades — don't build heavy scroll-jacking.

**Entry-aware highlighting:** support query param `?archetype=fruity|floral|balanced_sweet|chocolate_nutty|earthy`. When present, that region renders slightly emphasized (higher opacity/glow) in every state. Invalid/absent param → neutral rendering. This is how profile links land ("how did my coffee earn its place?").

---

## Page structure

Render the sections exactly as laid out in `THE_AXIS_PAGE_COPY_V2.md`:

1. **Hero** — label, headline, sub, body, map state 0, soft scroll CTA.
2. **Capture** — copy + map state 1 + depth expander ("How do we know our numbers mean anything?") + pull quote.
3. **Structure** — copy incl. the five archetype one-liners + map state 2 + depth expander ("What does 'provisional' mean?").
4. **Connect** — copy + map state 3 + the "Axis is your direction…" callout (style as the page's signature callout).
5. **Consume** — copy + map state 4 + depth expander ("What Liam can and can't see").
6. **Refine** — copy + map state 5 with live counters + "Your coffee may change…" callout.
7. **CTA** — headline, body, primary button → `/quiz` (check the actual quiz route in `App.tsx` and use it), microcopy.

**Depth expanders:** accessible `<details>`-style disclosure or a minimal accordion — closed by default, calm chevron rotation, no layout jump jank. These are the "progressive depth" layer; never open them automatically.

---

## Backend: `GET /api/axis/stats`

Create `backend/src/routes/axisStats.ts`, mount at `/api/axis` in `index.ts`. Public, no auth. Response — aggregates and timestamps ONLY:

```json
{
  "coffeesMapped": 29,
  "archetypes": [
    { "key": "fruity", "name": "Fruity", "coffeeCount": 6 },
    { "key": "floral", "name": "Floral", "coffeeCount": 4 },
    { "key": "balanced_sweet", "name": "Balanced & Sweet", "coffeeCount": 7 },
    { "key": "chocolate_nutty", "name": "Chocolate & Nutty", "coffeeCount": 8 },
    { "key": "earthy", "name": "Earthy", "coffeeCount": 4 }
  ],
  "connectionCount": 42,
  "regionAdjacency": [ { "a": "fruity", "b": "floral", "connections": 5 }, ... ],
  "experimentalCount": 3,
  "bloomNotesThisMonth": 0,
  "positionsRefinedThisQuarter": 0,
  "lastTightenedAt": "2026-07-01T00:00:00Z"
}
```

**Query strategy:** inspect the existing schema (coffee/dial position tables, the coffee-relationship table, feedback tables) and derive each aggregate with COUNT queries. `lastTightenedAt` = most recent updated-at across positions/relationships. If a source table is missing or empty, fall back to sensible hardcoded values (like V1's fallback pattern) and log a warning — the page must always render. Never include coffee IDs, names, positions, or dimension data in the response.

---

## Error / loading states
- Skeleton for the map while stats load; if the API fails, render the map with fallback density and hide the live counters (the narrative still works).
- Page must be fully readable with JS-reduced motion: respect `prefers-reduced-motion` (crossfade instead of animated transitions).

---

## Checklist
- [x] `TheAxis.tsx` rebuilt: 7 sections, copy verbatim from `THE_AXIS_PAGE_COPY_V2.md`
- [x] `AxisMap.tsx`: one SVG, six states (0–5), scroll-driven, breathing idle, seeded layout
- [x] Experimental = teal ring badge inside regions, shown in Connect state
- [x] Entry-aware `?archetype=` highlighting
- [x] Depth expanders (3), closed by default
- [x] `GET /api/axis/stats` — aggregates + timestamps only, with fallbacks (added to the existing `axis.ts` router rather than a new `axisStats.ts` — see WHAT_WE_BUILT.md #59)
- [x] Archetype color tokens added to `theme.css` with "Camila to confirm" comment
- [x] "Earthy" naming everywhere; no V1 terminology (no "vector mapping", no "Collaborative Flavor Wheel")
- [x] Competitive-safety audit: grep the built page/API for numbers, dimension names, table names, coffee names — none appear (2026-07-14)
- [x] `prefers-reduced-motion` respected

**2026-07-14 — built and verified against real production Cloud SQL + a local build (see WHAT_WE_BUILT.md #59 for full detail). Not yet opened in an actual browser — no headless-browser tool was available in that session; visual sign-off on the scroll/animation behavior is still outstanding.**
