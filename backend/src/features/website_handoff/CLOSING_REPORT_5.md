# Closing report — Website 5, The Bloom

**Status: shipped** (`WHAT_WE_BUILT.md` #255). Task 0 stopped once on two items with no home in the layout; Dana decided both on 2026-11-05 (S1 A, S2 A, the comfort-zone mapping and the server-side pill), and the run went on from Part A to push, deploy, startup log and production smoke. Production evidence is at the end.

Read for Task 0: `DEVELOPMENT_GUARDRAILS.md`, `CLAUDE.md`, the brief, workstream `README.md` (merge rule, D3/D5/D9/D12/D13/D14), `HANDOFF_SURVEY_2026-11-04.md` §3, `the_bloom_page/…PART12_RESTORE_FEATURES_ON_DIAL.md`, `source/bloom-b/index.html` (all 480 lines), `BloomPage.tsx`, `DialArchetypeSection.tsx`, `BloomDial.tsx` (slider/keyboard/doors/reduced-motion parts), `RevealedPanel.tsx`, `usePositionCardData.ts`, `useCompatibility.tsx`, `doorConfig.ts`, `DoorBand.tsx`, `archetypeConfig.ts`, `lib/prelaunch.ts`, `services/compatibilityReads.ts`, `routes/coffees.ts` (`/:id/compatibility`), `routes/users.ts` (dial-position), and the live prod payloads `/api/coffees/archetypes`, `/experimental`, `/cards`, `/2903/dimensions` (read-only, via `axis-and-bloom-prod.web.app`).

---

## STOP items and decisions

### S1. Doors between archetypes. **Decided 2026-11-05 (Dana): A.**

The brief put `DoorBand` ("Turn the {neighbour} dial →") under the lineup. Two things the brief got wrong:
- **`DoorBand` is not a neighbour door.** It is the Part 21 band that unfolds the folded dial on the quiz result, the returning-user screen and Profile.
- **The real doors are switched off everywhere.** They are BloomDial's edge chips, driven by `data.doors`. `doorConfig.ts` has `DOORS_ENABLED = false` (Part 23 §A, Dana's kill switch: "hide the doors everywhere until the separate door-chain thread fixes the map").

**What shipped (A):** a door row under the Other block, as two `bf-btn` buttons "← Turn the {left} dial" / "Turn the {right} dial →". It is rendered only while `DOORS_ENABLED` is true and `data.doors` resolves. A door opens the neighbour's tab on the `resolveLandingSortOrder` stop. Today nothing shows, same as before. `DoorBand` is not used on `/bloom`.

### S2. Experimental. **Decided 2026-11-05 (Dana): A.**

- **Today Experimental is a sixth dial section on `/bloom`**, not part of Other Categories. People link to it: Liam's action links and Flavor Intelligence's links can carry `?archetype=experimental`.
- **With five tabs it had no home.**

**What shipped (A):** the Other block opens with an "Experimental" group of `SlotShopCard` compact cards. They show the same states as the lineup (prod: four "Coming soon" cards), and add-to-cart works once a slot is live, with source `bloom`. `?archetype=experimental&slot=n` scrolls to the group (`id="experimental"`) and marks that card. Experimental gets no tab and no wheel.

### Comfort-zone mapping. **Decided 2026-11-05 (Dana): as proposed, server-side.**

The handoff's 0–10 steps, multiplied by 1.5 for our 0–15 scale:
- **1 → 1.5.** That is `dimension_delta_slight`, the existing "slightly" threshold.
- **2 → 3.** That is the new `evidence_parameter` row `comfort_zone_edge_delta`: "At the edge".
- **3 → 4.5,** mapped to the existing `dimension_delta_significant` (4): "Outside" applies exactly when the sentence says "significantly".

`compatibilityReads.compareCoffee` returns `zone` from the largest absolute midpoint difference:
- greater than `significant` → `outside`;
- at least `edge` → `edge`;
- otherwise → `in`.

`zone` is null whenever the sentence is null. In that case the frontend falls back to the family level: same family → In, adjacent → At the edge, otherwise → Outside (`comfortZoneOf`).

---

## Feature inventory, ticked (Task 0.1)

Each line shows where the item lives now, then the evidence.

- [x] **Silent auto-save + pre-set from the saved position.**
  - Where: `FlowerWheel.onCommit` → `DialFieldLayout.commit` → `BloomPage.handleDialSelect` (unchanged: `setDialPosition(archetype, n)`, no trigger, signed in only). The wheel opens on the deep-linked slot, else the saved one (Phase D fetch kept), else the classic.
  - Evidence: `bloom.test.tsx` "a settled turn auto-saves silently…", "a deep-linked slot wins over the saved position…". `users.dialPosition.test.ts` on the test DB: the no-trigger body writes `user_bloom_dial_current_position` and no event.
- [x] **Explicit "Save to flavor memory" + "View in flavor memory ↗".**
  - Where: Caps links under the commerce line. Shown when signed in and on a real slot, as before; "Saved to flavor memory ✓"; resets per slot.
  - Evidence: test "explicit save sends explicit_save with source bloom…" checks the exact body `{trigger:'explicit_save', source:'bloom', coffeeId, platformName}`. Test DB: one `customer_dial_event` `explicit_save` row and one `user_saved_item` `dial_slot` row.
- [x] **Add-to-cart dial event.**
  - Where: the commerce line's "Add to cart · {price}", the lineup cards and the classic quick pick, all through `cartItems.dialCartItem` + `syncDialAddToCart` with source `bloom`.
  - Evidence: test "add to cart…" (`add_to_cart`, source `bloom`, coffeeId). Test DB: one `add_to_cart` row.
- [x] **Weight/price selector, unpriced, unavailable, coming-soon states.**
  - Where: weight chips when there is more than one price (`useSlotAvailability`); the states "Price coming", "Temporarily unavailable" and "Coming soon" in Caps, none of which can be added. The shipping line comes from `GET /api/checkout/rules`: "Free shipping" or "Free shipping with {n} bags" (D13; replaces the typed "shipping included").
  - Evidence: test "weight chips… coming soon…".
- [x] **Quick picks (classic, Collection with discount).**
  - Where: a row under the lineup. The Collection discount is `collectionPct(offer)`, computed from the offer itself (the typed "10% off" is gone from both layouts). Hidden while gated.
  - Evidence: test "lineup…quick picks…" ("3 coffees · 10% off · $82.80" from sum 9200 / discounted 8280); the gated test.
- [x] **Compare overlay.**
  - Where: "Compare with the neighbour ↗" in the reveal footer (effectively active slots only, as before) → the same `CompareOverlay`.
  - Evidence: the reveal test renders the footer.
- [x] **Reveal: compatibility badge + why-sentence.**
  - Where: the comfort-zone aside (pill + the server sentence).
  - Evidence: test "the pill follows the server zone…".
- [x] **Reveal: TastingNotes.**
  - Where: reveal left, "In the roaster's words".
  - Evidence: the reveal test.
- [x] **Reveal: DimensionBars.**
  - Where: reveal right, end words from the payload (`variant="field"`).
  - Evidence: the reveal test.
- [x] **Reveal: collaborative wheel.**
  - Where: under the bars in a `<details>` "See the notes wheel", collapsed by default.
- [x] **Reveal: guest line.**
  - Where: "Find your flavor to see your match ↗" in the aside.
  - Evidence: test "guest…".
- [x] **Archetype order personalization + YOUR / TO EXPLORE kicker.**
  - Where: tab order from `/api/coffees/archetype-order`, the kicker in caps on each tab. The field waits for the order, so a known family opens first without a flicker.
  - Evidence: tests "five tabs in the personalized order…" and "Your" kicker.
- [x] **Doors between archetypes.** See S1: drawn, and gated by the kill switch.
  - Evidence: test "…no doors while switched off".
- [x] **`?archetype=&slot=` deep links (Liam, FI, the quiz).**
  - Where: the tab is URL state; `&slot=` selects the stop and wins over the saved position. Links followed while already on `/bloom` are handled too. `archetype=experimental` → S2.
  - Evidence: the deep-link tests, including Experimental.
- [x] **Three-beat strip (`hasTurnedDial`).**
  - Where: the strip is now the handoff's "01 Pick your family · 02 Turn the dial · 03 Meet your coffee". The wheel's hint line ("← Less {measure} · {first}" / "More {measure} · {last} →") hides after the first turn or for a customer with a saved position (same rule, same `axisbloom.hasTurnedDial` key).
  - Evidence: the auto-save test checks the hint disappears and the key is set.
- [x] **Sticky archetype nav.**
  - Where: sticky family tabs (`role=tablist`, ←/→ between tabs), scroll margin under them.
  - Evidence: test "a tab click switches the field; ←/→…".
- [x] **Other Categories.**
  - Where: the Other block after the quick picks; named category coffees only (OT-70) as `OtherShopCard`.
  - Evidence: test "Other block…" (the unnamed decaf is hidden, Night Owl is shown).
- [x] **Prelaunch gating.**
  - Where: `/bloom` stays behind `PrelaunchGate`; `prelaunch` (from `usePrelaunchGated`) hides add-to-cart, the quick picks, Ask Liam and Full breakdown.
  - Evidence: the gated test.
- [x] **`hasLiamAccess` gating.**
  - Where: "Unsure? Talk to Liam" in the aside and "Ask Liam ↗" in the reveal appear only with access and never while gated.
  - Evidence: test "guest… Liam with access…".
- [x] **`role=slider`, keyboard, `aria-valuenow`, reduced motion.**
  - Where: the wheel's `<input type=range>` (native slider role) with `aria-valuenow` = stop and `aria-valuetext` = "2 · Classic"; ←/→/↑/↓/Home/End move one stop and commit; under `prefers-reduced-motion` the rotation is painted at once and CSS transitions are off.
  - Evidence: FlowerWheel tests (keyboard, reduced motion, animated otherwise; snapshots at t = 0 / .5 / 1).
- [x] **Experimental dial section** (found in Task 0). See S2.

Also from Task 0:
- [x] **The why-line**, now the lineup heading "The four {Family} coffees · From {min} to {max}." (real count via `numberWord`).
- [x] **Error / loading states.** A paper block with `aria-busy` while loading; "The coffees did not load. Refresh the page to try again." if the catalogue fails.

---

## What was built

See `WHAT_WE_BUILT.md` #255 for the file list. In short:
- **Part A:** `FlowerWheel` (the 27 petals ported by script from the handoff SVG; `tints()`; drag, slider, keys, reduced motion).
- **Part B:** `DialArchetypeSection layout="field"` (`DialFieldLayout`, `ComfortZoneAside`), `RevealedPanel variant="field"`, compact selectable `ShopCoffeeCard`, the rewritten `BloomPage`.
- **Part C:** the `comfort_zone_edge_delta` row and `zone` on `compareCoffee`.
- **Part D:** the tests below.

**Reuse, no forks (G4.1, G3.9).** The slot logic moved unchanged from `DialArchetypeSection` into `useDialSlot.ts`, and both layouts call it. Also reused unchanged:
- `RevealedPanel`, `TastingNotes`, `DimensionBars` and `useCompatibility`, each extended with a variant or field;
- `CompareOverlay`, `cartItems`, `useSlotAvailability` and `usePositionCardData`;
- `ShopCoffeeCard` / `SlotShopCard` / `OtherShopCard`, plus `familyLookOf`, which moved from `ShopAll` to be shared;
- `useCheckoutRules` / `shippingCentsFor`, and the chrome primitives.

**G2.4 CATALOG.md check.** No table or view was added. The only schema change is one seed row in `evidence_parameter`, the table that already holds the compatibility thresholds and is read by `compatibilityReads`; `commerce_parameter` was considered and does not fit (business numbers of checkout). `comments.sql`: the `evidence_parameter` table comment lists the new key. `CATALOG.md` is regenerated from prod after the deploy.

## Deviations from the brief (and why)

1. **Category coffees use `OtherShopCard` instead of `OtherCategoryCard`.** `OtherCategoryCard` reads `/api/coffees/other-categories`, which still falls back to the raw `coffees.name`. That breaks the OT-70 rule the brief cites, so I took the coffees from `/cards` `other` (OT-70 applied) and drew them with Website 4's handoff-style card. `OtherCategoryCard` stays for Flavor Intelligence. The leftover fallback is OT-82.
2. **No "optional note"** in the reveal. The handoff's per-coffee `note` has no source field (D9: nothing typed). The left column shows the roaster's words alone.
3. **State words.** A slot with no coffee says "Coming soon" and an unpriced one "Price coming", the same words as the lineup cards (Website 4). The dial used to say "Temporarily unavailable" or "Unpriced" for these; "Temporarily unavailable" is kept for a priced coffee that no roaster can fill right now.
4. **"Take the quiz" sits at the end** of the lineup section, after the doors, in the brief's order. The handoff draws it in the lineup header.
5. **The sticky tab bar caps the handoff's 56px tab type at 38px** so the stuck bar does not cover the field. The handoff's `.fmenu` is not sticky; the brief makes it sticky.
6. **"From the roaster · cupped by us"** (handoff line under the spec) is left out. It would be a claim on coffees we have not cupped.

## Copy for Dana to review in place (G4.4)

All of it is positive register, with no "not X, but Y".
- **Brand lines from the handoff:** "Turn the dial. Each stop is a coffee." · "01 Pick your family · 02 Turn the dial · 03 Meet your coffee" · "Your comfort zone" · "From your quiz" (the handoff says "From your quiz & set-up"; there is no set-up yet) · "Unsure? Talk to Liam" · "Not sure which family is yours? Take the quiz ↗".
- **Pill words (the handoff's):** "In your comfort zone" / "At the edge of your comfort zone" / "Outside your comfort zone". The last one is an honest state label, allowed by G4.4.
- **New lines:** "Compare with the neighbour ↗", "Free shipping with {n} bags", "The coffees did not load. Refresh the page to try again."

## Evidence

**Tests (test DB for the backend, G5.1):**
- **Frontend vitest: 67/67.** That includes the new `bloom.test.tsx` (19); Shop all's 12 still pass with the card extensions.
- **Backend:** `coffeePresentation2.test.ts` 12/12, with the 2 new comfort-zone cases:
  - seeded at 3, and ordering is enforced both ways;
  - the zone is in / edge / outside at differences of 2 / 3 / 4 / 4.5, and moving the parameter moves the pill.
- **Backend:** `users.dialPosition.test.ts` 1/1: the three request bodies the page sends, against the real router on `axisandbloom_test`, give these rows:
  - silent → position only, no event;
  - `explicit_save` → event + saved item;
  - `add_to_cart` → event.
- **Full backend suite** (`npx vitest run`, test DB): 1137 passed, 8 failed out of 1145.
  - **7 are the known baseline (G1.12):** 6 `quizScoring` tie-break cases, plus `schema.catalog_blueprint` `dial_position_signal.suggested_slot_id` (OT-73).
  - **The 8th was this brief's:** `comments.format` caught the `evidence_parameter` table comment at 1030 characters, over the 1000 hard stop. I shortened two phrases in it, and it is now 999 characters and passes (9/9 on rerun). Nothing was dropped: the key list, readers and writer are all still there.
- **CI lints, all exit 0:** `lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:cupping`, `lint:lineage`.
- **Type-checks:** backend `tsc --noEmit` clean. Frontend `tsc --noEmit` adds no new error; the known set is unchanged: `ArchetypeSection.tsx` `hops`, `useAdjacentArchetype.ts`, `Profile.tsx` `address_type`, `TheAxis.tsx`. `vite build` is clean.

**Local acceptance (backend on `axisandbloom_test`, Vite :5179, headless Chromium):**
- `/bloom?preview=true&archetype=chocolate_nutty&slot=2` and `&archetype=floral&slot=1` at 390 and 1280: no horizontal scroll (scrollWidth = viewport).
- The field, reveal and lineup match the handoff.
- The reveal on Light Floral Edge (coffee 2903) shows the roaster's words, three bars with end words, the notes wheel collapsed, and the footer links.
- `GET /api/coffees/2903/compatibility?userArchetype=floral` returns `zone: null, reason: below_min_coffees` (the test DB has one cupped Floral coffee), so the family-level fallback applies.
- **Console:** only Firebase/App Check 403s, plus a 500 from `/api/users/profile`, which is the local Firestore write guard refusing the anonymous guest's profile write (dev only, by design; never bypassed).

**What is not covered, and why:**
- **The signed-in save in a real browser, and the signed-in check after deploy (G4.3).** Signing in headless needs a real Firebase Auth user, and Firebase Auth is shared with production. Creating or re-enabling one was not in this brief, so I did not do it. The test-DB router test above and the frontend body assertions stand in for it.
- **Dana's own browser (G4.3):** a signed-in pass with a turn, a save, then `/profile` flavor memory, and a Liam action link from `/sommelier` landing on its stop.

**Production (2026-11-05):**
- **Commit and deploy:** `8423d55` pushed to `main`; Deploy run 42098741457 green (backend + frontend); Cloud Run revision `axis-bloom-backend-00824-mhr` (us-central1).
- **Startup log** (55 lines, two boots):
  - 0 ERROR.
  - `[data-catalog] report only: 155 tables, 77 views, 1414 columns`. The one new finding was check #4 "CATALOG.md stale", expected because the `evidence_parameter` comment changed; `CATALOG.md` was regenerated from prod with `npm run catalog:md -- --expect-db axisandbloom` and now matches the live catalog-hash `79c85f22e346…`.
  - All other findings were already on the previous revision `00823-d5x`: data-catalog #6 (25 dead-table candidates), evidence-integrity #2 / #6, quiz-integrity #10, sommelier-integrity #3.
- **Smoke:** headless Chromium against `https://axis-and-bloom-prod.web.app/bloom?preview=true` (the same build as www, without Cloudflare), signed out, at 390 and 1280. Every family's field, reveal (where the slot has a coffee) and lineup was captured.

| | Floral | Fruity | Balanced | Chocolate & Nutty | Earthy |
|---|---|---|---|---|---|
| Opens on | 2 · Balanced, Perfumed & Expressive, Coming soon | 2 · Balanced, Bright & Tart, Coming soon | 2 · Balanced, Classic Balanced, Add to cart · $29.00 | 2 · Classic, Coado (Premium ★), Add to cart · $32.00 | 2 · Earthy, Grounded & Earthy, Coming soon |
| Lineup | The four Floral coffees, 4 cards | The four Fruity coffees, 4 | The four Balanced coffees, 4 | The four Chocolate & Nutty coffees, 4 | The four Earthy coffees, 4 |
| Reveal | (no live coffee on the stop) | (none) | roaster's words + bars | roaster's words + 8 bars with end words | (none) |

Same results at both widths:
- No horizontal scroll; no page errors; no door row.
- The aside shows "Find your flavor to see your match" (signed out).
- `/bloom?archetype=fruity&slot=2` lands on Fruity with `aria-valuetext` "2 · Balanced".
- **Keyboard-only turn:** the slider has focus (`type=range`), ArrowRight moves "1 · Lighter" to "2 · Classic".
- `?archetype=experimental&slot=2` scrolls to the Experimental group (4 cards, all "Coming soon") and marks card 2.
- Live `GET /api/coffees/2903/compatibility?userArchetype=floral` returns `zone: null, reason: below_min_coffees`. The field is deployed; Floral has one cupped coffee, so the family-level pill applies.
- Balanced's field takes its `#912f2f` ink (`fieldLook` override).

**Observations, for Dana (no change made):**
- Floral, Fruity and Earthy open on their classic stop (slot 2), and that slot has no coffee on prod today, so the first thing a visitor sees there is "Coming soon". The old dial opened on the same stop: the wheel keeps the classic-first rule (`computeDefaultSortOrder` / `isDefault`). Floral's and Fruity's only live coffees sit on stop 1. If you'd rather open on the first live stop, that is a one-line rule change in a later brief.
- "Save to flavor memory" also shows signed out. The site gives every visitor an anonymous Firebase identity, and the old dial's rule was `user && real slot`; kept as is.


## What the next brief needs

- **7B (quiz result) and a later Profile brief** move their surfaces to `layout="field"` or a compact variant of it. After that, OT-79 removes `BloomDial.tsx` and the `dial` layout.
- **Comfort-zone parameter.** `comfort_zone_edge_delta` is admin-editable on the Evidence parameters card. It must stay between slight and significant, or the change is refused.
- **Open tasks:** OT-79 (retire the old dial), OT-80 (per-user profile + match %), OT-81 (wheel a11y audit), OT-82 (`/other-categories` raw-name fallback), OT-83 (pill and state words in code).
