# Brief: Website 6 — The Axis

**Workstream:** website_handoff · **Date:** 2026-11-04 · **Model tier:** cheaper/faster · **Mode:** test, then push · **Depends on:** brief 1.

Read first: `README.md` (merge rule, D7, D11), `HANDOFF_SURVEY_2026-11-04.md` §4, `backend/src/features/the_axis_page/` (THE_AXIS_REDESIGN_STRATEGY.md, THE_AXIS_PAGE_COPY_V2.md: the approved copy and the competitive-safety rule), `TheAxis.tsx` header comment, `DEVELOPMENT_GUARDRAILS.md`.

Design source: `misc/design_documents/website/axis-and-bloom-handoff/source/axis/build.py` (generator: chapters, panels, helpers `origin_list`, `two_streams`, `family_bands`, `wheel`, `readers`; `region_map`/`circles_map`/`CIRC`/`CDOTS`/`EDGES`/`REGIONS` are unused and are not ported) and `source/axis/index.html` (CSS). Media `source/axis/media/`. `source/axis2.svg`, `axis3.svg` are reference art, unused.

## Goal

`/the-axis` is the handoff page: intro bar + chapter nav, hero with the origin list, four chapters with their panels, "Start here", on the new chrome. The live numbers the current page shows stay live; the world map, scroll stages and CTA animation are retired (D7).

**Decisions already made:** D7 · the Liam accordion ("What Liam can and can't see") uses the current live Liam expander copy from `TheAxis.tsx` · `?archetype=` focus highlights the family band · region dot counts are the real coffee counts per origin region · no numeric scales, dimension names or formulas appear on this page (competitive-safety rule, unchanged).

**Guardrails.** G4.1 reuse chrome primitives, `reportError`, the accordion pattern if one exists · G4.2 nothing typed in: region counts, last-tightened date, the stats line, family names/colours from the API · G4.3 · G4.4 rewrite the flagged comparative lines · G4.6 route stays gated · G3.1 if the stats endpoint is extended, route → service · G1.6. Schema: none (a view extension only if the per-region count needs one; then G2.4/G2.17 apply). STOP: none.

## Task 0 — verify first (findings into `CLOSING_REPORT_6.md`)

1. Read `TheAxis.tsx`, `AxisMap.tsx`, `worldOutline.ts`, the `/api/axis/stats` route and service: list every field returned and where each is shown today; list the current copy per stage (it is the approved copy; the handoff reuses it almost verbatim, report every difference).
2. Read `build.py`: chapters, panels, the `REGION_COUNT` values (7/7/8/7) and their region names; the wheel segment counts (6/5/5/5/6, 3 hollow); the accordion placeholder `[ Dana's answer goes here ]`.
3. Find the per-region coffee count source: `coffees.origin_region_id` → `lookup_value` category `origin_region` joined to sellable coffees (`v_coffee_sellable_slot`). If the four handoff regions do not match the lookup's regions, the page shows the lookup's regions (the data, not the mock).
4. Confirm the three photos are not already in the bucket.

## Task 0.5 — Dana's manual steps

Upload `axis-story.jpg`, `axis-bowl.jpg`, `axis-start.jpg` to the reported `raw/` paths. Not a pause point.

## Part A — data

Extend `GET /api/axis/stats` (same service) with `originRegions: [{label, coffeeCount}]` from the view Task 0 names; keep every existing field (the stage-5 numbers are reused). If a new view is needed: `v_axis_origin_region_count`, comment, catalog regenerated.

## Part B — the page

- **Intro bar + chapter nav** (01–04 anchors, scroll-spy marks the current chapter, not sticky, as drawn).
- **Hero**: H1 and the two leads as drawn; `origin_list` from `originRegions` (dot rows = `coffeeCount`, animated in on view, reduced motion = static); "Map last tightened {lastTightenedAt}" formatted with `formatCalendarDate`.
- **01 Origin**: text, accordion, pull quote, `two_streams` panel with the two framed photos (`Frame`) and captions.
- **02 Place**: the five bands from `/api/coffees/archetypes` (`is_archetype`, `sort_order`, colour, `description`); hover/focus shows the description; the text column's list items highlight the band (keyboard too); `?archetype=` pre-highlights one band and scrolls to the chapter.
- **03 Network**: the family wheel; segment counts = `coffeeCount` per archetype from the stats endpoint (not 6/5/5/5/6), hollow segments = `experimentalCount` capped to what fits; the segment paths come from the wheel SVG as an asset in `components/axis/` (not scraped at build time).
- **04 Readers**: `readers()` wheel with Quiz / Profile / Liam labels; the accordion with the live Liam copy; last line of the chapter = the current stage-5 stats line ("{n} Bloom Notes this month · {n} positions refined this quarter") in `Caps`.
- Any "seven questions" line renders `facts.questions` from `GET /api/home/content` (D15).
- **Start here**: quiz `Btn` → `/find-my-flavor`, "Free to take." (drop "No commitment." if Dana's copy file does not have it; keep what THE_AXIS_PAGE_COPY_V2 says), photo.
- Retire `AxisMap.tsx`, `worldOutline.ts`, `JourneyStep` and the bag handoff animation; delete only if no other page imports them (Task 0 checks `Home`, the quiz result, Profile).
- Panels sticky on desktop as drawn; widow fix as a small util reused from brief 3 if one was made there.

## Part B2 — Bloom follow-ups from Website 5 (decided 2026-11-05)

1. **OT-82, raw-name fallback.** `GET /api/coffees/other-categories` (read by `OtherCategoryCard` on Flavor Intelligence) still falls back to the raw `coffees.name` when a category coffee has no customer name. Apply the OT-70 rule there too (customer name, else home slot name, else not listed), through the existing reader; no customer surface may show `coffees.name` (G4.5). Close OT-82.
2. **Opening stop on `/bloom`.** Today a family opens on its default slot even when that slot has no sellable coffee ("Coming soon" is the first thing a visitor sees on Floral, Fruity, Earthy). Rule: open on the default slot when it is sellable, else on the sellable stop nearest to it (lower index first on a tie); a saved position or a deep link still wins. Uses `useSlotAvailability`; no typed numbers. One test per branch.

## Part C — copy register

Rewrite and list: "This isn't a brochure" · "AI with a vibe" · "Most coffee shopping asks you to trust adjectives" (comparisons/negatives, G4.4). Keep the rest as the approved copy.

## Part D — tests

vitest: regions and counts render from a mocked payload; the band highlight follows `?archetype=`; the stats line renders; accordion keyboard operable; reduced motion disables the dot animation.

## Acceptance

Live `?preview=true` 390/1280 screenshots of every chapter; `/the-axis?archetype=floral` highlights Floral; no number on the page that is not from the payload (grep the component for digits in JSX and justify each).

## Docs and closing

`WHAT_WE_BUILT.md`, `REGRESSION.md` (live counts, focus param, Liam copy), `OPEN_TASKS.md` (none expected), `CLOSING_REPORT_6.md` with the `raw/` paths and the copy diff against THE_AXIS_PAGE_COPY_V2.

## Do not

- Do not show scales, dimension names, formulas or weights on this page.
- Do not keep the mock counts; do not leave the `[ Dana's answer goes here ]` placeholder.
- Do not add Google Fonts or scrape `bloom-b` at build time.
