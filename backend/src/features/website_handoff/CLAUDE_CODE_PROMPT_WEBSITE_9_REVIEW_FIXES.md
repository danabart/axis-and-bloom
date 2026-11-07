# Brief: Website 9 — Dana's review fixes, site audit, close-out

**Workstream:** website_handoff · **Date:** 2026-11-06 · **Model tier:** cheaper/faster for the fixes; the wheel interaction (Part B) may be run on the strongest model if Task 0 finds it needs geometry changes · **Mode:** test, then push · **Depends on:** briefs 1–8 live. **This brief STOPS after Task 0** and reports; Dana and the CTO session decide the fix list before Part A.

Read first: `README.md` (merge rule, D5, D14, D15), `CLOSING_REPORT_3.md`, `_5.md`, `_7B.md`, `_8.md` (their inventories are the audit checklist), `DEVELOPMENT_GUARDRAILS.md`, `CATALOG.md` (G2.4).

## Dana's findings (2026-11-06, in her words, numbered as she gave them)

1. Home, signed in: "I see in the home page that I'm chocolate and nutty and then I see the balance picture next to it." (Section 03's figure is the handoff's fixed Balanced photo; the lifecycle message names her family.)
2. The Bloom:
   - 2.1 "The dial is not intuitive to turn. I need now to click on the straight line for it to turn and sometimes the screen is jumping. It doesn't look stable. The screen jumps when I try to click on the dial and turn it with the mouse. It worked better before the UI change. The bloom works better in 'find my flavor' page, it feels like the old functionality."
   - 2.2 Tabs show her family as YOUR and every other family as TO EXPLORE: "this doesn't look data driven, and it's also not correct."
   - 2.3 "When I click on the squares in the bottom of the dial the screen jumps up to the dial. I think that's not the behavior we want." And: "at the bottom of each square there is a comment like 'full profile' but where is the full profile?"
3. Shop: "I should see the same comment next to every family of taste, what its relationship with me, like 'worth exploring' or 'outside of my comfort zone'."
4. "Please do additional check-up."

## Decisions already made (CTO, 2026-11-06; Dana may overturn)

- **D16 Family relationship is data.** The YOUR / TO EXPLORE kicker (`BloomPage.tsx:212`, `DialArchetypeSection.tsx:242`, typed in before this redesign) is replaced by a relationship per family computed server-side from the same adjacency the archetype-order endpoint uses (`catalogReads.getArchetypeOrder`, `v_coffee_archetype_adjacency`): `your_family`, `neighbour`, `beyond` (code names provisional; Task 0 proposes final ones). Customer labels live in a lookup table (G2.7: `id`, `code UNIQUE`, `label`, `customer_label`), seeded "Your family" / "Worth exploring" / "Outside your comfort zone". One endpoint, `GET /api/coffees/archetype-relationships?archetype=<customer's>` (or a field on `/archetype-order`; Task 0 picks the one that avoids a second reader), read by The Bloom tabs and the Shop sections. Guests see no label. `archetype_relationship` already exists in `CATALOG.md` with no writer and no reader: Task 0 reads its columns and states whether it is the home for this, or why not (G2.4); nothing new is created if it fits.
- **D17 Home figure follows the family.** In section 03, when `homepageState.archetype` is set the figure shows that family's photo (`homeAssets.family[slug]`, fallback as today); only the anonymous / `NEW_NO_QUIZ` state shows the handoff's Balanced photo.
- **D18 Turning the dial never scrolls.** A turn (wheel drag, slider, keys, lineup card click) changes the stop in place. The page scrolls only on a deep link on load, a door, or a tab click, and a tab click scrolls only when the field is out of view. No `focus()` that moves the viewport.
- **D19 Wheel interaction parity with the old dial.** Drag anywhere on the wheel (petals, rim, centre), mouse and touch (`touch-action: none` on the wrap, pointer capture, no text selection), smooth and stable (no rAF loop fighting the drag; snap on release only), the slider and arrow keys as today. The quiz result page's dial is the reference Dana prefers; Task 0 says precisely what differs.
- **D20 Lineup card.** Click = turn the dial to that coffee in place (D18) with a selected state on the card. "Full profile ↗" is a real link to the coffee's full profile (`/flavor-intelligence` deep link, as the Shop card has) and its click does not bubble to the card.
- **OT-93** the drawer's sign-in link matches `/cart` (`?mode=signin&redirect=/checkout`) · **OT-94** the confirmation page line follows D14 (order facts only) · **OT-67** the old hex literals on Profile, Liam, About, How it works, Privacy, Terms, Crawl, QR door, Join household and the gate pages are swapped to the tokens (colour and type only; no layout change).

## Guardrails

G4.1 reuse (`FlowerWheel`, `DialArchetypeSection layout="field"`, `BloomDial` as the reference, `ShopAll`, `ShopCoffeeCard`, `Home`, `catalogReads.getArchetypeOrder`) · G4.2 nothing typed in (relationship labels from the lookup) · G2.1/G2.2/G2.4/G2.5/G2.7/G2.17 for the lookup and the endpoint · G4.3 tsc clean, every touched page verified live · G4.4 · G1.6 one closing report. Mode: test. **STOP point: after Task 0.**

## Task 0 — audit, read-only, then STOP and report (write `CLOSING_REPORT_9.md` Task 0 section)

1. **Dana's items.** For each of 1, 2.1, 2.2, 2.3, 3: the exact code path causing it (file:line), and the fix you propose under D16–D20, with any question that changes the fix.
2. **Wheel.** Compare `bloom/wheel/FlowerWheel.tsx` with `bloom/dial/BloomDial.tsx` pointer handling and with what the quiz result page renders today: list every difference in drag target, capture, touch-action, snapping, animation loop, and every `scrollIntoView` / `focus()` on the Bloom page and in the field section with the event that triggers it.
3. **Relationship source.** `archetype_relationship` columns, writer, readers (CATALOG.md); `v_coffee_archetype_adjacency`; how `getArchetypeOrder` orders neighbours. Propose the table/view/endpoint with the G2.4 statement.
4. **Site audit.** Walk every public page signed out and signed in (Dana's Chrome through the extension where it works, otherwise local against the test DB), at 1280 and 390: `/`, `/shop`, `/bloom`, `/the-axis`, `/find-my-flavor` (entry, a question, branch, result), `/sign-in`, `/cart`, `/checkout`, `/profile`, `/sommelier`. Check each page against its closing report's inventory and list, with a screenshot each: anything broken, any scroll jump, any typed number or word that should be data, any copy that names what we are not doing or promises timing (D14), any roaster or award name, any old colour.
5. Report the complete fix list (Dana's five + OT-93/94/67 + whatever the audit found), grouped Part A schema/API, Part B wheel and Bloom, Part C Home and Shop, Part D other pages, with an estimate. **STOP.**

## Parts A–D

Written after Task 0 is reviewed. Expect: A lookup + endpoint + comments.sql + catalog:md; B D18–D20; C D16 on tabs and sections, D17; D OT-93/94/67 and audit fixes. Tests for each rule (relationship per family from a mocked payload, no scroll on turn, card link navigates, Home figure per stage, drawer link). Acceptance: Dana's five items re-checked live in her browser, signed in.

## Do not

- Do not start Part A before the Task 0 report is reviewed.
- Do not type a relationship word, a family name or a number into a component.
- Do not change dial semantics (stops, default slot, saved position, events); only how it is turned and whether the page scrolls.

## Decisions after Task 0 (Dana + CTO, 2026-11-06)

- **Q1: C.** A family is `adjacent` when a bridge hop exists in `v_coffee_archetype_adjacency`; otherwise by cupping-profile distance against the customer's family using the same `evidence_parameter` thresholds as the per-coffee pill (`comfort_zone_edge_delta` → adjacent, `dimension_delta_significant` → distant). **Family reference profiles are pooled from cupped coffees (`v_coffee_dimension_range` / `coffee_dimensions`) only; `archetype_vector` and `v_archetype_vectors` (retired assumed targets) are never read.** `archetype_relationship` stays untouched and unused.
- **Q2.** Lookup `coffee_archetype_relationship_kind` with `own` / `adjacent` / `distant` → "Your family" / "Worth exploring" / "Outside your comfort zone". The per-coffee pill words (`COMFORT_ZONE_LABEL`) and the old badge words (`BADGE_CONFIG`) move into the lookup (a sibling table or a `scope` column, Task A decides, G2.7); `getCompatibility()`'s family level reads the relationships; no relationship word remains in code.
- **Q3.** Fix the flower wheel (B1–B4): drag anywhere without flipping, no wheel movement between stops, no page scroll on a turn, imperative paint during drag, settled-stop fetches.
- **Q4.** Rewrite the three Axis lines (AU4). Remove "this fall" and the typed count from the curtain and the gate (AU5, AU6): no launch date is promised; the count renders from the API or is dropped. Old `BloomDial` card: Premium ★ (D12), shipping from `getCheckoutRules()` (D13).
- **Q5.** Flavor Intelligence joins the OT-67 colour swap.
- **Also:** AU8 Profile's typed archetype "features" (`routes/users.ts:51–58`) are replaced by the family's `customer_words` from the archetype payload (one source); AU9 scroll reset on route change in `App.tsx`, keeping hash and `?archetype=`/`&slot=` landings; AU11 no "Save to flavor memory" on a placeholder/Coming soon stop; AU12 a signed-in visitor on `/sign-in` is sent to `redirect` or `/profile`; AU1, AU3, AU13, AU14 as proposed.
