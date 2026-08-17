# Claude Code Prompt — /admin/dial rebuild: Map & Journey

**Goal:** Rebuild the Bloom Dial admin page (`/admin/dial`) as a two-lens control surface over the dial graph — an allocentric **Map** (every coffee in its vocabulary slot, every hop, every seam, every gap) and an egocentric **Journey** (stand on one coffee; see every move out, dead ends, and the multi-hop horizon) — with full CRUD for positions, defaults, guests, and hops.

**Design source of truth:** `dial_map_journey/CONCEPT_MOCKUP.html` (same folder as this prompt). Open it in a browser first and click through both lenses. It is a working single-file prototype built on the real Base Data v2 — the layout, interactions, tooltips, filters, audit cards, compass geometry, and dimension colors are all specified by it. Replicate its behavior in the real stack; do not import its code. Where this prompt and the mockup disagree, this prompt wins.

**Why two lenses (context, not instructions):** the map answers the catalogue-control questions (where does every coffee sit, which seams exist, what travels on which dimension, where is the open range) and the journey answers the ego-centered directional question (from this coffee, what are the moves — and what's a dead end). They are two projections of one graph; clicking a coffee on the map is the transition into journey mode. Customer/traffic overlays and per-customer routing weights are future layers and explicitly out of scope here.

---

## Task 0 — Verify current state (confirm, don't assume)

The two prerequisite prompts in `backend/src/features/bloom_dial_base_data/` may or may not have been executed. Check each fact directly and record findings in your writeup:

1. Does `backend/src/routes/admin.ts` contain `GET/POST/DELETE /dial/relationships` handlers? (Part 1 Phase B builds them.)
2. Does `dial_archetype_positions` have an `is_guest` column and the `dap_guest_not_default` CHECK? (Part 2 Phase 1.)
3. Do the guest endpoints `POST /dial/positions/guest` and `DELETE /dial/positions/guest/:id` exist? (Part 2 Phase 3.)
4. In prod (via the Cloud SQL Auth Proxy, read-only queries): row counts for `dial_archetype_positions` and `dial_coffee_relationships`, and whether the seeds in `backend/src/db/seeds/` (`archetype_assignments_base.sql`, `dial_positions_base.sql`, `dial_relationships_base.sql`, `dial_seam_positions.sql`) appear applied (e.g. ~26 positions incl. 3 `is_guest=true` rows, ~50 relationship rows incl. the category_hop pair).
5. What `AdminDial.tsx` currently renders (expected: the Navigation-Hops-only table from change #66).

**Prerequisite rule:** if (1)–(3) are missing, execute `CLAUDE_CODE_PROMPT_BLOOM_DIAL_BASE_DATA_PART1_SEED_AND_HOPS.md` and `..._PART2_SEAM_POSITIONS.md` first, as written, in that order. Do not re-implement their content differently here. Seed files that already exist need not be regenerated — but flag any drift between a seed file and the workbook. If (4) shows seeds not applied, list the exact `psql` run order for Dana; do not run write-DDL/DML against prod yourself without her go-ahead in the session.

---

## Part A — Backend: one graph endpoint

Add `GET /api/admin/dial/graph` to `admin.ts` (behind `requireAdmin`). One call powers the whole page:

```jsonc
{
  "dimensions":  [ { "id": 5, "name": "Acidity", "platformAxis": "Brightness" }, ... ],   // the 4 dial dimensions: 5,6,7,9
  "archetypes":  [ { "archetype": "balanced_sweet", "label": "Balanced & Sweet", "dominantDimensionId": 5,
                     "vocabulary": [ { "id": ..., "sortOrder": 1, "label": "Smooth" }, ... ] }, ... ],
                  // from dial_archetype_config (is_archetype = true only) + dial_position_vocabulary
  "positions":   [ { "id": ..., "coffeeId": ..., "coffeeName": "Guatemala", "roaster": "Temecula Coffee Roasters",
                     "archetype": "balanced_sweet", "vocabularyId": ..., "sortOrder": 2, "isDefault": true,
                     "isGuest": false }, ... ],
  "relationships": [ { "id": ..., "fromCoffeeId": ..., "toCoffeeId": ..., "toCategoryId": null,
                       "dimensionId": 7, "direction": "more", "delta": 1, "hopType": "bridge_archetype",
                       "isRecommended": true, "confidence": "medium", "notes": "...",
                       "fromAvgScore": 8.5, "toAvgScore": 10.0 }, ... ],
  "unplaced":    [ { "coffeeId": ..., "name": "Kopi Safari", "roaster": "...",
                     "proposedArchetype": "earthy", "category": "Experimental" }, ... ]
                  // coffees with a current archetype_assignment but no dial position, + their coffee_category tag
}
```

- `dimensions` must be **derived, not listed**: the distinct `dominantDimensionId`s from `dial_archetype_config` unioned with every `dimension_id` present in `dial_coffee_relationships`, joined to `coffee_dimensions` for names. The ids 5/6/7/9 above document today's data — they must not appear as a literal list anywhere in the code.
- `fromAvgScore` / `toAvgScore`: merged cupping averages on the hop's own `dimension_id` via the existing `getAvgCuppingScore` in `services/dialSuggestion.ts` — `null` when no cupping data. Batch these lookups (one query joining `cupping_score_values`, not N+1 calls) but reuse the same score definition; do not fork the logic. These two numbers let the UI flag hop-vs-cupping contradictions in place.
- Include `category_hop` rows (with `toCategoryId` set, `toCoffeeId` null) — the UI renders them read-only.
- Do not remove or change the existing granular endpoints; the matrix on AdminCoffees keeps using them.

**Writes reuse what exists — build nothing new for writes:**

| Action in the new UI | Endpoint (existing / from Parts 1–2) |
|---|---|
| Move a coffee's slot, toggle default | `PATCH /api/admin/dial/positions/:id` (change #65) |
| Add / remove a home position | `POST /api/admin/dial/positions`, `DELETE /api/admin/dial/positions/:id` |
| Add / remove a guest position | `POST /api/admin/dial/positions/guest`, `DELETE /api/admin/dial/positions/guest/:id` (Part 2) |
| Add / delete a hop | `POST /api/admin/dial/relationships`, `DELETE /api/admin/dial/relationships/:id` (Part 1 — incl. its within/bridge archetype validation, 409 on duplicate, cupping soft-warning, category_hop rejection) |

---

## Part B — Frontend: rebuild `AdminDial.tsx` as the two-lens page

Route stays `/admin/dial`, nav label stays "Bloom Dial", inside the existing `AdminLayout`. Follow existing admin fetch patterns (`frontend/src/app/lib/api.ts`). The current Navigation-Hops table is retired; hop CRUD moves into the map (note this in the writeup — it's a deliberate replacement, not a regression).

### B1. Map lens (default view)

Replicate the mockup's board:

- **Lanes** top→bottom ordered so lane adjacency mirrors seam adjacency. **Derive the order** from the archetype adjacency data (`v_archetype_adjacency`, already exposed via `GET /api/axis/adjacency`): order archetypes along the adjacency path (with today's data that yields Floral, Fruity, Balanced & Sweet, Chocolate & Nutty, Earthy). If the adjacency graph is ever not a clean path, minimize non-adjacent bridge crossings and note the tie-break rule chosen. The archetype list, labels, and order come from data — never a hardcoded array.
- Each lane: archetype name + dominant-dimension chip on the left; **one socket per `dial_position_vocabulary` row** for that archetype, left→right by `sortOrder` (currently 4 each — render whatever count the data returns), slot number + label under each. Coffee **pills** in their socket (roaster badge P/T, ★ on default, dashed pill + "guest" tag for `isGuest` rows). Empty sockets: amber-tinted "open" treatment when neither home nor guest occupies them.
- **Hop arcs** in an SVG overlay, colored by dimension — Acidity `#2a78d6`, Body `#eb6834`, Bitterness `#1baf7a`, Savory/Depth `#4a3aa7` (validated palette; keep these). The color map is a presentation constant keyed by dimension **id**, with a defined fallback color for any dimension id not in the map — it must never be the thing that decides which dimensions exist. Within-archetype arcs dip below the lane; bridges curve between lanes; non-adjacent-lane links route around the left margin; the category hop drops to the shelf. Line style: solid = recommended primary; dashed = `is_recommended=false` (secondary); the mockup's "weak" dotted style applies to `is_recommended=false AND confidence='low'`. Opacity by confidence. Arrowheads both ends when the reverse row exists, single arrowhead otherwise.
- **Filters row:** dimension chips (All + the 4), toggles for Dial turns / Bridges / Guests. Hovering a pill highlights its hops and neighbors and dims the rest.
- **Off-dial shelf** at the bottom from `unplaced`, plus the "Experimental (category)" node the category hop points at.
- **Tooltips** on pills and arcs per the mockup (coffee: archetype, slot, default/guest/cupped, move count; hop: both names, dimension, direction, Δ, type, confidence, recommended, notes).

**Cupping-contradiction flag (new vs the mockup):** when a hop has both `fromAvgScore` and `toAvgScore` and the sign of `(to − from)` contradicts its `direction`, render a small warning glyph on the arc midpoint; tooltip shows both scores next to the claimed direction. This is display-only.

### B2. Edit mode (map)

An "Edit" toggle in the filter row. Read mode stays exactly as B1. In edit mode:

- **Move:** ← → arrows on each home pill (same interaction as AdminCoffees' matrix) → `PATCH` with the adjacent vocabulary id; disabled at the ends.
- **Default:** click the ★ (or empty star) on a home pill → `PATCH` toggle. Guests never show a star (server enforces; UI doesn't offer).
- **Add position:** an open socket in edit mode shows "+ place a coffee" → small popover listing coffees (searchable) → `POST /dial/positions` for a coffee of that archetype, or `POST /dial/positions/guest` when the chosen coffee's home archetype differs (label the choice explicitly: "add as guest — home stays at <archetype>"). Only offer guest placement on sockets whose lane is adjacent to the coffee's home archetype in the seam graph if that check is cheap from `graph` data; otherwise allow and let the admin decide (note which you did).
- **Remove:** an × affordance on pills in edit mode → `DELETE` (guest rows through the guest endpoint). Confirm dialog naming the coffee and slot.
- **Add hop:** "Add hop" button arms a two-click flow — click source pill, click target pill → dialog prefilled with the two coffees, hop type auto-derived (same archetype → `within_archetype`, else `bridge_archetype`, read-only), fields: dimension (the 4 only), direction, delta (default 1), recommended, confidence, notes. Creating the "more" row offers a checked-by-default "also create the reverse hop" that POSTs the mirrored `less` row. Surface the endpoint's cupping soft-`warning` in the success toast when present; on 409 show "this hop already exists."
- **Delete hop:** clicking an arc in edit mode opens its detail popover with a delete button (both directions offered when the reverse exists). `category_hop` rows: read-only, no delete/add in this UI.
- After every successful write, refetch `graph` and redraw — no optimistic partial state.

### B3. Journey lens

Clicking any coffee pill (read mode) opens the Journey view for it, replacing the board (tabs Map / Journey at top right; Esc or "← Map" returns; keep the mockup's breadcrumb **trail** of visited coffees).

- **Compass:** ego card centered (name, roaster, default/cupped, archetype + slot, guest note). Half-spokes assigned per dimension, "more"/"less" opposite ends. Axis geometry (E/W, S/N, SE/NW, NE/SW) is a presentation constant assigned to the data-derived dimension list in a stable order (dimension id ascending → today: Acidity E/W, Body S/N, Bitterness SE/NW, Savory/Depth NE/SW, matching the mockup); if the data ever returns a fifth dimension, distribute axes evenly rather than dropping it. Outbound hops as chips at radius Δ1/Δ2 on their spoke, connector styled like the map arcs; multiple hops on one spoke offset laterally; chips show target archetype + slot; clicking a chip travels (pushes to the trail and re-centers).
- **Dead ends:** empty half-spokes render the dashed hollow marker. In edit mode, clicking a dead-end marker opens the add-hop dialog prefilled with source = ego, dimension + direction = that spoke — target picked in the dialog. This is the "is this dead end deliberate or missing?" affordance.
- **Arrivals line** under the compass: inbound count and either "every arrival has a matching departure" or the list of one-way arrivals (computed client-side from the graph).
- **Horizon:** 1 / 2 / 3-turn control; BFS over directed hops; ring rows of reachable coffees with a path tooltip ("Guatemala → Brazil Santos → African Espresso Blend") and click-to-travel; a "beyond N turns" line listing what's unreachable within the horizon.

### B4. Audit strip (map, below the board — computed client-side from `graph`)

The five cards from the mockup, plus the roaster lens:

1. **Open range** — sockets with neither home nor guest (click pulses them on the board).
2. **Guest-held slots** — sockets covered only by a guest.
3. **One-way doors** — directed hops with no reverse row on the same dimension.
4. **Thin connections** — coffees with no hops at all, and coffees whose every hop is `is_recommended=false`.
5. **Unbridged archetype pairs** — archetype pairs with no bridge hop.
6. **Roaster filter** (new): one chip per **distinct roaster present in the graph data** plus All (today that's Path and Temecula — a third roaster must appear with zero code changes). Filtering re-renders board + arcs + audits restricted to that roaster's coffees — the per-roaster view directly shows what a single-roaster order can reach (this matters because fulfilment prefers one roaster per delivery). Cross-roaster hops render ghosted, not hidden, in a filtered view.

---

## Constraints & conventions

- **Everything data-driven — no domain literals.** This is a hard requirement, not a style preference. The concept mockup embeds its data because it is a backendless drawing; none of that carries over. Every archetype, label, vocabulary word, slot count, coffee name, roaster, dimension, and hop on the page comes from `GET /api/admin/dial/graph` (or the adjacency endpoint for lane order). The page renders correctly — empty lanes, empty shelf, no arcs, no crash — against an empty database. The only allowed constants are presentation tokens: the dimension→color map and compass axis geometry (both keyed by dimension id with defined fallbacks), spacing, and styles. Note the systemic effect: this page reads the same tables the other admin surfaces write — cupping scores entered in AdminCupping drive the contradiction flags, positions edited in AdminCoffees appear here on refetch, vocabulary/config seeds define the sockets. One source of truth, several views of it.
- **Reuse, don't fork** (standing project rule): AdminLayout, api.ts helpers, existing endpoints, existing admin styling patterns. AdminCoffees' matrix keeps position editing; both UIs hit the same endpoints, so no logic duplication — do not extract/rewrite AdminCoffees in this task.
- **Type-check explicitly:** `vite build` alone is not proof — run `tsc --noEmit` for the frontend and fix what it finds.
- No new logging/metrics beyond existing patterns (observability policy).
- No schema changes beyond what Parts 1–2 already define.
- Keep the page desktop-first; horizontal scroll on narrow viewports is acceptable (admin-only page).

## Verification checklist

- [ ] `GET /api/admin/dial/graph` returns all five keys with counts matching prod (positions incl. guests; relationships incl. the category pair; unplaced = the off-dial coffees).
- [ ] Map renders all lanes/sockets/pills/arcs from live data; dimension filter + type toggles work; guest pills dashed; open sockets amber.
- [ ] Edit mode: move/default/add/remove position, add/remove guest, add/delete hop (with reverse-row option) all round-trip against the real backend and redraw from a refetch.
- [ ] Within/bridge misclassification is impossible from this UI (type auto-derived) and the server still rejects a mismatched POST (Part 1 validation) — test one forced bad request.
- [ ] Journey: compass for a default coffee (e.g. Guatemala TCR) matches its hop rows exactly — every outbound hop on the right spoke, dead ends marked; horizon 3 from Guatemala shows the Path catalogue beyond reach (expected with current data).
- [ ] Dead-end click in edit mode opens the prefilled add-hop dialog; creating the hop removes the dead-end marker after refetch.
- [ ] Cupping-contradiction glyph appears only when both scores exist and disagree with direction (may be zero cases today — verify by temporarily faking scores in a local check, not in prod).
- [ ] Roaster filter: Path-only view shows its islands (floral on one weak link; no fruity beyond Ethiopia) — matches the audit numbers.
- [ ] AdminCoffees matrix still works unchanged; Liam (`sommelierRag.ts` / `v_dial_navigation`) unaffected — confirm, don't change.
- [ ] **No-hardcode grep:** search the new frontend code for coffee names, archetype keys, vocabulary labels, roaster names, and the literal dimension-id list — none may appear outside the dimension→color/axis presentation constants. Then verify live that a position change made in AdminCoffees shows up on this page after refetch.
- [ ] `tsc --noEmit` clean; `vite build` clean; browser click-through of both lenses + one full edit of each kind (Playwright or manual, per repo convention).

## Out of scope

Customer/traffic overlays (dial events), per-customer routing weights, perceived-vs-cupped delta calibration, category-hop authoring, auto-computed positions from cupping, any change to the public Bloom dial, and any pricing/fulfilment logic (the roaster filter is a view, not an allocation change).
