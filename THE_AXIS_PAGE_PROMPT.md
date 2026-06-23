# Build: "The Axis" page

## Goal
Build a new public page called **The Axis** at route `/the-axis`. It explains the flavor-matching methodology behind Axis & Bloom — how coffees and users are mapped to a seven-dimensional flavor space, and how distance between vectors drives recommendations.

There is a complete HTML reference mockup at:
`backend/src/axis page/axis_method_page_v5_match_plot.html`
Open it and treat it as the visual and content reference for every section. The mockup uses CSS variables and Tabler icons — the React component should replicate the layout and content faithfully while using the project's real design system (see below).

> **Important — data abstraction:** This is a public page and the exact numeric methodology must not be exposed. All charts and visualizations must be **illustrative only** — they convey shape and relative character, not precise values. Specifically:
> - No numeric scale labels on any chart axis or spoke (no 0–15 ticks, no min/max numbers)
> - No exact dimension values displayed to the user anywhere on the page
> - No mathematical formula displayed
> - The API endpoint may still return real data to drive chart shapes, but the frontend renders shapes, not numbers
> The goal is that a visitor understands the concept of multi-dimensional flavor matching without being able to extract the actual scoring parameters.

---

## Files to create / modify

| Action | File |
|---|---|
| Create | `frontend/src/app/components/TheAxis.tsx` |
| Edit | `frontend/src/app/App.tsx` — add route `/the-axis` |
| Edit | `frontend/src/app/components/Navigation.tsx` — add nav link "The Axis" |
| Create | `backend/src/routes/archetypes.ts` — new route file |
| Edit | `backend/src/index.ts` — mount the new route at `/api/archetypes` |

---

## Design system (match existing pages exactly)

- **Background**: `#f2f1ea` (page bg), `#e5e5da` (alternate section bg)
- **Font**: `fontFamily: "'Genova', sans-serif"` on all text
- **Accent / rust**: `#9a2918` or `#a33726` for labels, underlines, pills
- **Body text color**: `#2c2b27`
- **Muted label**: `0.7rem`, `letterSpacing: '0.28em'`, `textTransform: 'uppercase'`, color `#bf6a58`
- **Section padding**: `clamp(88px, 11vw, 148px) clamp(32px, 6vw, 96px)`
- **Animations**: use `motion/react` with the `fadeUp` pattern used in `About.tsx`:
  ```ts
  initial={{ opacity: 0, y: 28 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.2 }}
  transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
  ```
- **Thin divider lines**: `1px solid rgba(44,43,39,0.12)` between sections
- Look at `About.tsx` and `CoffeesPage.tsx` as the primary design reference. Do not use Tailwind classes for layout — use inline styles like every other page.

---

## Navigation

In `Navigation.tsx`, add "The Axis" as a nav link between "How it works" and "Our coffees":
```tsx
<Link to="/the-axis" style={NAV_LINK} className="hover:opacity-50 transition-opacity">The Axis</Link>
```

---

## Page structure (three sections — see mockup for full copy)

### Hero
- Small uppercase label: "The Axis"
- Large headline (clamp font-size, Genova 400 weight): "Every taste has a location."
- One paragraph of body text (copy from mockup)
- No image — editorial text only, cream background

### Section 1 — The flavor space
- Heading: "Five regions. One continuous map."
- **Parallel coordinates chart** — a custom SVG/Canvas visualization showing all 7 dimensions as vertical axes (Sweetness, Acidity, Bitterness, Body, Texture, Savory / Depth, Finish Length). Each archetype is a colored polyline. Finish Length axis is dashed. The chart is driven by data from the API (see backend section). **Only dimension names at the bottom of each axis — no numeric scale, no tick marks, no min/max labels at all.**
- Archetype color map (use these consistently across all charts):
  - Chocolate & Nutty: `#8b5e3c`
  - Balanced & Sweet: `#c4821a`
  - Earthy: `#4a3728`
  - Floral: `#7a6fa0`
  - Fruity: `#a33726`
- Below the chart: a two-panel callout explaining decaf (preference layer, not archetype) and experimental coffees (still mapped to one of the five regions). Copy from mockup.

### Section 2 — The seven dimensions
- Heading: "A coffee is a shape, not a word."
- Two-column layout:
  - **Left**: three data sources explanation (Trained cuppers, Roastery notes, Customer feedback) + "Vectors evolve continuously" callout + **interactive archetype selector** with dimension range bars. Clicking an archetype button renders its 7 dimension ranges as horizontal range bars (shaded band = min–max, dot = midpoint). All driven by API data. **Do not display any numeric labels on the bars (no range numbers like "7–9", no axis ticks, no values).** The bar shows relative shape only — the shaded region communicates wide vs. narrow range, the dot communicates high vs. low, without exposing the actual numbers.
  - **Right**: 
    - **Radar chart** (Chart.js) showing all 5 archetypes across 6 TASTE dimensions. Use Chart.js already used in `CoffeesPage.tsx`. Finish Length shown as a 7th spoke with dashed border. **Set `ticks: { display: false }` on the r-scale so no numeric values appear on the spokes.**
    - Below the radar: a short prose explanation (no formula): *"We calculate the flavor distance between your profile and every coffee in our catalogue. The closer the match, the more precisely the coffee fits who you are as a drinker — across every dimension at once."* Style this as a small callout card (same style as the decaf/experimental callout in Section 1).

### Section 3 — Matching
- Heading: "Nearest neighbor in flavor space."
- **SVG distance plot** — illustrative (static, not DB-driven). Shows a "You" dot, five colored archetype dots, and arrows from "You" to each archetype:
  - Thick solid rust arrow (`#a33726`) → nearest archetype (Fruity)
  - Medium solid amber arrows (`#c4821a`) → adjacent archetypes (Floral, Balanced & Sweet)
  - Thin dashed gray arrows → distant archetypes (Earthy, Chocolate & Nutty)
  - Two dashed concentric rings around "You" mark the wheelhouse and exploring zones
  - No axis labels or dimension names — purely illustrative
  - Legend below: "In your wheelhouse" / "Worth exploring" / "Outside comfort zone"
  - See mockup for exact SVG coordinates and layout
- Below the plot: three tier cards (In your wheelhouse / Worth exploring / Outside comfort zone) with distance threshold badges. Copy from mockup.

---

## Backend: `GET /api/archetypes/vectors`

Create `backend/src/routes/archetypes.ts`. Mount at `/api/archetypes` in `index.ts`.

### Endpoint: `GET /api/archetypes/vectors`
No auth required (public).

**What it should return:**
```json
[
  {
    "archetypeKey": "chocolate_nutty",
    "archetypeName": "Chocolate & Nutty",
    "dimensions": [
      { "name": "Sweetness",      "min": 7,  "max": 9,  "ideal": 8   },
      { "name": "Acidity",        "min": 3,  "max": 5,  "ideal": 4   },
      { "name": "Bitterness",     "min": 9,  "max": 11, "ideal": 10  },
      { "name": "Body",           "min": 10, "max": 13, "ideal": 11.5 },
      { "name": "Texture",        "min": 3,  "max": 5,  "ideal": 4   },
      { "name": "Savory / Depth", "min": 7,  "max": 9,  "ideal": 8   },
      { "name": "Finish Length",  "min": 9,  "max": 11, "ideal": 10  }
    ]
  },
  ...
]
```

**Query strategy:**
1. Join `archetype_vector` with the `archetype` table on `archetype_vector.archetype_id = archetype.id`.
2. The `dimension_id` column in `archetype_vector` is a UUID. Check whether it currently maps to any dimension name in the DB. If not (the old `dimension` table was dropped — see project history), the data may need to be seeded.
3. **If `archetype_vector` is empty or `dimension_id` cannot be resolved to dimension names**: fall back to returning the hardcoded reference values below so the page always works. Log a warning. The hardcoded fallback is:

```
Chocolate & Nutty: Sweetness 7–9, Acidity 3–5, Bitterness 9–11, Body 10–13, Texture 3–5, Savory/Depth 7–9, Finish 9–11
Balanced & Sweet:  Sweetness 9–11, Acidity 6–8, Bitterness 6–8, Body 7–9, Texture 2–4, Savory/Depth 4–6, Finish 6–8
Earthy:            Sweetness 5–7, Acidity 3–5, Bitterness 8–10, Body 12–14, Texture 9–11, Savory/Depth 12–14, Finish 12–14
Floral:            Sweetness 7–9, Acidity 10–12, Bitterness 3–5, Body 5–7, Texture 2–4, Savory/Depth 3–5, Finish 3–5
Fruity:            Sweetness 7–9, Acidity 12–14, Bitterness 5–7, Body 5–7, Texture 3–5, Savory/Depth 3–5, Finish 7–9
```

4. Return the five archetypes in a consistent order: Chocolate & Nutty, Balanced & Sweet, Earthy, Floral, Fruity.
5. Include a `Cache-Control: no-store` header (consistent with the rest of the API).

---

## Charts: implementation notes

- **Parallel coordinates** — draw as an SVG or `<canvas>` element in React. On mount, fetch archetype vectors from the API and plot each archetype as a polyline across 7 vertical axes. Use `useRef` for the canvas/SVG and `useEffect` to redraw when data arrives. Finish Length axis should be dashed. Each archetype uses its color from the color map above. Dots at each axis intersection.
- **Radar chart** — use Chart.js (already a dependency, see `CoffeesPage.tsx` for the import pattern). 6 spokes for the TASTE dimensions. Add Finish Length as the 7th spoke; set `borderDash: [4, 2]` on the Finish dimension's dataset point line. All data from the API response.
- **Dimension bars** — simple React-rendered `<div>` bars. Active archetype selected via state. Range rendered as a shaded band `left: min%, width: (max-min)%`; midpoint as a small dot. Switching archetype triggers a state update — no re-fetch needed (all data loaded on mount). **Do not render any text showing the min, max, or ideal values. No numbers at all — the bar shape is the only output.**
- **SVG matching plot** — static SVG, hardcoded positions. Copy coordinates from the mockup HTML file. Does not need DB data.

---

## Error / loading states
- Show a subtle loading skeleton or spinner while the archetype vectors are fetching.
- If the API call fails, show a small inline error message ("Could not load flavor data") — the static sections (hero, Section 3) should still render normally.

---

## Summary checklist
- [ ] `GET /api/archetypes/vectors` endpoint, with hardcoded fallback if DB is empty
- [ ] `TheAxis.tsx` component with 3 sections matching the mockup layout and brand design
- [ ] Parallel coordinates SVG/canvas driven by API data
- [ ] Radar chart (Chart.js) driven by API data, 7 dimensions
- [ ] Interactive dimension bars driven by API data
- [ ] Static SVG matching plot with distance arrows (Section 3)
- [ ] Route `/the-axis` added to `App.tsx`
- [ ] "The Axis" nav link added to `Navigation.tsx`
