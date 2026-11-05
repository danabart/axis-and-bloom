# Brief: Website 5 — The Bloom (option B: one flower wheel, the field, the comfort zone)

**Workstream:** website_handoff · **Date:** 2026-11-04 · **Model tier:** strongest, dedicated session (the dial carries the most product logic on the site) · **Mode:** test, then push · **Depends on:** briefs 1, 2, 4 (the shared card and `/api/coffees/cards`).

Read first: `README.md` (merge rule, D3, D5, D9, D12, D13), `HANDOFF_SURVEY_2026-11-04.md` §3, `backend/src/features/the_bloom_page/` (parts 1–12, especially PART12 "restore features on dial": the list of features that were lost once already and restored), `backend/src/features/bloom_dial/`, `backend/src/features/coffee_presentation/CLOSING_REPORT_1.md` (reveal panel), `DEVELOPMENT_GUARDRAILS.md`.

Design source: `misc/design_documents/website/axis-and-bloom-handoff/source/bloom-b/index.html` (hand-written; the `FAMS` array in its script is the data shape; the SVG wheel with `data-thr`/`data-tier`/`data-ang` petals is the dial drawing; `paint()`/`spin()` the motion).

## Goal

`/bloom` becomes the handoff page: family tabs, the tinted field with the single flower wheel on the left, the coffee in the middle, the comfort-zone aside on the right, the two-column reveal, the lineup, on the new chrome. Every feature the current dial has survives, placed in the design's language. The wheel geometry is a component asset; everything it shows is data.

**Decisions already made (do not re-open):**
- One wheel for all families (handoff) replaces the per-archetype canvas dial **on `/bloom` only**. `BloomDial.tsx` stays in the repo for the quiz result and Profile until briefs 7B and a later profile brief move them; the new wheel is `components/bloom/wheel/FlowerWheel.tsx` and `DialArchetypeSection` gains `layout="field"`; the old layout stays selectable until no page uses it, then is removed in its own brief.
- Five tabs (D5). Experimental and the categories keep the current Other Categories block below the lineup and the doors.
- "Your comfort zone" = the existing server compatibility (`useCompatibility`: badge + why-sentence) rendered as the handoff pill + sentence. The pill's three states map from the compatibility result; the mapping thresholds live in a parameter row, not in code. The handoff's per-user "YOU" dimension values and "91% match" are **not built** (no data basis yet, Dana 2026-09-26); the aside shows pill + sentence + "Unsure? Talk to Liam".
- Lineup shows every slot the family has, visible ones only (unfilled slots invisible, Dana 2026-10-13); "The four Floral coffees" uses the real count.
- Prices from the payload with the weight selector kept (D13); "Premium ★" = award (D12); the quick picks (classic + Collection) stay as a row under the lineup in the design's card style.

**Guardrails.** G4.1 reuse: `DialArchetypeSection`, `RevealedPanel`, `useCompatibility`, `TastingNotes`, `DimensionBars`, `CompareOverlay`, `DoorBand`, `OtherCategoryCard` (now under the OT-70 rule: unnamed category coffees are hidden), `useCart`, `bloom/cartItems.ts` and `useSlotAvailability` (extracted by Website 4; build no cart item or availability rule inline), `setDialPosition`, `ShopCoffeeCard` (lineup cards), `getCoffeeCards()` / the `/cards` payload for the card fields, chrome primitives · G4.2 nothing typed in (words, hints, thresholds, dimension names and end words come from the API; the wheel's petal thresholds are geometry) · G2.1 the comfort-zone thresholds as a parameter row (brief 2's parameter table) · G4.3 · G4.5 · G4.6 · G1.6. Schema: one parameter row only (seed, idempotent; `comments.sql` if a new row needs a comment per the table's convention). STOP: none.

## Task 0 — verify first (findings into `CLOSING_REPORT_5.md`)

1. Read `BloomPage.tsx`, `DialArchetypeSection.tsx`, `BloomDial.tsx`, `RevealedPanel.tsx`, `useCompatibility`, `usePositionCardData`, `doorConfig`, `archetypeConfig`, `fillEngine`, `bloomVisuals`, `CompareOverlay`, `OtherCategoryCard`, `lib/prelaunch.ts`. Write the **feature inventory** as a checklist (every item below must be ticked at the end): silent auto-save of position + pre-set from saved position · explicit "Save to flavor memory" + "View in flavor memory" · add-to-cart dial event · weight/price selector, unpriced, unavailable, coming-soon states · quick picks (classic, Collection with discount) · compare overlay · reveal: compatibility badge + why, TastingNotes, DimensionBars, collaborative wheel, guest line "Find your flavor to see your match" · archetype order personalization + YOUR / TO EXPLORE kicker · doors between archetypes · `?archetype=&slot=` deep links (Liam and the quiz) · three-beat strip (`hasTurnedDial`) · sticky archetype nav · Other Categories · prelaunch gating · `hasLiamAccess` gating · `role=slider`, keyboard, `aria-valuenow`, reduced motion.
2. Read the handoff script: `FAMS` fields, `paint()`, `spin()`, `tints()`, `setFam`, `setT`, the slider/drag/arrow handlers, the comfort-zone text and thresholds (lines ~388–465).
3. Confirm brief 2's payload carries words, hint, spec rows, dimension end words (`dimensionScaleMinLabel/MaxLabel`), and the eight cupping ranges the reveal draws.
4. Measure the current dial's event log contract (`customer_dial_event`, `dial_position_signal`): which triggers are written and from where; the new wheel must emit the same.

If the inventory finds a feature with no home in the handoff layout, STOP and propose its placement before Part A.

## Task 0.5 — Dana's manual steps

None.

## Part A — `FlowerWheel`

- Port the SVG (petal paths, `data-thr/tier/ang`) into `FlowerWheel.tsx`: props `t` (0..1), `stops` (count), `tint` (family colour set), `onChange(t)`, `onCommit(t)`; drag (pointer angle delta, snap on release), slider (`<input type=range>` with `role` semantics kept: `aria-valuenow`, `aria-valuetext` = stop label), ←/→ keys when focused, reduced motion (no spin animation, instant paint). Petals bloom by threshold as in `paint()`; the family tint set is computed by one `tints(colour)` helper from the archetype colour (the handoff's `t40/t60/t80` rule; Balanced special case ported as a per-archetype override that lives in `archetypeConfig`, not in the wheel).
- Stops = the family's visible slots; `t` ↔ slot by `k/(N-1)`; the default slot centred as `computeStopPositions` does today (keep that behaviour: the wheel opens on the default slot, or the saved position, or the deep-linked slot).

## Part B — the page

- **Top**: "The Bloom Dial" h1 + the 01/02/03 strip (replaces the three-beat strip; `hasTurnedDial` still hides the hint text after the first turn). Family tabs = the five archetypes in `archetype-order` (personalized) with the YOUR / TO EXPLORE kicker as a small `Caps` on the tab; sticky at the top offset; the tab is URL state: `?archetype=` as today, `&slot=` selects the stop.
- **Field** (`DialArchetypeSection layout="field"`): page tint from the family; left `FlowerWheel`; middle the coffee block (Premium ★, stop bar, words, name, signature notes, hint, spec rows present only, "Reveal the full profile"); right the comfort-zone aside (pill from the compatibility state, the why-sentence, "Unsure? Talk to Liam" → `/sommelier`, hidden by `hasLiamAccess`/prelaunch; guests see "Find your flavor to see your match" → quiz). Below the middle block, the commerce line as the handoff's reveal footer shows it ("Add to cart · {price}", "{weight} oz whole bean") plus the weight chips when more than one price, and the three states (unpriced, unavailable, coming soon) in `Caps`. "Save to flavor memory" / "View in flavor memory" as `Caps` links under the commerce line.
- **Reveal panel** (`RevealedPanel` restyled, two columns): left "In the roaster's words" (`TastingNotes` content) + the optional note; right the eight cupping range bars (`DimensionBars`, end words from the payload) and the collaborative wheel under them (collapsed by default, "See the notes wheel"). Footer links: "Full breakdown ↗" → `/flavor-intelligence` deep link, "Ask Liam ↗", "Your profile ↗" → `/profile`; `CompareOverlay` opens from a "Compare with the neighbour" link here (the current trigger, restyled).
- **Lineup**: "The {n} {Family} coffees · From lighter to richer" (end words from the dimension payload) with `ShopCoffeeCard` in compact mode; clicking a card turns the wheel to it. Under it: the quick-picks row (classic + Collection) restyled, then `OtherCategoryCard` block, then `DoorBand` (doors as the handoff's `Btn` style, "Turn the {neighbour} dial →"), then "Take the quiz" link.
- Every dial event (`explicit_save`, `add_to_cart`, auto-save) fires exactly as before.

## Part C — parameter

`bloom_comfort_zone_thresholds` (or the name brief 2's parameter table convention gives): maps the compatibility result to In / At the edge / Outside; seeded from the handoff's 1/2/3 steps translated to the compatibility payload's scale (Task 0 states the translation). Read at page load with the other rules.

## Part D — tests

vitest: the feature inventory as tests where unit-testable (deep link selects stop, auto-save fires on commit, explicit save calls `setDialPosition` with the right trigger, add-to-cart emits the dial event, compatibility maps to the pill through the parameter, gated/guest/Liam-less variants, keyboard changes the stop, reduced motion skips animation). Snapshot test of `FlowerWheel` at t=0, .5, 1.

## Acceptance

Live `?preview=true`, signed out and in: 390/1280 screenshots of each family's field, the reveal, the lineup; `/bloom?archetype=fruity&slot=2` lands on the stop; a Liam deep link from `/sommelier` still lands; a save appears on `/profile` flavor memory; the dial event rows appear in the test DB with the same triggers as before. Keyboard-only turn of the wheel. Closing report ticks the Task 0 inventory line by line.

## Docs and closing

`WHAT_WE_BUILT.md`, `REGRESSION.md` (the inventory), `OPEN_TASKS.md` (remove the old dial layout once quiz result + profile move; per-user dimension profile and match % when palate data exists; wheel a11y audit), `CLOSING_REPORT_5.md`.

## Do not

- Do not drop any inventory item; propose a placement instead.
- Do not re-implement the card, the reveal, compatibility, cart or the event log; extend `DialArchetypeSection` and `RevealedPanel`.
- Do not show a match percentage, a per-user dimension value, a roaster name or an award name.
- Do not type family words, hints, thresholds, dimension names or end words.
