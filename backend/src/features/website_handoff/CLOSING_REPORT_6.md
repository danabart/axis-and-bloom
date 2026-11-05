# Closing report — Website 6, The Axis

**Status: shipped** (`WHAT_WE_BUILT.md` #256). Task 0 stopped once, because the data contradicted the brief on the Place bands. Dana decided S1 A and S2 A on 2026-11-05, and the run went on from Part A to push, deploy, startup log and production smoke. Production evidence is at the end.

Read for Task 0:
- `DEVELOPMENT_GUARDRAILS.md` (unchanged since `3b7f084`) and the brief.
- Workstream `README.md` (merge rule, D7, D11, D15) and `HANDOFF_SURVEY_2026-11-04.md` §4.
- `the_axis_page/THE_AXIS_PAGE_COPY_V2.md` (all of it) and the header comment of `TheAxis.tsx`.
- `source/axis/build.py` (all 532 lines; the CSS is generated there).
- Code: `TheAxis.tsx`, `AxisMap.tsx`, `routes/axis.ts`, `services/coffeeCardReads.getOtherCategoryCoffees`, `lib/calendarDate.ts`, `home/Voices.tsx`, `design/assets.ts`.
- Data:
  - prod, read-only, through the public API only: `/api/axis/stats`, `/api/coffees/archetypes`, `/cards` and `/other-categories`. A direct prod database read was refused by the session's permission check, so nothing here comes from one.
  - The test DB (`axisandbloom_test`, the prod clone), read-only.

---

## Decisions

### S1. The Place bands' text. **Decided 2026-11-05 (Dana): A, the three words.**

The brief decided "`description` from the API" for the bands. The data (`v_coffee_archetype.description`, prod clone):

| Family | `description` | Approved one-liner (COPY_V2) | Shown now (three words) |
|---|---|---|---|
| Floral | **NULL** | delicate, aromatic, refined. | Bright · Fragrant · Delicate |
| Fruity | "…You're here for the experience, **not just the caffeine**." | lively, juicy, full of movement. | Lively · Vibrant · Expressive |
| Balanced | "…easy, pleasant, and **never surprising**." | soft, rounded, effortlessly satisfying. | Easy · Smooth · Harmonious |
| Chocolate & Nutty | "A rich, bold, and comforting profile. You know exactly what you like and you like it satisfying." | rich, grounding, deeply comforting. | Full · Grounded · Comforting |
| Earthy | **NULL** | full-bodied, savory, expressive depth. | Deep · Bold · Lasting |

The bands (on hover or focus) and the 02 list show `customerWords` from `GET /api/coffees/archetypes`. The descriptions are logged as **OT-84**: a rewrite is needed before Website 7B reads them, since two are empty and two are off the copy rule.

### S2. Origin regions. **Decided 2026-11-05 (Dana): A.**

- **Source:** new view `v_axis_origin_region_count`: sellable coffees (`v_coffee_sellable_slot`, each coffee once) per `coffees.origin_region_id` → `lookup_value` `origin_region`, in the lookup's `sort_order`. Only regions with at least one coffee appear. The page shows the lookup's regions, not the handoff's four mock ones.
- **Prod today:** no sellable coffee has a region (OT-71), so `originRegions` is `[]`. The hero runs full width with "Map last tightened {date}" below it. The list appears by itself when regions are filled in the admin coffee edit.

---

## Task 0 findings (kept from the stop)

**`/api/axis/stats`:**

| Field | Prod value | Before | Now |
|---|---|---|---|
| `coffeesMapped` | 22 | not shown | not shown (kept in the payload) |
| `archetypes[]` | Floral 2, Fruity 8, Balanced 4, Chocolate & Nutty 5, Earthy 3 | AxisMap dots | 03 wheel segments |
| `connectionCount` | 2 | AxisMap edges | not shown (kept) |
| `regionAdjacency` | [] | AxisMap bridges | not shown (kept) |
| `experimentalCount` | 0 | AxisMap hollow nodes | 03 hollow segments |
| `bloomNotesThisMonth` | 0 | stage-5 line | 04 last line |
| `positionsRefinedThisQuarter` | 13 | stage-5 line | 04 last line |
| `lastTightenedAt` | 2026-10-25T02:37:54Z | hero + stage 5 | hero foot (`formatCalendarDate`, UTC calendar date: October 25, 2026) |
| `originRegions` (new) | [] | — | hero origin list |

The route's SQL moved into `services/axisStatsReads.getAxisStats` (G3.1). The old error path answered 200 with a typed `coffeesMapped: 29` and "last tightened" = now; it now answers 500, and the page hides its live lines.

**`build.py` → port:**
- **Chapters:** 01 Origin, 02 Place (flip), 03 Network, 04 Readers (flip), then Start here.
- **Not ported (as the brief says):** `region_map`, `circles_map`, `CIRC`, `CDOTS`, `EDGES` and `REGIONS`.
- **The family wheel:** the same 27 petals as Website 5's flower wheel, sorted by angle. The port reuses `bloom/wheel/wheelGeometry.ts` (Website 5's asset), so nothing is scraped from `bloom-b` and nothing is duplicated.
  - Deviation from the brief: the brief asked for "an asset in `components/axis/`". The asset lives in `components/bloom/wheel/` and `components/axis/axisWheel.ts` reads it.
- **Segment counts are data,** not the mock 6/5/5/5/6. Hollow segments are `experimentalCount`, capped to what is left; the rest stays open. Beyond 27 coffees each family's share becomes proportional (`allocateSegments`).
- **The readers wheel:** the handoff's three petals (angles 306, 54, 162).

**Photos:** none was in `gs://axis-bloom-assets`. Upload paths (Task 0.5, Dana / Camila):

| Handoff file | Upload to | Code key | Falls back to (until uploaded) |
|---|---|---|---|
| `axis-story.jpg` | `raw/axis/axis-story.jpg` | `axisAssets.story` | `lifestyleAssets.coffee15Vertical` |
| `axis-bowl.jpg` | `raw/axis/axis-bowl.jpg` | `axisAssets.bowl` | `lifestyleAssets.coffee15` |
| `axis-start.jpg` | `raw/axis/axis-start.jpg` | `axisAssets.start` | `lifestyleAssets.family` |

Home's `raw/home/axis-quiz.jpg` and `axis-cupping.jpg` (Website 3's list) are not in the bucket either.

---

## What was built

- **Part A (data):** `v_axis_origin_region_count` (schema + comment); `axisStatsReads.getAxisStats` (every existing field kept, plus `originRegions`); the route answers 500 on failure. The `lint-customer` rule-6 allow-list entry for the Bloom Notes count (an aggregate read of `user_flavor_feedback`) moved with the query from `routes/axis.ts` to the service. The read is unchanged, and the entry's comment says so.
- **Part B (the page):**
  - **Intro and chapter nav:** the intro bar, and a chapter nav that marks the chapter in view and is not sticky.
  - **Hero:** the H1, two leads and the origin list (dots animate in on view; static under reduced motion), plus the hero foot.
  - **01 Origin:** text, accordion and pull quote; the two framed photos with captions, and "From farm to first measurement."
  - **02 Place:** the five bands in `sort_order` with their three words on hover or focus. List items highlight their band (keyboard too); `?archetype=` pre-highlights one and scrolls to 02.
  - **03 Network:** the family wheel from the data.
  - **04 Readers:** the readers panel; the Liam accordion with the live copy; the stats line as the chapter's last line.
  - **Start here:** `Btn` to `/find-my-flavor`, "Free to take. No commitment." (in COPY_V2), and the photo.
  - **Panels:** sticky on desktop.
  - **Widow fix:** `lib/widow.ts`, shared with Home.
  - **Retired:** `AxisMap.tsx`, `worldOutline.ts`, `JourneyStep` and the bag handoff animation are deleted; only `TheAxis.tsx` used them.
- **Part B2 (Bloom follow-ups):**
  1. **OT-82 closed.** The reader already applied OT-70 since Website 4; the stale comment in `routes/coffees.ts` is corrected, and the rule stays pinned by `services/websiteShop.test.ts` ("without a customer name the coffee is not listed, and its raw name never appears"). `CLOSING_REPORT_5.md` deviation 1 now carries the correction.
  2. **Opening stop.** `useDialSlot.openingSortOrder` with `useSlotAvailability.slotSellable` (the same rule as the hook's `effectivelyActive`, over the payload, plus a coffee on the slot). The rule: the classic when sellable, else the nearest sellable stop (the lower one on a tie), else the classic. A saved position or a deep link still wins. On prod, Floral and Fruity now open on stop 1 (their live coffee), Earthy stays on its classic (nothing sellable), and Balanced and Chocolate & Nutty are unchanged.
- **Part C (copy):** below.
- **Part D (tests):** below.

**Accordion pattern:** a `<button aria-expanded aria-controls>` over a labelled region in the handoff's `.acc` style. The site had only bare `<details>`; a button gives explicit ARIA state. Keyboard: Enter/Space, as any button (checked in Chromium on prod).

**Colours:** family colours come from `ARCHETYPE_VISUALS`, as on every page so far; the API has no colour field. In the 02 list on white, Balanced's name uses its accent `#912f2f` (Website 5's `fieldLook` override) instead of the low-contrast yellow.

## Copy diff against THE_AXIS_PAGE_COPY_V2.md

**Part C, G4.4 rewrites (Dana to review in place):**

| Approved | Now |
|---|---|
| "This isn't a brochure about our system. It's a window into it — the same living map our recommendations, our sommelier, and your profile all read." | "This is a window into our system: the same living map our recommendations, our sommelier, and your profile all read." |
| "Most coffee shopping asks you to trust adjectives. We'd rather show you the work: how a coffee goes from…" | "Here is the work behind every cup we suggest: how a coffee goes from…" (rest unchanged) |
| "That's the difference between AI with a map and AI with a vibe. Liam can't recommend…" | "That's AI working from a map. Liam can't recommend…" (rest unchanged) |

**Other differences:**
- **§2 one-liners → the three words (S1).** Also, "every coffee is assigned to one of five sensory archetypes": "five" is now the count of families in the payload.
- **"Balanced & Sweet" (COPY_V2) → "Balanced"** (the data's label).
- **§5 "The loop" removed (D7).** Gone: the headline "A map that tightens itself.", its three paragraphs (Bloom Note, Taste Memory, "You're not shouting into a void…"), and the callout "Your coffee may change. Your flavor stays close to home." Only the stats line moves into 04. COPY_V2 calls that callout bag language to keep identical wherever it appears, so its removal from this page is for Dana to confirm.
- **§1 "→ Read more in Our Method."** stays out: the page does not exist, and the live page did not show the link either.
- **Emphasis (italics on "you", "is", "place", "neighbors", "build") dropped,** as the handoff draws plain text.
- **Liam accordion:** the live copy replaces the handoff placeholder `[ Dana's answer goes here … ]`.

## Numbers on the page (acceptance: every digit justified)

The rendered text of `/the-axis` on prod was scanned for digits (smoke script). Every one:
- **"01"–"04" (chapter nav, chapter numerals, "01 — Where the data begins"):** structure, the handoff's chapter numbering.
- **"Map last tightened October 25, 2026.":** `lastTightenedAt`.
- **"0 Bloom Notes this month · 13 positions refined this quarter":** `bloomNotesThisMonth`, `positionsRefinedThisQuarter`.
- **Region rows and dot counts:** `originRegions` (none on prod today).
- **"five" (02):** `families.length`.
- **"Three minutes." (Start here):** approved COPY_V2 copy; there is no quiz-duration data to read it from.
- **The wheel's `aria-label` counts:** `archetypes[].coffeeCount`, `experimentalCount`.

No scale, dimension name, formula or weight appears.

## Evidence

**Tests:**
- **Frontend vitest: 84/84.** That includes the new `axis.test.tsx` (11 cases):
  - regions and dots from the payload, and no list without regions;
  - `?archetype=floral` highlights the band and the list item and scrolls;
  - the bands' order and three words, and keyboard focus on a list item;
  - the stats line, and the live lines hidden on error;
  - the accordion's ARIA wiring and the live Liam copy;
  - reduced motion shows at once, and without it the dots wait for the view;
  - wheel segments per family, plus 2 `allocateSegments` cases.
- **Frontend:** `bloom.test.tsx` 25 (6 new opening-stop cases).
- **Backend `services/axisStats.test.ts`, 3/3 on the test DB:**
  - every field is kept, plus `originRegions`;
  - a region counts each sellable coffee once, in lookup order, and appears only with a coffee;
  - no coffee name or id is in the payload.
- **Full backend suite** (test DB): 1140 passed, 8 failed out of 1148.
  - **7 are the known baseline (G1.12):** 6 `quizScoring` tie-break cases, plus OT-73's `catalog_blueprint` case.
  - **The 8th, `scripts/lintCustomer.test.ts`, is a 5 s test timeout, not a violation.** The wrapper times out because `lint-customer.mjs` takes about 6.7 s on this machine, and the HEAD version of the script takes the same time. The lint itself exits 0 after the allow-list move, and CI runs the lint directly, not this wrapper. Logged as OT-85 (test hygiene, not a gate).
- **CI lints, all exit 0:** `lint:catalog`, `lint:retention`, `lint:customer` (after the allow-list move above), `lint:roastery-portal`, `lint:cupping`, `lint:lineage`.
- **Type-checks:** backend `tsc --noEmit` clean. Frontend `tsc --noEmit` adds no new error; the known set shrank to three files (`ArchetypeSection.tsx` `hops`, `useAdjacentArchetype.ts`, `Profile.tsx`), since the old `TheAxis.tsx` error went with the rewrite. `vite build` is clean.

**Local (backend on `axisandbloom_test`, Vite :5179, headless Chromium, 390 and 1280):**
- All five sections render; no horizontal scroll; no placeholder text.
- `?archetype=floral` highlights only Floral, with 02 at the top of the viewport.
- Enter on the focused Liam accordion button opens it.

**Production (2026-11-05):**
- **Commit and deploy:** `91ad45c` pushed to `main`; Deploy run 42109582359 green (backend + frontend); Cloud Run revision `axis-bloom-backend-00826-kst` (us-central1).
- **Startup log** (52 lines, two boots):
  - 0 ERROR.
  - `[data-catalog] report only: 155 tables, 78 views` (the new view included). The one new finding was check #4 "CATALOG.md stale", expected; `CATALOG.md` was regenerated from prod (`npm run catalog:md -- --expect-db axisandbloom`, catalog-hash `c1ae3c6d11d1…`) and committed after.
  - The other findings are the same as on revisions `00823`–`00825`: data-catalog #6, evidence-integrity #2 / #6, quiz-integrity #10, sommelier-integrity #3.
- **Live `GET /api/axis/stats`:** every earlier field, plus `originRegions: []` (OT-71: no sellable coffee has a region yet).
- **Smoke:** headless Chromium against `https://axis-and-bloom-prod.web.app/the-axis?preview=true` (same build as www, without Cloudflare), signed out, 390 and 1280. Screenshots of the hero, 01, 02, 02 with `?archetype=floral`, 03, 04 and Start here at both widths. At both widths:
  - no horizontal scroll, no page errors, no placeholder text;
  - the hero is full width (no regions yet) with "Map last tightened October 25, 2026.";
  - the bands are floral, fruity, balanced_sweet, chocolate_nutty, earthy, with the three words;
  - the wheel reads "Floral: 2, Fruity: 8, Balanced: 4, Chocolate & Nutty: 5, Earthy: 3" (no Experimental today, so no hollow segments);
  - 04 ends on "0 Bloom Notes this month · 13 positions refined this quarter";
  - `?archetype=floral` highlights only Floral, with 02 scrolled to the top of the viewport;
  - Enter on the focused "What Liam can and can't see" button opens it (`aria-expanded="true"`);
  - digits in the rendered text: only the chapter numbers and the payload values listed above.
- **Photos:** until the three uploads land, "The story" and "The cupping" both fall back to the same lifestyle photo (two crops of `coffee-15`), and Start here shows `lifestyle/family`.
- **The Bloom opening stop (B2)**, prod, signed out, `/bloom?archetype=<family>` with no slot:

  | Family | Opens on | Before |
  |---|---|---|
  | Floral | 1 · Delicate, Light Floral Edge (buyable) | 2, Coming soon |
  | Fruity | 1 · Mellow, Clean Fruit (buyable) | 2, Coming soon |
  | Balanced | 2 · Balanced, Classic Balanced (buyable) | same |
  | Chocolate & Nutty | 2 · Classic, Coado (buyable) | same |
  | Earthy | 2 · Earthy, Grounded & Earthy, Coming soon (nothing sellable, classic kept) | same |

**Not checked:** a signed-in pass in a browser (Firebase Auth is shared with production; no test user was created). The page has no signed-in-only behaviour. For The Bloom, a saved position winning over the opening stop is covered by `bloom.test.tsx`.


## Open tasks

- **OT-84:** archetype descriptions rewrite before 7B.
- **OT-71 (existing):** origin regions; it now also feeds The Axis hero.
- **OT-82:** closed.
